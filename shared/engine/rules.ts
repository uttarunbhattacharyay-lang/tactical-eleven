import type { TeamId, RestartKind } from '../types';
import { L, BOX_D, BOX_Y0, BOX_Y1, GY0, GY1, clamp } from '../types';
import type { PlayerAgent } from './agent';
import type { Match, Flight, ShotInfo, Restart } from './engine';

export interface SubState { used: number; windows: number; lastStop: number; pending: { out: string; inn: string }[] }

/** Laws of the Game: offside, fouls & cards, restarts, goals, stoppage time, substitutions. */
export class RulesEngine {
  subs: [SubState, SubState] = [{ used: 0, windows: 0, lastStop: -1, pending: [] }, { used: 0, windows: 0, lastStop: -1, pending: [] }];
  subbedOff = new Set<string>();
  constructor(private m: Match) {}

  // ------------------------------------------------------------ geometry
  inOwnBox(a: PlayerAgent, x: number, y: number) {
    const gx = this.m.dir[a.team] === 1 ? 0 : L;
    return Math.abs(x - gx) < BOX_D && y > BOX_Y0 && y < BOX_Y1;
  }
  private inBoxOf(team: TeamId, x: number, y: number) {
    const gx = this.m.dir[team] === 1 ? 0 : L;
    return Math.abs(x - gx) < BOX_D && y > BOX_Y0 && y < BOX_Y1;
  }

  // ------------------------------------------------------------ offside
  /** Would a receiver positioned at x be offside if the ball were played now (used by passers, with imperfect perception) */
  wouldBeOffside(r: PlayerAgent, _passer: PlayerAgent, x: number) {
    const m = this.m, d = m.dir[r.team];
    const line = m.offsideLineX((1 - r.team) as TeamId);
    return (x - m.ball.x) * d > 0.5 && (x - line) * d > 0.3 && (x - 52.5) * d > 0;
  }
  isOffsideAtPass(r: PlayerAgent, ballX: number) {
    const m = this.m, d = m.dir[r.team];
    const line = m.offsideLineX((1 - r.team) as TeamId);
    return (r.x - ballX) * d > 0.3 && (r.x - line) * d > 0.3 && (r.x - 52.5) * d > 0;
  }
  callOffside(f: Flight, r: PlayerAgent) {
    const m = this.m, def = (1 - r.team) as TeamId, d = m.dir[r.team];
    const line = m.offsideLineX(def);
    m.stats[r.team].offsides++;
    const beyond = Math.abs(r.x - line);
    const dl = m.pitch[def].filter((a) => !a.isGK).map((a) => m.depthOf(def, a.x));
    const lineDepth = Math.round((dl.sort((a, b) => b - a)[0] ?? 0.3) * 100);
    const causes = [
      `${m.nm(r.team === 0 ? r : r)} was ${beyond.toFixed(1)} m beyond the second-last defender when ${m.nm(f.passer)} played the ball.`,
      `${m.teamName(def)} defensive line held at ~${lineDepth}% of the pitch (line height ${m.tactics[def].lineHeight}).`,
      f.passer.eff('passing') < 0.65 ? `${f.passer.card.name}'s passing vision (${f.passer.card.skills.passing}%) failed to read the run.` : `The run was mistimed: positioning ${r.card.skills.positioning}%.`,
    ];
    m.emit('offside', r.team, r, `Offside — ${m.nm(r)}`, causes, 3, { x: r.x, y: r.y });
    m.ball.owner = null;
    this.setRestart('freeKick', def, clamp(r.x, 1, L - 1), clamp(r.y, 1, 67));
    void d;
  }

