import { useEffect } from 'react';
import { newCanvas } from '../state/actions';
import { useStore } from '../state/store';
import { Icon } from './controls';

/** "Start a new animation?" Offers to save first; the discarded work stays recoverable. */
export function NewDialog() {
  const open = useStore((s) => s.newOpen);
  const dirty = useStore((s) => s.dirty);
  const name = useStore((s) => s.doc.name);
  const set = useStore((s) => s.set);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') set({ newOpen: false }); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, set]);
  if (!open) return null;
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && set({ newOpen: false })}>
      <div className="dialog dialog-small" role="alertdialog" aria-modal="true" aria-labelledby="new-title" aria-describedby="new-body">
        <header className="dialog-head">
          <h2 id="new-title">Start a new animation?</h2>
          <button className="icon-btn" aria-label="Close" onClick={() => set({ newOpen: false })}><Icon name="close" /></button>
        </header>
        <p id="new-body" className="note">
          {dirty ? `“${name}” has changes that aren't saved to a file.` : `“${name}” will close.`} If you discard it, you can still get it back from the start screen with <strong>Pick up where you left off</strong>, until you start working on something else.
        </p>
        <footer className="dialog-foot">
          <button className="btn" onClick={() => set({ newOpen: false })}>Cancel</button>
          <button className="btn" onClick={() => newCanvas(false)}>Discard and start new</button>
          <button className="btn btn-primary" onClick={() => newCanvas(true)} autoFocus><Icon name="save" size={15} /> Save, then start new</button>
        </footer>
      </div>
    </div>
  );
}
