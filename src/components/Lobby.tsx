import { useState } from 'react';
import { Swords, Users, Bot, Copy, Check, Timer, Flame, Shield, Zap, LogOut, Crown } from 'lucide-react';
import { useStore, multiplayerAvailable } from '../store';
import { CPU_LABELS, type CPUArchetype, type CPUDifficulty } from '../../shared/engine/cpu';
import { tickMsFor } from '../../shared/room';
import { Card, Seg, cx } from './ui';

/** Real playing time at 1x (the speed control can halve or multiply it). */
const realMin = (d: 3 | 6 | 10) => Math.round((tickMsFor(d) * d * 600) / 60000);
const DURATIONS = [
  { v: 3 as const, name: 'Blitz', blurb: `≈${realMin(3)} min at 1x · most compressed` },
  { v: 6 as const, name: 'Standard', blurb: `≈${realMin(6)} min at 1x · balanced` },
  { v: 10 as const, name: 'Tactical', blurb: `≈${realMin(10)} min at 1x · room to think` },
];
const ARCH_ICON: Record<CPUArchetype, JSX.Element> = { press: <Flame className="h-5 w-5" />, counter: <Zap className="h-5 w-5" />, block: <Shield className="h-5 w-5" /> };

export function Home() {
  const { name, setName, startCPU, createRoom, joinRoom, conn } = useStore();
  const [arch, setArch] = useState<CPUArchetype>('press');
  const [diff, setDiff] = useState<CPUDifficulty>('normal');
  const [dur, setDur] = useState<3 | 6 | 10>(6);
  const [code, setCode] = useState('');
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-10 text-center">
        <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300"><Swords className="h-3.5 w-3.5" /> Draft · Command · Outthink</div>
        <h1 className="font-display text-6xl font-bold uppercase tracking-wide text-white md:text-7xl">Tactical <span className="text-emerald-400">Eleven</span></h1>
        <p className="mx-auto mt-3 max-w-2xl text-slate-400">Draft a squad from a shared pool of 40, set a dual-phase tactical system, then manage a live 2D spatial simulation grounded in the Laws of the Game.</p>
        <div className="mx-auto mt-6 max-w-xs">
          <label className="label mb-1 block text-left">Manager name</label>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 18))} placeholder="Your name" className="w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm outline-none focus:border-emerald-400/60" />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Bot className="h-5 w-5 text-emerald-400" />Play vs CPU</span>} right={<span className="chip">zero setup</span>}>
          <div className="space-y-4">
            <div>
              <div className="label mb-2">AI manager archetype</div>
              <div className="grid gap-2">
                {(Object.keys(CPU_LABELS) as CPUArchetype[]).map((a) => (
                  <button key={a} onClick={() => setArch(a)} className={cx('flex items-start gap-3 rounded-lg border p-3 text-left transition', arch === a ? 'border-emerald-400/60 bg-emerald-400/10' : 'border-white/10 bg-white/5 hover:bg-white/10')}>
                    <span className="mt-0.5 text-emerald-300">{ARCH_ICON[a]}</span>
                    <span><span className="block text-sm font-semibold text-white">{CPU_LABELS[a].name}</span><span className="block text-xs text-slate-400">{CPU_LABELS[a].blurb}</span></span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div><div className="label mb-1">Difficulty</div><Seg value={diff} onChange={setDiff} options={[{ v: 'easy', label: 'Easy' }, { v: 'normal', label: 'Normal' }, { v: 'hard', label: 'Hard' }]} /></div>
            </div>
            <DurationPicker value={dur} onChange={setDur} />
            <button className="btn btn-primary w-full py-3 text-base" onClick={() => startCPU({ archetype: arch, difficulty: diff }, dur)}>Kick off vs CPU</button>
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Users className="h-5 w-5 text-sky-400" />Multiplayer</span>} right={<span className="chip">room code</span>}>
          {!multiplayerAvailable ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">Two managers, one shared draft pool, private room codes.</p>
              <p className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm text-slate-300">Online multiplayer isn’t available on this hosted version: it needs the game server running. Play against the CPU, or run the project locally with <code className="rounded bg-white/10 px-1">npm run dev</code> to play a friend.</p>
            </div>
          ) : (
          <div className="space-y-5">
            <p className="text-sm text-slate-400">Two managers, one shared draft pool. Create a private room and share the code — or join with a friend’s. Open two browser tabs to test locally.</p>
            <button className="btn btn-primary w-full py-3 text-base" disabled={conn === 'connecting'} onClick={createRoom}>Create private room</button>
            <div className="flex items-center gap-3 text-xs text-slate-500"><div className="h-px flex-1 bg-white/10" />or join<div className="h-px flex-1 bg-white/10" /></div>
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 7))} placeholder="TAC-714" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-800 px-3 py-2 font-mono text-lg tracking-widest outline-none focus:border-sky-400/60" />
              <button className="btn btn-ghost" disabled={code.length < 6 || conn === 'connecting'} onClick={() => joinRoom(code.includes('-') ? code : `${code.slice(0, 3)}-${code.slice(3)}`)}>Join</button>
            </div>
            <p className="text-xs text-slate-500">Requires the Socket.io server (<code className="rounded bg-white/10 px-1">npm run dev</code> starts both).</p>
          </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export function DurationPicker({ value, onChange, disabled }: { value: 3 | 6 | 10; onChange: (v: 3 | 6 | 10) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="label mb-2 flex items-center gap-1"><Timer className="h-3.5 w-3.5" /> Match duration (90′ + stoppage compressed)</div>
      <div className="grid grid-cols-3 gap-2">
        {DURATIONS.map((d) => (
          <button key={d.v} disabled={disabled} onClick={() => onChange(d.v)} className={cx('rounded-lg border p-2.5 text-left transition disabled:cursor-not-allowed', value === d.v ? 'border-emerald-400/60 bg-emerald-400/10' : 'border-white/10 bg-white/5 enabled:hover:bg-white/10')}>
            <div className="font-display text-xl font-semibold text-white">{d.v} min</div>
            <div className="text-xs font-semibold text-emerald-300">{d.name}</div>
            <div className="text-[11px] text-slate-400">{d.blurb}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function WaitingRoom() {
  const { view, send, leave } = useStore();
  const [copied, setCopied] = useState(false);
  if (!view) return null;
  const host = view.seat === 0;
  const both = view.connected[0] && view.connected[1];
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Card title="Private room" right={<button className="btn btn-ghost" onClick={leave}><LogOut className="h-4 w-4" />Leave</button>}>
        <div className="mb-6 text-center">
          <div className="label mb-1">Room code</div>
          <button onClick={() => { navigator.clipboard?.writeText(view.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="group inline-flex items-center gap-3 rounded-xl border border-white/10 bg-ink-900 px-6 py-3 font-mono text-5xl font-bold tracking-[0.2em] text-emerald-300 hover:border-emerald-400/50">
            {view.code}{copied ? <Check className="h-6 w-6" /> : <Copy className="h-6 w-6 text-slate-500 group-hover:text-slate-300" />}
          </button>
          <p className="mt-2 text-xs text-slate-500">Share this code. The second manager joins from the lobby.</p>
        </div>
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className={cx('rounded-lg border p-3', view.connected[i] ? 'border-emerald-400/30 bg-emerald-400/5' : 'border-dashed border-white/15')}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">{i === 0 && <Crown className="h-4 w-4 text-amber-300" />}{view.connected[i] ? view.names[i] : 'Waiting for manager…'}{view.seat === i && <span className="chip">you</span>}</div>
              <div className="mt-1 text-xs text-slate-400">{view.connected[i] ? (view.ready[i] ? 'Ready' : 'Not ready') : 'Not connected'} · {i === 0 ? 'Home (blue)' : 'Away (pink)'}</div>
            </div>
          ))}
        </div>
        <DurationPicker value={view.duration} disabled={!host} onChange={(v) => send({ t: 'config', duration: v })} />
        {!host && <p className="mt-2 text-xs text-slate-500">The host picks the duration; confirm by pressing Ready.</p>}
        <button className={cx('btn mt-6 w-full py-3 text-base', view.ready[view.seat] ? 'btn-ghost' : 'btn-primary')} disabled={!both} onClick={() => send({ t: 'ready', value: !view.ready[view.seat] })}>
          {!both ? 'Waiting for opponent…' : view.ready[view.seat] ? 'Ready — waiting for opponent (click to cancel)' : 'Ready'}
        </button>
      </Card>
    </div>
  );
}
