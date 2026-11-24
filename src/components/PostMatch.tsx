import { useMemo, useState } from 'react';
import { Trophy, RotateCcw } from 'lucide-react';
import { recorder, useStore } from '../store';
import type { MatchEvent, TeamId } from '../../shared/types';
import { Card, PitchCanvas, cx } from './ui';
import { EventTicker, StatsTable } from './Match';
import { TEAM_COLORS } from '../pitch';

export function PostMatch() {
  const { view, leave, events } = useStore();
  const res = view?.result;
  const [idx, setIdx] = useState(Math.max(0, recorder.frames.length - 1));
  const [sel, setSel] = useState<MatchEvent | null>(null);
  const me = (view?.seat ?? 0) as TeamId;
  const evs = res?.events ?? events;
  const frames = recorder.frames;
  const source = useMemo(() => () => { const f = frames[Math.min(idx, frames.length - 1)]; return f ? { a: f, b: f, alpha: 0 } : null; }, [idx, frames]);
  const turning = useMemo(() => evs.filter((e) => e.importance >= 5 && (e.type === 'goal' || e.type === 'red' || e.type === 'penalty' || e.type === 'chance' || e.type === 'save' || e.type === 'sub')).sort((a, b) => b.importance - a.importance).slice(0, 6).sort((a, b) => a.tick - b.tick), [evs]);
  // cumulative xG series
  const series = useMemo(() => {
    const pts: { t: number; a: number; b: number }[] = [{ t: 0, a: 0, b: 0 }]; let a = 0, b = 0;
    for (const e of evs) if (e.xg !== undefined && (e.team === 0 || e.team === 1)) { if (e.team === 0) a += e.xg; else b += e.xg; pts.push({ t: e.tick, a, b }); }
    return pts;
  }, [evs]);
  if (!view || !res) return <div className="p-10 text-center text-slate-400">Loading result…</div>;
  const [s0, s1] = res.score;
  const verdict = s0 === s1 ? 'Draw' : (s0 > s1 ? 0 : 1) === me ? 'Victory' : 'Defeat';
  const maxT = Math.max(1, frames[frames.length - 1]?.tick ?? 1);
  const maxX = Math.max(0.5, ...series.map((p) => Math.max(p.a, p.b)));
  const path = (k: 'a' | 'b') => series.map((p, i) => `${i ? 'L' : 'M'}${(p.t / maxT) * 300},${80 - (p[k] / maxX) * 74}`).join(' ') + ` L300,${80 - (series[series.length - 1][k] / maxX) * 74}`;
  const jump = (e: MatchEvent) => { setSel(e); let best = 0; frames.forEach((f, i) => { if (Math.abs(f.tick - (e.tick - 25)) < Math.abs(frames[best].tick - (e.tick - 25))) best = i; }); setIdx(best); };
  const f = frames[Math.min(idx, frames.length - 1)];
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="text-center">
        <div className="mx-auto mb-2 inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-xs font-bold uppercase text-amber-300"><Trophy className="h-3.5 w-3.5" />Full time</div>
        <div className="font-display text-6xl font-bold uppercase text-white">{verdict}</div>
        <div className="mt-1 flex items-center justify-center gap-5 font-display text-4xl font-bold">
          <span style={{ color: TEAM_COLORS[0].css }} className="text-2xl">{view.names[0]}</span><span className="text-white">{s0} – {s1}</span><span style={{ color: TEAM_COLORS[1].css }} className="text-2xl">{view.names[1]}</span>
        </div>
        <button className="btn btn-primary mt-4" onClick={leave}><RotateCcw className="h-4 w-4" />Play again</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Match stats"><StatsTable stats={res.stats} names={view.names} /></Card>
        <Card title="Cumulative xG" right={<span className="text-xs text-slate-400">{res.stats[0].xg.toFixed(2)} – {res.stats[1].xg.toFixed(2)}</span>}>
          <svg viewBox="0 0 300 90" className="w-full"><line x1="0" y1="80" x2="300" y2="80" stroke="#ffffff22" /><line x1="150" y1="0" x2="150" y2="80" stroke="#ffffff22" strokeDasharray="3" />
            <path d={path('a')} fill="none" stroke={TEAM_COLORS[0].css} strokeWidth="2" /><path d={path('b')} fill="none" stroke={TEAM_COLORS[1].css} strokeWidth="2" strokeDasharray="5 2" />
            {evs.filter((e) => e.type === 'goal').map((e) => <circle key={e.id} cx={(e.tick / maxT) * 300} cy={80 - ((e.team === 0 ? series.filter((p) => p.t <= e.tick).pop()?.a : series.filter((p) => p.t <= e.tick).pop()?.b) ?? 0) / maxX * 74} r="3.5" fill={e.team === 0 ? TEAM_COLORS[0].css : TEAM_COLORS[1].css} stroke="#fff" />)}
          </svg>
          <div className="flex justify-between text-[11px] text-slate-500"><span>Kick-off</span><span>Half-time</span><span>Full-time</span></div>
        </Card>
      </div>
      <Card title="Turning points & replay" right={<span className="text-xs text-slate-400">scrub the whole match or jump to a moment</span>}>
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div>
            <div className="relative aspect-[105/68] w-full overflow-hidden rounded-xl border border-white/10 bg-black"><PitchCanvas source={source} overlays={{ lanes: false, space: false, line: true, press: false }} mySeat={me} /></div>
            <input type="range" min={0} max={Math.max(0, frames.length - 1)} value={idx} onChange={(e) => { setIdx(+e.target.value); setSel(null); }} className="mt-2 w-full accent-emerald-500" />
            <div className="flex justify-between text-xs text-slate-400"><span>{f?.label ?? ''} · {f ? `${f.score[0]}–${f.score[1]}` : ''}</span><span>{frames.length} frames</span></div>
          </div>
          <div className="space-y-2">
            {turning.map((e) => (
              <button key={e.id} onClick={() => jump(e)} className={cx('w-full rounded-lg border p-2 text-left', sel?.id === e.id ? 'border-emerald-400/60 bg-emerald-400/10' : 'border-white/10 bg-white/5 hover:bg-white/10')}>
                <div className="flex items-center gap-2 text-sm"><span className="font-mono text-xs text-slate-400">{e.label}</span><span className="font-semibold text-white">{e.text}</span></div>
                {e.causes.length > 0 && <ul className="mt-1 list-disc pl-5 text-[11px] text-slate-400">{e.causes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
              </button>
            ))}
            {!turning.length && <p className="text-sm text-slate-500">A quiet match — no decisive moments recorded.</p>}
          </div>
        </div>
      </Card>
      <Card title="Full match log"><div className="max-h-96 overflow-y-auto"><EventTicker events={evs} seat={me} names={view.names} limit={400} minImp={2} /></div></Card>
    </div>
  );
}