  // ------------------------------------------------------------ fouls / cards
  foul(fouler: PlayerAgent, victim: PlayerAgent) {
    const m = this.m;
    m.stats[fouler.team].fouls++; fouler.stats.fouls++;
    const x = victim.x, y = victim.y;
    const dv = m.dir[victim.team];
    const attDepth = m.depthOf(victim.team, x);
    const lastMan = attDepth > 0.6 && m.pitch[fouler.team].filter((o) => !o.isGK && (o.x - x) * dv > 0.5).length === 0;
    let pY = 0.2 + 0.12 * (1 - fouler.eff('composure')), pR = 0.012;
    if (lastMan) { pR = 0.4; pY = 0.5; }
    const u = m.rng.next();
    let card: 'none' | 'yellow' | 'red' = u < pR ? 'red' : u < pR + pY ? 'yellow' : 'none';
    if (fouler.isGK && card === 'red') card = 'yellow';
    const penalty = this.inBoxOf(fouler.team, x, y);
    const causes = m.causes.explainFoul(fouler, victim, lastMan);
    m.emit('foul', fouler.team, fouler, `Foul by ${m.nm(fouler)} on ${m.nm(victim)}`, causes, penalty ? 5 : 2, { x, y });
    m.ball.owner = null; m.ball.flight = null;
    if (card === 'yellow') {
      fouler.yellow++;
      m.stats[fouler.team].yellows++; m.stopAccum += 30;
      if (fouler.yellow >= 2 && !fouler.isGK) { m.emit('yellow', fouler.team, fouler, `Second yellow — ${m.nm(fouler)}`, [`Repeated fouling with tackling ${fouler.card.skills.tackling}% and stamina ${Math.round(fouler.en * 100)}%.`], 6); this.sendOff(fouler, 'second yellow'); }
      else m.emit('yellow', fouler.team, fouler, `Yellow card — ${m.nm(fouler)}`, causes.slice(0, 2), 4);
    } else if (card === 'red') {
      this.sendOff(fouler, lastMan ? 'denying a goal-scoring opportunity' : 'serious foul play');
    }
    if (penalty) {
      const spotX = m.dir[fouler.team] === 1 ? 11 : L - 11;
      m.emit('penalty', victim.team, victim, `Penalty to ${m.teamName(victim.team)}!`, [`${m.nm(fouler)} fouled ${m.nm(victim)} inside the box.`], 8, { x: spotX, y: 34 });
      m.stopAccum += 30;
      this.setRestart('penalty', victim.team, spotX, 34);
    } else {
      this.setRestart('freeKick', victim.team, clamp(x, 0.5, L - 0.5), clamp(y, 0.5, 67.5));
    }
  }
  sendOff(a: PlayerAgent, why: string) {
    const m = this.m;
    a.sentOff = true; a.onPitch = false;
    m.stats[a.team].reds++; m.stopAccum += 30;
    m.refreshPitch();
    m.emit('red', a.team, a, `RED CARD — ${m.nm(a)} sent off (${why})`, [`${m.teamName(a.team)} are down to ${m.pitch[a.team].length} men; their shape now has a hole at ${a.slot}.`], 8);
  }

  // ------------------------------------------------------------ out of play
  outOfPlay() {
    const m = this.m, b = m.ball;
    const x = b.x, y = b.y, lt = b.lastTeam;
    if (x < 0 || x > L) {
      const defTeam = ((x < 0 ? m.dir[0] === 1 : m.dir[0] === -1) ? 0 : 1) as TeamId; // team whose goal is at this end
      const attTeam = (1 - defTeam) as TeamId;
      if (y > GY0 && y < GY1) {
        const scorer = (lt === defTeam ? b.last : b.last) ?? m.pitch[attTeam][0];
        this.goalScored(attTeam, scorer!, null, lt === defTeam);
        return;
      }
      if (lt === defTeam) { this.award('corner', attTeam, b); } else { this.award('goalKick', defTeam, b); }
      return;
    }
    this.award('throwIn', (1 - lt) as TeamId, b);
  }
  award(kind: 'corner' | 'goalKick' | 'throwIn', team: TeamId, b: { x: number; y: number }) {
    const m = this.m;
    b.x = clamp(b.x, -1, L + 1);
    if (kind === 'corner') {
      const x = b.x > 52.5 ? L : 0, y = b.y < 34 ? 0.4 : 67.6;
      m.stats[team].corners++;
      m.emit('corner', team, null, `Corner — ${m.teamName(team)}`, [], 2, { x, y });
      this.setRestart('corner', team, x, y);
    } else if (kind === 'goalKick') {
      const x = b.x > 52.5 ? L - 5.5 : 5.5;
      m.emit('goalkick', team, null, `Goal kick — ${m.teamName(team)}`, [], 1);
      this.setRestart('goalKick', team, x, 34);
    } else {
      const x = clamp(b.x, 1, L - 1), y = b.y < 34 ? 0.1 : 67.9;
      m.emit('throwin', team, null, `Throw-in — ${m.teamName(team)}`, [], 0);
      this.setRestart('throwIn', team, x, y);
    }
  }

