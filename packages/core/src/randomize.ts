import {
  DEFAULT_DEPART,
  DEFAULT_RETURN,
  MAX_CREW,
  canDrive,
  crewCapacity,
  driverRank,
  emptyAssignment,
  getAssignment,
  licenseRank,
  sameDestination,
  type PlanContext,
} from './assignments.ts';
import { createRng, shuffle, weightedPick, type Rng } from './rng.ts';
import type { Assignment, Destination, ID, Person, Priority, Project, Vehicle } from './types.ts';

export interface RandomizeOptions {
  seed: string;
  /** Preferred crew size per vehicle. */
  targetCrew: number;
  minCrew: number;
  maxCrew: number;
  /** Every staffed vehicle must carry somebody licensed to drive it. */
  requireDriver: boolean;
  /** Send at least one vehicle to every active project before doubling up. */
  coverAllProjects: boolean;
  /** Also add people to vehicles whose crew is (partly) pinned. Off = pinned crews stay exactly as pinned. */
  topUpPinnedCrews: boolean;
  /** Prefer putting people on vehicles from their own depot. */
  preferHomeSite: boolean;
  /** Only shuffle people and vehicles of this depot (others untouched). */
  siteId?: ID;
}

export const DEFAULT_RANDOMIZE_OPTIONS: Omit<RandomizeOptions, 'seed'> = {
  targetCrew: 2,
  minCrew: 1,
  maxCrew: MAX_CREW,
  requireDriver: true,
  coverAllProjects: true,
  topUpPinnedCrews: false,
  preferHomeSite: true,
};

export interface PersonMove {
  personId: ID;
  from: ID | null;
  to: ID | null;
}

export interface DestinationChange {
  vehicleId: ID;
  from: Destination | null;
  to: Destination | null;
}

export interface PlanDiff {
  moves: PersonMove[];
  destinationChanges: DestinationChange[];
}

export interface RandomizeResult {
  seed: string;
  assignments: Assignment[];
  diff: PlanDiff;
  warnings: string[];
  stats: {
    peopleAssigned: number;
    peopleUnassigned: number;
    vehiclesStaffed: number;
    projectsCovered: number;
    projectsActive: number;
    /** People / vehicles kept because they are pinned. */
    pinnedPeople: number;
    pinnedVehicles: number;
    /** Vehicles left alone because they are already on the road (or outside the depot scope). */
    frozenVehicles: number;
  };
}

const PRIORITY_WEIGHT: Record<Priority, number> = { low: 1, normal: 2, high: 3.5, critical: 5 };

/**
 * Randomly groups every available, un-pinned person into vehicles (1–4 each) and sends every
 * staffed vehicle to a random active project.
 *
 * Pins are respected:
 *  - pinned crew members stay on their vehicle,
 *  - pinned destinations stay,
 *  - vehicles already on the road (stage ≠ planned) are not touched at all.
 */
