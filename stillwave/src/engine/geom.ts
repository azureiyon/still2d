import type { EyeCurves, EyeZone, LidPoint, MouthZone, PathNode, SwayZone, Vec } from './types';

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

// ---- precise curves: cubic Bezier chains whose t never doubles back, so each
// curve is a single height across the eye (the shader reads it that way)

const cubic = (a: number, b: number, c: number, d: number, u: number) => {
  const v = 1 - u;
  return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
};

/** Height of a chain at t (bisection on the monotone t of each segment). */
export function chainAt(path: PathNode[], t: number): number {
  if (t <= path[0].t) return path[0].y;
  const last = path[path.length - 1];
  if (t >= last.t) return last.y;
  let i = 1;
  while (i < path.length - 1 && path[i].t < t) i++;
  const a = path[i - 1], b = path[i];
  let lo = 0, hi = 1;
  for (let k = 0; k < 22; k++) {
    const u = (lo + hi) / 2;
    if (cubic(a.t, a.ot, b.it, b.t, u) < t) lo = u; else hi = u;
  }
  return cubic(a.y, a.oy, b.iy, b.y, (lo + hi) / 2);
}

/** Split a chain at t, keeping its shape (de Casteljau). Returns null if too close to a node. */
export function chainSplit(path: PathNode[], t: number): PathNode[] | null {
  if (path.length >= 12) return null;
  let j = 1;
  while (j < path.length && path[j].t < t) j++;
  if (j === path.length || t <= path[0].t) return null;
  const a = path[j - 1], b = path[j];
  if (Math.min(t - a.t, b.t - t) < 0.04) return null;
  let lo = 0, hi = 1;
  for (let k = 0; k < 22; k++) { const u = (lo + hi) / 2; if (cubic(a.t, a.ot, b.it, b.t, u) < t) lo = u; else hi = u; }
  const u = (lo + hi) / 2;
  const mix = (p: number, q: number) => p + (q - p) * u;
  const A = { t: mix(a.t, a.ot), y: mix(a.y, a.oy) }, B = { t: mix(a.ot, b.it), y: mix(a.oy, b.iy) }, C = { t: mix(b.it, b.t), y: mix(b.iy, b.y) };
  const D = { t: mix(A.t, B.t), y: mix(A.y, B.y) }, E = { t: mix(B.t, C.t), y: mix(B.y, C.y) };
  const F = { t: mix(D.t, E.t), y: mix(D.y, E.y) };
  const out = path.map((n) => ({ ...n }));
  out[j - 1].ot = A.t; out[j - 1].oy = A.y;
  out[j].it = C.t; out[j].iy = C.y;
  out.splice(j, 0, { t: F.t, y: F.y, it: D.t, iy: D.y, ot: E.t, oy: E.y });
  return out;
}

/** Remove an interior node. */
export function chainRemove(path: PathNode[], i: number): PathNode[] {
  if (path.length <= 2 || i <= 0 || i >= path.length - 1) return path;
  const out = path.map((n) => ({ ...n }));
  out.splice(i, 1);
  return clampChain(out);
}

/** Keep handles between their neighbours so t never doubles back. */
export function clampChain(p: PathNode[]): PathNode[] {
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1];
    a.ot = Math.min(b.t, Math.max(a.t, a.ot));
    b.it = Math.min(b.t, Math.max(a.ot, b.it));
  }
  return p;
}

/**
 * Move one part of a node. `fixedEnds` keeps the end nodes at the eye corners
 * (the lash line and lower lid); otherwise ends move up and down only.
 * Handles stay smooth (opposite handle kept in line) unless `broken`.
 */
