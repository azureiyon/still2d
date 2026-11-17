// Pixel data registries. Images are the artwork; masks are the painted
// "this part moves" washes. Both are immutable once registered: an edit makes
// a new id, which is what lets undo/redo work by swapping ids in the document.
import { normalizeDoc, uid, type Doc, type Layer, type Zone } from './types';

export interface ImageAsset {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  version: number; // bumped while a brush stroke is live, so the renderer re-uploads
}

export interface MaskAsset {
  canvas: HTMLCanvasElement; // tinted rgba; alpha is the weight
  w: number;
  h: number;
  alpha: Uint8ClampedArray | null;
  bounds: { x0: number; y0: number; x1: number; y1: number } | null | undefined; // in 0..1 units
}

export const images = new Map<string, ImageAsset>();
export const masks = new Map<string, MaskAsset>();

export const MAX_TEXTURE = 4096;
export const MASK_RES = 512;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function registerImage(source: CanvasImageSource, w: number, h: number, id = uid('img')): string {
  const k = Math.min(1, MAX_TEXTURE / Math.max(w, h));
  const canvas = makeCanvas(w * k, h * k);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  images.set(id, { canvas, w: canvas.width, h: canvas.height, version: 0 });
  return id;
}

/** Register a canvas as-is (no copy, no resize). */
export function adoptImage(canvas: HTMLCanvasElement, id = uid('img')): string {
  images.set(id, { canvas, w: canvas.width, h: canvas.height, version: 0 });
  return id;
}

export function maskSize(doc: { width: number; height: number }) {
  const k = Math.min(1, MASK_RES / Math.max(doc.width, doc.height));
  return { w: Math.max(1, Math.round(doc.width * k)), h: Math.max(1, Math.round(doc.height * k)) };
}

export function registerMask(canvas: HTMLCanvasElement, id = uid('mask')): string {
  masks.set(id, { canvas, w: canvas.width, h: canvas.height, alpha: null, bounds: undefined });
  return id;
}

export function maskAlpha(m: MaskAsset): Uint8ClampedArray {
  if (!m.alpha) {
    // read from a throwaway copy: reading pixels would pull the display canvas off the GPU
    const copy = makeCanvas(m.w, m.h);
    const cctx = copy.getContext('2d', { willReadFrequently: true })!;
    cctx.drawImage(m.canvas, 0, 0);
    const data = cctx.getImageData(0, 0, m.w, m.h).data;
    const a = new Uint8ClampedArray(m.w * m.h);
    for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3];
    m.alpha = a;
  }
  return m.alpha;
}

/** Bilinear sample of a mask at normalised artboard coordinates. Returns 0..1. */
export function sampleMask(m: MaskAsset, u: number, v: number): number {
  if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
  const a = maskAlpha(m);
  const fx = u * (m.w - 1);
  const fy = v * (m.h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(m.w - 1, x0 + 1);
  const y1 = Math.min(m.h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const top = a[y0 * m.w + x0] * (1 - tx) + a[y0 * m.w + x1] * tx;
  const bot = a[y1 * m.w + x0] * (1 - tx) + a[y1 * m.w + x1] * tx;
  return (top * (1 - ty) + bot * ty) / 255;
}

export function maskBounds(m: MaskAsset) {
  if (m.bounds === undefined) {
    const a = maskAlpha(m);
    let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        if (a[y * m.w + x] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    m.bounds = x1 < 0 ? null : { x0: x0 / m.w, y0: y0 / m.h, x1: (x1 + 1) / m.w, y1: (y1 + 1) / m.h };
  }
  return m.bounds;
}

export function layerCorners(l: Layer) {
  const c = Math.cos(l.rotation) * l.scale;
  const s = Math.sin(l.rotation) * l.scale;
  const hw = l.w / 2;
  const hh = l.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: l.x + x * c - y * s, y: l.y + x * s + y * c }));
}

/** Artboard-space box a paint zone covers: its paint, or its whole layers. */
export function zoneBounds(doc: Doc, z: Zone): { x0: number; y0: number; x1: number; y1: number } | null {
  if (z.type === 'eye' || z.type === 'mouth') return null;
  if (z.whole) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of doc.layers) {
      if (z.layers !== 'all' && !z.layers.includes(l.id)) continue;
      for (const p of layerCorners(l)) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }
  const m = z.mask ? masks.get(z.mask) : null;
  const b = m ? maskBounds(m) : null;
  return b ? { x0: b.x0 * doc.width, y0: b.y0 * doc.height, x1: b.x1 * doc.width, y1: b.y1 * doc.height } : null;
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

// ---- project (de)serialisation, shared by the editor and the standalone player

export interface ProjectFile {
  format: 'stillwave';
  version: 1;
  doc: Doc;
  images: Record<string, string>;
  masks: Record<string, string>;
}

export function packProject(doc: Doc): ProjectFile {
  const out: ProjectFile = { format: 'stillwave', version: 1, doc, images: {}, masks: {} };
  for (const l of doc.layers) {
    const a = images.get(l.image);
    if (a && !out.images[l.image]) out.images[l.image] = a.canvas.toDataURL('image/png');
    const o = l.original ? images.get(l.original) : null;
    if (o && l.original && !out.images[l.original]) out.images[l.original] = o.canvas.toDataURL('image/png');
  }
  for (const z of doc.zones) {
    if (z.type !== 'eye') continue;
    for (const id of [z.paint, z.ctl]) {
      const a = id ? images.get(id) : null;
      if (a && id) out.images[id] = a.canvas.toDataURL('image/png');
    }
  }
  for (const z of doc.zones) {
    if ('mask' in z && z.mask) {
      const m = masks.get(z.mask);
      if (m) out.masks[z.mask] = m.canvas.toDataURL('image/png');
    }
  }
  return out;
}

export async function unpackProject(file: ProjectFile): Promise<Doc> {
  if (!file || file.format !== 'stillwave' || !file.doc) throw new Error('This is not a Stillwave project file.');
  await Promise.all([
    ...Object.entries(file.images).map(async ([id, url]) => {
      const img = await loadImageElement(url);
      registerImage(img, img.naturalWidth, img.naturalHeight, id);
    }),
    ...Object.entries(file.masks).map(async ([id, url]) => {
      const img = await loadImageElement(url);
      const c = makeCanvas(img.naturalWidth, img.naturalHeight);
      c.getContext('2d')!.drawImage(img, 0, 0);
      registerMask(c, id);
    }),
  ]);
  return normalizeDoc(file.doc);
}

/** Drop pixel data that no document state (current or in undo history) still refers to. */
export function collectGarbage(docs: Doc[]) {
  const liveImages = new Set<string>();
  const liveMasks = new Set<string>();
  for (const d of docs) {
    for (const l of d.layers) {
      liveImages.add(l.image);
      if (l.original) liveImages.add(l.original);
    }
    for (const z of d.zones) {
      if ('mask' in z && z.mask) liveMasks.add(z.mask);
      if (z.type === 'eye') {
        if (z.paint) liveImages.add(z.paint);
        if (z.ctl) liveImages.add(z.ctl);
      }
    }
  }
  for (const id of images.keys()) if (!liveImages.has(id)) images.delete(id);
  for (const id of masks.keys()) if (!liveMasks.has(id)) masks.delete(id);
}
