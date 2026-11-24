import { Rng } from './rng';
import type { Lineup, PlayerCard, PosGroup, Snapshot, TeamId, TeamTactics } from './types';
import { generatePool, assignNumbers } from './players';
import { autoLineup, defaultTactics, validateLineup } from './lineup';
import { Match, PS } from './engine/engine';
import { canDraft } from './draft';
import { CPUTactician, cpuDraftPick, cpuSetup, type CPUProfile } from './engine/cpu';
import { SPEEDS, type ClientMsg, type RoomPhase, type RoomView, type ServerMsg } from './protocol';

export type Emit = (seat: TeamId | 'all', msg: ServerMsg) => void;

/**
 * How fast football physics run relative to real time at 1x. Each tick simulates 0.1s x PS seconds of
 * football; stretching the real tick interval keeps ball and player movement close to real speed.
 */
const PHYSICS_VS_REAL = 1.15;
export const tickMsFor = (duration: 3 | 6 | 10) => Math.round((100 * PS[duration]) / PHYSICS_VS_REAL);

/** Match input log for deterministic replay: a number = that many ticks, [seat, msg] = an applied command, 'R' = second half resumed. */
type LogEntry = number | [TeamId, ClientMsg] | 'R';

export interface SaveData {
  v: 1;
  code: string; mode: 'cpu' | 'pvp'; cpuProfile?: CPUProfile; seed: number; rng: number;
  phase: RoomPhase; names: [string, string]; duration: 3 | 6 | 10;
  toss: GameRoom['toss']; firstPick: TeamId | null; kickoffTeam: TeamId | null;
  pool: PlayerCard[]; picks: [string[], string[]]; turn: TeamId;
  lineups: [Lineup | null, Lineup | null]; tactics: [TeamTactics | null, TeamTactics | null];
  tacticsReady: [boolean, boolean]; htReady: [boolean, boolean]; speed: number;
  result: RoomView['result']; matchStarted: boolean; log: LogEntry[];
}

/**
 * Authoritative room: lobby -> toss -> draft -> tactics -> match -> halftime -> fulltime.
 * Runs identically on the Node server (PvP) and in the browser (Play vs CPU, seat 1 is the AI).
 */
