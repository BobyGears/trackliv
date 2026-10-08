import { describe, expect, it } from 'vitest';
import { canDrive, crewCapacity, emptyAssignment, getAssignment, type PlanContext } from './assignments.ts';
import { ctx, people, vehicles } from './fixtures.test-helpers.ts';
import { randomizePlan } from './randomize.ts';
import type { Assignment, Person, Vehicle } from './types.ts';

const base = (): Assignment[] => vehicles.map((v) => emptyAssignment(v.id));

function invariants(result: ReturnType<typeof randomizePlan>, c: PlanContext = ctx) {
  const seen = new Set<string>();
  for (const a of result.assignments) {
    const v = c.vehicles.find((x) => x.id === a.vehicleId)!;
    expect(a.crew.length).toBeLessThanOrEqual(crewCapacity(v));
    expect(a.crew.length).toBeLessThanOrEqual(4);
    for (const pid of a.crew) {
      expect(seen.has(pid)).toBe(false);
      seen.add(pid);
      expect(c.people.find((p) => p.id === pid)!.status).toBe('available');
    }
    if (a.crew.length) {
      expect(v.status).toBe('active');
      expect(a.destination).not.toBeNull();
      const crew = a.crew.map((id) => c.people.find((p) => p.id === id)!);
      expect(crew.some((p) => canDrive(p, v))).toBe(true);
    }
  }
}

