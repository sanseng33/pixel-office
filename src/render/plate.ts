import {
  COLUMN_LINES,
  PLATE_SIZE,
  PLATE_SRC,
  ROOF_EDGE,
  SIGN_BOARD,
  isoPoint,
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
  kind: PropKind;
  phase: number;
  dual: boolean;
}

interface Actor {
  floor: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  pose: Pose;
  home: Pose;
  timer: number;
  phase: number;
  seed: number;
  role: number;
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

function scatter(
  cfg: FloorConfig,
  kind: PropKind,
  count: number,
  gap: number,
  add: (floor: number, x: number, y: number, kind: PropKind, dual?: boolean) => void,
  dual = false,
): void {
  const box = bounds(cfg);
  const placed: Vec2[] = [];
  for (let y = box.minY + 16; y <= box.maxY - 12 && placed.length < count; y += gap * 0.72) {
    const shift = ((y / gap) | 0) % 2 === 0 ? 0 : gap * 0.45;
    for (let x = box.minX + 18 + shift; x <= box.maxX - 16 && placed.length < count; x += gap) {
      const p = { x, y };
      if (!pointInPolygon(p, cfg.polygon)) continue;
      if (placed.some((q) => Math.hypot(q.x - x, q.y - y) < gap * 0.8)) continue;
      placed.push(p);
      add(cfg.level, x, y, kind, dual);
    }
  }
}

function buildProps(floors: readonly FloorConfig[]): Prop[] {
  const props: Prop[] = [];
  let phase = 0;
  const add = (floor: number, x: number, y: number, kind: PropKind, dual = false) => {
    props.push({ floor, x, y, kind, phase: phase++, dual });
  };
  for (const cfg of floors) {
    if (cfg.type === 'sales' || cfg.type === 'it' || cfg.type === 'rnd') {
      scatter(cfg, 'desk', Math.min(cfg.stations, 14), 46, add, cfg.type === 'rnd');
    }
    const put = (fx: number, fy: number, kind: PropKind) => {
      const p = spot(cfg, fx, fy);
      if (p) add(cfg.level, p.x, p.y, kind);
    };
    if (cfg.type === 'sales') {
      put(0.78, 0.62, 'gong');
      put(0.42, 0.22, 'board');
    }
    if (cfg.type === 'it') {
      put(0.84, 0.35, 'rack');
      put(0.92, 0.58, 'rack');
    }
    if (cfg.type === 'rnd' && cfg.level === 7) put(0.8, 0.55, 'lab');
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
      scatter(cfg, 'ghost', 10, 58, add);
      put(0.25, 0.7, 'cone');
      put(0.55, 0.4, 'cone');
      put(0.8, 0.65, 'cone');
    }
  }
  return props;
}

