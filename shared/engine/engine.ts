import { Rng } from '../rng';
import type {
  Lineup, MatchEvent, Order, PlayerCard, PlayerSnap, RestartKind, Snapshot, TeamId, TeamStats, TeamTactics, ZoneId, UnitCmd, Side, EventType, CtlView,
} from '../types';
import { L, W, GY0, GY1, GOAL_W, BOX_D, BOX_Y0, BOX_Y1, clamp, emptyStats, F_BALL, F_SPRINT, F_YELLOW, F_PRESS, F_ABSENT, F_ORDER } from '../types';
import { ROLE_MAP, STRATS, SHAPES, SLOT_GROUP, fitAt, shapePts, toWorld, depthOf } from '../formations';
import { normalizePlan } from '../lineup';
import { PlayerAgent } from './agent';
import { SpatialEvaluator, pressureAt, laneClear, type SP } from './spatial';
import { RulesEngine } from './rules';
import { TacticalCauseTracker } from './causes';

/** Physical time compression per tick (a tick = 0.1s x PS of football physics) by match length in minutes. */
export const PS: Record<number, number> = { 3: 2.9, 6: 2.4, 10: 1.9 };

export interface MatchConfig {
  seed: number;
  duration: 3 | 6 | 10;
  squads: [PlayerCard[], PlayerCard[]];
  lineups: [Lineup, Lineup];
  tactics: [TeamTactics, TeamTactics];
  kickoffTeam: TeamId;
}

export interface ShotInfo { outcome: 'goal' | 'save' | 'post' | 'wide' | 'block'; xg: number; header: boolean; pen: boolean; blocker: PlayerAgent | null }
export interface Flight {
  kind: 'pass' | 'through' | 'cross' | 'long' | 'clear' | 'shot';
  team: TeamId; passer: PlayerAgent; receiver: PlayerAgent | null;
  fx: number; fy: number; toX: number; toY: number; s: number; ds: number; arc: number; speed: number;
  offside: boolean; setPiece: boolean; shot?: ShotInfo; lofted: boolean;
}
export interface Ball { x: number; y: number; z: number; vx: number; vy: number; px: number; py: number; owner: PlayerAgent | null; last: PlayerAgent | null; lastTeam: TeamId; flight: Flight | null }
export interface Restart {
  kind: RestartKind; team: TeamId; x: number; y: number; delay: number; taker: PlayerAgent;
  targets: Map<PlayerAgent, { x: number; y: number }>; direct: boolean; age: number;
}
export interface ActiveOrder { key: string; label: string; kind: 'overload' | 'swarm' | 'lowBlock' | 'unit'; zone?: ZoneId; unit?: UnitCmd; side?: Side; ticks: number; total: number; ids: string[] }
export interface Ctl { lag: number; lock: number; active: ActiveOrder[]; cd: Record<string, number> }
export interface Trans { kind: 'none' | 'lost' | 'won'; ticks: number }

export const ZONES: Record<ZoneId, { x: number; y: number; label: string }> = {
  leftFlank: { x: 0.74, y: -0.86, label: 'Left Flank' },
  rightFlank: { x: 0.74, y: 0.86, label: 'Right Flank' },
  leftHalfSpace: { x: 0.70, y: -0.45, label: 'Left Half-Space' },
  rightHalfSpace: { x: 0.70, y: 0.45, label: 'Right Half-Space' },
  centralMid: { x: 0.52, y: 0, label: 'Central Midfield' },
};
export const UNIT_LABEL: Record<UnitCmd, string> = {
  fullbackOverlap: 'Full-back Overlap', fullbackInvert: 'Full-back Invert', midDropDeep: 'Midfielder Drop Deep', forwardPressHigh: 'Forward Press High',
};

const sg = (v: number) => (v < 0 ? -1 : 1);

export class Match {
  rng: Rng;
  duration: 3 | 6 | 10;
  totalTicks: number; halfTicks: number; dtp: number; drainK: number; tpm: number;
  tick = 0; tickInHalf = 0; half: 1 | 2 = 1;
  phase: 'play' | 'dead' | 'halftime' | 'fulltime' = 'dead';
  added = 0; addedAnnounced = false; stopAccum = 0; stopId = 0;
  dir: [1 | -1, 1 | -1] = [1, -1];
  agents: [PlayerAgent[], PlayerAgent[]];
  onPitch: [(PlayerAgent | null)[], (PlayerAgent | null)[]];
  pitch: [PlayerAgent[], PlayerAgent[]] = [[], []];
  byId = new Map<string, PlayerAgent>();
  tactics: [TeamTactics, TeamTactics];
  ball: Ball = { x: 52.5, y: 34, z: 0, vx: 0, vy: 0, px: 52.5, py: 34, owner: null, last: null, lastTeam: 0, flight: null };
  score: [number, number] = [0, 0];
  possTeam: TeamId | -1 = -1;
  stats: [TeamStats, TeamStats] = [emptyStats(), emptyStats()];
  events: MatchEvent[] = [];
  fresh: MatchEvent[] = [];
  evId = 0;
  spatial = new SpatialEvaluator();
  rules: RulesEngine;
  causes: TacticalCauseTracker;
  restart: Restart | null = null;
  ctl: [Ctl, Ctl] = [{ lag: 0, lock: 0, active: [], cd: {} }, { lag: 0, lock: 0, active: [], cd: {} }];
  trans: [Trans, Trans] = [{ kind: 'none', ticks: 0 }, { kind: 'none', ticks: 0 }];
  pressers: [Set<PlayerAgent>, Set<PlayerAgent>] = [new Set(), new Set()];
  jockey: [PlayerAgent | null, PlayerAgent | null] = [null, null];
  chasers: [Set<PlayerAgent>, Set<PlayerAgent>] = [new Set(), new Set()];
  contest: [Set<PlayerAgent>, Set<PlayerAgent>] = [new Set(), new Set()];
  spBy: [SP[], SP[]] = [[], []];
  backPassTicks = 0; poorTouch = 0;
  kickoffTeam: TeamId;
  clockOffset = 0;

  constructor(public cfg: MatchConfig) {
    this.rng = new Rng(cfg.seed);
    this.duration = cfg.duration;
    this.totalTicks = cfg.duration * 60 * 10;
    this.halfTicks = this.totalTicks / 2;
    this.tpm = this.totalTicks / 90;
    this.dtp = 0.1 * PS[cfg.duration];
    this.drainK = 1.8 / this.totalTicks;
    this.kickoffTeam = cfg.kickoffTeam;
    this.tactics = [structuredClone(cfg.tactics[0]), structuredClone(cfg.tactics[1])];
    this.agents = [[], []];
    this.onPitch = [new Array(11).fill(null), new Array(11).fill(null)];
    for (const t of [0, 1] as TeamId[]) {
      for (const card of cfg.squads[t]) {
        const a = new PlayerAgent(card, t);
        this.agents[t].push(a);
        this.byId.set(card.id, a);
      }
      cfg.lineups[t].starters.forEach((id, slot) => {
        const a = this.byId.get(id)!;
        a.slot = slot; a.onPitch = true; this.onPitch[t][slot] = a;
      });
      this.refit(t);
    }
    this.rules = new RulesEngine(this);
    this.causes = new TacticalCauseTracker(this);
    this.refreshPitch();
    this.possTeam = this.kickoffTeam;
    this.rules.setRestart('kickoff', this.kickoffTeam, 52.5, 34, true);
    this.refreshSP();
    this.computeAnchors(0); this.computeAnchors(1);
    this.rules.teleportAll();
    this.firstEvent();
  }

