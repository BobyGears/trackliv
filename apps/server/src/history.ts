import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { analyzeDay, keepPoint, type HistoryPlace, type Telemetry, type TrackPoint } from '@trackliv/core';
import { config } from './config.ts';
import { db } from './db.ts';
import { sites } from './geodata.ts';

/**
 * Where each vehicle was: every position TrackLiv receives (FleetGO or simulator) is thinned out
 * and stored per day in <data>/history/YYYY-MM-DD.json.gz, kept for KEEP_DAYS days.
 */

const DIR = join(config.dataDir, 'history');
const KEEP_DAYS = 120;
/** Projects count as "visited" within this distance of their pin. */
const PROJECT_RADIUS_M = 250;

type Day = Record<string, TrackPoint[]>;
const days = new Map<string, Day>();
const dirty = new Set<string>();
/** Last address FleetGO reported near a position (key: vehicle + rounded position). */
const addresses = new Map<string, string>();

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const dateOf = (ms: number) => dayFmt.format(ms);
const file = (date: string) => join(DIR, `${date}.json.gz`);
const addrKey = (vehicleId: string, lng: number, lat: number) => `${vehicleId}:${lng.toFixed(3)},${lat.toFixed(3)}`;

function load(date: string): Day {
  let day = days.get(date);
  if (!day) {
    const f = file(date);
    day = existsSync(f) ? (JSON.parse(gunzipSync(readFileSync(f)).toString('utf8')) as Day) : {};
    days.set(date, day);
  }
  return day;
}

/** Called for every telemetry batch (ops.ingest). */
export function recordHistory(list: readonly Telemetry[]) {
  for (const t of list) {
    const ms = Date.parse(t.ts);
    if (!Number.isFinite(ms)) continue;
    const date = dateOf(ms);
    const day = load(date);
    const track = (day[t.vehicleId] ??= []);
    const p: TrackPoint = [Math.round(ms / 1000), +t.lng.toFixed(6), +t.lat.toFixed(6), Math.round(t.speedKmh), Math.round(t.heading), t.ignition ? 1 : 0];
    if (keepPoint(track[track.length - 1], p)) {
      track.push(p);
      dirty.add(date);
    }
    if (t.address && t.speedKmh < 3) addresses.set(addrKey(t.vehicleId, t.lng, t.lat), t.address);
  }
}

export function flushHistory() {
  if (!dirty.size) return;
  mkdirSync(DIR, { recursive: true });
  for (const date of dirty) {
    const tmp = `${file(date)}.tmp`;
    writeFileSync(tmp, gzipSync(JSON.stringify(days.get(date) ?? {})));
    renameSync(tmp, file(date));
  }
  dirty.clear();
  // keep only recent days in memory
  const recent = [...days.keys()].sort().slice(-3);
  for (const d of days.keys()) if (!recent.includes(d)) days.delete(d);
}

function cleanup() {
  if (!existsSync(DIR)) return;
  const cutoff = dateOf(Date.now() - KEEP_DAYS * 86400_000);
  for (const f of readdirSync(DIR)) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(f);
    if (m && m[1] < cutoff) unlinkSync(join(DIR, f));
  }
}

setInterval(flushHistory, 60_000).unref();
setInterval(cleanup, 6 * 3600_000).unref();
cleanup();

/** Track, stops and trips of one vehicle on one day. */
export function vehicleHistory(vehicleId: string, date: string) {
  const points = load(date)[vehicleId] ?? [];
  const places: HistoryPlace[] = [
    ...sites.map((s) => ({ kind: 'site' as const, id: s.id, name: s.name, location: s.location, radiusM: s.geofenceRadiusM })),
    ...db.data.projects.map((p) => ({ kind: 'project' as const, id: p.id, name: p.name, location: p.location, radiusM: PROJECT_RADIUS_M })),
  ];
  const day = analyzeDay(points, places, (p) => addresses.get(addrKey(vehicleId, p[1], p[2])));
  return { date, vehicleId, points, ...day };
}

/** Days with recorded history (newest first) – for the date picker. */
export function historyDays(): string[] {
  const onDisk = existsSync(DIR) ? readdirSync(DIR).flatMap((f) => /^(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(f)?.[1] ?? []) : [];
  return [...new Set([...onDisk, ...days.keys()])].sort().reverse();
}