export function chainMove(path: PathNode[], i: number, part: 'n' | 'i' | 'o', t: number, y: number, fixedEnds: boolean, broken: boolean): PathNode[] {
  const p = path.map((n) => ({ ...n }));
  const n = p[i], prev = p[i - 1], next = p[i + 1];
  const end = i === 0 || i === p.length - 1;
  if (part === 'n') {
    if (end && fixedEnds) return p;
    const tt = end ? n.t : Math.min(next.t - 0.03, Math.max(prev.t + 0.03, t));
    const dt = tt - n.t, dy = y - n.y;
    n.t = tt; n.y = y; n.it += dt; n.ot += dt; n.iy += dy; n.oy += dy;
  } else {
    const isIn = part === 'i';
    const ht = isIn ? Math.min(n.t, Math.max(prev ? prev.t : n.t, t)) : Math.max(n.t, Math.min(next ? next.t : n.t, t));
    if (isIn) { n.it = ht; n.iy = y; } else { n.ot = ht; n.oy = y; }
    if (!broken && !end) {
      // mirror the direction onto the other handle, keeping its length
      const vx = (isIn ? n.it : n.ot) - n.t, vy = (isIn ? n.iy : n.oy) - n.y;
      const len = Math.hypot(vx, vy);
      if (len > 1e-6) {
        const ox = (isIn ? n.ot : n.it) - n.t, oy = (isIn ? n.oy : n.iy) - n.y;
        const olen = Math.hypot(ox, oy);
        if (isIn) { n.ot = n.t - (vx / len) * olen; n.oy = n.y - (vy / len) * olen; }
        else { n.it = n.t - (vx / len) * olen; n.iy = n.y - (vy / len) * olen; }
      }
    }
  }
  return clampChain(p);
}

/**
 * The smooth chain through f at the given nodes that best matches f in between.
 * Node heights are exact; the tangent at each node is shared by both of its
 * handles (so every node is smooth) and chosen by least squares over samples
 * of every segment. Handles sit a third of the way along each segment.
 */
export function chainThrough(f: (t: number) => number, ts: number[]): PathNode[] {
  const N = ts.length;
  const y = ts.map(f);
  const A = Array.from({ length: N }, () => new Float64Array(N));
  const rhs = new Float64Array(N);
  for (let i = 0; i < N - 1; i++) {
    const d = ts[i + 1] - ts[i];
    for (let k = 1; k < 24; k++) {
      const u = k / 24, v = 1 - u;
      const B0 = v * v * v, B1 = 3 * v * v * u, B2 = 3 * v * u * u, B3 = u * u * u;
      // y(u) = c + p*m_i + q*m_{i+1}
      const c = (B0 + B1) * y[i] + (B2 + B3) * y[i + 1] - f(ts[i] + d * u);
      const pi = (B1 * d) / 3, qi = (-B2 * d) / 3;
      A[i][i] += pi * pi; A[i][i + 1] += pi * qi; A[i + 1][i] += pi * qi; A[i + 1][i + 1] += qi * qi;
      rhs[i] -= pi * c; rhs[i + 1] -= qi * c;
    }
  }
  for (let i = 0; i < N; i++) A[i][i] += 1e-9;
  // Gaussian elimination (tiny, well conditioned)
  const m = Array.from(rhs);
  for (let c = 0; c < N; c++) {
    let piv = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = c + 1; r < N; r++) {
      const k = A[r][c] / A[c][c];
      for (let j = c; j < N; j++) A[r][j] -= k * A[c][j];
      m[r] -= k * m[c];
    }
  }
  for (let r = N - 1; r >= 0; r--) {
    let acc = m[r];
    for (let j = r + 1; j < N; j++) acc -= A[r][j] * m[j];
    m[r] = acc / A[r][r];
  }
  return ts.map((t, i) => {
    const l = i ? (t - ts[i - 1]) / 3 : 0, r = i < N - 1 ? (ts[i + 1] - t) / 3 : 0;
    return { t, y: y[i], it: t - l, iy: y[i] - m[i] * l, ot: t + r, oy: y[i] + m[i] * r };
  });
}