  goalScored(t: TeamId, scorer: PlayerAgent, s: ShotInfo | null, own = false) {
    const m = this.m;
    m.score[t]++; scorer.stats.goals += own ? 0 : 1;
    m.stopAccum += 70;
    const causes = own ? [`${m.nm(scorer)} turned the ball into his own net under pressure.`] : m.causes.explainGoal(scorer, s?.xg ?? 0.1, s);
    m.emit('goal', t, scorer, own ? `OWN GOAL — ${m.nm(scorer)}` : `GOAL! ${m.nm(scorer)} (${m.score[0]}–${m.score[1]})`, causes, 10, { xg: s?.xg, x: m.ball.x, y: m.ball.y });
    m.ball.owner = null; m.ball.flight = null;
    const conceding = (1 - t) as TeamId;
    this.setRestart('kickoff', conceding, 52.5, 34);
    m.restart!.delay += m.ctick(8);
  }

  // ------------------------------------------------------------ restarts
  private chooseTaker(kind: RestartKind, team: TeamId, x: number, y: number): PlayerAgent {
    const m = this.m, ps = m.pitch[team], out = ps.filter((a) => !a.isGK);
    const dist = (a: PlayerAgent) => Math.hypot(a.x - x, a.y - y);
    const gx = m.goalX(team);
    switch (kind) {
      case 'kickoff': return [...out].sort((a, b) => (b.slot >= 9 ? 100 : 0) - (a.slot >= 9 ? 100 : 0) + dist(a) - dist(b))[0] ?? ps[0];
      case 'goalKick': return m.keeperOf(team) ?? out[0];
      case 'throwIn': return [...out].sort((a, b) => dist(a) - dist(b))[0];
      case 'corner': return [...out].filter((a) => ['FB', 'WM'].includes(SLOT_GROUP_OF(a))).sort((a, b) => (b.eff('passing') - dist(b) * 0.01) - (a.eff('passing') - dist(a) * 0.01))[0] ?? out[0];
      case 'penalty': return [...out].sort((a, b) => (b.eff('finishing') * 0.6 + b.eff('composure') * 0.4) - (a.eff('finishing') * 0.6 + a.eff('composure') * 0.4))[0];
      case 'freeKick': {
        const dg = Math.hypot(gx - x, 34 - y);
        if (dg < 32) return [...out].sort((a, b) => (b.eff('finishing') * 0.5 + b.eff('passing') * 0.5) - (a.eff('finishing') * 0.5 + a.eff('passing') * 0.5))[0];
        return [...out].sort((a, b) => dist(a) - dist(b))[0];
      }
    }
  }

  setRestart(kind: RestartKind, team: TeamId, x: number, y: number, init = false) {
    const m = this.m, b = m.ball;
    m.stopId++;
    m.phase = 'dead';
    b.owner = null; b.flight = null; b.vx = 0; b.vy = 0; b.x = x; b.y = y; b.z = 0; b.px = x; b.py = y;
    const secs: Record<RestartKind, number> = { kickoff: 4, throwIn: 2.2, goalKick: 3.2, corner: 4, freeKick: 3.5, penalty: 4.5 };
    const taker = this.chooseTaker(kind, team, x, y);
    const r: Restart = { kind, team, x, y, delay: m.ctick(secs[kind]), taker, targets: new Map(), direct: false, age: 0 };
    m.restart = r; m.possTeam = team;
    m.refreshPitch();
    this.buildTargets(r);
    if (!init) this.flushSubs();
    // a flush can change the taker
    if (!r.taker.onPitch) r.taker = this.chooseTaker(kind, team, x, y);
  }

