import { RGB, VIEW } from '../config/display.ts';
import type { FloorConfig, FloorType } from '../config/floors.ts';
import type { OfficeEvent, OfficeEventType } from '../events/source.ts';
import { stampText, textWidth } from './font.ts';
import { DEPTH, FLOOR_W, FLOOR_X, FRONT_1, PITCH, SLAB, STAIR_X, frontY, fx, fy } from './iso.ts';
import type { RGBA } from './pixel.ts';
import { Pix } from './pixel.ts';
import { RACK_LEDS, SCREEN_OF, buildAtlas, type Atlas, type Frame } from './sprites.ts';

type State = 'sit' | 'phone' | 'walk' | 'chat' | 'swing' | 'cheer' | 'idle';

interface Actor {
  level: number;
  u: number;
  v: number;
  sprite: string;
  lift: number;
  kind: number;
  state: State;
  home: State;
  dir: number;
  frame: number;
  acc: number;
  timer: number;
  u0: number;
  u1: number;
  moving: number;
  role: number;
  homeU: number;
  homeV: number;
  hidden: number;
  bubble: number;
  seed: number;
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
  on: number;
}

const CODE = [0b101101, 0b011011, 0b110010, 0b001111, 0b101010, 0b111000];
const MOTE = ['rgba(127,219,255,0.4)', 'rgba(191,244,255,0.55)', 'rgba(127,219,255,0.7)'];
const WALL_H = PITCH - DEPTH - 4;

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function jagPoints(x0: number, y0: number, x1: number, y1: number, step = 4): number[] {
  const pts: number[] = [];
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.round(len / step));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const inv = len || 1;
  const px = -dy / inv;
  const py = dx / inv;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const j = ((i * 13 + Math.round(x0 + y0)) % 3) - 1;
    pts.push(x0 + dx * t + px * j, y0 + dy * t + py * j);
  }
  return pts;
}

function drawJag(pix: Pix, pts: number[], color: RGBA): void {
  for (let i = 2; i < pts.length; i += 2) {
    pix.line(pts[i - 2] ?? 0, pts[i - 1] ?? 0, pts[i] ?? 0, pts[i + 1] ?? 0, color);
  }
}

function toPulse(flat: number[], speed: number, phase: number): Pulse {
  const n = flat.length >> 1;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = flat[i * 2] ?? 0;
    ys[i] = flat[i * 2 + 1] ?? 0;
    if (i > 0) dist[i] = (dist[i - 1] ?? 0) + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  const total = dist[n - 1] || 1;
  return { xs, ys, dist, len: n, total, head: total * phase, speed, x: 0, y: 0 };
}

function sample(p: Pulse, d0: number): void {
  let d = d0 % p.total;
  if (d < 0) d += p.total;
  let i = 1;
  while (i < p.len - 1 && (p.dist[i] ?? 0) < d) i += 1;
  const i0 = i - 1;
  const span = (p.dist[i] ?? 0) - (p.dist[i0] ?? 0) || 1;
  const t = (d - (p.dist[i0] ?? 0)) / span;
  p.x = (p.xs[i0] ?? 0) + ((p.xs[i] ?? 0) - (p.xs[i0] ?? 0)) * t;
  p.y = (p.ys[i0] ?? 0) + ((p.ys[i] ?? 0) - (p.ys[i0] ?? 0)) * t;
}

function makeActor(level: number, u: number, v: number, sprite: string, lift = 0): Actor {
  return {
    level,
    u,
    v,
    sprite,
    lift,
    kind: 0,
    state: 'idle',
    home: 'idle',
    dir: 1,
    frame: 0,
    acc: 0,
    timer: 0,
    u0: u,
    u1: u,
    moving: 0,
    role: 0,
    homeU: u,
    homeV: v,
    hidden: 0,
    bubble: 0,
    seed: 1,
  };
}

