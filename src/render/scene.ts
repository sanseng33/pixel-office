import { RGB, VIEW } from '../config/display.ts';
import type { FloorConfig, FloorType } from '../config/floors.ts';
import type { OfficeEvent, OfficeEventType } from '../events/source.ts';
import { stampText } from './font.ts';
import { HH, HW, MIN_SUM, PITCH, SLAB, TD, TW, inRoom, inView, sx, sy } from './iso.ts';
import type { RGBA } from './pixel.ts';
import { Pix } from './pixel.ts';
import { SCREEN_OF, buildAtlas, type Atlas, type Frame } from './sprites.ts';

type State = 'sit' | 'phone' | 'walk' | 'chat' | 'swing' | 'cheer' | 'idle';

interface Actor {
  level: number;
  tx: number;
  ty: number;
  sprite: string;
  kind: number;
  state: State;
  home: State;
  dir: number;
  frame: number;
  acc: number;
  timer: number;
  nx: number;
  ny: number;
  moving: number;
  role: number;
  homeX: number;
  homeY: number;
  hidden: number;
  bubble: number;
  seed: number;
  lift: number;
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
const MOTE = ['rgba(127,219,255,0.45)', 'rgba(191,244,255,0.6)', 'rgba(127,219,255,0.75)'];

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function fillTile(pix: Pix, x: number, y: number, level: number, color: RGBA): void {
  const px = sx(x, y);
  const py = sy(x, y, level);
  for (let row = 0; row <= HH * 2; row++) {
    const dist = row <= HH ? row : HH * 2 - row;
    const half = (dist / HH) * HW;
    const yy = Math.round(py + row);
    pix.hline(yy, Math.round(px - half), Math.round(px + half), color);
  }
}

function dropEdge(pix: Pix, x0: number, y0: number, x1: number, y1: number): void {
  const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    pix.line(x, y, x, y + SLAB, RGB.side);
  }
  pix.line(x0, y0, x1, y1, RGB.bright);
  pix.line(x0, y0 + SLAB, x1, y1 + SLAB, RGB.ice);
}

function edgeDown(pix: Pix, ax: number, ay: number, bx: number, by: number): void {
  dropEdge(pix, ax, ay, bx, by);
}

function toPulse(pts: number[], speed: number, phase: number): Pulse {
  const n = pts.length >> 1;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i * 2] ?? 0;
    ys[i] = pts[i * 2 + 1] ?? 0;
    if (i) dist[i] = (dist[i - 1] ?? 0) + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
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