  private buildTargets(r: Restart) {
    const m = this.m, t = r.team, d = (1 - t) as TeamId, gxA = m.goalX(t), dA = m.dir[t];
    const outA = m.pitch[t].filter((a) => !a.isGK && a !== r.taker);
    const outD = m.pitch[d].filter((a) => !a.isGK);
    const box = (a: PlayerAgent, dx: number, y: number) => r.targets.set(a, { x: gxA - dA * dx, y });
    const atk = (a: PlayerAgent) => a.eff('aerial') + a.eff('finishing') * 0.5;
    const dfn = (a: PlayerAgent) => a.eff('tackling') + a.eff('aerial');
    if (r.kind === 'kickoff') {
      const partner = [...outA].sort((a, b) => (b.slot >= 9 ? 1 : 0) - (a.slot >= 9 ? 1 : 0))[0];
      if (partner) r.targets.set(partner, { x: 52.5 - dA * 2.4, y: 36.5 });
    } else if (r.kind === 'corner') {
      const aS = [[6, 30], [9, 38], [11, 34], [8, 27], [14, 41]];
      [...outA].sort((a, b) => atk(b) - atk(a)).slice(0, 5).forEach((a, i) => box(a, aS[i][0], aS[i][1]));
      const edge = [...outA].filter((a) => !r.targets.has(a)).sort((a, b) => b.eff('finishing') - a.eff('finishing'))[0];
      if (edge) box(edge, 22, 34);
      const dS = [[3, 28], [5, 40], [7, 34], [9, 31], [6, 37], [11, 26], [8, 42]];
      [...outD].sort((a, b) => dfn(b) - dfn(a)).slice(0, 7).forEach((a, i) => box(a, dS[i][0], dS[i][1]));
      const gk = m.keeperOf(d); if (gk) r.targets.set(gk, { x: gxA - dA * 2.5, y: 34 });
    } else if (r.kind === 'freeKick') {
      const dg = Math.hypot(gxA - r.x, 34 - r.y);
      if (dg < 34 && m.depthOf(t, r.x) > 0.6) {
        const n = dg < 22 ? 4 : 3;
        const nearest = [...outD].sort((a, b) => Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(b.x - r.x, b.y - r.y)).slice(0, n);
        const ux = (gxA - r.x) / dg, uy = (34 - r.y) / dg;
        nearest.forEach((a, i) => r.targets.set(a, { x: r.x + ux * 9.6 - uy * (i - (n - 1) / 2) * 0.85, y: r.y + uy * 9.6 + ux * (i - (n - 1) / 2) * 0.85 }));
        const aS = [[8, 30], [10, 38], [12, 34], [14, 27]];
        [...outA].sort((a, b) => atk(b) - atk(a)).slice(0, 4).forEach((a, i) => box(a, aS[i][0], aS[i][1]));
        const dS = [[6, 31], [8, 37], [10, 34], [12, 28]];
        [...outD].filter((a) => !r.targets.has(a)).sort((a, b) => dfn(b) - dfn(a)).slice(0, 4).forEach((a, i) => box(a, dS[i][0], dS[i][1]));
        r.direct = true;
      }
    } else if (r.kind === 'penalty') {
      const gk = m.keeperOf(d); if (gk) r.targets.set(gk, { x: gxA - dA * 0.6, y: 34 });
      const others = [...outA, ...outD];
      others.forEach((a, i) => r.targets.set(a, { x: gxA - dA * (BOX_D + 3 + (a.team === t ? 0 : 0.5)), y: 34 + (i - others.length / 2) * 2.9 }));
      const gkA = m.keeperOf(t); if (gkA) r.targets.set(gkA, { x: m.dir[t] === 1 ? 45 : 60, y: 34 });
    }
  }

