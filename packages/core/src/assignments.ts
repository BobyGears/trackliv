import type {
  Assignment,
  Destination,
  ID,
  LicenseClass,
  Person,
  Project,
  Site,
  Vehicle,
} from './types.ts';

export const MAX_CREW = 4;
export const DEFAULT_DEPART = '07:00';
export const DEFAULT_RETURN = '16:00';

export interface PlanContext {
  vehicles: Vehicle[];
  people: Person[];
  projects: Project[];
  sites: Site[];
}

export type OpResult =
  | { ok: true; assignments: Assignment[]; note?: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Licences

/** Which classes each licence also covers (German/EU licence hierarchy, simplified). */
const COVERS: Record<LicenseClass, LicenseClass[]> = {
  B: ['B'],
  BE: ['B', 'BE'],
  C1: ['B', 'C1'],
  C1E: ['B', 'BE', 'C1', 'C1E'],
  C: ['B', 'C1', 'C'],
  CE: ['B', 'BE', 'C1', 'C1E', 'C', 'CE'],
};

export function canDrive(person: Person, vehicle: Vehicle): boolean {
  return person.licenses.some((l) => COVERS[l]?.includes(vehicle.requiredLicense));
}

/** Rough "how valuable is this person as a driver" score – lower means fewer heavy licences. */
export function driverRank(person: Person): number {
  let best = 0;
  for (const l of person.licenses) best = Math.max(best, COVERS[l]?.length ?? 0);
  return best;
}

export function licenseRank(l: LicenseClass): number {
  return { B: 1, BE: 2, C1: 3, C1E: 4, C: 5, CE: 6 }[l];
}

export function crewCapacity(vehicle: Vehicle): number {
  return Math.max(1, Math.min(MAX_CREW, vehicle.seats));
}

// ---------------------------------------------------------------------------
// Basic accessors

export function emptyAssignment(vehicleId: ID): Assignment {
  return {
    vehicleId,
    crew: [],
    lockedCrew: [],
    destination: null,
    destinationLocked: false,
    stage: 'planned',
    stageTimes: {},
  };
}

export function getAssignment(list: readonly Assignment[], vehicleId: ID): Assignment {
  return list.find((a) => a.vehicleId === vehicleId) ?? emptyAssignment(vehicleId);
}

function put(list: readonly Assignment[], next: Assignment): Assignment[] {
  const idx = list.findIndex((a) => a.vehicleId === next.vehicleId);
  if (idx === -1) return [...list, next];
  const copy = list.slice();
  copy[idx] = next;
  return copy;
}

function update(list: readonly Assignment[], vehicleId: ID, fn: (a: Assignment) => Assignment): Assignment[] {
  return put(list, fn(getAssignment(list, vehicleId)));
}

export function findPersonVehicle(list: readonly Assignment[], personId: ID): ID | null {
  for (const a of list) if (a.crew.includes(personId)) return a.vehicleId;
  return null;
}

export function assignedPersonIds(list: readonly Assignment[]): Set<ID> {
  const s = new Set<ID>();
  for (const a of list) for (const p of a.crew) s.add(p);
  return s;
}

export function unassignedPeople(list: readonly Assignment[], people: readonly Person[]): Person[] {
  const taken = assignedPersonIds(list);
  return people.filter((p) => !taken.has(p.id));
}

export function isCrewLocked(a: Assignment, personId: ID): boolean {
  return a.lockedCrew.includes(personId);
}

export function isFullyLocked(a: Assignment): boolean {
  return a.destinationLocked && a.crew.length > 0 && a.crew.every((p) => a.lockedCrew.includes(p));
}

export function sameDestination(a: Destination | null, b: Destination | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'project' && b.kind === 'project') return a.projectId === b.projectId;
  if (a.kind === 'custom' && b.kind === 'custom')
    return (
      a.label === b.label &&
      a.location?.lat === b.location?.lat &&
      a.location?.lng === b.location?.lng
    );
  return false;
}

// ---------------------------------------------------------------------------
// Mutations (pure – always return a new array)

export function unassignPerson(list: readonly Assignment[], personId: ID): Assignment[] {
  return list.map((a) =>
    a.crew.includes(personId)
      ? { ...a, crew: a.crew.filter((p) => p !== personId), lockedCrew: a.lockedCrew.filter((p) => p !== personId) }
      : a,
  );
}

