import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/examples/jsm/postprocessing/RenderPixelatedPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VIEW } from '../config/display.ts';
import type { FloorConfig, FloorType } from '../config/floors.ts';
import type { OfficeEvent, OfficeEventType } from '../events/source.ts';

const W = 14;
const D = 7;
const STOREY = 3.2;
const SX = 1.65;
const SY = 1;
const SZ = 1;
const SLAB = 0.26;
const FILL = 0x0c1a2c;
const EDGE = 0x7fdbff;
const WHITE = 0xffffff;
const BRIGHT = 0xbff4ff;
const DEEP = 0x2e9bff;

const fillMat = new MeshBasicMaterial({ color: FILL });
const edgeMat = new LineBasicMaterial({ color: EDGE });
const iceMat = new MeshBasicMaterial({ color: EDGE });
const whiteMat = new MeshBasicMaterial({ color: WHITE });
const brightMat = new MeshBasicMaterial({ color: BRIGHT });
const deepMat = new MeshBasicMaterial({ color: DEEP });

type Kind = 'sit' | 'phone' | 'walk' | 'chat' | 'swing' | 'cheer' | 'idle';

interface Person {
  group: Group;
  arm: Group;
  kind: Kind;
  home: Kind;
  floor: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  moving: number;
  timer: number;
  phase: number;
  role: number;
  baseY: number;
  seed: number;
}

interface Desk {
  floor: number;
  x: number;
  z: number;
  y: number;
}

interface Path {
  xyz: Float32Array;
  dist: Float32Array;
  total: number;
}

export interface OfficeView {
  canvas: HTMLCanvasElement;
  update(dt: number, now: number): void;
  resize(displayPx: number): void;
  push(event: OfficeEvent): void;
  levelsFor(type: OfficeEventType): number[];
  setHour(hour: number): void;
}