  deadTarget(a: PlayerAgent): { x: number; y: number; sf: number } {
    const m = this.m, r = m.restart;
    if (!r) return { x: a.ax, y: a.ay, sf: 0.6 };
    const dirv = m.dir[a.team];
    if (a === r.taker) return { x: r.x - dirv * (r.kind === 'penalty' ? 2 : 0.9), y: r.y, sf: 0.95 };
    const sp = r.targets.get(a);
    if (sp) return { x: sp.x, y: sp.y, sf: 0.9 };
    let tx = a.ax, ty = a.ay;
    const att = r.team === a.team;
    if (r.kind === 'kickoff') {
      if (dirv === 1) tx = Math.min(tx, 51.5); else tx = Math.max(tx, 53.5);
      if (!att) { const dd = Math.hypot(tx - 52.5, ty - 34); if (dd < 10) { tx = 52.5 + ((tx - 52.5) / (dd || 1)) * 10; ty = 34 + ((ty - 34) / (dd || 1)) * 10; if (dirv === 1) tx = Math.min(tx, 51.5); else tx = Math.max(tx, 53.5); } }
    } else if (!att) {
      const minD = r.kind === 'throwIn' ? 3 : 9.3;
      const dd = Math.hypot(tx - r.x, ty - r.y);
      if (dd < minD && r.kind !== 'goalKick') { const u = dd || 1; tx = r.x + ((tx - r.x) / u) * minD; ty = r.y + ((ty - r.y) / u) * minD; }
      if (r.kind === 'goalKick') {
        const gxK = r.x < 52.5 ? 0 : L;
        if (Math.abs(tx - gxK) < BOX_D + 2 && ty > BOX_Y0 - 2 && ty < BOX_Y1 + 2) tx = gxK + (r.x < 52.5 ? 1 : -1) * (BOX_D + 2.5);
      }
    }
    tx = clamp(tx, 0.5, L - 0.5); ty = clamp(ty, 0.5, 67.5);
    return { x: tx, y: ty, sf: Math.hypot(tx - a.x, ty - a.y) > 15 ? 0.95 : 0.65 };
  }
  teleportAll() {
    const m = this.m;
    for (const t of [0, 1] as TeamId[]) for (const a of m.pitch[t]) { const p = this.deadTarget(a); a.x = p.x; a.y = p.y; a.vx = 0; a.vy = 0; a.tx = p.x; a.ty = p.y; }
  }

  deadStep() {
    const m = this.m, r = m.restart;
    if (!r) { m.phase = 'play'; return; }
    r.age++; r.delay--; m.stopAccum += 0.15;
    if (!r.taker.onPitch || r.taker.sentOff) r.taker = this.chooseTaker(r.kind, r.team, r.x, r.y);
    if (r.delay <= 0) {
      const dd = Math.hypot(r.taker.x - r.x, r.taker.y - r.y);
      if (dd < 2.6 || r.delay < -m.ctick(6)) this.exec(r);
    }
  }

  private bestMate(a: PlayerAgent, pred: (o: PlayerAgent) => boolean, kind: 'pass' | 'long' = 'pass') {
    const m = this.m, dirv = m.dir[a.team];
    let best: PlayerAgent | null = null, bu = -9;
    for (const o of m.pitch[a.team]) {
      if (o === a || !pred(o)) continue;
      const dist = Math.hypot(o.x - a.x, o.y - a.y);
      if (dist < 4) continue;
      const p = m.passEstimate(a, o.x, o.y, kind);
      const u = p * (1 + ((o.x - a.x) * dirv) / 60) - (kind === 'pass' && dist > 40 ? 0.3 : 0);
      if (u > bu) { bu = u; best = o; }
    }
    return best;
  }

