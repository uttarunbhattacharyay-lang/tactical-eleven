import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, X, AlertTriangle, Lightbulb, ThumbsUp, Info } from 'lucide-react';
import { useStore } from '../store';
import type { ClientMsg } from '../../shared/protocol';
import type { Snapshot, TeamId } from '../../shared/types';
import { assistantTips, type Tip } from '../../shared/assistant';
import { cx } from './ui';

const TONE: Record<Tip['tone'], { icon: JSX.Element; cls: string }> = {
  warn: { icon: <AlertTriangle className="h-4 w-4 text-amber-300" />, cls: 'border-amber-300/40 bg-amber-300/[0.07]' },
  idea: { icon: <Lightbulb className="h-4 w-4 text-sky-300" />, cls: 'border-sky-300/40 bg-sky-300/[0.07]' },
  good: { icon: <ThumbsUp className="h-4 w-4 text-emerald-300" />, cls: 'border-emerald-300/40 bg-emerald-300/[0.07]' },
  info: { icon: <Info className="h-4 w-4 text-slate-300" />, cls: 'border-white/10 bg-white/[0.04]' },
};

/** At half-time only board changes are allowed: a strategy switch becomes a tactics change, live orders are dropped. */
function htAction(msg: ClientMsg | undefined): ClientMsg | undefined | null {
  if (!msg || msg.t !== 'order') return msg;
  if (msg.order.kind === 'tactics') return msg;
  if (msg.order.kind === 'strategy') return { t: 'order', order: { kind: 'tactics', patch: { strategy: msg.order.strategy } } };
  return null;
}

/**
 * "Assistant Manager": situational advice read from the live match (vs CPU only).
 * Tips can be dismissed (they stay hidden for 10 match minutes) and many come with a one-click action.
 */
export function AssistantManager({ snap, onTab, halftime, max = 3, className }: { snap: Snapshot; onTab?: (tab: 'cmd' | 'squad' | 'tac' | 'opp') => void; halftime?: boolean; max?: number; className?: string }) {
  const { view, roster, events, send } = useStore();
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const [fresh, setFresh] = useState(false);
  const me = (view?.seat ?? 0) as TeamId;
  const bucket = Math.floor(snap.tick / 5); // re-evaluate a couple of times per second, not every frame
  const tacKey = JSON.stringify([view?.tactics?.strategy, view?.tactics?.buildUp, view?.tactics?.ipPts, view?.opp?.tactics?.strategy]);
  const tips = useMemo(() => (view?.mode === 'cpu'
    ? assistantTips({ snap, me, myTac: view.tactics, oppTac: view.opp?.tactics ?? null, roster, events, halftime })
    : []), [bucket, events.length, tacKey, halftime, view?.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = tips.filter((t) => !(t.id in dismissed && snap.minute - dismissed[t.id] < 10)).slice(0, max);
  const topId = visible[0]?.id;
  const prevTop = useRef<string | undefined>(undefined);
  useEffect(() => { // briefly highlight a new urgent tip
    if (topId && prevTop.current && topId !== prevTop.current && (visible[0]?.priority ?? 0) >= 6) { setFresh(true); const t = setTimeout(() => setFresh(false), 3500); prevTop.current = topId; return () => clearTimeout(t); }
    prevTop.current = topId;
  }, [topId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (view?.mode !== 'cpu') return null; // assistant only in matches against the CPU
  const dismiss = (id: string) => setDismissed((d) => ({ ...d, [id]: snap.minute }));
  return (
    <section className={cx('panel p-3 transition-shadow', fresh && 'shadow-[0_0_0_2px_rgba(250,204,21,0.6)]', className)}>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"><ClipboardList className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold uppercase leading-none tracking-wide text-white">Assistant Manager</h3>
          <div className="text-[11px] text-slate-400">{halftime ? 'Half-time team talk' : `Reading the game · ${snap.label}`}</div>
        </div>
      </div>
      <div className="space-y-2">
        {visible.map((t, i) => {
          const msg = halftime ? htAction(t.action?.msg) : t.action?.msg;
          const showAction = t.action && msg !== null && (msg || (t.action.tab && onTab));
          return (
            <div key={t.id} className={cx('rounded-lg border p-2', TONE[t.tone].cls, i > 0 && 'opacity-90')}>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">{TONE[t.tone].icon}</span>
                <div className="min-w-0 flex-1">
                  <div className={cx('font-semibold text-white', i === 0 ? 'text-sm' : 'text-xs')}>{t.title}</div>
                  <p className={cx('leading-snug text-slate-300', i === 0 ? 'text-xs' : 'text-[11px]')}>“{t.text}”</p>
                  {showAction && (
                    <button className="btn btn-ghost mt-1.5 px-2 py-1 text-xs" onClick={() => {
                      if (msg) { send(msg); dismiss(t.id); } else if (t.action!.tab) onTab?.(t.action!.tab);
                    }}>{t.action!.label}</button>
                  )}
                </div>
                {t.id !== 'calm' && <button onClick={() => dismiss(t.id)} title="Dismiss" className="rounded p-0.5 text-slate-500 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
