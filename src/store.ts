import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import type { ClientMsg, RoomView, ServerMsg } from '../shared/protocol';
import { GameRoom, type SaveData } from '../shared/room';
import type { CPUProfile } from '../shared/engine/cpu';
import type { MatchEvent, PlayerCard, Snapshot, TeamId } from '../shared/types';
import { playEvents, resetSoundEvents, setAmbient } from './sound';

/** Interpolation buffer: consumes one simulation snapshot per tick interval and exposes alpha for 60 FPS rendering. */
export class Playback {
  queue: Snapshot[] = [];
  /** snapshot before `prev` — used for smooth (Hermite) interpolation of player paths */
  prev0: Snapshot | null = null;
  prev: Snapshot | null = null;
  curr: Snapshot | null = null;
  acc = 0;
  tickMs = 200;
  /** called when a snapshot becomes the one on screen (used to sync sounds with what you see) */
  onShow: ((s: Snapshot) => void) | null = null;
  push(s: Snapshot) { if (!this.curr) { this.prev0 = s; this.prev = s; this.curr = s; } else this.queue.push(s); }
  reset() { this.queue = []; this.prev0 = null; this.prev = null; this.curr = null; this.acc = 0; }
  private shift() { this.prev0 = this.prev; this.prev = this.curr; this.curr = this.queue.shift()!; this.onShow?.(this.curr); }
  advance(dtMs: number, speed: number, baseMs: number) {
    this.tickMs = baseMs / Math.max(0.25, speed);
    this.acc += dtMs;
    if (this.queue.length > 8) { while (this.queue.length > 2) this.shift(); this.acc = 0; }
    while (this.acc >= this.tickMs && this.queue.length > 0) { this.acc -= this.tickMs; this.shift(); }
    if (!this.queue.length && this.acc > this.tickMs) this.acc = this.tickMs;
    return this.tickMs > 0 ? Math.min(1, this.acc / this.tickMs) : 1;
  }
}
export const playback = new Playback();
const END_TYPES = new Set(['half', 'full']);
playback.onShow = (s) => playEvents(s.ev, (useStore.getState().view?.seat ?? 0) as TeamId);
/** every snapshot of the match (for the post-match replay scrubber) */
export const recorder: { frames: Snapshot[] } = { frames: [] };

export interface Toast { id: number; text: string; kind: 'info' | 'error' | 'ok' }

interface Store {
  view: RoomView | null;
  snap: Snapshot | null;
  events: MatchEvent[];
  toasts: Toast[];
  conn: 'idle' | 'connecting' | 'online' | 'error';
  roster: Map<string, PlayerCard>;
  name: string;
  /** player whose details are shown in the info panel */
  inspect: string | null;
  setInspect: (id: string | null) => void;
  send: (m: ClientMsg) => void;
  setName: (n: string) => void;
  startCPU: (profile: CPUProfile, duration: 3 | 6 | 10) => void;
  createRoom: () => void;
  joinRoom: (code: string, token?: string) => void;
  /** Abandon the current game (clears saved progress) and return to the home screen. */
  newGame: () => void;
  /** Same as newGame (kept for the lobby / post-match screens). */
  leave: () => void;
  /** Resume a saved game on page load, if there is one. */
  boot: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
}

/** Multiplayer needs the Socket.io server: same origin in development, or VITE_SERVER_URL when the client is hosted statically (e.g. Vercel). */
const SERVER_URL = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_SERVER_URL || undefined;
export const multiplayerAvailable = !!SERVER_URL || (typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
const SAVE_KEY = 'te-save';
const PVP_KEY = 'te-pvp';
let socket: Socket | null = null;
let local: GameRoom | null = null;
let tid = 0;
let lastSet = 0;
let booted = false;

const storage = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* quota or private mode: progress just isn't saved */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---- save throttling (CPU games run in the browser and are saved locally)
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!local || local.disposed || local.phase === 'lobby') return;
  storage.set(SAVE_KEY, JSON.stringify(local.serialize()));
}
function scheduleSave() { if (!saveTimer) saveTimer = setTimeout(saveNow, 800); }
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', saveNow);
  window.addEventListener('beforeunload', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
}