function personSprite(a: Actor): string {
  const flip = a.dir < 0 ? 'F' : '';
  if (a.state === 'cheer') return 'cheer';
  if (a.state === 'walk') return `w${a.frame % 3}${flip}`;
  if (a.state === 'phone') return `p${a.frame % 2}${flip}`;
  if (a.state === 'chat') return `c${a.frame % 2}${flip}`;
  if (a.state === 'swing') return `g${a.frame % 2}${flip}`;
  if (a.state === 'idle') return `w0${flip}`;
  return `s${a.frame % 2}${flip}`;
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
  const bg = bakeBg();
  const roofs = bakeRoof(pulses);
  const shells = new Map<number, HTMLCanvasElement>();
  for (const cfg of floors) shells.set(cfg.level, bakeFloor(cfg, pulses));

  const actors: Actor[] = [];
  const byLevel: Actor[][] = [];
  for (let i = 0; i < 8; i++) byLevel.push([]);
  const add = (a: Actor) => {
    actors.push(a);
    byLevel[a.level]?.push(a);
  };
  for (const cfg of floors) layout(cfg, add);
  const order = byLevel.map((list) => Int16Array.from(list.map((_, i) => i)));

  const motes = Array.from({ length: 18 }, (_, i) => ({
    x: 8 + ((i * 97) % (VIEW - 16)),
    y: 10 + ((i * 53) % (VIEW - 20)),
    speed: 6 + (i % 5) * 3,
    style: i % MOTE.length,
  }));
  const bits: Bit[] = Array.from({ length: 14 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1 }));
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
  let carT = 0.2;
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
      bit.vx = Math.cos(ang) * 24;
      bit.vy = Math.sin(ang) * 16 - 6;
      bit.life = 720;
      bit.max = 720;
      n += 1;
      if (n >= 10) break;
    }
  }
  function showBanner(frame: string, x: number, y: number, now: number, ttl: number): void {
    const slot = banners.find((b) => !b.on) ?? banners[0];
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
    const list = byLevel[level] ?? [];
    if (type === 'dealClosed') {
      const who = list.find((a) => a.kind === 1 && a.home === 'phone');
      if (who) {
        who.state = 'cheer';
        who.timer = ttl;
        burst(sx(who.tx, who.ty), sy(who.tx, who.ty, level) - 12);
      }
      showBanner('tDEAL', sx(8, 8), sy(8, 8, level) - 16, now, ttl);
    } else if (type === 'deploySuccess') {
      showBanner('tDEPLOY', sx(8, 7), sy(8, 7, level) - 16, now, ttl);
      burst(sx(8, 7), sy(8, 7, level));
    } else {
      doorUntil = now + ttl;
      const visitor = list.find((a) => a.role === 2);
      if (visitor) {
        visitor.hidden = 0;
        visitor.tx = TW - 3;
        visitor.ty = TD - 3;
        visitor.nx = 6;
        visitor.ny = TD - 5;
        visitor.moving = 1;
        visitor.state = 'walk';
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
    update(dt) {
      while (qt !== qh) {
        const item = queue[qt];
        if (item?.level) apply(item.type, item.level, item.ttl, performance.now());
        qt = (qt + 1) % queue.length;
      }
      const sec = dt * 0.001;
      carT += sec * carDir * 0.18;
      if (carT > 1) {
        carT = 1;
        carDir = -1;
      } else if (carT < 0) {
        carT = 0;
        carDir = 1;
      }
      for (const a of actors) {
        if (a.kind !== 1 || a.hidden) continue;
        a.acc += dt;
        const pace = a.state === 'walk' || a.state === 'swing' ? 130 : 260;
        if (a.acc >= pace) {
          a.acc = 0;
          a.frame += 1;
        }
        if (a.moving || a.state === 'walk') {
          const dx = a.nx - a.tx;
          const dy = a.ny - a.ty;
          const dist = Math.hypot(dx, dy);
          if (dist < 0.06) {
            a.tx = a.nx;
            a.ty = a.ny;
            if (a.home === 'walk' || a.role === 2) {
              const swap = a.nx;
              a.nx = a.homeX;
              a.ny = a.homeY;
              a.homeX = swap;
              a.homeY = a.ty;
              a.dir = a.nx >= a.tx ? 1 : -1;
            } else {
              a.moving = 0;
              a.state = a.home;
              a.tx = a.homeX;
              a.ty = a.homeY;
              a.timer = 800 + (a.seed % 1400);
            }
          } else {
            const step = Math.min(1.7 * sec, dist);
            a.tx += (dx / dist) * step;
            a.ty += (dy / dist) * step;
            a.dir = dx - dy >= 0 ? 1 : -1;
            a.state = 'walk';
          }
        } else if (a.state !== 'swing' && a.state !== 'cheer') {
          a.timer -= dt;
          if (a.timer > 0) continue;
          a.seed = nextSeed(a.seed || 1);
          const r = (a.seed % 1000) / 1000;
          if (a.home === 'sit' || a.home === 'phone' || a.home === 'chat') {
            if (r < 0.55) {
              a.state = a.home;
              a.timer = 1200 + r * 2000;
            } else if (r < 0.75) {
              a.state = 'idle';
              a.timer = 640;
            } else if (inRoom(a.homeX + 2, a.homeY)) {
              a.nx = a.homeX + 2;
              a.ny = a.homeY;
              a.moving = 1;
              a.state = 'walk';
            } else a.timer = 900;
          }
        }
      }
      for (const p of pulses) {
        p.head += p.speed * sec;
        if (p.head >= p.total) p.head -= p.total;
      }
      for (const m of motes) {
        m.y -= m.speed * sec;
        if (m.y < 4) m.y = VIEW - 6;
      }
      for (const b of bits) {
        if (b.life <= 0) continue;
        b.life -= dt;
        b.x += b.vx * sec;
        b.y += b.vy * sec;
      }
    },
    draw(ctx, now) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bg, 0, 0);
      let style = '';
      for (const m of motes) {
        if (m.x > 70 && m.x < VIEW - 50 && m.y > 40 && m.y < VIEW - 20) continue;
        const fill = MOTE[m.style] ?? MOTE[0];
        if (fill !== style) {
          ctx.fillStyle = fill ?? '#7FDBFF';
          style = fill ?? '';
        }
        ctx.fillRect(m.x | 0, m.y | 0, 2, 2);
      }
      for (const cfg of floors) {
        const shell = shells.get(cfg.level);
        if (shell) ctx.drawImage(shell, 0, 0);
      }
      ctx.drawImage(roofs, 0, 0);
      drawSign(ctx, atlas, now);
      for (let li = floors.length - 1; li >= 0; li--) {
        const cfg = floors[li];
        if (!cfg) continue;
        const list = byLevel[cfg.level] ?? [];
        const idx = order[cfg.level];
        if (!idx) continue;
        const n = list.length;
        for (let i = 1; i < n; i++) {
          const id = idx[i] ?? 0;
          const key = (list[id]?.tx ?? 0) + (list[id]?.ty ?? 0);
          let j = i - 1;
          while (j >= 0 && (list[idx[j] ?? 0]?.tx ?? 0) + (list[idx[j] ?? 0]?.ty ?? 0) > key) {
            idx[j + 1] = idx[j] ?? 0;
            j -= 1;
          }
          idx[j + 1] = id;
        }
        const hot = now < hotUntil[cfg.level];
        for (let k = 0; k < n; k++) {
          const a = list[idx[k] ?? 0];
          if (!a || a.hidden) continue;
          const footX = sx(a.tx + 0.5, a.ty + 0.5);
          const footY = sy(a.tx + 0.5, a.ty + 0.5, cfg.level) - a.lift;
          if (a.sprite === 'rack') {
            drawRack(ctx, footX, footY, now, a.tx + a.ty);
            continue;
          }
          const name = a.kind === 1 ? personSprite(a) : a.sprite;
          const frame = atlas.frames[name];
          if (!frame) continue;
          const bob = a.state === 'walk' && a.frame % 2 ? -1 : 0;
          blit(ctx, atlas, frame, footX, footY + bob);
          if (a.kind === 0) paintScreen(ctx, a.sprite, frame, footX, footY, now, hot, cfg.level);
          if (a.sprite === 'gong' && hot) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect((footX - 4) | 0, (footY - 16) | 0, 8, 8);
          }
          if (a.kind === 1 && a.bubble && a.state !== 'walk' && a.state !== 'cheer') {
            const bub = atlas.frames[a.frame % 2 ? 'bubble2' : 'bubble'];
            if (bub) blit(ctx, atlas, bub, footX, footY - frame.h - 1);
          }
        }
      }
      const cols = ['#FFFFFF', '#BFF4FF', '#7FDBFF', '#2E9BFF'];
      for (let t = 0; t < 4; t++) {
        ctx.fillStyle = cols[t] ?? '#7FDBFF';
        const size = t === 0 ? 3 : 2;
        for (const p of pulses) {
          sample(p, p.head - t * 8);
          ctx.fillRect(p.x | 0, p.y | 0, size, size);
        }
      }
      drawCar(ctx, carT);
      ctx.fillStyle = '#FFFFFF';
      for (const b of bits) {
        if (b.life <= 0) continue;
        ctx.globalAlpha = Math.max(0, b.life / b.max);
        ctx.fillRect(b.x | 0, b.y | 0, 2, 2);
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
        blit(ctx, atlas, frame, item.x, item.y - (1 - life) * 10);
        ctx.globalAlpha = 1;
      }
      if (now < doorUntil) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(sx(TW - 3, TD - 3) | 0, (sy(TW - 3, TD - 3, 1) - 4) | 0, 6, 3);
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

function paintScreen(
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
    ctx.fillStyle = hot ? '#FFFFFF' : '#05080E';
    ctx.fillRect(x, y, spot.w, spot.h);
    if (hot) continue;
    ctx.fillStyle = '#FFFFFF';
    if (sprite === 'screen') {
      const tick = (now / 280 + salt) | 0;
      for (let i = 0; i < 5; i++) {
        const bh = 1 + ((tick + i) % Math.max(1, spot.h - 1));
        ctx.fillRect(x + 2 + i * 3, y + spot.h - bh, 2, bh);
      }
    } else {
      const mask = CODE[(((now / 150) | 0) + salt) % CODE.length] ?? 0;
      for (let c = 0; c < spot.w; c++) if (mask & (1 << (c % 6))) ctx.fillRect(x + c, y + (c % spot.h), 1, 1);
    }
  }
}