function asPerson(
  level: number,
  u: number,
  v: number,
  home: State,
  dir: number,
  role: number,
  seed: number,
): Actor {
  const actor = makeActor(level, u, v, '');
  actor.kind = 1;
  actor.state = home;
  actor.home = home;
  actor.dir = dir;
  actor.role = role;
  actor.homeU = u;
  actor.homeV = v;
  actor.seed = seed;
  actor.timer = 600 + (seed % 1500);
  actor.frame = seed & 1;
  actor.bubble = home === 'phone' || home === 'chat' ? 1 : 0;
  return actor;
}

export interface Scene {
  update(dt: number, now: number): void;
  draw(ctx: CanvasRenderingContext2D, now: number): void;
  push(event: OfficeEvent): void;
  levelsFor(type: OfficeEventType): number[];
}

export function createScene(configs: readonly FloorConfig[]): Scene {
  const floors = [...configs].sort((a, b) => a.level - b.level);
  const atlas = buildAtlas();
  const pulses: Pulse[] = [];
  const shell = new Pix(VIEW, VIEW);
  shell.rect(0, 0, VIEW, VIEW, RGB.bg);
  for (let i = 18; i < VIEW; i += 18) {
    const major = i % 72 === 0;
    const c = major ? ([127, 219, 255, 34] as const) : ([127, 219, 255, 14] as const);
    shell.hline(i, 0, VIEW - 1, c);
    for (let y = 0; y < VIEW; y += 2) shell.px(i, y, c);
  }

  const actors: Actor[] = [];
  const floorOf: Actor[][] = [];
  for (let i = 0; i < 8; i++) floorOf.push([]);

  const add = (actor: Actor) => {
    actors.push(actor);
    floorOf[actor.level]?.push(actor);
  };

  let seed = 11;
  const rnd = () => {
    seed = nextSeed(seed);
    return seed / 4294967296;
  };

  for (const cfg of floors) {
    bakeShell(shell, cfg, pulses);
    layout(cfg, add, rnd);
  }
  bakeRoof(shell, atlas, pulses);
  bakeFrame(shell);

  const staticCanvas = shell.toCanvas();
  const order: Int16Array[] = floorOf.map((list) => Int16Array.from(list.map((_, i) => i)));

  const motes = Array.from({ length: 14 }, (_, i) => ({
    x: i < 7 ? 6 + (i % 3) * 8 : VIEW - 14 - (i % 3) * 8,
    y: 12 + ((i * 67) % (VIEW - 24)),
    speed: 8 + (i % 4) * 3,
    style: i % MOTE.length,
  }));
  const bits: Bit[] = Array.from({ length: 16 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1 }));
  const banners: Banner[] = Array.from({ length: 3 }, () => ({
    frame: 'tDEAL',
    x: 0,
    y: 0,
    born: 0,
    until: 0,
    on: 0,
  }));
  const hotUntil = new Float64Array(8);
  let doorUntil = 0;
  let carT = 0;
  let carDir = 1;

  const queue: { type: OfficeEventType; level: number; ttl: number }[] = [];
  for (let i = 0; i < 8; i++) queue.push({ type: 'dealClosed', level: 0, ttl: 0 });
  let qh = 0;
  let qt = 0;

  const levelsOf = (type: FloorType) => floors.filter((f) => f.type === type).map((f) => f.level);

  function burst(x: number, y: number): void {
    let n = 0;
    for (const bit of bits) {
      if (bit.life > 0) continue;
      const ang = (n / 10) * Math.PI * 2;
      bit.x = x;
      bit.y = y;
      bit.vx = Math.cos(ang) * 22;
      bit.vy = Math.sin(ang) * 16 - 8;
      bit.life = 700;
      bit.max = 700;
      n += 1;
      if (n >= 10) break;
    }
  }

  function banner(frame: string, x: number, y: number, now: number, ttl: number): void {
    let slot = banners[0];
    for (const item of banners) {
      if (!item.on) {
        slot = item;
        break;
      }
    }
    if (!slot) return;
    slot.frame = frame;
    slot.x = x;
    slot.y = y;
    slot.born = now;
    slot.until = now + ttl;
    slot.on = 1;
  }

  function apply(type: OfficeEventType, level: number, ttl: number, now: number): void {
    if (type !== 'visitorArrived') hotUntil[level] = now + ttl;
    const list = floorOf[level] ?? [];
    const cx = fx(0.55, 0.5);
    const cy = fy(level, 0.5);
    if (type === 'dealClosed') {
      const who = list.find((a) => a.kind === 1 && a.home === 'phone');
      if (who) {
        who.state = 'cheer';
        who.timer = ttl;
        burst(fx(who.u, who.v), fy(level, who.v) - 10);
      }
      banner('tDEAL', cx, cy - 20, now, ttl);
    } else if (type === 'deploySuccess') {
      banner('tDEPLOY', cx, cy - 18, now, ttl);
      burst(cx, cy);
    } else {
      doorUntil = now + ttl;
      const visitor = list.find((a) => a.role === 2);
      if (visitor) {
        visitor.hidden = 0;
        visitor.u = 0.08;
        visitor.v = 0.2;
        visitor.u0 = 0.08;
        visitor.u1 = 0.42;
        visitor.moving = 1;
        visitor.state = 'walk';
        visitor.dir = 1;
        visitor.bubble = 1;
        visitor.timer = ttl;
      }
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
      carT += sec * carDir * 0.16;
      if (carT > 1) {
        carT = 1;
        carDir = -1;
      } else if (carT < 0) {
        carT = 0;
        carDir = 1;
      }
      for (const actor of actors) {
        if (actor.kind !== 1 || actor.hidden) continue;
        actor.acc += dt;
        const step = actor.state === 'walk' || actor.state === 'swing' ? 140 : 280;
        if (actor.acc >= step) {
          actor.acc -= step;
          if (actor.acc > step) actor.acc = 0;
          actor.frame = (actor.frame + 1) % (actor.state === 'walk' ? 3 : 2);
        }
        if (actor.moving || actor.state === 'walk') {
          const goal = actor.dir > 0 ? actor.u1 : actor.u0;
          const du = goal - actor.u;
          const stepU = 0.22 * sec;
          if (Math.abs(du) <= stepU) {
            actor.u = goal;
            actor.dir = -actor.dir;
            if (actor.home !== 'walk') {
              actor.moving = 0;
              actor.state = actor.home;
              actor.u = actor.homeU;
              actor.v = actor.homeV;
              actor.timer = 900 + (actor.seed % 1200);
            }
          } else {
            actor.u += Math.sign(du) * stepU;
            actor.state = 'walk';
          }
        } else if (actor.state !== 'swing') {
          actor.timer -= dt;
          if (actor.timer > 0 || actor.state === 'cheer') continue;
          actor.seed = nextSeed(actor.seed || 1);
          const r = (actor.seed % 1000) / 1000;
          if (actor.home === 'sit' || actor.home === 'phone') {
            if (r < 0.62) {
              actor.state = actor.home;
              actor.timer = 1400 + r * 2200;
            } else if (r < 0.78) {
              actor.state = 'idle';
              actor.timer = 700;
            } else {
              actor.u0 = Math.max(0.08, actor.homeU - 0.18);
              actor.u1 = Math.min(0.92, actor.homeU + 0.18);
              actor.u = actor.homeU;
              actor.moving = 1;
              actor.dir = r > 0.9 ? -1 : 1;
              actor.state = 'walk';
            }
          } else if (actor.role === 2) {
            actor.moving = 1;
            actor.state = 'walk';
          }
        }
      }
      for (const pulse of pulses) {
        pulse.head += pulse.speed * sec;
        if (pulse.head >= pulse.total) pulse.head -= pulse.total;
      }
      for (const mote of motes) {
        mote.y -= mote.speed * sec;
        if (mote.y < 6) mote.y = VIEW - 8;
      }
      for (const bit of bits) {
        if (bit.life <= 0) continue;
        bit.life -= dt;
        bit.x += bit.vx * sec;
        bit.y += bit.vy * sec;
      }
      void now;
    },
    draw(ctx, now) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(staticCanvas, 0, 0);
      let style = '';
      for (const mote of motes) {
        const fill = MOTE[mote.style] ?? MOTE[0];
        if (fill !== style) {
          ctx.fillStyle = fill ?? '#7FDBFF';
          style = fill ?? '';
        }
        ctx.fillRect(mote.x | 0, mote.y | 0, 2, 2);
      }

      for (const cfg of floors) {
        const list = floorOf[cfg.level] ?? [];
        const idx = order[cfg.level];
        if (!idx) continue;
        const n = list.length;
        for (let i = 1; i < n; i++) {
          const id = idx[i] ?? 0;
          const key = list[id]?.v ?? 0;
          let j = i - 1;
          while (j >= 0 && (list[idx[j] ?? 0]?.v ?? 0) < key) {
            idx[j + 1] = idx[j] ?? 0;
            j -= 1;
          }
          idx[j + 1] = id;
        }
        const hot = now < hotUntil[cfg.level];
        for (let k = 0; k < n; k++) {
          const actor = list[idx[k] ?? 0];
          if (!actor || actor.hidden) continue;
          const name = actor.kind === 0 ? actor.sprite : personSprite(actor);
          const frame = atlas.frames[name];
          if (!frame) continue;
          const x = fx(actor.u, actor.v);
          const y = fy(cfg.level, actor.v) - actor.lift + (actor.state === 'walk' && actor.frame === 1 ? -1 : 0);
          blit(ctx, atlas, frame, x, y);
          if (actor.kind === 0) drawMonitor(ctx, actor.sprite, frame, x, y, now, hot, actor.level);
          if (actor.sprite === 'rack') drawLeds(ctx, frame, x, y, now, actor.u);
          if (actor.sprite === 'gong' && hot) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect((x - 3) | 0, (y - frame.ay + 2) | 0, 6, 5);
          }
          if (actor.kind === 1 && actor.bubble && actor.state !== 'cheer' && actor.state !== 'walk') {
            const bub = atlas.frames[actor.frame & 1 ? 'bubble2' : 'bubble'];
            if (bub) blit(ctx, atlas, bub, x, y - frame.h - 1);
          }
        }
      }

      const tails = ['#FFFFFF', '#BFF4FF', '#7FDBFF', '#2E9BFF'];
      for (let t = 0; t < 4; t++) {
        ctx.fillStyle = tails[t] ?? '#7FDBFF';
        const size = t === 0 ? 3 : 2;
        for (const pulse of pulses) {
          sample(pulse, pulse.head - t * 7);
          ctx.fillRect(pulse.x | 0, pulse.y | 0, size, size);
        }
      }

      const carY = frontY(1) + (frontY(7) - frontY(1)) * carT;
      const carX = fx(1, 0.15) + 8;
      ctx.fillStyle = '#071018';
      ctx.fillRect((carX - 7) | 0, (carY - 16) | 0, 14, 18);
      ctx.fillStyle = '#7FDBFF';
      ctx.fillRect((carX - 7) | 0, (carY - 16) | 0, 14, 1);
      ctx.fillRect((carX - 7) | 0, (carY + 1) | 0, 14, 1);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect((carX - 2) | 0, (carY - 8) | 0, 2, 2);

      drawSign(ctx, atlas, now);
      ctx.fillStyle = '#FFFFFF';
      for (const bit of bits) {
        if (bit.life <= 0) continue;
        ctx.globalAlpha = Math.max(0, bit.life / bit.max);
        ctx.fillRect(bit.x | 0, bit.y | 0, 2, 2);
      }
      ctx.globalAlpha = 1;
      for (const item of banners) {
        if (!item.on) continue;
        if (now >= item.until) {
          item.on = 0;
          continue;
        }
        const life = (item.until - now) / (item.until - item.born || 1);
        const frame = atlas.frames[item.frame];
        if (!frame) continue;
        ctx.globalAlpha = life < 0 ? 0 : life;
        blit(ctx, atlas, frame, item.x, item.y - (1 - life) * 8);
        ctx.globalAlpha = 1;
      }
      if (now < doorUntil) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(fx(0.06, 0) | 0, (fy(1, 0) - 3) | 0, 8, 3);
      }
      const tint = tintStyle(suzhouHour());
      if (tint) {
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, VIEW, VIEW);
        drawSign(ctx, atlas, now);
      }
    },
  };
}