export const useStore = create<Store>((set, get) => {
  const onMsg = (msg: ServerMsg) => {
    if (msg.t === 'view') {
      const v = msg.view;
      const prevPhase = get().view?.phase;
      const roster = new Map(get().roster);
      if (v.draft) for (const p of v.draft.pool) roster.set(p.id, p);
      if (v.squads) for (const p of [...v.squads[0], ...v.squads[1]]) roster.set(p.id, p);
      if (v.phase === 'lobby' && prevPhase && prevPhase !== 'lobby') { playback.reset(); recorder.frames = []; resetSoundEvents(); }
      set({ view: v, roster, ...(v.phase === 'lobby' ? { events: [], snap: null } : {}) });
    } else if (msg.t === 'snap') {
      const s = msg.snap;
      if (!playback.curr) resetSoundEvents(Math.max(-1, ...(s.ev ?? []).map((e) => e.id))); // a restored game: don't replay old sounds
      playback.push(s);
      if (s.ev?.some((e) => e.type === 'half' || e.type === 'full')) playEvents(s.ev, (get().view?.seat ?? 0) as TeamId, END_TYPES); // the screen changes, so play these now
      const last = recorder.frames[recorder.frames.length - 1];
      if (!last || s.tick > last.tick) recorder.frames.push(s);
      const now = performance.now();
      const evs = s.ev;
      if (evs?.length) set((st) => ({ events: [...st.events, ...evs].filter((e, i, a) => i === 0 || e.id > a[i - 1].id).slice(-600) }));
      if (now - lastSet > 90 || s.phase !== get().snap?.phase || evs?.length || s.tick === get().snap?.tick) { lastSet = now; set({ snap: s }); }
    } else if (msg.t === 'result') {
      if (!msg.ok) get().toast(msg.reason ?? 'Order refused', 'error');
      else if (msg.reason) get().toast(msg.reason, 'info');
    } else if (msg.t === 'error') get().toast(msg.message, 'error');
  };
  const localEmit = (seat: TeamId | 'all', msg: ServerMsg) => { if (seat === 0 || seat === 'all') onMsg(msg); };

  const reset = () => {
    local?.dispose(); local = null;
    socket?.disconnect(); socket = null;
    playback.reset(); recorder.frames = []; resetSoundEvents(); setAmbient(false);
    set({ view: null, snap: null, events: [], conn: 'idle', roster: new Map(), inspect: null });
  };

  const connect = (onConnect: (s: Socket) => void) => {
    set({ conn: 'connecting' });
    const s = SERVER_URL ? io(SERVER_URL, { transports: ['websocket', 'polling'] }) : io({ transports: ['websocket', 'polling'] });
    socket = s;
    s.on('connect', () => { set({ conn: 'online' }); onConnect(s); });
    s.on('connect_error', () => { set({ conn: 'error' }); get().toast('Cannot reach the multiplayer server (is it running on :3001?)', 'error'); });
    s.on('msg', onMsg);
  };

  return {
    view: null, snap: null, events: [], toasts: [], conn: 'idle', roster: new Map(), name: storage.get('te-name') ?? '', inspect: null,
    setInspect: (id) => set({ inspect: id }),
    setName: (n) => { storage.set('te-name', n); set({ name: n }); },
    toast: (text, kind = 'info') => {
      const id = ++tid;
      set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3800);
    },
    send: (m) => {
      if (local) local.handle(0, m);
      else socket?.emit('msg', m);
    },
    startCPU: (profile, duration) => {
      reset();
      storage.del(PVP_KEY);
      const room = new GameRoom('CPU-MATCH', 'cpu', localEmit, profile);
      room.names[0] = get().name || 'You';
      room.onChange = scheduleSave;
      local = room;
      set({ conn: 'online' });
      room.setConnected(0, true);
      room.handle(0, { t: 'config', duration });
      room.handle(0, { t: 'ready', value: true });
    },
    createRoom: () => {
      reset();
      storage.del(SAVE_KEY);
      connect((s) => s.emit('create', get().name || 'Manager 1', (r: { code: string; token: string }) => storage.set(PVP_KEY, JSON.stringify({ code: r.code, token: r.token }))));
    },
    joinRoom: (code, token) => {
      reset();
      storage.del(SAVE_KEY);
      connect((s) => s.emit('join', { code, name: get().name || 'Manager 2', token }, (r: { ok: boolean; reason?: string; code?: string; token?: string }) => {
        if (!r.ok) { get().toast(r.reason ?? 'Could not join', 'error'); storage.del(PVP_KEY); reset(); return; }
        storage.set(PVP_KEY, JSON.stringify({ code: r.code ?? code, token: r.token }));
      }));
    },
    newGame: () => {
      storage.del(SAVE_KEY); storage.del(PVP_KEY);
      reset();
    },
    leave: () => get().newGame(),
    boot: () => {
      if (booted) return;
      booted = true;
      const raw = storage.get(SAVE_KEY);
      if (raw) {
        try {
          const data = JSON.parse(raw) as SaveData;
          recorder.frames = [];
          const room = GameRoom.restore(data, localEmit, (s) => recorder.frames.push(s));
          room.onChange = scheduleSave;
          local = room;
          set({ conn: 'online' });
          room.resume();
          if (room.phase === 'match') get().toast('Game restored — paused where you left off. Press play to continue.', 'ok');
          else get().toast('Game restored where you left off.', 'ok');
          return;
        } catch (e) {
          console.error('Could not restore saved game', e);
          storage.del(SAVE_KEY);
          reset();
        }
      }
      const pvp = storage.get(PVP_KEY);
      if (pvp) {
        try { const { code, token } = JSON.parse(pvp) as { code: string; token: string }; if (code && token) get().joinRoom(code, token); }
        catch { storage.del(PVP_KEY); }
      }
    },
  };
});

export const mySeat = (v: RoomView | null): TeamId => v?.seat ?? 0;