function drawRack(ctx: CanvasRenderingContext2D, cx: number, base: number, now: number, salt: number): void {
  const h = 30;
  const hw = 9;
  const hh = 3;
  const top = base - h;
  ctx.fillStyle = '#0c2034';
  ctx.fillRect((cx - hw) | 0, (top + hh) | 0, hw * 2, h - hh);
  ctx.fillStyle = '#7FDBFF';
  ctx.fillRect((cx - hw) | 0, (top + hh) | 0, 1, h - hh);
  ctx.fillRect((cx + hw - 1) | 0, (top + hh) | 0, 1, h - hh);
  for (let row = 0; row <= hh * 2; row++) {
    const dist = row <= hh ? row : hh * 2 - row;
    const half = (dist / hh) * hw;
    ctx.fillStyle = '#14344e';
    ctx.fillRect((cx - half) | 0, (top + row) | 0, Math.max(1, (half * 2) | 0), 1);
    ctx.fillStyle = '#7FDBFF';
    ctx.fillRect((cx - half) | 0, (top + row) | 0, 1, 1);
    ctx.fillRect((cx + half) | 0, (top + row) | 0, 1, 1);
  }
  for (let i = 0; i < 7; i++) {
    const on = Math.sin(now * 0.009 + salt + i * 0.7) > -0.1;
    ctx.fillStyle = on ? (i % 3 === 0 ? '#FFFFFF' : '#BFF4FF') : '#2E9BFF';
    ctx.fillRect((cx - 4) | 0, (base - 8 - i * 3) | 0, 2, 2);
    ctx.fillRect((cx + 2) | 0, (base - 8 - i * 3) | 0, 2, 2);
  }
}

