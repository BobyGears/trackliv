import { makeLocalProjection, type LngLat, type VehicleKind } from '@trackliv/core';
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from 'maplibre-gl';
import * as THREE from 'three';
import type { SiteGeo } from '../../lib/api';
import {
  buildRing,
  buildSiteBuilding,
  buildVehicle,
  buildYard,
  centroid,
  crewInstancedMeshes,
  type VehicleModel,
} from './models';

/**
 * three.js custom layer that renders the two HQs at true scale (from their real footprints),
 * every vehicle as a 3D model at its GPS position, and crews standing next to their vehicles.
 * Coordinates: local metres around `origin`, three.js x = east, y = up, z = south.
 */

export interface VehicleState {
  id: string;
  kind: VehicleKind;
  plate: string;
  lng: number;
  lat: number;
  heading: number;
  moving: boolean;
  color: string;
  selected: boolean;
  dim: boolean;
  crew: number;
  /** Show crew figures next to the vehicle. */
  showCrew: boolean;
}

export interface IdleCrew {
  siteId: string;
  count: number;
}

interface VehicleObj {
  model: VehicleModel;
  ring: THREE.Group;
  kind: VehicleKind;
  from: { x: number; z: number; h: number };
  to: { x: number; z: number; h: number };
  t0: number;
  dur: number;
  /** Heading as drawn (radians, three.js y-rotation), eased towards where the vehicle is going. */
  h: number;
  state: VehicleState;
}

/** How quickly a vehicle turns towards its new direction (1/s) – higher is snappier. */
const TURN_RATE = 5;

const MIN_ZOOM = 13;

export class HqLayer implements CustomLayerInterface {
  readonly id = 'tl-hq-3d';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map!: MlMap;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private modelMatrix = new THREE.Matrix4();
  private proj;
  private sun = new THREE.DirectionalLight('#ffffff', 2.1);
  private hemi = new THREE.HemisphereLight('#ffffff', '#b9c4d4', 1.5);
  private sitesGroup = new THREE.Group();
  private vehiclesGroup = new THREE.Group();
  private vehicles = new Map<string, VehicleObj>();
  private crew = crewInstancedMeshes(160);
  private idleCrew: IdleCrew[] = [];
  private shadowCatcher: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private lastFrame = performance.now();
  private interpMs = 1000;
  visible = true;

