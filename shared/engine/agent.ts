import type { PlayerCard, SkillKey, TeamId } from '../types';
import { L, W, clamp } from '../types';
import { ROLE_MAP, STRATS, type RoleDef } from '../formations';
import { laneClear } from './spatial';
import type { Match } from './engine';

/** Expected-threat style value of having the ball at (x, y) for a team attacking towards dirv (goal probability of the possession). */
export function threatAt(dirv: number, x: number, y: number): number {
  const gx = dirv === 1 ? L : 0;
  const d = Math.hypot(gx - x, 34 - y);
  const central = 1 - Math.min(1, Math.abs(y - 34) / 30);
  return 0.004 + 0.2 * Math.exp(-d / 11) * (0.55 + 0.45 * central);
}

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

  /**
   * On-ball decision. Every option is valued in the same currency: the chance that this possession ends in a goal
   * (an "expected threat" model, as used in football analytics), minus the danger of losing the ball where it goes.
   * The player's own attributes and role then colour how he sees and weighs those options.
   */
  decide(m: Match) {
    const t = this.team, opp = (1 - t) as TeamId, tac = m.tactics[t], mods = STRATS[tac.strategy], role = this.role(m), dirv = m.dir[t];
    const gx = dirv === 1 ? L : 0;
    const press = m.pressureAt(this.x, this.y, t);
    const depth = m.depthOf(t, this.x);
    const vis = this.eff('passing');
    const comp = this.eff('composure');
    const sk = this.card.skills;
    const fin = sk.finishing / 100;
    const trN = m.trans[t];
    const counter = trN.kind === 'won' && trN.ticks > 0 && tac.transition === 'counterattack';
    // team style: how much a forward ball is worth vs keeping it
    const direct = clamp(0.5 + mods.direct + (tac.buildUp === 'direct' ? 0.3 : tac.buildUp === 'short' ? -0.25 : 0) + (counter ? 0.3 : 0), 0.15, 1.35);
    const ambition = 0.85 + 0.3 * direct + 0.25 * role.risk; // weight on the value of where the ball goes
    // fear of losing it: careful roles and short build-up fear it more; low composure under pressure = panic
    const caution = clamp(1.6 - 0.45 * role.risk - 0.35 * (direct - 0.5) + press * (1 - comp) * 0.8, 0.8, 2.4);
    const noise = 0.012 * (1 - 0.75 * vis); // how clearly he reads the picture
    const here = threatAt(dirv, this.x, this.y);
    const oc = here * 0.75; // opportunity cost: a failed action throws away the attack we already have
    const TO = 0.026; // a turnover also sets the opponent off on a counter while we are out of shape
    const opts: Opt[] = [];

    // ---- shot
    const dGoal = Math.hypot(gx - this.x, 34 - this.y);
    let shotXg = 0;
    if (!this.isGK && dGoal < 34) {
      shotXg = m.xgAt(this, this.x, this.y, false, press);
      // shooting instinct: finishers back themselves, the role scales it (a poacher always, an anchor rarely)
      const selfish = clamp(role.shoot * (0.4 + 0.6 * fin), 0.3, 1.1);
      // bodies in the way: players see the shooting lane and don't blast into a wall
      let wall = 0;
      for (const o of m.spBy[opp]) {
        const along = ((o.x - this.x) * (gx - this.x) + (o.y - this.y) * (34 - this.y)) / (dGoal * dGoal + 1e-6);
        if (along < 0.04 || along > 0.95) continue;
        if (Math.hypot(o.x - (this.x + (gx - this.x) * along), o.y - (this.y + (34 - this.y) * along)) < 1.6) wall++;
      }
      let u = shotXg * selfish * Math.max(0.35, 1 - 0.22 * wall) + 0.002 - (1 - shotXg) * oc * 0.8; // + a little for rebounds / corners, minus the attack given up
      if (dGoal > 16) u -= 0.026 * clamp(1.5 - fin - 0.3 * role.shoot, 0.2, 1.2); // speculative efforts: only real shooters try them
      if (dGoal > 16 && m.rng.next() < clamp((fin - 0.6) * 0.8, 0, 0.25) * role.shoot) u += 0.02; // "he fancies it from there"
      opts.push({ k: 'shot', u });
    }

    // ---- passes
    const mates = m.onPitchOf(t).filter((o) => o !== this);
    for (const r of mates) {
      const tx = clamp(r.x + r.vx * 0.9, 1, L - 1), ty = clamp(r.y + r.vy * 0.9, 1, W - 1);
      const dist = Math.hypot(tx - this.x, ty - this.y);
      if (dist < 4 || dist > 68) continue;
      const progX = (tx - this.x) * dirv;
      const kind: 'pass' | 'through' | 'long' = dist > 36 ? 'long' : progX > 9 && !r.isGK ? 'through' : 'pass';
      // an attacker high up the pitch does not even look at a long ball back to his own defence
      if (this.slot > 4 && depth > 0.5 && progX < -18) continue;
      if (m.rules.wouldBeOffside(r, this, tx)) { if (m.rng.next() < 0.45 + 0.5 * vis) continue; }
      // vision: only creative passers reliably spot the through ball or the long switch
      if (kind !== 'pass' && progX > 0 && m.rng.next() > 0.3 + 0.75 * vis) continue;
      const p = m.passEstimate(this, tx, ty, kind);
      const pT = m.pressureAt(tx, ty, t);
      // what the ball is worth at his feet: the pitch value there, or his own chance if he can shoot from there
      let val = threatAt(dirv, tx, ty);
      const rRole = ROLE_MAP[tac.roles[r.slot]] ?? ROLE_MAP.cb;
      if (!r.isGK && Math.hypot(gx - tx, 34 - ty) < 26) {
        const rx = m.xgAt(r, tx, ty, false, pT * 0.7);
        val = Math.max(val, rx * clamp(rRole.shoot * (0.55 + 0.6 * r.card.skills.finishing / 100), 0.35, 1.3));
      }
      val *= clamp(1 - 0.45 * pT * (1.1 - r.eff('touch')), 0.5, 1); // a receiver under pressure may not keep it
      if (r.isGK) val *= 0.5; // keeper ball: safe but kills the attack
      // going backwards hands the opponent time to reset: the further back, the more of the attack is lost.
      // Attackers don't hit long balls back to their own defence.
      if (progX < 0 && this.slot > 4) {
        val *= 1 - clamp(-progX / 45, 0, 0.6);
        if (kind === 'long') val *= 0.35;
        if (r.slot >= 1 && r.slot <= 4 && depth > 0.55) val *= 0.6;
      }
      const lose = threatAt(-dirv, tx, ty); // what the opponent gets if it's cut out there
      let u = p * val * ambition - (1 - p) * (lose * caution * 1.6 + oc * caution + TO * caution);
      if (counter && progX > 8) u += 0.006 * p; // break with pace
      u += m.rng.gauss() * noise;
      opts.push({ k: 'pass', u, r, tx, ty, kind });
    }

    // ---- cross into the box (value from the best header in there)
    if (!this.isGK && depth > 0.68 && Math.abs(this.y - 34) > 12) {
      const cx = gx - dirv * 10.5, cy = 34 + (this.y > 34 ? -1 : 1) * 2.5;
      const inBox = mates.filter((o) => Math.hypot(o.x - cx, o.y - cy) < 9);
      const def = m.onPitchOf(opp).filter((o) => Math.hypot(o.x - cx, o.y - cy) < 8).length;
      if (inBox.length) {
        const pArr = clamp(0.25 + 0.5 * vis - 0.15 * press, 0.1, 0.85); // crossing quality
        let best = 0;
        for (const o of inBox) {
          const win = clamp(0.25 + 0.6 * (o.card.skills.aerial / 100 - 0.5) + 0.12 * (inBox.length - def), 0.08, 0.8);
          best = Math.max(best, win * m.xgAt(o, cx, cy, true, 0.3));
        }
        const u = pArr * best * (0.9 + 0.4 * (role.ipOut > 0 ? 1 : 0) + 0.2 * role.risk) * ambition + 0.004 - (1 - pArr * 0.5) * oc * 0.6 + m.rng.gauss() * noise;
        opts.push({ k: 'cross', u, tx: cx, ty: cy });
      }
    }

    // ---- keep it: carry / shield / take a man on
    if (!this.isGK) {
      const dribSkill = this.eff('touch') * 0.5 + this.eff('pace') * 0.3 + comp * 0.2;
      const pKeep = clamp(0.45 + 0.5 * dribSkill - 0.38 * press + role.hold * 0.4, 0.1, 0.95);
      const carryX = clamp(this.x + dirv * 6, 1, L - 1);
      const ahead = threatAt(dirv, carryX, this.y + (34 - this.y) * 0.25);
      let u = pKeep * Math.max(ahead, here) * ambition - (1 - pKeep) * (threatAt(-dirv, this.x, this.y) * caution * 1.6 + oc * caution + TO * caution * 0.8);
      // flair: elite dribblers back themselves against a defender in the final third
      if (depth > 0.55) u += 0.012 * (dribSkill - 0.72) * role.dribble * 3;
      u += m.rng.gauss() * noise * 0.5;
      opts.push({ k: 'dribble', u });
    }

    // ---- clearance: under real pressure near your own goal, get rid of it
    if ((depth < 0.33 && press > 0.6) || this.isGK) {
      const land = threatAt(dirv, clamp(this.x + dirv * 45, 1, L - 1), 34);
      opts.push({ k: 'clear', u: 0.45 * land - 0.55 * land * 0.5 - 0.002 });
    }
    void here;

    let best = opts[0];
    for (const o of opts) if (o.u > best.u) best = o;
    if (!best) { this.think = 3; return; }
    if (best.k === 'dribble') { this.think = Math.max(2, Math.round(0.5 / m.dtp)); return; }
    if (this.isGK && best.k === 'clear' && m.rng.next() < 0.6) { this.think = 3; return; } // keeper waits for an option before going long
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