function drawCar(ctx: CanvasRenderingContext2D, t: number): void {
  const x = sx(TW - 2, 2);
  const y1 = sy(TW - 2, 2, 1);
  const y7 = sy(TW - 2, 2, 7);
  const y = y1 + (y7 - y1) * t;
  ctx.fillStyle = '#07131f';
  ctx.fillRect((x - 8) | 0, (y - 18) | 0, 16, 20);
  ctx.fillStyle = '#7FDBFF';
  ctx.fillRect((x - 8) | 0, (y - 18) | 0, 16, 1);
  ctx.fillRect((x - 8) | 0, (y + 1) | 0, 16, 1);
  ctx.fillRect((x - 8) | 0, (y - 18) | 0, 1, 20);
  ctx.fillRect((x + 7) | 0, (y - 18) | 0, 1, 20);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect((x - 2) | 0, (y - 8) | 0, 2, 2);
}

function drawSign(ctx: CanvasRenderingContext2D, atlas: Atlas, now: number): void {
  const logo = atlas.frames.logo;
  if (!logo) return;
  const base = sy(5, 5, 7) - (PITCH - SLAB);
  const cx = sx(5.2, 5.2);
  const w = logo.w + 14;
  const h = logo.h + 10;
  const x = (cx - w / 2) | 0;
  const y = (base - h) | 0;
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.003);
  ctx.fillStyle = '#071018';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = pulse > 0.55 ? '#FFFFFF' : '#7FDBFF';
  ctx.fillRect(x, y, w, 2);
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillRect(x, y, 2, h);
  ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillRect((cx - 10) | 0, y + h, 2, 8);
  ctx.fillRect((cx + 8) | 0, y + h, 2, 8);
  blit(ctx, atlas, logo, cx, y + h - 3);
}