export function createOffice(configs: readonly FloorConfig[]): OfficeView {
  const floors = [...configs].sort((a, b) => a.level - b.level);
  const scene = new Scene();
  scene.background = new Color(0x060910);

  const fills: BufferGeometry[] = [];
  const edge: number[] = [];
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new BoxGeometry(w, h, d);
    g.translate(x, y, z);
    fills.push(g);
    const e = new EdgesGeometry(g, 1);
    const p = e.getAttribute('position');
    for (let i = 0; i < p.count; i++) edge.push(p.getX(i), p.getY(i), p.getZ(i));
    e.dispose();
  };

  const paths: Path[] = [];
  const addPath = (pts: Vector3[], speedHint = 1) => {
    const xyz = new Float32Array(pts.length * 3);
    const dist = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p) continue;
      xyz[i * 3] = p.x;
      xyz[i * 3 + 1] = p.y;
      xyz[i * 3 + 2] = p.z;
      if (i > 0) {
        const q = pts[i - 1];
        dist[i] = (dist[i - 1] ?? 0) + (q ? p.distanceTo(q) : 0);
      }
    }
    paths.push({ xyz, dist, total: dist[pts.length - 1] || 1 });
    void speedHint;
  };

  for (const cfg of floors) buildStorey(cfg, addBox, addPath);
  buildRoof(addBox, addPath);
  buildStairs(addBox);
  buildFrame(addBox);

  const shell = new Group();
  shell.scale.set(SX, SY, SZ);
  scene.add(shell);
  const merged = mergeGeometries(fills, false);
  for (const g of fills) g.dispose();
  if (merged) shell.add(new Mesh(merged, fillMat));
  for (const n of looseLines) edge.push(n);
  const eg = new BufferGeometry();
  eg.setAttribute('position', new Float32BufferAttribute(edge, 3));
  shell.add(new LineSegments(eg, edgeMat));

  for (const cfg of floors) addLabel(scene, cfg);

  const desks = collectDesks(floors);
  const deskMesh = makeInstances(desks, new BoxGeometry(1.05, 0.72, 0.62), 0, 0.36, 0, fillMat, false);
  const chairMesh = makeInstances(desks, new BoxGeometry(0.46, 0.7, 0.42), 0, 0.4, 0.58, fillMat, false);
  const monGeo = new BoxGeometry(0.78, 0.52, 0.08);
  const monMesh = makeInstances(desks, monGeo, 0, 1.05, -0.18, whiteMat, true);
  scene.add(deskMesh, chairMesh, monMesh);
  const furn: number[] = [];
  for (const d of desks) {
    stampBox(furn, 1.05, 0.72, 0.62, d.x * SX, d.y * SY + 0.36, d.z * SZ);
    stampBox(furn, 0.46, 0.7, 0.42, d.x * SX, d.y * SY + 0.4, (d.z + 0.58) * SZ);
    stampBox(furn, 0.78, 0.52, 0.08, d.x * SX, d.y * SY + 1.05, (d.z - 0.18) * SZ);
  }
  const fg = new BufferGeometry();
  fg.setAttribute('position', new Float32BufferAttribute(furn, 3));
  scene.add(new LineSegments(fg, edgeMat));

  const extras = new Group();
  extras.scale.set(SX, SY, SZ);
  scene.add(extras);
  const gong = addUnique(extras, floors);
  for (const child of extras.children) child.scale.set(1 / SX, 1 / SY, 1 / SZ);
  const people = spawnPeople(floors, desks);
  for (const p of people) scene.add(p.group);

  const sign = makeSign();
  sign.position.set(W * 0.42 * SX, (floors.length * STOREY + 1.05) * SY, D * 0.28 * SZ);
  sign.rotation.y = Math.PI / 4;
  scene.add(sign);

  const pulses = makePulses(paths);
  for (const m of pulses.meshes) scene.add(m);

  const target = new Vector3(W * 0.42 * SX, floors.length * STOREY * 0.43 * SY, D * 0.36 * SZ);
  const dist = 80;
  const s = dist / Math.sqrt(3);
  const basePos = new Vector3(target.x + s, target.y + s * 1.08, target.z + s);
  const camera = new OrthographicCamera(-16.2, 16.2, 16.2, -16.2, 0.1, 500);
  camera.position.copy(basePos);
  camera.lookAt(target);

  const renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x060910, 1);
  renderer.outputColorSpace = SRGBColorSpace;
  const composer = new EffectComposer(renderer);
  const pixelPass = new RenderPixelatedPass(2, scene, camera);
  pixelPass.normalEdgeStrength = 0.22;
  pixelPass.depthEdgeStrength = 0.4;
  composer.addPass(pixelPass);

  const hotUntil = new Float64Array(8);
  let carY = STOREY * 0.5;
  let carTo = 4;
  const car = extras.getObjectByName('car');
  const color = new Color();
  let hour = -1;

  const levelsOf = (type: FloorType) => floors.filter((f) => f.type === type).map((f) => f.level);

  function apply(ev: OfficeEvent, now: number): void {
    if (ev.type !== 'visitorArrived') hotUntil[ev.level] = now + ev.ttlMs;
    if (ev.type === 'dealClosed') {
      const who = people.find((p) => p.floor === ev.level && p.home === 'phone');
      if (who) {
        who.kind = 'cheer';
        who.timer = ev.ttlMs / 1000;
      }
      if (gong) (gong.material as MeshBasicMaterial).color.set(WHITE);
    } else if (ev.type === 'visitorArrived') {
      const who = people.find((p) => p.floor === ev.level && p.role === 2);
      if (who) {
        who.x = 2;
        who.z = D - 1.2;
        who.tx = W * 0.45;
        who.tz = D * 0.55;
        who.moving = 1;
        who.kind = 'walk';
      }
    }
  }

  return {
    canvas: renderer.domElement,
    levelsFor(type) {
      if (type === 'dealClosed') return levelsOf('sales');
      if (type === 'deploySuccess') return levelsOf('rnd');
      return levelsOf('lobby');
    },
    push(ev) {
      apply(ev, performance.now());
    },
    setHour(h) {
      if (h === hour) return;
      hour = h;
      const night = h >= 20 || h < 6;
      const dusk = !night && (h >= 17 || h < 7);
      renderer.setClearColor(night ? 0x04060c : dusk ? 0x050810 : 0x060910, 1);
    },
    resize(displayPx) {
      const pixelSize = Math.max(2, Math.round(displayPx / VIEW));
      renderer.setSize(displayPx, displayPx, false);
      composer.setSize(displayPx, displayPx);
      pixelPass.setPixelSize(pixelSize);
    },
    update(dt, now) {
      const sec = Math.min(0.05, dt);
      for (const p of people) stepPerson(p, sec);
      stepPulses(pulses, paths, sec);
      if (car) {
        const dest = (carTo - 0.5) * STOREY;
        carY += Math.sign(dest - carY) * sec * 1.6;
        if (Math.abs(dest - carY) < 0.05) carTo = 1 + ((carTo + 2) % 7);
        car.position.y = carY;
      }
      const flick = (now / 180) | 0;
      for (let i = 0; i < desks.length; i++) {
        const desk = desks[i];
        if (!desk) continue;
        const hot = now < hotUntil[desk.floor];
        color.set(hot || (flick + i) % 4 === 0 ? WHITE : BRIGHT);
        monMesh.setColorAt(i, color);
      }
      if (monMesh.instanceColor) monMesh.instanceColor.needsUpdate = true;
      if (gong) {
        const sales = floors.find((f) => f.type === 'sales');
        const lit = sales ? now < hotUntil[sales.level] : false;
        (gong.material as MeshBasicMaterial).color.set(lit ? WHITE : EDGE);
      }
      for (const p of people) {
        if (p.kind === 'cheer' && p.timer <= 0) p.kind = p.home;
      }
      composer.render();
    },
  };

  function stepPerson(p: Person, dt: number): void {
    p.phase += dt;
    p.timer -= dt;
    if (p.moving || p.kind === 'walk') {
      const dx = p.tx - p.x;
      const dz = p.tz - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.08) {
        p.x = p.tx;
        p.z = p.tz;
        if (p.home === 'walk' || p.role === 2) {
          const ox = p.tx;
          const oz = p.tz;
          p.tx = p.role === 2 ? (ox > W * 0.5 ? 2.2 : W - 2.2) : ox > 7 ? 3 : 11;
          p.tz = oz;
        } else {
          p.moving = 0;
          p.kind = p.home;
          p.timer = 1.2 + (p.seed % 5) * 0.4;
        }
      } else {
        const step = Math.min(1.6 * dt, dist);
        p.x += (dx / dist) * step;
        p.z += (dz / dist) * step;
        p.kind = 'walk';
        p.group.rotation.y = Math.atan2(dx, dz);
      }
      const bob = Math.abs(Math.sin(p.phase * 8)) * 0.08;
      p.group.position.set(p.x * SX, (p.baseY + bob) * SY, p.z * SZ);
      p.arm.rotation.x = Math.sin(p.phase * 8) * 0.6;
    } else {
      const sit = p.home === 'sit' || p.home === 'phone' || p.kind === 'sit' || p.kind === 'phone';
      const y = p.baseY - (sit ? 0.45 : 0) + Math.sin(p.phase * (p.kind === 'swing' ? 10 : 3)) * (p.kind === 'cheer' ? 0.12 : 0.03);
      p.group.position.set(p.x * SX, y * SY, p.z * SZ);
      p.arm.rotation.x = p.kind === 'swing' ? Math.sin(p.phase * 10) * 1.1 : p.kind === 'phone' ? -0.8 : Math.sin(p.phase * 6) * 0.35;
      if (p.kind === 'cheer') p.arm.rotation.z = -1.2;
      else p.arm.rotation.z = 0;
      if (p.timer <= 0 && p.kind !== 'swing') {
        p.seed = (Math.imul(p.seed, 1664525) + 1013904223) >>> 0;
        const r = (p.seed % 1000) / 1000;
        if (r > 0.72 && (p.home === 'sit' || p.home === 'phone')) {
          p.tx = Math.min(W - 1.5, Math.max(1.5, p.x + (r > 0.85 ? 2.2 : -2.2)));
          p.tz = p.z;
          p.moving = 1;
          p.kind = 'walk';
        } else {
          p.kind = r < 0.15 ? 'idle' : p.home;
          p.timer = 1.4 + r * 3;
        }
      }
    }
  }
}

