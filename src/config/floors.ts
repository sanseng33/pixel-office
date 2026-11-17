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
  /** 楼板外缘折线，电流沿着这些线走。 */
  edges: readonly (readonly Vec2[])[];
}

/** 每层楼板靠近观众的那条前缘（底图像素 y）。往上每层大约 103px。 */
const FRONT_Y: Record<number, number> = {
  1: 946,
  2: 840,
  3: 740,
  4: 636,
  5: 530,
  6: 428,
  7: 326,
};

/**
 * 每层楼板亮边，顺着画出来的折线：左臂前缘、凹口、右臂前缘，直到右侧。
 * 1F–3F 的凹口是单独对着亮线量的。
 */
const EDGES: Record<number, readonly Vec2[]> = {
  1: [
    { x: 220, y: 892 },
    { x: 400, y: 979 },
    { x: 480, y: 1019 },
    { x: 560, y: 995 },
    { x: 700, y: 924 },
    { x: 860, y: 846 },
  ],
  2: [
    { x: 220, y: 788 },
    { x: 430, y: 882 },
    { x: 540, y: 832 },
    { x: 620, y: 864 },
    { x: 740, y: 807 },
    { x: 860, y: 751 },
  ],
  3: [
    { x: 220, y: 676 },
    { x: 420, y: 762 },
    { x: 540, y: 710 },
    { x: 620, y: 726 },
    { x: 740, y: 687 },
    { x: 860, y: 633 },
  ],
  4: [
    { x: 220, y: 575 },
    { x: 390, y: 648 },
    { x: 540, y: 587 },
    { x: 640, y: 628 },
    { x: 860, y: 537 },
  ],
  5: [
    { x: 220, y: 474 },
    { x: 390, y: 545 },
    { x: 540, y: 484 },
    { x: 640, y: 522 },
    { x: 860, y: 446 },
  ],
  6: [
    { x: 220, y: 372 },
    { x: 390, y: 440 },
    { x: 550, y: 382 },
    { x: 640, y: 416 },
    { x: 860, y: 333 },
  ],
  7: [
    { x: 220, y: 286 },
    { x: 370, y: 343 },
    { x: 550, y: 281 },
    { x: 660, y: 323 },
    { x: 860, y: 250 },
  ],
};

function ribbon(edge: readonly Vec2[], frontDy: number, backDy: number): Vec2[] {
  const front = edge.map((p) => ({ x: p.x, y: p.y + frontDy }));
  const back = [...edge].reverse().map((p) => ({ x: p.x, y: p.y - backDy }));
  return [...front, ...back];
}

function legacyPolygon(front: number): Vec2[] {
  const yf = front;
  const yb = front - 86;
  return [
    { x: 246, y: yf - 12 },
    { x: 524, y: yf - 16 },
    { x: 524, y: yf - 16 },
    { x: 820, y: yf - 20 },
    { x: 820, y: yb },
    { x: 246, y: yb },
  ];
}

/** 沿后墙（楼板前缘的方向）和沿侧墙（进深）的两条等距轴。 */
const AXIS_U = { x: 0.934, y: 0.357 };
const AXIS_V = { x: 0.928, y: -0.372 };

function plateOf(level: number, front: number): Pick<FloorConfig, 'polygon' | 'origin' | 'axisU' | 'axisV' | 'labelAt' | 'edges'> {
  const edge = EDGES[level] ?? EDGES[4] ?? [];
  const a = edge[0] ?? { x: 250, y: front };
  // 可走区域是亮边内侧的楼板，背后再留一截，坐着的人头顶不会顶到边界。
  const polygon = level >= 3 ? ribbon(edge, -8, 118) : legacyPolygon(front);
  return {
    polygon,
    origin: { x: a.x, y: a.y },
    axisU: AXIS_U,
    axisV: AXIS_V,
    labelAt: { x: 108, y: front - 28 },
    edges: [edge],
  };
}

function floor(
  partial: Omit<FloorConfig, 'polygon' | 'origin' | 'axisU' | 'axisV' | 'labelAt' | 'edges'>,
): FloorConfig {
  const front = FRONT_Y[partial.level] ?? 900;
  return { ...partial, ...plateOf(partial.level, front) };
}

export const floors: readonly FloorConfig[] = [
  floor({
    level: 1,
    type: 'lobby',
    label: '1F',
    name: 'LOBBY',
    title: '入口与公共展厅',
    stations: 0,
    occupancy: 0,
    people: 3,
  }),
  floor({
    level: 2,
    type: 'lounge',
    label: '2F',
    name: 'LOUNGE',
    title: '员工休息区',
    stations: 0,
    occupancy: 0,
    people: 4,
  }),
  floor({
    level: 3,
    type: 'sales',
    label: '3F',
    name: 'SALES',
    title: '销售',
    stations: 24,
    occupancy: 0.4,
    people: 2,
  }),
  floor({
    level: 4,
    type: 'it',
    label: '4F',
    name: 'IT',
    title: 'IT 机房',
    stations: 24,
    occupancy: 0.4,
    people: 2,
  }),
  floor({
    level: 5,
    type: 'rnd',
    label: '5F',
    name: 'R&D',
    title: '研发',
    stations: 24,
    occupancy: 0.4,
    people: 2,
  }),
  floor({
    level: 6,
    type: 'vacant',
    label: '6F',
    name: 'VACANT',
    title: '空置',
    stations: 24,
    occupancy: 0,
    people: 0,
  }),
  floor({
    level: 7,
    type: 'rnd',
    label: '7F',
    name: 'R&D',
    title: '研发（实验台）',
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

export const PLATE_SRC = '/assets/bg-shell.jpg';
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
