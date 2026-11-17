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
  return rows.map((row) => [...row].reverse().join(''));
}

const WALK = [
  [
    '..wwwww..',
    '.wwwwwww.',
    '.ww.w.ww.',
    '.wwwwwww.',
    '..wwwww..',
    '...bbb...',
    '..bbbbb..',
    '.bbwwbb..',
    '..bbbbb..',
    '..bb.bb..',
    '..b...b..',
    '.dd...dd.',
  ],
  [
    '..wwwww..',
    '.wwwwwww.',
    '.ww.w.ww.',
    '.wwwwwww.',
    '..wwwww..',
    '...bbb...',
    '..bbbbb..',
    '.bbwwbb..',
    '..bbbbb..',
    '...b.b...',
    '..b...b..',
    '.dd...dd.',
  ],
  [
    '..wwwww..',
    '.wwwwwww.',
    '.ww.w.ww.',
    '.wwwwwww.',
    '..wwwww..',
    '...bbb...',
    '.bbbbbbb.',
    '..bwwb...',
    '..bbbbb..',
    '..b.b.b..',
    '.b.....b.',
    'dd.....dd',
  ],
];

const SIT = [
  [
    '..wwwww..',
    '.ww.w.ww.',
    '.wwwwwww.',
    '..bbbbb..',
    '.bbwwbb..',
    '..bbbbb..',
    '.bbbbbbb.',
    '..b...b..',
  ],
  [
    '..wwwww..',
    '.w.w.w.w.',
    '.wwwwwww.',
    '.bbbbbbb.',
    '..bwwb...',
    '..bbbbb..',
    '.bbbbbbb.',
    '..b...b..',
  ],
];

const PHONE = [
  [
    '..wwwww..',
    '.ww.w.wc.',
    '.wwwwwwb.',
    '..bbbbb..',
    '.bbwwbb..',
    '..bbbbb..',
    '.bbbbbbb.',
    '..b...b..',
  ],
  [
    '..wwwww..',
    '.ww.w.w.c',
    '.wwwwww..',
    '..bbbbb..',
    '.bbwwbb..',
    '..bbbbb..',
    '.bbbbbbb.',
    '..b...b..',
  ],
];

const CHAT = [
  [
    '..wwwww..',
    '.ww.w.ww.',
    '.wwwwwww.',
    '..bbb.b..',
    '.bbbbbb..',
    '..bbwwb..',
    '..bbbbb..',
    '..b...b..',
    '.dd...dd.',
  ],
  [
    '..wwwww..',
    '.ww.w.ww.',
    '.wwwwwww.',
    '...bbb...',
    '..bbbbb..',
    '.bwwbbb..',
    '..bbbbb..',
    '..b...b..',
    '.dd...dd.',
  ],
];

const SWING = [
  [
    'b.wwwww..',
    '.ww.w.ww.',
    '.wwwwwww.',
    '..bbbbb..',
    '.bbwwbb..',
    '..bbbbb..',
    '..b...b..',
    '.dd...dd.',
  ],
  [
    '..wwwww.b',
    '.ww.w.ww.',
    '.wwwwwww.',
    '..bbbbb..',
    '.bbwwbb..',
    '..bbbbb..',
    '..b...b..',
    '.dd...dd.',
  ],
];

const CHEER = [
  'b.wwwww.b',
  '.ww.w.ww.',
  'bwwwwwwwb',
  '..bbbbb..',
  '.bbwwbb..',
  '..bbbbb..',
  '..b...b..',
  '.dd...dd.',
];