function personSprite(actor: Actor): string {
  const flip = actor.dir < 0 ? 'F' : '';
  const f = actor.frame;
  if (actor.state === 'cheer') return 'cheer';
  if (actor.state === 'walk') return `w${f % 3}${flip}`;
  if (actor.state === 'phone') return `p${f % 2}${flip}`;
  if (actor.state === 'chat') return `c${f % 2}${flip}`;
  if (actor.state === 'swing') return `g${f % 2}${flip}`;
  if (actor.state === 'idle') return `w0${flip}`;
  return `s${f % 2}${flip}`;
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

function drawMonitor(
  ctx: CanvasRenderingContext2D,
  sprite: string,
  frame: Frame,
  footX: number,
  footY: number,
  now: number,
  hot: boolean,
  salt: number,
): void {
  const spots = SCREEN_OF[sprite];
  if (!spots) return;
  for (const spot of spots) {
    const x = (footX - frame.ax + spot.x) | 0;
    const y = (footY - frame.ay + spot.y) | 0;
    if (hot) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x, y, spot.w, spot.h);
      continue;
    }
    ctx.fillStyle = '#05080E';
    ctx.fillRect(x, y, spot.w, spot.h);
    ctx.fillStyle = '#FFFFFF';
    if (sprite === 'screen') {
      const tick = (now / 300 + salt) | 0;
      for (let i = 0; i < 6; i++) {
        const bh = 1 + ((tick + i * 2) % (spot.h - 1));
        ctx.fillRect(x + 1 + i * 3, y + spot.h - bh, 2, bh);
      }
    } else {
      const mask = CODE[(((now / 160) | 0) + salt) % CODE.length] ?? 0;
      for (let col = 0; col < spot.w; col++) {
        if (mask & (1 << (col % 6))) ctx.fillRect(x + col, y + (col % spot.h), 1, 1);
      }
    }
  }
}