function layout(cfg: FloorConfig, add: (a: Actor) => void): void {
  const level = cfg.level;
  const used = new Uint8Array(TW * TD);
  const prop = (x: number, y: number, sprite: string, lift = 0) => {
    if (!inView(Math.round(x), Math.round(y))) return;
    used[y * TW + x] = 1;
    add({
      level,
      tx: x,
      ty: y,
      sprite,
      kind: 0,
      state: 'idle',
      home: 'idle',
      dir: 1,
      frame: 0,
      acc: 0,
      timer: 0,
      nx: x,
      ny: y,
      moving: 0,
      role: 0,
      homeX: x,
      homeY: y,
      hidden: 0,
      bubble: 0,
      seed: 1,
      lift,
    });
  };
  const person = (x: number, y: number, home: State, dir: number, role: number, seed: number): Actor => {
    const actor: Actor = {
      level,
      tx: x,
      ty: y,
      sprite: '',
      kind: 1,
      state: home,
      home,
      dir,
      frame: seed & 1,
      acc: (seed * 40) % 200,
      timer: 500 + (seed % 1600),
      nx: x,
      ny: y,
      moving: 0,
      role,
      homeX: x,
      homeY: y,
      hidden: 0,
      bubble: home === 'phone' || home === 'chat' ? 1 : 0,
      seed,
      lift: 0,
    };
    add(actor);
    return actor;
  };

  if (cfg.type === 'vacant') {
    prop(6, 8, 'cone');
    prop(8, 7, 'cone');
    prop(10, 6, 'cone');
    prop(5, 6, 'box');
    prop(9, 9, 'box');
    return;
  }
  if (cfg.type === 'lobby') {
    prop(6, 7, 'bar');
    prop(7, 5, 'screen', 8);
    prop(5, 8, 'plant');
    prop(8, 6, 'plant');
    prop(6, 6, 'plant');
    person(6.4, 7.2, 'sit', 1, 0, 4);
    for (let i = 0; i < cfg.people; i++) {
      const px = 8 + (i % 3);
      const py = 9 - (i % 2);
      const visitor = person(px, py, 'walk', i % 2 ? -1 : 1, 2, 30 + i);
      visitor.homeX = 5;
      visitor.homeY = 8;
      visitor.nx = 10;
      visitor.ny = 6;
      visitor.moving = 1;
    }
    return;
  }
  if (cfg.type === 'lounge') {
    prop(5, 7, 'sofa');
    prop(6, 6, 'pong');
    prop(8, 5, 'bar');
    prop(8, 6, 'stool');
    prop(9, 5, 'stool');
    prop(4, 8, 'plant');
    prop(9, 6, 'plant');
    person(6.2, 6.4, 'swing', 1, 3, 8);
    person(8.2, 6.6, 'swing', -1, 3, 9);
    person(9.3, 5.3, 'chat', 1, 3, 10);
    person(10.6, 5.2, 'chat', -1, 3, 11);
    person(4.6, 7.2, 'chat', 1, 3, 12);
    person(5.8, 7.4, 'chat', -1, 3, 13);
    return;
  }

  const seats: { x: number; y: number }[] = [];
  const limitX = cfg.type === 'it' ? 8 : TW - 2;
  for (let y = 2; y < TD - 1 && seats.length < cfg.stations; y += 2) {
    for (let x = 2; x < limitX && seats.length < cfg.stations; x += 2) {
      if (!inRoom(x, y)) continue;
      if (used[y * TW + x]) continue;
      const sprite = cfg.type === 'it' ? 'dual' : 'desk';
      prop(x, y, sprite);
      seats.push({ x, y });
    }
  }
  if (cfg.type === 'it') {
    prop(8, 5, 'rack');
    prop(9, 4, 'rack');
    prop(7, 6, 'rack');
    prop(9, 5, 'rack');
    prop(6, 6, 'screen', 6);
    person(8.2, 6.2, 'idle', -1, 1, 50);
    person(9.1, 6.4, 'idle', 1, 1, 51);
  } else if (cfg.type === 'sales') {
    prop(5, 7, 'screen', 10);
    prop(8, 5, 'gong');
  } else {
    prop(5, 8, 'board', 8);
    if (level === 7) {
      prop(8, 5, 'bench');
      prop(9, 4, 'bench');
    }
    prop(9, 6, 'plant');
  }
  const occupied = Math.round(seats.length * cfg.occupancy);
  for (let i = 0; i < occupied; i++) {
    const s = seats[i];
    if (!s) continue;
    const phone = cfg.type === 'sales';
    person(s.x + 0.15, s.y + 0.55, phone ? 'phone' : 'sit', i % 2 ? -1 : 1, phone ? 4 : 0, 80 + level * 17 + i);
  }
  for (let i = 0; i < cfg.people; i++) {
    const walker = {
      level,
      tx: 4 + i,
      ty: 8,
      sprite: '',
      kind: 1,
      state: 'walk' as State,
      home: 'walk' as State,
      dir: 1,
      frame: 0,
      acc: 0,
      timer: 0,
      nx: 8,
      ny: 6,
      moving: 1,
      role: 1,
      homeX: 4,
      homeY: 8,
      hidden: 0,
      bubble: 0,
      seed: 90 + i,
      lift: 0,
    };
    add(walker);
  }
}

