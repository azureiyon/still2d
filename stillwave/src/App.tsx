import { useEffect, useState } from 'react';
import { importFiles } from './io/import';
import { saveProject, writeSession } from './io/project';
import { useStore } from './state/store';
import { deleteZone } from './state/actions';
import { isPaintZone } from './engine/types';
import { MoodDock, ToolPill } from './ui/Dock';
import { Inspector } from './ui/Inspector';
import { LeftPanel } from './ui/LeftPanel';
import { Stage } from './ui/Stage';
import { TopBar } from './ui/TopBar';
import { Welcome } from './ui/Welcome';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const typing = (e.target as HTMLElement).closest('input, textarea, [contenteditable]');
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && k === 's') { e.preventDefault(); void saveProject(); return; }
      if (mod && k === 'e') { e.preventDefault(); s.setMode('stage'); return; }
      if (typing || mod || !s.doc.layers.length) return;
      if (k === 'tab') { e.preventDefault(); s.set({ panels: !s.panels }); return; }
      if (k === 'f') { s.set({ viewNonce: s.viewNonce + 1 }); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && s.mode !== 'artwork' && s.doc.expressions[n - 1]) { s.set({ exprId: s.doc.expressions[n - 1].id }); return; }
      if (s.mode === 'stage') return;
      const zone = s.mode === 'motion' ? s.doc.zones.find((z) => z.id === s.zoneId) : undefined;
      const onMask = !!zone && isPaintZone(zone) && !zone.whole;
      const onEye = zone?.type === 'eye';
      const onLayer = s.mode === 'artwork' && !!s.layerId;
      const paintable = onMask || onEye || onLayer;
      if (k === 'v') s.set({ tool: 'move' });
      if (k === 'b' && paintable) s.set({ tool: 'brush', playing: false });
      if (k === 'e' && paintable) s.set({ tool: 'erase', playing: false });
      if (k === 'c' && (onLayer || (onEye && s.eyeLayer === 'skin'))) s.set({ tool: 'clone', playing: false });
      if (k === '[') s.set({ brush: { ...s.brush, size: Math.max(2, s.brush.size * 0.85) } });
      if (k === ']') s.set({ brush: { ...s.brush, size: s.brush.size * 1.18 } });
      if ((k === 'delete' || k === 'backspace') && zone && !s.playing) deleteZone(zone.id);
      if (k === 'escape') s.set(s.tool !== 'move' ? { tool: 'move' } : { zoneId: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useAutosave() {
  useEffect(() => {
    let timer = 0;
    const unsub = useStore.subscribe((s, prev) => {
      if (s.doc === prev.doc) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => { writeSession(useStore.getState().doc).catch(() => {}); }, 1200);
    });
    const warn = (e: BeforeUnloadEvent) => { if (useStore.getState().dirty && !navigator.webdriver) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { unsub(); clearTimeout(timer); window.removeEventListener('beforeunload', warn); };
  }, []);
}

export function App() {
  const empty = useStore((s) => s.doc.layers.length === 0);
  const panels = useStore((s) => s.panels);
  const mode = useStore((s) => s.mode);
  const toasts = useStore((s) => s.toasts);
  const [dropping, setDropping] = useState(false);
  useShortcuts();
  useAutosave();

  return (
    <div
      className={`app mode-${mode}${panels ? '' : ' no-panels'}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
      onDrop={(e) => { e.preventDefault(); setDropping(false); void importFiles(Array.from(e.dataTransfer.files)); }}
    >
      <Stage />
      {empty ? (
        <Welcome />
      ) : (
        <>
          <TopBar />
          {panels && <LeftPanel />}
          {panels && <Inspector />}
          <ToolPill />
          <MoodDock />
        </>
      )}
      {dropping && <div className="drop-veil"><span>Drop to add artwork</span></div>}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}
      </div>
    </div>
  );
}