function buildStorey(
  cfg: FloorConfig,
  addBox: (w: number, h: number, d: number, x: number, y: number, z: number) => void,
  addPath: (pts: Vector3[], speed?: number) => void,
): void {
  const y0 = (cfg.level - 1) * STOREY;
  const ySlab = y0 + SLAB / 2;
  addLSlab(addBox, ySlab);
  addBox(0.16, STOREY - SLAB, D, 0.08, y0 + SLAB + (STOREY - SLAB) / 2, D / 2);
  addBox(W, STOREY - SLAB, 0.16, W / 2, y0 + SLAB + (STOREY - SLAB) / 2, 0.08);
  const yb = y0 + SLAB;
  const yt = y0 + STOREY - 0.02;
  const grid: number[] = [];
  for (let z = 0.4; z <= D - 0.2; z += 1.7) grid.push(0.2, yb, z, 0.2, yt, z);
  for (let y = yb + 0.9; y < yt; y += 1.15) grid.push(0.2, y, 0.15, 0.2, y, D - 0.15);
  for (let x = 0.6; x <= W - 0.2; x += 1.75) grid.push(x, yb, 0.2, x, yt, 0.2);
  for (let y = yb + 0.9; y < yt; y += 1.15) grid.push(0.15, y, 0.2, W - 0.15, y, 0.2);
  pushLines(grid);
  addPath(
    [
      new Vector3(0, yb, 0),
      new Vector3(W, yb, 0),
      new Vector3(W, yb, D),
      new Vector3(0, yb, D),
      new Vector3(0, yb, 0),
    ],
    1,
  );
  const bolt = new Vector3(0.4, yb + 1.4, 1);
  pushLines([
    bolt.x, bolt.y, bolt.z,
    bolt.x + 0.8, bolt.y + 0.7, bolt.z + 0.2,
    bolt.x + 0.5, bolt.y + 1.3, bolt.z - 0.1,
    bolt.x + 1.3, bolt.y + 0.9, bolt.z + 0.5,
  ]);
}

