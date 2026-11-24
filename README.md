# Tactical Eleven

Real-time tactical football draft + live managerial match simulation. Deterministic 2D spatial engine (no dice rolls), IFAB-based rules (offside, fouls, cards, penalties, all restarts, stoppage time, 5 subs / 3 windows + half-time).

**Play it:** https://tactical-eleven.vercel.app (vs CPU; online multiplayer needs the Socket.io server, see below). Every push to `main` redeploys automatically.

## Run

```bash
npm install
npm run dev          # Vite client on http://localhost:5173 + Socket.io server on :3001
```
- **Play vs CPU**: pick an archetype on the home screen — runs entirely in the browser (no server needed).
- **Multiplayer**: "Create private room" → share the `TAC-###` code; the second manager joins from another tab/device.
- Production: `npm run build && npm start` (Express serves `dist/` and Socket.io on `PORT`, default 3001).
- `npm run typecheck`, `npm run sim` (headless calibration across archetypes).

## Structure
```
shared/            code used by both server and browser
  types.ts, formations.ts (IP/OOP shapes, roles, strategies), players.ts (40-player pool), lineup.ts (auto XI + diagnostic), draft.ts
  engine/          spatial.ts (SpatialEvaluator), agent.ts (PlayerAgent), engine.ts (Match), rules.ts (RulesEngine),
                   causes.ts (TacticalCauseTracker), cpu.ts (CPUTactician)
  room.ts          GameRoom state machine: toss → draft → tactics → match → half-time → full-time
  protocol.ts      client/server messages
server/index.ts    Express + Socket.io rooms
src/               React UI, Canvas renderer (pitch.ts, 60 FPS interpolation of 10 Hz ticks), zustand store
```

## Known limitations
- Goalkeepers are capped at a yellow card (no GK red); no injuries.
- The High-Press archetype is currently stronger than the Low-Block archetype at equal squad quality.
- Football time is compressed, but physics run close to real speed at 1x: the 3/6/10 settings take about 8/13/17 real minutes at 1x (0.5x–4x speed control; Space pauses).
- Vs-CPU games are saved in the browser (localStorage) and resume on reload — the match is rebuilt by replaying its recorded inputs through the deterministic engine. **New game** in the header clears the save. PvP rooms rejoin the server room after a reload.