function bakeBg(): HTMLCanvasElement {
  const pix = new Pix(VIEW, VIEW);
  pix.rect(0, 0, VIEW, VIEW, RGB.bg);
  for (let i = 20; i < VIEW; i += 20) {
    const c = i % 80 === 0 ? ([127, 219, 255, 32] as const) : ([127, 219, 255, 12] as const);
    pix.hline(i, 0, VIEW - 1, c);
    for (let y = 0; y < VIEW; y += 2) pix.px(i, y, c);
  }
  const stars = [24, 18, 40, 70, 18, 200, 36, 420, 500, 30, 516, 120, 508, 300, 490, 460];
  for (let i = 0; i < stars.length; i += 2) pix.px(stars[i] ?? 0, stars[i + 1] ?? 0, RGB.bright);
  return pix.toCanvas();
}

function bakeFloor(cfg: FloorConfig, pulses: Pulse[]): HTMLCanvasElement {
  const pix = new Pix(VIEW, VIEW);
  const level = cfg.level;
  for (let y = 0; y < TD; y++) {
    for (let x = 0; x < TW; x++) {
      if (!inRoom(x, y) || cfg.type === 'vacant') continue;
      fillTile(pix, x, y, level, (x + y) & 1 ? RGB.floor : RGB.floorAlt);
    }
  }
  for (let y = 0; y < TD; y++) {
    for (let x = 0; x < TW; x++) {
      if (!inRoom(x, y)) continue;
      const outline = (ax: number, ay: number, bx: number, by: number, open: boolean) => {
        if (cfg.type === 'vacant') pix.dashed(ax, ay, bx, by, RGB.white, 3, 3);
        else if (open) edgeDown(pix, ax, ay, bx, by);
        else pix.line(ax, ay, bx, by, RGB.iceFaint);
      };
      const cutX = x + 1 < TW && y >= 0 && x + 1 >= TW - 5 && y >= TD - 4;
      const cutY = y + 1 < TD && x >= TW - 5 && y + 1 >= TD - 4;
      const rimX = x + 1 === TW;
      const rimY = y + 1 === TD;
      outline(sx(x + 1, y), sy(x + 1, y, level), sx(x + 1, y + 1), sy(x + 1, y + 1, level), cutX || rimX);
      outline(sx(x, y + 1), sy(x, y + 1, level), sx(x + 1, y + 1), sy(x + 1, y + 1, level), cutY || rimY);
      pix.line(sx(x, y), sy(x, y, level), sx(x + 1, y), sy(x + 1, y, level), RGB.iceFaint);
      pix.line(sx(x, y), sy(x, y, level), sx(x, y + 1), sy(x, y + 1, level), RGB.iceFaint);
    }
  }
  glassWall(pix, level, true);
  glassWall(pix, level, false);
  stairs(pix, level);
  const label = findLabelTile();
  if (label) {
    const x = sx(label.x, label.y) - 8;
    const y = sy(label.x, label.y, level) - 26;
    stampText(pix, x | 0, y | 0, cfg.label, 2, RGB.white, 'ui');
    stampText(pix, x | 0, (y + 12) | 0, cfg.name, 1, RGB.ice, 'ui');
  }
  if (cfg.type === 'vacant') {
    stampText(pix, (sx(7, 7) - 24) | 0, (sy(7, 7, level) - 8) | 0, 'VACANT', 2, RGB.white, 'ui');
  }
  // current along the two outer walls
  const left = wallPoints(level, true);
  const right = wallPoints(level, false);
  if (left.length > 2) pulses.push(toPulse(left, 30 + level * 3, (level * 0.2) % 1));
  if (right.length > 2) pulses.push(toPulse(right, 34, (level * 0.45) % 1));
  branch(pix, level);
  return pix.toCanvas();
}