const looseLines: number[] = [];
function pushLines(pts: number[]): void {
  for (const n of pts) looseLines.push(n);
}

const CUT_X = 4.2;
const CUT_Z = 2.3;

function addLSlab(addBox: (w: number, h: number, d: number, x: number, y: number, z: number) => void, y: number): void {
  const depth = D - CUT_Z;
  addBox(W, SLAB, depth, W / 2, y, depth / 2);
  const width = W - CUT_X;
  addBox(width, SLAB, CUT_Z, width / 2, y, D - CUT_Z / 2);
}

function buildRoof(addBox: (w: number, h: number, d: number, x: number, y: number, z: number) => void, addPath: (pts: Vector3[]) => void): void {
  const y = 7 * STOREY;
  addLSlab(addBox, y + SLAB / 2);
  const py = y + SLAB + 0.22;
  addBox(W, 0.45, 0.12, W / 2, py, 0.06);
  addBox(W - CUT_X, 0.45, 0.12, (W - CUT_X) / 2, py, D - 0.06);
  addBox(0.12, 0.45, D, 0.06, py, D / 2);
  addBox(0.12, 0.45, D - CUT_Z, W - 0.06, py, (D - CUT_Z) / 2);
  addBox(0.12, 0.45, CUT_Z, W - CUT_X, py, D - CUT_Z / 2);
  addBox(1.4, 0.7, 1.1, W - 2.2, y + SLAB + 0.4, 1.4);
  addBox(1.2, 0.55, 0.9, W - 3.8, y + SLAB + 0.32, 2.6);
  addBox(0.08, 1.5, 0.08, 2.2, y + SLAB + 0.9, 1.6);
  addPath([
    new Vector3(0, y + SLAB, 0),
    new Vector3(W, y + SLAB, 0),
    new Vector3(W, y + SLAB, D),
    new Vector3(0, y + SLAB, D),
    new Vector3(0, y + SLAB, 0),
  ]);
}

