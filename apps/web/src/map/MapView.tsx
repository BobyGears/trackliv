import {
  ARRIVE_RADIUS_M,
  STAGE_LABEL,
  destinationLabel,
  destinationLocation,
  isAtDepot,
  type Assignment,
  type LngLat,
  type Telemetry,
} from '@trackliv/core';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LngLatBoundsLike, Map as MlMap } from 'maplibre-gl';
// Bundle MapLibre's module worker through Vite so it works in dev and in the production build.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef } from 'react';
import { STAGE_TONE, TONE_HEX } from '../lib/format';
import { useStore, type FocusRequest } from '../lib/store';
import { HqLayer, type VehicleState } from './hq/HqLayer';
import {
  projectMarkerEl,
  renderProjectMarker,
  renderSiteMarker,
  renderVehicleMarker,
  siteMarkerEl,
  vehicleMarkerEl,
} from './markers';
import { REGION_BBOX, applyTheme, buildStyle } from './style';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

let current: MapController | null = null;
export const getMap = () => current?.map ?? null;
export const mapController = () => current;

type S = ReturnType<typeof useStore.getState>;

const PANEL_PADDING = { top: 190, bottom: 250, left: 90, right: 400 };
/** Camera bearings with a clear view of each HQ's yard (neighbouring buildings block other angles). */
const SITE_CAMERA_BEARING: Record<string, number> = { 'hq-schieferstein': 200, 'hq-hafen': 250 };

function circle(center: LngLat, radiusM: number, steps = 64): [number, number][] {
  const pts: [number, number][] = [];
  const dLat = radiusM / 111200;
  const dLng = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([center.lng + Math.cos(a) * dLng, center.lat + Math.sin(a) * dLat]);
  }
  return pts;
}

