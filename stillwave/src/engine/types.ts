// The Stillwave document model. Everything a project needs lives in `Doc`,
// except pixel data (artwork images and painted masks), which is kept in the
// asset registries and referenced by id.

export type Vec = { x: number; y: number };

export interface Layer {
  id: string;
  name: string;
  image: string; // image asset id
  w: number;
  h: number;
  x: number; // centre, in artboard pixels
  y: number;
  scale: number;
  rotation: number; // radians
  opacity: number;
  visible: boolean;
  depth: number; // -1 (far) .. 1 (near): parallax when the head turns
  original?: string; // image before any retouching or lifting, for "restore"
  role?: 'repair' | 'lifted' | 'backing';
}

export type ZoneType = 'eye' | 'sway' | 'head' | 'breath' | 'mouth' | 'hold';
export type SwayStyle = 'swing' | 'bend' | 'flutter';
export type LidPoint = { t: number; y: number };
/** A node of a precise lid curve, in the eye's own frame: t runs -1 (left corner) to 1 (right corner),
 *  y is pixels away from the eye axis (up for the upper curves, down for the lower lid). */
export interface PathNode { t: number; y: number; it: number; iy: number; ot: number; oy: number }
export type EyeCurve = 'up' | 'band' | 'skin' | 'lo';
/** The four guide curves of a precisely edited eye. */
export interface EyeCurves { up: PathNode[]; band: PathNode[]; skin: PathNode[]; lo: PathNode[] }

interface ZoneBase {
  id: string;
  name: string;
  enabled: boolean;
  layers: 'all' | string[]; // which layers this motion bends
}

interface PaintZone extends ZoneBase {
  mask: string | null; // painted weight mask id
  whole: boolean; // move the chosen layers entirely, no paint needed
  auto: boolean; // anchor points follow the paint until moved by hand
}

export interface SwayZone extends PaintZone {
  type: 'sway';
  anchor: Vec;
  tip: Vec;
  path: Vec[]; // optional points between root and tip, so the spine can follow a curl
  style: SwayStyle; // swing: rigid from the root; bend: curls progressively; flutter: bend plus a fast tip
  amount: number;
  weight: number;
  bounce: number;
  breeze: number;
  ripple: number;
}

export interface HeadZone extends PaintZone {
  type: 'head';
  pivot: Vec;
  turn: number;
  nod: number;
  tilt: number;
}

export interface BreathZone extends PaintZone {
  type: 'breath';
  base: Vec;
  amount: number;
}

/** Painted "nothing here moves" area. Wins over every other motion. */
export interface HoldZone extends PaintZone {
  type: 'hold';
}

export interface EyeZone extends ZoneBase {
  type: 'eye';
  a: Vec; // corners
  b: Vec;
  upT: number; // upper lid peak position along the eye, -1..1
  upH: number; // upper lid height in px
  loT: number;
  loH: number;
  upRound: number;
  loRound: number;
  band: number; // lash thickness carried by the lid
  loBand: number;
  skin: number; // strip of skin above the lashes that stretches
  meet: number; // where the lids meet: 0 lower lid .. 1 upper lid
  gaze: number;
  pair: string | null;
  upPts: LidPoint[]; // extra points the upper lid passes through (besides its peak)
  loPts: LidPoint[];
  fill: 'soft' | 'stretch'; // how hidden skin is made: blended skin tone, or the skin above pulled down
  roll: number; // lashes foreshorten as the lid closes
  box: { x: number; y: number; w: number; h: number } | null; // artboard rect the eye paint covers
  paint: string | null; // hand-painted lid skin (image id)
  ctl: string | null; // red = keep as drawn, green = travels with the lid (image id)
  edit: 'simple' | 'precise'; // which set of controls shapes this eye
  curves: EyeCurves | null; // the precise shape, kept even while editing simply
  follow: number; // how far the top of the carried band (the crease) travels with the lashes, 0..1
  land: number; // px the closed lashes travel past the waterline, over the lower lid line
}

export interface MouthZone extends ZoneBase {
  type: 'mouth';
  a: Vec;
  b: Vec;
  bow: number; // how far the middle of the lip line sits above (+) or below (-) the corners
  openH: number;
  smileH: number;
  reach: number;
  color: string;
}

