// Shared domain types + pitch constants (105m x 68m, IFAB dimensions)

export const L = 105;
export const W = 68;
export const GOAL_W = 7.32;
export const GY0 = (W - GOAL_W) / 2;
export const GY1 = (W + GOAL_W) / 2;
export const BOX_D = 16.5;
export const BOX_Y0 = 13.84;
export const BOX_Y1 = 54.16;
export const SIX_D = 5.5;
export const SIX_Y0 = 24.84;
export const SIX_Y1 = 43.16;
export const PEN_SPOT = 11;

export type TeamId = 0 | 1;
export type Pos = 'GK' | 'CB' | 'LB' | 'RB' | 'LWB' | 'RWB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'ST' | 'CF' | 'LW' | 'RW';
export type PosGroup = 'GK' | 'DEF' | 'MID' | 'ATT';

export const SKILL_KEYS = ['pace', 'passing', 'touch', 'finishing', 'tackling', 'positioning', 'composure', 'stamina', 'aerial', 'goalkeeping'] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];
export const SKILL_LABELS: Record<SkillKey, string> = {
  pace: 'Pace',
  passing: 'Passing Vision',
  touch: 'First Touch & Control',
  finishing: 'Finishing',
  tackling: 'Tackling & Interception',
  positioning: 'Positioning & Discipline',
  composure: 'Composure',
  stamina: 'Stamina',
  aerial: 'Aerial Reach',
  goalkeeping: 'GK Reflexes / Distribution',
};
export const SKILL_SHORT: Record<SkillKey, string> = {
  pace: 'PAC', passing: 'PAS', touch: 'TCH', finishing: 'FIN', tackling: 'TKL', positioning: 'POS', composure: 'CMP', stamina: 'STA', aerial: 'AIR', goalkeeping: 'GKP',
};
export type Skills = Record<SkillKey, number>;

export interface PlayerCard {
  id: string;
  name: string;
  pos: Pos;
  group: PosGroup;
  archetype: string;
  skills: Skills;
  ovr: number;
  number: number;
}

export type Strategy = 'gegenpress' | 'positional' | 'vertical' | 'lowblock';
export type PressTrigger = 'backPass' | 'touchline' | 'poorTouch' | 'always';
export type BuildUp = 'short' | 'mixed' | 'direct';
export type TransitionStyle = 'counterpress' | 'regroup' | 'counterattack';

/** Formation point: [depth 0 (own goal) .. 1 (opponent goal), lateral -1 (left) .. 1 (right)] */
export type Pt = [number, number];

export interface TeamTactics {
  ipShape: string; // template the shape started from (fallback when no custom points)
  oopShape: string;
  /** Free-form positions per slot (index = slot, 0 = GK). Override the template shapes when present. */
  ipPts?: Pt[];
  oopPts?: Pt[];
  roles: string[]; // 11 entries, index = slot (0 = GK)
  lineHeight: number; // 0..100
  pressing: number; // 0..100
  triggers: PressTrigger[];
  buildUp: BuildUp;
  transition: TransitionStyle;
  strategy: Strategy;
}

export interface Lineup {
  starters: string[]; // 11 ids, index = slot, 0 = GK
  bench: string[]; // 9 ids
}

export type ZoneId = 'leftFlank' | 'rightFlank' | 'leftHalfSpace' | 'rightHalfSpace' | 'centralMid';
export type UnitCmd = 'fullbackOverlap' | 'fullbackInvert' | 'midDropDeep' | 'forwardPressHigh';
export type Side = 'left' | 'right' | 'both';

export type Order =
  | { kind: 'overload'; zone: ZoneId }
  | { kind: 'swarm' }
  | { kind: 'lowBlock' }
  | { kind: 'strategy'; strategy: Strategy }
  | { kind: 'unit'; unit: UnitCmd; side: Side }
  | { kind: 'tactics'; patch: Partial<TeamTactics> }
  | { kind: 'cancel' };

export type RestartKind = 'kickoff' | 'throwIn' | 'goalKick' | 'corner' | 'freeKick' | 'penalty';

export type EventType =
  | 'kickoff' | 'goal' | 'shot' | 'save' | 'foul' | 'yellow' | 'red' | 'penalty' | 'offside'
  | 'corner' | 'freekick' | 'throwin' | 'goalkick' | 'sub' | 'turnover' | 'chance' | 'half' | 'full'
  | 'order' | 'stoppage' | 'miss';

export interface MatchEvent {
  id: number;
  tick: number;
  label: string; // e.g. "45+2'"
  minute: number;
  type: EventType;
  team: TeamId | -1;
  playerId?: string;
  text: string;
  causes: string[];
  importance: number; // 1..10
  xg?: number;
  x?: number;
  y?: number;
}

export interface PlayerSnap {
  id: string;
  x: number;
  y: number;
  en: number; // energy 0..1
  f: number; // flags
}
export const F_BALL = 1, F_SPRINT = 2, F_YELLOW = 4, F_PRESS = 8, F_ABSENT = 16, F_ORDER = 32, F_SUBBED = 64;

export interface TeamStats {
  shots: number; onTarget: number; xg: number; passes: number; passesOk: number; poss: number;
  tackles: number; intercepts: number; fouls: number; corners: number; offsides: number;
  yellows: number; reds: number; saves: number;
}

export interface ActiveOrderView { key: string; label: string; ticks: number; total: number }
export interface CtlView {
  lag: number;
  lock: number;
  active: ActiveOrderView[];
  cd: Record<string, number>;
  subsUsed: number;
  windowsUsed: number;
  pendingSubs: { out: string; in: string }[];
}

export interface Snapshot {
  tick: number;
  totalTicks: number;
  half: 1 | 2;
  label: string;
  minute: number;
  phase: 'play' | 'dead' | 'halftime' | 'fulltime';
  ball: { x: number; y: number; z: number; owner: string | null };
  p: PlayerSnap[]; // 22: team0 slots 0..10, team1 slots 0..10
  score: [number, number];
  restart: { kind: RestartKind; team: TeamId; x: number; y: number } | null;
  stats: [TeamStats, TeamStats];
  ctl: [CtlView, CtlView];
  dir: [1 | -1, 1 | -1];
  added: number; // stoppage minutes announced for current half
  ev?: MatchEvent[];
}

export function emptyStats(): TeamStats {
  return { shots: 0, onTarget: 0, xg: 0, passes: 0, passesOk: 0, poss: 0, tackles: 0, intercepts: 0, fouls: 0, corners: 0, offsides: 0, yellows: 0, reds: 0, saves: 0 };
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
