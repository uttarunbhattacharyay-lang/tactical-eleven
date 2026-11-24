import type { Pos, PosGroup, Pt, Strategy } from './types';
import { L } from './types';

// 11 slots per team: 0 = GK, then the 10-slot skeleton
// [1 LB, 2 LCB, 3 RCB, 4 RB, 5 LM, 6 LCM, 7 RCM, 8 RM, 9 LF, 10 RF]
// Every shape (in possession / out of possession) supplies a coordinate for every slot, so players
// physically transform between phases (e.g. 4-4-2 out of possession -> 3-2-5 in possession).
export type SlotGroup = 'GK' | 'FB' | 'CB' | 'WM' | 'CM' | 'FW';
export const SLOT_LABELS = ['GK', 'LB', 'LCB', 'RCB', 'RB', 'LM', 'LCM', 'RCM', 'RM', 'LF', 'RF'] as const;
export const SLOT_GROUP: SlotGroup[] = ['GK', 'FB', 'CB', 'CB', 'FB', 'WM', 'CM', 'CM', 'WM', 'FW', 'FW'];
export const SLOT_NATURAL: Pos[][] = [
  ['GK'], ['LB', 'LWB'], ['CB'], ['CB'], ['RB', 'RWB'], ['LM', 'LW'], ['CM', 'CDM', 'CAM'], ['CM', 'CDM', 'CAM'], ['RM', 'RW'], ['ST', 'CF', 'LW', 'RW'], ['ST', 'CF', 'RW', 'LW'],
];
export const SLOT_CLOSE: Pos[][] = [
  [], ['RB', 'RWB', 'CB', 'LM'], ['LB', 'RB', 'CDM'], ['LB', 'RB', 'CDM'], ['LB', 'LWB', 'CB', 'RM'],
  ['RM', 'RW', 'CM', 'CAM', 'LWB'], ['LM', 'RM', 'CB'], ['LM', 'RM', 'CB'], ['LM', 'LW', 'CM', 'CAM', 'RWB'], ['CAM', 'LM', 'RM'], ['CAM', 'LM', 'RM'],
];
const SLOT_PG: PosGroup[] = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'ATT', 'ATT'];
export const POS_GROUP: Record<Pos, PosGroup> = {
  GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF', CDM: 'MID', CM: 'MID', CAM: 'MID', LM: 'MID', RM: 'MID', ST: 'ATT', CF: 'ATT', LW: 'ATT', RW: 'ATT',
};

/** Positional familiarity multiplier 0.2..1 for a natural position playing in a slot. */
export function slotFit(pos: Pos, slot: number): number {
  if (SLOT_NATURAL[slot].includes(pos)) return 1;
  if (SLOT_CLOSE[slot].includes(pos)) return 0.88;
  if (slot === 0) return 0.2;
  if (pos === 'GK') return 0.35;
  return POS_GROUP[pos] === SLOT_PG[slot] ? 0.78 : 0.6;
}

export interface ShapeDef { id: string; label: string; pts: Pt[] }
const GK0: Pt = [0.045, 0];
const S = (id: string, pts: Pt[]): ShapeDef => ({ id, label: id, pts: [GK0, ...pts] });

