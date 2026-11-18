import {
  BoxGeometry,
  BufferGeometry,
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
  OrthographicCamera,
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

const W = 20;
const D = 20;
const STOREY = 2.55;
const SX = 1;
const SY = 1;
const SZ = 1;
const SLAB = 0.16;
/** Full-width band against the back wall. The near corner is the open cut. */
const BACK = 9.2;
/** Left wing that runs to the front. */
const WING = 8.8;
const STEP = 0.1;
const FILL = 0x0a1626;
const EDGE = 0x7fdbff;
const WHITE = 0xffffff;
const BRIGHT = 0xbff4ff;
const DEEP = 0x2e9bff;

const fillMat = new MeshBasicMaterial({ color: FILL });
const edgeMat = new LineBasicMaterial({ color: EDGE });
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
  el: HTMLElement;
  update(dt: number, now: number): void;
  resize(displayPx: number): void;
  push(event: OfficeEvent): void;
  levelsFor(type: OfficeEventType): number[];
  setHour(hour: number): void;
}

export function createOffice(configs: readonly FloorConfig[]): OfficeView {
  const floors = [...configs].sort((a, b) => a.level - b.level);
  const scene = new Scene();
  scene.background = new Color(0x0c1830);
  const ground: number[] = [];
  for (let g = -4; g <= 24; g += 2) {
    ground.push(g, -0.04, -4, g, -0.04, 24, -4, -0.04, g, 24, -0.04, g);
  }
  const groundGeo = new BufferGeometry();
  groundGeo.setAttribute('position', new Float32BufferAttribute(ground, 3));
  scene.add(new LineSegments(groundGeo, new LineBasicMaterial({ color: 0x16324f })));

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
  buildFrame(addBox, addPath);

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

  const desks = collectDesks(floors);
  const deskMesh = makeInstances(desks, new BoxGeometry(1.25, 0.42, 0.7), 0, 0.21, 0, fillMat, false);
  const chairMesh = makeInstances(desks, new BoxGeometry(0.4, 0.36, 0.36), 0, 0.18, 0.52, fillMat, false);
  const monGeo = new BoxGeometry(0.78, 0.42, 0.06);
  const monMesh = makeInstances(desks, monGeo, 0, 0.62, -0.22, whiteMat, true);
  scene.add(deskMesh, chairMesh, monMesh);
  const furn: number[] = [];
  for (const d of desks) {
    stampBox(furn, 1.25, 0.42, 0.7, d.x * SX, d.y * SY + 0.21, d.z * SZ);
    stampBox(furn, 0.4, 0.36, 0.36, d.x * SX, d.y * SY + 0.18, (d.z + 0.52) * SZ);
    stampBox(furn, 0.78, 0.42, 0.06, d.x * SX, d.y * SY + 0.62, (d.z - 0.22) * SZ);
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
  sign.position.set(13.6, 7 * STOREY + 0.78, 4.2);
  sign.rotation.y = Math.PI / 4;
  scene.add(sign);

  const pulses = makePulses(paths);
  for (const m of pulses.meshes) scene.add(m);

  const target = new Vector3(W * 0.48, 7 * STOREY * 0.55, D * 0.42);
  const dist = 110;
  const s = dist / Math.sqrt(3);
  const basePos = new Vector3(target.x + s, target.y + s, target.z + s);
  const camera = new OrthographicCamera(-16.6, 16.6, 16.6, -16.6, 0.1, 800);
  camera.position.copy(basePos);
  camera.lookAt(target);

  const renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x0c1830, 1);
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
        who.x = 2.2;
        who.z = 12.2;
        who.tx = 3.6;
        who.tz = 8.4;
        who.moving = 1;
        who.kind = 'walk';
      }
    }
  }

  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  wrap.style.lineHeight = '0';
  const overlay = document.createElement('canvas');
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.pointerEvents = 'none';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  wrap.append(renderer.domElement, overlay);
  const octx = overlay.getContext('2d');
  const proj = new Vector3();
  const labels = floors.map((cfg) => ({
    label: cfg.label,
    name: cfg.name,
    at: new Vector3(0.45, (cfg.level - 1) * STOREY + STOREY * 0.5, 15.6),
  }));
  const signAt = new Vector3(13.6, 7 * STOREY + 0.78, 4.2);

  function drawOverlay(): void {
    if (!octx) return;
    const w = overlay.width;
    const h = overlay.height;
    if (w === 0 || h === 0) return;
    octx.clearRect(0, 0, w, h);
    for (const lab of labels) {
      proj.copy(lab.at).project(camera);
      const x = (proj.x * 0.5 + 0.5) * w;
      const y = (-proj.y * 0.5 + 0.5) * h;
      const labelScale = 4;
      const nameScale = 3;
      const labelW = lab.label.length * 6 * labelScale;
      const blockH = 5 * labelScale + 3 + 5 * nameScale;
      const left = x - labelW - 8;
      const top = y - blockH / 2;
      paintText(octx, lab.label, left, top, labelScale, '#ffffff');
      paintText(octx, lab.name, left, top + 5 * labelScale + 3, nameScale, '#7FDBFF');
    }
    proj.copy(signAt).project(camera);
    const px = (proj.x * 0.5 + 0.5) * w;
    const py = (-proj.y * 0.5 + 0.5) * h;
    const word = 'PatSnap';
    const scale = 6;
    const width = word.length * 6 * scale;
    const height = 5 * scale;
    const left = px - width / 2;
    const top = py - height / 2;
    octx.fillStyle = '#071018';
    octx.fillRect(left - 12, top - 10, width + 24, height + 20);
    octx.strokeStyle = '#7FDBFF';
    octx.lineWidth = 4;
    octx.strokeRect(left - 12, top - 10, width + 24, height + 20);
    paintText(octx, word, left, top, scale, '#ffffff');
  }

  return {
    canvas: renderer.domElement,
    el: wrap,
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
      renderer.setClearColor(night ? 0x081018 : dusk ? 0x0a1424 : 0x0c1830, 1);
      if (scene.background instanceof Color) scene.background.set(night ? 0x081018 : dusk ? 0x0a1424 : 0x0c1830);
    },
    resize(displayPx) {
      const pixelSize = Math.max(2, Math.round(displayPx / VIEW));
      renderer.setSize(displayPx, displayPx, false);
      composer.setSize(displayPx, displayPx);
      pixelPass.setPixelSize(pixelSize);
      overlay.width = displayPx;
      overlay.height = displayPx;
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
      drawOverlay();
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
          p.tx = p.role === 2 ? (ox > 3.5 ? 2.2 : 4.4) : ox > 6 ? 2.4 : 10.5;
          p.tz = oz > BACK ? (oz > 10 ? 8.2 : 11.2) : oz < 2 ? 3.6 : 1.6;
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
      const y = p.baseY - (sit ? 0.32 : 0) + Math.sin(p.phase * (p.kind === 'swing' ? 10 : 3)) * (p.kind === 'cheer' ? 0.08 : 0.02);
      p.group.position.set(p.x * SX, y * SY, p.z * SZ);
      p.arm.rotation.x = p.kind === 'swing' ? Math.sin(p.phase * 10) * 1.1 : p.kind === 'phone' ? -0.8 : Math.sin(p.phase * 6) * 0.35;
      if (p.kind === 'cheer') p.arm.rotation.z = -1.2;
      else p.arm.rotation.z = 0;
      if (p.timer <= 0 && p.kind !== 'swing') {
        p.seed = (Math.imul(p.seed, 1664525) + 1013904223) >>> 0;
        const r = (p.seed % 1000) / 1000;
        if (r > 0.72 && (p.home === 'sit' || p.home === 'phone')) {
          const nx = p.x + (r > 0.85 ? 2.4 : -2.4);
          p.tx = p.z > BACK ? Math.min(WING - 0.8, Math.max(1.4, nx)) : Math.min(12.2, Math.max(1.6, nx));
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
  addLSlab(addBox, ySlab, cfg.level);
  const wallH = STOREY - SLAB;
  const wallY = y0 + SLAB + wallH / 2;
  addBox(0.16, wallH, D, 0.08, wallY, D / 2);
  addBox(W, wallH, 0.16, W / 2, wallY, 0.08);
  const yb = y0 + SLAB;
  const yt = y0 + STOREY - 0.04;
  const grid: number[] = [];
  for (let z = 1.2; z <= D - 0.6; z += 2.4) grid.push(0.2, yb, z, 0.2, yt, z);
  for (let y = yb + 0.85; y < yt; y += 0.9) grid.push(0.2, y, 0.25, 0.2, y, D - 0.25);
  for (let x = 1.2; x <= W - 0.6; x += 2.4) grid.push(x, yb, 0.2, x, yt, 0.2);
  for (let y = yb + 0.85; y < yt; y += 0.9) grid.push(0.25, y, 0.2, W - 0.25, y, 0.2);
  const gy = yb + 0.03;
  for (let x = 3.2; x < W - 0.8; x += 4) {
    grid.push(x, gy, 0.35, x, gy, BACK - 0.2);
    if (x < WING - 0.2) grid.push(x, gy, BACK, x, gy, D - 0.35);
  }
  for (let z = 3.2; z < D - 0.8; z += 4) {
    const x1 = z < BACK ? W - 0.35 : WING - 0.2;
    if (x1 > 0.6) grid.push(0.35, gy, z, x1, gy, z);
  }
  pushLines(grid);
  addPath(
    [
      new Vector3(0, yb, 0),
      new Vector3(W, yb, 0),
      new Vector3(W, yb, BACK),
      new Vector3(WING, yb, BACK),
      new Vector3(WING, yb, D),
      new Vector3(0, yb, D),
      new Vector3(0, yb, 0),
    ],
    1,
  );
  const bolt = new Vector3(0.5, yb + 1.8, 1.2);
  pushLines([
    bolt.x, bolt.y, bolt.z,
    bolt.x + 0.9, bolt.y + 0.85, bolt.z + 0.25,
    bolt.x + 0.45, bolt.y + 1.55, bolt.z - 0.1,
    bolt.x + 1.45, bolt.y + 1.05, bolt.z + 0.55,
  ]);
}

const looseLines: number[] = [];
function pushLines(pts: number[]): void {
  for (const n of pts) looseLines.push(n);
}

function addLSlab(
  addBox: (w: number, h: number, d: number, x: number, y: number, z: number) => void,
  y: number,
  level: number,
): void {
  // Each higher slab steps back a little on the near edges so the floor below stays in view.
  const inset = (level - 1) * STEP;
  const back = Math.max(3.2, BACK - inset);
  const wing = Math.max(3.2, WING - inset * 0.6);
  const span = Math.max(wing + 1, W - inset);
  addBox(span, SLAB, back, span / 2, y, back / 2);
  const wingD = D - inset * 0.4 - back;
  if (wingD > 0.5) addBox(wing, SLAB, wingD, wing / 2, y, back + wingD / 2);
}

function buildRoof(addBox: (w: number, h: number, d: number, x: number, y: number, z: number) => void, addPath: (pts: Vector3[]) => void): void {
  const y = 7 * STOREY;
  addLSlab(addBox, y + SLAB / 2, 8);
  const py = y + SLAB + 0.28;
  const back = Math.max(3.2, BACK - 7 * STEP);
  const wing = Math.max(3.2, WING - 7 * STEP * 0.6);
  const span = Math.max(wing + 1, W - 7 * STEP);
  addBox(span, 0.5, 0.14, span / 2, py, 0.07);
  addBox(wing, 0.5, 0.14, wing / 2, py, D - 0.1);
  addBox(0.14, 0.5, D, 0.07, py, D / 2);
  addBox(0.14, 0.5, back, span - 0.07, py, back / 2);
  addBox(0.14, 0.5, D - back, wing, py, back + (D - back) / 2);
  addBox(1.8, 0.9, 1.4, span - 2.4, y + SLAB + 0.55, 1.6);
  addBox(1.5, 0.7, 1.2, span - 4.6, y + SLAB + 0.45, 3.2);
  addBox(0.1, 2.1, 0.1, 2.4, y + SLAB + 1.2, 1.5);
  addPath([
    new Vector3(0, y + SLAB, 0),
    new Vector3(span, y + SLAB, 0),
    new Vector3(span, y + SLAB, back),
    new Vector3(wing, y + SLAB, back),
    new Vector3(wing, y + SLAB, D),
    new Vector3(0, y + SLAB, D),
    new Vector3(0, y + SLAB, 0),
  ]);
}

function buildStairs(addBox: (w: number, h: number, d: number, x: number, y: number, z: number) => void): void {
  for (let level = 0; level < 7; level++) {
    const y0 = level * STOREY + SLAB;
    const steps = 8;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      addBox(1.1, 0.1, 0.42, 1.15, y0 + t * (STOREY - SLAB), 0.55 + s * 0.42);
    }
  }
}

function buildFrame(
  addBox: (w: number, h: number, d: number, x: number, y: number, z: number) => void,
  addPath: (pts: Vector3[]) => void,
): void {
  const h = 7 * STOREY + SLAB;
  const posts: readonly (readonly [number, number])[] = [
    [0.16, 0.16],
    [W - 0.16, 0.16],
    [0.16, D - 0.16],
    [WING, BACK],
  ];
  for (const p of posts) {
    addBox(0.28, h, 0.28, p[0], h / 2, p[1]);
    addPath([new Vector3(p[0], 0.2, p[1]), new Vector3(p[0], h, p[1])]);
  }
  const sx = W - 2.1;
  const sz = 2.4;
  for (const dx of [-0.7, 0.7]) {
    for (const dz of [-0.7, 0.7]) {
      addBox(0.16, h, 0.16, sx + dx, h / 2, sz + dz);
      addPath([new Vector3(sx + dx, 0.2, sz + dz), new Vector3(sx + dx, h, sz + dz)]);
    }
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
  a: ['00000', '01110', '00001', '01111', '10001'],
  t: ['00100', '01110', '00100', '00100', '00011'],
  n: ['00000', '10110', '11001', '10001', '10001'],
  p: ['00000', '11110', '10001', '11110', '10000'],
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

function collectDesks(floors: readonly FloorConfig[]): Desk[] {
  const out: Desk[] = [];
  for (const cfg of floors) {
    if (cfg.type !== 'sales' && cfg.type !== 'it' && cfg.type !== 'rnd') continue;
    const y = (cfg.level - 1) * STOREY + SLAB;
    const rows = cfg.type === 'it'
      ? [
          { z: 7.4, n: 4, x0: 2.6, x1: 9.4 },
          { z: 5.2, n: 4, x0: 2.6, x1: 9.4 },
        ]
      : [
          { z: 7.5, n: 6, x0: 2.8, x1: 15.6 },
          { z: 5.3, n: 5, x0: 3.2, x1: 14.2 },
        ];
    let placed = 0;
    for (const row of rows) {
      if (placed >= cfg.stations) break;
      const count = Math.min(row.n, cfg.stations - placed);
      for (let c = 0; c < count; c++) {
        const x = count === 1 ? row.x0 : row.x0 + c * ((row.x1 - row.x0) / Math.max(1, count - 1));
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
      const disc = new Mesh(new CylinderGeometry(0.42, 0.42, 0.08, 16), new MeshBasicMaterial({ color: EDGE }));
      disc.position.set(17.2, y + 1.05, 7.2);
      disc.rotation.x = Math.PI / 2;
      disc.add(new LineSegments(new EdgesGeometry(disc.geometry), edgeMat));
      group.add(disc);
      gong = disc;
      group.add(post(17.2, y + 0.5, 7.2));
      const kpi = new Mesh(new BoxGeometry(2.2, 1.05, 0.06), whiteMat);
      kpi.position.set(6.5, y + 1.35, 0.28);
      group.add(kpi);
    }
    if (cfg.type === 'it') {
      for (let i = 0; i < 3; i++) {
        const rack = new Mesh(new BoxGeometry(0.85, 1.7, 0.55), fillMat);
        rack.position.set(14.2 + i * 1.5, y + 0.9, 6.4);
        rack.add(new LineSegments(new EdgesGeometry(rack.geometry), edgeMat));
        group.add(rack);
        for (let row = 0; row < 5; row++) {
          for (let col = 0; col < 2; col++) {
            const led = new Mesh(new BoxGeometry(0.1, 0.1, 0.04), (row + col) % 2 === 0 ? brightMat : whiteMat);
            led.position.set(rack.position.x - 0.16 + col * 0.32, y + 0.35 + row * 0.28, rack.position.z + 0.3);
            group.add(led);
          }
        }
      }
    }
    if (cfg.type === 'lobby') {
      group.add(box(2.4, 0.55, 0.85, 6.2, y + 0.32, 6.2));
      group.add(box(0.14, 0.9, 0.14, 3.2, y + 0.5, 8.2));
      group.add(box(0.14, 0.9, 0.14, 4.8, y + 0.5, 8.2));
      group.add(box(1.7, 0.06, 0.06, 4.0, y + 0.7, 8.2));
      const screen = new Mesh(new BoxGeometry(2.0, 1.0, 0.06), whiteMat);
      screen.position.set(12.5, y + 1.3, 0.28);
      group.add(screen);
      group.add(plant(2.2, y, 2.4));
      group.add(plant(2.2, y, 5.6));
      group.add(plant(15.5, y, 4.2));
    }
    if (cfg.type === 'lounge') {
      group.add(box(2.2, 0.4, 0.75, 4.2, y + 0.28, 4.6));
      group.add(box(2.2, 0.55, 0.12, 4.2, y + 0.65, 4.25));
      group.add(box(2.4, 0.7, 0.55, 14.5, y + 0.4, 3.2));
      group.add(box(0.32, 0.42, 0.32, 13.4, y + 0.24, 4.2));
      group.add(box(0.32, 0.42, 0.32, 15.6, y + 0.24, 4.2));
      const table = box(2.6, 0.08, 1.35, 4.6, y + 0.55, 7.6);
      group.add(table);
      const net = new Mesh(new BoxGeometry(0.05, 0.32, 1.25), whiteMat);
      net.position.set(4.6, y + 0.78, 7.6);
      group.add(net);
    }
    if (cfg.type === 'rnd') {
      const board = new Mesh(new BoxGeometry(1.8, 0.95, 0.06), whiteMat);
      board.position.set(2.4, y + 1.25, 0.28);
      group.add(board);
      if (cfg.level === 7) {
        group.add(box(2.2, 0.5, 0.75, 16.4, y + 0.3, 6.6));
        group.add(box(1.4, 0.35, 0.5, 16.4, y + 0.72, 6.6));
      }
    }
    if (cfg.type === 'vacant') {
      for (const [cx, cz] of [
        [4.5, 6.2],
        [8.5, 4.2],
        [13.5, 7.2],
        [6.2, 3.2],
      ] as const) {
        const cone = new Mesh(new ConeGeometry(0.22, 0.55, 8), fillMat);
        cone.position.set(cx, y + 0.3, cz);
        cone.add(new LineSegments(new EdgesGeometry(cone.geometry), edgeMat));
        group.add(cone);
      }
      group.add(box(0.9, 0.45, 0.9, 11, y + 0.26, 5.4));
      group.add(box(0.75, 0.4, 0.75, 15.2, y + 0.24, 3.4));
    }
  }
  const car = new Mesh(new BoxGeometry(1.05, 1.55, 1.05), fillMat);
  car.name = 'car';
  car.position.set(W - 2.1, STOREY * 0.42, 2.4);
  car.add(new LineSegments(new EdgesGeometry(car.geometry), edgeMat));
  group.add(car);
  return gong;
}

function outline(mesh: Mesh): Mesh {
  mesh.add(new LineSegments(new EdgesGeometry(mesh.geometry), edgeMat));
  return mesh;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), fillMat);
  m.position.set(x, y, z);
  m.add(new LineSegments(new EdgesGeometry(m.geometry), edgeMat));
  return m;
}
function post(x: number, y: number, z: number): Mesh {
  return box(0.1, 0.95, 0.1, x, y, z);
}
function plant(x: number, y: number, z: number): Group {
  const g = new Group();
  g.add(box(0.28, 0.24, 0.28, 0, 0.14, 0));
  g.add(box(0.42, 0.36, 0.42, 0, 0.42, 0));
  g.position.set(x, y, z);
  return g;
}

function spawnPeople(floors: readonly FloorConfig[], desks: Desk[]): Person[] {
  const out: Person[] = [];
  const legG = new BoxGeometry(0.12, 0.5, 0.12);
  const bodyG = new BoxGeometry(0.32, 0.4, 0.18);
  const headG = new BoxGeometry(0.24, 0.24, 0.24);
  const armG = new BoxGeometry(0.08, 0.32, 0.08);
  let seed = 7;
  const add = (floor: number, x: number, z: number, home: Kind, role: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const group = new Group();
    const leg = outline(new Mesh(legG, fillMat));
    leg.position.set(-0.08, 0.25, 0);
    const leg2 = outline(new Mesh(legG, fillMat));
    leg2.position.set(0.08, 0.25, 0);
    const body = outline(new Mesh(bodyG, fillMat));
    body.position.y = 0.7;
    const head = outline(new Mesh(headG, fillMat));
    head.position.y = 1.04;
    const arm = new Group();
    arm.position.set(0.2, 0.82, 0);
    const armMesh = outline(new Mesh(armG, fillMat));
    armMesh.position.y = -0.14;
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
      add(cfg.level, 6.2, 7.2, 'sit', 0);
      for (let i = 0; i < Math.min(3, cfg.people); i++) add(cfg.level, 3.4 + i * 1.3, 10.4, 'walk', 2);
    } else if (cfg.type === 'lounge') {
      add(cfg.level, 3.6, 8.2, 'swing', 3);
      add(cfg.level, 5.6, 8.2, 'swing', 3);
      add(cfg.level, 3.4, 5.4, 'chat', 3);
      add(cfg.level, 5.2, 5.4, 'chat', 3);
      add(cfg.level, 13.6, 4.4, 'chat', 3);
      add(cfg.level, 15.4, 4.4, 'chat', 3);
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
      for (let i = 0; i < Math.min(2, cfg.people); i++) add(cfg.level, 4 + i * 2.2, 8.6, 'walk', 1);
    }
  }
  for (const p of out) {
    if (p.home === 'walk') {
      p.tx = p.x > 4 ? 2.2 : 4.2;
      p.tz = p.z > BACK ? 8.2 : 3.2;
      p.moving = 1;
    }
  }
  return out;
}

function makeSign(): Mesh {
  const mesh = new Mesh(new BoxGeometry(4.2, 1.25, 0.16), fillMat);
  mesh.add(new LineSegments(new EdgesGeometry(mesh.geometry), edgeMat));
  return mesh;
}

function makePulses(paths: Path[]): { meshes: Mesh[]; cursor: Float32Array } {
  const meshes: Mesh[] = [];
  const geo = new BoxGeometry(0.2, 0.2, 0.2);
  const mats = [whiteMat, brightMat, whiteMat, edgeMat, brightMat, deepMat];
  const count = Math.max(1, paths.length);
  const cursor = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 6; k++) {
      const m = new Mesh(geo, mats[k] ?? edgeMat);
      meshes.push(m);
    }
    cursor[i] = (i * 0.13) % 1;
  }
  return { meshes, cursor };
}

function stepPulses(pulses: { meshes: Mesh[]; cursor: Float32Array }, paths: Path[], dt: number): void {
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    if (!path) continue;
    let c = (pulses.cursor[i] ?? 0) + dt * 0.22;
    if (c > 1) c -= 1;
    pulses.cursor[i] = c;
    for (let k = 0; k < 6; k++) {
      const mesh = pulses.meshes[i * 6 + k];
      const at = samplePath(path, c - k * 0.025);
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
