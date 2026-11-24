import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Eye, Volume2, VolumeX } from 'lucide-react';
import { setAmbient, sound } from '../sound';
import { playback, useStore } from '../store';
import type { MatchEvent, Snapshot, TeamId, TeamStats } from '../../shared/types';
import { F_YELLOW } from '../../shared/types';
import { shapePts, zoneOf } from '../../shared/formations';
import { SPEEDS } from '../../shared/protocol';
import { PlayerInfo, InfoPlaceholder } from './PlayerInfo';
import { AssistantManager } from './Assistant';
import { Card, PitchCanvas, Seg, cx } from './ui';
import { TEAM_COLORS, type Overlays } from '../pitch';
import { CommandPanel, MatchTacticsEditor, OpponentPanel, SquadPanel, useSeen } from './Panels';

const EV_ICON: Partial<Record<MatchEvent['type'], string>> = { goal: '⚽', yellow: '🟨', red: '🟥', sub: '🔁', penalty: '🎯', save: '🧤', shot: '💥', offside: '🚩', foul: '⚠️', corner: '◣', half: '⏸', full: '🏁', order: '📋', miss: '✖', chance: '✨', turnover: '↺' };

export function EventTicker({ events, seat, names, limit = 40, minImp = 0 }: { events: MatchEvent[]; seat: TeamId; names: [string, string]; limit?: number; minImp?: number }) {
  const list = events.filter((e) => e.importance >= minImp).slice(-limit).reverse();
  return (
    <div className="scroll-thin space-y-1.5 overflow-y-auto pr-1">
      {list.map((e) => (
        <div key={e.id} className={cx('rounded-lg border px-2.5 py-1.5', e.team === seat ? 'border-sky-400/20 bg-sky-400/5' : e.team === -1 ? 'border-white/5 bg-white/[0.03]' : 'border-pink-400/20 bg-pink-400/5')}>
          <div className="flex items-start gap-2 text-sm"><span className="w-10 shrink-0 font-mono text-xs text-slate-400">{e.label}</span><span className="shrink-0">{EV_ICON[e.type] ?? '•'}</span><span className="text-slate-100">{e.text}</span>{e.xg !== undefined && <span className="chip ml-auto shrink-0">xG {e.xg.toFixed(2)}</span>}</div>
          {e.causes.length > 0 && <ul className="ml-12 mt-0.5 list-disc pl-4 text-[11px] leading-snug text-slate-400">{e.causes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
        </div>
      ))}
      {!list.length && <p className="py-4 text-center text-xs text-slate-500">Nothing yet.</p>}
    </div>
  );
}

export function StatsTable({ stats, names }: { stats: [TeamStats, TeamStats]; names: [string, string] }) {
  const [a, b] = stats; const tp = Math.max(1, a.poss + b.poss);
  const rows: [string, string | number, string | number, number, number][] = [
    ['Possession', `${Math.round((a.poss / tp) * 100)}%`, `${Math.round((b.poss / tp) * 100)}%`, a.poss, b.poss],
    ['Expected goals', a.xg.toFixed(2), b.xg.toFixed(2), a.xg, b.xg],
    ['Shots (on target)', `${a.shots} (${a.onTarget})`, `${b.shots} (${b.onTarget})`, a.shots, b.shots],
    ['Passes (accuracy)', `${a.passes} (${a.passes ? Math.round((a.passesOk / a.passes) * 100) : 0}%)`, `${b.passes} (${b.passes ? Math.round((b.passesOk / b.passes) * 100) : 0}%)`, a.passes, b.passes],
    ['Tackles', a.tackles, b.tackles, a.tackles, b.tackles], ['Interceptions', a.intercepts, b.intercepts, a.intercepts, b.intercepts],
    ['Saves', a.saves, b.saves, a.saves, b.saves], ['Fouls', a.fouls, b.fouls, a.fouls, b.fouls], ['Corners', a.corners, b.corners, a.corners, b.corners],
    ['Offsides', a.offsides, b.offsides, a.offsides, b.offsides], ['Yellow cards', a.yellows, b.yellows, a.yellows, b.yellows], ['Red cards', a.reds, b.reds, a.reds, b.reds],
  ];
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 text-xs font-bold"><span style={{ color: TEAM_COLORS[0].css }} className="truncate">{names[0]}</span><span /><span style={{ color: TEAM_COLORS[1].css }} className="truncate text-right">{names[1]}</span></div>
      {rows.map(([l, x, y, nx, ny]) => (
        <div key={l}>
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 text-sm"><span className="font-semibold text-white">{x}</span><span className="text-xs text-slate-400">{l}</span><span className="text-right font-semibold text-white">{y}</span></div>
          <div className="flex h-1 gap-0.5"><div className="flex flex-1 justify-end"><div className="h-full rounded-full" style={{ width: `${(nx / Math.max(1e-6, nx + ny)) * 100}%`, background: TEAM_COLORS[0].css }} /></div><div className="flex flex-1"><div className="h-full rounded-full" style={{ width: `${(ny / Math.max(1e-6, nx + ny)) * 100}%`, background: TEAM_COLORS[1].css }} /></div></div>
        </div>
      ))}
    </div>
  );
}

export function Scoreboard({ snap, names, seat }: { snap: Snapshot; names: [string, string]; seat: TeamId }) {
  return (
    <div className="flex items-center justify-center gap-4 rounded-xl border border-white/10 bg-ink-800 px-4 py-2">
      <div className="flex-1 truncate text-right font-display text-xl font-semibold uppercase" style={{ color: TEAM_COLORS[0].css }}>{names[0]}{seat === 0 && ' (you)'}</div>
      <div className="font-display text-4xl font-bold tabular-nums text-white">{snap.score[0]} <span className="text-slate-500">–</span> {snap.score[1]}</div>
      <div className="flex-1 truncate font-display text-xl font-semibold uppercase" style={{ color: TEAM_COLORS[1].css }}>{seat === 1 && '(you) '}{names[1]}</div>
      <div className="w-24 rounded-lg bg-black/40 px-2 py-1 text-center">
        <div className="font-mono text-lg font-bold text-emerald-300">{snap.label}</div>
        <div className="text-[10px] uppercase tracking-wide text-slate-400">{snap.phase === 'dead' ? (snap.restart?.kind ?? 'dead ball') : snap.phase === 'halftime' ? 'half-time' : snap.phase === 'fulltime' ? 'full-time' : `${snap.half === 1 ? '1st' : '2nd'} half`}</div>
      </div>
    </div>
  );
}

/** Player detail panel for whoever is selected (either team), with live match data. */
function InspectPanel({ snap, me, className }: { snap: Snapshot; me: TeamId; className?: string }) {
  const { view, roster, inspect, setInspect, events } = useStore();
  const card = inspect ? roster.get(inspect) : null;
  if (!card || !view) return <InfoPlaceholder className={className} />;
  const mine = view.squads?.[me]?.some((p) => p.id === card.id) ?? true;
  const team = (mine ? me : 1 - me) as TeamId;
  const idx = snap.p.findIndex((q) => q.id === card.id);
  const q = idx >= 0 ? snap.p[idx] : null;
  const tac = mine ? view.tactics : view.opp?.tactics;
  const slot = idx >= 0 ? idx % 11 : -1;
  const sentOff = events.some((e) => e.type === 'red' && e.playerId === card.id);
  const live = { en: q?.en ?? 1, yellow: !!q && (q.f & F_YELLOW) !== 0, sentOff, onPitch: !!q, zone: slot === 0 ? ('GK' as const) : slot > 0 && tac ? zoneOf(shapePts(tac, 'ip')[slot]) : undefined };
  return <PlayerInfo p={card} team={team} side={mine ? 'mine' : 'opp'} live={live} events={events} onClose={() => setInspect(null)} className={className} />;
}

export function Match() {
  const { view, snap, events, send, inspect, setInspect } = useStore();
  const [ov, setOv] = useState<Overlays>({ lanes: false, space: false, line: true, press: false });
  const [tab, setTab] = useState<'cmd' | 'squad' | 'tac' | 'opp' | 'feed'>('cmd');
  const [flash, setFlash] = useState<string | null>(null);
  const lastScore = useRef<[number, number] | null>(null);
  const seen = useSeen(snap);
  const me = (view?.seat ?? 0) as TeamId;
  const speed = view?.speed ?? 1;
  const speedRef = useRef(1); speedRef.current = speed;
  const baseMs = useRef(200); baseMs.current = view?.tickMs ?? 200;
  const lastSpeed = useRef(1); if (speed > 0) lastSpeed.current = speed;
  const togglePause = () => send({ t: 'speed', value: speedRef.current > 0 ? 0 : lastSpeed.current });
  const toggleRef = useRef(togglePause); toggleRef.current = togglePause;
  useEffect(() => { // space bar pauses / resumes (unless typing in a field)
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code !== 'Space' || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(t.tagName)) return;
      e.preventDefault(); toggleRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!snap) return;
    const [a, b] = snap.score;
    if (lastScore.current) { const [pa, pb] = lastScore.current; if (a + b > pa + pb) { const sc = a > pa ? 0 : 1; setFlash(`GOAL — ${view!.names[sc]}`); setTimeout(() => setFlash(null), 2600); } }
    lastScore.current = [a, b];
  }, [snap?.score[0], snap?.score[1]]); // eslint-disable-line
  const source = useMemo(() => (dt: number) => {
    const sp = speedRef.current;
    if (sp > 0) playback.advance(dt, sp, baseMs.current);
    else playback.acc = Math.min(playback.acc, playback.tickMs);
    const prev = playback.prev, curr = playback.curr;
    if (!prev || !curr) return null;
    return { a0: playback.prev0, a: prev, b: curr, alpha: Math.min(1, playback.acc / playback.tickMs) };
  }, []);
  const phase = snap?.phase;
  useEffect(() => { setAmbient(speed > 0 && (phase === 'play' || phase === 'dead')); }, [speed, phase]);
  useEffect(() => () => setAmbient(false), []);
  if (!view || !snap) return <div className="p-10 text-center text-slate-400">Loading match…</div>;
  const squad = view.squads![me];
  const paused = speed === 0;
  const tabs = [['cmd', 'Command'], ['squad', 'Squad'], ['tac', 'Tactics'], ['opp', 'Opponent'], ['feed', 'Feed']] as const;
  const tog = (k: keyof Overlays, label: string) => <button key={k} onClick={() => setOv({ ...ov, [k]: !ov[k] })} className={cx('chip cursor-pointer', ov[k] && 'border-emerald-400/60 bg-emerald-400/15 text-emerald-300')}><Eye className="mr-1 h-3 w-3" />{label}</button>;
  return (
    <div className="mx-auto max-w-[1800px] space-y-3 px-3 py-3">
      <Scoreboard snap={snap} names={view.names} seat={me} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_330px_400px]">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button onClick={togglePause} title={paused ? 'Resume (Space)' : 'Pause (Space)'} className={cx('btn px-4 py-1.5', paused ? 'btn-primary' : 'btn-ghost')}>
                {paused ? <><Play className="h-4 w-4" />Resume</> : <><Pause className="h-4 w-4" />Pause</>}
              </button>
              <Seg size="sm" value={paused ? -1 : speed} onChange={(v) => send({ t: 'speed', value: v })} options={SPEEDS.map((v) => ({ v, label: `${v}x`, title: `${v}x speed` }))} />
              <SoundToggle />
            </div>
            <div className="flex flex-wrap gap-1.5">{tog('lanes', 'Passing lanes')}{tog('space', 'Space control')}{tog('line', 'Def / offside line')}{tog('press', 'Pressing traps')}</div>
          </div>
          {view.mode === 'pvp' && paused && <div className="text-xs text-amber-300">Match paused (shared by both managers).</div>}
          <div className="relative aspect-[105/68] w-full overflow-hidden rounded-xl border border-white/10 bg-black">
            <PitchCanvas source={source} overlays={ov} mySeat={me} selected={inspect} onPick={(i) => { const id = i !== null ? snap.p[i]?.id : null; if (id) { setInspect(id); } }} />
            {flash && <div className="goal-pop pointer-events-none absolute inset-0 flex items-center justify-center"><div className="rounded-2xl bg-black/70 px-8 py-4 font-display text-5xl font-bold uppercase text-emerald-300">{flash}</div></div>}
            {paused && <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-bold uppercase tracking-wider text-sky-300">Paused — press Space or Resume</div>}
            {snap.restart && <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white">{snap.restart.kind} · {view.names[snap.restart.team]}</div>}
            <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/50 px-2 py-0.5 text-[10px] text-slate-300">Click any player for details</div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-400">
            <div className="rounded-lg bg-white/5 py-1">Possession <b className="text-white">{Math.round((snap.stats[me].poss / Math.max(1, snap.stats[0].poss + snap.stats[1].poss)) * 100)}%</b></div>
            <div className="rounded-lg bg-white/5 py-1">xG <b className="text-white">{snap.stats[me].xg.toFixed(2)}</b> – {snap.stats[(1 - me) as 0 | 1].xg.toFixed(2)}</div>
            <div className="rounded-lg bg-white/5 py-1">Shots <b className="text-white">{snap.stats[me].shots}</b> – {snap.stats[(1 - me) as 0 | 1].shots}</div>
          </div>
          <AssistantManager snap={snap} onTab={setTab} />
          <Card title="Cause & effect" className="hidden xl:block"><div className="max-h-52"><EventTicker events={events} seat={me} names={view.names} limit={12} minImp={2} /></div></Card>
        </div>
        <div className="hidden min-w-0 2xl:block"><div className="sticky top-3 max-h-[calc(100vh-1.5rem)] overflow-y-auto scroll-thin"><InspectPanel snap={snap} me={me} /></div></div>
        <div className="min-w-0 space-y-3">
          {inspect && <div className="2xl:hidden"><InspectPanel snap={snap} me={me} /></div>}
          <div className="panel flex min-h-[420px] flex-col p-3">
            <div className="mb-3 grid grid-cols-5 gap-1 rounded-lg bg-white/5 p-0.5">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx('rounded-md py-1.5 text-xs font-semibold', tab === k ? 'bg-emerald-500 text-ink-950' : 'text-slate-300 hover:bg-white/10')}>{l}</button>)}</div>
            <div className="scroll-thin max-h-[72vh] flex-1 overflow-y-auto pr-1">
              {tab === 'cmd' && <CommandPanel snap={snap} seat={me} />}
              {tab === 'squad' && <SquadPanel snap={snap} seat={me} squad={squad} seen={seen} />}
              {tab === 'tac' && <MatchTacticsEditor snap={snap} seat={me} />}
              {tab === 'opp' && <OpponentPanel snap={snap} seat={me} />}
              {tab === 'feed' && <div className="space-y-4"><StatsTable stats={snap.stats} names={view.names} /><div className="max-h-[40vh] overflow-y-auto"><EventTicker events={events} seat={me} names={view.names} limit={60} /></div></div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Turns match sounds (whistle and crowd) on or off; the choice is remembered. */
export function SoundToggle() {
  const [on, setOn] = useState(sound.enabled);
  useEffect(() => sound.subscribe(() => setOn(sound.enabled)), []);
  return (
    <button onClick={() => sound.setEnabled(!on)} title={on ? 'Mute whistle & crowd' : 'Turn on whistle & crowd sounds'} className={cx('btn btn-ghost px-2.5 py-1.5', !on && 'text-slate-500')}>
      {on ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
    </button>
  );
}