export type Zone = SwayZone | HeadZone | BreathZone | EyeZone | MouthZone | HoldZone;

export interface LidPose {
  upper: number;
  lower: number;
  arc: number;
}

export interface Pose {
  eyeL: LidPose;
  eyeR: LidPose;
  mouthOpen: number;
  mouthSmile: number;
  turn: number;
  nod: number;
  tilt: number;
}

export interface Expression {
  id: string;
  name: string;
  pose: Pose;
  layers: Record<string, boolean>; // per-mood layer visibility overrides
}

export interface Motion {
  liveliness: number;
  tempo: number;
  transition: number;
  blink: {
    enabled: boolean;
    every: number;
    vary: number;
    close: number;
    hold: number;
    open: number;
    partial: number;
    double: number;
  };
  breath: { period: number };
  idle: { head: number; body: number };
  look: { follow: boolean; amount: number; wander: number };
  voice: { gain: number; bob: number };
}

export interface Doc {
  version: 1;
  name: string;
  width: number;
  height: number;
  layers: Layer[]; // bottom to top
  zones: Zone[];
  expressions: Expression[];
  motion: Motion;
  stage: { background: string }; // 'transparent' or a css colour
}

export const ZONE_INFO: Record<ZoneType, { label: string; color: string; hint: string; paint: boolean }> = {
  eye: { label: 'Eye', color: '#6fb8ff', hint: 'Blinks, half-lids and gaze. Fit the outline to an eye.', paint: false },
  sway: { label: 'Sway', color: '#ff8fb3', hint: 'Hair, ribbons, ears, tails. Paint from root to tip.', paint: true },
  head: { label: 'Head', color: '#ffc46b', hint: 'Tilts, turns and nods. Paint the head and neck.', paint: true },
  breath: { label: 'Breath', color: '#7eddb5', hint: 'A slow rise and fall. Paint the chest and shoulders.', paint: true },
  mouth: { label: 'Mouth', color: '#ff7a6b', hint: 'Opens and smiles. Fit the line to the lips.', paint: false },
  hold: { label: 'Hold still', color: '#8fa3c7', hint: 'Paint anything that must never move: a face under swaying hair, a hand, a prop.', paint: true },
};

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export const neutralPose = (): Pose => ({
  eyeL: { upper: 0, lower: 0, arc: 0 },
  eyeR: { upper: 0, lower: 0, arc: 0 },
  mouthOpen: 0,
  mouthSmile: 0,
  turn: 0,
  nod: 0,
  tilt: 0,
});

export function defaultExpressions(): Expression[] {
  const mk = (name: string, patch: Partial<Pose>): Expression => ({
    id: uid('mood'),
    name,
    pose: { ...neutralPose(), ...patch },
    layers: {},
  });
  return [
    mk('Neutral', {}),
    mk('Joy', {
      eyeL: { upper: 0.5, lower: 0.9, arc: 1 },
      eyeR: { upper: 0.5, lower: 0.9, arc: 1 },
      mouthSmile: 0.8,
      mouthOpen: 0.15,
      tilt: 0.25,
    }),
    mk('Sleepy', {
      eyeL: { upper: 0.55, lower: 0.05, arc: -0.2 },
      eyeR: { upper: 0.6, lower: 0.05, arc: -0.2 },
      nod: 0.35,
      tilt: -0.2,
    }),
    mk('Wink', {
      eyeR: { upper: 1, lower: 0.5, arc: 0.7 },
      mouthSmile: 0.6,
      tilt: 0.3,
      turn: 0.15,
    }),
    mk('Surprised', { mouthOpen: 0.55, nod: -0.25 }),
  ];
}

export const defaultMotion = (): Motion => ({
  liveliness: 1,
  tempo: 1,
  transition: 0.35,
  blink: { enabled: true, every: 3.6, vary: 0.5, close: 0.075, hold: 0.04, open: 0.17, partial: 0.15, double: 0.12 },
  breath: { period: 3.8 },
  idle: { head: 0.5, body: 0.35 },
  look: { follow: false, amount: 0.6, wander: 0.35 },
  voice: { gain: 1, bob: 0.4 },
});

