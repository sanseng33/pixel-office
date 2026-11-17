import { RGB, VIEW } from '../config/display.ts';
import type { FloorConfig, FloorType } from '../config/floors.ts';
import type { OfficeEvent, OfficeEventType } from '../events/source.ts';
import { stampText } from './font.ts';
import { COLS, HH, HW, ROWS, SLAB, inBounds, screenX, screenY, tileVisible } from './iso.ts';
import type { RGBA } from './pixel.ts';
import { Pix } from './pixel.ts';
import { SCREEN_OF, buildAtlas, type Atlas, type Frame } from './sprites.ts';

type State = 'sit' | 'phone' | 'walk' | 'chat' | 'stretch' | 'idle' | 'cheer' | 'ride';

interface Prop {
  x: number;
  y: number;
  sprite: string;
  level: number;
}

interface ScreenSpot {
  prop: number;
  level: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
  phase: number;
  hot: number;
}

interface Person {
  level: number;
  x: number;
  y: number;
  dir: number;
  state: State;
  home: State;
  frame: number;
  acc: number;
  timer: number;
  gx: number;
  gy: number;
  nx: number;
  ny: number;
  moving: number;
  role: number;
  deskX: number;
  deskY: number;
  hidden: number;
  bubble: number;
  seed: number;
  chat: number;
}

interface Pulse {
  xs: Float32Array;
  ys: Float32Array;
  dist: Float32Array;
  len: number;
  total: number;
  head: number;
  speed: number;
  x: number;
  y: number;
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

interface Banner {
  frame: string;
  x: number;
  y: number;
  born: number;
  until: number;
  active: number;
}

const CODE = [0b101101, 0b011011, 0b110010, 0b001111, 0b101010, 0b111000, 0b010101, 0b100111];
const MOTE = ['rgba(127,219,255,0.35)', 'rgba(191,244,255,0.55)', 'rgba(127,219,255,0.6)'];
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const QX = new Int16Array(COLS * ROWS);
const QY = new Int16Array(COLS * ROWS);
const SEEN = new Int16Array(COLS * ROWS);
const PREV = new Int16Array(COLS * ROWS);
let seenGen = 1;

function at(x: number, y: number): number {
  return y * COLS + x;
}

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function nextStep(blocked: Uint8Array, sx: number, sy: number, gx: number, gy: number): number {
  if (!inBounds(sx, sy) || !inBounds(gx, gy)) return -1;
  if (sx === gx && sy === gy) return at(sx, sy);
  seenGen += 1;
  if (seenGen > 30000) {
    SEEN.fill(0);
    seenGen = 1;
  }
  let qt = 0;
  let qh = 0;
  QX[qt] = sx;
  QY[qt] = sy;
  qt += 1;
  SEEN[at(sx, sy)] = seenGen;
  PREV[at(sx, sy)] = -1;
  let found = false;
  while (qh < qt) {
    const x = QX[qh] ?? 0;
    const y = QY[qh] ?? 0;
    qh += 1;
    if (x === gx && y === gy) {
      found = true;
      break;
    }
    for (let d = 0; d < 4; d++) {
      const dir = DIRS[d];
      if (!dir) continue;
      const nx = x + dir[0];
      const ny = y + dir[1];
      if (!inBounds(nx, ny)) continue;
      const id = at(nx, ny);
      if (SEEN[id] === seenGen) continue;
      if (blocked[id] && !(nx === gx && ny === gy)) continue;
      SEEN[id] = seenGen;
      PREV[id] = at(x, y);
      QX[qt] = nx;
      QY[qt] = ny;
      qt += 1;
    }
  }
  if (!found) return -1;
  let cur = at(gx, gy);
  let parent = PREV[cur] ?? -1;
  while (parent !== -1 && parent !== at(sx, sy)) {
    cur = parent;
    parent = PREV[cur] ?? -1;
  }
  return cur;
}

function fillTile(pix: Pix, tx: number, ty: number, level: number, color: RGBA): void {
  const topX = screenX(tx, ty);
  const topY = screenY(tx, ty, level);
  for (let row = 0; row < HH * 2; row++) {
    const span = row < HH ? row / HH : (HH * 2 - row) / HH;
    const half = span * HW;
    const y = Math.round(topY + row);
    const x0 = Math.round(topX - half);
    const x1 = Math.round(topX + half);
    pix.hline(y, x0, Math.max(x0, x1), color);
  }
}

function edgeLevel(pix: Pix, x0: number, y0: number, x1: number, y1: number, level: number, color: RGBA): void {
  pix.line(screenX(x0, y0), screenY(x0, y0, level), screenX(x1, y1), screenY(x1, y1, level), color);
}

function dropEdge(pix: Pix, x0: number, y0: number, x1: number, y1: number, level: number): void {
  const ax = screenX(x0, y0);
  const ay = screenY(x0, y0, level);
  const bx = screenX(x1, y1);
  const by = screenY(x1, y1, level);
  const steps = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    pix.line(x, y, x, y + SLAB, RGB.side);
  }
  pix.line(ax, ay + SLAB, bx, by + SLAB, RGB.ice);
  pix.line(ax, ay, bx, by, RGB.ice);
}

function dashedEdge(pix: Pix, x0: number, y0: number, x1: number, y1: number, level: number, color: RGBA): void {
  pix.dashed(screenX(x0, y0), screenY(x0, y0, level), screenX(x1, y1), screenY(x1, y1, level), color, 2, 2);
}

interface BuiltFloor {
  canvas: HTMLCanvasElement;
  props: Prop[];
  people: Person[];
  blocked: Uint8Array;
  order: Int16Array;
  keys: Float32Array;
  count: number;
}

function deskSlots(level: number, top: number): { x: number; y: number }[] {
  const rows = [3, 4, 6, 7, 8, 9];
  const out: { x: number; y: number }[] = [];
  for (const y of rows) {
    for (let x = 2; x < COLS - 1; x += 2) {
      if (!tileVisible(x, y, level, top)) continue;
      out.push({ x, y });
    }
  }
  return out;
}

