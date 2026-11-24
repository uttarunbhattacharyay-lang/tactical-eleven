import { L, W, clamp } from '../types';

/** Minimal movement-aware player view; used by the engine and by client-side overlays. */
export interface SP {
  team: 0 | 1;
  x: number; y: number; vx: number; vy: number;
  speed: number; // max physical speed m/s
  int: number; // interception / tackling skill 0..1
}

export const GW = 21;
export const GH = 14;

function reach(p: SP, x: number, y: number): number {
  const dx = x - p.x, dy = y - p.y;
  const d = Math.hypot(dx, dy) + 1e-6;
  const along = (p.vx * dx + p.vy * dy) / d;
  const deff = Math.max(0.25 * d, d - 0.3 * along);
  return deff / Math.max(3, p.speed) + 0.1;
}

/** Space-control grid: probability-like dominance of team 0 (1) vs team 1 (0) per cell, from time-to-reach. */
export class SpatialEvaluator {
  ctrl = new Float32Array(GW * GH).fill(0.5);
  update(ps: SP[]) {
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const cx = ((gx + 0.5) / GW) * L, cy = ((gy + 0.5) / GH) * W;
        let t0 = 99, t1 = 99;
        for (const p of ps) {
          const t = reach(p, cx, cy);
          if (p.team === 0) { if (t < t0) t0 = t; } else if (t < t1) t1 = t;
        }
        this.ctrl[gy * GW + gx] = 1 / (1 + Math.exp(-(t1 - t0) * 1.7));
      }
    }
  }
  /** control of `team` at a point, 0..1 */
  at(team: 0 | 1, x: number, y: number): number {
    const gx = clamp(Math.floor((x / L) * GW), 0, GW - 1), gy = clamp(Math.floor((y / W) * GH), 0, GH - 1);
    const c = this.ctrl[gy * GW + gx];
    return team === 0 ? c : 1 - c;
  }
}

export function pressureAt(x: number, y: number, opps: SP[]): number {
  let s = 0;
  for (const o of opps) {
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < 8) s += Math.pow(1 - d / 8, 1.3) * (0.6 + 0.4 * o.int);
  }
  return Math.min(1.5, s);
}

const sig = (v: number) => 1 / (1 + Math.exp(-v));

/**
 * Probability that a pass along the segment from->to survives opponents (time-to-reach vs ball arrival time).
 * `lofted` passes only risk opponents near the landing zone.
 */
export function laneClear(fx: number, fy: number, tx: number, ty: number, passSpeed: number, opps: SP[], lofted: boolean): { p: number; gap: number } {
  const dx = tx - fx, dy = ty - fy;
  const len2 = dx * dx + dy * dy, len = Math.sqrt(len2) + 1e-6;
  let p = 1, gap = 99;
  for (const o of opps) {
    let u = ((o.x - fx) * dx + (o.y - fy) * dy) / len2;
    u = clamp(u, 0, 1);
    if (lofted && u < 0.85) continue;
    const cx = fx + dx * u, cy = fy + dy * u;
    const dperp = Math.hypot(o.x - cx, o.y - cy);
    gap = Math.min(gap, dperp);
    const tb = (u * len) / passSpeed;
    const to = Math.max(0, dperp - 0.8) / (o.speed * 0.85) + 0.15;
    const cut = sig((tb - to) * 4) * (0.35 + 0.65 * o.int) * (lofted ? 0.6 : 1);
    p *= 1 - cut * 0.9;
  }
  return { p, gap };
}
