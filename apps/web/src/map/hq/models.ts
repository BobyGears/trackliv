import * as THREE from 'three';
import type { VehicleKind } from '@trackliv/core';

// Procedural low-poly models in the soft "isometric operations" look:
// white bodies, brand-blue accents, dark glazing. All dimensions in metres, forward = -Z.

export const BRAND = '#2f5fe0';

const mats = new Map<string, THREE.Material>();
export function lambert(color: string, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${JSON.stringify(opts)}`;
  let m = mats.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, ...opts });
    mats.set(key, m);
  }
  return m;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const FONT = '"Inter Variable", Inter, system-ui, sans-serif';

let logoTex: THREE.CanvasTexture | null = null;
function logoTexture() {
  if (logoTex) return logoTex;
  logoTex = canvasTexture(512, 160, (ctx) => {
    ctx.clearRect(0, 0, 512, 160);
    // mark
    ctx.fillStyle = BRAND;
    ctx.beginPath();
    ctx.roundRect(16, 28, 104, 104, 22);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(68, 46);
    ctx.lineTo(104, 66);
    ctx.lineTo(68, 86);
    ctx.lineTo(32, 66);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(32, 74);
    ctx.lineTo(64, 92);
    ctx.lineTo(64, 116);
    ctx.lineTo(32, 98);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#16213a';
    ctx.font = `800 64px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('DTE', 140, 66);
    ctx.fillStyle = BRAND;
    ctx.font = `600 34px ${FONT}`;
    ctx.fillText('TrackLiv', 142, 116);
  });
  return logoTex;
}