function pushProp(props: Prop[], blocked: Uint8Array, level: number, x: number, y: number, sprite: string, block = true): void {
  if (!inBounds(x, y)) return;
  props.push({ x, y, sprite, level });
  if (block) blocked[at(x, y)] = 1;
}

function layoutFloor(cfg: FloorConfig, top: number, rndTop: number): { props: Prop[]; people: Person[]; blocked: Uint8Array } {
  const props: Prop[] = [];
  const people: Person[] = [];
  const blocked = new Uint8Array(COLS * ROWS);
  const level = cfg.level;
  let seed = (level * 97 + 13) >>> 0;
  const take = () => {
    seed = nextSeed(seed);
    return seed / 4294967296;
  };

  const addPerson = (x: number, y: number, home: State, role: number, deskX = -1, deskY = -1): void => {
    const dir = ((x + y) & 1) === 0 ? 0 : 1;
    const person: Person = {
      level,
      x,
      y,
      dir,
      state: home,
      home,
      frame: people.length & 1,
      acc: (people.length * 40) % 180,
      timer: 400 + take() * 2400,
      gx: x,
      gy: y,
      nx: x,
      ny: y,
      moving: 0,
      role,
      deskX,
      deskY,
      hidden: 0,
      bubble: home === 'phone' || home === 'chat' ? 1 : 0,
      seed: seed >>> 0,
      chat: -1,
    };
    people.push(person);
  };

  if (cfg.type === 'vacant') {
    pushProp(props, blocked, level, 6, 7, 'box2', true);
    pushProp(props, blocked, level, 8, 8, 'box', true);
    pushProp(props, blocked, level, 14, 7, 'box2', true);
    pushProp(props, blocked, level, 12, 9, 'box', true);
    return { props, people, blocked };
  }

  if (cfg.type === 'lobby') {
    pushProp(props, blocked, level, 12, 6, 'reception', true);
    pushProp(props, blocked, level, 9, 8, 'gate', true);
    pushProp(props, blocked, level, 13, 8, 'gate', true);
    pushProp(props, blocked, level, 8, 8, 'plinth', true);
    pushProp(props, blocked, level, 16, 6, 'plinth', true);
    pushProp(props, blocked, level, 15, 5, 'screen', true);
    pushProp(props, blocked, level, 7, 9, 'plant', true);
    pushProp(props, blocked, level, 17, 7, 'plant', true);
    pushProp(props, blocked, level, 11, 9, 'plant', false);
    addPerson(12.7, 6.7, 'sit', 0, 12, 6);
    const n = Math.max(2, cfg.people);
    for (let i = 0; i < n; i++) {
      addPerson(7 + (i % 5), 9, 'walk', 2);
      const p = people[people.length - 1];
      if (!p) continue;
      p.gx = 11;
      p.gy = 6;
      p.moving = 1;
      p.timer = 200 + i * 180;
    }
    return { props, people, blocked };
  }

  if (cfg.type === 'lounge') {
    pushProp(props, blocked, level, 8, 8, 'sofa', true);
    pushProp(props, blocked, level, 10, 8, 'sofa', true);
    pushProp(props, blocked, level, 14, 7, 'sofa', true);
    pushProp(props, blocked, level, 15, 5, 'pong', true);
    pushProp(props, blocked, level, 17, 6, 'coffee', true);
    pushProp(props, blocked, level, 7, 9, 'cooler', true);
    pushProp(props, blocked, level, 6, 9, 'plant', true);
    pushProp(props, blocked, level, 18, 8, 'plant', true);
    const seats = [
      [8.6, 8.7],
      [10.6, 8.7],
      [14.6, 7.7],
      [15.2, 7.6],
    ];
    for (let i = 0; i < seats.length && i < cfg.people; i++) {
      const s = seats[i];
      if (!s) continue;
      addPerson(s[0] ?? 6, s[1] ?? 6, 'chat', 3);
      const p = people[people.length - 1];
      if (p) p.chat = i < 2 ? 0 : 1;
    }
    const extra = Math.max(0, cfg.people - seats.length);
    for (let i = 0; i < extra; i++) {
      addPerson(10 + i, 9, 'walk', 1);
      const p = people[people.length - 1];
      if (!p) continue;
      p.gx = i % 2 === 0 ? 16 : 5;
      p.gy = i % 2 === 0 ? 4 : 8;
      p.moving = 1;
    }
    return { props, people, blocked };
  }

  const slots = deskSlots(level, top);
  const use = Math.min(cfg.stations, slots.length);
  const lab = cfg.type === 'rnd' && level === rndTop;
  for (let i = 0; i < use; i++) {
    const slot = slots[i];
    if (!slot) continue;
    if (cfg.type === 'it' && slot.y === 7 && slot.x >= 8 && slot.x <= 16) continue;
    if (cfg.type === 'sales' && slot.x === 10 && slot.y === 6) continue;
    if (cfg.type === 'it' && slot.x === 16 && slot.y === 5) continue;
    let sprite = 'desk';
    if (cfg.type === 'it') sprite = 'dual';
    else if (lab && slot.x >= 12) sprite = 'bench';
    else if (cfg.type === 'rnd' && slot.y >= 8 && slot.x % 4 === 2) sprite = 'stand';
    pushProp(props, blocked, level, slot.x, slot.y, sprite, true);
  }

  if (cfg.type === 'sales') {
    pushProp(props, blocked, level, 10, 6, 'screen', true);
    pushProp(props, blocked, level, 17, 7, 'gong', true);
    pushProp(props, blocked, level, 6, 9, 'plant', false);
  } else if (cfg.type === 'it') {
    for (let i = 0; i < 5; i++) pushProp(props, blocked, level, 8 + i * 2, 7, 'rack', true);
    pushProp(props, blocked, level, 16, 5, 'screen', true);
    pushProp(props, blocked, level, 6, 9, 'cooler', true);
  } else if (cfg.type === 'rnd') {
    pushProp(props, blocked, level, lab ? 8 : 9, lab ? 5 : 6, 'board', true);
    if (lab) {
      pushProp(props, blocked, level, 11, 4, 'board', true);
      pushProp(props, blocked, level, 14, 4, 'bench', true);
      pushProp(props, blocked, level, 16, 4, 'bench', true);
    }
    pushProp(props, blocked, level, 18, 8, 'plant', false);
    pushProp(props, blocked, level, 6, 9, 'cooler', true);
  }

  const seatProps = props.filter(
    (p) => p.sprite === 'desk' || p.sprite === 'dual' || p.sprite === 'stand' || p.sprite === 'bench',
  );
  const occupied = Math.round(seatProps.length * cfg.occupancy);
  for (let i = 0; i < occupied; i++) {
    const slot = seatProps[i];
    if (!slot) continue;
    const phone = cfg.type === 'sales';
    addPerson(slot.x + 0.72, slot.y + 0.72, phone ? 'phone' : 'sit', phone ? 4 : 0, slot.x, slot.y);
  }
  for (let i = 0; i < cfg.people; i++) {
    addPerson(8 + i * 2, 9, 'walk', 1);
    const p = people[people.length - 1];
    if (!p) continue;
    p.gx = 10 + ((i * 3) % 6);
    p.gy = 7;
    p.moving = 1;
    p.timer = 300;
  }
  return { props, people, blocked };
}

