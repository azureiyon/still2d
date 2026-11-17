import { addMood, selectMood } from '../state/actions';
import { isPaintZone } from '../engine/types';
import { useStore } from '../state/store';
import { Icon, IconButton, px, pct, Slider } from './controls';

/** Floating tool strip above the canvas in Motion mode. */
export function ToolPill() {
  const mode = useStore((s) => s.mode);
  const playing = useStore((s) => s.playing);
  const tool = useStore((s) => s.tool);
  const brush = useStore((s) => s.brush);
  const zone = useStore((s) => s.doc.zones.find((z) => z.id === s.zoneId));
  const unit = useStore((s) => Math.max(s.doc.width, s.doc.height));
  const set = useStore((s) => s.set);
  if (mode !== 'motion') return null;
  if (playing) {
    return (
      <div className="pill pill-live" role="status">
        <span className="live-dot" /> Playing. Pause to edit, or just watch.
        <button className="btn btn-small" onClick={() => set({ playing: false })}><Icon name="pause" size={12} fill /> Pause</button>
      </div>
    );
  }
  const canPaint = !!zone && isPaintZone(zone) && !zone.whole;
  return (
    <div className="pill" role="toolbar" aria-label="Tools">
      <IconButton icon="move" label="Select and adjust" hint="Select and adjust (V)" active={tool === 'move'} onClick={() => set({ tool: 'move' })} />
      <IconButton icon="brush" label="Paint motion" hint={canPaint ? 'Paint where it moves (B)' : 'Select a Sway, Head or Breath motion to paint'} active={tool === 'brush'} disabled={!canPaint} onClick={() => set({ tool: 'brush' })} />
      <IconButton icon="erase" label="Erase motion" hint="Erase paint (E)" active={tool === 'erase'} disabled={!canPaint} onClick={() => set({ tool: 'erase' })} />
      {tool !== 'move' && canPaint && (
        <div className="pill-sliders">
          <Slider label="Size" value={brush.size} min={unit * 0.005} max={unit * 0.4} step={1} format={px} onChange={(v) => set({ brush: { ...brush, size: v } })} />
          <Slider label="Softness" value={brush.soft} format={pct} onChange={(v) => set({ brush: { ...brush, soft: v } })} />
        </div>
      )}
    </div>
  );
}

/** Bottom dock: play/pause and the row of moods. */
export function MoodDock() {
  const mode = useStore((s) => s.mode);
  const playing = useStore((s) => s.playing);
  const moods = useStore((s) => s.doc.expressions);
  const exprId = useStore((s) => s.exprId) ?? moods[0]?.id;
  const set = useStore((s) => s.set);
  if (mode === 'artwork') return null;
  return (
    <div className="dock">
      {mode === 'motion' && (
        <button className={`play${playing ? ' is-playing' : ''}`} onClick={() => set({ playing: !playing, hoverZone: null })} aria-label={playing ? 'Pause and edit' : 'Play'} title={playing ? 'Pause and edit (Space)' : 'Play (Space)'}>
          <Icon name={playing ? 'pause' : 'play'} size={20} fill />
        </button>
      )}
      <div className="moods" role="radiogroup" aria-label="Moods">
        {moods.map((m, i) => (
          <button
            key={m.id} role="radio" aria-checked={m.id === exprId} className={`mood${m.id === exprId ? ' is-on' : ''}`}
            onClick={() => { selectMood(m.id); if (mode === 'motion' && !playing) set({ tab: 'mood' }); }}
            onDoubleClick={() => set({ tab: 'mood', mode: 'motion' })}
            title={i < 9 ? `Press ${i + 1}` : undefined}
          >
            {i < 9 && <kbd>{i + 1}</kbd>}
            {m.name || 'Untitled'}
          </button>
        ))}
        {mode === 'motion' && <button className="mood mood-add" onClick={addMood} aria-label="Add a mood from the current pose" title="New mood, copied from this one"><Icon name="plus" size={14} /></button>}
      </div>
    </div>
  );
}
