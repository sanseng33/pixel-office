import { Application, Graphics } from 'pixi.js';
import type { FloorConfig } from '../../config/floors.ts';
import type { OfficeEvent, OfficeEventType } from '../../events/source.ts';
import type { PlateView } from '../plate.ts';
import { PLAN, layoutFor } from './layout.ts';
import type { FloorLayout, Furn } from './layout.ts';

const VIEW = 540;
const HW = 22;
const HH = 11;
const ZH = 18;
const FLOOR_Z = 1;
const WALL_Z = 4;

const NAVY = 0x071422;
const MID = 0x14365c;
const ICE = 0x9ad7ff;
const WHITE = 0xf4fbff;

const GLYPH: Record<string, readonly string[]> = {
  R: ['111', '101', '111', '110', '101'],
  D: ['110', '101', '101', '101', '110'],
  F: ['111', '100', '110', '100', '100'],
  '&': ['010', '101', '010', '101', '010'],
  '5': ['111', '100', '111', '001', '111'],
  ' ': ['000', '000', '000', '000', '000'],
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
  const shown = configs.find((f) => f.type === 'rnd') ?? configs[0];
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
        consider(iso(x, y, WALL_Z));
        consider(iso(x + 1, y + 1, 0));
      }
    }
    return { minX, maxX, minY, maxY };
  };

  originX = 0;
  originY = 0;
  const box = boundsOf();
  originX = Math.round(VIEW / 2 - (box.minX + box.maxX) / 2);
  originY = Math.round(VIEW / 2 - (box.minY + box.maxY) / 2);

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
      pose: 'sit',
      path: [],
      hop: 0,
      timer: i < 3 ? 0.3 + i * 0.45 : 4 + rand() * 6,
      phase: rand() * 6,
      seed: (i * 17 + 3) >>> 0,
    });
  }

  let hour = 12;
  let burst = 0;
  const queue: DrawItem[] = [];

  const occupiedAt = (x: number, y: number) =>
    people.some((p) => p.pose === 'sit' && p.x === x && p.y === y && p.path.length === 0);

  function pushDraw(gx: number, gy: number, gz: number, draw: (g: Graphics) => void): void {
    queue.push({ key: (gx + gy) * 100 + gz, draw });
  }

  function paintText(g: Graphics, text: string, x: number, y: number, color: number): void {
    let cx = Math.round(x);
    const top = Math.round(y);
    for (const ch of text) {
      const rows = GLYPH[ch] ?? GLYPH[' '];
      if (!rows) continue;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r] ?? '';
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== '1') continue;
          g.rect(cx + c * 2, top + r * 2, 2, 2).fill({ color });
        }
      }
      cx += 8;
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

  function drawPerson(g: Graphics, foot: Pt, pose: Person['pose'], phase: number): void {
    const bob = pose === 'sit' || pose === 'chat' ? (Math.sin(phase * 5) > 0 ? 0 : -1) : 0;
    const fx = Math.round(foot.x);
    const fy = Math.round(foot.y) + bob;
    if (pose === 'sit' || pose === 'chat') {
      g.rect(fx - 3, fy - 4, 6, 3).fill({ color: ICE });
      g.rect(fx - 2, fy - 8, 4, 4).fill({ color: WHITE });
      return;
    }
    const step = pose === 'walk' && Math.sin(phase * 10) > 0 ? 1 : 0;
    g.rect(fx - 2, fy - 3, 1, 3).fill({ color: ICE });
    g.rect(fx + 1 + step, fy - 3, 1, 3).fill({ color: ICE });
    g.rect(fx - 2, fy - 7, 5, 4).fill({ color: ICE });
    g.rect(fx - 1, fy - 10, 3, 3).fill({ color: WHITE });
  }

  function drawDesk(g: Graphics, x: number, y: number, lit: boolean): void {
    const c = iso(x + 0.5, y + 0.42, FLOOR_Z);
    const top: Pt[] = [
      { x: c.x, y: c.y - 7 },
      { x: c.x + 9, y: c.y - 2 },
      { x: c.x + 2, y: c.y + 3 },
      { x: c.x - 7, y: c.y - 2 },
    ];
    poly(g, top, MID, 0.95, ICE, 1);
    const screen = (ox: number, oy: number) => {
      g.rect(Math.round(c.x + ox), Math.round(c.y + oy), 3, 4).fill({ color: lit ? WHITE : ICE, alpha: lit ? 1 : 0.7 });
    };
    screen(-6, -11);
    screen(-1, -12);
    // Chair, on the near side of the desk.
    const chair: Pt[] = [
      { x: c.x - 2, y: c.y + 4 },
      { x: c.x + 4, y: c.y + 7 },
      { x: c.x + 6, y: c.y + 5 },
      { x: c.x, y: c.y + 2 },
    ];
    poly(g, chair, NAVY, 1, ICE, 0.9);
  }

  function drawFurn(g: Graphics, item: Furn, now: number): void {
    if (item.kind === 'desk') {
      const lit = occupiedAt(item.x, item.y) && Math.sin(now / 180 + item.x * 3) > -0.2;
      drawDesk(g, item.x, item.y, lit);
      return;
    }
    if (item.kind === 'table') {
      const c = iso(item.x + 0.5, item.y + 0.5, FLOOR_Z);
      poly(
        g,
        [
          { x: c.x, y: c.y - 6 },
          { x: c.x + 8, y: c.y - 2 },
          { x: c.x, y: c.y + 3 },
          { x: c.x - 8, y: c.y - 1 },
        ],
        MID,
        0.9,
        WHITE,
        0.9,
      );
      return;
    }
    if (item.kind === 'plant') {
      const c = iso(item.x + 0.5, item.y + 0.5, FLOOR_Z);
      g.rect(Math.round(c.x) - 2, Math.round(c.y) - 2, 4, 3).fill({ color: MID });
      g.rect(Math.round(c.x) - 3, Math.round(c.y) - 8, 6, 5).fill({ color: ICE });
      return;
    }
    const c = iso(item.x + 0.5, item.y + 0.5, FLOOR_Z);
    poly(
      g,
      [
        { x: c.x, y: c.y - 5 },
        { x: c.x + 8, y: c.y - 1 },
        { x: c.x + 2, y: c.y + 3 },
        { x: c.x - 6, y: c.y - 1 },
      ],
      MID,
      1,
      ICE,
      1,
    );
    g.rect(Math.round(c.x) - 1, Math.round(c.y) - 7, 3, 3).fill({ color: WHITE });
  }

  function rebuild(now: number): void {
    queue.length = 0;
    for (let y = 0; y < PLAN; y++) {
      for (let x = 0; x < PLAN; x++) {
        if (!layout.solid(x, y)) continue;
        const gx = x;
        const gy = y;
        pushDraw(gx, gy, 0, (g) => {
          if (!layout.solid(x, y - 1)) poly(g, face(x, y, x + 1, y), MID, 0.85, ICE, 0.55);
          if (!layout.solid(x + 1, y)) poly(g, face(x + 1, y, x + 1, y + 1), MID, 0.75, ICE, 0.45);
          if (!layout.solid(x, y + 1)) poly(g, face(x, y + 1, x + 1, y + 1), MID, 0.9, ICE, 0.7);
          if (!layout.solid(x - 1, y)) poly(g, face(x, y, x, y + 1), MID, 0.8, ICE, 0.5);
        });
        pushDraw(gx, gy, 2, (g) => {
          poly(g, tilePts(x, y, FLOOR_Z), 0x0d2748, 0.55, ICE, 0.85);
        });
        if (y === 0) {
          pushDraw(gx, gy, 3, (g) => {
            const a = iso(x, y, FLOOR_Z);
            const b = iso(x + 1, y, FLOOR_Z);
            const c = iso(x + 1, y, WALL_Z);
            const d = iso(x, y, WALL_Z);
            poly(g, [a, b, c, d], 0x0b2038, 0.92, ICE, 0.8);
          });
        }
        if (x === 0) {
          pushDraw(gx, gy, 4, (g) => {
            const a = iso(x, y, FLOOR_Z);
            const b = iso(x, y + 1, FLOOR_Z);
            const c = iso(x, y + 1, WALL_Z);
            const d = iso(x, y, WALL_Z);
            poly(g, [a, b, c, d], 0x0a1c34, 0.92, ICE, 0.75);
          });
        }
      }
    }
    for (const item of layout.furniture) {
      pushDraw(item.x, item.y, 6, (g) => drawFurn(g, item, now));
    }
    for (const person of people) {
      const gx = Math.round(person.x);
      const gy = Math.round(person.y);
      const z = person.pose === 'sit' ? 8 : 12;
      pushDraw(gx, gy, z, (g) => {
        const foot = iso(person.x + 0.5, person.y + (person.pose === 'sit' || person.pose === 'chat' ? 0.58 : 0.62), FLOOR_Z);
        drawPerson(g, foot, person.pose, person.phase);
      });
    }
    queue.sort((a, b) => a.key - b.key);
    world.clear();
    for (const item of queue) item.draw(world);
    paintText(world, `${shown.label} ${shown.name}`, 16, 18, WHITE);

    glow.clear();
    const hot = now < burst;
    drawPulses(glow, outline, now, hot ? 70 : 42, hot ? 6 : 4);
    for (const column of columns) drawPulses(glow, column, now + 200, 28, 2);
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

function drawPulses(g: Graphics, run: Run, now: number, speed: number, count: number): void {
  if (run.total < 8) return;
  for (let n = 0; n < count; n++) {
    const head = ((now / 1000) * speed + n * (run.total / count)) % run.total;
    for (let k = 6; k >= 0; k--) {
      const q = pointAlong(run, head - k * 5);
      const alpha = (1 - k / 7) * 0.95;
      const size = k === 0 ? 3 : 2;
      g.rect(Math.round(q.x), Math.round(q.y), size, size).fill({ color: k === 0 ? WHITE : ICE, alpha });
    }
  }
}
