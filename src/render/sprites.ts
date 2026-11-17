import { RGB } from '../config/display.ts';
import { stampText } from './font.ts';
import type { RGBA } from './pixel.ts';
import { Pix } from './pixel.ts';

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

const INK: Record<string, RGBA> = {
  b: RGB.ice,
  w: RGB.white,
  d: RGB.deep,
  c: RGB.bright,
  k: RGB.hole,
};

function flip(rows: readonly string[]): string[] {
  return rows.map((row) => row.split('').reverse().join(''));
}

/** 5×9 people. Bottom row is the feet. */
const SE = [
  '.www.',
  'wdwdw',
  '.bbb.',
  'bbwbb',
  '.b.b.',
  '.b.b.',
  'd...d',
];
const SE2 = [
  '.www.',
  'wdwdw',
  '.bbb.',
  'bwbwb',
  '..b.b',
  '.b.b.',
  'd...d',
];
const SIT = [
  '.www.',
  'wdwdw',
  '.bbb.',
  'bbwbb',
  '.b.b.',
];
const SIT2 = [
  '.www.',
  'wdddw',
  'bbbbb',
  'bwbwb',
  '.b.b.',
];
const PH = [
  '.www.',
  'wdwdc',
  '.bbb.',
  'bbwbb',
  '.b.b.',
];
const PH2 = [
  '.www.',
  'wdw.c',
  '.bbb.',
  'bwbwb',
  '.b.b.',
];
const NE = [
  '.bbb.',
  'bbbbb',
  '.bwb.',
  'bbwbb',
  '.b.b.',
  '.b.b.',
  'd...d',
];
const NE2 = [
  '.bbb.',
  'bbbbb',
  '.bwb.',
  'bwbwb',
  '..b.b',
  '.b..b',
  'd...d',
];
const CHEER = [
  'b.w.b',
  'bwwwb',
  'wdwdw',
  '.bbb.',
  'bbwbb',
  '.b.b.',
  'd...d',
];
const STRETCH = [
  'bwwwb',
  'b.w.b',
  'wdwdw',
  '.bbb.',
  '.b.b.',
  'd...d',
];

