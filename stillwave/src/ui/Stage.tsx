// The canvas workspace: WebGL artwork underneath, a 2D overlay for washes and
// handles on top, and every direct-manipulation gesture.
import { useEffect, useRef } from 'react';
import { adoptImage, images, layerCorners, makeCanvas, maskBounds, masks, registerMask, sampleMask, zoneBounds } from '../engine/assets';
import { axisFrame, chainAt, chainMove, chainRemove, chainSplit, eyeBox, eyeContains, eyeLut, eyeOutline, lidBand, lidLo, lidSkin, lidUp, mouthContains, spineBind, swaySpine } from '../engine/geom';
import { fitView, Renderer } from '../engine/gl';
import { beginMask, strokeSegment } from '../engine/paint';
import { boxAffine, compositeRest, layerAffine, pickColor, Stroke } from '../engine/retouch';
import { isPaintZone, ZONE_INFO, type Doc, type EyeCurve, type EyeZone, type Layer, type MouthZone, type Vec, type Zone } from '../engine/types';
import { useStore } from '../state/store';
import { live } from './live';
import { CURVE_COLOR } from './curveColors';

interface Handle { id: string; x: number; y: number; shape?: 'dot' | 'ring' | 'diamond' | 'lid' | 'small' | 'square'; color?: string }
const CURVES: EyeCurve[] = ['skin', 'band', 'up', 'lo'];
const fixedEnds = (c: EyeCurve) => c === 'up' || c === 'lo';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; panX: number; panY: number }
  | { kind: 'layer-move'; id: string; start: Vec; ox: number; oy: number; key: string }
  | { kind: 'layer-scale'; id: string; scale: number; d0: number; key: string }
  | { kind: 'layer-rotate'; id: string; rot: number; a0: number; key: string }
  | { kind: 'handle'; zone: string; handle: string; key: string }
  | { kind: 'zone-move'; zone: string; last: Vec; key: string }
  | { kind: 'paint'; zone: string; canvas: HTMLCanvasElement; last: Vec; first: Vec; erase: boolean }
  | { kind: 'retouch'; layer: string; stroke: Stroke; tmp: string }
  | { kind: 'eye-paint'; zone: string; which: 'paint' | 'ctl'; stroke: Stroke; box: { x: number; y: number; w: number; h: number } };

let dragSerial = 0;
const EYE_CELL = 256;
const MARK = { keep: '#ff0000', lash: '#00ff00' };

function layerHit(l: Layer, p: Vec): boolean {
  const c = Math.cos(-l.rotation), s = Math.sin(-l.rotation);
  const dx = p.x - l.x, dy = p.y - l.y;
  const lx = (dx * c - dy * s) / l.scale + l.w / 2;
  const ly = (dx * s + dy * c) / l.scale + l.h / 2;
  if (lx < 0 || ly < 0 || lx >= l.w || ly >= l.h) return false;
  const a = images.get(l.image);
  if (!a) return true;
  const t = makeCanvas(1, 1);
  const g = t.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(a.canvas, Math.floor((lx / l.w) * a.w), Math.floor((ly / l.h) * a.h), 1, 1, 0, 0, 1, 1);
  return g.getImageData(0, 0, 1, 1).data[3] > 10;
}

const cl = (t: number) => Math.min(0.85, Math.max(-0.85, t));

