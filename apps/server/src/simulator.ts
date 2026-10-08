import {
  alongPolyline,
  createRng,
  destinationLocation,
  timeOnDate,
  type Assignment,
  type LngLat,
  type Telemetry,
  type Vehicle,
} from '@trackliv/core';
import { db } from './db.ts';
import { routeBetween, siteGeo, yardSlot } from './geodata.ts';
import { ops } from './ops.ts';

/**
 * Demo fleet simulator used when no FleetGO credentials are configured.
 * Vehicles wait in their HQ yard slot, leave at the planned departure time, drive the real road
 * network to their destination, stay until the planned return time and drive back.
 * Changing a destination or crew in the UI reroutes vehicles immediately.
 */

type Mode = 'parked' | 'driving' | 'at_dest';

interface SimRoute {
  coords: [number, number][];
  lengthM: number;
  progressM: number;
  speedMps: number;
  purpose: 'out' | 'back';
  destKey: string | null;
}

interface SimVehicle {
  id: string;
  mode: Mode;
  pos: LngLat;
  heading: number;
  speedKmh: number;
  odometerKm: number;
  fuelPct: number;
  route: SimRoute | null;
  destKey: string | null;
  slot: { lng: number; lat: number; heading: number };
  jitter: () => number;
}

const state = new Map<string, SimVehicle>();

function slotFor(v: Vehicle) {
  const siblings = db.data.vehicles.filter((x) => x.homeSiteId === v.homeSiteId);
  return yardSlot(v.homeSiteId, Math.max(0, siblings.findIndex((x) => x.id === v.id)));
}

function ensure(v: Vehicle): SimVehicle {
  let s = state.get(v.id);
  if (!s) {
    const slot = slotFor(v);
    const rng = createRng(v.id);
    s = {
      id: v.id,
      mode: 'parked',
      pos: { lng: slot.lng, lat: slot.lat },
      heading: slot.heading,
      speedKmh: 0,
      odometerKm: Math.round(18000 + rng() * 90000),
      fuelPct: Math.round(55 + rng() * 40),
      route: null,
      destKey: null,
      slot,
      jitter: rng,
    };
    state.set(v.id, s);
  }
  return s;
}

const keyOf = (p: LngLat | null) => (p ? `${p.lng.toFixed(5)},${p.lat.toFixed(5)}` : null);

/** Spread vehicles that share a destination so they don't stack on one point. */
function parkingSpot(dest: LngLat, vehicleId: string): LngLat {
  const r = createRng(`park-${vehicleId}`);
  const ang = r() * Math.PI * 2;
  const dist = 15 + r() * 35;
  return { lng: dest.lng + (Math.cos(ang) * dist) / 71500, lat: dest.lat + (Math.sin(ang) * dist) / 111200 };
}

function startRoute(s: SimVehicle, to: LngLat, purpose: 'out' | 'back', destKey: string | null) {
  const r = routeBetween(s.pos, to);
  const avg = r.lengthM / Math.max(60, r.durationMin * 60);
  s.route = {
    coords: r.coords,
    lengthM: r.lengthM,
    progressM: 0,
    speedMps: Math.max(7, Math.min(24, avg)),
    purpose,
    destKey,
  };
  s.mode = 'driving';
}

function advance(s: SimVehicle, dt: number) {
  const r = s.route!;
  // slower in the first/last 250 m (yard, side streets)
  const nearEnds = r.progressM < 250 || r.lengthM - r.progressM < 250;
  const v = nearEnds ? Math.min(r.speedMps, 6) : r.speedMps * (0.85 + s.jitter() * 0.3);
  r.progressM = Math.min(r.lengthM, r.progressM + v * dt);
  const at = alongPolyline(r.coords, r.progressM);
  s.pos = at.point;
  if (r.progressM < r.lengthM) s.heading = at.heading;
  s.speedKmh = Math.round(v * 3.6);
  s.odometerKm += (v * dt) / 1000;
  s.fuelPct = Math.max(8, s.fuelPct - (v * dt) / 1000 / 9);
  return r.progressM >= r.lengthM;
}

