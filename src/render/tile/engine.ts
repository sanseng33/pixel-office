import { Application, Graphics } from 'pixi.js';
import type { FloorConfig, FloorType } from '../../config/floors.ts';
import { VIEW } from '../../config/display.ts';
import type { OfficeEvent, OfficeEventType } from '../../events/source.ts';
import type { PlateView } from '../plate.ts';
import { PLAN, layoutFor } from './layout.ts';
import type { FloorLayout, Furn } from './layout.ts';

/** Single-floor tiles are 16×11. The stacked building uses a flatter slab so seven floors fit the square. */
let tileW = 16;
let tileH = 11;
let zH = 14;
let floorZ = 1.7;
let wallZ = 4.6;
let SPR = 1;
const DESK_H = 13;

function u(n: number): number {
  return Math.max(1, Math.round(n * SPR));
}

function s(n: number): number {
  return Math.round(n * SPR);
}

/** 4-frame scissor. Contact, passing, opposite contact, passing. Offsets follow the iso walk. */
function stridePose(dirX: number, dirY: number, frame: number): {
  bob: number;
  left: Pt;
  right: Pt;
  armL: Pt;
  armR: Pt;
  face: Pt;
} {
  const dx = dirX === 0 && dirY === 0 ? 0 : Math.sign(dirX);
  const dy = dirX === 0 && dirY === 0 ? 1 : Math.sign(dirY);
  const wx = dx - dy;
  const wy = dx + dy;
  const px = -wy;
  const py = wx;
  const reach = frame === 0 ? 3 : frame === 2 ? -3 : frame === 1 ? 1 : -1;
  const at = (along: number, side: number): Pt => ({
    x: s(px * side + wx * along),
    y: s(py * side + wy * along),
  });
  return {
    bob: frame % 2 === 1 ? -1 : 0,
    left: at(reach, 1),
    right: at(-reach, -1),
    armL: at(-Math.sign(reach), 2),
    armR: at(Math.sign(reach), -2),
    face: { x: s(wx), y: 0 },
  };
}

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
  B: ['11110', '10001', '11110', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '01111'],
  G: ['01111', '10000', '10111', '10001', '01111'],
  H: ['10001', '10001', '11111', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '11100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  Q: ['01110', '10001', '10101', '10010', '01101'],
  U: ['10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10101', '11011', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100'],
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
  /** Grid step of the current stride. One axis is ±1, the other is 0. */
  dirX: number;
  dirY: number;
  /** Visitors and wanderers pick a new goal instead of sitting down. */
  roam: boolean;
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Tower plate is ~13% longer on each side than the 15-tile single floor, about +28% area. */
const TOWER_N = 17;
const TOWER_CUT = 9;
let gridN = PLAN;

function keyOf(x: number, y: number): number {
  return x + y * gridN;
}

/** Same footprint on every storey. The camera-facing corner is an L-shaped notch. */
function towerSolid(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= TOWER_N || y >= TOWER_N) return false;
  if (x >= TOWER_CUT && y >= TOWER_CUT) return false;
  return true;
}

export async function createTileFloor(
  configs: readonly FloorConfig[],
  options?: { debug?: boolean; focus?: number },
): Promise<PlateView> {
  const focus = options?.focus ?? 0;
  const building = focus === 0;
  gridN = building ? TOWER_N : PLAN;
  const shownList = (building ? [...configs] : configs.filter((f) => f.level === focus)).slice();
  const shown = shownList[0];
  if (!shown) throw new Error('no floor config');
  tileW = building ? 12 : 16;
  tileH = building ? 5 : 11;
  zH = building ? 7 : 14;
  floorZ = building ? 1 : 1.7;
  wallZ = building ? 3.2 : 4.6;
  SPR = building ? 0.74 : 1;
  let layout = layoutFor(shown.type, shown.level);
  let people: Person[] = [];
  const debug = options?.debug === true;
  let roofGap = 0;
  let storeyStep = 44;

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
    x: originX + (x - y) * tileW,
    y: originY + (x + y) * tileH - z * zH,
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
    for (let y = 0; y < gridN; y++) {
      for (let x = 0; x < gridN; x++) {
        if (!layout.solid(x, y)) continue;
        consider(iso(x, y, floorZ));
        consider(iso(x + 1, y, 0));
        consider(iso(x, y + 1, 0));
        consider(iso(x + 1, y + 1, 0));
        if (y === 0) {
          consider(iso(x, y, wallZ));
          consider(iso(x + 1, y, wallZ));
        }
        if (x === 0) {
          consider(iso(x, y, wallZ));
          consider(iso(x, y + 1, wallZ));
        }
      }
    }
    return { minX, maxX, minY, maxY };
  };

  interface Sim {
    cfg: FloorConfig;
    layout: FloorLayout;
    people: Person[];
    originX: number;
    originY: number;
    outline: Run;
    columns: Run[];
    labelX: number;
    labelY: number;
  }

  function makePeople(cfg: FloorConfig, lay: FloorLayout): Person[] {
    const rand = mulberry(cfg.level * 97 + 11);
    const desks = lay.desks.slice();
    for (let i = desks.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const a = desks[i];
      const b = desks[j];
      if (!a || !b) continue;
      desks[i] = b;
      desks[j] = a;
    }
    const crew: Person[] = [];
    const seated = desks;
    const occupiedCount =
      building || cfg.type === 'vacant' || cfg.occupancy <= 0
        ? 0
        : Math.max(0, Math.round(seated.length * cfg.occupancy));
    const spawn = (x: number, y: number, pose: Person['pose'], roam: boolean, span: number, face: 1 | -1, i: number) => {
      crew.push({
        homeX: x,
        homeY: y,
        x,
        y,
        fromX: x,
        fromY: y,
        face,
        span,
        pose,
        path: [],
        hop: 0,
        timer: pose === 'walk' ? 0.2 : 1.6 + i * 0.85,
        phase: rand() * 6,
        seed: (i * 17 + cfg.level * 3) >>> 0,
        dirX: 1,
        dirY: 0,
        roam,
      });
    };
    for (let i = 0; i < occupiedCount; i++) {
      const desk = seated[i];
      if (!desk) continue;
      spawn(desk.x, desk.y, 'sit', false, desk.w, desk.face ?? 1, i);
    }
    const extras = building ? 0 : cfg.people;
    for (let i = 0; i < extras; i++) {
      const anchor = lay.anchors[i];
      if (anchor && (!building || notchOpen(anchor.x, anchor.y))) {
        spawn(anchor.x, anchor.y, anchor.pose, anchor.pose !== 'sit', 1, 1, occupiedCount + i);
        continue;
      }
      const open = (building ? notchTiles() : aisleTiles(lay)).filter((t) => !building || notchOpen(t.x, t.y));
      const spot = open[(cfg.level * 5 + i * 3) % Math.max(1, open.length)];
      if (!spot) continue;
      spawn(spot.x, spot.y, 'walk', true, 1, 1, occupiedCount + i);
    }
    if (building && cfg.type !== 'vacant') {
      const folk = stackFolk(cfg.type, cfg.level);
      for (let i = 0; i < folk.length; i++) {
        const f = folk[i];
        if (!f || !notchOpen(f.x, f.y)) continue;
        if (f.roam && !lay.walkable(f.x, f.y)) continue;
        spawn(f.x, f.y, f.pose, f.roam, 1, f.face, 20 + i);
      }
    }
    return crew;
  }

  originX = 0;
  originY = 0;
  const box = boundsOf();
  const sims: Sim[] = [];
  if (!building) {
    const headerBlock = 22;
    const contentTop = box.minY - headerBlock;
    const contentBottom = box.maxY + 2;
    originX = Math.round(VIEW / 2 - (box.minX + box.maxX) / 2);
    originY = Math.round(VIEW / 2 - (contentTop + contentBottom) / 2);
    const lay = layoutFor(shown.type, shown.level);
    layout = lay;
    sims.push({
      cfg: shown,
      layout: lay,
      people: makePeople(shown, lay),
      originX,
      originY,
      outline: buildOutline(lay.solid, iso),
      columns: columnRuns(iso),
      labelX: 8,
      labelY: 8,
    });
  } else {
    originX = 0;
    originY = 0;
    layout = layoutFor('lobby', 1);
    let plateTop = 1e9;
    let plateBottom = -1e9;
    let plateLeft = 1e9;
    let plateRight = -1e9;
    for (let y = 0; y < gridN; y++) {
      for (let x = 0; x < gridN; x++) {
        if (!towerSolid(x, y)) continue;
        const front = iso(x + 1, y + 1, 0);
        const back = iso(x, y, floorZ);
        const left = iso(x, y + 1, 0);
        const right = iso(x + 1, y, 0);
        if (back.y < plateTop) plateTop = back.y;
        if (front.y > plateBottom) plateBottom = front.y;
        if (left.x < plateLeft) plateLeft = left.x;
        if (right.x > plateRight) plateRight = right.x;
      }
    }
    storeyStep = 46;
    const wallOver = Math.ceil((wallZ - floorZ) * zH);
    roofGap = 40;
    const floorsN = shownList.length;
    const totalH = (plateBottom - plateTop) + storeyStep * (floorsN - 1) + roofGap + wallOver + 8;
    const top = Math.max(10, Math.round((VIEW - totalH) / 2));
    let originX0 = Math.round((VIEW - (plateRight - plateLeft)) / 2 - plateLeft);
    if (originX0 + plateRight > VIEW - 6) originX0 = Math.round(VIEW - 6 - plateRight);
    if (originX0 + plateLeft < 28) originX0 = Math.round(28 - plateLeft);
    originX0 += 14;
    shownList.forEach((cfg, index) => {
      const fromTop = floorsN - 1 - index;
      originX = originX0;
      originY = Math.round(top + roofGap + wallOver + fromTop * storeyStep - plateTop);
      const lay = layoutFor(cfg.type, cfg.level);
      layout = lay;
      const lip = iso(0, gridN - 1, floorZ);
      const label = `${cfg.label} ${cfg.name}`;
      const textW = label.length * 6;
      const notchLay = notchLayout(lay, cfg.type, cfg.level);
      sims.push({
        cfg,
        layout: notchLay,
        people: makePeople(cfg, notchLay),
        originX,
        originY,
        outline: buildOutline((x, y) => towerSolid(x, y), iso),
        columns: columnRuns(iso),
        labelX: Math.max(12, Math.min(VIEW - 12 - textW, Math.round(lip.x) - textW - 6)),
        labelY: Math.max(12, Math.min(VIEW - 16, Math.round(lip.y) - 6)),
      });
    });
  }
  layout = sims[0]?.layout ?? layout;
  people = sims[0]?.people ?? [];

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
    return [iso(x0, y0, floorZ), iso(x1, y1, floorZ), iso(x1, y1, 0), iso(x0, y0, 0)];
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

  function drawPerson(
    g: Graphics,
    foot: Pt,
    pose: Person['pose'],
    phase: number,
    lit: boolean,
    dirX = 0,
    dirY = 1,
  ): void {
    const fx = Math.round(foot.x);
    const fy = Math.round(foot.y);
    if (pose === 'sit') {
      const y = fy;
      mark(g, fx - u(5), y - u(10), u(10), u(7), ICE);
      mark(g, fx - u(7), y - u(9), u(2), u(5), ARM);
      mark(g, fx + u(5), y - u(9), u(2), u(5), ARM);
      mark(g, fx - u(3), y - u(16), u(6), u(6), WHITE);
      g.rect(fx - u(3), y - u(18), u(6), u(3)).fill({ color: HAIR });
      if (lit) g.rect(fx - u(2), y - u(14), u(4), u(2)).fill({ color: 0xd8f4ff });
      g.rect(fx - u(2), y - u(14), u(1), u(1)).fill({ color: lit ? 0x123044 : EYE });
      g.rect(fx + u(1), y - u(14), u(1), u(1)).fill({ color: lit ? 0x123044 : EYE });
      return;
    }
    const frame = pose === 'walk' ? Math.floor(phase * 8) % 4 : 0;
    const stride = stridePose(dirX, dirY, frame);
    const y = fy + stride.bob;
    const leg = (off: Pt, side: number) => {
      mark(g, fx + off.x - u(1), y - u(12) + off.y, u(3), u(12), LEG);
      void side;
    };
    leg(stride.left, -1);
    leg(stride.right, 1);
    mark(g, fx - u(5), y - u(21), u(10), u(9), ICE);
    mark(g, fx - u(8) + stride.armL.x, y - u(20) + stride.armL.y, u(3), u(7), ARM);
    mark(g, fx + u(5) + stride.armR.x, y - u(20) + stride.armR.y, u(3), u(7), ARM);
    mark(g, fx - u(3) + stride.face.x, y - u(27), u(6), u(6), WHITE);
    g.rect(fx - u(3) + stride.face.x, y - u(29), u(6), u(4)).fill({ color: HAIR });
    g.rect(fx - u(2) + stride.face.x, y - u(25), u(1), u(1)).fill({ color: EYE });
    g.rect(fx + u(1) + stride.face.x, y - u(25), u(1), u(1)).fill({ color: EYE });
    if (pose === 'chat') drawHeart(g, fx, y - u(34));
  }

  function drawArms(g: Graphics, foot: Pt, phase: number): void {
    const fx = Math.round(foot.x);
    const fy = Math.round(foot.y);
    const type = Math.floor(phase * 6) % 2;
    g.rect(fx - u(10), fy - u(4) + type, u(5), u(3)).fill({ color: ARM });
    g.rect(fx + u(5), fy - u(4) + (1 - type), u(5), u(3)).fill({ color: ARM });
    g.rect(fx - u(9), fy - u(4) + type, u(5), u(1)).fill({ color: WHITE });
    g.rect(fx + u(5), fy - u(4) + (1 - type), u(5), u(1)).fill({ color: WHITE });
  }

  function drawMonitor(g: Graphics, mx: number, my: number, towardCamera: boolean, lit: boolean, now: number): void {
    const center = raise(iso(mx, my, floorZ), u(DESK_H) + u(2));
    const px = Math.round(center.x);
    const py = Math.round(center.y);
    g.rect(px, py + u(3), u(1), u(3)).fill({ color: ICE });
    g.rect(px - u(3), py - u(5), u(7), u(8)).fill({ color: INK });
    g.rect(px - u(3), py - u(5), u(7), u(1)).fill({ color: lit ? ICE : WHITE });
    g.rect(px - u(3), py + u(2), u(7), u(1)).fill({ color: ICE });
    g.rect(px - u(3), py - u(5), u(1), u(8)).fill({ color: ICE });
    g.rect(px + u(3), py - u(5), u(1), u(8)).fill({ color: ICE });
    if (towardCamera && lit) {
      g.rect(px - u(2), py - u(4), u(5), u(5)).fill({ color: 0x6eb6dc });
      g.rect(px - u(2), py - u(4), u(3), u(1)).fill({ color: WHITE });
      const scan = Math.floor(now / 180 + mx * 3) % 4;
      g.rect(px - u(2), py - u(2) + scan, u(5), u(1)).fill({ color: WHITE });
      glowSpots.push({ x: px, y: py - 1, hot: true });
      return;
    }
    g.rect(px - u(2), py - u(4), u(5), u(5)).fill({ color: INK });
    if (lit) {
      g.rect(px - u(1), py - u(4), u(3), u(1)).fill({ color: ICE });
      glowSpots.push({ x: px, y: py + u(3), hot: false });
    }
  }

  function drawDesk(g: Graphics, item: Furn): void {
    const face = item.face ?? 1;
    const x = item.x;
    const y = item.y;
    const [a, b, c, d] = corners(x + 0.08, y + 0.16, x + item.w - 0.08, y + 0.84, floorZ);
    for (const p of [a, b, c, d]) {
      const legTop = raise(p, u(4));
      g.rect(Math.round(p.x), Math.round(legTop.y), u(1), Math.max(1, Math.round(p.y - legTop.y))).fill({ color: ICE });
    }
    volume(g, a, b, c, d, u(4), u(DESK_H));
    const kx0 = x + 0.55;
    const kx1 = x + item.w - 0.55;
    const ky0 = face === 1 ? y + 0.48 : y + 0.32;
    const ky1 = face === 1 ? y + 0.64 : y + 0.48;
    const [k1, k2, k3, k4] = corners(kx0, ky0, kx1, ky1, floorZ);
    poly(
      g,
      [raise(k1, u(DESK_H) + u(1)), raise(k2, u(DESK_H) + u(1)), raise(k3, u(DESK_H) + u(1)), raise(k4, u(DESK_H) + u(1))],
      INK,
      1,
      ICE,
      1,
    );
    const key = raise(iso((kx0 + kx1) / 2, (ky0 + ky1) / 2, floorZ), u(DESK_H) + u(1));
    const kx = Math.round(key.x);
    const ky = Math.round(key.y);
    g.rect(kx - 4, ky, 2, 1).fill({ color: WHITE });
    g.rect(kx - 1, ky, 2, 1).fill({ color: ICE });
    g.rect(kx + 2, ky, 2, 1).fill({ color: WHITE });
    if (layout.role === 'sales') {
      const phone = raise(iso(x + 0.32, face === 1 ? y + 0.38 : y + 0.7, floorZ), u(DESK_H) + u(2));
      const px = Math.round(phone.x);
      const py = Math.round(phone.y);
      g.rect(px, py, u(3), u(2)).fill({ color: INK });
      g.rect(px, py, u(3), u(1)).fill({ color: ICE });
      g.rect(px + u(1), py + u(1), u(1), u(1)).fill({ color: WHITE });
    }
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
    const [a, b, c, d] = corners(cx - 0.16, y0, cx + 0.16, y1, floorZ);
    volume(g, a, b, c, d, 0, u(3));
    const by = face === 1 ? y1 - 0.02 : y0 + 0.02;
    const hinge = raise(iso(cx, by, floorZ), u(3));
    const hx = Math.round(hinge.x);
    const hy = Math.round(hinge.y);
    g.rect(hx - u(3), hy - u(8), u(7), u(6)).fill({ color: INK });
    g.rect(hx - u(3), hy - u(8), u(7), u(1)).fill({ color: WHITE });
    g.rect(hx - u(3), hy - u(3), u(7), u(1)).fill({ color: ICE });
    g.rect(hx - u(3), hy - u(8), u(1), u(6)).fill({ color: ICE });
    g.rect(hx + u(3), hy - u(8), u(1), u(6)).fill({ color: ICE });
  }

  function drawFurn(g: Graphics, item: Furn, now: number): void {
    if (item.kind === 'desk') {
      drawDesk(g, item);
      return;
    }
    if (item.kind === 'table') {
      const [a, b, c, d] = corners(item.x + 0.08, item.y + 0.22, item.x + item.w - 0.08, item.y + 0.78, floorZ);
      volume(g, a, b, c, d, u(3), u(9));
      return;
    }
    if (item.kind === 'plant') {
      const [a, b, c, d] = corners(item.x + 0.34, item.y + 0.34, item.x + 0.66, item.y + 0.66, floorZ);
      volume(g, a, b, c, d, 0, u(4));
      const leaf = raise(iso(item.x + 0.5, item.y + 0.5, floorZ), u(4));
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
    if (item.kind === 'sofa') {
      const [a, b, c, d] = corners(item.x + 0.08, item.y + 0.25, item.x + item.w - 0.08, item.y + 0.8, floorZ);
      volume(g, a, b, c, d, 0, u(4));
      const back = raise(iso(item.x + item.w / 2, item.y + 0.3, floorZ), u(4));
      g.rect(Math.round(back.x) - u(6), Math.round(back.y) - u(5), u(12), u(4)).fill({ color: INK });
      g.rect(Math.round(back.x) - u(6), Math.round(back.y) - u(5), u(12), u(1)).fill({ color: WHITE });
      return;
    }
    if (item.kind === 'screen') {
      const [a, b, c, d] = corners(item.x + 0.1, item.y + 0.2, item.x + item.w - 0.1, item.y + 0.7, floorZ);
      volume(g, a, b, c, d, u(2), u(14));
      const mid = raise(iso(item.x + item.w / 2, item.y + 0.45, floorZ), u(10));
      g.rect(Math.round(mid.x) - u(4), Math.round(mid.y) - u(3), u(8), u(5)).fill({ color: 0x123044 });
      const scan = Math.floor(now / 200 + item.x) % 4;
      g.rect(Math.round(mid.x) - u(4), Math.round(mid.y) - u(3) + scan, u(8), u(1)).fill({ color: ICE });
      return;
    }
    if (item.kind === 'gate') {
      const post = (gx: number) => {
        const p = iso(gx, item.y + 0.5, floorZ);
        g.rect(Math.round(p.x), Math.round(p.y) - u(12), u(2), u(12)).fill({ color: INK });
        g.rect(Math.round(p.x), Math.round(p.y) - u(12), u(2), u(1)).fill({ color: WHITE });
      };
      post(item.x + 0.2);
      post(item.x + 0.8);
      const bar = iso(item.x + 0.5, item.y + 0.5, floorZ);
      g.rect(Math.round(bar.x) - u(6), Math.round(bar.y) - u(8), u(12), u(1)).fill({ color: ICE });
      return;
    }
    if (item.kind === 'pong') {
      const [a, b, c, d] = corners(item.x + 0.1, item.y + 0.2, item.x + item.w - 0.1, item.y + 0.8, floorZ);
      volume(g, a, b, c, d, u(2), u(6));
      const net = raise(iso(item.x + item.w / 2, item.y + 0.5, floorZ), u(6));
      g.rect(Math.round(net.x), Math.round(net.y) - u(4), u(1), u(8)).fill({ color: WHITE });
      return;
    }
    if (item.kind === 'rack') {
      const base = iso(item.x + 0.55, item.y + 0.55, floorZ);
      const x = Math.round(base.x);
      const y = Math.round(base.y);
      const h = u(22);
      const w = u(8);
      g.rect(x + w - u(3), y - h + u(2), u(3), h - u(2)).fill({ color: 0x050c14 });
      g.rect(x + w - u(3), y - h + u(2), u(1), h - u(2)).fill({ color: ICE });
      g.rect(x - u(3), y - h, w, h).fill({ color: INK });
      g.rect(x - u(3), y - h, w, u(1)).fill({ color: WHITE });
      g.rect(x - u(3), y - u(1), w, u(1)).fill({ color: ICE });
      g.rect(x - u(3), y - h, u(1), h).fill({ color: ICE });
      g.rect(x - u(3) + w - u(1), y - h, u(1), h).fill({ color: ICE });
      for (let i = 0; i < 5; i++) {
        const by = y - h + u(2) + i * u(4);
        g.rect(x - u(2), by, w - u(2), u(1)).fill({ color: 0x163044 });
        const blink = Math.floor(now / 170 + item.x * 2 + i) % 2 === 0;
        g.rect(x - u(1), by + u(1), u(1), u(1)).fill({ color: blink ? WHITE : ICE });
        g.rect(x + u(2), by + u(1), u(1), u(1)).fill({ color: blink ? ICE : WHITE });
      }
      return;
    }
    if (item.kind === 'box') {
      const [a, b, c, d] = corners(item.x + 0.2, item.y + 0.2, item.x + item.w - 0.2, item.y + 0.8, floorZ);
      volume(g, a, b, c, d, 0, u(6));
      return;
    }
    if (item.kind === 'board') {
      const [a, b, c, d] = corners(item.x + 0.1, item.y + 0.25, item.x + item.w - 0.1, item.y + 0.75, floorZ);
      volume(g, a, b, c, d, u(1), u(12));
      const line = raise(iso(item.x + item.w / 2, item.y + 0.5, floorZ), u(8));
      g.rect(Math.round(line.x) - u(3), Math.round(line.y), u(6), u(1)).fill({ color: ICE });
      g.rect(Math.round(line.x) - u(2), Math.round(line.y) + u(2), u(4), u(1)).fill({ color: ICE });
      return;
    }
    if (item.kind === 'room') {
      const [a, b, c, d] = corners(item.x + 0.06, item.y + 0.06, item.x + item.w - 0.06, item.y + 1.94, floorZ);
      const h = u(14);
      const A = raise(a, h);
      const B = raise(b, h);
      const C = raise(c, h);
      const D = raise(d, h);
      poly(g, [b, c, C, B], 0x0c2034, 0.88, ICE, 0.95);
      poly(g, [d, c, C, D], 0x0c2034, 0.82, ICE, 0.9);
      poly(g, [A, B, C, D], 0x10283c, 0.94, WHITE, 0.95);
      for (const p of [a, b, c, d]) {
        const top = raise(p, h);
        g.rect(Math.round(p.x), Math.round(top.y), u(1), Math.max(2, Math.round(p.y - top.y))).fill({ color: ICE });
      }
      return;
    }
    if (item.kind === 'cable') {
      for (let i = 0; i < item.w; i++) {
        const p = iso(item.x + i + 0.5, item.y + 0.5, floorZ);
        g.rect(Math.round(p.x), Math.round(p.y), u(3), u(1)).fill({ color: ICE });
      }
      return;
    }
    if (item.kind === 'file') {
      const [a, b, c, d] = corners(item.x + 0.18, item.y + 0.22, item.x + 0.82, item.y + 0.82, floorZ);
      volume(g, a, b, c, d, 0, u(11));
      const mid = raise(iso(item.x + 0.5, item.y + 0.5, floorZ), u(7));
      g.rect(Math.round(mid.x) - u(3), Math.round(mid.y), u(6), u(1)).fill({ color: ICE });
      g.rect(Math.round(mid.x) - u(3), Math.round(mid.y) + u(3), u(6), u(1)).fill({ color: ICE });
      return;
    }
    if (item.kind === 'print') {
      const [a, b, c, d] = corners(item.x + 0.22, item.y + 0.28, item.x + 0.78, item.y + 0.78, floorZ);
      volume(g, a, b, c, d, 0, u(6));
      const paper = raise(iso(item.x + 0.5, item.y + 0.5, floorZ), u(6));
      g.rect(Math.round(paper.x) - u(2), Math.round(paper.y) - u(3), u(4), u(2)).fill({ color: WHITE });
      return;
    }
    if (item.kind === 'booth') {
      const [a, b, c, d] = corners(item.x + 0.16, item.y + 0.16, item.x + 0.84, item.y + 0.84, floorZ);
      const h = u(16);
      const A = raise(a, h);
      const B = raise(b, h);
      const C = raise(c, h);
      const D = raise(d, h);
      poly(g, [b, c, C, B], 0x123044, 0.5, ICE, 0.95);
      poly(g, [d, c, C, D], 0x10283c, 0.45, ICE, 0.9);
      poly(g, [A, B, C, D], 0x10283c, 0.7, WHITE, 0.95);
      for (const p of [a, b, c, d]) {
        const top = raise(p, h);
        g.rect(Math.round(p.x), Math.round(top.y), u(1), Math.max(2, Math.round(p.y - top.y))).fill({ color: ICE });
      }
      return;
    }
    if (item.kind === 'shelf') {
      const [a, b, c, d] = corners(item.x + 0.1, item.y + 0.28, item.x + item.w - 0.1, item.y + 0.78, floorZ);
      volume(g, a, b, c, d, 0, u(12));
      const mid = raise(iso(item.x + item.w / 2, item.y + 0.5, floorZ), u(8));
      g.rect(Math.round(mid.x) - u(4), Math.round(mid.y), u(8), u(1)).fill({ color: ICE });
      g.rect(Math.round(mid.x) - u(4), Math.round(mid.y) + u(3), u(8), u(1)).fill({ color: WHITE });
      return;
    }
    if (item.kind === 'chairs') {
      const base = iso(item.x + 0.5, item.y + 0.5, floorZ);
      const x = Math.round(base.x);
      const y = Math.round(base.y);
      for (let i = 0; i < 3; i++) {
        const yy = y - u(4) - i * u(3);
        g.rect(x - u(3), yy, u(6), u(2)).fill({ color: INK });
        g.rect(x - u(3), yy, u(6), u(1)).fill({ color: WHITE });
        g.rect(x - u(3), yy + u(1), u(6), u(1)).fill({ color: ICE });
      }
      return;
    }
    if (item.kind === 'marker') {
      const p = iso(item.x + 0.5, item.y + 0.5, floorZ);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      g.rect(x, y - u(8), u(1), u(8)).fill({ color: ICE });
      g.rect(x - u(2), y - u(8), u(5), u(1)).fill({ color: WHITE });
      g.rect(x - u(1), y, u(3), u(1)).fill({ color: ICE });
      return;
    }
    const [a, b, c, d] = corners(item.x + 0.06, item.y + 0.16, item.x + item.w - 0.06, item.y + 0.84, floorZ);
    volume(g, a, b, c, d, 0, u(11));
    for (const ux of [0.55, 1.35]) {
      const cup = raise(iso(item.x + ux, item.y + 0.48, floorZ), u(11));
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
    world.clear();
    glow.clear();
    for (const sim of sims) {
      originX = sim.originX;
      originY = sim.originY;
      layout = sim.layout;
      people = sim.people;
      paintFloor(now, sim);
    }
    if (building) {
      paintRoof(now);
      for (const sim of sims) {
        paintText(world, `${sim.cfg.label} ${sim.cfg.name}`, sim.labelX, sim.labelY, WHITE, 1);
      }
    }
    if (hour >= 20 || hour < 6) world.rect(0, 0, VIEW, VIEW).fill({ color: 0x02060c, alpha: 0.28 });
    app.render();
  }

  function paintRoof(now: number): void {
    const top = sims[sims.length - 1];
    const low = sims[0];
    if (!top || !low) return;
    originX = top.originX;
    originY = top.originY - roofGap;
    for (let y = 0; y < gridN; y++) {
      for (let x = 0; x < gridN; x++) {
        if (!towerSolid(x, y)) continue;
        if (!towerSolid(x, y - 1)) poly(world, face(x, y, x + 1, y), 0x071018, 1);
        if (!towerSolid(x + 1, y)) poly(world, face(x + 1, y, x + 1, y + 1), 0x071018, 1);
        if (!towerSolid(x, y + 1)) poly(world, face(x, y + 1, x + 1, y + 1), 0x0a1828, 1);
        if (!towerSolid(x - 1, y)) poly(world, face(x, y, x, y + 1), 0x071018, 1);
        const mark = (x + y) % 2 === 0;
        poly(world, tilePts(x, y, floorZ), 0x0a1422, 1, mark ? 0x163044 : undefined, 0.18);
      }
    }
    strokeLoop(world, buildOutline((x, y) => towerSolid(x, y), iso), ICE);
    for (const spot of [iso(2.4, 6.4, floorZ), iso(10.8, 3.4, floorZ)]) {
      const ax = Math.round(spot.x);
      const ay = Math.round(spot.y) - 8;
      world.rect(ax, ay, 14, 8).fill({ color: INK });
      world.rect(ax, ay, 14, 1).fill({ color: WHITE });
      world.rect(ax, ay + 7, 14, 1).fill({ color: ICE });
      world.rect(ax, ay, 1, 8).fill({ color: ICE });
      world.rect(ax + 13, ay, 1, 8).fill({ color: ICE });
      world.rect(ax + 4, ay - 3, 6, 3).fill({ color: 0x163044 });
      world.rect(ax + 4, ay - 3, 6, 1).fill({ color: ICE });
    }
    const anchor = iso(5.6, 4.4, floorZ);
    const ax = Math.round(anchor.x);
    const ay = Math.round(anchor.y);
    const postH = 12;
    const boxW = 92;
    const boxH = 20;
    const boxX = ax - 40;
    const boxY = ay - postH - boxH;
    world.rect(ax - 24, ay - postH, 2, postH).fill({ color: ICE });
    world.rect(ax + 22, ay - postH, 2, postH).fill({ color: ICE });
    glow.rect(boxX - 4, boxY - 4, boxW + 8, boxH + 8).fill({ color: ICE, alpha: 0.2 });
    world.rect(boxX, boxY, boxW, boxH).fill({ color: INK });
    world.rect(boxX, boxY, boxW, 1).fill({ color: WHITE });
    world.rect(boxX, boxY + boxH - 1, boxW, 1).fill({ color: ICE });
    world.rect(boxX, boxY, 1, boxH).fill({ color: ICE });
    world.rect(boxX + boxW - 1, boxY, 1, boxH).fill({ color: ICE });
    paintText(world, 'PATSNAP', boxX + 5, boxY + 5, WHITE, 2);
    originX = low.originX;
    originY = low.originY;
    const a = iso(0, 0, 0);
    const c = iso(gridN, 0, 0);
    originX = top.originX;
    originY = top.originY - roofGap;
    const b = iso(0, 0, floorZ + 1);
    const d = iso(gridN, 0, floorZ + 1);
    drawPulses(glow, measure([a, b]), now, 32, 3);
    drawPulses(glow, measure([c, d]), now + 500, 32, 2);
  }

  function notchOpen(x: number, y: number): boolean {
    const edge = gridN - 2;
    return towerSolid(x, y) && x >= 2 && y >= 2 && x <= edge && y <= edge && x + y >= gridN - 1;
  }

  function notchTiles(): Pt[] {
    const tiles: Pt[] = [];
    const edge = gridN - 2;
    for (let y = 2; y <= edge; y++) {
      for (let x = 2; x <= edge; x++) {
        if (notchOpen(x, y)) tiles.push({ x, y });
      }
    }
    return tiles;
  }

  function stackFolk(
    role: FloorType,
    level = 7,
  ): { x: number; y: number; pose: Person['pose']; roam: boolean; face: 1 | -1 }[] {
    if (role === 'lobby') {
      return [
        { x: 3, y: 15, pose: 'sit', roam: false, face: -1 },
        { x: 7, y: 15, pose: 'walk', roam: true, face: 1 },
        { x: 10, y: 7, pose: 'walk', roam: true, face: 1 },
        { x: 15, y: 6, pose: 'walk', roam: true, face: 1 },
        { x: 8, y: 12, pose: 'walk', roam: true, face: 1 },
        { x: 9, y: 8, pose: 'walk', roam: true, face: 1 },
      ];
    }
    if (role === 'lounge') {
      return [
        { x: 3, y: 14, pose: 'chat', roam: false, face: 1 },
        { x: 8, y: 13, pose: 'chat', roam: false, face: 1 },
        { x: 9, y: 7, pose: 'chat', roam: false, face: -1 },
        { x: 11, y: 7, pose: 'walk', roam: true, face: 1 },
      ];
    }
    if (role === 'sales') {
      return [
        { x: 2, y: 15, pose: 'sit', roam: false, face: -1 },
        { x: 6, y: 15, pose: 'sit', roam: false, face: -1 },
        { x: 14, y: 5, pose: 'sit', roam: false, face: 1 },
        { x: 8, y: 14, pose: 'walk', roam: true, face: 1 },
      ];
    }
    if (role === 'it') {
      return [
        { x: 6, y: 15, pose: 'sit', roam: false, face: -1 },
        { x: 2, y: 13, pose: 'sit', roam: false, face: 1 },
      ];
    }
    if (role === 'vacant') return [];
    if (level <= 5) {
      return [
        { x: 3, y: 15, pose: 'sit', roam: false, face: -1 },
        { x: 4, y: 12, pose: 'sit', roam: false, face: 1 },
        { x: 12, y: 7, pose: 'sit', roam: false, face: 1 },
        { x: 8, y: 12, pose: 'walk', roam: true, face: 1 },
      ];
    }
    return [
      { x: 2, y: 15, pose: 'sit', roam: false, face: -1 },
      { x: 6, y: 15, pose: 'sit', roam: false, face: -1 },
      { x: 4, y: 12, pose: 'sit', roam: false, face: 1 },
      { x: 11, y: 6, pose: 'sit', roam: false, face: 1 },
      { x: 8, y: 14, pose: 'walk', roam: true, face: 1 },
    ];
  }

  function footprintTiles(item: Furn): { x: number; y: number }[] {
    const depth = item.kind === 'room' ? 2 : 1;
    const tiles: { x: number; y: number }[] = [];
    for (let j = 0; j < depth; j++) {
      for (let i = 0; i < item.w; i++) tiles.push({ x: item.x + i, y: item.y + j });
    }
    if (item.kind === 'desk') {
      const face = item.face ?? 1;
      for (let i = 0; i < item.w; i++) tiles.push({ x: item.x + i, y: item.y + face });
    }
    return tiles;
  }

  function blockedTiles(item: Furn): { x: number; y: number }[] {
    const tiles = footprintTiles(item);
    if (item.kind === 'room' || item.kind === 'booth') {
      const depth = item.kind === 'room' ? 2 : 1;
      for (let y = item.y - 1; y <= item.y + depth; y++) {
        for (let x = item.x - 1; x <= item.x + item.w; x++) tiles.push({ x, y });
      }
    }
    return tiles;
  }

  function fitsNotch(item: Furn): boolean {
    const edge = gridN - 2;
    return footprintTiles(item).every((t) => towerSolid(t.x, t.y) && t.x >= 1 && t.y >= 1 && t.x <= edge && t.y <= edge);
  }

  function stackAccents(role: FloorType, level = 7): Furn[] {
    const rnd: Furn[] = level <= 5
      ? [
          { kind: 'desk', x: 3, y: 15, w: 2, face: -1 },
          { kind: 'desk', x: 5, y: 15, w: 2, face: -1 },
          { kind: 'desk', x: 2, y: 12, w: 2, face: 1 },
          { kind: 'desk', x: 4, y: 12, w: 2, face: 1 },
          { kind: 'desk', x: 6, y: 12, w: 2, face: 1 },
          { kind: 'desk', x: 3, y: 10, w: 2, face: -1 },
          { kind: 'desk', x: 6, y: 10, w: 2, face: -1 },
          { kind: 'desk', x: 9, y: 7, w: 2, face: 1 },
          { kind: 'desk', x: 12, y: 7, w: 2, face: 1 },
          { kind: 'desk', x: 10, y: 5, w: 2, face: -1 },
          { kind: 'desk', x: 14, y: 5, w: 2, face: -1 },
          { kind: 'file', x: 8, y: 15, w: 1 },
          { kind: 'file', x: 8, y: 11, w: 1 },
          { kind: 'file', x: 15, y: 2, w: 1 },
          { kind: 'board', x: 8, y: 13, w: 1 },
          { kind: 'board', x: 15, y: 8, w: 1 },
          { kind: 'plant', x: 8, y: 9, w: 1 },
          { kind: 'plant', x: 11, y: 2, w: 1 },
          { kind: 'print', x: 1, y: 12, w: 1 },
        ]
      : [
          { kind: 'desk', x: 2, y: 15, w: 2, face: -1 },
          { kind: 'desk', x: 4, y: 15, w: 2, face: -1 },
          { kind: 'desk', x: 6, y: 15, w: 2, face: -1 },
          { kind: 'desk', x: 2, y: 12, w: 2, face: 1 },
          { kind: 'desk', x: 4, y: 12, w: 2, face: 1 },
          { kind: 'desk', x: 6, y: 12, w: 2, face: 1 },
          { kind: 'desk', x: 2, y: 10, w: 2, face: -1 },
          { kind: 'desk', x: 4, y: 10, w: 2, face: -1 },
          { kind: 'desk', x: 6, y: 10, w: 2, face: -1 },
          { kind: 'desk', x: 9, y: 6, w: 2, face: 1 },
          { kind: 'desk', x: 11, y: 6, w: 2, face: 1 },
          { kind: 'desk', x: 14, y: 6, w: 2, face: 1 },
          { kind: 'desk', x: 9, y: 4, w: 2, face: -1 },
          { kind: 'desk', x: 11, y: 4, w: 2, face: -1 },
          { kind: 'desk', x: 14, y: 4, w: 2, face: -1 },
          { kind: 'file', x: 8, y: 15, w: 1 },
          { kind: 'file', x: 8, y: 12, w: 1 },
          { kind: 'file', x: 8, y: 10, w: 1 },
          { kind: 'file', x: 15, y: 2, w: 1 },
          { kind: 'board', x: 9, y: 2, w: 2 },
          { kind: 'board', x: 12, y: 8, w: 2 },
          { kind: 'plant', x: 8, y: 13, w: 1 },
          { kind: 'plant', x: 15, y: 5, w: 1 },
          { kind: 'print', x: 8, y: 9, w: 1 },
        ];
    if (role === 'lobby') {
      return [
        { kind: 'desk', x: 3, y: 15, w: 3, face: -1 },
        { kind: 'gate', x: 2, y: 14, w: 1 },
        { kind: 'gate', x: 6, y: 14, w: 1 },
        { kind: 'sofa', x: 2, y: 13, w: 2 },
        { kind: 'sofa', x: 6, y: 12, w: 2 },
        { kind: 'table', x: 8, y: 14, w: 1 },
        { kind: 'screen', x: 11, y: 5, w: 2 },
        { kind: 'screen', x: 14, y: 4, w: 2 },
        { kind: 'plant', x: 8, y: 15, w: 1 },
        { kind: 'plant', x: 8, y: 13, w: 1 },
        { kind: 'plant', x: 15, y: 7, w: 1 },
        { kind: 'plant', x: 12, y: 8, w: 1 },
      ];
    }
    if (role === 'lounge') {
      return [
        { kind: 'sofa', x: 2, y: 15, w: 2 },
        { kind: 'sofa', x: 5, y: 15, w: 2 },
        { kind: 'sofa', x: 2, y: 13, w: 2 },
        { kind: 'sofa', x: 6, y: 13, w: 2 },
        { kind: 'table', x: 4, y: 14, w: 1 },
        { kind: 'table', x: 8, y: 14, w: 1 },
        { kind: 'table', x: 8, y: 12, w: 1 },
        { kind: 'shelf', x: 4, y: 12, w: 2 },
        { kind: 'coffee', x: 10, y: 6, w: 2 },
        { kind: 'pong', x: 13, y: 4, w: 3 },
        { kind: 'plant', x: 8, y: 15, w: 1 },
        { kind: 'plant', x: 7, y: 12, w: 1 },
        { kind: 'plant', x: 15, y: 7, w: 1 },
        { kind: 'plant', x: 12, y: 8, w: 1 },
        { kind: 'plant', x: 9, y: 3, w: 1 },
      ];
    }
    if (role === 'sales') {
      return [
        { kind: 'room', x: 4, y: 10, w: 2 },
        { kind: 'desk', x: 2, y: 15, w: 2, face: -1 },
        { kind: 'desk', x: 6, y: 15, w: 2, face: -1 },
        { kind: 'desk', x: 2, y: 12, w: 2, face: 1 },
        { kind: 'desk', x: 8, y: 12, w: 1, face: 1 },
        { kind: 'desk', x: 9, y: 6, w: 2, face: -1 },
        { kind: 'desk', x: 12, y: 6, w: 2, face: -1 },
        { kind: 'desk', x: 14, y: 5, w: 2, face: 1 },
        { kind: 'desk', x: 9, y: 7, w: 2, face: 1 },
        { kind: 'booth', x: 15, y: 3, w: 1 },
        { kind: 'booth', x: 15, y: 8, w: 1 },
        { kind: 'board', x: 12, y: 2, w: 2 },
        { kind: 'plant', x: 8, y: 15, w: 1 },
        { kind: 'plant', x: 1, y: 14, w: 1 },
        { kind: 'plant', x: 11, y: 8, w: 1 },
      ];
    }
    if (role === 'it') {
      return [
        { kind: 'rack', x: 9, y: 6, w: 1 },
        { kind: 'rack', x: 11, y: 6, w: 1 },
        { kind: 'rack', x: 13, y: 6, w: 1 },
        { kind: 'rack', x: 15, y: 6, w: 1 },
        { kind: 'rack', x: 10, y: 4, w: 1 },
        { kind: 'rack', x: 12, y: 4, w: 1 },
        { kind: 'rack', x: 14, y: 4, w: 1 },
        { kind: 'rack', x: 15, y: 3, w: 1 },
        { kind: 'table', x: 2, y: 15, w: 3 },
        { kind: 'table', x: 5, y: 13, w: 3 },
        { kind: 'table', x: 2, y: 12, w: 3 },
        { kind: 'desk', x: 6, y: 15, w: 2, face: -1 },
        { kind: 'desk', x: 2, y: 13, w: 2, face: 1 },
        { kind: 'desk', x: 8, y: 15, w: 1, face: -1 },
        { kind: 'plant', x: 8, y: 12, w: 1 },
        { kind: 'plant', x: 15, y: 7, w: 1 },
      ];
    }
    if (role === 'vacant') {
      return [
        { kind: 'box', x: 3, y: 15, w: 1 },
        { kind: 'box', x: 5, y: 15, w: 1 },
        { kind: 'box', x: 7, y: 14, w: 1 },
        { kind: 'box', x: 2, y: 13, w: 1 },
        { kind: 'box', x: 6, y: 12, w: 1 },
        { kind: 'box', x: 8, y: 15, w: 1 },
        { kind: 'box', x: 8, y: 11, w: 1 },
        { kind: 'box', x: 12, y: 6, w: 2 },
        { kind: 'box', x: 14, y: 5, w: 1 },
        { kind: 'box', x: 15, y: 3, w: 1 },
        { kind: 'marker', x: 4, y: 14, w: 1 },
        { kind: 'marker', x: 9, y: 6, w: 1 },
        { kind: 'marker', x: 13, y: 7, w: 1 },
        { kind: 'marker', x: 15, y: 7, w: 1 },
        { kind: 'marker', x: 6, y: 10, w: 1 },
        { kind: 'chairs', x: 8, y: 13, w: 1 },
      ];
    }
    return rnd;
  }

  function notchLayout(base: FloorLayout, role: FloorType, level: number): FloorLayout {
    void base;
    const furniture = stackAccents(role, level).filter(fitsNotch);
    const block = new Set<string>();
    for (const item of furniture) {
      if (item.kind === 'cable') continue;
      for (const tile of blockedTiles(item)) {
        if (towerSolid(tile.x, tile.y)) block.add(`${tile.x},${tile.y}`);
      }
    }
    const chat = (role === 'lounge' ? [{ x: 3, y: 14 }, { x: 8, y: 13 }, { x: 9, y: 7 }] : []).filter(
      (c) => notchOpen(c.x, c.y) && !block.has(`${c.x},${c.y}`),
    );
    return {
      role,
      solid: (x, y) => towerSolid(x, y),
      blocked: (x, y) => block.has(`${x},${y}`),
      walkable: (x, y) => notchOpen(x, y) && !block.has(`${x},${y}`),
      furniture,
      desks: furniture.filter((item) => item.kind === 'desk'),
      chat,
      anchors: [],
    };
  }

  function paintFloor(now: number, sim: Sim): void {
    queue.length = 0;
    glowSpots.length = 0;
    for (let y = 0; y < gridN; y++) {
      for (let x = 0; x < gridN; x++) {
        if (!(building ? towerSolid(x, y) : layout.solid(x, y))) continue;
        const gx = x;
        const gy = y;
        pushDraw(gx, gy, 0, (g) => {
          const sideA = building ? 1 : 0.9;
          const sideC = building ? 0x071018 : 0x0c243c;
          const cut = (nx: number, ny: number) => (building ? !towerSolid(nx, ny) : !layout.solid(nx, ny));
          const edge = (x0: number, y0: number, x1: number, y1: number, fill: number, strokeA: number) => {
            if (building) poly(g, face(x0, y0, x1, y1), fill, 1);
            else poly(g, face(x0, y0, x1, y1), fill, sideA, ICE, strokeA);
          };
          if (cut(x, y - 1)) edge(x, y, x + 1, y, sideC, 0.35);
          if (cut(x + 1, y)) edge(x + 1, y, x + 1, y + 1, sideC, 0.3);
          if (cut(x, y + 1)) edge(x, y + 1, x + 1, y + 1, building ? 0x0a1828 : 0x0e2844, 0.4);
          if (cut(x - 1, y)) edge(x, y, x, y + 1, sideC, 0.3);
        });
        pushDraw(gx, gy, 2, (g) => {
          const mark = (x + y) % 2 === 0;
          if (building) {
            poly(g, tilePts(x, y, floorZ), 0x0c1828, 1, mark ? 0x163044 : undefined, 0.45);
          } else {
            poly(g, tilePts(x, y, floorZ), 0x0a1c33, 0.42, mark ? DIM : undefined, 0.28);
          }
        });
        if (y === 0 && !building) {
          pushDraw(gx, gy, 3, (g) => {
            const a = iso(x, y, floorZ);
            const b = iso(x + 1, y, floorZ);
            const c = iso(x + 1, y, wallZ);
            const d = iso(x, y, wallZ);
            poly(g, [a, b, c, d], 0x081018, 0.92, ICE, 0.45);
          });
        }
        if (x === 0 && !building) {
          pushDraw(gx, gy, building ? 20 : 4, (g) => {
            const a = iso(x, y, floorZ);
            const b = iso(x, y + 1, floorZ);
            const c = iso(x, y + 1, wallZ);
            const d = iso(x, y, wallZ);
            poly(g, [a, b, c, d], 0x060e16, building ? 1 : 0.92, ICE, building ? 0.65 : 0.4);
            if (building) {
              const base = iso(x, y + 0.5, floorZ);
              const cap = iso(x, y + 0.5, wallZ);
              g.rect(Math.round(base.x), Math.round(cap.y), u(1), Math.max(2, Math.round(base.y - cap.y))).fill({ color: ICE, alpha: 0.5 });
            }
          });
        }
        if (
          building &&
          ((x === 0 && y === 0) ||
            (x === gridN - 1 && y === 0) ||
            (x === 0 && y === gridN - 1) ||
            (x === TOWER_CUT - 1 && y === TOWER_CUT - 1) ||
            (x === TOWER_CUT - 1 && y === 0) ||
            (x === 0 && y === TOWER_CUT - 1))
        ) {
          pushDraw(gx, gy, 21, (g) => {
            const p = iso(x, y, floorZ);
            const h = Math.max(8, storeyStep - 4);
            g.rect(Math.round(p.x) - 1, Math.round(p.y) - h, 3, h).fill({ color: ICE });
            g.rect(Math.round(p.x) - 1, Math.round(p.y) - h, 3, 1).fill({ color: WHITE });
          });
        }
      }
    }
    const pieces = building ? stackAccents(sim.cfg.type, sim.cfg.level).filter(fitsNotch) : layout.furniture;
    const furnish = (draw: (g: Graphics) => void) => (g: Graphics) => {
      const saved = SPR;
      if (building) SPR = 0.88;
      draw(g);
      SPR = saved;
    };
    for (const item of pieces) {
      if (building && !fitsNotch(item)) continue;
      const frontX = item.x + item.w - 1;
      if (item.kind === 'desk') {
        const face = item.face ?? 1;
        if (face === 1) {
          pushDraw(frontX, item.y, 5, furnish((g) => drawDesk(g, item)));
          pushDraw(frontX, item.y, 7, furnish((g) => drawMonitors(g, item, now)));
          pushDraw(frontX, item.y, 8, furnish((g) => drawChair(g, item)));
        } else {
          pushDraw(frontX, item.y, 3, furnish((g) => drawChair(g, item)));
          pushDraw(frontX, item.y, 6, furnish((g) => drawDesk(g, item)));
          pushDraw(frontX, item.y, 9, furnish((g) => drawMonitors(g, item, now)));
        }
        continue;
      }
      pushDraw(frontX, item.y, item.kind === 'room' || item.kind === 'booth' ? 11 : 6, furnish((g) => drawFurn(g, item, now)));
    }
    for (const person of people) {
      if (building && !towerSolid(Math.round(person.x), Math.round(person.y))) continue;
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
        const floorPt = iso(ox + across, oy + along, floorZ);
        const foot = atDesk ? raise(floorPt, u(DESK_H) - s(2)) : floorPt;
        drawPerson(g, foot, person.pose, person.phase, atDesk, person.dirX, person.dirY);
      });
      if (atDesk) {
        pushDraw(gx, gy, person.face === 1 ? 12 : 5, (g) => {
          const along = person.face === 1 ? 0.72 : 0.28;
          const floorPt = iso(person.homeX + person.span / 2, person.homeY + along, floorZ);
          drawArms(g, raise(floorPt, u(DESK_H) - s(2)), person.phase);
        });
      }
    }
    queue.sort((a, b) => a.key - b.key);
    for (const item of queue) item.draw(world);
    strokeLoop(world, sim.outline, ICE);
    const seated = people.filter((p) => p.pose === 'sit' || p.pose === 'chat').length;
    const wallTop = iso(0, 0, wallZ).y;
    if (!building) {
      const headerY = Math.max(4, Math.round(wallTop) - 30);
      paintText(world, `PATSNAP . ${sim.cfg.label} ${sim.cfg.name}`, 8, headerY, WHITE, 3);
      paintText(world, `SEAT ${seated}/${Math.max(layout.desks.length, seated)}  ON ${people.length}`, 8, headerY + 18, ICE, 2);
    }

    for (const spot of glowSpots) {
      if (spot.hot) {
        glow.rect(spot.x - 3, spot.y - 3, 6, 6).fill({ color: ICE, alpha: 0.28 });
      } else {
        glow.rect(spot.x - 2, spot.y - 1, 4, 2).fill({ color: ICE, alpha: 0.22 });
      }
    }
    const hot = now < burst && (building || sim.cfg.level === focus);
    drawPulses(glow, sim.outline, now + sim.cfg.level * 90, hot ? 78 : 46, hot ? 4 : 3);
    if (!building) {
      for (const column of sim.columns) drawPulses(glow, column, now + 180, 34, 2);
    }
    if (debug && !building) {
      for (let y = 0; y < gridN; y++) {
        for (let x = 0; x < gridN; x++) {
          if (!layout.solid(x, y)) continue;
          const c = iso(x + 0.5, y + 0.5, floorZ);
          world.rect(Math.round(c.x), Math.round(c.y), 1, 1).fill({ color: layout.walkable(x, y) ? 0xffe14a : 0xff5ad8 });
        }
      }
    }
  }

  function stepPeople(dt: number): void {
    for (const sim of sims) {
      layout = sim.layout;
      people = sim.people;
      stepCrew(dt);
    }
  }

  function stepCrew(dt: number): void {
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
        if (person.timer <= 0) {
          const homeChat = layout.chat.some((c) => c.x === person.homeX && c.y === person.homeY);
          if (homeChat && person.x === person.homeX && person.y === person.homeY) person.timer = 6;
          else sendHome(person);
        }
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
        person.dirX = Math.sign(next.x - person.x);
        person.dirY = Math.sign(next.y - person.y);
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
    if (person.roam) {
      const goal = pickGoal(person, people);
      const path = route(layout, { x: person.x, y: person.y }, goal);
      person.path = path.slice(1);
      person.hop = 0;
      person.pose = 'walk';
      if (person.path.length === 0) person.timer = 0.6;
      return;
    }
    if (atHome) {
      const homeChat = layout.chat.some((c) => c.x === person.homeX && c.y === person.homeY);
      person.pose = homeChat ? 'chat' : 'sit';
      person.timer = homeChat ? 6 : 5 + (person.seed % 5);
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
    const chats = layout.chat.filter((c) => layout.walkable(c.x, c.y));
    if (person.seed % 3 !== 0 && chats[0] && chatting.length < 2) {
      const spot = chats[person.seed % chats.length] ?? chats[0];
      return { x: spot.x, y: spot.y };
    }
    const open = aisleTiles(layout).filter((t) => layout.walkable(t.x, t.y) && (t.x !== person.homeX || t.y !== person.homeY));
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
      const sim = sims.find((entry) => entry.cfg.level === ev.level);
      if (!sim) return;
      burst = performance.now() + Math.min(ev.ttlMs, 2800);
      const who = sim.people.find((p) => p.pose === 'sit');
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
  for (let y = 0; y < gridN; y++) {
    for (let x = 0; x < gridN; x++) {
      if (layout.walkable(x, y)) tiles.push({ x, y });
    }
  }
  return tiles;
}

function route(layout: FloorLayout, start: Pt, goal: Pt): Pt[] {
  const walk = (x: number, y: number) => {
    if (x === start.x && y === start.y) return true;
    if (layout.blocked(x, y)) return x === goal.x && y === goal.y;
    return layout.walkable(x, y);
  };
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
        path.push({ x: prev % gridN, y: Math.floor(prev / gridN) });
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
  for (let y = 0; y < gridN; y++) {
    for (let x = 0; x < gridN; x++) {
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
  const screen = best.map((p) => iso(p.x, p.y, floorZ));
  return measure(screen);
}

function columnRuns(iso: (x: number, y: number, z?: number) => Pt): Run[] {
  const corners: Pt[] = [
    { x: 0, y: 0 },
    { x: gridN, y: 0 },
    { x: 0, y: gridN },
  ];
  return corners.map((c) => measure([iso(c.x, c.y, 0), iso(c.x, c.y, wallZ)]));
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
