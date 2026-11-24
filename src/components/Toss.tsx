import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Card, cx } from './ui';

export function Toss() {
  const { view, send } = useStore();
  const [flipped, setFlipped] = useState(false);
  const t = view?.toss;
  useEffect(() => { if (t?.result) setFlipped(true); }, [t?.result]);
  if (!view || !t) return null;
  const me = view.seat;
  const caller = t.caller, winner = t.winner;
  const myCall = caller === me;
  const myChoice = winner === me && !t.choice;
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 text-center">
      <h2 className="font-display mb-1 text-5xl font-bold uppercase text-white">Coin Toss</h2>
      <p className="mb-8 text-slate-400">{view.names[caller]} calls the toss.</p>
      <div className="coin-wrap mb-8 flex h-44 items-center justify-center">
        <div className={cx('coin', !t.result && 'spin-idle', flipped && (t.result === 'heads' ? 'flip-heads' : 'flip-tails'))}>
          <div className="coin-face coin-heads">HEADS</div>
          <div className="coin-face coin-tails">TAILS</div>
        </div>
      </div>
      <Card>
        {!t.call && myCall && (
          <div><p className="mb-3 font-semibold text-white">Call it:</p>
            <div className="flex justify-center gap-3"><button className="btn btn-primary px-8 py-3" onClick={() => send({ t: 'tossCall', call: 'heads' })}>Heads</button><button className="btn btn-ghost px-8 py-3" onClick={() => send({ t: 'tossCall', call: 'tails' })}>Tails</button></div></div>
        )}
        {!t.call && !myCall && <p className="text-slate-300">Waiting for {view.names[caller]} to call…</p>}
        {t.call && !t.choice && <p className="mb-3 text-slate-300">{view.names[caller]} called <b className="text-white">{t.call}</b>. It’s <b className="text-amber-300">{t.result}</b>!</p>}
        {t.call && winner !== null && !t.choice && (
          <div>
            <p className="mb-3 font-semibold text-emerald-300">{winner === me ? 'You win the toss!' : `${view.names[winner]} wins the toss.`}</p>
            {myChoice ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <button className="btn btn-primary flex-col py-4" onClick={() => send({ t: 'tossChoice', choice: 'firstPick' })}><span className="text-base">First Pick</span><span className="text-xs font-normal opacity-80">Take the best player; opponent kicks off</span></button>
                <button className="btn btn-ghost flex-col py-4" onClick={() => send({ t: 'tossChoice', choice: 'kickoff' })}><span className="text-base">Kick-off / Side</span><span className="text-xs font-normal opacity-80">Opponent gets first pick in the draft</span></button>
              </div>
            ) : <p className="text-slate-400">{view.names[winner]} is choosing…</p>}
          </div>
        )}
        {t.choice && (
          <div className="space-y-1 text-slate-200">
            <p><b className="text-white">{view.names[view.firstPick!]}</b> has the first pick in the draft.</p>
            <p><b className="text-white">{view.names[view.kickoffTeam!]}</b> will kick off.</p>
            <p className="pt-2 text-sm text-slate-400">Opening the draft room…</p>
          </div>
        )}
      </Card>
    </div>
  );
}
