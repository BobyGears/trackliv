import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RoadGraph, type LngLat, type Route, type RoadGraphData, type Site } from '@trackliv/core';
import { config } from './config.ts';

export interface SiteGeo extends Site {
  heightM: number | null;
  footprint: [number, number][];
  yard: { lng: number; lat: number; heading: number }[];
  gate: LngLat;
}

export const siteGeo: SiteGeo[] = JSON.parse(readFileSync(join(config.geoDir, 'sites.json'), 'utf8'));

export const sites: Site[] = siteGeo.map(({ id, code, name, address, location, geofenceRadiusM, color }) => ({
  id,
  code,
  name,
  address,
  location,
  geofenceRadiusM,
  color,
}));

let graph: RoadGraph | null = null;
export function roadGraph(): RoadGraph {
  if (!graph) {
    const t0 = Date.now();
    const data = JSON.parse(readFileSync(join(config.geoDir, 'road-graph.json'), 'utf8')) as RoadGraphData;
    graph = new RoadGraph(data);
    console.log(`[geo] road graph: ${graph.nodeCount} nodes (${Date.now() - t0} ms)`);
  }
  return graph;
}

const cache = new Map<string, Route | null>();
const key = (p: LngLat) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;

/** Road route with an in-memory cache; falls back to a straight line if the graph has no path. */
export function routeBetween(from: LngLat, to: LngLat): Route {
  const k = `${key(from)}>${key(to)}`;
  let r = cache.get(k);
  if (r === undefined) {
    r = roadGraph().route(from, to);
    if (cache.size > 5000) cache.clear();
    cache.set(k, r);
  }
  if (r) return r;
  const dx = (to.lng - from.lng) * 71500;
  const dy = (to.lat - from.lat) * 111200;
  const lengthM = Math.hypot(dx, dy) * 1.3;
  return {
    coords: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
    lengthM,
    durationMin: Math.max(1, Math.round(lengthM / 1000 / 40 * 60)),
  };
}

/** Yard slot for a vehicle: the n-th vehicle of a site gets the n-th slot. */
export function yardSlot(siteId: string, index: number) {
  const s = siteGeo.find((x) => x.id === siteId) ?? siteGeo[0];
  const slot = s.yard[index % s.yard.length];
  return slot ?? { ...s.location, heading: 0 };
}
