/**
 * 楼层配置。`type` 决定这一层画哪些小道具。
 * `polygon` 是底图（1024×1024）上该层可走的 L 形楼板，单位是底图像素。
 * `origin` + `axisU` / `axisV` 是贴着底图地板网格的等距坐标。
 * 1F 在最底。坐标是对照 public/assets/bg-shell.jpg（无闪电的壳体）量的，?debug=1 可以核对。
 */
export type FloorType = 'lobby' | 'lounge' | 'sales' | 'it' | 'rnd' | 'vacant';

export interface Vec2 {
  x: number;
  y: number;
}

export interface FloorConfig {
  level: number;
  type: FloorType;
  label: string;
  name: string;
  title: string;
  /** 办公层工位上限。实际只放得进楼板的那些。 */
  stations: number;
  occupancy: number;
  people: number;
  polygon: readonly Vec2[];
  origin: Vec2;
  axisU: Vec2;
  axisV: Vec2;
  /** 左墙楼层名的锚点。 */
  labelAt: Vec2;
  /** 楼板前缘亮线，电流沿着它走。 */
  edges: readonly (readonly Vec2[])[];
  /** 楼板正面的遮挡带。内容画完后用底图盖回去。 */
  mask: readonly Vec2[];
}

/**
 * 每层可见楼板的前缘（顶面和正面的交线），从下往上 1F 到 7F。
 * 点是顺着底图亮边量的。
 */
const LIPS: Record<number, readonly Vec2[]> = {
  1: [
    { x: 220, y: 892 },
    { x: 310, y: 935 },
    { x: 400, y: 979 },
    { x: 490, y: 1013 },
    { x: 590, y: 968 },
    { x: 680, y: 934 },
    { x: 770, y: 890 },
    { x: 860, y: 846 },
  ],
  2: [
    { x: 220, y: 788 },
    { x: 310, y: 829 },
    { x: 400, y: 871 },
    { x: 490, y: 854 },
    { x: 590, y: 852 },
    { x: 680, y: 835 },
    { x: 770, y: 793 },
    { x: 860, y: 751 },
  ],
  3: [
    { x: 220, y: 689 },
    { x: 280, y: 716 },
    { x: 350, y: 748 },
    { x: 410, y: 776 },
    { x: 470, y: 752 },
    { x: 530, y: 726 },
    { x: 600, y: 743 },
    { x: 660, y: 710 },
    { x: 735, y: 691 },
    { x: 810, y: 658 },
    { x: 860, y: 640 },
  ],
  4: [
    { x: 220, y: 588 },
    { x: 310, y: 626 },
    { x: 400, y: 658 },
    { x: 490, y: 620 },
    { x: 590, y: 619 },
    { x: 680, y: 627 },
    { x: 770, y: 588 },
    { x: 860, y: 551 },
  ],
  5: [
    { x: 220, y: 485 },
    { x: 310, y: 523 },
    { x: 400, y: 553 },
    { x: 490, y: 516 },
    { x: 590, y: 512 },
    { x: 680, y: 520 },
    { x: 770, y: 483 },
    { x: 860, y: 446 },
  ],
  6: [
    { x: 220, y: 385 },
    { x: 310, y: 420 },
    { x: 400, y: 450 },
    { x: 490, y: 415 },
    { x: 590, y: 411 },
    { x: 680, y: 417 },
    { x: 770, y: 382 },
    { x: 860, y: 346 },
  ],
  7: [
    { x: 220, y: 273 },
    { x: 310, y: 307 },
    { x: 400, y: 317 },
    { x: 490, y: 287 },
    { x: 590, y: 283 },
    { x: 680, y: 303 },
    { x: 770, y: 268 },
    { x: 860, y: 234 },
  ],
};

export function lipAt(lip: readonly Vec2[], x: number): number {
  for (let i = 0; i < lip.length - 1; i++) {
    const a = lip[i];
    const b = lip[i + 1];
    if (!a || !b) continue;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    if (x < minX || x > maxX) continue;
    const span = b.x - a.x || 1;
    return a.y + ((b.y - a.y) * (x - a.x)) / span;
  }
  const last = lip[lip.length - 1];
  return last?.y ?? 0;
}

/** 沿楼板前缘的一步。v 朝观众，单独用 y。 */
const AXIS_U = { x: 52, y: 0 };

