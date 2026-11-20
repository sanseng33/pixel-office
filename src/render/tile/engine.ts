import { Application, Graphics } from 'pixi.js';
import type { FloorConfig, FloorType } from '../../config/floors.ts';
import { VIEW } from '../../config/display.ts';
import type { OfficeEvent, OfficeEventType } from '../../events/source.ts';
import type { PlateView } from '../plate.ts';
import { PLAN, layoutFor } from './layout.ts';
import type { FloorLayout, Furn } from './layout.ts';
import { createElevator, stepElevator, type Elevator } from './elevator.ts';
import { buildExcludeQuads, buildFloorHitEntries, hitFloorAt, type FloorHitEntry } from './floorHit.ts';

/** Single-floor tiles are 16×11. The stacked building uses a flatter slab so seven floors fit the square. */
let tileW = 16;
let tileH = 11;
let zH = 14;
let floorZ = 1.7;
let wallZ = 4.6;
let SPR = 1;
const DESK_H = 13;

/** Snap to the output grid: whole 540 pixels normally, half pixels while the 5F fine path is active. */
function q(n: number): number {
  return fine ? Math.round(n * HD) / HD : Math.round(n);
}

function u(n: number): number {
  return Math.max(fine ? 1 / HD : 1, q(n * SPR));
}