const PROPS: Record<string, string[]> = {
  desk: [
    '.kkkkkkkk.',
    'kwwwwwwwwk',
    'kwwwwwwwwk',
    'kwwwwwwwwk',
    '.bbbbbbbb.',
    'bbbbbbbbbb',
    'b.bb..bb.b',
  ],
  dual: [
    'kkkk...kkkk.',
    'kwwk...kwwk.',
    'kwwk...kwwk.',
    '.bbb...bbb..',
    'bbbbbbbbbbbb',
    'bb..b..b..bb',
  ],
  rack: [
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
    'b.bb.b',
    'bbbbbb',
  ],
  pong: [
    '.bbbbbbbbbbbbbbbbbb.',
    'bwwwwwwwwwwwwwwwwwwb',
    'bwwwwwwwwbbwwwwwwwwb',
    'bwwwwwwwwwwwwwwwwwwb',
    '.bbbbbbbbbbbbbbbbbb.',
    '..b..............b..',
  ],
  bar: [
    'bbbbbbbbbbbbbbbbbbbb',
    'bwwwwwwwwwwwwwwwwwwb',
    'bbbbbbbbbbbbbbbbbbbb',
    'bb................bb',
    '.bb..............bb.',
  ],
  stool: ['bbbb', 'bwwb', '.bb.', 'b..b'],
  sofa: [
    'bb............bb',
    'bbbbbbbbbbbbbbbb',
    'bwwwwwwwwwwwwwwb',
    'bbbbbbbbbbbbbbbb',
    '.bb..........bb.',
  ],
  plant: ['.b.b.b.', 'bb.b.bb', '..bbb..', '...b...', '..www..', '.bbbbb.'],
  screen: [
    'bbbbbbbbbbbbbbbbbbbb',
    'bkkkkkkkkkkkkkkkkkkb',
    'bkkkkkkkkkkkkkkkkkkb',
    'bkkkkkkkkkkkkkkkkkkb',
    'bkkkkkkkkkkkkkkkkkkb',
    'bkkkkkkkkkkkkkkkkkkb',
    'bbbbbbbbbbbbbbbbbbbb',
  ],
  board: [
    'bbbbbbbbbbbbbbbb',
    'bwwwwwwwwwwwwwwb',
    'bw.ww..ww..w.wwb',
    'bwwwwwwwwwwwwwwb',
    'bw.ww.ww..ww.wwb',
    'bbbbbbbbbbbbbbbb',
  ],
  gong: [
    '..wwwww..',
    '.w.....w.',
    'w..www..w',
    'w.......w',
    'w..www..w',
    '.w.....w.',
    '..bbbbb..',
    '...b.b...',
    '..bbbbb..',
  ],
  cone: [
    '...w...',
    '..w.w..',
    '..bbb..',
    '.bwwwb.',
    '.bbbbb.',
    'bbbbbbb',
    '..b.b..',
  ],
  box: ['bbbbbb', 'bwwwwb', 'bbbbbb', 'bwwwwb', 'bbbbbb', 'bb..bb'],
  hvac: [
    '.bbbbbbbb.',
    'bkkkkkkkkb',
    'bkbkbkbkbb',
    'bkkkkkkkkb',
    'bbbbbbbbbb',
    'b..b...b.b',
  ],
  bench: [
    '..kkkkkkkk..',
    '.kwwwwwwwwk.',
    '.kwwwwwwwwk.',
    'bbbbbbbbbbbb',
    'b..bbbb..b.b',
    '.b..bb..b...',
  ],
  bubble: ['bbbbb', 'b.w.b', 'bbbbb', '.bb..'],
  bubble2: ['bbbbb', 'bw.wb', 'bbbbb', '.bb..'],
};

function feet(rows: readonly string[]): { rows: string[]; ax: number; ay: number } {
  const w = rows[0]?.length ?? 1;
  return { rows: [...rows], ax: w >> 1, ay: rows.length - 1 };
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  frames: Record<string, Frame>;
}

export function buildAtlas(): Atlas {
  const raw: Record<string, { rows: string[]; ax: number; ay: number }> = {};
  const add = (name: string, rows: readonly string[]) => {
    raw[name] = feet(rows);
    raw[`${name}F`] = feet(flip(rows));
  };
  WALK.forEach((rows, i) => add(`w${i}`, rows));
  SIT.forEach((rows, i) => add(`s${i}`, rows));
  PHONE.forEach((rows, i) => add(`p${i}`, rows));
  CHAT.forEach((rows, i) => add(`c${i}`, rows));
  SWING.forEach((rows, i) => add(`g${i}`, rows));
  raw.cheer = feet(CHEER);
  for (const [name, rows] of Object.entries(PROPS)) raw[name] = feet(rows);

  const size = 384;
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
    if (cy + h + 1 >= size) throw new Error(`atlas overflow at ${cx},${cy} for ${w}x${h}`);
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
      if (row.length !== w) throw new Error(`sprite ${name} width ${row.length} != ${w} [${row}]`);
    }
    const pos = pack(w, h);
    for (let y = 0; y < h; y++) {
      const row = sprite.rows[y] ?? '';
      for (let x = 0; x < w; x++) {
        const color = INK[row[x] ?? '.'];
        if (color) pix.px(pos.x + x, pos.y + y, color);
      }
    }
    frames[name] = { x: pos.x, y: pos.y, w, h, ax: sprite.ax, ay: sprite.ay };
  }

  const texts = [
    { name: 'logo', text: 'PatSnap', scale: 2, font: 'logo' as const },
    { name: 'tDEAL', text: 'DEAL', scale: 2, font: 'ui' as const },
    { name: 'tDEPLOY', text: 'DEPLOY', scale: 1, font: 'ui' as const },
    { name: 'tHI', text: 'HI', scale: 1, font: 'ui' as const },
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

export const SCREEN_OF: Record<string, { x: number; y: number; w: number; h: number }[]> = {
  desk: [{ x: 1, y: 1, w: 8, h: 3 }],
  dual: [
    { x: 1, y: 1, w: 3, h: 2 },
    { x: 8, y: 1, w: 3, h: 2 },
  ],
  screen: [{ x: 1, y: 1, w: 18, h: 5 }],
  bench: [{ x: 2, y: 1, w: 8, h: 2 }],
};

export const RACK_LEDS: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [1, 3],
  [2, 3],
  [3, 3],
  [4, 3],
  [1, 5],
  [2, 5],
  [3, 5],
  [4, 5],
  [1, 7],
  [2, 7],
  [3, 7],
  [4, 7],
  [1, 9],
  [2, 9],
  [3, 9],
  [4, 9],
  [1, 11],
  [2, 11],
  [3, 11],
  [4, 11],
];
