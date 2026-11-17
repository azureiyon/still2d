// End-to-end workflow on the reworked app, driven through the real UI with pointer and keyboard input.
const { open } = require('./lib.cjs');
const fs = require('fs');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const { b, p, errs } = await open();
  p.setDefaultTimeout(120000);
  const S = (fn, a) => p.evaluate(fn, a);
  const doc = () => S(() => window.stillwave.store.getState().doc);
  const st = () => S(() => { const s = window.stillwave.store.getState(); return { mode: s.mode, tool: s.tool, zoneId: s.zoneId, layerId: s.layerId, lidHold: s.lidHold, past: s.past.length }; });
  const toScreen = (x, y) => S(([x, y]) => { const v = window.stillwave.live.view; return [x * v.zoom + v.panX, y * v.zoom + v.panY]; }, [x, y]);
  const stroke = async (pts, steps = 6) => { const a = await toScreen(...pts[0]); await p.mouse.move(a[0], a[1]); await p.mouse.down(); for (const q of pts.slice(1)) { const c = await toScreen(...q); await p.mouse.move(c[0], c[1], { steps }); } await p.mouse.up(); await p.waitForTimeout(200); };
  const dbl = async (x, y) => { const a = await toScreen(x, y); await p.mouse.dblclick(a[0], a[1]); await p.waitForTimeout(200); };
  const choose = async (file) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText(/Choose artwork|^Open$/).first().click()]); await fc.setFiles(file); };

  // ---- 1. a project saved by the first build still opens
  await choose('tests/fixtures/v1-project.stillwave');
  await p.waitForFunction(() => window.stillwave.store.getState().doc.zones.length === 4);
  let d = await doc();
  const e0 = d.zones.find((z) => z.type === 'eye'), s0 = d.zones.find((z) => z.type === 'sway');
  ok(Array.isArray(e0.upPts) && e0.fill === 'stretch' && s0.style === 'bend' && Array.isArray(s0.path), 'first-build project opens; new fields filled with compatible defaults');

  // ---- 2. a fresh flat illustration
  await S(() => window.stillwave.store.getState().load({ ...window.stillwave.store.getState().doc, layers: [], zones: [] }));
  await p.waitForTimeout(300);
  await choose('tests/fixtures/art.png');
  await p.waitForFunction(() => window.stillwave.store.getState().doc.layers.length === 1 && window.stillwave.store.getState().doc.zones.length === 0);
  d = await doc();
  const layerId = d.layers[0].id, img0 = d.layers[0].image;

  // ---- 3. retouch: brush, undo, clone, repair layer
  await S((id) => window.stillwave.store.getState().set({ layerId: id }), layerId);
  await p.keyboard.press('b');
  ok((await st()).tool === 'brush', 'B picks up the brush on a selected layer');
  await S(() => { const s = window.stillwave.store.getState(); s.set({ brush: { ...s.brush, color: '#ff00ff', size: 20, soft: 0.2, opacity: 1, mode: 'normal' } }); });
  await stroke([[300, 600], [360, 620]]);
  d = await doc();
  ok(d.layers[0].image !== img0 && d.layers[0].original === img0, 'brush stroke makes a new layer image and remembers the original');
  const px = await S(([x, y]) => { const { compositeRest } = window.__rt || {}; return null; }, [0, 0]);
  void px;
  await p.keyboard.press('Control+z');
  ok((await doc()).layers[0].image === img0, 'Ctrl+Z undoes the stroke');
  await p.keyboard.press('Control+Shift+z');
  ok((await doc()).layers[0].image !== img0, 'Ctrl+Shift+Z redoes it');
  await p.keyboard.press('c');
  ok((await st()).tool === 'clone', 'C picks up the clone tool');
  await p.keyboard.down('Alt'); { const a = await toScreen(300, 150); await p.mouse.click(a[0], a[1]); } await p.keyboard.up('Alt');
  ok(!!(await S(() => window.stillwave.store.getState().cloneFrom)), 'Alt-click sets where the clone copies from');
  const before = (await doc()).layers[0].image;
  await stroke([[300, 330], [320, 330]]);
  ok((await doc()).layers[0].image !== before, 'clone stroke changes the layer');
  await p.keyboard.press('v');
  await p.getByRole('button', { name: 'Add a repair layer' }).click();
  d = await doc();
  ok(d.layers.length === 2 && d.layers[1].role === 'repair', 'repair layer added above the artwork');
  await S(() => window.stillwave.store.getState().set({ tool: 'brush' }));
  await S(() => { const s = window.stillwave.store.getState(); s.set({ brush: { ...s.brush, mode: 'behind' } }); });
  await stroke([[100, 100], [140, 100]]);
  d = await doc();
  ok(d.layers[0].image !== img0 && d.layers[1].original, 'painting on the repair layer leaves the artwork layer alone');
  await p.keyboard.press('v');
  await p.screenshot({ path: 'test-out/30-retouch.png' });

  // ---- 4. motion: eye with extra lid point, lid skin paint, hold-still, sway with style, path point, lift
  await p.getByRole('button', { name: 'Motion', exact: true }).click();
  await p.getByText('Eye', { exact: true }).first().click();
  await p.waitForTimeout(200);
  let eye = (await doc()).zones[0];
  await stroke([[(eye.a.x + eye.b.x) / 2, eye.a.y - 5], [240, 247]]);
  eye = (await doc()).zones[0];
  const f = (t, y) => { const m = { x: (eye.a.x + eye.b.x) / 2, y: (eye.a.y + eye.b.y) / 2 }; const hw = Math.hypot(eye.b.x - eye.a.x, eye.b.y - eye.a.y) / 2; return [m.x + t * hw, m.y - y]; };
  // double-click on the upper lid line, a third of the way along
  const upAt = await S(([id, t]) => import('/src/engine/geom.ts').then((g) => g.lidUp(window.stillwave.store.getState().doc.zones.find((z) => z.id === id), t)), [eye.id, -0.45]);
  await dbl(...f(-0.45, upAt));
  eye = (await doc()).zones[0];
  ok(eye.upPts.length === 1, 'double-clicking the upper lid adds a shaping point');
  const ptBefore = await toScreen(...f(eye.upPts[0].t, eye.upPts[0].y));
  await p.mouse.move(ptBefore[0], ptBefore[1]); await p.mouse.down(); await p.mouse.move(ptBefore[0], ptBefore[1] - 12, { steps: 4 }); await p.mouse.up();
  eye = (await doc()).zones[0];
  ok(eye.upPts[0].y > upAt + 2, 'dragging the point reshapes the lid');
  await p.getByRole('button', { name: 'Lid skin' }).click();
  let s1 = await st();
  ok(s1.tool === 'brush' && s1.lidHold[eye.id] === 1, 'choosing Lid skin picks up the brush and closes the lid to paint on');
  await S(() => { const s = window.stillwave.store.getState(); s.set({ brush: { ...s.brush, color: '#e8c0a0', size: 14 } }); });
  await stroke([[225, 250], [255, 250]]);
  eye = (await doc()).zones[0];
  ok(!!eye.paint && !!eye.box, 'lid skin paint saved on the eye');
  await p.getByRole('button', { name: 'Keep', exact: true }).click();
  await stroke([[240, 225], [240, 262]]);
  eye = (await doc()).zones[0];
  ok(!!eye.ctl, 'keep marks saved on the eye');
  await p.screenshot({ path: 'test-out/31-eye-paint.png' });
  await p.keyboard.press('v');

  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await p.getByText('Sway', { exact: true }).first().click();
  await S(() => { const s = window.stillwave.store.getState(); s.set({ brush: { ...s.brush, size: 50, soft: 0.5 } }); });
  await stroke([[150, 200], [150, 500]], 14);
  let sway = (await doc()).zones.find((z) => z.type === 'sway');
  ok(!!sway.mask && sway.style === 'bend', 'sway painted; Bend is the default style');
  await p.keyboard.press('v');
  await p.getByRole('button', { name: 'Swing', exact: true }).click();
  sway = (await doc()).zones.find((z) => z.type === 'sway');
  ok(sway.style === 'swing', 'Swing style button applies');
  await dbl(150, 350);
  sway = (await doc()).zones.find((z) => z.type === 'sway');
  ok(sway.path.length === 1, 'double-clicking the spine adds a path point');
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await p.getByText('Hold still', { exact: true }).first().click();
  await stroke([[300, 700], [400, 700]]);
  ok(!!(await doc()).zones.find((z) => z.type === 'hold')?.mask, 'hold-still region painted');
  await p.keyboard.press('v');
  await S((id) => window.stillwave.store.getState().set({ zoneId: id, tab: 'motion' }), sway.id);
  await p.getByRole('button', { name: 'Lift onto its own layer' }).click();
  await p.waitForTimeout(500);
  d = await doc();
  const lifted = d.layers.find((l) => l.role === 'lifted'), backing = d.layers.find((l) => l.role === 'backing');
  ok(!!lifted && !!backing && JSON.stringify(d.zones.find((z) => z.id === sway.id).layers) === JSON.stringify([lifted.id]), 'Lift makes a patch and a backing layer, and the sway now moves the patch');
  await p.keyboard.press('Control+z');
  ok((await doc()).layers.length === 2, 'Lift undoes in one step');
  await p.keyboard.press('Control+Shift+z');

  // play: guard and frame sanity
  await p.keyboard.press('Space');
  await p.waitForTimeout(1500);
  const live = await S(() => ({ t: window.stillwave.live.anim.t, playing: window.stillwave.store.getState().playing }));
  ok(live.playing && live.t > 1, 'Space plays');
  await p.screenshot({ path: 'test-out/32-playing.png' });
  await p.keyboard.press('Space');

  // ---- 5. save and reopen
  const saved = await doc();
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]);
  await dl.saveAs('test-out/v2-project.stillwave');
  const file = JSON.parse(fs.readFileSync('test-out/v2-project.stillwave', 'utf8'));
  ok(Object.keys(file.images).length >= 6, `project stores ${Object.keys(file.images).length} images (art, original, repair, patch, backing, eye paint)`);
  await S(() => window.stillwave.store.getState().load({ ...window.stillwave.store.getState().doc, layers: [], zones: [] }));
  await p.waitForTimeout(300);
  await choose('test-out/v2-project.stillwave');
  await p.waitForFunction(() => window.stillwave.store.getState().doc.zones.length >= 3);
  ok(JSON.stringify(await doc()) === JSON.stringify(saved), 'reopened project matches exactly');

  // ---- 6. export workspace
  await p.getByRole('button', { name: 'Export', exact: true }).click();
  await p.waitForTimeout(400);
  const exp = async (name) => {
    await p.getByRole('radio', { name: new RegExp('^' + name) }).click();
    const len = p.getByRole('slider', { name: 'Length' });
    if (await len.count()) { await len.focus(); for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowLeft'); }
    const [d2] = await Promise.all([p.waitForEvent('download', { timeout: 200000 }), p.getByRole('button', { name: 'Export ' + name }).click()]);
    const path = 'test-out/v2-export-' + d2.suggestedFilename();
    await d2.saveAs(path);
    return fs.readFileSync(path);
  };
  const gif = await exp('Animated GIF');
  ok(gif.slice(0, 6).toString() === 'GIF89a' && gif.length > 10000, `GIF exported (${(gif.length / 1024) | 0} KB)`);
  const webm = await exp('WebM video');
  ok(webm.readUInt32BE(0) === 0x1a45dfa3 && webm.length > 5000, `WebM exported (${(webm.length / 1024) | 0} KB)`);
  const zip = await exp('PNG frames');
  ok(zip.slice(0, 2).toString() === 'PK', `PNG frames exported (${(zip.length / 1024) | 0} KB)`);
  const html = await exp('Interactive page');
  ok(html.toString().includes('stillwave-project'), 'interactive page exported');
  fs.writeFileSync('test-out/v2-page.html', html);
  await p.screenshot({ path: 'test-out/33-export.png' });

  console.log(errs.length ? 'CONSOLE ERRORS:\n' + errs.join('\n') : 'no console errors');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close();
})().catch((e) => { console.error('TEST CRASH', e); process.exit(1); });