function findLabelTile(): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  for (let y = 0; y < TD; y++) {
    for (let x = 0; x < TW; x++) {
      if (!inRoom(x, y)) continue;
      if (!best || x < best.x || (x === best.x && y > best.y)) best = { x, y };
    }
  }
  return best;
}

function wallPoints(level: number, left: boolean): number[] {
  const pts: number[] = [];
  const lip = level >= 7 ? -999 : sy(TW - 1, TD - 1, level + 1);
  if (left) {
    for (let y = 0; y <= TD; y++) {
      const x = sx(0, y);
      const yv = sy(0, y, level);
      if (yv < lip + 8) continue;
      pts.push(x, yv);
    }
  } else {
    for (let x = 0; x <= TW; x++) {
      const xv = sx(x, 0);
      const yv = sy(x, 0, level);
      if (yv < lip + 8) continue;
      pts.push(xv, yv);
    }
  }
  return pts;
}

function glassWall(pix: Pix, level: number, left: boolean): void {
  const pts = wallPoints(level, left);
  const h = Math.min(28, PITCH - SLAB - 8);
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x = pts[i] ?? 0;
    const y = pts[i + 1] ?? 0;
    const x2 = pts[i + 2] ?? x;
    const y2 = pts[i + 3] ?? y;
    pix.line(x, y, x2, y2, RGB.ice);
    pix.line(x, y - h, x2, y2 - h, RGB.ice);
    pix.line(x, y - h * 0.5, x2, y2 - h * 0.5, RGB.iceFaint);
    if ((i / 2) % 2 === 0) pix.line(x, y, x, y - h, RGB.iceDim);
  }
}

function stairs(pix: Pix, level: number): void {
  // Steps climb the left-back edge, inside the footprint.
  for (let s = 0; s < 4; s++) {
    const y = TD - 2 - s;
    const x = 1 + (s % 2);
    if (y < 0) continue;
    const x0 = sx(x, y);
    const y0 = sy(x, y, level);
    const x1 = sx(x + 0.8, y + 0.2);
    const y1 = sy(x + 0.8, y + 0.2, level);
    pix.line(x0, y0, x1, y1, RGB.ice);
    pix.line(x0, y0, x0, y0 - 4, RGB.bright);
  }
}

