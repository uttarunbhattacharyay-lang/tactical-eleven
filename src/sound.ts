/**
 * Match sounds, synthesised with the Web Audio API (no audio files):
 * the referee's whistle on every stoppage and crowd reactions (roar, "ooh", groan, applause, ambient murmur).
 */
import type { MatchEvent, TeamId } from '../shared/types';

const KEY = 'te-sound';
type Listener = () => void;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let clapBuf: AudioBuffer | null = null;
let ambient: { gain: GainNode; stop: () => void } | null = null;
let wantAmbient = false;
let lastWhistle = 0;
let lastPlayedId = -1;
const listeners = new Set<Listener>();

function readPref(): boolean { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } }
let enabled = readPref();

export const sound = {
  get enabled() { return enabled; },
  setEnabled(v: boolean) {
    enabled = v;
    try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch { /* ignore */ }
    if (v) unlock();
    setAmbient(wantAmbient);
    if (master && ctx) master.gain.setTargetAtTime(v ? 0.9 : 0, ctx.currentTime, 0.05);
    listeners.forEach((l) => l());
  },
  subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
};

/** Browsers only allow audio after a user gesture: create/resume the context on the first click or key press. */
function unlock() {
  if (typeof window === 'undefined') return;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? 0.9 : 0;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      noiseBuf = makeNoise(ctx, 3);
      clapBuf = makeClaps(ctx, 4);
    }
    if (ctx.state === 'suspended') void ctx.resume().then(() => setAmbient(wantAmbient));
  } catch { ctx = null; }
}
if (typeof window !== 'undefined') {
  const once = () => unlock();
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}

function ready(): AudioContext | null {
  if (!enabled || !ctx || !master || ctx.state !== 'running') return null;
  return ctx;
}

/** Pinkish noise: a good base for crowd texture. */
function makeNoise(c: AudioContext, secs: number) {
  const n = Math.floor(c.sampleRate * secs);
  const buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
  }
  return buf;
}

/** Many people clapping: random short noise bursts. */
function makeClaps(c: AudioContext, secs: number) {
  const n = Math.floor(c.sampleRate * secs);
  const buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const claps = Math.floor(secs * 220);
    for (let k = 0; k < claps; k++) {
      const at = Math.floor(Math.random() * (n - 2000));
      const amp = 0.15 + Math.random() * 0.35;
      const len = 300 + Math.floor(Math.random() * 500);
      for (let i = 0; i < len; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len / 5));
    }
  }
  return buf;
}

function noiseSrc(c: AudioContext, buf: AudioBuffer, loop = true) {
  const s = c.createBufferSource();
  s.buffer = buf; s.loop = loop;
  s.playbackRate.value = 0.9 + Math.random() * 0.2;
  return s;
}

// ---------------------------------------------------------------- whistle

/** One blast of a pea whistle: a high tone with the rattling trill of the pea, plus breath noise. */
function blast(c: AudioContext, t0: number, dur: number, vol = 0.22) {
  const out = c.createGain();
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(vol, t0 + 0.015);
  out.gain.setValueAtTime(vol, t0 + dur - 0.04);
  out.gain.linearRampToValueAtTime(0, t0 + dur);
  out.connect(master!);

  const f = 2650 + Math.random() * 300;
  const osc = c.createOscillator(); osc.type = 'sine'; osc.frequency.value = f;
  const osc2 = c.createOscillator(); osc2.type = 'triangle'; osc2.frequency.value = f * 1.005;
  const trill = c.createOscillator(); trill.frequency.value = 32 + Math.random() * 8;
  const depth = c.createGain(); depth.gain.value = 170;
  trill.connect(depth); depth.connect(osc.frequency); depth.connect(osc2.frequency);
  // amplitude flutter from the pea
  const am = c.createGain(); am.gain.value = 0.75;
  const amDepth = c.createGain(); amDepth.gain.value = 0.25;
  trill.connect(amDepth).connect(am.gain);
  const g2 = c.createGain(); g2.gain.value = 0.35;
  osc.connect(am); osc2.connect(g2).connect(am); am.connect(out);

  const br = noiseSrc(c, noiseBuf!);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
  const bg = c.createGain(); bg.gain.value = 0.6;
  br.connect(bp).connect(bg).connect(out);

  [osc, osc2, trill].forEach((o) => { o.start(t0); o.stop(t0 + dur + 0.05); });
  br.start(t0, Math.random()); br.stop(t0 + dur + 0.05);
}

