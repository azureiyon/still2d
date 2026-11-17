import { useRef } from 'react';
import { useStore } from '../state/store';

const W = 268, H = 92, PAD = 14, TOP = 16, BOT = 70;

/** The shape of one blink, drawn as the lid's height over time. Drag the three points. */
export function BlinkEditor() {
  const blink = useStore((s) => s.doc.motion.blink);
  const edit = useStore((s) => s.edit);
  const scaleRef = useRef<number | null>(null);
  const total = blink.close + blink.hold + blink.open;
  const span = scaleRef.current ?? Math.max(0.45, total * 1.3);
  const k = (W - PAD * 2) / span;
  const x1 = PAD + blink.close * k, x2 = x1 + blink.hold * k, x3 = x2 + blink.open * k;

  const pts: string[] = [];
  for (let i = 0; i <= 12; i++) { const u = i / 12; pts.push(`${PAD + (x1 - PAD) * u},${TOP + (BOT - TOP) * (u * u * (3 - 2 * u))}`); }
  pts.push(`${x2},${BOT}`);
  for (let i = 1; i <= 16; i++) { const u = i / 16; pts.push(`${x2 + (x3 - x2) * u},${TOP + (BOT - TOP) * ((1 - u) * (1 - u) * (1 - u * 0.5))}`); }
  pts.push(`${W - PAD},${TOP}`);

  const dragger = (which: 'close' | 'hold' | 'open') => ({
    onPointerDown: (e: React.PointerEvent<SVGCircleElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      scaleRef.current = span;
    },
    onPointerMove: (e: React.PointerEvent<SVGCircleElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const svg = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
      const t = ((e.clientX - svg.left) * (W / svg.width) - PAD) / k;
      edit((d) => {
        const b = d.motion.blink;
        if (which === 'close') b.close = Math.min(0.3, Math.max(0.03, t));
        if (which === 'hold') b.hold = Math.min(0.4, Math.max(0, t - b.close));
        if (which === 'open') b.open = Math.min(0.6, Math.max(0.05, t - b.close - b.hold));
      }, 'blink-shape');
    },
    onPointerUp: () => { scaleRef.current = null; },
  });

  return (
    <div className="blink-editor">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Blink shape: lid height over time">
        <line x1={PAD} y1={TOP} x2={W - PAD} y2={TOP} className="blink-guide" />
        <line x1={PAD} y1={BOT} x2={W - PAD} y2={BOT} className="blink-guide" />
        <text x={PAD} y={TOP - 5} className="blink-text">open</text>
        <text x={PAD} y={BOT + 14} className="blink-text">closed</text>
        <text x={W - PAD} y={BOT + 14} className="blink-text" textAnchor="end">{Math.round(total * 1000)} ms</text>
        <polygon points={`${PAD},${TOP} ${pts.join(' ')} ${W - PAD},${TOP}`} className="blink-area" />
        <polyline points={pts.join(' ')} className="blink-line" />
        <circle cx={x1} cy={BOT} r={6.5} className="blink-dot" {...dragger('close')}><title>How fast the eye closes</title></circle>
        <circle cx={x2} cy={BOT} r={6.5} className="blink-dot" {...dragger('hold')}><title>How long it stays shut</title></circle>
        <circle cx={x3} cy={TOP} r={6.5} className="blink-dot" {...dragger('open')}><title>How slowly it opens again</title></circle>
      </svg>
    </div>
  );
}
