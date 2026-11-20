/** Screen-space elevator motion in floor units (1F=1 … 7F=7). Pure step for tests. */
export const ELEV_MIN = 1;
export const ELEV_MAX = 7;
export const ELEV_VMAX = 1.55;
export const ELEV_ACCEL = 2.4;
export const ELEV_WAIT_MIN = 1.6;
export const ELEV_WAIT_SPAN = 2.8;

export type ElevPhase = 'idle' | 'moving';

export interface Elevator {
  floor: number;
  target: number;
  y: number;
  v: number;
  phase: ElevPhase;
  wait: number;
  seed: number;
}

export function createElevator(seed = 20261119, startFloor = 1): Elevator {
  const floor = Math.min(ELEV_MAX, Math.max(ELEV_MIN, startFloor));
  return {
    floor,
    target: floor,
    y: floor,
    v: 0,
    phase: 'idle',
    wait: 1.8,
    seed: seed >>> 0,
  };
}

function rng(e: Elevator): number {
  e.seed = (Math.imul(e.seed, 1664525) + 1013904223) >>> 0;
  return e.seed / 4294967296;
}

function pickTarget(e: Elevator): number {
  const k = Math.floor(rng(e) * (ELEV_MAX - ELEV_MIN));
  const floor = k + ELEV_MIN;
  return floor >= e.floor ? floor + 1 : floor;
}

export function stepElevator(e: Elevator, dt: number): void {
  const step = Math.max(0, Math.min(0.05, dt));
  if (step <= 0) return;
  if (e.phase === 'idle') {
    e.v = 0;
    e.y = e.floor;
    e.wait -= step;
    if (e.wait > 0) return;
    e.target = pickTarget(e);
    e.phase = 'moving';
    return;
  }
  const dest = e.target;
  let dir = Math.sign(dest - e.y);
  if (dir === 0) dir = Math.sign(dest - e.floor);
  if (dir === 0) {
    e.y = dest;
    e.v = 0;
    e.floor = dest;
    e.phase = 'idle';
    e.wait = ELEV_WAIT_MIN + rng(e) * ELEV_WAIT_SPAN;
    return;
  }
  const remaining = dest - e.y;
  const brakeDist = (e.v * e.v) / (2 * ELEV_ACCEL);
  const going = e.v * dir > 0;
  const shouldBrake = Math.abs(remaining) <= brakeDist + 1e-9 && going;
  const acc = ELEV_ACCEL * dir;
  if (shouldBrake) {
    e.v -= acc * step;
    if (e.v * dir <= 0) e.v = 0;
  } else if (Math.abs(e.v) < ELEV_VMAX) {
    e.v += acc * step;
    if (e.v * dir > ELEV_VMAX) e.v = dir * ELEV_VMAX;
  } else {
    e.v = dir * ELEV_VMAX;
  }
  const next = e.y + e.v * step;
  if ((dir > 0 && next >= dest) || (dir < 0 && next <= dest)) {
    e.y = dest;
    e.v = 0;
    e.floor = dest;
    e.phase = 'idle';
    e.wait = ELEV_WAIT_MIN + rng(e) * ELEV_WAIT_SPAN;
    return;
  }
  e.y = Math.min(ELEV_MAX, Math.max(ELEV_MIN, next));
  if ((e.y === ELEV_MAX && dir > 0) || (e.y === ELEV_MIN && dir < 0)) {
    e.v = 0;
    e.floor = e.y;
    e.target = e.y;
    e.phase = 'idle';
    e.wait = ELEV_WAIT_MIN + rng(e) * ELEV_WAIT_SPAN;
  }
}
