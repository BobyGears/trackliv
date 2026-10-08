import { type FleetGoEquipment, parseEquipment } from './fleetgo.ts';

/**
 * Finds the vehicle list in data the FleetGO web dashboard loads, without knowing its exact format.
 *
 * The dashboard's internal endpoints are undocumented, so instead of hard-coding field names we
 * look for an array of objects that have coordinates plus vehicle-like fields (plate or name, speed,
 * heading, ignition, timestamp) and score it against look-alikes such as places/geofences (coordinates
 * and a name, but a radius and no speed) or trip histories (many points, no plate).
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

const K = {
  lat: /^(lat|latitude|breedtegraad|breite)$/i,
  lng: /^(lng|lon|long|longitude|lengtegraad|laenge|länge)$/i,
  position: /(pos|loc|gps|coord|geo|last|current|point)/i,
  id: /^(id|equipmentid|equipment_id|vehicleid|vehicle_id|objectid|assetid|unitid|deviceid|trackerid)$/i,
  plate: /(plate|licen[cs]e|kenteken|kennzeichen|registration|regnr|serialnumber)/i,
  name: /^(name|displayname|label|code|equipmentcode|callsign|description|title|alias|vehiclename|equipmentname|objectname)$/i,
  ts: /(datetime|timestamp|^time$|gpstime|fixtime|lastseen|lastupdate|updated(at|on)?$|^date$)/i,
  speed: /(speed|velocity|kmh)/i,
  heading: /^(heading|direction|course|bearing|angle|azimuth)$/i,
  ignition: /(ignition|contact|enginerunning|engineon|engine_on|motoran|isdriving|ismoving|moving|driving)/i,
  driver: /(driver|bestuurder|fahrer)/i,
  address: /^(address|street|place|locationname|adres|adresse|formattedaddress|currentaddress)$/i,
  odometer: /(odometer|mileage|kmstand)/i,
  notVehicle: /(radius|geofence|polygon|^poi|zone|area|perimeter)/i,
};

const toNum = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
};

/** Microdegree/1e5/1e7 encodings → degrees (the smallest scale that gives a valid coordinate). */
function scaleCoords(lat: number, lng: number): { lat: number; lng: number } | null {
  for (const s of [1, 1e5, 1e6, 1e7]) {
    const la = lat / s;
    const ln = lng / s;
    if (Math.abs(la) <= 90 && Math.abs(ln) <= 180) return la === 0 && ln === 0 ? null : { lat: la, lng: ln };
  }
  return null;
}

function directCoords(o: Obj): { lat: number; lng: number } | null {
  let lat: number | undefined;
  let lng: number | undefined;
  for (const [k, v] of Object.entries(o)) {
    if (lat === undefined && K.lat.test(k)) lat = toNum(v);
    else if (lng === undefined && K.lng.test(k)) lng = toNum(v);
  }
  if (lat !== undefined && lng !== undefined) return scaleCoords(lat, lng);
  // GeoJSON point / [lng, lat] pair
  const geom = isObj(o.geometry) ? o.geometry : o;
  const c = geom.coordinates;
  if (Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number' && (geom === o || geom.type === 'Point')) {
    return scaleCoords(c[1], c[0]);
  }
  return null;
}

/** Coordinates of a record: on the record itself or in a nested position object (2 levels deep). */
export function coordsOf(item: unknown): { lat: number; lng: number } | null {
  if (!isObj(item)) return null;
  const own = directCoords(item);
  if (own) return own;
  const children = Object.entries(item)
    .filter(([, v]) => isObj(v))
    .sort(([a], [b]) => Number(K.position.test(b)) - Number(K.position.test(a)));
  for (const [, child] of children) {
    const c = directCoords(child as Obj);
    if (c) return c;
    for (const grand of Object.values(child as Obj)) {
      if (isObj(grand)) {
        const g = directCoords(grand);
        if (g) return g;
      }
    }
  }
  return null;
}

/** Keys of a record and its nested objects (2 levels), for classifying it. */
function keysOf(item: Obj, depth = 0, out: string[] = []): string[] {
  for (const [k, v] of Object.entries(item)) {
    out.push(k);
    if (depth < 2 && isObj(v)) keysOf(v, depth + 1, out);
  }
  return out;
}

/** First primitive value whose key matches (own keys first, then nested objects). */
function field(item: Obj, re: RegExp, depth = 0): unknown {
  for (const [k, v] of Object.entries(item)) {
    if (re.test(k) && v !== null && v !== '' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) return v;
  }
  if (depth < 2) {
    for (const v of Object.values(item)) {
      if (isObj(v)) {
        const f = field(v, re, depth + 1);
        if (f !== undefined) return f;
      }
    }
  }
  return undefined;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const label = (item: Obj): string | undefined => {
  const v = field(item, K.plate) ?? field(item, K.name);
  return typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined;
};

export function parseTime(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') {
    const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : NaN;
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
  }
  const s = String(v);
  const asp = /\/Date\((-?\d+)/.exec(s); // ASP.NET "/Date(1700000000000+0100)/"
  if (asp) return new Date(Number(asp[1])).toISOString();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function parseBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 0 || v === 1) return v === 1;
  if (typeof v === 'string' && /^(on|off|true|false|ja|nein|yes|no|aan|uit|0|1)$/i.test(v.trim())) return /^(on|true|ja|yes|aan|1)$/i.test(v.trim());
  return undefined;
}