function randomInside(floor: FloorConfig, seed: number): Vec2 {
  let s = seed >>> 0;
  const box = bounds(floor);
  for (let n = 0; n < 40; n++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const x = box.minX + 14 + ((s % 1000) / 1000) * (box.maxX - box.minX - 28);
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const y = box.minY + 12 + ((s % 1000) / 1000) * (box.maxY - box.minY - 24);
    if (pointInPolygon({ x, y }, floor.polygon)) return { x, y };
  }
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

function buildActors(floors: readonly FloorConfig[], props: readonly Prop[]): Actor[] {
  const actors: Actor[] = [];
  let seed = 11;
  const add = (floor: number, x: number, y: number, pose: Pose, role: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    actors.push({
      floor,
      x,
      y,
      tx: x,
      ty: y,
      pose,
      home: pose,
      timer: 1 + (seed % 5) * 0.4,
      phase: (seed % 20) / 5,
      seed,
      role,
    });
  };
  for (const cfg of floors) {
    const desks = props.filter((p) => p.floor === cfg.level && p.kind === 'desk');
    const seated = Math.round(desks.length * cfg.occupancy);
    for (let i = 0; i < seated; i++) {
      const desk = desks[i];
      if (!desk) continue;
      const pose: Pose = cfg.type === 'sales' && i === 0 ? 'phone' : 'sit';
      add(cfg.level, desk.x, desk.y + 16, pose, 0);
    }
    if (cfg.type === 'lounge') {
      const pong = props.find((p) => p.floor === cfg.level && p.kind === 'pong');
      if (pong) {
        add(cfg.level, pong.x - 12, pong.y + 4, 'swing', 3);
        add(cfg.level, pong.x + 12, pong.y + 4, 'swing', 3);
      }
      const sofa = props.find((p) => p.floor === cfg.level && p.kind === 'sofa');
      if (sofa) add(cfg.level, sofa.x + 8, sofa.y + 8, 'chat', 3);
    }
    if (cfg.type === 'lobby') {
      for (let i = 0; i < cfg.people; i++) {
        const p = randomInside(cfg, 40 + i * 17);
        add(cfg.level, p.x, p.y, 'walk', 2);
      }
    } else if (cfg.type !== 'vacant') {
      for (let i = 0; i < cfg.people; i++) {
        const p = randomInside(cfg, 90 + cfg.level * 13 + i);
        add(cfg.level, p.x, p.y, 'walk', 1);
      }
    }
  }
  for (const actor of actors) {
    if (actor.home === 'walk') {
      const floor = floors.find((f) => f.level === actor.floor);
      if (!floor) continue;
      const next = randomInside(floor, actor.seed + 3);
      actor.tx = next.x;
      actor.ty = next.y;
    }
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
  g.fillRect(x, y, w, h);
  g.strokeStyle = EDGE;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawProp(g: CanvasRenderingContext2D, prop: Prop, now: number, hot: boolean): void {
  const { x, y } = prop;
  const blink = ((now / 220) | 0) + prop.phase;
  if (prop.kind === 'desk' || prop.kind === 'ghost') {
    g.globalAlpha = prop.kind === 'ghost' ? 0.35 : 1;
    strokeBox(g, x - 14, y - 5, 28, 10);
    const on = hot || blink % 5 === 0;
    const screen = (sx: number) => {
      g.fillStyle = on ? WHITE : SCREEN;
      g.fillRect(sx, y - 16, 8, 9);
      g.strokeStyle = EDGE;
      g.strokeRect(sx - 0.5, y - 16.5, 9, 10);
    };
    if (prop.dual) {
      screen(x - 10);
      screen(x + 1);
    } else {
      screen(x - 5);
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
  const bob = actor.pose === 'walk' ? Math.abs(Math.sin(actor.phase * 8)) * 2 : actor.pose === 'sit' ? 0 : Math.sin(actor.phase * 3) * 0.6;
  const y = actor.y - bob;
  const x = actor.x;
  const typing = actor.pose === 'sit' || actor.pose === 'phone';
  const arm = typing ? Math.sin(actor.phase * 10) * 2 : 0;
  g.lineWidth = 1;
  g.strokeStyle = '#062038';
  g.fillStyle = GLOW;
  const step = actor.pose === 'walk' ? Math.sin(actor.phase * 8) * 2 : 0;
  g.fillRect(x - 4, y - 10, 3, 10);
  g.fillRect(x + 1 + step, y - 10, 3, 10);
  g.strokeRect(x - 4.5, y - 10.5, 4, 11);
  g.strokeRect(x + 0.5 + step, y - 10.5, 4, 11);
  g.fillRect(x - 6, y - 20, 12, 10);
  g.strokeRect(x - 6.5, y - 20.5, 13, 11);
  if (typing) {
    g.fillStyle = WHITE;
    g.fillRect(x - 7, y - 14 + arm, 3, 2);
    g.fillRect(x + 4, y - 14 - arm, 3, 2);
  }
  g.fillStyle = WHITE;
  g.fillRect(x - 3, y - 26, 7, 6);
  g.strokeStyle = EDGE;
  g.strokeRect(x - 3.5, y - 26.5, 8, 7);
  if (actor.pose === 'phone') {
    g.fillStyle = SCREEN;
    g.fillRect(x + 4, y - 22, 3, 5);
  }
  if (actor.pose === 'cheer' || actor.pose === 'swing') {
    g.strokeStyle = WHITE;
    g.beginPath();
    g.moveTo(x - 6, y - 20);
    g.lineTo(x - 10, y - 28);
    g.moveTo(x + 6, y - 20);
    g.lineTo(x + 10, y - 28);
    g.stroke();
  }
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

  function stepActors(dt: number): void {
    for (const actor of actors) {
      actor.phase += dt;
      actor.timer -= dt;
      const floor = byLevel(actor.floor);
      if (!floor) continue;
      if (actor.pose === 'walk' || actor.home === 'walk') {
        const dx = actor.tx - actor.x;
        const dy = actor.ty - actor.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1.2) {
          actor.x = actor.tx;
          actor.y = actor.ty;
          const next = randomInside(floor, (actor.seed + (actor.phase * 10) | 0) >>> 0);
          actor.tx = next.x;
          actor.ty = next.y;
          actor.seed = (Math.imul(actor.seed, 1664525) + 1013904223) >>> 0;
          if (actor.role === 1 && actor.seed % 11 === 0) {
            const other = floors.find((f) => f.level === actor.floor + (actor.seed % 2 === 0 ? 1 : -1));
            if (other) {
              const hop = randomInside(other, actor.seed);
              actor.floor = other.level;
              actor.x = hop.x;
              actor.y = hop.y;
              actor.tx = hop.x;
              actor.ty = hop.y;
            }
          }
        } else {
          const step = Math.min(18 * dt, dist);
          const nx = actor.x + (dx / dist) * step;
          const ny = actor.y + (dy / dist) * step;
          if (pointInPolygon({ x: nx, y: ny }, floor.polygon)) {
            actor.x = nx;
            actor.y = ny;
          } else {
            const next = randomInside(floor, actor.seed + 9);
            actor.tx = next.x;
            actor.ty = next.y;
          }
        }
        actor.pose = 'walk';
      } else if (actor.timer <= 0 && actor.pose !== 'swing') {
        actor.seed = (Math.imul(actor.seed, 1664525) + 1013904223) >>> 0;
        if (actor.home === 'sit' && actor.seed % 7 === 0) {
          const next = randomInside(floor, actor.seed);
          actor.tx = next.x;
          actor.ty = next.y;
          actor.pose = 'walk';
          actor.timer = 3;
        } else {
          actor.pose = actor.home;
          actor.timer = 1.5 + (actor.seed % 4);
        }
      }
      if (actor.pose === 'cheer' && actor.timer <= 0) {
        actor.pose = actor.home;
        actor.timer = 2;
      }
    }
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
      const items: { y: number; draw: () => void }[] = [];
      for (const prop of props) {
        if (prop.floor !== floor.level) continue;
        items.push({ y: prop.y, draw: () => drawProp(ctx, prop, now, hot) });
      }
      for (const actor of actors) {
        if (actor.floor !== floor.level) continue;
        if (!pointInPolygon({ x: actor.x, y: actor.y }, floor.polygon)) continue;
        items.push({ y: actor.y, draw: () => drawActor(ctx, actor) });
      }
      items.sort((a, b) => a.y - b.y);
      for (const item of items) item.draw();
      ctx.restore();
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
      for (let u = 0; u < 8; u++) {
        for (let v = 0; v < 5; v++) {
          const p = isoPoint(floor, u, v);
          if (!pointInPolygon(p, floor.polygon)) continue;
          g.fillRect(p.x, p.y, 2, 2);
        }
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
      stepActors(Math.min(0.05, dt));
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
          const box = bounds(floor);
          const door = { x: box.minX + (box.maxX - box.minX) * 0.32, y: box.maxY - 16 };
          const dest = randomInside(floor, who.seed + 4);
          if (pointInPolygon(door, floor.polygon)) {
            who.x = door.x;
            who.y = door.y;
          }
          who.tx = dest.x;
          who.ty = dest.y;
          who.pose = 'walk';
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