function step(v: Vehicle, a: Assignment | undefined, now: number, date: string, dt: number) {
  const s = ensure(v);
  const destLoc = a && a.crew.length ? destinationLocation(a.destination, db.data.projects) : null;
  const destKey = keyOf(destLoc);
  const depart = timeOnDate(date, a?.departAt)?.getTime();
  const ret = timeOnDate(date, a?.returnAt)?.getTime();
  const shouldBeOut = !!destLoc && v.status === 'active' && depart !== undefined && now >= depart && (ret === undefined || now < ret);

  switch (s.mode) {
    case 'parked':
      s.speedKmh = 0;
      if (shouldBeOut) startRoute(s, parkingSpot(destLoc!, v.id), 'out', destKey);
      break;
    case 'at_dest':
      s.speedKmh = 0;
      if (!shouldBeOut) startRoute(s, s.slot, 'back', null);
      else if (destKey !== s.destKey) startRoute(s, parkingSpot(destLoc!, v.id), 'out', destKey);
      break;
    case 'driving': {
      const r = s.route!;
      if (r.purpose === 'out' && !shouldBeOut) startRoute(s, s.slot, 'back', null);
      else if (r.purpose === 'out' && destKey !== r.destKey) startRoute(s, parkingSpot(destLoc!, v.id), 'out', destKey);
      else if (r.purpose === 'back' && shouldBeOut) startRoute(s, parkingSpot(destLoc!, v.id), 'out', destKey);
      if (advance(s, dt)) {
        if (s.route!.purpose === 'out') {
          s.mode = 'at_dest';
          s.destKey = s.route!.destKey;
        } else {
          s.mode = 'parked';
          s.destKey = null;
          s.pos = { lng: s.slot.lng, lat: s.slot.lat };
          s.heading = s.slot.heading;
          if (s.fuelPct < 30) s.fuelPct = 96; // tanked up at the depot
        }
        s.route = null;
        s.speedKmh = 0;
      }
      break;
    }
  }
}

function snapshot(now: number): Telemetry[] {
  const ts = new Date(now).toISOString();
  return db.data.vehicles.map((v) => {
    const s = ensure(v);
    return {
      vehicleId: v.id,
      ts,
      lng: s.pos.lng,
      lat: s.pos.lat,
      speedKmh: s.speedKmh,
      heading: Math.round(s.heading),
      ignition: s.mode === 'driving',
      odometerKm: Math.round(s.odometerKm * 10) / 10,
      fuelPct: Math.round(s.fuelPct),
      source: 'simulator' as const,
    };
  });
}

function tick(now: number, dt: number) {
  const date = ops.today();
  const plan = ops.plan(date);
  for (const v of db.data.vehicles) {
    step(v, plan.assignments.find((a) => a.vehicleId === v.id), now, date, dt);
  }
}

/** Replay today from early morning up to now so positions, stages and the event log are consistent after a restart. */
function fastForward() {
  const now = ops.clock.now();
  const date = ops.today();
  const plan = ops.plan(date);
  // Re-derive today's stages from scratch.
  const reset = plan.assignments.map((a) => ({ ...a, stage: 'planned' as const, stageTimes: {} }));
  ops.savePlan(date, reset, { force: true, actor: 'simulator' });
  db.data.events = db.data.events.filter((e) => !(e.ts.startsWith(date) && (e.kind === 'stage' || e.kind === 'alert')));

  const start = new Date(`${date}T05:00:00`).getTime();
  if (now <= start) return;
  const step = 20_000;
  ops.silent = true;
  try {
    for (let t = start; t <= now; t += step) {
      ops.clock.now = () => t;
      tick(t, step / 1000);
      ops.ingest(snapshot(t));
      if (Math.floor(t / 60000) % 5 === 0) ops.checkLateDepartures();
    }
  } finally {
    delete (ops.clock as { now?: unknown }).now; // back to the real clock method
    ops.silent = false;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startSimulator(tickMs: number) {
  console.log(`[sim] demo fleet simulator, ${db.data.vehicles.length} vehicles, speed ×${ops.clock.speed}`);
  for (const s of siteGeo) console.log(`[sim]   ${s.code} ${s.name}: ${s.yard.length} yard slots`);
  const t0 = Date.now();
  fastForward();
  console.log(`[sim] fast-forwarded today in ${Date.now() - t0} ms`);
  ops.setFleetStatus({ source: 'simulator', connected: true, pollSeconds: tickMs / 1000, lastSync: ops.nowISO(), error: undefined });
  let last = ops.clock.now();
  let lateCheck = 0;
  timer = setInterval(() => {
    const now = ops.clock.now();
    const dt = Math.min(120, (now - last) / 1000);
    last = now;
    tick(now, dt);
    ops.ingest(snapshot(now));
    if (++lateCheck % 15 === 0) ops.checkLateDepartures();
  }, tickMs);
}

export function stopSimulator() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Drop simulator state for a vehicle (e.g. deleted or moved to another depot). */
export function resetSimVehicle(id: string) {
  state.delete(id);
}