function bakeFloor(cfg: FloorConfig): HTMLCanvasElement {
  const pix = new Pix(VIEW, VIEW);
  const level = cfg.level;
  const vacant = cfg.type === 'vacant';
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!vacant) fillTile(pix, x, y, level, (x + y) & 1 ? RGB.floor : RGB.floorAlt);
    }
  }
  const grid = vacant ? RGB.iceDim : RGB.iceFaint;
  for (let x = 0; x <= COLS; x++) edgeLevel(pix, x, 0, x, ROWS, level, x === 0 || x === COLS ? RGB.ice : grid);
  for (let y = 0; y <= ROWS; y++) edgeLevel(pix, 0, y, COLS, y, level, y === 0 || y === ROWS ? RGB.ice : grid);
  if (!vacant) {
    dropEdge(pix, 0, ROWS, COLS, ROWS, level);
    dropEdge(pix, COLS, 0, COLS, ROWS, level);
    for (let x = 0; x <= COLS; x += 2) {
      const sx = screenX(x, ROWS);
      const sy = screenY(x, ROWS, level);
      pix.dashed(sx, sy, sx, sy - 8, RGB.iceFaint, 1, 2);
    }
    for (let y = 0; y <= ROWS; y += 2) {
      const sx = screenX(COLS, y);
      const sy = screenY(COLS, y, level);
      pix.dashed(sx, sy, sx, sy - 8, RGB.iceFaint, 1, 2);
    }
  } else {
    dashedEdge(pix, 0, 0, COLS, 0, level, RGB.white);
    dashedEdge(pix, 0, 0, 0, ROWS, level, RGB.white);
    dashedEdge(pix, 0, ROWS, COLS, ROWS, level, RGB.ice);
    dashedEdge(pix, COLS, 0, COLS, ROWS, level, RGB.ice);
    const tx = screenX(10, 6);
    const ty = screenY(10, 6, level);
    stampText(pix, (tx - 24) | 0, (ty - 8) | 0, 'VACANT', 2, RGB.white, 'ui');
  }
  if (cfg.type === 'it') {
    for (let x = 3; x < COLS - 2; x++) {
      edgeLevel(pix, x, 4, x + 1, 4, level, RGB.deep);
    }
  }
  if (cfg.type === 'rnd') {
    const x0 = level >= 7 ? 11 : 13;
    dashedEdge(pix, x0, 5, x0 + 5, 5, level, RGB.ice);
    dashedEdge(pix, x0, 5, x0, 9, level, RGB.ice);
    dashedEdge(pix, x0 + 5, 5, x0 + 5, 9, level, RGB.ice);
    dashedEdge(pix, x0, 9, x0 + 2, 9, level, RGB.ice);
    dashedEdge(pix, x0 + 3, 9, x0 + 5, 9, level, RGB.ice);
  }
  if (cfg.type === 'sales') {
    dashedEdge(pix, 14, 6, 18, 6, level, RGB.iceDim);
    dashedEdge(pix, 14, 6, 14, 9, level, RGB.iceDim);
    dashedEdge(pix, 18, 6, 18, 9, level, RGB.iceDim);
    dashedEdge(pix, 14, 9, 16, 9, level, RGB.iceDim);
  }
  return pix.toCanvas();
}

function bakeBackground(configs: readonly FloorConfig[]): HTMLCanvasElement {
  const pix = new Pix(VIEW, VIEW);
  pix.rect(0, 0, VIEW, VIEW, RGB.bg);
  for (let i = 16; i < VIEW; i += 16) {
    const major = i % 64 === 0;
    const c = major ? ([127, 219, 255, 36] as const) : ([127, 219, 255, 16] as const);
    pix.hline(i, 0, VIEW - 1, c);
    for (let y = 0; y < VIEW; y += 2) pix.px(i, y, c);
  }
  for (const cfg of configs) {
    const lx = screenX(0, ROWS) - 52;
    const ly = screenY(0, ROWS, cfg.level) - 10;
    stampText(pix, lx, ly, cfg.label, 2, RGB.ice, 'ui');
    stampText(pix, lx, ly + 12, cfg.name, 1, RGB.deep, 'ui');
    pix.hline(ly + 4, lx + 28, screenX(0, ROWS) - 4, RGB.iceDim);
  }
  const stars = [
    [16, 24],
    [30, 80],
    [18, 200],
    [36, 360],
    [22, 480],
    [510, 30],
    [524, 120],
    [500, 250],
    [518, 400],
    [508, 500],
  ];
  for (const s of stars) pix.px(s[0] ?? 0, s[1] ?? 0, RGB.bright);
  return pix.toCanvas();
}

