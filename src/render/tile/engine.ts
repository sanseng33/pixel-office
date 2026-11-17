import { Application, Graphics } from 'pixi.js';
import type { FloorConfig } from '../../config/floors.ts';
import { VIEW } from '../../config/display.ts';
import type { OfficeEvent, OfficeEventType } from '../../events/source.ts';
import type { PlateView } from '../plate.ts';
import { PLAN, layoutFor } from './layout.ts';
import type { FloorLayout, Furn } from './layout.ts';

/** Tile is 16×11 so the floor stays near 90% of the width and uses more of the vertical space. 30×16 = 480 of the 540 buffer, scaled ×2 to 1080. */
const HW = 16;
const HH = 11;
const ZH = 14;
const FLOOR_Z = 1.7;
const WALL_Z = 4.6;
const DESK_H = 13;

const NAVY = 0x071422;
const DIM = 0x1c3d62;
const ICE = 0x9ad7ff;
const WHITE = 0xf4fbff;

/** 5×5 glyphs. 7, 5, S and & are drawn so they do not collapse into each other. */
const GLYPH: Record<string, readonly string[]> = {
  A: ['01110', '10001', '11111', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000'],
  N: ['10001', '11001', '10101', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '11110', '10000', '10000'],
  R: ['11110', '10001', '11110', '10100', '10001'],
  S: ['01111', '10000', '01110', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100'],
  '&': ['01100', '10010', '01100', '10010', '01101'],
  '0': ['01110', '10011', '10101', '11001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00110', '01000', '11111'],
  '3': ['11110', '00001', '01110', '00001', '11110'],
  '4': ['10001', '10001', '11111', '00001', '00001'],
  '5': ['11111', '10000', '11110', '00001', '11110'],
  '6': ['01110', '10000', '11110', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000'],
  '8': ['01110', '10001', '01110', '10001', '01110'],
  '9': ['01110', '10001', '01111', '00001', '01110'],
  '/': ['00001', '00010', '00100', '01000', '10000'],
  '.': ['00000', '00000', '00000', '01100', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000'],
};

interface Pt {
  x: number;
  y: number;
}

interface DrawItem {
  key: number;
  draw: (g: Graphics) => void;
}

interface Run {
  pts: Pt[];
  len: number[];
  total: number;
}

interface Person {
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  face: 1 | -1;
  /** Desk span along +x. 1 for anyone not tied to a desk. */
  span: number;
  pose: 'sit' | 'stand' | 'walk' | 'chat';
  path: Pt[];
  hop: number;
  timer: number;
  phase: number;
  seed: number;
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function keyOf(x: number, y: number): number {
  return x + y * PLAN;
}

export async function createTileFloor(
  configs: readonly FloorConfig[],
  options?: { debug?: boolean },
): Promise<PlateView> {
  const shown = configs.find((f) => f.level === 7) ?? configs.find((f) => f.type === 'rnd') ?? configs[0];
  if (!shown) throw new Error('no floor config');
  const layout = layoutFor(shown.type);
  const debug = options?.debug === true;

  const app = new Application();
  await app.init({
    width: VIEW,
    height: VIEW,
    background: NAVY,
    antialias: false,
    resolution: 1,
    autoDensity: false,
    roundPixels: true,
  });
  app.ticker.stop();
  const canvas = app.canvas;
  canvas.style.imageRendering = 'pixelated';
  canvas.style.display = 'block';

  const world = new Graphics();
  const glow = new Graphics();
  glow.blendMode = 'add';
  app.stage.addChild(world);
  app.stage.addChild(glow);

  const wrap = document.createElement('div');
  wrap.style.lineHeight = '0';
  wrap.appendChild(canvas);

  let originX = 0;
  let originY = 0;

  const iso = (x: number, y: number, z = 0): Pt => ({
    x: originX + (x - y) * HW,
    y: originY + (x + y) * HH - z * ZH,
  });

  const boundsOf = () => {
    let minX = 1e9;
    let maxX = -1e9;
    let minY = 1e9;
    let maxY = -1e9;
    const consider = (p: Pt) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    };
    for (let y = 0; y < PLAN; y++) {
      for (let x = 0; x < PLAN; x++) {
        if (!layout.solid(x, y)) continue;
        consider(iso(x, y, FLOOR_Z));
        consider(iso(x + 1, y, 0));
        consider(iso(x, y + 1, 0));
        consider(iso(x + 1, y + 1, 0));
        if (y === 0) {
          consider(iso(x, y, WALL_Z));
          consider(iso(x + 1, y, WALL_Z));
        }
        if (x === 0) {
          consider(iso(x, y, WALL_Z));
          consider(iso(x, y + 1, WALL_Z));
        }
      }
    }
    return { minX, maxX, minY, maxY };
  };

  originX = 0;
  originY = 0;
  const box = boundsOf();
    const headerBlock = 22;
  const contentTop = box.minY - headerBlock;
  const contentBottom = box.maxY + 2;
  originX = Math.round(VIEW / 2 - (box.minX + box.maxX) / 2);
  originY = Math.round(VIEW / 2 - (contentTop + contentBottom) / 2);

  const outline = buildOutline(layout.solid, iso);
  const columns = columnRuns(iso);

  const rand = mulberry(shown.level * 97 + 11);
  const desks = layout.desks.slice();
  for (let i = desks.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = desks[i];
    const b = desks[j];
    if (!a || !b) continue;
    desks[i] = b;
    desks[j] = a;
  }
  const occupiedCount = Math.max(1, Math.round(layout.desks.length * shown.occupancy));
  const people: Person[] = [];
  for (let i = 0; i < occupiedCount; i++) {
    const desk = desks[i];
    if (!desk) continue;
      people.push({
      homeX: desk.x,
      homeY: desk.y,
      x: desk.x,
      y: desk.y,
      fromX: desk.x,
      fromY: desk.y,
      face: desk.face ?? 1,
      span: desk.w,
      pose: 'sit',
      path: [],
      hop: 0,
      timer: 1.6 + i * 0.85,
      phase: rand() * 6,
      seed: (i * 17 + 3) >>> 0,
    });
  }

  let hour = 12;
  let burst = 0;
  const queue: DrawItem[] = [];
  const glowSpots: { x: number; y: number; hot: boolean }[] = [];

  const occupiedAt = (x: number, y: number) =>
    people.some((p) => p.pose === 'sit' && p.x === x && p.y === y && p.path.length === 0);

  function pushDraw(gx: number, gy: number, gz: number, draw: (g: Graphics) => void): void {
    queue.push({ key: (gx + gy) * 100 + gz, draw });
  }

  function paintText(g: Graphics, text: string, x: number, y: number, color: number, scale = 1): void {
    let cx = Math.round(x);
    const top = Math.round(y);
    for (const ch of text) {
      const rows = GLYPH[ch] ?? GLYPH[ch.toUpperCase()] ?? GLYPH[' '];
      if (!rows) {
        cx += 6 * scale;
        continue;
      }
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r] ?? '';
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== '1') continue;
          g.rect(cx + c * scale, top + r * scale, scale, scale).fill({ color });
        }
      }
      cx += 6 * scale;
    }
  }

  function poly(g: Graphics, pts: readonly Pt[], fill: number, fillA: number, stroke?: number, strokeA = 1): void {
    const flat: number[] = [];
    for (const p of pts) flat.push(Math.round(p.x), Math.round(p.y));
    const shape = g.poly(flat, true);
    shape.fill({ color: fill, alpha: fillA });
    if (stroke !== undefined) {
      g.poly(flat, true).stroke({ width: 1, color: stroke, alpha: strokeA, pixelLine: true });
    }
  }

  function tilePts(x: number, y: number, z: number): Pt[] {
    return [iso(x, y, z), iso(x + 1, y, z), iso(x + 1, y + 1, z), iso(x, y + 1, z)];
  }

  function face(x0: number, y0: number, x1: number, y1: number): Pt[] {
    return [iso(x0, y0, FLOOR_Z), iso(x1, y1, FLOOR_Z), iso(x1, y1, 0), iso(x0, y0, 0)];
  }

const HAIR = 0x5aaed4;
const ARM = 0x6eb6e4;
const EYE = 0x14324e;
const LEG = 0x0c3054;
const INK = 0x07111c;

function raise(p: Pt, h: number): Pt {
  return { x: p.x, y: p.y - h };
}

function corners(x0: number, y0: number, x1: number, y1: number, z: number): [Pt, Pt, Pt, Pt] {
  return [iso(x0, y0, z), iso(x1, y0, z), iso(x1, y1, z), iso(x0, y1, z)];
}

function volume(g: Graphics, a: Pt, b: Pt, c: Pt, d: Pt, h0: number, h1: number): void {
  const A = raise(a, h1);
  const B = raise(b, h1);
  const C = raise(c, h1);
  const D = raise(d, h1);
  const b0 = raise(b, h0);
  const c0 = raise(c, h0);
  const d0 = raise(d, h0);
  poly(g, [b0, c0, C, B], INK, 1, ICE, 0.85);
  poly(g, [d0, c0, C, D], INK, 1, ICE, 0.95);
  poly(g, [A, B, C, D], INK, 1, WHITE, 1);
}

function mark(g: Graphics, x: number, y: number, w: number, h: number, fill: number): void {
  g.rect(x - 1, y, 1, h).fill({ color: ICE });
  g.rect(x + w, y, 1, h).fill({ color: ICE });
  g.rect(x, y - 1, w, 1).fill({ color: WHITE });
  g.rect(x, y + h, w, 1).fill({ color: ICE });
  g.rect(x, y, w, h).fill({ color: fill });
}

  function drawHeart(g: Graphics, x: number, y: number): void {
    g.rect(x - 3, y, 2, 2).fill({ color: WHITE });
    g.rect(x + 1, y, 2, 2).fill({ color: WHITE });
    g.rect(x - 3, y + 2, 6, 1).fill({ color: ICE });
    g.rect(x - 2, y + 3, 4, 1).fill({ color: ICE });
    g.rect(x - 1, y + 4, 2, 1).fill({ color: WHITE });
  }

  function drawPerson(g: Graphics, foot: Pt, pose: Person['pose'], phase: number, lit: boolean): void {
    const fx = Math.round(foot.x);
    const fy = Math.round(foot.y);
    if (pose === 'sit') {
      const y = fy;
      mark(g, fx - 5, y - 10, 10, 7, ICE);
      mark(g, fx - 7, y - 9, 2, 5, ARM);
      mark(g, fx + 5, y - 9, 2, 5, ARM);
      mark(g, fx - 3, y - 16, 6, 6, WHITE);
      g.rect(fx - 3, y - 18, 6, 3).fill({ color: HAIR });
      if (lit) g.rect(fx - 2, y - 14, 4, 2).fill({ color: 0xd8f4ff });
      g.rect(fx - 2, y - 14, 1, 1).fill({ color: lit ? 0x123044 : EYE });
      g.rect(fx + 1, y - 14, 1, 1).fill({ color: lit ? 0x123044 : EYE });
      return;
    }
    const frame = pose === 'walk' ? Math.floor(phase * 8) % 4 : 0;
    const liftL = [2, 0, 0, 1][frame] ?? 0;
    const liftR = [0, 1, 2, 0][frame] ?? 0;
    const bob = frame === 1 || frame === 3 ? -1 : 0;
    const y = fy + bob;
    mark(g, fx - 4, y - 12 - liftL, 3, 12, LEG);
    mark(g, fx + 1, y - 12 - liftR, 3, 12, LEG);
    mark(g, fx - 5, y - 21, 10, 9, ICE);
    mark(g, fx - 8, y - 20 + liftR, 3, 7, ARM);
    mark(g, fx + 5, y - 20 + liftL, 3, 7, ARM);
    mark(g, fx - 3, y - 27, 6, 6, WHITE);
    g.rect(fx - 3, y - 29, 6, 4).fill({ color: HAIR });
    g.rect(fx - 2, y - 25, 1, 1).fill({ color: EYE });
    g.rect(fx + 1, y - 25, 1, 1).fill({ color: EYE });
    if (pose === 'chat') drawHeart(g, fx, y - 33);
  }

  function drawArms(g: Graphics, foot: Pt, phase: number): void {
    const fx = Math.round(foot.x);
    const fy = Math.round(foot.y);
    const type = Math.floor(phase * 6) % 2;
    g.rect(fx - 10, fy - 4 + type, 5, 3).fill({ color: ARM });
    g.rect(fx + 5, fy - 4 + (1 - type), 5, 3).fill({ color: ARM });
    g.rect(fx - 9, fy - 4 + type, 5, 1).fill({ color: WHITE });
    g.rect(fx + 5, fy - 4 + (1 - type), 5, 1).fill({ color: WHITE });
  }

  function drawMonitor(g: Graphics, mx: number, my: number, towardCamera: boolean, lit: boolean, now: number): void {
    const center = raise(iso(mx, my, FLOOR_Z), DESK_H + 2);
    const px = Math.round(center.x);
    const py = Math.round(center.y);
    g.rect(px, py + 3, 1, 3).fill({ color: ICE });
    g.rect(px - 3, py - 5, 7, 8).fill({ color: INK });
    g.rect(px - 3, py - 5, 7, 1).fill({ color: lit ? ICE : WHITE });
    g.rect(px - 3, py + 2, 7, 1).fill({ color: ICE });
    g.rect(px - 3, py - 5, 1, 8).fill({ color: ICE });
    g.rect(px + 3, py - 5, 1, 8).fill({ color: ICE });
    if (towardCamera && lit) {
      g.rect(px - 2, py - 4, 5, 5).fill({ color: 0x6eb6dc });
      g.rect(px - 2, py - 4, 3, 1).fill({ color: WHITE });
      const scan = Math.floor(now / 180 + mx * 3) % 4;
      g.rect(px - 2, py - 2 + scan, 5, 1).fill({ color: WHITE });
      glowSpots.push({ x: px, y: py - 1, hot: true });
      return;
    }
    g.rect(px - 2, py - 4, 5, 5).fill({ color: INK });
    if (lit) {
      g.rect(px - 1, py - 4, 3, 1).fill({ color: ICE });
      glowSpots.push({ x: px, y: py + 3, hot: false });
    }
  }

  function drawDesk(g: Graphics, item: Furn): void {
    const face = item.face ?? 1;
    const x = item.x;
    const y = item.y;
    const [a, b, c, d] = corners(x + 0.08, y + 0.16, x + item.w - 0.08, y + 0.84, FLOOR_Z);
    for (const p of [a, b, c, d]) {
      const legTop = raise(p, 4);
      g.rect(Math.round(p.x), Math.round(legTop.y), 1, Math.max(1, Math.round(p.y - legTop.y))).fill({ color: ICE });
    }
    volume(g, a, b, c, d, 4, DESK_H);
    const kx0 = x + 0.55;
    const kx1 = x + item.w - 0.55;
    const ky0 = face === 1 ? y + 0.48 : y + 0.32;
    const ky1 = face === 1 ? y + 0.64 : y + 0.48;
    const [k1, k2, k3, k4] = corners(kx0, ky0, kx1, ky1, FLOOR_Z);
    poly(
      g,
      [raise(k1, DESK_H + 1), raise(k2, DESK_H + 1), raise(k3, DESK_H + 1), raise(k4, DESK_H + 1)],
      INK,
      1,
      ICE,
      1,
    );
    const key = raise(iso((kx0 + kx1) / 2, (ky0 + ky1) / 2, FLOOR_Z), DESK_H + 1);
    const kx = Math.round(key.x);
    const ky = Math.round(key.y);
    g.rect(kx - 4, ky, 2, 1).fill({ color: WHITE });
    g.rect(kx - 1, ky, 2, 1).fill({ color: ICE });
    g.rect(kx + 2, ky, 2, 1).fill({ color: WHITE });
  }

  function drawMonitors(g: Graphics, item: Furn, now: number): void {
    const face = item.face ?? 1;
    const occupied = occupiedAt(item.x, item.y);
    const my = face === 1 ? item.y + 0.18 : item.y + 0.82;
    const screenTowardCamera = face === -1;
    drawMonitor(g, item.x + 0.42, my, screenTowardCamera, occupied, now);
    drawMonitor(g, item.x + 1.58, my, screenTowardCamera, occupied, now);
  }

  function drawChair(g: Graphics, item: Furn): void {
    const face = item.face ?? 1;
    const cx = item.x + item.w / 2;
    const y0 = face === 1 ? item.y + 0.58 : item.y + 0.18;
    const y1 = face === 1 ? item.y + 0.8 : item.y + 0.4;
    const [a, b, c, d] = corners(cx - 0.16, y0, cx + 0.16, y1, FLOOR_Z);
    volume(g, a, b, c, d, 0, 3);
    const by = face === 1 ? y1 - 0.02 : y0 + 0.02;
    const hinge = raise(iso(cx, by, FLOOR_Z), 3);
    const hx = Math.round(hinge.x);
    const hy = Math.round(hinge.y);
    g.rect(hx - 3, hy - 8, 7, 6).fill({ color: INK });
    g.rect(hx - 3, hy - 8, 7, 1).fill({ color: WHITE });
    g.rect(hx - 3, hy - 3, 7, 1).fill({ color: ICE });
    g.rect(hx - 3, hy - 8, 1, 6).fill({ color: ICE });
    g.rect(hx + 3, hy - 8, 1, 6).fill({ color: ICE });
  }

  function drawFurn(g: Graphics, item: Furn, now: number): void {
    if (item.kind === 'desk') {
      drawDesk(g, item);
      return;
    }
    if (item.kind === 'table') {
      const [a, b, c, d] = corners(item.x + 0.08, item.y + 0.22, item.x + item.w - 0.08, item.y + 0.78, FLOOR_Z);
      volume(g, a, b, c, d, 3, 9);
      return;
    }
    if (item.kind === 'plant') {
      const [a, b, c, d] = corners(item.x + 0.34, item.y + 0.34, item.x + 0.66, item.y + 0.66, FLOOR_Z);
      volume(g, a, b, c, d, 0, 4);
      const leaf = raise(iso(item.x + 0.5, item.y + 0.5, FLOOR_Z), 4);
      const lx = Math.round(leaf.x);
      const ly = Math.round(leaf.y);
      g.rect(lx, ly - 4, 1, 4).fill({ color: ICE });
      g.rect(lx - 4, ly - 9, 9, 6).fill({ color: INK });
      g.rect(lx - 4, ly - 9, 9, 1).fill({ color: WHITE });
      g.rect(lx - 4, ly - 4, 9, 1).fill({ color: ICE });
      g.rect(lx - 4, ly - 9, 1, 6).fill({ color: ICE });
      g.rect(lx + 4, ly - 9, 1, 6).fill({ color: ICE });
      g.rect(lx - 2, ly - 12, 5, 3).fill({ color: INK });
      g.rect(lx - 2, ly - 12, 5, 1).fill({ color: WHITE });
      g.rect(lx - 2, ly - 12, 1, 3).fill({ color: ICE });
      g.rect(lx + 2, ly - 12, 1, 3).fill({ color: ICE });
      return;
    }
    const [a, b, c, d] = corners(item.x + 0.06, item.y + 0.16, item.x + item.w - 0.06, item.y + 0.84, FLOOR_Z);
    volume(g, a, b, c, d, 0, 11);
    for (const ux of [0.55, 1.35]) {
      const cup = raise(iso(item.x + ux, item.y + 0.48, FLOOR_Z), 11);
      const cx = Math.round(cup.x);
      const cy = Math.round(cup.y);
      g.rect(cx - 2, cy - 5, 4, 4).fill({ color: INK });
      g.rect(cx - 2, cy - 5, 4, 1).fill({ color: WHITE });
      g.rect(cx - 2, cy - 2, 4, 1).fill({ color: ICE });
      g.rect(cx - 2, cy - 5, 1, 4).fill({ color: ICE });
      g.rect(cx + 1, cy - 5, 1, 4).fill({ color: ICE });
    }
    void now;
  }

  function rebuild(now: number): void {
    queue.length = 0;
    glowSpots.length = 0;
    for (let y = 0; y < PLAN; y++) {
      for (let x = 0; x < PLAN; x++) {
        if (!layout.solid(x, y)) continue;
        const gx = x;
        const gy = y;
        pushDraw(gx, gy, 0, (g) => {
          if (!layout.solid(x, y - 1)) poly(g, face(x, y, x + 1, y), 0x0c243c, 0.9, DIM, 0.35);
          if (!layout.solid(x + 1, y)) poly(g, face(x + 1, y, x + 1, y + 1), 0x0c243c, 0.9, DIM, 0.3);
          if (!layout.solid(x, y + 1)) poly(g, face(x, y + 1, x + 1, y + 1), 0x0e2844, 0.92, DIM, 0.4);
          if (!layout.solid(x - 1, y)) poly(g, face(x, y, x, y + 1), 0x0c243c, 0.9, DIM, 0.3);
        });
        pushDraw(gx, gy, 2, (g) => {
          const mark = (x + y) % 2 === 0;
          poly(g, tilePts(x, y, FLOOR_Z), 0x0a1c33, 0.42, mark ? DIM : undefined, 0.28);
        });
        if (y === 0) {
          pushDraw(gx, gy, 3, (g) => {
            const a = iso(x, y, FLOOR_Z);
            const b = iso(x + 1, y, FLOOR_Z);
            const c = iso(x + 1, y, WALL_Z);
            const d = iso(x, y, WALL_Z);
            poly(g, [a, b, c, d], 0x09182c, 0.92, ICE, 0.45);
          });
        }
        if (x === 0) {
          pushDraw(gx, gy, 4, (g) => {
            const a = iso(x, y, FLOOR_Z);
            const b = iso(x, y + 1, FLOOR_Z);
            const c = iso(x, y + 1, WALL_Z);
            const d = iso(x, y, WALL_Z);
            poly(g, [a, b, c, d], 0x081624, 0.92, ICE, 0.4);
          });
        }
      }
    }
    for (const item of layout.furniture) {
      const frontX = item.x + item.w - 1;
      if (item.kind === 'desk') {
        const face = item.face ?? 1;
        if (face === 1) {
          pushDraw(frontX, item.y, 5, (g) => drawDesk(g, item));
          pushDraw(frontX, item.y, 7, (g) => drawMonitors(g, item, now));
          pushDraw(frontX, item.y, 8, (g) => drawChair(g, item));
        } else {
          pushDraw(frontX, item.y, 3, (g) => drawChair(g, item));
          pushDraw(frontX, item.y, 6, (g) => drawDesk(g, item));
          pushDraw(frontX, item.y, 9, (g) => drawMonitors(g, item, now));
        }
        continue;
      }
      pushDraw(frontX, item.y, 6, (g) => drawFurn(g, item, now));
    }
    for (const person of people) {
      const atDesk = person.pose === 'sit';
      const alongSeat = person.face === 1 ? 0.72 : 0.28;
      const gx = atDesk ? person.homeX + person.span - 1 : Math.round(person.x);
      const gy = atDesk ? person.homeY : Math.round(person.y);
      const z = atDesk ? (person.face === 1 ? 10 : 4) : 12;
      pushDraw(gx, gy, z, (g) => {
        const along = atDesk ? alongSeat : 0.5;
        const across = atDesk ? person.span / 2 : 0.5;
        const ox = atDesk ? person.homeX : person.x;
        const oy = atDesk ? person.homeY : person.y;
        const floorPt = iso(ox + across, oy + along, FLOOR_Z);
        const foot = atDesk ? raise(floorPt, DESK_H - 2) : floorPt;
        drawPerson(g, foot, person.pose, person.phase, atDesk);
      });
      if (atDesk) {
        pushDraw(gx, gy, person.face === 1 ? 12 : 5, (g) => {
          const along = person.face === 1 ? 0.72 : 0.28;
          const floorPt = iso(person.homeX + person.span / 2, person.homeY + along, FLOOR_Z);
          drawArms(g, raise(floorPt, DESK_H - 2), person.phase);
        });
      }
    }
    queue.sort((a, b) => a.key - b.key);
    world.clear();
    for (const item of queue) item.draw(world);
    strokeLoop(world, outline, ICE);
    const seated = people.filter((p) => p.pose === 'sit').length;
    const wallTop = iso(0, 0, WALL_Z).y;
    const headerY = Math.max(4, Math.round(wallTop) - 30);
    paintText(world, `PATSNAP . 7F R&D`, 8, headerY, WHITE, 3);
    paintText(world, `SEAT ${seated}/${layout.desks.length}  ON ${people.length}`, 8, headerY + 18, ICE, 2);

    glow.clear();
    for (const spot of glowSpots) {
      if (spot.hot) {
        glow.rect(spot.x - 3, spot.y - 3, 6, 6).fill({ color: ICE, alpha: 0.28 });
      } else {
        glow.rect(spot.x - 2, spot.y - 1, 4, 2).fill({ color: ICE, alpha: 0.22 });
      }
    }
    const hot = now < burst;
    drawPulses(glow, outline, now, hot ? 78 : 46, hot ? 5 : 4);
    for (const column of columns) drawPulses(glow, column, now + 180, 34, 2);
    if (hour >= 20 || hour < 6) {
      world.rect(0, 0, VIEW, VIEW).fill({ color: 0x02060c, alpha: 0.28 });
    }
    if (debug) {
      for (let y = 0; y < PLAN; y++) {
        for (let x = 0; x < PLAN; x++) {
          if (!layout.solid(x, y)) continue;
          const c = iso(x + 0.5, y + 0.5, FLOOR_Z);
          world.rect(Math.round(c.x), Math.round(c.y), 1, 1).fill({ color: layout.walkable(x, y) ? 0xffe14a : 0xff5ad8 });
        }
      }
    }
    app.render();
  }

  function stepPeople(dt: number): void {
    let moving = people.filter((p) => p.pose !== 'sit').length;
    for (const person of people) {
      person.phase += dt;
      if (person.pose === 'sit') {
        person.timer -= dt;
        if (person.timer <= 0 && moving < 4) {
          const goal = pickGoal(person, people);
          const path = route(layout, { x: person.homeX, y: person.homeY }, goal);
          if (path.length > 1) {
            person.pose = 'stand';
            person.timer = 0.35;
            person.path = path.slice(1);
            person.hop = 0;
            person.fromX = person.x;
            person.fromY = person.y;
            moving += 1;
          } else {
            person.timer = 4;
          }
        }
        continue;
      }
      if (person.pose === 'stand') {
        person.timer -= dt;
        if (person.timer <= 0) person.pose = 'walk';
        continue;
      }
      if (person.pose === 'chat') {
        person.timer -= dt;
        if (person.timer <= 0) sendHome(person);
        continue;
      }
      const next = person.path[0];
      if (!next) {
        arrive(person);
        continue;
      }
      if (person.hop === 0) {
        person.fromX = person.x;
        person.fromY = person.y;
      }
      person.hop += dt;
      const t = Math.min(1, person.hop);
      person.x = person.fromX + (next.x - person.fromX) * t;
      person.y = person.fromY + (next.y - person.fromY) * t;
      if (person.hop >= 1) {
        person.x = next.x;
        person.y = next.y;
        person.hop = 0;
        person.path.shift();
        if (person.path.length === 0) arrive(person);
      }
    }
  }

  function arrive(person: Person): void {
    const atHome = person.x === person.homeX && person.y === person.homeY;
    const chatting = layout.chat.some((c) => c.x === person.x && c.y === person.y);
    if (atHome) {
      person.pose = 'sit';
      person.timer = 5 + (person.seed % 5);
      return;
    }
    if (chatting) {
      const friend = people.find(
        (other) => other !== person && other.pose !== 'sit' && layout.chat.some((c) => c.x === other.x && c.y === other.y),
      );
      if (friend) {
        person.pose = 'chat';
        friend.pose = 'chat';
        person.timer = 3.2;
        friend.timer = 3.2;
        return;
      }
      person.pose = 'chat';
      person.timer = 1.4;
      return;
    }
    sendHome(person);
  }

  function sendHome(person: Person): void {
    const path = route(layout, { x: person.x, y: person.y }, { x: person.homeX, y: person.homeY });
    person.path = path.slice(1);
    person.hop = 0;
    person.pose = person.path.length > 0 ? 'walk' : 'sit';
    if (person.pose === 'sit') person.timer = 6;
  }

  function pickGoal(person: Person, all: readonly Person[]): Pt {
    person.seed = (Math.imul(person.seed, 1664525) + 1013904223) >>> 0;
    const chatting = all.filter((p) => p.pose === 'chat' || (p.pose === 'walk' && layout.chat.some((c) => c.x === p.path[p.path.length - 1]?.x && c.y === p.path[p.path.length - 1]?.y)));
    if (person.seed % 3 !== 0 && layout.chat[0] && chatting.length < 2) {
      const spot = layout.chat[person.seed % layout.chat.length] ?? layout.chat[0];
      return { x: spot.x, y: spot.y };
    }
    const open = aisleTiles(layout).filter((t) => t.x !== person.homeX || t.y !== person.homeY);
    const pick = open[person.seed % Math.max(1, open.length)];
    return pick ?? { x: person.homeX, y: person.homeY };
  }

  let hourTint = 12;

  return {
    canvas,
    el: wrap,
    resize(displayPx: number) {
      const scale = Math.max(1, Math.floor(displayPx / VIEW));
      const px = VIEW * scale;
      canvas.style.width = `${px}px`;
      canvas.style.height = `${px}px`;
    },
    update(dt: number, now: number) {
      stepPeople(Math.min(0.05, dt));
      rebuild(now);
      hour = hourTint;
    },
    push(ev: OfficeEvent) {
      if (ev.level !== shown.level && ev.type !== 'deploySuccess') return;
      burst = performance.now() + Math.min(ev.ttlMs, 2800);
      const who = people.find((p) => p.pose === 'sit');
      if (who && ev.type === 'deploySuccess') {
        who.pose = 'stand';
        who.timer = 0.8;
        who.path = [];
      }
    },
    levelsFor(type: OfficeEventType) {
      if (type === 'deploySuccess') return configs.filter((f) => f.type === 'rnd').map((f) => f.level);
      if (type === 'dealClosed') return configs.filter((f) => f.type === 'sales').map((f) => f.level);
      return configs.filter((f) => f.type === 'lobby').map((f) => f.level);
    },
    setHour(next: number) {
      hourTint = next;
    },
  };
}

