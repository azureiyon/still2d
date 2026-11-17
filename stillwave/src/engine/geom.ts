import type { EyeZone, LidPoint, MouthZone, SwayZone, Vec } from './types';

/** The simple lid shape: one peak, rounded shoulders. */
export function lidCurve(t: number, tp: number, h: number, r: number) {
  let s = t < tp ? (tp - t) / (tp + 1) : (t - tp) / (1 - tp);
  s = Math.min(1, Math.max(0, s));
  return h * Math.pow(Math.max(0, 1 - s * s), r);
}

/** Local frame of an eye or mouth: origin mid-way between the corners, n points "up". */
export function axisFrame(z: { a: Vec; b: Vec }) {
  const flip = z.a.x <= z.b.x ? 1 : -1;
  const p = flip === 1 ? z.a : z.b;
  const q = flip === 1 ? z.b : z.a;
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const hw = Math.max(1, Math.hypot(q.x - p.x, q.y - p.y) / 2);
  const ex = { x: (q.x - p.x) / (2 * hw), y: (q.y - p.y) / (2 * hw) };
  const n = { x: ex.y, y: -ex.x };
  const at = (t: number, y: number): Vec => ({ x: mid.x + ex.x * t * hw + n.x * y, y: mid.y + ex.y * t * hw + n.y * y });
  const local = (pt: Vec) => ({ t: ((pt.x - mid.x) * ex.x + (pt.y - mid.y) * ex.y) / hw, y: (pt.x - mid.x) * n.x + (pt.y - mid.y) * n.y });
  return { flip, mid, hw, ex, n, at, local };
}

const clampT = (t: number) => Math.min(0.85, Math.max(-0.85, t));
export const LUT_N = 128;

/** Monotone cubic through sorted nodes: passes through every point, never overshoots. */
function monotone(nodes: LidPoint[]) {
  const n = nodes.length;
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((nodes[i + 1].y - nodes[i].y) / Math.max(1e-4, nodes[i + 1].t - nodes[i].t));
  m[0] = d[0] * 1.5; // lids leave the corners steeply
  m[n - 1] = d[n - 2] * 1.5;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  return (t: number) => {
    let i = 0;
    while (i < n - 2 && t > nodes[i + 1].t) i++;
    const h = Math.max(1e-4, nodes[i + 1].t - nodes[i].t);
    const u = Math.min(1, Math.max(0, (t - nodes[i].t) / h));
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * nodes[i].y + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * nodes[i + 1].y + (u3 - u2) * h * m[i + 1];
  };
}

export interface EyeLut { up: Float32Array; lo: Float32Array; hU: number; hL: number }
const lutCache = new WeakMap<EyeZone, EyeLut>();

/** Both lid curves sampled across the eye (left to right on screen). Heights are positive. */
export function eyeLut(z: EyeZone): EyeLut {
  let lut = lutCache.get(z);
  if (lut) return lut;
  const flip = z.a.x <= z.b.x ? 1 : -1;
  const make = (tp: number, h: number, r: number, pts: LidPoint[]) => {
    const out = new Float32Array(LUT_N + 1);
    const peak = clampT(tp * flip);
    let f: (t: number) => number;
    if (!pts?.length) f = (t) => lidCurve(t, peak, h, r);
    else {
      const nodes = [{ t: -1, y: 0 }, ...pts.map((p) => ({ t: Math.min(0.97, Math.max(-0.97, p.t * flip)), y: p.y })), { t: peak, y: h }, { t: 1, y: 0 }].sort((a, b) => a.t - b.t);
      f = monotone(nodes.filter((p, i) => i === 0 || p.t - nodes[i - 1].t > 0.01));
    }
    let max = 0;
    for (let i = 0; i <= LUT_N; i++) {
      out[i] = Math.max(0, f(-1 + (2 * i) / LUT_N));
      max = Math.max(max, out[i]);
    }
    out[0] = out[LUT_N] = 0;
    return { out, max };
  };
  const u = make(z.upT, z.upH, z.upRound, z.upPts);
  const l = make(z.loT, z.loH, z.loRound, z.loPts);
  lut = { up: u.out, lo: l.out, hU: u.max, hL: l.max };
  lutCache.set(z, lut);
  return lut;
}