  // ------------------------------------------------------------- helpers
  /** Positional familiarity and run behaviour from where each player stands in the team's own shape. */
  refit(t: TeamId) {
    const ip = shapePts(this.tactics[t], 'ip');
    for (const a of this.onPitch[t]) {
      if (!a || a.slot < 0) continue;
      a.fit = fitAt(a.card.pos, ip[a.slot]);
      a.runner = a.slot > 0 && ip[a.slot][0] >= 0.43;
    }
  }
  refreshPitch() {
    for (const t of [0, 1] as TeamId[]) this.pitch[t] = this.onPitch[t].filter((a): a is PlayerAgent => !!a && !a.sentOff);
  }
  onPitchOf(t: TeamId) { return this.pitch[t]; }
  keeperOf(t: TeamId): PlayerAgent | null { const g = this.onPitch[t][0]; return g && !g.sentOff ? g : null; }
  depthOf(t: TeamId, x: number) { return depthOf(this.dir[t], x); }
  goalX(t: TeamId) { return this.dir[t] === 1 ? L : 0; }
  teamName(t: TeamId) { return t === 0 ? 'Home' : 'Away'; }
  pressureAt(x: number, y: number, team: TeamId) { return pressureAt(x, y, this.spBy[1 - team]); }
  ctick(sec: number) { return Math.max(1, Math.round(sec / this.dtp)); }
  /** World x of the offside line vs attackers of the team opposite to `def` (second-last defender incl. GK). */
  offsideLineX(def: TeamId): number {
    const d = this.dir[def];
    const xs = this.pitch[def].map((a) => a.x * d * -1); // smaller = closer to own goal ... compute depth from own goal
    const depths = this.pitch[def].map((a) => (d === 1 ? a.x : L - a.x)).sort((a, b) => a - b);
    const second = depths[1] ?? depths[0] ?? 0;
    void xs;
    return d === 1 ? second : L - second;
  }
  clockLabel(): { label: string; minute: number } {
    const base = (this.half - 1) * 45;
    if (this.tickInHalf <= this.halfTicks) {
      const m = Math.min(44, Math.floor(this.tickInHalf / this.tpm));
      return { label: `${base + m + 1}'`, minute: base + m + 1 };
    }
    const extra = Math.ceil((this.tickInHalf - this.halfTicks) / this.tpm);
    return { label: `${base + 45}+${extra}'`, minute: base + 45 + extra };
  }
  emit(type: EventType, team: TeamId | -1, player: PlayerAgent | null, text: string, causes: string[] = [], importance = 1, extra: Partial<MatchEvent> = {}) {
    const c = this.clockLabel();
    const e: MatchEvent = { id: ++this.evId, tick: this.tick, label: c.label, minute: c.minute, type, team, playerId: player?.card.id, text, causes, importance, ...extra };
    this.events.push(e); this.fresh.push(e);
    return e;
  }
  nm(a: PlayerAgent) { return `#${a.card.number} ${a.card.name.split(' ').slice(-1)[0]}`; }

  // ------------------------------------------------------------- physics probes
  xgAt(a: PlayerAgent, x: number, y: number, header: boolean, press: number): number {
    const gx = this.goalX(a.team);
    const dx = Math.max(0.6, Math.abs(gx - x));
    const dist = Math.hypot(dx, y - 34);
    const ang = Math.abs(Math.atan2(GY1 - y, dx) - Math.atan2(GY0 - y, dx));
    const logit = -1.96 - 0.0955 * dist + 1.97 * ang + (a.eff('finishing') - 0.62) * 1.4 + (a.eff('composure') - 0.6) * 0.5 - 0.95 * press - (header ? 0.55 : 0);
    return clamp(1 / (1 + Math.exp(-logit)), 0.004, 0.85);
  }
  passEstimate(a: PlayerAgent, tx: number, ty: number, kind: string): number {
    const lofted = kind === 'long' || kind === 'cross' || kind === 'clear';
    const passEff = a.eff('passing') * 0.62 + a.eff('composure') * 0.16 + a.eff('touch') * 0.22;
    const speed = (lofted ? 19 : 13.5) + passEff * (lofted ? 7 : 10);
    const { p } = laneClear(a.x, a.y, tx, ty, speed, this.spBy[1 - a.team], lofted);
    const dist = Math.hypot(tx - a.x, ty - a.y);
    const acc = clamp(0.74 + 0.3 * passEff - dist * 0.0035 * (lofted ? 0.7 : 1) - this.pressureAt(a.x, a.y, a.team) * 0.09, 0.2, 0.99);
    return p * acc;
  }
  pressIntensity(t: TeamId): number {
    const tac = this.tactics[t], mods = STRATS[tac.strategy], c = this.ctl[t];
    let pi = tac.pressing / 100 + mods.press / 100;
    const tr = this.trans[t];
    if (tr.kind === 'lost' && tr.ticks > 0) pi += tac.transition === 'counterpress' ? 0.3 : tac.transition === 'regroup' ? -0.3 : 0;
    if (c.active.some((o) => o.kind === 'lowBlock')) pi = Math.min(pi, 0.15);
    if (c.active.some((o) => o.kind === 'swarm')) pi = Math.max(pi, 1);
    return clamp(pi, 0, 1.2);
  }

