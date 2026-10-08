import type { Site, Telemetry, Vehicle } from '@trackliv/core';
import { haversineM } from '@trackliv/core';
import { config } from './config.ts';

/**
 * FleetGO API client.
 *
 * Endpoints and field names follow FleetGO's public API as used by the open-source
 * RitAssist/FleetGO client (Home Assistant "fleetgo" integration):
 *   POST /api/session/login        { client_id, client_secret, username, password }
 *                                   → { access_token, refresh_token, expires_in }
 *   GET  /api/equipment/Getfleet   ?groupId=0&hasDeviceOnly=false   (Bearer token)
 *   GET  /api/trips/GetTrips       ?equipmentId=&from=&to=&extendedInfo=True
 * API keys are issued by FleetGO (info@fleetgo.com). Paths are configurable in .env in case
 * your account uses a newer API version.
 */

export interface FleetGoEquipment {
  equipmentId: number | string;
  plate: string;
  equipmentCode?: string;
  make?: string;
  model?: string;
  lat: number | null;
  lng: number | null;
  ts?: string;
  speedKmh: number;
  heading: number;
  ignition: boolean;
  odometerKm?: number;
  fuelPct?: number;
  address?: string;
}

interface Token {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

const pick = (o: unknown, ...paths: string[]): unknown => {
  for (const path of paths) {
    let cur: unknown = o;
    for (const k of path.split('.')) {
      if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[k];
      else {
        cur = undefined;
        break;
      }
    }
    if (cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return undefined;
};
const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

/** Normalise one FleetGO equipment record (tolerant to field-name variants between API versions). */
export function parseEquipment(raw: unknown): FleetGoEquipment | null {
  const id = pick(raw, 'Id', 'id', 'EquipmentId', 'equipmentId');
  if (id === undefined) return null;
  const plate = String(
    pick(raw, 'EquipmentHeader.SerialNumber', 'SerialNumber', 'LicensePlate', 'licensePlate', 'EquipmentHeader.Name', 'Name') ?? id,
  );
  const lat = num(pick(raw, 'Location.Latitude', 'LastLocation.Latitude', 'Latitude', 'location.latitude'));
  const lng = num(pick(raw, 'Location.Longitude', 'LastLocation.Longitude', 'Longitude', 'location.longitude'));
  const ts = pick(raw, 'Location.DateTime', 'LastLocation.DateTime', 'DateTime', 'LastUpdate', 'location.dateTime');
  const address = pick(raw, 'Location.Address', 'Address.Address', 'CurrentAddress');
  return {
    equipmentId: id as number | string,
    plate,
    equipmentCode: pick(raw, 'EquipmentHeader.EquipmentID', 'EquipmentID') as string | undefined,
    make: pick(raw, 'EquipmentHeader.Make', 'Make') as string | undefined,
    model: pick(raw, 'EquipmentHeader.Model', 'Model') as string | undefined,
    lat: lat ?? null,
    lng: lng ?? null,
    ts: ts ? new Date(String(ts)).toISOString() : undefined,
    speedKmh: num(pick(raw, 'Speed', 'Location.Speed', 'speed')) ?? 0,
    heading: num(pick(raw, 'Heading', 'Direction', 'Course', 'Location.Heading', 'Location.Direction')) ?? 0,
    ignition: Boolean(pick(raw, 'EngineRunning', 'IgnitionOn', 'Ignition', 'engineRunning')),
    odometerKm: num(pick(raw, 'Odometer', 'OdometerKm', 'odometer')),
    fuelPct: num(pick(raw, 'FuelLevel', 'fuelLevel')),
    address: typeof address === 'string' ? address : undefined,
  };
}

export const normalizePlate = (s: string) => s.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '');

export function matchVehicle(eq: FleetGoEquipment, vehicles: Vehicle[]): Vehicle | undefined {
  const byId = vehicles.find((v) => v.fleetgo?.equipmentId !== undefined && String(v.fleetgo.equipmentId) === String(eq.equipmentId));
  if (byId) return byId;
  const plates = [eq.plate, eq.equipmentCode].filter(Boolean).map((p) => normalizePlate(p!));
  return vehicles.find((v) => plates.includes(normalizePlate(v.plate)) || (v.fleetgo?.serial && plates.includes(normalizePlate(v.fleetgo.serial))));
}

/** Guess a TrackLiv vehicle profile for an unknown FleetGO vehicle (editable later in the UI). */
export function vehicleFromEquipment(eq: FleetGoEquipment, sites: Site[], index: number): Vehicle {
  const model = `${eq.make ?? ''} ${eq.model ?? ''}`.toLowerCase();
  const truck = /(tgl|tgm|atego|actros|antos|daf|scania|volvo fl|iveco eurocargo|70c|72c|lkw|koffer)/.test(model);
  const pickup = /(amarok|hilux|ranger|navara|l200|d-max|pickup)/.test(model);
  let home = sites[0];
  if (eq.lat !== null && eq.lng !== null) {
    home = sites.reduce((best, s) =>
      haversineM(s.location, { lat: eq.lat!, lng: eq.lng! }) < haversineM(best.location, { lat: eq.lat!, lng: eq.lng! }) ? s : best,
    );
  }
  return {
    id: `fg-${eq.equipmentId}`,
    callsign: `T-${String(index + 1).padStart(2, '0')}`,
    plate: eq.plate,
    make: eq.make ?? 'Unknown',
    model: eq.model ?? '',
    kind: truck ? 'truck' : pickup ? 'pickup' : 'van',
    seats: truck ? 3 : 4,
    requiredLicense: truck ? 'C1' : 'B',
    homeSiteId: home.id,
    status: 'active',
    fleetgo: { equipmentId: eq.equipmentId, serial: eq.plate },
  };
}

export function toTelemetry(eq: FleetGoEquipment, vehicleId: string, fallbackTs: string): Telemetry | null {
  if (eq.lat === null || eq.lng === null) return null;
  return {
    vehicleId,
    ts: eq.ts ?? fallbackTs,
    lat: eq.lat,
    lng: eq.lng,
    speedKmh: eq.speedKmh,
    heading: eq.heading,
    ignition: eq.ignition,
    odometerKm: eq.odometerKm,
    fuelPct: eq.fuelPct,
    address: eq.address,
    source: 'fleetgo',
  };
}

export class FleetGoClient {
  private token: Token | null = null;
  constructor(private cfg = config.fleetgo) {}

  private async login(): Promise<Token> {
    const res = await fetch(`${this.cfg.baseUrl}${this.cfg.loginPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        username: this.cfg.username,
        password: this.cfg.password,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof body.access_token !== 'string') {
      throw new Error(`FleetGO login failed (${res.status}): ${String(body.error_description ?? body.error ?? body.message ?? 'no token')}`);
    }
    const expiresIn = Number(body.expires_in ?? 3600);
    this.token = {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
      expiresAt: Date.now() + (expiresIn - 60) * 1000,
    };
    return this.token;
  }

  private async authed(path: string): Promise<unknown> {
    const token = this.token && this.token.expiresAt > Date.now() ? this.token : await this.login();
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401) {
      this.token = null;
      throw new Error('FleetGO rejected the token (401) – will log in again');
    }
    if (!res.ok) throw new Error(`FleetGO ${path} → HTTP ${res.status}`);
    return res.json();
  }

  async fleet(): Promise<FleetGoEquipment[]> {
    const data = await this.authed(this.cfg.fleetPath);
    const list = Array.isArray(data) ? data : ((data as Record<string, unknown>)?.Items ?? (data as Record<string, unknown>)?.items ?? []);
    return (list as unknown[]).map(parseEquipment).filter((e): e is FleetGoEquipment => !!e);
  }

  async trips(equipmentId: string | number, from: string, to: string): Promise<unknown> {
    const q = new URLSearchParams({ equipmentId: String(equipmentId), from, to, extendedInfo: 'True' });
    return this.authed(`${this.cfg.tripsPath}?${q}`);
  }
}
