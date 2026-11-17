// "Mio", the built-in sample avatar. She is drawn with canvas paths at
// runtime (original artwork, no external assets) so the app has something to
// animate out of the box, both as separate layers and as one flattened image.
import { makeCanvas, registerImage } from '../engine/assets';
import { maskFromStrokes } from '../engine/paint';
import {
  defaultExpressions, defaultMotion, uid, ZONE_INFO, SWAY_FEELS,
  type Doc, type EyeZone, type Layer, type MouthZone, type Zone,
} from '../engine/types';

const W = 900;
const H = 1100;

const C = {
  hair: '#3d5a80', hairDark: '#293f5c', hairLight: '#6f93bd',
  skin: '#ffe3d3', skinShade: '#f3c3b3', line: '#2a2233',
  iris: '#e8963a', irisDark: '#a3531f', white: '#fffdfb',
  hoodie: '#f5efe4', hoodieShade: '#d9cfc0', accent: '#ff7d6b', mouth: '#7a2b33', blush: '#ff9d94',
};

const EYE = { hw: 37, y: 462, upT: 0.08, upH: 27, loT: 0, loH: 15, upRound: 0.72, loRound: 0.9, band: 8 };
const EYES = [{ cx: 389, flip: -1 }, { cx: 511, flip: 1 }];

function lid(t: number, tp: number, h: number, r: number) {
  let s = t < tp ? (tp - t) / (tp + 1) : (t - tp) / (1 - tp);
  s = Math.min(1, Math.max(0, s));
  return h * Math.pow(Math.max(0, 1 - s * s), r);
}

type Ctx = CanvasRenderingContext2D;
type Draw = (g: Ctx) => void;

function path(g: Ctx, d: string) {
  return new Path2D(d);
}

const backHair: Draw = (g) => {
  const p = path(g, 'M450 205 C300 200 232 300 236 430 C240 560 205 660 214 780 C226 770 238 752 246 730 C250 790 268 830 300 858 C296 820 300 790 312 760 C330 810 356 838 392 850 L508 850 C544 838 570 810 588 760 C600 790 604 820 600 858 C632 830 650 790 654 730 C662 752 674 770 686 780 C695 660 660 560 664 430 C668 300 600 200 450 205 Z');
  const grad = g.createLinearGradient(0, 200, 0, 860);
  grad.addColorStop(0, C.hair);
  grad.addColorStop(1, C.hairDark);
  g.fillStyle = grad;
  g.fill(p);
  g.strokeStyle = C.hairDark;
  g.lineWidth = 3;
  g.lineCap = 'round';
  for (const d of ['M270 470 C262 580 250 660 262 740', 'M630 470 C638 580 650 660 638 740', 'M330 620 C326 700 334 770 350 820', 'M570 620 C574 700 566 770 550 820']) g.stroke(path(g, d));
};

const body: Draw = (g) => {
  // neck
  g.fillStyle = C.skinShade;
  g.fill(path(g, 'M412 560 L412 700 C430 722 470 722 488 700 L488 560 Z'));
  g.fillStyle = C.skin;
  g.fill(path(g, 'M412 610 C436 632 464 632 488 610 L488 700 C470 722 430 722 412 700 Z'));
  // hoodie
  const p = path(g, 'M180 1100 C186 930 220 800 330 742 C366 724 396 706 412 690 C436 716 464 716 488 690 C504 706 534 724 570 742 C680 800 714 930 720 1100 Z');
  g.fillStyle = C.hoodie;
  g.fill(p);
  g.save();
  g.clip(p);
  g.fillStyle = C.hoodieShade;
  g.fill(path(g, 'M180 1100 C200 980 230 900 262 850 C262 950 270 1030 286 1100 Z'));
  g.fill(path(g, 'M720 1100 C700 980 670 900 638 850 C638 950 630 1030 614 1100 Z'));
  // hood folds
  g.fill(path(g, 'M330 742 C380 760 420 790 450 840 C480 790 520 760 570 742 C540 780 500 830 450 880 C400 830 360 780 330 742 Z'));
  g.restore();
  g.strokeStyle = C.accent;
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.stroke(path(g, 'M418 800 C414 850 416 900 420 940'));
  g.stroke(path(g, 'M482 800 C486 850 484 900 480 940'));
  g.fillStyle = C.accent;
  g.beginPath(); g.arc(420, 950, 9, 0, 7); g.arc(480, 950, 9, 0, 7); g.fill();
  // little wave emblem
  g.lineWidth = 6;
  g.stroke(path(g, 'M560 960 c10 0 10 -16 20 -16 s10 16 20 16 s10 -16 20 -16'));
};