function drawLeds(ctx: CanvasRenderingContext2D, frame: Frame, footX: number, footY: number, now: number, salt: number): void {
  for (let i = 0; i < RACK_LEDS.length; i++) {
    const led = RACK_LEDS[i];
    if (!led) continue;
    const on = Math.sin(now * 0.008 + salt * 3 + led[1]) > -0.15;
    ctx.fillStyle = on ? (i % 5 === 0 ? '#FFFFFF' : '#BFF4FF') : '#2E9BFF';
    ctx.fillRect((footX - frame.ax + led[0]) | 0, (footY - frame.ay + led[1]) | 0, 1, 1);
  }
}

function layout(cfg: FloorConfig, add: (actor: Actor) => void, rnd: () => number): void {
  const level = cfg.level;
  const prop = (u: number, v: number, sprite: string, lift = 0) => {
    const actor = makeActor(level, u, v, sprite, lift);
    add(actor);
  };
  if (cfg.type === 'vacant') {
    prop(0.22, 0.45, 'cone');
    prop(0.4, 0.55, 'cone');
    prop(0.62, 0.4, 'cone');
    prop(0.78, 0.6, 'box');
    prop(0.3, 0.7, 'box');
    return;
  }
  if (cfg.type === 'lobby') {
    prop(0.38, 0.62, 'bar');
    prop(0.62, 0.78, 'screen', 16);
    prop(0.18, 0.7, 'plant');
    prop(0.78, 0.55, 'plant');
    prop(0.52, 0.48, 'plant');
    const host = asPerson(level, 0.4, 0.5, 'sit', 1, 0, 3);
    add(host);
    const n = cfg.people;
    for (let i = 0; i < n; i++) {
      const person = asPerson(level, 0.12 + i * 0.08, 0.22, 'walk', i % 2 ? -1 : 1, 2, 20 + i);
      person.u0 = 0.08;
      person.u1 = 0.55;
      person.moving = 1;
      person.home = 'walk';
      add(person);
    }
    return;
  }
  if (cfg.type === 'lounge') {
    prop(0.28, 0.6, 'sofa');
    prop(0.48, 0.42, 'pong');
    prop(0.78, 0.68, 'bar');
    prop(0.7, 0.58, 'stool');
    prop(0.86, 0.58, 'stool');
    prop(0.16, 0.45, 'plant');
    prop(0.9, 0.4, 'plant');
    add(asPerson(level, 0.4, 0.32, 'swing', 1, 3, 8));
    add(asPerson(level, 0.56, 0.32, 'swing', -1, 3, 9));
    add(asPerson(level, 0.72, 0.5, 'chat', 1, 3, 10));
    add(asPerson(level, 0.84, 0.48, 'chat', -1, 3, 11));
    add(asPerson(level, 0.24, 0.48, 'chat', 1, 3, 12));
    add(asPerson(level, 0.34, 0.46, 'chat', -1, 3, 13));
    return;
  }

  const cols = cfg.type === 'it' ? 6 : Math.min(9, Math.max(6, Math.ceil(cfg.stations / 2)));
  const rows = 2;
  let placed = 0;
  const seats: { u: number; v: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const v = r === 0 ? 0.82 : 0.34;
    for (let c = 0; c < cols && placed < cfg.stations; c++) {
      const u = 0.1 + ((c + 0.5) * (cfg.type === 'it' ? 0.48 : 0.78)) / cols;
      if (cfg.type === 'sales' && u > 0.78 && r === 0) continue;
      const sprite = cfg.type === 'it' ? 'dual' : 'desk';
      prop(u, v, sprite);
      seats.push({ u, v });
      placed += 1;
    }
  }
  if (cfg.type === 'it') {
    for (let i = 0; i < 4; i++) prop(0.62 + i * 0.09, 0.7, 'rack');
    prop(0.84, 0.42, 'screen', 8);
    add(asPerson(level, 0.66, 0.52, 'idle', -1, 1, 40));
    add(asPerson(level, 0.84, 0.52, 'idle', 1, 1, 41));
  } else if (cfg.type === 'sales') {
    prop(0.22, 0.86, 'screen', 14);
    prop(0.88, 0.62, 'gong');
  } else if (cfg.type === 'rnd') {
    prop(0.16, 0.9, 'board', 12);
    if (level === 7) {
      prop(0.7, 0.78, 'bench');
      prop(0.86, 0.78, 'bench');
    }
    prop(0.92, 0.4, 'plant');
  }

  const occupied = Math.round(seats.length * cfg.occupancy);
  for (let i = 0; i < occupied; i++) {
    const seat = seats[i];
    if (!seat) continue;
    const phone = cfg.type === 'sales';
    add(asPerson(level, seat.u + 0.015, seat.v - 0.12, phone ? 'phone' : 'sit', i % 2 ? -1 : 1, phone ? 4 : 0, 100 + level * 20 + i));
  }
  for (let i = 0; i < cfg.people; i++) {
    const walker = asPerson(level, 0.2 + i * 0.2, 0.28, 'walk', 1, 1, 200 + i);
    walker.u0 = 0.15;
    walker.u1 = 0.7;
    walker.moving = 1;
    walker.home = 'walk';
    add(walker);
  }
  void rnd;
}

