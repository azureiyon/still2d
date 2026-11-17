// The animator turns a document plus a few live inputs (pointer, voice, the
// chosen mood) into a RigFrame: a small bag of numbers the renderer bends the
// artwork with. It runs on a fixed 120 Hz step so playback, GIF export and the
// standalone player all move identically.
import type { Doc, EyeZone, Expression, Pose, Zone } from './types';
import { neutralPose } from './types';

export interface RigFrame {
  head: { turn: number; nod: number; tilt: number };
  breath: number;
  body: { rot: number; bob: number };
  eyes: Record<string, { upper: number; lower: number; arc: number; gx: number; gy: number }>;
  mouths: Record<string, { open: number; smile: number }>;
  sway: Record<string, Float32Array>; // angle (radians) sampled along root..tip
  layerAlpha: Record<string, number>;
  liveliness: number;
}

export const SWAY_SAMPLES = 24;
const STEP = 1 / 120;
const HIST = 160;
const TAU = Math.PI * 2;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const poseToArray = (p: Pose) => [
  p.eyeL.upper, p.eyeL.lower, p.eyeL.arc, p.eyeR.upper, p.eyeR.lower, p.eyeR.arc,
  p.mouthOpen, p.mouthSmile, p.turn, p.nod, p.tilt,
];

export function eyeAxis(doc: Doc): number {
  const eyes = doc.zones.filter((z): z is EyeZone => z.type === 'eye');
  if (eyes.length < 2) return doc.width / 2;
  return eyes.reduce((s, e) => s + (e.a.x + e.b.x) / 2, 0) / eyes.length;
}

export function eyeSide(doc: Doc, e: EyeZone): 'L' | 'R' {
  return (e.a.x + e.b.x) / 2 <= eyeAxis(doc) ? 'L' : 'R';
}

interface BlinkEvent { t0: number; peak: number }
interface SwayState { th: number; om: number; hist: Float32Array; hi: number; phase: number }

const hashPhase = (id: string) => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967296) * TAU;
};

export class Animator {
  t = 0;
  /** Seamless-loop length in seconds, or null for free-running. */
  loop: number | null = null;
  // live inputs
  pointer: { x: number; y: number } | null = null;
  voice = 0;
  exprId: string | null = null;
  /** 1 = idle motion running, 0 = hold the rest pose (edit mode). */
  idleTarget = 1;
  /** 1 = show the chosen mood, 0 = neutral. */
  poseTarget = 1;
  /** A zone that performs a little demonstration even while paused. */
  demo: string | null = null;
  /** Manual eyelid position per eye zone (the on-canvas lid pull). */
  lidScrub: Record<string, number> = {};

  private rng: () => number;
  private acc = 0;
  private tt = 0;
  private breathPhase = 0;
  private idle = 0;
  private pose = poseToArray(neutralPose());
  private poseVel = this.pose.map(() => 0);
  private layerAlpha: Record<string, number> = {};
  private blinks: BlinkEvent[] = [];
  private nextBlink = 1.2;
  private loopBlinks: BlinkEvent[] | null = null;
  private sway = new Map<string, SwayState>();
  private look = { x: 0, y: 0 };
  private head = { turn: 0, nod: 0, tilt: 0 };
  private headVel = { turn: 0, tilt: 0 };
  private voiceS = 0;
  private scrubS: Record<string, number> = {};
  private demoGain = 0;
  private demoId: string | null = null;
  private poke = 0;

  frame: RigFrame = {
    head: { turn: 0, nod: 0, tilt: 0 }, breath: 0, body: { rot: 0, bob: 0 },
    eyes: {}, mouths: {}, sway: {}, layerAlpha: {}, liveliness: 1,
  };

  constructor(seed = 7) {
    this.rng = mulberry(seed);
  }

  /** Give every sway zone a shove, as if the avatar was tapped. */
  nudge(strength = 1) {
    this.poke += strength;
  }

  blinkNow() {
    this.blinks.push({ t0: this.t, peak: 1 });
  }

  /** Jump straight to the settled state (used when a project opens). */
  settle(doc: Doc) {
    const expr = this.expression(doc);
    this.pose = poseToArray(this.poseTarget && expr ? expr.pose : neutralPose());
    this.poseVel.fill(0);
    for (const l of doc.layers) this.layerAlpha[l.id] = this.layerTarget(l.id, l.visible, expr) ? 1 : 0;
  }

