import type { Lineup, PlayerCard, TeamTactics } from './types';
import { DEFAULT_ROLES, ROLE_MAP, SHAPES, canonicalPerm, clonePts, fitAt, permute, roleForZone, shapePts, zoneGroup, zoneOf } from './formations';

export function defaultTactics(): TeamTactics {
  return {
    ipShape: '4-4-2', oopShape: '4-4-2 Mid-Block', roles: [...DEFAULT_ROLES],
    ipPts: clonePts(SHAPES['4-4-2'].pts), oopPts: clonePts(SHAPES['4-4-2 Mid-Block'].pts),
    lineHeight: 50, pressing: 50, triggers: ['backPass', 'touchline'], buildUp: 'mixed', transition: 'regroup', strategy: 'positional',
  };
}

/**
 * Normalise a free-form plan: materialise custom points, re-order slots canonically from the
 * out-of-possession shape (players, points and roles move together) and make each role suit its zone.
 * Returns perm with perm[newSlot] = oldSlot.
 */
export function normalizePlan<T>(tac: TeamTactics, slots: T[]): { tac: TeamTactics; slots: T[]; perm: number[] } {
  const ip = clonePts(shapePts(tac, 'ip')), oop = clonePts(shapePts(tac, 'oop'));
  const perm = canonicalPerm(oop);
  const nip = permute(ip, perm), noop = permute(oop, perm);
  const roles = permute(tac.roles, perm).map((r, i) => roleForZone(r, zoneOf(nip[i])));
  roles[0] = roleForZone(roles[0], 'GK');
  return { tac: { ...tac, ipPts: nip, oopPts: noop, roles }, slots: permute(slots, perm), perm };
}

/** Greedy best-fit XI + bench from a 20-player squad. */
export function autoLineup(squad: PlayerCard[], tac?: TeamTactics): Lineup {
  const ip = shapePts(tac ?? defaultTactics(), 'ip');
  const left = [...squad];
  const starters: (string | null)[] = new Array(11).fill(null);
  // most constrained first
  const order = [0, 2, 3, 1, 4, 6, 7, 5, 8, 9, 10];
  for (const slot of order) {
    let best: PlayerCard | null = null;
    let bs = -1;
    for (const p of left) {
      const sc = p.ovr * fitAt(p.pos, ip[slot]) + (slot === 0 && p.pos === 'GK' ? 100 : 0);
      if (sc > bs) { bs = sc; best = p; }
    }
    if (best) { starters[slot] = best.id; left.splice(left.indexOf(best), 1); }
  }
  // bench: 9 — ensure a GK and one of each group if possible
  const bench: PlayerCard[] = [];
  const takeBest = (pred: (p: PlayerCard) => boolean) => {
    const c = left.filter(pred).sort((a, b) => b.ovr - a.ovr)[0];
    if (c) { bench.push(c); left.splice(left.indexOf(c), 1); }
  };
  takeBest((p) => p.group === 'GK');
  takeBest((p) => p.group === 'DEF'); takeBest((p) => p.group === 'MID'); takeBest((p) => p.group === 'ATT');
  left.sort((a, b) => b.ovr - a.ovr);
  while (bench.length < 9 && left.length) bench.push(left.shift()!);
  return { starters: starters as string[], bench: bench.map((p) => p.id) };
}

export function validateLineup(squad: PlayerCard[], lu: Lineup): string | null {
  const ids = new Set(squad.map((p) => p.id));
  if (lu.starters.length !== 11 || lu.bench.length !== 9) return 'Lineup needs 11 starters and 9 substitutes';
  const all = [...lu.starters, ...lu.bench];
  if (new Set(all).size !== 20 || !all.every((i) => ids.has(i))) return 'Lineup must use each of the 20 squad players exactly once';
  return null;
}

