import { useRef, type ReactNode } from 'react';

const PATHS: Record<string, string> = {
  undo: 'M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12h-2',
  redo: 'M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 12h2',
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.7A9.8 9.8 0 0 1 12 5.5C18.4 5.5 22 12 22 12a17 17 0 0 1-3 3.7M6.5 7.3A16.600 16.600 0 0 0 2 12s3.600 6.500 10 6.500a9.500 9.500 0 0 0 3.500-.700',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  move: 'M5 3l14 7.500-6 2-2 6z',
  brush: 'M14 4l6 6-8.500 8.500c-1.500 1.500-3.500 1.500-5 1.500H4v-2.500c0-1.500 0-3.500 1.500-5zM11.500 6.500l6 6',
  erase: 'M4 16l9-11 7 6-8 9H7zM9 20h11',
  mirror: 'M12 3v18M8 7l-5 5 5 5zM16 7l5 5-5 5z',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  open: 'M3 7h6l2 2h10v10H3z',
  export: 'M12 15V3M7 8l5-5 5 5M4 14v6h16v-6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  mesh: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4',
  close: 'M6 6l12 12M18 6L6 18',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  panels: 'M3 4h18v16H3zM8 4v16M16 4v16',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.500 9.500h.010',
  spark: 'M12 3l2.200 6.800L21 12l-6.800 2.200L12 21l-2.200-6.800L3 12l6.800-2.200z',
  pick: 'M14.500 4.500a2.800 2.800 0 0 1 4 4L16 11l1 1-1.500 1.500-1-1-6.500 6.500H5v-3l6.500-6.500-1-1L12 7l1 1zM6.500 15.500l3 3',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
  path: 'M5 19c3-1 4-5 7-7s6-2 7-7M5 19h.010M12 12h.010M19 5h.010',
};

export function Icon({ name, size = 16, fill }: { name: string; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function IconButton(props: { icon: string; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; fill?: boolean; small?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      className={`icon-btn${props.active ? ' is-active' : ''}${props.small ? ' is-small' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.hint ?? props.label}
    >
      <Icon name={props.icon} fill={props.fill} size={props.small ? 14 : 16} />
    </button>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  reset?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  tint?: string;
  hint?: string;
}

/** A bar you grab anywhere along its length. Double-click returns it to its default. */
export function Slider({ label, value, min = 0, max = 1, step, reset, format, onChange, tint, hint }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const st = step ?? (max - min) / 100;
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / st) * st));
  const fromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(clamp(min + ((e.clientX - r.left - 6) / (r.width - 12)) * (max - min)));
  };
  const pct = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const text = format ? format(value) : `${Math.round(pct * 100)}`;
  return (
    <div
      ref={ref}
      className="slider"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={text}
      title={hint}
      style={tint ? ({ '--tint': tint } as React.CSSProperties) : undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        fromEvent(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && fromEvent(e)}
      onDoubleClick={() => reset !== undefined && onChange(reset)}
      onKeyDown={(e) => {
        const big = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { onChange(clamp(value + st * big)); e.preventDefault(); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { onChange(clamp(value - st * big)); e.preventDefault(); }
        if (e.key === 'Home') onChange(min);
        if (e.key === 'End') onChange(max);
      }}
    >
      <div className="slider-fill" style={{ width: `calc(6px + (100% - 12px) * ${pct})` }} />
      <span className="slider-label">{label}</span>
      <span className="slider-value">{text}</span>
    </div>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button type="button" className="toggle" role="switch" aria-checked={value} onClick={() => onChange(!value)} title={hint}>
      <span>{label}</span>
      <span className="toggle-track"><span className="toggle-knob" /></span>
    </button>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const secs = (v: number) => `${v.toFixed(v < 1 ? 2 : 1)} s`;
export const px = (v: number) => `${Math.round(v)} px`;
