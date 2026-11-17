import type { FloorType } from '../../config/floors.ts';

/** One floor on a near-square grid. The near corner is stepped so a stack still shows each interior. */
export const PLAN = 15;

export type FurnKind =
  | 'desk'
  | 'table'
  | 'plant'
  | 'coffee'
  | 'sofa'
  | 'screen'
  | 'gate'
  | 'pong'
  | 'rack'
  | 'box'
  | 'board'
  | 'room'
  | 'cable'
  | 'marker';

export interface Furn {
  kind: FurnKind;
  x: number;
  y: number;
  /** Span along +x, in tiles. A desk is 2. */
  w: number;
  /** 1 = sitter on the +y side, -1 = sitter on the -y side. Screens face the sitter. */
  face?: 1 | -1;
}

export interface Anchor {
  x: number;
  y: number;
  pose: 'sit' | 'chat' | 'walk';
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
  anchors: readonly Anchor[];
}

function stepped(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= PLAN || y >= PLAN) return false;
  if (x >= 10 && y >= 10) return false;
  if (x >= 11 && y >= 8) return false;
  if (y >= 11 && x >= 8) return false;
  return true;
}

function base(
  role: FloorType,
  furniture: readonly Furn[],
  chat: readonly { x: number; y: number }[],
  anchors: readonly Anchor[] = [],
): FloorLayout {
  const block = new Set<string>();
  for (const f of furniture) {
    const depth = f.kind === 'room' ? 2 : 1;
    const blocks = f.kind !== 'cable' && f.kind !== 'marker';
    if (!blocks) continue;
    for (let j = 0; j < depth; j++) {
      for (let i = 0; i < f.w; i++) block.add(`${f.x + i},${f.y + j}`);
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
    anchors,
  };
}

function put(furniture: Furn[], kind: FurnKind, x: number, y: number, w = 1, face?: 1 | -1): void {
  for (let i = 0; i < w; i++) if (!stepped(x + i, y)) return;
  furniture.push({ kind, x, y, w, face });
}

function desk(furniture: Furn[], x: number, y: number, face: 1 | -1): void {
  put(furniture, 'desk', x, y, 2, face);
}

function rndLayout(): FloorLayout {
  const furniture: Furn[] = [];
  for (const x of [1, 4, 8, 11]) {
    desk(furniture, x, 2, -1);
    desk(furniture, x, 3, 1);
  }
  for (const x of [1, 5, 9]) {
    desk(furniture, x, 6, -1);
    desk(furniture, x, 7, 1);
  }
  put(furniture, 'table', 8, 9, 2);
  put(furniture, 'coffee', 12, 5, 2);
  put(furniture, 'plant', 14, 2);
  put(furniture, 'plant', 13, 7);
  put(furniture, 'plant', 4, 10);
  put(furniture, 'plant', 2, 12);
  const chat = [
    { x: 11, y: 4 },
    { x: 11, y: 5 },
  ].filter((p) => stepped(p.x, p.y));
  return base('rnd', furniture, chat);
}

/** 5F is the same kit with a shorter desk row and a whiteboard, so the two labs are not copies. */
function rndSmall(): FloorLayout {
  const furniture: Furn[] = [];
  for (const x of [1, 5, 9]) {
    desk(furniture, x, 3, -1);
    desk(furniture, x, 4, 1);
  }
  put(furniture, 'board', 12, 2, 2);
  put(furniture, 'coffee', 2, 8, 2);
  put(furniture, 'table', 8, 8, 2);
  put(furniture, 'plant', 13, 6);
  put(furniture, 'plant', 4, 10);
  const chat = [
    { x: 4, y: 8 },
    { x: 5, y: 8 },
  ].filter((p) => stepped(p.x, p.y));
  return base('rnd', furniture, chat);
}

function lobbyLayout(): FloorLayout {
  const furniture: Furn[] = [];
  put(furniture, 'screen', 2, 1, 2);
  put(furniture, 'screen', 6, 1, 3);
  put(furniture, 'screen', 11, 1, 2);
  put(furniture, 'desk', 5, 4, 4, 1);
  put(furniture, 'sofa', 1, 7, 2);
  put(furniture, 'sofa', 9, 7, 2);
  put(furniture, 'plant', 4, 7);
  put(furniture, 'plant', 12, 6);
  put(furniture, 'gate', 3, 11);
  put(furniture, 'gate', 7, 11);
  const chat = [
    { x: 4, y: 6 },
    { x: 8, y: 7 },
  ].filter((p) => stepped(p.x, p.y));
  const anchors: Anchor[] = [
    { x: 2, y: 10, pose: 'walk' },
    { x: 6, y: 9, pose: 'walk' },
    { x: 8, y: 11, pose: 'walk' },
  ];
  return base('lobby', furniture, chat, anchors);
}

function loungeLayout(): FloorLayout {
  const furniture: Furn[] = [];
  put(furniture, 'coffee', 1, 2, 2);
  put(furniture, 'sofa', 5, 2, 2);
  put(furniture, 'sofa', 9, 2, 2);
  put(furniture, 'table', 5, 5, 1);
  put(furniture, 'table', 8, 5, 1);
  put(furniture, 'table', 11, 5, 1);
  put(furniture, 'pong', 10, 8, 3);
  put(furniture, 'plant', 14, 3);
  put(furniture, 'plant', 3, 8);
  put(furniture, 'plant', 7, 10);
  const chat = [
    { x: 3, y: 2 },
    { x: 4, y: 3 },
  ].filter((p) => stepped(p.x, p.y));
  const anchors: Anchor[] = [
    { x: 5, y: 3, pose: 'sit' },
    { x: 9, y: 3, pose: 'sit' },
    { x: 3, y: 2, pose: 'chat' },
    { x: 4, y: 3, pose: 'chat' },
  ];
  return base('lounge', furniture, chat, anchors);
}

function salesLayout(): FloorLayout {
  const furniture: Furn[] = [];
  for (const x of [1, 4]) {
    desk(furniture, x, 2, -1);
    desk(furniture, x, 3, 1);
  }
  for (const x of [8, 11]) {
    desk(furniture, x, 2, -1);
    desk(furniture, x, 3, 1);
  }
  put(furniture, 'room', 1, 6, 4);
  put(furniture, 'board', 8, 6, 2);
  put(furniture, 'table', 11, 7, 2);
  put(furniture, 'plant', 7, 8);
  put(furniture, 'plant', 13, 6);
  const chat = [
    { x: 6, y: 7 },
    { x: 6, y: 8 },
  ].filter((p) => stepped(p.x, p.y));
  return base('sales', furniture, chat);
}

function itLayout(): FloorLayout {
  const furniture: Furn[] = [];
  for (const x of [1, 4]) {
    desk(furniture, x, 2, -1);
    desk(furniture, x, 3, 1);
  }
  put(furniture, 'rack', 9, 2);
  put(furniture, 'rack', 11, 2);
  put(furniture, 'rack', 13, 2);
  put(furniture, 'cable', 9, 4, 5);
  put(furniture, 'desk', 9, 6, 2, 1);
  put(furniture, 'desk', 12, 6, 2, 1);
  put(furniture, 'plant', 7, 6);
  put(furniture, 'plant', 4, 8);
  const chat = [
    { x: 7, y: 3 },
    { x: 8, y: 4 },
  ].filter((p) => stepped(p.x, p.y));
  return base('it', furniture, chat);
}

function vacantLayout(): FloorLayout {
  const furniture: Furn[] = [];
  put(furniture, 'box', 3, 3);
  put(furniture, 'box', 4, 3);
  put(furniture, 'box', 9, 5, 2);
  put(furniture, 'marker', 6, 8);
  put(furniture, 'marker', 12, 4);
  put(furniture, 'marker', 2, 10);
  return base('vacant', furniture, []);
}

export function layoutFor(role: FloorType, level = 7): FloorLayout {
  if (role === 'rnd') return level === 5 ? rndSmall() : rndLayout();
  if (role === 'lobby') return lobbyLayout();
  if (role === 'lounge') return loungeLayout();
  if (role === 'sales') return salesLayout();
  if (role === 'it') return itLayout();
  if (role === 'vacant') return vacantLayout();
  return base(role, [], []);
}