function sampleLut(a: Float32Array, t: number) {
  const f = Math.min(1, Math.max(0, (t + 1) / 2)) * LUT_N;
  const i = Math.min(LUT_N - 1, Math.floor(f));
  return a[i] + (a[i + 1] - a[i]) * (f - i);
}

/** Upper lid height above the eye axis at t (screen left = -1). */
export const lidUp = (z: EyeZone, t: number) => sampleLut(eyeLut(z).up, t);
/** Lower lid depth below the eye axis at t. */
export const lidLo = (z: EyeZone, t: number) => sampleLut(eyeLut(z).lo, t);

export function eyeOutline(z: EyeZone, steps = 36) {
  const f = axisFrame(z);
  const up: Vec[] = [];
  const lo: Vec[] = [];
  const band: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = -1 + (2 * i) / steps;
    const u = lidUp(z, t);
    up.push(f.at(t, u));
    band.push(f.at(t, u + z.band));
    lo.push(f.at(t, -lidLo(z, t)));
  }
  return { f, up, lo, band };
}

export function eyeContains(z: EyeZone, pt: Vec, pad = 0) {
  const { t, y } = axisFrame(z).local(pt);
  if (Math.abs(t) > 1) return false;
  return y <= lidUp(z, t) + z.band + pad && y >= -lidLo(z, t) - pad;
}

/** The artboard rectangle an eye's paint (lid skin, lash and keep marks) lives in. */
export function eyeBox(z: EyeZone) {
  const f = axisFrame(z);
  const { hU, hL } = eyeLut(z);
  const r = Math.max(f.hw * 1.45, hU + z.band + z.skin * 2 + 8, hL + 8);
  return { x: f.mid.x - r, y: f.mid.y - r, w: r * 2, h: r * 2 };
}

export function mouthContains(z: MouthZone, pt: Vec, pad = 0) {
  const { t, y } = axisFrame(z).local(pt);
  return Math.abs(t) <= 1.05 && Math.abs(y - z.bow * Math.max(0, 1 - t * t)) <= Math.max(8, z.openH * 0.5) + pad;
}

/** Mirror an eye across a vertical line. */
export function mirrorEye(z: EyeZone, axisX: number): Pick<EyeZone, 'a' | 'b' | 'upT' | 'loT' | 'upPts' | 'loPts'> {
  return {
    a: { x: 2 * axisX - z.b.x, y: z.b.y },
    b: { x: 2 * axisX - z.a.x, y: z.a.y },
    upT: -z.upT,
    loT: -z.loT,
    // a->b reverses with the mirror, so points keep their t along that direction
    upPts: z.upPts.map((p) => ({ ...p })),
    loPts: z.loPts.map((p) => ({ ...p })),
  };
}

// ---- sway spine: root, optional middle points, tip

export interface Spine { pts: Vec[]; acc: number[]; total: number }

export function swaySpine(z: SwayZone): Spine {
  const pts = [z.anchor, ...z.path, z.tip];
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.max(0.001, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)));
  return { pts, acc, total: acc[acc.length - 1] };
}

export function spineAt(s: Spine, at: number): Vec {
  const d = Math.min(1, Math.max(0, at)) * s.total;
  let i = 0;
  while (i < s.pts.length - 2 && s.acc[i + 1] < d) i++;
  const u = (d - s.acc[i]) / (s.acc[i + 1] - s.acc[i]);
  return { x: s.pts[i].x + (s.pts[i + 1].x - s.pts[i].x) * u, y: s.pts[i].y + (s.pts[i + 1].y - s.pts[i].y) * u };
}

/** Closest position along the spine (0 root .. 1 tip) and the spine point there. */
export function spineBind(s: Spine, x: number, y: number) {
  let best = Infinity, at = 0, cx = s.pts[0].x, cy = s.pts[0].y;
  for (let i = 0; i < s.pts.length - 1; i++) {
    const a = s.pts[i], b = s.pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const u = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const px = a.x + u * dx, py = a.y + u * dy;
    const d = (x - px) * (x - px) + (y - py) * (y - py);
    if (d < best) { best = d; at = (s.acc[i] + (s.acc[i + 1] - s.acc[i]) * u) / s.total; cx = px; cy = py; }
  }
  return { at, cx, cy };
}
