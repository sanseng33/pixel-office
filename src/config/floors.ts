/**
 * 楼层配置 — 改 `type` 就会换成那一层的室内。
 *
 * - level: 1 在最底，数字越大越靠上。保持 1–7 且不要重复。
 * - type: lobby / lounge / sales / it / rnd / vacant。
 * - label / name: 画在该层左墙内侧。像素字体只支持 A–Z、0–9 和 & - ! + 空格。
 * - stations: 办公层工位数量，大约 16–24，多了会挤出楼板。
 * - occupancy: 工位有人的比例，建议 0.4–0.6。
 * - people: 不坐工位的人数（访客、踱步、打球、吧台）。
 */
export type FloorType = 'lobby' | 'lounge' | 'sales' | 'it' | 'rnd' | 'vacant';

export interface FloorConfig {
  level: number;
  type: FloorType;
  label: string;
  name: string;
  title: string;
  stations: number;
  occupancy: number;
  people: number;
}

export const floors: readonly FloorConfig[] = [
  {
    level: 1,
    type: 'lobby',
    label: '1F',
    name: 'LOBBY',
    title: '入口与公共展厅',
    stations: 0,
    occupancy: 0,
    people: 5,
  },
  {
    level: 2,
    type: 'lounge',
    label: '2F',
    name: 'LOUNGE',
    title: '员工休息区',
    stations: 0,
    occupancy: 0,
    people: 6,
  },
  {
    level: 3,
    type: 'sales',
    label: '3F',
    name: 'SALES',
    title: '销售',
    stations: 18,
    occupancy: 0.55,
    people: 2,
  },
  {
    level: 4,
    type: 'it',
    label: '4F',
    name: 'IT',
    title: 'IT 机房',
    stations: 10,
    occupancy: 0.5,
    people: 2,
  },
  {
    level: 5,
    type: 'rnd',
    label: '5F',
    name: 'R&D',
    title: '研发',
    stations: 16,
    occupancy: 0.5,
    people: 1,
  },
  {
    level: 6,
    type: 'vacant',
    label: '6F',
    name: 'VACANT',
    title: '空置',
    stations: 0,
    occupancy: 0,
    people: 0,
  },
  {
    level: 7,
    type: 'rnd',
    label: '7F',
    name: 'R&D',
    title: '研发（实验台）',
    stations: 14,
    occupancy: 0.5,
    people: 1,
  },
];