describe('randomizePlan', () => {
  it('is reproducible from its seed', () => {
    const a = randomizePlan(ctx, base(), { seed: 'ABC123' });
    const b = randomizePlan(ctx, base(), { seed: 'ABC123' });
    const c = randomizePlan(ctx, base(), { seed: 'ZZZ999' });
    expect(a.assignments).toEqual(b.assignments);
    expect(JSON.stringify(a.assignments)).not.toEqual(JSON.stringify(c.assignments));
  });

  it('assigns every available person when there are enough seats', () => {
    const r = randomizePlan(ctx, base(), { seed: 'S1' });
    invariants(r);
    const available = people.filter((p) => p.status === 'available');
    expect(r.stats.peopleAssigned).toBe(available.length);
    expect(r.stats.peopleUnassigned).toBe(0);
    expect(r.assignments.flatMap((a) => a.crew)).not.toContain('SICK');
    expect(getAssignment(r.assignments, 'MX').crew).toEqual([]);
  });

  it('covers every active project when there are enough vehicles', () => {
    const r = randomizePlan(ctx, base(), { seed: 'S2', coverAllProjects: true });
    const covered = new Set(
      r.assignments.filter((a) => a.crew.length && a.destination?.kind === 'project').map((a) => (a.destination as { projectId: string }).projectId),
    );
    expect([...covered].sort()).toEqual(['J1', 'J2', 'J3']);
    expect(covered.has('J4')).toBe(false); // paused
  });

  it('keeps pinned people and pinned destinations', () => {
    const current = base().map((a) =>
      a.vehicleId === 'V2'
        ? { ...a, crew: ['P4', 'P1'], lockedCrew: ['P4', 'P1'], destination: { kind: 'project' as const, projectId: 'J2' }, destinationLocked: true }
        : a.vehicleId === 'V3'
          ? { ...a, destination: { kind: 'custom' as const, label: 'Storm damage' }, destinationLocked: true }
          : a,
    );
    for (const seed of ['A', 'B', 'C', 'D', 'E']) {
      const r = randomizePlan(ctx, current, { seed });
      invariants(r);
      const v2 = getAssignment(r.assignments, 'V2');
      expect(v2.crew).toEqual(['P4', 'P1']); // no top-up by default
      expect(v2.destination).toEqual({ kind: 'project', projectId: 'J2' });
      const v3 = getAssignment(r.assignments, 'V3');
      expect(v3.destination).toEqual({ kind: 'custom', label: 'Storm damage' });
      expect(v3.crew.length).toBeGreaterThan(0); // pinned destination gets staffed first
    }
  });

  it('can top up pinned crews when asked', () => {
    const current = base().map((a) =>
      a.vehicleId === 'V1' ? { ...a, crew: ['P1'], lockedCrew: ['P1'] } : a,
    );
    const r = randomizePlan(ctx, current, { seed: 'TOP', topUpPinnedCrews: true, targetCrew: 3 });
    invariants(r);
    const v1 = getAssignment(r.assignments, 'V1');
    expect(v1.crew[0]).toBe('P1');
    expect(v1.crew.length).toBeGreaterThan(1);
  });

  it('never touches vehicles already on the road', () => {
    const current = base().map((a) =>
      a.vehicleId === 'V1'
        ? { ...a, crew: ['P2', 'P5'], destination: { kind: 'project' as const, projectId: 'J3' }, stage: 'departed' as const }
        : a,
    );
    const r = randomizePlan(ctx, current, { seed: 'ROAD' });
    expect(getAssignment(r.assignments, 'V1')).toEqual(getAssignment(current, 'V1'));
    for (const a of r.assignments) if (a.vehicleId !== 'V1') expect(a.crew).not.toContain('P2');
  });

  it('only puts licensed drivers on the truck', () => {
    for (let i = 0; i < 50; i++) {
      const r = randomizePlan(ctx, base(), { seed: `T${i}` });
      const tr = getAssignment(r.assignments, 'TR');
      if (tr.crew.length) {
        expect(tr.crew.some((id) => ['P3', 'P9'].includes(id))).toBe(true);
      }
    }
  });

  it('respects crew size bounds', () => {
    const r = randomizePlan(ctx, base(), { seed: 'SZ', minCrew: 2, maxCrew: 2, targetCrew: 2 });
    for (const a of r.assignments) if (a.crew.length) expect(a.crew.length).toBeLessThanOrEqual(2);
  });

  it('warns when there are not enough seats', () => {
    const many: Person[] = Array.from({ length: 30 }, (_, i) => ({
      id: `X${i}`,
      firstName: 'X',
      lastName: String(i),
      role: 'Operative' as const,
      licenses: i % 3 === 0 ? ['B' as const] : [],
      homeSiteId: 'A',
      status: 'available' as const,
    }));
    const vs: Vehicle[] = vehicles.filter((v) => v.id === 'V1' || v.id === 'V2');
    const c: PlanContext = { ...ctx, people: many, vehicles: vs };
    const r = randomizePlan(c, vs.map((v) => emptyAssignment(v.id)), { seed: 'FULL' });
    invariants(r, c);
    expect(r.stats.peopleAssigned).toBe(8);
    expect(r.stats.peopleUnassigned).toBe(22);
    expect(r.warnings.join(' ')).toMatch(/left unassigned/);
  });

  it('holds its invariants across many seeds', () => {
    for (let i = 0; i < 300; i++) {
      const r = randomizePlan(ctx, base(), {
        seed: `fuzz-${i}`,
        targetCrew: 1 + (i % 4),
        coverAllProjects: i % 2 === 0,
        preferHomeSite: i % 3 !== 0,
      });
      invariants(r);
    }
  });

  it('reports a diff against the current plan', () => {
    const r = randomizePlan(ctx, base(), { seed: 'DIFF' });
    const moved = r.diff.moves.filter((m) => m.from === null && m.to !== null);
    expect(moved.length).toBe(r.stats.peopleAssigned);
    expect(r.diff.destinationChanges.length).toBe(r.stats.vehiclesStaffed);
  });

  it('can be limited to one depot', () => {
    const r = randomizePlan(ctx, base(), { seed: 'SITE', siteId: 'B' });
    for (const a of r.assignments) {
      const v = vehicles.find((x) => x.id === a.vehicleId)!;
      if (v.homeSiteId === 'A') expect(a.crew).toEqual([]);
      for (const pid of a.crew) expect(people.find((p) => p.id === pid)!.homeSiteId).toBe('B');
    }
  });
});
