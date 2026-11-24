import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PlayerCard, Snapshot, SkillKey } from '../../shared/types';
import { SKILL_KEYS, SKILL_SHORT, SKILL_LABELS } from '../../shared/types';
import { PitchRenderer, type Overlays, staminaColor } from '../pitch';
import { useStore } from '../store';

export function cx(...a: (string | false | null | undefined)[]) { return a.filter(Boolean).join(' '); }

export function useNow(ms = 250) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setN(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return n;
}

export function Bar({ value, color, h = 6 }: { value: number; color?: string; h?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full bg-white/10" style={{ height: h }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color ?? '#34d399' }} />
    </div>
  );
}
export function EnergyBar({ en }: { en: number }) { return <Bar value={en * 100} color={staminaColor(en)} />; }

const GROUP_COLOR: Record<string, string> = { GK: 'bg-amber-500/20 text-amber-300', DEF: 'bg-sky-500/20 text-sky-300', MID: 'bg-emerald-500/20 text-emerald-300', ATT: 'bg-rose-500/20 text-rose-300' };
export function PosBadge({ p }: { p: PlayerCard }) {
  return <span className={cx('inline-block w-10 rounded px-1 py-0.5 text-center text-[11px] font-bold', GROUP_COLOR[p.group])}>{p.pos}</span>;
}
export function OvrBadge({ v }: { v: number }) {
  const c = v >= 80 ? 'bg-emerald-400 text-ink-950' : v >= 70 ? 'bg-lime-400/90 text-ink-950' : v >= 60 ? 'bg-amber-400/90 text-ink-950' : 'bg-slate-500 text-white';
  return <span className={cx('inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold', c)}>{v}</span>;
}
const skillColor = (v: number) => (v >= 80 ? '#34d399' : v >= 65 ? '#a3e635' : v >= 50 ? '#fbbf24' : '#94a3b8');
export function SkillGrid({ p, compact = false }: { p: PlayerCard; compact?: boolean }) {
  const keys = (p.group === 'GK' ? SKILL_KEYS : SKILL_KEYS.filter((k) => k !== 'goalkeeping')) as readonly SkillKey[];
  return (
    <div className={cx('grid gap-x-3 gap-y-1', compact ? 'grid-cols-5' : 'grid-cols-2')}>
      {keys.map((k) => (
        <div key={k} title={`${SKILL_LABELS[k]}: ${p.skills[k]}%`} className="min-w-0">
          <div className="flex justify-between text-[10px] text-slate-400"><span>{SKILL_SHORT[k]}</span><span className="font-semibold text-slate-200">{p.skills[k]}%</span></div>
          <Bar value={p.skills[k]} color={skillColor(p.skills[k])} h={4} />
        </div>
      ))}
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, size = 'md' }: { value: T; options: { v: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5">
      {options.map((o) => (
        <button key={String(o.v)} title={o.title} onClick={() => onChange(o.v)}
          className={cx('rounded-md font-semibold transition', size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm', value === o.v ? 'bg-emerald-500 text-ink-950' : 'text-slate-300 hover:bg-white/10')}>{o.label}</button>
      ))}
    </div>
  );
}

export function Slider({ label, value, onChange, onCommit, hint }: { label: string; value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; hint?: string }) {
  return (
    <div>
      <div className="flex justify-between"><span className="label">{label}</span><span className="text-xs font-semibold text-slate-200">{value}{hint ? ` · ${hint}` : ''}</span></div>
      <input type="range" min={0} max={100} value={value} className="w-full accent-emerald-500"
        onChange={(e) => onChange(+e.target.value)} onMouseUp={(e) => onCommit?.(+(e.target as HTMLInputElement).value)} onTouchEnd={(e) => onCommit?.(+(e.target as HTMLInputElement).value)} onKeyUp={(e) => onCommit?.(+(e.target as HTMLInputElement).value)} />
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto max-w-sm rounded-lg border px-3 py-2 text-sm shadow-xl', t.kind === 'error' ? 'border-rose-400/40 bg-rose-950/90 text-rose-100' : t.kind === 'ok' ? 'border-emerald-400/40 bg-emerald-950/90 text-emerald-100' : 'border-white/15 bg-ink-700/95 text-slate-100')}>{t.text}</div>
      ))}
    </div>
  );
}

export function Card({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('panel p-4', className)}>
      {(title || right) && <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-display text-lg font-semibold uppercase tracking-wide text-white">{title}</h3>{right}</div>}
      {children}
    </section>
  );
}

type Src = (dtMs: number) => { a0?: Snapshot | null; a: Snapshot; b: Snapshot; alpha: number } | null;
/** Canvas pitch that renders interpolated snapshots at display refresh rate (~60 FPS). Click a player to select them. */
export function PitchCanvas({ source, overlays, mySeat, onHover, onPick, selected }: { source: Src; overlays: Overlays; mySeat: 0 | 1; onHover?: (idx: number | null) => void; onPick?: (idx: number | null) => void; selected?: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const rend = useRef<PitchRenderer | null>(null);
  const hover = useRef<number | null>(null);
  const ov = useRef(overlays); ov.current = overlays;
  const srcRef = useRef(source); srcRef.current = source;
  const seatRef = useRef(mySeat); seatRef.current = mySeat;
  const selRef = useRef(selected ?? null); selRef.current = selected ?? null;
  useEffect(() => {
    const canvas = ref.current!;
    const r = new PitchRenderer(canvas); rend.current = r;
    const fit = () => { r.resize(); };
    const ro = new ResizeObserver(fit); ro.observe(holder.current!); fit();
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(250, now - last); last = now;
      const sc = srcRef.current(dt);
      if (sc) r.render({ ...sc, roster: useStore.getState().roster, overlays: ov.current, mySeat: seatRef.current, hover: hover.current, selected: selRef.current });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return (
    <div ref={holder} className="relative h-full w-full">
      <canvas ref={ref} className={cx('absolute inset-0 h-full w-full rounded-lg', onPick && 'cursor-pointer')}
        onClick={(e) => { if (!onPick) return; const b = e.currentTarget.getBoundingClientRect(); onPick(rend.current?.pickAt(e.clientX - b.left, e.clientY - b.top) ?? null); }}
        onMouseMove={(e) => { const b = e.currentTarget.getBoundingClientRect(); const i = rend.current?.pickAt(e.clientX - b.left, e.clientY - b.top) ?? null; if (i !== hover.current) { hover.current = i; onHover?.(i); } }}
        onMouseLeave={() => { hover.current = null; onHover?.(null); }} />
    </div>
  );
}
