import './style.css';
import {
  BURN_IN_FAST_MS,
  BURN_IN_INTERVAL_MS,
  BURN_IN_PATH,
  EVENT_MAX_MS,
  EVENT_MIN_MS,
  EVENT_TTL_MS,
  VIEW,
} from './config/display.ts';
import { floors } from './config/floors.ts';
import { createMockEventSource } from './events/source.ts';
import type { OfficeEventType } from './events/source.ts';
import { createPlate } from './render/plate.ts';
import type { PlateView } from './render/plate.ts';

const params = new URLSearchParams(location.search);
if (params.get('kiosk') === '1') document.body.classList.add('kiosk');

const hourParam = params.get('hour');
const forcedHour = hourParam !== null && hourParam !== '' ? Number(hourParam) : -1;

const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('missing #app');

const renderer = params.get('renderer');
const debug = params.get('debug') === '1';

const office: PlateView =
  renderer === '3d'
    ? await (await import('./render/office3d.ts')).createOffice(floors)
    : renderer === 'plate'
      ? createPlate(floors, { debug })
      : await (await import('./render/tile/engine.ts')).createTileFloor(floors, { debug });

function suzhouHour(now = Date.now()): number {
  if (forcedHour >= 0 && forcedHour <= 23) return forcedHour;
  let h = (Math.floor(now / 3_600_000) + 8) % 24;
  if (h < 0) h += 24;
  return h;
}

office.setHour(suzhouHour());
window.setInterval(() => office.setHour(suzhouHour()), 60_000);

const demo = params.get('demo') === '1';
const source = createMockEventSource({
  minMs: demo ? 8_000 : EVENT_MIN_MS,
  maxMs: demo ? 14_000 : EVENT_MAX_MS,
  ttlMs: EVENT_TTL_MS,
  firstMs: demo ? 9_000 : undefined,
  levelsFor: (type) => office.levelsFor(type),
});

if (demo) {
  const seq: OfficeEventType[] = ['visitorArrived', 'dealClosed', 'deploySuccess'];
  for (let i = 0; i < seq.length; i++) {
    const type = seq[i];
    if (!type) continue;
    window.setTimeout(() => {
      const levels = office.levelsFor(type);
      const level = levels[i % Math.max(1, levels.length)] ?? levels[0];
      if (!level) return;
      office.push({ type, level, ttlMs: EVENT_TTL_MS, at: performance.now() });
    }, 1200 + i * 2200);
  }
}
source.start((event) => office.push(event));

function fit(): void {
  const side = Math.min(window.innerWidth, window.innerHeight);
  const tile = 360;
  const px =
    renderer === 'plate'
      ? Math.max(1, side)
      : renderer === '3d'
        ? Math.max(VIEW, VIEW * Math.max(1, Math.floor(side / VIEW)))
        : Math.max(tile, tile * Math.max(1, Math.floor(side / tile)));
  office.resize(px);
  office.el.style.width = `${px}px`;
  office.el.style.height = `${px}px`;
}

let drift = 0;
const driftEvery = params.get('burn') === 'fast' ? BURN_IN_FAST_MS : BURN_IN_INTERVAL_MS;
window.setInterval(() => {
  drift = (drift + 1) % BURN_IN_PATH.length;
  const offset = BURN_IN_PATH[drift] ?? [0, 0];
  office.el.style.transform = `translate(${offset[0]}px, ${offset[1]}px)`;
}, driftEvery);

office.canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  window.location.reload();
});

appRoot.appendChild(office.el);
fit();
window.addEventListener('resize', fit);

if (params.get('kiosk') === '1') {
  window.addEventListener('contextmenu', (event) => event.preventDefault());
}

let last = performance.now();
let acc = 0;
const frame = (now: number) => {
  let dt = now - last;
  last = now;
  if (dt > 50) dt = 50;
  acc += dt;
  if (acc >= 1000 / 30) {
    const step = acc;
    acc = 0;
    office.update(step / 1000, now);
  }
  requestAnimationFrame(frame);
};
office.update(1 / 30, performance.now());
requestAnimationFrame(frame);