function bakeRoof(): HTMLCanvasElement {
  const pix = new Pix(VIEW, VIEW);
  const level = 7;
  for (let y = 1; y < ROWS - 1; y++) {
    for (let x = 1; x < COLS - 1; x++) fillTile(pix, x, y, level + 0.35, RGB.floor);
  }
  edgeLevel(pix, 1, 1, COLS - 1, 1, level + 0.35, RGB.ice);
  edgeLevel(pix, 1, 1, 1, ROWS - 1, level + 0.35, RGB.ice);
  edgeLevel(pix, 1, ROWS - 1, COLS - 1, ROWS - 1, level + 0.35, RGB.ice);
  edgeLevel(pix, COLS - 1, 1, COLS - 1, ROWS - 1, level + 0.35, RGB.ice);
  for (let i = 0; i < 8; i++) {
    const x = 3 + i * 2;
    const sx = screenX(x, 2);
    const sy = screenY(x, 2, level + 0.35);
    pix.line(sx, sy, sx, sy - 3, RGB.iceDim);
  }
  return pix.toCanvas();
}

function densify(pts: readonly (readonly [number, number])[]): Pulse {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.round(len / 3));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      xs.push(a[0] + dx * t);
      ys.push(a[1] + dy * t);
    }
  }
  const last = pts[pts.length - 1];
  if (last) {
    xs.push(last[0]);
    ys.push(last[1]);
  }
  const dist = new Float32Array(xs.length);
  for (let i = 1; i < xs.length; i++) {
    dist[i] = (dist[i - 1] ?? 0) + Math.hypot((xs[i] ?? 0) - (xs[i - 1] ?? 0), (ys[i] ?? 0) - (ys[i - 1] ?? 0));
  }
  return {
    xs: Float32Array.from(xs),
    ys: Float32Array.from(ys),
    dist,
    len: xs.length,
    total: dist[xs.length - 1] || 1,
    head: 0,
    speed: 30,
    x: 0,
    y: 0,
  };
}

function sample(p: Pulse, dist: number): void {
  let d = dist % p.total;
  if (d < 0) d += p.total;
  let i = 1;
  while (i < p.len - 1 && (p.dist[i] ?? 0) < d) i += 1;
  const i0 = Math.max(0, i - 1);
  const span = (p.dist[i] ?? 0) - (p.dist[i0] ?? 0) || 1;
  const t = (d - (p.dist[i0] ?? 0)) / span;
  p.x = (p.xs[i0] ?? 0) + ((p.xs[i] ?? 0) - (p.xs[i0] ?? 0)) * t;
  p.y = (p.ys[i0] ?? 0) + ((p.ys[i] ?? 0) - (p.ys[i0] ?? 0)) * t;
}

function corner(level: number, tx: number, ty: number): readonly [number, number] {
  return [screenX(tx, ty), screenY(tx, ty, level)];
}

function buildPulses(levels: readonly number[]): Pulse[] {
  const pulses: Pulse[] = [];
  const add = (pts: readonly (readonly [number, number])[], speed: number, phase: number) => {
    if (pts.length < 2) return;
    const pulse = densify(pts);
    pulse.speed = speed;
    pulse.head = (pulse.total * phase) % pulse.total;
    pulses.push(pulse);
  };
  for (const level of levels) {
    add(
      [corner(level, 0, ROWS), corner(level, COLS, ROWS), corner(level, COLS, 0)],
      26 + (level % 3) * 6,
      (level * 0.17) % 1,
    );
    add([corner(level, 0, 0), corner(level, COLS, 0), corner(level, COLS, ROWS)], 22, (level * 0.41) % 1);
  }
  const top = levels[levels.length - 1] ?? 7;
  const bot = levels[0] ?? 1;
  add([corner(bot, 0, ROWS), corner(top, 0, ROWS)], 34, 0.2);
  add([corner(bot, COLS, 0), corner(top, COLS, 0)], 34, 0.6);
  add([corner(bot, COLS, ROWS), corner(top, COLS, ROWS)], 40, 0.05);
  return pulses;
}

const RACK_LEDS: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [1, 3],
  [2, 3],
  [3, 3],
  [4, 3],
  [1, 5],
  [2, 5],
  [3, 5],
  [4, 5],
  [1, 7],
  [2, 7],
  [3, 7],
  [4, 7],
  [1, 9],
  [2, 9],
  [3, 9],
  [4, 9],
  [1, 11],
  [2, 11],
  [3, 11],
  [4, 11],
];

function spriteFor(person: Person): string {
  const f = person.frame & 1;
  if (person.state === 'cheer') return 'cheer';
  if (person.state === 'stretch') return 'stretch';
  if (person.state === 'phone') return f ? (person.dir === 1 ? 'ph0F' : 'ph0') : person.dir === 1 ? 'ph1F' : 'ph1';
  if (person.state === 'sit' || person.state === 'chat') {
    return f ? (person.dir === 1 ? 'sit0F' : 'sit0') : person.dir === 1 ? 'sit1F' : 'sit1';
  }
  const walk = ['se', 'seF', 'neF', 'ne'][person.dir] ?? 'se';
  return `${walk}${f}`;
}

function faceDir(dx: number, dy: number): number {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 2;
  return dy >= 0 ? 1 : 3;
}

export interface Scene {
  update(dt: number, now: number): void;
  draw(ctx: CanvasRenderingContext2D, now: number): void;
  push(event: OfficeEvent): void;
  levelsFor(type: OfficeEventType): number[];
}

