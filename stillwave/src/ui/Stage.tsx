// The canvas workspace: WebGL artwork underneath, a 2D overlay for washes and
// handles on top, and every direct-manipulation gesture.
import { useEffect, useRef } from 'react';
import { images, layerCorners, maskBounds, masks, registerMask, sampleMask, zoneBounds } from '../engine/assets';
import { axisFrame, eyeContains, eyeOutline, mouthContains } from '../engine/geom';
import { fitView, Renderer } from '../engine/gl';
import { beginMask, strokeSegment } from '../engine/paint';
import { isPaintZone, ZONE_INFO, type Doc, type EyeZone, type Layer, type MouthZone, type Vec, type Zone } from '../engine/types';
import { useStore } from '../state/store';
import { live } from './live';

interface Handle { id: string; x: number; y: number; shape?: 'dot' | 'ring' | 'diamond' | 'lid' }

type Drag =
  | { kind: 'pan'; sx: number; sy: number; panX: number; panY: number }
  | { kind: 'layer-move'; id: string; start: Vec; ox: number; oy: number; key: string }
  | { kind: 'layer-scale'; id: string; scale: number; d0: number; key: string }
  | { kind: 'layer-rotate'; id: string; rot: number; a0: number; key: string }
  | { kind: 'handle'; zone: string; handle: string; key: string }
  | { kind: 'zone-move'; zone: string; last: Vec; key: string }
  | { kind: 'paint'; zone: string; canvas: HTMLCanvasElement; last: Vec; first: Vec; erase: boolean };

let dragSerial = 0;

function layerHit(l: Layer, p: Vec): boolean {
  const c = Math.cos(-l.rotation), s = Math.sin(-l.rotation);
  const dx = p.x - l.x, dy = p.y - l.y;
  const lx = (dx * c - dy * s) / l.scale + l.w / 2;
  const ly = (dx * s + dy * c) / l.scale + l.h / 2;
  if (lx < 0 || ly < 0 || lx >= l.w || ly >= l.h) return false;
  const a = images.get(l.image);
  if (!a) return true;
  const px = a.canvas.getContext('2d')!.getImageData(Math.floor((lx / l.w) * a.w), Math.floor((ly / l.h) * a.h), 1, 1).data;
  return px[3] > 10;
}

function zoneHandles(z: Zone, zoom: number): Handle[] {
  if (z.type === 'sway') return [{ id: 'anchor', ...z.anchor, shape: 'ring' }, { id: 'tip', ...z.tip, shape: 'diamond' }];
  if (z.type === 'head') return [{ id: 'pivot', ...z.pivot, shape: 'ring' }];
  if (z.type === 'breath') return [{ id: 'base', ...z.base, shape: 'ring' }];
  const f = axisFrame(z);
  if (z.type === 'mouth') {
    return [{ id: 'a', ...z.a }, { id: 'b', ...z.b }, { id: 'bow', ...f.at(0, z.bow) }, { id: 'open', ...f.at(0, z.bow - Math.max(z.openH, 14 / zoom)), shape: 'diamond' }];
  }
  const cl = (t: number) => Math.min(0.85, Math.max(-0.85, t * f.flip));
  const lidX = 1 + 22 / zoom / f.hw;
  return [
    { id: 'a', ...z.a }, { id: 'b', ...z.b },
    { id: 'up', ...f.at(cl(z.upT), z.upH) },
    { id: 'lo', ...f.at(cl(z.loT), -z.loH) },
    { id: 'band', ...f.at(cl(z.upT), z.upH + z.band + 10 / zoom), shape: 'diamond' },
    { id: 'lid', ...f.at(lidX, z.upH - (z.upH + z.loH) * (live.anim.lidScrub[z.id] ?? 0)), shape: 'lid' },
  ];
}