function zoneHandles(z: Zone, zoom: number, hold: number, nodeSel: string | null = null): Handle[] {
  if (z.type === 'sway') {
    return [{ id: 'anchor', ...z.anchor, shape: 'ring' }, ...z.path.map((p, i) => ({ id: `p${i}`, ...p, shape: 'small' as const })), { id: 'tip', ...z.tip, shape: 'diamond' }];
  }
  if (z.type === 'head') return [{ id: 'pivot', ...z.pivot, shape: 'ring' }];
  if (z.type === 'breath') return [{ id: 'base', ...z.base, shape: 'ring' }];
  if (z.type === 'hold') return [];
  const f = axisFrame(z);
  if (z.type === 'mouth') {
    return [{ id: 'a', ...z.a }, { id: 'b', ...z.b }, { id: 'bow', ...f.at(0, z.bow) }, { id: 'open', ...f.at(0, z.bow - Math.max(z.openH, 14 / zoom)), shape: 'diamond' }];
  }
  const lidX = 1 + 22 / zoom / f.hw;
  const lut = eyeLut(z);
  const tab: Handle = { id: 'lid', ...f.at(lidX, lut.hU - (lut.hU + lut.hL) * hold), shape: 'lid' };
  if (z.edit === 'precise' && z.curves) {
    const out: Handle[] = [{ id: 'a', ...z.a }, { id: 'b', ...z.b }];
    const at = (c: EyeCurve, t: number, y: number) => f.at(t, c === 'lo' ? -y : y);
    for (const c of CURVES) {
      z.curves[c].forEach((n, i, all) => {
        if (fixedEnds(c) && (i === 0 || i === all.length - 1)) return;
        if (nodeSel === `${c}:${i}`) {
          if (i > 0) out.push({ id: `H:${c}:${i}:i`, ...at(c, n.it, n.iy), shape: 'square', color: CURVE_COLOR[c] });
          if (i < all.length - 1) out.push({ id: `H:${c}:${i}:o`, ...at(c, n.ot, n.oy), shape: 'square', color: CURVE_COLOR[c] });
        }
        out.push({ id: `N:${c}:${i}`, ...at(c, n.t, n.y), shape: 'small', color: nodeSel === `${c}:${i}` ? '#ffffff' : CURVE_COLOR[c] });
      });
    }
    out.push(tab);
    return out;
  }
  return [
    { id: 'a', ...z.a }, { id: 'b', ...z.b },
    { id: 'up', ...f.at(cl(z.upT * f.flip), z.upH) },
    { id: 'lo', ...f.at(cl(z.loT * f.flip), -z.loH) },
    ...z.upPts.map((p, i) => ({ id: `u${i}`, ...f.at(p.t * f.flip, p.y), shape: 'small' as const })),
    ...z.loPts.map((p, i) => ({ id: `l${i}`, ...f.at(p.t * f.flip, -p.y), shape: 'small' as const })),
    { id: 'band', ...f.at(cl(z.upT * f.flip), z.upH + z.band + 10 / zoom), shape: 'diamond' },
    tab,
  ];
}

