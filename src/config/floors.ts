/**
 * 楼层配置 — 改这里即可调整大厅屏幕上的楼层职能。
 *
 * - level: 1 在最底部，数字越大越靠上。请保持 1–7 且不要重复。
 * - kind: 决定室内布置（前台、休息区、工位、机柜、施工等）。
 * - label: 侧面大字，通常是 "1F"。
 * - name: 侧面小字，仅支持 A–Z、0–9 和 & - ! + 空格（像素字体）。
 * - title: 给人看的中文说明，不会画到屏幕上。
 * - people: 该层走动/就座的人数。空置层忽略。人少、工位多，画面才不会挤。
 * - stations: 销售 / 研发 / IT 的工位数量（很多人空着）。
 * - racks: IT 层机柜数量。
 */
export type FloorKind = 'lobby' | 'lounge' | 'sales' | 'it' | 'rnd' | 'vacant';

export interface FloorConfig {
  level: number;
  kind: FloorKind;
  label: string;
  name: string;
  title: string;
  people: number;
  stations: number;
  racks: number;
}

export const floors: readonly FloorConfig[] = [
  {
    level: 1,
    kind: 'lobby',
    label: '1F',
    name: 'LOBBY',
    title: '入口与公共展厅',
    people: 3,
    stations: 0,
    racks: 0,
  },
  {
    level: 2,
    kind: 'lounge',
    label: '2F',
    name: 'LOUNGE',
    title: '员工休息区',
    people: 4,
    stations: 0,
    racks: 0,
  },
  {
    level: 3,
    kind: 'sales',
    label: '3F',
    name: 'SALES',
    title: '销售',
    people: 4,
    stations: 10,
    racks: 0,
  },
  {
    level: 4,
    kind: 'it',
    label: '4F',
    name: 'IT',
    title: 'IT 机房',
    people: 3,
    stations: 4,
    racks: 6,
  },
  {
    level: 5,
    kind: 'rnd',
    label: '5F',
    name: 'R&D',
    title: '研发',
    people: 5,
    stations: 12,
    racks: 0,
  },
  {
    level: 6,
    kind: 'vacant',
    label: '6F',
    name: 'SOON',
    title: '空置 / 即将启用',
    people: 0,
    stations: 0,
    racks: 0,
  },
  {
    level: 7,
    kind: 'rnd',
    label: '7F',
    name: 'R&D',
    title: '研发',
    people: 4,
    stations: 12,
    racks: 0,
  },
];