export const IP_SHAPES: ShapeDef[] = [
  S('4-4-2', [[.34,-.85],[.24,-.3],[.24,.3],[.34,.85],[.55,-.85],[.50,-.25],[.50,.25],[.55,.85],[.70,-.2],[.70,.2]]),
  S('4-3-3', [[.38,-.88],[.24,-.3],[.24,.3],[.38,.88],[.70,-.82],[.50,-.3],[.50,.3],[.44,0],[.78,0],[.70,.82]]),
  S('4-2-3-1', [[.36,-.86],[.24,-.3],[.24,.3],[.36,.86],[.64,-.78],[.44,-.2],[.44,.2],[.64,.78],[.80,0],[.64,0]]),
  S('3-2-5', [[.58,-.62],[.26,-.52],[.26,.52],[.25,0],[.72,-.92],[.42,-.2],[.42,.2],[.72,.92],[.82,-.12],[.78,.38]]),
  S('2-3-5', [[.42,-.55],[.24,-.26],[.24,.26],[.42,.55],[.72,-.9],[.46,0],[.80,0],[.72,.9],[.78,-.45],[.78,.45]]),
  S('3-1-6', [[.64,-.62],[.26,-.5],[.26,.5],[.25,0],[.76,-.92],[.42,0],[.78,0],[.76,.92],[.84,-.3],[.84,.3]]),
  S('4-2-4', [[.38,-.82],[.24,-.3],[.24,.3],[.38,.82],[.74,-.85],[.45,-.16],[.45,.16],[.74,.85],[.80,-.25],[.80,.25]]),
];
export const OOP_SHAPES: ShapeDef[] = [
  S('4-4-2 Mid-Block', [[.28,-.8],[.2,-.3],[.2,.3],[.28,.8],[.40,-.8],[.38,-.25],[.38,.25],[.40,.8],[.52,-.18],[.52,.18]]),
  S('5-4-1 Low Block', [[.22,-.86],[.17,-.4],[.17,.4],[.22,.86],[.30,-.72],[.17,0],[.32,-.22],[.30,.72],[.32,.22],[.46,0]]),
  S('4-3-3 Press', [[.38,-.8],[.30,-.3],[.30,.3],[.38,.8],[.64,-.74],[.50,-.3],[.50,.3],[.45,0],[.68,0],[.64,.74]]),
  S('4-5-1 Compact', [[.27,-.82],[.2,-.3],[.2,.3],[.27,.82],[.40,-.8],[.37,-.3],[.37,.3],[.40,.8],[.52,0],[.38,0]]),
  S('4-4-2 High Press', [[.42,-.8],[.34,-.3],[.34,.3],[.42,.8],[.58,-.8],[.55,-.25],[.55,.25],[.58,.8],[.70,-.2],[.70,.2]]),
];
export const SHAPES: Record<string, ShapeDef> = Object.fromEntries([...IP_SHAPES, ...OOP_SHAPES].map((s) => [s.id, s]));

export interface RoleDef {
  id: string; label: string; groups: SlotGroup[]; desc: string;
  ipDx: number; oopDx: number; ipIn: number; ipOut: number;
  risk: number; shoot: number; dribble: number; run: number; press: number; hold: number;
}
const r = (id: string, label: string, groups: SlotGroup[], desc: string, o: Partial<RoleDef> = {}): RoleDef => ({
  id, label, groups, desc, ipDx: 0, oopDx: 0, ipIn: 0, ipOut: 0, risk: 0, shoot: 1, dribble: 1, run: 0.3, press: 1, hold: 0, ...o,
});
export const ROLES: RoleDef[] = [
  r('gk', 'Shot-Stopper', ['GK'], 'Stays on his line and commands the box.'),
  r('sweeper', 'Sweeper Keeper', ['GK'], 'Plays high, sweeps behind the line and starts attacks.', { ipDx: 0.05, oopDx: 0.07, risk: 0.25 }),
  r('cb', 'Central Defender', ['CB'], 'Holds the line and wins duels.'),
  r('ballcb', 'Ball-Playing CB', ['CB'], 'Steps out with the ball and splits lines with passes.', { ipDx: 0.04, risk: 0.5, hold: 0.1 }),
  r('stopper', 'Stopper', ['CB'], 'Aggressively steps onto strikers.', { oopDx: 0.05, press: 1.4, risk: -0.3 }),
  r('fb', 'Full-Back', ['FB'], 'Balanced defend / support.', { ipDx: 0.04 }),
  r('invfb', 'Inverted Full-Back', ['FB'], 'Tucks into midfield in possession to form a pivot.', { ipDx: 0.1, ipIn: 0.75, risk: 0.2 }),
  r('wingback', 'Wing-Back', ['FB'], 'Provides all the width, high up the pitch.', { ipDx: 0.2, oopDx: 0.06, ipOut: 0.4, run: 0.6 }),
  r('defwb', 'Defensive Full-Back', ['FB'], 'Stays home, rarely overlaps.', { ipDx: -0.05, oopDx: -0.02, risk: -0.3 }),
  r('b2b', 'Box-to-Box Midfielder', ['CM'], 'Covers ground at both ends.', { ipDx: 0.1, run: 0.55, press: 1.15, shoot: 1.1 }),
  r('dlp', 'Deep-Lying Playmaker', ['CM'], 'Drops deep to dictate tempo.', { ipDx: -0.07, risk: 0.35, hold: 0.25, shoot: 0.6, run: 0.05 }),
  r('anchor', 'Anchor', ['CM'], 'Screens the back line.', { ipDx: -0.08, oopDx: -0.04, risk: -0.25, shoot: 0.4, run: 0, press: 0.9 }),
  r('hs10', 'Half-Space 10', ['CM', 'WM'], 'Occupies the half-space between the lines.', { ipDx: 0.14, risk: 0.35, shoot: 1.2, run: 0.5, dribble: 1.1 }),
  r('ballwinner', 'Ball-Winning Midfielder', ['CM'], 'Hunts the ball relentlessly.', { press: 1.5, risk: -0.2, shoot: 0.5 }),
  r('winger', 'Winger', ['WM', 'FW'], 'Hugs the touchline, beats his man, crosses.', { ipDx: 0.06, ipOut: 0.3, dribble: 1.4, run: 0.45 }),
  r('insidefwd', 'Inside Forward', ['WM', 'FW'], 'Cuts inside to shoot.', { ipDx: 0.08, ipIn: 0.45, shoot: 1.4, dribble: 1.2, run: 0.7 }),
  r('widemid', 'Wide Midfielder', ['WM'], 'Disciplined two-way wide player.', { press: 1.1 }),
  r('target', 'Target Striker', ['FW'], 'Holds the ball up and wins aerial duels.', { ipDx: 0.02, hold: 0.2, run: 0.15, shoot: 1.1 }),
  r('poacher', 'Poacher', ['FW'], 'Lives on the last defender’s shoulder.', { ipDx: 0.06, run: 0.95, shoot: 1.45, press: 0.6 }),
  r('pressfwd', 'Pressing Forward', ['FW'], 'Leads the press.', { press: 1.7, run: 0.55 }),
  r('false9', 'False 9', ['FW'], 'Drops into midfield to link play.', { ipDx: -0.12, risk: 0.3, hold: 0.15, run: 0.2, shoot: 0.8 }),
];
export const ROLE_MAP: Record<string, RoleDef> = Object.fromEntries(ROLES.map((x) => [x.id, x]));
export const DEFAULT_ROLES = ['gk', 'fb', 'cb', 'cb', 'fb', 'widemid', 'b2b', 'dlp', 'widemid', 'target', 'poacher'];

