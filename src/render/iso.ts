import { VIEW } from '../config/display.ts';

/**
 * Dollhouse cutaway. The floor grid uses 2:1 steps (a step back is +2px across
 * and -1px up, scaled by the tile), but each storey is only a few tiles deep.
 * Wall height is the vertical distance between slabs, so the floor above sits
 * on the ceiling and does not cover the people below.
 *
 * A pure 2:1 diamond of a wide floor is half as tall as it is wide, and seven
 * of those cannot stack in a square without hiding each other (the v2 plates).
 * This is the Project Highrise / Tiny Tower compromise: iso floor grid, full
 * storey height, camera-facing wall removed.
 */
export const FLOOR_X = 68;
export const FLOOR_W = 378;
export const SKEW = 52;
export const DEPTH = 30;
export const PITCH = 66;
export const SLAB = 6;
export const STAIR_X = 16;
export const FRONT_1 = VIEW - 10;

export function frontY(level: number): number {
  return FRONT_1 - (level - 1) * PITCH;
}

export function fx(u: number, v: number): number {
  return FLOOR_X + u * FLOOR_W + v * SKEW;
}

export function fy(level: number, v: number): number {
  return frontY(level) - v * DEPTH;
}