const face: Draw = (g) => {
  g.fillStyle = C.skinShade;
  g.beginPath(); g.ellipse(322, 452, 16, 26, 0, 0, 7); g.ellipse(578, 452, 16, 26, 0, 0, 7); g.fill();
  const p = path(g, 'M322 400 C320 520 384 604 450 606 C516 604 580 520 578 400 C578 290 322 290 322 400 Z');
  g.fillStyle = C.skin;
  g.fill(p);
  g.save();
  g.clip(p);
  // soft shadow under the fringe
  const sh = g.createLinearGradient(0, 330, 0, 420);
  sh.addColorStop(0, C.skinShade);
  sh.addColorStop(1, 'rgba(243,195,179,0)');
  g.fillStyle = sh;
  g.fillRect(300, 300, 300, 130);
  g.restore();
  // brows
  g.strokeStyle = C.hairDark;
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.stroke(path(g, 'M356 408 C374 398 400 398 420 404'));
  g.stroke(path(g, 'M544 408 C526 398 500 398 480 404'));
  // nose
  g.strokeStyle = C.skinShade;
  g.lineWidth = 4;
  g.stroke(path(g, 'M447 512 C450 518 453 518 455 514'));
};

const blush: Draw = (g) => {
  for (const x of [366, 534]) {
    const r = g.createRadialGradient(x, 512, 0, x, 512, 34);
    r.addColorStop(0, 'rgba(255,125,120,0.75)');
    r.addColorStop(1, 'rgba(255,125,120,0)');
    g.fillStyle = r;
    g.beginPath(); g.ellipse(x, 512, 36, 22, 0, 0, 7); g.fill();
  }
};

const eyes: Draw = (g) => {
  for (const e of EYES) {
    const X = (t: number) => e.cx + t * EYE.hw;
    const up = (t: number) => EYE.y - lid(t, EYE.upT * e.flip, EYE.upH, EYE.upRound);
    const lo = (t: number) => EYE.y + lid(t, EYE.loT, EYE.loH, EYE.loRound);
    const N = 40;
    const almond = new Path2D();
    for (let i = 0; i <= N; i++) { const t = -1 + (2 * i) / N; i ? almond.lineTo(X(t), up(t)) : almond.moveTo(X(t), up(t)); }
    for (let i = N; i >= 0; i--) { const t = -1 + (2 * i) / N; almond.lineTo(X(t), lo(t)); }
    almond.closePath();
    g.fillStyle = C.white;
    g.fill(almond);
    g.save();
    g.clip(almond);
    const ig = g.createLinearGradient(0, EYE.y - 24, 0, EYE.y + 18);
    ig.addColorStop(0, C.irisDark);
    ig.addColorStop(0.55, C.iris);
    ig.addColorStop(1, '#ffd58a');
    g.fillStyle = ig;
    g.beginPath(); g.ellipse(e.cx, EYE.y - 3, 19, 23, 0, 0, 7); g.fill();
    g.fillStyle = C.line;
    g.beginPath(); g.ellipse(e.cx, EYE.y - 5, 8, 11, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(42,34,51,0.28)';
    g.fillRect(e.cx - 50, EYE.y - 40, 100, 22); // lid shadow
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(e.cx - 8, EYE.y - 13, 6, 7, 0, 0, 7); g.fill();
    g.beginPath(); g.arc(e.cx + 8, EYE.y + 7, 3, 0, 7); g.fill();
    g.restore();
    // upper lash: a band that sits exactly on the lid curve
    g.fillStyle = C.line;
    const lash = new Path2D();
    for (let i = 0; i <= N; i++) { const t = -1 + (2 * i) / N; i ? lash.lineTo(X(t), up(t) + 0.5) : lash.moveTo(X(t), up(t) + 0.5); }
    for (let i = N; i >= 0; i--) {
      const t = -1 + (2 * i) / N;
      const outer = (t * e.flip + 1) / 2; // 0 inner corner .. 1 outer corner
      lash.lineTo(X(t), up(t) - (EYE.band - 1) * (0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, outer * 0.75 + 0.2))));
    }
    lash.closePath();
    g.fill(lash);
    // lower lash hint
    g.strokeStyle = 'rgba(42,34,51,0.55)';
    g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i <= 14; i++) { const t = e.flip * (0.15 + (0.8 * i) / 14); i ? g.lineTo(X(t), lo(t)) : g.moveTo(X(t), lo(t)); }
    g.stroke();
  }
};

