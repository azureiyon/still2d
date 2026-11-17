// Standalone Stillwave avatar runtime. The editor inlines this bundle plus a
// project into a single HTML file that works offline and as an OBS browser
// source. Options (query string): ?bg=00ff00  ?mood=2  ?mic=1  ?follow=0
import { unpackProject, type ProjectFile } from '../engine/assets';
import { fitView, Renderer } from '../engine/gl';
import { Animator } from '../engine/rig';
import { Voice } from '../engine/voice';

async function boot() {
  const canvas = document.getElementById('stillwave') as HTMLCanvasElement;
  const file = JSON.parse(document.getElementById('stillwave-project')!.textContent!) as ProjectFile;
  const doc = await unpackProject(file);
  const q = new URLSearchParams(location.search);
  const bg = q.get('bg');
  if (bg) document.body.style.background = /^[0-9a-f]{6}$/i.test(bg) ? `#${bg}` : bg;
  if (q.get('follow') === '0') doc.motion.look.follow = false;

  const renderer = new Renderer(canvas);
  const anim = new Animator(Date.now() & 0xffff);
  const mood = Number(q.get('mood') || 1) - 1;
  anim.exprId = doc.expressions[mood]?.id ?? doc.expressions[0]?.id ?? null;
  anim.settle(doc);

  const voice = new Voice();
  if (q.get('mic') === '1') voice.start().catch(() => {});

  window.addEventListener('pointermove', (e) => {
    anim.pointer = { x: (e.clientX / innerWidth) * 2 - 1, y: (e.clientY / innerHeight) * 2 - 1 };
  });
  document.addEventListener('pointerleave', () => (anim.pointer = null));
  window.addEventListener('pointerdown', () => anim.nudge(1));
  window.addEventListener('keydown', (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= doc.expressions.length) anim.exprId = doc.expressions[n - 1].id;
    if (e.key === 'm') voice.active ? voice.stop() : voice.start().catch(() => {});
  });

  let last = performance.now();
  const frame = (now: number) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.resize(Math.round(innerWidth * dpr), Math.round(innerHeight * dpr));
    anim.voice = voice.level();
    const f = anim.step((now - last) / 1000, doc);
    last = now;
    renderer.render(doc, f, fitView(doc, canvas.width, canvas.height));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  document.body.textContent = `Stillwave avatar failed to start: ${err?.message ?? err}`;
});
