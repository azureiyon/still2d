// Artwork correction: a brush engine that can paint, erase and clone onto any
// canvas (a layer, or an eye's lid-skin and mark canvases), a fill that guesses
// what was hidden, and "lift", which moves a painted region onto its own layer.
// Nothing here edits pixels in place: every result is a new canvas, so the
// document only ever swaps image ids and undo stays trivial.
import { adoptImage, images, makeCanvas, masks } from './assets';
import { uid, type Doc, type Layer, type Vec, type Zone } from './types';

/** Maps artboard coordinates to a canvas's own pixels. */
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }

export function layerAffine(l: Layer): Affine {
  const img = images.get(l.image);
  const kx = (img?.w ?? l.w) / l.w, ky = (img?.h ?? l.h) / l.h;
  const c = Math.cos(-l.rotation) / l.scale, s = Math.sin(-l.rotation) / l.scale;
  // local = R(-rot)/scale * (doc - pos) + size/2, then to image pixels
  return {
    a: c * kx, b: s * ky, c: -s * kx, d: c * ky,
    e: (-c * l.x + s * l.y + l.w / 2) * kx,
    f: (-s * l.x - c * l.y + l.h / 2) * ky,
  };
}

export function boxAffine(box: { x: number; y: number; w: number; h: number }, size: number): Affine {
  return { a: size / box.w, b: 0, c: 0, d: size / box.h, e: (-box.x * size) / box.w, f: (-box.y * size) / box.h };
}

const apply = (m: Affine, p: Vec): Vec => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });

/** Every visible layer drawn flat, at rest, in artboard space. Clone and eyedropper read from this. */
export function compositeRest(doc: Doc, maxSide = 2048): { canvas: HTMLCanvasElement; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(doc.width, doc.height));
  const canvas = makeCanvas(doc.width * scale, doc.height * scale);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  for (const l of doc.layers) {
    const img = images.get(l.image);
    if (!l.visible || !img) continue;
    g.save();
    g.globalAlpha = l.opacity;
    g.scale(scale, scale);
    g.translate(l.x, l.y);
    g.rotate(l.rotation);
    g.scale(l.scale, l.scale);
    g.drawImage(img.canvas, -l.w / 2, -l.h / 2, l.w, l.h);
    g.restore();
  }
  return { canvas, scale };
}

