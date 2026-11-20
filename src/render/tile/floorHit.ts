/** Pure floor hit-testing and hover timing. No DOM. */

import { HOVER_HIDE_MS, HOVER_SHOW_MS } from '../../config/floorIntros.ts';

export { HOVER_HIDE_MS, HOVER_SHOW_MS };

export type Pt = { x: number; y: number };

export interface FloorHitEntry {
  level: number;
  quads: Pt[][];
}

export interface HoverCtrl {
  hit: number;
  lit: number;
  card: number;
  since: number;
  hideAt: number;
}

export function createHoverCtrl(): HoverCtrl {
  return { hit: 0, lit: 0, card: 0, since: 0, hideAt: 0 };
}

export function feedHover(
  state: HoverCtrl,
  hit: number,
  now: number,
  showMs = HOVER_SHOW_MS,
  hideMs = HOVER_HIDE_MS,
): HoverCtrl {
  const next: HoverCtrl = { ...state };
  if (hit !== 0) {
    next.hideAt = 0;
    if (hit !== state.hit) {
      next.hit = hit;
      next.since = now;
      next.lit = hit;
    } else {
      next.hit = hit;
      next.lit = hit;
    }
    if (now - next.since >= showMs) next.card = hit;
    return next;
  }
  next.hit = 0;
  if (state.hit !== 0 || (state.lit !== 0 && state.hideAt === 0)) next.hideAt = now + hideMs;
  else next.hideAt = state.hideAt;
  if (next.hideAt !== 0 && now >= next.hideAt) {
    next.lit = 0;
    next.card = 0;
    next.since = 0;
    next.hideAt = 0;
  }
  return next;
}

/** Card, guide line and hide clock share `card`; highlight uses `lit`. After hide delay all are 0. */
export function hoverChrome(ctrl: HoverCtrl): { lit: number; card: number; guide: number } {
  return { lit: ctrl.lit, card: ctrl.card, guide: ctrl.card };
}

export interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GUIDE_PAD = 4;

function inflate(r: LabelRect, pad: number): LabelRect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

/** True if the open segment strictly enters the rectangle (touching an edge is not a hit). */
export function segmentIntersectsRect(a: Pt, b: Pt, r: LabelRect): boolean {
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, a.x - x0)) return false;
  if (!clip(dx, x1 - a.x)) return false;
  if (!clip(-dy, a.y - y0)) return false;
  if (!clip(dy, y1 - a.y)) return false;
  const mid = t0 + (t1 - t0) / 2;
  const mx = a.x + mid * dx;
  const my = a.y + mid * dy;
  return mx > x0 && mx < x1 && my > y0 && my < y1;
}

export function polylineHitsRects(points: readonly Pt[], rects: readonly LabelRect[], pad = 0): boolean {
  const boxes = pad ? rects.map((r) => inflate(r, pad)) : rects;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    for (const r of boxes) {
      if (segmentIntersectsRect(a, b, r)) return true;
    }
  }
  return false;
}

function dedupe(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * Elbow / 3-segment polyline from the card exit to the floor lip.
 * Vertical run stays in the gutter left of every label box; the last run
 * is horizontal under the target label, and never crosses the lip into the tower.
 */
export function routeGuideLine(
  from: Pt,
  to: Pt,
  labels: readonly LabelRect[],
  opts?: { pad?: number; lipX?: number },
): Pt[] {
  const pad = opts?.pad ?? GUIDE_PAD;
  const lipX = opts?.lipX ?? to.x;
  const dest: Pt = { x: Math.min(to.x, lipX), y: to.y };
  const labelLeft = labels.length === 0 ? dest.x : Math.min(...labels.map((r) => r.x));
  const channelX = Math.min(labelLeft - pad, dest.x);
  const pts = dedupe([
    { x: from.x, y: from.y },
    { x: channelX, y: from.y },
    { x: channelX, y: dest.y },
    { x: dest.x, y: dest.y },
  ]);
  return pts.length >= 2 ? pts : [from, dest];
}

export function pointInPoly(px: number, py: number, poly: readonly Pt[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    const mid = a.y > py !== b.y > py;
    if (mid && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y + 0.0) + a.x) inside = !inside;
  }
  return inside;
}

