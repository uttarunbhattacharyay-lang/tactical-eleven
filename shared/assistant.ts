import type { ClientMsg } from './protocol';
import type { MatchEvent, PlayerCard, Snapshot, TeamId, TeamTactics, ZoneId } from './types';
import { F_ABSENT, F_YELLOW } from './types';
import { STRATS, fitAt, shapePts, zoneOf } from './formations';

/** A piece of advice from the assistant manager, optionally with a one-click action. */
export interface Tip {
  id: string; // stable per situation (used for dismissing)
  priority: number; // 0..10, higher first
  tone: 'warn' | 'idea' | 'good' | 'info';
  title: string;
  text: string;
  action?: { label: string; msg?: ClientMsg; tab?: 'cmd' | 'squad' | 'tac' | 'opp' };
}

export interface TipContext {
  snap: Snapshot;
  me: TeamId;
  myTac: TeamTactics | null;
  oppTac: TeamTactics | null;
  roster: Map<string, PlayerCard>;
  events: MatchEvent[];
  halftime?: boolean;
}

/** Surname as it is used in football: 'Virgil van Dijk' -> 'van Dijk'. */
const last = (n: string) => { const w = n.split(' '); let i = w.length - 1; while (i > 1 && /^(van|von|de|der|da|di|dos|du|la|le)$/i.test(w[i - 1])) i--; return w.slice(i).join(' '); };
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Rule-based reading of the match from the user's point of view. Returns tips sorted by priority. */
export function assistantTips(c: TipContext): Tip[] {
  const { snap, me, myTac, oppTac, roster, events } = c;
  const o = (1 - me) as TeamId;
  const tips: Tip[] = [];
  const add = (t: Tip) => tips.push(t);
  const minute = snap.minute;
  const tpm = snap.totalTicks / 90;
  const recent = (mins: number) => events.filter((e) => snap.tick - e.tick <= mins * tpm);
  const [myGoals, oppGoals] = [snap.score[me], snap.score[o]];
  const diff = myGoals - oppGoals;
  const ms = snap.stats[me], os = snap.stats[o];
  const possTot = Math.max(1, ms.poss + os.poss);
  const myPoss = ms.poss / possTot;
  const passAcc = ms.passes ? ms.passesOk / ms.passes : 1;
  const side = (worldY: number) => ((worldY - 34) / (30 * snap.dir[me]) < 0 ? 'left' : 'right');
  const mine = snap.p.slice(me * 11, me * 11 + 11).map((p, slot) => ({ p, slot, card: roster.get(p.id) })).filter((x) => x.card && !(x.p.f & F_ABSENT));
  const theirs = snap.p.slice(o * 11, o * 11 + 11).map((p, slot) => ({ p, slot, card: roster.get(p.id) })).filter((x) => x.card && !(x.p.f & F_ABSENT));
  const ctl = snap.ctl[me];
  const subsLeft = 5 - ctl.subsUsed - ctl.pendingSubs.length;
  const myStrat = myTac?.strategy;

  // ---- red cards
  const myRed = recent(12).find((e) => e.type === 'red' && e.team === me);
  if (myRed) add({ id: `red-me-${myRed.id}`, priority: 9, tone: 'warn', title: "We're down to ten", text: 'With a man short, chasing the game will leave holes everywhere. Compact the shape and protect the middle, then pick moments to counter.', action: myStrat !== 'lowblock' ? { label: 'Switch to Low-Block Shield', msg: { t: 'order', order: { kind: 'strategy', strategy: 'lowblock' } } } : undefined });
  const oppRed = recent(12).find((e) => e.type === 'red' && e.team === o);
  if (oppRed) add({ id: `red-opp-${oppRed.id}`, priority: 8, tone: 'idea', title: "They're down to ten", text: 'They will struggle to cover the width now. Get the full-backs high and stretch them so the spare man always appears.', action: { label: 'Full-backs overlap (both)', msg: { t: 'order', order: { kind: 'unit', unit: 'fullbackOverlap', side: 'both' } } } });

  // ---- goal analysis
  const conceded = recent(4).filter((e) => e.type === 'goal' && e.team === o).pop();
  if (conceded) {
    // turn the engine's cause notes into a coach's explanation
    const txt = conceded.causes.join(' ');
    const near = /Nearest defender (.+?) was ([\d.]+) m away.*?stamina (\d+)%/.exec(txt);
    const parts: string[] = [];
    let tired = false;
    if (near) {
      const d = +near[2], st = +near[3];
      if (st < 45) { tired = true; parts.push(`${near[1]} was out on his feet (${st}% stamina) and couldn't close the shooter down — fresh legs would have stopped that.`); }
      else if (d > 3.5) parts.push(`Nobody got near the shooter — the closest man, ${near[1]}, was ${d.toFixed(1)} m away. We have to stay tighter around our box.`);
      else parts.push(`${near[1]} was close (${d.toFixed(1)} m) but couldn't block it.`);
    }
    if (conceded.xg !== undefined) parts.push(conceded.xg >= 0.3 ? `It was a clear-cut chance (xG ${conceded.xg.toFixed(2)}) — we let them get far too close to goal.` : `It was a low-quality chance (xG ${conceded.xg.toFixed(2)}), so a good finish more than a broken plan — don't overreact.`);
    add({ id: `conceded-${conceded.id}`, priority: 7, tone: 'warn', title: 'Why we conceded', text: parts.join(' ') || 'We were opened up too easily — tighten the distances between the lines.',
      action: tired && subsLeft > 0 ? { label: 'Make a substitution', tab: 'squad' } : { label: 'Review tactics', tab: 'tac' } });
  }
  const scored = recent(3).filter((e) => e.type === 'goal' && e.team === me).pop();
  if (scored && !conceded) add({ id: `scored-${scored.id}`, priority: 3, tone: 'good', title: 'Great goal, boss', text: 'That came straight from the plan. Keep the structure — teams are most vulnerable right after they score, so stay switched on for the next few minutes.' });

  // ---- stamina
  const tired = mine.filter((x) => x.slot > 0).sort((a, b) => a.p.en - b.p.en);
  const dead = tired.filter((x) => x.p.en < 0.32);
  if (dead.length) {
    const t = dead[0];
    add({ id: `tired-${t.p.id}`, priority: 8, tone: 'warn', title: `${last(t.card!.name)} is running on empty`, text: subsLeft > 0
      ? `#${t.card!.number} ${t.card!.name} is down to ${pct(t.p.en)} stamina${dead.length > 1 ? ` (and ${dead.length - 1} more are close)` : ''}. Exhausted players lose pace and make mistakes — bring on fresh legs.`
      : `${t.card!.name} is at ${pct(t.p.en)} and we have no subs left. Lower the pressing so the lads can save energy.`,
      action: subsLeft > 0 ? { label: 'Make a substitution', tab: 'squad' } : { label: 'Adjust pressing', tab: 'tac' } });
  } else if (minute >= 55 && tired[0] && tired[0].p.en < 0.45 && subsLeft > 0) {
    const t = tired[0];
    add({ id: `tiring-${t.p.id}`, priority: 5, tone: 'info', title: `${last(t.card!.name)} is tiring`, text: `${t.card!.name} is at ${pct(t.p.en)} stamina. Have someone warming up — a sub at the next stoppage keeps the intensity high.`, action: { label: 'Open substitutions', tab: 'squad' } });
  }

  // ---- bookings on defenders
  const booked = mine.find((x) => (x.p.f & F_YELLOW) && x.slot >= 1 && x.slot <= 4);
  if (booked && !snap.p.slice(me * 11, me * 11 + 11).some((p) => p.id === booked.p.id && (p.f & F_ABSENT))) {
    add({ id: `yellow-${booked.p.id}`, priority: 4, tone: 'warn', title: `${last(booked.card!.name)} is on a yellow`, text: `One more mistimed challenge and ${booked.card!.name} walks. Lower the pressing or take him off before he is targeted.`, action: subsLeft > 0 ? { label: 'Open substitutions', tab: 'squad' } : undefined });
  }

  // ---- chance quality
  if (minute >= 15 && os.xg - ms.xg > 0.8 && os.shots >= ms.shots + 3) {
    add({ id: 'xg-gap', priority: 7, tone: 'warn', title: "They're carving us open", text: `Their chances are much better than ours (xG ${os.xg.toFixed(2)} vs ${ms.xg.toFixed(2)}, shots ${os.shots}–${ms.shots}). Drop the line and get compact until we regain control.`, action: { label: 'Drop to low block', msg: { t: 'order', order: { kind: 'lowBlock' } } } });
  }

  // ---- game state late on
  if (!c.halftime && minute >= 70 && diff < 0 && myStrat !== 'gegenpress') {
    add({ id: 'chasing', priority: 8, tone: 'idea', title: 'Time to gamble', text: `We're ${myGoals}–${oppGoals} down with ${Math.max(1, 90 - minute)} minutes left. Push everyone up and win the ball high — a draw is worth the risk.`, action: { label: 'Switch to Gegenpress', msg: { t: 'order', order: { kind: 'strategy', strategy: 'gegenpress' } } } });
  }
  if (!c.halftime && minute >= 75 && diff > 0 && myStrat !== 'lowblock') {
    add({ id: 'protect', priority: 6, tone: 'idea', title: 'See the game out', text: `We're ahead with ${Math.max(1, 90 - minute)} minutes to go. Sit deeper, stay compact and make them break us down.`, action: { label: 'Switch to Low-Block Shield', msg: { t: 'order', order: { kind: 'strategy', strategy: 'lowblock' } } } });
  }

  if (oppTac) {
    // ---- beating their press
    const oppPress = oppTac.pressing + STRATS[oppTac.strategy].press;
    if (minute >= 8 && ms.passes >= 15 && passAcc < 0.6 && oppPress >= 62 && myTac?.buildUp !== 'direct') {
      add({ id: 'beat-press', priority: 6, tone: 'idea', title: 'Play over their press', text: `They're pressing hard and our pass accuracy is only ${pct(passAcc)}. Going long bypasses their first line and turns their aggression against them.`, action: { label: 'Switch build-up to Direct', msg: { t: 'order', order: { kind: 'tactics', patch: { buildUp: 'direct' } } } } });
    }
    // ---- space behind a high line
    const oppLine = oppTac.lineHeight + STRATS[oppTac.strategy].line;
    const quick = mine.filter((x) => x.card!.group === 'ATT' || x.slot >= 8).sort((a, b) => b.card!.skills.pace - a.card!.skills.pace)[0];
    if (oppLine >= 60 && quick && quick.card!.skills.pace >= 84 && myStrat !== 'vertical' && diff <= 0) {
      add({ id: 'behind-line', priority: 5, tone: 'idea', title: 'Space in behind', text: `Their back line is very high and ${quick.card!.name} has ${quick.card!.skills.pace} pace. Win it and release him early — they can't turn and chase.`, action: { label: 'Switch to Direct Vertical Counter', msg: { t: 'order', order: { kind: 'strategy', strategy: 'vertical' } } } });
    }
    // ---- breaking down a deep block
    if (minute >= 20 && myPoss > 0.58 && ms.xg < 0.6 && (oppTac.strategy === 'lowblock' || oppLine < 40)) {
      add({ id: 'deep-block', priority: 5, tone: 'idea', title: "They're parked deep", text: `We have ${pct(myPoss)} of the ball but little to show for it (xG ${ms.xg.toFixed(2)}). Overload a half-space to create a spare man between their lines.`, action: { label: 'Overload left half-space', msg: { t: 'order', order: { kind: 'overload', zone: 'leftHalfSpace' } } } });
    }
  }

  // ---- a tiring opponent to target
  const weakOpp = theirs.filter((x) => x.slot >= 1 && x.slot <= 4).sort((a, b) => a.p.en - b.p.en)[0];
  if (weakOpp && weakOpp.p.en < 0.45 && Math.abs(weakOpp.p.y - 34) > 12) {
    const s = side(weakOpp.p.y);
    const zone: ZoneId = s === 'left' ? 'leftFlank' : 'rightFlank';
    add({ id: `target-${weakOpp.p.id}`, priority: 5, tone: 'idea', title: 'Target their tired defender', text: `${weakOpp.card!.name} is down to ${pct(weakOpp.p.en)} stamina on our ${s}. Attack that flank and he won't be able to keep up.`, action: { label: `Overload ${s} flank`, msg: { t: 'order', order: { kind: 'overload', zone } } } });
  }

  // ---- possession battle
  if (minute >= 15 && myPoss < 0.36 && diff <= 0 && !tips.some((t) => t.id === 'beat-press')) {
    add({ id: 'no-ball', priority: 4, tone: 'info', title: "We can't keep the ball", text: `Only ${pct(myPoss)} possession. Either press higher to win it back sooner, or stay patient with short passing so we don't give it away cheaply.`, action: { label: 'Open tactics', tab: 'tac' } });
  }

  // ---- out of position
  if (myTac) {
    const ip = shapePts(myTac, 'ip');
    const oop = mine.filter((x) => x.slot > 0).map((x) => ({ ...x, fit: fitAt(x.card!.pos, ip[x.slot]), zone: zoneOf(ip[x.slot]) })).filter((x) => x.fit < 0.8).sort((a, b) => a.fit - b.fit)[0];
    if (oop) add({ id: `oop-${oop.p.id}-${oop.zone}`, priority: 3, tone: 'info', title: 'Player out of position', text: `${oop.card!.name} (${oop.card!.pos}) is playing ${oop.zone} at ${pct(oop.fit)} familiarity, so his positioning suffers. Move him closer to his natural role if it isn't deliberate.`, action: { label: 'Open tactics', tab: 'tac' } });
  }

  // ---- half-time general
  if (c.halftime) {
    add({ id: 'ht-summary', priority: 10, tone: 'info', title: 'Half-time notes', text: `${diff > 0 ? "We're in front" : diff < 0 ? "We're behind" : "It's level"} at ${myGoals}–${oppGoals}. We've had ${pct(myPoss)} of the ball and created xG ${ms.xg.toFixed(2)} to their ${os.xg.toFixed(2)}. Substitutions now don't use one of our three windows.` });
  }

  if (!tips.length) {
    add({ id: 'calm', priority: 0, tone: 'good', title: 'All under control', text: minute < 30 ? 'The shape is holding well. Watch how they build up — I will flag anything worth changing.' : 'Things are steady. Keep an eye on stamina after the hour mark and be ready to react to the score.' });
  }
  return tips.sort((a, b) => b.priority - a.priority);
}
