import { useState } from 'react';
import { isPaintZone, SWAY_FEELS, ZONE_INFO, type Doc, type EyeZone, type Layer, type LidPose, type Zone } from '../engine/types';
import { eyeSide } from '../engine/rig';
import { clearEyePaint, deleteMood, deleteZone, focusEye, liftZone, mirrorEyeZone, resetEyeCurves, restoreLayer, setEyeEdit } from '../state/actions';
import { CURVE_COLOR } from './curveColors';
import { ExportPanel } from './ExportPanel';
import { useStore } from '../state/store';
import { BlinkEditor } from './BlinkEditor';
import { Icon, IconButton, pct, px, secs, Section, Slider, Toggle } from './controls';
import { live } from './live';

type NumKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

function ZoneSlider<Z extends Zone>({ zone, prop, label, min = 0, max = 1, format = pct, reset, hint }: {
  zone: Z; prop: NumKey<Z> & string; label: string; min?: number; max?: number; format?: (v: number) => string; reset?: number; hint?: string;
}) {
  const editZone = useStore((s) => s.editZone);
  return (
    <Slider
      label={label} min={min} max={max} format={format} reset={reset} hint={hint} tint={ZONE_INFO[zone.type].color}
      value={zone[prop] as number}
      onChange={(v) => editZone(zone.id, (z) => { (z as unknown as Record<string, number>)[prop] = v; }, `${zone.id}.${prop}`)}
    />
  );
}

function LayerPicker({ zone, doc }: { zone: Zone; doc: Doc }) {
  const editZone = useStore((s) => s.editZone);
  if (doc.layers.length < 2) return null;
  const all = zone.layers === 'all';
  return (
    <Section title="Layers it moves">
      <Toggle label="Every layer" value={all} onChange={(v) => editZone(zone.id, (z) => { z.layers = v ? 'all' : doc.layers.map((l) => l.id); })} />
      {!all && (
        <div className="checks">
          {[...doc.layers].reverse().map((l) => {
            const on = (zone.layers as string[]).includes(l.id);
            return (
              <label key={l.id} className="check">
                <input type="checkbox" checked={on} onChange={() => editZone(zone.id, (z) => {
                  const list = z.layers as string[];
                  z.layers = on ? list.filter((x) => x !== l.id) : [...list, l.id];
                })} />
                <span>{l.name}</span>
              </label>
            );
          })}
        </div>
      )}
      {isPaintZone(zone) && (
        <Toggle
          label="Move whole layers" value={zone.whole}
          hint="No painting needed: the chosen layers move as one piece."
          onChange={(v) => editZone(zone.id, (z) => { if (isPaintZone(z)) z.whole = v; })}
        />
      )}
    </Section>
  );
}