/** One dashboard record → the same shape the official FleetGO API client produces. */
export function normalizeRecord(item: unknown, index = 0): FleetGoEquipment | null {
  if (!isObj(item)) return null;
  const known = parseEquipment(item);
  if (known && known.lat !== null && known.lng !== null) return known;
  const c = coordsOf(item);
  const plateRaw = field(item, K.plate);
  const nameRaw = field(item, K.name);
  const idRaw = field(item, K.id);
  const plate = String(plateRaw ?? nameRaw ?? idRaw ?? `#${index + 1}`).trim();
  const name = nameRaw !== undefined && String(nameRaw) !== plate ? String(nameRaw) : undefined;
  const ignition = parseBool(field(item, K.ignition));
  const speed = toNum(field(item, K.speed)) ?? 0;
  const address = field(item, K.address);
  return {
    equipmentId: (idRaw as string | number | undefined) ?? plate,
    plate,
    equipmentCode: name,
    make: str(field(item, /^(make|brand|merk|marke)$/i)),
    model: str(field(item, /^(model|modell)$/i)),
    lat: c?.lat ?? null,
    lng: c?.lng ?? null,
    ts: parseTime(field(item, K.ts)),
    speedKmh: speed,
    heading: toNum(field(item, K.heading)) ?? 0,
    ignition: ignition ?? speed > 0,
    odometerKm: toNum(field(item, K.odometer)),
    address: typeof address === 'string' ? address : undefined,
  };
}

export interface VehicleCandidate {
  /** JSON path of the list inside the response, e.g. "data.items". */
  path: string;
  items: unknown[];
  score: number;
}

/** How much a list looks like "our vehicles with their current position" (0 = not at all). */
export function scoreList(items: unknown[]): number {
  const objs = items.filter(isObj).slice(0, 300);
  if (objs.length === 0) return 0;
  const n = objs.length;
  let coords = 0;
  let named = 0;
  let idOnly = 0;
  let vehicleish = 0;
  let poi = 0;
  const labels = new Set<string>();
  for (const o of objs) {
    if (coordsOf(o)) coords++;
    const l = label(o);
    if (l) {
      named++;
      labels.add(l);
    } else if (field(o, K.id) !== undefined) {
      idOnly++;
      labels.add(String(field(o, K.id)));
    }
    const keys = keysOf(o);
    if (keys.some((k) => K.plate.test(k) || K.speed.test(k) || K.heading.test(k) || K.ignition.test(k) || K.ts.test(k) || K.driver.test(k) || K.odometer.test(k))) vehicleish++;
    if (keys.some((k) => K.notVehicle.test(k))) poi++;
  }
  if (coords / n < 0.5) return 0;
  // places, customers and geofences have coordinates and a name, but nothing a vehicle reports
  if (vehicleish / n < 0.3) return 0;
  // vehicles have a plate or name each (an id alone counts less); trip points and tracks have neither
  const labelled = (named + 0.4 * idOnly) / n;
  const distinct = named + idOnly ? labels.size / (named + idOnly) : 0;
  // a fleet lists each vehicle once; trips, stops and messages repeat the same few vehicles
  if (n >= 4 && named + idOnly >= 4 && distinct < 0.5) return 0;
  return (
    coords *
    (0.2 + labelled) *
    (0.3 + vehicleish / n) *
    (labelled < 0.3 ? 0.01 : 1) *
    (poi / n > 0.5 ? 0.2 : 1) *
    (distinct >= 0.8 ? 1 : 0.3)
  );
}

/** Best vehicle-like list anywhere in a JSON document (also a single vehicle object, e.g. a live update). */
export function findVehicleList(json: unknown): VehicleCandidate | null {
  let best: VehicleCandidate | null = null;
  const visit = (v: unknown, path: string, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(v)) {
      if (v.some(isObj)) {
        const score = scoreList(v);
        if (score > 0 && (!best || score > best.score)) best = { path, items: v, score };
      }
      v.slice(0, 50).forEach((x, i) => visit(x, `${path}[${i}]`, depth + 1));
    } else if (isObj(v)) {
      for (const [k, child] of Object.entries(v)) visit(child, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  visit(json, '', 0);
  if (!best && isObj(json) && coordsOf(json) && label(json)) {
    const score = scoreList([json]);
    if (score > 0) best = { path: '', items: [json], score };
  }
  return best;
}

export function extractVehicles(json: unknown): { candidate: VehicleCandidate; vehicles: FleetGoEquipment[] } | null {
  const candidate = findVehicleList(json);
  if (!candidate) return null;
  const vehicles = candidate.items.map((x, i) => normalizeRecord(x, i)).filter((v): v is FleetGoEquipment => !!v);
  return vehicles.length ? { candidate, vehicles } : null;
}

/** Structure of a JSON document without its values – safe to print in logs and reports. */
export function shapeOf(v: unknown, depth = 0, maxKeys = 14): string {
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.length}× ${shapeOf(v[0], depth + 1, maxKeys)}]`;
  if (isObj(v)) {
    if (depth > 4) return '{…}';
    const entries = Object.entries(v).slice(0, maxKeys);
    const inner = entries.map(([k, x]) => (isObj(x) || Array.isArray(x) ? `${k}:${shapeOf(x, depth + 1, maxKeys)}` : k)).join(', ');
    return `{${inner}${Object.keys(v).length > entries.length ? ', …' : ''}}`;
  }
  return typeof v;
}

/** URL without secrets: query values of token-like keys (or long values) are replaced by "…". */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const [k, v] of [...u.searchParams.entries()]) {
      if (/(token|key|sig|auth|session|code|state|pass|secret|nonce)/i.test(k) || v.length > 24) u.searchParams.set(k, '…');
    }
    return `${u.origin}${u.pathname}${u.search ? decodeURIComponent(u.search) : ''}`;
  } catch {
    return '(invalid url)';
  }
}

/** m.duranoglu@example.de → m…@example.de */
export const maskUser = (u: string) => (u.includes('@') ? `${u[0]}…@${u.split('@')[1]}` : `${u.slice(0, 1)}…`);