function aisleTiles(layout: FloorLayout): Pt[] {
  const tiles: Pt[] = [];
  for (let y = 0; y < PLAN; y++) {
    for (let x = 0; x < PLAN; x++) {
      if (layout.walkable(x, y)) tiles.push({ x, y });
    }
  }
  return tiles;
}

function route(layout: FloorLayout, start: Pt, goal: Pt): Pt[] {
  const walk = (x: number, y: number) =>
    (x === start.x && y === start.y) || (x === goal.x && y === goal.y) || layout.walkable(x, y);
  if (start.x === goal.x && start.y === goal.y) return [start];
  const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  const open: { x: number; y: number; g: number; f: number }[] = [{ x: start.x, y: start.y, g: 0, f: h(start.x, start.y) }];
  const came = new Map<number, number>();
  const best = new Map<number, number>();
  best.set(keyOf(start.x, start.y), 0);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    if (!cur) break;
    if (cur.x === goal.x && cur.y === goal.y) {
      const path: Pt[] = [{ x: cur.x, y: cur.y }];
      let id = keyOf(cur.x, cur.y);
      while (came.has(id)) {
        const prev = came.get(id) ?? id;
        path.push({ x: prev % PLAN, y: Math.floor(prev / PLAN) });
        id = prev;
      }
      path.reverse();
      return path;
    }
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!walk(nx, ny)) continue;
      const ng = cur.g + 1;
      const id = keyOf(nx, ny);
      if (ng >= (best.get(id) ?? 1e9)) continue;
      best.set(id, ng);
      came.set(id, keyOf(cur.x, cur.y));
      open.push({ x: nx, y: ny, g: ng, f: ng + h(nx, ny) });
    }
  }
  return [];
}