export function createScene(configs: readonly FloorConfig[]): Scene {
  const floors = [...configs].sort((a, b) => a.level - b.level);
  const top = floors[floors.length - 1]?.level ?? 7;
  const rndLevels = floors.filter((f) => f.type === 'rnd').map((f) => f.level);
  const rndTop = rndLevels.length ? Math.max(...rndLevels) : top;
  const atlas = buildAtlas();
  const bg = bakeBackground(floors);
  const roof = bakeRoof();
  const structure = bakeStructure();
  const built: BuiltFloor[] = [];
  const screens: ScreenSpot[] = [];
  for (const cfg of floors) {
    const laid = layoutFloor(cfg, top, rndTop);
    const canvas = bakeFloor(cfg);
    const count = laid.props.length + laid.people.length;
    const floor: BuiltFloor = {
      canvas,
      props: laid.props,
      people: laid.people,
      blocked: laid.blocked,
      order: new Int16Array(Math.max(1, count)),
      keys: new Float32Array(Math.max(1, count)),
      count,
    };
    for (let i = 0; i < laid.props.length; i++) {
      const prop = laid.props[i];
      if (!prop) continue;
      const spot = SCREEN_OF[prop.sprite];
      if (spot) {
        screens.push({
          prop: i,
          level: cfg.level,
          ox: spot.x,
          oy: spot.y,
          w: spot.w,
          h: spot.h,
          phase: screens.length * 3 + cfg.level,
          hot: prop.sprite === 'screen' ? 2 : 1,
        });
      }
      if (prop.sprite === 'dual') {
        screens.push({
          prop: i,
          level: cfg.level,
          ox: 5,
          oy: 1,
          w: 2,
          h: 2,
          phase: screens.length + 1,
          hot: 1,
        });
      }
    }
    built.push(floor);
  }
  const byLevel = new Map<number, BuiltFloor>();
  floors.forEach((cfg, i) => {
    const floor = built[i];
    if (floor) byLevel.set(cfg.level, floor);
  });

  const pulses = buildPulses(floors.map((f) => f.level));
  const motes = Array.from({ length: 16 }, (_, i) => ({
    x: i < 8 ? 10 + (i % 4) * 10 : VIEW - 18 - (i % 4) * 10,
    y: 20 + ((i * 53) % (VIEW - 40)),
    speed: 7 + (i % 4) * 3,
    style: i % MOTE.length,
  }));
  const bits: Bit[] = Array.from({ length: 18 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1 }));
  const banners: Banner[] = Array.from({ length: 4 }, () => ({
    frame: 'tDEAL',
    x: 0,
    y: 0,
    born: 0,
    until: 0,
    active: 0,
  }));
  const flashUntil = new Float64Array(12);
  const hotUntil = new Float64Array(12);
  let doorUntil = 0;
  let carLevel = 1;
  let carTo = 4;
  let carT = 0;

  const queue: { type: OfficeEventType; level: number; ttl: number }[] = [];
  for (let i = 0; i < 8; i++) queue.push({ type: 'dealClosed', level: 0, ttl: 0 });
  let qh = 0;
  let qt = 0;

  const levelsOf = (type: FloorType) => floors.filter((f) => f.type === type).map((f) => f.level);

  function burst(x: number, y: number): void {
    let n = 0;
    for (const bit of bits) {
      if (bit.life > 0) continue;
      const ang = (n / 12) * Math.PI * 2;
      bit.x = x;
      bit.y = y;
      bit.vx = Math.cos(ang) * (16 + (n % 3) * 8);
      bit.vy = Math.sin(ang) * (12 + (n % 3) * 6) - 10;
      bit.life = 800;
      bit.max = 800;
      n += 1;
      if (n >= 12) break;
    }
  }

  function showBanner(frame: string, x: number, y: number, now: number, ttl: number): void {
    let slot = banners[0];
    for (const item of banners) {
      if (!item.active) {
        slot = item;
        break;
      }
      if (slot && item.until < slot.until) slot = item;
    }
    if (!slot) return;
    slot.frame = frame;
    slot.x = x;
    slot.y = y;
    slot.born = now;
    slot.until = now + ttl;
    slot.active = 1;
  }

  function apply(type: OfficeEventType, level: number, ttl: number, now: number): void {
    flashUntil[level] = now + ttl;
    if (type === 'dealClosed' || type === 'deploySuccess') hotUntil[level] = now + ttl;
    const floor = byLevel.get(level);
    const cx = screenX(10, 6);
    const cy = screenY(10, 6, level);
    if (type === 'dealClosed') {
      const who = floor?.people.find((p) => p.home === 'phone' || p.role === 4);
      if (who) {
        who.state = 'cheer';
        who.timer = ttl;
        burst(screenX(who.x, who.y), screenY(who.x, who.y, level) - 8);
      }
      showBanner('tDEAL', cx, cy - 18, now, ttl);
      burst(cx, cy);
    } else if (type === 'deploySuccess') {
      showBanner('tDEPLOY', cx, cy - 16, now, ttl);
      burst(cx, cy - 6);
    } else {
      doorUntil = now + ttl;
      const visitor = floor?.people.find((p) => p.role === 2);
      if (visitor) {
        visitor.hidden = 0;
        visitor.x = 16;
        visitor.y = 9;
        visitor.gx = 10;
        visitor.gy = 6;
        visitor.moving = 1;
        visitor.state = 'walk';
        visitor.bubble = 1;
        visitor.timer = ttl;
      }
    }
  }

  function sortFloor(floor: BuiltFloor): void {
    const n = floor.props.length + floor.people.length;
    floor.count = n;
    for (let i = 0; i < n; i++) {
      floor.order[i] = i;
      if (i < floor.props.length) {
        const prop = floor.props[i];
        floor.keys[i] = prop ? prop.x + prop.y : 0;
      } else {
        const person = floor.people[i - floor.props.length];
        floor.keys[i] = person ? person.x + person.y + 0.01 : 0;
      }
    }
    for (let i = 1; i < n; i++) {
      const oi = floor.order[i] ?? 0;
      const key = floor.keys[oi] ?? 0;
      let j = i - 1;
      while (j >= 0) {
        const oj = floor.order[j] ?? 0;
        if ((floor.keys[oj] ?? 0) <= key) break;
        floor.order[j + 1] = oj;
        j -= 1;
      }
      floor.order[j + 1] = oi;
    }
  }

  function ensureStep(person: Person, blocked: Uint8Array): void {
    const sx = person.x | 0;
    const sy = person.y | 0;
    if (!person.moving) return;
    if ((person.nx | 0) === sx && (person.ny | 0) === sy && Math.hypot(person.nx - person.x, person.ny - person.y) < 0.05) {
      const step = nextStep(blocked, sx, sy, person.gx | 0, person.gy | 0);
      if (step < 0) {
        person.moving = 0;
        person.state = person.home === 'walk' ? 'idle' : person.home;
        person.timer = 500;
        return;
      }
      person.nx = step % COLS;
      person.ny = (step / COLS) | 0;
    }
  }

  return {
    levelsFor(type) {
      if (type === 'dealClosed') return levelsOf('sales');
      if (type === 'deploySuccess') return levelsOf('rnd');
      return levelsOf('lobby');
    },
    push(event) {
      const slot = queue[qh];
      if (!slot) return;
      slot.type = event.type;
      slot.level = event.level;
      slot.ttl = event.ttlMs;
      qh = (qh + 1) % queue.length;
      if (qh === qt) qt = (qt + 1) % queue.length;
    },
    update(dt, now) {
      while (qt !== qh) {
        const item = queue[qt];
        if (item && item.level) apply(item.type, item.level, item.ttl, now);
        qt = (qt + 1) % queue.length;
      }
      const sec = dt * 0.001;
      carT += sec / 7;
      if (carT >= 1) {
        carT = 0;
        carLevel = carTo;
        carTo = 1 + ((carTo + 2) % top);
      }
      const rideLevel = carLevel + (carTo - carLevel) * carT;
      for (const floor of built) {
        for (const person of floor.people) {
          if (person.hidden && person.state === 'ride') continue;
          person.acc += dt;
          const stepMs = person.state === 'walk' ? 140 : 260;
          if (person.acc >= stepMs) {
            person.acc -= stepMs;
            if (person.acc > stepMs) person.acc = 0;
            person.frame ^= 1;
          }
          if (person.state === 'walk' || person.moving) {
            ensureStep(person, floor.blocked);
            const dx = person.nx - person.x;
            const dy = person.ny - person.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 0.04) {
              person.x = person.nx;
              person.y = person.ny;
              const goal = Math.hypot(person.gx - person.x, person.gy - person.y) < 0.6;
              if (goal || !person.moving) {
                person.moving = 0;
                person.state = person.home === 'walk' ? 'idle' : person.home;
                if (person.home === 'sit' || person.home === 'phone' || person.home === 'chat') {
                  if (person.deskX >= 0) {
                    person.x = person.deskX + 0.72;
                    person.y = person.deskY + 0.72;
                  }
                  person.state = person.home;
                }
                person.timer = 700 + (person.seed % 1800);
              } else {
                person.state = 'walk';
                const id = nextStep(floor.blocked, person.x | 0, person.y | 0, person.gx | 0, person.gy | 0);
                if (id >= 0) {
                  person.nx = id % COLS;
                  person.ny = (id / COLS) | 0;
                }
              }
            } else {
              const speed = 2.1 * sec;
              const step = Math.min(speed, dist);
              person.x += (dx / dist) * step;
              person.y += (dy / dist) * step;
              person.dir = faceDir(dx, dy);
              person.state = 'walk';
            }
          } else {
            person.timer -= dt;
            if (person.timer > 0 || person.state === 'cheer') continue;
            person.seed = nextSeed(person.seed);
            const r = (person.seed % 1000) / 1000;
            if (person.role === 2) {
              if (person.gx === 10) {
                person.gx = 16;
                person.gy = 9;
              } else {
                person.gx = 10;
                person.gy = 6;
              }
              person.moving = 1;
              person.state = 'walk';
              person.bubble = person.gx === 10 ? 1 : 0;
              continue;
            }
            if ((person.home === 'sit' || person.home === 'phone') && person.deskX >= 0) {
              if (r < 0.55) {
                person.state = person.home;
                person.timer = 1600 + r * 3000;
              } else if (r < 0.72) {
                person.state = 'stretch';
                person.timer = 800;
              } else if (r < 0.84) {
                person.state = 'idle';
                person.timer = 900;
              } else if (r < 0.93 && Math.abs(rideLevel - person.level) < 0.4) {
                person.gx = COLS - 2;
                person.gy = 3;
                person.moving = 1;
                person.state = 'walk';
              } else {
                person.gx = 4 + (person.seed % (COLS - 8));
                person.gy = 9;
                person.moving = 1;
                person.state = 'walk';
              }
            } else if (person.home === 'chat') {
              person.state = r < 0.7 ? 'chat' : 'idle';
              person.bubble = person.state === 'chat' ? 1 : 0;
              person.timer = 1200 + r * 2000;
            } else {
              person.gx = 3 + (person.seed % (COLS - 6));
              person.gy = 4 + (person.seed % 5);
              if (floor.blocked[at(person.gx | 0, person.gy | 0)]) person.gy = 9;
              person.moving = 1;
              person.state = 'walk';
            }
          }
          if (person.state === 'walk' && (person.x | 0) >= COLS - 2 && (person.y | 0) === 3 && person.role !== 2) {
            person.state = 'ride';
            person.hidden = 1;
            person.moving = 0;
            person.timer = 4000;
          }
          if (person.hidden && person.state === 'ride' && person.timer <= 0) {
            person.hidden = 0;
            person.level = carTo;
            person.x = COLS - 3;
            person.y = 4;
            person.moving = 1;
            person.gx = person.deskX >= 0 ? person.deskX : 8;
            person.gy = person.deskY >= 0 ? person.deskY : 7;
            person.state = 'walk';
          }
        }
      }
      for (const pulse of pulses) {
        pulse.head += pulse.speed * sec;
        if (pulse.head >= pulse.total) pulse.head -= pulse.total;
      }
      for (const mote of motes) {
        mote.y -= mote.speed * sec;
        if (mote.y < 4) mote.y = VIEW - 8;
      }
      for (const bit of bits) {
        if (bit.life <= 0) continue;
        bit.life -= dt;
        bit.x += bit.vx * sec;
        bit.y += bit.vy * sec;
      }
      void now;
      void rideLevel;
    },
    draw(ctx, now) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bg, 0, 0);
      let style = '';
      for (const mote of motes) {
        const fill = MOTE[mote.style] ?? MOTE[0];
        if (fill !== style) {
          ctx.fillStyle = fill ?? '#7FDBFF';
          style = fill ?? '';
        }
        ctx.fillRect(mote.x | 0, mote.y | 0, 2, 2);
      }
      const rideLevel = carLevel + (carTo - carLevel) * Math.min(1, carT);
      for (let i = 0; i < floors.length; i++) {
        const cfg = floors[i];
        const floor = built[i];
        if (!cfg || !floor) continue;
        ctx.drawImage(floor.canvas, 0, 0);
        sortFloor(floor);
        const hot = now < hotUntil[cfg.level];
        for (let k = 0; k < floor.count; k++) {
          const index = floor.order[k] ?? 0;
          if (index < floor.props.length) {
            const prop = floor.props[index];
            if (!prop) continue;
            const frame = atlas.frames[prop.sprite];
            if (!frame) continue;
            const fx = screenX(prop.x + 0.5, prop.y + 0.5);
            const fy = screenY(prop.x + 0.5, prop.y + 0.5, cfg.level);
            blit(ctx, atlas, frame, fx, fy);
            drawScreens(ctx, screens, index, cfg.level, frame, fx, fy, now, hot);
            if (prop.sprite === 'rack') drawLeds(ctx, frame, fx, fy, now, index + cfg.level);
            if (prop.sprite === 'gong' && now < flashUntil[cfg.level]) {
              ctx.fillStyle = '#FFFFFF';
              ctx.fillRect((fx - 2) | 0, (fy - frame.ay + 1) | 0, 3, 3);
            }
          } else {
            const person = floor.people[index - floor.props.length];
            if (!person || person.hidden || person.level !== cfg.level) continue;
            const name = spriteFor(person);
            const frame = atlas.frames[name];
            if (!frame) continue;
            const fx = screenX(person.x, person.y);
            const fy = screenY(person.x, person.y, cfg.level);
            blit(ctx, atlas, frame, fx, fy + (person.state === 'walk' && person.frame ? -1 : 0));
            if (person.bubble && person.state !== 'cheer' && person.state !== 'walk') {
              const b = atlas.frames[(person.frame & 1) === 0 ? 'bubble' : 'bubble2'];
              if (b) blit(ctx, atlas, b, fx, fy - frame.h - 1);
            }
            if (person.role === 2 && person.bubble && now < person.timer + 200) {
              const hi = atlas.frames.tHI;
              if (hi && person.state === 'walk') blit(ctx, atlas, hi, fx, fy - frame.h - 2);
            }
          }
        }
        if (now < flashUntil[cfg.level] && ((now / 140) | 0) % 2 === 0) outlineFloor(ctx, cfg.level);
      }
      ctx.drawImage(roof, 0, 0);
      ctx.drawImage(structure, 0, 0);
      drawSign(ctx, atlas, now);
      const shaftX = screenX(COLS + 0.15, 4);
      const shaftY = screenY(COLS + 0.15, 4, rideLevel);
      ctx.fillStyle = '#071018';
      ctx.fillRect((shaftX - 5) | 0, (shaftY - 8) | 0, 10, 10);
      ctx.fillStyle = '#7FDBFF';
      ctx.fillRect((shaftX - 5) | 0, (shaftY - 8) | 0, 10, 1);
      ctx.fillRect((shaftX - 5) | 0, (shaftY + 1) | 0, 10, 1);
      ctx.fillRect((shaftX - 5) | 0, (shaftY - 8) | 0, 1, 10);
      ctx.fillRect((shaftX + 4) | 0, (shaftY - 8) | 0, 1, 10);
      ctx.fillStyle = ((now / 200) | 0) % 2 === 0 ? '#FFFFFF' : '#2E9BFF';
      ctx.fillRect((shaftX - 2) | 0, (shaftY - 4) | 0, 2, 2);

      const tails = ['#FFFFFF', '#BFF4FF', '#7FDBFF', '#2E9BFF'];
      for (let t = 0; t < 4; t++) {
        ctx.fillStyle = tails[t] ?? '#7FDBFF';
        const size = t === 0 ? 3 : t === 1 ? 2 : 1;
        for (const pulse of pulses) {
          sample(pulse, pulse.head - t * 6);
          ctx.fillRect(pulse.x | 0, pulse.y | 0, size, size);
        }
      }
      ctx.fillStyle = '#FFFFFF';
      for (const bit of bits) {
        if (bit.life <= 0) continue;
        ctx.globalAlpha = Math.max(0, bit.life / bit.max);
        ctx.fillRect(bit.x | 0, bit.y | 0, 2, 2);
      }
      ctx.globalAlpha = 1;
      for (const item of banners) {
        if (!item.active) continue;
        if (now >= item.until) {
          item.active = 0;
          continue;
        }
        const span = item.until - item.born || 1;
        const life = (item.until - now) / span;
        const frame = atlas.frames[item.frame];
        if (!frame) continue;
        ctx.globalAlpha = life < 0 ? 0 : life;
        blit(ctx, atlas, frame, item.x, item.y - (1 - life) * 8);
        ctx.globalAlpha = 1;
      }
      if (now < doorUntil) {
        ctx.fillStyle = '#FFFFFF';
        const dx = screenX(16, 9);
        const dy = screenY(16, 9, floors.find((f) => f.type === 'lobby')?.level ?? 1);
        ctx.fillRect(dx | 0, dy | 0, 3, 2);
      }
      const tint = tintStyle(suzhouHour());
      if (tint) {
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, VIEW, VIEW);
      }
    },
  };
}

