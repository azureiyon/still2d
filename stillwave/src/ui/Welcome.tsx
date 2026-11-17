import { useEffect, useState } from 'react';
import { unpackProject, type ProjectFile } from '../engine/assets';
import { ARTWORK_TYPES, importFiles, pickFiles } from '../io/import';
import { readSession } from '../io/project';
import { sampleFlat, sampleLayered } from '../sample/character';
import { useStore } from '../state/store';
import { Icon } from './controls';

export function Welcome() {
  const load = useStore((s) => s.load);
  const [session, setSession] = useState<{ file: ProjectFile; at: number } | null>(null);
  useEffect(() => { readSession().then(setSession); }, []);
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>Bring a drawing to life</h1>
        <p className="lede">Stillwave makes an illustration blink, breathe and sway. No bones, no rig: you paint the parts that should move, then export the animation.</p>
        <div className="welcome-drop">
          <button className="btn btn-primary btn-big" onClick={async () => importFiles(await pickFiles(`${ARTWORK_TYPES},.stillwave`))}>
            <Icon name="image" size={18} /> Choose artwork
          </button>
          <span>or drop a PNG, a layered PSD or a .stillwave project anywhere</span>
        </div>
        <div className="welcome-row">
          <button className="sample" onClick={() => load(sampleLayered())}>
            <strong>Meet Mio, in layers</strong>
            <small>A finished sample animation built from eight layers</small>
          </button>
          <button className="sample" onClick={() => load(sampleFlat())}>
            <strong>Mio, flattened</strong>
            <small>The same drawing as one image, to see what a single PNG can do</small>
          </button>
          {session && (
            <button className="sample" onClick={async () => load(await unpackProject(session.file))}>
              <strong>Pick up where you left off</strong>
              <small>{session.file.doc.name}, {new Date(session.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small>
            </button>
          )}
        </div>
        <ol className="steps">
          <li><strong>Artwork</strong> Bring in a drawing. Arrange and retouch it.</li>
          <li><strong>Motion</strong> Fit an outline to each eye, then brush over hair, head and chest.</li>
          <li><strong>Export</strong> Preview it, then save a GIF, video or frames.</li>
        </ol>
      </div>
    </div>
  );
}