export function convexHull(points: readonly Pt[]): Pt[] {
  const uniq = [...points].sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x));
  if (uniq.length <= 2) return uniq;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function hitFloorAt(
  px: number,
  py: number,
  floors: readonly FloorHitEntry[],
  exclude: readonly Pt[][] = [],
): number {
  for (const quad of exclude) {
    if (pointInPoly(px, py, quad)) return 0;
  }
  for (const floor of floors) {
    for (const quad of floor.quads) {
      if (pointInPoly(px, py, quad)) return floor.level;
    }
  }
  return 0;
}

export function cssToLogical(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  frameW: number,
  frameH: number,
): Pt | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (clientX < rect.left || clientX >= rect.left + rect.width) return null;
  if (clientY < rect.top || clientY >= rect.top + rect.height) return null;
  return {
    x: ((clientX - rect.left) * frameW) / rect.width,
    y: ((clientY - rect.top) * frameH) / rect.height,
  };
}

export interface HitBuildOpts {
  gridN: number;
  tileW: number;
  tileH: number;
  zH: number;
  wallZ: number;
  storeyStep: number;
  solid: (x: number, y: number) => boolean;
}

export function buildFloorHitEntries(
  floors: readonly { level: number; originX: number; originY: number }[],
  opts: HitBuildOpts,
): FloorHitEntry[] {
  const { gridN, tileW, tileH, zH, wallZ, storeyStep, solid } = opts;
  const iso = (originX: number, originY: number, x: number, y: number, z: number): Pt => ({
    x: originX + (x - y) * tileW,
    y: originY + (x + y) * tileH - z * zH,
  });
  const ordered = [...floors].sort((a, b) => b.level - a.level);
  const entries: FloorHitEntry[] = [];
  for (const floor of ordered) {
    const z1 = floor.level === 7 ? wallZ : (storeyStep - 1) / zH;
    const quads: Pt[][] = [];
    for (let y = 0; y < gridN; y++) {
      for (let x = 0; x < gridN; x++) {
        if (!solid(x, y)) continue;
        const pts = [
          iso(floor.originX, floor.originY, x, y, 0),
          iso(floor.originX, floor.originY, x + 1, y, 0),
          iso(floor.originX, floor.originY, x + 1, y + 1, 0),
          iso(floor.originX, floor.originY, x, y + 1, 0),
          iso(floor.originX, floor.originY, x, y, z1),
          iso(floor.originX, floor.originY, x + 1, y, z1),
          iso(floor.originX, floor.originY, x + 1, y + 1, z1),
          iso(floor.originX, floor.originY, x, y + 1, z1),
        ];
        quads.push(convexHull(pts));
      }
    }
    entries.push({ level: floor.level, quads });
  }
  return entries;
}

export function buildExcludeQuads(
  originX: number,
  originY: number,
  z1: number,
  opts: HitBuildOpts,
  extra: readonly Pt[][] = [],
): Pt[][] {
  const { gridN, tileW, tileH, zH, solid } = opts;
  const iso = (x: number, y: number, z: number): Pt => ({
    x: originX + (x - y) * tileW,
    y: originY + (x + y) * tileH - z * zH,
  });
  const quads: Pt[][] = [];
  for (let y = 0; y < gridN; y++) {
    for (let x = 0; x < gridN; x++) {
      if (!solid(x, y)) continue;
      quads.push(
        convexHull([
          iso(x, y, 0),
          iso(x + 1, y, 0),
          iso(x + 1, y + 1, 0),
          iso(x, y + 1, 0),
          iso(x, y, z1),
          iso(x + 1, y, z1),
          iso(x + 1, y + 1, z1),
          iso(x, y + 1, z1),
        ]),
      );
    }
  }
  return [...quads, ...extra];
}

