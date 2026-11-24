import { useRef, useState } from 'react';
import type { PlayerCard, Pt } from '../../shared/types';
import { fitAt, zoneOf } from '../../shared/formations';

const toSvg = ([d, l]: Pt) => ({ x: d * 105, y: 34 + l * 30 });
const fromSvg = (x: number, y: number): Pt => [Math.min(0.96, Math.max(0.1, x / 105)), Math.min(1.08, Math.max(-1.08, (y - 34) / 30))];
const lastName = (n: string) => n.split(' ').slice(-1)[0];

/**
 * Mini pitch where every outfield player can be dragged anywhere (the keeper stays in goal).
 * Our team always attacks to the right. Click a player (without dragging) to select / inspect.
 */
export function FormationBoard({ pts, players, tint, selectedId, onSelect, onDrop, readOnly, absent }: {
  pts: Pt[]; players: (PlayerCard | undefined)[]; tint: string; selectedId?: string | null;
  onSelect?: (slot: number) => void; onDrop?: (slot: number, pt: Pt) => void; readOnly?: boolean; absent?: boolean[];
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ slot: number; pt: Pt; moved: boolean; sx: number; sy: number } | null>(null);
  const toLocal = (e: React.PointerEvent) => {
    const m = svg.current!.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const down = (slot: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (readOnly || slot === 0 || absent?.[slot]) { onSelect?.(slot); return; }
    svg.current!.setPointerCapture(e.pointerId);
    setDrag({ slot, pt: pts[slot], moved: false, sx: e.clientX, sy: e.clientY });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4;
    if (!moved) return;
    const { x, y } = toLocal(e);
    setDrag({ ...drag, moved, pt: fromSvg(x, y) });
  };
  const up = () => {
    if (!drag) return;
    if (drag.moved) onDrop?.(drag.slot, drag.pt); else onSelect?.(drag.slot);
    setDrag(null);
  };
  const line = '#ffffff55';
  return (
    <svg ref={svg} viewBox="-2 -1 109 70" className="w-full touch-none select-none rounded-lg bg-emerald-900/60" onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      <rect x="0" y="0" width="105" height="68" fill="none" stroke={line} strokeWidth=".4" />
      <line x1="52.5" y1="0" x2="52.5" y2="68" stroke={line} strokeWidth=".4" />
      <circle cx="52.5" cy="34" r="9.15" fill="none" stroke={line} strokeWidth=".4" />
      <rect x="0" y="13.84" width="16.5" height="40.32" fill="none" stroke={line} strokeWidth=".4" />
      <rect x="88.5" y="13.84" width="16.5" height="40.32" fill="none" stroke={line} strokeWidth=".4" />
      <text x="100" y="66" textAnchor="end" fontSize="2.6" fill="#ffffff66">attacking →</text>
      {pts.map((base, slot) => {
        const p = players[slot];
        if (!p) return null;
        const pt = drag && drag.slot === slot ? drag.pt : base;
        const { x, y } = toSvg(pt);
        const zone = zoneOf(pt);
        const fit = slot === 0 ? 1 : fitAt(p.pos, pt);
        const sel = selectedId === p.id, isDrag = drag?.slot === slot && drag.moved;
        const gone = absent?.[slot];
        return (
          <g key={p.id} onPointerDown={down(slot)} className={readOnly || slot === 0 ? 'cursor-pointer' : 'cursor-grab'} opacity={gone ? 0.35 : 1}>
            <circle cx={x} cy={y} r={isDrag ? 4.4 : 3.7} fill={tint} stroke={sel ? '#fde047' : fit < 0.8 ? '#f87171' : fit < 0.95 ? '#fbbf24' : '#0b1220'} strokeWidth={sel ? 1 : fit < 0.95 ? 0.7 : 0.5} />
            <text x={x} y={y + 1.25} textAnchor="middle" fontSize="3.3" fontWeight="700" fill="#fff" pointerEvents="none">{p.number || '?'}</text>
            <text x={x} y={y + 7.1} textAnchor="middle" fontSize="2.5" fill="#e2e8f0" pointerEvents="none">{lastName(p.name).slice(0, 11)}</text>
            <text x={x} y={y - 4.6} textAnchor="middle" fontSize="2.2" fontWeight="700" fill={fit < 0.8 ? '#fca5a5' : fit < 0.95 ? '#fcd34d' : '#a7f3d0'} pointerEvents="none">{zone}</text>
          </g>
        );
      })}
    </svg>
  );
}
