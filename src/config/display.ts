/** Logical pixel resolution. 540 scales ×2 to 1080 and ×4 to 2160. */
export const VIEW = 540;

/** Page letterbox and canvas clear. Must match engine NAVY 0x071422. */
export const BG = '#071422';

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
  floor: [8, 14, 24, 255] as const,
  floorAlt: [10, 18, 30, 255] as const,
  side: [12, 28, 46, 255] as const,
  hole: [4, 7, 12, 255] as const,
  ice: [127, 219, 255, 255] as const,
  iceDim: [127, 219, 255, 56] as const,
  iceFaint: [127, 219, 255, 28] as const,
  deep: [46, 155, 255, 255] as const,
  bright: [191, 244, 255, 255] as const,
  white: [255, 255, 255, 255] as const,
};
