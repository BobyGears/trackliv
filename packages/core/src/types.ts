// Domain model shared by the TrackLiv server and web client.
// Everything is plain JSON so it can be persisted, streamed over SSE and diffed.

export type ID = string;

export interface LngLat {
  lng: number;
  lat: number;
}

export interface Site {
  id: ID;
  /** Short operational code shown in chips, e.g. "HQ-SCH". */
  code: string;
  name: string;
  address: string;
  /** Address point (official Hessen address register via Overture Maps). */
  location: LngLat;
  /** Vehicles inside this radius count as "at the depot". */
  geofenceRadiusM: number;
  color: string;
}

export type VehicleKind = 'van' | 'truck' | 'pickup' | 'car';

/** German driving licence classes relevant for the fleet. */
export type LicenseClass = 'B' | 'BE' | 'C1' | 'C1E' | 'C' | 'CE';

export type VehicleStatus = 'active' | 'maintenance' | 'inactive';

export interface Vehicle {
  id: ID;
  callsign: string;
  plate: string;
  make: string;
  model: string;
  kind: VehicleKind;
  /** Crew capacity (1–4). */
  seats: number;
  /** Minimum licence needed to drive it. */
  requiredLicense: LicenseClass;
  homeSiteId: ID;
  status: VehicleStatus;
  /** Link to the FleetGO equipment record (matched by id or licence plate). */
  fleetgo?: { equipmentId?: number | string; serial?: string };
}

export type PersonRole = 'Foreman' | 'Driver' | 'Technician' | 'Operative' | 'Apprentice';
export type PersonStatus = 'available' | 'sick' | 'vacation' | 'training';

export interface Person {
  id: ID;
  firstName: string;
  lastName: string;
  role: PersonRole;
  licenses: LicenseClass[];
  homeSiteId: ID;
  status: PersonStatus;
  phone?: string;
}

export type ProjectStatus = 'active' | 'planned' | 'paused' | 'completed';
export type Priority = 'low' | 'normal' | 'high' | 'critical';

export interface Project {
  id: ID;
  code: string;
  name: string;
  client: string;
  address: string;
  location: LngLat;
  status: ProjectStatus;
  priority: Priority;
  /** Desired number of people on site per day (used by the randomizer for weighting). */
  crewTarget?: number;
  color: string;
  start?: string;
  end?: string;
  notes?: string;
}

export type Destination =
  | { kind: 'project'; projectId: ID }
  | { kind: 'custom'; label: string; address?: string; location?: LngLat };

/** Lifecycle of one vehicle's run for the day. */
export type Stage = 'planned' | 'departed' | 'on_site' | 'returning' | 'completed';

export const STAGES: Stage[] = ['planned', 'departed', 'on_site', 'returning', 'completed'];

export interface Assignment {
  vehicleId: ID;
  /** Person ids, max `vehicle.seats` (≤ 4). Order is display order; crew[0] is the preferred driver. */
  crew: ID[];
  /** Crew members pinned to this vehicle – the randomizer never moves them. */
  lockedCrew: ID[];
  destination: Destination | null;
  /** Destination pinned – the randomizer never changes it. */
  destinationLocked: boolean;
  /** Planned departure / return, "HH:MM" local time. */
  departAt?: string;
  returnAt?: string;
  stage: Stage;
  stageTimes: Partial<Record<Stage, string>>;
  note?: string;
}

export interface DayPlan {
  date: string;
  revision: number;
  assignments: Assignment[];
  updatedAt: string;
  updatedBy?: string;
}

export interface Telemetry {
  vehicleId: ID;
  ts: string;
  lng: number;
  lat: number;
  speedKmh: number;
  heading: number;
  ignition: boolean;
  odometerKm?: number;
  fuelPct?: number;
  address?: string;
  source: 'fleetgo' | 'simulator';
}

export type EventKind = 'stage' | 'assignment' | 'randomize' | 'system' | 'fleet' | 'alert';
export type Severity = 'info' | 'success' | 'warning' | 'critical';

export interface OpsEvent {
  id: ID;
  ts: string;
  kind: EventKind;
  severity: Severity;
  title: string;
  detail?: string;
  refs?: { vehicleId?: ID; personIds?: ID[]; projectId?: ID; siteId?: ID };
}

export interface FleetStatus {
  source: 'fleetgo' | 'simulator';
  connected: boolean;
  lastSync?: string;
  error?: string;
  vehiclesMatched?: number;
  vehiclesTotal?: number;
  pollSeconds: number;
}

export interface Bootstrap {
  serverTime: string;
  sites: Site[];
  vehicles: Vehicle[];
  people: Person[];
  projects: Project[];
  plan: DayPlan;
  telemetry: Telemetry[];
  events: OpsEvent[];
  fleet: FleetStatus;
}
