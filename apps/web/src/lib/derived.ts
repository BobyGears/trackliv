import {
  AVG_SPEED_KMH,
  destinationLocation,
  etaMinutes,
  haversineM,
  isAtDepot,
  validatePlan,
  type Assignment,
  type Destination,
  type ID,
  type Person,
  type Project,
  type Stage,
  type Vehicle,
  STAGE_LABEL,
  destinationLabel,
} from '@trackliv/core';
import { useEffect, useMemo, useState } from 'react';
import { opsTime } from './format';
import { t, tx } from './i18n';
import { useStore } from './store';

/** Operations clock (server time, possibly accelerated in simulator mode), ticking every second. */
export function useOpsNow(intervalMs = 1000): number {
  const opsNow = useStore((s) => s.opsNow);
  const clock = useStore((s) => s.clock);
  const [now, setNow] = useState(() => opsNow());
  useEffect(() => {
    setNow(opsNow());
    const t = setInterval(() => setNow(opsNow()), clock.speed > 5 ? 250 : intervalMs);
    return () => clearInterval(t);
  }, [opsNow, clock, intervalMs]);
  return now;
}

export interface RunInfo {
  vehicle: Vehicle;
  assignment: Assignment | undefined;
  stage: Stage;
  stageLabel: string;
  destLabel: string;
  remainingM: number | null;
  etaMin: number | null;
  progress: number | null;
  crew: Person[];
  atDepot: boolean;
  late: boolean;
}

export function runInfo(vehicleId: ID, now: number): RunInfo | null {
  const s = useStore.getState();
  const vehicle = s.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return null;
  const a = s.plan.assignments.find((x) => x.vehicleId === vehicleId);
  const t = s.telemetry[vehicleId];
  const dest = destinationLocation(a?.destination ?? null, s.projects);
  const stage = a?.stage ?? 'planned';
  const route = s.routes[vehicleId];
  let remainingM: number | null = null;
  let progress: number | null = null;
  if (t && dest) {
    const straight = haversineM(t, dest);
    const factor = route ? route.lengthM / Math.max(1, haversineM({ lng: route.coords[0][0], lat: route.coords[0][1] }, dest)) : 1.3;
    if (stage === 'departed') {
      remainingM = straight * Math.min(1.8, Math.max(1, factor));
      if (route) progress = Math.max(0, Math.min(1, 1 - remainingM / route.lengthM));
    } else if (stage === 'returning') {
      const home = s.sites.find((x) => x.id === vehicle.homeSiteId);
      if (home) {
        remainingM = haversineM(t, home.location) * Math.min(1.8, Math.max(1, factor));
        if (route) progress = Math.max(0, Math.min(1, 1 - remainingM / route.lengthM));
      }
    } else if (stage === 'on_site' || stage === 'completed') progress = 1;
    else if (stage === 'planned') progress = 0;
  }
  const speed = t && t.speedKmh > 10 ? (t.speedKmh + AVG_SPEED_KMH) / 2 : AVG_SPEED_KMH;
  const planned = opsTime(s.date, a?.departAt);
  const late = stage === 'planned' && !!a?.crew.length && !!planned && now - planned.getTime() > 15 * 60000;
  return {
    vehicle,
    assignment: a,
    stage,
    stageLabel: stageLabel(stage),
    destLabel: destLabel(a?.destination ?? null, s.projects),
    remainingM,
    etaMin: remainingM !== null ? etaMinutes(remainingM, speed) : route && stage === 'planned' ? route.durationMin : null,
    progress,
    crew: (a?.crew ?? []).map((id) => s.people.find((p) => p.id === id)).filter((p): p is Person => !!p),
    atDepot: !!t && isAtDepot(t, s.sites),
    late,
  };
}

export function useKpis() {
  const plan = useStore((s) => s.plan);
  const people = useStore((s) => s.people);
  const vehicles = useStore((s) => s.vehicles);
  const projects = useStore((s) => s.projects);
  const telemetry = useStore((s) => s.telemetry);
  const sites = useStore((s) => s.sites);
  const date = useStore((s) => s.date);
  const now = useOpsNow(5000);
  return useMemo(() => {
    const available = people.filter((p) => p.status === 'available');
    const assigned = new Set(plan.assignments.flatMap((a) => a.crew));
    const crewed = plan.assignments.filter((a) => a.crew.length);
    const out = crewed.filter((a) => a.stage === 'departed' || a.stage === 'on_site' || a.stage === 'returning');
    const enRoute = crewed.filter((a) => a.stage === 'departed').length;
    const onSite = crewed.filter((a) => a.stage === 'on_site').length;
    const departed = crewed.filter((a) => a.stageTimes.departed);
    const onTime = departed.filter((a) => {
      const planned = opsTime(date, a.departAt);
      return !planned || Date.parse(a.stageTimes.departed!) - planned.getTime() <= 15 * 60000;
    }).length;
    const late = crewed.filter((a) => {
      const planned = opsTime(date, a.departAt);
      return a.stage === 'planned' && planned && now - planned.getTime() > 15 * 60000;
    }).length;
    const active = projects.filter((p) => p.status === 'active');
    const covered = new Set(crewed.filter((a) => a.destination?.kind === 'project').map((a) => (a.destination as { projectId: string }).projectId));
    const inYard = vehicles.filter((v) => telemetry[v.id] && isAtDepot(telemetry[v.id], sites)).length;
    const issues = validatePlan(plan.assignments, { vehicles, people, projects, sites });
    return {
      crewAssigned: available.filter((p) => assigned.has(p.id)).length,
      crewAvailable: available.length,
      crewUnavailable: people.length - available.length,
      vehiclesOut: out.length,
      vehiclesTotal: vehicles.filter((v) => v.status === 'active').length,
      enRoute,
      onSite,
      inYard,
      onTimePct: departed.length ? Math.round((onTime / departed.length) * 100) : null,
      departedCount: departed.length,
      late,
      projectsCovered: active.filter((p) => covered.has(p.id)).length,
      projectsActive: active.length,
      issues,
    };
  }, [plan, people, vehicles, projects, telemetry, sites, date, now]);
}

/** Vehicle type names in the current language (getters, so lookups always translate). */
export const vehicleKindLabel: Record<Vehicle['kind'], string> = {
  get van() {
    return t('Van');
  },
  get truck() {
    return t('Box truck');
  },
  get pickup() {
    return t('Pickup');
  },
  get car() {
    return t('Car');
  },
};

/** Stage name in the current language ("At depot", "En route" …). */
export const stageLabel = (s: Stage) => t(STAGE_LABEL[s]);

/** Destination name in the current language (project names stay as entered). */
export const destLabel = (d: Destination | null | undefined, projects: readonly Project[]) => tx(destinationLabel(d ?? null, projects));

/** "Mercedes-Benz Sprinter" – or the vehicle type while make/model are not entered yet. */
export const vehicleDesc = (v: Pick<Vehicle, 'make' | 'model' | 'kind'>) => `${v.make} ${v.model}`.trim() || vehicleKindLabel[v.kind];