function buildStairs(addBox: (w: number, h: number, d: number, x: number, y: number, z: number) => void): void {
  for (let level = 0; level < 7; level++) {
    const y0 = level * STOREY + SLAB;
    for (let s = 0; s < 6; s++) {
      const t = s / 6;
      addBox(1.15, 0.12, 0.55, 0.85, y0 + t * (STOREY - SLAB), 0.45 + s * 0.7);
    }
  }
}

function buildFrame(addBox: (w: number, h: number, d: number, x: number, y: number, z: number) => void): void {
  const h = 7 * STOREY + SLAB;
  const posts: readonly (readonly [number, number])[] = [
    [0.12, 0.12],
    [W - 0.12, 0.12],
    [0.12, D - 0.12],
    [W - 0.12, D - 0.12],
  ];
  for (const p of posts) addBox(0.22, h, 0.22, p[0], h / 2, p[1]);
  const sx = W - 1.7;
  const sz = 1.2;
  for (const dx of [-0.55, 0.55]) {
    for (const dz of [-0.55, 0.55]) addBox(0.14, h, 0.14, sx + dx, h / 2, sz + dz);
  }
}

const GLYPH: Record<string, string[]> = {
  A: ['01110', '10001', '11111', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000'],
  G: ['01111', '10000', '10111', '10001', '01111'],
  I: ['11111', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '11110', '10000', '10000'],
  R: ['11110', '10001', '11110', '10100', '10010'],
  S: ['01111', '10000', '01110', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '01010', '00100'],
  Y: ['10001', '01010', '00100', '00100', '00100'],
  '&': ['01010', '10101', '01010', '10101', '01010'],
  '1': ['00100', '01100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00110', '01000', '11111'],
  '3': ['11110', '00001', '01110', '00001', '11110'],
  '4': ['10001', '10001', '11111', '00001', '00001'],
  '5': ['11111', '10000', '11110', '00001', '11110'],
  '6': ['01110', '10000', '11110', '10001', '01110'],
  '7': ['11111', '00010', '00100', '01000', '01000'],
  ' ': ['00000', '00000', '00000', '00000', '00000'],
};

function paintText(g: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, color: string): void {
  g.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    const rows = GLYPH[ch] ?? GLYPH[ch.toUpperCase()] ?? GLYPH[' '];
    for (let r = 0; r < (rows?.length ?? 0); r++) {
      const row = rows?.[r] ?? '';
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== '1') continue;
        g.fillRect(cx + c * scale, y + r * scale, scale, scale);
      }
    }
    cx += 6 * scale;
  }
}

function addLabel(scene: Scene, cfg: FloorConfig): void {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.fillStyle = '#071018';
  g.fillRect(0, 0, 256, 96);
  g.strokeStyle = '#7FDBFF';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 90);
  paintText(g, cfg.label, 10, 8, 7, '#ffffff');
  paintText(g, cfg.name, 10, 52, 5, '#7FDBFF');
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(3.4, 1.05), new MeshBasicMaterial({ map: tex }));
  const y = (cfg.level - 1) * STOREY + 1.15;
  mesh.position.set(2.4 * SX, y * SY, 5.5 * SZ);
  mesh.rotation.y = Math.PI / 4;
  scene.add(mesh);
}

function collectDesks(floors: readonly FloorConfig[]): Desk[] {
  const out: Desk[] = [];
  for (const cfg of floors) {
    if (cfg.type !== 'sales' && cfg.type !== 'it' && cfg.type !== 'rnd') continue;
    const y = (cfg.level - 1) * STOREY + SLAB;
    const rows = cfg.type === 'it'
      ? [{ z: 3.15, n: 6, x0: 1.6, x1: 8.4 }, { z: 5.15, n: 6, x0: 1.6, x1: 8.2 }]
      : [
          { z: 1.55, n: 8, x0: 1.7, x1: 12.2 },
          { z: 3.15, n: 8, x0: 1.7, x1: 12.2 },
          { z: 5.15, n: 6, x0: 1.7, x1: 8.4 },
        ];
    let placed = 0;
    for (const row of rows) {
      if (placed >= cfg.stations) break;
      const count = Math.min(row.n, cfg.stations - placed);
      for (let c = 0; c < count; c++) {
        const x = count === 1 ? row.x0 : row.x0 + c * ((row.x1 - row.x0) / (count - 1));
        out.push({ floor: cfg.level, x, z: row.z, y });
        placed += 1;
      }
    }
  }
  return out;
}