export interface StratDef { id: Strategy; label: string; desc: string; press: number; line: number; compact: number; tempo: number; direct: number }
export const STRATS: Record<Strategy, StratDef> = {
  gegenpress: { id: 'gegenpress', label: 'Gegenpress', desc: 'Win it back within seconds. High line, heavy stamina cost, gaps behind if bypassed.', press: 15, line: 8, compact: 0.12, tempo: 0.25, direct: 0.1 },
  positional: { id: 'positional', label: 'Positional Build-Up', desc: 'Patient short passing to drag opponents out of shape. Lower tempo.', press: 0, line: 4, compact: 0, tempo: -0.2, direct: -0.25 },
  vertical: { id: 'vertical', label: 'Direct Vertical Counter', desc: 'Sit off, win it, go long and fast to runners.', press: -10, line: -8, compact: -0.05, tempo: 0.35, direct: 0.45 },
  lowblock: { id: 'lowblock', label: 'Low-Block Shield', desc: 'Drop deep and compact, absorb pressure, hit on the break.', press: -25, line: -20, compact: 0.18, tempo: 0.1, direct: 0.35 },
};

// ------------------------------------------------------------- free-form formations

/** Shape points for a team's tactics: custom (dragged) positions, else the template. */
export function shapePts(t: { ipShape: string; oopShape: string; ipPts?: Pt[]; oopPts?: Pt[] }, kind: 'ip' | 'oop'): Pt[] {
  const custom = kind === 'ip' ? t.ipPts : t.oopPts;
  if (custom && custom.length === 11) return custom;
  return (SHAPES[kind === 'ip' ? t.ipShape : t.oopShape] ?? SHAPES[kind === 'ip' ? '4-4-2' : '4-4-2 Mid-Block']).pts;
}
export const clonePts = (p: Pt[]): Pt[] => p.map(([a, b]) => [a, b] as Pt);