function plateTexture(text: string) {
  return canvasTexture(256, 56, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 56);
    ctx.fillStyle = '#1f3fae';
    ctx.fillRect(0, 0, 26, 56);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 52);
    ctx.fillStyle = '#111';
    ctx.font = `700 34px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, 140, 30);
  });
}

function box(w: number, h: number, l: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Side profile (z forward negative, y up) extruded across the vehicle width. */
function profile(points: [number, number][], width: number, mat: THREE.Material) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  geo.translate(0, 0, -width / 2);
  // shape x → vehicle z (front stays at -z), extrusion z → vehicle x
  geo.rotateY(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function wheel(x: number, z: number, r = 0.36, w = 0.26) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18), lambert('#22262d'));
  tyre.rotation.z = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 12), lambert('#aeb6c2'));
  rim.rotation.z = Math.PI / 2;
  g.add(tyre, rim);
  g.position.set(x, r, z);
  tyre.castShadow = true;
  return g;
}

function decal(tex: THREE.Texture, w: number, h: number) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  return m;
}

function sideLogos(g: THREE.Group, halfWidth: number, y: number, z: number, w: number) {
  const tex = logoTexture();
  const left = decal(tex, w, w * 0.3125);
  left.position.set(-halfWidth - 0.012, y, z);
  left.rotation.y = -Math.PI / 2;
  const right = decal(tex, w, w * 0.3125);
  right.position.set(halfWidth + 0.012, y, z);
  right.rotation.y = Math.PI / 2;
  g.add(left, right);
}

function plates(g: THREE.Group, text: string, frontZ: number, rearZ: number, y = 0.55) {
  const tex = plateTexture(text);
  const f = decal(tex, 0.52, 0.115);
  f.position.set(0, y, frontZ - 0.01);
  f.rotation.y = Math.PI;
  const r = decal(tex, 0.52, 0.115);
  r.position.set(0, y + 0.1, rearZ + 0.01);
  g.add(f, r);
}

export interface VehicleModel {
  group: THREE.Group;
  /** Meshes that get tinted when selected. */
  accent: THREE.Mesh[];
  length: number;
}

export function buildVehicle(kind: VehicleKind, plate: string): VehicleModel {
  switch (kind) {
    case 'truck':
      return buildTruck(plate);
    case 'pickup':
      return buildPickup(plate);
    default:
      return buildVan(plate);
  }
}

function buildVan(plate: string): VehicleModel {
  const g = new THREE.Group();
  const white = lambert('#f6f8fb');
  const glass = lambert('#1f2b3d');
  const W = 2.0;
  // z from +2.95 (rear) to -2.95 (front)
  const body = profile(
    [
      [2.95, 0.42],
      [2.95, 2.55],
      [-1.15, 2.55],
      [-1.95, 1.55],
      [-2.85, 1.2],
      [-2.95, 0.42],
    ],
    W - 0.12,
    white,
  );
  g.add(body);
  // windscreen + side cab windows
  // windscreen on the slanted front (from z=-1.15,y=2.55 to z=-1.95,y=1.55)
  const a = Math.atan2(0.8, 1.0);
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.3, 1.18), glass);
  ws.rotation.set(a, Math.PI, 0);
  ws.position.set(0, 2.05 + 0.08 * Math.sin(a), -1.55 - 0.08 * Math.cos(a));
  g.add(ws);
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.7), glass);
    win.position.set(s * (W / 2 + 0.005), 1.95, -0.9);
    win.rotation.y = s * (Math.PI / 2);
    g.add(win);
  }
  // brand stripe
  const stripeMat = lambert(BRAND);
  for (const s of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(5.1, 0.16), stripeMat);
    stripe.position.set(s * (W / 2 + 0.008), 0.95, 0.35);
    stripe.rotation.y = s * (Math.PI / 2);
    g.add(stripe);
  }
  // bumpers + lights
  g.add(box(W - 0.05, 0.28, 0.18, lambert('#3a4150'), 0, 0.32, -2.92));
  g.add(box(W - 0.05, 0.28, 0.14, lambert('#3a4150'), 0, 0.32, 2.93));
  for (const s of [-1, 1]) {
    g.add(box(0.32, 0.12, 0.05, lambert('#fff7d6', { emissive: '#fff2b0', emissiveIntensity: 0.6 }), s * 0.72, 1.05, -2.9));
    g.add(box(0.12, 0.42, 0.04, lambert('#e5484d', { emissive: '#e5484d', emissiveIntensity: 0.4 }), s * 0.9, 1.0, 2.96));
  }
  sideLogos(g, W / 2, 1.75, 1.05, 2.3);
  plates(g, plate, -2.97, 2.97);
  for (const [x, z] of [
    [-0.86, -1.9],
    [0.86, -1.9],
    [-0.86, 1.85],
    [0.86, 1.85],
  ])
    g.add(wheel(x, z));
  return { group: g, accent: [], length: 5.9 };
}

function buildTruck(plate: string): VehicleModel {
  const g = new THREE.Group();
  const white = lambert('#f7f9fc');
  const cabMat = lambert(BRAND);
  const glass = lambert('#1d2738');
  const W = 2.3;
  // chassis
  g.add(box(1.2, 0.35, 7.0, lambert('#2b303a'), 0, 0.45, 0.2));
  // cab (front at -Z)
  const cab = profile(
    [
      [-1.55, 0.6],
      [-1.55, 2.55],
      [-3.35, 2.55],
      [-3.6, 2.1],
      [-3.7, 0.6],
    ],
    W - 0.1,
    cabMat,
  );
  g.add(cab);
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.3, 0.95), glass);
  ws.rotation.set(0.07, Math.PI, 0);
  ws.position.set(0, 2.05, -3.71);
  g.add(ws);
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.75), glass);
    win.position.set(s * (W / 2 + 0.01), 2.0, -2.85);
    win.rotation.y = s * (Math.PI / 2);
    g.add(win);
  }
  // box body
  const cargo = box(W + 0.1, 2.75, 5.3, white, 0, 0.75, 1.25);
  g.add(cargo);
  const roofTrim = box(W + 0.14, 0.08, 5.34, lambert('#dfe5ee'), 0, 3.5, 1.25);
  g.add(roofTrim);
  // rear doors outline
  const door = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, 2.5), lambert('#e9edf3'));
  door.position.set(0, 2.1, 3.92);
  g.add(door);
  g.add(box(W, 0.25, 0.15, lambert('#3a4150'), 0, 0.42, -3.72));
  for (const s of [-1, 1]) {
    g.add(box(0.36, 0.14, 0.05, lambert('#fff7d6', { emissive: '#fff2b0', emissiveIntensity: 0.6 }), s * 0.85, 0.9, -3.72));
    g.add(box(0.18, 0.3, 0.05, lambert('#e5484d', { emissive: '#e5484d', emissiveIntensity: 0.4 }), s * 1.0, 0.7, 3.92));
  }
  sideLogos(g, (W + 0.1) / 2, 2.3, 1.2, 3.6);
  plates(g, plate, -3.76, 3.93, 0.45);
  for (const [x, z] of [
    [-1.0, -2.6],
    [1.0, -2.6],
    [-1.0, 1.6],
    [1.0, 1.6],
    [-1.0, 2.75],
    [1.0, 2.75],
  ])
    g.add(wheel(x, z, 0.46, 0.3));
  return { group: g, accent: [cab as THREE.Mesh], length: 7.6 };
}

function buildPickup(plate: string): VehicleModel {
  const g = new THREE.Group();
  const bodyMat = lambert('#f4f6f9');
  const glass = lambert('#1f2b3d');
  const W = 1.95;
  const lower = profile(
    [
      [2.65, 0.5],
      [2.65, 1.25],
      [-1.4, 1.25],
      [-2.55, 1.05],
      [-2.7, 0.5],
    ],
    W - 0.1,
    bodyMat,
  );
  g.add(lower);
  const cabin = profile(
    [
      [0.55, 1.2],
      [0.55, 1.95],
      [-0.6, 1.95],
      [-1.3, 1.25],
    ],
    W - 0.2,
    lambert(BRAND),
  );
  g.add(cabin);
  const pa = Math.PI / 4;
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.4, 0.92), glass);
  ws.rotation.set(pa, Math.PI, 0);
  ws.position.set(0, 1.6 + 0.08 * Math.sin(pa), -0.95 - 0.08 * Math.cos(pa));
  g.add(ws);
  // bed
  const bed = new THREE.Mesh(new THREE.BoxGeometry(W - 0.3, 0.05, 1.9), lambert('#3a4150'));
  bed.position.set(0, 1.0, 1.55);
  g.add(bed);
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), glass);
    win.position.set(s * (W / 2 - 0.02), 1.6, -0.05);
    win.rotation.y = s * (Math.PI / 2);
    g.add(win);
  }
  sideLogos(g, W / 2 + 0.01, 0.9, -0.2, 1.4);
  plates(g, plate, -2.72, 2.67, 0.62);
  for (const [x, z] of [
    [-0.85, -1.7],
    [0.85, -1.7],
    [-0.85, 1.75],
    [0.85, 1.75],
  ])
    g.add(wheel(x, z, 0.4, 0.28));
  return { group: g, accent: [], length: 5.4 };
}

// --- People ------------------------------------------------------------------------------

export function crewInstancedMeshes(capacity: number) {
  const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.24, 0.72, 4, 10), lambert('#f59f1b'), capacity);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.78, 0.24), lambert('#2a3446'), capacity);
  const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 12, 10), lambert('#e9c2a0'), capacity);
  const helmet = new THREE.InstancedMesh(new THREE.SphereGeometry(0.175, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), lambert('#ffffff'), capacity);
  const stripe = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.255, 0.255, 0.06, 12), lambert('#e8eef6'), capacity);
  for (const m of [body, legs, head, helmet, stripe]) {
    m.castShadow = true;
    m.count = 0;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  return { body, legs, head, helmet, stripe };
}

// --- Buildings ----------------------------------------------------------------------------

function claddingTexture(base: string, rib: string, band: string) {
  const tex = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 16) {
      ctx.fillStyle = rib;
      ctx.fillRect(x, 0, 6, 256);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 6, 0, 2, 256);
    }
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, 256, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, 26, 256, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, 246, 256, 10);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function signTexture(title: string, sub: string) {
  return canvasTexture(1024, 256, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(0, 0, 1024, 256, 36);
    ctx.fill();
    ctx.fillStyle = BRAND;
    ctx.beginPath();
    ctx.roundRect(28, 38, 180, 180, 36);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `800 96px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('D', 118, 132);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#14203a';
    ctx.font = `800 104px ${FONT}`;
    ctx.fillText(title, 240, 104);
    ctx.fillStyle = '#5b6b85';
    ctx.font = `600 52px ${FONT}`;
    ctx.fillText(sub, 244, 196);
  });
}

