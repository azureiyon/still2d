import { ARTWORK_TYPES, importFiles, pickFiles } from '../io/import';
import { saveProject } from '../io/project';
import { useStore, type Mode } from '../state/store';
import { Icon, IconButton } from './controls';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'artwork', label: 'Artwork', hint: 'Arrange your drawing' },
  { id: 'motion', label: 'Motion', hint: 'Paint what moves' },
  { id: 'stage', label: 'Stage', hint: 'Perform and export' },
];

export function TopBar() {
  const name = useStore((s) => s.doc.name);
  const mode = useStore((s) => s.mode);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const dirty = useStore((s) => s.dirty);
  const wire = useStore((s) => s.wire);
  const panels = useStore((s) => s.panels);
  const { undo, redo, edit, set, setMode } = useStore.getState();
  return (
    <header className="topbar">
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--accent)" /><path d="M6 19c3.500 0 3.500-6 7-6s3.500 6 7 6 3.500-6 6-6" fill="none" stroke="var(--desk)" strokeWidth="3" strokeLinecap="round" /></svg>
        <span className="wordmark">Stillwave</span>
        <input className="doc-name" value={name} aria-label="Project name" spellCheck={false} onChange={(e) => edit((d) => { d.name = e.target.value; }, 'doc.name')} />
        {dirty && <span className="dirty" title="Unsaved changes" />}
      </div>

      <nav className="seg modes" aria-label="Workspace">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? 'is-on' : ''} aria-current={mode === m.id} title={m.hint} onClick={() => setMode(m.id)}>{m.label}</button>
        ))}
      </nav>

      <div className="top-actions">
        <IconButton icon="undo" label="Undo" hint="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo" label="Redo" hint="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} />
        <span className="divider" />
        <IconButton icon="fit" label="Fit artwork to view" hint="Fit to view (F)" onClick={() => set({ viewNonce: useStore.getState().viewNonce + 1 })} />
        {mode === 'motion' && <IconButton icon="mesh" label="Show the bending mesh" active={wire} onClick={() => set({ wire: !wire })} />}
        <IconButton icon="panels" label="Show or hide panels" hint="Panels (Tab)" active={panels} onClick={() => set({ panels: !panels })} />
        <span className="divider" />
        <button className="btn" onClick={async () => importFiles(await pickFiles(`.stillwave,${ARTWORK_TYPES}`))}><Icon name="open" size={15} /> Open</button>
        <button className="btn" onClick={() => saveProject()} title="Save project (Ctrl+S)"><Icon name="save" size={15} /> Save</button>
        <button className="btn btn-primary" onClick={() => set({ exportOpen: true })}><Icon name="export" size={15} /> Export</button>
      </div>
    </header>
  );
}
