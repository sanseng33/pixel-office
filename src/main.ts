import './style.css';
import {
  BURN_IN_FAST_MS,
  BURN_IN_INTERVAL_MS,
  BURN_IN_PATH,
  EVENT_MAX_MS,
  EVENT_MIN_MS,
  EVENT_TTL_MS,
} from './config/display.ts';
import { introFor } from './config/floorIntros.ts';
import { floors } from './config/floors.ts';
import { createMockEventSource } from './events/source.ts';
import type { OfficeEventType } from './events/source.ts';
import { createHoverCtrl, cssToLogical, feedHover, routeGuideLine } from './render/tile/floorHit.ts';
import { createPlate } from './render/plate.ts';
import type { PlateView } from './render/plate.ts';

const params = new URLSearchParams(location.search);
if (params.get('kiosk') === '1') document.body.classList.add('kiosk');

const hourParam = params.get('hour');
const forcedHour = hourParam !== null && hourParam !== '' ? Number(hourParam) : -1;

const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('missing #app');
const host = appRoot;

const renderer = params.get('renderer');
const debug = params.get('debug') === '1';

const floorParam = params.get('floor');
const focus = floorParam ? Number(floorParam) : 0;

const office: PlateView =
  renderer === '3d'
    ? await (await import('./render/office3d.ts')).createOffice(floors)
    : renderer === 'plate'
      ? createPlate(floors, { debug })
      : await (await import('./render/tile/engine.ts')).createTileFloor(floors, { debug, focus });

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
  // Contain-fit the logical canvas into #app. The stacked building stays
  // 600 tall (640 wide); typical desktops keep the same display height as
  // the previous 600 square because scale is height-limited. plate/3d stay square.
  const availW = Math.max(1, Math.floor(host.clientWidth || window.innerWidth));
  const availH = Math.max(1, Math.floor(host.clientHeight || window.innerHeight));
  if (renderer === 'plate' || renderer === '3d') {
    const side = Math.max(1, Math.min(availW, availH));
    office.resize(side);
    office.el.style.width = `${side}px`;
    office.el.style.height = `${side}px`;
    return;
  }
  office.resize(availW, availH);
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
setupFloorHover();

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

