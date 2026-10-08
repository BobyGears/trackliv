import { describe, expect, it } from 'vitest';
import {
  assignPerson,
  canDrive,
  clearUnlocked,
  emptyAssignment,
  getAssignment,
  pinGroupToTask,
  setDestination,
  setVehicleLock,
  toggleCrewLock,
  validatePlan,
} from './assignments.ts';
import { ctx, people, vehicles } from './fixtures.test-helpers.ts';
import type { Assignment } from './types.ts';

const base = (): Assignment[] => vehicles.map((v) => emptyAssignment(v.id));
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { error: string }).error);
  return r as Extract<T, { ok: true }>;
};

describe('licences', () => {
  it('follows the licence hierarchy', () => {
    const truck = vehicles.find((v) => v.id === 'TR')!;
    const van = vehicles.find((v) => v.id === 'V1')!;
    expect(canDrive(people.find((p) => p.id === 'P1')!, truck)).toBe(false);
    expect(canDrive(people.find((p) => p.id === 'P3')!, truck)).toBe(true);
    expect(canDrive(people.find((p) => p.id === 'P9')!, van)).toBe(true); // CE covers B
    expect(canDrive(people.find((p) => p.id === 'P4')!, van)).toBe(false);
  });
});

describe('assignPerson', () => {
  it('adds people up to the seat limit', () => {
    let list = base();
    for (const id of ['P1', 'P2', 'P4']) list = ok(assignPerson(list, ctx, id, 'V4')).assignments;
    expect(getAssignment(list, 'V4').crew).toEqual(['P1', 'P2', 'P4']);
    const full = assignPerson(list, ctx, 'P5', 'V4');
    expect(full.ok).toBe(false);
  });

  it('moves a person instead of duplicating', () => {
    let list = ok(assignPerson(base(), ctx, 'P1', 'V1')).assignments;
    const r = ok(assignPerson(list, ctx, 'P1', 'V2'));
    list = r.assignments;
    expect(getAssignment(list, 'V1').crew).toEqual([]);
    expect(getAssignment(list, 'V2').crew).toEqual(['P1']);
    expect(r.note).toContain('V1');
  });

  it('drops the pin when a person is moved elsewhere', () => {
    let list = ok(assignPerson(base(), ctx, 'P1', 'V1', { lock: true })).assignments;
    list = ok(assignPerson(list, ctx, 'P1', 'V2')).assignments;
    expect(getAssignment(list, 'V1').lockedCrew).toEqual([]);
  });
});

describe('pinGroupToTask', () => {
  it('picks a vehicle someone in the group can drive and pins everything', () => {
    const r = ok(
      pinGroupToTask(base(), ctx, {
        personIds: ['P3', 'P4', 'P5'],
        destination: { kind: 'project', projectId: 'J1' },
      }),
    );
    const a = getAssignment(r.assignments, r.vehicleId!);
    expect(a.crew.sort()).toEqual(['P3', 'P4', 'P5']);
    expect(a.lockedCrew.sort()).toEqual(['P3', 'P4', 'P5']);
    expect(a.destinationLocked).toBe(true);
    expect(a.destination).toEqual({ kind: 'project', projectId: 'J1' });
    const v = vehicles.find((x) => x.id === r.vehicleId)!;
    expect(v.status).toBe('active');
    expect(a.crew.some((id) => canDrive(people.find((p) => p.id === id)!, v))).toBe(true);
  });

  it('refuses more than 4 people', () => {
    const r = pinGroupToTask(base(), ctx, {
      personIds: ['P1', 'P2', 'P4', 'P5', 'P10'],
      destination: { kind: 'custom', label: 'Emergency' },
    });
    expect(r.ok).toBe(false);
  });

  it('respects someone else already pinned to the chosen vehicle', () => {
    let list = ok(assignPerson(base(), ctx, 'P1', 'V4', { lock: true })).assignments;
    const r = pinGroupToTask(list, ctx, {
      personIds: ['P2', 'P4', 'P5'],
      destination: { kind: 'project', projectId: 'J2' },
      vehicleId: 'V4',
    });
    expect(r.ok).toBe(false);
    list = ok(
      pinGroupToTask(list, ctx, {
        personIds: ['P2', 'P4'],
        destination: { kind: 'project', projectId: 'J2' },
        vehicleId: 'V4',
      }),
    ).assignments;
    expect(getAssignment(list, 'V4').crew.sort()).toEqual(['P1', 'P2', 'P4']);
  });
});

describe('locks and clearing', () => {
  it('clearUnlocked keeps pins and vehicles already on the road', () => {
    let list = base();
    list = ok(assignPerson(list, ctx, 'P1', 'V1')).assignments;
    list = ok(assignPerson(list, ctx, 'P2', 'V1')).assignments;
    list = toggleCrewLock(list, 'V1', 'P2');
    list = setDestination(list, 'V1', { kind: 'project', projectId: 'J1' }, { lock: true });
    list = ok(assignPerson(list, ctx, 'P6', 'V3')).assignments;
    list = setDestination(list, 'V3', { kind: 'project', projectId: 'J2' });
    list = list.map((a) => (a.vehicleId === 'V3' ? { ...a, stage: 'departed' as const } : a));

    const cleared = clearUnlocked(list);
    expect(getAssignment(cleared, 'V1').crew).toEqual(['P2']);
    expect(getAssignment(cleared, 'V1').destination).toEqual({ kind: 'project', projectId: 'J1' });
    expect(getAssignment(cleared, 'V3').crew).toEqual(['P6']);
  });

  it('setVehicleLock pins crew and destination together', () => {
    let list = ok(assignPerson(base(), ctx, 'P1', 'V1')).assignments;
    list = setDestination(list, 'V1', { kind: 'project', projectId: 'J1' });
    list = setVehicleLock(list, 'V1', true);
    expect(getAssignment(list, 'V1').lockedCrew).toEqual(['P1']);
    expect(getAssignment(list, 'V1').destinationLocked).toBe(true);
    list = setVehicleLock(list, 'V1', false);
    expect(getAssignment(list, 'V1').lockedCrew).toEqual([]);
    expect(getAssignment(list, 'V1').destinationLocked).toBe(false);
  });
});

describe('validatePlan', () => {
  it('reports duplicates, over-capacity and missing licences', () => {
    const list: Assignment[] = [
      { ...emptyAssignment('V4'), crew: ['P4', 'P5', 'P7', 'P8'], destination: { kind: 'project', projectId: 'J1' } },
      { ...emptyAssignment('V1'), crew: ['P4'] },
    ];
    const issues = validatePlan(list, ctx);
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toMatch(/only 3 seats/);
    expect(text).toMatch(/two vehicles/);
    expect(text).toMatch(/licence B/);
    expect(text).toMatch(/no destination/);
  });
});