function blit(ctx: CanvasRenderingContext2D, atlas: Atlas, frame: Frame, footX: number, footY: number): void {
  ctx.drawImage(
    atlas.canvas,
    frame.x,
    frame.y,
    frame.w,
    frame.h,
    (footX - frame.ax) | 0,
    (footY - frame.ay) | 0,
    frame.w,
    frame.h,
  );
}

function drawScreens(
  ctx: CanvasRenderingContext2D,
  screens: ScreenSpot[],
  propIndex: number,
  level: number,
  frame: Frame,
  fx: number,
  fy: number,
  now: number,
  hot: boolean,
): void {
  for (let i = 0; i < screens.length; i++) {
    const spot = screens[i];
    if (!spot || spot.prop !== propIndex || spot.level !== level) continue;
    const x = (fx - frame.ax + spot.ox) | 0;
    const y = (fy - frame.ay + spot.oy) | 0;
    if (hot) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x, y, spot.w, spot.h);
      continue;
    }
    ctx.fillStyle = '#05080E';
    ctx.fillRect(x, y, spot.w, spot.h);
    ctx.fillStyle = '#FFFFFF';
    if (spot.hot === 2) {
      const tick = (now / 320 + spot.phase) | 0;
      const bars = 5;
      const gap = Math.max(2, (spot.w / bars) | 0);
      for (let b = 0; b < bars; b++) {
        const bh = 1 + ((tick + b * 2) % Math.max(1, spot.h - 1));
        ctx.fillRect(x + b * gap, y + spot.h - bh, Math.max(1, gap - 1), bh);
      }
    } else {
      const mask = CODE[(((now / 180) | 0) + spot.phase) % CODE.length] ?? 0;
      for (let col = 0; col < spot.w; col++) {
        if ((mask & (1 << (col % 6))) === 0) continue;
        ctx.fillRect(x + col, y + (col % spot.h), 1, 1);
      }
    }
  }
}