const mouth: Draw = (g) => {
  g.strokeStyle = C.mouth;
  g.lineWidth = 4.5;
  g.lineCap = 'round';
  g.stroke(path(g, 'M428 548 C440 556 460 556 472 548'));
};

const frontHair: Draw = (g) => {
  const p = path(g, 'M450 196 C330 190 262 280 268 420 C270 520 262 590 280 660 C296 620 304 580 306 530 C310 480 312 440 322 410 C330 420 340 426 350 428 C348 400 352 372 364 350 C372 384 388 410 410 424 C408 392 414 362 430 338 C440 376 462 408 492 424 C490 396 494 370 506 350 C520 386 540 412 566 426 C570 420 574 414 578 408 C588 440 590 480 594 530 C596 580 604 620 620 660 C638 590 630 520 632 420 C638 280 570 190 450 196 Z');
  const grad = g.createLinearGradient(0, 190, 0, 660);
  grad.addColorStop(0, C.hairLight);
  grad.addColorStop(0.35, C.hair);
  grad.addColorStop(1, C.hair);
  g.fillStyle = grad;
  g.fill(p);
  g.save();
  g.clip(p);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 14;
  g.lineCap = 'round';
  g.stroke(path(g, 'M340 290 C400 262 500 262 560 290'));
  g.strokeStyle = C.hairDark;
  g.lineWidth = 2.5;
  for (const d of ['M290 440 C286 520 286 580 292 630', 'M610 440 C614 520 614 580 608 630', 'M392 250 C380 290 370 320 364 350', 'M470 240 C452 276 436 306 430 338', 'M540 262 C522 290 510 320 506 350']) g.stroke(path(g, d));
  g.restore();
};

const ahoge: Draw = (g) => {
  g.fillStyle = C.hair;
  g.fill(path(g, 'M444 214 C430 160 452 118 500 104 C472 128 462 160 468 212 Z'));
  g.fillStyle = C.accent;
  // hair clip
  g.save();
  g.translate(600, 372);
  g.rotate(0.5);
  g.beginPath(); g.roundRect(-22, -6, 44, 12, 6); g.fill();
  g.restore();
};

const PARTS: { name: string; draw: Draw; depth: number; visible?: boolean }[] = [
  { name: 'Back hair', draw: backHair, depth: -0.6 },
  { name: 'Body', draw: body, depth: 0 },
  { name: 'Face', draw: face, depth: 0 },
  { name: 'Blush', draw: blush, depth: 0.15, visible: false },
  { name: 'Eyes', draw: eyes, depth: 0.25 },
  { name: 'Mouth', draw: mouth, depth: 0.25 },
  { name: 'Front hair', draw: frontHair, depth: 0.55 },
  { name: 'Ahoge and clip', draw: ahoge, depth: 0.7 },
];

