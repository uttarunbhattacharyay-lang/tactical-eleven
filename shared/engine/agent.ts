import type { PlayerCard, SkillKey, TeamId } from '../types';
import { L, W, clamp } from '../types';
import { ROLE_MAP, STRATS, type RoleDef } from '../formations';
import { laneClear } from './spatial';
import type { Match } from './engine';

export interface AgentStats { passes: number; passesOk: number; shots: number; goals: number; tackles: number; intercepts: number; fouls: number; dist: number }

type Opt =
  | { k: 'shot'; u: number }
  | { k: 'pass'; u: number; r: PlayerAgent; tx: number; ty: number; kind: 'pass' | 'through' | 'long' }
  | { k: 'cross'; u: number; tx: number; ty: number }
  | { k: 'clear'; u: number }
  | { k: 'dribble'; u: number };

/** One footballer: physical state + skill-driven steering and on-ball decision making. */
export class PlayerAgent {
  x = 52; y = 34; vx = 0; vy = 0;
  en = 1; yellow = 0; sentOff = false; onPitch = false; slot = -1;
  tx = 52; ty = 34; sf = 0.6;
  ax = 52; ay = 34; // tactical anchor (world)
  think = 0; lag = 0; tackleCool = 0; cool = 0; dive = 0; runTicks = 0; runX = 0; runY = 0;
  loadMult = 1; pressing = false; ordered = false; forcePress = false; fit = 1; runner = false;
  headX = 1; headY = 0;
  stats: AgentStats = { passes: 0, passesOk: 0, shots: 0, goals: 0, tackles: 0, intercepts: 0, fouls: 0, dist: 0 };
  constructor(readonly card: PlayerCard, readonly team: TeamId) {}

  get isGK() { return this.card.group === 'GK'; }
  /** effective skill 0..1 (fatigue mildly erodes everything) */
  eff(k: SkillKey): number { return (this.card.skills[k] / 100) * (0.8 + 0.2 * this.en); }
  /** positioning also scaled by positional familiarity */
  posEff(): number { return this.eff('positioning') * (0.7 + 0.3 * this.fit); }
  fullSpeed(): number { return 6.4 + this.card.skills.pace * 0.034; }
  maxSpeed(): number { return this.fullSpeed() * (0.72 + 0.28 * Math.pow(this.en, 0.7)); }
  role(m: Match): RoleDef { return ROLE_MAP[m.tactics[this.team].roles[this.slot]] ?? ROLE_MAP.cb; }

  // ---------------------------------------------------------------- movement
  move(m: Match) {
    const dtp = m.dtp;
    const dx = this.tx - this.x, dy = this.ty - this.y;
    const d = Math.hypot(dx, dy);
    const lagF = this.lag > 0 ? 0.7 : 1;
    if (this.lag > 0) this.lag--;
    if (this.dive > 0) this.dive--;
    const vmax = this.maxSpeed() * this.sf * lagF * (this.dive > 0 ? 1.45 : 1);
    const sp = d < 0.05 ? 0 : Math.min(vmax, d / (dtp * 1.6));
    const wx = d > 0 ? (dx / d) * sp : 0, wy = d > 0 ? (dy / d) * sp : 0;
    const acc = 7.5 * dtp * (this.dive > 0 ? 2 : 1);
    let ex = wx - this.vx, ey = wy - this.vy;
    const em = Math.hypot(ex, ey);
    if (em > acc) { ex *= acc / em; ey *= acc / em; }
    this.vx += ex; this.vy += ey;
    this.x += this.vx * dtp; this.y += this.vy * dtp;
    if (this.x < 0.3) { this.x = 0.3; this.vx = 0; } else if (this.x > L - 0.3) { this.x = L - 0.3; this.vx = 0; }
    if (this.y < 0.3) { this.y = 0.3; this.vy = 0; } else if (this.y > W - 0.3) { this.y = W - 0.3; this.vy = 0; }
    const spd = Math.hypot(this.vx, this.vy);
    if (spd > 0.5) { this.headX = this.vx / spd; this.headY = this.vy / spd; }
    const f = spd / this.fullSpeed();
    const st = this.card.skills.stamina;
    let drain = m.drainK * (0.22 + 0.78 * f * f) * (1.5 - 0.009 * st) * this.loadMult;
    if (f < 0.18) drain *= 0.3;
    this.en = Math.max(0, this.en - drain);
    this.stats.dist += spd * dtp;
    if (this.tackleCool > 0) this.tackleCool--;
    if (this.cool > 0) this.cool--;
  }