  // ------------------------------------------------------------- orders
  private cdTicks(n: number) { return Math.max(4, Math.round(n * clamp(this.totalTicks / 3600, 0.6, 1.6))); }
  applyOrder(team: TeamId, order: Order): { ok: boolean; reason?: string } {
    const c = this.ctl[team], tac = this.tactics[team];
    if (this.phase === 'fulltime') return { ok: false, reason: 'Match is over' };
    const ht = this.phase === 'halftime';
    if (order.kind === 'tactics') {
      // The tactical board can be changed at any time (running, paused or at half-time); the team
      // simply needs a few seconds to reorganise (transition lag) before the new plan fully applies.
      const p = structuredClone(order.patch);
      if (p.roles && p.roles.length !== 11) delete p.roles;
      if (p.ipPts && p.ipPts.length !== 11) delete p.ipPts;
      if (p.oopPts && p.oopPts.length !== 11) delete p.oopPts;
      Object.assign(tac, p);
      if (p.ipPts || p.oopPts || p.roles || p.ipShape || p.oopShape) this.reshape(team);
      if (!ht) { c.lag = Math.max(c.lag, this.ctick(4)); this.emit('order', team, null, `${this.teamName(team)} adjust the tactical board`, [], 1); }
      return { ok: true };
    }
    if (ht) return { ok: false, reason: 'Live orders are for active play' };
    if (c.lock > 0) return { ok: false, reason: 'Units still adjusting — wait a moment' };
    switch (order.kind) {
      case 'cancel': c.active = []; c.lag = this.ctick(2.5); c.lock = this.ctick(2); return { ok: true };
      case 'strategy': {
        if (order.strategy === tac.strategy) return { ok: false, reason: 'Already playing that strategy' };
        if (c.cd.strategy > 0) return { ok: false, reason: `Strategy switch cooling down (${Math.ceil(c.cd.strategy / 10)}s)` };
        tac.strategy = order.strategy;
        c.lag = this.ctick(8); c.lock = this.ctick(3); c.cd.strategy = this.cdTicks(450);
        this.emit('order', team, null, `${this.teamName(team)} switch to ${STRATS[order.strategy].label}`, ['Transition lag: units reorganise for a few seconds.'], 3);
        return { ok: true };
      }
      case 'overload': {
        if (c.cd.overload > 0) return { ok: false, reason: `Overload cooling down (${Math.ceil(c.cd.overload / 10)}s)` };
        const z = ZONES[order.zone];
        const dur = this.cdTicks(220);
        const cand = this.pitch[team].filter((a) => !a.isGK && a.slot !== 2 && a.slot !== 3);
        const tw = toWorld(this.dir[team], z.x, z.y);
        cand.sort((a, b) => Math.hypot(a.x - tw.x, a.y - tw.y) - Math.hypot(b.x - tw.x, b.y - tw.y));
        c.active = c.active.filter((o) => o.kind !== 'overload');
        c.active.push({ key: 'overload', label: `Overload: ${z.label}`, kind: 'overload', zone: order.zone, ticks: dur, total: dur, ids: cand.slice(0, 3).map((a) => a.card.id) });
        c.cd.overload = dur + this.cdTicks(300);
        c.lag = this.ctick(3); c.lock = this.ctick(2.5);
        this.emit('order', team, null, `${this.teamName(team)} overload the ${z.label.toLowerCase()}`, ['Three players commit to the zone; the far side thins out.'], 3);
        return { ok: true };
      }
      case 'swarm': {
        if (c.cd.swarm > 0) return { ok: false, reason: `Swarm cooling down (${Math.ceil(c.cd.swarm / 10)}s)` };
        const dur = this.cdTicks(110);
        c.active = c.active.filter((o) => o.kind !== 'swarm' && o.kind !== 'lowBlock');
        c.active.push({ key: 'swarm', label: 'Press Carrier Swarm', kind: 'swarm', ticks: dur, total: dur, ids: [] });
        c.cd.swarm = dur + this.cdTicks(300); c.lag = this.ctick(2); c.lock = this.ctick(2.5);
        this.emit('order', team, null, `${this.teamName(team)} swarm the ball carrier`, ['Stamina drain x1.8 while swarming.'], 3);
        return { ok: true };
      }
      case 'lowBlock': {
        if (c.cd.lowBlock > 0) return { ok: false, reason: `Low block cooling down (${Math.ceil(c.cd.lowBlock / 10)}s)` };
        const dur = this.cdTicks(300);
        c.active = c.active.filter((o) => o.kind !== 'swarm' && o.kind !== 'lowBlock');
        c.active.push({ key: 'lowBlock', label: 'Drop to Low Block', kind: 'lowBlock', ticks: dur, total: dur, ids: [] });
        c.cd.lowBlock = dur + this.cdTicks(200); c.lag = this.ctick(3); c.lock = this.ctick(2.5);
        this.emit('order', team, null, `${this.teamName(team)} drop into a low block`, [], 3);
        return { ok: true };
      }
      case 'unit': {
        const key = `unit:${order.unit}:${order.side}`;
        if (c.cd[key] > 0) return { ok: false, reason: `Order cooling down (${Math.ceil(c.cd[key] / 10)}s)` };
        if (c.active.filter((o) => o.kind === 'unit').length >= 3) return { ok: false, reason: 'Too many unit orders active' };
        const dur = this.cdTicks(250);
        c.active = c.active.filter((o) => o.key !== key);
        c.active.push({ key, label: `${UNIT_LABEL[order.unit]} (${order.side})`, kind: 'unit', unit: order.unit, side: order.side, ticks: dur, total: dur, ids: [] });
        c.cd[key] = dur + this.cdTicks(200); c.lag = this.ctick(1.5); c.lock = this.ctick(1.5);
        this.emit('order', team, null, `${this.teamName(team)}: ${UNIT_LABEL[order.unit]} (${order.side})`, [], 2);
        return { ok: true };
      }
    }
  }
  /** Re-order slots canonically after a formation change so players, points and roles stay together. */
  reshape(t: TeamId) {
    const { tac, slots } = normalizePlan(this.tactics[t], this.onPitch[t]);
    this.tactics[t] = tac;
    this.onPitch[t] = slots;
    slots.forEach((a, s) => { if (a) a.slot = s; });
    this.refreshPitch();
    this.refit(t);
  }
  requestSub(team: TeamId, outId: string, inId: string) { return this.rules.requestSub(team, outId, inId); }

