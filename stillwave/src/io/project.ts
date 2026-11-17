import { packProject, unpackProject, type ProjectFile } from '../engine/assets';
import type { Doc } from '../engine/types';
import { useStore } from '../state/store';

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const fileSafe = (name: string) => name.replace(/[^\w\- ()]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'avatar';

type Picker = (opts: unknown) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;

/** Save a blob, with a native "Save as" dialog where the browser has one. */
export async function saveBlob(blob: Blob, name: string, description: string, ext: string) {
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (picker && !navigator.webdriver) {
    try {
      const handle = await picker({ suggestedName: name, types: [{ description, accept: { [blob.type || 'application/octet-stream']: [ext] } }] });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return false;
    }
  }
  download(blob, name);
  return true;
}

export async function saveProject() {
  const s = useStore.getState();
  const blob = new Blob([JSON.stringify(packProject(s.doc))], { type: 'application/json' });
  if (await saveBlob(blob, `${fileSafe(s.doc.name)}.stillwave`, 'Stillwave project', '.stillwave')) {
    s.set({ dirty: false });
    s.toast('Project saved');
  }
}

export async function openProjectText(text: string) {
  let file: ProjectFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('That file is not a readable Stillwave project.');
  }
  const doc = await unpackProject(file);
  useStore.getState().load(doc);
}

// ---- autosave: the last session is kept in IndexedDB so a refresh loses nothing

const DB = 'stillwave';
const STORE = 'session';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function writeSession(doc: Doc) {
  if (!doc.layers.length) return;
  const db = await idb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({ file: packProject(doc), at: Date.now() }, 'last');
  await new Promise((r) => (tx.oncomplete = r));
  db.close();
}

export async function readSession(): Promise<{ file: ProjectFile; at: number } | null> {
  try {
    const db = await idb();
    const req = db.transaction(STORE).objectStore(STORE).get('last');
    const out = await new Promise<{ file: ProjectFile; at: number } | null>((resolve) => {
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return out;
  } catch {
    return null;
  }
}
