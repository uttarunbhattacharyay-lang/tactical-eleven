import type { PlayerCard, Pos, SkillKey, Skills } from './types';
import { SKILL_KEYS } from './types';
import { posFit } from './formations';

/** How much each skill matters in each position (weights sum to ~1). */
export const POS_W: Record<Pos, Partial<Skills>> = {
  GK: { goalkeeping: 0.6, positioning: 0.15, composure: 0.1, aerial: 0.1, passing: 0.05 },
  CB: { tackling: 0.26, positioning: 0.22, aerial: 0.2, pace: 0.1, composure: 0.1, passing: 0.06, stamina: 0.06 },
  LB: { tackling: 0.2, pace: 0.2, stamina: 0.15, positioning: 0.15, passing: 0.12, touch: 0.1, composure: 0.08 },
  RB: { tackling: 0.2, pace: 0.2, stamina: 0.15, positioning: 0.15, passing: 0.12, touch: 0.1, composure: 0.08 },
  LWB: { pace: 0.22, stamina: 0.2, passing: 0.15, touch: 0.13, tackling: 0.15, positioning: 0.08, composure: 0.07 },
  RWB: { pace: 0.22, stamina: 0.2, passing: 0.15, touch: 0.13, tackling: 0.15, positioning: 0.08, composure: 0.07 },
  CDM: { tackling: 0.24, positioning: 0.22, passing: 0.18, composure: 0.12, stamina: 0.12, aerial: 0.06, touch: 0.06 },
  CM: { passing: 0.24, touch: 0.16, stamina: 0.16, positioning: 0.12, tackling: 0.1, composure: 0.12, finishing: 0.05, pace: 0.05 },
  CAM: { passing: 0.22, touch: 0.22, finishing: 0.16, composure: 0.14, positioning: 0.1, pace: 0.1, stamina: 0.06 },
  LM: { pace: 0.2, passing: 0.18, touch: 0.18, stamina: 0.16, finishing: 0.08, composure: 0.1, tackling: 0.1 },
  RM: { pace: 0.2, passing: 0.18, touch: 0.18, stamina: 0.16, finishing: 0.08, composure: 0.1, tackling: 0.1 },
  LW: { pace: 0.24, touch: 0.2, finishing: 0.2, composure: 0.12, passing: 0.1, positioning: 0.08, stamina: 0.06 },
  RW: { pace: 0.24, touch: 0.2, finishing: 0.2, composure: 0.12, passing: 0.1, positioning: 0.08, stamina: 0.06 },
  ST: { finishing: 0.3, positioning: 0.18, composure: 0.14, pace: 0.14, touch: 0.1, aerial: 0.1, stamina: 0.04 },
  CF: { finishing: 0.22, touch: 0.18, passing: 0.16, composure: 0.14, positioning: 0.14, pace: 0.1, aerial: 0.06 },
};
export const POS_NAME: Record<Pos, string> = {
  GK: 'Goalkeeper', CB: 'Centre-back', LB: 'Left-back', RB: 'Right-back', LWB: 'Left wing-back', RWB: 'Right wing-back',
  CDM: 'Defensive midfielder', CM: 'Central midfielder', CAM: 'Attacking midfielder', LM: 'Left midfielder', RM: 'Right midfielder',
  LW: 'Left winger', RW: 'Right winger', ST: 'Striker', CF: 'Centre-forward',
};

const STRONG: Record<SkillKey, string> = {
  pace: 'Explosive pace — wins races in behind and recovers quickly',
  passing: 'Elite passing vision — finds and splits lines',
  touch: 'Silky first touch and close control under pressure',
  finishing: 'Clinical finisher — punishes half-chances',
  tackling: 'Ferocious in the tackle and reads interceptions early',
  positioning: 'Superb positional sense and discipline',
  composure: 'Ice-cold composure in big moments',
  stamina: 'Tireless engine — keeps going for 90 minutes',
  aerial: 'Dominant in the air at both ends',
  goalkeeping: 'Outstanding reflexes and shot-stopping',
};
const WEAK: Record<SkillKey, string> = {
  pace: 'Lacks pace — vulnerable in a foot race',
  passing: 'Limited passing range; can be pressed into mistakes',
  touch: 'Heavy touch when closed down',
  finishing: 'Wasteful in front of goal',
  tackling: 'Weak in the tackle and in defensive duels',
  positioning: 'Loses positional discipline',
  composure: 'Can panic under pressure',
  stamina: 'Fades late in matches — plan a substitution',
  aerial: 'Struggles in aerial duels',
  goalkeeping: 'Shaky shot-stopping',
};

/** Rating (0-99) of a player in a given position: skill fit for the job, scaled by familiarity. */
export function positionRating(p: PlayerCard, pos: Pos): number {
  let v = 0;
  for (const k of SKILL_KEYS) v += (POS_W[pos][k] ?? 0) * p.skills[k];
  return Math.round(v * (0.82 + 0.18 * posFit(p.pos, pos)));
}

export function bestPositions(p: PlayerCard, n = 3): { pos: Pos; rating: number }[] {
  const all = (Object.keys(POS_W) as Pos[]).filter((q) => (p.pos === 'GK') === (q === 'GK'));
  return all.map((pos) => ({ pos, rating: positionRating(p, pos) })).sort((a, b) => b.rating - a.rating).slice(0, n);
}

/** Skills that matter for this player's natural position (plus pace & stamina, which matter everywhere). */
function relevant(p: PlayerCard): SkillKey[] {
  const w = POS_W[p.pos];
  return SKILL_KEYS.filter((k) => (w[k] ?? 0) >= 0.06 || (p.group !== 'GK' && (k === 'pace' || k === 'stamina')));
}

export function strengths(p: PlayerCard): { key: SkillKey; value: number; text: string }[] {
  const keys = SKILL_KEYS.filter((k) => p.group === 'GK' || k !== 'goalkeeping');
  let top = keys.filter((k) => p.skills[k] >= 84).sort((a, b) => p.skills[b] - p.skills[a]);
  if (top.length < 2) top = keys.filter((k) => relevant(p).includes(k)).sort((a, b) => p.skills[b] - p.skills[a]).slice(0, 2);
  return top.slice(0, 4).map((k) => ({ key: k, value: p.skills[k], text: STRONG[k] }));
}

export function weaknesses(p: PlayerCard): { key: SkillKey; value: number; text: string }[] {
  const rel = relevant(p).sort((a, b) => p.skills[a] - p.skills[b]);
  const weak = rel.filter((k) => p.skills[k] < 66).slice(0, 3).map((k) => ({ key: k, value: p.skills[k], text: WEAK[k] }));
  if (weak.length) return weak;
  // world-class players rarely have real holes: report the relative weak spot instead
  const k = rel[0];
  return k && p.skills[k] < 80 ? [{ key: k, value: p.skills[k], text: `Relative weak spot: ${WEAK[k].charAt(0).toLowerCase()}${WEAK[k].slice(1)}` }] : [];
}
