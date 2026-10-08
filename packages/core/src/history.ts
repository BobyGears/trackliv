import { haversineM } from './geo.ts';
import type { LngLat } from './types.ts';

/**
 * Vehicle history: the positions TrackLiv receives (FleetGO or simulator) are kept as a thinned-out
 * track per vehicle and day, and turned into stops and trips like a driver's logbook.
 */

/** [unix seconds, lng, lat, speed km/h, heading °, ignition 0/1] */
export type TrackPoint = [number, number, number, number, number, number];

export interface HistoryPlace {
  kind: 'site' | 'project';
  id: string;
  name: string;
  location: LngLat;
  radiusM: number;
}

export interface Stop {
  start: number;
  end: number;
  location: LngLat;
  place?: { kind: HistoryPlace['kind']; id: string; name: string };
  address?: string;
}

export interface Trip {
  start: number;
  end: number;
  from: LngLat;
  to: LngLat;
  distanceM: number;
  maxSpeedKmh: number;
}

export interface DayHistory {
  stops: Stop[];
  trips: Trip[];
  totals: { distanceM: number; drivingS: number; stops: number; firstDeparture?: number; lastArrival?: number };
}

/** Below this speed a vehicle counts as standing. */
export const STANDING_KMH = 3;
/** Standing at least this long is a stop (shorter: traffic light, junction). */
export const MIN_STOP_S = 3 * 60;

/**
 * Should a new position be kept? Thins out the stream (30 s polls from FleetGO, 1 s from the
 * simulator) without losing the shape of the route: while moving every 30 m (more when fast) / 20° turn / 30 s,
 * while standing every 5 minutes, and always when the vehicle starts or stops.
 */
export function keepPoint(last: TrackPoint | undefined, p: TrackPoint): boolean {
  if (!last) return true;
  if (p[0] <= last[0]) return false;
  const moving = p[3] >= STANDING_KMH;
  const wasMoving = last[3] >= STANDING_KMH;
  if (moving !== wasMoving || p[5] !== last[5]) return true;
  const dt = p[0] - last[0];
  if (!moving) return dt >= 300;
  const turn = Math.abs(((p[4] - last[4] + 540) % 360) - 180);
  // faster = further apart (a straight motorway needs fewer points than a town)
  const minDist = Math.max(30, (p[3] / 3.6) * 4);
  return dt >= 30 || turn >= 20 || haversineM({ lng: last[1], lat: last[2] }, { lng: p[1], lat: p[2] }) >= minDist;
}

function placeAt(loc: LngLat, places: readonly HistoryPlace[]) {
  let best: HistoryPlace | undefined;
  let bestD = Infinity;
  for (const pl of places) {
    const d = haversineM(loc, pl.location);
    if (d <= pl.radiusM && d < bestD) {
      best = pl;
      bestD = d;
    }
  }
  return best && { kind: best.kind, id: best.id, name: best.name };
}

/** Split a day's track into stops and the trips between them. */
export function analyzeDay(points: readonly TrackPoint[], places: readonly HistoryPlace[] = [], addressAt?: (p: TrackPoint) => string | undefined): DayHistory {
  const stops: Stop[] = [];
  const trips: Trip[] = [];
  if (!points.length) return { stops, trips, totals: { distanceM: 0, drivingS: 0, stops: 0 } };

  // standing runs: consecutive points below STANDING_KMH
  type Run = { i0: number; i1: number };
  const runs: Run[] = [];
  let cur: Run | null = null;
  points.forEach((p, i) => {
    if (p[3] < STANDING_KMH) {
      if (cur) cur.i1 = i;
      else cur = { i0: i, i1: i };
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  });
  if (cur) runs.push(cur);

  // a run is a stop if it lasts long enough – or it opens/closes the day (parked overnight)
  const last = points.length - 1;
  const stopRuns = runs.filter((r) => {
    const end = r.i1 < last ? points[r.i1 + 1][0] : points[r.i1][0];
    return end - points[r.i0][0] >= MIN_STOP_S || r.i0 === 0 || r.i1 === last;
  });

  for (const r of stopRuns) {
    const p = points[r.i0];
    const location = { lng: p[1], lat: p[2] };
    stops.push({
      start: p[0],
      end: r.i1 < last ? points[r.i1 + 1][0] : points[r.i1][0],
      location,
      place: placeAt(location, places),
      address: addressAt?.(p),
    });
  }

  // trips: from the end of one stop to the start of the next (or the day's edges)
  const bounds: [number, number][] = [];
  let from = stopRuns.length && stopRuns[0].i0 === 0 ? stopRuns[0].i1 : 0;
  for (const r of stopRuns) {
    if (r.i0 > from) bounds.push([from, r.i0]);
    from = r.i1;
  }
  if (from < last && !(stopRuns.length && stopRuns[stopRuns.length - 1].i1 === last)) bounds.push([from, last]);

  for (const [a, b] of bounds) {
    let distanceM = 0;
    let maxSpeedKmh = 0;
    for (let i = a + 1; i <= b; i++) {
      distanceM += haversineM({ lng: points[i - 1][1], lat: points[i - 1][2] }, { lng: points[i][1], lat: points[i][2] });
      maxSpeedKmh = Math.max(maxSpeedKmh, points[i][3]);
    }
    if (distanceM < 50) continue; // GPS jitter while parked
    trips.push({
      start: points[a][0],
      end: points[b][0],
      from: { lng: points[a][1], lat: points[a][2] },
      to: { lng: points[b][1], lat: points[b][2] },
      distanceM: Math.round(distanceM),
      maxSpeedKmh: Math.round(maxSpeedKmh),
    });
  }

  return {
    stops,
    trips,
    totals: {
      distanceM: trips.reduce((s, t) => s + t.distanceM, 0),
      drivingS: trips.reduce((s, t) => s + (t.end - t.start), 0),
      stops: stops.length,
      firstDeparture: trips[0]?.start,
      lastArrival: trips.length ? trips[trips.length - 1].end : undefined,
    },
  };
}