  private expression(doc: Doc): Expression | undefined {
    return doc.expressions.find((e) => e.id === this.exprId) ?? doc.expressions[0];
  }

  private layerTarget(id: string, visible: boolean, expr?: Expression) {
    if (this.poseTarget && expr && id in expr.layers) return expr.layers[id];
    return visible;
  }

  private osc(f: number, phase: number, tempo: number) {
    if (this.loop) {
      const cycles = Math.max(1, Math.round(f * tempo * this.loop));
      return Math.sin((TAU * cycles * this.t) / this.loop + phase);
    }
    return Math.sin(TAU * f * this.tt + phase);
  }

  private blinkEnv(dt: number, doc: Doc) {
    const { close, hold, open } = doc.motion.blink;
    if (dt < 0) return 0;
    if (dt < close) {
      const x = dt / close;
      return x * x * (3 - 2 * x);
    }
    if (dt < close + hold) return 1;
    const x = (dt - close - hold) / open;
    if (x >= 1) return 0;
    return (1 - x) * (1 - x) * (1 - x * 0.5) ;
  }

  private buildLoopBlinks(doc: Doc, T: number) {
    const b = doc.motion.blink;
    const dur = b.close + b.hold + b.open;
    const n = Math.max(1, Math.round((T * doc.motion.tempo) / b.every));
    const rng = mulberry(11);
    const out: BlinkEvent[] = [];
    for (let i = 0; i < n; i++) {
      const jitter = (rng() - 0.5) * b.vary * 0.6;
      const t0 = Math.min(T - dur - 0.02, Math.max(0.02, ((i + 0.45 + jitter) / n) * T));
      out.push({ t0, peak: rng() < b.partial ? 0.55 : 1 });
    }
    return out;
  }

