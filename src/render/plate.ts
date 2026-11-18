import {
  COLUMN_LINES,
  PLATE_SIZE,
  PLATE_SRC,
  ROOF_EDGE,
  SIGN_BOARD,
  lipAt,
  pointInPolygon,
} from '../config/floors.ts';
import type { FloorConfig, Vec2 } from '../config/floors.ts';
import type { OfficeEvent, OfficeEventType } from '../events/source.ts';

const NAVY = '#071428';
const EDGE = '#b7e4ff';
const GLOW = '#7ec8ff';
const WHITE = '#f4fbff';
const SCREEN = '#e7f7ff';

type Pose = 'sit' | 'walk' | 'phone' | 'chat' | 'swing' | 'cheer';
type PropKind =
  | 'desk'
  | 'ghost'
  | 'gong'
  | 'kpi'
  | 'rack'
  | 'board'
  | 'lab'
  | 'pong'
  | 'bar'
  | 'stool'
  | 'sofa'
  | 'reception'
  | 'gate'
  | 'plant'
  | 'cone';

interface Prop {
  floor: number;
  x: number;
  y: number;
  u: number;
  v: number;
  kind: PropKind;
  phase: number;
  dual: boolean;
}

interface Actor {
  floor: number;
  x: number;
  y: number;
  u: number;
  v: number;
  tu: number;
  tv: number;
  pose: Pose;
  home: Pose;
  timer: number;
  phase: number;
  seed: number;
  role: number;
  desk: number;
  axis: 0 | 1;
}

export interface PlateView {
  canvas: HTMLCanvasElement;
  el: HTMLElement;
  update(dt: number, now: number): void;
  resize(displayPx: number): void;
  push(event: OfficeEvent): void;
  levelsFor(type: OfficeEventType): number[];
  setHour(hour: number): void;
}

const GLYPH: Record<string, string[]> = {
  A: ['01110', '10001', '11111', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000'],
  G: ['01111', '10000', '10111', '10001', '01111'],
  I: ['11111', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '11110', '10000', '10000'],
  R: ['11110', '10001', '11110', '10100', '10010'],
  S: ['01111', '10000', '01110', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '01010', '00100'],
  Y: ['10001', '01010', '00100', '00100', '00100'],
  '&': ['01010', '10101', '01010', '10101', '01010'],
  '1': ['00100', '01100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00110', '01000', '11111'],
  '3': ['11110', '00001', '01110', '00001', '11110'],
  '4': ['10001', '10001', '11111', '00001', '00001'],
  '5': ['11111', '10000', '11110', '00001', '11110'],
  '6': ['01110', '10000', '11110', '10001', '01110'],
  '7': ['11111', '00010', '00100', '01000', '01000'],
  ' ': ['00000', '00000', '00000', '00000', '00000'],
  a: ['00000', '01110', '00001', '01111', '10001'],
  t: ['00100', '01110', '00100', '00100', '00011'],
  n: ['00000', '10110', '11001', '10001', '10001'],
  p: ['00000', '11110', '10001', '11110', '10000'],
};

function paintText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: string,
): void {
  g.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    const rows = GLYPH[ch] ?? GLYPH[ch.toUpperCase()] ?? GLYPH[' '];
    for (let r = 0; r < (rows?.length ?? 0); r++) {
      const row = rows?.[r] ?? '';
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== '1') continue;
        g.fillRect(cx + c * scale, y + r * scale, scale, scale);
      }
    }
    cx += 6 * scale;
  }
}

function bounds(floor: FloorConfig): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = 9999;
  let maxX = 0;
  let minY = 9999;
  let maxY = 0;
  for (const p of floor.polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function spot(floor: FloorConfig, fx: number, fy: number): Vec2 | null {
  const box = bounds(floor);
  const x = box.minX + fx * (box.maxX - box.minX);
  const y = box.minY + fy * (box.maxY - box.minY);
  if (pointInPolygon({ x, y }, floor.polygon)) return { x, y };
  for (let r = 10; r <= 50; r += 10) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, r]] as const) {
      const q = { x: x + dx, y: y + dy };
      if (pointInPolygon(q, floor.polygon)) return q;
    }
  }
  return null;
}

