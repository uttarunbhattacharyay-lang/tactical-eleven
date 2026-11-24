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
      buildCrowd();
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
//
// A crowd is thousands of people: here it is built from dozens of synthetic voices (a buzzing vocal-cord
// tone at each person's own pitch, shaped by vowel formants), each talking or shouting with its own rhythm.
// The voices are rendered once, offline, into short buffers that are then played back for each reaction.

type Vowel = [number, number, number];
const V: Record<string, Vowel> = { a: [760, 1250, 2500], ah: [680, 1100, 2450], e: [520, 1800, 2550], o: [500, 880, 2400], u: [340, 760, 2300], i: [320, 2200, 2900] };
interface CrowdBufs { murmur: AudioBuffer; cheer: AudioBuffer; ooh: AudioBuffer; groan: AudioBuffer; boo: AudioBuffer }
let crowdBufs: CrowdBufs | null = null;
let building = false;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pickOf = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

interface VoiceSpec {
  voices: number; secs: number; pitch: [number, number]; vowels: string[];
  /** talking: on/off syllables at this rate (Hz); 0 = one sustained shout */
  syll: number;
  /** pitch glide over the buffer (ratio at end) */
  glide?: [number, number];
  /** vowel at the end (formants slide towards it) */
  toVowel?: string;
  env: (t: number) => number; // overall loudness shape 0..1 at time t (s)
  breath?: number;
}

async function renderVoices(sr: number, s: VoiceSpec): Promise<AudioBuffer> {
  const OAC = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const oc = new OAC(2, Math.floor(sr * s.secs), sr);
  const bus = oc.createGain(); bus.gain.value = 1.6 / Math.sqrt(s.voices);
  // overall envelope
  const envG = oc.createGain();
  envG.gain.setValueAtTime(s.env(0), 0);
  for (let t = 0.05; t <= s.secs; t += 0.05) envG.gain.linearRampToValueAtTime(s.env(t), t);
  // a touch of breath / stadium air above 1 kHz (not the low rumble that sounds like surf)
  if (s.breath) {
    const nb = oc.createBuffer(1, Math.floor(sr * s.secs), sr); const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const ns = oc.createBufferSource(); ns.buffer = nb;
    const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const ng = oc.createGain(); ng.gain.value = s.breath;
    ns.connect(hp).connect(ng).connect(envG); ns.start();
  }
  bus.connect(envG).connect(oc.destination);
  for (let k = 0; k < s.voices; k++) {
    const f0 = rnd(s.pitch[0], s.pitch[1]);
    const osc = oc.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, 0);
    if (s.glide) { osc.frequency.setValueAtTime(f0 * s.glide[0] * rnd(0.95, 1.05), 0); osc.frequency.linearRampToValueAtTime(f0 * s.glide[1] * rnd(0.93, 1.07), s.secs); }
    // natural vibrato / pitch drift per person
    const vib = oc.createOscillator(); vib.frequency.value = rnd(4, 7);
    const vibG = oc.createGain(); vibG.gain.value = f0 * rnd(0.01, s.syll ? 0.025 : 0.04);
    vib.connect(vibG).connect(osc.frequency);
    // vocal tract: three formant resonances
    const vw = V[pickOf(s.vowels)];
    const mix = oc.createGain(); mix.gain.value = rnd(0.5, 1);
    const formants = vw.map((fq, i) => {
      const bp = oc.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.setValueAtTime(fq * rnd(0.92, 1.1), 0); bp.Q.value = [7, 9, 11][i];
      if (s.toVowel) bp.frequency.linearRampToValueAtTime(V[s.toVowel][i] * rnd(0.92, 1.1), s.secs);
      const g = oc.createGain(); g.gain.value = [1, 0.55, 0.25][i];
      osc.connect(bp).connect(g).connect(mix);
      return bp;
    });
    // syllables (talking) or one held shout with its own swell
    const amp = oc.createGain(); amp.gain.setValueAtTime(0, 0);
    if (s.syll) {
      let t = rnd(0, 0.4);
      while (t < s.secs) {
        const on = rnd(0.5, 1.6) / s.syll, off = rnd(0.2, 1.2) / s.syll, lvl = rnd(0.3, 1);
        amp.gain.setTargetAtTime(lvl, t, 0.02); amp.gain.setTargetAtTime(0, t + on, 0.03);
        // each syllable a different vowel: that's what makes it sound like words
        const nv = V[pickOf(s.vowels)];
        formants.forEach((bp, i) => bp.frequency.setTargetAtTime(nv[i] * rnd(0.92, 1.1), t, 0.03));
        t += on + off;
        if (Math.random() < 0.12) t += rnd(0.3, 1.2); // pauses for breath
      }
    } else {
      const st = rnd(0, 0.25);
      amp.gain.setTargetAtTime(rnd(0.5, 1), st, rnd(0.04, 0.15));
      amp.gain.setTargetAtTime(rnd(0.3, 0.8), st + rnd(0.6, 1.5), 0.4); // people run out of breath at different times
    }
    const pan = oc.createStereoPanner(); pan.pan.value = rnd(-0.9, 0.9);
    mix.connect(amp).connect(pan).connect(bus);
    osc.start(0); vib.start(0); osc.stop(s.secs); vib.stop(s.secs);
  }
  return oc.startRendering();
}