/** Position a point on the pitch corresponds to (depth 0..1 towards the opponent goal, lateral -1 left .. 1 right). */
export function zoneOf([d, y]: Pt): Pos {
  const L = y < 0;
  if (d < 0.1) return 'GK';
  if (Math.abs(y) > 0.6) {
    if (d < 0.4) return L ? 'LB' : 'RB';
    if (d < 0.5) return L ? 'LWB' : 'RWB';
    if (d < 0.66) return L ? 'LM' : 'RM';
    return L ? 'LW' : 'RW';
  }
  if (d < 0.32) return 'CB';
  if (d < 0.44) return 'CDM';
  if (d < 0.6) return 'CM';
  if (d < 0.68) return 'CAM';
  return 'ST';
}
const CLOSE_POS: Record<Pos, Pos[]> = {
  GK: [], CB: ['CDM', 'LB', 'RB'], LB: ['LWB', 'CB', 'LM'], RB: ['RWB', 'CB', 'RM'], LWB: ['LB', 'LM', 'LW'], RWB: ['RB', 'RM', 'RW'],
  CDM: ['CM', 'CB'], CM: ['CDM', 'CAM'], CAM: ['CM', 'CF', 'ST'], LM: ['LW', 'LWB', 'CM', 'RM'], RM: ['RW', 'RWB', 'CM', 'LM'],
  LW: ['LM', 'RW', 'ST', 'CF'], RW: ['RM', 'LW', 'ST', 'CF'], ST: ['CF', 'CAM', 'LW', 'RW'], CF: ['ST', 'CAM', 'LW', 'RW'],
};
/** Familiarity (0.2..1) of a player whose natural position is `pos` playing in `zone`. */
export function posFit(pos: Pos, zone: Pos): number {
  if (pos === zone || (pos === 'CF' && zone === 'ST')) return 1;
  if (zone === 'GK') return 0.2;
  if (pos === 'GK') return 0.35;
  if (CLOSE_POS[pos].includes(zone) || CLOSE_POS[zone].includes(pos)) return 0.88;
  return POS_GROUP[pos] === POS_GROUP[zone] ? 0.78 : 0.6;
}
/** Fit for a player standing at a point of the in-possession shape. */
export const fitAt = (pos: Pos, pt: Pt) => posFit(pos, zoneOf(pt));

const ZONE_GROUP: Record<Pos, SlotGroup> = {
  GK: 'GK', CB: 'CB', LB: 'FB', RB: 'FB', LWB: 'FB', RWB: 'FB', CDM: 'CM', CM: 'CM', CAM: 'CM', LM: 'WM', RM: 'WM', LW: 'FW', RW: 'FW', ST: 'FW', CF: 'FW',
};
export const zoneGroup = (zone: Pos): SlotGroup => ZONE_GROUP[zone];
const GROUP_DEFAULT_ROLE: Record<SlotGroup, string> = { GK: 'gk', CB: 'cb', FB: 'fb', CM: 'b2b', WM: 'widemid', FW: 'poacher' };
/** Keep a role if it suits the zone, otherwise fall back to the zone's default role. */
export function roleForZone(role: string, zone: Pos): string {
  const g = zoneGroup(zone);
  return ROLE_MAP[role]?.groups.includes(g) ? role : GROUP_DEFAULT_ROLE[g];
}

/**
 * Canonical slot order from the out-of-possession shape: GK, then the deepest four (left→right),
 * the next four (left→right) and the two most advanced (left→right). Returns perm with perm[newSlot] = oldSlot.
 * The engine's unit commands and defensive-line logic rely on this ordering.
 */
export function canonicalPerm(oop: Pt[]): number[] {
  const out = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].sort((a, b) => oop[a][0] - oop[b][0] || a - b);
  const byY = (arr: number[]) => arr.sort((a, b) => oop[a][1] - oop[b][1] || a - b);
  return [0, ...byY(out.slice(0, 4)), ...byY(out.slice(4, 8)), ...byY(out.slice(8))];
}
export const permute = <T>(arr: T[], perm: number[]): T[] => perm.map((i) => arr[i]);

export function toWorld(dir: 1 | -1, x01: number, y01: number) {
  return { x: dir === 1 ? x01 * L : (1 - x01) * L, y: 34 + y01 * 30 * dir };
}
export function depthOf(dir: 1 | -1, x: number) {
  return dir === 1 ? x / L : 1 - x / L;
}
