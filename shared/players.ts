import { Rng } from './rng';
import type { PlayerCard, Pos, PosGroup, Skills } from './types';
import { SKILL_KEYS, clamp } from './types';
import { POS_GROUP } from './formations';

/** Archetype labels (used for draft filters). */
export const ALL_ARCHETYPES = [
  'Shot-Stopper', 'Sweeper Keeper',
  'Stopper', 'Ball-Playing CB', 'Aerial Dominator', 'Sweeper',
  'Defensive FB', 'Overlapping FB', 'Inverted FB', 'Wing-Back',
  'Anchor', 'Ball-Winner', 'Deep-Lying Playmaker', 'Box-to-Box', 'Playmaker',
  'Half-Space 10', 'Shadow Striker', 'Winger', 'Wide Playmaker', 'Inside Winger',
  'Target Striker', 'Poacher', 'Pressing Forward', 'Complete Forward', 'False 9', 'Inside Forward', 'Raumdeuter',
];

/**
 * Real-world roster, with skills modelled on each player's style.
 * Skill order: [pace, passing, touch, finishing, tackling, positioning, composure, stamina, aerial, goalkeeping]
 * Outfield players get a nominal goalkeeping value.
 */
type Row = [name: string, pos: Pos, archetype: string, skills: number[]];
const ROSTER: Row[] = [
  // Goalkeepers
  ['Alisson Becker', 'GK', 'Shot-Stopper', [52, 72, 66, 12, 30, 86, 88, 60, 80, 90]],
  ['Thibaut Courtois', 'GK', 'Shot-Stopper', [45, 62, 58, 12, 26, 90, 86, 58, 90, 91]],
  ['Ederson', 'GK', 'Sweeper Keeper', [60, 90, 82, 14, 32, 76, 82, 60, 72, 82]],
  ['Gianluigi Donnarumma', 'GK', 'Shot-Stopper', [50, 58, 55, 12, 28, 84, 80, 58, 85, 88]],
  // Centre-backs
  ['Virgil van Dijk', 'CB', 'Aerial Dominator', [76, 76, 70, 40, 88, 90, 90, 74, 92, 8]],
  ['William Saliba', 'CB', 'Sweeper', [84, 72, 74, 30, 86, 88, 86, 76, 80, 8]],
  ['Rúben Dias', 'CB', 'Stopper', [64, 70, 66, 34, 88, 88, 84, 78, 84, 8]],
  ['Antonio Rüdiger', 'CB', 'Stopper', [80, 62, 60, 36, 86, 80, 76, 80, 84, 8]],
  ['Alessandro Bastoni', 'CB', 'Ball-Playing CB', [70, 84, 80, 40, 82, 82, 80, 76, 80, 8]],
  ['Gabriel Magalhães', 'CB', 'Aerial Dominator', [72, 62, 60, 50, 85, 82, 78, 74, 90, 8]],
  // Full-backs & wing-backs
  ['Nuno Mendes', 'LB', 'Overlapping FB', [90, 76, 82, 56, 78, 74, 76, 86, 64, 8]],
  ['Joško Gvardiol', 'LB', 'Inverted FB', [80, 80, 78, 58, 82, 80, 80, 80, 80, 8]],
  ['Marc Cucurella', 'LB', 'Defensive FB', [74, 72, 74, 40, 80, 80, 76, 88, 66, 8]],
  ['Achraf Hakimi', 'RB', 'Overlapping FB', [92, 80, 80, 66, 74, 74, 78, 88, 64, 8]],
  ['Trent Alexander-Arnold', 'RB', 'Inverted FB', [74, 94, 86, 64, 74, 76, 82, 80, 64, 8]],
  ['Jules Koundé', 'RB', 'Defensive FB', [84, 74, 74, 40, 84, 82, 78, 80, 72, 8]],
  ['Alejandro Grimaldo', 'LWB', 'Wing-Back', [82, 88, 84, 72, 72, 76, 80, 88, 58, 8]],
  ['Jeremie Frimpong', 'RWB', 'Wing-Back', [94, 76, 82, 68, 72, 74, 76, 90, 56, 8]],
  // Defensive midfield
  ['Rodri', 'CDM', 'Anchor', [62, 90, 86, 66, 86, 92, 92, 84, 80, 8]],
  ['Declan Rice', 'CDM', 'Ball-Winner', [76, 82, 80, 66, 86, 84, 84, 92, 76, 8]],
  ['Joshua Kimmich', 'CDM', 'Deep-Lying Playmaker', [66, 92, 84, 60, 76, 82, 86, 86, 58, 8]],
  // Central midfield
  ['Pedri', 'CM', 'Playmaker', [72, 90, 92, 66, 64, 80, 88, 86, 52, 8]],
  ['Federico Valverde', 'CM', 'Box-to-Box', [86, 82, 80, 76, 78, 80, 82, 96, 70, 8]],
  ['Vitinha', 'CM', 'Deep-Lying Playmaker', [70, 90, 90, 64, 70, 82, 88, 88, 50, 8]],
  ['João Neves', 'CM', 'Ball-Winner', [78, 80, 84, 58, 84, 80, 80, 92, 52, 8]],
  // Attacking midfield
  ['Florian Wirtz', 'CAM', 'Playmaker', [78, 90, 92, 80, 54, 80, 86, 82, 52, 8]],
  ['Jamal Musiala', 'CAM', 'Half-Space 10', [82, 84, 95, 82, 58, 80, 86, 82, 48, 8]],
  ['Jude Bellingham', 'CAM', 'Shadow Striker', [78, 82, 86, 84, 70, 86, 86, 88, 76, 8]],
  // Wide midfield
  ['Nico Williams', 'LM', 'Winger', [93, 80, 86, 74, 50, 72, 76, 86, 48, 8]],
  ['Khvicha Kvaratskhelia', 'LM', 'Inside Winger', [86, 84, 91, 82, 48, 76, 82, 84, 54, 8]],
  ['Bukayo Saka', 'RM', 'Inside Winger', [86, 86, 88, 82, 60, 80, 84, 88, 50, 8]],
  ['Bernardo Silva', 'RM', 'Wide Playmaker', [70, 88, 92, 72, 62, 80, 88, 92, 46, 8]],
  // Strikers
  ['Erling Haaland', 'ST', 'Poacher', [90, 64, 78, 94, 40, 92, 88, 76, 88, 8]],
  ['Harry Kane', 'ST', 'Complete Forward', [68, 88, 86, 93, 50, 90, 92, 78, 84, 8]],
  ['Lautaro Martínez', 'ST', 'Pressing Forward', [80, 72, 82, 86, 64, 86, 84, 90, 74, 8]],
  ['Kylian Mbappé', 'CF', 'Complete Forward', [97, 80, 90, 92, 36, 86, 88, 80, 66, 8]],
  // Wide forwards
  ['Vinícius Júnior', 'LW', 'Inside Forward', [95, 80, 90, 82, 32, 72, 82, 82, 50, 8]],
  ['Raphinha', 'LW', 'Raumdeuter', [86, 82, 84, 84, 52, 86, 82, 88, 54, 8]],
  ['Mohamed Salah', 'RW', 'Inside Forward', [89, 82, 88, 90, 42, 88, 90, 82, 62, 8]],
  ['Lamine Yamal', 'RW', 'Winger', [88, 90, 94, 84, 34, 76, 88, 80, 46, 8]],
];

