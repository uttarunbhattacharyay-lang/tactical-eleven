import type { TeamId } from '../types';
import { ZONES, type Match, type Flight, type ShotInfo } from './engine';
import type { PlayerAgent } from './agent';

/** Builds the human-readable "why" behind goals, turnovers, chances and cards from spatial state, skills and stamina. */
export class TacticalCauseTracker {
  chain: { id: string; team: TeamId; action: string; tick: number }[] = [];
  constructor(private m: Match) {}

  possessionChanged() { this.chain = []; }
  touch(a: PlayerAgent, action: string) {
    if (this.chain.length && this.chain[this.chain.length - 1].team !== a.team) this.chain = [];
    this.chain.push({ id: a.card.id, team: a.team, action, tick: this.m.tick });
    if (this.chain.length > 14) this.chain.shift();
  }
  private pct(v: number) { return `${Math.round(v)}%`; }
  private nm(a: PlayerAgent) { return this.m.nm(a); }

  private buildUp(t: TeamId): string | null {
    const c = this.chain.filter((x) => x.team === t);
    if (c.length < 2) return null;
    const secs = ((c[c.length - 1].tick - c[0].tick) * this.m.dtp).toFixed(0);
    const names = [...new Set(c.map((x) => x.id))].slice(-4).map((id) => this.m.byId.get(id)!).map((a) => `#${a.card.number}`).join(' → ');
    const last = c[c.length - 2]?.action;
    return `Move through ${names} (${c.length - 1} touches, ~${secs}s of play); final ball was a ${last === 'cross' ? 'cross' : last === 'through' ? 'through ball' : last === 'long' ? 'long ball' : 'short pass'}.`;
  }
  private nearestFoe(a: PlayerAgent) {
    let best: PlayerAgent | null = null, bd = 99;
    for (const o of this.m.pitch[(1 - a.team) as TeamId]) {
      if (o.isGK) continue;
      const d = Math.hypot(o.x - a.x, o.y - a.y);
      if (d < bd) { bd = d; best = o; }
    }
    return { o: best, d: bd };
  }
  private lineNote(attacker: TeamId) {
    const m = this.m, def = (1 - attacker) as TeamId;
    const ds = m.pitch[def].filter((a) => !a.isGK).map((a) => m.depthOf(def, a.x)).sort((a, b) => a - b);
    const line = ds[0] ?? 0.3;
    const height = m.tactics[def].lineHeight;
    return `${m.teamName(def)} back line sat at ~${Math.round(line * 100)}% of the pitch (line height ${height}${m.tactics[def].strategy === 'gegenpress' ? ', gegenpress' : ''}).`;
  }
  private overloadNote(t: TeamId): string | null {
    const o = this.m.ctl[t].active.find((x) => x.kind === 'overload');
    return o ? `${o.label} was active: 3 players committed, so numbers were favourable there.` : null;
  }
  private fatigueNote(def: TeamId): string | null {
    const m = this.m;
    const tired = m.pitch[def].filter((a) => !a.isGK && a.en < 0.4);
    if (tired.length >= 2) return `${m.teamName(def)} had ${tired.length} outfielders under 40% stamina (e.g. ${this.nm(tired[0])} at ${this.pct(tired[0].en * 100)}).`;
    return null;
  }