  // ------------------------------------------------------------- anchors
  private computeAnchors(t: TeamId) {
    const tac = this.tactics[t], mods = STRATS[tac.strategy], c = this.ctl[t], dirv = this.dir[t];
    const inPoss = this.possTeam === t;
    const bd = clamp(this.depthOf(t, this.ball.x), 0, 1);
    const by = clamp(((this.ball.y - 34) / 30) * dirv, -1.2, 1.2);
    const low = c.active.find((o) => o.kind === 'lowBlock');
    const swarm = c.active.find((o) => o.kind === 'swarm');
    const tr = this.trans[t];
    const pts = inPoss ? shapePts(tac, 'ip') : low ? SHAPES['5-4-1 Low Block'].pts : shapePts(tac, 'oop');
    let lineH = tac.lineHeight + mods.line + (low ? -45 : 0) + (swarm ? 12 : 0);
    if (tr.kind === 'lost' && tr.ticks > 0) lineH += tac.transition === 'regroup' ? -18 : tac.transition === 'counterpress' ? 8 : 0;
    lineH = clamp(lineH, 0, 100);
    const compact = clamp(0.5 + mods.compact + (low ? 0.25 : 0), 0.1, 1);
    const ov = c.active.find((o) => o.kind === 'overload');
    const zone = ov ? ZONES[ov.zone!] : null;
    const units = c.active.filter((o) => o.kind === 'unit');
    for (const a of this.pitch[t]) {
      a.loadMult = 1; a.ordered = false; a.forcePress = false;
      const s = a.slot;
      const role = ROLE_MAP[tac.roles[s]] ?? ROLE_MAP.cb;
      let [px, py] = pts[s];
      if (s === 0) {
        px = 0.045 + (inPoss ? role.ipDx + 0.04 : role.oopDx) + (lineH - 50) / 100 * 0.04;
        const w = toWorld(dirv, px, 0); a.ax = w.x; a.ay = 34 + by * 6; continue;
      }
      if (inPoss) {
        px += role.ipDx;
        py = py * (1 - role.ipIn); if (role.ipOut) py += sg(py) * role.ipOut * (1 - Math.abs(py));
        px += (bd - 0.5) * 0.3; py += (by - py) * 0.1;
        // attacking in the final third: midfielders arrive around the box by role (box-to-box / No.10 yes, anchor no)
        if (bd > 0.6 && s >= 5 && s <= 8) px += (bd - 0.6) * (0.1 + 0.6 * role.run);
      } else {
        px += role.oopDx;
        px += (bd - 0.5) * 0.52; py += (by - py) * compact * 0.35;
      }
      const g = s <= 4 ? 0 : s <= 8 ? 1 : 2;
      px += ((lineH - 50) / 100) * [0.3, 0.2, 0.1][g] * (inPoss ? 0.5 : 1);
      if (tr.kind === 'won' && tr.ticks > 0 && tac.transition === 'counterattack' && s >= 5) px += 0.12;
      if (zone && ov) {
        const idx = ov.ids.indexOf(a.card.id);
        if (idx >= 0) {
          const zx = inPoss ? zone.x : zone.x - 0.3;
          const offs = [[0.05, 0], [-0.07, 0.2], [0.1, 0.25]][idx];
          px = zx + offs[0];
          py = zone.y === 0 ? (idx - 1) * 0.28 : zone.y - sg(zone.y) * offs[1];
          a.loadMult *= 1.35; a.ordered = true;
        } else {
          py += (zone.y - py) * 0.17;
          if (Math.abs(py) > 0.55 && sg(py) !== sg(zone.y || 1)) py += (zone.y - py) * 0.1;
        }
      }
      for (const u of units) {
        const sideMatch = (slotL: number, slotR: number) => (u.side === 'both' ? s === slotL || s === slotR : u.side === 'left' ? s === slotL : s === slotR);
        if (u.unit === 'fullbackOverlap' && sideMatch(1, 4)) {
          if (inPoss) { px += 0.2; py = sg(py) * 0.95; } else px += 0.08;
          a.loadMult *= 1.2; a.ordered = true;
        } else if (u.unit === 'fullbackInvert' && sideMatch(1, 4)) {
          if (inPoss) { py *= 0.2; px += 0.1; }
          a.ordered = true;
        } else if (u.unit === 'midDropDeep' && sideMatch(6, 7)) { px -= 0.13; a.ordered = true; }
        else if (u.unit === 'forwardPressHigh' && sideMatch(9, 10)) {
          if (!inPoss) { px += 0.13; a.forcePress = true; a.loadMult *= 1.25; }
          a.ordered = true;
        }
      }
      px = clamp(px, 0.04, 0.97); py = clamp(py, -1, 1);
      const w = toWorld(dirv, px, py);
      a.ax = w.x; a.ay = w.y;
    }
    if (swarm) for (const a of this.pitch[t]) if (!a.isGK) a.ordered = a.ordered || false;
  }

  private computePress(t: TeamId) {
    const set = this.pressers[t]; set.clear(); this.jockey[t] = null;
    const c = this.ball.owner;
    if (!c || c.team === t || this.phase !== 'play') return;
    const tac = this.tactics[t], cc = this.ctl[t];
    const pi = this.pressIntensity(t);
    const swarm = cc.active.some((o) => o.kind === 'swarm');
    const n = swarm ? 3 : 1 + (pi > 0.5 ? 1 : 0) + (pi > 0.9 ? 1 : 0);
    const tr = this.trans[t];
    const trigger = pi > 0.78 || swarm || (tr.kind === 'lost' && tr.ticks > 0 && tac.transition === 'counterpress') ||
      tac.triggers.includes('always') || (tac.triggers.includes('touchline') && Math.abs(c.y - 34) > 25) ||
      (tac.triggers.includes('backPass') && this.backPassTicks > 0) || (tac.triggers.includes('poorTouch') && this.poorTouch > 0);
    const radius = swarm ? 45 : 9 + 16 * pi;
    const cands = this.pitch[t].filter((a) => !a.isGK).map((a) => ({ a, d: Math.hypot(a.x - c.x, a.y - c.y) })).sort((p, q) => p.d - q.d);
    let k = 0;
    for (const { a, d } of cands) {
      if (a.forcePress && d < 26) { set.add(a); continue; }
      if (k >= n) break;
      if (d < radius && (trigger || (k === 0 && d < 9))) { set.add(a); k++; }
    }
    if (!set.size && cands.length && cands[0].d < 20) this.jockey[t] = cands[0].a;
  }

  // ------------------------------------------------------------- per-tick
  private refreshSP() {
    for (const t of [0, 1] as TeamId[]) {
      this.spBy[t] = this.pitch[t].map((a) => ({ team: t, x: a.x, y: a.y, vx: a.vx, vy: a.vy, speed: a.maxSpeed(), int: a.eff('tackling') * 0.6 + a.posEff() * 0.4 }));
    }
  }
  private updatePossession() {
    const prev = this.possTeam;
    let pt: TeamId | -1 = prev;
    if (this.ball.owner) pt = this.ball.owner.team; else if (this.ball.flight) pt = this.ball.flight.team;
    if (this.phase === 'dead' && this.restart) pt = this.restart.team;
    if (pt !== prev && pt !== -1) {
      this.causes.possessionChanged();
      if (prev !== -1 && this.phase === 'play') {
        const n = this.ctick(3.5);
        this.trans[pt === 0 ? 1 : 0] = { kind: 'lost', ticks: n };
        this.trans[pt] = { kind: 'won', ticks: n };
      }
    }
    this.possTeam = pt;
  }
  private tickTimers() {
    for (const t of [0, 1] as TeamId[]) {
      const c = this.ctl[t];
      if (c.lag > 0) c.lag--; if (c.lock > 0) c.lock--;
      for (const k of Object.keys(c.cd)) if (c.cd[k] > 0) c.cd[k]--;
      for (const o of c.active) o.ticks--;
      c.active = c.active.filter((o) => o.ticks > 0);
      if (this.trans[t].ticks > 0 && --this.trans[t].ticks === 0) this.trans[t].kind = 'none';
    }
    if (this.backPassTicks > 0) this.backPassTicks--;
    if (this.poorTouch > 0) this.poorTouch--;
  }
  private computeChasers() {
    const b = this.ball;
    for (const t of [0, 1] as TeamId[]) { this.chasers[t].clear(); this.contest[t].clear(); }
    if (this.phase !== 'play') return;
    if (!b.owner && !b.flight) {
      for (const t of [0, 1] as TeamId[]) {
        const arr = this.pitch[t].filter((a) => !a.isGK).map((a) => ({ a, d: Math.hypot(a.x - b.x, a.y - b.y) / a.maxSpeed() })).sort((p, q) => p.d - q.d);
        for (let i = 0; i < Math.min(2, arr.length); i++) if (arr[i].d < 4) this.chasers[t].add(arr[i].a);
      }
    }
    const f = b.flight;
    if (f && !f.shot) {
      const dt = (1 - f.team) as TeamId;
      const arr = this.pitch[dt].filter((a) => !a.isGK).map((a) => ({ a, d: Math.hypot(a.x - f.toX, a.y - f.toY) })).sort((p, q) => p.d - q.d);
      for (let i = 0; i < Math.min(2, arr.length); i++) if (arr[i].d < 24) this.contest[dt].add(arr[i].a);
    }
  }

