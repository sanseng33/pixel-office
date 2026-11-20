/** Tower canvas and Chinese floor-label metrics for the live building view. */

/** Logical building canvas. 820×640 (ratio 1.28) still height-fills 16:9 / 16:10 desktops. */
export const TOWER_FRAME_W = 820;
export const TOWER_FRAME_H = 640;
/** Historical 600-wide placement base; the tower is not rescaled, only padded. */
export const TOWER_BASE_W = 600;

export const FLOOR_LABEL_SIZE = 16;
export const FLOOR_LABEL_STROKE = 3;
export const FLOOR_LABEL_LIP_GAP = 12;
/** Leftmost label edge, leaving room for a 320–340px intro card on a 1280×800 desktop. */
export const FLOOR_LABEL_MIN_X = 180;
export const FLOOR_LABEL_FONT_FAMILY =
  "'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Noto Sans SC', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif";
export const FLOOR_LABEL_FONT = `700 ${FLOOR_LABEL_SIZE}px ${FLOOR_LABEL_FONT_FAMILY}`;
export const FLOOR_LABEL_FILL = 0xf4fbff;
export const FLOOR_LABEL_LIT = 0x9ad7ff;
export const FLOOR_LABEL_STROKE_COLOR = 0x071422;

export const SIGN_TILE = { x: 3.4, y: 5.2 } as const;
export const SIGN_BOX_W = 202;
export const SIGN_BOX_H = 44;
export const SIGN_POST_H = 26;
export const SIGN_BOX_OFFSET_X = 88;
export const SIGN_POST_LEFT = 53;
export const SIGN_POST_RIGHT = 48;

export const MASCOT_TILE = { x: 14.5, y: 2.5 } as const;
export const MASCOT_W = 83;
export const MASCOT_H = 116;
export const MASCOT_SRC_W = 86;
export const MASCOT_SRC_H = 120;

export const AC_UNITS = [
  { x: 1.3, y: 15.3 },
  { x: 5.3, y: 12.3 },
  { x: 6.3, y: 8.3 },
  { x: 16.3, y: 6.3 },
] as const;

export function floorLabelText(label: string, name: string): string {
  return `${label} ${name}`;
}

/** Official 1F–7F label strings, in storey order. */
export const OFFICIAL_FLOOR_LABELS = [
  '1F 大厅&展厅',
  '2F 休息区',
  '3F 国内事业部',
  '4F IT',
  '5F 综合研发部&运营',
  '6F 健身区',
  '7F 综合研发部&产品',
] as const;

/** Noto Sans CJK SC Bold 16px advances; used when a canvas is unavailable. */
export const OFFICIAL_LABEL_ADVANCE: Record<string, number> = {
  '1F 大厅&展厅': 98.266,
  '2F 休息区': 70.422,
  '3F 国内事业部': 102.422,
  '4F IT': 37.703,
  '5F 综合研发部&运营': 146.266,
  '6F 健身区': 70.422,
  '7F 综合研发部&产品': 146.266,
};

let measureCtx: CanvasRenderingContext2D | null = null;

function fallbackWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 32;
    width += code === 32 ? 6 : code < 128 ? 9.2 : 16;
  }
  return width;
}

/** Measured glyph box including stroke. Uses the live font when a document exists. */
export function measureFloorLabel(text: string): { w: number; h: number } {
  let width = 0;
  if (typeof document !== 'undefined') {
    if (!measureCtx) {
      const canvas = document.createElement('canvas');
      measureCtx = canvas.getContext('2d');
    }
    if (measureCtx) {
      measureCtx.font = FLOOR_LABEL_FONT;
      width = measureCtx.measureText(text).width;
    }
  }
  if (!(width > 8)) width = OFFICIAL_LABEL_ADVANCE[text] ?? fallbackWidth(text);
  return {
    w: Math.ceil(width + FLOOR_LABEL_STROKE * 2),
    h: FLOOR_LABEL_SIZE + FLOOR_LABEL_STROKE * 2 + 2,
  };
}
