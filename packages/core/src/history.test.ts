import { describe, expect, it } from 'vitest';
import { analyzeDay, keepPoint, type HistoryPlace, type TrackPoint } from './history.ts';

const DEPOT: HistoryPlace = { kind: 'site', id: 'hq', name: 'Lager Schieferstein', location: { lng: 8.4128, lat: 50.0068 }, radiusM: 110 };
const SITE: HistoryPlace = { kind: 'project', id: 'p1', name: 'Hallenbau Kelsterbach', location: { lng: 8.53, lat: 50.06 }, radiusM: 250 };

/** A day: parked at the depot, drive to the project, a red light on the way, work, drive back. */
function day(): TrackPoint[] {
  const pts: TrackPoint[] = [];
  const t0 = 1_760_000_000;
  const at = (s: number, lng: number, lat: number, v: number) => pts.push([t0 + s, lng, lat, v, 60, v > 0 ? 1 : 0]);
  for (let s = 0; s <= 1800; s += 300) at(s, 8.4128, 50.0068, 0); // parked 30 min
  for (let i = 1; i <= 20; i++) at(1800 + i * 60, 8.4128 + (0.1172 * i) / 20, 50.0068 + (0.0532 * i) / 20, 50); // 20 min drive
  at(2400 + 30, 8.47, 50.033, 0); // 60 s at a red light – not a stop
  at(2400 + 90, 8.471, 50.034, 40);
  for (let s = 3000; s <= 3000 + 4 * 3600; s += 300) at(s, 8.53, 50.06, 0); // 4 h on site
  for (let i = 1; i <= 20; i++) at(3000 + 4 * 3600 + i * 60, 8.53 - (0.1172 * i) / 20, 50.06 - (0.0532 * i) / 20, 55);
  for (let s = 0; s <= 900; s += 300) at(3000 + 4 * 3600 + 1200 + 60 + s, 8.4128, 50.0068, 0); // back, parked
  return pts.sort((a, b) => a[0] - b[0]);
}

describe('vehicle history', () => {
  it('splits a day into stops and trips with places', () => {
    const h = analyzeDay(day(), [DEPOT, SITE]);
    expect(h.stops.map((s) => s.place?.name)).toEqual(['Lager Schieferstein', 'Hallenbau Kelsterbach', 'Lager Schieferstein']);
    expect(h.trips).toHaveLength(2); // the red light does not split the trip
    expect(h.trips[0].distanceM).toBeGreaterThan(9_000);
    expect(h.trips[0].maxSpeedKmh).toBe(50);
    expect(h.totals.stops).toBe(3);
    expect(h.totals.distanceM).toBe(h.trips[0].distanceM + h.trips[1].distanceM);
    expect(h.stops[1].end - h.stops[1].start).toBeGreaterThanOrEqual(4 * 3600);
  });

  it('empty day', () => {
    expect(analyzeDay([])).toEqual({ stops: [], trips: [], totals: { distanceM: 0, drivingS: 0, stops: 0 } });
  });

  it('thins out the position stream', () => {
    const p = (s: number, lng: number, v: number, h = 90): TrackPoint => [s, lng, 50, v, h, v > 0 ? 1 : 0];
    expect(keepPoint(undefined, p(0, 8, 0))).toBe(true);
    expect(keepPoint(p(0, 8, 0), p(60, 8, 0))).toBe(false); // standing: every 5 min
    expect(keepPoint(p(0, 8, 0), p(301, 8, 0))).toBe(true);
    expect(keepPoint(p(0, 8, 0), p(1, 8, 20))).toBe(true); // starts driving
    expect(keepPoint(p(0, 8, 50), p(1, 8.0001, 50))).toBe(false); // 7 m, 1 s later
    expect(keepPoint(p(0, 8, 50), p(5, 8.0005, 50))).toBe(false); // 36 m at 50 km/h: not yet
    expect(keepPoint(p(0, 8, 50), p(5, 8.001, 50))).toBe(true); // 72 m
    expect(keepPoint(p(0, 8, 50, 90), p(2, 8.0001, 50, 130))).toBe(true); // turned 40°
    expect(keepPoint(p(10, 8, 50), p(10, 8.1, 50))).toBe(false); // not newer
  });
});