  // ---------------------------------------------------------------- planning
  plan(m: Match) {
    const b = m.ball;
    if (m.phase === 'dead') {
      const p = m.rules.deadTarget(this);
      this.tx = p.x; this.ty = p.y; this.sf = p.sf; this.pressing = false;
      return;
    }
    this.pressing = false;
    if (this.isGK) return this.planGK(m);
    if (b.owner === this) return this.planCarrier(m);
    const fl = b.flight;
    if (fl && fl.team === this.team && fl.receiver === this && !fl.shot) { this.tx = fl.toX; this.ty = fl.toY; this.sf = 1; return; }
    if (!b.owner && !fl) {
      if (m.chasers[this.team].has(this)) {
        this.tx = b.x + b.vx * 0.25; this.ty = b.y + b.vy * 0.25; this.sf = 1; return;
      }
    }
    if (fl && fl.team !== this.team && !fl.shot && m.contest[this.team].has(this)) { this.tx = fl.toX; this.ty = fl.toY; this.sf = 1; return; }
    if (m.possTeam === this.team) return this.planSupport(m);
    return this.planDefend(m);
  }

  private planGK(m: Match) {
    const t = this.team, b = m.ball, dirv = m.dir[t];
    const gx = dirv === 1 ? 0 : L;
    this.sf = 0.8;
    if (b.owner === this) { this.tx = this.x; this.ty = this.y; this.sf = 0.3; if (this.think > 0) this.think--; else this.decide(m); return; }
    const fl = b.flight;
    if (fl && fl.shot && fl.team !== t) { this.tx = fl.toX; this.ty = clamp(fl.toY, 30, 38); this.sf = 1; this.dive = 3; return; }
    const tac = m.tactics[t];
    const role = this.role(m);
    const sweeperBoost = role.id === 'sweeper' ? 5 : 0;
    // loose ball / cross in own box: come and claim
    const inBox = Math.abs(b.x - gx) < 16.5 && b.y > 13.84 && b.y < 54.16;
    if (!b.owner && inBox && (!fl || fl.kind === 'cross' || fl.kind === 'long')) {
      const dd = Math.hypot(b.x - this.x, b.y - this.y);
      if (dd < 14) { this.tx = (fl ? fl.toX : b.x); this.ty = (fl ? fl.toY : b.y); this.sf = 1; return; }
    }
    const dist = Math.hypot(b.x - gx, b.y - 34);
    const d = clamp(0.12 * dist + 1.5, 2.2, 6.5) + sweeperBoost * (tac.lineHeight / 100) + (m.possTeam === t ? 6 : 0);
    const ux = (b.x - gx) / (dist + 1e-6), uy = (b.y - 34) / (dist + 1e-6);
    this.tx = gx + ux * d; this.ty = 34 + uy * d * 1.0;
    if (!m.rules.inOwnBox(this, this.tx, this.ty)) this.tx = gx + (dirv === 1 ? 1 : -1) * 3;
  }

  private planCarrier(m: Match) {
    const t = this.team, dirv = m.dir[t];
    const gx = dirv === 1 ? L : 0;
    // choose carry heading among 5 candidate bearings: space ahead vs. progress
    let best = 0, bestScore = -1e9;
    const base = Math.atan2(34 - this.y, (gx - this.x));
    const foes = m.spBy[1 - t];
    for (const off of [-0.9, -0.45, 0, 0.45, 0.9]) {
      const a = base + off;
      const px = this.x + Math.cos(a) * 7, py = this.y + Math.sin(a) * 7;
      let md = 30;
      for (const o of foes) md = Math.min(md, Math.hypot(o.x - px, o.y - py));
      const edge = Math.min(py, W - py, 10) * 0.25;
      const sc = Math.min(md, 12) * 1.0 - Math.abs(off) * 2.2 + edge;
      if (sc > bestScore) { bestScore = sc; best = a; }
    }
    this.tx = this.x + Math.cos(best) * 9; this.ty = this.y + Math.sin(best) * 9;
    this.sf = this.isGK ? 0.3 : 0.78;
    if (this.think > 0) { this.think--; return; }
    this.decide(m);
  }