export const mirrorChain = (path: PathNode[]): PathNode[] =>
  [...path].reverse().map((n) => ({ t: -n.t, y: n.y, it: -n.ot, iy: n.oy, ot: -n.it, oy: n.iy }));

// ---- the lid lookup table the shader reads

export interface EyeLut {
  up: Float32Array; lo: Float32Array; band: Float32Array; skin: Float32Array;
  hU: number; hL: number; hTop: number; // tallest upper lid, deepest lower lid, highest skin top
}
const lutCache = new WeakMap<EyeZone, EyeLut>();

/** Simple-mode heights at screen-ordered t. */
function simpleUp(z: EyeZone, flip: number) {
  const peak = clampT(z.upT * flip);
  if (!z.upPts?.length) return (t: number) => lidCurve(t, peak, z.upH, z.upRound);
  const nodes = [{ t: -1, y: 0 }, ...z.upPts.map((p) => ({ t: Math.min(0.97, Math.max(-0.97, p.t * flip)), y: p.y })), { t: peak, y: z.upH }, { t: 1, y: 0 }].sort((a, b) => a.t - b.t);
  return monotone(nodes.filter((p, i) => i === 0 || p.t - nodes[i - 1].t > 0.01));
}
function simpleLo(z: EyeZone, flip: number) {
  const peak = clampT(z.loT * flip);
  if (!z.loPts?.length) return (t: number) => lidCurve(t, peak, z.loH, z.loRound);
  const nodes = [{ t: -1, y: 0 }, ...z.loPts.map((p) => ({ t: Math.min(0.97, Math.max(-0.97, p.t * flip)), y: p.y })), { t: peak, y: z.loH }, { t: 1, y: 0 }].sort((a, b) => a.t - b.t);
  return monotone(nodes.filter((p, i) => i === 0 || p.t - nodes[i - 1].t > 0.01));
}

/** The four precise curves that reproduce an eye's current simple shape. */
export function curvesFromSimple(z: EyeZone): EyeCurves {
  const flip = z.a.x <= z.b.x ? 1 : -1;
  const up = simpleUp(z, flip), lo = simpleLo(z, flip);
  // nodes at the corners, the lid's peak, and half way to each corner
  const pk = Math.min(0.6, Math.max(-0.6, z.upT * flip)), lk = Math.min(0.6, Math.max(-0.6, z.loT * flip));
  const ts = [-1, (pk - 1) / 2, pk, (pk + 1) / 2, 1];
  const tl = [-1, (lk - 1) / 2, lk, (lk + 1) / 2, 1];
  return {
    up: chainThrough((t) => Math.max(0, up(t)), ts),
    band: chainThrough((t) => Math.max(0, up(t)) + z.band, ts),
    skin: chainThrough((t) => Math.max(0, up(t)) + z.band + z.skin, ts),
    lo: chainThrough((t) => Math.max(0, lo(t)), tl),
  };
}

