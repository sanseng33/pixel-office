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

function plateOf(front: number): Pick<FloorConfig, 'polygon' | 'origin' | 'axisU' | 'axisV' | 'labelAt' | 'edges'> {
  const yf = front;
  const ym = front - 42;
  const yb = front - 86;
  const near = front + 68;
  const recess = front + 6;
  const lip: readonly Vec2[] = [
    { x: 172, y: near - 8 },
    { x: 250, y: near },
    { x: 340, y: near - 4 },
    { x: 340, y: recess + 10 },
    { x: 560, y: recess },
    { x: 760, y: recess + 8 },
    { x: 848, y: recess - 10 },
  ];
  return {
    polygon: [
      { x: 246, y: yf - 12 },
      { x: 524, y: yf - 16 },
      { x: 524, y: ym + 8 },
      { x: 820, y: ym + 4 },
      { x: 820, y: yb },
      { x: 246, y: yb },
    ],
    origin: { x: 252, y: yb + 8 },
    axisU: { x: 42, y: 5 },
    axisV: { x: 6, y: 22 },
    labelAt: { x: 108, y: yf - 104 },
    edges: [lip],
  };
}

function floor(
  partial: Omit<FloorConfig, 'polygon' | 'origin' | 'axisU' | 'axisV' | 'labelAt' | 'edges'>,
): FloorConfig {
  const front = FRONT_Y[partial.level] ?? 900;
  return { ...partial, ...plateOf(front) };
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
    stations: 12,
    occupancy: 0.45,
    people: 1,
  }),
  floor({
    level: 4,
    type: 'it',
    label: '4F',
    name: 'IT',
    title: 'IT 机房',
    stations: 8,
    occupancy: 0.45,
    people: 1,
  }),
  floor({
    level: 5,
    type: 'rnd',
    label: '5F',
    name: 'R&D',
    title: '研发',
    stations: 12,
    occupancy: 0.45,
    people: 1,
  }),
  floor({
    level: 6,
    type: 'vacant',
    label: '6F',
    name: 'VACANT',
    title: '空置',
    stations: 0,
    occupancy: 0,
    people: 0,
  }),
  floor({
    level: 7,
    type: 'rnd',
    label: '7F',
    name: 'R&D',
    title: '研发（实验台）',
    stations: 10,
    occupancy: 0.4,
    people: 1,
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