function makeInstances(
  desks: Desk[],
  geo: BoxGeometry,
  ox: number,
  oy: number,
  oz: number,
  material: MeshBasicMaterial,
  tint: boolean,
): InstancedMesh {
  const mesh = new InstancedMesh(geo, material, Math.max(1, desks.length));
  const m = new Matrix4();
  for (let i = 0; i < desks.length; i++) {
    const d = desks[i];
    if (!d) continue;
    m.makeTranslation((d.x + ox) * SX, d.y * SY + oy, (d.z + oz) * SZ);
    mesh.setMatrixAt(i, m);
    if (tint) mesh.setColorAt(i, new Color(WHITE));
  }
  mesh.count = Math.max(1, desks.length);
  return mesh;
}

function stampBox(edge: number[], w: number, h: number, d: number, x: number, y: number, z: number): void {
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const y0 = y - h / 2;
  const y1 = y + h / 2;
  const z0 = z - d / 2;
  const z1 = z + d / 2;
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ];
  const segs = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (const pair of segs) {
    const a = c[pair[0] ?? 0];
    const b = c[pair[1] ?? 0];
    if (!a || !b) continue;
    edge.push(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, b[0] ?? 0, b[1] ?? 0, b[2] ?? 0);
  }
}

function addUnique(group: Group, floors: readonly FloorConfig[]): Mesh | null {
  let gong: Mesh | null = null;
  for (const cfg of floors) {
    const y = (cfg.level - 1) * STOREY + SLAB;
    if (cfg.type === 'sales') {
      const disc = new Mesh(new CylinderGeometry(0.55, 0.55, 0.08, 16), whiteMat);
      disc.position.set(11.6, y + 1.55, 4.4);
      disc.rotation.x = Math.PI / 2;
      group.add(disc);
      gong = disc;
      group.add(post(11.6, y + 0.75, 4.4));
      const kpi = new Mesh(new BoxGeometry(2.4, 1.15, 0.08), whiteMat);
      kpi.position.set(6.2, y + 1.9, 0.28);
      group.add(kpi);
    }
    if (cfg.type === 'it') {
      for (let i = 0; i < 4; i++) {
        const rack = new Mesh(new BoxGeometry(0.7, 2.1, 0.55), fillMat);
        rack.position.set(11.2 + (i % 2) * 0.9, y + 1.15, 1.3 + Math.floor(i / 2) * 0.9);
        rack.name = 'rack';
        rack.add(new LineSegments(new EdgesGeometry(rack.geometry), edgeMat));
        group.add(rack);
        const leds = new Mesh(new BoxGeometry(0.08, 1.5, 0.02), brightMat);
        leds.position.set(rack.position.x + 0.2, y + 1.2, rack.position.z + 0.28);
        group.add(leds);
      }
    }
    if (cfg.type === 'lobby') {
      group.add(box(3.2, 0.9, 1.1, 4.2, y + 0.55, 2.2));
      group.add(box(0.18, 1.1, 0.18, 2.2, y + 0.7, 5.4));
      group.add(box(0.18, 1.1, 0.18, 3.4, y + 0.7, 5.4));
      group.add(box(1.4, 0.08, 0.08, 2.8, y + 0.9, 5.4));
      const screen = new Mesh(new BoxGeometry(2.2, 1.2, 0.08), whiteMat);
      screen.position.set(8.5, y + 1.8, 0.25);
      group.add(screen);
      for (const pz of [1.2, 4.2]) group.add(plant(1.2, y, pz));
      group.add(plant(11, y, 2));
    }
    if (cfg.type === 'lounge') {
      group.add(box(2.4, 0.45, 0.9, 3.2, y + 0.4, 2.4));
      group.add(box(2.4, 0.7, 0.18, 3.2, y + 0.85, 2.0));
      group.add(box(2.6, 0.9, 0.7, 10.2, y + 0.55, 1.6));
      group.add(box(0.35, 0.45, 0.35, 9.2, y + 0.35, 2.5));
      group.add(box(0.35, 0.45, 0.35, 11.2, y + 0.35, 2.5));
      const table = box(2.2, 0.1, 1.2, 6.4, y + 0.7, 4.2);
      group.add(table);
      const net = new Mesh(new BoxGeometry(0.06, 0.35, 1.15), whiteMat);
      net.position.set(6.4, y + 0.95, 4.2);
      group.add(net);
      group.add(plant(1.3, y, 4.5));
    }
    if (cfg.type === 'rnd') {
      const board = new Mesh(new BoxGeometry(1.8, 1.0, 0.06), whiteMat);
      board.position.set(2.2, y + 1.7, 0.22);
      group.add(board);
      if (cfg.level === 7) {
        group.add(box(2.2, 0.8, 0.8, 11, y + 0.5, 4.6));
        group.add(box(1.6, 0.5, 0.6, 11, y + 1.15, 4.6));
      }
    }
    if (cfg.type === 'vacant') {
      for (const [cx, cz] of [
        [4, 3],
        [7, 4.5],
        [10, 2.5],
      ] as const) {
        const cone = new Mesh(new ConeGeometry(0.28, 0.7, 8), edgeMat);
        cone.position.set(cx, y + 0.4, cz);
        group.add(cone);
      }
      group.add(box(0.8, 0.5, 0.8, 5.5, y + 0.3, 5));
      group.add(box(0.7, 0.45, 0.7, 8.5, y + 0.28, 2));
    }
  }
  const car = new Mesh(new BoxGeometry(1.05, 2.2, 1.05), fillMat);
  car.name = 'car';
  car.position.set(W - 1.7, STOREY * 0.6, 1.2);
  car.add(new LineSegments(new EdgesGeometry(car.geometry), edgeMat));
  group.add(car);
  return gong;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), fillMat);
  m.position.set(x, y, z);
  m.add(new LineSegments(new EdgesGeometry(m.geometry), edgeMat));
  return m;
}
function post(x: number, y: number, z: number): Mesh {
  return box(0.12, 1.3, 0.12, x, y, z);
}
function plant(x: number, y: number, z: number): Group {
  const g = new Group();
  const pot = box(0.35, 0.3, 0.35, 0, 0.2, 0);
  const leaf = box(0.55, 0.45, 0.55, 0, 0.6, 0);
  g.add(pot, leaf);
  g.position.set(x, y, z);
  return g;
}

