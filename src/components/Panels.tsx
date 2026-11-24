import { useEffect, useRef, useState } from 'react';
import { Zap, Shield, Users, MoveHorizontal, ArrowUpFromLine, ArrowDownToLine, Swords, Ban, Repeat, Check, Undo2 } from 'lucide-react';
import { useStore } from '../store';
import type { CtlView, PlayerCard, Pt, Snapshot, Side, Strategy, TeamTactics, UnitCmd, ZoneId } from '../../shared/types';
import { F_ABSENT } from '../../shared/types';
import { SLOT_LABELS, STRATS, clonePts, roleForZone, shapePts, zoneOf } from '../../shared/formations';
import { FormationBoard } from './FormationBoard';
import { Instructions, RoleSelect, ToggleShapeBoard, type ShapeKind } from './TacticsEditor';
import { ZONES, UNIT_LABEL } from '../../shared/engine/engine';
import { Bar, EnergyBar, OvrBadge, PosBadge, Seg, cx } from './ui';

/** Real seconds left on a cooldown (ticks x real tick length). */
export const cdLeft = (ctl: CtlView, key: string, tickMs = 100) => Math.ceil(((ctl.cd[key] ?? 0) * tickMs) / 1000);

/** Tracks every player id that has been seen on the pitch, to know who was substituted off. */
export function useSeen(snap: Snapshot | null) {
  const seen = useRef(new Set<string>());
  if (snap) for (const p of snap.p) seen.current.add(p.id);
  return seen.current;
}

export function CommandPanel({ snap, seat }: { snap: Snapshot; seat: 0 | 1 }) {
  const send = useStore((s) => s.send);
  const tickMs = useStore((s) => s.view?.tickMs ?? 100);
  const ctl = snap.ctl[seat];
  const busy = ctl.lock > 0;
  const Btn = ({ k, onClick, icon, label, sub }: { k: string; onClick: () => void; icon: React.ReactNode; label: string; sub?: string }) => {
    const cd = cdLeft(ctl, k, tickMs);
    return (
      <button disabled={cd > 0 || busy || snap.phase === 'fulltime'} onClick={onClick} className="relative flex items-center gap-2 overflow-hidden rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-left text-sm enabled:hover:bg-white/10 disabled:opacity-50">
        <span className="text-emerald-300">{icon}</span>
        <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-white">{label}</span>{sub && <span className="block truncate text-[11px] text-slate-400">{sub}</span>}</span>
        {cd > 0 && <span className="chip text-amber-300">{cd}s</span>}
      </button>
    );
  };
  const order = (o: Parameters<typeof send>[0] extends infer M ? (M extends { t: 'order'; order: infer O } ? O : never) : never) => send({ t: 'order', order: o });
  const zones = Object.keys(ZONES) as ZoneId[];
  const units: { u: UnitCmd; icon: React.ReactNode }[] = [
    { u: 'fullbackOverlap', icon: <MoveHorizontal className="h-4 w-4" /> }, { u: 'fullbackInvert', icon: <Repeat className="h-4 w-4" /> },
    { u: 'midDropDeep', icon: <ArrowDownToLine className="h-4 w-4" /> }, { u: 'forwardPressHigh', icon: <ArrowUpFromLine className="h-4 w-4" /> },
  ];
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-white/10 bg-ink-900/60 p-2">
        <div className="mb-1 flex items-center justify-between text-xs"><span className="label">Transition lag</span><span className={cx('font-semibold', ctl.lag > 0 ? 'text-amber-300' : 'text-emerald-300')}>{ctl.lag > 0 ? `reorganising ${((ctl.lag * tickMs) / 1000).toFixed(1)}s` : 'settled'}</span></div>
        <Bar value={Math.min(100, ctl.lag * 4)} color="#eab308" h={4} />
        {ctl.active.length > 0 && <div className="mt-2 space-y-1">{ctl.active.map((a) => <div key={a.key}><div className="flex justify-between text-[11px] text-slate-300"><span>{a.label}</span><span>{Math.ceil((a.ticks * tickMs) / 1000)}s</span></div><Bar value={(a.ticks / a.total) * 100} color="#38bdf8" h={3} /></div>)}</div>}
      </div>
      <div>
        <div className="label mb-1">Strategy switch</div>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(STRATS) as Strategy[]).map((s) => <Btn key={s} k="strategy" onClick={() => order({ kind: 'strategy', strategy: s })} icon={<Swords className="h-4 w-4" />} label={STRATS[s].label} />)}
        </div>
      </div>
      <div>
        <div className="label mb-1">Overload a zone (3 players commit)</div>
        <div className="grid grid-cols-2 gap-1.5">{zones.map((z) => <Btn key={z} k="overload" onClick={() => order({ kind: 'overload', zone: z })} icon={<Users className="h-4 w-4" />} label={ZONES[z].label} />)}</div>
      </div>
      <div>
        <div className="label mb-1">Defensive shape</div>
        <div className="grid grid-cols-2 gap-1.5">
          <Btn k="swarm" onClick={() => order({ kind: 'swarm' })} icon={<Zap className="h-4 w-4" />} label="Swarm carrier" sub="stamina x1.8" />
          <Btn k="lowBlock" onClick={() => order({ kind: 'lowBlock' })} icon={<Shield className="h-4 w-4" />} label="Drop to low block" />
        </div>
      </div>
      <div>
        <div className="label mb-1">Unit commands</div>
        <div className="space-y-1.5">
          {units.map(({ u, icon }) => (
            <div key={u} className="flex items-center gap-1.5">
              <span className="w-[130px] truncate text-xs font-semibold text-slate-200">{UNIT_LABEL[u]}</span>
              {(['left', 'right', 'both'] as Side[]).map((sd) => {
                const cd = cdLeft(ctl, `unit:${u}:${sd}`, tickMs);
                return <button key={sd} disabled={cd > 0 || busy} onClick={() => order({ kind: 'unit', unit: u, side: sd })} className="btn btn-ghost flex-1 px-1 py-1 text-xs disabled:opacity-40" title={String(icon && '')}>{cd > 0 ? `${cd}s` : sd === 'both' ? 'Both' : sd === 'left' ? 'Left' : 'Right'}</button>;
              })}
            </div>
          ))}
        </div>
      </div>
      <button className="btn btn-ghost w-full" disabled={busy || ctl.active.length === 0} onClick={() => order({ kind: 'cancel' })}><Ban className="h-4 w-4" />Cancel active orders</button>
    </div>
  );
}