function frontAt(edge: readonly Vec2[], x: number): number {
  return lipAt(edge, x);
}

/** 把楼板坐标 (u 沿前缘, v 朝观众) 映到屏幕。v=0 在前缘内侧。 */
function onFloor(cfg: FloorConfig, u: number, v: number): Vec2 {
  const lip = cfg.edges[0] ?? [];
  const x = 305 + u * 52;
  const y = frontAt(lip, x) - 24 - v * 22;
  return { x, y };
}

function placeIso(
  cfg: FloorConfig,
  kind: PropKind,
  add: (floor: number, x: number, y: number, kind: PropKind, u: number, v: number, dual?: boolean) => void,
  dual = false,
): void {
  // 两排，中间是过道。u 从楼梯右侧铺到楼的右缘。
  for (const v of [0, 1]) {
    for (let u = 0; u < 10; u++) {
      const p = onFloor(cfg, u, v);
      if (p.x < 300 || p.x > 830) continue;
      if (!pointInPolygon(p, cfg.polygon)) continue;
      const lip = cfg.edges[0];
      if (lip && frontAt(lip, p.x) - p.y < 16) continue;
      add(cfg.level, p.x, p.y, kind, u, v, dual);
    }
  }
}

function buildProps(floors: readonly FloorConfig[]): Prop[] {
  const props: Prop[] = [];
  let phase = 0;
  const add = (floor: number, x: number, y: number, kind: PropKind, u = 0, v = 0, dual = false) => {
    props.push({ floor, x, y, u, v, kind, phase: phase++, dual });
  };
  for (const cfg of floors) {
    if (cfg.type === 'sales' || cfg.type === 'it' || cfg.type === 'rnd') {
      placeIso(cfg, 'desk', add, cfg.type === 'rnd');
    }
    const put = (fx: number, fy: number, kind: PropKind) => {
      const p = spot(cfg, fx, fy);
      if (p) add(cfg.level, p.x, p.y, kind);
    };
    const edge = cfg.edges[0];
    const onLip = (x: number, inset: number, kind: PropKind) => {
      if (!edge) return;
      const p = { x, y: frontAt(edge, x) - inset };
      if (pointInPolygon(p, cfg.polygon)) add(cfg.level, p.x, p.y, kind);
    };
    if (cfg.type === 'sales') {
      onLip(300, 46, 'board');
      onLip(812, 30, 'gong');
    }
    if (cfg.type === 'it') {
      onLip(828, 26, 'rack');
      onLip(828, 52, 'rack');
    }
    if (cfg.type === 'rnd' && cfg.level === 7) onLip(790, 64, 'lab');
    if (cfg.type === 'lounge') {
      put(0.22, 0.32, 'sofa');
      put(0.48, 0.28, 'sofa');
      put(0.78, 0.5, 'bar');
      put(0.7, 0.68, 'stool');
      put(0.82, 0.7, 'stool');
      put(0.9, 0.62, 'stool');
      put(0.38, 0.7, 'pong');
      put(0.3, 0.55, 'plant');
      put(0.58, 0.48, 'plant');
      put(0.12, 0.62, 'plant');
    }
    if (cfg.type === 'lobby') {
      put(0.5, 0.42, 'reception');
      put(0.28, 0.28, 'kpi');
      put(0.72, 0.26, 'kpi');
      put(0.36, 0.72, 'gate');
      put(0.18, 0.55, 'plant');
      put(0.62, 0.6, 'plant');
      put(0.84, 0.4, 'plant');
    }
    if (cfg.type === 'vacant') {
      placeIso(cfg, 'ghost', add);
      onLip(300, 40, 'cone');
      onLip(520, 36, 'cone');
      onLip(760, 32, 'cone');
    }
  }
  return props;
}

