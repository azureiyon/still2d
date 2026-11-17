// Real-illustration blink test. Uses the demo frame from the reference repo, read from the scratchpad (never copied into this project).
const { open } = require('./lib.cjs');
const REF = process.env.STILLWAVE_REF_IMAGE; if (!REF) { console.log('Set STILLWAVE_REF_IMAGE to an illustration with two visible eyes (the eye positions below are for the reference demo.jpg).'); process.exit(0); }
(async () => {
  const { b, p, errs } = await open();
  p.setDefaultTimeout(100000);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose artwork').click()]);
  await fc.setFiles(REF);
  await p.waitForFunction(() => window.stillwave.store.getState().doc.layers.length === 1);
  const S = (fn, a) => p.evaluate(fn, a);
  await S(() => {
    const { store, live } = window.stillwave;
    const s = store.getState();
    const eye = (name, a, b, upT, upH, loH, band, skin) => ({
      id: 'eye_' + name, type: 'eye', name, enabled: true, layers: 'all', a, b, upT, upH, loT: 0, loH, upRound: 0.8, loRound: 0.9,
      band, loBand: 1, skin, meet: 0.05, gaze: 0.5, pair: null, upPts: [], loPts: [], fill: 'soft', roll: 0.4, box: null, paint: null, ctl: null,
    });
    s.edit((d) => {
      d.zones.push(eye('L', { x: 290, y: 245 }, { x: 337, y: 241 }, -0.05, 5, 6, 6, 5));
      d.zones.push(eye('R', { x: 394, y: 226 }, { x: 438, y: 215 }, 0.0, 6, 5, 6, 5));
    });
    s.set({ mode: 'motion', playing: false, panels: false, tab: 'rhythm', zoneId: null });
    live.view = { zoom: 5, panX: -1100, panY: -700 };
  });
  const clip = { x: 150, y: 150, width: 1150, height: 550 };
  const shot = async (name) => { await p.waitForTimeout(700); await p.screenshot({ path: `test-out/real-${name}.png`, clip }); };
  const toScreen = (x, y) => [x * 5 - 1100, y * 5 - 700];
  const stroke = async (pts) => { const [x0, y0] = toScreen(...pts[0]); await p.mouse.move(x0, y0); await p.mouse.down(); for (const q of pts.slice(1)) { const [x, y] = toScreen(...q); await p.mouse.move(x, y, { steps: 6 }); } await p.mouse.up(); await p.waitForTimeout(250); };
  const clean = (on) => S((on) => window.stillwave.store.getState().set({ tab: on ? 'mood' : 'motion' }), on);
  // 1. automatic result, both skin modes
  await clean(true);
  for (const fill of ['soft', 'stretch']) {
    await S((fill) => { const s = window.stillwave.store.getState(); s.edit((d) => { for (const z of d.zones) if (z.type === 'eye') z.fill = fill; }); }, fill);
    for (const v of [0, 0.5, 1]) { await S((v) => { window.stillwave.live.scrubAll = v; }, v); await shot(`${fill}-${v}`); }
  }
  // 2. refine the left eye by hand, with the real tools: Keep the fringe, then clone lid skin
  await S(() => { const s = window.stillwave.store.getState(); window.stillwave.live.scrubAll = null; s.edit((d) => { for (const z of d.zones) if (z.type === 'eye') z.fill = 'soft'; }); s.set({ tab: 'motion', zoneId: 'eye_L', tool: 'brush', eyeLayer: 'keep', brush: { ...s.brush, size: 7, soft: 0.5 }, lidHold: { eye_L: 1 } }); });
  await stroke([[339, 222], [334, 238], [329, 252]]);
  await stroke([[296, 226], [301, 236], [303, 246]]);
  await shot('keep-editing');
  await S(() => { const s = window.stillwave.store.getState(); s.set({ tool: 'clone', eyeLayer: 'skin', brush: { ...s.brush, size: 9, soft: 0.7, opacity: 1 } }); });
  await p.keyboard.down('Alt'); { const [x, y] = toScreen(316, 229); await p.mouse.click(x, y); } await p.keyboard.up('Alt');
  await stroke([[306, 238], [314, 237], [322, 237]]);
  await stroke([[306, 243], [314, 242], [322, 242]]);
  await shot('skin-editing');
  const z = await S(() => window.stillwave.store.getState().doc.zones[0]);
  console.log('eye L paint:', !!z.paint, 'marks:', !!z.ctl, 'box:', JSON.stringify(z.box), 'undo steps:', await S(() => window.stillwave.store.getState().past.length));
  await clean(true);
  await S(() => window.stillwave.store.getState().set({ zoneId: null, tool: 'move' }));
  for (const v of [0, 0.5, 1]) { await S((v) => { window.stillwave.live.scrubAll = v; }, v); await shot(`refined-${v}`); }
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
