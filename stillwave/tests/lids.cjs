const { open } = require('./lib.cjs');
(async () => {
  const { b, p, errs } = await open({ deviceScaleFactor: 1 });
  const which = process.argv[2] || 'layers';
  await p.getByText(which === 'flat' ? 'Mio, flattened' : 'Meet Mio, in layers').click();
  await p.waitForTimeout(500);
  const clip = { x: 560, y: 230, width: 320, height: 260 }; p.setDefaultTimeout(90000);
  const st = (fn, a) => p.evaluate(fn, a);
  // freeze idle; scrub lids by hand
  await st(() => { const s = window.stillwave.store.getState(); s.set({ playing: false, tab: 'rhythm', zoneId: null }); });
  await p.waitForTimeout(700);
  for (const v of [0, 0.35, 0.7, 1]) {
    await st((v) => { window.stillwave.live.scrubAll = v; }, v);
    await p.waitForTimeout(400);
    await p.screenshot({ path: `test-out/${which}-lid-${v}.png`, clip });
  }
  await st(() => { window.stillwave.live.scrubAll = null; });
  const moods = await st(() => window.stillwave.store.getState().doc.expressions.map((e) => [e.id, e.name]));
  await st(() => window.stillwave.store.getState().set({ tab: 'mood' }));
  for (const [id, name] of moods) {
    await st((id) => window.stillwave.store.getState().set({ exprId: id }), id);
    await p.waitForTimeout(900);
    await p.screenshot({ path: `test-out/${which}-mood-${name}.png`, clip });
  }
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})();
