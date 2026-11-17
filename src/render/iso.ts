/** Shallow isometric cutaway. Front and back edges are horizontal so floors stack. */
export const ISO = {
  x0: 88,
  floorW: 292,
  skew: 40,
  depth: 28,
  pitch: 52,
  slab: 5,
  wallH: 36,
  side: 16,
  frontY1: 444,
  stairX: 48,
};

export function floorX(u: number, v: number): number {
  return ISO.x0 + u * ISO.floorW + v * ISO.skew;
}

export function floorY(level: number, v: number): number {
  return ISO.frontY1 - (level - 1) * ISO.pitch - v * ISO.depth;
}

export interface RoofGeom {
  frontY: number;
  x0: number;
  w: number;
  skew: number;
  depth: number;
}

export function roofFor(topLevel: number): RoofGeom {
  const backY = floorY(topLevel, 1);
  return {
    frontY: backY - ISO.wallH + 12,
    x0: ISO.x0 + 6,
    w: ISO.floorW - 10,
    skew: ISO.skew - 6,
    depth: 20,
  };
}

export function roofX(g: RoofGeom, u: number, v: number): number {
  return g.x0 + u * g.w + v * g.skew;
}

export function roofY(g: RoofGeom, v: number): number {
  return g.frontY - v * g.depth;
}
