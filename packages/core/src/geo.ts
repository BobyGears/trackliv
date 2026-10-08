import type { LngLat } from './types.ts';

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing a → b in degrees clockwise from north. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Local east/north metres around an origin (equirectangular with WGS84 radii of curvature).
 * Accurate to well below a metre over the few kilometres of an HQ scene.
 */
export function makeLocalProjection(origin: LngLat) {
  const lat0 = toRad(origin.lat);
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * lat0) + 1.175 * Math.cos(4 * lat0);
  const mPerDegLng = 111412.84 * Math.cos(lat0) - 93.5 * Math.cos(3 * lat0);
  return {
    origin,
    mPerDegLat,
    mPerDegLng,
    toLocal(p: LngLat): { x: number; y: number } {
      return { x: (p.lng - origin.lng) * mPerDegLng, y: (p.lat - origin.lat) * mPerDegLat };
    },
    toLngLat(x: number, y: number): LngLat {
      return { lng: origin.lng + x / mPerDegLng, lat: origin.lat + y / mPerDegLat };
    },
  };
}

export type LocalProjection = ReturnType<typeof makeLocalProjection>;

export function lerpLngLat(a: LngLat, b: LngLat, t: number): LngLat {
  return { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t };
}

/** Length of a [lng,lat] polyline in metres. */
export function polylineLengthM(coords: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineM(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] },
    );
  }
  return len;
}

/** Point and heading at `distM` metres along a [lng,lat] polyline. */
export function alongPolyline(
  coords: [number, number][],
  distM: number,
): { point: LngLat; heading: number; done: boolean } {
  if (coords.length === 0) return { point: { lng: 0, lat: 0 }, heading: 0, done: true };
  if (coords.length === 1) return { point: { lng: coords[0][0], lat: coords[0][1] }, heading: 0, done: true };
  let remaining = Math.max(0, distM);
  for (let i = 1; i < coords.length; i++) {
    const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
    const b = { lng: coords[i][0], lat: coords[i][1] };
    const seg = haversineM(a, b);
    if (remaining <= seg || i === coords.length - 1) {
      const t = seg > 0 ? Math.min(1, remaining / seg) : 1;
      return { point: lerpLngLat(a, b, t), heading: bearingDeg(a, b), done: i === coords.length - 1 && remaining >= seg };
    }
    remaining -= seg;
  }
  const last = coords[coords.length - 1];
  return { point: { lng: last[0], lat: last[1] }, heading: 0, done: true };
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '–';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
