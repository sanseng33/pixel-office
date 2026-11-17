import { RGB, VIEW } from '../config/display.ts';
import type { FloorConfig } from '../config/floors.ts';
import type { OfficeEvent, OfficeEventType } from '../events/source.ts';
import { stampText, textWidth } from './font.ts';
import { ISO, floorX, floorY, roofFor, roofX, roofY } from './iso.ts';
import { Pix } from './pixel.ts';
import {
  BIG_SCREEN,
  DESK_SCREEN,
  RACK_LEDS,
  buildAtlas,
  type Atlas,
  type Frame,
} from './sprites.ts';

type Mode = 'walk' | 'phone' | 'chat' | 'coffee' | 'cheer' | 'type';

interface Actor {
  level: number;
  u: number;
  v: number;
  ox: number;
  oy: number;
  home: Mode;
  mode: Mode;
  dir: number;
  frameDir: number;
  frames: readonly string[];
  frame: number;
  acc: number;
  walking: number;
  u0: number;
  u1: number;
  t: number;
  dur: number;
  visitor: number;
  leg: number;
  hidden: number;
  bubbleUntil: number;
  override: Mode;
  overrideUntil: number;
  head: number;
  ySort: number;
}

interface Screen {
  x: number;
  y: number;
  w: number;
  h: number;
  phase: number;
  level: number;
  kind: 'code' | 'billboard';
}

interface Led {
  x: number;
  y: number;
  phase: number;
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

interface Mote {
  x: number;
  y: number;
  speed: number;
  style: number;
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

const WALK_R = ['walk0', 'walk1', 'walk2', 'walk3'] as const;
const WALK_L = ['walk0L', 'walk1L', 'walk2L', 'walk3L'] as const;
const PHONE_R = ['phone0', 'phone1'] as const;
const PHONE_L = ['phone0L', 'phone1L'] as const;
const CHAT_R = ['chat0', 'chat1'] as const;
const CHAT_L = ['chat0L', 'chat1L'] as const;
const COFFEE_R = ['coffee0', 'coffee1'] as const;
const COFFEE_L = ['coffee0L', 'coffee1L'] as const;
const CHEER = ['cheer0', 'cheer1'] as const;
const TYPE = ['type0', 'type1'] as const;

const CODE: readonly number[] = [0b101101, 0b011011, 0b110010, 0b001111, 0b101010, 0b111000, 0b010101, 0b100111];

const MOTE_FILL = ['rgba(127,219,255,0.35)', 'rgba(191,244,255,0.5)', 'rgba(127,219,255,0.55)'];

function frameSet(mode: Mode, dir: number): readonly string[] {
  const left = dir < 0;
  switch (mode) {
    case 'walk':
      return left ? WALK_L : WALK_R;
    case 'phone':
      return left ? PHONE_L : PHONE_R;
    case 'chat':
      return left ? CHAT_L : CHAT_R;
    case 'coffee':
      return left ? COFFEE_L : COFFEE_R;
    case 'cheer':
      return CHEER;
    default:
      return TYPE;
  }
}

function densify(pts: readonly (readonly [number, number])[], step: number): Pulse {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.round(len / step));
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
    const dx = (xs[i] ?? 0) - (xs[i - 1] ?? 0);
    const dy = (ys[i] ?? 0) - (ys[i - 1] ?? 0);
    dist[i] = (dist[i - 1] ?? 0) + Math.hypot(dx, dy);
  }
  return {
    xs: Float32Array.from(xs),
    ys: Float32Array.from(ys),
    dist,
    len: xs.length,
    total: dist[xs.length - 1] || 1,
    head: 0,
    speed: 28,
    x: 0,
    y: 0,
  };
}

function sample(p: Pulse, dist: number): void {
  let d = dist % p.total;
  if (d < 0) d += p.total;
  let i = 1;
  while (i < p.len - 1 && (p.dist[i] ?? 0) < d) i++;
  const i0 = i - 1;
  const span = (p.dist[i] ?? 0) - (p.dist[i0] ?? 0) || 1;
  const t = (d - (p.dist[i0] ?? 0)) / span;
  p.x = (p.xs[i0] ?? 0) + ((p.xs[i] ?? 0) - (p.xs[i0] ?? 0)) * t;
  p.y = (p.ys[i0] ?? 0) + ((p.ys[i] ?? 0) - (p.ys[i0] ?? 0)) * t;
}

export interface Scene {
  update(dt: number, now: number): void;
  draw(ctx: CanvasRenderingContext2D, now: number): void;
  push(event: OfficeEvent): void;
  levelsFor(type: OfficeEventType): number[];
}

