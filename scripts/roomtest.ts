import { GameRoom } from '../shared/room';
let snaps = 0, views = 0, phase = '', last: any;
const room = new GameRoom('CPU-1', 'cpu', (s, m) => {
  if (s === 1) return;
  if (m.t === 'snap') { snaps++; last = m.snap; }
  if (m.t === 'view') { views++; if (m.view.phase !== phase) { phase = m.view.phase; console.log('phase ->', phase); } }
  if (m.t === 'error') console.log('error', m.message);
}, { archetype: 'counter', difficulty: 'normal' }, 42);
room.handle(0, { t: 'config', duration: 3 });
room.handle(0, { t: 'ready', value: true });
const iv = setInterval(() => {
  const v = room.view(0);
  if (v.phase === 'toss' && v.toss && !v.toss.call && v.toss.caller === 0) room.handle(0, { t: 'tossCall', call: 'heads' });
  if (v.phase === 'toss' && v.toss?.winner === 0 && !v.toss.choice) room.handle(0, { t: 'tossChoice', choice: 'firstPick' });
  if (v.phase === 'draft' && v.draft && v.draft.turn === 0) {
    const p = room.pool.find((q) => room.canPick(0, q)); if (p) room.handle(0, { t: 'draftPick', playerId: p.id });
  }
  if (v.phase === 'tactics' && !v.tacticsReady[0]) room.handle(0, { t: 'tacticsReady', value: true });
  if (v.phase === 'match' && v.speed !== 4) room.handle(0, { t: 'speed', value: 4 });
  if (v.phase === 'halftime') { room.handle(0, { t: 'htReady', value: true }); }
  if (v.phase === 'fulltime') { console.log('FULLTIME', v.result!.score, 'events', v.result!.events.length, 'snaps', snaps); clearInterval(iv); room.dispose(); process.exit(0); }
}, 200);
setTimeout(() => { console.log('TIMEOUT phase', phase, 'snaps', snaps, last?.label); process.exit(1); }, 170000);