function buildActors(floors: readonly FloorConfig[], props: readonly Prop[]): Actor[] {
  const actors: Actor[] = [];
  let seed = 11;
  const add = (cfg: FloorConfig, u: number, v: number, pose: Pose, role: number, desk = -1) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const p = onFloor(cfg, u, v);
    actors.push({
      floor: cfg.level,
      x: p.x,
      y: p.y,
      u,
      v,
      tu: u,
      tv: v,
      pose,
      home: pose,
      timer: 1.5 + (seed % 5) * 0.6,
      phase: (seed % 20) / 5,
      seed,
      role,
      desk,
      axis: 0,
    });
  };
  for (const cfg of floors) {
    const desks = props
      .map((p, index) => ({ p, index }))
      .filter((item) => item.p.floor === cfg.level && item.p.kind === 'desk');
    const seated = Math.round(desks.length * cfg.occupancy);
    const order = desks.map((_, i) => i);
    let mix = cfg.level * 97 + 11;
    for (let i = order.length - 1; i > 0; i--) {
      mix = (Math.imul(mix, 1664525) + 1013904223) >>> 0;
      const j = mix % (i + 1);
      const swap = order[i] ?? 0;
      order[i] = order[j] ?? 0;
      order[j] = swap;
    }
    for (let i = 0; i < seated; i++) {
      const pick = desks[order[i] ?? 0];
      if (!pick) continue;
      const pose: Pose = cfg.type === 'sales' && i === 0 ? 'phone' : 'sit';
      add(cfg, pick.p.u, pick.p.v, pose, 0, pick.index);
    }
    const walkers = Math.min(3, cfg.people);
    for (let i = 0; i < walkers; i++) {
      const u = 1 + ((cfg.level * 3 + i * 4) % 7);
      add(cfg, u, 0.45, 'walk', cfg.type === 'lobby' ? 2 : 1);
    }
  }
  for (const actor of actors) {
    if (actor.home !== 'walk') continue;
    actor.tu = (actor.seed % 8) + 0.2;
    actor.tv = 0.45;
  }
  return actors;
}

interface Run {
  level: number;
  pts: readonly Vec2[];
  dist: number[];
  total: number;
}

function prepareRun(level: number, pts: readonly Vec2[]): Run | null {
  if (pts.length < 2) return null;
  const dist = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    total += Math.hypot(b.x - a.x, b.y - a.y);
    dist.push(total);
  }
  if (total < 8) return null;
  return { level, pts, dist, total };
}

