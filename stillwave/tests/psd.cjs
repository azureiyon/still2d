const { open } = require('./lib.cjs');
const fs = require('fs');
const path = require('path');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const { b, p, errs } = await open();
  p.setDefaultTimeout(60000);
  // PSD import
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose artwork').click()]);
  await fc.setFiles('tests/fixtures/art.psd');
  await p.waitForFunction(() => window.stillwave.store.getState().doc.layers.length >= 3);
  const d = await p.evaluate(() => window.stillwave.store.getState().doc);
  console.log(d.layers.map((l) => `${l.name} ${l.w}x${l.h} @${l.x},${l.y} vis=${l.visible} op=${l.opacity.toFixed(2)}`).join(' | '));
  ok(d.width === 400 && d.height === 500 && d.layers.length === 4 && d.layers[0].name === 'body' && d.layers[0].x === 200 && d.layers[0].y === 375, 'PSD layers imported with positions');
  ok(d.layers.find((l) => l.name === 'secret').visible === false && Math.abs(d.layers.find((l) => l.name === 'hair').opacity - 0.5) < 0.02, 'PSD hidden flag and opacity carried over');
  await p.waitForTimeout(600);
  await p.screenshot({ path: 'test-out/21-psd.png' });
  console.log(errs.join('\n') || 'no console errors');
  await b.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
