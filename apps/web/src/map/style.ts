import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import type { Theme } from '../lib/store';

/**
 * Offline basemap built from Overture Maps extracts served by the TrackLiv API:
 * a Rhein-Main overview (towns, motorways, rivers, forests) plus full-detail surroundings
 * of both HQs (every building with height, streets, yards, rail).
 */

export const PALETTE = {
  light: {
    background: '#e8ecf2',
    urban: '#d9dfe8',
    forest: '#d5e4d6',
    water: '#b3d0f0',
    waterLine: '#a2c4ec',
    rail: '#aeb8c6',
    roadCasing: '#c9d1dd',
    motorway: '#ffffff',
    motorwayCasing: '#b9c4d3',
    primary: '#ffffff',
    secondary: '#f9fafc',
    minor: '#ffffff',
    path: '#d3d9e2',
    grass: '#d8e6d3',
    parking: '#dce1e9',
    building: '#f7f8fb',
    buildingDim: '#eef1f5',
    label: '#3f4a5c',
    labelHalo: 'rgba(255,255,255,0.92)',
    streetLabel: '#7b8597',
    geofence: '#2f6bff',
  },
  dark: {
    background: '#0b1018',
    urban: '#121a25',
    forest: '#0f1a18',
    water: '#0c2238',
    waterLine: '#123150',
    rail: '#2a3546',
    roadCasing: '#0b1018',
    motorway: '#2b3a50',
    motorwayCasing: '#0b1018',
    primary: '#223044',
    secondary: '#1c2838',
    minor: '#1a2433',
    path: '#1a2331',
    grass: '#11201b',
    parking: '#172130',
    building: '#1f2a3a',
    buildingDim: '#1a2432',
    label: '#9fb0c6',
    labelHalo: 'rgba(8,12,18,0.9)',
    streetLabel: '#6c7d94',
    geofence: '#4d82ff',
  },
} as const;

const origin = () => window.location.origin;

/**
 * Raster tiles for the optional "Street detail" layer (needs internet). Defaults to the OSM tile
 * server – fine for a small dispatch office; set VITE_STREET_TILES to your own provider for heavier use.
 */
const STREET_TILES = (import.meta.env.VITE_STREET_TILES as string | undefined) ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Extent of the offline basemap (see scripts/geo/fetch_overture.py REGION_BBOX). */
export const REGION_BBOX: [number, number, number, number] = [7.95, 49.75, 9.05, 50.35];

/** Nested frames (world minus a growing box) that stack into a soft fade at the data edge. */
function regionMask(): GeoJSON.FeatureCollection {
  const [w, s, e, n] = REGION_BBOX;
  const world: [number, number][] = [
    [-179, -85],
    [179, -85],
    [179, 85],
    [-179, 85],
    [-179, -85],
  ];
  const features: GeoJSON.Feature[] = [-0.1, -0.075, -0.05, -0.03, -0.01, 0.01, 0.04, 0.09, 0.2].map((d) => {
    const dy = d * 0.62;
    const hole: [number, number][] = [
      [w - d, s - dy],
      [w - d, n + dy],
      [e + d, n + dy],
      [e + d, s - dy],
      [w - d, s - dy],
    ];
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [world, hole] }, properties: {} };
  });
  return { type: 'FeatureCollection', features };
}
const geo = (name: string) => `${origin()}/api/geo/${name}`;

const ROAD_WIDTH: Record<string, [number, number][]> = {
  motorway: [
    [6, 0.8],
    [10, 2.4],
    [14, 9],
    [18, 40],
  ],
  trunk: [
    [7, 0.6],
    [10, 1.8],
    [14, 7],
    [18, 32],
  ],
  primary: [
    [8, 0.4],
    [11, 1.4],
    [14, 6],
    [18, 28],
  ],
  secondary: [
    [9, 0.3],
    [12, 1.2],
    [15, 6],
    [18, 22],
  ],
};

const interp = (stops: [number, number][]) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops.flat()] as unknown as number;

