import { Rng } from '../rng';
import type { Lineup, PlayerCard, PosGroup, Strategy, TeamId, TeamTactics, ZoneId } from '../types';
import { autoLineup, defaultTactics } from '../lineup';
import { DEFAULT_ROLES } from '../formations';
import type { Match } from './engine';

export type CPUArchetype = 'press' | 'counter' | 'block';
export type CPUDifficulty = 'easy' | 'normal' | 'hard';
export interface CPUProfile { archetype: CPUArchetype; difficulty: CPUDifficulty }

export const CPU_LABELS: Record<CPUArchetype, { name: string; blurb: string }> = {
  press: { name: 'High-Pressing Ideologue', blurb: 'Gegenpress, high line, 4-3-3 press. Wins it high, runs out of breath late.' },
  counter: { name: 'Pragmatic Counter-Attack', blurb: 'Mid-block, quick vertical transitions, inverted full-backs, ruthless on the break.' },
  block: { name: 'Compact Low-Block Specialist', blurb: '5-4-1 shield, deep line, direct outlets. Hard to break down; patient and cynical.' },
};

/** Draft logic: best available by OVR with positional-need and archetype bias. */
export function cpuDraftPick(rng: Rng, pool: PlayerCard[], mine: PlayerCard[], profile: CPUProfile, canPick: (p: PlayerCard) => boolean): PlayerCard {
  const avail = pool.filter(canPick);
  const need: Record<PosGroup, number> = { GK: 2, DEF: 7, MID: 7, ATT: 4 };
  const have: Record<PosGroup, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  for (const p of mine) have[p.group]++;
  const bias = (p: PlayerCard) => {
    let b = 0;
    if (profile.archetype === 'press') b += (p.skills.stamina - 65) * 0.25 + (p.skills.pace - 65) * 0.12;
    if (profile.archetype === 'counter') b += (p.skills.pace - 65) * 0.3 + (p.skills.finishing - 55) * 0.08;
    if (profile.archetype === 'block') b += (p.skills.tackling - 55) * 0.2 + (p.skills.aerial - 55) * 0.15 + (p.skills.positioning - 60) * 0.1;
    return b;
  };
  const scored = avail.map((p) => {
    const gap = need[p.group] - have[p.group];
    let s = p.ovr + bias(p) * (profile.difficulty === 'easy' ? 0.3 : 1) + (gap > 0 ? 3 + gap : -4 * (-gap + 1));
    if (profile.difficulty === 'easy') s += rng.gauss() * 6; else if (profile.difficulty === 'normal') s += rng.gauss() * 2.5;
    return { p, s };
  }).sort((a, b) => b.s - a.s);
  return scored[0].p;
}

export function cpuSetup(squad: PlayerCard[], profile: CPUProfile): { lineup: Lineup; tactics: TeamTactics } {
  const t = defaultTactics();
  t.roles = [...DEFAULT_ROLES];
  if (profile.archetype === 'press') {
    Object.assign(t, { ipShape: '4-2-3-1', oopShape: '4-3-3 Press', lineHeight: 66, pressing: 70, triggers: ['always', 'backPass', 'touchline'], buildUp: 'short', transition: 'counterpress', strategy: 'gegenpress' as Strategy });
    t.roles[5] = 'insidefwd'; t.roles[8] = 'winger'; t.roles[9] = 'pressfwd'; t.roles[10] = 'poacher'; t.roles[6] = 'b2b'; t.roles[7] = 'ballwinner';
  } else if (profile.archetype === 'counter') {
    Object.assign(t, { ipShape: '3-2-5', oopShape: '4-4-2 Mid-Block', lineHeight: 42, pressing: 48, triggers: ['backPass', 'poorTouch'], buildUp: 'direct', transition: 'counterattack', strategy: 'vertical' as Strategy });
    t.roles[1] = 'invfb'; t.roles[5] = 'insidefwd'; t.roles[8] = 'winger'; t.roles[9] = 'poacher'; t.roles[10] = 'target'; t.roles[6] = 'anchor'; t.roles[7] = 'hs10';
  } else {
    Object.assign(t, { ipShape: '4-4-2', oopShape: '5-4-1 Low Block', lineHeight: 30, pressing: 35, triggers: ['touchline', 'backPass'], buildUp: 'mixed', transition: 'counterattack', strategy: 'lowblock' as Strategy });
    t.roles[2] = 'stopper'; t.roles[3] = 'cb'; t.roles[6] = 'anchor'; t.roles[7] = 'ballwinner'; t.roles[9] = 'target'; t.roles[10] = 'poacher';
  }
  return { lineup: autoLineup(squad), tactics: t };
}