function applyHandle(z: Zone, handle: string, p: Vec, broken = false) {
  if (z.type === 'sway') {
    if (handle === 'anchor') z.anchor = p; else if (handle === 'tip') z.tip = p; else z.path[Number(handle.slice(1))] = p;
    z.auto = false;
    return;
  }
  if (z.type === 'head') { z.pivot = p; z.auto = false; return; }
  if (z.type === 'breath') { z.base = p; z.auto = false; return; }
  if (z.type === 'hold') return;
  if (handle === 'a' || handle === 'b') { z[handle] = p; return; }
  const f = axisFrame(z);
  const { t, y } = f.local(p);
  if (z.type === 'mouth') { if (handle === 'open') z.openH = Math.max(4, z.bow - y); if (handle === 'bow') z.bow = y; return; }
  if ((handle[0] === 'N' || handle[0] === 'H') && handle[1] === ':' && z.curves) {
    const [kind, c, si, part] = handle.split(':') as [string, EyeCurve, string, 'i' | 'o' | undefined];
    const i = Number(si);
    z.curves[c] = chainMove(z.curves[c], i, kind === 'N' ? 'n' : part!, t, c === 'lo' ? -y : y, fixedEnds(c), broken);
    return;
  }
  const tt = Math.min(0.8, Math.max(-0.8, t)) * f.flip;
  if (handle === 'up') { z.upT = tt; z.upH = Math.max(2, y); }
  else if (handle === 'lo') { z.loT = tt; z.loH = Math.max(1, -y); }
  else if (handle === 'band') z.band = Math.max(0, y - z.upH - 10 / live.view.zoom);
  else if (handle[0] === 'u') z.upPts[Number(handle.slice(1))] = { t: Math.min(0.95, Math.max(-0.95, t)) * f.flip, y: Math.max(0.5, y) };
  else if (handle[0] === 'l') z.loPts[Number(handle.slice(1))] = { t: Math.min(0.95, Math.max(-0.95, t)) * f.flip, y: Math.max(0.5, -y) };
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
      renderer = new Renderer(glCanvas, true);
    } catch (err) {
      useStore.getState().toast((err as Error).message, 'error');
      return;
    }
    live.renderer = renderer;
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
    let cloneOffset: Vec | null = null;
    let cloneOffsetFor: Vec | null = null;

    const size = () => ({ w: el.clientWidth, h: el.clientHeight });
    const toDoc = (sx: number, sy: number): Vec => ({ x: (sx - live.view.panX) / live.view.zoom, y: (sy - live.view.panY) / live.view.zoom });
    const toScreen = (p: Vec): Vec => ({ x: p.x * live.view.zoom + live.view.panX, y: p.y * live.view.zoom + live.view.panY });
    const local = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const insets = () => {
      const s = S();
      return { l: s.panels ? 300 : 40, r: s.panels ? 330 : 40, t: 76, b: s.mode === 'artwork' ? 40 : 110 };
    };
    const fit = () => {
      const { w, h } = size();
      const i = insets();
      const d = S().doc;
      const v = fitView(d, Math.max(100, w - i.l - i.r), Math.max(100, h - i.t - i.b));
      live.view = { zoom: v.zoom, panX: v.panX + i.l, panY: v.panY + i.t };
    };
    const hold = (id: string) => S().lidHold[id] ?? 0;

    const zoneAt = (doc: Doc, p: Vec, selected: string | null): Zone | null => {
      const order = [...doc.zones].reverse().sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
      const pad = 6 / live.view.zoom;
      for (const z of order) {
        if (z.type === 'eye' && eyeContains(z, p, pad)) return z;
        if (z.type === 'mouth' && mouthContains(z, p, pad)) return z;
      }
      for (const z of order) {
        if (!isPaintZone(z) || z.whole) continue;
        const m = z.mask ? masks.get(z.mask) : null;
        if (m && sampleMask(m, p.x / doc.width, p.y / doc.height) > 0.12) return z;
      }
      // whole-layer motions last: the smallest region under the pointer wins
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
      for (const h of zoneHandles(z, live.view.zoom, hold(z.id), S().nodeSel).reverse()) {
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

    const strokeOptions = (p: Vec, colorOverride?: string) => {
      const s = S();
      const tool = s.tool === 'move' ? 'brush' : s.tool;
      let source, offset;
      if (tool === 'clone') {
        if (!s.cloneFrom) return null;
        source = compositeRest(s.doc);
        if (!cloneOffset || cloneOffsetFor !== s.cloneFrom) { cloneOffset = { x: s.cloneFrom.x - p.x, y: s.cloneFrom.y - p.y }; cloneOffsetFor = s.cloneFrom; }
        offset = cloneOffset;
      }
      return { tool, color: colorOverride ?? s.brush.color, size: s.brush.size, soft: s.brush.soft, opacity: colorOverride ? 1 : s.brush.opacity, mode: colorOverride ? ('normal' as const) : s.brush.mode, source, offset };
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

      const painting = s.tool !== 'move';
      // Alt-click with a paint tool: pick a colour, or choose where the clone copies from
      if (painting && e.altKey) {
        if (s.tool === 'clone') { s.set({ cloneFrom: p }); cloneOffset = null; }
        else { const c = pickColor(doc, p); if (c) s.set({ brush: { ...s.brush, color: c } }); }
        return;
      }

      if (s.mode === 'artwork') {
        const sel = doc.layers.find((l) => l.id === s.layerId);
        if (painting) {
          if (!sel) { s.toast('Select a layer to paint on.'); return; }
          const base = images.get(sel.image)?.canvas;
          const opts = strokeOptions(p);
          if (!base) return;
          if (!opts) { s.toast('Alt-click the spot to copy from first.'); return; }
          const stroke = new Stroke(base, layerAffine(sel), opts);
          const tmp = adoptImage(stroke.work);
          drag = { kind: 'retouch', layer: sel.id, stroke, tmp };
          stroke.to(p);
          return;
        }
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
      if (painting && zone && isPaintZone(zone)) {
        if (zone.whole) { s.toast('This motion moves whole layers. Turn off "Move whole layers" to paint it.'); return; }
        if (s.tool === 'clone') return;
        const canvas = beginMask(doc, zone.mask);
        drag = { kind: 'paint', zone: zone.id, canvas, last: p, first: p, erase: s.tool === 'erase' };
        paintTo(p);
        return;
      }
      if (painting && zone?.type === 'eye') {
        const marks = s.eyeLayer !== 'skin';
        if (marks && s.tool === 'clone') return;
        const which = marks ? 'ctl' : 'paint';
        const box = zone.box ?? eyeBox(zone);
        const existing = zone[which] ? images.get(zone[which]!)?.canvas : null;
        const base = existing ?? makeCanvas(EYE_CELL, EYE_CELL);
        const opts = strokeOptions(p, marks ? MARK[s.eyeLayer as 'keep' | 'lash'] : undefined);
        if (!opts) { s.toast('Alt-click the spot to copy from first.'); return; }
        const stroke = new Stroke(base, boxAffine(box, EYE_CELL), opts);
        drag = { kind: 'eye-paint', zone: zone.id, which, stroke, box };
        stroke.to(p);
        return;
      }
      if (zone) {
        const h = handleAt(zone, sp);
        if (h) {
          drag = { kind: 'handle', zone: zone.id, handle: h.id, key };
          if (h.id[0] === 'N' && h.id[1] === ':') s.set({ nodeSel: h.id.slice(2) });
          if (h.id === 'lid') onMove(e);
          return;
        }
      }
      const hit = zoneAt(doc, p, s.zoneId);
      s.set({ zoneId: hit?.id ?? null, nodeSel: null, ...(hit ? { tab: 'motion' as const } : {}) });
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
            if (z) { const lut = eyeLut(z); s.set({ lidHold: { ...s.lidHold, [z.id]: Math.min(1, Math.max(0, (lut.hU - axisFrame(z).local(p).y) / (lut.hU + lut.hL))) } }); }
          } else s.editZone(g.zone, (z) => applyHandle(z, g.handle, p, e.altKey), g.key);
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
        case 'retouch': {
          drag.stroke.to(p);
          const a = images.get(drag.tmp);
          if (a) a.version++;
          break;
        }
        case 'eye-paint':
          drag.stroke.to(p);
          break;
      }
    };

    const onUp = () => {
      const g = drag;
      drag = null;
      if (!g) return;
      const s = S();
      if (g.kind === 'paint') {
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
      } else if (g.kind === 'retouch') {
        s.edit((d) => {
          const l = d.layers.find((x) => x.id === g.layer);
          if (!l) return;
          l.original ??= l.image;
          l.image = g.tmp;
        });
      } else if (g.kind === 'eye-paint') {
        const id = adoptImage(g.stroke.work);
        s.editZone<EyeZone>(g.zone, (z) => { z.box ??= g.box; z[g.which] = id; });
      }
    };

    const onDouble = (e: MouseEvent) => {
      const s = S();
      if (s.mode !== 'motion' || s.playing || s.tool !== 'move') return;
      const zone = s.doc.zones.find((z) => z.id === s.zoneId);
      if (!zone) return;
      const sp = local(e);
      const p = toDoc(sp.x, sp.y);
      const near = 9 / live.view.zoom;
      const h = handleAt(zone, sp);
      if (zone.type === 'sway') {
        if (h && h.id[0] === 'p') { s.editZone(zone.id, (z) => { if (z.type === 'sway') z.path.splice(Number(h.id.slice(1)), 1); }); return; }
        if (h) return;
        const spine = swaySpine(zone);
        const b = spineBind(spine, p.x, p.y);
        if (Math.hypot(b.cx - p.x, b.cy - p.y) > near || zone.path.length >= 6) return;
        // insert in order along the spine
        const index = zone.path.filter((q) => spineBind(spine, q.x, q.y).at < b.at).length;
        s.editZone(zone.id, (z) => { if (z.type === 'sway') z.path.splice(index, 0, p); });
      } else if (zone.type === 'eye' && zone.edit === 'precise' && zone.curves) {
        if (h && h.id[0] === 'N' && h.id[1] === ':') {
          const [, c, si] = h.id.split(':') as [string, EyeCurve, string];
          s.editZone<EyeZone>(zone.id, (z) => { if (z.curves) z.curves[c] = chainRemove(z.curves[c], Number(si)); });
          s.set({ nodeSel: null });
          return;
        }
        if (h) return;
        const { t, y } = axisFrame(zone).local(p);
        if (Math.abs(t) > 0.97) return;
        let best: EyeCurve | null = null, bestD = near;
        for (const c of CURVES) {
          const d = Math.abs((c === 'lo' ? -y : y) - chainAt(zone.curves[c], t));
          if (d < bestD) { bestD = d; best = c; }
        }
        if (!best) return;
        const c = best;
        const split = chainSplit(zone.curves[c], t);
        if (!split) return;
        s.editZone<EyeZone>(zone.id, (z) => { if (z.curves) z.curves[c] = split; });
        s.set({ nodeSel: `${c}:${split.findIndex((n) => Math.abs(n.t - t) < 1e-3)}` });
      } else if (zone.type === 'eye') {
        if (h && (h.id[0] === 'u' || h.id[0] === 'l') && h.id.length > 1 && h.id !== 'up' && h.id !== 'lo' && h.id !== 'lid') {
          const i = Number(h.id.slice(1));
          s.editZone<EyeZone>(zone.id, (z) => { (h.id[0] === 'u' ? z.upPts : z.loPts).splice(i, 1); });
          return;
        }
        if (h) return;
        const f = axisFrame(zone);
        const { t, y } = f.local(p);
        if (Math.abs(t) > 0.95) return;
        const onUp2 = Math.abs(y - lidUp(zone, t)) < near, onLo = Math.abs(y + lidLo(zone, t)) < near;
        if (!onUp2 && !onLo) return;
        s.editZone<EyeZone>(zone.id, (z) => {
          const list = onUp2 ? z.upPts : z.loPts;
          if (list.length < 6) list.push({ t: t * f.flip, y: Math.abs(y) });
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
      if (e.type === 'keydown' && e.key.startsWith('Arrow') && !(e.target as HTMLElement).closest('input, textarea, [contenteditable], [role=slider]')) {
        const s = S();
        const zone = s.doc.zones.find((z) => z.id === s.zoneId);
        if (s.mode === 'motion' && !s.playing && zone?.type === 'eye' && zone.edit === 'precise' && zone.curves && s.nodeSel) {
          e.preventDefault();
          const [c, si] = s.nodeSel.split(':') as [EyeCurve, string];
          const i = Number(si);
          const n = zone.curves[c][i];
          if (!n) return;
          // one screen pixel per press (ten with Shift), however far you are zoomed in
          const step = (e.shiftKey ? 10 : 1) / live.view.zoom;
          const f = axisFrame(zone);
          const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
          const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
          const ny = n.y + (c === 'lo' ? -dy : dy);
          s.editZone<EyeZone>(zone.id, (z) => { if (z.curves) z.curves[c] = chainMove(z.curves[c], i, 'n', n.t + dx / f.hw, ny, fixedEnds(c), false); }, `nudge:${zone.id}:${s.nodeSel}`);
          return;
        }
      }
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
    const noMenu = (e: Event) => e.preventDefault();

    ov.addEventListener('pointerdown', onDown);
    ov.addEventListener('pointermove', onMove);
    ov.addEventListener('pointerup', onUp);
    ov.addEventListener('pointercancel', onUp);
    ov.addEventListener('pointerleave', onLeave);
    ov.addEventListener('dblclick', onDouble);
    ov.addEventListener('wheel', onWheel, { passive: false });
    ov.addEventListener('contextmenu', noMenu);
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
      const r = h.shape === 'small' ? (hot ? 5 : 4) : hot ? 6.5 : 5.5;
      ctx.beginPath();
      if (h.shape === 'diamond') { ctx.rotate(Math.PI / 4); ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6); }
      else if (h.shape === 'lid') { ctx.roundRect(-9, -5, 18, 10, 5); }
      else if (h.shape === 'square') { ctx.rect(-3.5, -3.5, 7, 7); }
      else ctx.arc(0, 0, h.shape === 'ring' ? r + 1.5 : r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (h.shape === 'ring') { ctx.fillStyle = '#141824'; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, 7); ctx.fill(); }
      ctx.restore();
    };
    const brushRing = (color: string) => {
      if (!cursor) return;
      const s = S();
      const r = (s.brush.size / 2) * live.view.zoom;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,24,36,0.5)';
      ctx.beginPath(); ctx.arc(cursor.x, cursor.y, r, 0, 7); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(cursor.x, cursor.y, r, 0, 7); ctx.stroke();
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.arc(cursor.x, cursor.y, r * (1 - s.brush.soft), 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    };
    const cloneMark = () => {
      const s = S();
      if (s.tool !== 'clone' || !s.cloneFrom) return;
      // while painting, show where pixels are being copied from right now
      const at = cursor && cloneOffset && cloneOffsetFor === s.cloneFrom && drag ? { x: toDoc(cursor.x, cursor.y).x + cloneOffset.x, y: toDoc(cursor.x, cursor.y).y + cloneOffset.y } : s.cloneFrom;
      const c = toScreen(at);
      ctx.strokeStyle = 'rgba(20,24,36,0.7)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(c.x - 9, c.y); ctx.lineTo(c.x + 9, c.y); ctx.moveTo(c.x, c.y - 9); ctx.lineTo(c.x, c.y + 9); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
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
        if (l && s.tool === 'move') {
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
        } else if (l && s.tool !== 'move') {
          // faint frame: paint lands only inside the selected layer
          const cs = layerCorners(l).map(toScreen);
          ctx.strokeStyle = 'rgba(169,180,255,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
          ctx.beginPath(); cs.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y))); ctx.closePath(); ctx.stroke();
          ctx.setLineDash([]);
          cloneMark();
          brushRing(s.tool === 'erase' ? '#ffffff' : s.tool === 'clone' ? '#a9b4ff' : s.brush.color);
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
      const zone = d.zones.find((z) => z.id === s.zoneId);
      const eyePainting = zone?.type === 'eye' && s.tool !== 'move';
      // eye and mouth outlines
      for (const z of d.zones) {
        if (!z.enabled) continue;
        const sel = z.id === s.zoneId, hov = z.id === s.hoverZone;
        const color = ZONE_INFO[z.type].color;
        ctx.lineJoin = 'round';
        if (z.type === 'eye') {
          const o = eyeOutline(z);
          if (sel && !eyePainting) {
            // what travels (green) and what stretches (pink) when the lid closes
            const N = 36, ub: Vec[] = [], bb: Vec[] = [], sb: Vec[] = [];
            for (let i = 0; i <= N; i++) {
              const t = -1 + (2 * i) / N, u = lidUp(z, t), bd = lidBand(z, t), sk = lidSkin(z, t);
              ub.push(o.f.at(t, u)); bb.push(o.f.at(t, u + bd)); sb.push(o.f.at(t, u + bd + sk));
            }
            ctx.globalAlpha = 0.22; ctx.fillStyle = CURVE_COLOR.band;
            poly([...ub, ...[...bb].reverse()], true); ctx.fill();
            ctx.globalAlpha = 0.18; ctx.fillStyle = CURVE_COLOR.skin;
            poly([...bb, ...[...sb].reverse()], true); ctx.fill();
            ctx.globalAlpha = 1;
            if (z.edit === 'precise') {
              ctx.lineWidth = 1.4; ctx.setLineDash([4, 4]);
              ctx.strokeStyle = CURVE_COLOR.skin; poly(sb); ctx.stroke();
              ctx.strokeStyle = CURVE_COLOR.band; poly(bb); ctx.stroke();
              ctx.setLineDash([]);
            }
          }
          ctx.globalAlpha = sel ? (eyePainting ? 0.35 : 1) : hov ? 0.9 : 0.55;
          poly([...o.up, ...o.lo.reverse()], true);
          ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(20,24,36,0.55)'; ctx.stroke();
          ctx.lineWidth = 1.6; ctx.strokeStyle = color; ctx.stroke();
          if (sel && !eyePainting) {
            if (z.edit !== 'precise') {
              ctx.setLineDash([3, 4]);
              poly(o.band); ctx.stroke();
              ctx.setLineDash([]);
            }
            // track for the lid pull
            const lidX = 1 + 22 / v.zoom / o.f.hw;
            const lut = eyeLut(z);
            poly([o.f.at(lidX, lut.hU), o.f.at(lidX, -lut.hL)]);
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
      // an eye's own paint: the area it covers, and its keep (red) and lash (green) marks
      if (zone?.type === 'eye' && eyePainting) {
        const box = zone.box ?? eyeBox(zone);
        const r = { x: box.x * v.zoom + v.panX, y: box.y * v.zoom + v.panY, w: box.w * v.zoom, h: box.h * v.zoom };
        ctx.strokeStyle = 'rgba(111,184,255,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([]);
        if (s.eyeLayer !== 'skin') {
          const marks = drag?.kind === 'eye-paint' && drag.which === 'ctl' ? drag.stroke.work : zone.ctl ? images.get(zone.ctl)?.canvas : null;
          if (marks) { ctx.globalAlpha = 0.5; ctx.drawImage(marks, r.x, r.y, r.w, r.h); ctx.globalAlpha = 1; }
        }
        cloneMark();
        brushRing(s.tool === 'erase' ? '#ffffff' : s.eyeLayer === 'skin' ? (s.tool === 'clone' ? '#a9b4ff' : s.brush.color) : MARK[s.eyeLayer]);
      }
      // handles of the selected motion
      if (zone && s.tool === 'move') {
        const color = ZONE_INFO[zone.type].color;
        if (zone.type === 'sway') {
          const pts = swaySpine(zone).pts.map(toScreen);
          const line = () => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); };
          ctx.strokeStyle = 'rgba(20,24,36,0.6)'; ctx.lineWidth = 4.5; ctx.lineJoin = 'round'; line();
          ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([2, 5]); ctx.lineCap = 'round'; line();
          ctx.setLineDash([]);
        }
        if (zone.type === 'breath') {
          const b = toScreen(zone.base);
          ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([2, 5]); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(b.x - 70, b.y); ctx.lineTo(b.x + 70, b.y); ctx.stroke();
          ctx.setLineDash([]);
        }
        const activeHandle = drag?.kind === 'handle' ? drag.handle : hoverHandle;
        if (zone.type === 'eye' && zone.edit === 'precise' && s.nodeSel) {
          // tangent lines of the selected node
          const hs = zoneHandles(zone, v.zoom, hold(zone.id), s.nodeSel);
          const node = hs.find((x) => x.id === `N:${s.nodeSel}`);
          if (node) for (const hd of hs.filter((x) => x.shape === 'square')) {
            const a = toScreen(node), b = toScreen(hd);
            ctx.strokeStyle = 'rgba(20,24,36,0.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            ctx.strokeStyle = hd.color ?? color; ctx.lineWidth = 1.2; ctx.stroke();
          }
        }
        for (const hd of zoneHandles(zone, v.zoom, hold(zone.id), s.nodeSel)) drawHandle(hd, hd.color ?? color, hd.id === activeHandle);
      }
      // brush ring for motion paint
      if (zone && isPaintZone(zone) && s.tool !== 'move') brushRing(s.tool === 'erase' ? '#ffffff' : ZONE_INFO[zone.type].color);
    };

    // ------------------------------------------------------------ frame loop
    let lastSig = '';
    let lastDoc: Doc | null = null;
    let lastRenderDoc: Doc | null = null;
    let lastLook = '';
    let wasDragging = false;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const s = S();
      let d = s.doc;
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
      a.demo = !playing && s.mode === 'motion' && !drag && s.tab !== 'mood' && s.tool === 'move' ? s.hoverZone : null;
      // a held lid stays where it was put, for as long as that eye is being edited
      a.lidScrub = !playing && s.mode === 'motion' && s.zoneId && s.lidHold[s.zoneId] ? { [s.zoneId]: s.lidHold[s.zoneId] } : {};
      if (live.scrubAll !== null) for (const z of d.zones) if (z.type === 'eye') a.lidScrub[z.id] = live.scrubAll;
      live.voiceLevel = s.voiceOn ? live.voice.level() : 0;
      a.voice = playing ? live.voiceLevel : 0;
      const f = a.step((now - last) / 1000, d);
      last = now;

      // strokes in progress are shown without touching the document
      let livePaint: Map<string, HTMLCanvasElement> | undefined;
      if (drag?.kind === 'retouch') {
        const g = drag;
        d = { ...d, layers: d.layers.map((l) => (l.id === g.layer ? { ...l, image: g.tmp } : l)) };
      } else if (drag?.kind === 'eye-paint') {
        livePaint = new Map([[`${drag.zone}:${drag.which}`, drag.stroke.work]]);
      }

      const v = live.view;
      const stageBg = s.mode === 'stage' ? d.stage.background : 'transparent';
      // A still picture is not redrawn: paused editing then costs next to nothing.
      const q = (x: number) => Math.round(x * 400); // finer than a pixel for any realistic size
      let pose = `${q(f.head.turn)},${q(f.head.nod)},${q(f.head.tilt)},${q(f.breath)},${q(f.body.rot)},${q(f.body.bob)}`;
      for (const k in f.eyes) { const e = f.eyes[k]; pose += `|${q(e.upper)},${q(e.lower)},${q(e.arc)},${q(e.gx)},${q(e.gy)}`; }
      for (const k in f.mouths) pose += `|${q(f.mouths[k].open)},${q(f.mouths[k].smile)}`;
      for (const k in f.sway) { const c = f.sway[k]; pose += `|${q(c[c.length - 1])},${q(c[c.length >> 1])}`; }
      for (const k in f.layerAlpha) pose += `|${q(f.layerAlpha[k])}`;
      const look = [pose, v.zoom, v.panX, v.panY, W, H, s.wire, s.mode].join(';');
      if (drag || livePaint || d !== lastRenderDoc || look !== lastLook) {
        renderer.render(d, f, { zoom: v.zoom * dpr, panX: v.panX * dpr, panY: v.panY * dpr }, { wire: s.wire && s.mode === 'motion', ghost: s.mode === 'artwork', livePaint });
        live.guarded = renderer.guarded;
        lastRenderDoc = d;
        lastLook = look;
        live.frames++;
      }

      board.style.display = d.layers.length ? '' : 'none';
      board.style.transform = `translate(${v.panX}px, ${v.panY}px)`;
      board.style.width = `${d.width * v.zoom}px`;
      board.style.height = `${d.height * v.zoom}px`;
      board.dataset.bg = s.mode === 'stage' ? (stageBg === 'transparent' ? 'checker' : 'solid') : 'paper';
      board.style.backgroundColor = s.mode === 'stage' && stageBg !== 'transparent' ? stageBg : '';
      el.dataset.live = playing ? '1' : '0';
      const paintCursor = s.tool !== 'move' && (s.mode === 'artwork' || (s.mode === 'motion' && !s.playing));
      el.style.cursor = spaceDown || drag?.kind === 'pan' ? 'grabbing' : paintCursor ? 'none' : hoverHandle || s.hoverZone ? 'pointer' : 'default';

      // the overlay only repaints when something it shows has changed
      const brushing = s.tool !== 'move' && cursor ? `${cursor.x},${cursor.y}` : '';
      const sig = [s.mode, s.playing, s.tab, s.zoneId, s.nodeSel, s.hoverZone, s.layerId, s.tool, s.brush.size, s.brush.soft, s.brush.color, s.eyeLayer, s.cloneFrom?.x, s.cloneFrom?.y, s.zoneId ? s.lidHold[s.zoneId] : 0, v.zoom, v.panX, v.panY, brushing, hoverHandle, a.demo, W, H].join('|');
      if (drag || wasDragging || sig !== lastSig || s.doc !== lastDoc) {
        lastSig = sig;
        lastDoc = s.doc;
        wasDragging = !!drag;
        drawOverlay(dpr);
        live.overlays++;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ov.removeEventListener('pointerdown', onDown);
      ov.removeEventListener('pointermove', onMove);
      ov.removeEventListener('pointerup', onUp);
      ov.removeEventListener('pointercancel', onUp);
      ov.removeEventListener('pointerleave', onLeave);
      ov.removeEventListener('dblclick', onDouble);
      ov.removeEventListener('wheel', onWheel);
      ov.removeEventListener('contextmenu', noMenu);
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
