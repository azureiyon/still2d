import { images, makeCanvas, zoneBounds } from '../engine/assets';
import { liftRegion, newRepairLayer } from '../engine/retouch';
import { axisFrame, curvesFromSimple, eyeBox, mirrorEye } from '../engine/geom';
import { eyeAxis } from '../engine/rig';
import { isPaintZone, makeZone, neutralPose, uid, ZONE_INFO, type EyeZone, type ZoneType } from '../engine/types';
import { live } from '../ui/live';
import { useStore } from './store';

const S = useStore.getState;

export function addZone(type: ZoneType) {
  const s = S();
  const d = s.doc;
  const v = live.view;
  const at = {
    x: Math.min(d.width * 0.9, Math.max(d.width * 0.1, (window.innerWidth / 2 - v.panX) / v.zoom)),
    y: Math.min(d.height * 0.9, Math.max(d.height * 0.1, (window.innerHeight / 2 - v.panY) / v.zoom)),
  };
  const zone = makeZone(type, d, at, d.zones.filter((z) => z.type === type).length);
  // on layered art an eye or mouth should only reshape the layers that have artwork there,
  // not a fringe or accessory that happens to sit in front
  if ((zone.type === 'eye' || zone.type === 'mouth') && d.layers.length > 1) zone.layers = d.layers.map((l) => l.id);
  s.edit((doc) => { doc.zones.push(zone); });
  s.set({ zoneId: zone.id, mode: 'motion', playing: false, tab: 'motion', tool: ZONE_INFO[type].paint ? 'brush' : 'move' });
}

export function deleteZone(id: string) {
  const s = S();
  s.edit((d) => {
    d.zones = d.zones.filter((z) => z.id !== id);
    for (const z of d.zones) if (z.type === 'eye' && z.pair === id) z.pair = null;
  });
  if (s.zoneId === id) s.set({ zoneId: null, tool: 'move' });
}

/** Create (or re-shape) the partner of an eye as its mirror image. */
export function mirrorEyeZone(id: string) {
  const s = S();
  const d = s.doc;
  const eye = d.zones.find((z) => z.id === id) as EyeZone | undefined;
  if (!eye) return;
  const partner = d.zones.find((z) => z.id === eye.pair && z.type === 'eye') as EyeZone | undefined;
  if (partner) {
    // keep the partner where it is, copy the mirrored shape onto it
    const m = mirrorEye(eye, 0);
    const from = axisFrame(m).mid, to = axisFrame(partner).mid;
    const dx = to.x - from.x, dy = to.y - from.y;
    s.editZone<EyeZone>(partner.id, (z) => {
      Object.assign(z, {
        a: { x: m.a.x + dx, y: m.a.y + dy }, b: { x: m.b.x + dx, y: m.b.y + dy }, upT: m.upT, loT: m.loT,
        upPts: m.upPts, loPts: m.loPts, fill: eye.fill, roll: eye.roll, curves: m.curves, edit: eye.edit, follow: eye.follow,
        upH: eye.upH, loH: eye.loH, upRound: eye.upRound, loRound: eye.loRound, band: eye.band, loBand: eye.loBand, skin: eye.skin, meet: eye.meet, gaze: eye.gaze,
      });
    });
    s.toast(`Copied the shape to ${partner.name}`);
    return;
  }
  const head = d.zones.find((z) => z.type === 'head');
  const hb = head ? zoneBounds(d, head) : null;
  const mid = axisFrame(eye).mid;
  let axis = hb ? (hb.x0 + hb.x1) / 2 : d.width / 2;
  if (Math.abs(axis - mid.x) < axisFrame(eye).hw * 1.3) axis = mid.x + (mid.x < d.width / 2 ? 1 : -1) * axisFrame(eye).hw * 1.8;
  // painted lid skin and marks belong to the artwork under the original eye, so the twin starts clean
  const twin: EyeZone = { ...eye, ...mirrorEye(eye, axis), id: uid('zone'), name: `${eye.name} (mirror)`, pair: eye.id, box: null, paint: null, ctl: null };
  s.edit((doc) => {
    doc.zones.push(twin);
    const src = doc.zones.find((z) => z.id === id) as EyeZone;
    src.pair = twin.id;
  });
  s.set({ zoneId: twin.id });
  s.toast('Mirrored. Drag the new eye into place.');
}

export function addMood() {
  const s = S();
  const cur = s.doc.expressions.find((e) => e.id === s.exprId);
  const mood = { id: uid('mood'), name: `Mood ${s.doc.expressions.length + 1}`, pose: structuredClone(cur?.pose ?? neutralPose()), layers: { ...(cur?.layers ?? {}) } };
  s.edit((d) => { d.expressions.push(mood); });
  s.set({ exprId: mood.id, tab: 'mood' });
}

export function deleteMood(id: string) {
  const s = S();
  if (s.doc.expressions.length <= 1) return;
  s.edit((d) => { d.expressions = d.expressions.filter((e) => e.id !== id); });
  if (s.exprId === id) s.set({ exprId: S().doc.expressions[0].id });
}