/** Render the crowd voices once in the background (a few hundred ms, off the main thread). */
function buildCrowd() {
  if (crowdBufs || building || typeof window === 'undefined') return;
  building = true;
  const sr = 22050;
  const rise = (a: number, hold: number, rel: number) => (t: number) => (t < a ? t / a : t < a + hold ? 1 : Math.max(0, 1 - (t - a - hold) / rel));
  Promise.all([
    renderVoices(sr, { voices: 46, secs: 6, pitch: [90, 240], vowels: ['a', 'e', 'o', 'i', 'u', 'ah'], syll: 4.5, env: () => 1, breath: 0.03 }),
    renderVoices(sr, { voices: 64, secs: 4, pitch: [170, 430], vowels: ['a', 'ah', 'e'], syll: 0, glide: [0.85, 1.08], env: rise(0.18, 1.6, 2.2), breath: 0.12 }),
    renderVoices(sr, { voices: 48, secs: 2.2, pitch: [140, 320], vowels: ['u', 'o'], syll: 0, glide: [0.88, 1.22], env: rise(0.22, 0.5, 1.4), breath: 0.04 }),
    renderVoices(sr, { voices: 48, secs: 2.2, pitch: [140, 300], vowels: ['o', 'ah'], syll: 0, glide: [1.15, 0.72], toVowel: 'ah', env: rise(0.15, 0.45, 1.5), breath: 0.04 }),
    renderVoices(sr, { voices: 48, secs: 2.6, pitch: [95, 190], vowels: ['u', 'o'], syll: 0, glide: [1, 0.93], env: rise(0.25, 1.4, 0.9), breath: 0.03 }),
  ]).then(([murmur, cheer, ooh, groan, boo]) => {
    crowdBufs = { murmur, cheer, ooh, groan, boo };
    if (wantAmbient) { ambient = null; setAmbient(true); }
  }).catch(() => { building = false; });
}

function playBuf(c: AudioContext, buf: AudioBuffer, t: number, vol: number, o: { rate?: number; lowpass?: number; loop?: boolean } = {}) {
  const src = c.createBufferSource(); src.buffer = buf; src.loop = !!o.loop;
  src.playbackRate.value = (o.rate ?? 1) * rnd(0.97, 1.03);
  const g = c.createGain(); g.gain.value = vol;
  let node: AudioNode = src;
  if (o.lowpass) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lowpass; node.connect(lp); node = lp; }
  node.connect(g).connect(master!);
  src.start(t);
  return { src, g };
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
  buildCrowd();
  const b = crowdBufs; if (!b) return;
  const t = c.currentTime + 0.03;
  switch (kind) {
    case 'roar': // home goal: the stadium erupts, then applause and chatter
      playBuf(c, b.cheer, t, 1.0);
      playBuf(c, b.cheer, t + 0.12, 0.6, { rate: 1.06 });
      applause(c, t + 1.4, 4, 0.32);
      break;
    case 'awayRoar': // their goal: the away end celebrates across the stadium while the home fans groan
      playBuf(c, b.cheer, t, 0.35, { lowpass: 1200, rate: 0.96 });
      playBuf(c, b.groan, t + 0.1, 0.7);
      break;
    case 'ooh': playBuf(c, b.ooh, t, 0.85); applause(c, t + 1.2, 1.8, 0.12); break;
    case 'gasp': playBuf(c, b.ooh, t, 0.5, { rate: 1.12 }); break;
    case 'groan': playBuf(c, b.groan, t, 0.7); break;
    case 'boo': playBuf(c, b.boo, t, 0.55); break;
    case 'applause': applause(c, t, 4.5, 0.4); break;
    case 'swell': { const s = playBuf(c, b.cheer, t, 0.32); s.src.stop(t + 2.2); s.g.gain.setTargetAtTime(0, t + 1.4, 0.3); break; }
  }
}

/** Constant stadium chatter while the match is running: many people talking, not a wash of noise. */
export function setAmbient(on: boolean) {
  wantAmbient = on;
  const c = ready();
  if (!on || !c) {
    if (ambient && ctx) { const a = ambient; ambient = null; a.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4); setTimeout(a.stop, 2000); }
    return;
  }
  buildCrowd();
  if (ambient || !crowdBufs) return;
  const gain = c.createGain(); gain.gain.value = 0.0001;
  gain.gain.setTargetAtTime(0.32, c.currentTime, 0.8);
  gain.connect(master!);
  // two copies of the chatter, offset and at slightly different speeds, so the loop never repeats audibly
  const mk = (rate: number, off: number) => {
    const s = c.createBufferSource(); s.buffer = crowdBufs!.murmur; s.loop = true; s.playbackRate.value = rate;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    s.connect(lp).connect(gain); s.start(c.currentTime, off); return s;
  };
  const a = mk(1, 0), b2 = mk(0.93, 3.1);
  ambient = { gain, stop: () => { try { a.stop(); b2.stop(); } catch { /* already stopped */ } } };
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
