import type { Lineup, MatchEvent, Order, PlayerCard, Snapshot, TeamId, TeamStats, TeamTactics } from './types';
import type { CPUArchetype, CPUDifficulty } from './engine/cpu';

export type RoomPhase = 'lobby' | 'toss' | 'draft' | 'tactics' | 'match' | 'halftime' | 'fulltime';

export interface RoomView {
  code: string;
  seat: TeamId;
  mode: 'cpu' | 'pvp';
  phase: RoomPhase;
  names: [string, string];
  connected: [boolean, boolean];
  ready: [boolean, boolean];
  duration: 3 | 6 | 10;
  cpu?: { archetype: CPUArchetype; difficulty: CPUDifficulty };
  toss: null | { caller: TeamId; call: 'heads' | 'tails' | null; result: 'heads' | 'tails' | null; winner: TeamId | null; choice: 'firstPick' | 'kickoff' | null };
  firstPick: TeamId | null;
  kickoffTeam: TeamId | null;
  draft: null | {
    pool: PlayerCard[]; picks: [string[], string[]]; turn: TeamId; pickNo: number;
  };
  squads: [PlayerCard[], PlayerCard[]] | null; // numbered; opponent squad visible after draft
  lineup: Lineup | null; // own
  tactics: TeamTactics | null; // own (live match tactics once the match has started)
  /** Opponent plan: visible in CPU matches from the tactics board on, and in PvP once the match starts. */
  opp: { lineup: Lineup; tactics: TeamTactics } | null;
  tacticsReady: [boolean, boolean];
  htReady: [boolean, boolean];
  speed: number; // 0 paused, 0.5, 1, 2, 4
  /** Real-time milliseconds per simulation tick at 1x speed. */
  tickMs: number;
  score: [number, number];
  result: null | { score: [number, number]; stats: [TeamStats, TeamStats]; events: MatchEvent[] };
  notice?: string;
}

export type ClientMsg =
  | { t: 'name'; name: string }
  | { t: 'config'; duration: 3 | 6 | 10 }
  | { t: 'ready'; value: boolean }
  | { t: 'tossCall'; call: 'heads' | 'tails' }
  | { t: 'tossChoice'; choice: 'firstPick' | 'kickoff' }
  | { t: 'draftPick'; playerId: string }
  | { t: 'setPlan'; lineup: Lineup; tactics: TeamTactics }
  | { t: 'tacticsReady'; value: boolean }
  | { t: 'speed'; value: number }
  | { t: 'order'; order: Order }
  | { t: 'sub'; outId: string; inId: string }
  | { t: 'cancelSub'; outId: string }
  | { t: 'swap'; a: number; b: number }
  | { t: 'htReady'; value: boolean };

export type ServerMsg =
  | { t: 'view'; view: RoomView }
  | { t: 'snap'; snap: Snapshot }
  | { t: 'result'; ok: boolean; reason?: string; what: string }
  | { t: 'error'; message: string };

export const SPEEDS = [0.5, 1, 2, 4] as const;