export function assignPerson(
  list: readonly Assignment[],
  ctx: PlanContext,
  personId: ID,
  vehicleId: ID,
  opts: { lock?: boolean; index?: number } = {},
): OpResult {
  const vehicle = ctx.vehicles.find((v) => v.id === vehicleId);
  const person = ctx.people.find((p) => p.id === personId);
  if (!vehicle) return { ok: false, error: `Unknown vehicle ${vehicleId}` };
  if (!person) return { ok: false, error: `Unknown person ${personId}` };

  const from = findPersonVehicle(list, personId);
  const target = getAssignment(list, vehicleId);
  if (from !== vehicleId && target.crew.length >= crewCapacity(vehicle)) {
    return { ok: false, error: `${vehicle.callsign} is full (${crewCapacity(vehicle)} seats)` };
  }

  let next = unassignPerson(list, personId);
  const wasLocked = from === vehicleId && target.lockedCrew.includes(personId);
  next = update(next, vehicleId, (a) => {
    const crew = a.crew.slice();
    const at = opts.index === undefined ? crew.length : Math.max(0, Math.min(opts.index, crew.length));
    crew.splice(at, 0, personId);
    const lock = opts.lock ?? wasLocked;
    return { ...a, crew, lockedCrew: lock ? [...a.lockedCrew, personId] : a.lockedCrew };
  });

  const fromVehicle = from && from !== vehicleId ? ctx.vehicles.find((v) => v.id === from) : undefined;
  return {
    ok: true,
    assignments: next,
    note: fromVehicle ? `Moved from ${fromVehicle.callsign}` : undefined,
  };
}

export function setDestination(
  list: readonly Assignment[],
  vehicleId: ID,
  destination: Destination | null,
  opts: { lock?: boolean } = {},
): Assignment[] {
  return update(list, vehicleId, (a) => ({
    ...a,
    destination,
    destinationLocked: destination ? opts.lock ?? a.destinationLocked : false,
  }));
}

export function toggleCrewLock(list: readonly Assignment[], vehicleId: ID, personId: ID): Assignment[] {
  return update(list, vehicleId, (a) => {
    if (!a.crew.includes(personId)) return a;
    return a.lockedCrew.includes(personId)
      ? { ...a, lockedCrew: a.lockedCrew.filter((p) => p !== personId) }
      : { ...a, lockedCrew: [...a.lockedCrew, personId] };
  });
}

export function setDestinationLock(list: readonly Assignment[], vehicleId: ID, locked: boolean): Assignment[] {
  return update(list, vehicleId, (a) => ({ ...a, destinationLocked: locked && !!a.destination }));
}

/** Pin (or release) the whole vehicle: every crew member and the destination. */
export function setVehicleLock(list: readonly Assignment[], vehicleId: ID, locked: boolean): Assignment[] {
  return update(list, vehicleId, (a) => ({
    ...a,
    lockedCrew: locked ? a.crew.slice() : [],
    destinationLocked: locked && !!a.destination,
  }));
}

export function setTimes(
  list: readonly Assignment[],
  vehicleId: ID,
  times: { departAt?: string; returnAt?: string },
): Assignment[] {
  return update(list, vehicleId, (a) => ({ ...a, ...times }));
}

export function setNote(list: readonly Assignment[], vehicleId: ID, note: string): Assignment[] {
  return update(list, vehicleId, (a) => ({ ...a, note: note || undefined }));
}

/** Remove every crew member and destination that is not pinned (vehicles already on the road are kept). */
export function clearUnlocked(list: readonly Assignment[]): Assignment[] {
  return list.map((a) => {
    if (a.stage !== 'planned') return a;
    return {
      ...a,
      crew: a.crew.filter((p) => a.lockedCrew.includes(p)),
      destination: a.destinationLocked ? a.destination : null,
    };
  });
}

/**
 * "Send these people to this task": puts the selected people into one vehicle, pins them and
 * pins the destination, so a later randomize keeps them together.
 * If no vehicle is given the best free vehicle is chosen (enough seats, licensed driver in the group,
 * same home depot as most of the group).
 */