function ZoneInspector({ zone, doc }: { zone: Zone; doc: Doc }) {
  const editZone = useStore((s) => s.editZone);
  const set = useStore((s) => s.set);
  const info = ZONE_INFO[zone.type];
  const flat = doc.layers.length === 1;
  return (
    <>
      <div className="insp-title">
        <span className="swatch" style={{ background: info.color }} />
        <input className="name-input" value={zone.name} aria-label="Motion name" onChange={(e) => editZone(zone.id, (z) => { z.name = e.target.value; }, `${zone.id}.name`)} />
        <IconButton icon={zone.enabled ? 'eye' : 'eyeOff'} label={zone.enabled ? 'Switch this motion off' : 'Switch this motion on'} small onClick={() => editZone(zone.id, (z) => { z.enabled = !z.enabled; })} />
        <IconButton icon="trash" label="Delete this motion" small onClick={() => deleteZone(zone.id)} />
      </div>

      {isPaintZone(zone) && !zone.whole && (
        <p className="note">
          {zone.mask ? 'Brush more in, or erase paint where it should stay still. Soft edges bend gently; hard edges tear.' : zone.type === 'sway' ? 'Paint over the part that sways, starting at its root and ending at its tip.' : info.hint}
          {' '}
          <button className="link" onClick={() => set({ tool: 'brush' })}>Pick up the brush</button>
        </p>
      )}

      {zone.type === 'sway' && (
        <>
          <Section title="How it moves">
            <div className="seg seg-small seg-fill" role="group" aria-label="Movement style">
              {([['swing', 'Swing', 'Turns as one piece from the root. Best for lifted patches, ears and ribbons. On flat art the soft edge has to stretch more than with Bend.'], ['bend', 'Bend', 'Curls more toward the tip, like a hanging lock.'], ['flutter', 'Flutter', 'A bend with a quick, light tip, for wisps and fine strands.']] as const).map(([id, label, hint]) => (
                <button key={id} className={zone.style === id ? 'is-on' : ''} title={hint} onClick={() => editZone(zone.id, (z) => { if (z.type === 'sway') z.style = id; })}>{label}</button>
              ))}
            </div>
          </Section>
          <Section title="Feel">
            <div className="chips">
              {Object.entries(SWAY_FEELS).map(([name, f]) => {
                const on = (Object.keys(f) as (keyof typeof f)[]).every((k) => Math.abs(zone[k] - f[k]) < 0.005);
                return <button key={name} className={`chip${on ? ' is-on' : ''}`} onClick={() => editZone(zone.id, (z) => { Object.assign(z, f); })}>{name}</button>;
              })}
            </div>
            <ZoneSlider zone={zone} prop="amount" label="Swing" reset={0.4} hint="How far it swings" />
            <ZoneSlider zone={zone} prop="weight" label="Weight" reset={0.5} hint="Light things flutter quickly, heavy things swing slowly" />
            <ZoneSlider zone={zone} prop="bounce" label="Bounce" reset={0.35} hint="How long it keeps wobbling after a movement" />
            <ZoneSlider zone={zone} prop="breeze" label="Breeze" reset={0.45} hint="Gentle movement even when the head is still" />
            <ZoneSlider zone={zone} prop="ripple" label="Ripple" reset={0.5} hint="How much the tip trails behind the root" />
          </Section>
          <p className="note">The ring marks the root, which stays put. The diamond marks the tip. Double-click the dotted line to add a point, so the spine follows a curl.</p>
          {!zone.whole && zone.mask && (
            <Section title="Separate it from the picture">
              <button className="btn" onClick={() => liftZone(zone.id)}>Lift onto its own layer</button>
              <p className="note">A painted strand drags the pixels beside it. Lifting cuts it out, guesses what was behind, and lets it move freely over the picture.{flat ? '' : ' It lifts from the front-most layer under the paint.'}</p>
            </Section>
          )}
        </>
      )}

      {zone.type === 'head' && (
        <>
          <Section title="Range">
            <ZoneSlider zone={zone} prop="turn" label="Turn" reset={0.6} />
            <ZoneSlider zone={zone} prop="nod" label="Nod" reset={0.6} />
            <ZoneSlider zone={zone} prop="tilt" label="Tilt" reset={0.6} />
          </Section>
          <p className="note">The ring is the pivot. Put it where the neck meets the shoulders.{flat ? ' On flattened art the neck stretches a little as the head moves, so keep the range modest.' : ''}</p>
        </>
      )}

      {zone.type === 'breath' && (
        <>
          <Section title="Breathing">
            <ZoneSlider zone={zone} prop="amount" label="Depth" reset={0.5} />
          </Section>
          <p className="note">Everything painted rises from the ring. Speed lives under Rhythm.</p>
        </>
      )}

      {zone.type === 'hold' && (
        <p className="note">Whatever is painted here stays exactly as drawn, however the motions around it pull. Use it for a face behind swaying hair, or the root of a strand. Lifted layers ignore it.</p>
      )}

      {zone.type === 'eye' && <EyeInspector zone={zone} doc={doc} />}

      {zone.type === 'mouth' && (
        <>
          <Section title="Shape">
            <ZoneSlider zone={zone} prop="openH" label="Opening" min={4} max={Math.max(doc.width, doc.height) * 0.12} format={px} />
            <ZoneSlider zone={zone} prop="smileH" label="Smile lift" min={0} max={Math.max(doc.width, doc.height) * 0.04} format={px} />
            <ZoneSlider zone={zone} prop="reach" label="Reach" min={8} max={Math.max(doc.width, doc.height) * 0.15} format={px} hint="How far around the lips the skin gives way" />
            <label className="color-row">
              <span>Inside colour</span>
              <input type="color" value={zone.color} onChange={(e) => editZone(zone.id, (z) => { if (z.type === 'mouth') z.color = e.target.value; }, `${zone.id}.color`)} />
            </label>
          </Section>
          <p className="note">The mouth opens along the line between the two corner dots; drag the middle dot to bend that line onto the lips. Each expression can hold it open or lift it into a smile.</p>
        </>
      )}

      <LayerPicker zone={zone} doc={doc} />
    </>
  );
}

