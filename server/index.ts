import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server } from 'socket.io';
import { GameRoom } from '../shared/room';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import type { TeamId } from '../shared/types';

const PORT = Number(process.env.PORT ?? 3001);
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

interface RoomEntry { room: GameRoom; sockets: [string | null, string | null]; tokens: [string, string]; lastEmpty: number }
const rooms = new Map<string, RoomEntry>();

const newCode = () => {
  for (let i = 0; i < 200; i++) {
    const c = `TAC-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    if (!rooms.has(c)) return c;
  }
  throw new Error('no free room codes');
};
const token = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

io.on('connection', (socket) => {
  let code: string | null = null;
  let seat: TeamId = 0;

  const emitTo = (entry: RoomEntry) => (s: TeamId | 'all', msg: ServerMsg) => {
    const targets = s === 'all' ? [0, 1] : [s];
    for (const t of targets) { const id = entry.sockets[t]; if (id) io.to(id).emit('msg', msg); }
  };

  socket.on('create', (name: string, cb: (r: { code: string; token: string; seat: TeamId }) => void) => {
    const c = newCode();
    const entry: RoomEntry = { room: null as unknown as GameRoom, sockets: [socket.id, null], tokens: [token(), token()], lastEmpty: 0 };
    entry.room = new GameRoom(c, 'pvp', emitTo(entry));
    entry.room.connected = [true, false];
    entry.room.names[0] = (name || 'Manager 1').slice(0, 18);
    rooms.set(c, entry);
    code = c; seat = 0;
    socket.join(c);
    cb({ code: c, token: entry.tokens[0], seat: 0 });
    entry.room.setConnected(0, true);
  });

  socket.on('join', (p: { code: string; name: string; token?: string }, cb: (r: { ok: boolean; reason?: string; code?: string; token?: string; seat?: TeamId }) => void) => {
    const c = (p.code ?? '').toUpperCase().trim();
    const entry = rooms.get(c);
    if (!entry) return cb({ ok: false, reason: 'Room not found' });
    let s: TeamId | null = null;
    if (p.token && p.token === entry.tokens[0]) s = 0; else if (p.token && p.token === entry.tokens[1]) s = 1;
    if (s === null) {
      if (entry.sockets[1] === null && !entry.room.connected[1] && entry.room.phase === 'lobby') s = 1;
      else return cb({ ok: false, reason: entry.room.phase === 'lobby' ? 'Room is full' : 'Match already started' });
    }
    entry.sockets[s] = socket.id;
    code = c; seat = s;
    socket.join(c);
    if (s === 1 && p.name) entry.room.names[1] = p.name.slice(0, 18);
    cb({ ok: true, code: c, token: entry.tokens[s], seat: s });
    entry.room.setConnected(s, true);
  });

  socket.on('msg', (msg: ClientMsg) => {
    if (!code) return;
    const entry = rooms.get(code);
    if (!entry || entry.sockets[seat] !== socket.id) return;
    try { entry.room.handle(seat, msg); } catch (e) { console.error('room error', e); }
  });

  socket.on('disconnect', () => {
    if (!code) return;
    const entry = rooms.get(code);
    if (!entry || entry.sockets[seat] !== socket.id) return;
    entry.sockets[seat] = null;
    entry.room.setConnected(seat, false);
    if (!entry.sockets[0] && !entry.sockets[1]) entry.lastEmpty = Date.now();
  });
});

// garbage-collect abandoned rooms
setInterval(() => {
  for (const [c, e] of rooms) if (!e.sockets[0] && !e.sockets[1] && e.lastEmpty && Date.now() - e.lastEmpty > 10 * 60_000) { e.room.dispose(); rooms.delete(c); }
}, 60_000);

http.listen(PORT, () => console.log(`Tactical Eleven server on :${PORT}`));
