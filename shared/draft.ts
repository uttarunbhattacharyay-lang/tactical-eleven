import type { PlayerCard, PosGroup } from './types';

export const MIN_GROUP: Record<PosGroup, number> = { GK: 1, DEF: 4, MID: 4, ATT: 2 };
export const POOL_COUNT: Record<PosGroup, number> = { GK: 4, DEF: 14, MID: 14, ATT: 8 };

/** A pick is legal if the player is free, the group cap leaves the opponent a legal XI, and own minimums stay reachable. */
export function canDraft(mine: PlayerCard[], taken: Set<string>, p: PlayerCard): boolean {
  if (taken.has(p.id)) return false;
  const cnt: Record<PosGroup, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  for (const q of mine) cnt[q.group]++;
  if (cnt[p.group] + 1 > POOL_COUNT[p.group] - MIN_GROUP[p.group]) return false;
  const picksLeft = 20 - mine.length - 1;
  let need = 0;
  for (const g of Object.keys(MIN_GROUP) as PosGroup[]) need += Math.max(0, MIN_GROUP[g] - (cnt[g] + (g === p.group ? 1 : 0)));
  return need <= picksLeft;
}
