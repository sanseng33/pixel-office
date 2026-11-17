import { RGB } from '../config/display.ts';
import type { RGBA } from './pixel.ts';
import { Pix } from './pixel.ts';
import { stampText } from './font.ts';

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

interface Raw {
  rows: string[];
  ax: number;
  ay: number;
}

function flipRows(rows: string[]): string[] {
  return rows.map((row) => row.split('').reverse().join(''));
}

const WALK = [
  [
    '...wwww.....',
    '..wwwwww....',
    '..wwddww....',
    '..wwwwww....',
    '...wwww.....',
    '....bb......',
    '...bbbb.....',
    '..bbwwbb....',
    '...bbbb.....',
    '...bbbb.....',
    '...bb.bb....',
    '...b...b....',
    '..dd...dd...',
  ],
  [
    '...wwww.....',
    '..wwwwww....',
    '..wwddww....',
    '..wwwwww....',
    '...wwww.....',
    '....bb......',
    '...bbbb..b..',
    '..bbwwbbb...',
    '...bbbb.....',
    '....bb......',
    '....bb......',
    '....bb......',
    '...dddd.....',
  ],
  [
    '...wwww.....',
    '..wwwwww....',
    '..wwddww....',
    '..wwwwww....',
    '...wwww.....',
    '....bb......',
    '...bbbb.....',
    '..bbwwbb....',
    '...bbbb.....',
    '...bb.b.....',
    '..b...b.....',
    '..b....d....',
    '.dd....dd...',
  ],
  [
    '...wwww.....',
    '..wwwwww....',
    '..wwddww....',
    '..wwwwww....',
    '...wwww.....',
    '....bb......',
    '.b.bbbb.....',
    '..bbbwwbb...',
    '...bbbb.....',
    '...b.bb.....',
    '...b...b....',
    '...b...b....',
    '..dd...dd...',
  ],
];

const PHONE = [
  [
    '...wwww.....',
    '..wwwwww....',
    '..wwddww.w..',
    '..wwwwww.d..',
    '...wwww..b..',
    '....bb...b..',
    '...bbbb.....',
    '..bbwwbb....',
    '...bbbb.....',
    '...bb.b.....',
    '...b...b....',
    '..dd...dd...',
  ],
  [
    '...wwww.....',
    '..wwwwww.w..',
    '..wwddww.d..',
    '..wwwwww....',
    '...wwww.....',
    '....bb..b...',
    '...bbbbb....',
    '..bbwwbb....',
    '...bbbb.....',
    '...b.bb.....',
    '...b...b....',
    '..dd...dd...',
  ],
];

const CHAT = [
  [
    '...wwww.....',
    '..wwwwww....',
    '..wwddww....',
    '..wwwwww....',
    '...wwww.....',
    '....bb......',
    '...bbbbbb...',
    '..bbwwbb....',
    '...bbbb.....',
    '...bb.bb....',
    '...b...b....',
    '..dd...dd...',
  ],
  [
    '...wwww.....',
    '..wwwwww....',
    '..wwddww....',
    '..wwwwww....',
    '...wwww.....',
    '....bb..b...',
    '...bbbbb....',
    '..bbwwbb....',
    '...bbbb.....',
    '...bb..b....',
    '...b...b....',
    '..dd...dd...',
  ],
];

const COFFEE = [
  [
    '...wwww.....',
    '..wwwwww....',
    '..wwddww....',
    '..wwwwww....',
    '...wwww.....',
    '....bb......',
    '...bbbb.w...',
    '..bbwwbbw...',
    '...bbbb.c...',
    '...bb.bb....',
    '...b...b....',
    '..dd...dd...',
  ],
  [
    '...wwww.....',
    '..wwwwww....',
    '..wwddww....',
    '..wwwwww....',
    '...wwww.....',
    '....bb......',
    '...bbbb..w..',
    '..bbwwbb.w..',
    '...bbbb.c...',
    '...b.bb.....',
    '...b...b....',
    '..dd...dd...',
  ],
];

const CHEER = [
  [
    'b...wwww...b',
    'b..wwwwww..b',
    '...wwddww...',
    '...wwwwww...',
    '....wwww....',
    '....bbbb....',
    '...bwwwwb...',
    '...bbbbbb...',
    '....b..b....',
    '....b..b....',
    '...dd..dd...',
  ],
  [
    'bb..wwww..bb',
    '...wwwwww...',
    '...wwddww...',
    '...wwwwww...',
    '....wwww....',
    '....bbbb....',
    '...bwwwwb...',
    '...bbbbbb...',
    '....b..b....',
    '...dd..dd...',
  ],
];