/** Lid heights across the eye (screen left = index 0). Heights are positive away from the axis. */
export function eyeLut(z: EyeZone): EyeLut {
  let lut = lutCache.get(z);
  if (lut) return lut;
  const flip = z.a.x <= z.b.x ? 1 : -1;
  const N = LUT_N + 1;
  const up = new Float32Array(N), lo = new Float32Array(N), band = new Float32Array(N), skin = new Float32Array(N);
  const precise = z.edit === 'precise' && z.curves;
  const fu = precise ? (t: number) => chainAt(z.curves!.up, t) : simpleUp(z, flip);
  const fl = precise ? (t: number) => chainAt(z.curves!.lo, t) : simpleLo(z, flip);
  let hU = 0, hL = 0, hTop = 0;
  for (let i = 0; i < N; i++) {
    const t = -1 + (2 * i) / LUT_N;
    let u = fu(t), l = fl(t);
    if (!precise) { u = Math.max(0, u); l = Math.max(0, l); }
    if (u + l < 0.5) l = 0.5 - u; // the lids may not cross
    const b = precise ? Math.max(0.5, chainAt(z.curves!.band, t) - u) : z.band;
    const s = precise ? Math.max(1, chainAt(z.curves!.skin, t) - u - b) : z.skin;
    up[i] = u; lo[i] = l; band[i] = b; skin[i] = s;
    hU = Math.max(hU, u); hL = Math.max(hL, l); hTop = Math.max(hTop, u + b + s);
  }
  up[0] = up[LUT_N] = 0;
  lo[0] = lo[LUT_N] = 0;
  lut = { up, lo, band, skin, hU, hL, hTop };
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
export const lidBand = (z: EyeZone, t: number) => sampleLut(eyeLut(z).band, t);
export const lidSkin = (z: EyeZone, t: number) => sampleLut(eyeLut(z).skin, t);

export function eyeOutline(z: EyeZone, steps = 36) {
  const f = axisFrame(z);
  const up: Vec[] = [];
  const lo: Vec[] = [];
  const band: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = -1 + (2 * i) / steps;
    const u = lidUp(z, t);
    up.push(f.at(t, u));
    band.push(f.at(t, u + lidBand(z, t)));
    lo.push(f.at(t, -lidLo(z, t)));
  }
  return { f, up, lo, band };
}

export function eyeContains(z: EyeZone, pt: Vec, pad = 0) {
  const { t, y } = axisFrame(z).local(pt);
  if (Math.abs(t) > 1) return false;
  return y <= lidUp(z, t) + lidBand(z, t) + pad && y >= -lidLo(z, t) - pad;
}

/** The artboard rectangle an eye's paint (lid skin, lash and keep marks) lives in. */
export function eyeBox(z: EyeZone) {
  const f = axisFrame(z);
  const { hTop, hL } = eyeLut(z);
  const r = Math.max(f.hw * 1.45, hTop + 8, hL + 8);
  return { x: f.mid.x - r, y: f.mid.y - r, w: r * 2, h: r * 2 };
}

export function mouthContains(z: MouthZone, pt: Vec, pad = 0) {
  const { t, y } = axisFrame(z).local(pt);
  return Math.abs(t) <= 1.05 && Math.abs(y - z.bow * Math.max(0, 1 - t * t)) <= Math.max(8, z.openH * 0.5) + pad;
}

/** Mirror an eye across a vertical line. */
export function mirrorEye(z: EyeZone, axisX: number): Pick<EyeZone, 'a' | 'b' | 'upT' | 'loT' | 'upPts' | 'loPts' | 'curves'> {
  return {
    a: { x: 2 * axisX - z.b.x, y: z.b.y },
    b: { x: 2 * axisX - z.a.x, y: z.a.y },
    upT: -z.upT,
    loT: -z.loT,
    // a->b reverses with the mirror, so points keep their t along that direction
    upPts: z.upPts.map((p) => ({ ...p })),
    loPts: z.loPts.map((p) => ({ ...p })),
    // precise curves live in the screen-ordered eye frame, so they flip left to right
    curves: z.curves ? { up: mirrorChain(z.curves.up), band: mirrorChain(z.curves.band), skin: mirrorChain(z.curves.skin), lo: mirrorChain(z.curves.lo) } : null,
  };
}

// ---- sway spine: root, optional middle points, tip

export interface Spine { pts: Vec[]; acc: number[]; total: number; ctrl: Vec[] }
const spineCache = new WeakMap<SwayZone, Spine>();

/**
 * The strand's spine: a smooth curve (centripetal Catmull-Rom) through the
 * root, any path points and the tip, sampled finely. Smooth, so a path point
 * bends the strand gently instead of putting a kink in it.
 */