function spawnPeople(floors: readonly FloorConfig[], desks: Desk[]): Person[] {
  const out: Person[] = [];
  const legG = new BoxGeometry(0.16, 0.7, 0.16);
  const bodyG = new BoxGeometry(0.46, 0.55, 0.28);
  const headG = new BoxGeometry(0.36, 0.36, 0.36);
  const armG = new BoxGeometry(0.12, 0.5, 0.12);
  let seed = 7;
  const add = (floor: number, x: number, z: number, home: Kind, role: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const group = new Group();
    const leg = new Mesh(legG, deepMat);
    leg.position.set(-0.12, 0.35, 0);
    const leg2 = new Mesh(legG, deepMat);
    leg2.position.set(0.12, 0.35, 0);
    const body = new Mesh(bodyG, iceMat);
    body.position.y = 0.95;
    const head = new Mesh(headG, whiteMat);
    head.position.y = 1.42;
    const arm = new Group();
    arm.position.set(0.3, 1.15, 0);
    const armMesh = new Mesh(armG, fillMat);
    armMesh.position.y = -0.22;
    arm.add(armMesh);
    group.add(leg, leg2, body, head, arm);
    const baseY = (floor - 1) * STOREY + SLAB;
    group.position.set(x * SX, baseY * SY, z * SZ);
    out.push({
      group,
      arm,
      kind: home,
      home,
      floor,
      x,
      z,
      tx: x,
      tz: z,
      moving: home === 'walk' ? 1 : 0,
      timer: 1 + (seed % 4),
      phase: (seed % 20) / 5,
      role,
      baseY,
      seed,
    });
  };
  for (const cfg of floors) {
    if (cfg.type === 'lobby') {
      add(cfg.level, 4.2, 3.2, 'sit', 0);
      for (let i = 0; i < cfg.people; i++) add(cfg.level, 3 + i * 1.3, 5.2, 'walk', 2);
    } else if (cfg.type === 'lounge') {
      add(cfg.level, 5.4, 4.6, 'swing', 3);
      add(cfg.level, 7.4, 4.6, 'swing', 3);
      add(cfg.level, 2.6, 3.2, 'chat', 3);
      add(cfg.level, 4.0, 3.2, 'chat', 3);
      add(cfg.level, 9.4, 2.6, 'chat', 3);
      add(cfg.level, 11.0, 2.6, 'chat', 3);
    } else if (cfg.type === 'vacant') {
      continue;
    } else {
      const mine = desks.filter((d) => d.floor === cfg.level);
      const n = Math.round(mine.length * cfg.occupancy);
      for (let i = 0; i < n; i++) {
        const d = mine[i];
        if (!d) continue;
        add(cfg.level, d.x, d.z + 0.55, cfg.type === 'sales' ? 'phone' : 'sit', cfg.type === 'sales' ? 4 : 0);
      }
      for (let i = 0; i < cfg.people; i++) add(cfg.level, 2.4 + i * 1.6, 4.4, 'walk', 1);
    }
  }
  for (const p of out) {
    if (p.home === 'walk') {
      p.tx = p.x > 6 ? 2.2 : 8.2;
      p.moving = 1;
    }
  }
  return out;
}

