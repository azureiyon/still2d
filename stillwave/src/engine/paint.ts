// The motion brush. Paint goes into a small tinted canvas whose alpha channel
// is the "how much does this pixel move" weight.
import { makeCanvas, maskSize, masks, registerMask } from './assets';

export function stamp(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, soft: number, color: string, erase: boolean) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  const core = Math.max(0, Math.min(0.98, 1 - soft));
  const c = erase ? '#000000' : color;
  g.addColorStop(0, c + 'ff');
  g.addColorStop(core, c + 'ff');
  g.addColorStop(core + (1 - core) * 0.5, c + '66');
  g.addColorStop(1, c + '00');
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function strokeSegment(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number, soft: number, color: string, erase: boolean) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, r * 0.3)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    stamp(ctx, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, soft, color, erase);
  }
}

/** A fresh working copy of a zone's mask (or a blank one) to paint into. */
export function beginMask(doc: { width: number; height: number }, from: string | null) {
  const { w, h } = maskSize(doc);
  const canvas = makeCanvas(w, h);
  const src = from ? masks.get(from) : null;
  if (src) canvas.getContext('2d')!.drawImage(src.canvas, 0, 0, w, h);
  return canvas;
}

/** Paint a list of artboard-space strokes into a new mask. Used by the sample rigs. */
export function maskFromStrokes(doc: { width: number; height: number }, color: string, strokes: { pts: number[]; r: number; soft?: number }[]) {
  const canvas = beginMask(doc, null);
  const ctx = canvas.getContext('2d')!;
  const k = canvas.width / doc.width;
  for (const s of strokes) {
    for (let i = 0; i + 1 < s.pts.length; i += 2) {
      const j = Math.max(0, i - 2);
      strokeSegment(ctx, s.pts[j] * k, s.pts[j + 1] * k, s.pts[i] * k, s.pts[i + 1] * k, s.r * k, s.soft ?? 0.5, color, false);
    }
  }
  return registerMask(canvas);
}