  step() {
    if (this.phase === 'halftime' || this.phase === 'fulltime') return;
    this.tick++; this.tickInHalf++;
    this.fresh = [];
    this.refreshPitch();
    this.tickTimers();
    this.refreshSP();
    if (this.tick % 2 === 0) this.spatial.update([...this.spBy[0], ...this.spBy[1]]);
    this.updatePossession();
    this.computeAnchors(0); this.computeAnchors(1);
    this.computePress(0); this.computePress(1);
    this.computeChasers();
    const all = [...this.pitch[0], ...this.pitch[1]];
    for (const a of all) a.plan(this);
    for (const a of all) a.move(this);
    this.separate(all);
    const b = this.ball;
    b.px = b.x; b.py = b.y;
    if (this.phase === 'play') {
      this.updateBall();
      if (this.phase === 'play') { this.duels(); this.looseBall(); this.checkOut(); }
      if (this.possTeam !== -1) this.stats[this.possTeam].poss++;
    } else {
      this.syncBallToRestart();
      this.rules.deadStep();
    }
    this.rules.clockStep();
  }

  private separate(all: PlayerAgent[]) {
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], c = all[j];
        const dx = c.x - a.x, dy = c.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 0.64 && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (0.8 - d) * 0.25;
          a.x -= (dx / d) * push; a.y -= (dy / d) * push; c.x += (dx / d) * push; c.y += (dy / d) * push;
        }
      }
    }
  }

  private syncBallToRestart() {
    const b = this.ball;
    if (b.owner) { b.x = b.owner.x + b.owner.headX * 0.5; b.y = b.owner.y + b.owner.headY * 0.5; }
  }

  // ------------------------------------------------------------- ball
  give(a: PlayerAgent) {
    const b = this.ball;
    b.owner = a; b.last = a; b.lastTeam = a.team; b.flight = null; b.vx = 0; b.vy = 0; b.z = 0;
    a.think = a.holdTicks(this);
    this.causes.touch(a, 'control');
  }
  private updateBall() {
    const b = this.ball;
    if (b.flight) { this.advanceFlight(b.flight); return; }
    if (b.owner) { b.x = b.owner.x + b.owner.headX * 0.5; b.y = b.owner.y + b.owner.headY * 0.5; b.z = 0; return; }
    b.x += b.vx * this.dtp; b.y += b.vy * this.dtp; b.z = 0;
    const f = Math.exp(-0.55 * this.dtp);
    b.vx *= f; b.vy *= f;
  }

  kickPass(a: PlayerAgent, kind: 'pass' | 'through' | 'long' | 'cross' | 'clear', tx: number, ty: number, receiver: PlayerAgent | null, setPiece = false) {
    const b = this.ball, t = a.team;
    b.owner = null;
    const dist0 = Math.hypot(tx - b.x, ty - b.y);
    const passEff = a.eff('passing') * 0.62 + a.eff('composure') * 0.16 + a.eff('touch') * 0.22;
    const press = this.pressureAt(a.x, a.y, t);
    const lofted = kind === 'long' || kind === 'cross' || kind === 'clear';
    let sigma = (1 - passEff) * 1.5 + press * 0.4 + dist0 * 0.022 * (1 - passEff * 0.55);
    if (lofted) sigma *= 1.35;
    tx += this.rng.gauss() * sigma; ty += this.rng.gauss() * sigma;
    const speed = (lofted ? 19 : 13.5) + passEff * (lofted ? 7 : 10);
    const dist = Math.hypot(tx - b.x, ty - b.y);
    const dur = Math.max(2, Math.ceil(dist / (speed * this.dtp)));
    const dirv = this.dir[t];
    const offside = !setPiece && !!receiver && this.rules.isOffsideAtPass(receiver, b.x);
    if (receiver && (receiver.x - a.x) * dirv < -3 && !a.isGK) this.backPassTicks = this.ctick(2.5);
    b.flight = { kind, team: t, passer: a, receiver, fx: b.x, fy: b.y, toX: tx, toY: ty, s: 0, ds: 1 / dur, arc: lofted ? Math.min(8, dist * 0.12) : 0, speed, offside, setPiece, lofted };
    b.last = a; b.lastTeam = t; a.cool = 3;
    a.stats.passes++; this.stats[t].passes++;
    this.causes.touch(a, kind);
  }

  kickShot(a: PlayerAgent, kind: 'foot' | 'header' | 'penalty' | 'fk') {
    const b = this.ball, t = a.team, dirv = this.dir[t], gx = this.goalX(t), def = (1 - t) as TeamId;
    const keeper = this.keeperOf(def);
    const press = this.pressureAt(a.x, a.y, t);
    const dist = Math.hypot(gx - b.x, 34 - b.y);
    const fin = a.eff('finishing'), comp = a.eff('composure');
    const gkEff = keeper ? keeper.eff('goalkeeping') : 0.25;
    let xg: number;
    if (kind === 'penalty') xg = clamp(0.64 + (fin * 0.5 + comp * 0.5 - 0.6) * 0.5 - (gkEff - 0.6) * 0.3, 0.45, 0.92);
    else if (kind === 'fk') xg = clamp(this.xgAt(a, b.x, b.y, false, 0) * 0.55 + fin * 0.02, 0.01, 0.16);
    else xg = this.xgAt(a, b.x, b.y, kind === 'header', press);
    let nBl = 0, blocker: PlayerAgent | null = null;
    if (kind === 'foot' || kind === 'header') {
      for (const o of this.pitch[def]) {
        if (o.isGK) continue;
        const along = ((o.x - b.x) * (gx - b.x) + (o.y - b.y) * (34 - b.y)) / (dist * dist + 1e-6);
        if (along < 0.08 || along > 0.95) continue;
        const cx = b.x + (gx - b.x) * along, cy = b.y + (34 - b.y) * along;
        if (Math.hypot(o.x - cx, o.y - cy) < 1.8) { nBl++; blocker = o; }
      }
    }
    const pBlock = kind === 'penalty' ? 0 : kind === 'fk' ? 0.15 : Math.min(0.45, nBl * 0.15 * (0.7 + (blocker ? blocker.eff('tackling') * 0.5 : 0)));
    // accuracy: real shots hit the target about a third of the time; elite finishers about half
    const pOn = kind === 'penalty' ? 0.93 : clamp(0.2 + 0.4 * fin + 0.08 * comp - 0.25 * press - Math.max(0, dist - 12) * 0.011 + (kind === 'header' ? -0.05 : 0), 0.12, 0.82);
    const pGoal = kind === 'penalty' ? xg / 0.93 : clamp(xg / ((1 - pBlock) * pOn) * (1 + (0.66 - gkEff) * 0.6), 0.01, 0.95);
    const u1 = this.rng.next(), u2 = this.rng.next(), u3 = this.rng.next();
    let outcome: ShotInfo['outcome'];
    if (u1 < pBlock) outcome = 'block';
    else if (u2 > pOn) outcome = u3 < 0.14 ? 'post' : 'wide';
    else outcome = u3 < pGoal ? 'goal' : 'save';
    // target point on / near the goal line
    let ty: number, tx = gx;
    const kx = keeper ? keeper.y : 34;
    switch (outcome) {
      case 'goal': ty = clamp(kx < 34 ? GY1 - 0.7 - this.rng.next() * 1.4 : GY0 + 0.7 + this.rng.next() * 1.4, GY0 + 0.4, GY1 - 0.4); break;
      case 'save': ty = clamp(kx + (this.rng.next() - 0.5) * 1.6, GY0 + 0.3, GY1 - 0.3); break;
      case 'post': ty = this.rng.chance(0.5) ? GY0 : GY1; break;
      case 'block': ty = blocker ? blocker.y : b.y; tx = blocker ? blocker.x : b.x + dirv * 4; break;
      default: ty = this.rng.chance(0.5) ? GY0 - 0.8 - this.rng.next() * 5 : GY1 + 0.8 + this.rng.next() * 5;
    }
    const speed = kind === 'header' ? 15 : kind === 'penalty' ? 24 : 22 + fin * 9;
    const d = Math.hypot(tx - b.x, ty - b.y);
    const dur = Math.max(2, Math.ceil(d / (speed * this.dtp)));
    b.owner = null;
    b.flight = { kind: 'shot', team: t, passer: a, receiver: null, fx: b.x, fy: b.y, toX: tx, toY: ty, s: 0, ds: 1 / dur, arc: kind === 'header' ? 1 : 0.8, speed, offside: false, setPiece: kind === 'penalty' || kind === 'fk', lofted: false, shot: { outcome, xg, header: kind === 'header', pen: kind === 'penalty', blocker } };
    b.last = a; b.lastTeam = t; a.cool = 4;
    a.stats.shots++; this.stats[t].shots++; this.stats[t].xg += xg;
    if (outcome === 'goal' || outcome === 'save') this.stats[t].onTarget++;
    if (keeper && (outcome === 'goal' || outcome === 'save')) { keeper.dive = 4; }
    this.causes.touch(a, 'shot');
    const label = kind === 'penalty' ? 'penalty' : kind === 'header' ? 'header' : kind === 'fk' ? 'free kick' : 'shot';
    this.emit('shot', t, a, `${this.nm(a)} ${label} (xG ${xg.toFixed(2)})`, [], 2 + Math.round(xg * 8), { xg, x: b.x, y: b.y });
  }

  private advanceFlight(f: Flight) {
    const b = this.ball;
    b.px = b.x; b.py = b.y;
    f.s += f.ds;
    const s = Math.min(1, f.s);
    b.x = f.fx + (f.toX - f.fx) * s; b.y = f.fy + (f.toY - f.fy) * s; b.z = f.arc * 4 * s * (1 - s);
    if (!f.shot) { if (this.checkIntercept(f)) return; }
    if (f.s >= 1) { b.flight = null; f.shot ? this.resolveShot(f) : this.arrive(f); }
  }

  private checkIntercept(f: Flight): boolean {
    const b = this.ball;
    const sx = b.x - b.px, sy = b.y - b.py, l2 = sx * sx + sy * sy + 1e-9;
    for (const o of this.pitch[(1 - f.team) as TeamId]) {
      const u = clamp(((o.x - b.px) * sx + (o.y - b.py) * sy) / l2, 0, 1);
      const d = Math.hypot(o.x - (b.px + sx * u), o.y - (b.py + sy * u));
      const reach = (o.isGK ? 2.0 : 0.7) + o.eff('tackling') * 0.8 + o.posEff() * 0.2;
      if (d < reach && b.z < (o.isGK ? 2.8 : 2.3) && o.cool === 0) {
        let p = 0.16 + 0.3 * o.eff('tackling') + 0.1 * o.posEff();
        if (f.lofted) p *= 0.6;
        if (this.rng.next() < p) { this.intercepted(f, o); return true; }
      }
    }
    return false;
  }
  private intercepted(f: Flight, o: PlayerAgent) {
    const b = this.ball;
    b.flight = null; b.last = o; b.lastTeam = o.team;
    o.stats.intercepts++; this.stats[o.team].intercepts++;
    const causes = this.causes.explainTurnover('intercept', f.passer, o, f);
    const dep = this.depthOf(f.passer.team, b.x);
    if (dep < 0.4 || this.rng.next() < 0.12) this.emit('turnover', o.team, o, `${this.nm(o)} intercepts ${this.nm(f.passer)}'s pass`, causes, dep < 0.3 ? 3 : 2);
    if (this.rng.next() < 0.55 + 0.4 * o.eff('touch')) this.give(o);
    else { b.owner = null; b.vx = this.rng.gauss() * 3; b.vy = this.rng.gauss() * 3; this.poorTouch = this.ctick(2); }
  }

  private arrive(f: Flight) {
    const b = this.ball;
    b.x = f.toX; b.y = f.toY; b.z = 0;
    if (b.x < 0 || b.x > L || b.y < 0 || b.y > W) { b.vx = 0; b.vy = 0; this.rules.outOfPlay(); return; }
    const R = f.lofted ? 4.2 : 3.2;
    const cands: { a: PlayerAgent; sc: number }[] = [];
    for (const t of [0, 1] as TeamId[]) {
      for (const a of this.pitch[t]) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > R || (a === f.passer && a.cool > 0)) continue;
        const sc = a.eff('touch') * 0.3 + a.eff('pace') * 0.2 + (f.lofted ? a.eff('aerial') * 0.35 : 0) + this.rng.next() * 0.3 - d * 0.1 + (a === f.receiver ? 0.12 : 0) + (a.team !== f.team ? a.posEff() * 0.08 : 0);
        cands.push({ a, sc });
      }
    }
    if (!cands.length) {
      const dx = f.toX - f.fx, dy = f.toY - f.fy, dl = Math.hypot(dx, dy) + 1e-6;
      b.owner = null; b.vx = (dx / dl) * f.speed * 0.3; b.vy = (dy / dl) * f.speed * 0.3;
      return;
    }
    cands.sort((p, q) => q.sc - p.sc);
    const w = cands[0].a;
    if (f.kind === 'cross') { this.arriveCross(f, w, cands.map((c) => c.a)); return; }
    if (w.team === f.team) {
      if (f.offside && f.receiver && w === f.receiver) { this.rules.callOffside(f, w); return; }
      const press = this.pressureAt(w.x, w.y, w.team);
      const p = clamp(0.55 + 0.4 * w.eff('touch') - 0.22 * press - (f.kind === 'long' ? 0.1 : 0), 0.2, 0.97);
      if (this.rng.next() < p) {
        if (w !== f.passer) { f.passer.stats.passesOk++; this.stats[f.team].passesOk++; }
        this.give(w);
      } else {
        b.last = w; b.lastTeam = w.team; b.owner = null; b.vx = this.rng.gauss() * 3.5; b.vy = this.rng.gauss() * 3.5; this.poorTouch = this.ctick(2.5);
        this.emit('turnover', w.team === 0 ? 1 : 0, w, `${this.nm(w)} miscontrols`, this.causes.explainTurnover('touch', w, w, f), 1);
      }
    } else {
      w.stats.intercepts++; this.stats[w.team].intercepts++;
      b.last = w; b.lastTeam = w.team;
      if (f.lofted && this.rng.next() < 0.55) {
        b.owner = null; b.vx = this.dir[w.team] * this.rng.range(6, 12); b.vy = this.rng.gauss() * 4;
      } else if (this.rng.next() < 0.5 + 0.4 * w.eff('touch')) this.give(w);
      else { b.owner = null; b.vx = this.rng.gauss() * 3; b.vy = this.rng.gauss() * 3; }
      if (this.depthOf(f.team, b.x) < 0.45 || this.rng.next() < 0.1) this.emit('turnover', w.team, w, `${this.nm(w)} wins the ball from ${this.nm(f.passer)}'s ${f.kind === 'long' ? 'long ball' : 'pass'}`, this.causes.explainTurnover('lost', f.passer, w, f), 2);
    }
  }

  private arriveCross(f: Flight, w: PlayerAgent, cands: PlayerAgent[]) {
    const b = this.ball, def = (1 - f.team) as TeamId;
    const keeper = this.keeperOf(def);
    if (keeper && Math.hypot(keeper.x - b.x, keeper.y - b.y) < 7 && this.rules.inOwnBox(keeper, b.x, b.y)) {
      const near = cands.filter((c) => c.team === f.team).length;
      const p = clamp(0.3 + 0.45 * keeper.eff('goalkeeping') + 0.12 * keeper.eff('aerial') - 0.1 * near, 0.15, 0.9);
      if (this.rng.next() < p) { this.give(keeper); this.emit('save', def, keeper, `${this.nm(keeper)} claims the cross`, [`Keeper reach ${Math.round(keeper.card.skills.goalkeeping)}% against ${near} attackers in the area.`], 3); return; }
    }
    if (w.team === f.team) {
      const d = Math.hypot(this.goalX(w.team) - w.x, 34 - w.y);
      if (d < 16 && !w.isGK) { this.kickShot(w, 'header'); return; }
      this.give(w); return;
    }
    // defender clears
    w.stats.intercepts++; this.stats[w.team].intercepts++;
    b.last = w; b.lastTeam = w.team; b.owner = null;
    b.vx = this.dir[w.team] * this.rng.range(6, 13); b.vy = (b.y > 34 ? 1 : -1) * this.rng.range(2, 11);
    this.emit('turnover', w.team, w, `${this.nm(w)} heads the cross clear`, this.causes.explainTurnover('lost', f.passer, w, f), 2);
  }

  private resolveShot(f: Flight) {
    const b = this.ball, s = f.shot!, a = f.passer, t = f.team, def = (1 - t) as TeamId;
    const keeper = this.keeperOf(def);
    b.x = f.toX; b.y = f.toY; b.z = 0;
    switch (s.outcome) {
      case 'goal': this.rules.goalScored(t, a, s); return;
      case 'save': {
        this.stats[def].saves++;
        const gkEff = keeper ? keeper.eff('goalkeeping') : 0.2;
        const causes = this.causes.explainSave(a, keeper, s.xg);
        if (keeper) { keeper.x = f.toX + (this.dir[t] === 1 ? -0.6 : 0.6); keeper.y = f.toY; }
        if (!keeper || this.rng.next() < clamp(0.5 + gkEff * 0.35, 0.35, 0.9)) {
          if (keeper) { this.give(keeper); this.emit('save', def, keeper, `${this.nm(keeper)} saves from ${this.nm(a)} (xG ${s.xg.toFixed(2)})`, causes, 3 + Math.round(s.xg * 8), { xg: s.xg }); }
        } else if (keeper) {
          this.emit('save', def, keeper, `${this.nm(keeper)} parries ${this.nm(a)}'s effort`, causes, 4 + Math.round(s.xg * 8), { xg: s.xg });
          if (this.rng.next() < 0.45) { b.last = keeper; b.lastTeam = def; this.rules.award('corner', t, b); }
          else { b.last = keeper; b.lastTeam = def; b.owner = null; b.vx = -this.dir[t] * this.rng.range(5, 10); b.vy = this.rng.gauss() * 5; }
        }
        return;
      }
      case 'post': {
        this.emit('miss', t, a, `${this.nm(a)} hits the post!`, this.causes.explainShot(a, s.xg, 'post'), 5 + Math.round(s.xg * 8), { xg: s.xg });
        b.owner = null; b.vx = -this.dir[t] * this.rng.range(5, 11); b.vy = this.rng.gauss() * 5;
        b.x -= this.dir[t] * 0.4; return;
      }
      case 'wide': {
        this.emit('miss', t, a, `${this.nm(a)} misses the target (xG ${s.xg.toFixed(2)})`, this.causes.explainShot(a, s.xg, 'miss'), 2 + Math.round(s.xg * 8), { xg: s.xg });
        b.x = this.dir[t] === 1 ? L + 0.3 : -0.3; b.owner = null; b.vx = 0; b.vy = 0;
        if (this.rng.next() < 0.12) { const d = this.pitch[def].find((o) => !o.isGK); if (d) { b.last = d; b.lastTeam = def; } } // took a deflection: corner
        this.rules.outOfPlay(); return;
      }
      case 'block': {
        const bl = s.blocker;
        if (bl) { bl.stats.intercepts++; b.last = bl; b.lastTeam = bl.team; }
        this.emit('chance', t, a, `${this.nm(a)}'s shot is blocked${bl ? ' by ' + this.nm(bl) : ''}`, this.causes.explainTurnover('block', a, bl ?? a, f), 2 + Math.round(s.xg * 6), { xg: s.xg });
        if (bl && this.rng.next() < 0.3) { b.x = this.dir[t] === 1 ? L + 0.3 : -0.3; b.owner = null; b.vx = 0; b.vy = 0; this.rules.award('corner', t, b); return; } // deflected behind
        b.owner = null; b.vx = this.rng.gauss() * 6; b.vy = this.rng.gauss() * 6;
        return;
      }
    }
  }

  private looseBall() {
    const b = this.ball;
    if (b.owner || b.flight || this.phase !== 'play') return;
    const sp = Math.hypot(b.vx, b.vy);
    let best: PlayerAgent | null = null, bs = -1;
    for (const t of [0, 1] as TeamId[]) {
      for (const a of this.pitch[t]) {
        if (a.cool > 0) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = a.isGK && this.rules.inOwnBox(a, b.x, b.y) ? 2.3 : 1.5;
        if (d > r) continue;
        const sc = a.eff('touch') * 0.4 + a.eff('pace') * 0.15 + this.rng.next() * 0.45 - d * 0.1;
        if (sc > bs) { bs = sc; best = a; }
      }
    }
    if (!best) return;
    const p = clamp(0.8 - sp * 0.025 + best.eff('touch') * 0.15, 0.25, 0.95);
    if (this.rng.next() < p) this.give(best);
    else { b.vx += this.rng.gauss() * 1.5; b.vy += this.rng.gauss() * 1.5; best.cool = 2; }
  }

  private duels() {
    const c = this.ball.owner;
    if (!c || this.phase !== 'play') return;
    // poor first touch under pressure
    const press = this.pressureAt(c.x, c.y, c.team);
    if (!c.isGK && press > 0.4 && this.rng.next() < (1 - c.eff('touch')) * 0.03 * press) {
      this.ball.owner = null; this.ball.vx = c.vx * 0.6 + this.rng.gauss() * 2; this.ball.vy = c.vy * 0.6 + this.rng.gauss() * 2; c.cool = 3; this.poorTouch = this.ctick(2);
      return;
    }
    if (c.isGK) return;
    for (const d of this.pitch[(1 - c.team) as TeamId]) {
      if (d.tackleCool > 0 || d.isGK) continue;
      const dist = Math.hypot(d.x - c.x, d.y - c.y);
      if (dist > 1.9) continue;
      const pi = this.pressIntensity(d.team);
      const pAtt = 0.07 + 0.14 * pi * (0.7 + 0.3 * d.role(this).press);
      if (this.rng.next() > pAtt) continue;
      d.tackleCool = 4;
      const sD = d.eff('tackling') * 0.6 + d.posEff() * 0.15 + d.eff('pace') * 0.1 + 0.15 * this.rng.next();
      const sC = c.eff('touch') * 0.35 + c.eff('composure') * 0.2 + c.eff('pace') * 0.25 + 0.2 * this.rng.next();
      const pWin = 1 / (1 + Math.exp(-5 * (sD - sC)));
      if (this.rng.next() < pWin) {
        d.stats.tackles++; this.stats[d.team].tackles++;
        const causes = this.causes.explainTurnover('tackle', c, d, null);
        const dep = this.depthOf(c.team, c.x);
        if (dep < 0.4 || this.rng.next() < 0.15) this.emit('turnover', d.team, d, `${this.nm(d)} tackles ${this.nm(c)}`, causes, dep < 0.3 ? 3 : 2);
        this.ball.last = d; this.ball.lastTeam = d.team;
        if (this.rng.next() < 0.6) this.give(d);
        else { this.ball.owner = null; this.ball.vx = this.rng.gauss() * 3; this.ball.vy = this.rng.gauss() * 3; c.cool = 3; }
      } else {
        const pFoul = 0.07 + 0.12 * (1 - d.eff('tackling')) + 0.1 * pi + 0.06 * (1 - d.en);
        if (this.rng.next() < pFoul) { this.rules.foul(d, c); } else { d.lag = 3; }
      }
      break;
    }
  }

  private checkOut() {
    const b = this.ball;
    if (this.phase !== 'play' || b.owner || b.flight) return;
    if (b.x < 0 || b.x > L || b.y < 0 || b.y > W) this.rules.outOfPlay();
  }

  // ------------------------------------------------------------- snapshot
  ctlView(t: TeamId): CtlView {
    const c = this.ctl[t], s = this.rules.subs[t];
    return {
      lag: c.lag, lock: c.lock,
      active: c.active.map((o) => ({ key: o.key, label: o.label, ticks: o.ticks, total: o.total })),
      cd: { ...c.cd }, subsUsed: s.used, windowsUsed: s.windows, pendingSubs: s.pending.map((p) => ({ out: p.out, in: p.inn })),
    };
  }
  snapshot(): Snapshot {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const p: PlayerSnap[] = [];
    for (const t of [0, 1] as TeamId[]) {
      for (let s = 0; s < 11; s++) {
        const a = this.onPitch[t][s];
        if (!a || a.sentOff) { p.push({ id: `-${t}${s}`, x: -20, y: -20, en: 0, f: F_ABSENT }); continue; }
        let f = 0;
        if (this.ball.owner === a) f |= F_BALL;
        if (Math.hypot(a.vx, a.vy) / a.fullSpeed() > 0.82) f |= F_SPRINT;
        if (a.yellow > 0) f |= F_YELLOW;
        if (a.pressing) f |= F_PRESS;
        if (a.ordered) f |= F_ORDER;
        p.push({ id: a.card.id, x: r2(a.x), y: r2(a.y), en: Math.round(a.en * 1000) / 1000, f });
      }
    }
    const clk = this.clockLabel();
    const rs = this.restart;
    const snap: Snapshot = {
      tick: this.tick, totalTicks: this.totalTicks, half: this.half, label: clk.label, minute: clk.minute, phase: this.phase,
      ball: { x: r2(this.ball.x), y: r2(this.ball.y), z: r2(this.ball.z), owner: this.ball.owner?.card.id ?? null },
      p, score: [this.score[0], this.score[1]],
      restart: rs ? { kind: rs.kind, team: rs.team, x: rs.x, y: rs.y } : null,
      stats: [{ ...this.stats[0] }, { ...this.stats[1] }], ctl: [this.ctlView(0), this.ctlView(1)], dir: [this.dir[0], this.dir[1]],
      added: Math.round(this.added / this.tpm),
    };
    if (this.fresh.length) snap.ev = this.fresh;
    return snap;
  }

  // ------------------------------------------------------------- lifecycle
  startSecondHalf() {
    this.half = 2; this.tickInHalf = 0; this.added = 0; this.addedAnnounced = false; this.stopAccum = 0;
    this.dir = [-1, 1];
    for (const t of [0, 1] as TeamId[]) {
      this.ctl[t].active = []; this.ctl[t].lag = 0; this.ctl[t].lock = 0;
      for (const a of this.pitch[t]) a.en = Math.min(1, a.en + 0.1);
    }
    this.phase = 'dead';
    const kt = (1 - this.kickoffTeam) as TeamId;
    this.possTeam = kt;
    this.ball.owner = null; this.ball.flight = null;
    this.refreshPitch();
    this.rules.setRestart('kickoff', kt, 52.5, 34, true);
    this.refreshSP();
    for (const t of [0, 1] as TeamId[]) this.computeAnchors(t);
    this.rules.teleportAll();
    this.emit('kickoff', -1, null, 'Second half kicks off', [], 2);
  }
  firstEvent() { this.emit('kickoff', -1, null, 'Kick-off', [], 2); }

  /** Final-state helper for the UI */
  resultSummary() { return { score: [...this.score], stats: this.stats, events: this.events }; }
}

export { SLOT_GROUP };