const PROPS: Record<string, { rows: string[]; ax: number; ay: number }> = {
  desk: {
    ax: 4,
    ay: 7,
    rows: [
      '.kkkkkk.',
      'kwwwwwwk',
      'kwwwwwwk',
      '.bbbbbb.',
      'bbbbbbbb',
      'bb.bb.bb',
    ],
  },
  dual: {
    ax: 5,
    ay: 7,
    rows: [
      'kk....kk',
      'kww..wwk',
      'kww..wwk',
      '.bbbbbb.',
      'bbbbbbbb',
      'bb.bb.bb',
    ],
  },
  stand: {
    ax: 4,
    ay: 9,
    rows: [
      '.kkkkkk.',
      'kwwwwwwk',
      'kwwwwwwk',
      '..bbbb..',
      '...bb...',
      '...bb...',
      '..b..b..',
      'bbbbbbbb',
    ],
  },
  bench: {
    ax: 7,
    ay: 7,
    rows: [
      '...kkkkkk...',
      '..kwwwwwwk..',
      '..kwwwwwwk..',
      '...bbbbbb...',
      '..b......b..',
      '.bbb....bbb.',
    ],
  },
  rack: {
    ax: 3,
    ay: 15,
    rows: [
      'bbbbbb',
      'bwwwwb',
      'bbbbbb',
      'bccccb',
      'bbbbbb',
      'bwwwwb',
      'bbbbbb',
      'bccccb',
      'bbbbbb',
      'bwwwwb',
      'bbbbbb',
      'bccccb',
      'bbbbbb',
      'bb..bb',
    ],
  },
  sofa: {
    ax: 8,
    ay: 7,
    rows: [
      'bb..........bb',
      'bbbbbbbbbbbbbb',
      'bwwwwwwwwwwwwb',
      'bbbbbbbbbbbbbb',
      '.bb........bb.',
      '..b........b..',
    ],
  },
  coffee: {
    ax: 4,
    ay: 9,
    rows: [
      '.bbbbbb.',
      '.bkkkkb.',
      '.bwwwwb.',
      '.bbbbbb.',
      '..bwwb..',
      '.bbbbbb.',
      '..b..b..',
    ],
  },
  pong: {
    ax: 8,
    ay: 6,
    rows: [
      '.bbbbbbbbbbbb.',
      'bwwwwwwwwwwwwb',
      'bwwwwwwwwwwwwb',
      'bwwwwwbbwwwwwb',
      '.bbbbbbbbbbbb.',
      '..b........b..',
    ],
  },
  plant: {
    ax: 2,
    ay: 7,
    rows: [
      '.b.b.',
      'b.b.b',
      '.bbb.',
      '..b..',
      '.www.',
      'bbbbb',
    ],
  },
  box: {
    ax: 3,
    ay: 6,
    rows: [
      '.bbbb.',
      'bwwwwb',
      'bbbbbb',
      'bwwwwb',
      'bbbbbb',
      '.b..b.',
    ],
  },
  box2: {
    ax: 3,
    ay: 10,
    rows: [
      '.bbbb.',
      'bwwwwb',
      'bbbbbb',
      '.bbbb.',
      'bwwwwb',
      'bbbbbb',
      'bwwwwb',
      'bbbbbb',
      '.b..b.',
    ],
  },
  board: {
    ax: 6,
    ay: 8,
    rows: [
      'bbbbbbbbbbbb',
      'bwwwwwwwwwwb',
      'bw.ww..ww.wb',
      'bwwwwwwwwwwb',
      'bw..ww.ww.wb',
      'bwwwwwwwwwwb',
      'bbbbbbbbbbbb',
    ],
  },
  screen: {
    ax: 8,
    ay: 10,
    rows: [
      'bbbbbbbbbbbbbbbb',
      'bkkkkkkkkkkkkkkb',
      'bkkkkkkkkkkkkkkb',
      'bkkkkkkkkkkkkkkb',
      'bkkkkkkkkkkkkkkb',
      'bkkkkkkkkkkkkkkb',
      'bbbbbbbbbbbbbbbb',
      '......bb........',
    ],
  },
  reception: {
    ax: 8,
    ay: 6,
    rows: [
      'bbbbbbbbbbbbbbbb',
      'bwwwwwwwwwwwwwwb',
      'bbbbbbbbbbbbbbbb',
      '.bb..........bb.',
      '..bb........bb..',
    ],
  },
  gate: {
    ax: 2,
    ay: 6,
    rows: [
      'b.b.b',
      'bbbbb',
      '..b..',
      '..b..',
      '.bbb.',
      'b...b',
    ],
  },
  plinth: {
    ax: 3,
    ay: 6,
    rows: [
      '..ww..',
      '.bbbb.',
      '..bb..',
      '.bbbb.',
      'bbbbbb',
    ],
  },
  gong: {
    ax: 3,
    ay: 8,
    rows: ['..ww..', '.w..w.', 'w.ww.w', '.w..w.', '..bb..', '...b..', '..bbb.'],
  },
  cooler: {
    ax: 2,
    ay: 8,
    rows: [
      'bbbbb',
      'bwwwb',
      'bbbbb',
      'bkkkb',
      'bwwbb',
      'bbbbb',
      'b.b.b',
    ],
  },
  bubble: {
    ax: 2,
    ay: 4,
    rows: ['bbbbb', 'b.w.b', 'bbbbb', '.bb..'],
  },
  bubble2: {
    ax: 2,
    ay: 4,
    rows: ['bbbbb', 'bw.wb', 'bbbbb', '.bb..'],
  },
};

function feet(rows: readonly string[]): { rows: string[]; ax: number; ay: number } {
  const w = rows[0]?.length ?? 1;
  return { rows: [...rows], ax: w >> 1, ay: rows.length - 1 };
}