function EyeInspector({ zone, doc }: { zone: EyeZone; doc: Doc }) {
  const edit = useStore((st) => st.editZone);
  const set = useStore((st) => st.set);
  const lid = useStore((st) => st.lidHold[zone.id] ?? 0);
  const nodeSel = useStore((st) => st.nodeSel);
  const editZone = (id: string, fn: (z: EyeZone) => void) => edit<EyeZone>(id, fn);
  const u = Math.max(doc.width, doc.height);
  const partner = doc.zones.find((z) => z.id === zone.pair);
  const precise = zone.edit === 'precise';
  const hold = (v: number) => set({ lidHold: { ...useStore.getState().lidHold, [zone.id]: v } });
  return (
    <>
      <div className="seg seg-small seg-fill" role="group" aria-label="How this eye is shaped">
        <button className={!precise ? 'is-on' : ''} title="A few handles: corners, lid peaks and the lash band" onClick={() => setEyeEdit(zone.id, 'simple')}>Simple</button>
        <button className={precise ? 'is-on' : ''} title="Four curves with nodes and tangent handles, for exact fitting" onClick={() => setEyeEdit(zone.id, 'precise')}>Precise</button>
      </div>
      {precise ? (
        <div className="legend">
          <p><span className="key" style={{ background: CURVE_COLOR.up }} /> <strong>Lash line</strong>: where the lid edge is. It travels down to the lower lid.</p>
          <p><span className="key" style={{ background: CURVE_COLOR.band }} /> <strong>Carried band</strong>: lashes, crease and eye shadow, moved down as one piece.</p>
          <p><span className="key" style={{ background: CURVE_COLOR.skin }} /> <strong>Stretching skin</strong>: fills the gap. Keep its top below the brow.</p>
          <p className="note">Click a node to show its handles. Double-click a curve to add a node, a node to remove it. Alt-drag a handle to give the node a corner. Arrow keys nudge the selected node by one screen pixel, ten with Shift.</p>
        </div>
      ) : (
        <p className="note">
          Fit the outline to the eye opening, with the dashed line just above the lashes. Pull the tab beside the eye to close the lid; it stays where you leave it. Double-click a lid line to add a point for tricky shapes.
        </p>
      )}
      <div className="row">
        <button className="btn" onClick={() => live.anim.blinkNow()}>Test a blink</button>
        <button className="btn" onClick={() => mirrorEyeZone(zone.id)}>
          <Icon name="mirror" size={14} /> {partner ? `Copy to ${partner.name}` : 'Mirror to other eye'}
        </button>
      </div>
      {precise && (
        <Section title="Check the closing" aside={<button className="link" onClick={() => focusEye(zone.id)}>Focus eye</button>}>
          <div className="seg seg-small seg-fill" role="group" aria-label="Hold the lid at">
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <button key={v} className={Math.abs(lid - v) < 0.01 ? 'is-on' : ''} onClick={() => hold(v)}>{v * 100}%</button>
            ))}
          </div>
          {nodeSel && <p className="note">Selected: {({ up: 'lash line', band: 'carried band', skin: 'stretching skin', lo: 'lower lid' } as const)[nodeSel.split(':')[0] as 'up']} node {Number(nodeSel.split(':')[1]) + 1}.</p>}
        </Section>
      )}
      <Section title="Hidden skin">
        <div className="seg seg-small seg-fill" role="group" aria-label="How the eyelid skin is made">
          <button className={zone.fill === 'soft' ? 'is-on' : ''} title="Blends the skin tones just above and below the eye. Clean, and leaves eyebrows and fringe alone." onClick={() => editZone(zone.id, (z) => { z.fill = 'soft'; })}>Blend skin</button>
          <button className={zone.fill === 'stretch' ? 'is-on' : ''} title="Pulls the stretching skin down, keeping its shading and creases." onClick={() => editZone(zone.id, (z) => { z.fill = 'stretch'; })}>Pull skin down</button>
        </div>
        <p className="note">Not right for this drawing? Choose <strong>Lid skin</strong> in the tool strip and paint or clone the eyelid yourself. <strong>Lashes</strong> marks stray lashes that should travel, <strong>Keep</strong> protects hair that crosses the eye.</p>
        {(zone.paint || zone.ctl) && (
          <div className="row">
            {zone.paint && <button className="btn btn-small" onClick={() => clearEyePaint(zone.id, 'paint')}>Clear lid skin</button>}
            {zone.ctl && <button className="btn btn-small" onClick={() => clearEyePaint(zone.id, 'ctl')}>Clear marks</button>}
          </div>
        )}
      </Section>
      <Section title="Lid">
        {!precise && <ZoneSlider zone={zone} prop="band" label="Lash thickness" min={0} max={u * 0.04} format={px} hint="The lashes that travel down with the lid" />}
        <ZoneSlider zone={zone} prop="skin" label={precise ? 'Skin below the eye' : 'Skin sample'} min={1} max={u * 0.05} format={px} hint={precise ? 'How far below the lower lid skin is sampled and stretched' : 'How far above the lashes (and below the eye) skin is taken from. Keep it clear of the eyebrow.'} />
        <ZoneSlider zone={zone} prop="follow" label="Crease follow" reset={1} hint="How far the top of the carried band (the crease) moves with the lashes. Lower values keep the crease higher as the eye closes." />
        <ZoneSlider zone={zone} prop="roll" label="Lash roll" reset={0.4} hint="Lashes thin out as the lid closes, as if tipping away from you" />
        <ZoneSlider zone={zone} prop="loBand" label="Lower lash" min={0} max={u * 0.02} format={px} />
        <ZoneSlider zone={zone} prop="meet" label="Lower lid rise" max={0.6} reset={0.08} hint="0% keeps the lower lid still and lets the upper lid do all the travelling" />
      </Section>
      {!precise && (
        <Section title="Curve">
          {zone.upPts.length === 0 ? <ZoneSlider zone={zone} prop="upRound" label="Upper roundness" min={0.4} max={1.6} reset={0.8} format={(v) => v.toFixed(2)} /> : <p className="note">The upper lid follows its {zone.upPts.length + 1} points. Double-click a small point to remove it.</p>}
          {zone.loPts.length === 0 ? <ZoneSlider zone={zone} prop="loRound" label="Lower roundness" min={0.4} max={1.6} reset={0.9} format={(v) => v.toFixed(2)} /> : <p className="note">The lower lid follows its {zone.loPts.length + 1} points.</p>}
        </Section>
      )}
      {precise && (
        <div className="row">
          <button className="btn btn-small" onClick={() => resetEyeCurves(zone.id)} title="Throw away the precise curves and start again from the simple shape">Rebuild curves from the simple shape</button>
        </div>
      )}
      <Section title="Gaze">
        <ZoneSlider zone={zone} prop="gaze" label="Iris travel" reset={0.6} hint="How far the iris slides when the avatar looks around" />
      </Section>
      <p className="note">This is the {eyeSide(doc, zone) === 'L' ? 'left' : 'right'} eye as you look at the screen. Expressions can close each side separately, which is how a wink works.</p>
    </>
  );
}