  private planSupport(m: Match) {
    const t = this.team, dirv = m.dir[t];
    const role = this.role(m);
    let tx = this.ax, ty = this.ay, sf = 0.62;
    const c = m.ball.owner;
    if (this.runner && role.run > 0.05) {
      if (this.runTicks > 0) { this.runTicks--; tx = this.runX; ty = this.runY; sf = 1; }
      else if (c && c.team === t && c !== this && (m.tick + this.slot) % 6 === 0) {
        const p = role.run * 0.3 * (0.6 + this.eff('pace') * 0.6) * (1 + STRATS[m.tactics[t].strategy].direct * 0.5);
        if (m.rng.next() < p) {
          const line = m.offsideLineX(1 - t as TeamId);
          const err = (1 - this.posEff()) * 1.8 - 0.55;
          const rx = line - dirv * (0.6 - err);
          if ((rx - this.x) * dirv > 4 && (rx - c.x) * dirv > -2) {
            this.runX = clamp(rx, 1, L - 1); this.runY = clamp(this.ay + (m.rng.next() - 0.5) * 12, 3, W - 3);
            this.runTicks = Math.max(3, Math.round(1.5 / m.dtp));
          }
        }
      }
    }
    // late arrival: box-to-box / No.10 types (and anyone who likes a shot) attack the edge of the box when the ball is in the final third
    if (tx === this.ax && c && c.team === t && c !== this && this.slot >= 5 && this.slot <= 8) {
      const cd = m.depthOf(t, c.x);
      const arrive = role.run * 0.7 + role.shoot * 0.3 * (this.card.skills.finishing / 100);
      if (cd > 0.6 && arrive > 0.5) {
        const gx = dirv === 1 ? L : 0;
        const ex = gx - dirv * (17 + (1 - arrive) * 8);
        const ey = 34 + clamp(this.ay - 34, -12, 12) * 0.8;
        tx = ex; ty = ey; sf = 0.85;
      }
    }
    if (tx === this.ax && c && c.team === t && c !== this) {
      const dd = Math.hypot(c.x - this.ax, c.y - this.ay);
      if (dd < 30 && this.slot > 0) { tx = this.ax * 0.78 + (c.x + dirv * 7) * 0.22; ty = this.ay * 0.82 + c.y * 0.18; }
    }
    this.tx = tx; this.ty = ty; this.sf = sf;
    if (m.trans[t].kind === 'won' && m.trans[t].ticks > 0 && m.tactics[t].transition === 'counterattack' && this.runner) this.sf = 0.95;
  }

  private planDefend(m: Match) {
    const t = this.team, dirv = m.dir[t];
    let tx = this.ax, ty = this.ay, sf = 0.65;
    const c = m.ball.owner;
    if (c && c.team !== t) {
      if (m.pressers[t].has(this)) {
        const pi = m.pressIntensity(t);
        tx = c.x + c.vx * 0.3; ty = c.y + c.vy * 0.3; sf = pi > 0.55 ? 1 : 0.88; this.pressing = true;
        this.loadMult *= 1 + pi * 0.6;
      } else if (m.jockey[t] === this) {
        const gxo = dirv === 1 ? 0 : L;
        const ux = gxo - c.x, uy = 34 - c.y, ul = Math.hypot(ux, uy) + 1e-6;
        tx = c.x + (ux / ul) * 2.6; ty = c.y + (uy / ul) * 2.6; sf = 0.8;
      } else if (this.slot >= 1 && this.slot <= 4) {
        // defenders pick up the most dangerous attacker near their zone
        let tgt: PlayerAgent | null = null, bd = 10;
        for (const o of m.onPitchOf(1 - t as TeamId)) {
          if (o === c || o.isGK) continue;
          const dd = Math.hypot(o.x - this.ax, o.y - this.ay);
          if (dd < bd) { bd = dd; tgt = o; }
        }
        if (tgt) {
          const w = 0.45 * (0.5 + this.posEff() * 0.6);
          const gxo = dirv === 1 ? 0 : L;
          tx = this.ax * (1 - w) + (tgt.x + (gxo - tgt.x) * 0.05) * w;
          ty = this.ay * (1 - w) + tgt.y * w;
          sf = 0.8;
        }
      }
    }
    this.tx = tx; this.ty = ty; this.sf = sf;
  }