export class GameRoom {
  phase: RoomPhase = 'lobby';
  names: [string, string] = ['Manager 1', 'Manager 2'];
  connected: [boolean, boolean] = [true, false];
  ready: [boolean, boolean] = [false, false];
  duration: 3 | 6 | 10 = 6;
  seed: number;
  toss: NonNullable<RoomView['toss']> | null = null;
  firstPick: TeamId | null = null;
  kickoffTeam: TeamId | null = null;
  pool: PlayerCard[] = [];
  picks: [string[], string[]] = [[], []];
  turn: TeamId = 0;
  lineups: [Lineup | null, Lineup | null] = [null, null];
  tactics: [TeamTactics | null, TeamTactics | null] = [null, null];
  tacticsReady: [boolean, boolean] = [false, false];
  htReady: [boolean, boolean] = [false, false];
  speed = 1;
  match: Match | null = null;
  cpu: CPUTactician | null = null;
  result: RoomView['result'] = null;
  /** Called after state worth persisting changes (CPU mode). */
  onChange?: () => void;
  private log: LogEntry[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private loop: ReturnType<typeof setTimeout> | null = null;
  private rng: Rng;
  disposed = false;

  constructor(public code: string, public mode: 'cpu' | 'pvp', private emit: Emit, public cpuProfile?: CPUProfile, seed?: number) {
    this.seed = seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = new Rng(this.seed);
    if (mode === 'cpu') {
      this.connected = [true, true];
      this.ready[1] = true;
      this.names[1] = cpuProfile ? ({ press: 'CPU · Press', counter: 'CPU · Counter', block: 'CPU · Block' } as const)[cpuProfile.archetype] : 'CPU';
    }
  }

  dispose() {
    this.disposed = true;
    this.timers.forEach(clearTimeout); this.timers = [];
    if (this.loop) clearTimeout(this.loop);
    this.loop = null;
  }
  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => { if (!this.disposed) fn(); }, ms);
    this.timers.push(t);
  }
  private isCPU(seat: TeamId) { return this.mode === 'cpu' && seat === 1; }
  private changed() { this.onChange?.(); }
  tickMs() { return tickMsFor(this.duration); }

  // ------------------------------------------------------------ views
  view(seat: TeamId): RoomView {
    const ps = this.pool;
    const squads = this.phase === 'lobby' || this.phase === 'toss' || this.phase === 'draft' ? null
      : [this.squad(0), this.squad(1)] as [PlayerCard[], PlayerCard[]];
    const o = (1 - seat) as TeamId;
    const showOpp = this.mode === 'cpu' ? this.phase !== 'lobby' && this.phase !== 'toss' && this.phase !== 'draft' : !!this.match;
    return {
      code: this.code, seat, mode: this.mode, phase: this.phase, names: this.names, connected: this.connected, ready: this.ready, duration: this.duration,
      cpu: this.cpuProfile, toss: this.toss, firstPick: this.firstPick, kickoffTeam: this.kickoffTeam,
      draft: this.phase === 'draft' || this.phase === 'tactics' ? { pool: ps, picks: this.picks, turn: this.turn, pickNo: this.picks[0].length + this.picks[1].length } : null,
      squads, lineup: this.liveLineup(seat), tactics: this.match ? this.match.tactics[seat] : this.tactics[seat],
      opp: showOpp && this.liveLineup(o) && this.tactics[o] ? { lineup: this.liveLineup(o)!, tactics: this.match ? this.match.tactics[o] : this.tactics[o]! } : null,
      tacticsReady: this.tacticsReady, htReady: this.htReady, speed: this.speed, tickMs: this.tickMs(),
      score: this.match ? [this.match.score[0], this.match.score[1]] : [0, 0], result: this.result,
    };
  }
  /** Current XI (live during a match) + bench. */
  private liveLineup(t: TeamId): Lineup | null {
    const lu = this.lineups[t];
    if (!lu || !this.match) return lu;
    const starters = this.match.onPitch[t].map((a) => a?.card.id ?? '');
    const on = new Set(starters);
    return { starters, bench: this.squad(t).map((p) => p.id).filter((id) => !on.has(id)) };
  }
  private squad(t: TeamId): PlayerCard[] {
    const byId = new Map(this.pool.map((p) => [p.id, p]));
    return this.picks[t].map((id) => byId.get(id)!).filter(Boolean);
  }
  private push() {
    this.emit(0, { t: 'view', view: this.view(0) });
    if (this.mode === 'pvp' && this.connected[1]) this.emit(1, { t: 'view', view: this.view(1) });
    this.changed();
  }
  private notice(seat: TeamId, message: string) { this.emit(seat, { t: 'error', message }); }

  // ------------------------------------------------------------ connection
  setConnected(seat: TeamId, v: boolean) {
    this.connected[seat] = v;
    if (v) this.emit(seat, { t: 'view', view: this.view(seat) });
    this.push();
    // there is no draft clock: only a manager who has left (and not come back within the grace period) is auto-picked for
    if (!v && this.phase === 'draft' && this.turn === seat) this.graceAutoPick(seat);
  }

  // ------------------------------------------------------------ message handling
  handle(seat: TeamId, msg: ClientMsg) {
    switch (msg.t) {
      case 'name': this.names[seat] = msg.name.slice(0, 18) || this.names[seat]; this.push(); break;
      case 'config':
        if (this.phase !== 'lobby') return;
        if (seat !== 0) return this.notice(seat, 'Only the host sets the duration');
        this.duration = msg.duration; this.ready = [false, this.isCPU(1)]; this.push(); break;
      case 'ready':
        if (this.phase !== 'lobby') return;
        this.ready[seat] = msg.value;
        if (this.mode === 'cpu') this.ready[1] = true;
        this.push();
        if (this.ready[0] && this.ready[1] && this.connected[0] && this.connected[1]) this.startToss();
        break;
      case 'tossCall': this.tossCall(seat, msg.call); break;
      case 'tossChoice': this.tossChoice(seat, msg.choice); break;
      case 'draftPick': this.draftPick(seat, msg.playerId); break;
      case 'setPlan': this.setPlan(seat, msg.lineup, msg.tactics); break;
      case 'tacticsReady':
        if (this.phase !== 'tactics') return;
        if (msg.value && (!this.lineups[seat] || !this.tactics[seat])) return this.notice(seat, 'Set your lineup first');
        this.tacticsReady[seat] = msg.value; this.push();
        if (this.tacticsReady[0] && this.tacticsReady[1]) this.startMatch();
        break;
      case 'speed': {
        if (this.phase !== 'match') return;
        this.speed = msg.value === 0 || (SPEEDS as readonly number[]).includes(msg.value) ? msg.value : 1;
        if (this.speed === 0) { if (this.loop) clearTimeout(this.loop); this.loop = null; }
        else if (!this.loop) this.scheduleTick();
        this.push();
        break;
      }
      case 'order': case 'sub': case 'cancelSub': case 'swap':
        if (!this.match || (this.phase !== 'match' && this.phase !== 'halftime')) return;
        this.record([seat, msg]);
        this.applyMatchMsg(seat, msg);
        this.changed();
        break;
      case 'htReady':
        if (this.phase !== 'halftime') return;
        this.htReady[seat] = msg.value; this.push();
        if (this.htReady[0] && this.htReady[1]) this.resumeSecondHalf();
        break;
    }
  }
  /** In-match commands. Also used verbatim when replaying a saved match. */
  private applyMatchMsg(seat: TeamId, msg: ClientMsg) {
    const m = this.match!;
    switch (msg.t) {
      case 'order': {
        if (this.phase !== 'match' && this.phase !== 'halftime') return;
        const r = m.applyOrder(seat, msg.order);
        this.emit(seat, { t: 'result', what: 'order', ok: r.ok, reason: r.reason });
        if (msg.order.kind === 'tactics' && r.ok) { this.emit(seat, { t: 'view', view: this.view(seat) }); this.emit('all', { t: 'snap', snap: m.snapshot() }); }
        break;
      }
      case 'sub': {
        const r = m.requestSub(seat, msg.outId, msg.inId);
        this.emit(seat, { t: 'result', what: 'sub', ok: r.ok, reason: r.reason });
        if (this.phase === 'halftime') this.push();
        break;
      }
      case 'cancelSub': m.rules.cancelSub(seat, msg.outId); break;
      case 'swap':
        if (m.rules.swapSlots(seat, msg.a, msg.b)) { this.emit(seat, { t: 'view', view: this.view(seat) }); this.emit('all', { t: 'snap', snap: m.snapshot() }); }
        break;
    }
  }
  private record(e: LogEntry) {
    if (this.mode !== 'cpu') return; // only local CPU matches are saved in the browser
    const last = this.log[this.log.length - 1];
    if (typeof e === 'number' && typeof last === 'number') this.log[this.log.length - 1] = last + e;
    else this.log.push(e);
  }

  // ------------------------------------------------------------ toss
  private startToss() {
    this.phase = 'toss';
    this.toss = { caller: this.rng.chance(0.5) ? 0 : 1, call: null, result: null, winner: null, choice: null };
    this.push();
    this.kick();
  }
  private tossCall(seat: TeamId, call: 'heads' | 'tails') {
    const t = this.toss;
    if (this.phase !== 'toss' || !t || t.call || seat !== t.caller) return;
    t.call = call; t.result = this.rng.chance(0.5) ? 'heads' : 'tails';
    t.winner = t.result === call ? t.caller : ((1 - t.caller) as TeamId);
    this.push();
    if (this.isCPU(t.winner)) this.later(3200, () => this.tossChoice(t.winner!, this.rng.chance(0.65) ? 'firstPick' : 'kickoff'));
  }
  private tossChoice(seat: TeamId, choice: 'firstPick' | 'kickoff') {
    const t = this.toss;
    if (this.phase !== 'toss' || !t || t.winner !== seat || t.choice || !t.result) return;
    t.choice = choice;
    if (choice === 'firstPick') { this.firstPick = seat; this.kickoffTeam = (1 - seat) as TeamId; }
    else { this.kickoffTeam = seat; this.firstPick = (1 - seat) as TeamId; }
    this.push();
    this.later(2200, () => this.startDraft());
  }
  /** (Re)schedule whatever the CPU or the room is waiting to do in the current phase — used at start and after a restore. */
  private kick() {
    if (this.phase === 'toss' && this.toss) {
      const t = this.toss;
      if (!t.call) { if (this.isCPU(t.caller)) this.later(1400, () => this.tossCall(t.caller, this.rng.chance(0.5) ? 'heads' : 'tails')); }
      else if (t.winner !== null && !t.choice) { if (this.isCPU(t.winner)) this.later(2000, () => this.tossChoice(t.winner!, this.rng.chance(0.65) ? 'firstPick' : 'kickoff')); }
      else if (t.choice) this.later(1200, () => { if (this.phase === 'toss') this.startDraft(); });
    } else if (this.phase === 'draft') {
      if (this.isCPU(this.turn)) this.later(900 + this.rng.int(0, 1400), () => this.cpuPick());
      else if (!this.connected[this.turn]) this.graceAutoPick(this.turn);
    } else if (this.phase === 'match' && this.speed > 0) this.scheduleTick();
  }

  // ------------------------------------------------------------ draft (no time limit)
  private startDraft() {
    this.phase = 'draft';
    this.pool = generatePool(this.seed);
    this.picks = [[], []]; this.turn = this.firstPick ?? 0;
    this.beginTurn();
  }
  private beginTurn() {
    this.push();
    this.kick();
  }
  private graceAutoPick(seat: TeamId) {
    const pickNo = this.picks[0].length + this.picks[1].length;
    this.later(30000, () => {
      if (!this.connected[seat] && this.phase === 'draft' && this.turn === seat && this.picks[0].length + this.picks[1].length === pickNo) this.autoPick();
    });
  }
  canPick(team: TeamId, p: PlayerCard): boolean {
    return canDraft(this.squad(team), new Set([...this.picks[0], ...this.picks[1]]), p);
  }
  private cpuPick() {
    if (this.phase !== 'draft' || !this.isCPU(this.turn)) return;
    const prof = this.cpuProfile ?? { archetype: 'counter', difficulty: 'normal' } as CPUProfile;
    const p = cpuDraftPick(this.rng, this.pool, this.squad(this.turn), prof, (q) => this.canPick(this.turn, q));
    this.draftPick(this.turn, p.id);
  }
  private autoPick() {
    if (this.phase !== 'draft') return;
    const avail = this.pool.filter((p) => this.canPick(this.turn, p));
    const need: Record<PosGroup, number> = { GK: 2, DEF: 7, MID: 7, ATT: 4 };
    const have: Record<PosGroup, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
    for (const q of this.squad(this.turn)) have[q.group]++;
    avail.sort((a, b) => (b.ovr + (need[b.group] > have[b.group] ? 4 : 0)) - (a.ovr + (need[a.group] > have[a.group] ? 4 : 0)));
    if (avail[0]) this.draftPick(this.turn, avail[0].id);
  }
  private draftPick(seat: TeamId, id: string) {
    if (this.phase !== 'draft' || seat !== this.turn) return;
    const p = this.pool.find((q) => q.id === id);
    if (!p) return;
    if (!this.canPick(seat, p)) return this.notice(seat, 'That pick would leave a squad unable to field a legal XI (or is taken)');
    this.picks[seat].push(id);
    if (this.picks[0].length === 20 && this.picks[1].length === 20) { this.finishDraft(); return; }
    this.turn = (1 - seat) as TeamId;
    this.beginTurn();
  }
  private finishDraft() {
    for (const t of [0, 1] as TeamId[]) assignNumbers(this.squad(t));
    this.phase = 'tactics';
    for (const t of [0, 1] as TeamId[]) {
      this.tactics[t] = defaultTactics();
      this.lineups[t] = autoLineup(this.squad(t), this.tactics[t]!);
    }
    if (this.mode === 'cpu') {
      const s = cpuSetup(this.squad(1), this.cpuProfile!);
      this.lineups[1] = s.lineup; this.tactics[1] = s.tactics; this.tacticsReady[1] = true;
    }
    this.push();
  }

  // ------------------------------------------------------------ tactics
  private setPlan(seat: TeamId, lineup: Lineup, tactics: TeamTactics) {
    if (this.phase !== 'tactics') return;
    const err = validateLineup(this.squad(seat), lineup);
    if (err) return this.notice(seat, err);
    this.lineups[seat] = lineup; this.tactics[seat] = tactics;
    if (this.tacticsReady[seat]) this.tacticsReady[seat] = false;
    this.emit(seat, { t: 'view', view: this.view(seat) });
    this.changed();
  }

  // ------------------------------------------------------------ match
  private buildMatch() {
    this.match = new Match({
      seed: this.seed ^ 0xabcdef, duration: this.duration,
      squads: [this.squad(0), this.squad(1)],
      lineups: [this.lineups[0]!, this.lineups[1]!], tactics: [this.tactics[0]!, this.tactics[1]!], kickoffTeam: this.kickoffTeam ?? 0,
    });
    this.cpu = this.mode === 'cpu' ? new CPUTactician(1, this.cpuProfile!, this.seed) : null;
  }
  private startMatch() {
    this.buildMatch();
    this.log = [];
    this.phase = 'match'; this.speed = 1;
    this.push();
    this.emit('all', { t: 'snap', snap: this.match!.snapshot() });
    this.scheduleTick();
  }
  private scheduleTick() {
    if (this.loop) clearTimeout(this.loop);
    this.loop = null;
    if (this.phase !== 'match' || this.speed <= 0 || this.disposed) return;
    this.loop = setTimeout(() => this.runTick(), this.tickMs() / this.speed);
  }
  private runTick() {
    this.loop = null;
    const m = this.match;
    if (!m || this.phase !== 'match' || this.disposed || this.speed <= 0) return;
    const t0 = Date.now();
    this.cpu?.update(m);
    m.step();
    this.record(1);
    this.emit('all', { t: 'snap', snap: m.snapshot() });
    if (m.phase === 'halftime') { this.enterHalftime(); return; }
    if (m.phase === 'fulltime') { this.enterFulltime(); return; }
    if (m.tick % 20 === 0) this.changed();
    // paused while this tick ran: stay paused (a 0 speed must never schedule a tick)
    if (this.speed <= 0) return;
    this.loop = setTimeout(() => this.runTick(), Math.max(0, this.tickMs() / this.speed - (Date.now() - t0)));
  }
  private enterHalftime() {
    this.phase = 'halftime'; this.htReady = [false, this.isCPU(1)];
    if (this.cpu && this.match) this.cpu.halftime(this.match);
    this.push();
    this.emit('all', { t: 'snap', snap: this.match!.snapshot() });
  }
  private resumeSecondHalf() {
    if (!this.match) return;
    this.match.startSecondHalf();
    this.record('R');
    this.phase = 'match'; this.htReady = [false, false];
    if (this.speed <= 0) this.speed = 1;
    this.push();
    this.emit('all', { t: 'snap', snap: this.match.snapshot() });
    this.scheduleTick();
  }
  private enterFulltime() {
    const m = this.match!;
    this.phase = 'fulltime';
    this.result = { score: [m.score[0], m.score[1]], stats: [m.stats[0], m.stats[1]], events: m.events };
    this.push();
  }

  // ------------------------------------------------------------ save / restore
  serialize(): SaveData {
    return {
      v: 1, code: this.code, mode: this.mode, cpuProfile: this.cpuProfile, seed: this.seed, rng: this.rng.state,
      phase: this.phase, names: this.names, duration: this.duration, toss: this.toss, firstPick: this.firstPick, kickoffTeam: this.kickoffTeam,
      pool: this.pool, picks: this.picks, turn: this.turn, lineups: this.lineups, tactics: this.tactics,
      tacticsReady: this.tacticsReady, htReady: this.htReady, speed: this.speed, result: this.result,
      matchStarted: !!this.match, log: this.log,
    };
  }
  /**
   * Rebuild a room from a save. The match itself is reconstructed by replaying the recorded inputs
   * through the deterministic engine, so it resumes at exactly the same tick, positions and score.
   * `frameSink` receives every replayed snapshot (for the post-match replay scrubber).
   */
  static restore(d: SaveData, emit: Emit, frameSink?: (s: Snapshot) => void): GameRoom {
    if (d.v !== 1) throw new Error('Unsupported save version');
    const r = new GameRoom(d.code, d.mode, () => {}, d.cpuProfile, d.seed);
    Object.assign(r, {
      phase: d.phase, names: d.names, duration: d.duration, toss: d.toss, firstPick: d.firstPick, kickoffTeam: d.kickoffTeam,
      pool: d.pool, picks: d.picks, turn: d.turn, lineups: d.lineups, tactics: d.tactics,
      tacticsReady: d.tacticsReady, htReady: d.htReady, result: d.result,
    });
    r.ready = [true, true];
    r.rng.state = d.rng;
    if (d.matchStarted) {
      const phase = d.phase;
      r.buildMatch();
      r.phase = 'match';
      const m = r.match!;
      let htDone = false;
      for (const e of d.log) {
        if (typeof e === 'number') {
          for (let i = 0; i < e; i++) {
            r.cpu?.update(m); m.step();
            frameSink?.(m.snapshot());
            if (m.phase === 'halftime' && !htDone) { htDone = true; r.phase = 'halftime'; r.cpu?.halftime(m); }
          }
        } else if (e === 'R') { m.startSecondHalf(); r.phase = 'match'; }
        else r.applyMatchMsg(e[0], e[1]);
      }
      r.log = d.log;
      r.phase = phase;
    }
    r.speed = r.phase === 'match' ? 0 : d.speed; // resume paused, exactly where it was
    r.emit = emit;
    return r;
  }
  /** Send the restored state to the client and restart any pending timers. */
  resume() {
    this.push();
    if (this.match) this.emit('all', { t: 'snap', snap: { ...this.match.snapshot(), ev: this.match.events } });
    this.kick();
  }
}
