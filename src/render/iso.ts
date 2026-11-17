import { VIEW } from '../config/display.ts';

/**
 * True 2:1 dimetric projection (45° isometric pixel art).
 * screenX = (x - y) * HW
 * screenY = (x + y) * HH - (level - 1) * PITCH
 * One step in x or y moves HW pixels across and HH pixels down, HW = 2 * HH.
 */
export const HW = 8;
export const HH = 4;
export const COLS = 20;
export const ROWS = 10;
export const PITCH = 64;
export const SLAB = 4;

export const ORIGIN_X = 268;
export const ORIGIN_Y = 392;

export function screenX(tx: number, ty: number): number {
  return ORIGIN_X + (tx - ty) * HW;
}

export function screenY(tx: number, ty: number, level: number): number {
  return ORIGIN_Y + (tx + ty) * HH - (level - 1) * PITCH;
}

/** A tile is covered when the floor above overlaps it. Top floor is fully visible. */
export function tileVisible(tx: number, ty: number, level: number, top: number): boolean {
  if (level >= top) return true;
  const cy = screenY(tx + 0.5, ty + 0.5, level);
  const lip = screenY(COLS, ROWS, level + 1) + SLAB + 1;
  return cy >= lip;
}

export function inBounds(tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS;
}

export const WORLD_W = VIEW;
export const WORLD_H = VIEW;