  // ---------------------------------------------------------------- decisions
  holdTicks(m: Match): number {
    const t = this.team, tac = m.tactics[t], mods = STRATS[tac.strategy], role = this.role(m);
    const press = m.pressureAt(this.x, this.y, t);
    const comp = this.eff('composure');
    let sec = 0.45 + (1 - comp) * 0.5 - mods.tempo * 0.3 + role.hold * 0.5 - press * 0.45 + (tac.buildUp === 'short' ? 0.1 : 0);
    if (this.isGK) sec = 1.0 + (1 - comp) * 0.4;
    return clamp(Math.round(sec / m.dtp), 1, 14);
  }

  decide(m: Match) {
    const t = this.team, tac = m.tactics[t], mods = STRATS[tac.strategy], role = this.role(m), dirv = m.dir[t];
    const gx = dirv === 1 ? L : 0;
    const press = m.pressureAt(this.x, this.y, t);
    const depth = m.depthOf(t, this.x);
    const vis = this.eff('passing');
    const comp = this.eff('composure');
    const trN = m.trans[t];
    const direct = clamp(0.5 + mods.direct + (tac.buildUp === 'direct' ? 0.3 : tac.buildUp === 'short' ? -0.25 : 0) + role.risk * 0.3
      + (trN.kind === 'won' && trN.ticks > 0 && tac.transition === 'counterattack' ? 0.3 : 0), 0.15, 1.35);
    const opts: Opt[] = [];
    const dGoal = Math.hypot(gx - this.x, 34 - this.y);
    const sk = this.card.skills;
    const fin = sk.finishing / 100;
    // shooting instinct: natural finishers look for goal, the role scales it (an anchor rarely shoots, a poacher always does)
    const instinct = role.shoot * (0.3 + 0.95 * fin + 0.1 * comp);
    // space in front of the carrier (towards goal)
    let free = 20;
    for (const o of m.spBy[1 - t]) { const ox = (o.x - this.x) * dirv; if (ox > -1) free = Math.min(free, Math.hypot(o.x - this.x, o.y - this.y)); }

    let shotXg = 0;
    const range = 16 + 13 * fin; // good finishers try it from further out
    if (!this.isGK && depth > 0.6 && dGoal < range) {
      shotXg = m.xgAt(this, this.x, this.y, false, press);
      let u = shotXg * 1.75 * instinct * (0.8 + 0.4 * direct) - 0.045;
      if (dGoal < 12) u += 0.03 + 0.06 * fin; // in and around the six-yard box you hit it
      if (dGoal >= 16 && shotXg > 0.025) {
        // a sight of goal from range: players who can strike a ball fancy it (Bellingham will, Rodri rarely)
        const urge = clamp(0.4 * (fin - 0.55) / 0.35, 0, 0.45) * role.shoot * (free > 5 ? 1 : 0.35);
        if (m.rng.next() < urge) u += 0.45;
      } // a sight of goal from range: shooters take it on
      opts.push({ k: 'shot', u });
    }
    const mates = m.onPitchOf(t).filter((o) => o !== this);
    for (const r of mates) {
      const tx = clamp(r.x + r.vx * 0.9, 1, L - 1), ty = clamp(r.y + r.vy * 0.9, 1, W - 1);
      const dist = Math.hypot(tx - this.x, ty - this.y);
      if (dist < 4 || dist > 68) continue;
      const progX = (tx - this.x) * dirv;
      const kind: 'pass' | 'through' | 'long' = dist > 36 ? 'long' : progX > 9 && !r.isGK ? 'through' : 'pass';
      if (m.rules.wouldBeOffside(r, this, tx)) { if (m.rng.next() < 0.45 + 0.5 * vis) continue; }
      // vision: only creative passers reliably spot the through ball or the long switch
      if (kind !== 'pass' && m.rng.next() > 0.3 + 0.75 * vis) continue;
      const p = m.passEstimate(this, tx, ty, kind);
      const dT = m.depthOf(t, tx);
      const progress = dT - depth;
      const space = m.spatial.at(t, tx, ty);
      const pT = m.pressureAt(tx, ty, t);
      let threat = dT > 0.62 ? m.xgAt(r, tx, ty, false, pT * 0.6) : 0;
      // a lay-off to a free team-mate arriving at the edge of the box who can strike a ball
      if (threat > 0.02 && pT < 0.35) threat *= 1 + 1.6 * Math.max(0, r.card.skills.finishing / 100 - 0.6) * (ROLE_MAP[tac.roles[r.slot]]?.shoot ?? 1);
      let u = p * (progress * 1.15 * direct * 2.0 + 0.2 * space + 2.4 * threat + 0.1) - (1 - p) * (0.3 + 0.55 * (1 - dT));
      u += role.risk * progress * 0.4;
      if (press > 0.6 && dGoal > 20) u += 0.12 * p; // recycling under pressure is for the build-up, not the box
      // giving up a shooting chance to go backwards: forwards hate it, the better the finisher the more
      if (shotXg > 0.03 && progX < 0) u -= shotXg * 3 * (0.4 + fin) * role.shoot + 0.03;
      u += (m.rng.next() - 0.5) * 0.3 * (1 - vis * 0.7);
      if (r.isGK && !this.isGK) u -= 0.05;
      opts.push({ k: 'pass', u, r, tx, ty, kind });
    }
    // cross
    if (!this.isGK && depth > 0.7 && Math.abs(this.y - 34) > 14) {
      const cx = gx - dirv * 10.5, cy = 34 + (this.y > 34 ? -1 : 1) * 2.5;
      const inBox = mates.filter((o) => Math.hypot(o.x - cx, o.y - cy) < 9);
      const box = inBox.length;
      const air = inBox.reduce((mx, o) => Math.max(mx, o.card.skills.aerial / 100), 0); // a target man in the box invites the cross
      const def = m.onPitchOf(1 - t as TeamId).filter((o) => Math.hypot(o.x - cx, o.y - cy) < 7).length;
      if (box > 0) {
        const pArr = clamp(0.3 + 0.45 * vis - 0.15 * press, 0.1, 0.85);
        opts.push({ k: 'cross', u: pArr * (0.085 * box + 0.12 * Math.max(0, air - 0.6) - 0.025 * def + 0.05) * 1.8 * (0.8 + role.risk * 0.3) + (role.ipOut > 0 ? 0.04 : 0), tx: cx, ty: cy });
      }
    }
    if (!this.isGK) {
      const dribSkill = this.eff('touch') * 0.5 + this.eff('pace') * 0.3 + comp * 0.2;
      const pD = clamp(0.4 + 0.4 * dribSkill - 0.4 * press, 0.12, 0.9);
      let u = pD * (0.1 + 0.1 * role.dribble * (free > 6 ? 1 : 0.3)) - (1 - pD) * 0.16 + 0.01;
      // flair: elite dribblers take their man on in the final third; clumsy players don't try
      if (depth > 0.55) u += 0.55 * Math.max(-0.05, dribSkill - 0.72) * role.dribble * (free < 8 ? 1 : 0.6);
      opts.push({ k: 'dribble', u });
    }
    if (depth < 0.3 && press > 0.7) opts.push({ k: 'clear', u: 0.2 });

    let best = opts[0];
    for (const o of opts) if (o.u > best.u) best = o;
    if (!best) { this.think = 3; return; }
    if (best.k === 'dribble') { this.think = Math.max(2, Math.round(0.5 / m.dtp)); return; }
    if (this.isGK && best.k === 'pass' && best.u < 0.02) { this.think = 3; return; }
    switch (best.k) {
      case 'shot': m.kickShot(this, 'foot'); break;
      case 'pass': m.kickPass(this, best.kind, best.tx, best.ty, best.r); break;
      case 'cross': m.kickPass(this, 'cross', best.tx, best.ty, null); break;
      case 'clear': {
        const tgt = m.rng.pick(m.onPitchOf(t).filter((o) => !o.isGK && (o.x - this.x) * dirv > 15));
        if (tgt) m.kickPass(this, 'long', tgt.x, tgt.y, tgt); else m.kickPass(this, 'long', this.x + dirv * 45, this.y + (m.rng.next() - 0.5) * 30, null);
        break;
      }
    }
  }

  /** estimate used for UI overlays and decisions */
  laneEstimate(m: Match, tx: number, ty: number, speed: number, lofted: boolean) {
    return laneClear(this.x, this.y, tx, ty, speed, m.spBy[1 - this.team], lofted);
  }
}