export function createScene(floorsIn: readonly FloorConfig[]): Scene {
  const floors = [...floorsIn].sort((a, b) => a.level - b.level);
  const atlas = buildAtlas();
  const bg = bakeBackground();
  const built = bakeBuilding(atlas, floors);
  const actors = built.actors;
  actors.sort((a, b) => a.ySort - b.ySort);

  const pulses = built.pulses;
  const screens = built.screens;
  const leds = built.leds;
  const motes: Mote[] = [];
  for (let i = 0; i < 18; i++) {
    const left = i < 9;
    motes.push({
      x: left ? 8 + (i % 5) * 8 : VIEW - 14 - (i % 5) * 8,
      y: 20 + ((i * 47) % (VIEW - 40)),
      speed: 6 + (i % 4) * 3,
      style: i % MOTE_FILL.length,
    });
  }
  const bits: Bit[] = [];
  for (let i = 0; i < 16; i++) bits.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1 });
  const banners: Banner[] = [];
  for (let i = 0; i < 4; i++) banners.push({ frame: 'tDEAL', x: 0, y: 0, born: 0, until: 0, active: 0 });

  const flashUntil = new Float64Array(10);
  const hotUntil = new Float64Array(10);
  let doorUntil = 0;
  let antennaOn = 0;

  const queue: { type: OfficeEventType; level: number; ttl: number }[] = [];
  for (let i = 0; i < 8; i++) queue.push({ type: 'dealClosed', level: 0, ttl: 0 });
  let qh = 0;
  let qt = 0;

  const celebrant: (Actor | null)[] = [null, null, null, null, null, null, null, null, null, null];
  for (const actor of actors) {
    if (actor.home === 'phone' && !celebrant[actor.level]) celebrant[actor.level] = actor;
  }

  const levelsOf = (kind: FloorConfig['kind']): number[] =>
    floors.filter((f) => f.kind === kind).map((f) => f.level);

  function burst(x: number, y: number): void {
    const angles = 12;
    let spawned = 0;
    for (const bit of bits) {
      if (bit.life > 0) continue;
      const ang = (spawned / angles) * Math.PI * 2;
      bit.x = x;
      bit.y = y;
      bit.vx = Math.cos(ang) * (18 + (spawned % 3) * 8);
      bit.vy = Math.sin(ang) * (14 + (spawned % 3) * 6) - 8;
      bit.life = 900;
      bit.max = 900;
      spawned++;
      if (spawned >= angles) break;
    }
  }

  function banner(frame: string, x: number, y: number, now: number, ttl: number): void {
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
    const cx = floorX(0.55, 0.45);
    const cy = floorY(level, 0.45);
    if (type === 'dealClosed') {
      const who = celebrant[level];
      if (who) {
        who.override = 'cheer';
        who.overrideUntil = now + ttl;
        burst(floorX(who.u, who.v) + who.ox, floorY(level, who.v) + who.oy - 10);
      } else {
        burst(cx, cy);
      }
      banner('tDEAL', cx, cy - 30, now, ttl);
    } else if (type === 'deploySuccess') {
      burst(cx, cy - 8);
      banner('tDEPLOY', cx, cy - 30, now, ttl);
    } else {
      doorUntil = now + ttl;
      for (const actor of actors) {
        if (actor.visitor === 2 && actor.level === level) {
          actor.hidden = 0;
          actor.leg = 0;
          actor.t = 0;
          actor.u0 = 0.14;
          actor.u1 = 0.46;
          actor.dir = 1;
          actor.walking = 1;
          actor.bubbleUntil = now + ttl;
          break;
        }
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
        if (item) apply(item.type, item.level, item.ttl, now);
        qt = (qt + 1) % queue.length;
      }
      for (const actor of actors) {
        if (actor.walking && !actor.hidden) {
          actor.t += dt / actor.dur;
          if (actor.t >= 1) {
            actor.t = 0;
            if (actor.visitor === 2) {
              if (actor.leg === 0) {
                actor.leg = 1;
                const swap = actor.u0;
                actor.u0 = actor.u1;
                actor.u1 = swap;
                actor.dir = actor.u1 >= actor.u0 ? 1 : -1;
              } else {
                actor.hidden = 1;
              }
            } else {
              const swap = actor.u0;
              actor.u0 = actor.u1;
              actor.u1 = swap;
              actor.dir = actor.u1 >= actor.u0 ? 1 : -1;
            }
          }
          const travel = actor.t > 1 ? 1 : actor.t;
          actor.u = actor.u0 + (actor.u1 - actor.u0) * travel;
        }
        const mode = actor.overrideUntil > now ? actor.override : actor.home;
        if (mode !== actor.mode || actor.dir !== actor.frameDir) {
          actor.mode = mode;
          actor.frameDir = actor.dir;
          actor.frames = frameSet(mode, actor.dir);
          actor.frame = 0;
          actor.acc = 0;
        }
        actor.acc += dt;
        const step = actor.mode === 'walk' ? 140 : 240;
        if (actor.acc >= step) {
          actor.acc -= step;
          if (actor.acc > step) actor.acc = 0;
          const n = actor.frames.length || 1;
          actor.frame = (actor.frame + 1) % n;
        }
      }
      const dsec = dt * 0.001;
      for (const pulse of pulses) {
        pulse.head += pulse.speed * dsec;
        if (pulse.head >= pulse.total) pulse.head -= pulse.total;
      }
      for (const mote of motes) {
        mote.y -= mote.speed * dsec;
        if (mote.y < 4) mote.y = VIEW - 6;
      }
      for (const bit of bits) {
        if (bit.life <= 0) continue;
        bit.life -= dt;
        bit.x += bit.vx * dsec;
        bit.y += bit.vy * dsec;
        bit.vy += 22 * dsec;
      }
      antennaOn = ((now / 420) | 0) % 2;
    },
    draw(ctx, now) {
      ctx.drawImage(bg, 0, 0);
      let lastStyle = '';
      for (const mote of motes) {
        const style = MOTE_FILL[mote.style] ?? MOTE_FILL[0];
        if (style !== lastStyle) {
          ctx.fillStyle = style;
          lastStyle = style;
        }
        ctx.fillRect(mote.x | 0, mote.y | 0, 2, 2);
      }
      ctx.drawImage(built.building, 0, 0);

      const tailColors = ['#FFFFFF', '#BFF4FF', '#7FDBFF', '#2E9BFF'];
      for (let t = 0; t < 4; t++) {
        ctx.fillStyle = tailColors[t] ?? '#7FDBFF';
        const size = t === 0 ? 3 : t === 1 ? 2 : 1;
        for (const pulse of pulses) {
          sample(pulse, pulse.head - t * 5);
          ctx.fillRect(pulse.x | 0, pulse.y | 0, size, size);
        }
      }

      ctx.fillStyle = '#FFFFFF';
      for (let i = 0; i < leds.length; i++) {
        const led = leds[i];
        if (!led) continue;
        const on = Math.sin(now * 0.006 + led.phase) > -0.15;
        if (!on && i % 3 !== 0) continue;
        if (!on) ctx.fillStyle = '#2E9BFF';
        else if ((i + ((now / 180) | 0)) % 5 === 0) ctx.fillStyle = '#FFFFFF';
        else ctx.fillStyle = '#BFF4FF';
        ctx.fillRect(led.x, led.y, 1, 1);
      }

      for (const screen of screens) {
        const hot = now < hotUntil[screen.level];
        if (hot) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
          continue;
        }
        ctx.fillStyle = '#05080E';
        ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
        ctx.fillStyle = '#FFFFFF';
        if (screen.kind === 'billboard') {
          const tick = (now / 380 + screen.phase) | 0;
          const bars = 6;
          const gap = Math.max(2, (screen.w / bars) | 0);
          for (let i = 0; i < bars; i++) {
            const bh = 2 + ((tick + i * 3) % (screen.h - 2));
            ctx.fillRect(screen.x + 1 + i * gap, screen.y + screen.h - bh, Math.max(1, gap - 2), bh);
          }
        } else {
          const mask = CODE[(((now / 160) | 0) + screen.phase) % CODE.length] ?? 0;
          for (let col = 0; col < screen.w; col++) {
            if ((mask & (1 << (col % 6))) === 0) continue;
            const row = (col + screen.phase) % screen.h;
            ctx.fillRect(screen.x + col, screen.y + row, 1, 1);
          }
        }
      }

      if (now < doorUntil) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(built.doorX, built.doorY, 2, 2);
        ctx.fillRect(built.doorX + 10, built.doorY, 2, 2);
      }

      for (const level of built.outlineLevels) {
        if (now >= flashUntil[level]) continue;
        ctx.fillStyle = ((now / 120) | 0) % 2 === 0 ? '#FFFFFF' : '#BFF4FF';
        const y = floorY(level, 0);
        const x0 = floorX(0, 0);
        const x1 = floorX(1, 0);
        ctx.fillRect(x0 | 0, y | 0, (x1 - x0) | 0, 1);
      }

      for (const actor of actors) {
        if (actor.hidden) continue;
        const name = actor.frames[actor.frame] ?? actor.frames[0];
        if (!name) continue;
        const frame = atlas.frames[name];
        if (!frame) continue;
        const x = (floorX(actor.u, actor.v) + actor.ox - frame.ax) | 0;
        const y = (floorY(actor.level, actor.v) + actor.oy - frame.ay) | 0;
        blit(ctx, atlas, frame, x, y);
        const bub =
          actor.mode === 'phone' || actor.mode === 'chat' || now < actor.bubbleUntil;
        if (!bub || actor.mode === 'cheer') continue;
        const bname = ((now / 260) | 0) % 2 === 0 ? 'bubble' : 'bubble2';
        const bubble = atlas.frames[now < actor.bubbleUntil ? 'tHI' : bname];
        if (!bubble) continue;
        blit(ctx, atlas, bubble, (x + frame.ax - bubble.ax) | 0, (y - bubble.h - 1) | 0);
      }

      ctx.fillStyle = '#FFFFFF';
      for (const bit of bits) {
        if (bit.life <= 0) continue;
        ctx.globalAlpha = bit.life / bit.max;
        ctx.fillRect(bit.x | 0, bit.y | 0, 2, 2);
      }
      ctx.globalAlpha = 1;

      drawSign(ctx, atlas, built.sign, now);
      if (antennaOn) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(built.antennaX, built.antennaY, 2, 2);
      }

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
        const rise = (1 - life) * 12;
        blit(ctx, atlas, frame, (item.x - frame.ax) | 0, (item.y - rise - frame.ay) | 0);
        ctx.globalAlpha = 1;
      }

      const tint = tintStyle(suzhouHour());
      if (tint) {
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, VIEW, VIEW);
      }
    },
  };
}