function bakeShell(pix: Pix, cfg: FloorConfig, pulses: Pulse[]): void {
  const level = cfg.level;
  const y0 = fy(level, 0);
  const y1 = fy(level, 1);
  const vacant = cfg.type === 'vacant';
  const wallTop = y1 - WALL_H;
  if (!vacant) {
    pix.rect(fx(0, 1), wallTop, FLOOR_W, WALL_H, RGB.side);
    pix.trap(y1, y0, fx(0, 1), fx(1, 1), fx(0, 0), fx(1, 0), RGB.floor);
  }
  const edge = vacant ? RGB.white : RGB.ice;
  const grid = vacant ? RGB.iceDim : RGB.iceFaint;
  for (let i = 0; i <= 4; i++) {
    const v = i / 4;
    const x0 = fx(0, v);
    const x1 = fx(1, v);
    const y = fy(level, v);
    if (vacant) pix.dashed(x0, y, x1, y, i % 2 ? RGB.white : RGB.deep, 3, 3);
    else pix.line(x0, y, x1, y, i === 0 || i === 4 ? edge : grid);
  }
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    pix.line(fx(u, 0), fy(level, 0), fx(u, 1), fy(level, 1), i === 0 || i === 10 ? edge : grid);
  }
  pix.rect(fx(0, 0), y0, FLOOR_W, SLAB, RGB.side);
  pix.line(fx(0, 0), y0 + SLAB, fx(1, 0), y0 + SLAB, RGB.ice);
  pix.line(fx(0, 0), y0, fx(1, 0), y0, RGB.bright);
  pix.line(fx(0, 1), y1, fx(0, 1), wallTop, RGB.ice);
  pix.line(fx(1, 1), y1, fx(1, 1), wallTop, RGB.ice);
  pix.line(fx(0, 1), wallTop, fx(1, 1), wallTop, RGB.ice);

  if (!vacant) {
    const windows = cfg.type === 'lobby' ? 4 : 8;
    for (let i = 0; i < windows; i++) {
      const u = 0.08 + i * (0.84 / windows);
      if (cfg.type === 'sales' && u < 0.34 && u > 0.12) continue;
      const x = fx(u, 1);
      const top = wallTop + 6;
      const bot = y1 - 4;
      pix.rect(x, top, 18, Math.max(4, bot - top), RGB.hole);
      pix.line(x, top, x + 18, top, RGB.ice);
      pix.line(x, bot, x + 18, bot, RGB.ice);
      pix.line(x, top, x, bot, RGB.ice);
      pix.line(x + 18, top, x + 18, bot, RGB.ice);
    }
  }

  const sideTop = wallTop;
  const sideBot = y0 + SLAB;
  pix.line(fx(1, 1) + 12, sideTop, fx(1, 1) + 12, sideBot, RGB.ice);
  pix.line(fx(1, 0) + 8, y0, fx(1, 0) + 8, y0 + SLAB + 2, RGB.ice);
  pix.line(fx(1, 1), y1, fx(1, 1) + 12, y1 - 4, RGB.ice);
  for (let v = 0.4; v <= 1.01; v += 0.2) {
    const x = fx(1, v);
    const y = fy(level, v);
    pix.line(x, y, x + 10, y - 4, RGB.deep);
    pix.line(x + 10, y - 4, x + 10, y - 4 - 10, RGB.iceDim);
  }

  const stairTop = frontY(level) - PITCH + 6;
  const stairBot = y0 + SLAB;
  pix.rect(STAIR_X, stairTop, FLOOR_X - STAIR_X - 2, stairBot - stairTop, RGB.side);
  pix.line(STAIR_X, stairTop, STAIR_X, stairBot, RGB.ice);
  pix.line(FLOOR_X - 2, stairTop, FLOOR_X - 2, stairBot, RGB.ice);
  const steps = 5;
  const rise = (stairBot - stairTop) / steps;
  for (let s = 0; s < steps; s++) {
    const y = stairBot - (s + 1) * rise;
    const left = s % 2 === 0;
    const x0 = left ? STAIR_X + 4 : STAIR_X + 22;
    const x1 = left ? STAIR_X + 24 : FLOOR_X - 6;
    pix.rect(x0, y - 2, x1 - x0, 3, RGB.ice);
    pix.line(left ? x1 : x0, y, left ? x1 : x0, y - rise, RGB.bright);
  }

  const lx = (fx(0.03, 1) + 2) | 0;
  const ly = (wallTop + 8) | 0;
  stampText(pix, lx, ly, cfg.label, 2, RGB.white, 'ui');
  stampText(pix, lx, ly + 12, cfg.name, 1, RGB.ice, 'ui');

  if (vacant) {
    const text = 'VACANT';
    const tw = textWidth(text, 2, 3);
    stampText(pix, (fx(0.5, 0.55) - tw / 2) | 0, (fy(level, 0.55) - 16) | 0, text, 2, RGB.white, 'ui');
  }

  pulses.push(toPulse(jagPoints(fx(0, 0), y0, fx(1, 0), y0, 6), 34 + (level % 3) * 6, (level * 0.17) % 1));
  pulses.push(toPulse(jagPoints(fx(0, 1), wallTop, fx(1, 1), wallTop, 6), 28, (level * 0.41) % 1));
}