/** Position label of each slot from the team's in-possession shape. */
const slotLabel = (tac: TeamTactics | null | undefined, i: number) => (i === 0 ? 'GK' : tac ? zoneOf(shapePts(tac, 'ip')[i]) : SLOT_LABELS[i]);

export function SquadPanel({ snap, seat, squad, seen }: { snap: Snapshot; seat: 0 | 1; squad: PlayerCard[]; starters?: string[]; seen: Set<string>; }) {
  const { send, roster, view, setInspect, inspect } = useStore();
  const ctl = snap.ctl[seat];
  const base = seat * 11;
  const on = snap.p.slice(base, base + 11);
  const onIds = new Set(on.map((p) => p.id));
  const bench = squad.filter((p) => !seen.has(p.id) && !onIds.has(p.id));
  const used = ctl.subsUsed + ctl.pendingSubs.length;
  const pendingOut = new Map(ctl.pendingSubs.map((s) => [s.out, s.in]));
  const pendingIn = new Set(ctl.pendingSubs.map((s) => s.in));
  const [outSel, setOut] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs"><span className="label">Substitutions</span><span className="font-semibold text-slate-200">{ctl.subsUsed}/5 used · windows {ctl.windowsUsed}/3</span></div>
      <p className="text-[11px] leading-snug text-slate-400">Pick a player to take off, then a substitute. Subs are made at the next stoppage and use one of three windows (half-time is free).</p>
      <div className="space-y-1">
        {on.map((p, i) => {
          const c = roster.get(p.id); if (!c) return null;
          const absent = (p.f & F_ABSENT) !== 0;
          const pend = pendingOut.get(p.id);
          return (
            <div key={p.id} onClick={() => { setInspect(p.id); if (absent) return; if (pend) send({ t: 'cancelSub', outId: p.id }); else setOut(outSel === p.id ? null : p.id); }}
              className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1', outSel === p.id ? 'border-rose-300 bg-rose-300/10' : inspect === p.id ? 'border-yellow-300/40 bg-white/[0.06]' : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.07]', absent && 'opacity-40')}>
              <span className="w-8 text-[10px] font-bold text-slate-400">{slotLabel(view?.tactics, i)}</span>
              <span className="w-6 text-xs text-slate-300">#{c.number}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-white">{c.name}{(p.f & 4) !== 0 && <span className="ml-1 inline-block h-3 w-2 rounded-sm bg-yellow-400 align-middle" title="Yellow card" />}{absent && ' (sent off)'}</span>
              <div className="w-16">{!absent && <EnergyBar en={p.en} />}</div>
              <span className="w-8 text-right text-[11px] text-slate-300">{absent ? '' : Math.round(p.en * 100)}%</span>
              {pend && <span className="chip text-amber-300">→ {roster.get(pend)?.name.split(' ').pop()}</span>}
            </div>
          );
        })}
      </div>
      <div className="label">Bench</div>
      <div className="space-y-1">
        {bench.map((c) => (
          <div key={c.id} onClick={() => setInspect(c.id)} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1', inspect === c.id ? 'border-yellow-300/40 bg-white/[0.06]' : 'border-white/5 bg-white/[0.03]')}>
            <OvrBadge v={c.ovr} /><PosBadge p={c} /><span className="min-w-0 flex-1 truncate text-sm text-slate-200">#{c.number} {c.name}</span>
            <button className="btn btn-primary px-2 py-1 text-xs" disabled={!outSel || pendingIn.has(c.id) || used >= 5} onClick={(e) => { e.stopPropagation(); send({ t: 'sub', outId: outSel!, inId: c.id }); setOut(null); }}>{pendingIn.has(c.id) ? 'Queued' : 'On'}</button>
          </div>
        ))}
        {!bench.length && <p className="text-xs text-slate-500">Bench is empty.</p>}
      </div>
    </div>
  );
}

