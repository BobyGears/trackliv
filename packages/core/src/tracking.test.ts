import { describe, expect, it } from 'vitest';
import { emptyAssignment } from './assignments.ts';
import { sites } from './fixtures.test-helpers.ts';
import { RoadGraph } from './routing.ts';
import { nextStage } from './tracking.ts';
import type { Assignment } from './types.ts';

const dest = { lng: 8.68, lat: 50.11 };
const at = (stage: Assignment['stage']): Assignment => ({ ...emptyAssignment('V1'), stage });

describe('nextStage', () => {
  it('walks through a full day', () => {
    const depot = sites[0].location;
    const road = { lng: 8.5, lat: 50.05 };
    expect(nextStage(at('planned'), depot, sites, dest)).toBe('planned');
    expect(nextStage(at('planned'), road, sites, dest)).toBe('departed');
    expect(nextStage(at('departed'), road, sites, dest)).toBe('departed');
    expect(nextStage(at('departed'), { lng: 8.6801, lat: 50.1101 }, sites, dest)).toBe('on_site');
    // small GPS jitter around the destination keeps it on site
    expect(nextStage(at('on_site'), { lng: 8.683, lat: 50.111 }, sites, dest)).toBe('on_site');
    expect(nextStage(at('on_site'), road, sites, dest)).toBe('returning');
    expect(nextStage(at('returning'), depot, sites, dest)).toBe('completed');
    // returning to the *other* HQ counts as back at depot
    expect(nextStage(at('returning'), sites[1].location, sites, dest)).toBe('completed');
  });

  it('treats turning back before arrival as still planned', () => {
    expect(nextStage(at('departed'), sites[0].location, sites, dest)).toBe('planned');
  });

  it('ignores driving back through the depot fence on the way out', () => {
    expect(nextStage(at('departed'), { ...sites[0].location, speedKmh: 25 }, sites, dest)).toBe('departed');
  });
});

describe('RoadGraph', () => {
  // A square with a diagonal shortcut that is a slow service road.
  const g = new RoadGraph({
    classes: ['primary', 'service'],
    nodes: [8.0, 50.0, 8.01, 50.0, 8.01, 50.01, 8.0, 50.01],
    edges: [
      [0, 1, 716, 0],
      [1, 2, 1112, 0],
      [0, 3, 1112, 0],
      [3, 2, 716, 0],
      [0, 2, 1322, 1, [8.005, 50.005]],
    ],
  });

  it('prefers the faster road over the shorter one', () => {
    const r = g.route({ lng: 7.9999, lat: 50.0 }, { lng: 8.0101, lat: 50.01 })!;
    expect(r).not.toBeNull();
    // primary 60 km/h via a corner (1828 m) beats service 15 km/h diagonal (1322 m)
    expect(r.coords.some(([x, y]) => x === 8.005 && y === 50.005)).toBe(false);
    expect(r.lengthM).toBeGreaterThan(1800);
  });

  it('snaps to the nearest node', () => {
    expect(g.nearestNode({ lng: 8.0099, lat: 50.0001 })!.node).toBe(1);
  });
});