export function pinGroupToTask(
  list: readonly Assignment[],
  ctx: PlanContext,
  args: { personIds: ID[]; destination: Destination; vehicleId?: ID },
): OpResult & { vehicleId?: ID } {
  const group = args.personIds
    .map((id) => ctx.people.find((p) => p.id === id))
    .filter((p): p is Person => !!p);
  if (group.length === 0) return { ok: false, error: 'Select at least one person' };
  if (group.length > MAX_CREW) return { ok: false, error: `A vehicle takes at most ${MAX_CREW} people` };

  let vehicle: Vehicle | undefined;
  if (args.vehicleId) {
    vehicle = ctx.vehicles.find((v) => v.id === args.vehicleId);
    if (!vehicle) return { ok: false, error: 'Unknown vehicle' };
  } else {
    const siteVotes = new Map<ID, number>();
    for (const p of group) siteVotes.set(p.homeSiteId, (siteVotes.get(p.homeSiteId) ?? 0) + 1);
    const preferredSite = [...siteVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const groupIds = new Set(group.map((p) => p.id));
    const scored = ctx.vehicles
      .filter((v) => v.status === 'active' && crewCapacity(v) >= group.length)
      .map((v) => {
        const a = getAssignment(list, v.id);
        if (a.stage !== 'planned') return null;
        const foreignLocked = a.lockedCrew.filter((p) => !groupIds.has(p));
        if (foreignLocked.length > 0) return null; // somebody else is pinned here
        if (a.destinationLocked) return null;
        let score = 0;
        if (group.some((p) => canDrive(p, v))) score += 100;
        if (a.crew.length === 0) score += 30;
        else score -= a.crew.length * 5;
        if (v.homeSiteId === preferredSite) score += 10;
        score -= (crewCapacity(v) - group.length) * 2; // don't waste big vehicles
        score -= licenseRank(v.requiredLicense); // prefer simpler vehicles
        return { v, score };
      })
      .filter((x): x is { v: Vehicle; score: number } => !!x)
      .sort((a, b) => b.score - a.score);
    vehicle = scored[0]?.v;
    if (!vehicle) return { ok: false, error: 'No free vehicle with enough seats' };
  }

  const current = getAssignment(list, vehicle.id);
  const groupIds = new Set(group.map((p) => p.id));
  const keptLocked = current.lockedCrew.filter((p) => !groupIds.has(p));
  if (keptLocked.length + group.length > crewCapacity(vehicle)) {
    return { ok: false, error: `${vehicle.callsign} has only ${crewCapacity(vehicle) - keptLocked.length} free seats` };
  }

  // Release the group from wherever they were, then rebuild the target crew:
  // other pinned members stay, unpinned members make room for the group.
  let next: Assignment[] = list.slice();
  for (const p of group) next = unassignPerson(next, p.id);
  const ordered = [...group].sort((a, b) => Number(canDrive(b, vehicle!)) - Number(canDrive(a, vehicle!)));
  next = update(next, vehicle.id, (a) => ({
    ...a,
    crew: [...keptLocked, ...ordered.map((p) => p.id)],
    lockedCrew: [...keptLocked, ...ordered.map((p) => p.id)],
    destination: args.destination,
    destinationLocked: true,
    departAt: a.departAt ?? DEFAULT_DEPART,
    returnAt: a.returnAt ?? DEFAULT_RETURN,
  }));
  return { ok: true, assignments: next, vehicleId: vehicle.id };
}

// ---------------------------------------------------------------------------
// Validation

export interface PlanIssue {
  severity: 'error' | 'warning' | 'info';
  vehicleId?: ID;
  personId?: ID;
  message: string;
}

export function validatePlan(list: readonly Assignment[], ctx: PlanContext): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const seen = new Map<ID, ID>();
  for (const a of list) {
    const v = ctx.vehicles.find((x) => x.id === a.vehicleId);
    if (!v) continue;
    if (a.crew.length > crewCapacity(v)) {
      issues.push({ severity: 'error', vehicleId: v.id, message: `${v.callsign}: ${a.crew.length} people but only ${crewCapacity(v)} seats` });
    }
    for (const pid of a.crew) {
      const prev = seen.get(pid);
      const p = ctx.people.find((x) => x.id === pid);
      if (prev && prev !== v.id) {
        issues.push({ severity: 'error', personId: pid, message: `${p ? fullName(p) : pid} is on two vehicles` });
      }
      seen.set(pid, v.id);
      if (p && p.status !== 'available') {
        issues.push({ severity: 'warning', personId: pid, vehicleId: v.id, message: `${fullName(p)} is ${p.status}` });
      }
    }
    if (a.crew.length > 0) {
      if (v.status !== 'active') {
        issues.push({ severity: 'warning', vehicleId: v.id, message: `${v.callsign} is in ${v.status}` });
      }
      const crew = a.crew.map((id) => ctx.people.find((p) => p.id === id)).filter((p): p is Person => !!p);
      if (!crew.some((p) => canDrive(p, v))) {
        issues.push({ severity: 'warning', vehicleId: v.id, message: `${v.callsign}: nobody holds licence ${v.requiredLicense}` });
      }
      if (!a.destination) {
        issues.push({ severity: 'warning', vehicleId: v.id, message: `${v.callsign}: crew assigned but no destination` });
      }
    } else if (a.destination) {
      issues.push({ severity: 'info', vehicleId: v.id, message: `${v.callsign}: destination set but no crew` });
    }
    if (a.destination?.kind === 'custom' && !a.destination.location) {
      issues.push({ severity: 'info', vehicleId: v.id, message: `${v.callsign}: custom destination has no map position – arrival can't be tracked` });
    }
  }
  return issues;
}

export function fullName(p: Person): string {
  return `${p.firstName} ${p.lastName}`;
}

export function initials(p: Person): string {
  return `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}`.toUpperCase();
}