export type Severity = 'high' | 'med' | 'low' | 'ok';
export interface Diagnostic { severity: Severity; title: string; detail: string }

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Pre-kickoff tactical readiness & vulnerability diagnostic. */
export function diagnose(squad: PlayerCard[], lu: Lineup, t: TeamTactics): { score: number; items: Diagnostic[] } {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const xi = lu.starters.map((id) => byId.get(id));
  const items: Diagnostic[] = [];
  const add = (severity: Severity, title: string, detail: string) => items.push({ severity, title, detail });
  if (xi.some((p) => !p)) return { score: 0, items: [{ severity: 'high', title: 'Incomplete XI', detail: 'Every slot needs a player.' }] };
  const P = xi as PlayerCard[];

  if (P[0].pos !== 'GK') add('high', 'No natural goalkeeper', `${P[0].name} is a ${P[0].pos} in goal — shot-stopping collapses.`);
  const ipPts = shapePts(t, 'ip');
  const oop = P.map((p, i) => ({ p, i })).filter(({ p, i }) => i > 0 && fitAt(p.pos, ipPts[i]) < 0.8);
  if (oop.length) add(oop.length > 2 ? 'high' : 'med', `${oop.length} player(s) out of position`, oop.map(({ p, i }) => `${p.name} (${p.pos}) at ${zoneOf(ipPts[i])}`).join(', ') + ' — reduced positional discipline.');

  const cbs = [2, 3].map((i) => P[i]);
  const fbs = [1, 4].map((i) => P[i]);
  const mids = [5, 6, 7, 8].map((i) => P[i]);
  const fwds = [9, 10].map((i) => P[i]);
  const eff = (t.lineHeight + (t.strategy === 'gegenpress' ? 12 : t.strategy === 'lowblock' ? -28 : 0));
  const cbPace = avg(cbs.map((p) => p.skills.pace));

  if (eff > 62 && cbPace < 66) add('high', 'High line, slow centre-backs', `Line height ${t.lineHeight} with CB pace averaging ${Math.round(cbPace)}% — through balls will punish you.`);
  else if (eff > 62) add('low', 'High line demands sync', `CB pace ${Math.round(cbPace)}% is adequate; keep pressing intensity high so the line is protected.`);
  const stam = avg(P.slice(1).map((p) => p.skills.stamina));
  if (t.pressing > 68 && stam < 64) add('high', 'Pressing outruns your lungs', `Team stamina averages ${Math.round(stam)}%. Expect red rings by ~60'; plan substitutions.`);
  if (t.pressing > 70 && eff < 38) add('med', 'Press and line disconnected', 'Pressing high with a deep line stretches the team — space opens between the lines.');
  if (t.pressing < 30 && eff > 62) add('med', 'Free possession for opponents', 'Pushing the line up without pressing lets the carrier pick passes behind you.');

  const back = ipPts.slice(1).filter((p) => p[0] < 0.36).length;
  if (back <= 2) add(cbPace < 70 ? 'high' : 'med', 'Thin rest-defence in possession', `Your in-possession shape leaves only ${back} players behind the ball; counters will hit ${cbs[0].name} and ${cbs[1].name} one-on-one.`);
  const invRoles = [1, 4].filter((i) => t.roles[i] === 'invfb');
  for (const i of invRoles) if (P[i].skills.passing < 60) add('med', 'Inverted full-back lacks passing', `${P[i].name} has ${P[i].skills.passing}% passing vision for a playmaking role.`);
  if (t.roles.includes('ballcb') && cbs.some((p, k) => t.roles[2 + k] === 'ballcb' && p.skills.passing < 60)) add('med', 'Ball-playing CB under-qualified', 'A ball-playing centre-back with <60% passing will gift turnovers in build-up.');
  if (t.roles.includes('dlp') && P[6].skills.passing < 62 && P[7].skills.passing < 62) add('med', 'Playmaker lacks vision', 'The deep-lying playmaker has <62% passing vision.');
  if (t.roles[9] === 'target' || t.roles[10] === 'target') { const tgt = t.roles[9] === 'target' ? P[9] : P[10]; if (tgt.skills.aerial < 62) add('med', 'Target striker is not aerial', `${tgt.name} has ${tgt.skills.aerial}% aerial reach.`); }
  const finisher = Math.max(...fwds.map((p) => p.skills.finishing));
  if (finisher < 66) add('med', 'Blunt attack', `Best forward finishing is only ${finisher}%; chances will need volume.`);
  const wideMid = avg([P[5], P[8]].map((p) => p.skills.stamina));
  if (t.strategy === 'gegenpress' && wideMid < 62) add('low', 'Wide men may fade under gegenpress', `Wide-midfield stamina ${Math.round(wideMid)}%.`);
  if (avg(fbs.map((p) => p.skills.pace)) < 58 && ['wingback'].some((r) => t.roles.includes(r))) add('med', 'Slow wing-backs', 'Wing-backs with <58% pace will not recover after overlapping.');
  const bench = lu.bench.map((id) => byId.get(id)!).filter(Boolean);
  if (!bench.some((p) => p.pos === 'GK')) add('low', 'No goalkeeper on the bench', 'A red card or injury to the keeper would be fatal.');
  const roleOk = t.roles.every((r, i) => ROLE_MAP[r] && ROLE_MAP[r].groups.includes(zoneGroup(i === 0 ? 'GK' : zoneOf(ipPts[i]))));
  if (!roleOk) add('med', 'Invalid role assignment', 'One or more roles do not suit their slot.');
  if (!items.length) add('ok', 'Structure looks sound', 'No major structural risks detected.');
  const pen = items.reduce((s, i) => s + (i.severity === 'high' ? 22 : i.severity === 'med' ? 11 : i.severity === 'low' ? 4 : 0), 0);
  return { score: Math.max(5, 100 - pen), items };
}
