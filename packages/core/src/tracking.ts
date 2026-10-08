import { haversineM } from './geo.ts';
import type { Assignment, Destination, LngLat, Project, Site, Stage, Telemetry } from './types.ts';

/** Within this distance of the destination a vehicle counts as "on site". */
export const ARRIVE_RADIUS_M = 250;
/** It has to get this far away again before it counts as "returning" (hysteresis against GPS jitter). */
export const LEAVE_RADIUS_M = 450;
const DEPOT_EXIT_MARGIN_M = 40;

export const STAGE_LABEL: Record<Stage, string> = {
  planned: 'At depot',
  departed: 'En route',
  on_site: 'On site',
  returning: 'Returning',
  completed: 'Back at depot',
};

export function destinationLocation(dest: Destination | null, projects: readonly Project[]): LngLat | null {
  if (!dest) return null;
  if (dest.kind === 'project') return projects.find((p) => p.id === dest.projectId)?.location ?? null;
  return dest.location ?? null;
}

export function destinationLabel(dest: Destination | null, projects: readonly Project[]): string {
  if (!dest) return 'No destination';
  if (dest.kind === 'project') {
    const p = projects.find((x) => x.id === dest.projectId);
    return p ? p.name : 'Unknown project';
  }
  return dest.label || dest.address || 'Custom destination';
}

export function nearestSite(pos: LngLat, sites: readonly Site[]): { site: Site; distM: number } | null {
  let best: { site: Site; distM: number } | null = null;
  for (const s of sites) {
    const d = haversineM(pos, s.location);
    if (!best || d < best.distM) best = { site: s, distM: d };
  }
  return best;
}

export function isAtDepot(pos: LngLat, sites: readonly Site[], margin = 0): boolean {
  const n = nearestSite(pos, sites);
  return !!n && n.distM <= n.site.geofenceRadiusM + margin;
}

/**
 * Geofence state machine that advances an assignment's stage from GPS positions.
 * planned → departed → on_site → returning → completed (→ departed again for a second run).
 */
export function nextStage(
  assignment: Assignment,
  t: Pick<Telemetry, 'lng' | 'lat'> & Partial<Pick<Telemetry, 'speedKmh'>>,
  sites: readonly Site[],
  dest: LngLat | null,
): Stage {
  const pos = { lng: t.lng, lat: t.lat };
  // Roads around a depot can loop back past its fence, so only a vehicle that is standing
  // inside the geofence counts as "turned back".
  const parked = (t.speedKmh ?? 0) < 3;
  const atDepot = isAtDepot(pos, sites);
  const leftDepot = !isAtDepot(pos, sites, DEPOT_EXIT_MARGIN_M);
  const dDest = dest ? haversineM(pos, dest) : Infinity;

  switch (assignment.stage) {
    case 'planned':
      if (leftDepot) return dDest <= ARRIVE_RADIUS_M ? 'on_site' : 'departed';
      return 'planned';
    case 'departed':
      if (dDest <= ARRIVE_RADIUS_M) return 'on_site';
      if (atDepot && parked) return 'planned'; // turned back before reaching the destination
      return 'departed';
    case 'on_site':
      if (dDest > LEAVE_RADIUS_M) return atDepot ? 'completed' : 'returning';
      return 'on_site';
    case 'returning':
      if (atDepot) return 'completed';
      if (dDest <= ARRIVE_RADIUS_M) return 'on_site';
      return 'returning';
    case 'completed':
      if (leftDepot) return 'departed';
      return 'completed';
  }
}

export const AVG_SPEED_KMH = 42;

/** Remaining distance and ETA (minutes) to the destination, using route length when known. */
export function etaMinutes(remainingM: number, speedKmh = AVG_SPEED_KMH): number {
  return Math.round((remainingM / 1000 / Math.max(5, speedKmh)) * 60);
}

/** "HH:MM" for today → Date in local time. */
export function timeOnDate(date: string, hhmm: string | undefined): Date | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(`${date}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