function blit(ctx: CanvasRenderingContext2D, atlas: Atlas, frame: Frame, x: number, y: number): void {
  ctx.drawImage(atlas.canvas, frame.x, frame.y, frame.w, frame.h, x, y, frame.w, frame.h);
}

let cachedHour = -1;
let cachedTint = '';

/** Asia/Shanghai is UTC+8 year-round. */
function suzhouHour(): number {
  if (forcedHour >= 0) return forcedHour;
  let h = (Math.floor(Date.now() / 3_600_000) + 8) % 24;
  if (h < 0) h += 24;
  return h;
}

let forcedHour = -1;
export function setForcedHour(hour: number): void {
  forcedHour = hour;
  cachedHour = -1;
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

function bakeBackground(): HTMLCanvasElement {
  const pix = new Pix(VIEW, VIEW);
  pix.rect(0, 0, VIEW, VIEW, RGB.bg);
  for (let i = 16; i < VIEW; i += 16) {
    const major = i % 64 === 0;
    const h = major ? ([127, 219, 255, 40] as const) : ([127, 219, 255, 18] as const);
    const v = major ? ([127, 219, 255, 32] as const) : ([127, 219, 255, 14] as const);
    pix.hline(i, 0, VIEW - 1, h);
    for (let y = 0; y < VIEW; y += 2) pix.px(i, y, v);
  }
  const stars: readonly (readonly [number, number])[] = [
    [18, 30],
    [36, 70],
    [22, 180],
    [14, 300],
    [30, 400],
    [458, 24],
    [466, 90],
    [450, 210],
    [462, 340],
    [454, 420],
  ];
  for (const star of stars) pix.px(star[0], star[1], RGB.bright);
  return pix.toCanvas();
}

interface Built {
  building: HTMLCanvasElement;
  actors: Actor[];
  screens: Screen[];
  leds: Led[];
  pulses: Pulse[];
  outlineLevels: number[];
  doorX: number;
  doorY: number;
  antennaX: number;
  antennaY: number;
  sign: { x: number; y: number; w: number; h: number; tx: number; ty: number };
}

function bakeBuilding(atlas: Atlas, floors: readonly FloorConfig[]): Built {
  const pix = new Pix(VIEW, VIEW);
  const actors: Actor[] = [];
  const screens: Screen[] = [];
  const leds: Led[] = [];
  const segments: (readonly [number, number])[][] = [];
  const outlineLevels: number[] = [];

  const addSeg = (pts: (readonly [number, number])[]) => {
    segments.push(pts);
  };

  const rndLevels = floors.filter((f) => f.kind === 'rnd').map((f) => f.level);
  const topRnd = rndLevels.length ? Math.max(...rndLevels) : 0;
  const topLevel = floors.length ? Math.max(...floors.map((f) => f.level)) : 7;

  for (const floor of floors) {
    drawFloorShell(pix, floor, addSeg);
    outlineLevels.push(floor.level);
    furnish(pix, atlas, floor, actors, screens, leds, floor.level === topRnd);
  }

  drawStairs(pix, floors, addSeg);
  const roof = drawRoof(pix, atlas, topLevel, addSeg);

  const leftX = ISO.stairX;
  const topY = roof.sign.y - 6;
  const rightX = floorX(1, 1) + ISO.side;
  const botY = floorY(floors[0]?.level ?? 1, 0) + ISO.slab;
  addSeg([
    [leftX, botY],
    [leftX, topY],
    [rightX, topY],
    [rightX, botY],
    [floorX(0, 0), botY],
    [leftX, botY],
  ]);

  const pulses: Pulse[] = [];
  segments.forEach((pts, i) => {
    if (pts.length < 2) return;
    const pulse = densify(pts, 3);
    pulse.speed = 22 + (i % 5) * 6;
    pulse.head = (pulse.total * ((i * 3) % 7)) / 7;
    pulses.push(pulse);
    if (pts.length > 3 || i % 2 === 0) {
      const twin: Pulse = { ...pulse, head: (pulse.head + pulse.total * 0.5) % pulse.total, speed: pulse.speed * 0.85 };
      pulses.push(twin);
    }
  });

  stampLabels(pix, floors);

  return {
    building: pix.toCanvas(),
    actors,
    screens,
    leds,
    pulses,
    outlineLevels,
    doorX: floorX(0.16, 0) | 0,
    doorY: (floorY(floors.find((f) => f.kind === 'lobby')?.level ?? 1, 0) - 2) | 0,
    antennaX: roof.antennaX,
    antennaY: roof.antennaY,
    sign: roof.sign,
  };
}

function drawFloorShell(
  pix: Pix,
  floor: FloorConfig,
  addSeg: (pts: (readonly [number, number])[]) => void,
): void {
  const level = floor.level;
  const flx = floorX(0, 0);
  const frx = floorX(1, 0);
  const blx = floorX(0, 1);
  const brx = floorX(1, 1);
  const fy = floorY(level, 0);
  const by = floorY(level, 1);

  pix.rect(blx, by - ISO.wallH, brx - blx, ISO.wallH, RGB.wall);
  pix.trap(by, fy, blx, brx, flx, frx, RGB.floor);

  for (let i = 1; i < 5; i++) {
    const v = i / 5;
    const y = floorY(level, v);
    pix.hline(y, floorX(0, v), floorX(1, v), RGB.iceDim);
  }
  for (let i = 1; i < 8; i++) {
    const u = i / 8;
    pix.line(floorX(u, 0), floorY(level, 0), floorX(u, 1), floorY(level, 1), RGB.iceDim);
  }

  if (floor.kind !== 'vacant') {
    const windows = floor.kind === 'lobby' ? 4 : floor.kind === 'it' ? 0 : 7;
    for (let i = 0; i < windows; i++) {
      const u = 0.08 + i * (floor.kind === 'lobby' ? 0.12 : 0.12);
      if (floor.kind === 'lobby' && u > 0.42 && u < 0.78) continue;
      const x0 = floorX(u, 1);
      const x1 = floorX(u + 0.07, 1);
      const top = by - ISO.wallH + 6;
      const bot = by - 5;
      pix.rect(x0, top, x1 - x0, bot - top, RGB.hole);
      pix.line(x0, top, x1, top, RGB.ice);
      pix.line(x0, bot, x1, bot, RGB.ice);
      pix.line(x0, top, x0, bot, RGB.ice);
      pix.line(x1, top, x1, bot, RGB.ice);
    }
    if (floor.kind === 'it') {
      for (let i = 0; i < 5; i++) {
        const y = by - 8 - i * 5;
        pix.hline(y, blx + 8, brx - 8, RGB.iceDim);
      }
    }
  } else {
    for (let x = blx + 4; x < brx - 4; x += 6) {
      pix.hline(by - 10, x, x + 3, RGB.white);
    }
  }

  pix.rect(flx, fy, frx - flx, ISO.slab, RGB.lip);
  if (floor.kind === 'lobby') {
    const dx0 = floorX(0.12, 0);
    const dx1 = floorX(0.24, 0);
    pix.rect(dx0, fy, dx1 - dx0, ISO.slab, RGB.hole);
    pix.line(dx0, fy - 8, dx0, fy + ISO.slab, RGB.ice);
    pix.line(dx1, fy - 8, dx1, fy + ISO.slab, RGB.ice);
    pix.line(dx0, fy - 8, dx1, fy - 8, RGB.ice);
  }
  if (floor.kind === 'vacant') {
    for (let x = flx; x < frx; x += 8) {
      pix.hline(fy + 2, x, x + 4, x % 16 === 0 ? RGB.white : RGB.deep);
    }
  }

  pix.line(flx, fy, frx, fy, RGB.ice);
  pix.line(flx, fy + ISO.slab, frx, fy + ISO.slab, RGB.ice);
  pix.line(blx, by, brx, by, RGB.ice);
  pix.line(blx, by - ISO.wallH, brx, by - ISO.wallH, RGB.ice);
  pix.line(flx, fy, blx, by, RGB.ice);
  pix.line(frx, fy, brx, by, RGB.ice);
  pix.line(blx, by, blx, by - ISO.wallH, RGB.ice);
  pix.line(brx, by, brx, by - ISO.wallH, RGB.ice);

  const ox = ISO.side;
  const oy = 4;
  pix.line(frx + ox, fy - oy, brx + ox, by - oy, RGB.ice);
  pix.line(frx, fy, frx + ox, fy - oy, RGB.ice);
  pix.line(brx, by, brx + ox, by - oy, RGB.ice);
  pix.line(frx + ox, fy - oy, frx + ox, fy + ISO.slab, RGB.ice);

  addSeg([
    [flx, fy],
    [frx, fy],
  ]);
  addSeg([
    [blx, by - ISO.wallH],
    [brx, by - ISO.wallH],
  ]);
}

function drawStairs(
  pix: Pix,
  floors: readonly FloorConfig[],
  addSeg: (pts: (readonly [number, number])[]) => void,
): void {
  if (!floors.length) return;
  const top = floors[floors.length - 1];
  const bot = floors[0];
  if (!top || !bot) return;
  const y1 = floorY(bot.level, 0) + ISO.slab;
  const y0 = floorY(top.level, 1) - ISO.wallH;
  pix.rect(ISO.stairX, y0, ISO.x0 - ISO.stairX - 2, y1 - y0, RGB.stair);
  pix.line(ISO.stairX, y0, ISO.stairX, y1, RGB.ice);
  pix.line(ISO.x0 - 2, y0, ISO.x0 - 2, y1, RGB.ice);
  pix.line(ISO.stairX, y0, ISO.x0 - 2, y0, RGB.ice);

  for (const floor of floors) {
    const yb = floorY(floor.level, 0);
    const yt = yb - ISO.pitch + 8;
    const xL = ISO.stairX + 4;
    const xR = ISO.x0 - 8;
    const mid = (xL + xR) / 2;
    const steps = 4;
    const sh = (yb - yt) / steps;
    for (let i = 0; i < steps; i++) {
      const y = yb - i * sh;
      const left = i % 2 === 0;
      pix.hline(y | 0, left ? xL : mid, left ? mid : xR, RGB.ice);
      pix.line(mid, y, mid, y - sh, RGB.deep);
    }
  }
  addSeg([
    [ISO.stairX + 2, y1],
    [ISO.stairX + 2, y0],
  ]);
}

function drawRoof(
  pix: Pix,
  atlas: Atlas,
  topLevel: number,
  addSeg: (pts: (readonly [number, number])[]) => void,
): { sign: Built['sign']; antennaX: number; antennaY: number } {
  const g = roofFor(topLevel);
  const flx = roofX(g, 0, 0);
  const frx = roofX(g, 1, 0);
  const blx = roofX(g, 0, 1);
  const brx = roofX(g, 1, 1);
  const fy = roofY(g, 0);
  const by = roofY(g, 1);
  pix.trap(by, fy, blx, brx, flx, frx, RGB.floor);
  pix.line(flx, fy, frx, fy, RGB.ice);
  pix.line(blx, by, brx, by, RGB.ice);
  pix.line(flx, fy, blx, by, RGB.ice);
  pix.line(frx, fy, brx, by, RGB.ice);
  for (let i = 1; i < 8; i++) {
    const u = i / 8;
    pix.line(roofX(g, u, 0), fy - 3, roofX(g, u, 0), fy, RGB.iceDim);
  }

  place(pix, atlas, 'hvac', roofX(g, 0.78, 0.62), roofY(g, 0.62), 0, 0);
  place(pix, atlas, 'hvac', roofX(g, 0.62, 0.35), roofY(g, 0.35), 0, 0);

  const ax = roofX(g, 0.12, 0.75) | 0;
  const ay = (roofY(g, 0.75) - 16) | 0;
  pix.line(ax, ay + 16, ax, ay, RGB.ice);
  pix.line(ax - 4, ay + 3, ax + 4, ay + 3, RGB.ice);
  pix.line(ax, ay, ax + 8, ay + 4, RGB.deep);

  const logo = atlas.frames.logo;
  const lw = logo?.w ?? 80;
  const lh = logo?.h ?? 14;
  const tx = roofX(g, 0.42, 0.7);
  const ty = roofY(g, 0.7) - 8;
  const sign = {
    x: (tx - lw / 2 - 6) | 0,
    y: (ty - lh - 6) | 0,
    w: (lw + 12) | 0,
    h: (lh + 10) | 0,
    tx: tx | 0,
    ty: ty | 0,
  };
  pix.rect(sign.x, sign.y, sign.w, sign.h, RGB.hole);
  pix.line(sign.x, sign.y, sign.x + sign.w, sign.y, RGB.ice);
  pix.line(sign.x, sign.y + sign.h, sign.x + sign.w, sign.y + sign.h, RGB.ice);
  pix.line(sign.x, sign.y, sign.x, sign.y + sign.h, RGB.ice);
  pix.line(sign.x + sign.w, sign.y, sign.x + sign.w, sign.y + sign.h, RGB.ice);
  pix.line(sign.x + 8, sign.y + sign.h, sign.x + 8, sign.y + sign.h + 6, RGB.ice);
  pix.line(sign.x + sign.w - 8, sign.y + sign.h, sign.x + sign.w - 8, sign.y + sign.h + 6, RGB.ice);
  if (logo) {
    const ice = atlas.frames.logoIce;
    if (ice) {
      pix.blit(atlas.pix, ice.x, ice.y, ice.w, ice.h, (tx - ice.ax) | 0, (ty - ice.ay) | 0);
    }
    pix.blit(atlas.pix, logo.x, logo.y, logo.w, logo.h, (tx - logo.ax) | 0, (ty - logo.ay) | 0);
  }

  const cable: (readonly [number, number])[] = [
    [ax, ay + 4],
    [roofX(g, 0.4, 0.8), roofY(g, 0.8) - 2],
    [roofX(g, 0.78, 0.62), roofY(g, 0.62) - 8],
  ];
  pix.line(cable[0]?.[0] ?? 0, cable[0]?.[1] ?? 0, cable[1]?.[0] ?? 0, cable[1]?.[1] ?? 0, RGB.deep);
  pix.line(cable[1]?.[0] ?? 0, cable[1]?.[1] ?? 0, cable[2]?.[0] ?? 0, cable[2]?.[1] ?? 0, RGB.deep);
  addSeg(cable);
  addSeg([
    [flx, fy],
    [frx, fy],
    [brx, by],
    [blx, by],
    [flx, fy],
  ]);

  return { sign, antennaX: ax - 1, antennaY: ay };
}

function stampLabels(pix: Pix, floors: readonly FloorConfig[]): void {
  for (const floor of floors) {
    const y = (floorY(floor.level, 0) - 28) | 0;
    stampText(pix, 6, y, floor.label, 2, RGB.ice, 'ui');
    stampText(pix, 6, y + 14, floor.name, 1, RGB.deep, 'ui');
    const lw = textWidth(floor.label, 2, 3);
    pix.hline(y + 6, 8 + lw, ISO.stairX - 2, RGB.iceDim);
  }
}

function place(pix: Pix, atlas: Atlas, name: string, footX: number, footY: number, ox: number, oy: number): Frame | null {
  const frame = atlas.frames[name];
  if (!frame) return null;
  const dx = (footX + ox - frame.ax) | 0;
  const dy = (footY + oy - frame.ay) | 0;
  pix.blit(atlas.pix, frame.x, frame.y, frame.w, frame.h, dx, dy);
  return frame;
}

function furnish(
  pix: Pix,
  atlas: Atlas,
  floor: FloorConfig,
  actors: Actor[],
  screens: Screen[],
  leds: Led[],
  walkerOnRnd: boolean,
): void {
  const kind = floor.kind;
  if (kind === 'lobby') furnishLobby(pix, atlas, floor, actors, screens);
  else if (kind === 'lounge') furnishLounge(pix, atlas, floor, actors);
  else if (kind === 'sales') furnishDesks(pix, atlas, floor, actors, screens, 'phone', false);
  else if (kind === 'it') furnishIt(pix, atlas, floor, actors, screens, leds);
  else if (kind === 'rnd') furnishDesks(pix, atlas, floor, actors, screens, 'type', walkerOnRnd);
  else furnishVacant(pix, atlas, floor);
}

function addActor(actors: Actor[], partial: Omit<Actor, 'frames' | 'frame' | 'acc' | 'frameDir' | 'mode' | 'ySort' | 'override' | 'overrideUntil' | 'bubbleUntil'> & { bubbleUntil?: number }): void {
  const actor: Actor = {
    ...partial,
    mode: partial.home,
    frameDir: partial.dir,
    frames: frameSet(partial.home, partial.dir),
    frame: actors.length % 4,
    acc: (actors.length * 37) % 200,
    ySort: floorY(partial.level, partial.v) + partial.oy,
    override: partial.home,
    overrideUntil: 0,
    bubbleUntil: partial.bubbleUntil ?? 0,
  };
  actors.push(actor);
}

function furnishLobby(pix: Pix, atlas: Atlas, floor: FloorConfig, actors: Actor[], screens: Screen[]): void {
  const level = floor.level;
  place(pix, atlas, 'screen', floorX(0.7, 1), floorY(level, 1) - 2, 0, -2);
  const screenFrame = atlas.frames.screen;
  if (screenFrame) {
    const fx = floorX(0.7, 1);
    const fy = floorY(level, 1) - 4;
    screens.push({
      x: (fx - screenFrame.ax + BIG_SCREEN.x) | 0,
      y: (fy - screenFrame.ay + BIG_SCREEN.y) | 0,
      w: BIG_SCREEN.w,
      h: BIG_SCREEN.h,
      phase: 1,
      level,
      kind: 'billboard',
    });
  }
  place(pix, atlas, 'counter', floorX(0.4, 0.62), floorY(level, 0.62), 0, 0);
  place(pix, atlas, 'pedestal', floorX(0.72, 0.42), floorY(level, 0.42), 0, 0);
  place(pix, atlas, 'pedestal', floorX(0.86, 0.48), floorY(level, 0.48), 0, 0);
  place(pix, atlas, 'plant', floorX(0.1, 0.78), floorY(level, 0.78), 0, 0);
  place(pix, atlas, 'plant', floorX(0.92, 0.7), floorY(level, 0.7), 0, 0);

  const n = floor.people;
  if (n > 0) {
    addActor(actors, {
      level,
      u: 0.4,
      v: 0.5,
      ox: 0,
      oy: -2,
      home: 'chat',
      dir: 1,
      walking: 0,
      u0: 0.4,
      u1: 0.4,
      t: 0,
      dur: 1,
      visitor: 0,
      leg: 0,
      hidden: 0,
      head: 12,
    });
  }
  const loops = Math.max(0, n - 1);
  for (let i = 0; i < loops; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    addActor(actors, {
      level,
      u: 0.2 + i * 0.08,
      v: 0.28,
      ox: 0,
      oy: 0,
      home: 'walk',
      dir,
      walking: 1,
      u0: dir > 0 ? 0.16 : 0.42,
      u1: dir > 0 ? 0.42 : 0.16,
      t: i * 0.45,
      dur: 7000 + i * 800,
      visitor: 1,
      leg: 0,
      hidden: 0,
      head: 14,
    });
  }
  addActor(actors, {
    level,
    u: 0.14,
    v: 0.22,
    ox: 0,
    oy: 0,
    home: 'walk',
    dir: 1,
    walking: 1,
    u0: 0.14,
    u1: 0.46,
    t: 0,
    dur: 5000,
    visitor: 2,
    leg: 0,
    hidden: 1,
    head: 14,
  });
}

function furnishLounge(pix: Pix, atlas: Atlas, floor: FloorConfig, actors: Actor[]): void {
  const level = floor.level;
  place(pix, atlas, 'sofa', floorX(0.28, 0.68), floorY(level, 0.68), 0, 0);
  place(pix, atlas, 'sofa', floorX(0.58, 0.4), floorY(level, 0.4), 0, 0);
  place(pix, atlas, 'coffee', floorX(0.84, 0.74), floorY(level, 0.74), 0, 0);
  place(pix, atlas, 'plant', floorX(0.1, 0.55), floorY(level, 0.55), 0, 0);
  place(pix, atlas, 'crate', floorX(0.7, 0.72), floorY(level, 0.72), 0, 0);

  const slots: { u: number; v: number; mode: Mode; dir: number; oy: number }[] = [
    { u: 0.24, v: 0.6, mode: 'chat', dir: 1, oy: -3 },
    { u: 0.36, v: 0.6, mode: 'chat', dir: -1, oy: -3 },
    { u: 0.52, v: 0.34, mode: 'chat', dir: 1, oy: -3 },
    { u: 0.8, v: 0.64, mode: 'coffee', dir: -1, oy: 0 },
  ];
  for (let i = 0; i < floor.people && i < slots.length; i++) {
    const slot = slots[i];
    if (!slot) continue;
    addActor(actors, {
      level,
      u: slot.u,
      v: slot.v,
      ox: 0,
      oy: slot.oy,
      home: slot.mode,
      dir: slot.dir,
      walking: 0,
      u0: slot.u,
      u1: slot.u,
      t: 0,
      dur: 1,
      visitor: 0,
      leg: 0,
      hidden: 0,
      head: 14,
    });
  }
}

function deskSpots(count: number): { u: number; v: number }[] {
  const cols = Math.min(6, Math.max(1, count));
  const rows = Math.ceil(count / cols);
  const out: { u: number; v: number }[] = [];
  let n = 0;
  for (let r = 0; r < rows; r++) {
    const v = 0.74 - r * 0.3;
    const rowCount = Math.min(cols, count - n);
    for (let c = 0; c < rowCount; c++) {
      const u = 0.12 + ((c + 0.5) * 0.76) / rowCount + (r % 2 ? 0.03 : 0);
      out.push({ u, v });
      n++;
    }
  }
  return out;
}

function furnishDesks(
  pix: Pix,
  atlas: Atlas,
  floor: FloorConfig,
  actors: Actor[],
  screens: Screen[],
  home: 'phone' | 'type',
  walker: boolean = false,
): void {
  const level = floor.level;
  const spots = deskSpots(Math.max(0, floor.stations));
  const desk = atlas.frames.desk;
  spots.forEach((spot, i) => {
    const fx = floorX(spot.u, spot.v);
    const fy = floorY(level, spot.v);
    place(pix, atlas, 'desk', fx, fy, 0, 0);
    if (desk) {
      screens.push({
        x: (fx - desk.ax + DESK_SCREEN.x) | 0,
        y: (fy - desk.ay + DESK_SCREEN.y) | 0,
        w: DESK_SCREEN.w,
        h: DESK_SCREEN.h,
        phase: i * 2 + level,
        level,
        kind: 'code',
      });
    }
  });
  if (home === 'type') {
    place(pix, atlas, 'board', floorX(0.2, 1), floorY(level, 1) - 1, 0, -1);
  }
  place(pix, atlas, 'plant', floorX(0.94, 0.5), floorY(level, 0.5), 0, 0);

  const seated = walker ? Math.max(0, floor.people - 1) : floor.people;
  for (let i = 0; i < seated && i < spots.length; i++) {
    const spot = spots[i];
    if (!spot) continue;
    addActor(actors, {
      level,
      u: spot.u,
      v: spot.v,
      ox: home === 'phone' ? 7 : 1,
      oy: home === 'phone' ? -2 : -4,
      home,
      dir: i % 2 === 0 ? 1 : -1,
      walking: 0,
      u0: spot.u,
      u1: spot.u,
      t: 0,
      dur: 1,
      visitor: 0,
      leg: 0,
      hidden: 0,
      head: home === 'phone' ? 14 : 10,
    });
  }
  if (walker && floor.people > 0) {
    addActor(actors, {
      level,
      u: 0.2,
      v: 0.32,
      ox: 0,
      oy: 0,
      home: 'walk',
      dir: 1,
      walking: 1,
      u0: 0.16,
      u1: 0.78,
      t: 0.2,
      dur: 9000,
      visitor: 1,
      leg: 0,
      hidden: 0,
      head: 14,
    });
  }
}

function furnishIt(pix: Pix, atlas: Atlas, floor: FloorConfig, actors: Actor[], screens: Screen[], leds: Led[]): void {
  const level = floor.level;
  const racks = Math.max(0, floor.racks);
  const rackFrame = atlas.frames.rack;
  for (let i = 0; i < racks; i++) {
    const u = 0.1 + ((i + 0.5) * 0.8) / Math.max(1, racks);
    const v = 0.84;
    const fx = floorX(u, v);
    const fy = floorY(level, v);
    place(pix, atlas, 'rack', fx, fy, 0, 0);
    if (!rackFrame) continue;
    for (const led of RACK_LEDS) {
      leds.push({
        x: (fx - rackFrame.ax + led[0]) | 0,
        y: (fy - rackFrame.ay + led[1]) | 0,
        phase: i * 1.3 + led[1] * 0.4,
      });
    }
  }
  const desk = atlas.frames.desk;
  const cols = Math.max(1, floor.stations);
  for (let i = 0; i < floor.stations; i++) {
    const u = 0.16 + ((i + 0.5) * 0.7) / cols;
    const v = 0.4;
    const fx = floorX(u, v);
    const fy = floorY(level, v);
    place(pix, atlas, 'desk', fx, fy, 0, 0);
    if (!desk) continue;
    screens.push({
      x: (fx - desk.ax + DESK_SCREEN.x) | 0,
      y: (fy - desk.ay + DESK_SCREEN.y) | 0,
      w: DESK_SCREEN.w,
      h: DESK_SCREEN.h,
      phase: i + 4,
      level,
      kind: 'code',
    });
  }
  const seated = Math.max(0, floor.people - 1);
  for (let i = 0; i < seated && i < floor.stations; i++) {
    const u = 0.16 + ((i + 0.5) * 0.7) / cols;
    addActor(actors, {
      level,
      u,
      v: 0.4,
      ox: 1,
      oy: -6,
      home: 'type',
      dir: 1,
      walking: 0,
      u0: u,
      u1: u,
      t: 0,
      dur: 1,
      visitor: 0,
      leg: 0,
      hidden: 0,
      head: 10,
    });
  }
  if (floor.people > 0) {
    addActor(actors, {
      level,
      u: 0.3,
      v: 0.58,
      ox: 0,
      oy: 0,
      home: 'walk',
      dir: 1,
      walking: 1,
      u0: 0.16,
      u1: 0.72,
      t: 0.35,
      dur: 8000,
      visitor: 1,
      leg: 0,
      hidden: 0,
      head: 14,
    });
  }
}

function furnishVacant(pix: Pix, atlas: Atlas, floor: FloorConfig): void {
  const level = floor.level;
  const cones = [0.22, 0.42, 0.66, 0.84];
  const pts: { x: number; y: number }[] = [];
  for (const u of cones) {
    const x = floorX(u, 0.42);
    const y = floorY(level, 0.42);
    place(pix, atlas, 'cone', x, y, 0, 0);
    pts.push({ x, y: y - 4 });
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    pix.dashed(a.x, a.y, b.x, b.y, RGB.white, 2, 2);
    pix.dashed(a.x, a.y + 1, b.x, b.y + 1, RGB.deep, 2, 2);
  }
  place(pix, atlas, 'crate', floorX(0.16, 0.72), floorY(level, 0.72), 0, 0);
  place(pix, atlas, 'crate', floorX(0.24, 0.76), floorY(level, 0.76), 0, 2);
  const bx = floorX(0.55, 0.68);
  const by = floorY(level, 0.68);
  const text = 'COMING SOON';
  const tw = textWidth(text, 1, 3);
  const bw = tw + 8;
  const bh = 16;
  const x = (bx - bw / 2) | 0;
  const y = (by - bh - 4) | 0;
  pix.rect(x, y, bw, bh, RGB.hole);
  pix.line(x, y, x + bw, y, RGB.white);
  pix.line(x, y + bh, x + bw, y + bh, RGB.white);
  pix.line(x, y, x, y + bh, RGB.ice);
  pix.line(x + bw, y, x + bw, y + bh, RGB.ice);
  stampText(pix, x + 4, y + 5, text, 1, RGB.white, 'ui');
  pix.line(x + 4, by, x + 4, y + bh, RGB.ice);
  pix.line(x + bw - 4, by, x + bw - 4, y + bh, RGB.ice);
}

function drawSign(ctx: CanvasRenderingContext2D, atlas: Atlas, sign: Built['sign'], now: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.003);
  ctx.fillStyle = '#071018';
  ctx.fillRect(sign.x, sign.y, sign.w, sign.h);
  ctx.fillStyle = pulse > 0.65 ? '#FFFFFF' : '#7FDBFF';
  ctx.fillRect(sign.x, sign.y, sign.w, 1);
  ctx.fillRect(sign.x, sign.y + sign.h - 1, sign.w, 1);
  ctx.fillRect(sign.x, sign.y, 1, sign.h);
  ctx.fillRect(sign.x + sign.w - 1, sign.y, 1, sign.h);
  const logo = atlas.frames.logo;
  if (!logo) return;
  if (pulse > 0.45) {
    const ice = atlas.frames.logoIce;
    if (ice) {
      ctx.globalAlpha = 0.35 + pulse * 0.4;
      blit(ctx, atlas, ice, (sign.tx - ice.ax - 1) | 0, (sign.ty - ice.ay) | 0);
      blit(ctx, atlas, ice, (sign.tx - ice.ax + 1) | 0, (sign.ty - ice.ay) | 0);
      ctx.globalAlpha = 1;
    }
  }
  blit(ctx, atlas, logo, (sign.tx - logo.ax) | 0, (sign.ty - logo.ay) | 0);
}