export interface SiteBuildingInput {
  /** Local ring (x east, y north) in metres, closed or open. */
  ring: [number, number][];
  height: number;
  /** Direction (local x,y) from the building toward its yard – loading docks go on that side. */
  yardDir: [number, number];
  title: string;
  subtitle: string;
  theme: 'light' | 'dark';
}

/** Warehouse with ribbed cladding, white parapet, roof units, loading docks and a sign. */
export function buildSiteBuilding(input: SiteBuildingInput): THREE.Group {
  const g = new THREE.Group();
  let ring = input.ring.slice();
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  // ensure counter-clockwise (positive area) for outward normals
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  if (area < 0) ring = ring.reverse();

  const H = Math.max(6, input.height);
  const dark = input.theme === 'dark';
  const cladding = claddingTexture(dark ? '#4a64a3' : '#7392d6', dark ? '#415a96' : '#6886cc', dark ? '#c9d3e3' : '#f7f9fc');
  const wallMat = new THREE.MeshLambertMaterial({ map: cladding, side: THREE.DoubleSide });

  // Walls with continuous UVs (u = metres along the perimeter / 4)
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  let u = 0;
  const edges: { a: [number, number]; b: [number, number]; n: [number, number]; len: number }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    const n: [number, number] = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
    edges.push({ a, b, n, len });
    const u2 = u + len / 4;
    // three coords: x = east, y = up, z = -north
    const quad = [
      [a[0], 0, -a[1], u, 0],
      [b[0], 0, -b[1], u2, 0],
      [b[0], H, -b[1], u2, 1],
      [a[0], 0, -a[1], u, 0],
      [b[0], H, -b[1], u2, 1],
      [a[0], H, -a[1], u, 1],
    ];
    for (const [x, y, z, uu, vv] of quad) {
      pos.push(x, y, z);
      uv.push(uu, vv);
      nor.push(n[0], 0, -n[1]);
    }
    u = u2;
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  wallGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const walls = new THREE.Mesh(wallGeo, wallMat);
  walls.castShadow = true;
  walls.receiveShadow = true;
  g.add(walls);

  // Roof + parapet
  const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
  const roofGeo = new THREE.ShapeGeometry(shape);
  roofGeo.rotateX(-Math.PI / 2);
  const roof = new THREE.Mesh(roofGeo, lambert(dark ? '#cfd7e4' : '#eef1f6'));
  roof.position.y = H - 0.02;
  roof.receiveShadow = true;
  g.add(roof);
  const parapet = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false }),
    lambert(dark ? '#e4e9f1' : '#ffffff'),
  );
  parapet.geometry.rotateX(-Math.PI / 2);
  parapet.position.y = H - 0.02;
  // inset roof plane slightly above the parapet block reads as a rim
  const inner = new THREE.Mesh(roofGeo.clone(), lambert(dark ? '#c3ccda' : '#e4e8ef'));
  inner.position.y = H + 0.62;
  inner.scale.set(0.985, 1, 0.985);
  const c = centroid(ring);
  inner.position.x = c[0] * (1 - 0.985);
  inner.position.z = -c[1] * (1 - 0.985);
  g.add(parapet, inner);

  // Roof units & skylights
  const rng = mulberry(ring.length * 7919 + Math.round(H * 10));
  const bb = bbox(ring);
  for (let i = 0; i < 6; i++) {
    const x = bb.minX + (bb.maxX - bb.minX) * (0.2 + rng() * 0.6);
    const y = bb.minY + (bb.maxY - bb.minY) * (0.2 + rng() * 0.6);
    if (!pointInRing([x, y], ring)) continue;
    const unit = box(1.6 + rng() * 1.4, 0.9, 1.2 + rng(), lambert(dark ? '#9aa6b8' : '#d3d9e2'), x, H + 0.62, -y);
    g.add(unit);
  }

  // Loading docks on the wall that faces the yard
  const [yx, yy] = input.yardDir;
  const yl = Math.hypot(yx, yy) || 1;
  const docks = edges
    .map((e) => ({ e, score: (e.n[0] * yx + e.n[1] * yy) / yl }))
    .filter((d) => d.score > 0.45 && d.e.len > 7)
    .sort((a, b) => b.score * b.e.len - a.score * a.e.len)
    .slice(0, 2);
  const doorMat = lambert(dark ? '#2a3240' : '#3b4454');
  const frameMat = lambert('#f2c230');
  const canopyMat = lambert(dark ? '#d9e0ea' : '#ffffff');
  for (const { e } of docks) {
    const count = Math.min(6, Math.floor((e.len - 2) / 4.4));
    const start = (e.len - (count - 1) * 4.4) / 2;
    const dir = [(e.b[0] - e.a[0]) / e.len, (e.b[1] - e.a[1]) / e.len];
    const rotY = Math.atan2(e.n[0], -e.n[1]); // local +z → outward wall normal
    for (let k = 0; k < count; k++) {
      const t = start + k * 4.4;
      const px = e.a[0] + dir[0] * t + e.n[0] * 0.06;
      const py = e.a[1] + dir[1] * t + e.n[1] * 0.06;
      const door = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.3, 0.12), doorMat);
      door.position.set(px, 1.65 + 0.5, -py);
      door.rotation.y = rotY;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.18, 0.2), frameMat);
      frame.position.set(px + e.n[0] * 0.05, 0.6, -(py + e.n[1] * 0.05));
      frame.rotation.y = rotY;
      // ribs on the shutter
      for (let r = 0; r < 6; r++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.04, 0.02), lambert(dark ? '#3a4352' : '#566072'));
        rib.position.set(px + e.n[0] * 0.08, 0.9 + r * 0.5, -(py + e.n[1] * 0.08));
        rib.rotation.y = rotY;
        g.add(rib);
      }
      g.add(door, frame);
    }
    // canopy along the dock wall
    const midT = e.len / 2;
    const cx = e.a[0] + dir[0] * midT + e.n[0] * 1.3;
    const cy = e.a[1] + dir[1] * midT + e.n[1] * 1.3;
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(Math.min(e.len - 1, count * 4.4 + 1), 0.14, 1.9), canopyMat);
    canopy.position.set(cx - e.n[0] * 0.35, 4.45, -(cy - e.n[1] * 0.35));
    canopy.rotation.y = rotY;
    canopy.castShadow = true;
    g.add(canopy);
  }

  // Sign on the longest wall that doesn't carry docks
  const signWall = edges
    .filter((e) => !docks.some((d) => d.e === e))
    .sort((a, b) => b.len - a.len)[0] ?? edges[0];
  if (signWall) {
    const tex = signTexture(input.title, input.subtitle);
    const w = Math.min(signWall.len * 0.6, 12);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w / 4),
      new THREE.MeshLambertMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    const mid = [(signWall.a[0] + signWall.b[0]) / 2, (signWall.a[1] + signWall.b[1]) / 2];
    sign.position.set(mid[0] + signWall.n[0] * 0.08, H - 1.6 - w / 8, -(mid[1] + signWall.n[1] * 0.08));
    sign.rotation.y = Math.atan2(signWall.n[0], -signWall.n[1]);
    g.add(sign);
  }
  return g;
}

