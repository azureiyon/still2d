// Deterministic eye renders (offscreen, the app's own renderer): simple vs converted precise
// at five closures, and crease follow 100% vs 40% on a precise eye with a tall carried band.
const { open } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const { b, p, errs } = await open();
  p.setDefaultTimeout(200000);
  await p.getByText(process.argv[2] || 'Mio, flattened').click();
  await p.waitForTimeout(800);
  const out = await p.evaluate(async () => {
    const { Renderer } = await import('/src/engine/gl.ts');
    const g = await import('/src/engine/geom.ts');
    const base = window.stillwave.store.getState().doc;
    const eye = base.zones.find((z) => z.type === 'eye');
    const c = document.createElement('canvas'); c.width = 900; c.height = 1100;
    const r = new Renderer(c);
    const K = 4, box = g.eyeBox(eye);
    const view = { zoom: K, panX: -box.x * K, panY: -box.y * K };
    c.width = Math.round(box.w * K); c.height = Math.round(box.h * K);
    const frame = (up) => ({ head: { turn: 0, nod: 0, tilt: 0 }, breath: 0, body: { rot: 0, bob: 0 }, eyes: { [eye.id]: { upper: up, lower: up * 0.18, arc: 0, gx: 0, gy: 0 } }, mouths: {}, sway: {}, layerAlpha: {}, liveliness: 1 });
    const docWith = (z) => ({ ...base, zones: [{ ...eye, ...z }] });
    const grab = (doc, up) => { r.render(doc, frame(up), view); const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const x = o.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0); return { url: o.toDataURL(), px: x.getImageData(0, 0, o.width, o.height).data }; };
    const precise = { edit: 'precise', curves: g.curvesFromSimple(eye) };
    const shots = [], diff = {};
    for (const up of [0, 0.25, 0.5, 0.75, 1]) {
      const a = grab(docWith({}), up), bb = grab(docWith(precise), up);
      let max = 0, over = 0;
      for (let i = 0; i < a.px.length; i += 4) { const d = Math.max(Math.abs(a.px[i] - bb.px[i]), Math.abs(a.px[i + 1] - bb.px[i + 1]), Math.abs(a.px[i + 2] - bb.px[i + 2])); max = Math.max(max, d); if (d > 16) over++; }
      diff[`${up * 100}%`] = { maxChannelDiff: max, pixelsOver16: over, of: a.px.length / 4 };
      shots.push([`simple ${up * 100}%`, a.url], [`precise ${up * 100}%`, bb.url]);
    }
    // a tall carried band (lashes + crease), closed, crease follow 100% vs 40%
    const tall = g.curvesFromSimple({ ...eye, band: eye.band + 10 });
    for (const follow of [1, 0.4]) shots.push([`band +10 px, crease follow ${follow * 100}%, closed`, grab(docWith({ edit: 'precise', curves: tall, follow }), 1).url]);
    return { shots, diff, size: [c.width, c.height] };
  });
  fs.mkdirSync('test-out/eyefid', { recursive: true });
  out.shots.forEach(([n, u], i) => fs.writeFileSync(`test-out/eyefid/${i}.png`, Buffer.from(u.split(',')[1], 'base64')));
  fs.writeFileSync('test-out/eyefid/labels.json', JSON.stringify(out.shots.map((s) => s[0])));
  console.log(JSON.stringify(out.diff, null, 1));
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
