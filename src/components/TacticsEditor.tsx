import { useState } from 'react';
import type { PlayerCard, PressTrigger, Pt, Strategy, TeamTactics } from '../../shared/types';
import { IP_SHAPES, OOP_SHAPES, ROLES, ROLE_MAP, STRATS, SHAPES, clonePts, shapePts, zoneGroup, zoneOf } from '../../shared/formations';
import { FormationBoard } from './FormationBoard';
import { Seg, Slider, cx } from './ui';

const TRIG: { v: PressTrigger; label: string }[] = [
  { v: 'backPass', label: 'Back-pass' }, { v: 'touchline', label: 'Touchline' }, { v: 'poorTouch', label: 'Poor touch' }, { v: 'always', label: 'Constant' },
];
export type ShapeKind = 'ip' | 'oop';
export const SHAPE_TITLE: Record<ShapeKind, string> = { ip: 'In possession', oop: 'Out of possession' };
export const SHAPE_TINT: Record<ShapeKind, string> = { ip: '#2563eb', oop: '#9333ea' };

/** Optional starting points — positions stay fully free after loading one. */
export function TemplatePicker({ kind, onPick }: { kind: ShapeKind; onPick: (id: string, pts: Pt[]) => void }) {
  const list = kind === 'ip' ? IP_SHAPES : OOP_SHAPES;
  return (
    <select value="" onChange={(e) => { const s = SHAPES[e.target.value]; if (s) onPick(s.id, clonePts(s.pts)); }} title="Optional: start from a template, then drag players anywhere"
      className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1 text-xs text-slate-300">
      <option value="">Load template…</option>
      {list.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
    </select>
  );
}

/** One draggable shape board with its title and template picker. */
export function ShapeBoard({ kind, tac, players, absent, selectedId, onSelect, onDrop, onTemplate, header = true }: {
  kind: ShapeKind; tac: TeamTactics; players: (PlayerCard | undefined)[]; absent?: boolean[]; selectedId?: string | null;
  onSelect: (slot: number) => void; onDrop: (slot: number, pt: Pt) => void; onTemplate: (id: string, pts: Pt[]) => void; header?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {header && <div className="flex items-center justify-between gap-2"><span className="label">{SHAPE_TITLE[kind]}</span><TemplatePicker kind={kind} onPick={onTemplate} /></div>}
      <FormationBoard pts={shapePts(tac, kind)} players={players} tint={SHAPE_TINT[kind]} selectedId={selectedId} onSelect={onSelect} onDrop={onDrop} absent={absent} />
    </div>
  );
}

/** Compact editor: one board at a time with an in/out-of-possession toggle. */
export function ToggleShapeBoard(props: Omit<Parameters<typeof ShapeBoard>[0], 'kind' | 'header' | 'onTemplate'> & { onTemplate: (kind: ShapeKind, id: string, pts: Pt[]) => void; onDropKind: (kind: ShapeKind, slot: number, pt: Pt) => void }) {
  const [kind, setKind] = useState<ShapeKind>('ip');
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Seg size="sm" value={kind} onChange={setKind} options={[{ v: 'ip', label: 'In possession' }, { v: 'oop', label: 'Out of possession' }]} />
        <TemplatePicker kind={kind} onPick={(id, pts) => props.onTemplate(kind, id, pts)} />
      </div>
      <ShapeBoard {...props} kind={kind} header={false} onTemplate={() => {}} onDrop={(s, pt) => props.onDropKind(kind, s, pt)} />
    </div>
  );
}

/** Role options that suit where the player stands in the in-possession shape. */
export function RoleSelect({ tac, slot, onChange }: { tac: TeamTactics; slot: number; onChange: (role: string) => void }) {
  const zone = slot === 0 ? 'GK' : zoneOf(shapePts(tac, 'ip')[slot]);
  const roles = ROLES.filter((r) => r.groups.includes(zoneGroup(zone)));
  return (
    <select value={tac.roles[slot]} onClick={(e) => e.stopPropagation()} onChange={(e) => onChange(e.target.value)} title={ROLE_MAP[tac.roles[slot]]?.desc}
      className="w-40 shrink-0 rounded-md border border-white/10 bg-ink-900 px-1 py-1 text-xs">
      {!roles.some((r) => r.id === tac.roles[slot]) && <option value={tac.roles[slot]}>{ROLE_MAP[tac.roles[slot]]?.label ?? tac.roles[slot]}</option>}
      {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
    </select>
  );
}

/** Team instructions: playing style, defensive line, pressing, build-up and transitions. */
export function Instructions({ tac, patch, compact }: { tac: TeamTactics; patch: (p: Partial<TeamTactics>) => void; compact?: boolean }) {
  const toggleTrig = (v: PressTrigger) => patch({ triggers: tac.triggers.includes(v) ? tac.triggers.filter((x) => x !== v) : [...tac.triggers, v] });
  return (
    <div className="space-y-4">
      <div>
        <div className="label mb-1">Playing style</div>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(STRATS) as Strategy[]).map((s) => (
            <button key={s} onClick={() => patch({ strategy: s })} className={cx('rounded-lg border p-2 text-left', tac.strategy === s ? 'border-emerald-400/60 bg-emerald-400/10' : 'border-white/10 bg-white/5 hover:bg-white/10')}>
              <div className="text-sm font-semibold text-white">{STRATS[s].label}</div>{!compact && <div className="text-[11px] leading-tight text-slate-400">{STRATS[s].desc}</div>}
            </button>
          ))}
        </div>
      </div>
      <Slider label="Defensive line height" value={tac.lineHeight} onChange={(v) => patch({ lineHeight: v })} hint={tac.lineHeight > 65 ? 'high' : tac.lineHeight < 35 ? 'deep' : 'medium'} />
      <Slider label="Pressing intensity" value={tac.pressing} onChange={(v) => patch({ pressing: v })} hint={tac.pressing > 65 ? 'aggressive' : tac.pressing < 35 ? 'passive' : 'balanced'} />
      <div><div className="label mb-1">Pressing triggers</div><div className="flex flex-wrap gap-1.5">{TRIG.map((t) => <button key={t.v} onClick={() => toggleTrig(t.v)} className={cx('chip cursor-pointer', tac.triggers.includes(t.v) && 'border-emerald-400/60 bg-emerald-400/15 text-emerald-300')}>{t.label}</button>)}</div></div>
      <div><div className="label mb-1">Passing style (build-up)</div><Seg value={tac.buildUp} onChange={(v) => patch({ buildUp: v })} options={[{ v: 'short', label: 'Short' }, { v: 'mixed', label: 'Mixed' }, { v: 'direct', label: 'Direct' }]} /></div>
      <div><div className="label mb-1">On losing the ball</div><Seg size={compact ? 'sm' : 'md'} value={tac.transition} onChange={(v) => patch({ transition: v })} options={[{ v: 'counterpress', label: 'Counter-press' }, { v: 'regroup', label: 'Regroup' }, { v: 'counterattack', label: 'Drop & counter' }]} /></div>
    </div>
  );
}
