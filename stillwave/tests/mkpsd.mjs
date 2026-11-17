import { writePsdBuffer } from 'ag-psd';
import fs from 'fs';
const mk = (w, h, rgba) => { const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) data.set(rgba, i * 4); return { width: w, height: h, data }; };
const psd = { width: 400, height: 500, children: [
  { name: 'body', left: 100, top: 250, imageData: mk(200, 250, [120, 160, 220, 255]) },
  { name: 'face group', children: [ { name: 'head', left: 120, top: 60, imageData: mk(160, 200, [255, 224, 200, 255]) }, { name: 'secret', hidden: true, left: 10, top: 10, imageData: mk(40, 40, [255, 0, 0, 255]) } ] },
  { name: 'hair', left: 110, top: 40, opacity: 0.5, imageData: mk(180, 60, [90, 60, 40, 255]) },
] };
fs.writeFileSync('tests/fixtures/art.psd', writePsdBuffer(psd, { generateThumbnail: false }));
console.log('psd written');
