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

function rndLayout(): FloorLayout {
  const furniture: Furn[] = [];
  const rows = [2, 3, 4, 6, 7, 8];
  const cols = [1, 2, 4, 5];
  for (const y of rows) {
    for (const x of cols) {
      if (stepped(x, y)) furniture.push({ kind: 'desk', x, y, w: 1 });
    }
  }
  for (const x of [7, 8, 9]) {
    if (stepped(x, 1)) furniture.push({ kind: 'table', x, y: 1, w: 1 });
  }
  furniture.push({ kind: 'coffee', x: 9, y: 3, w: 1 });
  for (const [x, y] of [
    [10, 1],
    [1, 10],
    [10, 4],
  ] as const) {
    if (stepped(x, y)) furniture.push({ kind: 'plant', x, y, w: 1 });
  }
  const chat = [
    { x: 8, y: 3 },
    { x: 8, y: 4 },
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