function drawLeds(ctx: CanvasRenderingContext2D, frame: Frame, fx: number, fy: number, now: number, salt: number): void {
  for (let i = 0; i < RACK_LEDS.length; i++) {
    const led = RACK_LEDS[i];
    if (!led) continue;
    const on = Math.sin(now * 0.007 + salt + led[1]) > -0.2;
    ctx.fillStyle = on ? (i % 4 === 0 ? '#FFFFFF' : '#BFF4FF') : '#2E9BFF';
    ctx.fillRect((fx - frame.ax + led[0]) | 0, (fy - frame.ay + led[1]) | 0, 1, 1);
  }
}

function outlineFloor(ctx: CanvasRenderingContext2D, level: number): void {
  ctx.fillStyle = '#BFF4FF';
  const corners: readonly (readonly [number, number])[] = [
    [0, 0],
    [COLS, 0],
    [COLS, ROWS],
    [0, ROWS],
  ];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    if (!a || !b) continue;
    const x0 = screenX(a[0], a[1]);
    const y0 = screenY(a[0], a[1], level);
    const x1 = screenX(b[0], b[1]);
    const y1 = screenY(b[0], b[1], level);
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      ctx.fillRect((x0 + (x1 - x0) * t) | 0, (y0 + (y1 - y0) * t) | 0, 1, 1);
    }
  }
}