function setupFloorHover(): void {
  if (!office.hitFloor || !office.setHoveredFloor || !office.floorGuideAnchor || !office.logicalSize) return;

  const overlay = document.createElement('div');
  overlay.id = 'floor-hover';
  overlay.innerHTML = `
    <svg aria-hidden="true">
      <polyline class="guide-line" points="" />
      <circle class="guide-dot" r="2.5" cx="0" cy="0" />
    </svg>
    <article class="card" hidden>
      <div class="card-kicker"></div>
      <div class="card-title"></div>
      <p class="card-body"></p>
    </article>
  `;
  host.appendChild(overlay);
  const card = overlay.querySelector('.card') as HTMLElement;
  const kicker = overlay.querySelector('.card-kicker') as HTMLElement;
  const title = overlay.querySelector('.card-title') as HTMLElement;
  const body = overlay.querySelector('.card-body') as HTMLElement;
  const line = overlay.querySelector('.guide-line') as SVGPolylineElement;
  const dot = overlay.querySelector('.guide-dot') as SVGCircleElement;

  let ctrl = createHoverCtrl();
  let shownCard = 0;

  const fillCard = (level: number): void => {
    const intro = introFor(level);
    if (!intro) return;
    kicker.textContent = `${intro.label}  ·  ${intro.name}`;
    title.textContent = intro.title;
    body.textContent = intro.body;
    shownCard = level;
  };

  const layoutOverlay = (level: number): void => {
    const size = office.logicalSize!();
    const anchor = office.floorGuideAnchor!(level);
    if (!anchor) return;
    const cr = office.canvas.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const scaleX = cr.width / size.width;
    const scaleY = cr.height / size.height;
    const ax = cr.left - hr.left + anchor.x * scaleX;
    const ay = cr.top - hr.top + anchor.y * scaleY;
    const labelLeft = cr.left - hr.left + Math.min(anchor.labelX, 16) * scaleX;
    const gutter = cr.left - hr.left;
    const topGutter = cr.top - hr.top;
    const pad = 12;
    const limit = Math.min(labelLeft - 8, gutter - 6);
    let width = Math.min(260, Math.max(140, gutter - pad * 2));
    let left = pad;
    let top = pad;
    if (gutter >= 148) {
      if (left + width > limit) width = Math.max(120, limit - left);
      card.style.width = `${Math.round(width)}px`;
      const height = card.offsetHeight || 120;
      top = Math.max(pad, Math.min(ay - height / 2, hr.height - height - pad));
    } else if (topGutter >= 88) {
      width = Math.min(280, Math.max(160, hr.width - pad * 2));
      card.style.width = `${Math.round(width)}px`;
      top = Math.max(pad, Math.min(pad, topGutter - pad - (card.offsetHeight || 80)));
    } else {
      width = Math.max(110, Math.min(width, Math.max(96, limit - pad)));
      card.style.width = `${Math.round(width)}px`;
      const height = card.offsetHeight || 120;
      top = Math.max(pad, Math.min(ay - height / 2, hr.height - height - pad));
    }
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
    const x1 = left + width;
    const y1 = top + Math.min(card.offsetHeight || 36, 36);
    const toHost = (x: number, y: number) => ({
      x: cr.left - hr.left + x * scaleX,
      y: cr.top - hr.top + y * scaleY,
    });
    const labels = (anchor.labels ?? [{ level, x: anchor.labelX, y: anchor.labelY, w: anchor.labelW ?? 0, h: anchor.labelH ?? 10 }]).map((box) => {
      const p = toHost(box.x, box.y);
      return { x: p.x, y: p.y, w: box.w * scaleX, h: box.h * scaleY };
    });
    const dest = { x: ax, y: ay };
    const lipX = cr.left - hr.left + (anchor.lipX ?? anchor.x) * scaleX;
    const pts = routeGuideLine({ x: x1, y: y1 }, dest, labels, { lipX });
    line.setAttribute('points', pts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' '));
    line.style.display = '';
    line.style.visibility = '';
    line.style.opacity = '';
    const tip = pts[pts.length - 1] ?? dest;
    dot.setAttribute('cx', String(Math.round(tip.x)));
    dot.setAttribute('cy', String(Math.round(tip.y)));
    dot.style.display = '';
    dot.style.visibility = '';
    dot.style.opacity = '';
  };

  const hideGuide = (): void => {
    line.setAttribute('points', '');
    line.style.display = 'none';
    line.style.visibility = 'hidden';
    line.style.opacity = '0';
    line.removeAttribute('x1');
    line.removeAttribute('y1');
    line.removeAttribute('x2');
    line.removeAttribute('y2');
    dot.setAttribute('cx', '0');
    dot.setAttribute('cy', '0');
    dot.style.display = 'none';
    dot.style.visibility = 'hidden';
    dot.style.opacity = '0';
  };

  const apply = (): void => {
    office.setHoveredFloor!(ctrl.lit);
    if (ctrl.card > 0) {
      if (shownCard !== ctrl.card) fillCard(ctrl.card);
      card.hidden = false;
      overlay.classList.add('is-on');
      layoutOverlay(ctrl.card);
    } else {
      overlay.classList.remove('is-on');
      card.hidden = true;
      hideGuide();
      shownCard = 0;
    }
  };

  const feed = (hit: number, now = performance.now()): void => {
    const next = feedHover(ctrl, hit, now);
    if (
      next.hit === ctrl.hit &&
      next.lit === ctrl.lit &&
      next.card === ctrl.card &&
      next.hideAt === ctrl.hideAt
    ) {
      if (next.card > 0) layoutOverlay(next.card);
      return;
    }
    ctrl = next;
    apply();
  };

  const pointerToHit = (event: PointerEvent): number => {
    const size = office.logicalSize!();
    const logical = cssToLogical(event.clientX, event.clientY, office.canvas.getBoundingClientRect(), size.width, size.height);
    if (!logical) return 0;
    return office.hitFloor!(logical.x, logical.y);
  };

  hideGuide();

  window.addEventListener('pointermove', (event) => feed(pointerToHit(event)), { passive: true });
  window.addEventListener('pointerleave', () => feed(0), { passive: true });
  document.addEventListener('mouseleave', () => feed(0));
  window.addEventListener('resize', () => {
    if (ctrl.card > 0) layoutOverlay(ctrl.card);
  });
  const tick = (): void => {
    if (ctrl.hideAt !== 0 || (ctrl.hit !== 0 && ctrl.card !== ctrl.hit)) feed(ctrl.hit);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

