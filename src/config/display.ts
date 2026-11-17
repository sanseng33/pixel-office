/** Logical pixel resolution. The canvas is integer-scaled up to the window. */
export const VIEW = 480;

/** Near-black lobby surround. Also the letterbox color. */
export const BG = '#060910';

export const BURN_IN_INTERVAL_MS = 15 * 60 * 1000;
export const BURN_IN_FAST_MS = 3000;

/** Integer pixel offsets, each within ±2, cycled to wander static UI off the same panel pixels. */
export const BURN_IN_PATH: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [2, 1],
  [1, 2],
  [0, 2],
  [-1, 2],
  [-2, 1],
  [-2, 0],
  [-2, -1],
  [-1, -2],
  [0, -2],
  [1, -2],
  [2, -1],
  [2, 0],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [2, -2],
];

export const EVENT_MIN_MS = 10_000;
export const EVENT_MAX_MS = 30_000;
export const EVENT_TTL_MS = 5_500;

export const RGB = {
  bg: [6, 9, 16, 255] as const,
  floor: [7, 12, 20, 255] as const,
  wall: [8, 16, 28, 255] as const,
  lip: [10, 22, 36, 255] as const,
  stair: [6, 11, 18, 255] as const,
  hole: [4, 7, 12, 255] as const,
  ice: [127, 219, 255, 255] as const,
  iceDim: [127, 219, 255, 90] as const,
  deep: [46, 155, 255, 255] as const,
  bright: [191, 244, 255, 255] as const,
  white: [255, 255, 255, 255] as const,
};
