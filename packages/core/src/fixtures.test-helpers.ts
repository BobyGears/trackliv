import type { PlanContext } from './assignments.ts';
import type { Person, Project, Site, Vehicle } from './types.ts';

export const sites: Site[] = [
  { id: 'A', code: 'HQ-A', name: 'Depot A', address: '', location: { lng: 8.41283, lat: 50.00683 }, geofenceRadiusM: 110, color: '#00f' },
  { id: 'B', code: 'HQ-B', name: 'Depot B', address: '', location: { lng: 8.41375, lat: 50.00243 }, geofenceRadiusM: 110, color: '#0ff' },
];

const v = (id: string, extra: Partial<Vehicle> = {}): Vehicle => ({
  id,
  callsign: id,
  plate: `MTK-DT ${id}`,
  make: 'Mercedes-Benz',
  model: 'Sprinter',
  kind: 'van',
  seats: 4,
  requiredLicense: 'B',
  homeSiteId: 'A',
  status: 'active',
  ...extra,
});

export const vehicles: Vehicle[] = [
  v('V1'),
  v('V2'),
  v('V3', { homeSiteId: 'B' }),
  v('V4', { homeSiteId: 'B', seats: 3 }),
  v('TR', { kind: 'truck', seats: 3, requiredLicense: 'C1', homeSiteId: 'B' }),
  v('MX', { status: 'maintenance' }),
];

const p = (id: string, extra: Partial<Person> = {}): Person => ({
  id,
  firstName: id,
  lastName: 'Test',
  role: 'Operative',
  licenses: [],
  homeSiteId: 'A',
  status: 'available',
  ...extra,
});

export const people: Person[] = [
  p('P1', { licenses: ['B'] }),
  p('P2', { licenses: ['B'] }),
  p('P3', { licenses: ['C1'] }),
  p('P4'),
  p('P5'),
  p('P6', { licenses: ['B'], homeSiteId: 'B' }),
  p('P7', { homeSiteId: 'B' }),
  p('P8', { homeSiteId: 'B' }),
  p('P9', { licenses: ['CE'], homeSiteId: 'B' }),
  p('P10'),
  p('P11', { licenses: ['B'] }),
  p('SICK', { licenses: ['B'], status: 'sick' }),
];

const proj = (id: string, extra: Partial<Project> = {}): Project => ({
  id,
  code: id,
  name: `Project ${id}`,
  client: 'Client',
  address: '',
  location: { lng: 8.6, lat: 50.1 },
  status: 'active',
  priority: 'normal',
  color: '#f00',
  ...extra,
});

export const projects: Project[] = [
  proj('J1', { priority: 'critical', location: { lng: 8.68, lat: 50.11 } }),
  proj('J2', { location: { lng: 8.24, lat: 50.08 } }),
  proj('J3', { priority: 'high', location: { lng: 8.27, lat: 49.99 } }),
  proj('J4', { status: 'paused' }),
];

export const ctx: PlanContext = { sites, vehicles, people, projects };