export function randomizePlan(
  ctx: PlanContext,
  current: readonly Assignment[],
  options: Partial<RandomizeOptions> & { seed: string },
): RandomizeResult {
  const opts: RandomizeOptions = { ...DEFAULT_RANDOMIZE_OPTIONS, ...options };
  const maxCrew = clamp(opts.maxCrew, 1, MAX_CREW);
  const minCrew = clamp(opts.minCrew, 1, maxCrew);
  const target = clamp(opts.targetCrew, minCrew, maxCrew);
  const rng = createRng(opts.seed);
  const warnings: string[] = [];
  const inScope = (siteId: ID) => !opts.siteId || opts.siteId === siteId;

  const peopleById = new Map(ctx.people.map((p) => [p.id, p]));
  const cap = (v: Vehicle) => Math.min(crewCapacity(v), maxCrew);

  // 1) Start from what is pinned. -------------------------------------------------
  const next = new Map<ID, Assignment>();
  const pinned = new Set<ID>(); // everyone who must not move (pinned or on a frozen vehicle)
  let pinnedPeople = 0;
  let pinnedVehicles = 0;
  let frozenVehicles = 0;
  for (const v of ctx.vehicles) {
    const cur = getAssignment(current, v.id);
    const frozen = cur.stage !== 'planned' || !inScope(v.homeSiteId);
    if (frozen) {
      next.set(v.id, { ...cur });
      cur.crew.forEach((p) => pinned.add(p));
      if (cur.crew.length) frozenVehicles++;
      continue;
    }
    const lockedCrew = cur.lockedCrew.filter((id) => {
      if (!cur.crew.includes(id)) return false;
      const p = peopleById.get(id);
      if (!p || p.status !== 'available') {
        warnings.push(`${p ? `${p.firstName} ${p.lastName}` : id} was pinned to ${v.callsign} but is ${p?.status ?? 'unknown'} – released`);
        return false;
      }
      return true;
    });
    lockedCrew.forEach((p) => pinned.add(p));
    pinnedPeople += lockedCrew.length;
    const destination = cur.destinationLocked ? cur.destination : null;
    if (lockedCrew.length || destination) pinnedVehicles++;
    next.set(v.id, {
      ...cur,
      crew: lockedCrew.slice(),
      lockedCrew,
      destination,
      destinationLocked: !!destination && cur.destinationLocked,
    });
  }

  // People pinned on a vehicle that is out of service stay put but we flag it.
  for (const v of ctx.vehicles) {
    const a = next.get(v.id)!;
    if (v.status !== 'active' && a.crew.length && a.stage === 'planned') {
      warnings.push(`${v.callsign} is in ${v.status} but has pinned crew`);
    }
  }

  // 2) Pool of people to distribute. ----------------------------------------------
  let pool = shuffle(
    ctx.people.filter((p) => p.status === 'available' && !pinned.has(p.id) && inScope(p.homeSiteId)),
    rng,
  );

  // Vehicles that can take new people.
  const open = ctx.vehicles.filter((v) => {
    const a = next.get(v.id)!;
    return v.status === 'active' && a.stage === 'planned' && inScope(v.homeSiteId) && a.crew.length === 0;
  });
  const topUp = opts.topUpPinnedCrews
    ? ctx.vehicles.filter((v) => {
        const a = next.get(v.id)!;
        return v.status === 'active' && a.stage === 'planned' && a.crew.length > 0 && a.crew.length < cap(v) && inScope(v.homeSiteId);
      })
    : [];

  // Vehicles with a pinned destination but no crew are staffed first.
  const destPinnedOpen = shuffle(open.filter((v) => next.get(v.id)!.destination), rng);
  const otherOpen = shuffle(open.filter((v) => !next.get(v.id)!.destination), rng);
  const candidates = [...destPinnedOpen, ...otherOpen];

  // Top-up seats count against the pool first (up to the target size).
  let topUpSeats = 0;
  for (const v of topUp) topUpSeats += Math.max(0, Math.min(target, cap(v)) - next.get(v.id)!.crew.length);
  const forNewVehicles = Math.max(0, pool.length - topUpSeats);

  // 3) How many fresh vehicles to staff. --------------------------------------------
  let k = 0;
  if (forNewVehicles > 0 && candidates.length > 0) {
    const ideal = Math.round(forNewVehicles / target);
    const atLeast = Math.ceil(forNewVehicles / maxCrew);
    const atMost = Math.floor(forNewVehicles / minCrew);
    k = clamp(Math.max(ideal, atLeast, Math.min(destPinnedOpen.length, forNewVehicles)), 1, Math.min(candidates.length, Math.max(1, atMost)));
  }

  // 4) Pick vehicles and reserve a licensed driver for each. -------------------------
  const chosen: Vehicle[] = [];
  const drivers = new Map<ID, Person>();
  // Heavier vehicles first so scarce C/CE drivers are not used up by vans.
  const byLicence = (vs: Vehicle[]) =>
    vs.slice().sort((a, b) => licenseRank(b.requiredLicense) - licenseRank(a.requiredLicense));
  const reserveDriver = (v: Vehicle): boolean => {
    if (!opts.requireDriver) return true;
    const qualified = pool.filter((p) => canDrive(p, v) && !isReserved(p.id));
    if (!qualified.length) return false;
    const minRank = Math.min(...qualified.map(driverRank));
    const best = qualified.filter((p) => driverRank(p) === minRank);
    const preferred = opts.preferHomeSite ? best.filter((p) => p.homeSiteId === v.homeSiteId) : [];
    const d = (preferred.length ? preferred : best)[Math.floor(rng() * (preferred.length || best.length))];
    drivers.set(v.id, d);
    return true;
  };
  const isReserved = (pid: ID) => {
    for (const d of drivers.values()) if (d.id === pid) return true;
    return false;
  };

  // Make sure pinned crews still have a driver if we are allowed to top them up.
  for (const v of topUp) {
    const a = next.get(v.id)!;
    const crew = a.crew.map((id) => peopleById.get(id)).filter((p): p is Person => !!p);
    if (opts.requireDriver && !crew.some((p) => canDrive(p, v))) reserveDriver(v);
  }

  const pickOrder = [
    ...byLicence(candidates.slice(0, destPinnedOpen.length)),
    ...byLicence(candidates.slice(destPinnedOpen.length)),
  ];
  let skippedNoDriver = 0;
  for (const v of pickOrder) {
    if (chosen.length >= k) break;
    if (reserveDriver(v)) chosen.push(v);
    else skippedNoDriver++;
  }
  if (opts.requireDriver && chosen.length < k) {
    warnings.push(
      `Not enough licensed drivers: staffed ${chosen.length} vehicle${chosen.length === 1 ? '' : 's'} instead of ${k}` +
        (skippedNoDriver ? ` (${skippedNoDriver} vehicle${skippedNoDriver === 1 ? '' : 's'} had nobody who may drive it)` : ''),
    );
  }

  // Seat reserved drivers.
  for (const [vid, d] of drivers) {
    const a = next.get(vid)!;
    next.set(vid, { ...a, crew: [d.id, ...a.crew] });
  }
  pool = pool.filter((p) => !isReserved(p.id));

  // Without driver requirement every chosen vehicle still needs one person.
  if (!opts.requireDriver) {
    for (const v of chosen) {
      const p = pool.shift();
      if (!p) break;
      const a = next.get(v.id)!;
      next.set(v.id, { ...a, crew: [...a.crew, p.id] });
    }
  }

  // 5) Distribute the rest – fill the emptiest vehicle first, tie-break on home depot. ---
  const targets = [...chosen, ...topUp];
  const limitFor = (v: Vehicle) => (topUp.includes(v) ? Math.min(target, cap(v)) : cap(v));
  const leftovers: Person[] = [];
  for (const p of pool) {
    const free = targets.filter((v) => next.get(v.id)!.crew.length < limitFor(v));
    if (!free.length) {
      leftovers.push(p);
      continue;
    }
    const minSize = Math.min(...free.map((v) => next.get(v.id)!.crew.length));
    let best = free.filter((v) => next.get(v.id)!.crew.length === minSize);
    if (opts.preferHomeSite) {
      const home = best.filter((v) => v.homeSiteId === p.homeSiteId);
      if (home.length) best = home;
    }
    const v = best[Math.floor(rng() * best.length)];
    const a = next.get(v.id)!;
    next.set(v.id, { ...a, crew: [...a.crew, p.id] });
  }
  if (leftovers.length) {
    warnings.push(`${leftovers.length} ${leftovers.length === 1 ? 'person' : 'people'} left unassigned – not enough seats`);
  }

  // 6) Destinations. ------------------------------------------------------------------
  const active = ctx.projects.filter((p) => p.status === 'active');
  const vehiclesPerProject = new Map<ID, number>();
  for (const a of next.values()) {
    if (a.destination?.kind === 'project' && a.crew.length) {
      vehiclesPerProject.set(a.destination.projectId, (vehiclesPerProject.get(a.destination.projectId) ?? 0) + 1);
    }
  }
  const needDest = shuffle(
    [...next.values()].filter((a) => a.crew.length > 0 && !a.destination && a.stage === 'planned'),
    rng,
  );
  if (needDest.length && !active.length) warnings.push('No active projects to send vehicles to');

  const assignDest = (a: Assignment, project: Project) => {
    vehiclesPerProject.set(project.id, (vehiclesPerProject.get(project.id) ?? 0) + 1);
    next.set(a.vehicleId, { ...a, destination: { kind: 'project', projectId: project.id } });
  };

  let queue = needDest.slice();
  if (opts.coverAllProjects && active.length) {
    const uncovered = orderByPriority(
      active.filter((p) => !vehiclesPerProject.get(p.id)),
      rng,
    );
    for (const project of uncovered) {
      const a = queue.shift();
      if (!a) break;
      assignDest(next.get(a.vehicleId)!, project);
    }
    if (uncovered.length > needDest.length) {
      warnings.push(`${uncovered.length - needDest.length} active project(s) get no vehicle today`);
    }
  }
  for (const a of queue) {
    if (!active.length) break;
    const project = weightedPick(
      active,
      (p) => PRIORITY_WEIGHT[p.priority] / (1 + (vehiclesPerProject.get(p.id) ?? 0)),
      rng,
    )!;
    assignDest(next.get(a.vehicleId)!, project);
  }

  // Default times for anything newly staffed.
  for (const [vid, a] of next) {
    if (a.crew.length && a.stage === 'planned') {
      next.set(vid, { ...a, departAt: a.departAt ?? DEFAULT_DEPART, returnAt: a.returnAt ?? DEFAULT_RETURN });
    }
  }

  // Keep the original vehicle order, drop empty untouched records.
  const assignments: Assignment[] = ctx.vehicles.map((v) => next.get(v.id) ?? emptyAssignment(v.id));

  const assignedIds = new Set(assignments.flatMap((a) => a.crew));
  const covered = new Set(
    assignments
      .filter((a) => a.crew.length && a.destination?.kind === 'project')
      .map((a) => (a.destination as { projectId: ID }).projectId),
  );
  const availableInScope = ctx.people.filter((p) => p.status === 'available' && inScope(p.homeSiteId));

  return {
    seed: opts.seed,
    assignments,
    diff: diffPlans(current, assignments),
    warnings,
    stats: {
      peopleAssigned: availableInScope.filter((p) => assignedIds.has(p.id)).length,
      peopleUnassigned: availableInScope.filter((p) => !assignedIds.has(p.id)).length,
      vehiclesStaffed: assignments.filter((a) => a.crew.length > 0).length,
      projectsCovered: covered.size,
      projectsActive: active.length,
      pinnedPeople,
      pinnedVehicles,
      frozenVehicles,
    },
  };
}

function orderByPriority(projects: Project[], rng: Rng): Project[] {
  const shuffled = shuffle(projects, rng);
  return shuffled.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
}

export function diffPlans(before: readonly Assignment[], after: readonly Assignment[]): PlanDiff {
  const where = (list: readonly Assignment[]) => {
    const m = new Map<ID, ID>();
    for (const a of list) for (const p of a.crew) m.set(p, a.vehicleId);
    return m;
  };
  const b = where(before);
  const a = where(after);
  const moves: PersonMove[] = [];
  for (const pid of new Set([...b.keys(), ...a.keys()])) {
    const from = b.get(pid) ?? null;
    const to = a.get(pid) ?? null;
    if (from !== to) moves.push({ personId: pid, from, to });
  }
  const destinationChanges: DestinationChange[] = [];
  const vids = new Set([...before.map((x) => x.vehicleId), ...after.map((x) => x.vehicleId)]);
  for (const vid of vids) {
    const from = before.find((x) => x.vehicleId === vid)?.destination ?? null;
    const to = after.find((x) => x.vehicleId === vid)?.destination ?? null;
    if (!sameDestination(from, to)) destinationChanges.push({ vehicleId: vid, from, to });
  }
  return { moves, destinationChanges };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