type WhistleKind = 'pip' | 'short' | 'strong' | 'long' | 'half' | 'full';
export function whistle(kind: WhistleKind) {
  const c = ready(); if (!c) return;
  const now = c.currentTime;
  if (now - lastWhistle < 0.25 && kind !== 'half' && kind !== 'full') return; // don't stack at high speed
  lastWhistle = now;
  const t = now + 0.02;
  switch (kind) {
    case 'pip': blast(c, t, 0.16, 0.18); break;
    case 'short': blast(c, t, 0.32); break;
    case 'strong': blast(c, t, 0.14, 0.26); blast(c, t + 0.2, 0.55, 0.26); break;
    case 'long': blast(c, t, 0.75); break;
    case 'half': blast(c, t, 0.35); blast(c, t + 0.5, 0.9); break;
    case 'full': blast(c, t, 0.35); blast(c, t + 0.5, 0.35); blast(c, t + 1.0, 1.2); break;
  }
}

// ---------------------------------------------------------------- crowd

/** Crowd voice texture: noise through a few vocal-range band-pass filters. */
function crowdVoice(c: AudioContext, t0: number, env: [number, number][], opts: { bright?: number; sweep?: [number, number]; distant?: boolean } = {}) {
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, t0);
  let t = t0;
  for (const [dt, v] of env) { t += dt; out.gain.linearRampToValueAtTime(Math.max(0.0001, v), t); }
  const end = t + 0.05;
  let dest: AudioNode = master!;
  if (opts.distant) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.connect(master!); dest = lp; }
  out.connect(dest);

  const src = noiseSrc(c, noiseBuf!);
  const bands = [[380, 1.1, 1], [720, 1.3, 0.8], [1250, 1.6, 0.55 * (opts.bright ?? 1)], [2400, 2, 0.3 * (opts.bright ?? 1)]];
  for (const [fq, q, g] of bands) {
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(opts.sweep ? fq * opts.sweep[0] : fq, t0);
    if (opts.sweep) bp.frequency.linearRampToValueAtTime(fq * opts.sweep[1], end);
    const gn = c.createGain(); gn.gain.value = g;
    src.connect(bp).connect(gn).connect(out);
  }
  src.start(t0, Math.random() * 2); src.stop(end);
}

function applause(c: AudioContext, t0: number, dur: number, vol: number) {
  const src = noiseSrc(c, clapBuf!, true);
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.4);
  g.gain.setValueAtTime(vol, t0 + dur * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(hp).connect(g).connect(master!);
  src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
}

export type CrowdKind = 'roar' | 'awayRoar' | 'ooh' | 'gasp' | 'groan' | 'boo' | 'applause' | 'swell';
export function crowd(kind: CrowdKind) {
  const c = ready(); if (!c) return;
  const t = c.currentTime + 0.03;
  switch (kind) {
    case 'roar': // home goal: huge eruption, long tail, applause underneath
      crowdVoice(c, t, [[0.18, 0.9], [1.6, 0.8], [3.2, 0.0001]], { bright: 1.4 });
      crowdVoice(c, t + 0.1, [[0.3, 0.35], [1.5, 0.3], [2.5, 0.0001]], { sweep: [1.1, 1.3], bright: 1.6 });
      applause(c, t + 1.2, 4, 0.35);
      break;
    case 'awayRoar': // their goal: the away end celebrates far across the stadium, home fans groan
      crowdVoice(c, t, [[0.25, 0.32], [1.4, 0.26], [2.2, 0.0001]], { distant: true });
      crowdVoice(c, t + 0.15, [[0.25, 0.3], [1.6, 0.0001]], { sweep: [1.15, 0.7] });
      break;
    case 'ooh': // near miss for us
      crowdVoice(c, t, [[0.2, 0.55], [0.5, 0.5], [1.2, 0.0001]], { sweep: [0.75, 1.15] });
      applause(c, t + 0.9, 2, 0.15);
      break;
    case 'gasp': // their big chance
      crowdVoice(c, t, [[0.12, 0.38], [0.9, 0.0001]], { sweep: [1.1, 0.85] });
      break;
    case 'groan':
      crowdVoice(c, t, [[0.25, 0.4], [1.5, 0.0001]], { sweep: [1.15, 0.7] });
      break;
    case 'boo':
      crowdVoice(c, t, [[0.3, 0.32], [1.2, 0.28], [1.2, 0.0001]], { sweep: [0.6, 0.55], bright: 0.4 });
      break;
    case 'applause':
      applause(c, t, 4.5, 0.4);
      crowdVoice(c, t, [[0.4, 0.2], [2.5, 0.0001]]);
      break;
    case 'swell':
      crowdVoice(c, t, [[0.5, 0.3], [1.8, 0.0001]], { bright: 1.2 });
      break;
  }
}

