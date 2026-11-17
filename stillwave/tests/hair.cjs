// Hair deformation comparison at a fixed, strong pose. Renders offscreen with the app's own modules.
const { open } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const { b, p, errs } = await open();
  p.setDefaultTimeout(200000);
  await p.getByText('Mio, flattened').click();
  await p.waitForTimeout(800);
  await p.evaluate(() => window.stillwave.store.getState().set({ playing: false }));
  const out = await p.evaluate(async () => {
    const { Renderer } = await import('/src/engine/gl.ts');
    const { swaySpine, spineBind } = await import('/src/engine/geom.ts');
    const { maskFromStrokes } = await import('/src/engine/paint.ts');
    const actions = await import('/src/state/actions.ts');
    const { store } = window.stillwave;
    const base = store.getState().doc;
    const lock = base.zones.find((z) => z.name === 'Left hair');
    const c = document.createElement('canvas'); c.width = 900; c.height = 1100;
    const r = new Renderer(c);
    const view = { zoom: 1, panX: 0, panY: 0 };
    const A = 0.5; // radians of turn at the tip
    const profile = (style) => { const a = new Float32Array(25); for (let i = 0; i <= 24; i++) { const d = i / 24; a[i] = style === 'swing' ? A * 0.5 : A * d + (style === 'flutter' ? 0.25 * d * d * Math.sin(d * 9) : 0); } return a; };
    const frame = (id, style) => ({ head: { turn: 0, nod: 0, tilt: 0 }, breath: 0, body: { rot: 0, bob: 0 }, eyes: {}, mouths: {}, sway: { [id]: profile(style) }, layerAlpha: {}, liveliness: 1 });
    const crop = (name) => { const o = document.createElement('canvas'); o.width = 300; o.height = 520; o.getContext('2d').drawImage(c, 150, 380, 300, 520, 0, 0, 300, 520); return [name, o.toDataURL()]; };
    const docWith = (patch) => ({ ...base, zones: base.zones.filter((z) => z.type !== 'eye' && z.type !== 'mouth').map((z) => (z.id === lock.id ? { ...z, ...patch } : z)) });
    // strand distortion: how much grid edges inside the lock change length (0 = perfectly rigid)
    const stretch = (pos, rest, w, cols, rows) => {
      let sum = 0, n = 0, max = 0;
      const S = cols + 1;
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        const a = j * S + i;
        for (const bb of [i < cols ? a + 1 : -1, j < rows ? a + S : -1]) {
          if (bb < 0 || w[a] < 0.5 || w[bb] < 0.5) continue; // the strand and its soft edge
          const L0 = Math.hypot(rest[bb * 2] - rest[a * 2], rest[bb * 2 + 1] - rest[a * 2 + 1]);
          const L1 = Math.hypot(pos[bb * 2] - pos[a * 2], pos[bb * 2 + 1] - pos[a * 2 + 1]);
          const e = Math.abs(L1 / L0 - 1); sum += e; n++; max = Math.max(max, e);
        }
      }
      return { mean: +(sum / n).toFixed(4), max: +max.toFixed(3) };
    };
    const shots = [], metrics = {};
    const meshOf = () => [...r.meshes.values()][0];
    // rest
    r.render(docWith({}), { ...frame(lock.id, 'bend'), sway: {} }, view); shots.push(crop('Rest'));
    // v1-style: every vertex rotated about the root by its own angle (what the first build did)
    {
      const d = docWith({ style: 'bend' });
      r.render(d, frame(lock.id, 'bend'), view);
      const m = meshOf();
      const w = m.weights.get(lock.id).w;
      const spine = swaySpine(lock);
      const prof = profile('bend');
      const old = new Float32Array(m.rest);
      const ax = lock.anchor.x, ay = lock.anchor.y, len = Math.hypot(lock.tip.x - ax, lock.tip.y - ay);
      const dx = (lock.tip.x - ax) / len, dy = (lock.tip.y - ay) / len;
      for (let i = 0; i < old.length / 2; i++) {
        const vx = m.rest[i * 2] - ax, vy = m.rest[i * 2 + 1] - ay;
        const t = Math.min(1, Math.max(0, (vx * dx + vy * dy) / len));
        const ang = prof[Math.round(t * 24)] * w[i];
        old[i * 2] = ax + vx * Math.cos(ang) - vy * Math.sin(ang);
        old[i * 2 + 1] = ay + vx * Math.sin(ang) + vy * Math.cos(ang);
      }
      metrics['First build: rotate each point about the root'] = stretch(old, m.rest, w, m.cols, m.rows);
      metrics['Bend: carried along the spine'] = stretch(m.pos, m.rest, w, m.cols, m.rows);
      shots.push(crop('Bend'));
      void spine; void spineBind;
    }
    for (const style of ['swing', 'flutter']) {
      r.render(docWith({ style }), frame(lock.id, style), view);
      const m = meshOf();
      metrics[style === 'swing' ? 'Swing: rigid turn' : 'Flutter'] = stretch(m.pos, m.rest, m.weights.get(lock.id).w, m.cols, m.rows);
      shots.push(crop(style === 'swing' ? 'Swing' : 'Flutter'));
    }
    // hold still over the face
    const hold = { id: 'hold_shoulder', type: 'hold', name: 'Shoulder', enabled: true, layers: 'all', whole: false, auto: false, mask: maskFromStrokes(base, '#8fa3c7', [{ pts: [170, 940, 240, 820, 330, 750, 420, 730], r: 55, soft: 0.25 }]) };
    const dh = docWith({ style: 'bend' }); dh.zones = [...dh.zones, hold];
    r.render(dh, frame(lock.id, 'bend'), view); shots.push(crop('Bend + hold shoulder'));
    // lift the lock onto its own layer, then swing it
    store.getState().set({ zoneId: lock.id });
    actions.liftZone(lock.id);
    const lifted = store.getState().doc;
    const ld = { ...lifted, zones: lifted.zones.filter((z) => z.type !== 'eye' && z.type !== 'mouth').map((z) => (z.id === lock.id ? { ...z, style: 'bend' } : z)) };
    r.render(ld, { ...frame(lock.id, 'bend'), sway: {} }, view); shots.push(crop('Lifted, at rest'));
    r.render(ld, frame(lock.id, 'bend'), view); shots.push(crop('Lifted + bend'));
    return { shots, metrics, layers: lifted.layers.map((l) => `${l.name} [${l.role ?? 'art'}]`), guarded: r.guarded };
  });
  fs.mkdirSync('test-out/hair', { recursive: true });
  for (const [name, url] of out.shots) fs.writeFileSync(`test-out/hair/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(JSON.stringify(out.metrics, null, 1));
  console.log('layers after lift:', out.layers.join(' | '));
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