const TYPE = [
  [
    '...wwww.....',
    '..wwwwww....',
    '..wwddww....',
    '...wwww.....',
    '...bbbb.....',
    '..bbwwbb....',
    '.bbbbbbbb...',
    '..bb..bb....',
  ],
  [
    '...wwww.....',
    '..wwwwww....',
    '..wwddww....',
    '...wwww.....',
    '..bbbbbb....',
    '.bbwwwwbb...',
    '..bbbbbb....',
    '..b....b....',
  ],
];

const PROPS: Record<string, Raw> = {
  desk: {
    ax: 7,
    ay: 12,
    rows: [
      '..kkkkkkkkkk..',
      '.kwwwwwwwwwwk.',
      '.kwwwwwwwwwwk.',
      '.kwwwwwwwwwwk.',
      '.kkkkkkkkkkkk.',
      '..bbbbbbbbbb..',
      'bbbbbbbbbbbbbb',
      'bb..........bb',
      '.b..........b.',
      'bb..........bb',
      '.bb........bb.',
    ],
  },
  counter: {
    ax: 12,
    ay: 7,
    rows: [
      'bbbbbbbbbbbbbbbbbbbbbbbb',
      'bwwwwwwwwwwwwwwwwwwwwwwb',
      'bbbbbbbbbbbbbbbbbbbbbbbb',
      'bb....................bb',
      '.bb..................bb.',
      'bb....................bb',
      '.b....................b.',
    ],
  },
  sofa: {
    ax: 12,
    ay: 8,
    rows: [
      'bb....................bb',
      'bbbbbbbbbbbbbbbbbbbbbbbb',
      'bwwwwwwwwwwwwwwwwwwwwwwb',
      'bbbbbbbbbbbbbbbbbbbbbbbb',
      'bb....................bb',
      '.bb..................bb.',
      '..bb................bb..',
    ],
  },
  coffee: {
    ax: 5,
    ay: 13,
    rows: [
      '..bbbbbb..',
      '.bkkkkkkb.',
      '.bwwwwwwb.',
      '.bkkkkkkb.',
      '..bbbbbb..',
      '..b.ww.b..',
      '..bbbbbb..',
      '...b..b...',
      '..bbbbbb..',
      '...wwww...',
      '....bb....',
    ],
  },
  rack: {
    ax: 5,
    ay: 16,
    rows: [
      'bbbbbbbbbb',
      'bkkkkkkkkb',
      'bkww..wwkb',
      'bkkkkkkkkb',
      'bkcc..cckb',
      'bkkkkkkkkb',
      'bkww..wwkb',
      'bkkkkkkkkb',
      'bkcc..wwkb',
      'bkkkkkkkkb',
      'bkww..cckb',
      'bkkkkkkkkb',
      'bbbbbbbbbb',
      'b..b..b..b',
      'bb.b..b.bb',
    ],
  },
  plant: {
    ax: 4,
    ay: 8,
    rows: [
      '..b.b.b.',
      '.bb.b.bb',
      '..bbbbb.',
      '...bbb..',
      '....b...',
      '...bbb..',
      '..bbbbb.',
    ],
  },
  cone: {
    ax: 4,
    ay: 10,
    rows: [
      '....w....',
      '...w.w...',
      '...bbb...',
      '..bwwwb..',
      '..bbbbb..',
      '.bwwwwwb.',
      '.bbbbbbb.',
      'bbbbbbbbb',
      '...b.b...',
    ],
  },
  crate: {
    ax: 4,
    ay: 7,
    rows: [
      'bbbbbbbb',
      'bwwwwwwb',
      'bbbbbbbb',
      'bwwwwwwb',
      'bbbbbbbb',
      'bb....bb',
    ],
  },
  board: {
    ax: 9,
    ay: 10,
    rows: [
      'bbbbbbbbbbbbbbbbbb',
      'bwwwwwwwwwwwwwwwwb',
      'bw..ww....ww..w.wb',
      'bwwwwwwwwwwwwwwwwb',
      'bw.ww..ww..ww..w.b',
      'bwwwwwwwwwwwwwwwwb',
      'bbbbbbbbbbbbbbbbbb',
      '....bb......bb....',
    ],
  },
  screen: {
    ax: 16,
    ay: 16,
    rows: [
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'bkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkb',
      'bkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkb',
      'bkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkb',
      'bkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkb',
      'bkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkb',
      'bkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkb',
      'bkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkb',
      'bkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkb',
      'bkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkb',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '..............bb................',
    ],
  },
  hvac: {
    ax: 7,
    ay: 7,
    rows: [
      '.bbbbbbbbbbbb.',
      'bkkkkkkkkkkkkb',
      'bkbkbkbkbkbkbb',
      'bkkkkkkkkkkkkb',
      'bbbbbbbbbbbbbb',
      'b..b......b..b',
    ],
  },
  pedestal: {
    ax: 3,
    ay: 7,
    rows: [
      '..bbbb..',
      '..bwwb..',
      '..bbbb..',
      '...bb...',
      '..bbbb..',
      '.bbbbbb.',
    ],
  },
  bubble: {
    ax: 3,
    ay: 5,
    rows: [
      '.bbbbb.',
      'bw.w.wb',
      'b.w.w.b',
      '.bbbbb.',
      '..bb...',
    ],
  },
  bubble2: {
    ax: 3,
    ay: 5,
    rows: [
      '.bbbbb.',
      'b.www.b',
      'bw.w.wb',
      '.bbbbb.',
      '..bb...',
    ],
  },
};