export function deleteLayer(id: string) {
  const s = S();
  s.edit((d) => {
    d.layers = d.layers.filter((l) => l.id !== id);
    for (const z of d.zones) if (z.layers !== 'all') z.layers = z.layers.filter((x) => x !== id);
    for (const e of d.expressions) delete e.layers[id];
  });
  s.set({ layerId: S().doc.layers.at(-1)?.id ?? null });
}

export function moveLayer(id: string, dir: 1 | -1) {
  S().edit((d) => {
    const i = d.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= d.layers.length) return;
    [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]];
  });
}

export function selectMood(id: string) {
  S().set({ exprId: id });
}

export { eyeAxis, isPaintZone };

/** Add an empty paint layer above the selected one, ready for repairs. */
export function addRepairLayer() {
  const s = S();
  const layer = newRepairLayer(s.doc);
  s.edit((d) => {
    const i = d.layers.findIndex((l) => l.id === s.layerId);
    d.layers.splice(i < 0 ? d.layers.length : i + 1, 0, layer);
  });
  s.set({ layerId: layer.id, mode: 'artwork', tool: 'brush' });
  s.toast('Repair layer added. Paint on it without touching the artwork below.');
}

/** Put back the pixels a layer had before any retouching or lifting. */
export function restoreLayer(id: string) {
  S().edit((d) => {
    const l = d.layers.find((x) => x.id === id);
    if (l?.original) { l.image = l.original; delete l.original; }
  });
}

/** Lift a painted motion onto its own layer, with a filled-in backing underneath. */
export function liftZone(id: string) {
  const s = S();
  const zone = s.doc.zones.find((z) => z.id === id);
  if (!zone || !isPaintZone(zone)) return;
  const out = liftRegion(s.doc, zone);
  if (typeof out === 'string') { s.toast(out, 'error'); return; }
  s.edit((d) => {
    const i = d.layers.findIndex((l) => l.id === out.source);
    const src = d.layers[i];
    src.original ??= src.image;
    src.image = out.cut;
    d.layers.splice(i + 1, 0, out.backing, out.patch);
    for (const z of d.zones) {
      if (z.id === id) z.layers = [out.patch.id];
      else if (z.layers !== 'all' && z.layers.includes(out.source) && z.type !== 'eye' && z.type !== 'mouth' && z.type !== 'hold') z.layers.push(out.backing.id, out.patch.id);
      else if (z.layers !== 'all' && z.layers.includes(out.source) && z.type === 'hold') z.layers.push(out.backing.id);
    }
  });
  s.toast(`Lifted onto its own layer. The gap behind it was filled in; repaint "${out.backing.name}" if the guess is off.`);
}

/** Small preview of a layer for the layer list. */
const thumbs = new Map<string, string>();
export function layerThumb(imageId: string): string {
  let t = thumbs.get(imageId);
  if (t) return t;
  const img = images.get(imageId);
  if (!img) return '';
  const k = Math.min(1, 44 / Math.max(img.w, img.h));
  const c = makeCanvas(img.w * k, img.h * k);
  c.getContext('2d')!.drawImage(img.canvas, 0, 0, c.width, c.height);
  t = c.toDataURL();
  if (thumbs.size > 200) thumbs.clear();
  thumbs.set(imageId, t);
  return t;
}

export function clearEyePaint(id: string, which: 'paint' | 'ctl' | 'both') {
  S().editZone<EyeZone>(id, (z) => {
    if (which !== 'ctl') z.paint = null;
    if (which !== 'paint') z.ctl = null;
    if (!z.paint && !z.ctl) z.box = null;
  });
}

/** Switch an eye between its simple controls and its four precise curves. Both shapes are kept. */
export function setEyeEdit(id: string, edit: 'simple' | 'precise') {
  const s = S();
  s.editZone<EyeZone>(id, (z) => {
    if (edit === 'precise' && !z.curves) z.curves = curvesFromSimple(z);
    z.edit = edit;
  });
  s.set({ nodeSel: null });
}

/** Start the precise curves over from the current simple shape. */
export function resetEyeCurves(id: string) {
  const s = S();
  s.editZone<EyeZone>(id, (z) => { z.curves = curvesFromSimple({ ...z, edit: 'simple' }); });
  s.set({ nodeSel: null });
}

/** Zoom the canvas onto one eye. */
export function focusEye(id: string) {
  const s = S();
  const z = s.doc.zones.find((x) => x.id === id);
  if (z?.type !== 'eye') return;
  const box = eyeBox(z);
  const w = window.innerWidth - (s.panels ? 640 : 80), h = window.innerHeight - 200;
  const zoom = Math.min(24, Math.min(w / (box.w * 1.15), h / (box.h * 1.15)));
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  live.view = { zoom, panX: (s.panels ? 300 : 40) + w / 2 - cx * zoom, panY: 90 + h / 2 - cy * zoom };
}