  constructor(
    private sites: SiteGeo[],
    private theme: 'light' | 'dark',
  ) {
    const o: LngLat = {
      lng: sites.reduce((s, x) => s + x.location.lng, 0) / sites.length,
      lat: sites.reduce((s, x) => s + x.location.lat, 0) / sites.length,
    };
    this.proj = makeLocalProjection(o);
    const mc = MercatorCoordinate.fromLngLat([o.lng, o.lat], 0);
    const s = mc.meterInMercatorCoordinateUnits();
    this.modelMatrix
      .makeTranslation(mc.x, mc.y, mc.z)
      .scale(new THREE.Vector3(s, -s, s))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 1600),
      new THREE.ShadowMaterial({ opacity: theme === 'dark' ? 0.35 : 0.16, depthWrite: false }),
    );
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.position.y = 0.02;
    this.shadowCatcher.receiveShadow = true;
  }

  /** Local metres (x east, z south). */
  toLocal(lng: number, lat: number) {
    const p = this.proj.toLocal({ lng, lat });
    return { x: p.x, z: -p.y };
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -160;
    sc.right = 160;
    sc.top = 160;
    sc.bottom = -160;
    sc.near = 1;
    sc.far = 900;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.shadowCatcher, this.sitesGroup, this.vehiclesGroup);
    for (const m of Object.values(this.crew)) this.scene.add(m);
    this.buildSites();
    this.applyTheme();
  }

  onRemove() {
    this.renderer?.dispose();
  }

  setTheme(theme: 'light' | 'dark') {
    if (theme === this.theme) return;
    this.theme = theme;
    this.buildSites();
    this.applyTheme();
    this.map?.triggerRepaint();
  }

  private applyTheme() {
    const dark = this.theme === 'dark';
    this.sun.intensity = dark ? 1.3 : 2.1;
    this.hemi.intensity = dark ? 0.9 : 1.55;
    this.hemi.color.set(dark ? '#9fb3d6' : '#ffffff');
    this.hemi.groundColor.set(dark ? '#1b2533' : '#b9c4d4');
    (this.shadowCatcher.material as THREE.ShadowMaterial).opacity = dark ? 0.35 : 0.16;
  }

  private buildSites() {
    this.sitesGroup.clear();
    for (const site of this.sites) {
      const ring = site.footprint.map(([lng, lat]) => {
        const p = this.proj.toLocal({ lng, lat });
        return [p.x, p.y] as [number, number];
      });
      const yard = site.yard.map((y) => {
        const p = this.proj.toLocal(y);
        return { x: p.x, y: p.y, heading: y.heading };
      });
      const c = centroid(ring);
      const yc = yard.length ? yard.reduce((a, y) => [a[0] + y.x / yard.length, a[1] + y.y / yard.length], [0, 0]) : [c[0] + 1, c[1]];
      this.sitesGroup.add(buildYard(yard, this.theme));
      this.sitesGroup.add(
        buildSiteBuilding({
          ring,
          height: site.heightM ?? 9,
          yardDir: [yc[0] - c[0], yc[1] - c[1]],
          title: 'DTE GmbH',
          subtitle: `${site.code} · ${site.name}`,
          theme: this.theme,
        }),
      );
    }
  }

  /** Update vehicles from the store (positions are interpolated between fixes). */
  setVehicles(states: VehicleState[], interpMs: number) {
    this.interpMs = interpMs;
    const now = performance.now();
    const seen = new Set<string>();
    for (const st of states) {
      seen.add(st.id);
      const p = this.toLocal(st.lng, st.lat);
      const h = (-st.heading * Math.PI) / 180;
      let v = this.vehicles.get(st.id);
      if (!v || v.kind !== st.kind) {
        if (v) this.vehiclesGroup.remove(v.model.group, v.ring);
        const model = buildVehicle(st.kind, st.plate);
        model.group.userData.vehicleId = st.id;
        model.group.traverse((o) => (o.userData.vehicleId = st.id));
        const ring = buildRing(st.kind === 'truck' ? 5.2 : 4.3, st.color);
        v = { model, ring, kind: st.kind, from: { x: p.x, z: p.z, h }, to: { x: p.x, z: p.z, h }, t0: now, dur: 1, h, state: st };
        this.vehicles.set(st.id, v);
        this.vehiclesGroup.add(model.group, ring);
      } else {
        const cur = this.pose(v, now);
        const jump = Math.hypot(p.x - cur.x, p.z - cur.z) > 3000;
        v.from = jump ? { x: p.x, z: p.z, h } : cur;
        v.to = { x: p.x, z: p.z, h: unwrap(cur.h, h) };
        v.t0 = now;
        v.dur = jump ? 1 : interpMs;
        if (jump) v.h = h;
      }
      v.state = st;
      for (const m of v.ring.children) ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(st.selected ? '#2f6bff' : st.color);
      v.ring.visible = st.selected || st.moving;
    }
    for (const [id, v] of this.vehicles) {
      if (!seen.has(id)) {
        this.vehiclesGroup.remove(v.model.group, v.ring);
        this.vehicles.delete(id);
      }
    }
    this.map?.triggerRepaint();
  }

  setIdleCrew(idle: IdleCrew[]) {
    this.idleCrew = idle;
    this.map?.triggerRepaint();
  }

  private pose(v: VehicleObj, now: number) {
    const t = Math.min(1, (now - v.t0) / v.dur);
    const e = t;
    return {
      x: v.from.x + (v.to.x - v.from.x) * e,
      z: v.from.z + (v.to.z - v.from.z) * e,
      h: v.from.h + (v.to.h - v.from.h) * Math.min(1, t * 2),
    };
  }

  /** Screen position (px) of a vehicle as currently drawn, for HTML labels. */
  vehicleLngLat(id: string): LngLat | null {
    const v = this.vehicles.get(id);
    if (!v) return null;
    const p = this.pose(v, performance.now());
    return this.proj.toLngLat(p.x, -p.z);
  }

  pick(point: { x: number; y: number }): string | null {
    if (!this.visible || !this.map) return null;
    const canvas = this.map.getCanvas();
    const ndc = new THREE.Vector2((point.x / canvas.clientWidth) * 2 - 1, -(point.y / canvas.clientHeight) * 2 + 1);
    const inv = this.camera.projectionMatrix.clone().invert();
    const near = new THREE.Vector3(ndc.x, ndc.y, -1).applyMatrix4(inv);
    const far = new THREE.Vector3(ndc.x, ndc.y, 1).applyMatrix4(inv);
    this.raycaster.set(near, far.sub(near).normalize());
    const hits = this.raycaster.intersectObjects(this.vehiclesGroup.children, true);
    for (const h of hits) {
      const id = h.object.userData.vehicleId as string | undefined;
      if (id) return id;
    }
    return null;
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const zoom = this.map.getZoom();
    this.visible = zoom >= MIN_ZOOM;
    if (!this.visible) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]);
    this.camera.projectionMatrix = m.multiply(this.modelMatrix);

    // Shadow frustum follows the map centre.
    const c = this.map.getCenter();
    const cl = this.toLocal(c.lng, c.lat);
    const span = Math.min(700, Math.max(90, 40000 / Math.pow(2, zoom - 11)));
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.updateProjectionMatrix();
    this.sun.position.set(cl.x - 160, 260, cl.z + 120);
    this.sun.target.position.set(cl.x, 0, cl.z);
    this.shadowCatcher.position.set(cl.x, 0.02, cl.z);
    // scale models a bit when zoomed out so they stay readable
    const boost = Math.max(1, Math.pow(2, (16.2 - zoom) * 0.55));

    let animating = false;
    for (const v of this.vehicles.values()) {
      const p = this.pose(v, now);
      if (now - v.t0 < v.dur) animating = true;
      // Face the way the vehicle is actually moving on screen; parked: the reported heading.
      const dx = v.to.x - v.from.x;
      const dz = v.to.z - v.from.z;
      const target = now - v.t0 < v.dur && Math.hypot(dx, dz) > 1.5 ? -Math.atan2(dx, -dz) : p.h;
      const turn = unwrap(v.h, target) - v.h;
      v.h += turn * (1 - Math.exp(-dt * TURN_RATE));
      if (Math.abs(turn) > 0.01) animating = true;
      v.model.group.position.set(p.x, 0, p.z);
      v.model.group.rotation.y = v.h;
      v.model.group.scale.setScalar(boost);
      v.model.group.visible = !v.state.dim || v.state.selected;
      v.ring.position.set(p.x, 0, p.z);
      v.ring.scale.setScalar(boost * (v.state.selected ? 1 + 0.06 * Math.sin(now / 220) : 1));
      if (v.state.selected) animating = true;
    }
    this.layoutCrew(now, boost);
    // idle sway is only worth repainting for when people are big enough to see
    if (zoom >= 16.5 && (this.idleCrew.some((c) => c.count) || [...this.vehicles.values()].some((v) => v.state.showCrew))) animating = true;

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    if (animating) this.map.triggerRepaint();
  }

  private layoutCrew(now: number, boost: number) {
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sV = new THREE.Vector3();
    const pos = new THREE.Vector3();
    let n = 0;
    const cap = this.crew.body.instanceMatrix.count;
    const place = (x: number, z: number, facing: number, seed: number) => {
      if (n >= cap) return;
      const bob = Math.sin(now / 600 + seed) * 0.03;
      const sway = Math.sin(now / 900 + seed * 1.7) * 0.15;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing + sway);
      sV.setScalar(boost);
      const set = (mesh: THREE.InstancedMesh, y: number) => {
        pos.set(x, y * boost + bob, z);
        mat.compose(pos, q, sV);
        mesh.setMatrixAt(n, mat);
      };
      set(this.crew.legs, 0.39);
      set(this.crew.body, 1.15);
      set(this.crew.stripe, 1.2);
      set(this.crew.head, 1.72);
      set(this.crew.helmet, 1.78);
      n++;
    };

    for (const v of this.vehicles.values()) {
      if (!v.state.showCrew || !v.state.crew || !v.model.group.visible) continue;
      const g = v.model.group;
      const h = g.rotation.y;
      // stand on the vehicle's right-hand side, spaced along it
      const rx = Math.cos(h);
      const rz = -Math.sin(h);
      const fx = -Math.sin(h);
      const fz = -Math.cos(h);
      for (let i = 0; i < v.state.crew; i++) {
        const along = (i - (v.state.crew - 1) / 2) * 1.1 * boost;
        const side = (v.kind === 'truck' ? 2.3 : 2.0) * boost;
        place(g.position.x + rx * side + fx * along, g.position.z + rz * side + fz * along, h + Math.PI / 2 + (i % 2 ? 0.4 : -0.3), i * 3.1 + g.position.x);
      }
    }
    for (const idle of this.idleCrew) {
      const site = this.sites.find((s) => s.id === idle.siteId);
      if (!site || !idle.count) continue;
      const gate = this.toLocal(site.gate.lng, site.gate.lat);
      const loc = this.toLocal(site.location.lng, site.location.lat);
      // muster point between the building and the gate
      const mx = loc.x + (gate.x - loc.x) * 0.55;
      const mz = loc.z + (gate.z - loc.z) * 0.55;
      const cols = Math.ceil(Math.sqrt(idle.count));
      for (let i = 0; i < idle.count; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        place(mx + (c - cols / 2) * 1.05 * boost, mz + r * 1.05 * boost, Math.atan2(loc.x - mx, loc.z - mz) + (i % 3) * 0.3, i * 1.9);
      }
    }
    for (const m of Object.values(this.crew)) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}

function unwrap(from: number, to: number) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d;
}