function applyHandle(z: Zone, handle: string, p: Vec) {
  if (z.type === 'sway') { if (handle === 'anchor') z.anchor = p; else z.tip = p; z.auto = false; return; }
  if (z.type === 'head') { z.pivot = p; z.auto = false; return; }
  if (z.type === 'breath') { z.base = p; z.auto = false; return; }
  if (handle === 'a' || handle === 'b') { z[handle] = p; return; }
  const f = axisFrame(z);
  const { t, y } = f.local(p);
  if (z.type === 'mouth') { if (handle === 'open') z.openH = Math.max(4, z.bow - y); if (handle === 'bow') z.bow = y; return; }
  const tt = Math.min(0.8, Math.max(-0.8, t)) * f.flip;
  if (handle === 'up') { z.upT = tt; z.upH = Math.max(2, y); }
  if (handle === 'lo') { z.loT = tt; z.loH = Math.max(1, -y); }
  if (handle === 'band') z.band = Math.max(0, y - z.upH - 10 / live.view.zoom);
}

export function Stage() {
  const wrap = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrap.current!, glCanvas = glRef.current!, ov = ovRef.current!, board = boardRef.current!;
    let renderer: Renderer;
    try {
      renderer = new Renderer(glCanvas);
    } catch (err) {
      useStore.getState().toast((err as Error).message, 'error');
      return;
    }
    const ctx = ov.getContext('2d')!;
    const S = useStore.getState;
    let drag: Drag | null = null;
    let cursor: Vec | null = null; // screen px, relative to the stage
    let spaceDown = false;
    let spacePanned = false;
    let fittedNonce = -1;
    let hoverHandle: string | null = null;
    let raf = 0;
    let last = performance.now();

    const size = () => ({ w: el.clientWidth, h: el.clientHeight });
    const toDoc = (sx: number, sy: number): Vec => ({ x: (sx - live.view.panX) / live.view.zoom, y: (sy - live.view.panY) / live.view.zoom });
    const toScreen = (p: Vec): Vec => ({ x: p.x * live.view.zoom + live.view.panX, y: p.y * live.view.zoom + live.view.panY });
    const local = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const insets = () => {
      const s = S();
      const side = s.panels && s.mode !== 'stage' ? 300 : 40;
      return { l: side, r: s.panels ? 320 : 40, t: 76, b: 120 };
    };
    const fit = () => {
      const { w, h } = size();
      const i = insets();
      const d = S().doc;
      const v = fitView(d, Math.max(100, w - i.l - i.r), Math.max(100, h - i.t - i.b));
      live.view = { zoom: v.zoom, panX: v.panX + i.l, panY: v.panY + i.t };
    };

    const zoneAt = (doc: Doc, p: Vec, selected: string | null): Zone | null => {
      const order = [...doc.zones].reverse().sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
      const pad = 6 / live.view.zoom;
      for (const z of order) {
        if (z.type === 'eye' && eyeContains(z, p, pad)) return z;
        if (z.type === 'mouth' && mouthContains(z, p, pad)) return z;
      }
      for (const z of order) {
        if (!isPaintZone(z)) continue;
        if (z.whole) {
          if (doc.layers.some((l) => (z.layers === 'all' || z.layers.includes(l.id)) && l.visible && layerHit(l, p)) && z.id === selected) return z;
          continue;
        }
        const m = z.mask ? masks.get(z.mask) : null;
        if (m && sampleMask(m, p.x / doc.width, p.y / doc.height) > 0.12) return z;
      }
      // whole-layer zones last: smallest region wins
      let best: Zone | null = null;
      let bestArea = Infinity;
      for (const z of order) {
        if (!isPaintZone(z) || !z.whole) continue;
        const b = zoneBounds(doc, z);
        if (!b || p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) continue;
        if (!doc.layers.some((l) => (z.layers === 'all' || z.layers.includes(l.id)) && l.visible && layerHit(l, p))) continue;
        const area = (b.x1 - b.x0) * (b.y1 - b.y0);
        if (area < bestArea) { best = z; bestArea = area; }
      }
      return best;
    };

    const handleAt = (z: Zone, sp: Vec): Handle | null => {
      for (const h of zoneHandles(z, live.view.zoom).reverse()) {
        const s = toScreen(h);
        if (Math.hypot(s.x - sp.x, s.y - sp.y) < 9) return h;
      }
      return null;
    };

    const layerHandles = (l: Layer) => {
      const cs = layerCorners(l).map(toScreen);
      const top = { x: (cs[0].x + cs[1].x) / 2, y: (cs[0].y + cs[1].y) / 2 };
      const c = toScreen(l);
      const len = Math.hypot(top.x - c.x, top.y - c.y) || 1;
      const rot = { x: top.x + ((top.x - c.x) / len) * 26, y: top.y + ((top.y - c.y) / len) * 26 };
      return { cs, top, rot, c };
    };

    // ------------------------------------------------------------ pointer input
    const onDown = (e: PointerEvent) => {
      const s = S();
      const sp = local(e);
      const p = toDoc(sp.x, sp.y);
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (e.button === 1 || e.button === 2 || spaceDown) {
        drag = { kind: 'pan', sx: sp.x, sy: sp.y, panX: live.view.panX, panY: live.view.panY };
        spacePanned = true;
        ov.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;
      ov.setPointerCapture(e.pointerId);
      const key = `drag${++dragSerial}`;
      const doc = s.doc;

      if (s.mode === 'stage' || (s.mode === 'motion' && s.playing)) {
        live.anim.nudge(1);
        return;
      }

      if (s.mode === 'artwork') {
        const sel = doc.layers.find((l) => l.id === s.layerId);
        if (sel) {
          const h = layerHandles(sel);
          if (Math.hypot(h.rot.x - sp.x, h.rot.y - sp.y) < 11) {
            drag = { kind: 'layer-rotate', id: sel.id, rot: sel.rotation, a0: Math.atan2(p.y - sel.y, p.x - sel.x), key };
            return;
          }
          if (h.cs.some((c) => Math.hypot(c.x - sp.x, c.y - sp.y) < 11)) {
            drag = { kind: 'layer-scale', id: sel.id, scale: sel.scale, d0: Math.max(1, Math.hypot(p.x - sel.x, p.y - sel.y)), key };
            return;
          }
        }
        const hit = [...doc.layers].reverse().find((l) => l.visible && layerHit(l, p));
        s.set({ layerId: hit?.id ?? null });
        if (hit) drag = { kind: 'layer-move', id: hit.id, start: p, ox: hit.x, oy: hit.y, key };
        return;
      }

      // motion mode, paused
      const zone = doc.zones.find((z) => z.id === s.zoneId);
      if ((s.tool === 'brush' || s.tool === 'erase') && zone && isPaintZone(zone)) {
        if (zone.whole) { s.toast('This motion moves whole layers. Turn off "Move whole layers" to paint it.'); return; }
        const canvas = beginMask(doc, zone.mask);
        drag = { kind: 'paint', zone: zone.id, canvas, last: p, first: p, erase: s.tool === 'erase' };
        paintTo(p);
        return;
      }
      if (zone) {
        const h = handleAt(zone, sp);
        if (h) {
          drag = { kind: 'handle', zone: zone.id, handle: h.id, key };
          if (h.id === 'lid') onMove(e);
          return;
        }
      }
      const hit = zoneAt(doc, p, s.zoneId);
      s.set({ zoneId: hit?.id ?? null, ...(hit ? { tab: 'motion' as const } : {}) });
      if (hit && (hit.type === 'eye' || hit.type === 'mouth')) drag = { kind: 'zone-move', zone: hit.id, last: p, key };
    };

    const paintTo = (p: Vec) => {
      if (drag?.kind !== 'paint') return;
      const s = S();
      const zone = s.doc.zones.find((z) => z.id === (drag as { zone: string }).zone);
      if (!zone) return;
      const k = drag.canvas.width / s.doc.width;
      strokeSegment(drag.canvas.getContext('2d')!, drag.last.x * k, drag.last.y * k, p.x * k, p.y * k, (s.brush.size / 2) * k, s.brush.soft, ZONE_INFO[zone.type].color, drag.erase);
      drag.last = p;
    };

    const onMove = (e: PointerEvent) => {
      const sp = local(e);
      cursor = sp;
      const p = toDoc(sp.x, sp.y);
      const s = S();
      if (!drag) {
        // follow the pointer while live; find hover targets while editing
        const d = s.doc;
        live.anim.pointer = { x: Math.max(-1, Math.min(1, (p.x - d.width / 2) / (d.width * 0.7))), y: Math.max(-1, Math.min(1, (p.y - d.height * 0.4) / (d.height * 0.7))) };
        if (s.mode === 'motion' && !s.playing && s.tool === 'move') {
          const zone = d.zones.find((z) => z.id === s.zoneId);
          hoverHandle = zone ? handleAt(zone, sp)?.id ?? null : null;
          const hit = hoverHandle ? null : zoneAt(d, p, s.zoneId);
          const id = hit?.id ?? null;
          if (id !== s.hoverZone) s.set({ hoverZone: id });
        } else if (s.hoverZone) s.set({ hoverZone: null });
        return;
      }
      switch (drag.kind) {
        case 'pan':
          live.view.panX = drag.panX + sp.x - drag.sx;
          live.view.panY = drag.panY + sp.y - drag.sy;
          break;
        case 'layer-move': {
          const g = drag;
          s.edit((d) => { const l = d.layers.find((x) => x.id === g.id); if (l) { l.x = Math.round(g.ox + p.x - g.start.x); l.y = Math.round(g.oy + p.y - g.start.y); } }, g.key);
          break;
        }
        case 'layer-scale': {
          const g = drag;
          s.edit((d) => { const l = d.layers.find((x) => x.id === g.id); if (l) l.scale = Math.max(0.02, g.scale * (Math.hypot(p.x - l.x, p.y - l.y) / g.d0)); }, g.key);
          break;
        }
        case 'layer-rotate': {
          const g = drag;
          s.edit((d) => {
            const l = d.layers.find((x) => x.id === g.id);
            if (!l) return;
            let r = g.rot + Math.atan2(p.y - l.y, p.x - l.x) - g.a0;
            if (e.shiftKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
            l.rotation = r;
          }, g.key);
          break;
        }
        case 'handle': {
          const g = drag;
          if (g.handle === 'lid') {
            const z = s.doc.zones.find((x) => x.id === g.zone) as EyeZone | undefined;
            if (z) live.anim.lidScrub[z.id] = Math.min(1, Math.max(0, (z.upH - axisFrame(z).local(p).y) / (z.upH + z.loH)));
          } else s.editZone(g.zone, (z) => applyHandle(z, g.handle, p), g.key);
          break;
        }
        case 'zone-move': {
          const g = drag;
          const dx = p.x - g.last.x, dy = p.y - g.last.y;
          g.last = p;
          s.editZone<EyeZone | MouthZone>(g.zone, (z) => { z.a = { x: z.a.x + dx, y: z.a.y + dy }; z.b = { x: z.b.x + dx, y: z.b.y + dy }; }, g.key);
          break;
        }
        case 'paint':
          paintTo(p);
          break;
      }
    };

    const onUp = () => {
      const g = drag;
      drag = null;
      if (!g) return;
      if (g.kind === 'handle' && g.handle === 'lid') live.anim.lidScrub[g.zone] = 0;
      if (g.kind === 'paint') {
        const s = S();
        const id = registerMask(g.canvas);
        const b = maskBounds(masks.get(id)!);
        const d = s.doc;
        s.editZone(g.zone, (z) => {
          if (!isPaintZone(z)) return;
          const firstPaint = !z.mask;
          z.mask = id;
          if (!z.auto || !b) return;
          const cx = ((b.x0 + b.x1) / 2) * d.width, bottom = b.y1 * d.height, hgt = (b.y1 - b.y0) * d.height;
          if (z.type === 'sway' && firstPaint && Math.hypot(g.last.x - g.first.x, g.last.y - g.first.y) > 12) { z.anchor = g.first; z.tip = g.last; }
          if (z.type === 'head') z.pivot = { x: cx, y: bottom - hgt * 0.1 };
          if (z.type === 'breath') z.base = { x: cx, y: bottom };
        });
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const sp = local(e);
      const v = live.view;
      if (e.ctrlKey || Math.abs(e.deltaY) >= 40 || e.deltaMode !== 0) {
        const k = Math.exp(-(e.deltaMode ? e.deltaY * 30 : e.deltaY) * (e.ctrlKey ? 0.01 : 0.0016));
        const zoom = Math.min(24, Math.max(0.04, v.zoom * k));
        v.panX = sp.x - ((sp.x - v.panX) / v.zoom) * zoom;
        v.panY = sp.y - ((sp.y - v.panY) / v.zoom) * zoom;
        v.zoom = zoom;
      } else {
        v.panX -= e.deltaX;
        v.panY -= e.deltaY;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
      if (e.type === 'keydown') {
        if (!e.repeat) { spaceDown = true; spacePanned = false; }
        e.preventDefault();
      } else {
        spaceDown = false;
        const s = S();
        if (!spacePanned && s.mode === 'motion') s.set({ playing: !s.playing, hoverZone: null });
      }
    };
    const onLeave = () => { cursor = null; live.anim.pointer = null; if (S().hoverZone) S().set({ hoverZone: null }); };

    ov.addEventListener('pointerdown', onDown);
    ov.addEventListener('pointermove', onMove);
    ov.addEventListener('pointerup', onUp);
    ov.addEventListener('pointercancel', onUp);
    ov.addEventListener('pointerleave', onLeave);
    ov.addEventListener('wheel', onWheel, { passive: false });
    ov.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    // ------------------------------------------------------------ overlay drawing
    const poly = (pts: Vec[], close = false) => {
      ctx.beginPath();
      pts.forEach((p, i) => { const s = toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      if (close) ctx.closePath();
    };
    const drawHandle = (h: Handle, color: string, hot: boolean) => {
      const s = toScreen(h);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#141824';
      ctx.fillStyle = hot ? '#ffffff' : color;
      const r = hot ? 6.5 : 5.5;
      ctx.beginPath();
      if (h.shape === 'diamond') { ctx.rotate(Math.PI / 4); ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6); }
      else if (h.shape === 'lid') { ctx.roundRect(-9, -5, 18, 10, 5); }
      else ctx.arc(0, 0, h.shape === 'ring' ? r + 1.5 : r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (h.shape === 'ring') { ctx.fillStyle = '#141824'; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, 7); ctx.fill(); }
      ctx.restore();
    };

    const drawOverlay = (dpr: number) => {
      const s = S();
      const d = s.doc;
      const { w, h } = size();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const v = live.view;

      if (s.mode === 'artwork') {
        const l = d.layers.find((x) => x.id === s.layerId);
        if (l) {
          const hd = layerHandles(l);
          ctx.strokeStyle = '#a9b4ff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          hd.cs.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
          ctx.closePath();
          ctx.moveTo(hd.top.x, hd.top.y);
          ctx.lineTo(hd.rot.x, hd.rot.y);
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#141824';
          for (const c of hd.cs) { ctx.beginPath(); ctx.rect(c.x - 5, c.y - 5, 10, 10); ctx.fill(); ctx.stroke(); }
          ctx.beginPath(); ctx.arc(hd.rot.x, hd.rot.y, 6, 0, 7); ctx.fill(); ctx.stroke();
        }
        return;
      }
      if (s.mode !== 'motion' || s.playing || s.tab === 'mood') return;

      const demo = live.anim.demo;
      // washes: where each motion has been painted
      for (const z of d.zones) {
        if (!isPaintZone(z) || !z.enabled) continue;
        const sel = z.id === s.zoneId, hov = z.id === s.hoverZone;
        const working = drag?.kind === 'paint' && drag.zone === z.id ? drag.canvas : null;
        const src = working ?? (z.mask ? masks.get(z.mask)?.canvas : null);
        if (src && !z.whole) {
          ctx.globalAlpha = demo === z.id && !sel ? 0.12 : sel ? 0.5 : hov ? 0.4 : 0.2;
          ctx.drawImage(src, v.panX, v.panY, d.width * v.zoom, d.height * v.zoom);
          ctx.globalAlpha = 1;
        } else if (z.whole && (sel || hov)) {
          const b = zoneBounds(d, z);
          if (b) {
            ctx.strokeStyle = ZONE_INFO[z.type].color;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 5]);
            ctx.globalAlpha = sel ? 0.9 : 0.5;
            ctx.strokeRect(b.x0 * v.zoom + v.panX, b.y0 * v.zoom + v.panY, (b.x1 - b.x0) * v.zoom, (b.y1 - b.y0) * v.zoom);
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }
        }
      }
      // eye and mouth outlines
      for (const z of d.zones) {
        if (!z.enabled) continue;
        const sel = z.id === s.zoneId, hov = z.id === s.hoverZone;
        const color = ZONE_INFO[z.type].color;
        ctx.lineJoin = 'round';
        if (z.type === 'eye') {
          const o = eyeOutline(z);
          ctx.globalAlpha = sel ? 1 : hov ? 0.9 : 0.55;
          poly([...o.up, ...o.lo.reverse()], true);
          ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(20,24,36,0.55)'; ctx.stroke();
          ctx.lineWidth = 1.6; ctx.strokeStyle = color; ctx.stroke();
          if (sel) {
            ctx.setLineDash([3, 4]);
            poly(o.band); ctx.stroke();
            ctx.setLineDash([]);
            // track for the lid pull
            const lidX = 1 + 22 / v.zoom / o.f.hw;
            poly([o.f.at(lidX, z.upH), o.f.at(lidX, -z.loH)]);
            ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,24,36,0.6)'; ctx.lineCap = 'round'; ctx.stroke();
            ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
          }
          ctx.globalAlpha = 1;
        } else if (z.type === 'mouth') {
          const f = axisFrame(z);
          ctx.globalAlpha = sel ? 1 : hov ? 0.9 : 0.55;
          const pts: Vec[] = [];
          for (let i = 0; i <= 20; i++) { const t = -1 + i / 10; pts.push(f.at(t, z.bow * (1 - t * t) + (sel ? -z.openH * 0.75 * Math.pow(1 - t * t, 0.65) : 0))); }
          const top: Vec[] = [];
          for (let i = 20; i >= 0; i--) { const t = -1 + i / 10; top.push(f.at(t, z.bow * (1 - t * t) + (sel ? z.openH * 0.25 * Math.pow(1 - t * t, 0.65) : 0))); }
          poly([...pts, ...top], true);
          ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(20,24,36,0.55)'; ctx.stroke();
          ctx.lineWidth = 1.6; ctx.strokeStyle = color; ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      // handles of the selected motion
      const zone = d.zones.find((z) => z.id === s.zoneId);
      if (zone && s.tool === 'move') {
        const color = ZONE_INFO[zone.type].color;
        if (zone.type === 'sway') {
          const a = toScreen(zone.anchor), t = toScreen(zone.tip);
          ctx.strokeStyle = 'rgba(20,24,36,0.6)'; ctx.lineWidth = 4.5;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(t.x, t.y); ctx.stroke();
          ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([2, 5]); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(t.x, t.y); ctx.stroke();
          ctx.setLineDash([]);
        }
        if (zone.type === 'breath') {
          const b = toScreen(zone.base);
          ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([2, 5]); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(b.x - 70, b.y); ctx.lineTo(b.x + 70, b.y); ctx.stroke();
          ctx.setLineDash([]);
        }
        const activeHandle = drag?.kind === 'handle' ? drag.handle : hoverHandle;
        for (const hd of zoneHandles(zone, v.zoom)) drawHandle(hd, color, hd.id === activeHandle);
      }
      // brush ring
      if (cursor && (s.tool === 'brush' || s.tool === 'erase') && zone && isPaintZone(zone)) {
        const r = (s.brush.size / 2) * v.zoom;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,24,36,0.5)';
        ctx.beginPath(); ctx.arc(cursor.x, cursor.y, r, 0, 7); ctx.stroke();
        ctx.lineWidth = 1.5; ctx.strokeStyle = s.tool === 'erase' ? '#ffffff' : ZONE_INFO[zone.type].color;
        ctx.beginPath(); ctx.arc(cursor.x, cursor.y, r, 0, 7); ctx.stroke();
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.arc(cursor.x, cursor.y, r * (1 - s.brush.soft), 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    // ------------------------------------------------------------ frame loop
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const s = S();
      const d = s.doc;
      const { w, h } = size();
      if (w < 2 || h < 2) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      renderer.resize(W, H);
      if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; }
      if (fittedNonce !== s.viewNonce) { fittedNonce = s.viewNonce; fit(); }

      const a = live.anim;
      const playing = s.playing && s.mode !== 'artwork';
      a.idleTarget = playing ? 1 : 0;
      a.poseTarget = playing || (s.mode === 'motion' && s.tab === 'mood') ? 1 : 0;
      a.exprId = s.exprId;
      a.demo = !playing && s.mode === 'motion' && !drag && s.tab !== 'mood' ? s.hoverZone : null;
      live.voiceLevel = s.voiceOn ? live.voice.level() : 0;
      a.voice = playing ? live.voiceLevel : 0;
      const f = a.step((now - last) / 1000, d);
      last = now;

      const v = live.view;
      const stageBg = s.mode === 'stage' ? d.stage.background : 'transparent';
      renderer.render(d, f, { zoom: v.zoom * dpr, panX: v.panX * dpr, panY: v.panY * dpr }, { wire: s.wire && s.mode === 'motion', ghost: s.mode === 'artwork' });

      board.style.display = d.layers.length ? '' : 'none';
      board.style.transform = `translate(${v.panX}px, ${v.panY}px)`;
      board.style.width = `${d.width * v.zoom}px`;
      board.style.height = `${d.height * v.zoom}px`;
      board.dataset.bg = s.mode === 'stage' ? (stageBg === 'transparent' ? 'checker' : 'solid') : 'paper';
      board.style.backgroundColor = s.mode === 'stage' && stageBg !== 'transparent' ? stageBg : '';
      el.dataset.live = playing ? '1' : '0';
      el.style.cursor = spaceDown || drag?.kind === 'pan' ? 'grabbing'
        : s.mode === 'motion' && !s.playing && s.tool !== 'move' ? 'none'
        : hoverHandle || s.hoverZone ? 'pointer' : 'default';
      // the overlay only repaints when something it shows has changed
      const brushing = s.tool !== 'move' && cursor ? `${cursor.x},${cursor.y}` : '';
      const sig = [s.mode, s.playing, s.tab, s.zoneId, s.hoverZone, s.layerId, s.tool, s.brush.size, s.brush.soft, v.zoom, v.panX, v.panY, brushing, hoverHandle, a.demo, W, H].join('|');
      if (drag || sig !== lastSig || d !== lastDoc || lidWasDown) {
        lastSig = sig;
        lastDoc = d;
        lidWasDown = !!drag;
        drawOverlay(dpr);
      }
    };
    let lastSig = '';
    let lastDoc: Doc | null = null;
    let lidWasDown = false;
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ov.removeEventListener('pointerdown', onDown);
      ov.removeEventListener('pointermove', onMove);
      ov.removeEventListener('pointerup', onUp);
      ov.removeEventListener('pointercancel', onUp);
      ov.removeEventListener('pointerleave', onLeave);
      ov.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  return (
    <div className="stage" ref={wrap}>
      <div className="artboard" ref={boardRef} />
      <canvas className="stage-gl" ref={glRef} />
      <canvas className="stage-overlay" ref={ovRef} />
    </div>
  );
}
