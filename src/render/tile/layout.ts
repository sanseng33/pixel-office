import type { FloorType } from '../../config/floors.ts';

/** One R&D floor on a near-square grid. Other roles share this generator so they can be filled in later. */
export const PLAN = 12;

export type FurnKind = 'desk' | 'table' | 'plant' | 'coffee';

export interface Furn {
  kind: FurnKind;
  x: number;
  y: number;
  /** Desk spans this many tiles in +x. */
  w: number;
  /** 1 = sitter on the +y side, -1 = sitter on the -y side. Monitors face the sitter. */
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
  // Near corner (high x and high y) is cut in steps so the room reads as open.
  if (x >= 8 && y >= 8) return false;
  if (x >= 9 && y >= 6) return false;
  if (y >= 9 && x >= 6) return false;
  return true;
}

function base(role: FloorType, furniture: readonly Furn[], chat: readonly { x: number; y: number }[]): FloorLayout {
  const block = new Set(furniture.filter((f) => f.kind !== 'plant').map((f) => `${f.x},${f.y}`));
  // Plants block the tile they stand on too.
  for (const f of furniture) {
    if (f.kind === 'plant' || f.kind === 'coffee' || f.kind === 'table') block.add(`${f.x},${f.y}`);
    if (f.kind === 'desk' || f.kind === 'table') {
      for (let i = 0; i < f.w; i++) block.add(`${f.x + i},${f.y}`);
    }
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

function pair(furniture: Furn[], xs: number[], y: number): void {
  for (const x of xs) {
    if (stepped(x, y)) furniture.push({ kind: 'desk', x, y, w: 1, face: -1 });
    if (stepped(x, y + 1)) furniture.push({ kind: 'desk', x, y: y + 1, w: 1, face: 1 });
  }
}

function rndLayout(): FloorLayout {
  const furniture: Furn[] = [];
  // Face-to-face clusters, with a full tile of aisle between them.
  pair(furniture, [1, 2], 2);
  pair(furniture, [4, 5, 6], 2);
  pair(furniture, [1, 2], 5);
  pair(furniture, [4, 5, 6], 5);
  for (const x of [8, 9, 10]) {
    if (stepped(x, 1)) furniture.push({ kind: 'table', x, y: 1, w: 1 });
  }
  if (stepped(9, 4)) furniture.push({ kind: 'coffee', x: 9, y: 4, w: 1 });
  for (const [x, y] of [
    [10, 3],
    [10, 5],
    [1, 10],
  ] as const) {
    if (stepped(x, y)) furniture.push({ kind: 'plant', x, y, w: 1 });
  }
  const chat = [
    { x: 8, y: 4 },
    { x: 8, y: 3 },
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
