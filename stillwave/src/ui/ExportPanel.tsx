import { useState } from 'react';
import { runExport, webmMime, type ExportFormat } from '../io/export';
import { fileSafe, saveBlob } from '../io/project';
import { useStore } from '../state/store';
import { Icon, pct, secs, Section, Slider, Toggle } from './controls';
import { live } from './live';

const FORMATS: { id: ExportFormat; name: string; blurb: string }[] = [
  { id: 'gif', name: 'Animated GIF', blurb: 'A looping clip that plays anywhere. 256 colours, hard-edged transparency.' },
  { id: 'webm', name: 'WebM video', blurb: 'Smooth, full-colour video recorded in real time. Keeps transparency in Chromium browsers.' },
  { id: 'png', name: 'PNG frames', blurb: 'A zip of full-quality transparent frames for video editors and game engines.' },
  { id: 'html', name: 'Interactive page', blurb: 'One offline HTML file that plays the animation live and reacts to the pointer.' },
];

/** The Export workspace: what you see on the canvas is what gets rendered. */
export function ExportPanel() {
  const doc = useStore((s) => s.doc);
  const exprId = useStore((s) => s.exprId);
  const edit = useStore((s) => s.edit);
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const voiceOn = useStore((s) => s.voiceOn);
  const [format, setFormat] = useState<ExportFormat>('gif');
  const [scale, setScale] = useState(0.5);
  const [fps, setFps] = useState(24);
  const [seconds, setSeconds] = useState(4);
  const [loop, setLoop] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [extras, setExtras] = useState(false);

  const mood = doc.expressions.find((e) => e.id === exprId) ?? doc.expressions[0];
  const bg = doc.stage.background;
  const clip = format !== 'html';
  const w = Math.round((doc.width * scale) / 2) * 2, h = Math.round((doc.height * scale) / 2) * 2;
  const noWebm = format === 'webm' && !webmMime();
  const swatches = ['transparent', '#ffffff', '#1b2030', '#f4f1ea', '#bcd7ff', '#00ff00'];

  const go = async () => {
    setError('');
    setProgress(0);
    try {
      const out = await runExport(doc, { format, scale, fps, seconds, loop: loop && format !== 'webm', background: bg, exprId: mood?.id ?? null }, setProgress);
      await saveBlob(out.blob, `${fileSafe(doc.name)}${out.ext}`, out.label, out.ext);
      toast(`Exported ${out.label} (${(out.blob.size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err) {
      setError((err as Error).message || 'The export did not finish.');
    } finally {
      setProgress(null);
    }
  };
  const toggleVoice = async (on: boolean) => {
    if (!on) { live.voice.stop(); set({ voiceOn: false }); return; }
    try { await live.voice.start(); set({ voiceOn: true }); }
    catch { toast('The microphone is not available. Check the browser permission for this page.', 'error'); }
  };

  return (
    <>
      <div className="insp-title"><h2>Export</h2></div>
      <p className="note">The canvas shows the finished animation. Pick an expression below it, then choose how to save.</p>
      <Section title="Format">
        <div className="format-list" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <button key={f.id} role="radio" aria-checked={format === f.id} className={`format${format === f.id ? ' is-on' : ''}`} onClick={() => setFormat(f.id)}>
              <strong>{f.name}</strong>
              <small>{f.blurb}</small>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Background">
        <div className="swatches">
          {swatches.map((c) => (
            <button key={c} className={`bg-swatch${bg === c ? ' is-on' : ''}${c === 'transparent' ? ' is-clear' : ''}`} style={c === 'transparent' ? undefined : { background: c }} aria-label={c === 'transparent' ? 'Transparent background' : `Background ${c}`} title={c === 'transparent' ? 'Transparent' : c} onClick={() => edit((d) => { d.stage.background = c; })} />
          ))}
          <label className="bg-swatch bg-pick" title="Pick a colour">
            <input type="color" value={bg === 'transparent' ? '#808080' : bg} onChange={(e) => edit((d) => { d.stage.background = e.target.value; }, 'stage.bg')} />
          </label>
        </div>
      </Section>
      {clip && (
        <Section title="Clip">
          <Slider label="Size" value={scale} min={0.1} max={1} step={0.05} format={() => `${w} × ${h}`} onChange={setScale} />
          <Slider label="Length" value={seconds} min={1} max={12} step={0.5} format={secs} onChange={setSeconds} />
          <Slider label="Frames per second" value={fps} min={10} max={format === 'gif' ? 30 : 60} step={1} format={(v) => `${v}`} onChange={setFps} />
          {format !== 'webm' && <Toggle label="Seamless loop" value={loop} onChange={setLoop} hint="Fits breathing, blinks and sway into the clip length so the end meets the start" />}
          <p className="note">{Math.round(seconds * fps)} frames of “{mood?.name}” with all motion running.</p>
        </Section>
      )}
      {!clip && <p className="note">The page carries every expression (keys 1 to 9), blinking, sway and pointer tracking, and works offline or as a browser source in streaming software.</p>}
      {noWebm && <p className="note error">This browser cannot record WebM. Try GIF or PNG frames.</p>}
      {error && <p className="note error">{error}</p>}
      {progress !== null ? (
        <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ transform: `scaleX(${progress})` }} />
          <span>{format === 'webm' ? 'Recording' : 'Rendering'} {pct(progress)}</span>
        </div>
      ) : (
        <button className="btn btn-primary btn-wide" disabled={noWebm} onClick={go}><Icon name="export" size={15} /> Export {FORMATS.find((f) => f.id === format)!.name}</button>
      )}
      <Section title="Live preview extras" aside={<button className="link" onClick={() => setExtras(!extras)}>{extras ? 'Hide' : 'Show'}</button>}>
        {extras && (
          <>
            <p className="note">These only affect the live canvas and the interactive page, never a rendered clip.</p>
            <Toggle label="Look toward the pointer" value={doc.motion.look.follow} onChange={(v) => edit((d) => { d.motion.look.follow = v; })} />
            <Toggle label="Mouth follows the microphone" value={voiceOn} onChange={toggleVoice} />
            {voiceOn && <Slider label="Microphone sensitivity" value={doc.motion.voice.gain} min={0.3} max={3} reset={1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => edit((d) => { d.motion.voice.gain = v; }, 'voice.gain')} />}
          </>
        )}
      </Section>
    </>
  );
}