/** Constant stadium murmur while the match is running. */
export function setAmbient(on: boolean) {
  wantAmbient = on;
  const c = ready();
  if (!on || !c) {
    if (ambient && ctx) { const a = ambient; ambient = null; a.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4); setTimeout(a.stop, 2000); }
    return;
  }
  if (ambient) return;
  const gain = c.createGain(); gain.gain.value = 0.0001;
  gain.gain.setTargetAtTime(0.11, c.currentTime, 0.8);
  const src = noiseSrc(c, noiseBuf!);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.7;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
  // slow swells, like a real crowd reacting to play
  const lfo = c.createOscillator(); lfo.frequency.value = 0.13;
  const lfoG = c.createGain(); lfoG.gain.value = 0.035;
  const level = c.createGain(); level.gain.value = 1;
  lfo.connect(lfoG).connect(level.gain);
  src.connect(bp).connect(lp).connect(level).connect(gain).connect(master!);
  src.start(); lfo.start();
  ambient = { gain, stop: () => { try { src.stop(); lfo.stop(); } catch { /* already stopped */ } } };
}

/** Play the sound for each new match event (each event is played once). `me` is the user's team (the home crowd). */
export function playEvents(evs: MatchEvent[] | undefined, me: TeamId, onlyTypes?: Set<string>) {
  if (!evs?.length) return;
  for (const e of evs) {
    if (onlyTypes && !onlyTypes.has(e.type)) continue;
    if (e.id <= lastPlayedId) continue;
    lastPlayedId = e.id;
    if (!ready()) continue;
    const ours = e.team === me;
    switch (e.type) {
      case 'kickoff': whistle('long'); crowd('swell'); break;
      case 'goal': lastWhistle = 0; crowd(ours ? 'roar' : 'awayRoar'); setTimeout(() => whistle('short'), 900); break;
      case 'foul': if (e.importance < 5) { whistle('short'); if (e.team !== me) crowd('boo'); } break; // a penalty foul is followed by its own event
      case 'yellow': lastWhistle = 0; whistle('strong'); crowd(ours ? 'groan' : 'boo'); break;
      case 'red': lastWhistle = 0; whistle('strong'); crowd(ours ? 'groan' : 'roar'); break;
      case 'penalty': lastWhistle = 0; whistle('strong'); crowd(ours ? 'ooh' : 'groan'); break;
      case 'offside': whistle('pip'); break;
      case 'half': lastWhistle = 0; whistle('half'); crowd('applause'); break;
      case 'full': lastWhistle = 0; whistle('full'); crowd('applause'); break;
      case 'sub': crowd('applause'); break;
      case 'miss': if ((e.xg ?? 0) >= 0.15 || e.text.includes('post')) crowd(ours ? 'ooh' : 'gasp'); break;
      case 'save': if ((e.xg ?? 0) >= 0.15) crowd(ours ? 'gasp' : 'ooh'); break; // `team` on a save is the keeper's side
      case 'chance': if ((e.xg ?? 0) >= 0.25) crowd(ours ? 'ooh' : 'gasp'); break;
    }
  }
}

/** Forget what was played (new game / restored game). */
export function resetSoundEvents(fromId = -1) { lastPlayedId = fromId; }
