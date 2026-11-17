import { create } from 'zustand';
import { produce } from 'immer';
import { emptyDoc, type Doc, type Zone } from '../engine/types';

export type Mode = 'artwork' | 'motion' | 'stage';
export type Tool = 'move' | 'brush' | 'erase';
export type InspectorTab = 'motion' | 'rhythm' | 'mood';

interface HistoryEntry { doc: Doc; key?: string; at: number }

export interface Toast { id: number; text: string; tone: 'info' | 'error' }

interface State {
  doc: Doc;
  past: HistoryEntry[];
  future: Doc[];
  dirty: boolean;

  mode: Mode;
  playing: boolean;
  tool: Tool;
  brush: { size: number; soft: number };
  layerId: string | null;
  zoneId: string | null;
  exprId: string | null;
  tab: InspectorTab;
  panels: boolean;
  wire: boolean;
  hoverZone: string | null;
  exportOpen: boolean;
  voiceOn: boolean;
  toasts: Toast[];
  viewNonce: number; // bump to ask the stage to re-fit the view

  /** Change the document. Calls sharing a `key` within a short time merge into one undo step. */
  edit: (fn: (d: Doc) => void, key?: string) => void;
  editZone: <Z extends Zone = Zone>(id: string, fn: (z: Z) => void, key?: string) => void;
  undo: () => void;
  redo: () => void;
  load: (doc: Doc) => void;
  set: (patch: Partial<State>) => void;
  setMode: (m: Mode) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  doc: emptyDoc(),
  past: [],
  future: [],
  dirty: false,

  mode: 'artwork',
  playing: false,
  tool: 'move',
  brush: { size: 60, soft: 0.6 },
  layerId: null,
  zoneId: null,
  exprId: null,
  tab: 'rhythm',
  panels: true,
  wire: false,
  hoverZone: null,
  exportOpen: false,
  voiceOn: false,
  toasts: [],
  viewNonce: 0,

  edit: (fn, key) => {
    const { doc, past } = get();
    const next = produce(doc, fn);
    if (next === doc) return;
    const now = performance.now();
    const last = past[past.length - 1];
    const merge = key && last && last.key === key && now - last.at < 900;
    const entry: HistoryEntry = merge ? { ...last, at: now } : { doc, key, at: now };
    set({ doc: next, past: merge ? [...past.slice(0, -1), entry] : [...past.slice(-119), entry], future: [], dirty: true });
  },
  editZone: (id, fn, key) =>
    get().edit((d) => {
      const z = d.zones.find((x) => x.id === id);
      if (z) fn(z as never);
    }, key),
  undo: () => {
    const { past, doc, future } = get();
    const last = past[past.length - 1];
    if (!last) return;
    set({ doc: last.doc, past: past.slice(0, -1), future: [doc, ...future], dirty: true });
  },
  redo: () => {
    const { past, doc, future } = get();
    if (!future.length) return;
    set({ doc: future[0], past: [...past, { doc, at: 0 }], future: future.slice(1), dirty: true });
  },
  load: (doc) =>
    set({
      doc, past: [], future: [], dirty: false,
      layerId: doc.layers[doc.layers.length - 1]?.id ?? null,
      zoneId: null, exprId: doc.expressions[0]?.id ?? null,
      mode: doc.zones.length ? 'motion' : 'artwork', playing: doc.zones.length > 0, tool: 'move',
      tab: 'rhythm', viewNonce: get().viewNonce + 1,
    }),
  set: (patch) => set(patch),
  setMode: (mode) => {
    const s = get();
    set({ mode, playing: mode === 'stage' ? true : mode === 'artwork' ? false : s.playing, tool: 'move' });
  },
  toast: (text, tone = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), tone === 'error' ? 6000 : 3200);
  },
}));

export const getDoc = () => useStore.getState().doc;
