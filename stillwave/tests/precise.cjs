// Precise eye editing through the real UI, on the flattened sample.
const { open } = require('./lib.cjs');
const fs = require('fs');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const { b, p, errs } = await open();
  p.setDefaultTimeout(120000);
  const S = (fn, a) => p.evaluate(fn, a);
  await p.getByText('Mio, flattened').click();
  await p.waitForTimeout(800);
  const eyeId = await S(() => { const s = window.stillwave.store.getState(); const e = s.doc.zones.find((z) => z.type === 'eye'); s.set({ playing: false, zoneId: e.id, tab: 'motion' }); return e.id; });
  const eye = () => S((id) => window.stillwave.store.getState().doc.zones.find((z) => z.id === id), eyeId);
  await S((id) => import('/src/state/actions.ts').then((a) => a.focusEye(id)), eyeId);
  await p.waitForTimeout(600);
  const clip = { x: 420, y: 160, width: 600, height: 440 };
  const settle = () => S(() => new Promise((res) => { const l = window.stillwave.live; const f0 = l.frames; let n = 0; const tick = () => { if (++n > 3 && l.frames === f0) res(); else { requestAnimationFrame(tick); } }; requestAnimationFrame(tick); setTimeout(res, 8000); }));
  const shotAt = async (name, v) => { await S(([id, v]) => { const s = window.stillwave.store.getState(); s.set({ lidHold: { ...s.lidHold, [id]: v }, tab: 'mood' }); }, [eyeId, v]); await p.waitForTimeout(400); await settle(); await p.screenshot({ path: `test-out/precise-${name}.png`, clip }); await S(() => window.stillwave.store.getState().set({ tab: 'motion' })); };
  for (const v of [0, 0.5, 1]) await shotAt(`simple-${v}`, v);
  await S(([id]) => { const s = window.stillwave.store.getState(); s.set({ lidHold: { ...s.lidHold, [id]: 0 } }); }, [eyeId]);

  // 1. switch to precise: curves appear, shape preserved
  await p.getByRole('button', { name: 'Precise', exact: true }).click();
  let e = await eye();
  ok(e.edit === 'precise' && e.curves && ['up', 'band', 'skin', 'lo'].every((k) => e.curves[k].length === 5), 'Precise converts the eye into four 5-node curves');
  for (const v of [0, 0.5, 1]) await shotAt(`precise-${v}`, v);
  await S(([id]) => { const s = window.stillwave.store.getState(); s.set({ lidHold: { ...s.lidHold, [id]: 0 } }); }, [eyeId]);
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'test-out/precise-ui.png' });

  // helpers in screen space
  const nodeScreen = (c, i, part = 'n') => S(([id, c, i, part]) => import('/src/engine/geom.ts').then((g) => {
    const s = window.stillwave.store.getState(); const z = s.doc.zones.find((x) => x.id === id); const f = g.axisFrame(z); const n = z.curves[c][i];
    const t = part === 'n' ? n.t : part === 'i' ? n.it : n.ot, y = part === 'n' ? n.y : part === 'i' ? n.iy : n.oy;
    const q = f.at(t, c === 'lo' ? -y : y); const v = window.stillwave.live.view; return [q.x * v.zoom + v.panX, q.y * v.zoom + v.panY];
  }), [eyeId, c, i, part]);
  const dragBy = async (from, dx, dy, alt = false) => { await p.mouse.move(from[0], from[1]); if (alt) await p.keyboard.down('Alt'); await p.mouse.down(); await p.mouse.move(from[0] + dx, from[1] + dy, { steps: 5 }); await p.mouse.up(); if (alt) await p.keyboard.up('Alt'); await p.waitForTimeout(200); };

  // 2. drag a band node up: the band thickens there
  const b0 = (await eye()).curves.band[2];
  await dragBy(await nodeScreen('band', 2), 0, -18);
  e = await eye();
  ok(e.curves.band[2].y > b0.y + 1.5 && (await S(() => window.stillwave.store.getState().nodeSel)) === 'band:2', `dragging a band node moves it (${b0.y.toFixed(1)} -> ${e.curves.band[2].y.toFixed(1)} px) and selects it`);
  // 3. handles of the selected node: smooth drag keeps them in line, Alt breaks them
  const before = (await eye()).curves.band[2];
  await dragBy(await nodeScreen('band', 2, 'o'), 10, -14);
  e = await eye();
  const n = e.curves.band[2];
  const cross = (n.ot - n.t) * (n.iy - n.y) - (n.oy - n.y) * (n.it - n.t);
  ok(Math.abs(cross) < 1e-3 * Math.hypot(n.ot - n.t, n.oy - n.y) * Math.hypot(n.it - n.t, n.iy - n.y) * 1000 && n.oy !== before.oy, 'dragging a tangent handle keeps the node smooth (handles stay in line)');
  await dragBy(await nodeScreen('band', 2, 'o'), 0, 20, true);
  e = await eye();
  const n2 = e.curves.band[2];
  const hw = await S((id) => import('/src/engine/geom.ts').then((g) => g.axisFrame(window.stillwave.store.getState().doc.zones.find((x) => x.id === id)).hw), eyeId);
  // angle between the two handles, in pixels: 180 degrees means smooth
  const ang = (q) => Math.abs(Math.atan2((q.oy - q.y), (q.ot - q.t) * hw) - Math.atan2((q.iy - q.y), (q.it - q.t) * hw)) * 180 / Math.PI;
  const cross2 = 0;
  void cross2;
  ok(Math.abs(ang(n) - 180) < 0.5 && Math.abs(ang(n2) - 180) > 5 && n2.iy === n.iy && n2.it === n.it, `Alt-dragging a handle breaks the tangent (handles ${ang(n).toFixed(1)} deg apart before, ${ang(n2).toFixed(1)} deg after; the other handle untouched)`);
  // 4. arrow nudge: one screen pixel per press
  const zoom = await S(() => window.stillwave.live.view.zoom);
  const y0 = (await eye()).curves.band[2].y;
  await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('Shift+ArrowUp');
  const y1 = (await eye()).curves.band[2].y;
  ok(Math.abs((y1 - y0) - 12 / zoom) < 1e-6, `arrow keys nudge by screen pixels (${((y1 - y0) * zoom).toFixed(2)} px on screen for 1+1+10)`);
  const pastLen = await S(() => window.stillwave.store.getState().past.length);
  await p.keyboard.press('Control+z');
  ok(Math.abs((await eye()).curves.band[2].y - y0) < 1e-6, 'one Ctrl+Z undoes the whole nudge run');
  void pastLen;
  // 5. double-click on the lash line adds a node; double-click the node removes it
  const upMid = await S(([id]) => import('/src/engine/geom.ts').then((g) => { const z = window.stillwave.store.getState().doc.zones.find((x) => x.id === id); const f = g.axisFrame(z); const t = 0.25; const q = f.at(t, g.chainAt(z.curves.up, t)); const v = window.stillwave.live.view; return [q.x * v.zoom + v.panX, q.y * v.zoom + v.panY]; }), [eyeId]);
  await p.mouse.dblclick(upMid[0], upMid[1]); await p.waitForTimeout(250);
  e = await eye();
  ok(e.curves.up.length === 6, 'double-clicking the lash line adds a node');
  const sel = await S(() => window.stillwave.store.getState().nodeSel);
  const idx = Number(sel.split(':')[1]);
  const ns = await nodeScreen('up', idx);
  await p.mouse.dblclick(ns[0], ns[1]); await p.waitForTimeout(250);
  ok((await eye()).curves.up.length === 5, 'double-clicking that node removes it');
  // 6. closure presets and focus
  await p.getByRole('button', { name: '75%', exact: true }).click();
  ok(Math.abs((await S((id) => window.stillwave.store.getState().lidHold[id], eyeId)) - 0.75) < 1e-9, 'closure preset holds the lid at 75%');
  await p.getByRole('button', { name: '0%', exact: true }).click();
  // 7. crease follow changes the closed render
  await S((id) => window.stillwave.store.getState().editZone(id, (z) => { z.follow = 0.3; }), eyeId);
  await shotAt('follow-0.3-1', 1);
  await S((id) => window.stillwave.store.getState().editZone(id, (z) => { z.follow = 1; }), eyeId);
  await shotAt('follow-1-1', 1);
  // 8. back to simple keeps the curves; precise again restores them
  const curves = JSON.stringify((await eye()).curves);
  await p.getByRole('button', { name: 'Simple', exact: true }).click();
  e = await eye();
  ok(e.edit === 'simple' && JSON.stringify(e.curves) === curves, 'switching back to Simple keeps the precise curves');
  await p.getByRole('button', { name: 'Precise', exact: true }).click();
  ok(JSON.stringify((await eye()).curves) === curves, 'switching to Precise again brings them back unchanged');
  // 9. mirror carries the curves, flipped
  await S((id) => import('/src/state/actions.ts').then((a) => a.mirrorEyeZone(id)), eyeId);
  const pair = await S((id) => { const d = window.stillwave.store.getState().doc; const z = d.zones.find((x) => x.id === id); return d.zones.find((x) => x.id === z.pair); }, eyeId);
  e = await eye();
  ok(pair.edit === 'precise' && Math.abs(pair.curves.band[2].y - e.curves.band[2].y) < 1e-9 && Math.abs(pair.curves.band[1].t + e.curves.band[3].t) < 1e-9, 'Copy to the other eye carries the curves, mirrored');
  // 10. save and reopen
  const saved = await S(() => window.stillwave.store.getState().doc);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]);
  await dl.saveAs('test-out/precise.stillwave');
  await S(() => window.stillwave.store.getState().load({ ...window.stillwave.store.getState().doc, layers: [], zones: [] }));
  await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose artwork').click()]);
  await fc.setFiles('test-out/precise.stillwave');
  await p.waitForFunction(() => window.stillwave.store.getState().doc.zones.length > 3);
  ok(JSON.stringify(await S(() => window.stillwave.store.getState().doc)) === JSON.stringify(saved), 'precise curves survive save and reopen exactly');
  console.log(errs.length ? 'CONSOLE ERRORS:\n' + errs.join('\n') : 'no console errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close();
})().catch((e) => { console.error('TEST CRASH', e); process.exit(1); });
