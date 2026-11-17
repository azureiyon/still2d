// Hair path editing, the eyedropper, deleting motions and starting a new canvas, through the real UI.
const { open } = require('./lib.cjs');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const { b, p, errs } = await open();
  p.setDefaultTimeout(120000);
  const S = (fn, a) => p.evaluate(fn, a);
  const doc = () => S(() => window.stillwave.store.getState().doc);
  const st = () => S(() => { const s = window.stillwave.store.getState(); return { tool: s.tool, pathSel: s.pathSel, recent: s.recent, color: s.brush.color, zoneId: s.zoneId }; });
  const toScreen = (x, y) => S(([x, y]) => { const v = window.stillwave.live.view; return [x * v.zoom + v.panX, y * v.zoom + v.panY]; }, [x, y]);
  const settle = () => S(() => new Promise((res) => { const l = window.stillwave.live; let f0 = l.frames, n = 0; const tick = () => { n++; if (n > 4 && l.frames === f0) res(); else { f0 = n > 4 ? l.frames : f0; requestAnimationFrame(tick); } }; requestAnimationFrame(tick); setTimeout(res, 10000); }));
  await p.getByText('Mio, flattened').click();
  await p.waitForTimeout(800);
  const lockId = await S(() => { const s = window.stillwave.store.getState(); const z = s.doc.zones.find((x) => x.name === 'Left hair'); s.set({ playing: false, zoneId: z.id, tab: 'motion' }); return z.id; });
  const lock = async () => (await doc()).zones.find((z) => z.id === lockId);

  // ---- 1. hair path
  await p.getByRole('button', { name: 'Follow the paint' }).click();
  let z = await lock();
  ok(z.path.length >= 3, `Follow the paint lays ${z.path.length} points along the strand`);
  const n1 = z.path.length;
  await p.getByRole('button', { name: 'Add point', exact: true }).click();
  z = await lock();
  const s1 = await st();
  ok(z.path.length === n1 + 1 && s1.pathSel !== null, 'Add point inserts a point and selects it');
  const i = s1.pathSel;
  const pt = await toScreen(z.path[i].x, z.path[i].y);
  await p.mouse.move(pt[0], pt[1]); await p.mouse.down(); await p.mouse.move(pt[0] + 25, pt[1] + 5, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200);
  const z2 = await lock();
  ok(z2.path[i].x > z.path[i].x + 5, 'dragging a path point moves it');
  const zoom = await S(() => window.stillwave.live.view.zoom);
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
  const z3 = await lock();
  ok(Math.abs((z3.path[i].x - z2.path[i].x) * zoom - 2) < 1e-6, 'arrow keys nudge the selected point by screen pixels');
  await p.keyboard.press('Delete');
  z = await lock();
  ok(!!z && z.path.length === z3.path.length - 1, 'Delete removes the selected point, not the whole motion');
  await settle();
  await p.screenshot({ path: 'test-out/40-path.png' });
  // the spine is smooth: no sharp turns between neighbouring samples
  const maxTurn = await S((id) => import('/src/engine/geom.ts').then((g) => {
    const zz = window.stillwave.store.getState().doc.zones.find((x) => x.id === id); const sp = g.swaySpine(zz); let m = 0;
    for (let k = 1; k < sp.pts.length - 1; k++) {
      const a = Math.atan2(sp.pts[k].y - sp.pts[k - 1].y, sp.pts[k].x - sp.pts[k - 1].x), c = Math.atan2(sp.pts[k + 1].y - sp.pts[k].y, sp.pts[k + 1].x - sp.pts[k].x);
      let d = Math.abs(c - a); if (d > Math.PI) d = 2 * Math.PI - d; m = Math.max(m, d);
    }
    return (m * 180) / Math.PI;
  }), lockId);
  ok(maxTurn < 15, `the spine bends smoothly through its points (sharpest turn between samples ${maxTurn.toFixed(1)} degrees)`);
  const tip0 = (await lock()).tip;
  await p.getByRole('button', { name: 'Flip root and tip' }).click();
  ok(JSON.stringify((await lock()).anchor) === JSON.stringify(tip0), 'Flip root and tip swaps them');
  await p.getByRole('button', { name: 'Straighten' }).click();
  ok((await lock()).path.length === 0, 'Straighten removes every path point');
  await p.keyboard.press('Control+z'); await p.keyboard.press('Control+z');
  ok((await lock()).path.length > 0, 'undo brings the path back');

  // ---- 2. deleting a motion from the list, and undo
  const n0 = (await doc()).zones.length;
  await p.locator('.panel-left .item', { hasText: 'Ahoge' }).hover();
  await p.getByRole('button', { name: 'Delete Ahoge' }).click();
  const d1 = await doc();
  ok(d1.zones.length === n0 - 1 && !d1.zones.some((x) => x.name === 'Ahoge'), "the list's delete button removes that motion");
  ok(await p.getByText('Ctrl+Z brings it back').isVisible(), 'a message says how to bring it back');
  await p.keyboard.press('Control+z');
  ok((await doc()).zones.length === n0, 'Ctrl+Z restores it');

  // ---- 3. eyedropper
  await p.getByRole('button', { name: 'Artwork', exact: true }).click();
  await S(() => { const s = window.stillwave.store.getState(); s.set({ layerId: s.doc.layers[0].id }); });
  await p.keyboard.press('i');
  ok((await st()).tool === 'pick', 'I picks up the eyedropper');
  const hair = await toScreen(300, 700);
  await p.mouse.move(hair[0], hair[1]); await p.waitForTimeout(300); await settle();
  await p.screenshot({ path: 'test-out/41-loupe.png' });
  await p.mouse.click(hair[0], hair[1]);
  let s2 = await st();
  const rgb = [1, 3, 5].map((k) => parseInt(s2.color.slice(k, k + 2), 16));
  ok(rgb[2] > rgb[0] + 20 && s2.tool === 'brush' && s2.recent[0] === s2.color, `clicking takes the colour under the cursor (${s2.color}, the hair is blue) and goes back to the brush`);
  await p.keyboard.press('i');
  const skin = await toScreen(450, 520);
  await p.mouse.click(skin[0], skin[1]);
  s2 = await st();
  const skinRgb = [1, 3, 5].map((k) => parseInt(s2.color.slice(k, k + 2), 16));
  ok(skinRgb[0] > 200 && s2.recent.length >= 2, `a second pick (${s2.color}, skin) joins the recent colours`);
  await p.locator('.recent').first().click();
  ok((await st()).color === s2.recent[1], 'clicking a recent swatch brings that colour back');

  // ---- 4. new canvas
  await p.getByRole('button', { name: 'New', exact: true }).click();
  ok(await p.getByRole('alertdialog').isVisible(), 'New asks before discarding');
  await p.getByRole('button', { name: 'Cancel' }).click();
  ok((await doc()).layers.length === 1, 'Cancel keeps the work');
  await p.getByRole('button', { name: 'New', exact: true }).click();
  await p.getByRole('button', { name: 'Discard and start new' }).click();
  await p.waitForTimeout(800);
  ok((await doc()).layers.length === 0 && (await p.getByText('Bring a drawing to life').isVisible()), 'Discard returns to the start screen with an empty canvas');
  await p.getByText('Pick up where you left off').click();
  await p.waitForFunction(() => window.stillwave.store.getState().doc.layers.length === 1);
  ok((await doc()).name.includes('Mio'), 'the discarded work can be picked up again from the start screen');

  console.log(errs.length ? 'CONSOLE ERRORS:\n' + errs.join('\n') : 'no console errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close();
})().catch((e) => { console.error('TEST CRASH', e); process.exit(1); });
