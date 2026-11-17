import type { FloorType } from '../../config/floors.ts';

/** One R&D floor on a near-square grid. Other roles share this generator so they can be filled in later. */
export const PLAN = 15;

export type FurnKind = 'desk' | 'table' | 'plant' | 'coffee';

export interface Furn {
  kind: FurnKind;
  x: number;
  y: number;
  /** Span along +x, in tiles. A desk is 2. */
  w: number;
  /** 1 = sitter on the +y side, -1 = sitter on the -y side. Screens face the sitter. */
  face?: 1 | -1;
}

export interface FloorLayout {
  role: FloorType;
  solid: (x: number, y: number) => boolean;
  blocked: (x: number, y: number) => boolean;
  walkable: (x: number, y: number) => boolean;
  furniture: readonly Furn[];
  desks: readonly Furn[];
  /** Tiles where two people can stand and talk. */
  chat: readonly { x: number; y: number }[];
}

function stepped(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= PLAN || y >= PLAN) return false;
  // Near corner (high x and high y) stays stepped, same cut as the 12-grid scaled up.
  if (x >= 10 && y >= 10) return false;
  if (x >= 11 && y >= 8) return false;
  if (y >= 11 && x >= 8) return false;
  return true;
}

function base(role: FloorType, furniture: readonly Furn[], chat: readonly { x: number; y: number }[]): FloorLayout {
  const block = new Set<string>();
  for (const f of furniture) {
    for (let i = 0; i < f.w; i++) block.add(`${f.x + i},${f.y}`);
  }
  const solid = (x: number, y: number) => stepped(x, y);
  const blocked = (x: number, y: number) => block.has(`${x},${y}`);
  return {
    role,
    solid,
    blocked,
    walkable: (x, y) => solid(x, y) && !blocked(x, y),
    furniture,
    desks: furniture.filter((f) => f.kind === 'desk'),
    chat,
  };
}

function desk(furniture: Furn[], x: number, y: number, face: 1 | -1): void {
  if (!stepped(x, y) || !stepped(x + 1, y)) return;
  furniture.push({ kind: 'desk', x, y, w: 2, face });
}

function rndLayout(): FloorLayout {
  const furniture: Furn[] = [];
  // Two face-to-face rows spanning the floor. Monitors meet on the shared line.
  // A tile separates desks in a row; two tiles separate the rows.
  for (const x of [1, 4, 8, 11]) {
    desk(furniture, x, 2, -1);
    desk(furniture, x, 3, 1);
  }
  for (const x of [1, 5, 9]) {
    desk(furniture, x, 6, -1);
    desk(furniture, x, 7, 1);
  }

  if (stepped(8, 9) && stepped(9, 9)) furniture.push({ kind: 'table', x: 8, y: 9, w: 2 });
  if (stepped(12, 5) && stepped(13, 5)) furniture.push({ kind: 'coffee', x: 12, y: 5, w: 2 });
  for (const [x, y] of [
    [14, 2],
    [13, 7],
    [4, 10],
    [2, 12],
  ] as const) {
    if (stepped(x, y)) furniture.push({ kind: 'plant', x, y, w: 1 });
  }
  const chat = [
    { x: 11, y: 4 },
    { x: 11, y: 5 },
  ].filter((p) => stepped(p.x, p.y));
  return base('rnd', furniture, chat);
}

/** Lobby, lounge, sales, IT, and vacant reuse the same cutaway shell. Their furniture is filled in when those floors are stacked. */
function shell(role: FloorType): FloorLayout {
  return base(role, [], []);
}

export function layoutFor(role: FloorType): FloorLayout {
  if (role === 'rnd') return rndLayout();
  return shell(role);
}
