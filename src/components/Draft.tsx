import { useMemo, useState } from 'react';
import { Search, Check, Hourglass } from 'lucide-react';
import { useStore } from '../store';
import { SKILL_KEYS, SKILL_LABELS, type PlayerCard, type PosGroup, type SkillKey } from '../../shared/types';
import { canDraft, MIN_GROUP } from '../../shared/draft';
import { ALL_ARCHETYPES } from '../../shared/players';
import { Card, OvrBadge, PosBadge, Seg, SkillGrid, cx } from './ui';
import { PlayerInfo, InfoPlaceholder } from './PlayerInfo';

export function Draft() {
  const { view, send, inspect, setInspect, roster } = useStore();
  const [group, setGroup] = useState<'ALL' | PosGroup>('ALL');
  const [arch, setArch] = useState('ALL');
  const [skill, setSkill] = useState<SkillKey | 'ovr'>('ovr');
  const [min, setMin] = useState(0);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const d = view?.draft;
  const taken = useMemo(() => new Set(d ? [...d.picks[0], ...d.picks[1]] : []), [d]);
  const byId = useMemo(() => new Map((d?.pool ?? []).map((p) => [p.id, p])), [d]);
  if (!view || !d) return null;
  const me = view.seat, them = (1 - me) as 0 | 1, myTurn = d.turn === me;
  const mine = d.picks[me].map((i) => byId.get(i)!), theirs = d.picks[them].map((i) => byId.get(i)!);
  const rows = d.pool.filter((p) => !taken.has(p.id))
    .filter((p) => (group === 'ALL' || p.group === group) && (arch === 'ALL' || p.archetype === arch) && (min === 0 || (skill === 'ovr' ? p.ovr : p.skills[skill]) >= min) && (!q || p.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (skill === 'ovr' ? b.ovr - a.ovr : b.skills[skill] - a.skills[skill]));
  const cnt = (arr: PlayerCard[], g: PosGroup) => arr.filter((p) => p.group === g).length;
  const archs = ['ALL', ...ALL_ARCHETYPES.filter((a) => d.pool.some((p) => p.archetype === a))];
  const insp = inspect ? roster.get(inspect) : null;
  const inspTheirs = !!inspect && d.picks[them].includes(inspect);
  return (
    <div className="mx-auto grid max-w-[1500px] gap-4 px-4 py-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="label">Draft · pick {d.pickNo + 1} of 40</div>
              <div className="font-display text-3xl font-bold uppercase text-white">{myTurn ? 'Your pick' : `${view.names[d.turn]} is picking`}</div>
            </div>
            <div className={cx('flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold', myTurn ? 'border-emerald-400/50 text-emerald-300' : 'border-white/10 text-slate-300')}>
              <Hourglass className="h-4 w-4" />{myTurn ? 'No time limit — take your time' : 'Waiting for their pick…'}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">Click a player to see his full profile, then press Draft to confirm the pick. Legal-XI rules: at least 1 GK, 4 DEF, 4 MID, 2 ATT per squad; max 3 GK.</p>
        </Card>
        <Card title="Draft board">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div><div className="label mb-1">Position</div><Seg size="sm" value={group} onChange={setGroup} options={(['ALL', 'GK', 'DEF', 'MID', 'ATT'] as const).map((g) => ({ v: g, label: g }))} /></div>
            <div><div className="label mb-1">Role archetype</div><select value={arch} onChange={(e) => setArch(e.target.value)} className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1.5 text-sm">{archs.map((a) => <option key={a}>{a}</option>)}</select></div>
            <div><div className="label mb-1">Sort / skill %</div>
              <select value={skill} onChange={(e) => setSkill(e.target.value as SkillKey | 'ovr')} className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1.5 text-sm"><option value="ovr">Overall</option>{SKILL_KEYS.map((k) => <option key={k} value={k}>{SKILL_LABELS[k]}</option>)}</select></div>
            <div className="min-w-[140px] flex-1"><div className="label mb-1 flex justify-between"><span>Min %</span><span className="text-slate-200">{min}</span></div><input type="range" min={0} max={90} step={5} value={min} onChange={(e) => setMin(+e.target.value)} className="w-full accent-emerald-500" /></div>
            <div className="relative"><Search className="absolute left-2 top-2 h-4 w-4 text-slate-500" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-36 rounded-lg border border-white/10 bg-ink-900 py-1.5 pl-8 pr-2 text-sm outline-none" /></div>
          </div>
          <div className="scroll-thin max-h-[60vh] space-y-1 overflow-y-auto pr-1">
            {rows.map((p) => {
              const legal = canDraft(mine, taken, p);
              return (
                <div key={p.id} className={cx('rounded-lg border hover:bg-white/[0.06]', inspect === p.id ? 'border-yellow-300/40 bg-white/[0.06]' : 'border-white/5 bg-white/[0.03]')}>
                  <div className="flex cursor-pointer items-center gap-3 px-3 py-2" onClick={() => { setOpen(open === p.id ? null : p.id); setInspect(p.id); }}>
                    <OvrBadge v={p.ovr} /><PosBadge p={p} />
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-white">{p.name}</div><div className="truncate text-xs text-slate-400">{p.archetype}{skill !== 'ovr' && <> · <span className="text-emerald-300">{SKILL_LABELS[skill]} {p.skills[skill]}%</span></>}</div></div>
                    <div className="hidden w-[300px] md:block"><SkillGrid p={p} compact /></div>
                    <button className="btn btn-primary" disabled={!myTurn || !legal} title={!legal && myTurn ? 'Would break legal-XI constraints' : ''} onClick={(e) => { e.stopPropagation(); send({ t: 'draftPick', playerId: p.id }); }}>Draft</button>
                  </div>
                  {open === p.id && <div className="border-t border-white/5 px-3 py-2 md:hidden"><SkillGrid p={p} /></div>}
                </div>
              );
            })}
            {!rows.length && <p className="py-8 text-center text-sm text-slate-500">No players match the filters.</p>}
          </div>
        </Card>
      </div>
      <aside className="space-y-3">
        {insp ? <PlayerInfo p={insp} team={inspTheirs ? them : me} side={inspTheirs ? 'opp' : 'mine'} onClose={() => setInspect(null)} />
          : <InfoPlaceholder text="Click any player to see his strengths, weaknesses, attributes and best positions before you draft him." />}
        <Squad title={`${view.names[me]} (you)`} list={mine} cnt={cnt} accent="text-sky-300" onPick={setInspect} />
        <Squad title={view.names[them]} list={theirs} cnt={cnt} accent="text-pink-300" onPick={setInspect} />
      </aside>
    </div>
  );
}

function Squad({ title, list, cnt, accent, onPick }: { title: string; list: PlayerCard[]; cnt: (a: PlayerCard[], g: PosGroup) => number; accent: string; onPick: (id: string) => void }) {
  return (
    <Card title={<span className={accent}>{title}</span>} right={<span className="chip">{list.length}/20</span>}>
      <div className="mb-2 grid grid-cols-4 gap-1 text-center text-[11px]">
        {(['GK', 'DEF', 'MID', 'ATT'] as PosGroup[]).map((g) => { const c = cnt(list, g); return <div key={g} className={cx('rounded border px-1 py-1', c >= MIN_GROUP[g] ? 'border-emerald-400/30 text-emerald-300' : 'border-white/10 text-slate-400')}>{g} {c}/{MIN_GROUP[g]}+ {c >= MIN_GROUP[g] && <Check className="inline h-3 w-3" />}</div>; })}
      </div>
      <div className="scroll-thin max-h-60 space-y-1 overflow-y-auto">
        {[...list].sort((a, b) => b.ovr - a.ovr).map((p) => <button key={p.id} onClick={() => onPick(p.id)} className="flex w-full items-center gap-2 rounded text-left text-xs hover:bg-white/5"><OvrBadge v={p.ovr} /><PosBadge p={p} /><span className="truncate text-slate-200">{p.name}</span></button>)}
        {!list.length && <p className="py-3 text-center text-xs text-slate-500">No picks yet</p>}
      </div>
    </Card>
  );
}