export const POOL_SPEC: Pos[] = ROSTER.map((r) => r[1]);

const OVR_W: Record<PosGroup, Partial<Skills>> = {
  GK: { goalkeeping: 0.6, positioning: 0.15, composure: 0.1, aerial: 0.1, passing: 0.05 },
  DEF: { tackling: 0.24, positioning: 0.2, aerial: 0.15, pace: 0.12, composure: 0.1, passing: 0.09, stamina: 0.06, touch: 0.04 },
  MID: { passing: 0.22, touch: 0.16, positioning: 0.12, stamina: 0.12, tackling: 0.12, composure: 0.1, pace: 0.08, finishing: 0.04, aerial: 0.04 },
  ATT: { finishing: 0.25, pace: 0.18, touch: 0.14, composure: 0.12, positioning: 0.1, passing: 0.06, stamina: 0.07, aerial: 0.08 },
};

export function computeOvr(group: PosGroup, s: Skills): number {
  let o = 0;
  for (const k of SKILL_KEYS) o += (OVR_W[group][k] ?? 0) * s[k];
  return Math.round(o);
}

/** Build the 40-player draft pool from the real-world roster; the seed only shuffles the order. */
export function generatePool(seed: number): PlayerCard[] {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const cards: PlayerCard[] = ROSTER.map(([name, pos, archetype, vals], i) => {
    const group = POS_GROUP[pos];
    const skills = {} as Skills;
    SKILL_KEYS.forEach((k, j) => { skills[k] = clamp(vals[j], 1, 99); });
    return { id: `P${String(i + 1).padStart(2, '0')}`, name, pos, group, archetype, skills, ovr: computeOvr(group, skills), number: 0 };
  });
  return rng.shuffle(cards);
}

const NUM_PREF: Record<Pos, number[]> = {
  GK: [1, 12, 13, 23, 25, 31], CB: [4, 5, 15, 6, 22, 26, 3, 2], LB: [3, 15, 16, 19, 23, 25], RB: [2, 12, 14, 16, 22, 24],
  LWB: [3, 17, 19, 21, 20], RWB: [2, 18, 22, 21, 20], CDM: [6, 5, 8, 14, 16, 18, 4], CM: [8, 4, 14, 16, 18, 20, 21, 24],
  CAM: [10, 8, 21, 17, 22, 28], LM: [11, 17, 19, 20, 21, 23], RM: [7, 17, 19, 20, 22, 23], ST: [9, 19, 11, 10, 14, 29],
  CF: [9, 19, 13, 10], LW: [11, 17, 10, 21, 23], RW: [7, 17, 10, 21, 23],
};
/** Assign unique squad numbers (positional preferences first). Mutates and returns the squad. */
export function assignNumbers(squad: PlayerCard[]): PlayerCard[] {
  const used = new Set<number>();
  const order = [...squad].sort((a, b) => b.ovr - a.ovr);
  for (const p of order) {
    const pref = NUM_PREF[p.pos].find((n) => !used.has(n));
    if (pref) { p.number = pref; used.add(pref); continue; }
    let n = 30;
    while (used.has(n)) n++;
    p.number = n; used.add(n);
  }
  return squad;
}
