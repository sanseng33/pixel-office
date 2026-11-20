/** Hover timing and per-floor department copy. Replace bodies here when official text is ready. */

/** Delay after arriving on a floor before the intro card appears (ms). */
export const HOVER_SHOW_MS = 320;
/** Delay after leaving the building before highlight, card and guide line hide (ms). */
export const HOVER_HIDE_MS = 180;

/** Page / canvas / card navy. Must stay identical to engine NAVY 0x071422. */
export const PAGE_NAVY = '#071422';
export const CARD_BORDER = '#9ad7ff';
export const CARD_TEXT = '#f4fbff';
export const CARD_MUTED = '#9ad7ff';
export const GUIDE_STROKE = '#9ad7ff';

export interface FloorIntro {
  level: number;
  label: string;
  name: string;
  /** Official short title from src/config/floors.ts. */
  title: string;
  /**
   * Department copy. Sentences are taken only from floors.ts titles and
   * documented layout notes in docs/HANDOFF.md / README.md (fixtures, role).
   * Do not invent company business facts here. If you add unverified colour,
   * prefix that paragraph with 「示例介绍：」 so it stays replaceable.
   */
  body: string;
}

export const FLOOR_INTROS: readonly FloorIntro[] = [
  {
    level: 1,
    label: '1F',
    name: '大厅&展厅',
    title: '大厅&展厅',
    body: '大厅与展厅。层内有接待台、展示屏、沙发与绿植，并保留访客通道。访客到达事件出现在本层。',
  },
  {
    level: 2,
    label: '2F',
    name: '休息区',
    title: '休息区',
    body: '员工休息区。层内有沙发、咖啡台、乒乓球桌与绿植。',
  },
  {
    level: 3,
    label: '3F',
    name: '国内事业部',
    title: '国内事业部',
    body: '国内事业部。层内为工位与会议室；成交事件出现在本层。',
  },
  {
    level: 4,
    label: '4F',
    name: 'IT',
    title: 'IT',
    body: 'IT 机房。层内保留机柜等机房设施。',
  },
  {
    level: 5,
    label: '5F',
    name: '综合研发部&运营',
    title: '综合研发部&运营',
    body: '综合研发与运营。层内为研发工位；部署成功事件出现在研发层。',
  },
  {
    level: 6,
    label: '6F',
    name: '健身区',
    title: '健身区',
    body: '健身区。层内有跑步机、动感单车、哑铃架、训练凳与瑜伽垫等少量器械；本层人数为 0。',
  },
  {
    level: 7,
    label: '7F',
    name: '综合研发部&产品',
    title: '综合研发部&产品',
    body: '综合研发与产品。同为研发，布置与 5F 不同，含实验台／白板。部署成功事件同样出现在研发层。',
  },
];

export function introFor(level: number): FloorIntro | undefined {
  return FLOOR_INTROS.find((item) => item.level === level);
}
