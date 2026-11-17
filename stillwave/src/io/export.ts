import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { zipSync } from 'fflate';
import { makeCanvas, packProject } from '../engine/assets';
import { cssToRgb, fitView, Renderer } from '../engine/gl';
import { Animator } from '../engine/rig';
import type { Doc } from '../engine/types';
import playerSource from '../generated/player.iife.js?raw';

export type ExportFormat = 'gif' | 'webm' | 'png' | 'html';

export interface ExportOptions {
  format: ExportFormat;
  scale: number; // of the artboard size
  fps: number;
  seconds: number;
  loop: boolean;
  background: string; // 'transparent' or #rrggbb
  exprId: string | null;
}

type Progress = (done: number) => void;
const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

/** An offscreen renderer + animator that steps time by hand. */
function makeSession(doc: Doc, o: ExportOptions) {
  const w = Math.max(2, Math.round((doc.width * o.scale) / 2) * 2);
  const h = Math.max(2, Math.round((doc.height * o.scale) / 2) * 2);
  const glCanvas = makeCanvas(w, h);
  const renderer = new Renderer(glCanvas);
  const anim = new Animator(3);
  anim.exprId = o.exprId;
  if (o.loop) anim.loop = o.seconds;
  anim.settle(doc);
  // run-in: lets springs reach their steady (periodic) state
  const warm = o.loop ? o.seconds * 2 : 1.5;
  for (let t = 0; t < warm - 1e-6; t += 1 / 60) anim.step(1 / 60, doc);
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  const view = fitView(doc, w, h);
  const draw = () => {
    renderer.render(doc, anim.frame, view);
    ctx.clearRect(0, 0, w, h);
    if (o.background !== 'transparent') {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(glCanvas, 0, 0);
  };
  const dispose = () => renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { w, h, anim, out, ctx, draw, dispose };
}

async function exportGif(doc: Doc, o: ExportOptions, progress: Progress): Promise<Blob> {
  const s = makeSession(doc, o);
  const gif = GIFEncoder();
  const frames = Math.round(o.seconds * o.fps);
  const transparent = o.background === 'transparent';
  const matte = [255, 255, 255];
  for (let i = 0; i < frames; i++) {
    s.draw();
    const data = s.ctx.getImageData(0, 0, s.w, s.h).data;
    if (transparent) {
      // GIF has 1-bit alpha: harden the edge, matting soft pixels toward white
      for (let p = 0; p < data.length; p += 4) {
        const a = data[p + 3];
        if (a < 110) { data[p] = data[p + 1] = data[p + 2] = data[p + 3] = 0; }
        else if (a < 255) {
          const k = a / 255;
          data[p] = data[p] * k + matte[0] * (1 - k);
          data[p + 1] = data[p + 1] * k + matte[1] * (1 - k);
          data[p + 2] = data[p + 2] * k + matte[2] * (1 - k);
          data[p + 3] = 255;
        }
      }
    }
    const palette = quantize(data, 256, transparent ? { format: 'rgba4444', oneBitAlpha: true } : {});
    const index = applyPalette(data, palette, transparent ? 'rgba4444' : 'rgb565');
    const ti = transparent ? palette.findIndex((c) => c[3] === 0) : -1;
    gif.writeFrame(index, s.w, s.h, {
      palette, delay: Math.round(1000 / o.fps), transparent: ti >= 0, transparentIndex: Math.max(0, ti), dispose: transparent ? 2 : 1,
    });
    s.anim.step(1 / o.fps, doc);
    progress((i + 1) / frames);
    if (i % 2 === 0) await nextTask();
  }
  gif.finish();
  s.dispose();
  return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
}

async function exportPngZip(doc: Doc, o: ExportOptions, progress: Progress): Promise<Blob> {
  const s = makeSession(doc, o);
  const frames = Math.round(o.seconds * o.fps);
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < frames; i++) {
    s.draw();
    const blob = await new Promise<Blob>((res, rej) => s.out.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode a frame.'))), 'image/png'));
    files[`frame_${String(i + 1).padStart(4, '0')}.png`] = new Uint8Array(await blob.arrayBuffer());
    s.anim.step(1 / o.fps, doc);
    progress((i + 1) / frames);
  }
  s.dispose();
  return new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export function webmMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/** WebM is recorded in real time through the browser's own encoder. */
async function exportWebm(doc: Doc, o: ExportOptions, progress: Progress): Promise<Blob> {
  const mime = webmMime();
  if (!mime) throw new Error('This browser cannot record WebM video.');
  const s = makeSession(doc, o);
  s.draw();
  const stream = s.out.captureStream(o.fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  let bytes = 0;
  rec.ondataavailable = (e) => { if (e.data.size) { chunks.push(e.data); bytes += e.data.size; } };
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(200);
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  let last = performance.now();
  const tick = async () => {
    const now = performance.now();
    s.anim.step((now - last) / 1000, doc);
    last = now;
    s.draw();
    await sleep(Math.max(4, 1000 / o.fps - (performance.now() - now)));
  };
  // Encoders can take a moment to spin up; keep the avatar moving until
  // frames are really being written, then record the requested length.
  const warmStart = performance.now();
  while (bytes < 2000 && performance.now() - warmStart < 5000) await tick();
  const start = performance.now();
  while (performance.now() - start < o.seconds * 1000) {
    await tick();
    progress(Math.min(1, (performance.now() - start) / (o.seconds * 1000)));
  }
  await sleep(120);
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  s.dispose();
  if (bytes < 2000) throw new Error('The browser recorded an empty video. Try again, or use GIF or PNG frames.');
  return new Blob(chunks, { type: 'video/webm' });
}

export function exportHtml(doc: Doc, background: string): Blob {
  const project = JSON.stringify(packProject(doc)).replace(/</g, '\\u003c');
  const bg = background === 'transparent' ? 'transparent' : `rgb(${cssToRgb(background).map((v) => Math.round(v * 255)).join(',')})`;
  const title = doc.name.replace(/[<>&"]/g, '');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<!-- Stillwave avatar. Works offline. Options: ?bg=00ff00  ?mood=2  ?mic=1  ?follow=0. Keys 1-9 switch moods, M toggles the microphone. -->
<style>html,body{margin:0;height:100%;overflow:hidden;background:${bg}}canvas{display:block;width:100vw;height:100vh}</style>
</head><body><canvas id="stillwave"></canvas>
<script id="stillwave-project" type="application/json">${project}</script>
<script>${playerSource.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`;
  return new Blob([html], { type: 'text/html' });
}

export async function runExport(doc: Doc, o: ExportOptions, progress: Progress): Promise<{ blob: Blob; ext: string; label: string }> {
  switch (o.format) {
    case 'gif': return { blob: await exportGif(doc, o, progress), ext: '.gif', label: 'Animated GIF' };
    case 'png': return { blob: await exportPngZip(doc, o, progress), ext: '.zip', label: 'PNG frames' };
    case 'webm': return { blob: await exportWebm(doc, o, progress), ext: '.webm', label: 'WebM video' };
    case 'html': return { blob: exportHtml(doc, o.background), ext: '.html', label: 'Interactive page' };
  }
}
