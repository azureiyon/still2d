import { useState } from 'react';
import { ZONE_INFO, type ZoneType } from '../engine/types';
import { ARTWORK_TYPES, importFiles, pickFiles } from '../io/import';
import { addRepairLayer, addZone, deleteLayer, deleteZone, layerThumb, moveLayer } from '../state/actions';
import { useStore } from '../state/store';
import { Icon, IconButton } from './controls';

function Layers() {
  const doc = useStore((s) => s.doc);
  const layerId = useStore((s) => s.layerId);
  const set = useStore((s) => s.set);
  const edit = useStore((s) => s.edit);
  return (
    <>
      <header className="panel-head">
        <h2>Artwork</h2>
        <button className="btn btn-small" onClick={async () => importFiles(await pickFiles(ARTWORK_TYPES))}><Icon name="plus" size={13} /> Add</button>
      </header>
      <div className="panel-scroll">
        <ul className="list">
          {[...doc.layers].reverse().map((l, i, arr) => (
            <li key={l.id} className={`item${l.id === layerId ? ' is-selected' : ''}${l.visible ? '' : ' is-off'}`}>
              <button className="item-main" onClick={() => set({ layerId: l.id })}>
                <img className="thumb" src={layerThumb(l.image)} alt="" />
                <span className="item-name">{l.name}</span>
                {l.role && <span className="item-kind">{l.role === 'repair' ? 'Repair' : l.role === 'backing' ? 'Backing' : 'Lifted'}</span>}
              </button>
              <span className="item-actions">
                <IconButton small icon="up" label="Bring forward" disabled={i === 0} onClick={() => moveLayer(l.id, 1)} />
                <IconButton small icon="down" label="Send back" disabled={i === arr.length - 1} onClick={() => moveLayer(l.id, -1)} />
                <IconButton small icon="trash" label={`Delete ${l.name}`} onClick={() => deleteLayer(l.id)} />
              </span>
              <IconButton small icon={l.visible ? 'eye' : 'eyeOff'} label={l.visible ? 'Hide layer' : 'Show layer'} onClick={() => edit((d) => { const x = d.layers.find((y) => y.id === l.id); if (x) x.visible = !x.visible; })} />
            </li>
          ))}
        </ul>
        <button className="btn btn-wide btn-quiet" onClick={addRepairLayer}><Icon name="brush" size={14} /> Add a repair layer</button>
        <p className="note">Drop PNG or PSD files anywhere to add them. The top of this list is the front of the picture. A repair layer is an empty sheet for painting over problems without changing the artwork.</p>
      </div>
    </>
  );
}

function Motions() {
  const doc = useStore((s) => s.doc);
  const zoneId = useStore((s) => s.zoneId);
  const hoverZone = useStore((s) => s.hoverZone);
  const set = useStore((s) => s.set);
  const editZone = useStore((s) => s.editZone);
  const [adding, setAdding] = useState(false);
  const types: ZoneType[] = ['eye', 'mouth', 'head', 'sway', 'breath', 'hold'];
  return (
    <>
      <header className="panel-head">
        <h2>Motions</h2>
        <button className="btn btn-small" aria-expanded={adding} onClick={() => setAdding(!adding)}><Icon name={adding ? 'close' : 'plus'} size={13} /> {adding ? 'Close' : 'Add'}</button>
      </header>
      <div className="panel-scroll">
        {(adding || doc.zones.length === 0) && (
          <div className="add-menu">
            {doc.zones.length === 0 && <p className="note">Nothing moves yet. Choose what to bring to life first.</p>}
            {types.map((t) => (
              <button key={t} className="add-card" onClick={() => { addZone(t); setAdding(false); }}>
                <span className="swatch" style={{ background: ZONE_INFO[t].color }} />
                <span><strong>{ZONE_INFO[t].label}</strong><small>{ZONE_INFO[t].hint}</small></span>
              </button>
            ))}
          </div>
        )}
        <ul className="list">
          {doc.zones.map((z) => (
            <li
              key={z.id}
              className={`item${z.id === zoneId ? ' is-selected' : ''}${z.id === hoverZone ? ' is-hover' : ''}${z.enabled ? '' : ' is-off'}`}
              onPointerEnter={() => set({ hoverZone: z.id })}
              onPointerLeave={() => set({ hoverZone: null })}
            >
              <button className="item-main" onClick={() => set({ zoneId: z.id, tab: 'motion', tool: 'move' })}>
                <span className="swatch" style={{ background: ZONE_INFO[z.type].color }} />
                <span className="item-name">{z.name}</span>
                <span className="item-kind">{ZONE_INFO[z.type].label}</span>
              </button>
              <span className="item-actions">
                <IconButton small icon="trash" label={`Delete ${z.name}`} hint={`Delete ${z.name} (Delete key)`} onClick={() => deleteZone(z.id)} />
              </span>
              <IconButton small icon={z.enabled ? 'eye' : 'eyeOff'} label={z.enabled ? 'Switch off' : 'Switch on'} onClick={() => editZone(z.id, (x) => { x.enabled = !x.enabled; })} />
            </li>
          ))}
        </ul>
        {doc.zones.length > 0 && <p className="note">Hover a motion to watch only that part move.</p>}
      </div>
    </>
  );
}

export function LeftPanel() {
  const mode = useStore((s) => s.mode);
  if (mode === 'stage') return null;
  return <aside className="panel panel-left" aria-label={mode === 'artwork' ? 'Artwork layers' : 'Motions'}>{mode === 'artwork' ? <Layers /> : <Motions />}</aside>;
}