export function emptyDoc(): Doc {
  return {
    version: 1,
    name: 'Untitled avatar',
    width: 1024,
    height: 1024,
    layers: [],
    zones: [],
    expressions: defaultExpressions(),
    motion: defaultMotion(),
    stage: { background: 'transparent' },
  };
}

export const SWAY_FEELS: Record<string, Pick<SwayZone, 'amount' | 'weight' | 'bounce' | 'breeze' | 'ripple'>> = {
  Soft: { amount: 0.4, weight: 0.5, bounce: 0.35, breeze: 0.45, ripple: 0.5 },
  Bouncy: { amount: 0.55, weight: 0.3, bounce: 0.85, breeze: 0.3, ripple: 0.35 },
  Heavy: { amount: 0.3, weight: 0.9, bounce: 0.3, breeze: 0.2, ripple: 0.7 },
  Feather: { amount: 0.65, weight: 0.1, bounce: 0.5, breeze: 0.9, ripple: 0.8 },
};

export function makeZone(type: ZoneType, doc: Doc, at: Vec, index: number): Zone {
  const base = { id: uid('zone'), name: `${ZONE_INFO[type].label}${index > 0 ? ' ' + (index + 1) : ''}`, enabled: true, layers: 'all' as const };
  const u = Math.max(doc.width, doc.height);
  switch (type) {
    case 'eye':
      return {
        ...base, type,
        a: { x: at.x - u * 0.045, y: at.y }, b: { x: at.x + u * 0.045, y: at.y },
        upT: 0, upH: u * 0.03, loT: 0, loH: u * 0.018, upRound: 0.8, loRound: 0.9,
        band: u * 0.008, loBand: u * 0.002, skin: u * 0.008, meet: 0.08, gaze: 0.6, pair: null,
        upPts: [], loPts: [], fill: 'soft', roll: 0.4, box: null, paint: null, ctl: null, edit: 'simple', curves: null, follow: 1, land: 1.5,
      };
    case 'mouth':
      return {
        ...base, type,
        a: { x: at.x - u * 0.03, y: at.y }, b: { x: at.x + u * 0.03, y: at.y },
        bow: 0, openH: u * 0.03, smileH: u * 0.012, reach: u * 0.05, color: '#7a2b33',
      };
    case 'sway':
      return { ...base, type, mask: null, whole: false, auto: true, anchor: { x: at.x, y: at.y - u * 0.08 }, tip: { x: at.x, y: at.y + u * 0.08 }, path: [], style: 'bend', ...SWAY_FEELS.Soft };
    case 'hold':
      return { ...base, type, mask: null, whole: false, auto: false };
    case 'head':
      return { ...base, type, mask: null, whole: false, auto: true, pivot: { x: at.x, y: at.y + u * 0.1 }, turn: 0.6, nod: 0.6, tilt: 0.6 };
    case 'breath':
      return { ...base, type, mask: null, whole: false, auto: true, base: { x: at.x, y: at.y + u * 0.1 }, amount: 0.5 };
  }
}

export const isPaintZone = (z: Zone): z is SwayZone | HeadZone | BreathZone | HoldZone =>
  z.type === 'sway' || z.type === 'head' || z.type === 'breath' || z.type === 'hold';

/** Fill in fields added after a project was saved, so old files keep opening. */
export function normalizeDoc(doc: Doc): Doc {
  for (const z of doc.zones) {
    if (z.type === 'sway') {
      z.path ??= [];
      z.style ??= 'bend';
    } else if (z.type === 'eye') {
      z.upPts ??= [];
      z.loPts ??= [];
      z.fill ??= 'stretch'; // what older projects were tuned with
      z.roll ??= 0;
      z.box ??= null;
      z.paint ??= null;
      z.ctl ??= null;
      z.edit ??= 'simple';
      z.curves ??= null;
      z.follow ??= 1;
      z.land ??= 0; // older projects closed exactly on the waterline
    } else if (z.type === 'mouth') {
      z.bow ??= 0;
    }
  }
  return doc;
}

export const zoneHitsLayer = (z: Zone, layerId: string) => z.layers === 'all' || z.layers.includes(layerId);
