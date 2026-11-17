/**
 * 楼层配置 — 改 `type` 就会换成那一层的等距布置。
 *
 * - level: 1 在最底，数字越大越靠上。保持 1–7 且不要重复。
 * - type: lobby 门厅 / lounge 休息 / sales 销售 / it 机房 / rnd 研发 / vacant 空置。
 * - label: 侧面大字，如 "3F"。像素字体只支持 A–Z 0–9 和 & - ! + 空格。
 * - name: 侧面小字。空置层请用 "VACANT"，不要用会被裁切的长句。
 * - title: 中文说明，只给人看，不画到屏幕上。
 * - stations: 办公层希望放的工位数量（实际会受可见地砖限制，大约 24–40）。
 * - occupancy: 工位有人的比例，建议 0.3–0.5。
 * - people: 不坐工位的额外人数（访客、踱步、休息区）。
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
    people: 6,
  },
  {
    level: 2,
    type: 'lounge',
    label: '2F',
    name: 'LOUNGE',
    title: '员工休息区',
    stations: 0,
    occupancy: 0,
    people: 8,
  },
  {
    level: 3,
    type: 'sales',
    label: '3F',
    name: 'SALES',
    title: '销售',
    stations: 36,
    occupancy: 0.42,
    people: 3,
  },
  {
    level: 4,
    type: 'it',
    label: '4F',
    name: 'IT',
    title: 'IT 机房',
    stations: 30,
    occupancy: 0.36,
    people: 2,
  },
  {
    level: 5,
    type: 'rnd',
    label: '5F',
    name: 'R&D',
    title: '研发',
    stations: 32,
    occupancy: 0.4,
    people: 2,
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
    title: '研发（实验区）',
    stations: 28,
    occupancy: 0.38,
    people: 2,
  },
];
