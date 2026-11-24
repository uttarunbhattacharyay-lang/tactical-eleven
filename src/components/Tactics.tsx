import { useEffect, useMemo, useRef, useState } from 'react';
import { Wand2, ShieldAlert, ShieldCheck, AlertTriangle, ArrowLeftRight, Move } from 'lucide-react';
import { useStore } from '../store';
import type { Lineup, PlayerCard, Pt, TeamTactics } from '../../shared/types';
import { fitAt, shapePts, zoneOf } from '../../shared/formations';
import { autoLineup, diagnose, normalizePlan } from '../../shared/lineup';
import { Card, OvrBadge, PosBadge, cx } from './ui';
import { FormationBoard } from './FormationBoard';
import { PlayerInfo, InfoPlaceholder } from './PlayerInfo';
import { Instructions, RoleSelect, ShapeBoard, type ShapeKind } from './TacticsEditor';

export function Tactics() {
  const { view, send, inspect, setInspect, roster } = useStore();
  const me = view!.seat;
  const squad = view!.squads![me];
  const opp = view!.squads![(1 - me) as 0 | 1];
  const byId = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);
  // the plan is always kept normalised: custom points materialised and slots in canonical order
  const init = useMemo(() => {
    const t = view!.tactics!; const l = view!.lineup ?? autoLineup(squad, t);
    const n = normalizePlan(t, l.starters);
    return { tac: n.tac, order: [...n.slots, ...l.bench] };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [order, setOrder] = useState<string[]>(init.order);
  const [tac, setTac] = useState<TeamTactics>(init.tac);
  const [sel, setSel] = useState<number | null>(null); // index into 20-order, for swaps
  const first = useRef(true);
  const lineup: Lineup = useMemo(() => ({ starters: order.slice(0, 11), bench: order.slice(11) }), [order]);
  useEffect(() => { // push plan to the room on every change (debounced)
    const t = setTimeout(() => { send({ t: 'setPlan', lineup, tactics: tac }); first.current = false; }, first.current ? 0 : 250);
    return () => clearTimeout(t);
  }, [lineup, tac]); // eslint-disable-line react-hooks/exhaustive-deps
  const diag = useMemo(() => diagnose(squad, lineup, tac), [squad, lineup, tac]);
  const ready = view!.tacticsReady[me];
  const ipPts = shapePts(tac, 'ip');

  const apply = (t: TeamTactics, starters = order.slice(0, 11)) => {
    const n = normalizePlan(t, starters);
    setTac(n.tac); setOrder([...n.slots, ...order.slice(11)]); setSel(null);
  };
  const setPt = (kind: ShapeKind, slot: number, pt: Pt) => {
    const pts = shapePts(tac, kind).map((p, i) => (i === slot ? pt : p)) as Pt[];
    apply(kind === 'ip' ? { ...tac, ipPts: pts } : { ...tac, oopPts: pts });
  };
  const template = (kind: ShapeKind, id: string, pts: Pt[]) => apply(kind === 'ip' ? { ...tac, ipShape: id, ipPts: pts } : { ...tac, oopShape: id, oopPts: pts });
  const click = (i: number) => {
    const id = order[i]; if (id) setInspect(id);
    if (sel === null) return setSel(i);
    if (sel === i) return setSel(null);
    const n = [...order]; [n[sel], n[i]] = [n[i], n[sel]];
    setOrder(n); setSel(null);
  };
  const patch = (p: Partial<TeamTactics>) => setTac((t) => ({ ...t, ...p }));
  const setRole = (slot: number, id: string) => setTac((t) => { const r = [...t.roles]; r[slot] = id; return { ...t, roles: r }; });
  const auto = () => { const l = autoLineup(squad, tac); const n = normalizePlan(tac, l.starters); setTac(n.tac); setOrder([...n.slots, ...l.bench]); setSel(null); };
  const starters = order.slice(0, 11).map((id) => byId.get(id));
  const selectSlot = (slot: number) => { const id = order[slot]; if (id) setInspect(id); };
  const sevIcon = { high: <ShieldAlert className="h-4 w-4 text-rose-400" />, med: <AlertTriangle className="h-4 w-4 text-amber-400" />, low: <AlertTriangle className="h-4 w-4 text-sky-300" />, ok: <ShieldCheck className="h-4 w-4 text-emerald-400" /> };
  const oppAvg = Math.round(opp.reduce((a, p) => a + p.ovr, 0) / Math.max(1, opp.length));
  const insp = inspect ? roster.get(inspect) : null;
  const inspSide = insp && squad.some((p) => p.id === insp.id) ? 'mine' : 'opp';
  const oppPlan = view!.opp;
  const oppStarters = oppPlan?.lineup.starters.map((id) => roster.get(id));

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><div className="label">Pre-match</div><h2 className="font-display text-4xl font-bold uppercase text-white">Tactics Board</h2></div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Opponent squad avg OVR {oppAvg}</span>
          <button className="btn btn-ghost" onClick={auto}><Wand2 className="h-4 w-4" />Auto-pick XI</button>
          <button className={cx('btn px-6 py-2.5', ready ? 'btn-ghost' : 'btn-primary')} onClick={() => send({ t: 'tacticsReady', value: !ready })}>
            {ready ? 'Ready ✓ (click to edit)' : 'Ready for kick-off'}
          </button>
        </div>
      </div>
      {view!.mode === 'pvp' && <div className="text-xs text-slate-400">{view!.names[0]}: {view!.tacticsReady[0] ? 'ready' : 'setting up'} · {view!.names[1]}: {view!.tacticsReady[1] ? 'ready' : 'setting up'}</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Formation" right={<span className="flex items-center gap-1 text-xs text-slate-400"><Move className="h-3.5 w-3.5" />Drag any outfield player anywhere · click to inspect</span>}>
          <div className="grid gap-4 lg:grid-cols-2">
            {(['ip', 'oop'] as const).map((k) => (
              <ShapeBoard key={k} kind={k} tac={tac} players={starters} selectedId={inspect} onSelect={selectSlot} onDrop={(s, pt) => setPt(k, s, pt)} onTemplate={(id, pts) => template(k, id, pts)} />
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Build any shape you like — players are placed exactly where you drop them. The label above each player is the position that spot corresponds to;
            an amber or red ring means the player is out of his natural position there. Templates are optional starting points.
          </p>
        </Card>
        {insp ? <PlayerInfo p={insp} team={inspSide === 'mine' ? me : ((1 - me) as 0 | 1)} side={inspSide} onClose={() => setInspect(null)} className="xl:sticky xl:top-3 xl:self-start" />
          : <InfoPlaceholder className="xl:self-start" text="Click any player on the boards or in the lists to see strengths, weaknesses, attributes and best positions." />}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card title="Starting XI & roles" right={<span className="text-xs text-slate-400">click to inspect · click another to swap</span>}>
          <div className="space-y-1">
            {Array.from({ length: 11 }, (_, i) => {
              const p = byId.get(order[i]); if (!p) return null;
              const zone = i === 0 ? 'GK' : zoneOf(ipPts[i]);
              const fit = i === 0 ? (p.pos === 'GK' ? 1 : 0.2) : fitAt(p.pos, ipPts[i]);
              return (
                <div key={i} onClick={() => click(i)} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5', sel === i ? 'border-amber-300 bg-amber-300/10' : inspect === p.id ? 'border-yellow-300/40 bg-white/[0.06]' : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.07]')}>
                  <span className="w-9 text-xs font-bold text-slate-400">{zone}</span>
                  <OvrBadge v={p.ovr} /><PosBadge p={p} />
                  <span className="min-w-0 flex-1 truncate text-sm text-white">#{p.number} {p.name}</span>
                  {fit < 1 && <span title="Playing out of position" className={cx('chip', fit < 0.8 ? 'text-rose-300' : 'text-amber-300')}>{Math.round(fit * 100)}% fit</span>}
                  <RoleSelect tac={tac} slot={i} onChange={(r) => setRole(i, r)} />
                </div>
              );
            })}
          </div>
          <div className="label mb-1 mt-4 flex items-center gap-1"><ArrowLeftRight className="h-3.5 w-3.5" />Substitutes (9)</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {Array.from({ length: 9 }, (_, k) => {
              const i = 11 + k; const p = byId.get(order[i]); if (!p) return null;
              return (
                <div key={i} onClick={() => click(i)} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5', sel === i ? 'border-amber-300 bg-amber-300/10' : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.07]')}>
                  <OvrBadge v={p.ovr} /><PosBadge p={p} /><span className="min-w-0 flex-1 truncate text-sm text-slate-200">#{p.number} {p.name}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Team instructions"><Instructions tac={tac} patch={patch} /></Card>
          <Card title="Vulnerability diagnostic" right={<span className={cx('chip', diag.score >= 75 ? 'text-emerald-300' : diag.score >= 55 ? 'text-amber-300' : 'text-rose-300')}>Readiness {diag.score}</span>}>
            <div className="scroll-thin max-h-[280px] space-y-2 overflow-y-auto pr-1">
              {diag.items.map((d, i) => (
                <div key={i} className="flex gap-2 rounded-lg bg-white/5 p-2">{sevIcon[d.severity]}<div><div className="text-sm font-semibold text-white">{d.title}</div><div className="text-xs text-slate-400">{d.detail}</div></div></div>
              ))}
            </div>
          </Card>
          <Card title={<span className="text-pink-300">Opposition · {view!.names[(1 - me) as 0 | 1]}</span>} right={<span className="chip">avg {oppAvg}</span>}>
            {oppPlan && oppStarters ? (
              <>
                <FormationBoard readOnly pts={shapePts(oppPlan.tactics, 'oop')} players={oppStarters} tint="#be185d" selectedId={inspect} onSelect={(s) => { const id = oppPlan.lineup.starters[s]; if (id) setInspect(id); }} />
                <p className="mt-1 text-xs text-slate-400">Their defensive shape (attacking →). Click a player to scout him.</p>
              </>
            ) : <p className="text-xs text-slate-400">Their line-up is revealed at kick-off.</p>}
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {[...opp].sort((a, b) => b.ovr - a.ovr).map((p: PlayerCard) => (
                <button key={p.id} onClick={() => setInspect(p.id)} className={cx('flex items-center gap-2 rounded-lg border px-2 py-1 text-left', inspect === p.id ? 'border-yellow-300/40 bg-white/[0.06]' : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.07]')}>
                  <OvrBadge v={p.ovr} /><PosBadge p={p} /><span className="min-w-0 flex-1 truncate text-xs text-slate-200">{p.name}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