function buildRaw(): Record<string, { rows: string[]; ax: number; ay: number }> {
  const out: Record<string, { rows: string[]; ax: number; ay: number }> = {};
  const add = (name: string, rows: readonly string[], mirror = true) => {
    out[name] = feet(rows);
    if (mirror) out[`${name}F`] = feet(flip(rows));
  };
  add('se0', SE);
  add('se1', SE2);
  add('ne0', NE);
  add('ne1', NE2);
  add('sit0', SIT);
  add('sit1', SIT2);
  add('ph0', PH);
  add('ph1', PH2);
  out.cheer = feet(CHEER);
  out.stretch = feet(STRETCH);
  for (const key of Object.keys(PROPS)) {
    const prop = PROPS[key];
    if (!prop) continue;
    out[key] = { rows: prop.rows.map((row) => row.replace(/ /g, '')), ax: prop.ax, ay: prop.ay };
  }
  return out;
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  frames: Record<string, Frame>;
}

export function buildAtlas(): Atlas {
  const raw = buildRaw();
  const size = 256;
  const pix = new Pix(size, size);
  const frames: Record<string, Frame> = {};
  let cx = 1;
  let cy = 1;
  let rowH = 0;
  const pack = (w: number, h: number) => {
    if (cx + w + 1 >= size) {
      cx = 1;
      cy += rowH + 1;
      rowH = 0;
    }
    if (cy + h + 1 >= size) throw new Error('sprite atlas overflow');
    const pos = { x: cx, y: cy };
    cx += w + 1;
    if (h > rowH) rowH = h;
    return pos;
  };

  for (const name of Object.keys(raw)) {
    const sprite = raw[name];
    if (!sprite) continue;
    const h = sprite.rows.length;
    const w = sprite.rows[0]?.length ?? 0;
    for (const row of sprite.rows) {
      if (row.length !== w) throw new Error(`sprite ${name} row width ${row.length} != ${w} (${row})`);
    }
    const pos = pack(w, h);
    for (let y = 0; y < h; y++) {
      const row = sprite.rows[y] ?? '';
      for (let x = 0; x < w; x++) {
        const color = INK[row[x] ?? '.'];
        if (!color) continue;
        pix.px(pos.x + x, pos.y + y, color);
      }
    }
    frames[name] = { x: pos.x, y: pos.y, w, h, ax: sprite.ax, ay: sprite.ay };
  }

  const texts: { name: string; text: string; scale: number; font: 'ui' | 'logo' }[] = [
    { name: 'logo', text: 'PatSnap', scale: 2, font: 'logo' },
    { name: 'tDEAL', text: 'DEAL', scale: 2, font: 'ui' },
    { name: 'tDEPLOY', text: 'DEPLOY', scale: 1, font: 'ui' },
    { name: 'tVACANT', text: 'VACANT', scale: 2, font: 'ui' },
    { name: 'tHI', text: 'HI', scale: 1, font: 'ui' },
  ];
  for (const item of texts) {
    const gw = item.font === 'logo' ? 5 : 3;
    const gh = item.font === 'logo' ? 7 : 5;
    const w = item.text.length * gw * item.scale + Math.max(0, item.text.length - 1) * item.scale;
    const h = gh * item.scale;
    const pos = pack(w, h);
    stampText(pix, pos.x, pos.y, item.text, item.scale, RGB.white, item.font);
    frames[item.name] = { x: pos.x, y: pos.y, w, h, ax: w >> 1, ay: h };
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const image = ctx.createImageData(size, size);
  image.data.set(pix.data);
  ctx.putImageData(image, 0, 0);
  return { canvas, frames };
}

/** Monitor window inside a prop sprite, relative to its top-left. */
export const SCREEN_OF: Record<string, { x: number; y: number; w: number; h: number }> = {
  desk: { x: 1, y: 1, w: 6, h: 2 },
  dual: { x: 1, y: 1, w: 2, h: 2 },
  stand: { x: 1, y: 1, w: 6, h: 2 },
  screen: { x: 1, y: 1, w: 14, h: 5 },
};