  step(dt: number, doc: Doc): RigFrame {
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP - 1e-9) {
      this.tick(STEP, doc);
      this.acc -= STEP;
    }
    return this.frame;
  }

  private tick(h: number, doc: Doc) {
    const m = doc.motion;
    const L = m.liveliness;
    this.t += h;
    this.tt += h * m.tempo;
    const k = (tau: number) => 1 - Math.exp(-h / tau);

    this.idle += (this.idleTarget - this.idle) * k(0.22);
    const idle = this.idle;
    if (this.demo) this.demoId = this.demo;
    this.demoGain += ((this.demo ? 1 : 0) - this.demoGain) * k(0.15);
    const demo = this.demoGain > 0.01 ? this.demoId : null;
    const dg = this.demoGain;
    const dz = demo ? doc.zones.find((z) => z.id === demo) : undefined;

    // ---- mood: every pose value eases toward the chosen expression
    const expr = this.expression(doc);
    const target = poseToArray(this.poseTarget && expr ? expr.pose : neutralPose());
    const w = 4.2 / Math.max(0.05, m.transition);
    for (let i = 0; i < target.length; i++) {
      const a = w * w * (target[i] - this.pose[i]) - 2 * w * this.poseVel[i];
      this.poseVel[i] += a * h;
      this.pose[i] += this.poseVel[i] * h;
    }
    const P = this.pose;
    const fade = k(Math.max(0.03, m.transition / 3));
    for (const l of doc.layers) {
      const goal = this.layerTarget(l.id, l.visible, expr) ? 1 : 0;
      const cur = this.layerAlpha[l.id] ?? goal;
      this.layerAlpha[l.id] = Math.abs(goal - cur) < 0.004 ? goal : cur + (goal - cur) * fade;
    }

    // ---- voice
    const v = Math.min(1, this.voice * m.voice.gain);
    this.voiceS += (v - this.voiceS) * k(v > this.voiceS ? 0.035 : 0.09);

    // ---- gaze and head
    const wander = this.loop ? 0 : m.look.wander;
    const wx = (this.osc(0.11, 1.3, 1) * 0.6 + this.osc(0.23, 4.1, 1) * 0.4) * wander * 0.5;
    const wy = this.osc(0.17, 2.2, 1) * wander * 0.25;
    const follow = m.look.follow && this.pointer && !this.loop ? m.look.amount : 0;
    const lx = (this.pointer ? this.pointer.x * follow : 0) + wx * (1 - follow);
    const ly = (this.pointer ? this.pointer.y * follow : 0) + wy * (1 - follow);
    this.look.x += (lx * idle - this.look.x) * k(0.14);
    this.look.y += (ly * idle - this.look.y) * k(0.14);

    const drift = idle * L * m.idle.head;
    let turn = drift * (this.osc(0.13, 0.4, 1) * 0.55 + this.osc(0.31, 2.6, 1) * 0.3) + this.look.x * 0.75 + P[8];
    let nod = drift * (this.osc(0.19, 1.9, 1) * 0.4 + this.osc(0.41, 5.2, 1) * 0.2) + this.look.y * 0.6 + P[9];
    let tilt = drift * (this.osc(0.09, 3.3, 1) * 0.6 + this.osc(0.27, 0.9, 1) * 0.25) + P[10] - turn * 0.12;
    nod += this.voiceS * m.voice.bob * 0.35 * idle;
    if (dz?.type === 'head') {
      turn += Math.sin(this.t * 2.6) * 0.8 * dg;
      tilt += Math.sin(this.t * 1.7 + 1) * 0.7 * dg;
      nod += Math.sin(this.t * 2.1 + 2) * 0.4 * dg;
    }
    this.headVel.turn = (turn - this.head.turn) / h;
    this.headVel.tilt = (tilt - this.head.tilt) / h;
    this.head.turn = turn;
    this.head.nod = nod;
    this.head.tilt = tilt;

    // ---- breath and body
    if (this.loop) {
      const cycles = Math.max(1, Math.round((this.loop * m.tempo) / m.breath.period));
      this.breathPhase = (cycles * this.t) / this.loop;
    } else {
      this.breathPhase += (h * m.tempo) / m.breath.period;
    }
    const bp = this.breathPhase % 1;
    // inhale takes 42% of the cycle, the exhale is longer and softer
    const wave = bp < 0.42 ? 0.5 - 0.5 * Math.cos((bp / 0.42) * Math.PI) : 0.5 + 0.5 * Math.cos(((bp - 0.42) / 0.58) * Math.PI);
    let breath = wave * idle;
    if (dz?.type === 'breath') breath = Math.max(breath, (0.5 - 0.5 * Math.cos(this.t * 4)) * dg);
    const bodyAmt = idle * L * m.idle.body;
    const rot = bodyAmt * 0.014 * (this.osc(0.07, 0.2, 1) * 0.7 + this.osc(0.16, 3.9, 1) * 0.3);
    const bob = bodyAmt * doc.height * 0.0035 * this.osc(0.1, 1.1, 1);

    // ---- blinking
    let blink = 0;
    const b = m.blink;
    const dur = b.close + b.hold + b.open;
    if (this.loop) {
      this.loopBlinks ??= this.buildLoopBlinks(doc, this.loop);
      const tl = this.t % this.loop;
      for (const e of this.loopBlinks) blink = Math.max(blink, this.blinkEnv(tl - e.t0, doc) * e.peak);
      if (!b.enabled) blink = 0;
    } else {
      if (b.enabled && idle > 0.5 && this.t >= this.nextBlink) {
        const partial = this.rng() < b.partial;
        this.blinks.push({ t0: this.t, peak: partial ? 0.45 + this.rng() * 0.25 : 1 });
        const again = this.rng() < b.double;
        const gap = b.every * (1 + (this.rng() * 2 - 1) * b.vary * 0.8);
        this.nextBlink = this.t + (again ? dur + 0.06 + this.rng() * 0.08 : Math.max(dur + 0.2, gap / m.tempo));
      }
      if (idle <= 0.5) this.nextBlink = Math.max(this.nextBlink, this.t + 0.6);
      this.blinks = this.blinks.filter((e) => this.t - e.t0 < dur + 0.05);
      for (const e of this.blinks) blink = Math.max(blink, this.blinkEnv(this.t - e.t0, doc) * e.peak);
    }

    const axis = eyeAxis(doc);
    const f = this.frame;
    f.head = this.head;
    f.breath = breath;
    f.body = { rot, bob };
    f.layerAlpha = this.layerAlpha;
    f.liveliness = L;
    f.eyes = {};
    f.mouths = {};
    f.sway = {};

    for (const z of doc.zones) {
      if (!z.enabled) continue;
      if (z.type === 'eye') {
        const o = (z.a.x + z.b.x) / 2 <= axis ? 0 : 3;
        let upper = P[o] + (1 - P[o]) * blink;
        let lower = P[o + 1] + (1 - P[o + 1]) * 0.18 * blink;
        const want = this.lidScrub[z.id] ?? 0;
        const cur = this.scrubS[z.id] ?? 0;
        const s = cur + (want - cur) * k(want > cur ? 0.02 : 0.07);
        this.scrubS[z.id] = s;
        if (dz === z) {
          const ph = (this.t % 1.3) / 1.3;
          s > 0.01 || (upper = Math.max(upper, this.blinkEnv(ph * 1.3 - 0.3, doc) * dg));
        }
        upper = Math.max(upper, s);
        lower = Math.max(lower, s * 0.18);
        const hw = Math.hypot(z.b.x - z.a.x, z.b.y - z.a.y) / 2;
        f.eyes[z.id] = {
          upper: Math.min(1, Math.max(0, upper)),
          lower: Math.min(1, Math.max(0, lower)),
          arc: P[o + 2],
          gx: this.look.x * z.gaze * hw * 0.32,
          gy: this.look.y * z.gaze * (z.upH + z.loH) * 0.3,
        };
      } else if (z.type === 'mouth') {
        let open = P[6] + this.voiceS * (1 - P[6] * 0.5);
        if (dz === z) open = Math.max(open, (0.5 - 0.5 * Math.cos(this.t * 7)) * 0.8 * dg);
        f.mouths[z.id] = { open: Math.min(1, Math.max(0, open)), smile: P[7] };
      } else if (z.type === 'sway') {
        f.sway[z.id] = this.tickSway(z, h, idle, L, dz === z ? dg : 0, m.tempo);
      }
    }
    this.poke *= Math.exp(-h / 0.05);
  }

  private tickSway(z: Extract<Zone, { type: 'sway' }>, h: number, idle: number, L: number, demo: number, tempo: number) {
    let s = this.sway.get(z.id);
    if (!s) {
      s = { th: 0, om: 0, hist: new Float32Array(HIST), hi: 0, phase: hashPhase(z.id) };
      this.sway.set(z.id, s);
    }
    const freq = 2.4 - z.weight * 1.8; // Hz: light things flutter, heavy things swing
    const w0 = TAU * freq;
    const zeta = 0.62 - z.bounce * 0.52;
    const wind =
      (this.osc(0.21, s.phase, 1) * 0.6 + this.osc(0.47, s.phase * 1.7, 1) * 0.3 + this.osc(0.83, s.phase * 2.3, 1) * 0.1) *
      z.breeze * idle;
    const rest = wind * 0.55 + Math.sin(this.t * 4.4) * demo * 0.9;
    const dir = Math.sign(z.tip.y - z.anchor.y) || 1; // hanging things lag behind the head; upright things lead
    const inertia = -(this.headVel.turn * 0.5 + this.headVel.tilt * 0.9) * dir * (0.5 + z.weight);
    const kick = this.poke * 60 * Math.cos(s.phase * 3);
    const acc = w0 * w0 * (rest - s.th) - 2 * zeta * w0 * s.om + (inertia + kick) * w0;
    s.om += acc * h;
    s.th += s.om * h;
    if (s.th > 2.5) { s.th = 2.5; s.om = 0; }
    if (s.th < -2.5) { s.th = -2.5; s.om = 0; }
    s.hi = (s.hi + 1) % HIST;
    s.hist[s.hi] = s.th;

    const out = (this.frame.sway[z.id] as Float32Array | undefined) ?? new Float32Array(SWAY_SAMPLES + 1);
    const amp = z.amount * 0.55 * Math.min(1.6, 0.35 + L * 0.65);
    const lag = z.ripple * 0.42;
    for (let i = 0; i <= SWAY_SAMPLES; i++) {
      const d = (i / SWAY_SAMPLES) * 1.5;
      const back = Math.min(HIST - 2, (lag * d) / STEP);
      const i0 = Math.floor(back);
      const fr = back - i0;
      const a = s.hist[(s.hi - i0 + HIST * 2) % HIST];
      const b2 = s.hist[(s.hi - i0 - 1 + HIST * 2) % HIST];
      out[i] = (a + (b2 - a) * fr) * amp * Math.pow(d, 1.25);
    }
    void tempo;
    return out;
  }
}