  private exec(r: Restart) {
    const m = this.m, a = r.taker, b = m.ball, t = a.team, dirv = m.dir[t], tac = m.tactics[t];
    m.phase = 'play'; m.restart = null;
    a.x = r.x; a.y = r.y; a.vx = 0; a.vy = 0;
    b.owner = null; b.flight = null; b.vx = 0; b.vy = 0; b.x = r.x; b.y = r.y; b.last = a; b.lastTeam = t;
    switch (r.kind) {
      case 'kickoff': {
        const mate = this.bestMate(a, (o) => !o.isGK && (o.x - a.x) * dirv < 3, 'pass') ?? m.pitch[t].find((o) => o !== a)!;
        m.kickPass(a, 'pass', mate.x, mate.y, mate, true); break;
      }
      case 'throwIn': {
        const mate = this.bestMate(a, (o) => Math.hypot(o.x - a.x, o.y - a.y) < 28 && !o.isGK) ?? m.pitch[t].find((o) => o !== a)!;
        m.kickPass(a, 'pass', mate.x, mate.y, mate, true); break;
      }
      case 'goalKick': {
        const short = tac.buildUp === 'short' || (tac.buildUp === 'mixed' && m.rng.next() < 0.55);
        const mate = short ? this.bestMate(a, (o) => !o.isGK && Math.hypot(o.x - a.x, o.y - a.y) < 38, 'pass') : this.bestMate(a, (o) => !o.isGK && (o.x - a.x) * dirv > 30 && (o.slot >= 5), 'long');
        if (mate) m.kickPass(a, short ? 'pass' : 'long', mate.x, mate.y, mate, true);
        else m.kickPass(a, 'long', a.x + dirv * 50, 34, null, true);
        break;
      }
      case 'corner': {
        const targets = [...r.targets.entries()].filter(([ag]) => ag.team === t).map(([ag, p]) => ({ ag, p }));
        const pick = targets.sort((p, q) => (q.ag.eff('aerial') + q.ag.eff('finishing') * 0.4) - (p.ag.eff('aerial') + p.ag.eff('finishing') * 0.4))[0];
        if (pick) m.kickPass(a, 'cross', pick.p.x, pick.p.y, pick.ag, true);
        else m.kickPass(a, 'cross', m.goalX(t) - dirv * 9, 34, null, true);
        break;
      }
      case 'freeKick': {
        const gx = m.goalX(t), dg = Math.hypot(gx - r.x, 34 - r.y);
        const depth = m.depthOf(t, r.x);
        if (r.direct && dg < 31 && m.rng.next() < 0.65) m.kickShot(a, 'fk');
        else if (depth > 0.62 && dg < 46) {
          const tg = [...r.targets.entries()].filter(([ag]) => ag.team === t).map(([ag, p]) => ({ ag, p }))[0];
          const rcv = tg?.ag ?? this.bestMate(a, (o) => (o.x - a.x) * dirv > 5, 'long');
          m.kickPass(a, 'cross', rcv ? rcv.x : gx - dirv * 10, rcv ? rcv.y : 34, rcv ?? null, true);
        } else {
          const mate = this.bestMate(a, (o) => !o.isGK && Math.hypot(o.x - a.x, o.y - a.y) < 35) ?? m.pitch[t].find((o) => o !== a)!;
          m.kickPass(a, 'pass', mate.x, mate.y, mate, true);
        }
        break;
      }
      case 'penalty': m.kickShot(a, 'penalty'); break;
    }
  }

  // ------------------------------------------------------------ clock & stoppage
  clockStep() {
    const m = this.m;
    if (m.tickInHalf >= m.halfTicks && !m.addedAnnounced) {
      m.addedAnnounced = true;
      m.added = clamp(Math.round(m.stopAccum * 0.55), Math.round(0.6 * m.tpm), Math.round(5.5 * m.tpm));
      const mins = Math.max(1, Math.round(m.added / m.tpm));
      m.emit('stoppage', -1, null, `${mins} minute${mins > 1 ? 's' : ''} of stoppage time`, [`Time lost: goals, cards, substitutions and set-piece delays.`], 2);
    }
    if (!m.addedAnnounced) return;
    const end = m.halfTicks + m.added;
    const pendingRestart = m.restart && ['penalty', 'corner', 'freeKick'].includes(m.restart.kind);
    const shotLive = !!(m.ball.flight && m.ball.flight.shot);
    if ((m.tickInHalf >= end && !shotLive && !pendingRestart && m.phase !== 'halftime') || m.tickInHalf > end + 120) this.endHalf();
  }
  private endHalf() {
    const m = this.m;
    m.ball.owner = null; m.ball.flight = null; m.restart = null;
    if (m.half === 1) { m.phase = 'halftime'; m.emit('half', -1, null, `Half-time ${m.score[0]}–${m.score[1]}`, [], 5); }
    else { m.phase = 'fulltime'; m.emit('full', -1, null, `Full-time ${m.score[0]}–${m.score[1]}`, [], 8); }
  }