export function swaySpine(z: SwayZone): Spine {
  const hit = spineCache.get(z);
  if (hit) return hit;
  const ctrl = [z.anchor, ...(z.path ?? []), z.tip];
  let pts: Vec[];
  if (ctrl.length <= 2) pts = ctrl;
  else {
    pts = [ctrl[0]];
    const ext = [
      { x: 2 * ctrl[0].x - ctrl[1].x, y: 2 * ctrl[0].y - ctrl[1].y },
      ...ctrl,
      { x: 2 * ctrl[ctrl.length - 1].x - ctrl[ctrl.length - 2].x, y: 2 * ctrl[ctrl.length - 1].y - ctrl[ctrl.length - 2].y },
    ];
    for (let i = 1; i < ext.length - 2; i++) {
      const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
      const knot = (a: Vec, b: Vec) => Math.max(1e-3, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
      const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
      const lerp = (a: Vec, b: Vec, ta: number, tb: number, t: number) => ({ x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta), y: ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta) });
      for (let k = 1; k <= 12; k++) {
        const t = t1 + ((t2 - t1) * k) / 12;
        const A1 = lerp(p0, p1, t0, t1, t), A2 = lerp(p1, p2, t1, t2, t), A3 = lerp(p2, p3, t2, t3, t);
        const B1 = lerp(A1, A2, t0, t2, t), B2 = lerp(A2, A3, t1, t3, t);
        pts.push(lerp(B1, B2, t1, t2, t));
      }
    }
  }
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.max(0.001, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)));
  const sp = { pts, acc, total: acc[acc.length - 1], ctrl };
  spineCache.set(z, sp);
  return sp;
}

/**
 * Trace a path through a painted strand: walk outward from the root inside
 * the paint, and take the middle of the paint at even steps along the way.
 * Returns the tip (the farthest painted point) and `count` points between.
 */
export function traceStrand(alpha: Uint8ClampedArray, w: number, h: number, docW: number, docH: number, root: Vec, count = 4): { path: Vec[]; tip: Vec } | null {
  const kx = w / docW, ky = h / docH;
  const inside = (i: number) => alpha[i] > 76;
  // nearest painted pixel to the root
  const rx = Math.round(root.x * kx), ry = Math.round(root.y * ky);
  let seed = -1, best = Infinity;
  for (let y = Math.max(0, ry - 40); y < Math.min(h, ry + 40); y++) for (let x = Math.max(0, rx - 40); x < Math.min(w, rx + 40); x++) {
    const i = y * w + x;
    if (!inside(i)) continue;
    const d = (x - rx) ** 2 + (y - ry) ** 2;
    if (d < best) { best = d; seed = i; }
  }
  if (seed < 0) return null;
  const dist = new Int32Array(w * h).fill(-1);
  const q = new Int32Array(w * h);
  let head = 0, tail = 0, far = seed;
  dist[seed] = 0; q[tail++] = seed;
  while (head < tail) {
    const i = q[head++], x = i % w;
    if (dist[i] > dist[far]) far = i;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= w * h || dist[j] >= 0 || !inside(j)) continue;
      dist[j] = dist[i] + 1; q[tail++] = j;
    }
  }
  const dmax = dist[far];
  if (dmax < 6) return null;
  // centre of the paint in thin bands of distance from the root
  const bands = count + 1;
  const sx = new Float64Array(bands + 1), sy = new Float64Array(bands + 1), n = new Float64Array(bands + 1);
  for (let k = 0; k < tail; k++) {
    const i = q[k], f = dist[i] / dmax;
    const b = Math.round(f * bands);
    if (Math.abs(f * bands - b) > 0.18 || b < 1) continue;
    sx[b] += (i % w) + 0.5; sy[b] += Math.floor(i / w) + 0.5; n[b]++;
  }
  const path: Vec[] = [];
  for (let b = 1; b < bands; b++) if (n[b]) path.push({ x: sx[b] / n[b] / kx, y: sy[b] / n[b] / ky });
  const tip = n[bands] ? { x: sx[bands] / n[bands] / kx, y: sy[bands] / n[bands] / ky } : { x: ((far % w) + 0.5) / kx, y: (Math.floor(far / w) + 0.5) / ky };
  return { path, tip };
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