const LOOKS = [
  { name: 'Still life', hint: 'Barely there: slow breath, rare blinks', liveliness: 0.45, tempo: 0.8, idle: { head: 0.2, body: 0.15 }, breath: 5, blink: 5.5, breeze: 0.7 },
  { name: 'Natural', hint: 'A balanced, living portrait', liveliness: 1, tempo: 1, idle: { head: 0.5, body: 0.35 }, breath: 3.8, blink: 3.6, breeze: 1 },
  { name: 'Lively', hint: 'Bigger, quicker movement', liveliness: 1.5, tempo: 1.25, idle: { head: 0.75, body: 0.5 }, breath: 3, blink: 2.8, breeze: 1.15 },
  { name: 'Breezy', hint: 'Calm figure, restless hair', liveliness: 1.1, tempo: 0.9, idle: { head: 0.3, body: 0.25 }, breath: 4.2, blink: 4, breeze: 1.6 },
];

function Rhythm({ doc }: { doc: Doc }) {
  const edit = useStore((s) => s.edit);
  const m = doc.motion;
  const hasEyes = doc.zones.some((z) => z.type === 'eye');
  return (
    <>
      <Section title="Start from a look">
        <div className="chips">
          {LOOKS.map((k) => (
            <button key={k.name} className="chip" title={k.hint} onClick={() => edit((d) => { Object.assign(d.motion, { liveliness: k.liveliness, tempo: k.tempo }); d.motion.idle = { ...k.idle }; d.motion.breath.period = k.breath; d.motion.blink.every = k.blink; for (const z of d.zones) if (z.type === 'sway') z.breeze = Math.min(1, Math.max(0, z.breeze * k.breeze)); })}>{k.name}</button>
          ))}
        </div>
      </Section>
      <Section title="Overall">
        <Slider label="Liveliness" value={m.liveliness} min={0} max={2} reset={1} format={pct} onChange={(v) => edit((d) => { d.motion.liveliness = v; }, 'liveliness')} hint="One dial for how much everything moves" />
        <Slider label="Tempo" value={m.tempo} min={0.4} max={2} reset={1} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => edit((d) => { d.motion.tempo = v; }, 'tempo')} hint="How quickly the avatar breathes, blinks and drifts" />
      </Section>
      <Section title="Blink" aside={<button className="link" onClick={() => live.anim.blinkNow()}>Blink now</button>}>
        {!hasEyes && <p className="note">Add an Eye motion to see blinking.</p>}
        <Toggle label="Blink on its own" value={m.blink.enabled} onChange={(v) => edit((d) => { d.motion.blink.enabled = v; })} />
        <BlinkEditor />
        <Slider label="Every" value={m.blink.every} min={1} max={10} step={0.1} reset={3.6} format={(v) => `~${v.toFixed(1)} s`} onChange={(v) => edit((d) => { d.motion.blink.every = v; }, 'blink.every')} />
        <Slider label="Irregularity" value={m.blink.vary} reset={0.5} format={pct} onChange={(v) => edit((d) => { d.motion.blink.vary = v; }, 'blink.vary')} hint="Even blinks look robotic; uneven ones look alive" />
        <Slider label="Half blinks" value={m.blink.partial} max={0.6} reset={0.15} format={pct} onChange={(v) => edit((d) => { d.motion.blink.partial = v; }, 'blink.partial')} hint="Chance that a blink only closes part of the way" />
        <Slider label="Double blinks" value={m.blink.double} max={0.6} reset={0.12} format={pct} onChange={(v) => edit((d) => { d.motion.blink.double = v; }, 'blink.double')} />
      </Section>
      <Section title="Breath and drift">
        <Slider label="One breath" value={m.breath.period} min={1.5} max={8} step={0.1} reset={3.8} format={secs} onChange={(v) => edit((d) => { d.motion.breath.period = v; }, 'breath.period')} />
        <Slider label="Head drift" value={m.idle.head} reset={0.5} format={pct} onChange={(v) => edit((d) => { d.motion.idle.head = v; }, 'idle.head')} />
        <Slider label="Body sway" value={m.idle.body} reset={0.35} format={pct} onChange={(v) => edit((d) => { d.motion.idle.body = v; }, 'idle.body')} />
      </Section>
      <Section title="Looking">
        <Slider label="Wandering gaze" value={m.look.wander} reset={0.35} format={pct} onChange={(v) => edit((d) => { d.motion.look.wander = v; }, 'look.wander')} hint="Small, slow glances to either side" />
      </Section>
      <Section title="Expression changes">
        <Slider label="Transition" value={m.transition} min={0.08} max={1.5} step={0.01} reset={0.35} format={secs} onChange={(v) => edit((d) => { d.motion.transition = v; }, 'transition')} />
      </Section>
    </>
  );
}