function tileBand(lip: readonly Vec2[]): Vec2[] {
  const front = lip.map((p) => ({ x: p.x, y: p.y - 12 }));
  const back = [...lip].reverse().map((p) => ({ x: p.x + 4, y: p.y - 50 }));
  return [...front, ...back];
}

function lipMask(lip: readonly Vec2[]): Vec2[] {
  const face = lip.map((p) => ({ x: p.x, y: p.y + 14 }));
  return [...face, ...[...lip].reverse()];
}

function plateOf(level: number): Pick<FloorConfig, 'polygon' | 'origin' | 'axisU' | 'axisV' | 'labelAt' | 'edges' | 'mask'> {
  const lip = LIPS[level] ?? LIPS[4] ?? [];
  const y = lipAt(lip, 250);
  return {
    polygon: tileBand(lip),
    origin: { x: 300, y: lipAt(lip, 300) - 22 },
    axisU: AXIS_U,
    axisV: { x: 0, y: 22 },
    labelAt: { x: 96, y: y - 32 },
    edges: [lip],
    mask: lipMask(lip),
  };
}

function floor(
  partial: Omit<FloorConfig, 'polygon' | 'origin' | 'axisU' | 'axisV' | 'labelAt' | 'edges' | 'mask'>,
): FloorConfig {
  return { ...partial, ...plateOf(partial.level) };
}

export const floors: readonly FloorConfig[] = [
  floor({
    level: 1,
    type: 'lobby',
    label: '1F',
    name: '大厅&展厅',
    title: '大厅&展厅',
    stations: 1,
    occupancy: 1,
    people: 3,
  }),
  floor({
    level: 2,
    type: 'lounge',
    label: '2F',
    name: '休息区',
    title: '休息区',
    stations: 0,
    occupancy: 0,
    people: 4,
  }),
  floor({
    level: 3,
    type: 'sales',
    label: '3F',
    name: '国内事业部',
    title: '国内事业部',
    stations: 24,
    occupancy: 0.4,
    people: 2,
  }),
  floor({
    level: 4,
    type: 'it',
    label: '4F',
    name: 'IT',
    title: 'IT',
    stations: 24,
    occupancy: 0.4,
    people: 2,
  }),
  floor({
    level: 5,
    type: 'rnd',
    label: '5F',
    name: '综合研发部&运营',
    title: '综合研发部&运营',
    stations: 24,
    occupancy: 0.4,
    people: 2,
  }),
  floor({
    level: 6,
    type: 'vacant',
    label: '6F',
    name: '健身区',
    title: '健身区',
    stations: 24,
    occupancy: 0,
    people: 0,
  }),
  floor({
    level: 7,
    type: 'rnd',
    label: '7F',
    name: '综合研发部&产品',
    title: '综合研发部&产品',
    stations: 24,
    occupancy: 0.4,
    people: 2,
  }),
];

/** 屋顶空白字牌的内框，底图像素。 */
/** Inner dark area of the roof board, with room for padding. */
export const SIGN_BOARD = { x: 338, y: 66, w: 156, h: 52 };

/** 角柱：电流从下往上送。 */
export const COLUMN_LINES: readonly (readonly Vec2[])[] = [
  [
    { x: 170, y: 970 },
    { x: 170, y: 210 },
  ],
  [
    { x: 340, y: 960 },
    { x: 340, y: 260 },
  ],
  [
    { x: 848, y: 930 },
    { x: 848, y: 188 },
  ],
];

/** 屋顶女儿墙外缘，顺着屋面亮边走。 */
export const ROOF_EDGE: readonly Vec2[] = [
  { x: 176, y: 236 },
  { x: 360, y: 198 },
  { x: 560, y: 184 },
  { x: 852, y: 196 },
  { x: 824, y: 242 },
  { x: 500, y: 256 },
  { x: 190, y: 248 },
];

export const PLATE_SRC = `${import.meta.env.BASE_URL}assets/bg-shell.jpg`;
export const PLATE_SIZE = 1024;

export function isoPoint(floorCfg: FloorConfig, u: number, v: number): Vec2 {
  return {
    x: floorCfg.origin.x + u * floorCfg.axisU.x + v * floorCfg.axisV.x,
    y: floorCfg.origin.y + u * floorCfg.axisU.y + v * floorCfg.axisV.y,
  };
}

export function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b || a.y === b.y) continue;
    const hit = (a.y > p.y) !== (b.y > p.y);
    if (hit && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
