import { useEffect, useState } from 'react';
import { runExport, webmMime, type ExportFormat } from '../io/export';
import { fileSafe, saveBlob } from '../io/project';
import { useStore } from '../state/store';
import { Icon, pct, secs, Slider, Toggle } from './controls';

const FORMATS: { id: ExportFormat; name: string; blurb: string }[] = [
  { id: 'html', name: 'Avatar page', blurb: 'One HTML file that runs the live avatar anywhere, offline. Add it to OBS as a browser source for a transparent, reactive avatar.' },
  { id: 'gif', name: 'Animated GIF', blurb: 'A looping clip for chat, profiles and stickers. 256 colours, hard-edged transparency.' },
  { id: 'webm', name: 'WebM video', blurb: 'Smooth video, recorded in real time by your browser. Transparency is kept in Chromium browsers.' },
  { id: 'png', name: 'PNG frames', blurb: 'A zip of full-quality transparent frames for video editors and game engines.' },
];

export function ExportDialog() {
  const open = useStore((s) => s.exportOpen);
  const doc = useStore((s) => s.doc);
  const exprId = useStore((s) => s.exprId);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const [format, setFormat] = useState<ExportFormat>('html');
  const [scale, setScale] = useState(0.5);
  const [fps, setFps] = useState(24);
  const [seconds, setSeconds] = useState(4);
  const [loop, setLoop] = useState(true);
  const [clear, setClear] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && progress === null && set({ exportOpen: false });
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, progress, set]);
  if (!open) return null;

  const mood = doc.expressions.find((e) => e.id === exprId) ?? doc.expressions[0];
  const bg = clear ? 'transparent' : doc.stage.background === 'transparent' ? '#ffffff' : doc.stage.background;
  const clip = format !== 'html';
  const w = Math.round((doc.width * scale) / 2) * 2, h = Math.round((doc.height * scale) / 2) * 2;
  const noWebm = format === 'webm' && !webmMime();

  const go = async () => {
    setError('');
    setProgress(0);
    try {
      const out = await runExport(doc, { format, scale, fps, seconds, loop: loop && format !== 'webm', background: bg, exprId: mood?.id ?? null }, setProgress);
      await saveBlob(out.blob, `${fileSafe(doc.name)}${out.ext}`, out.label, out.ext);
      toast(`Exported ${out.label} (${(out.blob.size / 1024 / 1024).toFixed(1)} MB)`);
      set({ exportOpen: false });
    } catch (err) {
      setError((err as Error).message || 'The export did not finish.');
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && progress === null && set({ exportOpen: false })}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <header className="dialog-head">
          <h2 id="export-title">Export avatar</h2>
          <button className="icon-btn" aria-label="Close" onClick={() => progress === null && set({ exportOpen: false })}><Icon name="close" /></button>
        </header>
        <div className="format-grid" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <button key={f.id} role="radio" aria-checked={format === f.id} className={`format${format === f.id ? ' is-on' : ''}`} onClick={() => setFormat(f.id)}>
              <strong>{f.name}</strong>
              <small>{f.blurb}</small>
            </button>
          ))}
        </div>
        <div className="dialog-opts">
          {clip ? (
            <>
              <Slider label="Size" value={scale} min={0.1} max={1} step={0.05} format={() => `${w} × ${h}`} onChange={setScale} />
              <Slider label="Length" value={seconds} min={1} max={12} step={0.5} format={secs} onChange={setSeconds} />
              <Slider label="Frames per second" value={fps} min={10} max={format === 'gif' ? 30 : 60} step={1} format={(v) => `${v}`} onChange={setFps} />
              {format !== 'webm' && <Toggle label="Seamless loop" value={loop} onChange={setLoop} hint="Fits breathing, blinks and sway into the clip length so the end meets the start" />}
              <Toggle label="Transparent background" value={clear} onChange={setClear} />
              <p className="note">Plays the mood “{mood?.name}” with idle motion. {Math.round(seconds * fps)} frames.{!clear && ' Uses the Stage backdrop colour.'}</p>
            </>
          ) : (
            <>
              <Toggle label="Transparent background" value={clear} onChange={setClear} />
              <p className="note">The page includes every mood, blinking, sway, pointer tracking and optional microphone lip movement. Keys 1 to 9 switch moods. Add <code>?mic=1</code> to the address to start with the microphone on.</p>
            </>
          )}
          {noWebm && <p className="note error">This browser cannot record WebM. Try GIF or PNG frames.</p>}
          {error && <p className="note error">{error}</p>}
        </div>
        <footer className="dialog-foot">
          {progress !== null ? (
            <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ transform: `scaleX(${progress})` }} />
              <span>{format === 'webm' ? 'Recording' : 'Rendering'} {pct(progress)}</span>
            </div>
          ) : (
            <>
              <button className="btn" onClick={() => set({ exportOpen: false })}>Cancel</button>
              <button className="btn btn-primary" disabled={noWebm} onClick={go}><Icon name="export" size={15} /> Export {FORMATS.find((f) => f.id === format)!.name}</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
