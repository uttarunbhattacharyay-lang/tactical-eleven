import { X, TrendingUp, TrendingDown, MapPin, Activity } from 'lucide-react';
import type { MatchEvent, PlayerCard, Pos, SkillKey } from '../../shared/types';
import { SKILL_KEYS, SKILL_LABELS } from '../../shared/types';
import { bestPositions, strengths, weaknesses, POS_NAME } from '../../shared/insight';
import { posFit } from '../../shared/formations';
import { TEAM_COLORS } from '../pitch';
import { Bar, EnergyBar, OvrBadge, PosBadge, cx } from './ui';

const skillColor = (v: number) => (v >= 80 ? '#34d399' : v >= 65 ? '#a3e635' : v >= 50 ? '#fbbf24' : '#94a3b8');

export interface LiveInfo { en: number; yellow: boolean; sentOff: boolean; zone?: Pos; onPitch: boolean }

/** Detailed player card: rating, strengths, weaknesses, best positions, all attributes and live match data. */
export function PlayerInfo({ p, team, side, live, events, onClose, className }: {
  p: PlayerCard; team: 0 | 1; side: 'mine' | 'opp'; live?: LiveInfo | null; events?: MatchEvent[]; onClose?: () => void; className?: string;
}) {
  const st = strengths(p), wk = weaknesses(p), best = bestPositions(p);
  const keys = (p.group === 'GK' ? SKILL_KEYS : SKILL_KEYS.filter((k) => k !== 'goalkeeping')) as readonly SkillKey[];
  const mine = events?.filter((e) => e.playerId === p.id) ?? [];
  const goals = mine.filter((e) => e.type === 'goal').length;
  const yellows = mine.filter((e) => e.type === 'yellow').length, reds = mine.filter((e) => e.type === 'red').length;
  const fit = live?.zone ? posFit(p.pos, live.zone) : null;
  return (
    <section className={cx('panel space-y-3 p-3', className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-display text-2xl font-bold text-white" style={{ background: TEAM_COLORS[team].fill }}>{p.number || '–'}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: TEAM_COLORS[team].css }}>{side === 'mine' ? 'Your squad' : 'Opposition'}</div>
          <div className="truncate font-display text-xl font-bold uppercase leading-tight text-white" title={p.name}>{p.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400"><PosBadge p={p} /><span>{POS_NAME[p.pos]}</span><span>· {p.archetype}</span></div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <OvrBadge v={p.ovr} />
          {onClose && <button onClick={onClose} title="Close" className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>}
        </div>
      </div>

      {live && (
        <div className="space-y-1.5 rounded-lg border border-white/10 bg-ink-900/60 p-2 text-xs">
          <div className="flex items-center gap-1 font-semibold text-slate-300"><Activity className="h-3.5 w-3.5" />Live</div>
          {live.sentOff ? <div className="text-rose-300">Sent off</div> : !live.onPitch ? <div className="text-slate-400">On the bench</div> : (
            <>
              <div className="flex items-center gap-2"><span className="w-14 text-slate-400">Stamina</span><div className="flex-1"><EnergyBar en={live.en} /></div><span className="w-9 text-right font-semibold text-white">{Math.round(live.en * 100)}%</span></div>
              {live.zone && <div className="flex items-center gap-2"><span className="w-14 text-slate-400">Playing</span><span className="font-semibold text-white">{live.zone}</span>{fit !== null && <span className={cx('chip', fit >= 0.95 ? 'text-emerald-300' : fit >= 0.8 ? 'text-amber-300' : 'text-rose-300')}>{Math.round(fit * 100)}% fit</span>}</div>}
            </>
          )}
          {events && <div className="flex gap-3 text-slate-300"><span>Goals <b className="text-white">{goals}</b></span>{(yellows > 0 || live.yellow) && <span className="text-yellow-300">Yellow card</span>}{reds > 0 && <span className="text-rose-300">Red card</span>}</div>}
        </div>
      )}

      <div>
        <div className="label mb-1 flex items-center gap-1 text-emerald-300"><TrendingUp className="h-3.5 w-3.5" />Strengths</div>
        <ul className="space-y-1">{st.map((s) => <li key={s.key} className="flex gap-2 text-xs text-slate-200"><span className="w-8 shrink-0 font-bold text-emerald-300">{s.value}</span><span>{s.text}</span></li>)}</ul>
      </div>
      <div>
        <div className="label mb-1 flex items-center gap-1 text-rose-300"><TrendingDown className="h-3.5 w-3.5" />Weaknesses</div>
        {wk.length ? <ul className="space-y-1">{wk.map((s) => <li key={s.key} className="flex gap-2 text-xs text-slate-200"><span className="w-8 shrink-0 font-bold text-rose-300">{s.value}</span><span>{s.text}</span></li>)}</ul>
          : <p className="text-xs text-slate-400">No clear weaknesses for this position.</p>}
      </div>
      <div>
        <div className="label mb-1 flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />Best positions</div>
        <div className="flex flex-wrap gap-1.5">{best.map((b, i) => <span key={b.pos} title={POS_NAME[b.pos]} className={cx('rounded-md border px-2 py-1 text-xs', i === 0 ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-white/5 text-slate-200')}><b>{b.pos}</b> <span className="text-slate-400">{b.rating}</span></span>)}</div>
      </div>
      <div>
        <div className="label mb-1">Attributes</div>
        <div className="space-y-1">
          {keys.map((k) => (
            <div key={k}>
              <div className="flex justify-between text-[11px]"><span className="text-slate-400">{SKILL_LABELS[k]}</span><span className="font-semibold text-slate-100">{p.skills[k]}</span></div>
              <Bar value={p.skills[k]} color={skillColor(p.skills[k])} h={4} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function InfoPlaceholder({ className, text }: { className?: string; text?: string }) {
  return (
    <section className={cx('panel flex flex-col items-center justify-center gap-1 p-6 text-center', className)}>
      <div className="font-display text-lg font-semibold uppercase text-white">Player details</div>
      <p className="text-xs text-slate-400">{text ?? 'Click any player — yours or the opposition — to see their strengths, weaknesses, attributes and best positions.'}</p>
    </section>
  );
}