function makeSign(): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  if (!g) return new Mesh();
  g.fillStyle = '#071018';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#7FDBFF';
  g.lineWidth = 10;
  g.strokeRect(8, 8, 496, 112);
  paintText(g, 'PATSNAP', 28, 36, 10, '#ffffff');
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(4.8, 1.2), new MeshBasicMaterial({ map: tex }));
  return mesh;
}

function makePulses(paths: Path[]): { meshes: Mesh[]; cursor: Float32Array } {
  const meshes: Mesh[] = [];
  const geo = new BoxGeometry(0.18, 0.18, 0.18);
  const mats = [whiteMat, brightMat, edgeMat, deepMat];
  const count = Math.max(1, paths.length);
  const cursor = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 4; k++) {
      const m = new Mesh(geo, mats[k] ?? edgeMat);
      meshes.push(m);
    }
    cursor[i] = (i * 0.17) % 1;
  }
  return { meshes, cursor };
}

function stepPulses(pulses: { meshes: Mesh[]; cursor: Float32Array }, paths: Path[], dt: number): void {
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    if (!path) continue;
    let c = (pulses.cursor[i] ?? 0) + dt * 0.18;
    if (c > 1) c -= 1;
    pulses.cursor[i] = c;
    for (let k = 0; k < 4; k++) {
      const mesh = pulses.meshes[i * 4 + k];
      const at = samplePath(path, c - k * 0.03);
      if (mesh) mesh.position.set(at[0] * SX, at[1] * SY, at[2] * SZ);
    }
  }
}

function samplePath(path: Path, t: number): [number, number, number] {
  let d = t * path.total;
  if (d < 0) d += path.total;
  let i = 1;
  while (i < path.dist.length - 1 && (path.dist[i] ?? 0) < d) i += 1;
  const i0 = i - 1;
  const span = (path.dist[i] ?? 0) - (path.dist[i0] ?? 0) || 1;
  const u = (d - (path.dist[i0] ?? 0)) / span;
  const a = i0 * 3;
  const b = i * 3;
  return [
    (path.xyz[a] ?? 0) + ((path.xyz[b] ?? 0) - (path.xyz[a] ?? 0)) * u,
    (path.xyz[a + 1] ?? 0) + ((path.xyz[b + 1] ?? 0) - (path.xyz[a + 1] ?? 0)) * u,
    (path.xyz[a + 2] ?? 0) + ((path.xyz[b + 2] ?? 0) - (path.xyz[a + 2] ?? 0)) * u,
  ];
}

void looseLines;