function pointAlong(run: Run, distance: number): Vec2 {
  const total = run.total;
  let d = distance % total;
  if (d < 0) d += total;
  let i = 1;
  while (i < run.dist.length - 1 && (run.dist[i] ?? 0) < d) i += 1;
  const a = run.pts[i - 1];
  const b = run.pts[i] ?? a;
  if (!a || !b) return { x: 0, y: 0 };
  const start = run.dist[i - 1] ?? 0;
  const span = (run.dist[i] ?? start) - start || 1;
  const u = (d - start) / span;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

function drawRun(g: CanvasRenderingContext2D, run: Run, now: number, hot: boolean): void {
  const packets = hot ? 5 : 3;
  const speed = hot ? 110 : 62;
  const head = ((now / 1000) * speed) % run.total;
  for (let p = 0; p < packets; p++) {
    const lead = head - p * (run.total / packets);
    for (let k = 7; k >= 0; k--) {
      const q = pointAlong(run, lead - k * 5);
      const fade = 1 - k / 8;
      const alpha = fade * (hot ? 1 : 0.8);
      g.fillStyle = k === 0 ? `rgba(244,251,255,${alpha})` : `rgba(150,214,255,${alpha * 0.55})`;
      g.beginPath();
      g.arc(q.x, q.y, k === 0 ? 2.4 : 1.5, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function strokeBox(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = NAVY;
  g.strokeStyle = EDGE;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w * 0.72, y + h * 0.42);
  g.lineTo(x + w * 0.95, y - h * 0.12);
  g.lineTo(x + w * 0.22, y - h * 0.5);
  g.closePath();
  g.fill();
  g.stroke();
}

function drawProp(g: CanvasRenderingContext2D, prop: Prop, now: number, hot: boolean): void {
  const { x, y } = prop;
  const blink = ((now / 220) | 0) + prop.phase;
  if (prop.kind === 'desk' || prop.kind === 'ghost') {
    g.globalAlpha = prop.kind === 'ghost' ? 0.32 : 1;
    g.fillStyle = NAVY;
    g.strokeStyle = EDGE;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x - 11, y - 1);
    g.lineTo(x + 7, y + 6);
    g.lineTo(x + 13, y + 1);
    g.lineTo(x - 5, y - 6);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(x - 3, y + 6);
    g.lineTo(x + 4, y + 9);
    g.lineTo(x + 6, y + 6);
    g.lineTo(x - 1, y + 3);
    g.closePath();
    g.stroke();
    const on = prop.kind === 'desk' && (hot || blink % 5 === 0);
    const screen = (sx: number, sy: number) => {
      g.fillStyle = on ? WHITE : SCREEN;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx + 5, sy + 2);
      g.lineTo(sx + 5, sy - 3);
      g.lineTo(sx, sy - 5);
      g.closePath();
      g.fill();
      g.stroke();
    };
    if (prop.dual) {
      screen(x - 6, y - 8);
      screen(x + 1, y - 9);
    } else {
      screen(x - 2, y - 8);
    }
    g.globalAlpha = 1;
    return;
  }
  if (prop.kind === 'rack') {
    strokeBox(g, x - 7, y - 20, 14, 26);
    for (let row = 0; row < 5; row++) {
      g.fillStyle = (blink + row) % 3 === 0 ? WHITE : GLOW;
      g.fillRect(x - 4, y - 16 + row * 4, 3, 3);
      g.fillRect(x + 1, y - 16 + row * 4, 3, 3);
    }
    return;
  }
  if (prop.kind === 'gong') {
    g.strokeStyle = EDGE;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y - 14);
    g.stroke();
    g.beginPath();
    g.arc(x, y - 18, 7, 0, Math.PI * 2);
    g.stroke();
    return;
  }
  if (prop.kind === 'kpi' || prop.kind === 'board') {
    const w = prop.kind === 'kpi' ? 36 : 30;
    strokeBox(g, x, y - 16, w, 16);
    g.fillStyle = blink % 4 === 0 ? WHITE : GLOW;
    g.fillRect(x + 3, y - 12, 10, 6);
    return;
  }
  if (prop.kind === 'lab') {
    strokeBox(g, x - 16, y - 6, 32, 10);
    strokeBox(g, x - 5, y - 14, 10, 8);
    return;
  }
  if (prop.kind === 'pong') {
    strokeBox(g, x - 18, y - 9, 36, 18);
    g.strokeStyle = WHITE;
    g.beginPath();
    g.moveTo(x, y - 8);
    g.lineTo(x, y + 8);
    g.stroke();
    return;
  }
  if (prop.kind === 'bar') {
    strokeBox(g, x - 18, y - 8, 36, 12);
    return;
  }
  if (prop.kind === 'stool') {
    strokeBox(g, x - 4, y - 5, 8, 6);
    return;
  }
  if (prop.kind === 'sofa') {
    strokeBox(g, x - 16, y - 7, 32, 12);
    g.strokeStyle = EDGE;
    g.strokeRect(x - 16.5, y - 13.5, 8, 7);
    g.strokeRect(x + 8.5, y - 13.5, 8, 7);
    return;
  }
  if (prop.kind === 'reception') {
    strokeBox(g, x - 18, y - 7, 36, 12);
    return;
  }
  if (prop.kind === 'gate') {
    strokeBox(g, x - 12, y - 10, 4, 12);
    strokeBox(g, x + 8, y - 10, 4, 12);
    g.strokeStyle = EDGE;
    g.beginPath();
    g.moveTo(x - 8, y - 6);
    g.lineTo(x + 8, y - 6);
    g.stroke();
    return;
  }
  if (prop.kind === 'plant') {
    strokeBox(g, x - 4, y - 4, 8, 6);
    g.fillStyle = GLOW;
    g.fillRect(x - 4, y - 12, 8, 8);
    g.strokeStyle = EDGE;
    g.strokeRect(x - 4.5, y - 12.5, 9, 9);
    return;
  }
  if (prop.kind === 'cone') {
    g.strokeStyle = EDGE;
    g.beginPath();
    g.moveTo(x, y - 12);
    g.lineTo(x - 5, y);
    g.lineTo(x + 5, y);
    g.closePath();
    g.stroke();
  }
}

function drawActor(g: CanvasRenderingContext2D, actor: Actor): void {
  const x = actor.x;
  g.lineWidth = 1;
  if (actor.pose === 'sit' || actor.pose === 'phone') {
    const bob = Math.sin(actor.phase * 7) * 0.7;
    const y = actor.y - 7 + bob;
    g.fillStyle = GLOW;
    g.strokeStyle = EDGE;
    g.fillRect(x - 5, y - 5, 10, 4);
    g.strokeRect(x - 5.5, y - 5.5, 11, 5);
    g.fillStyle = WHITE;
    g.fillRect(x - 3, y - 11, 6, 6);
    g.strokeRect(x - 3.5, y - 11.5, 7, 7);
    if (actor.pose === 'phone') {
      g.fillStyle = SCREEN;
      g.fillRect(x + 3, y - 8, 2, 4);
    }
    return;
  }
  const bob = actor.pose === 'walk' ? Math.abs(Math.sin(actor.phase * 6)) * 1.2 : 0;
  const y = actor.y - bob;
  const step = actor.pose === 'walk' ? Math.sin(actor.phase * 6) * 1.5 : 0;
  g.fillStyle = GLOW;
  g.strokeStyle = EDGE;
  g.fillRect(x - 3, y - 8, 2, 8);
  g.fillRect(x + 1 + step, y - 8, 2, 8);
  g.strokeRect(x - 3.5, y - 8.5, 3, 9);
  g.strokeRect(x + 0.5 + step, y - 8.5, 3, 9);
  g.fillRect(x - 5, y - 16, 10, 8);
  g.strokeRect(x - 5.5, y - 16.5, 11, 9);
  g.fillStyle = WHITE;
  g.fillRect(x - 3, y - 22, 6, 6);
  g.strokeRect(x - 3.5, y - 22.5, 7, 7);
}

export function createPlate(configs: readonly FloorConfig[], options?: { debug?: boolean }): PlateView {
  const floors = [...configs].sort((a, b) => a.level - b.level);
  const debug = options?.debug === true;
  const props = buildProps(floors);
  const actors = buildActors(floors, props);
  const runs: Run[] = [];
  for (const floor of floors) {
    for (const edge of floor.edges) {
      const run = prepareRun(floor.level, edge);
      if (run) runs.push(run);
    }
  }
  for (const line of COLUMN_LINES) {
    const run = prepareRun(0, line);
    if (run) runs.push(run);
  }
  const roofRun = prepareRun(8, ROOF_EDGE);
  if (roofRun) runs.push(roofRun);
  const hotUntil = new Float64Array(8);
  let occEpoch = Math.floor(performance.now() / 16_000);

  function reshuffle(now: number): void {
    const epoch = Math.floor(now / 16_000);
    if (epoch === occEpoch) return;
    occEpoch = epoch;
    for (const cfg of floors) {
      const desks = props
        .map((p, index) => ({ p, index }))
        .filter((item) => item.p.floor === cfg.level && item.p.kind === 'desk');
      if (desks.length === 0) continue;
      const order = desks.map((_, i) => i);
      let mix = epoch * 131 + cfg.level * 17;
      for (let i = order.length - 1; i > 0; i--) {
        mix = (Math.imul(mix, 1664525) + 1013904223) >>> 0;
        const j = mix % (i + 1);
        const swap = order[i] ?? 0;
        order[i] = order[j] ?? 0;
        order[j] = swap;
      }
      const want = Math.max(1, Math.round(desks.length * cfg.occupancy));
      const sitters = actors.filter((a) => a.floor === cfg.level && a.role === 0);
      for (let i = 0; i < sitters.length; i++) {
        const actor = sitters[i];
        const pick = desks[order[i] ?? 0];
        if (!actor || !pick || i >= want) continue;
        actor.desk = pick.index;
        actor.home = cfg.type === 'sales' && i === 0 ? 'phone' : 'sit';
        actor.pose = actor.home;
        actor.u = pick.p.u;
        actor.v = pick.p.v;
        actor.tu = pick.p.u;
        actor.tv = pick.p.v;
        const p = onFloor(cfg, actor.u, actor.v);
        actor.x = p.x;
        actor.y = p.y;
      }
    }
  }

  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  wrap.style.lineHeight = '0';
  const base = document.createElement('canvas');
  const overlay = document.createElement('canvas');
  base.style.display = 'block';
  base.style.width = '100%';
  base.style.height = '100%';
  base.style.imageRendering = 'auto';
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.pointerEvents = 'none';
  overlay.style.imageRendering = 'pixelated';
  wrap.append(base, overlay);
  const bg = base.getContext('2d');
  const ctx = overlay.getContext('2d');
  const image = new Image();
  image.src = PLATE_SRC;
  let ready = false;
  let size = PLATE_SIZE;
  let hour = -1;

  const paintBase = () => {
    if (!bg || !ready) return;
    bg.setTransform(1, 0, 0, 1, 0, 0);
    bg.imageSmoothingEnabled = true;
    bg.clearRect(0, 0, size, size);
    bg.drawImage(image, 0, 0, size, size);
  };
  image.onload = () => {
    ready = true;
    paintBase();
  };

  const byLevel = (level: number) => floors.find((f) => f.level === level);

  function stepActors(dt: number, now: number): void {
    reshuffle(now);
    const speed = 20;
    for (const actor of actors) {
      actor.phase += dt;
      if (actor.pose === 'cheer') {
        actor.timer -= dt;
        if (actor.timer <= 0) actor.pose = actor.home;
        continue;
      }
      if (actor.home !== 'walk') continue;
      actor.timer -= dt;
      const floor = byLevel(actor.floor);
      if (!floor) continue;
      const du = actor.tu - actor.u;
      const dv = actor.tv - actor.v;
      if (Math.abs(du) < 0.04 && Math.abs(dv) < 0.04) {
        actor.u = actor.tu;
        actor.v = actor.tv;
        actor.pose = 'chat';
        if (actor.timer <= 0) {
          actor.seed = (Math.imul(actor.seed, 1664525) + 1013904223) >>> 0;
          if (actor.axis === 0) {
            actor.tu = 0.4 + (actor.seed % 80) / 10;
            actor.tv = 0.45;
          } else {
            actor.tu = actor.u;
            actor.tv = actor.seed % 2 === 0 ? 0.05 : 0.9;
            actor.axis = 0;
          }
          if (actor.seed % 3 === 0) actor.axis = 1;
          actor.timer = 2 + (actor.seed % 3);
          actor.pose = 'walk';
        }
      } else {
        const stepU = (speed / 52) * dt;
        const stepV = (speed / 22) * dt;
        if (Math.abs(du) >= 0.04) actor.u += Math.sign(du) * Math.min(stepU, Math.abs(du));
        else actor.v += Math.sign(dv) * Math.min(stepV, Math.abs(dv));
        actor.u = Math.max(0, Math.min(9, actor.u));
        actor.v = Math.max(0, Math.min(1, actor.v));
        actor.pose = 'walk';
      }
      const p = onFloor(floor, actor.u, actor.v);
      if (pointInPolygon(p, floor.polygon)) {
        actor.x = p.x;
        actor.y = p.y;
      }
    }
  }

  function stampPlate(g: CanvasRenderingContext2D, poly: readonly Vec2[]): void {
    if (!ready || poly.length < 3) return;
    g.save();
    g.beginPath();
    const first = poly[0];
    if (first) g.moveTo(first.x, first.y);
    for (let i = 1; i < poly.length; i++) {
      const p = poly[i];
      if (p) g.lineTo(p.x, p.y);
    }
    g.closePath();
    g.clip();
    g.imageSmoothingEnabled = true;
    g.drawImage(image, 0, 0, PLATE_SIZE, PLATE_SIZE);
    g.restore();
  }

  function drawOverlay(now: number): void {
    if (!ctx) return;
    const scale = size / PLATE_SIZE;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const order = [...floors].sort((a, b) => b.level - a.level);
    for (const floor of order) {
      const hot = now < hotUntil[floor.level];
      ctx.save();
      ctx.beginPath();
      const poly = floor.polygon;
      const first = poly[0];
      if (first) ctx.moveTo(first.x, first.y);
      for (let i = 1; i < poly.length; i++) {
        const p = poly[i];
        if (p) ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.clip();
      const items: { depth: number; draw: () => void }[] = [];
      for (const prop of props) {
        if (prop.floor !== floor.level) continue;
        items.push({ depth: prop.u + prop.v, draw: () => drawProp(ctx, prop, now, hot) });
      }
      for (const actor of actors) {
        if (actor.floor !== floor.level) continue;
        if (!pointInPolygon({ x: actor.x, y: actor.y }, floor.polygon)) continue;
        items.push({ depth: actor.u + actor.v + 0.15, draw: () => drawActor(ctx, actor) });
      }
      items.sort((a, b) => a.depth - b.depth);
      for (const item of items) item.draw();
      ctx.restore();
      stampPlate(ctx, floor.mask);
      const above = byLevel(floor.level + 1);
      if (above) stampPlate(ctx, above.mask);
      if (hot && floor.type === 'sales') {
        paintText(ctx, 'DEAL', floor.origin.x + 20, floor.origin.y + 8, 2, WHITE);
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const run of runs) {
      const hot = run.level > 0 && run.level < 8 && now < hotUntil[run.level];
      drawRun(ctx, run, now, hot === true);
    }
    ctx.restore();
    const signScale = 3;
    const signW = 'PatSnap'.length * 6 * signScale;
    const signH = 5 * signScale;
    paintText(
      ctx,
      'PatSnap',
      SIGN_BOARD.x + (SIGN_BOARD.w - signW) / 2,
      SIGN_BOARD.y + (SIGN_BOARD.h - signH) / 2,
      signScale,
      WHITE,
    );
    for (const floor of floors) {
      const block = 5 * 3 + 4 + 5 * 2;
      paintText(ctx, floor.label, floor.labelAt.x, floor.labelAt.y - block / 2, 3, WHITE);
      paintText(ctx, floor.name, floor.labelAt.x, floor.labelAt.y - block / 2 + 19, 2, GLOW);
    }
    if (debug) drawDebug(ctx);
  }

  function drawDebug(g: CanvasRenderingContext2D): void {
    g.save();
    g.lineWidth = 1;
    for (const floor of floors) {
      g.strokeStyle = floor.level % 2 === 0 ? '#ffe14a' : '#ff5ad8';
      g.beginPath();
      const poly = floor.polygon;
      const first = poly[0];
      if (first) g.moveTo(first.x, first.y);
      for (let i = 1; i < poly.length; i++) {
        const p = poly[i];
        if (p) g.lineTo(p.x, p.y);
      }
      g.closePath();
      g.stroke();
      g.fillStyle = '#ffe14a';
      for (let u = 0; u < 10; u++) {
        for (const v of [0, 0.45, 1]) {
          const p = onFloor(floor, u, v);
          if (!pointInPolygon(p, floor.polygon)) continue;
          g.fillRect(p.x - 1, p.y - 1, 2, 2);
        }
      }
      g.fillStyle = '#ffffff';
      for (const prop of props) {
        if (prop.floor !== floor.level) continue;
        if (prop.kind !== 'desk' && prop.kind !== 'ghost') continue;
        g.fillRect(prop.x - 2, prop.y - 2, 4, 4);
      }
      g.fillStyle = '#ffffff';
      g.fillRect(floor.labelAt.x - 2, floor.labelAt.y - 2, 4, 4);
      paintText(g, String(floor.level), floor.origin.x, floor.origin.y, 2, '#ffe14a');
      g.strokeStyle = '#7dffb2';
      g.lineWidth = 1;
      for (const edge of floor.edges) {
        g.beginPath();
        const a0 = edge[0];
        if (a0) g.moveTo(a0.x, a0.y);
        for (let i = 1; i < edge.length; i++) {
          const p = edge[i];
          if (p) g.lineTo(p.x, p.y);
        }
        g.stroke();
      }
    }
    g.strokeStyle = '#7dffb2';
    for (const line of COLUMN_LINES) {
      g.beginPath();
      const a0 = line[0];
      if (a0) g.moveTo(a0.x, a0.y);
      for (let i = 1; i < line.length; i++) {
        const p = line[i];
        if (p) g.lineTo(p.x, p.y);
      }
      g.stroke();
    }
    g.beginPath();
    const r0 = ROOF_EDGE[0];
    if (r0) g.moveTo(r0.x, r0.y);
    for (let i = 1; i < ROOF_EDGE.length; i++) {
      const p = ROOF_EDGE[i];
      if (p) g.lineTo(p.x, p.y);
    }
    g.closePath();
    g.stroke();
    g.strokeStyle = '#ff5ad8';
    g.strokeRect(SIGN_BOARD.x, SIGN_BOARD.y, SIGN_BOARD.w, SIGN_BOARD.h);
    g.restore();
  }

  return {
    canvas: overlay,
    el: wrap,
    resize(displayPx: number) {
      size = Math.max(1, displayPx);
      base.width = size;
      base.height = size;
      overlay.width = size;
      overlay.height = size;
      paintBase();
    },
    update(dt: number, now: number) {
      stepActors(Math.min(0.05, dt), now);
      drawOverlay(now);
    },
    push(ev: OfficeEvent) {
      const now = performance.now();
      hotUntil[ev.level] = now + ev.ttlMs;
      if (ev.type === 'dealClosed' || ev.type === 'deploySuccess') {
        const who = actors.find((a) => a.floor === ev.level && (a.home === 'sit' || a.home === 'phone'));
        if (who) {
          who.pose = 'cheer';
          who.timer = ev.ttlMs / 1000;
        }
      }
      if (ev.type === 'visitorArrived') {
        const floor = byLevel(ev.level);
        const who = actors.find((a) => a.floor === ev.level && a.role === 2);
        if (floor && who) {
          who.u = 1;
          who.v = 0.45;
          who.tu = 6;
          who.tv = 0.45;
          who.pose = 'walk';
          who.timer = 0.4;
          const p = onFloor(floor, who.u, who.v);
          who.x = p.x;
          who.y = p.y;
        }
      }
    },
    levelsFor(type: OfficeEventType) {
      if (type === 'dealClosed') return floors.filter((f) => f.type === 'sales').map((f) => f.level);
      if (type === 'deploySuccess') {
        return floors.filter((f) => f.type === 'it' || f.type === 'rnd').map((f) => f.level);
      }
      return floors.filter((f) => f.type === 'lobby').map((f) => f.level);
    },
    setHour(h: number) {
      if (h === hour) return;
      hour = h;
      const night = h >= 20 || h < 6;
      const dusk = !night && (h >= 17 || h < 7);
      base.style.filter = night ? 'brightness(0.72)' : dusk ? 'brightness(0.86)' : 'none';
    },
  };
}
