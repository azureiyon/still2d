const { chromium } = require('playwright');
exports.open = async (opts = {}) => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['microphone'], ...opts });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  await p.goto('http://localhost:5173/');
  await p.waitForTimeout(600);
  return { b, p, errs, ctx };
};
