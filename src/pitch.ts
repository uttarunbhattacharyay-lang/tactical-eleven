import { L, W, F_BALL, F_ABSENT, F_PRESS, F_SPRINT, F_YELLOW, F_ORDER, type PlayerCard, type PlayerSnap, type Snapshot } from '../shared/types';
import { SpatialEvaluator, GW, GH, laneClear, type SP } from '../shared/engine/spatial';

export const TEAM_COLORS = [
  { fill: '#1d4ed8', gk: '#0e7490', soft: '#60a5fa', css: '#3b82f6' },
  { fill: '#be185d', gk: '#a16207', soft: '#f9a8d4', css: '#ec4899' },
];
export const STAMINA = { fresh: [0x22, 0xc5, 0x5e], mid: [0xea, 0xb3, 0x08], dead: [0xef, 0x44, 0x44] };

/** Smooth green (#22C55E) -> amber (#EAB308) -> red (#EF4444) exhaustion gradient. */
export function staminaColor(en: number): string {
  const e = Math.max(0, Math.min(1, en));
  const [a, b, t] = e >= 0.5 ? [STAMINA.mid, STAMINA.fresh, (e - 0.5) / 0.5] : [STAMINA.dead, STAMINA.mid, e / 0.5];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export interface Overlays { lanes: boolean; space: boolean; line: boolean; press: boolean }
export interface Scene {
  a0?: Snapshot | null; a: Snapshot; b: Snapshot; alpha: number;
  selected?: string | null;
  roster: Map<string, PlayerCard>;
  overlays: Overlays;
  mySeat: 0 | 1;
  hover: number | null;
}
const PAD = 3.2;
const ease = (a: number, b: number, t: number) => a + (b - a) * t;
/** cubic Hermite between p0 and p1 with tangents m0, m1 */
const herm = (p0: number, p1: number, m0: number, m1: number, t: number) => {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
};

export class PitchRenderer {
  ctx: CanvasRenderingContext2D;
  w = 0; h = 0; s = 1; dpr = 1;
  spatial = new SpatialEvaluator();
  private lastSpaceTick = -1;
  tokens: { x: number; y: number; r: number; idx: number }[] = [];

  constructor(private canvas: HTMLCanvasElement) { this.ctx = canvas.getContext('2d')!; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr); this.canvas.height = Math.round(r.height * this.dpr);
    this.s = Math.min(this.w / (L + PAD * 2), this.h / (W + PAD * 2));
  }
  private X(x: number) { return (this.w - L * this.s) / 2 + x * this.s; }
  private Y(y: number) { return (this.h - W * this.s) / 2 + y * this.s; }

  pickAt(px: number, py: number): number | null {
    let best: number | null = null, bd = 1e9;
    for (const t of this.tokens) { const d = Math.hypot(t.x - px, t.y - py); if (d < t.r + 5 && d < bd) { bd = d; best = t.idx; } }
    return best;
  }

  drawPitch() {
    const c = this.ctx, s = this.s;
    const x0 = this.X(0), y0 = this.Y(0);
    // surround
    c.fillStyle = '#071a12'; c.fillRect(0, 0, this.w, this.h);
    // grass stripes
    const n = 14;
    for (let i = 0; i < n; i++) { c.fillStyle = i % 2 ? '#0d4a31' : '#0b4029'; c.fillRect(x0 + (L / n) * i * s, y0, (L / n) * s + 1, W * s); }
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = Math.max(1.2, s * 0.14);
    const R = (x: number, y: number, w: number, h: number) => c.strokeRect(this.X(x), this.Y(y), w * s, h * s);
    R(0, 0, L, W);
    c.beginPath(); c.moveTo(this.X(L / 2), this.Y(0)); c.lineTo(this.X(L / 2), this.Y(W)); c.stroke();
    c.beginPath(); c.arc(this.X(L / 2), this.Y(W / 2), 9.15 * s, 0, Math.PI * 2); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.arc(this.X(L / 2), this.Y(W / 2), s * 0.28, 0, 7); c.fill();
    for (const side of [0, 1]) {
      const bx = side ? L - 16.5 : 0, sx = side ? L - 5.5 : 0;
      R(bx, 13.84, 16.5, 40.32); R(sx, 24.84, 5.5, 18.32);
      const spot = side ? L - 11 : 11;
      c.beginPath(); c.arc(this.X(spot), this.Y(W / 2), s * 0.26, 0, 7); c.fill();
      c.beginPath(); c.arc(this.X(spot), this.Y(W / 2), 9.15 * s, side ? Math.PI * 0.69 : -Math.PI * 0.31, side ? Math.PI * 1.31 : Math.PI * 0.31); c.stroke();
      // goals
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.fillRect(side ? this.X(L) : this.X(-2), this.Y(30.34), 2 * s, 7.32 * s);
      c.strokeRect(side ? this.X(L) : this.X(-2), this.Y(30.34), 2 * s, 7.32 * s);
      c.fillStyle = 'rgba(255,255,255,0.7)';
    }
    for (const [cx, cy, a0] of [[0, 0, 0], [L, 0, Math.PI / 2], [L, W, Math.PI], [0, W, -Math.PI / 2]] as const) {
      c.beginPath(); c.arc(this.X(cx), this.Y(cy), s, a0, a0 + Math.PI / 2); c.stroke();
    }
  }

  private interp(sc: Scene): { p: PlayerSnap[]; ball: { x: number; y: number; z: number }; vel: [number, number][] } {
    const { a, b, alpha, a0 } = sc;
    const p: PlayerSnap[] = []; const vel: [number, number][] = [];
    for (let i = 0; i < b.p.length; i++) {
      const q = b.p[i], o = a.p[i], o0 = a0?.p[i];
      if (o && o.id === q.id && !(q.f & F_ABSENT)) {
        // Hermite curve through the previous two ticks: removes the zig-zag of straight-line segments
        const smooth = o0 && o0.id === q.id && Math.hypot(q.x - o.x, q.y - o.y) < 6 && Math.hypot(o.x - o0.x, o.y - o0.y) < 6;
        const x = smooth ? herm(o.x, q.x, (q.x - o0!.x) / 2, q.x - o.x, alpha) : ease(o.x, q.x, alpha);
        const y = smooth ? herm(o.y, q.y, (q.y - o0!.y) / 2, q.y - o.y, alpha) : ease(o.y, q.y, alpha);
        p.push({ id: q.id, x, y, en: ease(o.en, q.en, alpha), f: q.f });
        vel.push([(q.x - o.x) * 10, (q.y - o.y) * 10]);
      } else { p.push(q); vel.push([0, 0]); }
    }
    return { p, ball: { x: ease(a.ball.x, b.ball.x, alpha), y: ease(a.ball.y, b.ball.y, alpha), z: ease(a.ball.z, b.ball.z, alpha) }, vel };
  }

  render(sc: Scene) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawPitch();
    const { p, ball, vel } = this.interp(sc);
    const s = this.s;
    const snap = sc.b;
    const sp = this.buildSP(sc, p, vel);
    if (sc.overlays.space) this.drawSpace(sc, sp, snap.tick);
    if (sc.overlays.line) this.drawLines(p, snap);
    if (sc.overlays.press) this.drawPress(p, ball, snap);
    if (sc.overlays.lanes) this.drawLanes(sc, p, sp);
    // restart marker
    if (snap.restart) {
      c.strokeStyle = 'rgba(250,204,21,.9)'; c.lineWidth = 2; c.setLineDash([4, 4]);
      c.beginPath(); c.arc(this.X(snap.restart.x), this.Y(snap.restart.y), 1.8 * s, 0, 7); c.stroke(); c.setLineDash([]);
      c.fillStyle = 'rgba(250,204,21,.95)'; c.font = `600 ${Math.max(10, s * 1.1)}px Inter`; c.textAlign = 'center';
      c.fillText(snap.restart.kind.toUpperCase(), this.X(snap.restart.x), this.Y(snap.restart.y) - 2.6 * s);
    }
    // tokens
    this.tokens = [];
    const r = Math.max(9, s * 1.35);
    const order = p.map((_, i) => i).sort((i, j) => p[i].y - p[j].y);
    for (const i of order) {
      const q = p[i]; if (q.f & F_ABSENT) continue;
      const team = i < 11 ? 0 : 1, slot = i % 11;
      const card = sc.roster.get(q.id);
      const px = this.X(q.x), py = this.Y(q.y);
      this.tokens.push({ x: px, y: py, r, idx: i });
      c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(px + 2, py + r * 0.85, r * 0.9, r * 0.35, 0, 0, 7); c.fill();
      c.fillStyle = slot === 0 ? TEAM_COLORS[team].gk : TEAM_COLORS[team].fill;
      c.beginPath(); c.arc(px, py, r, 0, 7); c.fill();
      // exhaustion ring
      c.lineWidth = Math.max(3, r * 0.3); c.strokeStyle = staminaColor(q.en);
      c.beginPath(); c.arc(px, py, r, 0, 7); c.stroke();
      if (q.f & F_SPRINT) { c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.5; c.beginPath(); c.arc(px, py, r + 4, 0, 7); c.stroke(); }
      if (q.f & F_ORDER) { c.fillStyle = '#c084fc'; c.beginPath(); c.arc(px - r * 0.85, py - r * 0.85, r * 0.26, 0, 7); c.fill(); }
      if (q.f & F_YELLOW) { c.fillStyle = '#facc15'; c.fillRect(px + r * 0.55, py - r * 1.25, r * 0.5, r * 0.7); }
      if (sc.selected && sc.selected === q.id) { c.strokeStyle = '#fde047'; c.lineWidth = 3; c.beginPath(); c.arc(px, py, r + 6, 0, 7); c.stroke(); }
      else if (sc.hover === i) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(px, py, r + 5, 0, 7); c.stroke(); }
      c.fillStyle = '#fff'; c.font = `700 ${Math.round(r * 1.02)}px "Barlow Condensed", Inter, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(card?.number ?? slot + 1), px, py + 0.5);
      c.textBaseline = 'alphabetic';
      if (r > 10) { c.fillStyle = sc.mySeat === team ? 'rgba(255,255,255,.75)' : 'rgba(251,207,232,.75)'; c.font = `500 ${Math.max(9, s * 0.95)}px Inter`; c.fillText((card?.name.split(' ').slice(-1)[0] ?? '').slice(0, 10), px, py + r + 11); }
    }
    // ball
    const bx = this.X(ball.x), by = this.Y(ball.y);
    c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(bx + 1, by + 3, s * 0.45, s * 0.22, 0, 0, 7); c.fill();
    c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(bx, by - ball.z * s * 0.35, Math.max(4, s * 0.5) * (1 + ball.z * 0.05), 0, 7); c.fill(); c.stroke();
  }

  private buildSP(sc: Scene, p: PlayerSnap[], vel: [number, number][]): SP[] {
    const out: SP[] = [];
    for (let i = 0; i < p.length; i++) {
      const q = p[i]; if (q.f & F_ABSENT) continue;
      const card = sc.roster.get(q.id);
      const pace = card?.skills.pace ?? 60;
      out.push({ team: i < 11 ? 0 : 1, x: q.x, y: q.y, vx: vel[i][0], vy: vel[i][1], speed: (6.4 + pace * 0.034) * (0.72 + 0.28 * Math.pow(q.en, 0.7)), int: ((card?.skills.tackling ?? 55) * 0.6 + (card?.skills.positioning ?? 55) * 0.4) / 100 });
    }
    return out;
  }

  private drawSpace(sc: Scene, sp: SP[], tick: number) {
    if (tick !== this.lastSpaceTick || tick === 0) { this.spatial.update(sp); this.lastSpaceTick = tick; }
    const c = this.ctx, s = this.s;
    const cw = (L / GW) * s, ch = (W / GH) * s;
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const v = this.spatial.ctrl[gy * GW + gx];
      const t = v > 0.5 ? 0 : 1; const a = Math.abs(v - 0.5) * 0.62;
      c.fillStyle = t === 0 ? `rgba(59,130,246,${a})` : `rgba(236,72,153,${a})`;
      c.fillRect(this.X(0) + gx * cw, this.Y(0) + gy * ch, cw + 0.5, ch + 0.5);
    }
  }

  private drawLines(p: PlayerSnap[], snap: Snapshot) {
    const c = this.ctx, s = this.s;
    for (const team of [0, 1] as const) {
      const d = snap.dir[team];
      const defs: PlayerSnap[] = [];
      for (let k = 0; k < 11; k++) { const q = p[team * 11 + k]; if (!(q.f & F_ABSENT)) defs.push(q); }
      const depth = (q: PlayerSnap) => (d === 1 ? q.x : L - q.x);
      const sorted = [...defs].sort((a, b) => depth(a) - depth(b));
      const second = sorted[1] ?? sorted[0]; if (!second) continue;
      const outfield = sorted.filter((q) => q.id !== p[team * 11].id);
      const line = outfield.slice(0, 4).sort((a, b) => a.y - b.y);
      c.strokeStyle = TEAM_COLORS[team].soft; c.lineWidth = 2; c.setLineDash([8, 6]);
      c.beginPath(); c.moveTo(this.X(second.x), this.Y(0)); c.lineTo(this.X(second.x), this.Y(W)); c.stroke(); c.setLineDash([]);
      c.fillStyle = TEAM_COLORS[team].soft; c.font = `600 ${Math.max(10, s)}px Inter`; c.textAlign = 'center';
      c.fillText('OFFSIDE LINE', this.X(second.x), this.Y(team === 0 ? 3.5 : W - 2));
      c.strokeStyle = TEAM_COLORS[team].soft; c.lineWidth = 3; c.globalAlpha = 0.55; c.beginPath();
      line.forEach((q, i) => (i ? c.lineTo(this.X(q.x), this.Y(q.y)) : c.moveTo(this.X(q.x), this.Y(q.y)))); c.stroke(); c.globalAlpha = 1;
    }
  }

  private drawPress(p: PlayerSnap[], ball: { x: number; y: number }, snap: Snapshot) {
    const c = this.ctx, s = this.s;
    const carrierIdx = snap.ball.owner ? p.findIndex((q) => q.id === snap.ball.owner) : -1;
    for (let i = 0; i < p.length; i++) {
      const q = p[i]; if (!(q.f & F_PRESS)) continue;
      const px = this.X(q.x), py = this.Y(q.y);
      c.strokeStyle = 'rgba(248,113,113,.9)'; c.lineWidth = 2; c.setLineDash([5, 4]);
      c.beginPath(); c.arc(px, py, 2.6 * s, 0, 7); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.moveTo(px, py); c.lineTo(this.X(ball.x), this.Y(ball.y)); c.strokeStyle = 'rgba(248,113,113,.55)'; c.stroke();
    }
    if (carrierIdx >= 0) {
      const team = carrierIdx < 11 ? 0 : 1;
      const pressers = p.filter((q, i) => (q.f & F_PRESS) && (i < 11 ? 0 : 1) !== team).length;
      const q = p[carrierIdx];
      const edge = Math.min(q.y, W - q.y) < 14;
      if (pressers >= 1) {
        const g = c.createRadialGradient(this.X(q.x), this.Y(q.y), 0, this.X(q.x), this.Y(q.y), 11 * s);
        g.addColorStop(0, 'rgba(239,68,68,.35)'); g.addColorStop(1, 'rgba(239,68,68,0)');
        c.fillStyle = g; c.beginPath(); c.arc(this.X(q.x), this.Y(q.y), 11 * s, 0, 7); c.fill();
        if (edge) { c.fillStyle = 'rgba(239,68,68,.22)'; const top = q.y < 34; c.fillRect(this.X(Math.max(0, q.x - 14)), this.Y(top ? 0 : W - 14), 28 * s, 14 * s); c.fillStyle = '#fecaca'; c.font = `700 ${Math.max(10, s)}px Inter`; c.textAlign = 'center'; c.fillText('TOUCHLINE TRAP', this.X(q.x), this.Y(top ? 12 : W - 12)); }
      }
    }
  }

  private drawLanes(sc: Scene, p: PlayerSnap[], sp: SP[]) {
    const c = this.ctx;
    const owner = sc.b.ball.owner; if (!owner) return;
    const oi = p.findIndex((q) => q.id === owner); if (oi < 0) return;
    const team = oi < 11 ? 0 : 1; const me = p[oi];
    const opps = sp.filter((q) => q.team !== team);
    const cardO = sc.roster.get(owner);
    const eff = ((cardO?.skills.passing ?? 60) * 0.62 + (cardO?.skills.composure ?? 60) * 0.16 + (cardO?.skills.touch ?? 60) * 0.22) / 100;
    for (let k = 0; k < 11; k++) {
      const i = team * 11 + k; if (i === oi) continue; const q = p[i]; if (q.f & F_ABSENT) continue;
      const dist = Math.hypot(q.x - me.x, q.y - me.y); if (dist < 3) continue;
      const lofted = dist > 36;
      const { p: pc } = laneClear(me.x, me.y, q.x, q.y, (lofted ? 19 : 13.5) + eff * (lofted ? 7 : 10), opps, lofted);
      const prob = pc * Math.max(0.2, Math.min(0.98, 0.74 + 0.3 * eff - dist * 0.0035));
      const col = prob > 0.7 ? '34,197,94' : prob > 0.45 ? '234,179,8' : '239,68,68';
      c.strokeStyle = `rgba(${col},${0.35 + prob * 0.5})`; c.lineWidth = 1 + prob * 3;
      if (lofted) c.setLineDash([7, 5]);
      c.beginPath(); c.moveTo(this.X(me.x), this.Y(me.y)); c.lineTo(this.X(q.x), this.Y(q.y)); c.stroke(); c.setLineDash([]);
      c.fillStyle = `rgba(${col},1)`; c.font = '700 11px Inter'; c.textAlign = 'center';
      c.fillText(`${Math.round(prob * 100)}%`, (this.X(me.x) + this.X(q.x)) / 2, (this.Y(me.y) + this.Y(q.y)) / 2 - 3);
    }
  }
}