function MoodInspector({ doc }: { doc: Doc }) {
  const exprId = useStore((s) => s.exprId);
  const edit = useStore((s) => s.edit);
  const [both, setBoth] = useState(true);
  const mood = doc.expressions.find((e) => e.id === exprId) ?? doc.expressions[0];
  if (!mood) return null;
  const change = (fn: (m: typeof mood) => void, key: string) => edit((d) => { const m = d.expressions.find((e) => e.id === mood.id); if (m) fn(m); }, `mood.${mood.id}.${key}`);
  const lid = (side: 'eyeL' | 'eyeR', prop: keyof LidPose, label: string, min = 0) => (
    <Slider
      key={side + prop} label={label} min={min} max={1} reset={0} format={pct} value={mood.pose[side][prop]}
      onChange={(v) => change((m) => { m.pose[side][prop] = v; if (both) m.pose[side === 'eyeL' ? 'eyeR' : 'eyeL'][prop] = v; }, side + prop)}
    />
  );
  const num = (prop: 'mouthOpen' | 'mouthSmile' | 'turn' | 'nod' | 'tilt', label: string, min: number) => (
    <Slider label={label} min={min} max={1} reset={0} format={pct} value={mood.pose[prop]} onChange={(v) => change((m) => { m.pose[prop] = v; }, prop)} />
  );
  return (
    <>
      <div className="insp-title">
        <input className="name-input" value={mood.name} aria-label="Expression name" onChange={(e) => change((m) => { m.name = e.target.value; }, 'name')} />
        <IconButton icon="trash" label="Delete this expression" small disabled={doc.expressions.length <= 1} onClick={() => deleteMood(mood.id)} />
      </div>
      <p className="note">An expression is a held pose. Blinking, breathing and sway carry on over the top of it.</p>
      <Section title="Eyes" aside={<Toggle label="Both together" value={both} onChange={setBoth} />}>
        {both ? (
          <>{lid('eyeL', 'upper', 'Upper lid')}{lid('eyeL', 'lower', 'Lower lid')}{lid('eyeL', 'arc', 'Closing curve', -1)}</>
        ) : (
          <>
            {lid('eyeL', 'upper', 'Left upper lid')}{lid('eyeL', 'lower', 'Left lower lid')}{lid('eyeL', 'arc', 'Left curve', -1)}
            {lid('eyeR', 'upper', 'Right upper lid')}{lid('eyeR', 'lower', 'Right lower lid')}{lid('eyeR', 'arc', 'Right curve', -1)}
          </>
        )}
      </Section>
      <Section title="Mouth">
        {num('mouthOpen', 'Open', 0)}
        {num('mouthSmile', 'Smile', -1)}
      </Section>
      <Section title="Head">
        {num('tilt', 'Tilt', -1)}
        {num('turn', 'Turn', -1)}
        {num('nod', 'Nod', -1)}
      </Section>
      {doc.layers.length > 1 && (
        <Section title="Layers in this expression">
          <p className="note">Swap in a blush, a different mouth or closed-eye artwork for this expression only.</p>
          <div className="checks">
            {[...doc.layers].reverse().map((l) => {
              const state = l.id in mood.layers ? (mood.layers[l.id] ? 'show' : 'hide') : 'same';
              return (
                <div key={l.id} className="tri">
                  <span>{l.name}</span>
                  <div className="seg seg-small" role="group" aria-label={`${l.name} in this expression`}>
                    {(['same', 'show', 'hide'] as const).map((o) => (
                      <button key={o} className={state === o ? 'is-on' : ''} onClick={() => change((m) => { if (o === 'same') delete m.layers[l.id]; else m.layers[l.id] = o === 'show'; }, 'layers')}>
                        {o === 'same' ? 'As is' : o === 'show' ? 'Show' : 'Hide'}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </>
  );
}

function LayerInspector({ layer, doc }: { layer: Layer | undefined; doc: Doc }) {
  const edit = useStore((s) => s.edit);
  const upd = (fn: (l: Layer) => void, key: string) => edit((d) => { const l = d.layers.find((x) => x.id === layer?.id); if (l) fn(l); }, `layer.${layer?.id}.${key}`);
  return (
    <>
      {layer ? (
        <>
          <div className="insp-title">
            <input className="name-input" value={layer.name} aria-label="Layer name" onChange={(e) => upd((l) => { l.name = e.target.value; }, 'name')} />
          </div>
          <Section title="Placement">
            <Slider label="Across" value={layer.x} min={-doc.width * 0.5} max={doc.width * 1.5} step={1} reset={doc.width / 2} format={px} onChange={(v) => upd((l) => { l.x = v; }, 'x')} />
            <Slider label="Down" value={layer.y} min={-doc.height * 0.5} max={doc.height * 1.5} step={1} reset={doc.height / 2} format={px} onChange={(v) => upd((l) => { l.y = v; }, 'y')} />
            <Slider label="Size" value={layer.scale} min={0.05} max={4} step={0.01} reset={1} format={pct} onChange={(v) => upd((l) => { l.scale = v; }, 'scale')} />
            <Slider label="Rotation" value={(layer.rotation * 180) / Math.PI} min={-180} max={180} step={1} reset={0} format={(v) => `${Math.round(v)}°`} onChange={(v) => upd((l) => { l.rotation = (v * Math.PI) / 180; }, 'rot')} />
            <Slider label="Opacity" value={layer.opacity} reset={1} format={pct} onChange={(v) => upd((l) => { l.opacity = v; }, 'opacity')} />
          </Section>
          {(layer.original || layer.role) && (
            <Section title="Retouching">
              {layer.role === 'repair' && <p className="note">A repair layer. Paint, clone or erase on it freely; the artwork underneath is never changed.</p>}
              {layer.role === 'backing' && <p className="note">This fills the gap left by a lifted piece. It was guessed from the surrounding colours; repaint it if the guess is off.</p>}
              {layer.role === 'lifted' && <p className="note">Lifted out of the picture so it can move on its own. Erase any halo of background that came with it.</p>}
              {layer.original && <button className="btn" onClick={() => restoreLayer(layer.id)}>Restore original pixels</button>}
            </Section>
          )}
          <Section title="Depth">
            <Slider label="Near or far" value={layer.depth} min={-1} max={1} reset={0} format={(v) => (Math.abs(v) < 0.02 ? 'Middle' : v > 0 ? `Near ${Math.round(v * 100)}` : `Far ${Math.round(-v * 100)}`)} onChange={(v) => upd((l) => { l.depth = v; }, 'depth')} hint="Near layers slide further when the head turns, which fakes a little 3D" />
          </Section>
        </>
      ) : (
        <p className="note">Click a piece of artwork to move, resize or rotate it. Pick the brush, clone or eraser above the canvas to retouch the selected layer.</p>
      )}
      <Section title="Artboard">
        <p className="note">{doc.width} × {doc.height} px, {doc.layers.length} layer{doc.layers.length === 1 ? '' : 's'}</p>
        {doc.layers.length === 1 && (
          <p className="note callout">
            This is flattened artwork, so Stillwave bends its pixels rather than moving separate parts. Blinks, breathing, sway and gentle head motion work well. Big head turns and anything hidden behind something else need separate layers.
          </p>
        )}
      </Section>
    </>
  );
}

export function Inspector() {
  const doc = useStore((s) => s.doc);
  const mode = useStore((s) => s.mode);
  const tab = useStore((s) => s.tab);
  const zoneId = useStore((s) => s.zoneId);
  const layerId = useStore((s) => s.layerId);
  const set = useStore((s) => s.set);
  const zone = doc.zones.find((z) => z.id === zoneId);

  if (mode === 'artwork') return <aside className="panel panel-right" aria-label="Layer settings"><div className="panel-scroll"><LayerInspector layer={doc.layers.find((l) => l.id === layerId)} doc={doc} /></div></aside>;
  if (mode === 'stage') return <aside className="panel panel-right" aria-label="Export settings"><div className="panel-scroll"><ExportPanel /></div></aside>;

  return (
    <aside className="panel panel-right" aria-label="Motion settings">
      <div className="tabs" role="tablist">
        {([['motion', 'Motion'], ['rhythm', 'Rhythm'], ['mood', 'Expression']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => set({ tab: id })}>{label}</button>
        ))}
      </div>
      <div className="panel-scroll">
        {tab === 'motion' && (zone ? <ZoneInspector key={zone.id} zone={zone} doc={doc} /> : (
          <p className="note">Pick a motion from the list, or click a tinted area on the artwork. Hover over one to watch just that part move.</p>
        ))}
        {tab === 'rhythm' && <Rhythm doc={doc} />}
        {tab === 'mood' && <MoodInspector doc={doc} />}
      </div>
    </aside>
  );
}