function buildOutline(solid: FloorLayout['solid'], iso: (x: number, y: number, z?: number) => Pt): Run {
  const segs: { ax: number; ay: number; bx: number; by: number }[] = [];
  const add = (ax: number, ay: number, bx: number, by: number) => segs.push({ ax, ay, bx, by });
  for (let y = 0; y < PLAN; y++) {
    for (let x = 0; x < PLAN; x++) {
      if (!solid(x, y)) continue;
      if (!solid(x, y - 1)) add(x, y, x + 1, y);
      if (!solid(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!solid(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!solid(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const key = (x: number, y: number) => `${x},${y}`;
  const next = new Map<string, Pt[]>();
  const link = (from: string, to: Pt) => {
    const list = next.get(from) ?? [];
    list.push(to);
    next.set(from, list);
  };
  for (const s of segs) {
    link(key(s.ax, s.ay), { x: s.bx, y: s.by });
    link(key(s.bx, s.by), { x: s.ax, y: s.ay });
  }
  const used = new Set<string>();
  const ek = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  let best: Pt[] = [];
  for (const s of segs) {
    const startKey = key(s.ax, s.ay);
    const firstEdge = ek(startKey, key(s.bx, s.by));
    if (used.has(firstEdge)) continue;
    const loop: Pt[] = [{ x: s.ax, y: s.ay }];
    used.add(firstEdge);
    let cx = s.bx;
    let cy = s.by;
    for (let guard = 0; guard < 600; guard++) {
      loop.push({ x: cx, y: cy });
      if (cx === s.ax && cy === s.ay) break;
      const opts = next.get(key(cx, cy)) ?? [];
      let moved = false;
      for (const n of opts) {
        const id = ek(key(cx, cy), key(n.x, n.y));
        if (used.has(id)) continue;
        used.add(id);
        cx = n.x;
        cy = n.y;
        moved = true;
        break;
      }
      if (!moved) break;
    }
    if (loop.length > best.length) best = loop;
  }
  const screen = best.map((p) => iso(p.x, p.y, FLOOR_Z));
  return measure(screen);
}

function columnRuns(iso: (x: number, y: number, z?: number) => Pt): Run[] {
  const corners: Pt[] = [
    { x: 0, y: 0 },
    { x: PLAN, y: 0 },
    { x: 0, y: PLAN },
  ];
  return corners.map((c) => measure([iso(c.x, c.y, 0), iso(c.x, c.y, WALL_Z)]));
}

function measure(pts: Pt[]): Run {
  const len = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    total += Math.hypot(b.x - a.x, b.y - a.y);
    len.push(total);
  }
  return { pts, len, total };
}

function pointAlong(run: Run, distance: number): Pt {
  if (run.total < 1 || run.pts.length === 0) return { x: 0, y: 0 };
  let d = distance % run.total;
  if (d < 0) d += run.total;
  let i = 1;
  while (i < run.len.length - 1 && (run.len[i] ?? 0) < d) i += 1;
  const a = run.pts[i - 1];
  const b = run.pts[i] ?? a;
  if (!a || !b) return { x: 0, y: 0 };
  const start = run.len[i - 1] ?? 0;
  const span = (run.len[i] ?? start) - start || 1;
  const u = (d - start) / span;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

function strokeLoop(g: Graphics, run: Run, color: number): void {
  if (run.pts.length < 2) return;
  const flat: number[] = [];
  for (const p of run.pts) flat.push(Math.round(p.x), Math.round(p.y));
  g.poly(flat, true).stroke({ width: 1, color, alpha: 1, pixelLine: true });
}

function drawPulses(g: Graphics, run: Run, now: number, speed: number, count: number): void {
  if (run.total < 8) return;
  for (let n = 0; n < count; n++) {
    const head = ((now / 1000) * speed + n * (run.total / count)) % run.total;
    for (let k = 8; k >= 0; k--) {
      const q = pointAlong(run, head - k * 1.15);
      const alpha = k === 0 ? 1 : (1 - k / 9) * 0.85;
      const size = k === 0 ? 3 : 2;
      g.rect(Math.round(q.x) - 1, Math.round(q.y) - 1, size, size).fill({ color: k < 2 ? WHITE : ICE, alpha });
    }
  }
}