function bakeRoof(pix: Pix, atlas: Atlas, pulses: Pulse[]): void {
  const level = 7;
  const y1 = fy(level, 1) - WALL_H - 2;
  const depth = 14;
  const y0 = y1 + depth;
  const x0 = FLOOR_X + 10;
  const x1 = FLOOR_X + FLOOR_W - 8;
  const skew = 24;
  pix.trap(y1, y0, x0 + skew, x1 + skew, x0, x1, RGB.floor);
  pix.line(x0, y0, x1, y0, RGB.ice);
  pix.line(x0 + skew, y1, x1 + skew, y1, RGB.ice);
  pix.line(x0, y0, x0 + skew, y1, RGB.ice);
  pix.line(x1, y0, x1 + skew, y1, RGB.ice);
  pix.line(x0, y0 - 5, x1, y0 - 5, RGB.bright);
  pix.line(x0 + skew, y1 - 5, x1 + skew, y1 - 5, RGB.bright);
  const hvac = atlas.frames.hvac;
  if (hvac) {
    pix.blit(atlasPix(atlas), hvac.x, hvac.y, hvac.w, hvac.h, (x1 - 70) | 0, (y1 + 2) | 0);
    pix.blit(atlasPix(atlas), hvac.x, hvac.y, hvac.w, hvac.h, (x1 - 36) | 0, (y0 - 16) | 0);
  }
  pix.line(x0 + 28, y1 + 6, x0 + 28, y1 - 16, RGB.ice);
  pix.line(x0 + 22, y1 - 12, x0 + 36, y1 - 16, RGB.bright);
  const ridge = jagPoints(x0, y0 - 5, x1 + skew, y1 - 5, 6);
  drawJag(pix, ridge, RGB.deep);
  pulses.push(toPulse(ridge, 36, 0.2));
  void atlas;
}

