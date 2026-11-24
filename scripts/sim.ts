import { generatePool, assignNumbers } from '../shared/players';
import { Match } from '../shared/engine/engine';
import { CPUTactician, cpuSetup } from '../shared/engine/cpu';
import { Rng } from '../shared/rng';
import type { TeamId } from '../shared/types';

const N = Number(process.argv[2] ?? 8);
const dur = (Number(process.argv[3] ?? 6)) as 3 | 6 | 10;
const archs = ['press', 'counter', 'block'] as const;
const agg: Record<string, number> = {};
const add = (k: string, v: number) => (agg[k] = (agg[k] ?? 0) + v);
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const pool = generatePool(1000 + g);
  const rng = new Rng(g);
  const sq: [any[], any[]] = [[], []];
  const sorted = [...pool].sort((a, b) => b.ovr - a.ovr);
  const mine = (t: number) => sq[t];
  // naive balanced draft: alternate picks respecting max per group
  const cap: any = { GK: 3, DEF: 10, MID: 10, ATT: 6 };
  const cnt = [{ GK: 0, DEF: 0, MID: 0, ATT: 0 }, { GK: 0, DEF: 0, MID: 0, ATT: 0 }] as any;
  let turn = 0;
  for (const p of sorted) { /* ignore */ void p; }
  const left = [...sorted];
  while (sq[0].length < 20 || sq[1].length < 20) {
    const t = turn % 2;
    const idx = left.findIndex((p) => cnt[t][p.group] < cap[p.group] && !(p.group === 'GK' && cnt[t].GK >= 2 && false));
    const p = left.splice(idx, 1)[0];
    sq[t].push(p); cnt[t][p.group]++; turn++;
  }
  void mine;
  assignNumbers(sq[0]); assignNumbers(sq[1]);
  const pa = { archetype: archs[g % 3], difficulty: 'hard' as const };
  const pb = { archetype: archs[(g + 1) % 3], difficulty: 'hard' as const };
  const s0 = cpuSetup(sq[0], pa), s1 = cpuSetup(sq[1], pb);
  const m = new Match({ seed: 77 + g, duration: dur, squads: sq as any, lineups: [s0.lineup, s1.lineup], tactics: [s0.tactics, s1.tactics], kickoffTeam: (g % 2) as TeamId });
  const c0 = new CPUTactician(0, pa, g), c1 = new CPUTactician(1, pb, g + 1);
  let guard = 0;
  while (m.phase !== 'fulltime' && guard++ < 40000) {
    if (m.phase === 'halftime') { c0.halftime(m); c1.halftime(m); m.startSecondHalf(); }
    c0.update(m); c1.update(m); m.step();
  }
  for (const t of [0, 1] as const) {
    const s = m.stats[t];
    add('goals', m.score[t]); add('shots', s.shots); add('onT', s.onTarget); add('xg', s.xg); add('passes', s.passes); add('passOk', s.passesOk);
    add('poss', s.poss); add('tackles', s.tackles); add('int', s.intercepts); add('fouls', s.fouls); add('corners', s.corners); add('offs', s.offsides);
    add('yel', s.yellows); add('red', s.reds); add('saves', s.saves);
    add('endEn', m.pitch[t].filter((a) => !a.isGK).reduce((q, a) => q + a.en, 0) / Math.max(1, m.pitch[t].filter((a) => !a.isGK).length));
  }
  console.log(`game ${g}: ${m.score[0]}-${m.score[1]} (${pa.archetype} v ${pb.archetype}) ticks=${m.tick} events=${m.events.length} shots ${m.stats[0].shots}/${m.stats[1].shots} xg ${m.stats[0].xg.toFixed(2)}/${m.stats[1].xg.toFixed(2)}`);
}
console.log('--- per match (both teams) ---');
for (const [k, v] of Object.entries(agg)) console.log(k.padEnd(8), (v / N).toFixed(2));
console.log(`passAcc ${(agg.passOk / agg.passes * 100).toFixed(1)}%  ms/game ${((Date.now() - t0) / N).toFixed(0)}`);