function branch(pix: Pix, level: number): void {
  const x = sx(2, TD - 3);
  const y = sy(2, TD - 3, level) - 10;
  pix.line(x, y, x + 10, y - 8, RGB.deep);
  pix.line(x + 10, y - 8, x + 6, y - 16, RGB.bright);
  pix.line(x + 10, y - 8, x + 18, y - 6, RGB.deep);
}

function bakeRoof(pulses: Pulse[]): HTMLCanvasElement {
  const pix = new Pix(VIEW, VIEW);
  const level = 7;
  const lift = PITCH - SLAB;
  for (let y = 0; y < TD; y++) {
    for (let x = 0; x < TW; x++) {
      if (x + y < MIN_SUM - 3) continue;
      if (x >= TW - 3 && y >= TD - 3) continue;
      const px = sx(x, y);
      const py = sy(x, y, level) - lift;
      for (let row = 0; row <= HH * 2; row++) {
        const dist = row <= HH ? row : HH * 2 - row;
        const half = (dist / HH) * HW;
        pix.hline(Math.round(py + row), Math.round(px - half), Math.round(px + half), (x + y) & 1 ? RGB.floorAlt : RGB.floor);
      }
    }
  }
  // parapet
  for (let i = 0; i <= TW; i++) {
    const x = sx(i, 2);
    const y = sy(i, 2, level) - lift;
    pix.line(x, y, x, y - 5, RGB.ice);
  }
  for (let i = 0; i <= TD; i++) {
    const x = sx(2, i);
    const y = sy(2, i, level) - lift;
    pix.line(x, y, x, y - 5, RGB.ice);
  }
  // hvac boxes
  boxAt(pix, 9, 4, level, lift, 16);
  boxAt(pix, 11, 3, level, lift, 14);
  // antenna
  const ax = sx(4, 4);
  const ay = sy(4, 4, level) - lift;
  pix.line(ax, ay, ax, ay - 18, RGB.ice);
  pix.line(ax - 5, ay - 14, ax + 6, ay - 18, RGB.bright);
  pix.px(ax | 0, (ay - 18) | 0, RGB.white);
  const ridge: number[] = [];
  for (let i = 0; i <= TW; i++) ridge.push(sx(i, 1), sy(i, 1, level) - lift - 5);
  pulses.push(toPulse(ridge, 40, 0.15));
  const ridge2: number[] = [];
  for (let i = 0; i <= TD; i++) ridge2.push(sx(1, i), sy(1, i, level) - lift - 5);
  pulses.push(toPulse(ridge2, 36, 0.55));
  // columns at the two side corners, full height of the stack
  const corners: readonly (readonly [number, number])[] = [
    [0, TD - 1],
    [TW - 1, 0],
  ];
  for (const c of corners) {
    const x = sx(c[0], c[1]);
    const yTop = sy(c[0], c[1], 7) - lift;
    const yBot = sy(c[0], c[1], 1) + SLAB;
    pix.line(x, yTop, x, yBot, RGB.ice);
    pix.line(x + 1, yTop, x + 1, yBot, RGB.deep);
    const col: number[] = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const yy = yBot + (yTop - yBot) * t;
      const j = (i % 5) - 2;
      col.push(x + j, yy);
    }
    pulses.push(toPulse(col, 42, c[0] === 0 ? 0.1 : 0.6));
  }
  return pix.toCanvas();
}

function boxAt(pix: Pix, x: number, y: number, level: number, lift: number, h: number): void {
  const cx = sx(x + 0.5, y + 0.5);
  const base = sy(x + 0.5, y + 0.5, level) - lift;
  const top = base - h;
  pix.rect(cx - 10, top + 4, 20, h - 4, RGB.side);
  pix.line(cx - 10, top + 4, cx - 10, base, RGB.ice);
  pix.line(cx + 10, top + 4, cx + 10, base, RGB.ice);
  for (let row = 0; row <= 6; row++) {
    const dist = row <= 3 ? row : 6 - row;
    const half = (dist / 3) * 10;
    pix.hline(Math.round(top + row), Math.round(cx - half), Math.round(cx + half), RGB.floorAlt);
  }
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

void HW;
void HH;