export function buildStyle(theme: Theme): StyleSpecification {
  const c = PALETTE[theme];
  return {
    version: 8,
    name: 'TrackLiv offline',
    glyphs: `${origin()}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      landcover: { type: 'geojson', data: geo('region-landcover.geojson'), tolerance: 0.6 },
      water: { type: 'geojson', data: geo('region-water.geojson'), tolerance: 0.4 },
      roads: { type: 'geojson', data: geo('region-roads.geojson'), tolerance: 0.5 },
      rail: { type: 'geojson', data: geo('region-rail.geojson'), tolerance: 0.6 },
      places: { type: 'geojson', data: geo('region-places.geojson') },
      'hq-areas': { type: 'geojson', data: geo('hq-areas.geojson') },
      'hq-water': { type: 'geojson', data: geo('hq-water.geojson') },
      'hq-roads': { type: 'geojson', data: geo('hq-roads.geojson') },
      'hq-rail': { type: 'geojson', data: geo('hq-rail.geojson') },
      'hq-buildings': { type: 'geojson', data: geo('hq-buildings.geojson') },
      'region-mask': { type: 'geojson', data: regionMask() },
      streets: {
        type: 'raster',
        tiles: [STREET_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': c.background } },
      {
        id: 'landcover-forest',
        type: 'fill',
        source: 'landcover',
        filter: ['==', ['get', 'sub'], 'forest'],
        paint: { 'fill-color': c.forest, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 1, 15, 0.5] },
      },
      {
        id: 'landcover-urban',
        type: 'fill',
        source: 'landcover',
        filter: ['==', ['get', 'sub'], 'urban'],
        paint: { 'fill-color': c.urban, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 1, 15, 0.6] },
      },
      {
        id: 'hq-areas-green',
        type: 'fill',
        source: 'hq-areas',
        minzoom: 13,
        filter: [
          'any',
          ['in', ['get', 'sub'], ['literal', ['park', 'managed', 'agriculture', 'recreation', 'horticulture', 'protected', 'forest', 'shrub', 'grass']]],
        ],
        paint: { 'fill-color': c.grass, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0.9] },
      },
      {
        id: 'hq-areas-paved',
        type: 'fill',
        source: 'hq-areas',
        minzoom: 14,
        filter: ['==', ['get', 'layer'], 'infra'],
        paint: { 'fill-color': c.parking, 'fill-opacity': 0.9 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'water',
        filter: ['==', ['get', 'kind'], 'area'],
        paint: { 'fill-color': c.water },
      },
      {
        id: 'water-line',
        type: 'line',
        source: 'water',
        filter: ['==', ['get', 'kind'], 'line'],
        paint: { 'line-color': c.waterLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 3] },
      },
      { id: 'hq-water', type: 'fill', source: 'hq-water', minzoom: 13, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': c.water } },
      {
        id: 'rail',
        type: 'line',
        source: 'rail',
        minzoom: 9,
        maxzoom: 14,
        paint: { 'line-color': c.rail, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 14, 1.4], 'line-dasharray': [3, 2] },
      },
      {
        id: 'hq-rail',
        type: 'line',
        source: 'hq-rail',
        minzoom: 14,
        paint: { 'line-color': c.rail, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.2, 18, 4], 'line-dasharray': [2, 1.5] },
      },
      // Region roads (casing then fill) — hidden at HQ zoom where the detailed streets take over.
      ...(['secondary', 'primary', 'trunk', 'motorway'] as const).flatMap((cls) => [
        {
          id: `road-${cls}-casing`,
          type: 'line' as const,
          source: 'roads',
          filter: ['in', ['get', 'cls'], ['literal', [cls, `${cls}_link`]]] as unknown as boolean,
          minzoom: cls === 'secondary' ? 10 : cls === 'primary' ? 8 : 5,
          layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
          paint: {
            'line-color': cls === 'motorway' ? c.motorwayCasing : c.roadCasing,
            'line-width': interp(ROAD_WIDTH[cls].map(([z, w]) => [z, w + (z < 12 ? 0.8 : 2)] as [number, number])),
          },
        },
        {
          id: `road-${cls}`,
          type: 'line' as const,
          source: 'roads',
          filter: ['in', ['get', 'cls'], ['literal', [cls, `${cls}_link`]]] as unknown as boolean,
          minzoom: cls === 'secondary' ? 10 : cls === 'primary' ? 8 : 5,
          layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
          paint: {
            'line-color': cls === 'motorway' ? c.motorway : cls === 'secondary' ? c.secondary : c.primary,
            'line-width': interp(ROAD_WIDTH[cls]),
          },
        },
      ]),
      // Optional online street detail (Map layers → "Street detail"), greyed to match the UI.
      {
        id: 'streets-raster',
        type: 'raster',
        source: 'streets',
        layout: { visibility: 'none' },
        paint: {
          'raster-saturation': -0.85,
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 14, 0.75],
          'raster-contrast': -0.15,
          'raster-brightness-min': theme === 'dark' ? 0 : 0.12,
          'raster-brightness-max': theme === 'dark' ? 0.35 : 1,
        },
      },
      // Fade out everything beyond the extracted Rhein-Main region.
      {
        id: 'region-mask',
        type: 'fill',
        source: 'region-mask',
        paint: { 'fill-color': c.background, 'fill-opacity': 0.32, 'fill-antialias': false },
      },
      // HQ streets
      {
        id: 'hq-paths',
        type: 'line',
        source: 'hq-roads',
        minzoom: 15,
        filter: ['in', ['get', 'cls'], ['literal', ['footway', 'path', 'steps', 'cycleway', 'track', 'pedestrian']]],
        paint: { 'line-color': c.path, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 19, 3], 'line-dasharray': [2, 1] },
      },
      {
        id: 'hq-roads-casing',
        type: 'line',
        source: 'hq-roads',
        minzoom: 13,
        filter: ['!', ['in', ['get', 'cls'], ['literal', ['footway', 'path', 'steps', 'cycleway', 'track', 'pedestrian']]]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': c.roadCasing,
          'line-width': [
            'interpolate',
            ['exponential', 1.8],
            ['zoom'],
            13,
            ['match', ['get', 'cls'], 'service', 0.8, 1.6],
            19,
            ['match', ['get', 'cls'], 'service', 18, ['primary', 'secondary', 'trunk'], 46, 34],
          ],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 1],
        },
      },
      {
        id: 'hq-roads',
        type: 'line',
        source: 'hq-roads',
        minzoom: 13,
        filter: ['!', ['in', ['get', 'cls'], ['literal', ['footway', 'path', 'steps', 'cycleway', 'track', 'pedestrian']]]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': c.minor,
          'line-width': [
            'interpolate',
            ['exponential', 1.8],
            ['zoom'],
            13,
            ['match', ['get', 'cls'], 'service', 0.4, 1],
            19,
            ['match', ['get', 'cls'], 'service', 15, ['primary', 'secondary', 'trunk'], 42, 30],
          ],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 1],
        },
      },
      {
        id: 'hq-buildings',
        type: 'fill-extrusion',
        source: 'hq-buildings',
        minzoom: 13.5,
        filter: ['!', ['has', 'site']],
        paint: {
          'fill-extrusion-color': c.building,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, ['get', 'h']],
          'fill-extrusion-base': ['coalesce', ['get', 'mh'], 0],
          'fill-extrusion-opacity': 0.94,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        id: 'hq-street-labels',
        type: 'symbol',
        source: 'hq-roads',
        minzoom: 16,
        filter: ['has', 'name'],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10, 19, 13],
          'text-letter-spacing': 0.02,
        },
        paint: { 'text-color': c.streetLabel, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.4 },
      },
      {
        id: 'places-towns',
        type: 'symbol',
        source: 'places',
        filter: [
          'any',
          ['all', ['==', ['get', 'rank'], 1], ['>=', ['zoom'], 6]],
          ['all', ['==', ['get', 'rank'], 2], ['>=', ['zoom'], 9.2]],
          ['all', ['==', ['get', 'rank'], 3], ['>=', ['zoom'], 11.5]],
        ],
        maxzoom: 15,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['match', ['get', 'rank'], 1, ['literal', ['Noto Sans Medium']], ['literal', ['Noto Sans Regular']]],
          'text-size': ['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'rank'], 1, 12, 2, 11, 10], 12, ['match', ['get', 'rank'], 1, 17, 2, 13, 11.5]],
          'text-transform': ['match', ['get', 'rank'], 1, 'uppercase', 'none'],
          'text-letter-spacing': ['match', ['get', 'rank'], 1, 0.12, 0.02],
          'symbol-sort-key': ['-', 0, ['get', 'pop']],
          'text-padding': 6,
        },
        paint: {
          'text-color': c.label,
          'text-halo-color': c.labelHalo,
          'text-halo-width': 1.6,
          'text-opacity': ['match', ['get', 'rank'], 1, 0.9, 0.85],
        },
      },
    ],
  } as StyleSpecification;
}

/** Re-colour an existing map for a theme switch without rebuilding the style. */
export function applyTheme(map: MlMap, theme: Theme) {
  const c = PALETTE[theme];
  const set = (layer: string, prop: string, value: unknown) => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop as never, value as never);
  };
  set('background', 'background-color', c.background);
  set('landcover-forest', 'fill-color', c.forest);
  set('landcover-urban', 'fill-color', c.urban);
  set('hq-areas-green', 'fill-color', c.grass);
  set('hq-areas-paved', 'fill-color', c.parking);
  set('water', 'fill-color', c.water);
  set('hq-water', 'fill-color', c.water);
  set('water-line', 'line-color', c.waterLine);
  set('rail', 'line-color', c.rail);
  set('hq-rail', 'line-color', c.rail);
  for (const cls of ['secondary', 'primary', 'trunk', 'motorway']) {
    set(`road-${cls}-casing`, 'line-color', cls === 'motorway' ? c.motorwayCasing : c.roadCasing);
    set(`road-${cls}`, 'line-color', cls === 'motorway' ? c.motorway : cls === 'secondary' ? c.secondary : c.primary);
  }
  set('hq-paths', 'line-color', c.path);
  set('hq-roads-casing', 'line-color', c.roadCasing);
  set('hq-roads', 'line-color', c.minor);
  set('hq-buildings', 'fill-extrusion-color', c.building);
  set('hq-street-labels', 'text-color', c.streetLabel);
  set('hq-street-labels', 'text-halo-color', c.labelHalo);
  set('places-towns', 'text-color', c.label);
  set('places-towns', 'text-halo-color', c.labelHalo);
  set('region-mask', 'fill-color', c.background);
  set('streets-raster', 'raster-brightness-min', theme === 'dark' ? 0 : 0.12);
  set('streets-raster', 'raster-brightness-max', theme === 'dark' ? 0.35 : 1);
  set('tl-geofence-fill', 'fill-color', c.geofence);
  set('tl-geofence-line', 'line-color', c.geofence);
}
