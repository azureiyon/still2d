import type { EyeZone, MouthZone, Vec } from './types';

/** Same curve the shader uses for a lid. */
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

export function eyeOutline(z: EyeZone, steps = 28) {
  const f = axisFrame(z);
  const up: Vec[] = [];
  const lo: Vec[] = [];
  const band: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = -1 + (2 * i) / steps;
    const u = lidCurve(t, clampT(z.upT * f.flip), z.upH, z.upRound);
    up.push(f.at(t, u));
    band.push(f.at(t, u + z.band));
    lo.push(f.at(t, -lidCurve(t, clampT(z.loT * f.flip), z.loH, z.loRound)));
  }
  return { f, up, lo, band };
}

export function eyeContains(z: EyeZone, pt: Vec, pad = 0) {
  const f = axisFrame(z);
  const { t, y } = f.local(pt);
  if (Math.abs(t) > 1) return false;
  const u = lidCurve(t, clampT(z.upT * f.flip), z.upH, z.upRound) + z.band + pad;
  const l = -lidCurve(t, clampT(z.loT * f.flip), z.loH, z.loRound) - pad;
  return y <= u && y >= l;
}

export function mouthContains(z: MouthZone, pt: Vec, pad = 0) {
  const { t, y } = axisFrame(z).local(pt);
  return Math.abs(t) <= 1.05 && Math.abs(y) <= Math.max(8, z.openH * 0.5) + pad;
}

/** Mirror an eye across a vertical line. */
export function mirrorEye(z: EyeZone, axisX: number): Pick<EyeZone, 'a' | 'b' | 'upT' | 'loT'> {
  return {
    a: { x: 2 * axisX - z.b.x, y: z.b.y },
    b: { x: 2 * axisX - z.a.x, y: z.a.y },
    upT: -z.upT,
    loT: -z.loT,
  };
}