function s(n: number): number {
  return q(n * SPR);
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
    bob: 0,
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

/**
 * Live tower plate. A: 17×17 minus a 8×8 notch = 225 tiles (the 15-tile PLAN is only the single-floor view).
 * B (default, or ?plate=b): 19×19 minus 9×9 = 280 tiles, +24% floor area. Baseline content is shifted by SHIFT so it keeps
 * the same relation to the notch, and every storey shares the same footprint.
 * Explicit ?plate=a still selects the older 17×17 plate.
 */
const PLATE_B = new URLSearchParams(location.search).get('plate') !== 'a';
const TOWER_N = PLATE_B ? 19 : 17;
const TOWER_CUT = PLATE_B ? 10 : 9;
const SHIFT = PLATE_B ? 1 : 0;
/** Internal supersample. Logical px are the 540/600 grid; ?hd=2 draws each logical px as 2 backing px (storey 52 → 104). */
const HD = Math.max(1, Math.min(2, Math.floor(Number(new URLSearchParams(location.search).get('hd') ?? '2')) || 2));
let fine = false;
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
  // Logical height stays 600 so the tower keeps its storey/roof layout. Width
  // is 640 to hold 2× floor labels on the left and a right-edge elevator
  // without shrinking the building. Do not scale the tower back down.
  const frameW = building ? 640 : VIEW;
  const frameH = building ? 600 : VIEW;
  const resW = frameW * HD;
  const resH = frameH * HD;

  const app = new Application();
  await app.init({
    width: resW,
    height: resH,
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
  world.scale.set(HD);
  glow.scale.set(HD);
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
        if (!f) continue;
        f.x += SHIFT;
        f.y += SHIFT;
        if (!notchOpen(f.x, f.y)) continue;
        if (f.roam && !lay.walkable(f.x, f.y)) continue;
        spawn(f.x, f.y, f.pose, f.roam, 1, f.face, 20 + i);
      }
    }
    return crew;
  }

  const LABEL_SCALE = 2;
  // Tile-space shaft: flush to the y=0 facade at the right tip (x=gridN).
  // Negative y is outward (iso up-right) so the box has visible top and side thickness.
  const SHAFT_X0 = gridN - 1.4;
  const SHAFT_X1 = gridN;
  const SHAFT_Y0 = -0.85;
  const SHAFT_Y1 = 0;
  const CAR_H = 22;
  const elevator: Elevator = createElevator(20261119, 1);
  const elevStops: number[] = [];
  let shaftTop = 0;
  let shaftBot = 0;
  let shaftMinX = 0;
  let shaftMaxX = 0;
  let shaftH = 0;
  let hoveredFloor = 0;
  let hitEntries: FloorHitEntry[] = [];
  let hitExclude: Pt[][] = [];

  originX = 0;
  originY = 0;
  const box = boundsOf();
  const sims: Sim[] = [];
  if (!building) {
    const headerBlock = 22;
    const contentTop = box.minY - headerBlock;
    const contentBottom = box.maxY + 2;
    originX = Math.round(frameW / 2 - (box.minX + box.maxX) / 2);
    originY = Math.round(frameH / 2 - (contentTop + contentBottom) / 2);
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
    storeyStep = 52;
    const wallOver = Math.ceil((wallZ - floorZ) * zH);
    // Roof sits one storey above the 7F slab — same 52px clear height as 1F–6F.
    roofGap = storeyStep;
    const floorsN = shownList.length;
    const totalH = (plateBottom - plateTop) + storeyStep * (floorsN - 1) + roofGap + wallOver + 8;
    const top = Math.max(16, Math.round((frameH - totalH) / 2));
    // Place the tower as in the 600-wide canvas, then shift right only as
    // needed so 2× labels fit in the left gutter. Do not recenter in the
    // wider frame (that would shrink the tower or steal the right shaft).
    let originX0 = Math.round((600 - (plateRight - plateLeft)) / 2 - plateLeft);
    if (originX0 + plateRight > 600 - 6) originX0 = Math.round(600 - 6 - plateRight);
    if (originX0 + plateLeft < 28) originX0 = Math.round(28 - plateLeft);
    originX0 += 14;
    const longest = shownList.reduce((w, cfg) => Math.max(w, (`${cfg.label} ${cfg.name}`).length * 6 * LABEL_SCALE), 0);
    const lipLocalX = (0 - (gridN - 1)) * tileW;
    const leftPad = Math.max(0, 16 + longest + 8 - (originX0 + lipLocalX));
    originX0 += leftPad;
    shownList.forEach((cfg, index) => {
      const fromTop = floorsN - 1 - index;
      originX = originX0;
      originY = Math.round(top + roofGap + wallOver + fromTop * storeyStep - plateTop);
      const lay = layoutFor(cfg.type, cfg.level);
      layout = lay;
      const lip = iso(0, gridN - 1, floorZ);
      const label = `${cfg.label} ${cfg.name}`;
      const textW = label.length * 6 * LABEL_SCALE;
      const textH = 5 * LABEL_SCALE;
      const notchLay = notchLayout(lay, cfg.type, cfg.level);
      sims.push({
        cfg,
        layout: notchLay,
        people: makePeople(cfg, notchLay),
        originX,
        originY,
        outline: buildOutline((x, y) => towerSolid(x, y), iso),
        columns: columnRuns(iso),
        labelX: Math.max(16, Math.min(frameW - 16 - textW, Math.round(lip.x) - textW - 8)),
        labelY: Math.max(12, Math.min(frameH - 12 - textH, Math.round(lip.y) - Math.floor(textH / 2))),
      });
    });
    const lowSim = sims.find((s) => s.cfg.level === 1);
    const highSim = sims.find((s) => s.cfg.level === 7);
    if (lowSim && highSim) {
      originX = lowSim.originX;
      originY = lowSim.originY;
      // Short overrun above the 7F wall, still below the roof slab / PATSNAP board.
      shaftH = (lowSim.originY - highSim.originY) + wallZ * zH + 8;
      const base = corners(SHAFT_X0, SHAFT_Y0, SHAFT_X1, SHAFT_Y1, 0);
      const extents = [...base, ...base.map((p) => raise(p, shaftH))];
      shaftMinX = Math.min(...extents.map((p) => p.x));
      shaftMaxX = Math.max(...extents.map((p) => p.x));
      shaftTop = Math.max(2, Math.round(Math.min(...extents.map((p) => p.y))));
      shaftBot = Math.min(frameH - 2, Math.round(Math.max(...extents.map((p) => p.y))));
      for (const sim of sims) {
        originX = sim.originX;
        originY = sim.originY;
        elevStops[sim.cfg.level] = iso((SHAFT_X0 + SHAFT_X1) / 2, (SHAFT_Y0 + SHAFT_Y1) / 2, floorZ).y;
      }
    }
  }
  layout = sims[0]?.layout ?? layout;
  people = sims[0]?.people ?? [];
  if (building) {
    const hitOpts = {
      gridN,
      tileW,
      tileH,
      zH,
      wallZ,
      storeyStep,
      solid: towerSolid,
    };
    hitEntries = buildFloorHitEntries(
      sims.map((sim) => ({ level: sim.cfg.level, originX: sim.originX, originY: sim.originY })),
      hitOpts,
    );
    const high = sims.find((sim) => sim.cfg.level === 7);
    if (high) {
      const roofX = high.originX;
      const roofY = high.originY - roofGap;
      originX = roofX;
      originY = roofY;
      const anchor = iso(5.6, 4.4, floorZ);
      const boxX = anchor.x - 88;
      const boxY = anchor.y - 26 - 44;
      const sign = [
        { x: boxX - 8, y: boxY - 8 },
        { x: boxX + 202 + 8, y: boxY - 8 },
        { x: boxX + 202 + 8, y: anchor.y + 8 },
        { x: boxX - 8, y: anchor.y + 8 },
      ];
      hitExclude = buildExcludeQuads(roofX, roofY, floorZ + 1, hitOpts, [sign]);
    }
  }
  // Read by scripts/capture.mjs to crop a floor and report geometry. Units are 540-grid pixels.
  (window as unknown as { __tower?: unknown }).__tower = {
    gridN,
    hd: HD,
    tileW,
    tileH,
    tiles: building ? countSolid() : 0,
    floors: sims.map((sim) => {
      originX = sim.originX;
      originY = sim.originY;
      const pts = [iso(0, 0, wallZ), iso(gridN, 0, 0), iso(0, gridN, 0), iso(gridN, gridN, 0)];
      const kinds: Record<string, number> = {};
      for (const f of sim.layout.furniture) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
      return {
        level: sim.cfg.level,
        furniture: kinds,
        visibleFurniture: sim.layout.furniture.filter((f) => footprintTiles(f).some((t) => visibleTile(t.x, t.y))).reduce((counts, f) => {
          counts[f.kind] = (counts[f.kind] ?? 0) + 1;
          return counts;
        }, {} as Record<string, number>),
        people: sim.people.length,
        minX: Math.min(...pts.map((p) => p.x)),
        maxX: Math.max(...pts.map((p) => p.x)),
        minY: Math.min(...pts.map((p) => p.y)),
        maxY: Math.max(...pts.map((p) => p.y)),
      };
    }),
  };
  const towerHook = (window as unknown as { __tower?: Record<string, unknown>; __elevator?: unknown }).__tower;
  if (towerHook) {
    towerHook.frameW = frameW;
    towerHook.frameH = frameH;
    towerHook.labelScale = building ? LABEL_SCALE : 1;
    if (building) {
      towerHook.labels = sims.map((sim) => {
        const text = `${sim.cfg.label} ${sim.cfg.name}`;
        return {
          level: sim.cfg.level,
          text,
          x: sim.labelX,
          y: sim.labelY,
          w: text.length * 6 * LABEL_SCALE,
          h: 5 * LABEL_SCALE,
        };
      });
      towerHook.elevatorShaft = {
        x0: SHAFT_X0,
        x1: SHAFT_X1,
        y0: SHAFT_Y0,
        y1: SHAFT_Y1,
        flushWallY: SHAFT_Y1,
        minX: shaftMinX,
        maxX: shaftMaxX,
        top: shaftTop,
        bot: shaftBot,
        height: shaftH,
      };
      towerHook.plants = sims.map((sim) => ({
        level: sim.cfg.level,
        count: sim.layout.furniture.filter((f) => f.kind === 'plant').length,
      }));
      towerHook.hitFloor = (x: number, y: number) => hitFloorAt(x, y, hitEntries, hitExclude);
      towerHook.hoveredFloor = () => hoveredFloor;
    }
  }
  function countSolid(): number {
    let n = 0;
    for (let y = 0; y < gridN; y++) for (let x = 0; x < gridN; x++) if (towerSolid(x, y)) n++;
    return n;
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
    for (const p of pts) flat.push(q(p.x), q(p.y));
    const shape = g.poly(flat, true);
    shape.fill({ color: fill, alpha: fillA });
    if (stroke !== undefined) {
      if (fine) g.poly(flat, true).stroke({ width: 1 / HD, color: stroke, alpha: strokeA, alignment: 0.5 });
      else g.poly(flat, true).stroke({ width: 1, color: stroke, alpha: strokeA, pixelLine: HD === 1 });
    }
  }

  function tilePts(x: number, y: number, z: number): Pt[] {
    return [iso(x, y, z), iso(x + 1, y, z), iso(x + 1, y + 1, z), iso(x, y + 1, z)];
  }

  function face(x0: number, y0: number, x1: number, y1: number): Pt[] {
    return [iso(x0, y0, floorZ), iso(x1, y1, floorZ), iso(x1, y1, 0), iso(x0, y0, 0)];
  }

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

  let personScale = 1;

  /** Desk-top lift uses the same SPR as stacked furniture so typists sit at the slab, not through it. */
  function seatLift(): number {
    const saved = SPR;
    if (building) SPR = 0.88;
    const lift = u(DESK_H) - s(2);
    SPR = saved;
    return lift;
  }

  function drawHeart(g: Graphics, x: number, y: number): void {
    const s = personScale;
    g.rect(x - 2 * s, y, s, s).fill({ color: WHITE });
    g.rect(x + s, y, s, s).fill({ color: WHITE });
    g.rect(x - 2 * s, y + s, 4 * s, s).fill({ color: ICE });
    g.rect(x - s, y + 2 * s, 2 * s, s).fill({ color: ICE });
  }

  function drawGuy(
    g: Graphics,
    fx: number,
    fy: number,
    hair: number,
    toward: boolean,
    faceRight: boolean,
    frame: number,
    seated: boolean,
    chat: boolean,
    dirX: number,
    dirY: number,
  ): void {
    if (fine) {
      drawGuyFine(g, fx, fy, hair, toward, faceRight, frame, seated, chat, dirX, dirY);
      return;
    }
    const s = personScale;
    const pix = (x: number, up: number, color: number) => {
      g.rect(fx + x * s, fy - up * s, s, s).fill({ color });
    };
    const blk = (x: number, up: number, w: number, h: number, fill: number) => {
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) pix(x + xx, up - yy, fill);
      }
      for (let xx = 0; xx < w; xx++) {
        pix(x + xx, up + 1, ICE);
        pix(x + xx, up - h, ICE);
      }
      for (let yy = 0; yy < h; yy++) {
        pix(x - 1, up - yy, ICE);
        pix(x + w, up - yy, ICE);
      }
    };
    const stride = stridePose(dirX, dirY, frame < 0 ? 0 : frame);
    const ox = frame < 0 ? 0 : Math.round(stride.left.x);
    const oy = frame < 0 ? 0 : Math.round(stride.left.y);
    if (!seated) {
      blk(-3 + ox, 4 - oy, 2, 3, NAVY);
      blk(1 - ox, 4 + oy, 2, 3, NAVY);
      pix(-3 + ox, 1 - oy, WHITE);
      pix(2 - ox, 1 + oy, WHITE);
    }
    blk(-2, 8, 5, 4, NAVY);
    pix(0, 8, WHITE);
    pix(-1, 7, ICE);
    pix(1, 7, ICE);
    const arm = frame < 0 ? 0 : Math.round(stride.armL.y);
    blk(-5, 7 + (chat ? 2 : arm), 2, 3, NAVY);
    pix(-5, 5 + (chat ? 2 : arm), ICE);
    blk(3, 7 - arm, 2, 3, NAVY);
    pix(4, 5 - arm, ICE);
    blk(-2, 13, 5, 5, NAVY);
    if (toward) {
      pix(-1, 11, WHITE);
      pix(1, 11, WHITE);
    } else {
      blk(-2, 13, 5, 2, NAVY);
    }
    if (hair === 1) {
      blk(-2, 15, 1, 2, NAVY);
      blk(0, 16, 1, 3, NAVY);
      blk(2, 15, 1, 2, NAVY);
      blk(-2, 13, 5, 1, NAVY);
    } else if (hair === 2) {
      blk(-3, 14, 7, 2, NAVY);
      blk(-3, 12, 1, 3, NAVY);
      blk(3, 12, 1, 3, NAVY);
    } else if (hair === 3) {
      blk(-2, 14, 5, 2, NAVY);
      blk(toward ? (faceRight ? -5 : 4) : faceRight ? 3 : -5, 12, 2, 4, NAVY);
    } else {
      blk(-2, 14, 5, 2, NAVY);
    }
    if (chat) drawHeart(g, fx, fy - 18 * s);
  }

  function drawPerson(
    g: Graphics,
    foot: Pt,
    pose: Person['pose'],
    phase: number,
    lit: boolean,
    dirX = 0,
    dirY = 1,
    hair = 0,
  ): void {
    const fx = q(foot.x);
    const fy = q(foot.y);
    const frame = pose === 'walk' ? Math.floor(phase * 8) % 4 : -1;
    const toward = dirX + dirY > 0;
    const faceRight = dirX > 0 || (dirX === 0 && dirY < 0);
    personScale = building ? 1 : 2;
    drawGuy(g, fx, fy, hair, toward, faceRight, frame, pose === 'sit', pose === 'chat', dirX, dirY);
    void lit;
  }

  function drawArms(g: Graphics, foot: Pt, phase: number): void {
    if (fine) {
      drawHandsFine(g, foot, phase);
      return;
    }
    const s = personScale;
    const fx = Math.round(foot.x);
    const fy = Math.round(foot.y);
    const type = Math.floor(phase * 6) % 2;
    const hand = (x: number, y: number) => {
      g.rect(x, y, 3 * s, 2 * s).fill({ color: NAVY });
      g.rect(x, y, 3 * s, s).fill({ color: ICE });
      g.rect(x, y + s, s, s).fill({ color: WHITE });
    };
    hand(fx - 5 * s, fy - s + type * s);
    hand(fx + 2 * s, fy - s + (1 - type) * s);
  }

  function drawMonitor(g: Graphics, mx: number, my: number, towardCamera: boolean, lit: boolean, now: number): void {
    if (fine) {
      drawMonitorFine(g, mx, my, towardCamera, lit, now);
      return;
    }
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
    if (fine) {
      drawDeskFine(g, item);
      return;
    }
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
    if (fine) {
      drawChairFine(g, item);
      return;
    }
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

  function drawFurn(g: Graphics, item: Furn, now: number, meeting = false): void {
    if (item.kind === 'desk') {
      drawDesk(g, item);
      return;
    }
    if (item.kind === 'table') {
      const [a, b, c, d] = corners(item.x + 0.08, item.y + 0.22, item.x + item.w - 0.08, item.y + 0.78, floorZ);
      if (meeting && item.w === 2) {
        // Open space beneath a thin top makes the 5F meeting piece read as a table.
        for (const p of [a, b, c, d]) {
          const top = raise(p, u(6));
          g.rect(Math.round(p.x), Math.round(top.y), u(1), Math.max(1, Math.round(p.y - top.y))).fill({ color: ICE });
        }
        volume(g, a, b, c, d, u(6), u(7));
      } else {
        volume(g, a, b, c, d, u(3), u(9));
      }
      return;
    }
    if (item.kind === 'plant') {
      const [a, b, c, d] = corners(item.x + 0.36, item.y + 0.36, item.x + 0.64, item.y + 0.64, floorZ);
      volume(g, a, b, c, d, 0, u(3));
      const pot = raise(iso(item.x + 0.5, item.y + 0.5, floorZ), u(3));
      const cx = Math.round(pot.x);
      const cy = Math.round(pot.y);
      // Short stem, then a few ICE leaves fanning up and outward (WHITE tips).
      // Open silhouette — not a filled 9×6 block that read as a mini screen.
      g.rect(cx, cy - 4, 1, 4).fill({ color: ICE });
      g.rect(cx, cy - 9, 1, 5).fill({ color: ICE });
      g.rect(cx - 1, cy - 8, 1, 3).fill({ color: ICE });
      g.rect(cx + 1, cy - 8, 1, 3).fill({ color: ICE });
      g.rect(cx, cy - 10, 1, 1).fill({ color: WHITE });
      g.rect(cx - 1, cy - 6, 1, 2).fill({ color: ICE });
      g.rect(cx - 2, cy - 8, 1, 3).fill({ color: ICE });
      g.rect(cx - 3, cy - 8, 1, 2).fill({ color: ICE });
      g.rect(cx - 4, cy - 9, 1, 1).fill({ color: WHITE });
      g.rect(cx + 1, cy - 6, 1, 2).fill({ color: ICE });
      g.rect(cx + 2, cy - 8, 1, 3).fill({ color: ICE });
      g.rect(cx + 3, cy - 8, 1, 2).fill({ color: ICE });
      g.rect(cx + 4, cy - 9, 1, 1).fill({ color: WHITE });
      g.rect(cx - 1, cy - 4, 1, 1).fill({ color: ICE });
      g.rect(cx - 2, cy - 5, 1, 2).fill({ color: ICE });
      g.rect(cx - 3, cy - 6, 1, 2).fill({ color: ICE });
      g.rect(cx - 4, cy - 6, 1, 1).fill({ color: WHITE });
      g.rect(cx + 1, cy - 4, 1, 1).fill({ color: ICE });
      g.rect(cx + 2, cy - 5, 1, 2).fill({ color: ICE });
      g.rect(cx + 3, cy - 6, 1, 2).fill({ color: ICE });
      g.rect(cx + 4, cy - 6, 1, 1).fill({ color: WHITE });
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
    if (item.kind === 'chairs' && meeting) {
      for (let i = 0; i < item.w; i++) {
        const x = item.x + i + 0.5;
        const y = item.y + 0.5;
        const seat = iso(x, y, floorZ);
        const back = iso(x, item.y + (item.y > gridN - 3 ? 0.72 : 0.28), floorZ);
        const [a, b, c, d] = corners(x - 0.2, y - 0.17, x + 0.2, y + 0.17, floorZ);
        for (const p of [a, c]) {
          g.rect(Math.round(p.x), Math.round(p.y) - u(3), u(1), u(3)).fill({ color: ICE });
        }
        poly(g, [raise(a, u(3)), raise(b, u(3)), raise(c, u(3)), raise(d, u(3))], INK, 1, WHITE, 1);
        g.rect(Math.round(back.x) - u(2), Math.round(back.y) - u(8), u(4), u(3)).fill({ color: ICE });
        g.rect(Math.round(back.x) - u(2), Math.round(back.y) - u(8), u(4), u(1)).fill({ color: WHITE });
        void seat;
      }
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
    if (item.kind === 'tread') {
      const [a, b, c, d] = corners(item.x + 0.08, item.y + 0.28, item.x + item.w - 0.08, item.y + 0.72, floorZ);
      volume(g, a, b, c, d, 0, u(3));
      const belt = raise(iso(item.x + item.w / 2, item.y + 0.5, floorZ), u(3));
      g.rect(Math.round(belt.x) - u(7), Math.round(belt.y), u(14), u(1)).fill({ color: ICE });
      g.rect(Math.round(belt.x) - u(6), Math.round(belt.y) + u(2), u(12), u(1)).fill({ color: WHITE });
      const console = iso(item.x + 0.22, item.y + 0.5, floorZ);
      g.rect(Math.round(console.x) - u(1), Math.round(console.y) - u(10), u(2), u(8)).fill({ color: ICE });
      g.rect(Math.round(console.x) - u(3), Math.round(console.y) - u(12), u(6), u(4)).fill({ color: INK });
      g.rect(Math.round(console.x) - u(3), Math.round(console.y) - u(12), u(6), u(1)).fill({ color: WHITE });
      g.rect(Math.round(console.x) - u(2), Math.round(console.y) - u(11), u(4), u(2)).fill({ color: ICE });
      return;
    }
    if (item.kind === 'bike') {
      const base = iso(item.x + 0.5, item.y + 0.5, floorZ);
      const x = Math.round(base.x);
      const y = Math.round(base.y);
      g.rect(x - u(4), y - u(1), u(8), u(2)).fill({ color: INK });
      g.rect(x - u(4), y - u(1), u(8), u(1)).fill({ color: ICE });
      g.rect(x - u(1), y - u(8), u(2), u(7)).fill({ color: ICE });
      g.rect(x - u(3), y - u(9), u(4), u(2)).fill({ color: WHITE });
      g.rect(x - u(5), y - u(6), u(3), u(1)).fill({ color: ICE });
      g.rect(x + u(2), y - u(5), u(1), u(1)).fill({ color: ICE });
      g.rect(x + u(2), y - u(6), u(4), u(4)).fill({ color: INK });
      g.rect(x + u(2), y - u(6), u(4), u(1)).fill({ color: WHITE });
      g.rect(x + u(3), y - u(5), u(2), u(2)).fill({ color: ICE });
      return;
    }
    if (item.kind === 'weights') {
      const [a, b, c, d] = corners(item.x + 0.14, item.y + 0.28, item.x + item.w - 0.14, item.y + 0.72, floorZ);
      volume(g, a, b, c, d, 0, u(3));
      const mid = raise(iso(item.x + item.w / 2, item.y + 0.5, floorZ), u(3));
      const x = Math.round(mid.x);
      const y = Math.round(mid.y);
      g.rect(x - u(6), y - u(10), u(2), u(10)).fill({ color: ICE });
      g.rect(x + u(4), y - u(10), u(2), u(10)).fill({ color: ICE });
      g.rect(x - u(6), y - u(11), u(12), u(1)).fill({ color: WHITE });
      for (const ox of [-4, 0, 4]) {
        g.rect(x + u(ox) - u(2), y - u(8), u(4), u(4)).fill({ color: INK });
        g.rect(x + u(ox) - u(2), y - u(8), u(4), u(1)).fill({ color: WHITE });
        g.rect(x + u(ox) - u(1), y - u(7), u(2), u(2)).fill({ color: ICE });
      }
      return;
    }
    if (item.kind === 'bench') {
      const [a, b, c, d] = corners(item.x + 0.1, item.y + 0.3, item.x + item.w - 0.1, item.y + 0.7, floorZ);
      volume(g, a, b, c, d, 0, u(4));
      const pad = raise(iso(item.x + item.w / 2, item.y + 0.5, floorZ), u(4));
      g.rect(Math.round(pad.x) - u(item.w * 5), Math.round(pad.y) - u(1), u(item.w * 10), u(2)).fill({ color: WHITE });
      g.rect(Math.round(pad.x) - u(item.w * 5), Math.round(pad.y) - u(1), u(item.w * 10), u(1)).fill({ color: ICE });
      return;
    }
    if (item.kind === 'mat') {
      const [a, b, c, d] = corners(item.x + 0.12, item.y + 0.22, item.x + item.w - 0.12, item.y + 0.78, floorZ);
      poly(g, [a, b, c, d], 0x0c2838, 1, ICE, 1);
      const mid = iso(item.x + item.w / 2, item.y + 0.5, floorZ);
      g.rect(Math.round(mid.x) - u(3), Math.round(mid.y), u(6), u(1)).fill({ color: WHITE });
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

  /* 5F fine sprites. Drawn on a half-pixel grid (HD=2) so detail is real, not upscaled. Palette stays navy/ice/white. */
  const SHIRT = [0x123a5e, 0x0e2c4a, 0x1a4670, 0x10324f] as const;
  const PANTS = 0x0a1a2c;
  const SKIN = 0x9fc9e6;
  // Back-facing skull/hair used NAVY (ΔL=0 vs the floor), so the head vanished
  // and only the ICE side ticks remained. HAIR is mid-navy, slightly darker
  // than the darkest shirt (0x0e2c4a) but ΔL≈19.6 above the floor — a fill
  // change, not an outline-only tweak.
  const HAIR = 0x0f2a40;
  const SCREEN = 0x1a4670;
  const CODE = 0x4a8db3;

  function drawGuyFine(
    g: Graphics,
    fx: number,
    fy: number,
    hair: number,
    toward: boolean,
    faceRight: boolean,
    frame: number,
    seated: boolean,
    chat: boolean,
    dirX: number,
    dirY: number,
  ): void {
    const p = personScale / HD;
    /** Row r is the r-th fine pixel above the foot line. */
    const fill = (x: number, r: number, w: number, h: number, color: number) => {
      g.rect(fx + x * p, fy - (r + h) * p, w * p, h * p).fill({ color });
    };
    // Compact pixel-office figure (~26 fine px): 6-row legs, 8-row torso, 8-row head. Dark outline, readable features.
    const side = faceRight ? 1 : -1;
    const shirt = SHIRT[hair % SHIRT.length] ?? SHIRT[0];
    const walking = frame >= 0;
    const stride = !walking ? 0 : frame === 0 ? 3 : frame === 1 ? 1 : frame === 2 ? -3 : -1;
    const lean = dirX - dirY;
    const off = stride * (lean === 0 ? 1 : Math.sign(lean));
    const sitDrop = seated ? 4 : 0;
    if (!seated) {
      // Scissor walk: legs slant from hip, feet split; wider stride for clarity.
      // ICE column edges + white toes (same language as coarse drawGuy) so the
      // 1-backing-px legs read on the navy slab instead of vanishing as a half body.
      for (const [hip, o] of [
        [-3, off],
        [1, -off],
      ] as const) {
        for (let r = 1; r < 7; r++) {
          const x = hip + Math.round((o * (7 - r)) / 6);
          fill(x, r, 2, 1, PANTS);
          fill(x - 1, r, 1, 1, ICE);
          fill(x + 2, r, 1, 1, ICE);
        }
        const heel = hip + o - (side < 0 ? 1 : 0);
        fill(heel, 0, 3, 1, NAVY);
        fill(heel + (side < 0 ? 0 : 2), 0, 1, 1, WHITE);
        fill(heel, 1, 1, 1, ICE);
        fill(heel + 2, 1, 1, 1, ICE);
      }
    } else {
      // Thighs forward onto the chair seat; shins hidden by the desk.
      fill(-3, 3, 6, 2, PANTS);
      fill(side > 0 ? 1 : -4, 1, 3, 2, PANTS);
      fill(-4, 3, 1, 2, ICE);
      fill(3, 3, 1, 2, ICE);
      fill(side > 0 ? 0 : -5, 1, 1, 2, ICE);
      fill(side > 0 ? 4 : -1, 1, 1, 2, ICE);
    }
    const r0 = 7 - sitDrop;
    // Torso: shoulders wider than waist, belt line, collar.
    fill(-4, r0, 8, 1, INK);
    fill(-4, r0 + 1, 8, 5, shirt);
    fill(-5, r0 + 5, 10, 2, shirt);
    fill(-5, r0 + 1, 1, 4, ICE);
    fill(4, r0 + 1, 1, 4, ICE);
    if (toward) {
      fill(-1, r0 + 6, 2, 1, WHITE);
      fill(0, r0 + 2, 1, 3, DIM);
    } else {
      // Back: closed collar and a centre seam, no buttons or shirt-front V.
      fill(-2, r0 + 6, 4, 1, shirt);
      fill(-1, r0 + 3, 2, 1, DIM);
    }
    // Arms: sleeve plus hand, swinging opposite the legs. Seated typing hands come from drawHandsFine.
    if (!seated || chat) {
      const aL = chat ? 4 : Math.round(-off / 2);
      const aR = chat ? 0 : Math.round(off / 2);
      fill(-7, r0 + 2 + aL, 2, 5, shirt);
      fill(-7, r0 + 1 + aL, 2, 1, SKIN);
      fill(5, r0 + 2 + aR, 2, 5, shirt);
      fill(5, r0 + 1 + aR, 2, 1, SKIN);
    } else {
      // Upper arms from the shoulders; forearms tuck inward so they meet the keyboard hands.
      fill(-6, r0 + 4, 2, 3, shirt);
      fill(-5, r0 + 2, 3, 2, shirt);
      fill(4, r0 + 4, 2, 3, shirt);
      fill(2, r0 + 2, 3, 2, shirt);
    }
    // Neck, head, hair with distinct silhouettes.
    const h0 = r0 + 7;
    const hairFill = toward ? NAVY : HAIR;
    fill(-1, h0, 2, 1, SKIN);
    fill(-3, h0 + 1, 6, 6, toward ? SKIN : HAIR);
    fill(-4, h0 + 2, 1, 4, ICE);
    fill(3, h0 + 2, 1, 4, ICE);
    if (toward) {
      const look = side > 0 ? 1 : 0;
      fill(-2 + look, h0 + 3, 1, 2, INK);
      fill(1 + look, h0 + 3, 1, 2, INK);
      fill(-1, h0 + 2, 2, 1, DIM);
    }
    fill(-3, h0 + 6, 6, 2, hairFill);
    fill(-4, h0 + 5, 1, 2, hairFill);
    fill(3, h0 + 5, 1, 2, hairFill);
    fill(-2, h0 + 7, 3, 1, DIM);
    // Hair: distinct styles, readable in silhouette (SHORT/SPIKY/BOB/TAIL).
    if (hair === 1) {
      fill(-3, h0 + 8, 6, 1, hairFill);
      fill(-2, h0 + 8, 1, 1, DIM);
      fill(0, h0 + 8, 1, 2, hairFill);
      fill(1, h0 + 8, 1, 1, DIM);
    } else if (hair === 2) {
      fill(-5, h0 + 1, 1, 5, hairFill);
      fill(4, h0 + 1, 1, 5, hairFill);
      fill(-3, h0 + 8, 6, 1, hairFill);
    } else if (hair === 3) {
      const tailSide = (toward ? -side : side) > 0 ? 4 : -5;
      fill(tailSide, h0 + 2, 1, 5, hairFill);
      fill(tailSide + (tailSide > 0 ? 1 : -1), h0 + 4, 1, 2, hairFill);
      fill(-3, h0 + 7, 6, 1, hairFill);
    } else {
      fill(-3, h0 + 7, 6, 1, hairFill);
    }
    if (!toward) {
      // Hair covers the skull; a darker nape line keeps the back of the head distinct from the collar.
      fill(-3, h0 + 1, 6, 5, HAIR);
      fill(-2, h0 + 1, 4, 1, DIM);
    }
    if (chat) drawHeart(g, fx, fy - (h0 + 11) * p);
  }

  function drawHandsFine(g: Graphics, foot: Pt, phase: number): void {
    const p = personScale / HD;
    const fx = q(foot.x);
    const fy = q(foot.y);
    const tap = Math.floor(phase * 6) % 2;
    // Seated typists are already raised to desk height and dropped 4 rows.
    // Palms sit on the keyboard band (rows 4-6), meeting the forearm ends (~row 6).
    const palm = (x: number, row: number, finger: number): void => {
      g.rect(fx + (x - 1) * p, fy - (row + 3) * p, 1 * p, 3 * p).fill({ color: INK });
      g.rect(fx + x * p, fy - (row + 3) * p, 3 * p, 3 * p).fill({ color: SKIN });
      g.rect(fx + (x + finger) * p, fy - (row + 1) * p, 1 * p, 1 * p).fill({ color: WHITE });
    };
    palm(-5, 4 + tap, 0);
    palm(3, 4 + (1 - tap), 2);
  }

  function drawMonitorFine(g: Graphics, mx: number, my: number, towardCamera: boolean, lit: boolean, now: number): void {
    const d = 1 / HD;
    const base = raise(iso(mx, my, floorZ), u(DESK_H));
    const px = q(base.x);
    const py = q(base.y);
    g.rect(px - 4 * d, py - d, 8 * d, 2 * d).fill({ color: ICE });
    g.rect(px - d, py - 8 * d, 2 * d, 8 * d).fill({ color: towardCamera ? DIM : ICE });
    const w = 16 * d;
    const h = 11 * d;
    const left = px - w / 2;
    const top = py - 8 * d - h;
    g.rect(left - d, top - d, w + 2 * d, h + 2 * d).fill({ color: ICE });
    g.rect(left, top, w, h).fill({ color: INK });
    if (towardCamera) {
      if (!lit) return;
      g.rect(left + d, top + d, w - 2 * d, h - 2 * d).fill({ color: SCREEN });
      const scroll = Math.floor(now / 400 + mx * 5) % 4;
      for (let row = 0; row < 4; row++) {
        const len = 3 + ((row + scroll + Math.floor(mx)) % 4) * 2;
        g.rect(left + 2 * d, top + (2 + row * 2) * d, len * d, d).fill({ color: CODE });
      }
      // Fine screens remain matte; no emissive halo.
      return;
    }
    // Casing back: centre hump and a vent line, so near-side sitters read as facing away.
    g.rect(left + 3 * d, top + 2 * d, w - 6 * d, h - 4 * d).fill({ color: 0x0c1d30 });
    g.rect(left + 5 * d, top + 4 * d, w - 10 * d, d).fill({ color: DIM });
    if (lit) g.rect(left + d, top - d, w - 2 * d, d).fill({ color: CODE, alpha: 0.6 });
  }

  function drawDeskFine(g: Graphics, item: Furn): void {
    const d = 1 / HD;
    const face = item.face ?? 1;
    const x = item.x;
    const y = item.y;
    const [a, b, c, dd] = corners(x + 0.06, y + 0.14, x + item.w - 0.06, y + 0.86, floorZ);
    const inset = corners(x + 0.14, y + 0.22, x + item.w - 0.14, y + 0.78, floorZ);
    const under = u(DESK_H) - u(2);
    // Modesty panel on the side away from the sitter.
    const m0 = face === 1 ? inset[0] : inset[3];
    const m1 = face === 1 ? inset[1] : inset[2];
    poly(g, [raise(m0, under), raise(m1, under), raise(m1, u(4)), raise(m0, u(4))], 0x0a1828, 1, DIM, 0.9);
    for (const p of inset) {
      const lx = q(p.x) - d;
      g.rect(lx, q(p.y) - under, 3 * d, under).fill({ color: DIM });
      g.rect(lx, q(p.y) - under, d, under).fill({ color: ICE });
      g.rect(lx - d, q(p.y) - d, 5 * d, d).fill({ color: ICE });
    }
    // Two-pixel slab with a lit front lip.
    volume(g, a, b, c, dd, under, u(DESK_H));
    const lipA = raise(dd, u(DESK_H));
    const lipB = raise(c, u(DESK_H));
    g.moveTo(q(lipA.x), q(lipA.y)).lineTo(q(lipB.x), q(lipB.y)).stroke({ width: d, color: WHITE, alpha: 0.7 });
    // Keyboard and mouse on the sitter side.
    const ky0 = face === 1 ? y + 0.5 : y + 0.3;
    const ky1 = ky0 + 0.16;
    const kx0 = x + item.w / 2 - 0.42;
    const kx1 = x + item.w / 2 + 0.42;
    const [k1, k2, k3, k4] = corners(kx0, ky0, kx1, ky1, floorZ);
    const top = u(DESK_H) + d;
    poly(g, [raise(k1, top), raise(k2, top), raise(k3, top), raise(k4, top)], 0x0c1d30, 1, ICE, 0.9);
    const mouse = raise(iso(kx1 + 0.2, (ky0 + ky1) / 2, floorZ), top);
    g.rect(q(mouse.x), q(mouse.y) - d, 2 * d, 2 * d).fill({ color: ICE });
    if ((x + y) % 3 === 0) {
      const mug = raise(iso(x + 0.25, face === 1 ? y + 0.34 : y + 0.66, floorZ), top);
      g.rect(q(mug.x) - d, q(mug.y) - 4 * d, 3 * d, 4 * d).fill({ color: ICE });
      g.rect(q(mug.x), q(mug.y) - 3 * d, d, 3 * d).fill({ color: NAVY });
    }
  }

  function drawChairFine(g: Graphics, item: Furn): void {
    const d = 1 / HD;
    const face = item.face ?? 1;
    const cx = item.x + item.w / 2;
    const y0 = face === 1 ? item.y + 0.6 : item.y + 0.16;
    const y1 = face === 1 ? item.y + 0.84 : item.y + 0.4;
    const mid = iso(cx, (y0 + y1) / 2, floorZ);
    const bx = q(mid.x);
    const by = q(mid.y);
    // Star base and gas lift.
    g.rect(bx - 5 * d, by - d, 10 * d, d).fill({ color: ICE });
    g.rect(bx - 6 * d, by - 2 * d, 2 * d, d).fill({ color: DIM });
    g.rect(bx + 4 * d, by - 2 * d, 2 * d, d).fill({ color: DIM });
    g.rect(bx - d / 2, by - u(5), d, u(5)).fill({ color: ICE });
    // Cushion with thickness.
    const [a, b, c, dd] = corners(cx - 0.2, y0, cx + 0.2, y1, floorZ);
    volume(g, a, b, c, dd, u(5), u(6.5));
    // Backrest on the side away from the desk, with a lumbar line.
    const hingeY = face === 1 ? y1 - 0.02 : y0 + 0.02;
    const hinge = raise(iso(cx, hingeY, floorZ), u(6.5));
    const hx = q(hinge.x);
    const hy = q(hinge.y);
    const w = 12 * d;
    const h = 14 * d;
    g.rect(hx - d / 2, hy - 3 * d, d, 3 * d).fill({ color: ICE });
    g.rect(hx - w / 2 + d, hy - 3 * d - h, w - 2 * d, d).fill({ color: WHITE });
    g.rect(hx - w / 2, hy - 2 * d - h, w, h - d).fill({ color: ICE });
    g.rect(hx - w / 2 + d, hy - 2 * d - h + d, w - 2 * d, h - 3 * d).fill({ color: face === 1 ? INK : 0x0c1d30 });
    g.rect(hx - w / 2 + 3 * d, hy - 8 * d, w - 6 * d, d).fill({ color: DIM });
  }

  function paintPoseSheet(): void {
    world.rect(0, 0, frameW, frameH).fill({ color: 0x060910 });
    fine = HD > 1;
    const cols: { name: string; dx: number; dy: number; frame: number; pose: 'stand' | 'walk' | 'sit' | 'chat' }[] = [
      { name: '+X', dx: 1, dy: 0, frame: 0, pose: 'stand' },
      { name: '-X', dx: -1, dy: 0, frame: 0, pose: 'stand' },
      { name: '+Y', dx: 0, dy: 1, frame: 0, pose: 'stand' },
      { name: '-Y', dx: 0, dy: -1, frame: 0, pose: 'stand' },
      { name: 'W0', dx: 1, dy: 0, frame: 0, pose: 'walk' },
      { name: 'W1', dx: 1, dy: 0, frame: 1, pose: 'walk' },
      { name: 'W2', dx: 1, dy: 0, frame: 2, pose: 'walk' },
      { name: 'W3', dx: 1, dy: 0, frame: 3, pose: 'walk' },
      { name: 'SIT', dx: 1, dy: 0, frame: 0, pose: 'sit' },
      { name: 'CHAT', dx: 0, dy: 1, frame: 0, pose: 'chat' },
    ];
    const hairs = ['SHORT', 'SPIKY', 'BOB', 'TAIL'];
    cols.forEach((col, i) => paintText(world, col.name, 24 + i * 52, 28, ICE, 1));
    for (let hair = 0; hair < 4; hair++) {
      paintText(world, hairs[hair] ?? '', 4, 78 + hair * 100, WHITE, 1);
      cols.forEach((col, i) => {
        const fx = 36 + i * 52;
        const fy = 110 + hair * 100;
        personScale = 3;
        const toward = col.dx + col.dy > 0;
        const faceRight = col.dx > 0 || (col.dx === 0 && col.dy < 0);
        const frame = col.pose === 'walk' ? col.frame : 0;
        drawGuy(world, fx, fy, hair, toward, faceRight, frame, col.pose === 'sit', col.pose === 'chat', col.dx, col.dy);
        if (col.pose === 'sit') drawArms(world, { x: fx, y: fy }, 0.2);
      });
    }
  }

  function carLift(floorY: number): number {
    return (floorY - 1) * storeyStep + floorZ * zH;
  }

  function paintElevator(): void {
    if (!building || shaftH <= 0) return;
    const low = sims.find((s) => s.cfg.level === 1);
    if (!low) return;
    originX = low.originX;
    originY = low.originY;
    const base = corners(SHAFT_X0, SHAFT_Y0, SHAFT_X1, SHAFT_Y1, 0);
    volume(world, base[0], base[1], base[2], base[3], 0, shaftH);
    // Landing ticks on the outward (y=SHAFT_Y0) top edge, in the same iso.
    for (let f = 1; f <= 7; f++) {
      const mark = raise(iso((SHAFT_X0 + SHAFT_X1) / 2, SHAFT_Y0, 0), carLift(f));
      const mx = Math.round(mark.x);
      const my = Math.round(mark.y);
      if (my > shaftTop && my < shaftBot) world.rect(mx - 2, my, 5, 1).fill({ color: ICE });
    }
    let h0 = carLift(elevator.y) + 1;
    let h1 = h0 + CAR_H;
    if (h0 < 2) {
      h1 += 2 - h0;
      h0 = 2;
    }
    if (h1 > shaftH - 2) {
      h0 -= h1 - (shaftH - 2);
      h1 = shaftH - 2;
    }
    if (h0 < 2) h0 = 2;
    const inset = 0.1;
    const car = corners(SHAFT_X0 + inset, SHAFT_Y0 + inset, SHAFT_X1 - inset, SHAFT_Y1 - inset, 0);
    volume(world, car[0], car[1], car[2], car[3], h0, h1);
    // Door slit on the building-facing face (y = SHAFT_Y1 = 0).
    const door = raise(iso((SHAFT_X0 + SHAFT_X1) / 2, SHAFT_Y1, 0), (h0 + h1) / 2);
    const dy = Math.max(8, Math.round(h1 - h0 - 8));
    world.rect(Math.round(door.x), Math.round(door.y) - Math.floor(dy / 2), 1, dy).fill({ color: WHITE });
  }

  function rebuild(now: number): void {
    world.clear();
    glow.clear();
    if (new URLSearchParams(location.search).get('poses') === '1') {
      paintPoseSheet();
      app.render();
      return;
    }
    for (const sim of sims) {
      originX = sim.originX;
      originY = sim.originY;
      layout = sim.layout;
      people = sim.people;
      // Approved typist/silhouette sprites apply on every occupied floor at ?hd=2, not only 5F.
      fine = HD > 1;
      paintFloor(now, sim);
      fine = false;
    }
    if (building) {
      paintRoof(now);
      for (const sim of sims) {
        paintText(world, `${sim.cfg.label} ${sim.cfg.name}`, sim.labelX, sim.labelY, WHITE, LABEL_SCALE);
      }
      paintElevator();
    }
    if (hour >= 20 || hour < 6) world.rect(0, 0, frameW, frameH).fill({ color: 0x02060c, alpha: 0.28 });
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
    // Four outdoor AC units: pad, body, fan, side grille. Inset on solid roof, clear of the sign.
    const acUnits = [
      { x: 2.3, y: 9.2 },
      { x: 3.3, y: 3.2 },
      { x: 12.3, y: 2.3 },
      { x: 15.3, y: 4.3 },
    ];
    for (const spot of acUnits) {
      if (!towerSolid(Math.floor(spot.x), Math.floor(spot.y))) continue;
      const p = iso(spot.x, spot.y, floorZ);
      const cx = Math.round(p.x);
      const cy = Math.round(p.y);
      world.rect(cx - 8, cy - 2, 16, 3).fill({ color: INK });
      world.rect(cx - 8, cy - 2, 16, 1).fill({ color: ICE });
      world.rect(cx - 7, cy - 12, 14, 10).fill({ color: INK });
      world.rect(cx - 7, cy - 12, 14, 1).fill({ color: WHITE });
      world.rect(cx - 7, cy - 3, 14, 1).fill({ color: ICE });
      world.rect(cx - 7, cy - 12, 1, 10).fill({ color: ICE });
      world.rect(cx + 6, cy - 12, 1, 10).fill({ color: ICE });
      world.rect(cx - 5, cy - 8, 7, 1).fill({ color: ICE });
      world.rect(cx - 2, cy - 11, 1, 7).fill({ color: ICE });
      world.rect(cx - 3, cy - 9, 3, 3).fill({ color: WHITE });
      for (let i = 0; i < 4; i++) {
        world.rect(cx + 3, cy - 11 + i * 2, 3, 1).fill({ color: ICE });
      }
    }
    const anchor = iso(5.6, 4.4, floorZ);
    const ax = Math.round(anchor.x);
    const ay = Math.round(anchor.y);
    // PATSNAP board scaled ≈2.2× on both axes; posts grow with the board (was 92×20, posts 12).
    const postH = 26;
    const boxW = 202;
    const boxH = 44;
    const boxX = ax - 88;
    const boxY = ay - postH - boxH;
    world.rect(ax - 53, ay - postH, 3, postH).fill({ color: ICE });
    world.rect(ax + 48, ay - postH, 3, postH).fill({ color: ICE });
    glow.rect(boxX - 6, boxY - 6, boxW + 12, boxH + 12).fill({ color: ICE, alpha: 0.2 });
    world.rect(boxX, boxY, boxW, boxH).fill({ color: INK });
    world.rect(boxX, boxY, boxW, 1).fill({ color: WHITE });
    world.rect(boxX, boxY + boxH - 1, boxW, 1).fill({ color: ICE });
    world.rect(boxX, boxY, 1, boxH).fill({ color: ICE });
    world.rect(boxX + boxW - 1, boxY, 1, boxH).fill({ color: ICE });
    paintText(world, 'PATSNAP', boxX + 17, boxY + 8, WHITE, 4);
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
        { x: 1, y: 15, pose: 'sit', roam: false, face: -1 },
        { x: 7, y: 14, pose: 'walk', roam: true, face: 1 },
        { x: 7, y: 12, pose: 'walk', roam: true, face: 1 },
        { x: 13, y: 5, pose: 'walk', roam: true, face: 1 },
        { x: 14, y: 5, pose: 'walk', roam: true, face: 1 },
      ];
    }
    if (role === 'lounge') {
      return [
        { x: 7, y: 13, pose: 'chat', roam: false, face: 1 },
        { x: 7, y: 12, pose: 'chat', roam: false, face: 1 },
        { x: 7, y: 10, pose: 'walk', roam: true, face: 1 },
        { x: 14, y: 5, pose: 'walk', roam: true, face: 1 },
      ];
    }
    if (role === 'sales') {
      return [
        { x: 6, y: 15, pose: 'sit', roam: false, face: -1 },
        { x: 6, y: 13, pose: 'sit', roam: false, face: -1 },
        { x: 13, y: 7, pose: 'sit', roam: false, face: -1 },
        { x: 7, y: 14, pose: 'walk', roam: true, face: 1 },
        { x: 7, y: 10, pose: 'walk', roam: true, face: 1 },
        { x: 14, y: 5, pose: 'walk', roam: true, face: 1 },
      ];
    }
    if (role === 'it') {
      return [
        { x: 2, y: 9, pose: 'sit', roam: false, face: -1 },
        { x: 5, y: 9, pose: 'sit', roam: false, face: -1 },
        { x: 7, y: 14, pose: 'walk', roam: true, face: 1 },
        { x: 7, y: 11, pose: 'walk', roam: true, face: 1 },
        { x: 13, y: 5, pose: 'walk', roam: true, face: 1 },
      ];
    }
    if (role === 'vacant') return [];
    if (level === 5) {
      return [
        { x: 2, y: 15, pose: 'sit', roam: false, face: 1 },
        { x: 4, y: 15, pose: 'sit', roam: false, face: 1 },
        { x: 6, y: 15, pose: 'sit', roam: false, face: 1 },
        { x: 6, y: 12, pose: 'sit', roam: false, face: 1 },
        { x: 11, y: 7, pose: 'sit', roam: false, face: -1 },
        { x: 13, y: 7, pose: 'sit', roam: false, face: -1 },
      ];
    }
    return [
      { x: 6, y: 15, pose: 'sit', roam: false, face: -1 },
      { x: 6, y: 13, pose: 'sit', roam: false, face: -1 },
      { x: 13, y: 7, pose: 'sit', roam: false, face: -1 },
      { x: 7, y: 14, pose: 'walk', roam: true, face: 1 },
      { x: 7, y: 10, pose: 'walk', roam: true, face: 1 },
      { x: 14, y: 5, pose: 'walk', roam: true, face: 1 },
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

  function visibleTile(x: number, y: number): boolean {
    return inPlate(x, y) && x + y >= gridN - 1;
  }

  function inPlate(x: number, y: number): boolean {
    const edge = gridN - 2;
    return towerSolid(x, y) && x >= 1 && y >= 1 && x <= edge && y <= edge;
  }

  function isAisle(x0: number, y0: number): boolean {
    const x = x0 - SHIFT;
    const y = y0 - SHIFT;
    if (x === 7 && y >= 9 && y <= 15) return true;
    if (x === 8 && y >= 8 && y <= 10) return true;
    if (x === 9 && y === 7) return true;
    if (x === 10 && (y === 7 || y === 6)) return true;
    if (x === 11 && (y === 6 || y === 5)) return true;
    if (y === 5 && x >= 12 && x <= 15) return true;
    return false;
  }

  function stackAccents(role: FloorType, level = 7): Furn[] {
    const items: Furn[] = [];
    const blocked = new Set<string>();
    // The original L-shaped reservation has a diagonal step at (9,9)→(10,8).
    // Reserve the orthogonal connector on every plate-B floor.
    const aisle = (x: number, y: number) =>
      isAisle(x, y) || (SHIFT > 0 && x === 10 && y === 9);
    const mark = (item: Furn) => {
      for (const t of footprintTiles(item)) blocked.add(`${t.x},${t.y}`);
    };
    const put = (kind: Furn['kind'], x: number, y: number, w = 1, face: 1 | -1 = 1): boolean => {
      const item: Furn = { kind, x: x + SHIFT, y: y + SHIFT, w, face };
      const cells = footprintTiles(item);
      if (cells.some((t) => !inPlate(t.x, t.y) || blocked.has(`${t.x},${t.y}`) || aisle(t.x, t.y))) return false;
      items.push(item);
      mark(item);
      return true;
    };
    // Grid scans below use absolute tile coords; put() takes baseline coords and adds SHIFT.
    const putAt = (kind: Furn['kind'], x: number, y: number, w = 1, face: 1 | -1 = 1): boolean =>
      put(kind, x - SHIFT, y - SHIFT, w, face);
    const seen = (x: number, y: number) => visibleTile(x, y) && !blocked.has(`${x},${y}`) && !aisle(x, y);
    if (role === 'vacant') {
      // 6F GYM on both plates: a short, readable set of machines; no vacant boxes/markers.
      put('tread', 2, 14, 2);
      put('tread', 5, 14, 2);
      put('mat', 2, 12);
      put('mat', 4, 12);
      put('bench', 3, 13, 2);
      put('bike', 13, 7);
      put('bike', 15, 7);
      put('weights', 13, 3, 2);
      put('bench', 15, 3);
      put('plant', 15, 4);
      return items;
    }
    if (SHIFT > 0 && (role === 'lobby' || role === 'lounge')) {
      // Plate-B 1F / 2F: a short, hand-placed list for the audience-facing strip (abs coords, visible tiles only).
      // The reserved aisle (x=8 column, diagonal, y=6 row) and the (10,9) connector stay empty; open floor is left
      // between groups so the pieces read individually instead of as a field of small blocks.
      const edge = gridN - 2;
      if (role === 'lobby') {
        // Reception: desk on the front-left, receptionist sits at its first tile (stackFolk 1F).
        putAt('desk', 2, edge - 1, 3, -1);
        // Entrance: two gate posts flank the aisle column; the aisle tile between them stays open.
        putAt('gate', 7, edge - 1);
        putAt('gate', 9, edge - 1);
        // Waiting seats and a side table beside the reception.
        putAt('sofa', 4, 13, 2);
        putAt('table', 5, 14);
        putAt('sofa', 5, 15, 2);
        putAt('plant', 2, edge);
        putAt('plant', 9, 13);
        // Public exhibition: three display screens on the right wing, seats and plants in front.
        putAt('screen', 12, 8, 2);
        putAt('screen', 15, 8, 2);
        putAt('screen', 16, 4, 2);
        putAt('sofa', 13, 9, 2);
        putAt('plant', edge, 9);
        putAt('plant', edge, 7);
      } else {
        // Lounge seating group (front-left): two sofas around a low table.
        putAt('sofa', 3, edge - 1, 2);
        putAt('table', 3, edge - 2, 2);
        putAt('sofa', 4, edge - 3, 2);
        putAt('plant', 2, edge);
        putAt('plant', 7, edge);
        putAt('plant', 9, 13);
        // Right wing: coffee station with tea tables in front, ping-pong at the back with clear play space.
        putAt('coffee', 13, 8, 2);
        putAt('table', 15, 8);
        putAt('table', 15, 9);
        putAt('sofa', 12, 9, 2);
        putAt('plant', edge, 8);
        putAt('pong', 14, 4, 3);
        putAt('plant', edge, 2);
      }
      return items;
    }
    if (role === 'rnd' && level === 5 && SHIFT > 0) {
      // Reserve the front-left meeting area: table with chairs around it.
      putAt('table', 3, gridN - 3, 2);
      putAt('chairs', 3, gridN - 2, 2);
      putAt('chairs', 2, gridN - 3, 1);
      putAt('chairs', 5, gridN - 3, 1);
    }
    if (role === 'sales') {
      put('room', 3, 12, 2);
      put('booth', 15, 7);
      put('booth', 15, 5);
    }
    if (role === 'rnd' || role === 'sales') {
      const rows: ReadonlyArray<readonly [number, 1 | -1]> =
        level === 5
          ? [
              [15, -1],
              [12, 1],
              [10, -1],
            ]
          : [
              [15, -1],
              [13, -1],
              [10, -1],
            ];
      for (const x of [1, 3, 5]) {
        for (const [y, face] of rows) put('desk', x, y, 2, face);
      }
      for (const x of [1, 3, 5]) put('desk', x, 8, 2, -1);
      for (const x of [8, 10, 12, 14]) {
        put('desk', x, 2, 2, -1);
      }
      put('desk', 8, 3, 2, -1);
      put('desk', 10, 3, 2, -1);
      put(role === 'rnd' && level === 5 && SHIFT > 0 ? 'plant' : 'file', 11, 7);
      put('desk', 12, 7, 2, -1);
      put('desk', 14, 7, 2, -1);
      put('board', 12, 3, 2);
      put('plant', 15, 4);
      put(role === 'rnd' && level === 5 && SHIFT > 0 ? 'plant' : 'file', 13, 4);
    }
    if (role === 'it') {
      for (const y of [15, 14, 13]) {
        for (let x = 1; x <= 6; x++) put('rack', x, y);
      }
      for (let x = 12; x <= 15; x++) put('rack', x, 7);
      for (let x = 13; x <= 15; x++) put('rack', x, 6);
      for (let x = 12; x <= 14; x++) put('rack', x, 3);
      put('table', 1, 12, 3);
      put('table', 4, 12, 3);
      put('table', 1, 10, 3);
      put('desk', 1, 9, 2, -1);
      put('desk', 4, 9, 2, -1);
    }
    if (role === 'lounge') {
      put('sofa', 1, 15, 2);
      put('sofa', 4, 15, 2);
      put('table', 3, 14);
      put('sofa', 1, 13, 2);
      put('sofa', 4, 13, 2);
      put('table', 6, 12);
      put('shelf', 1, 10, 2);
      put('plant', 6, 15);
      put('plant', 6, 10);
      put('coffee', 12, 6, 2);
      put('coffee', 14, 3, 2);
      put('pong', 12, 2, 3);
      put('sofa', 12, 7, 2);
      put('table', 14, 7);
      put('table', 15, 6);
      put('sofa', 13, 3, 2);
      put('plant', 11, 7);
      put('plant', 15, 4);
    }
    if (role === 'lobby') {
      put('desk', 1, 15, 3, -1);
      put('gate', 5, 14);
      put('gate', 6, 13);
      put('sofa', 1, 13, 2);
      put('sofa', 4, 13, 2);
      put('table', 3, 12);
      put('sofa', 1, 10, 2);
      put('plant', 6, 15);
      put('plant', 4, 10);
      put('screen', 12, 7, 2);
      put('screen', 14, 7, 2);
      put('screen', 14, 6, 2);
      put('screen', 12, 3, 2);
      put('sofa', 14, 3, 2);
      put('plant', 11, 7);
      put('plant', 15, 4);
    }
    // Plate B adds a visible strip (abs x=1 column, abs y/x = edge rows) that the baseline never furnished.
    // Instead of file cabinets blocking the view, place real workstations, meeting areas, and plants.
    if (SHIFT > 0) {
      const edge = gridN - 2;
      if (role === 'rnd' && level === 5) {
        // Front row: workstations facing forward, clear of the aisle.
        for (const x of [2, 4, 6]) putAt('desk', x, edge - 1, 2, 1);
        putAt('plant', 2, edge);
        putAt('plant', 7, edge);
        // Left edge: workstation rhythm with plants; preserve the L-shaped aisle.
        for (let y = 3; y <= 15; y++) {
          if (!seen(1, y)) continue;
          if ([5, 9, 13].includes(y)) putAt('desk', 1, y, 1, -1);
          else if ([7, 11, 15].includes(y)) putAt('plant', 1, y);
        }
        // Right-facing front corner: workstations and plants only, no file/box storage.
        for (const y of [3, 5, 7]) if (seen(edge, y)) putAt('plant', edge, y);
        for (const y of [4, 6]) if (seen(edge - 1, y)) putAt('desk', edge - 1, y, 2, -1);
      } else if (role === 'sales') {
        // 3F sales strip: a few outward workstations and plants, not a desk on every front tile.
        for (const x of [3, 7]) putAt('desk', x, edge - 1, 2, 1);
        putAt('plant', 2, edge);
        putAt('plant', 5, edge);
        if (seen(1, 4)) putAt('desk', 1, 4, 1, -1);
        if (seen(1, 8)) putAt('plant', 1, 8);
        if (seen(1, 11)) putAt('desk', 1, 11, 1, -1);
        if (seen(edge - 1, 5)) putAt('desk', edge - 1, 5, 2, -1);
        if (seen(edge, 3)) putAt('plant', edge, 3);
        if (seen(edge, 7)) putAt('plant', edge, 7);
      } else if (role === 'it') {
        // 4F strip: rack clusters with gaps, not a solid wall of cabinets; core racks stay below.
        for (const x of [2, 3, 5, 6]) if (seen(x, edge)) putAt('rack', x, edge);
        if (seen(8, edge)) putAt('plant', 8, edge);
        for (const y of [3, 4, 7, 13, 14]) if (seen(1, y)) putAt('rack', 1, y);
        if (seen(1, 6)) putAt('plant', 1, 6);
        for (const y of [3, 4, 7]) if (seen(edge, y)) putAt('rack', edge, y);
      } else if (role === 'rnd') {
        // 7F R&D strip: readable desks and plants, different rhythm from the 5F sample.
        for (const x of [3, 8]) putAt('desk', x, edge - 1, 2, 1);
        putAt('plant', 2, edge);
        putAt('plant', 6, edge);
        putAt('plant', 11, edge);
        for (const y of [4, 14]) if (seen(1, y)) putAt('desk', 1, y, 1, -1);
        for (const y of [7, 11]) if (seen(1, y)) putAt('plant', 1, y);
        if (seen(edge - 1, 5)) putAt('desk', edge - 1, 5, 2, -1);
        if (seen(edge, 3)) putAt('plant', edge, 3);
        if (seen(edge, 7)) putAt('plant', edge, 7);
      }
    }
    for (let y = 2 + SHIFT; y <= 7 + SHIFT; y++) {
      for (let x = 11 + SHIFT; x <= 15 + SHIFT; x++) {
        if (!seen(x, y)) continue;
        if (role === 'it') putAt('rack', x, y);
        else if (role === 'lounge') putAt(x % 2 === 0 ? 'table' : 'plant', x, y);
        else if (role === 'lobby') {
          if (!putAt('screen', x, y, 2)) putAt('plant', x, y);
        }
        else if (SHIFT > 0 && role === 'rnd' && level !== 5) putAt(x % 2 === 0 ? 'plant' : 'desk', x, y);
        else if (SHIFT > 0 && role === 'sales') putAt(x % 2 === 0 ? 'plant' : 'desk', x, y);
        else putAt(role === 'rnd' && level === 5 && SHIFT > 0 ? 'plant' : x % 2 === 0 ? 'file' : 'plant', x, y);
      }
    }
    const filler: Furn['kind'][] =
      role === 'rnd'
        ? (level === 5 && SHIFT > 0 ? ['plant', 'plant', 'plant', 'plant'] : SHIFT > 0 ? ['plant', 'desk', 'plant', 'plant'] : ['file', 'plant', 'plant', 'file'])
        : role === 'sales'
          ? (SHIFT > 0 ? ['plant', 'desk', 'plant'] : ['plant', 'file', 'plant'])
          : role === 'it'
            ? (SHIFT > 0 ? ['plant', 'rack', 'table'] : ['plant', 'file', 'table'])
            : role === 'lounge'
              ? (SHIFT > 0 ? ['plant', 'table', 'sofa'] : ['plant', 'table', 'plant'])
              : role === 'lobby'
                ? (SHIFT > 0 ? ['plant', 'screen', 'plant', 'sofa'] : ['plant', 'table', 'plant'])
                : SHIFT > 0
                  ? ['marker', 'marker', 'marker', 'marker']
                  : ['box', 'marker', 'chairs', 'box'];
    const holeAt = (x: number, y: number) => {
      for (let yy = y - 2; yy <= y; yy++) {
        for (let xx = x - 2; xx <= x; xx++) {
          let empty = true;
          for (let j = 0; j < 3 && empty; j++) {
            for (let i = 0; i < 3; i++) {
              const tx = xx + i;
              const ty = yy + j;
              if (!visibleTile(tx, ty) || aisle(tx, ty) || blocked.has(`${tx},${ty}`)) {
                empty = false;
                break;
              }
            }
          }
          if (empty) return true;
        }
      }
      return false;
    };
    for (let guard = 0; guard < 500; guard++) {
      let placed = false;
      for (let y = 1; y <= gridN - 2 && !placed; y++) {
        for (let x = 1; x <= gridN - 2; x++) {
          if (!seen(x, y) || !holeAt(x, y)) continue;
          const kind = filler[(x + y + level) % filler.length] ?? 'plant';
          if (putAt(kind, x, y)) {
            placed = true;
            break;
          }
        }
      }
      if (!placed) break;
    }
    return items;
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
    const chat = (role === 'vacant' ? [] : [{ x: 7, y: 13 }, { x: 7, y: 12 }, { x: 13, y: 5 }, { x: 14, y: 5 }])
      .map((c) => ({ x: c.x + SHIFT, y: c.y + SHIFT }))
      .filter(
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
          const lit = building && hoveredFloor === sim.cfg.level;
          const sideA = building ? 1 : 0.9;
          const sideC = lit ? 0x163044 : building ? 0x071018 : 0x0c243c;
          const cut = (nx: number, ny: number) => (building ? !towerSolid(nx, ny) : !layout.solid(nx, ny));
          const edge = (x0: number, y0: number, x1: number, y1: number, fill: number, strokeA: number) => {
            if (building) poly(g, face(x0, y0, x1, y1), fill, 1, lit ? ICE : undefined, lit ? 0.55 : 0);
            else poly(g, face(x0, y0, x1, y1), fill, sideA, ICE, strokeA);
          };
          if (cut(x, y - 1)) edge(x, y, x + 1, y, sideC, 0.35);
          if (cut(x + 1, y)) edge(x + 1, y, x + 1, y + 1, sideC, 0.3);
          if (cut(x, y + 1)) edge(x, y + 1, x + 1, y + 1, lit ? 0x1a3d5c : building ? 0x0a1828 : 0x0e2844, 0.4);
          if (cut(x - 1, y)) edge(x, y, x, y + 1, sideC, 0.3);
        });
        pushDraw(gx, gy, 2, (g) => {
          const mark = (x + y) % 2 === 0;
          const lit = building && hoveredFloor === sim.cfg.level;
          if (building) {
            poly(g, tilePts(x, y, floorZ), lit ? 0x1a3d5c : 0x0c1828, 1, lit ? ICE : mark ? 0x163044 : undefined, lit ? 0.8 : 0.45);
            if (lit) poly(g, tilePts(x, y, floorZ), ICE, 0.12);
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
      pushDraw(frontX, item.y, item.kind === 'room' || item.kind === 'booth' ? 11 : 6, furnish((g) => drawFurn(g, item, now, building && SHIFT > 0 && sim.cfg.level === 5)));
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
        const foot = atDesk ? raise(floorPt, seatLift()) : floorPt;
        const dx = atDesk ? 0 : person.dirX;
        const dy = atDesk ? (person.face === 1 ? -1 : 1) : person.dirY;
        drawPerson(g, foot, person.pose, person.phase, atDesk, dx, dy, person.seed % 4);
      });
      if (atDesk) {
        pushDraw(gx, gy, person.face === 1 ? 12 : 5, (g) => {
          const along = person.face === 1 ? 0.72 : 0.28;
          const floorPt = iso(person.homeX + person.span / 2, person.homeY + along, floorZ);
          personScale = building ? 1 : 2;
          drawArms(g, raise(floorPt, seatLift()), person.phase);
        });
      }
    }
    queue.sort((a, b) => a.key - b.key);
    for (const item of queue) item.draw(world);
    const lit = building && hoveredFloor === sim.cfg.level;
    strokeLoop(world, sim.outline, lit ? WHITE : ICE);
    if (lit) strokeLoop(world, sim.outline, ICE);
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
      if (chatting) {
        const friend = people.find(
          (other) => other !== person && other.roam && other.pose !== 'sit' && Math.abs(other.x - person.x) + Math.abs(other.y - person.y) <= 1.2,
        );
        if (friend) {
          person.pose = 'chat';
          friend.pose = 'chat';
          person.path = [];
          friend.path = [];
          person.timer = 2.4;
          friend.timer = 2.4;
          return;
        }
      }
      const goal = pickGoal(person, people);
      const path = route(layout, { x: person.x, y: person.y }, goal);
      person.path = path.slice(1);
      person.hop = 0;
      person.pose = 'walk';
      if (person.path.length === 0) person.timer = 0.4;
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
    resize(availW: number, availH?: number) {
      // Display size only; backing stays frameW×frameH×HD. Contain-fit so
      // typical desktops keep the same building display height as the 600
      // square, while the wider canvas uses leftover width.
      const aw = Math.max(1, Math.floor(availW));
      const ah = Math.max(1, Math.floor(availH ?? availW));
      const scale = Math.min(aw / frameW, ah / frameH);
      const cssW = Math.max(1, Math.floor(frameW * scale));
      const cssH = Math.max(1, Math.floor(frameH * scale));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      wrap.style.width = `${cssW}px`;
      wrap.style.height = `${cssH}px`;
    },
    update(dt: number, now: number) {
      const step = Math.min(0.05, dt);
      stepPeople(step);
      if (building) stepElevator(elevator, step);
      // Count walkers standing on a non-walkable tile; read by scripts/capture.mjs.
      const t = (window as unknown as { __tower?: Record<string, unknown>; onFurniture?: number }).__tower;
      if (t) {
        for (const sim of sims) {
          for (const p of sim.people) {
            if (p.pose === 'sit') continue;
            if (!sim.layout.walkable(Math.round(p.x), Math.round(p.y))) t.onFurniture = ((t.onFurniture as number | undefined) ?? 0) + 1;
          }
        }
        if (building) {
          const low = sims.find((s) => s.cfg.level === 1);
          if (low) {
            originX = low.originX;
            originY = low.originY;
          }
          const mid = iso((SHAFT_X0 + SHAFT_X1) / 2, (SHAFT_Y0 + SHAFT_Y1) / 2, 0);
          const lift = carLift(elevator.y) + 1;
          const carY = mid.y - (lift + CAR_H / 2);
          t.elevator = {
            y: elevator.y,
            v: elevator.v,
            phase: elevator.phase,
            floor: elevator.floor,
            target: elevator.target,
            wait: elevator.wait,
            carY,
            carTop: Math.round(carY - CAR_H / 2),
            carBot: Math.round(carY - CAR_H / 2) + CAR_H,
            carH0: lift,
            carH1: lift + CAR_H,
            shaftTop,
            shaftBot,
            shaftMinX,
            shaftMaxX,
            shaftH,
          };
        }
      }
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
    hitFloor(lx: number, ly: number) {
      if (!building) return 0;
      return hitFloorAt(lx, ly, hitEntries, hitExclude);
    },
    setHoveredFloor(level: number) {
      const next = level > 0 ? level : 0;
      if (hoveredFloor === next) return;
      hoveredFloor = next;
    },
    floorGuideAnchor(level: number) {
      const sim = sims.find((entry) => entry.cfg.level === level);
      if (!sim) return null;
      originX = sim.originX;
      originY = sim.originY;
      const lip = iso(0, gridN - 1, floorZ);
      const textH = 5 * LABEL_SCALE;
      const labels = sims.map((entry) => {
        const text = `${entry.cfg.label} ${entry.cfg.name}`;
        return {
          level: entry.cfg.level,
          x: entry.labelX,
          y: entry.labelY,
          w: text.length * 6 * LABEL_SCALE,
          h: 5 * LABEL_SCALE,
        };
      });
      const self = labels.find((item) => item.level === level) ?? {
        level,
        x: sim.labelX,
        y: sim.labelY,
        w: 0,
        h: textH,
      };
      // Attach just under this floor's glyphs; the overlay routes around every label box.
      return {
        x: lip.x,
        y: sim.labelY + textH + 4,
        labelX: sim.labelX,
        labelY: sim.labelY,
        labelW: self.w,
        labelH: self.h,
        lipX: lip.x,
        labels,
      };
    },
    logicalSize() {
      return { width: frameW, height: frameH };
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
  g.poly(flat, true).stroke({ width: 1, color, alpha: 1, pixelLine: HD === 1 });
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