function feet(rows: string[]): Raw {
  return { rows, ax: (rows[0]?.length ?? 1) >> 1, ay: rows.length - 1 };
}

function buildRaw(): Record<string, Raw> {
  const out: Record<string, Raw> = { ...PROPS };
  WALK.forEach((rows, i) => {
    out[`walk${i}`] = feet(rows);
    out[`walk${i}L`] = feet(flipRows(rows));
  });
  PHONE.forEach((rows, i) => {
    out[`phone${i}`] = feet(rows);
    out[`phone${i}L`] = feet(flipRows(rows));
  });
  CHAT.forEach((rows, i) => {
    out[`chat${i}`] = feet(rows);
    out[`chat${i}L`] = feet(flipRows(rows));
  });
  COFFEE.forEach((rows, i) => {
    out[`coffee${i}`] = feet(rows);
    out[`coffee${i}L`] = feet(flipRows(rows));
  });
  CHEER.forEach((rows, i) => {
    out[`cheer${i}`] = feet(rows);
  });
  TYPE.forEach((rows, i) => {
    out[`type${i}`] = feet(rows);
  });
  return out;
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  pix: Pix;
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

  const pack = (w: number, h: number): { x: number; y: number } => {
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
      if (row.length !== w) throw new Error(`sprite ${name} has uneven rows`);
    }
    const pos = pack(w, h);
    for (let y = 0; y < h; y++) {
      const row = sprite.rows[y] ?? '';
      for (let x = 0; x < w; x++) {
        const ch = row[x] ?? '.';
        const color = INK[ch];
        if (!color) continue;
        pix.px(pos.x + x, pos.y + y, color);
      }
    }
    frames[name] = { x: pos.x, y: pos.y, w, h, ax: sprite.ax, ay: sprite.ay };
  }

  const texts: { name: string; text: string; scale: number; font: 'ui' | 'logo'; color: RGBA }[] = [
    { name: 'logo', text: 'PatSnap', scale: 2, font: 'logo', color: RGB.white },
    { name: 'logoIce', text: 'PatSnap', scale: 2, font: 'logo', color: RGB.ice },
    { name: 'tDEAL', text: 'DEAL', scale: 2, font: 'ui', color: RGB.white },
    { name: 'tDEPLOY', text: 'DEPLOY', scale: 2, font: 'ui', color: RGB.white },
    { name: 'tHI', text: 'HI', scale: 2, font: 'ui', color: RGB.white },
  ];
  for (const item of texts) {
    const gw = item.font === 'logo' ? 5 : 3;
    const gh = item.font === 'logo' ? 7 : 5;
    const w = item.text.length * gw * item.scale + (item.text.length - 1) * item.scale;
    const h = gh * item.scale;
    const pos = pack(w, h);
    stampText(pix, pos.x, pos.y, item.text, item.scale, item.color, item.font);
    frames[item.name] = { x: pos.x, y: pos.y, w, h, ax: w >> 1, ay: h };
  }

  return { canvas: pix.toCanvas(), pix, frames };
}

/** Monitor hole inside the desk sprite, relative to the sprite's top-left. */
export const DESK_SCREEN = { x: 2, y: 1, w: 10, h: 3 };
/** Interior of the lobby big screen. */
export const BIG_SCREEN = { x: 1, y: 1, w: 30, h: 9 };
/** Rack LED pixels relative to the rack sprite top-left. */
export const RACK_LEDS: readonly (readonly [number, number])[] = [
  [2, 2],
  [3, 2],
  [6, 2],
  [7, 2],
  [2, 4],
  [3, 4],
  [6, 4],
  [7, 4],
  [2, 6],
  [3, 6],
  [6, 6],
  [7, 6],
  [2, 8],
  [3, 8],
  [6, 8],
  [7, 8],
  [2, 10],
  [3, 10],
  [6, 10],
  [7, 10],
];
