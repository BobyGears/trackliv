import type {
  Assignment,
  Bootstrap,
  DayHistory,
  DayPlan,
  FleetStatus,
  LngLat,
  OpsEvent,
  Person,
  Project,
  Route,
  Telemetry,
  TrackPoint,
  Vehicle,
} from '@trackliv/core';

export interface ClockSnapshot {
  realEpoch: number;
  opsEpoch: number;
  speed: number;
}

export interface SiteGeo {
  id: string;
  code: string;
  name: string;
  address: string;
  color: string;
  location: LngLat;
  geofenceRadiusM: number;
  heightM: number | null;
  footprint: [number, number][];
  yard: { lng: number; lat: number; heading: number }[];
  gate: LngLat;
}

/** One vehicle's day: the recorded track plus stops and trips; `days` = all days with recordings (newest first). */
export type VehicleHistory = DayHistory & { date: string; vehicleId: string; points: TrackPoint[]; days: string[] };

export type BootstrapResponse = Bootstrap & { clock: ClockSnapshot; today: string; mode: 'fleetgo' | 'simulator' };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

const user = () => {
  try {
    return localStorage.getItem('trackliv:user') || 'Dispatcher';
  } catch {
    return 'Dispatcher';
  }
};

/** Fired when the server says the session is missing or expired. */
export const UNAUTHORIZED_EVENT = 'trackliv:unauthorized';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-TrackLiv-User': user() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `HTTP ${res.status}`, res.status, data);
  return data as T;
}

export const authApi = {
  me: () => req<{ authEnabled: boolean; user: string | null; provider?: 'atlas' | 'local' | null; atlasUrl?: string | null }>('GET', '/api/auth/me'),
  login: (username: string, password: string) => req<{ user: string }>('POST', '/api/auth/login', { username, password }),
  logout: () => req<{ ok: boolean }>('POST', '/api/auth/logout'),
};

export const api = {
  bootstrap: (date?: string) => req<BootstrapResponse>('GET', `/api/bootstrap${date ? `?date=${date}` : ''}`),
  siteGeo: () => req<SiteGeo[]>('GET', '/api/sites/geo'),
  plan: (date: string) => req<DayPlan>('GET', `/api/plans/${date}`),
  putPlan: (date: string, assignments: Assignment[], baseRevision: number, reason?: string) =>
    req<DayPlan>('PUT', `/api/plans/${date}`, { assignments, baseRevision, reason }),
  dispatch: (date: string, vehicleId: string) => req<DayPlan>('POST', `/api/plans/${date}/dispatch`, { vehicleId }),
  recall: (date: string, vehicleId: string) => req<DayPlan>('POST', `/api/plans/${date}/recall`, { vehicleId }),
  routes: (legs: { id: string; from: LngLat; to: LngLat }[]) =>
    req<{ routes: Record<string, Route> }>('POST', '/api/routes', { legs }),
  geocode: (q: string) => req<{ results: { label: string; lat: number; lng: number }[] }>('GET', `/api/geocode?q=${encodeURIComponent(q)}`),
  history: (vehicleId: string, date: string) => req<VehicleHistory>('GET', `/api/history/${encodeURIComponent(vehicleId)}?date=${date}`),
  simSpeed: (speed: number) => req<ClockSnapshot>('POST', '/api/sim/speed', { speed }),
  save: <T extends Person | Project | Vehicle>(kind: 'people' | 'projects' | 'vehicles', item: Partial<T>) =>
    item.id ? req<T>('PUT', `/api/${kind}/${item.id}`, item) : req<T>('POST', `/api/${kind}`, item),
  remove: (kind: 'people' | 'projects' | 'vehicles', id: string) => req<void>('DELETE', `/api/${kind}/${id}`),
};

export interface StreamHandlers {
  telemetry: (t: Telemetry[]) => void;
  plan: (p: DayPlan) => void;
  event: (e: OpsEvent) => void;
  fleet: (f: FleetStatus) => void;
  clock: (c: ClockSnapshot) => void;
  master: (m: Partial<{ people: Person[]; projects: Project[]; vehicles: Vehicle[] }>) => void;
  vehicles: (v: Vehicle[]) => void;
  status: (connected: boolean) => void;
}

export function openStream(h: StreamHandlers): () => void {
  const es = new EventSource('/api/stream');
  const on = <K extends keyof StreamHandlers>(name: K) =>
    es.addEventListener(name, (e) => (h[name] as (d: unknown) => void)(JSON.parse((e as MessageEvent).data)));
  on('telemetry');
  on('plan');
  on('event');
  on('fleet');
  on('clock');
  on('master');
  on('vehicles');
  // the session ended (signed out elsewhere, or Atlas withdrew access) → back to the sign-in screen
  es.addEventListener('auth', () => {
    es.close();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  });
  es.onopen = () => h.status(true);
  es.onerror = () => h.status(false);
  return () => es.close();
}

export async function loadGeo<T = GeoJSON.FeatureCollection>(name: string): Promise<T> {
  const res = await fetch(`/api/geo/${name}`);
  if (!res.ok) throw new Error(`geodata ${name}: HTTP ${res.status}`);
  return res.json();
}