function bakeStructure(): HTMLCanvasElement {
  const pix = new Pix(VIEW, VIEW);
  const posts: readonly (readonly [number, number])[] = [
    [0, ROWS],
    [COLS, 0],
  ];
  for (const post of posts) {
    const x = screenX(post[0], post[1]);
    const yTop = screenY(post[0], post[1], 7) - 8;
    const yBot = screenY(post[0], post[1], 1) + SLAB + 2;
    pix.line(x, yTop, x, yBot, RGB.ice);
    pix.line(x + 1, yTop, x + 1, yBot, RGB.deep);
  }
  const sx = screenX(COLS + 0.15, 4);
  const yTop = screenY(COLS + 0.15, 4, 7) - 6;
  const yBot = screenY(COLS + 0.15, 4, 1) + 10;
  pix.line(sx - 7, yTop, sx - 7, yBot, RGB.ice);
  pix.line(sx + 7, yTop, sx + 7, yBot, RGB.ice);
  for (let level = 1; level <= 7; level++) {
    const y = screenY(COLS + 0.15, 4, level);
    pix.hline(y | 0, sx - 7, sx + 7, RGB.deep);
  }
  return pix.toCanvas();
}

function drawSign(ctx: CanvasRenderingContext2D, atlas: Atlas, now: number): void {
  const logo = atlas.frames.logo;
  if (!logo) return;
  const baseX = screenX(6, 2);
  const baseY = screenY(6, 2, 7.15);
  const w = logo.w + 10;
  const h = logo.h + 8;
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.003);
  ctx.fillStyle = '#071018';
  for (let row = 0; row < h; row++) {
    const shear = (h - row) >> 1;
    ctx.fillRect((baseX + shear) | 0, (baseY - h + row) | 0, w, 1);
  }
  ctx.fillStyle = pulse > 0.62 ? '#FFFFFF' : '#7FDBFF';
  for (let row = 0; row < h; row += h - 1) {
    const shear = (h - row) >> 1;
    ctx.fillRect((baseX + shear) | 0, (baseY - h + row) | 0, w, 1);
  }
  const topShear = h >> 1;
  ctx.fillRect((baseX + topShear) | 0, (baseY - h) | 0, 1, h);
  ctx.fillRect((baseX + topShear + w - 1) | 0, (baseY - h) | 0, 1, h);
  blit(ctx, atlas, logo, baseX + w / 2 + (h >> 2), baseY - 2);
}

let forcedHour = -1;
let cachedHour = -1;
let cachedTint = '';

export function setForcedHour(hour: number): void {
  forcedHour = hour;
  cachedHour = -1;
}

function suzhouHour(): number {
  if (forcedHour >= 0) return forcedHour;
  let h = (Math.floor(Date.now() / 3_600_000) + 8) % 24;
  if (h < 0) h += 24;
  return h;
}

function tintStyle(hour: number): string {
  if (hour === cachedHour) return cachedTint;
  cachedHour = hour;
  let alpha = 0;
  if (hour >= 20 || hour < 6) alpha = 0.22;
  else if (hour >= 17 || hour < 7) alpha = 0.1;
  cachedTint = alpha ? `rgba(0,10,28,${alpha})` : '';
  return cachedTint;
}
