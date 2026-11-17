import { Application, Sprite, Texture } from 'pixi.js';
import './style.css';
import {
  BURN_IN_FAST_MS,
  BURN_IN_INTERVAL_MS,
  BURN_IN_PATH,
  BG,
  EVENT_MAX_MS,
  EVENT_MIN_MS,
  EVENT_TTL_MS,
  VIEW,
} from './config/display.ts';
import { floors } from './config/floors.ts';
import { createMockEventSource } from './events/source.ts';
import type { OfficeEventType } from './events/source.ts';
import { createScene, setForcedHour } from './render/scene.ts';

const params = new URLSearchParams(location.search);
if (params.get('kiosk') === '1') document.body.classList.add('kiosk');

const hourParam = params.get('hour');
if (hourParam !== null && hourParam !== '') {
  const hour = Number(hourParam);
  if (hour >= 0 && hour <= 23) setForcedHour(hour);
}

const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('missing #app');

const pixelCanvas = document.createElement('canvas');
pixelCanvas.width = VIEW;
pixelCanvas.height = VIEW;
const pixelCtx = pixelCanvas.getContext('2d', { alpha: false });
if (!pixelCtx) throw new Error('2d context unavailable');
pixelCtx.imageSmoothingEnabled = false;
const ctx: CanvasRenderingContext2D = pixelCtx;

const scene = createScene(floors);
const bootNow = performance.now();
scene.update(16, bootNow);
scene.draw(ctx, bootNow);

const demo = params.get('demo') === '1';
const source = createMockEventSource({
  minMs: demo ? 8_000 : EVENT_MIN_MS,
  maxMs: demo ? 14_000 : EVENT_MAX_MS,
  ttlMs: EVENT_TTL_MS,
  firstMs: demo ? 9_000 : undefined,
  levelsFor: (type) => scene.levelsFor(type),
});

if (demo) {
  const seq: OfficeEventType[] = ['visitorArrived', 'dealClosed', 'deploySuccess'];
  for (let i = 0; i < seq.length; i++) {
    const type = seq[i];
    if (!type) continue;
    window.setTimeout(() => {
      const levels = scene.levelsFor(type);
      const level = levels[i % Math.max(1, levels.length)] ?? levels[0];
      if (!level) return;
      scene.push({ type, level, ttlMs: EVENT_TTL_MS, at: performance.now() });
    }, 1200 + i * 2200);
  }
}

source.start((event) => scene.push(event));

function fit(el: HTMLCanvasElement): void {
  const side = Math.min(window.innerWidth, window.innerHeight);
  const scale = Math.max(1, Math.floor(side / VIEW));
  const px = `${VIEW * scale}px`;
  el.style.width = px;
  el.style.height = px;
}

function startBurnIn(el: HTMLCanvasElement): void {
  let step = 0;
  const interval = params.get('burn') === 'fast' ? BURN_IN_FAST_MS : BURN_IN_INTERVAL_MS;
  window.setInterval(() => {
    step = (step + 1) % BURN_IN_PATH.length;
    const offset = BURN_IN_PATH[step] ?? [0, 0];
    el.style.transform = `translate(${offset[0]}px, ${offset[1]}px)`;
  }, interval);
}

function watchContextLoss(canvas: HTMLCanvasElement): void {
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    window.location.reload();
  });
}

const mount = async (): Promise<void> => {
  try {
    const app = new Application();
    await app.init({
      width: VIEW,
      height: VIEW,
      background: BG,
      antialias: false,
      resolution: 1,
      autoDensity: false,
      roundPixels: true,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    const texture = Texture.from(pixelCanvas);
    texture.source.scaleMode = 'nearest';
    texture.source.autoGenerateMipmaps = false;
    const sprite = new Sprite(texture);
    app.stage.addChild(sprite);
    app.ticker.add((ticker) => {
      const dt = ticker.deltaMS > 100 ? 100 : ticker.deltaMS;
      scene.update(dt, ticker.lastTime);
      scene.draw(ctx, ticker.lastTime);
      texture.source.update();
    });
    appRoot.appendChild(app.canvas);
    fit(app.canvas);
    startBurnIn(app.canvas);
    watchContextLoss(app.canvas);
    window.addEventListener('resize', () => fit(app.canvas));
  } catch (error) {
    console.error(error);
    appRoot.appendChild(pixelCanvas);
    fit(pixelCanvas);
    startBurnIn(pixelCanvas);
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      scene.update(dt, now);
      scene.draw(ctx, now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.addEventListener('resize', () => fit(pixelCanvas));
  }
};

if (params.get('kiosk') === '1') {
  window.addEventListener('contextmenu', (event) => event.preventDefault());
}

mount().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'failed to start';
  appRoot.innerHTML = `<p id="boot-error">像素公司无法启动：${message}</p>`;
});
