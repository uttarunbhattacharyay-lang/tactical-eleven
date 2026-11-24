import { useStore } from './store';
import { Toasts } from './components/ui';
import { Home, WaitingRoom } from './components/Lobby';
import { Toss } from './components/Toss';
import { Draft } from './components/Draft';
import { Tactics } from './components/Tactics';
import { Match } from './components/Match';
import { Halftime } from './components/Halftime';
import { PostMatch } from './components/PostMatch';
import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

export default function App() {
  const { view, conn, newGame, boot } = useStore();
  useEffect(() => { boot(); }, [boot]);
  let body;
  if (!view) body = conn === 'connecting' ? <div className="p-20 text-center text-slate-400">Connecting…</div> : <Home />;
  else switch (view.phase) {
    case 'lobby': body = view.mode === 'pvp' ? <WaitingRoom /> : <div className="p-20 text-center text-slate-400">Preparing match…</div>; break;
    case 'toss': body = <Toss />; break;
    case 'draft': body = <Draft />; break;
    case 'tactics': body = <Tactics key="tac" />; break;
    case 'match': body = <Match />; break;
    case 'halftime': body = <Halftime />; break;
    case 'fulltime': body = <PostMatch />; break;
  }
  return (
    <div className="min-h-screen bg-ink-950 text-slate-100">
      {view && view.phase !== 'lobby' && (
        <div className="flex items-center justify-between border-b border-white/10 bg-ink-900 px-4 py-1.5 text-xs text-slate-400">
          <span className="font-display text-sm font-bold uppercase tracking-wide text-white">Tactical <span className="text-emerald-400">Eleven</span></span>
          <span>{view.mode === 'pvp' ? `Room ${view.code}` : 'vs CPU'} · {view.phase}</span>
          <button className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 hover:border-rose-300/50 hover:text-white" title="Abandon this game and start again from the beginning"
            onClick={() => { if (confirm('Start a new game?\n\nYour current progress (draft, squad, tactics and match) will be permanently lost.')) newGame(); }}><RotateCcw className="h-3.5 w-3.5" />New game</button>
        </div>
      )}
      {body}
      <Toasts />
    </div>
  );
}