/** In-match AI manager: reacts to score, clock, fatigue and opponent weaknesses. */
export class CPUTactician {
  private every: number;
  private rng: Rng;
  constructor(private team: TeamId, private profile: CPUProfile, seed: number) {
    this.every = profile.difficulty === 'hard' ? 24 : profile.difficulty === 'normal' ? 50 : 90;
    this.rng = new Rng(seed ^ 0xc0ffee);
  }
  update(m: Match) {
    if (m.phase !== 'play' && m.phase !== 'dead') return;
    if (m.tick % this.every !== 0) return;
    const t = this.team, o = (1 - t) as TeamId, hard = this.profile.difficulty === 'hard';
    const frac = (m.tick) / m.totalTicks;
    const diff = m.score[t] - m.score[o];
    const tac = m.tactics[t];
    // strategy by game state
    let want: Strategy = tac.strategy;
    const base: Strategy = this.profile.archetype === 'press' ? 'gegenpress' : this.profile.archetype === 'counter' ? 'vertical' : 'lowblock';
    want = base;
    if (frac > 0.75 && diff > 0 && this.profile.archetype !== 'block') want = 'lowblock';
    if (frac > 0.65 && diff < 0) want = this.profile.archetype === 'block' ? 'vertical' : 'gegenpress';
    if (frac > 0.8 && diff < 0 && hard) want = 'gegenpress';
    if (want !== tac.strategy) m.applyOrder(t, { kind: 'strategy', strategy: want });
    // exploit weak flank by overloading toward it
    if (hard || this.profile.difficulty === 'normal') {
      const side = this.weakSide(m, o);
      if (side && this.rng.next() < (hard ? 0.5 : 0.25) && m.possTeam === t) {
        const z: ZoneId = side === 'left' ? (this.rng.chance(0.5) ? 'leftFlank' : 'leftHalfSpace') : (this.rng.chance(0.5) ? 'rightFlank' : 'rightHalfSpace');
        m.applyOrder(t, { kind: 'overload', zone: z });
      }
      if (m.possTeam === o && frac > 0.2 && diff <= 0 && this.profile.archetype === 'press' && this.rng.next() < 0.3) m.applyOrder(t, { kind: 'swarm' });
      if (diff > 0 && frac > 0.8 && m.possTeam === o && this.rng.next() < 0.4) m.applyOrder(t, { kind: 'lowBlock' });
    }
    this.subs(m);
  }
  private weakSide(m: Match, o: TeamId): 'left' | 'right' | null {
    // the opponent full-back who is more tired is the weaker side (from the attacker's perspective, mirror handled by slots)
    const l = m.onPitch[o][1], r = m.onPitch[o][4];
    if (!l || !r) return null;
    const dirT = m.dir[this.team], dirO = m.dir[o];
    // slot 1 = left from its own team perspective; convert to our perspective (same dir => same side, opposite => mirrored)
    const lEnergy = l.en, rEnergy = r.en;
    const weakerOppLeft = lEnergy < rEnergy;
    const same = dirT === dirO;
    if (Math.abs(lEnergy - rEnergy) < 0.04) return null;
    return weakerOppLeft ? (same ? 'left' : 'right') : (same ? 'right' : 'left');
  }
  private subs(m: Match) {
    const t = this.team, st = m.rules.subs[t];
    if (st.used + st.pending.length >= 5) return;
    const tired = m.pitch[t].filter((a) => !a.isGK && a.en < (this.profile.difficulty === 'hard' ? 0.42 : 0.3)).sort((a, b) => a.en - b.en);
    if (!tired.length) return;
    const out = tired[0];
    const used = new Set([...st.pending.map((p) => p.inn)]);
    const bench = m.agents[t].filter((a) => !a.onPitch && !a.sentOff && !used.has(a.card.id) && !m.rules.subbedOff.has(a.card.id) && a.card.group !== 'GK');
    if (!bench.length) return;
    bench.sort((a, b) => (b.card.group === out.card.group ? 20 : 0) + b.card.ovr - ((a.card.group === out.card.group ? 20 : 0) + a.card.ovr));
    m.requestSub(t, out.card.id, bench[0].card.id);
  }
  /** Halftime: swap out the most exhausted players. */
  halftime(m: Match) {
    const t = this.team, st = m.rules.subs[t];
    const tired = m.pitch[t].filter((a) => !a.isGK && a.en < 0.5).sort((a, b) => a.en - b.en).slice(0, 2);
    for (const out of tired) {
      if (st.used >= 5) break;
      const bench = m.agents[t].filter((a) => !a.onPitch && !a.sentOff && !m.rules.subbedOff.has(a.card.id) && a.card.group !== 'GK');
      bench.sort((a, b) => (b.card.group === out.card.group ? 20 : 0) + b.card.ovr - ((a.card.group === out.card.group ? 20 : 0) + a.card.ovr));
      if (bench[0]) m.requestSub(t, out.card.id, bench[0].card.id);
    }
  }
}
