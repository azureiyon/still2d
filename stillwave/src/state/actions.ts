import { zoneBounds } from '../engine/assets';
import { axisFrame, mirrorEye } from '../engine/geom';
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
  const twin: EyeZone = { ...eye, ...mirrorEye(eye, axis), id: uid('zone'), name: `${eye.name} (mirror)`, pair: eye.id };
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
