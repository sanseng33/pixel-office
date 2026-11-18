import { VIEW } from '../config/display.ts';

/**
 * Strict 2:1 dimetric, seen from the front corner.
 *   sx = OX + (x - y) * 16
 *   sy = OY + (x + y) * 8 - (level - 1) * PITCH
 * The plan is 10×10 tiles. Each slab is a real rhombus; the storey above
 * covers only the far tip, so both receding walls and the near interior stay
 * in frame. A pure stack of seven *wide* rhombi cannot also fill the width of
 * a square — at 2:1 the block is about half as wide as the canvas.
 */
export const HW = 16;
export const HH = 8;
export const TW = 10;
export const TD = 10;
export const PITCH = 64;
export const SLAB = 5;
export const HEAD = 14;
export const OX = 270;
export const OY = 386;

export const SMAX = TW + TD - 2;
export const VIS_STEPS = Math.floor((PITCH - HEAD) / HH);
export const MIN_SUM = SMAX - VIS_STEPS;

export function sx(x: number, y: number): number {
  return OX + (x - y) * HW;
}

export function sy(x: number, y: number, level: number): number {
  return OY + (x + y) * HH - (level - 1) * PITCH;
}

/** Floor tiles. The near corner is cut so the opening is an L. */
export function inRoom(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= TW || y >= TD) return false;
  if (x >= TW - 3 && y >= TD - 3) return false;
  return true;
}

/** Tiles in front of the slab above — safe for people and furniture. */
export function inView(x: number, y: number): boolean {
  return inRoom(x, y) && x + y >= MIN_SUM;
}

export const WORLD = VIEW;
