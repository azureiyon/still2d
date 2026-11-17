import { readPsd, type Layer as PsdLayer } from 'ag-psd';
import { loadImageElement, registerImage } from '../engine/assets';
import { emptyDoc, uid, type Layer } from '../engine/types';
import { useStore } from '../state/store';
import { openProjectText } from './project';

interface Incoming { name: string; source: CanvasImageSource; w: number; h: number; left: number; top: number; opacity: number; visible: boolean }

async function readImage(file: File): Promise<{ items: Incoming[]; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const w = img.naturalWidth, h = img.naturalHeight;
    return { items: [{ name: file.name.replace(/\.[^.]+$/, ''), source: img, w, h, left: 0, top: 0, opacity: 1, visible: true }], w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readPsdFile(file: File): Promise<{ items: Incoming[]; w: number; h: number }> {
  const psd = readPsd(await file.arrayBuffer(), { skipThumbnail: true });
  const items: Incoming[] = [];
  const walk = (layers: PsdLayer[], hidden: boolean, opacity: number, prefix: string) => {
    for (const l of layers) {
      const hide = hidden || !!l.hidden;
      const op = opacity * (l.opacity ?? 1);
      if (l.children) walk(l.children, hide, op, prefix);
      else if (l.canvas && l.canvas.width > 0 && l.canvas.height > 0) {
        items.push({ name: prefix + (l.name || 'Layer'), source: l.canvas, w: l.canvas.width, h: l.canvas.height, left: l.left ?? 0, top: l.top ?? 0, opacity: op, visible: !hide });
      }
    }
  };
  walk(psd.children ?? [], false, 1, '');
  if (!items.length && psd.canvas) {
    items.push({ name: file.name.replace(/\.[^.]+$/, ''), source: psd.canvas, w: psd.width, h: psd.height, left: 0, top: 0, opacity: 1, visible: true });
  }
  if (!items.length) throw new Error('No pixel layers were found in that PSD.');
  return { items, w: psd.width, h: psd.height };
}

/** Bring files into the app: artwork becomes layers, a .stillwave file opens as a project. */
export async function importFiles(files: File[]) {
  const s = useStore.getState();
  for (const file of files) {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.stillwave') || name.endsWith('.json')) {
        await openProjectText(await file.text());
        s.toast(`Opened ${file.name}`);
        continue;
      }
      const isPsd = name.endsWith('.psd');
      if (!isPsd && !file.type.startsWith('image/')) {
        s.toast(`${file.name} is not a PNG, PSD or Stillwave project.`, 'error');
        continue;
      }
      const { items, w, h } = isPsd ? await readPsdFile(file) : await readImage(file);
      const fresh = useStore.getState().doc.layers.length === 0;
      const layers: Layer[] = items.map((it) => ({
        id: uid('layer'), name: it.name, image: registerImage(it.source, it.w, it.h),
        w: it.w, h: it.h, x: it.left + it.w / 2, y: it.top + it.h / 2,
        scale: 1, rotation: 0, opacity: it.opacity, visible: it.visible, depth: 0,
      }));
      if (fresh) {
        const doc = emptyDoc();
        doc.name = file.name.replace(/\.[^.]+$/, '');
        doc.width = w;
        doc.height = h;
        doc.layers = layers;
        useStore.getState().load(doc);
      } else {
        // later imports land centred on the existing artboard
        const d = useStore.getState().doc;
        const dx = (d.width - w) / 2, dy = (d.height - h) / 2;
        useStore.getState().edit((doc) => {
          for (const l of layers) doc.layers.push({ ...l, x: l.x + dx, y: l.y + dy });
        });
        useStore.getState().set({ layerId: layers[layers.length - 1].id, mode: 'artwork', playing: false });
      }
      s.toast(isPsd ? `Imported ${items.length} layer${items.length === 1 ? '' : 's'} from ${file.name}` : `Imported ${file.name}`);
    } catch (err) {
      s.toast((err as Error).message || `Could not import ${file.name}`, 'error');
    }
  }
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export const ARTWORK_TYPES = '.png,.webp,.jpg,.jpeg,.psd,image/png,image/webp,image/jpeg';