/**
 * Live tactics editor. Edits are drafted locally and applied together with "Apply changes" — works while the
 * match is running, paused or at half-time. Players need a few seconds to reorganise after a change.
 */
export function MatchTacticsEditor({ snap, seat, title }: { snap: Snapshot; seat: 0 | 1; title?: string }) {
  const { view, send, roster, inspect, setInspect } = useStore();
  const live = view?.tactics;
  const liveKey = JSON.stringify(live ?? null);
  const [draft, setDraft] = useState<TeamTactics | null>(() => (live ? structuredClone(live) : null));
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (live && !dirty) setDraft(structuredClone(live)); }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!draft || !live) return <p className="text-xs text-slate-400">Loading tactics…</p>;
  const on = snap.p.slice(seat * 11, seat * 11 + 11);
  const players = on.map((p) => roster.get(p.id));
  const absent = on.map((p) => (p.f & F_ABSENT) !== 0);
  const edit = (t: TeamTactics) => { setDraft(t); setDirty(true); };
  const patch = (p: Partial<TeamTactics>) => edit({ ...draft, ...p });
  const fixRoles = (t: TeamTactics): TeamTactics => { const ip = shapePts(t, 'ip'); return { ...t, roles: t.roles.map((r, i) => (i === 0 ? r : roleForZone(r, zoneOf(ip[i])))) }; };
  const setPt = (kind: ShapeKind, slot: number, pt: Pt) => {
    const ip = clonePts(shapePts(draft, 'ip')), oop = clonePts(shapePts(draft, 'oop'));
    (kind === 'ip' ? ip : oop)[slot] = pt;
    edit(fixRoles({ ...draft, ipPts: ip, oopPts: oop }));
  };
  const template = (kind: ShapeKind, id: string, pts: Pt[]) => edit(fixRoles(kind === 'ip' ? { ...draft, ipShape: id, ipPts: pts } : { ...draft, oopShape: id, oopPts: pts }));
  const applyNow = () => {
    const { ipShape, oopShape, roles, lineHeight, pressing, triggers, buildUp, transition, strategy } = draft;
    send({ t: 'order', order: { kind: 'tactics', patch: { ipShape, oopShape, ipPts: clonePts(shapePts(draft, 'ip')), oopPts: clonePts(shapePts(draft, 'oop')), roles: [...roles], lineHeight, pressing, triggers: [...triggers], buildUp, transition, strategy } } });
    setDirty(false);
  };
  const discard = () => { setDraft(structuredClone(live)); setDirty(false); };
  const paused = view?.speed === 0;
  return (
    <div className="space-y-4">
      <div className={cx('sticky top-0 z-10 flex items-center gap-2 rounded-lg border bg-ink-800 p-2', dirty ? 'border-amber-300/50' : 'border-white/10')}>
        <span className="min-w-0 flex-1 text-xs text-slate-300">{dirty ? 'You have unapplied changes' : title ?? 'Edit freely, then apply.'}{paused && <span className="text-sky-300"> · match paused</span>}</span>
        <button className="btn btn-ghost px-2 py-1 text-xs" disabled={!dirty} onClick={discard}><Undo2 className="h-3.5 w-3.5" />Discard</button>
        <button className="btn btn-primary px-3 py-1 text-xs" disabled={!dirty} onClick={applyNow}><Check className="h-3.5 w-3.5" />Apply</button>
      </div>
      <ToggleShapeBoard tac={draft} players={players} absent={absent} selectedId={inspect} onSelect={(s) => { const id = on[s]?.id; if (id) setInspect(id); }}
        onDrop={() => {}} onDropKind={setPt} onTemplate={template} />
      <p className="-mt-2 text-[11px] text-slate-400">Drag players to reposition them. Changes take effect when applied; the team then needs a few seconds to reorganise.</p>
      <div>
        <div className="label mb-1">Player roles</div>
        <div className="space-y-1">
          {on.map((p, i) => {
            const c = players[i]; if (!c) return null;
            return (
              <div key={p.id} onClick={() => setInspect(p.id)} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1', inspect === p.id ? 'border-yellow-300/40 bg-white/[0.06]' : 'border-white/5 bg-white/[0.03]', absent[i] && 'opacity-40')}>
                <span className="w-8 text-[10px] font-bold text-slate-400">{slotLabel(draft, i)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-white">#{c.number} {c.name}</span>
                <RoleSelect tac={draft} slot={i} onChange={(r) => { const roles = [...draft.roles]; roles[i] = r; patch({ roles }); }} />
              </div>
            );
          })}
        </div>
      </div>
      <Instructions tac={draft} patch={patch} compact />
    </div>
  );
}