export function pickColor(doc: Doc, p: Vec): string | null {
  const { canvas, scale } = compositeRest(doc, 1024);
  const x = Math.floor(p.x * scale), y = Math.floor(p.y * scale);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  const d = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
  if (d[3] < 8) return null;
  return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export type StrokeTool = 'brush' | 'erase' | 'clone';
export type PaintMode = 'normal' | 'behind' | 'inside';

export interface StrokeOptions {
  tool: StrokeTool;
  color: string;
  size: number; // diameter, artboard px
  soft: number;
  opacity: number;
  mode: PaintMode;
  /** Clone only: artboard-space picture to copy from, and where its sample point is relative to the brush. */
  source?: { canvas: HTMLCanvasElement; scale: number };
  offset?: Vec;
}

/** One brush stroke in progress. `work` always holds base + stroke so far. */
export class Stroke {
  work: HTMLCanvasElement;
  private ink: HTMLCanvasElement;
  private last: Vec | null = null;
  private tmp: HTMLCanvasElement | null = null;

  constructor(private base: HTMLCanvasElement, private m: Affine, private o: StrokeOptions) {
    this.work = makeCanvas(base.width, base.height);
    this.ink = makeCanvas(base.width, base.height);
    this.work.getContext('2d')!.drawImage(base, 0, 0);
  }

  private stamp(p: Vec) {
    const { m, o } = this;
    const c = apply(m, p);
    const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)); // artboard px -> canvas px
    const r = Math.max(0.6, (o.size / 2) * k);
    const core = Math.max(0, Math.min(0.97, 1 - o.soft));
    const g = this.ink.getContext('2d')!;
    const fade = (ctx: CanvasRenderingContext2D, x: number, y: number, rgb: string) => {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgb + 'ff');
      grad.addColorStop(core, rgb + 'ff');
      grad.addColorStop(core + (1 - core) * 0.5, rgb + '66');
      grad.addColorStop(1, rgb + '00');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (o.tool === 'clone' && o.source && o.offset) {
      const size = Math.ceil(r * 2 + 2);
      if (!this.tmp || this.tmp.width !== size) this.tmp = makeCanvas(size, size);
      const t = this.tmp.getContext('2d')!;
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, size, size);
      // draw the source so that (p + offset) lands on the middle of the stamp
      const from = { x: p.x + o.offset.x, y: p.y + o.offset.y };
      const fc = apply(m, from);
      t.setTransform(m.a, m.b, m.c, m.d, m.e - fc.x + size / 2, m.f - fc.y + size / 2);
      t.drawImage(o.source.canvas, 0, 0, o.source.canvas.width / o.source.scale, o.source.canvas.height / o.source.scale);
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.globalCompositeOperation = 'destination-in';
      fade(t, size / 2, size / 2, '#000000');
      g.drawImage(this.tmp, c.x - size / 2, c.y - size / 2);
    } else {
      fade(g, c.x, c.y, o.tool === 'erase' ? '#000000' : o.color);
    }
  }

  to(p: Vec) {
    const from = this.last ?? p;
    const dist = Math.hypot(p.x - from.x, p.y - from.y);
    const steps = this.last ? Math.max(1, Math.ceil(dist / Math.max(0.75, this.o.size * 0.14))) : 1;
    for (let i = 1; i <= steps; i++) this.stamp({ x: from.x + ((p.x - from.x) * i) / steps, y: from.y + ((p.y - from.y) * i) / steps });
    this.last = p;
    const w = this.work.getContext('2d')!;
    w.globalCompositeOperation = 'copy';
    w.globalAlpha = 1;
    w.drawImage(this.base, 0, 0);
    w.globalAlpha = this.o.opacity;
    w.globalCompositeOperation = this.o.tool === 'erase' ? 'destination-out' : this.o.mode === 'behind' ? 'destination-over' : this.o.mode === 'inside' ? 'source-atop' : 'source-over';
    w.drawImage(this.ink, 0, 0);
    w.globalAlpha = 1;
    w.globalCompositeOperation = 'source-over';
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Guess hidden pixels from their surroundings (pull-push). `known` is 0..1 per
 * pixel; colour and alpha spread inward from known pixels, so a hole in a face
 * fills with skin and a hole next to nothing fills with nothing.
 */
export function inpaint(rgba: Uint8ClampedArray, w: number, h: number, known: Float32Array): Uint8ClampedArray {
  type Level = { w: number; h: number; c: Float32Array; k: Float32Array };
  const base: Level = { w, h, c: new Float32Array(w * h * 4), k: known };
  for (let i = 0; i < w * h; i++) {
    const a = (rgba[i * 4 + 3] / 255) * known[i];
    base.c[i * 4] = rgba[i * 4] * a; base.c[i * 4 + 1] = rgba[i * 4 + 1] * a; base.c[i * 4 + 2] = rgba[i * 4 + 2] * a; base.c[i * 4 + 3] = a * 255;
  }
  const levels = [base];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const s = levels[levels.length - 1];
    const dw = Math.max(1, Math.ceil(s.w / 2)), dh = Math.max(1, Math.ceil(s.h / 2));
    const d: Level = { w: dw, h: dh, c: new Float32Array(dw * dh * 4), k: new Float32Array(dw * dh) };
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      let k = 0; const acc = [0, 0, 0, 0];
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const sx = Math.min(s.w - 1, x * 2 + i), sy = Math.min(s.h - 1, y * 2 + j), si = sy * s.w + sx;
        k += s.k[si];
        for (let ch = 0; ch < 4; ch++) acc[ch] += s.c[si * 4 + ch];
      }
      const di = y * dw + x;
      d.k[di] = Math.min(1, k);
      const n = k > 1 ? 1 / k : 1; // keep weighted sums until a cell is fully known
      for (let ch = 0; ch < 4; ch++) d.c[di * 4 + ch] = acc[ch] * n;
    }
    levels.push(d);
  }
  for (let li = levels.length - 2; li >= 0; li--) {
    const s = levels[li], u = levels[li + 1];
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const i = y * s.w + x;
      const miss = 1 - s.k[i];
      if (miss <= 0.001) continue;
      // bilinear sample of the coarser level
      const fx = Math.min(u.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), fy = Math.min(u.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(u.w - 1, x0 + 1), y1 = Math.min(u.h - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      for (let ch = 0; ch < 4; ch++) {
        const norm = (ui: number) => (u.k[ui] > 0.001 ? u.c[ui * 4 + ch] / u.k[ui] : 0);
        const v = (norm(y0 * u.w + x0) * (1 - tx) + norm(y0 * u.w + x1) * tx) * (1 - ty) + (norm(y1 * u.w + x0) * (1 - tx) + norm(y1 * u.w + x1) * tx) * ty;
        s.c[i * 4 + ch] += v * miss;
      }
      s.k[i] = 1;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = base.c[i * 4 + 3] / 255;
    if (a > 0.002) { out[i * 4] = base.c[i * 4] / a; out[i * 4 + 1] = base.c[i * 4 + 1] / a; out[i * 4 + 2] = base.c[i * 4 + 2] / a; }
    out[i * 4 + 3] = base.c[i * 4 + 3];
  }
  return out;
}

/** A transparent layer covering the artboard, for painting repairs on. */
export function newRepairLayer(doc: Doc, name = 'Repair'): Layer {
  const k = Math.min(1, 2048 / Math.max(doc.width, doc.height));
  const c = makeCanvas(doc.width * k, doc.height * k);
  return {
    id: uid('layer'), name, image: adoptImage(c), w: doc.width, h: doc.height, x: doc.width / 2, y: doc.height / 2,
    scale: 1, rotation: 0, opacity: 1, visible: true, depth: 0, role: 'repair',
  };
}

export interface LiftResult { cut: string; backing: Layer; patch: Layer; source: string }

/**
 * Lift a painted region onto its own layer. The source keeps a hole where the
 * region was, a "backing" layer fills that hole with a guess at what was
 * behind, and the lifted patch sits on top. At rest the three together look
 * like the original; in motion the patch no longer drags its neighbours.
 */
export function liftRegion(doc: Doc, zone: Zone): LiftResult | string {
  if (!('mask' in zone) || !zone.mask) return 'Paint the region first.';
  const mask = masks.get(zone.mask);
  if (!mask) return 'Paint the region first.';
  // the front-most visible layer the region touches
  let source: Layer | null = null;
  let matte: Float32Array | null = null;
  let srcData: ImageData | null = null;
  for (let i = doc.layers.length - 1; i >= 0 && !source; i--) {
    const l = doc.layers[i];
    const img = images.get(l.image);
    if (!l.visible || !img || (zone.layers !== 'all' && !zone.layers.includes(l.id))) continue;
    const m = layerAffine(l);
    const mc = makeCanvas(img.w, img.h);
    const g = mc.getContext('2d', { willReadFrequently: true })!;
    g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    g.imageSmoothingQuality = 'high';
    g.drawImage(mask.canvas, 0, 0, doc.width, doc.height);
    const md = g.getImageData(0, 0, img.w, img.h).data;
    const sc = makeCanvas(img.w, img.h);
    const sg = sc.getContext('2d', { willReadFrequently: true })!;
    sg.drawImage(img.canvas, 0, 0);
    const sd = sg.getImageData(0, 0, img.w, img.h);
    let area = 0, hit = 0;
    const a = new Float32Array(img.w * img.h);
    for (let p = 0; p < a.length; p++) {
      a[p] = md[p * 4 + 3] / 255;
      if (a[p] > 0.5) { area++; if (sd.data[p * 4 + 3] > 128) hit++; }
    }
    if (area > 0 && hit / area > 0.25) { source = l; matte = a; srcData = sd; }
  }
  if (!source || !matte || !srcData) return 'There is no artwork under this region to lift.';
  const W = srcData.width, H = srcData.height;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (matte[y * W + x] > 0.02) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return 'Paint the region first.';
  const pad = 24;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;

  const crop = new Uint8ClampedArray(w * h * 4);
  const known = new Float32Array(w * h);
  const patch = new ImageData(w, h);
  const cut = new ImageData(new Uint8ClampedArray(srcData.data), W, H);
  const hole = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = (y + y0) * W + (x + x0), di = y * w + x;
    const m = matte[si];
    for (let ch = 0; ch < 4; ch++) crop[di * 4 + ch] = srcData.data[si * 4 + ch];
    // The cut follows the middle of the brush falloff with a one-pixel soft edge.
    // Patch and hole use the same matte, so at rest the pieces add back up to the
    // original: the guessed backing only ever shows where the patch has moved away.
    const edge = smooth(0.44, 0.56, m);
    known[di] = 1 - smooth(0.3, 0.44, m);
    patch.data[di * 4] = crop[di * 4]; patch.data[di * 4 + 1] = crop[di * 4 + 1]; patch.data[di * 4 + 2] = crop[di * 4 + 2];
    patch.data[di * 4 + 3] = crop[di * 4 + 3] * edge;
    hole[di] = edge;
    cut.data[si * 4 + 3] = srcData.data[si * 4 + 3] * (1 - edge);
  }
  const filled = inpaint(crop, w, h, known);
  const backing = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    backing.data[i * 4] = filled[i * 4]; backing.data[i * 4 + 1] = filled[i * 4 + 1]; backing.data[i * 4 + 2] = filled[i * 4 + 2];
    // only fill where the original had paint: empty background stays empty
    backing.data[i * 4 + 3] = filled[i * 4 + 3] * hole[i] * (crop[i * 4 + 3] / 255);
  }
  const toCanvas = (d: ImageData) => { const c = makeCanvas(d.width, d.height); c.getContext('2d')!.putImageData(d, 0, 0); return c; };
  // place the crops where they came from, following the source layer's own transform
  const kx = source.w / W, ky = source.h / H;
  const lx = ((x0 + w / 2) * kx - source.w / 2) * source.scale, ly = ((y0 + h / 2) * ky - source.h / 2) * source.scale;
  const cr = Math.cos(source.rotation), sr = Math.sin(source.rotation);
  const place = { x: source.x + lx * cr - ly * sr, y: source.y + lx * sr + ly * cr, w: w * kx, h: h * ky, scale: source.scale, rotation: source.rotation };
  const mk = (name: string, c: HTMLCanvasElement, role: Layer['role'], depth: number): Layer => ({
    id: uid('layer'), name, image: adoptImage(c), ...place, opacity: 1, visible: true, depth, role,
  });
  return {
    source: source.id,
    cut: adoptImage(toCanvas(cut)),
    backing: mk(`${zone.name} backing`, toCanvas(backing), 'backing', source.depth),
    patch: mk(`${zone.name} (lifted)`, toCanvas(patch), 'lifted', source.depth),
  };
}