function trim(src: HTMLCanvasElement) {
  const data = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
  let x0 = src.width, y0 = src.height, x1 = 0, y1 = 0;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    if (data[(y * src.width + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(src.width - 1, x1 + 2); y1 = Math.min(src.height - 1, y1 + 2);
  const out = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d')!.drawImage(src, -x0, -y0);
  return { canvas: out, x: x0, y: y0 };
}

function renderPart(draw: Draw) {
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  draw(g);
  return c;
}

function eyeZones(layers: 'all' | string[] = 'all'): EyeZone[] {
  const ids = [uid('zone'), uid('zone')];
  return EYES.map((e, i) => ({
    id: ids[i], type: 'eye', name: i === 0 ? 'Left eye' : 'Right eye', enabled: true, layers,
    a: { x: e.cx - EYE.hw, y: EYE.y }, b: { x: e.cx + EYE.hw, y: EYE.y },
    upT: EYE.upT * e.flip, upH: EYE.upH, loT: EYE.loT, loH: EYE.loH, upRound: EYE.upRound, loRound: EYE.loRound,
    band: EYE.band + 1, loBand: 2, skin: 7, meet: 0.1, gaze: 0.6, pair: ids[1 - i],
    upPts: [], loPts: [], fill: 'soft', roll: 0.35, box: null, paint: null, ctl: null, edit: 'simple', curves: null, follow: 1, land: 1.5,
  }));
}

const mouthZone = (): MouthZone => ({
  id: uid('zone'), type: 'mouth', name: 'Mouth', enabled: true, layers: 'all',
  a: { x: 427, y: 548 }, b: { x: 473, y: 548 }, bow: -6, openH: 30, smileH: 9, reach: 40, color: C.mouth,
});

function moods(layerIds: Record<string, string>) {
  const list = defaultExpressions();
  const joy = list.find((m) => m.name === 'Joy');
  if (joy && layerIds.Blush) joy.layers[layerIds.Blush] = true;
  return list;
}

/** The sample as separate layers, with a rig that moves whole layers. */
export function sampleLayered(): Doc {
  const layers: Layer[] = [];
  const ids: Record<string, string> = {};
  for (const part of PARTS) {
    const t = trim(renderPart(part.draw));
    const id = uid('layer');
    ids[part.name] = id;
    layers.push({
      id, name: part.name, image: registerImage(t.canvas, t.canvas.width, t.canvas.height),
      w: t.canvas.width, h: t.canvas.height, x: t.x + t.canvas.width / 2, y: t.y + t.canvas.height / 2,
      scale: 1, rotation: 0, opacity: 1, visible: part.visible ?? true, depth: part.depth,
    });
  }
  const doc = { width: W, height: H };
  const headLayers = PARTS.filter((p) => p.name !== 'Body').map((p) => ids[p.name]);
  const zones: Zone[] = [
    { id: uid('zone'), type: 'head', name: 'Head', enabled: true, layers: headLayers, mask: null, whole: true, auto: false, pivot: { x: 450, y: 640 }, turn: 0.6, nod: 0.6, tilt: 0.6 },
    { id: uid('zone'), type: 'breath', name: 'Breath', enabled: true, layers: [ids.Body], mask: null, whole: true, auto: false, base: { x: 450, y: 1100 }, amount: 0.5 },
    ...eyeZones([ids.Face, ids.Eyes]),
    mouthZone(),
    { id: uid('zone'), type: 'sway', name: 'Back hair', enabled: true, layers: [ids['Back hair']], mask: null, whole: true, auto: false, anchor: { x: 450, y: 330 }, tip: { x: 450, y: 850 }, path: [], style: 'swing', ...SWAY_FEELS.Heavy, amount: 0.22 },
    {
      id: uid('zone'), type: 'sway', name: 'Left lock', enabled: true, layers: [ids['Front hair']], whole: false, auto: false,
      mask: maskFromStrokes(doc, ZONE_INFO.sway.color, [{ pts: [286, 430, 284, 520, 286, 600, 284, 660], r: 34, soft: 0.6 }]),
      anchor: { x: 290, y: 400 }, tip: { x: 282, y: 660 }, path: [], style: 'bend', ...SWAY_FEELS.Soft,
    },
    {
      id: uid('zone'), type: 'sway', name: 'Right lock', enabled: true, layers: [ids['Front hair']], whole: false, auto: false,
      mask: maskFromStrokes(doc, ZONE_INFO.sway.color, [{ pts: [614, 430, 616, 520, 614, 600, 616, 660], r: 34, soft: 0.6 }]),
      anchor: { x: 610, y: 400 }, tip: { x: 618, y: 660 }, path: [], style: 'bend', ...SWAY_FEELS.Soft,
    },
    {
      id: uid('zone'), type: 'sway', name: 'Fringe', enabled: true, layers: [ids['Front hair']], whole: false, auto: false,
      mask: maskFromStrokes(doc, ZONE_INFO.sway.color, [{ pts: [340, 400, 400, 396, 450, 396, 500, 396, 560, 400], r: 34, soft: 0.7 }]),
      anchor: { x: 450, y: 300 }, tip: { x: 450, y: 430 }, path: [], style: 'bend', ...SWAY_FEELS.Soft, amount: 0.2,
    },
    { id: uid('zone'), type: 'sway', name: 'Ahoge', enabled: true, layers: [ids['Ahoge and clip']], whole: false, auto: false,
      mask: maskFromStrokes(doc, ZONE_INFO.sway.color, [{ pts: [456, 205, 456, 160, 480, 115], r: 40, soft: 0.4 }]),
      anchor: { x: 456, y: 214 }, tip: { x: 490, y: 108 }, path: [], style: 'bend', ...SWAY_FEELS.Bouncy },
  ];
  return {
    version: 1, name: 'Mio (layered sample)', width: W, height: H, layers, zones,
    expressions: moods(ids), motion: defaultMotion(), stage: { background: 'transparent' },
  };
}

/** The same drawing flattened to a single image, rigged with painted regions only. */
export function sampleFlat(): Doc {
  const flat = makeCanvas(W, H);
  const g = flat.getContext('2d')!;
  for (const part of PARTS) if (part.visible ?? true) g.drawImage(renderPart(part.draw), 0, 0);
  const doc = { width: W, height: H };
  const layer: Layer = {
    id: uid('layer'), name: 'Mio (flattened)', image: registerImage(flat, W, H), w: W, h: H, x: W / 2, y: H / 2,
    scale: 1, rotation: 0, opacity: 1, visible: true, depth: 0,
  };
  const zones: Zone[] = [
    {
      id: uid('zone'), type: 'head', name: 'Head', enabled: true, layers: 'all', whole: false, auto: false,
      mask: maskFromStrokes(doc, ZONE_INFO.head.color, [
        { pts: [450, 400], r: 250, soft: 0.25 },
        { pts: [330, 520, 300, 700], r: 130, soft: 0.5 }, { pts: [570, 520, 600, 700], r: 130, soft: 0.5 },
        { pts: [470, 160], r: 90, soft: 0.4 },
      ]),
      pivot: { x: 450, y: 650 }, turn: 0.5, nod: 0.5, tilt: 0.55,
    },
    {
      id: uid('zone'), type: 'breath', name: 'Breath', enabled: true, layers: 'all', whole: false, auto: false,
      mask: maskFromStrokes(doc, ZONE_INFO.breath.color, [{ pts: [300, 900, 450, 880, 600, 900], r: 190, soft: 0.6 }, { pts: [300, 1040, 600, 1040], r: 180, soft: 0.5 }]),
      base: { x: 450, y: 1100 }, amount: 0.5,
    },
    ...eyeZones(),
    mouthZone(),
    {
      id: uid('zone'), type: 'sway', name: 'Left hair', enabled: true, layers: 'all', whole: false, auto: false,
      mask: maskFromStrokes(doc, ZONE_INFO.sway.color, [{ pts: [262, 470, 250, 600, 252, 720, 270, 820], r: 58, soft: 0.7 }]),
      anchor: { x: 270, y: 420 }, tip: { x: 256, y: 840 }, path: [], style: 'bend', ...SWAY_FEELS.Soft, amount: 0.3,
    },
    {
      id: uid('zone'), type: 'sway', name: 'Right hair', enabled: true, layers: 'all', whole: false, auto: false,
      mask: maskFromStrokes(doc, ZONE_INFO.sway.color, [{ pts: [638, 470, 650, 600, 648, 720, 630, 820], r: 58, soft: 0.7 }]),
      anchor: { x: 630, y: 420 }, tip: { x: 644, y: 840 }, path: [], style: 'bend', ...SWAY_FEELS.Soft, amount: 0.3,
    },
    {
      id: uid('zone'), type: 'sway', name: 'Ahoge', enabled: true, layers: 'all', whole: false, auto: false,
      mask: maskFromStrokes(doc, ZONE_INFO.sway.color, [{ pts: [458, 190, 460, 150, 486, 112], r: 36, soft: 0.5 }]),
      anchor: { x: 456, y: 212 }, tip: { x: 490, y: 108 }, path: [], style: 'bend', ...SWAY_FEELS.Bouncy,
    },
  ];
  return {
    version: 1, name: 'Mio (flattened sample)', width: W, height: H, layers: [layer], zones,
    expressions: defaultExpressions(), motion: defaultMotion(), stage: { background: 'transparent' },
  };
}
