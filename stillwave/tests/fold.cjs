// Fold protection at extreme poses: count inside-out triangles with the guard off and on.
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
    const { maskFromStrokes } = await import('/src/engine/paint.ts');
    const base = window.stillwave.store.getState().doc;
    const lock = base.zones.find((z) => z.name === 'Left hair');
    const c = document.createElement('canvas'); c.width = 900; c.height = 1100;
    const r = new Renderer(c);
    const hold = { id: 'hold_shoulder', type: 'hold', name: 'Shoulder', enabled: true, layers: 'all', whole: false, auto: false, mask: maskFromStrokes(base, '#8fa3c7', [{ pts: [170, 940, 240, 820, 330, 750, 420, 730], r: 55, soft: 0.25 }]) };
    const prof = (A) => { const a = new Float32Array(25); for (let i = 0; i <= 24; i++) a[i] = A * (i / 24); return a; };
    const flips = () => { const m = [...r.meshes.values()][0]; let n = 0; for (let t = 0; t < m.tris.length; t += 3) { const [a, b2, cc] = [m.tris[t], m.tris[t + 1], m.tris[t + 2]]; const p = m.pos; const cur = (p[b2 * 2] - p[a * 2]) * (p[cc * 2 + 1] - p[a * 2 + 1]) - (p[b2 * 2 + 1] - p[a * 2 + 1]) * (p[cc * 2] - p[a * 2]); if (cur / m.triArea[t / 3] < 0.05) n++; } return n; };
    const res = {}, shots = [];
    for (const [label, A, withHold] of [['Bend 1.4 rad', 1.4, false], ['Bend 1.4 rad + held shoulder', 1.4, true], ['Bend -1.2 rad (into the face)', -1.2, false]]) {
      const doc = { ...base, zones: base.zones.filter((z) => z.type !== 'eye' && z.type !== 'mouth').map((z) => (z.id === lock.id ? { ...z, style: 'bend' } : z)).concat(withHold ? [hold] : []) };
      const frame = { head: { turn: 0, nod: 0, tilt: 0 }, breath: 0, body: { rot: 0, bob: 0 }, eyes: {}, mouths: {}, sway: { [lock.id]: prof(A) }, layerAlpha: {}, liveliness: 1 };
      const row = {};
      for (const on of [false, true]) {
        r.foldGuard = on;
        const t0 = performance.now();
        for (let k = 0; k < 10; k++) r.render(doc, frame, { zoom: 1, panX: 0, panY: 0 });
        row[on ? 'ms per frame, guard on' : 'ms per frame, guard off'] = +((performance.now() - t0) / 10).toFixed(1);
        row[on ? 'guard on' : 'guard off'] = { flipped: flips(), ...(on ? { foldedAfterEdgePass: r.fold.flips, unfoldedLocally: r.fold.unfolded, islandsScaledBack: r.fold.islands, motionKept: +r.fold.minScale.toFixed(2) } : {}) };
        const o = document.createElement('canvas'); o.width = 380; o.height = 560; o.getContext('2d').drawImage(c, 110, 360, 380, 560, 0, 0, 380, 560);
        shots.push([`${label} (${on ? 'guard on' : 'guard off'})`, o.toDataURL()]);
      }
      res[label] = row;
    }
    return { res, shots };
  });
  fs.mkdirSync('test-out/fold', { recursive: true });
  out.shots.forEach(([n, u], i) => fs.writeFileSync(`test-out/fold/${i}.png`, Buffer.from(u.split(',')[1], 'base64')));
  fs.writeFileSync('test-out/fold/labels.json', JSON.stringify(out.shots.map((s) => s[0])));
  console.log(JSON.stringify(out.res, null, 1));
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
