import { useState } from 'react';
import { useStore } from '../store';
import type { TeamId } from '../../shared/types';
import { F_ABSENT } from '../../shared/types';
import { shapePts, zoneOf } from '../../shared/formations';
import { Card, EnergyBar, cx } from './ui';
import { EventTicker, Scoreboard, StatsTable } from './Match';
import { MatchTacticsEditor, OpponentPanel, SquadPanel, useSeen } from './Panels';
import { PlayerInfo, InfoPlaceholder } from './PlayerInfo';
import { AssistantManager } from './Assistant';

export function Halftime() {
  const { view, snap, events, send, roster, inspect, setInspect } = useStore();
  const [swapSel, setSwapSel] = useState<number | null>(null);
  const seen = useSeen(snap);
  if (!view || !snap) return null;
  const me = view.seat as TeamId;
  const ready = view.htReady[me];
  const on = snap.p.slice(me * 11, me * 11 + 11);
  const ip = view.tactics ? shapePts(view.tactics, 'ip') : null;
  const clickSlot = (i: number) => {
    setInspect(on[i].id);
    if (swapSel === null) return setSwapSel(i);
    if (swapSel !== i) send({ t: 'swap', a: swapSel, b: i });
    setSwapSel(null);
  };
  const card = inspect ? roster.get(inspect) : null;
  const mine = !!card && view.squads![me].some((p) => p.id === card.id);
  const idx = card ? snap.p.findIndex((q) => q.id === card.id) : -1;
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-4">
      <Scoreboard snap={snap} names={view.names} seat={me} />
      <div className="flex items-center justify-between">
        <h2 className="font-display text-4xl font-bold uppercase text-white">Half-time Board</h2>
        <button className={cx('btn px-6 py-2.5', ready ? 'btn-ghost' : 'btn-primary')} onClick={() => send({ t: 'htReady', value: !ready })}>{ready ? 'Ready ✓ — waiting for opponent' : 'Ready for second half'}</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-[1fr_1fr_340px]">
        <Card title="Adjust tactics (free at half-time)"><MatchTacticsEditor snap={snap} seat={me} title="Reshape freely, then apply." /></Card>
        <div className="space-y-4">
          <Card title="Stamina & positions" right={<span className="text-xs text-slate-400">click two to swap positions</span>}>
            <div className="space-y-1">
              {on.map((p, i) => { const c = roster.get(p.id); if (!c) return null; const abs = (p.f & F_ABSENT) !== 0;
                return <div key={p.id} onClick={() => !abs && clickSlot(i)} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-sm', swapSel === i ? 'border-amber-300 bg-amber-300/10' : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.07]', abs && 'opacity-40')}>
                  <span className="w-8 text-[10px] font-bold text-slate-400">{i === 0 ? 'GK' : ip ? zoneOf(ip[i]) : ''}</span><span className="min-w-0 flex-1 truncate text-white">#{c.number} {c.name}</span>
                  <div className="w-16"><EnergyBar en={p.en} /></div><span className="w-8 text-right text-xs text-slate-300">{Math.round(p.en * 100)}%</span></div>; })}
            </div>
          </Card>
          <Card title="First-half stats"><StatsTable stats={snap.stats} names={view.names} /></Card>
        </div>
        <div className="space-y-4 lg:col-span-2 2xl:col-span-1">
          <AssistantManager snap={snap} halftime max={4} />
          {card ? <PlayerInfo p={card} team={(mine ? me : 1 - me) as TeamId} side={mine ? 'mine' : 'opp'} events={events}
            live={{ en: idx >= 0 ? snap.p[idx].en : 1, yellow: idx >= 0 && (snap.p[idx].f & 4) !== 0, sentOff: events.some((e) => e.type === 'red' && e.playerId === card.id), onPitch: idx >= 0 }}
            onClose={() => setInspect(null)} /> : <InfoPlaceholder />}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Substitutions (5 total)"><SquadPanel snap={snap} seat={me} squad={view.squads![me]} seen={seen} /></Card>
        <Card title={<span className="text-pink-300">Opposition</span>}><OpponentPanel snap={snap} seat={me} /></Card>
        <Card title="First-half story"><div className="max-h-[520px] overflow-y-auto"><EventTicker events={events} seat={me} names={view.names} limit={60} minImp={3} /></div></Card>
      </div>
    </div>
  );
}