// --- helpers -------------------------------------------------------------------------------

export function centroid(ring: [number, number][]): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

function bbox(ring: [number, number][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function pointInRing(p: [number, number], ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Painted parking bays + asphalt pad for a yard. */
export function buildYard(slots: { x: number; y: number; heading: number }[], theme: 'light' | 'dark'): THREE.Group {
  const g = new THREE.Group();
  if (!slots.length) return g;
  const lineMat = new THREE.MeshBasicMaterial({ color: theme === 'dark' ? '#8796ad' : '#ffffff', polygonOffset: true, polygonOffsetFactor: -4 });
  const padMat = new THREE.MeshLambertMaterial({
    color: theme === 'dark' ? '#1a2331' : '#c9d0da',
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  // pad = convex hull of slot corners grown by 3 m
  const pts: THREE.Vector2[] = [];
  for (const s of slots) {
    const h = (s.heading * Math.PI) / 180;
    const fx = Math.sin(h);
    const fy = Math.cos(h);
    const rx = Math.cos(h);
    const ry = -Math.sin(h);
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      pts.push(new THREE.Vector2(s.x + fx * a * 6 + rx * b * 3.5, s.y + fy * a * 6 + ry * b * 3.5));
    }
  }
  const hull = convexHull(pts);
  const pad = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(hull)), padMat);
  pad.geometry.rotateX(-Math.PI / 2);
  pad.position.y = 0.03;
  pad.receiveShadow = true;
  g.add(pad);

  for (const s of slots) {
    const h = (s.heading * Math.PI) / 180;
    const rx = Math.cos(h);
    const ry = -Math.sin(h);
    for (const side of [-1, 1]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 7.2), lineMat);
      line.geometry.rotateX(-Math.PI / 2);
      line.position.set(s.x + rx * side * 1.65, 0.06, -(s.y + ry * side * 1.65));
      line.rotation.y = -h;
      g.add(line);
    }
  }
  return g;
}

function convexHull(points: THREE.Vector2[]): THREE.Vector2[] {
  const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: THREE.Vector2[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: THREE.Vector2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Flat ring used for selection / status under a vehicle. */
export function buildRing(radius: number, color: string) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.86, radius, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }),
  );
  ring.geometry.rotateX(-Math.PI / 2);
  ring.position.y = 0.08;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.86, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }),
  );
  disc.geometry.rotateX(-Math.PI / 2);
  disc.position.y = 0.07;
  const g = new THREE.Group();
  g.add(ring, disc);
  return g;
}
