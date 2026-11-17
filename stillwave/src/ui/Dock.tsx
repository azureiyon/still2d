import { addMood, selectMood } from '../state/actions';
import { isPaintZone } from '../engine/types';
import type { PaintMode } from '../engine/retouch';
import { rememberColor, useStore, type EyeLayer, type Tool } from '../state/store';
import { Icon, IconButton, px, pct, Slider } from './controls';

const EYE_LAYERS: { id: EyeLayer; label: string; hint: string }[] = [
  { id: 'skin', label: 'Lid skin', hint: 'Paint what the closed eyelid looks like. Only shows where the lid has come down.' },
  { id: 'lash', label: 'Lashes', hint: 'Mark lashes that should travel with the lid, beyond the dashed band.' },
  { id: 'keep', label: 'Keep', hint: 'Mark artwork the blink must never touch, such as hair crossing the eye.' },
];
const MODES: { id: PaintMode; label: string; hint: string }[] = [
  { id: 'normal', label: 'Over', hint: 'Paint over what is there' },
  { id: 'behind', label: 'Behind', hint: 'Only fill empty pixels: underpaint without touching the artwork' },
  { id: 'inside', label: 'Inside', hint: 'Only recolour pixels that already exist' },
];

/** Floating tool strip above the canvas. Its contents follow what is selected. */
export function ToolPill() {
  const mode = useStore((s) => s.mode);
  const playing = useStore((s) => s.playing);
  const tool = useStore((s) => s.tool);
  const brush = useStore((s) => s.brush);
  const eyeLayer = useStore((s) => s.eyeLayer);
  const cloneFrom = useStore((s) => s.cloneFrom);
  const zone = useStore((s) => s.doc.zones.find((z) => z.id === s.zoneId));
  const layer = useStore((s) => s.doc.layers.find((l) => l.id === s.layerId));
  const unit = useStore((s) => Math.max(s.doc.width, s.doc.height));
  const lid = useStore((s) => (s.zoneId ? s.lidHold[s.zoneId] ?? 0 : 0));
  const set = useStore((s) => s.set);
  const recent = useStore((s) => s.recent);
  if (mode === 'stage') return null;
  if (mode === 'motion' && playing) {
    return (
      <div className="pill pill-live" role="status">
        <span className="live-dot" /> Playing. Pause to edit, or just watch.
        <button className="btn btn-small" onClick={() => set({ playing: false })}><Icon name="pause" size={12} fill /> Pause</button>
      </div>
    );
  }
  const onEye = mode === 'motion' && zone?.type === 'eye';
  const onMask = mode === 'motion' && !!zone && isPaintZone(zone) && !zone.whole;
  const onLayer = mode === 'artwork' && !!layer;
  const canPaint = onEye || onMask || onLayer;
  const colour = (onEye && eyeLayer === 'skin') || onLayer; // a real colour brush, not a mask brush
  const canClone = colour;
  const pick = (t: Tool) => {
    const patch: Parameters<typeof set>[0] = { tool: t };
    // lid skin is only visible on a closed lid; lashes are only visible on an open one
    if (onEye && zone && t !== 'move') {
      const s = useStore.getState();
      if (eyeLayer === 'skin' && !(s.lidHold[zone.id] > 0.05)) patch.lidHold = { ...s.lidHold, [zone.id]: 1 };
      if (eyeLayer === 'lash') patch.lidHold = { ...s.lidHold, [zone.id]: 0 };
    }
    set(patch);
  };
  const pickLayer = (l: EyeLayer) => {
    if (!zone) return;
    const s = useStore.getState();
    set({ eyeLayer: l, tool: tool === 'move' || (l !== 'skin' && tool === 'clone') ? 'brush' : tool, lidHold: { ...s.lidHold, [zone.id]: l === 'skin' ? Math.max(s.lidHold[zone.id] ?? 0, 1) : l === 'lash' ? 0 : s.lidHold[zone.id] ?? 0 } });
  };
  const painting = tool !== 'move' && canPaint;
  return (
    <div className="pill" role="toolbar" aria-label="Tools">
      <IconButton icon="move" label="Select and adjust" hint="Select and adjust (V)" active={tool === 'move'} onClick={() => pick('move')} />
      <IconButton icon="brush" label="Brush" hint={canPaint ? (colour ? 'Paint (B). Alt-click picks a colour from the artwork.' : 'Paint where it applies (B)') : mode === 'artwork' ? 'Select a layer to paint on' : 'Select a motion to paint'} active={tool === 'brush'} disabled={!canPaint} onClick={() => pick('brush')} />
      {(mode === 'artwork' || onEye) && <IconButton icon="copy" label="Clone" hint={canClone ? 'Clone (C): Alt-click where to copy from, then paint' : 'Clone works on layers and on lid skin'} active={tool === 'clone'} disabled={!canClone} onClick={() => pick('clone')} />}
      <IconButton icon="erase" label="Eraser" hint="Erase (E)" active={tool === 'erase'} disabled={!canPaint} onClick={() => pick('erase')} />
      {(mode === 'artwork' || onEye) && <IconButton icon="pick" label="Eyedropper" hint={canClone ? 'Eyedropper (I): click to take a colour from the picture. Alt-click does the same while painting.' : 'The eyedropper works on layers and on lid skin'} active={tool === 'pick'} disabled={!canClone} onClick={() => set({ tool: 'pick', pickReturn: tool === 'pick' || tool === 'move' || tool === 'erase' ? 'brush' : tool })} />}
      {onEye && (
        <div className="seg seg-small pill-seg" role="group" aria-label="What the brush paints">
          {EYE_LAYERS.map((l) => <button key={l.id} className={eyeLayer === l.id ? 'is-on' : ''} title={l.hint} onClick={() => pickLayer(l.id)}>{l.label}</button>)}
        </div>
      )}
      {onEye && zone && (
        <div className="pill-sliders">
          <Slider label="Lid" value={lid} format={pct} onChange={(v) => set({ lidHold: { ...useStore.getState().lidHold, [zone.id]: v } })} hint="Hold the lid at any height while you adjust and paint" tint="#6fb8ff" />
        </div>
      )}
      {painting && tool !== 'pick' && (
        <div className="pill-sliders">
          <Slider label="Size" value={brush.size} min={Math.max(1, unit * 0.002)} max={unit * 0.4} step={1} format={px} onChange={(v) => set({ brush: { ...brush, size: v } })} />
          <Slider label="Softness" value={brush.soft} format={pct} onChange={(v) => set({ brush: { ...brush, soft: v } })} />
          {colour && <Slider label="Opacity" value={brush.opacity} min={0.05} format={pct} onChange={(v) => set({ brush: { ...brush, opacity: v } })} />}
        </div>
      )}
      {painting && colour && (tool === 'brush' || tool === 'pick') && (
        <div className="pill-colors" role="group" aria-label="Brush colour">
          <label className="pill-color" title={`Brush colour ${brush.color}. Click to choose one; use the eyedropper to take one from the picture.`}>
            <input type="color" value={brush.color} aria-label="Brush colour" onChange={(e) => set({ brush: { ...brush, color: e.target.value } })} onBlur={(e) => rememberColor(e.target.value)} />
          </label>
          {recent.filter((c) => c !== brush.color.toLowerCase()).slice(0, 7).map((c) => (
            <button key={c} className="recent" style={{ background: c }} title={`Use ${c}`} aria-label={`Use recent colour ${c}`} onClick={() => set({ brush: { ...brush, color: c }, ...(tool === 'pick' ? { tool: useStore.getState().pickReturn } : {}) })} />
          ))}
        </div>
      )}
      {tool === 'pick' && canPaint && <span className="pill-note">Click the picture to take a colour</span>}
      {painting && onLayer && tool !== 'erase' && tool !== 'pick' && (
        <div className="seg seg-small pill-seg" role="group" aria-label="How paint lands">
          {MODES.map((m) => <button key={m.id} className={brush.mode === m.id ? 'is-on' : ''} title={m.hint} onClick={() => set({ brush: { ...brush, mode: m.id } })}>{m.label}</button>)}
        </div>
      )}
      {painting && tool === 'clone' && !cloneFrom && <span className="pill-note">Alt-click where to copy from</span>}
    </div>
  );
}

/** Bottom dock: play/pause and the row of expressions. */
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
      <div className="moods" role="radiogroup" aria-label="Expressions">
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
        {mode === 'motion' && <button className="mood mood-add" onClick={addMood} aria-label="Add an expression from the current pose" title="New expression, copied from this one"><Icon name="plus" size={14} /></button>}
      </div>
    </div>
  );
}