function bakeFrame(pix: Pix): void {
  const yTop = fy(7, 1) - WALL_H - 20;
  const yBot = FRONT_1 + SLAB;
  pix.line(STAIR_X, yTop, STAIR_X, yBot, RGB.ice);
  pix.line(STAIR_X + 1, yTop, STAIR_X + 1, yBot, RGB.deep);
  const rx = fx(1, 1) + 12;
  pix.line(rx, yTop, rx, yBot, RGB.ice);
  pix.line(rx + 1, yTop, rx + 1, yBot, RGB.deep);
  const spine = jagPoints(STAIR_X, yBot, STAIR_X, yTop, 6);
  void spine;
}

const atlasPixels = new WeakMap<Atlas, Pix>();

function atlasPix(atlas: Atlas): Pix {
  let pix = atlasPixels.get(atlas);
  if (pix) return pix;
  pix = new Pix(atlas.canvas.width, atlas.canvas.height);
  const ctx = atlas.canvas.getContext('2d');
  if (!ctx) return pix;
  const data = ctx.getImageData(0, 0, atlas.canvas.width, atlas.canvas.height);
  pix.data.set(data.data);
  atlasPixels.set(atlas, pix);
  return pix;
}

function drawSign(ctx: CanvasRenderingContext2D, atlas: Atlas, now: number): void {
  const logo = atlas.frames.logo;
  if (!logo) return;
  const y1 = fy(7, 1) - WALL_H - 8;
  const cx = FLOOR_X + FLOOR_W * 0.42;
  const w = logo.w + 12;
  const h = logo.h + 10;
  const x = (cx - w / 2) | 0;
  const y = (y1 - h - 6) | 0;
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.003);
  ctx.fillStyle = '#071018';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = pulse > 0.6 ? '#FFFFFF' : '#7FDBFF';
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
  ctx.fillRect(x + 8, y + h, 1, 6);
  ctx.fillRect(x + w - 9, y + h, 1, 6);
  blit(ctx, atlas, logo, cx, y + h - 4);
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
  if (hour >= 20 || hour < 6) alpha = 0.2;
  else if (hour >= 17 || hour < 7) alpha = 0.08;
  cachedTint = alpha ? `rgba(0,10,28,${alpha})` : '';
  return cachedTint;
}