function meanHeading(hs: number[]) {
  let x = 0;
  let y = 0;
  for (const h of hs) {
    x += Math.sin((h * Math.PI) / 180);
    y += Math.cos((h * Math.PI) / 180);
  }
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

class MapController {
  map: MlMap;
  hq: HqLayer | null = null;
  private siteMarkers = new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement }>();
  private hqCluster: { marker: maplibregl.Marker; el: HTMLDivElement } | null = null;
  private projectMarkers = new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement }>();
  private vehicleMarkers = new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement; shown: boolean }>();
  private unsub: (() => void)[] = [];
  private raf = 0;
  private loaded = false;

  constructor(el: HTMLDivElement) {
    const s = useStore.getState();
    this.map = new maplibregl.Map({
      container: el,
      style: buildStyle(s.theme),
      center: [8.52, 50.05],
      zoom: 9.4,
      pitch: 32,
      bearing: -6,
      maxPitch: 78,
      minZoom: 7.6,
      maxBounds: [
        [REGION_BBOX[0] - 0.6, REGION_BBOX[1] - 0.4],
        [REGION_BBOX[2] + 0.6, REGION_BBOX[3] + 0.4],
      ],
      maxZoom: 20.5,
      attributionControl: { compact: true, customAttribution: 'Geodata © OpenStreetMap contributors, Overture Maps Foundation, Hessen address register (DL-DE-ZERO-2.0)' },
      canvasContextAttributes: { antialias: true },
      fadeDuration: 120,
    });
    this.map.on('load', () => this.onLoad());
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const u of this.unsub) u();
    this.map.remove();
  }

  private onLoad() {
    const s = useStore.getState();
    const map = this.map;
    map.addSource('tl-routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('tl-geofence', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const before = map.getLayer('hq-buildings') ? 'hq-buildings' : undefined;
    map.addLayer(
      {
        id: 'tl-geofence-fill',
        type: 'fill',
        source: 'tl-geofence',
        minzoom: 12,
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.07, 16, 0.035] },
      },
      before,
    );
    map.addLayer(
      {
        id: 'tl-geofence-line',
        type: 'line',
        source: 'tl-geofence',
        minzoom: 12,
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-dasharray': [3, 2], 'line-opacity': 0.7 },
      },
      before,
    );
    map.addLayer(
      {
        id: 'tl-routes-casing',
        type: 'line',
        source: 'tl-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, ['case', ['get', 'selected'], 6, 3.5], 15, ['case', ['get', 'selected'], 12, 7]],
          'line-opacity': ['case', ['get', 'faded'], 0.25, 0.9],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: 'tl-routes',
        type: 'line',
        source: 'tl-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, ['case', ['get', 'selected'], 3.5, 1.8], 15, ['case', ['get', 'selected'], 7, 4]],
          'line-opacity': ['case', ['get', 'faded'], 0.25, ['get', 'active'], 0.95, 0.7],
          'line-dasharray': ['case', ['get', 'active'], ['literal', [1, 0]], ['literal', [1.2, 1.4]]],
        },
      },
      before,
    );
    map.addLayer({ id: 'tl-routes-hit', type: 'line', source: 'tl-routes', paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0 } }, before);

    this.hq = new HqLayer(s.siteGeo, s.theme);
    map.addLayer(this.hq, map.getLayer('hq-street-labels') ? 'hq-street-labels' : undefined);

    for (const site of s.siteGeo) {
      const el = siteMarkerEl();
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        useStore.getState().select({ type: 'site', id: site.id }, { focus: true });
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat(site.location).addTo(map);
      this.siteMarkers.set(site.id, { marker, el });
    }

    {
      // Both HQs are ~500 m apart – one combined marker at regional zoom.
      const el = siteMarkerEl();
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const site = useStore.getState().siteGeo[0];
        useStore.getState().requestFocus({ kind: 'lnglat', lng: site.location.lng + 0.0005, lat: site.location.lat - 0.0021, zoom: 16.1 });
      });
      const c = s.siteGeo.reduce((a, x) => ({ lng: a.lng + x.location.lng / s.siteGeo.length, lat: a.lat + x.location.lat / s.siteGeo.length }), { lng: 0, lat: 0 });
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat(c).addTo(map);
      this.hqCluster = { marker, el };
    }

    map.on('click', (e) => this.onClick(e));
    map.on('mousemove', (e) => {
      if (useStore.getState().mapPick) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: ['tl-routes-hit'] }).length > 0 || !!this.hq?.pick(e.point);
      map.getCanvas().style.cursor = hit ? 'pointer' : '';
    });
    map.on('zoom', () => this.syncMarkers());
    map.on('rotate', () => this.syncMarkers());
    map.on('moveend', () => this.syncMarkers());

    this.loaded = true;
    this.syncAll();
    this.fitAll(false);
    const pending = useStore.getState().focus;
    if (pending) this.focus(pending);

    let prev = useStore.getState();
    this.unsub.push(
      useStore.subscribe((st) => {
        const p = prev;
        prev = st;
        if (st.theme !== p.theme) {
          applyTheme(map, st.theme);
          this.hq?.setTheme(st.theme);
        }
        if (st.focus && st.focus !== p.focus) this.focus(st.focus);
        if (st.mapPick !== p.mapPick) map.getCanvas().style.cursor = st.mapPick ? 'crosshair' : '';
        if (st.layers !== p.layers) this.applyLayers(st);
        if (st.is3d !== p.is3d) map.easeTo({ pitch: st.is3d ? 55 : 0, duration: 700 });
        if (
          st.telemetry !== p.telemetry ||
          st.plan !== p.plan ||
          st.selection !== p.selection ||
          st.routes !== p.routes ||
          st.projects !== p.projects ||
          st.vehicles !== p.vehicles ||
          st.people !== p.people
        ) {
          this.syncAll(st.telemetry !== p.telemetry);
        }
      }),
    );
    this.loop();
  }

  private applyLayers(st: S) {
    const vis = (id: string, on: boolean) => this.map.getLayer(id) && this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    for (const id of ['tl-routes', 'tl-routes-casing', 'tl-routes-hit']) vis(id, st.layers.routes);
    vis('hq-buildings', st.layers.buildings);
    vis(this.hq!.id, st.layers.buildings);
    vis('places-towns', st.layers.labels);
    vis('hq-street-labels', st.layers.labels);
    vis('streets-raster', st.layers.streets);
    this.syncAll();
  }

  private onClick(e: maplibregl.MapMouseEvent) {
    const st = useStore.getState();
    if (st.mapPick) {
      const pick = st.mapPick;
      st.setMapPick(null);
      pick.onPick({ lng: +e.lngLat.lng.toFixed(6), lat: +e.lngLat.lat.toFixed(6) });
      return;
    }
    const picked = this.hq?.pick(e.point);
    if (picked) return st.select({ type: 'vehicle', id: picked });
    const route = this.map.queryRenderedFeatures(e.point, { layers: ['tl-routes-hit'] })[0];
    if (route) return st.select({ type: 'vehicle', id: String(route.properties?.vehicleId) });
    st.select(null);
  }

  private bounds(points: LngLat[]): LngLatBoundsLike | null {
    if (!points.length) return null;
    const b = new maplibregl.LngLatBounds();
    for (const p of points) b.extend([p.lng, p.lat]);
    return b;
  }

  fitAll(animate = true) {
    const st = useStore.getState();
    const pts = [
      ...st.sites.map((s) => s.location),
      ...st.projects.filter((p) => p.status === 'active' || p.status === 'planned').map((p) => p.location),
    ];
    const b = this.bounds(pts);
    if (!b) return;
    const el = this.map.getContainer();
    const small = el.clientWidth < 900;
    this.map.fitBounds(b, {
      padding: small ? 40 : PANEL_PADDING,
      pitch: 32,
      bearing: -6,
      duration: animate ? 1600 : 0,
      maxZoom: 12,
    });
  }

  private focus(f: FocusRequest) {
    const st = useStore.getState();
    const fly = (center: LngLat, zoom: number, pitch = 58, bearing?: number) =>
      this.map.flyTo({
        center: [center.lng, center.lat],
        zoom,
        pitch,
        bearing: bearing ?? this.map.getBearing(),
        duration: 2000,
        essential: true,
        padding: { top: 120, bottom: 160, left: 40, right: 360 },
      });
    switch (f.kind) {
      case 'fit-all':
        return this.fitAll();
      case 'site': {
        const site = st.siteGeo.find((s) => s.id === f.id);
        if (!site) return;
        // look at the building from its yard side, slightly off-axis
        const h = site.yard.length ? meanHeading(site.yard.map((y) => y.heading)) : 0;
        const yardMid = site.yard.length
          ? { lng: site.yard.reduce((a, y) => a + y.lng, 0) / site.yard.length, lat: site.yard.reduce((a, y) => a + y.lat, 0) / site.yard.length }
          : site.location;
        const center = { lng: (site.location.lng + yardMid.lng) / 2, lat: (site.location.lat + yardMid.lat) / 2 };
        fly(center, 18.45, 58, SITE_CAMERA_BEARING[site.id] ?? (h + 180 + 25) % 360);
        return;
      }
      case 'project': {
        const p = st.projects.find((x) => x.id === f.id);
        if (p) fly(p.location, 15.2, 50);
        return;
      }
      case 'vehicle': {
        const t = st.telemetry[f.id];
        if (!t) return;
        const pos = this.hq?.vehicleLngLat(f.id) ?? { lng: t.lng, lat: t.lat };
        const home = isAtDepot(pos, st.sites);
        fly(pos, home ? 18.4 : 15.4, home ? 64 : 52);
        return;
      }
      case 'lnglat':
        fly({ lng: f.lng, lat: f.lat }, f.zoom ?? 15);
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.hq) return;
    for (const [id, m] of this.vehicleMarkers) {
      if (!m.shown) continue;
      const p = this.hq.vehicleLngLat(id);
      if (p) m.marker.setLngLat([p.lng, p.lat]);
    }
  };

  syncAll(telemetryOnly = false) {
    if (!this.loaded) return;
    const st = useStore.getState();
    this.syncVehicles(st);
    if (!telemetryOnly) this.syncRoutes(st);
    this.syncMarkers();
  }

  private assignmentOf(st: S, vehicleId: string): Assignment | undefined {
    return st.plan.assignments.find((a) => a.vehicleId === vehicleId);
  }

  private vehicleColor(st: S, a: Assignment | undefined) {
    if (a?.destination?.kind === 'project') {
      const pid = a.destination.projectId;
      return st.projects.find((p) => p.id === pid)?.color ?? TONE_HEX.primary;
    }
    if (a?.destination?.kind === 'custom') return '#64748b';
    return '#94a3b8';
  }

  private syncVehicles(st: S) {
    if (!this.hq) return;
    const sel = st.selection;
    const focusProject = sel?.type === 'project' ? sel.id : null;
    const states: VehicleState[] = [];
    for (const v of st.vehicles) {
      const t: Telemetry | undefined = st.telemetry[v.id];
      if (!t) continue;
      const a = this.assignmentOf(st, v.id);
      const moving = t.speedKmh > 2;
      const atDepot = isAtDepot(t, st.sites);
      states.push({
        id: v.id,
        kind: v.kind,
        plate: v.plate,
        lng: t.lng,
        lat: t.lat,
        heading: t.heading,
        moving,
        color: TONE_HEX[STAGE_TONE[a?.stage ?? 'planned']],
        selected: sel?.type === 'vehicle' && sel.id === v.id,
        dim: !!focusProject && !(a?.destination?.kind === 'project' && a.destination.projectId === focusProject),
        crew: a?.crew.length ?? 0,
        showCrew: st.layers.crew && !moving && !!a?.crew.length && ((atDepot && a.stage === 'planned') || a.stage === 'on_site'),
      });
    }
    const interp = st.fleet.source === 'fleetgo' ? st.fleet.pollSeconds * 1000 : 1050;
    this.hq.setVehicles(states, interp);

    // unassigned, available people wait at their HQ's muster point
    const assigned = new Set(st.plan.assignments.flatMap((a) => a.crew));
    this.hq.setIdleCrew(
      st.layers.crew
        ? st.sites.map((s) => ({
            siteId: s.id,
            count: st.people.filter((p) => p.homeSiteId === s.id && p.status === 'available' && !assigned.has(p.id)).length,
          }))
        : [],
    );
  }

  private syncRoutes(st: S) {
    const sel = st.selection;
    const features: GeoJSON.Feature[] = [];
    for (const a of st.plan.assignments) {
      const route = st.routes[a.vehicleId];
      if (!route || !a.crew.length) continue;
      const selected = sel?.type === 'vehicle' && sel.id === a.vehicleId;
      const projectSel = sel?.type === 'project' && a.destination?.kind === 'project' && a.destination.projectId === sel.id;
      const faded = !!sel && (sel.type === 'vehicle' || sel.type === 'project') && !selected && !projectSel;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: route.coords },
        properties: {
          vehicleId: a.vehicleId,
          color: this.vehicleColor(st, a),
          active: a.stage === 'departed' || a.stage === 'returning',
          selected: selected || projectSel,
          faded,
        },
      });
    }
    (this.map.getSource('tl-routes') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });

    // geofences: both depots + the selected vehicle's / project's destination
    const fences: GeoJSON.Feature[] = st.sites.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [circle(s.location, s.geofenceRadiusM)] },
      properties: { color: s.color },
    }));
    let dest: LngLat | null = null;
    if (sel?.type === 'vehicle') dest = destinationLocation(this.assignmentOf(st, sel.id)?.destination ?? null, st.projects);
    if (sel?.type === 'project') dest = st.projects.find((p) => p.id === sel.id)?.location ?? null;
    if (dest) fences.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [circle(dest, ARRIVE_RADIUS_M)] }, properties: { color: '#12a150' } });
    (this.map.getSource('tl-geofence') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: fences });
  }

  private syncMarkers() {
    if (!this.loaded) return;
    const st = useStore.getState();
    const zoom = this.map.getZoom();
    const bearing = this.map.getBearing();
    const sel = st.selection;
    const assigned = new Set(st.plan.assignments.flatMap((a) => a.crew));

    // Sites
    for (const site of st.sites) {
      const m = this.siteMarkers.get(site.id);
      if (!m) continue;
      const vehicles = st.vehicles.filter((v) => v.homeSiteId === site.id);
      const home = vehicles.filter((v) => {
        const t = st.telemetry[v.id];
        return t && isAtDepot(t, [site]);
      }).length;
      renderSiteMarker(m.el, {
        code: site.code,
        name: site.name,
        color: site.color,
        vehiclesHome: home,
        vehiclesTotal: vehicles.length,
        idle: st.people.filter((p) => p.homeSiteId === site.id && p.status === 'available' && !assigned.has(p.id)).length,
        selected: sel?.type === 'site' && sel.id === site.id,
      });
      m.el.style.display = zoom >= 16.2 || zoom < 14 ? 'none' : '';
    }
    if (this.hqCluster) {
      const vehicles = st.vehicles;
      const home = vehicles.filter((v) => st.telemetry[v.id] && isAtDepot(st.telemetry[v.id], st.sites)).length;
      renderSiteMarker(this.hqCluster.el, {
        code: st.sites.map((s) => s.code).join(' · '),
        name: st.sites.length > 1 ? 'DTE Lager' : (st.sites[0]?.name ?? 'DTE'),
        color: '#1f4fd6',
        vehiclesHome: home,
        vehiclesTotal: vehicles.length,
        idle: st.people.filter((p) => p.status === 'available' && !assigned.has(p.id)).length,
        selected: sel?.type === 'site',
      });
      this.hqCluster.el.style.display = zoom >= 14 ? 'none' : '';
      this.hqCluster.el.style.zIndex = '3';
    }

    // Projects – full labels where they fit, dots where they would collide.
    const placed: [number, number, number, number][] = [];
    if (this.hqCluster && zoom < 14) {
      const c = this.map.project(this.hqCluster.marker.getLngLat());
      placed.push([c.x - 130, c.y - 50, c.x + 130, c.y + 4]);
    }
    const order = st.projects
      .filter((p) => p.status !== 'completed')
      .map((p) => {
        const runs = st.plan.assignments.filter((a) => a.crew.length && a.destination?.kind === 'project' && a.destination.projectId === p.id);
        const isSel = sel?.type === 'project' && sel.id === p.id;
        const rank = (isSel ? 1000 : 0) + runs.reduce((n, a) => n + a.crew.length, 0) * 10 + (p.status === 'active' ? 5 : 0);
        return { p, rank };
      })
      .sort((a, b) => b.rank - a.rank);
    const compactIds = new Set<string>();
    for (const { p } of order) {
      const pt = this.map.project([p.location.lng, p.location.lat]);
      const w = 40 + p.name.length * 6.6 + 95;
      const box: [number, number, number, number] = [pt.x - 13, pt.y - 14, pt.x - 13 + w, pt.y + 14];
      const hit = placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      if (hit && !(sel?.type === 'project' && sel.id === p.id)) compactIds.add(p.id);
      else placed.push(box);
    }
    const seenP = new Set<string>();
    for (const p of st.projects) {
      if (p.status === 'completed') continue;
      seenP.add(p.id);
      let m = this.projectMarkers.get(p.id);
      if (!m) {
        const el = projectMarkerEl();
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          useStore.getState().select({ type: 'project', id: p.id });
        });
        const marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [-13, 0] }).setLngLat(p.location).addTo(this.map);
        m = { marker, el };
        this.projectMarkers.set(p.id, m);
      }
      m.marker.setLngLat(p.location);
      const runs = st.plan.assignments.filter((a) => a.crew.length && a.destination?.kind === 'project' && a.destination.projectId === p.id);
      renderProjectMarker(m.el, {
        name: p.name,
        code: p.code,
        color: p.color,
        vehicles: runs.length,
        crew: runs.reduce((n, a) => n + a.crew.length, 0),
        onSite: runs.filter((a) => a.stage === 'on_site').length,
        enRoute: runs.filter((a) => a.stage === 'departed').length,
        selected: sel?.type === 'project' && sel.id === p.id,
        dim: p.status !== 'active',
        compact: compactIds.has(p.id),
        status: p.status,
      });
    }
    for (const [id, m] of this.projectMarkers) {
      if (!seenP.has(id)) {
        m.marker.remove();
        this.projectMarkers.delete(id);
      }
    }

    // Vehicles – labels at street zoom are decluttered (selected first, moving next).
    const labelBoxes: [number, number, number, number][] = [];
    const vehicleOrder = st.vehicles
      .filter((v) => st.telemetry[v.id])
      .sort((a, b) => {
        const sa = sel?.type === 'vehicle' && sel.id === a.id ? 1 : 0;
        const sb = sel?.type === 'vehicle' && sel.id === b.id ? 1 : 0;
        return sb - sa || (st.telemetry[b.id].speedKmh > 2 ? 1 : 0) - (st.telemetry[a.id].speedKmh > 2 ? 1 : 0);
      });
    const compactLabel = new Set<string>();
    if (zoom >= 15.2) {
      for (const v of vehicleOrder) {
        const t = st.telemetry[v.id];
        const pt = this.map.project([t.lng, t.lat]);
        const box: [number, number, number, number] = [pt.x - 12, pt.y - 48, pt.x + 190, pt.y - 22];
        if (labelBoxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) compactLabel.add(v.id);
        else labelBoxes.push(box);
      }
    }
    const seenV = new Set<string>();
    for (const v of vehicleOrder) {
      const t = st.telemetry[v.id];
      if (!t) continue;
      seenV.add(v.id);
      let m = this.vehicleMarkers.get(v.id);
      if (!m) {
        const el = vehicleMarkerEl();
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          useStore.getState().select({ type: 'vehicle', id: v.id });
        });
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([t.lng, t.lat]).addTo(this.map);
        m = { marker, el, shown: true };
        this.vehicleMarkers.set(v.id, m);
      }
      const a = this.assignmentOf(st, v.id);
      const atDepot = isAtDepot(t, st.sites);
      const selected = sel?.type === 'vehicle' && sel.id === v.id;
      const moving = t.speedKmh > 2;
      const label = zoom >= 15.2 && !compactLabel.has(v.id);
      const show = selected || zoom >= 15.2 || (!atDepot && !(a?.stage === 'on_site' && zoom < 13));
      m.shown = show && st.layers.labels !== false ? true : show;
      m.el.style.display = show ? '' : 'none';
      const stage = a?.stage ?? 'planned';
      m.el.style.zIndex = selected ? '5' : label ? '3' : '2';
      renderVehicleMarker(m.el, {
        callsign: v.callsign,
        color: TONE_HEX[STAGE_TONE[stage]],
        heading: t.heading - bearing,
        moving,
        selected,
        label,
        lifted: zoom >= 15.2,
        status: a?.crew.length ? `${STAGE_LABEL[stage]} · ${destinationLabel(a.destination, st.projects)}` : v.status === 'active' ? 'Unassigned' : v.status,
      });
    }
    for (const [id, m] of this.vehicleMarkers) {
      if (!seenV.has(id)) {
        m.marker.remove();
        this.vehicleMarkers.delete(id);
      }
    }
  }
}

export function MapView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ctl = new MapController(ref.current!);
    current = ctl;
    return () => {
      ctl.destroy();
      if (current === ctl) current = null;
    };
  }, []);
  // MapLibre forces position:relative on its container, so size it from a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}