  explainShot(a: PlayerAgent, xg: number, kind: string): string[] {
    const m = this.m, out: string[] = [];
    const b = this.buildUp(a.team); if (b) out.push(b);
    const { o, d } = this.nearestFoe(a);
    const space = m.spatial.at(a.team, a.x, a.y);
    out.push(`Space control at the shooting zone: ${this.pct(space * 100)} for ${m.teamName(a.team)}.`);
    if (o) out.push(`Nearest defender ${this.nm(o)} was ${d.toFixed(1)} m away (pace ${o.card.skills.pace}%, stamina ${this.pct(o.en * 100)}).`);
    if (kind === 'miss' || kind === 'post') out.push(`${a.card.name}'s finishing ${a.card.skills.finishing}% and composure ${a.card.skills.composure}% vs pressure ${m.pressureAt(a.x, a.y, a.team).toFixed(2)} → xG ${xg.toFixed(2)}.`);
    return out.slice(0, 4);
  }
  explainGoal(a: PlayerAgent, xg: number, s: ShotInfo | null): string[] {
    const m = this.m, out: string[] = [];
    const b = this.buildUp(a.team); if (b) out.push(b);
    const { o, d } = this.nearestFoe(a);
    out.push(`${this.lineNote(a.team)}`);
    if (o) out.push(`Nearest defender ${this.nm(o)} was ${d.toFixed(1)} m away with pace ${o.card.skills.pace}% and stamina ${this.pct(o.en * 100)} — ${o.en < 0.45 ? 'fatigue cost him a yard' : 'no real chance to close'}.`);
    const ov = this.overloadNote(a.team); if (ov) out.push(ov);
    const fat = this.fatigueNote((1 - a.team) as TeamId); if (fat) out.push(fat);
    const gk = m.keeperOf((1 - a.team) as TeamId);
    out.push(`Chance quality xG ${xg.toFixed(2)}${s?.header ? ' (header)' : ''}; ${a.card.name}'s finishing ${a.card.skills.finishing}%${gk ? ` vs ${gk.card.name}'s reflexes ${gk.card.skills.goalkeeping}%` : ''}.`);
    return out.slice(0, 5);
  }
  explainSave(a: PlayerAgent, gk: PlayerAgent | null, xg: number): string[] {
    const out: string[] = [];
    const b = this.buildUp(a.team); if (b) out.push(b);
    if (gk) out.push(`${this.nm(gk)}: reflexes ${gk.card.skills.goalkeeping}%, positioning ${gk.card.skills.positioning}% — beat a ${xg.toFixed(2)} xG chance.`);
    const ov = this.overloadNote(a.team); if (ov) out.push(ov);
    return out;
  }
  explainTurnover(kind: 'intercept' | 'tackle' | 'lost' | 'touch' | 'block', loser: PlayerAgent, winner: PlayerAgent, f: Flight | null): string[] {
    const m = this.m, out: string[] = [];
    const press = m.pressureAt(loser.x, loser.y, loser.team);
    switch (kind) {
      case 'intercept':
        out.push(`Lane was cut: ${this.nm(winner)} (interception ${winner.card.skills.tackling}%, positioning ${winner.card.skills.positioning}%) read it.`);
        out.push(`${this.nm(loser)} passed under pressure ${press.toFixed(2)} with passing ${loser.card.skills.passing}% / composure ${loser.card.skills.composure}%.`);
        break;
      case 'tackle':
        out.push(`Duel: tackling ${winner.card.skills.tackling}% (stamina ${this.pct(winner.en * 100)}) beat touch ${loser.card.skills.touch}% / composure ${loser.card.skills.composure}%.`);
        if (m.pressers[winner.team].has(winner)) out.push(`${m.teamName(winner.team)} pressing trap (intensity ${Math.round(m.pressIntensity(winner.team) * 100)}%) forced the contact.`);
        break;
      case 'lost':
        out.push(`${this.nm(winner)} won the aerial/ground contest — aerial ${winner.card.skills.aerial}% vs receiver's ${f?.receiver ? f.receiver.card.skills.aerial + '%' : 'n/a'}.`);
        break;
      case 'touch':
        out.push(`First touch ${loser.card.skills.touch}% (stamina ${this.pct(loser.en * 100)}) under pressure ${press.toFixed(2)}.`);
        break;
      case 'block':
        out.push(`${this.nm(winner)} stood in the shooting lane — the shot was taken with defenders within 2 m of the line.`);
        break;
    }
    const st = m.ctl[winner.team].active.find((o) => o.kind === 'swarm');
    if (st) out.push('Press Carrier Swarm order was active.');
    return out.slice(0, 3);
  }
  explainFoul(fouler: PlayerAgent, victim: PlayerAgent, lastMan: boolean): string[] {
    const m = this.m, out: string[] = [];
    out.push(`${this.nm(fouler)} was beaten (tackling ${fouler.card.skills.tackling}%, stamina ${this.pct(fouler.en * 100)}) by ${this.nm(victim)} (pace ${victim.card.skills.pace}%).`);
    const pi = m.pressIntensity(fouler.team);
    if (pi > 0.65) out.push(`High pressing intensity (${Math.round(pi * 100)}%) increases the foul risk.`);
    if (lastMan) out.push('Last-man challenge: denied a clear route to goal.');
    return out;
  }
}
export { ZONES };