/** Opposition scouting: their live shape, players, stamina and instructions. Click a player for details. */
export function OpponentPanel({ snap, seat }: { snap: Snapshot; seat: 0 | 1 }) {
  const { view, roster, inspect, setInspect } = useStore();
  const [kind, setKind] = useState<ShapeKind>('oop');
  const o = (1 - seat) as 0 | 1;
  const on = snap.p.slice(o * 11, o * 11 + 11);
  const players = on.map((p) => roster.get(p.id));
  const absent = on.map((p) => (p.f & F_ABSENT) !== 0);
  const tac = view?.opp?.tactics;
  const onIds = new Set(on.map((p) => p.id));
  const bench = (view?.squads?.[o] ?? []).filter((p) => !onIds.has(p.id));
  return (
    <div className="space-y-3">
      {tac ? (
        <>
          <div className="flex items-center justify-between gap-2"><span className="label text-pink-300">{view?.names[o]}</span><Seg size="sm" value={kind} onChange={setKind} options={[{ v: 'ip', label: 'With ball' }, { v: 'oop', label: 'Without ball' }]} /></div>
          <FormationBoard readOnly pts={shapePts(tac, kind)} players={players} absent={absent} tint="#be185d" selectedId={inspect} onSelect={(s) => { const id = on[s]?.id; if (id) setInspect(id); }} />
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="chip">{STRATS[tac.strategy].label}</span><span className="chip">Line {tac.lineHeight}</span><span className="chip">Press {tac.pressing}</span><span className="chip">Build-up {tac.buildUp}</span>
          </div>
        </>
      ) : <p className="text-xs text-slate-400">Opposition shape unavailable.</p>}
      <div className="space-y-1">
        {on.map((p, i) => {
          const c = players[i]; if (!c) return null;
          const gone = absent[i];
          return (
            <div key={p.id} onClick={() => setInspect(p.id)} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1', inspect === p.id ? 'border-yellow-300/40 bg-white/[0.06]' : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.07]', gone && 'opacity-40')}>
              <span className="w-8 text-[10px] font-bold text-slate-400">{slotLabel(tac, i)}</span>
              <OvrBadge v={c.ovr} />
              <span className="min-w-0 flex-1 truncate text-sm text-white">#{c.number} {c.name}{gone && ' (sent off)'}</span>
              <div className="w-14">{!gone && <EnergyBar en={p.en} />}</div>
            </div>
          );
        })}
      </div>
      <div className="label">Their bench</div>
      <div className="grid gap-1">
        {bench.map((c) => <button key={c.id} onClick={() => setInspect(c.id)} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1 text-left hover:bg-white/[0.07]"><OvrBadge v={c.ovr} /><PosBadge p={c} /><span className="truncate text-xs text-slate-200">{c.name}</span></button>)}
      </div>
    </div>
  );
}