  // ------------------------------------------------------------ substitutions
  requestSub(team: TeamId, outId: string, inId: string): { ok: boolean; reason?: string } {
    const m = this.m, out = m.byId.get(outId), inn = m.byId.get(inId), st = this.subs[team];
    if (!out || !inn || out.team !== team || inn.team !== team) return { ok: false, reason: 'Unknown player' };
    if (!out.onPitch || out.sentOff) return { ok: false, reason: 'That player is not on the pitch' };
    if (inn.onPitch || inn.sentOff || this.subbedOff.has(inn.card.id)) return { ok: false, reason: 'That substitute is unavailable' };
    if (st.used + st.pending.length >= 5) return { ok: false, reason: 'All five substitutions used' };
    if (st.pending.some((p) => p.out === outId || p.inn === inId)) return { ok: false, reason: 'Already queued' };
    if (m.phase === 'fulltime') return { ok: false, reason: 'Match over' };
    if (m.phase === 'halftime') { this.performSub(team, out, inn); return { ok: true }; }
    if (m.phase === 'dead' && m.restart && m.restart.kind !== 'penalty') {
      if (st.lastStop !== m.stopId) { if (st.windows >= 3) return { ok: false, reason: 'No substitution windows left (3 used)' }; st.windows++; st.lastStop = m.stopId; }
      this.performSub(team, out, inn); return { ok: true };
    }
    if (st.windows >= 3) return { ok: false, reason: 'No substitution windows left (3 used)' };
    st.pending.push({ out: outId, inn: inId });
    return { ok: true, reason: 'Queued for the next stoppage' };
  }
  cancelSub(team: TeamId, outId: string) { this.subs[team].pending = this.subs[team].pending.filter((p) => p.out !== outId); }
  private flushSubs() {
    const m = this.m;
    for (const t of [0, 1] as TeamId[]) {
      const st = this.subs[t];
      if (!st.pending.length || st.windows >= 3) { if (st.windows >= 3) st.pending = []; continue; }
      st.windows++; st.lastStop = m.stopId;
      for (const p of st.pending) {
        const out = m.byId.get(p.out)!, inn = m.byId.get(p.inn)!;
        if (out.onPitch && !out.sentOff && !inn.onPitch && st.used < 5) this.performSub(t, out, inn);
      }
      st.pending = [];
    }
  }
  private performSub(team: TeamId, out: PlayerAgent, inn: PlayerAgent) {
    const m = this.m, st = this.subs[team];
    const slot = out.slot;
    out.onPitch = false; out.slot = -1; this.subbedOff.add(out.card.id);
    inn.onPitch = true; inn.slot = slot;
    inn.x = out.x; inn.y = out.y; inn.vx = 0; inn.vy = 0; inn.en = 1;
    m.onPitch[team][slot] = inn; m.refreshPitch(); m.refit(team);
    st.used++; m.stopAccum += 25;
    for (const o of m.ctl[team].active) o.ids = o.ids.map((id) => (id === out.card.id ? inn.card.id : id));
    if (m.restart && m.restart.taker === out) m.restart.taker = inn;
    m.emit('sub', team, inn, `${m.teamName(team)} sub: ${m.nm(inn)} on for ${m.nm(out)}`, [`${out.card.name} left at ${Math.round(out.en * 100)}% stamina.`], 4);
  }
  swapSlots(team: TeamId, a: number, b: number): boolean {
    const m = this.m;
    if (m.phase === 'fulltime' || a === b || a < 0 || b < 0 || a > 10 || b > 10) return false;
    const x = m.onPitch[team][a], y = m.onPitch[team][b];
    m.onPitch[team][a] = y; m.onPitch[team][b] = x;
    if (x) x.slot = b;
    if (y) y.slot = a;
    m.refreshPitch(); m.refit(team);
    return true;
  }
}

import { SLOT_GROUP } from '../formations';
function SLOT_GROUP_OF(a: PlayerAgent) { return SLOT_GROUP[Math.max(0, a.slot)]; }
