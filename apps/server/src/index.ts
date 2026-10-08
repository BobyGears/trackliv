import { config, fleetgoConfigured } from './config.ts';

process.env.TZ = config.timezone;

import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  DEFAULT_RETURN,
  randomizePlan,
  todayISO,
  unassignPerson,
  validatePlan,
  type Assignment,
  type Bootstrap,
  type LngLat,
  type Person,
  type Project,
  type Vehicle,
} from '@trackliv/core';
import {
  createAuth,
  issueSession,
  loginRateLimited,
  noteFailedLogin,
  requireSession,
  sessionUser,
  setSessionCookie,
  verifyPassword,
} from './auth.ts';
import { db } from './db.ts';
import { startFleetGoSync } from './fleetSync.ts';
import { routeBetween, siteGeo, sites } from './geodata.ts';
import { broadcast, clientCount, sseHandler } from './hub.ts';
import { ops } from './ops.ts';
import { demoPeople, demoProjects, demoVehicles } from './seed.ts';
import { resetSimVehicle, startSimulator } from './simulator.ts';

// ---------------------------------------------------------------------------------------------
// First start: seed master data and a randomized plan for today.
const live = fleetgoConfigured();
if (db.isEmpty) {
  if (config.seed === 'demo') {
    db.data.people = demoPeople;
    db.data.projects = demoProjects;
    db.data.vehicles = live ? [] : demoVehicles; // with FleetGO the real fleet is imported on first sync
  }
  db.flush();
}
if (!live && config.seed === 'demo') {
  const date = ops.today();
  if (!db.data.plans[date]) seedDemoPlan(date);
}
db.flush();
db.snapshot();

function seedDemoPlan(date: string) {
  const ctx = { vehicles: db.data.vehicles, people: db.data.people, projects: db.data.projects, sites };
  const r = randomizePlan(ctx, ops.plan(date).assignments, { seed: `DTE-${date}`, targetCrew: 3 });
  const departures = ['06:30', '06:45', '07:00', '07:00', '07:15', '07:30', '07:45', '08:00', '08:30', '09:00', '10:00'];
  const returns = ['14:30', '15:00', '15:30', '15:45', '16:00', '16:15', '16:30', '17:00'];
  let i = 0;
  const assignments: Assignment[] = r.assignments.map((a) =>
    a.crew.length ? { ...a, departAt: departures[i % departures.length], returnAt: returns[i++ % returns.length] } : a,
  );
  // One vehicle stays unplanned so the dispatcher has something to do.
  const spare = assignments.findIndex((a) => a.crew.length && a.vehicleId === 'veh-10');
  if (spare >= 0) assignments[spare] = { ...assignments[spare], departAt: '11:30', returnAt: '18:00' };
  ops.savePlan(date, assignments, { force: true, actor: 'seed' });
  ops.log({ kind: 'system', severity: 'info', title: 'Demo plan created', detail: `Randomized with seed DTE-${date}` });
}

ops.clock.setSpeed(live ? 1 : config.simulator.speed);

// ---------------------------------------------------------------------------------------------
const auth = createAuth(process.env);
if (config.production && !auth.enabled && process.env.TRACKLIV_AUTH !== 'off') {
  console.error('[trackliv] Refusing to start in production without users. Set TRACKLIV_USERS="Name:password,…" in .env');
  console.error('           (or TRACKLIV_AUTH=off if the server is only reachable from a private network).');
  process.exit(1);
}
if (auth.enabled && !/^[0-9a-f]{32,}$/i.test(process.env.TRACKLIV_SESSION_SECRET ?? '')) {
  console.warn('[auth] TRACKLIV_SESSION_SECRET not set – using a random one, everybody is signed out on restart');
}

const app = express();
app.disable('x-powered-by');
// Behind Caddy / nginx (Docker network or localhost): trust X-Forwarded-* for client IP and https.
app.set('trust proxy', 'loopback, uniquelocal');
app.use(express.json({ limit: '2mb' }));

if (config.production) {
  const tileOrigin = (() => {
    try {
      return new URL((process.env.VITE_STREET_TILES ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').replace(/[{}]/g, '')).origin;
    } catch {
      return '';
    }
  })();
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${tileOrigin}`,
    `connect-src 'self' ${tileOrigin}`,
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    next();
  });
}

// --- login -----------------------------------------------------------------------------------
app.get('/api/auth/me', (req, res) => {
  res.json({ authEnabled: auth.enabled, user: auth.enabled ? sessionUser(auth, req) : null });
});
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip ?? 'unknown';
  if (loginRateLimited(ip)) return void res.status(429).json({ error: 'Too many attempts – try again in 15 minutes' });
  const name = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const match = [...auth.users.entries()].find(([u]) => u.toLowerCase() === name.toLowerCase());
  if (!auth.enabled || !match || !verifyPassword(match[1], password)) {
    noteFailedLogin(ip);
    return void res.status(401).json({ error: 'Wrong name or password' });
  }
  setSessionCookie(req, res, issueSession(auth, match[0]));
  ops.log({ kind: 'system', severity: 'info', title: `${match[0]} signed in` });
  res.json({ user: match[0] });
});
app.post('/api/auth/logout', (req, res) => {
  setSessionCookie(req, res, null);
  res.json({ ok: true });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: live ? 'fleetgo' : 'simulator', serverTime: ops.nowISO() });
});
app.use('/api', requireSession(auth));

const actorOf = (req: Request, res?: Response) =>
  String(res?.locals.user ?? req.header('x-trackliv-user') ?? 'dispatcher').slice(0, 60);
const dateParam = (s: unknown) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ops.today());
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, mode: live ? 'fleetgo' : 'simulator', clients: clientCount(), fleet: ops.fleet, serverTime: ops.nowISO() });
});

app.get('/api/bootstrap', (req, res) => {
  const date = dateParam(req.query.date);
  const body: Bootstrap & { clock: ReturnType<typeof ops.clock.snapshot>; today: string; mode: string } = {
    serverTime: ops.nowISO(),
    today: ops.today(),
    mode: live ? 'fleetgo' : 'simulator',
    clock: ops.clock.snapshot(),
    sites,
    vehicles: db.data.vehicles,
    people: db.data.people,
    projects: db.data.projects,
    plan: ops.plan(date),
    telemetry: [...ops.telemetry.values()],
    events: ops.recentEvents(400),
    fleet: ops.fleet,
  };
  res.json(body);
});

app.get('/api/stream', sseHandler);

app.get('/api/plans/:date', (req, res) => {
  res.json(ops.plan(dateParam(req.params.date)));
});

app.put('/api/plans/:date', (req, res) => {
  const date = dateParam(req.params.date);
  const { assignments, baseRevision, reason } = req.body as { assignments: Assignment[]; baseRevision?: number; reason?: string };
  if (!Array.isArray(assignments)) return void res.status(400).json({ error: 'assignments[] required' });
  const ctx = { vehicles: db.data.vehicles, people: db.data.people, projects: db.data.projects, sites };
  const errors = validatePlan(assignments, ctx).filter((i) => i.severity === 'error');
  if (errors.length) return void res.status(422).json({ error: errors.map((e) => e.message).join('; '), issues: errors });
  const r = ops.savePlan(date, assignments, { baseRevision, actor: actorOf(req, res) });
  if (!r.ok) return void res.status(409).json({ error: 'Plan changed in the meantime', plan: r.plan });
  if (reason) {
    ops.log({ kind: reason.startsWith('Randomized') ? 'randomize' : 'assignment', severity: 'info', title: reason, detail: `by ${actorOf(req, res)}` });
  }
  res.json(r.plan);
});

function patchAssignment(req: Request, res: Response, fn: (a: Assignment, now: number) => Assignment, title: (callsign: string) => string) {
  const date = dateParam(req.params.date);
  const vehicleId = String(req.body?.vehicleId ?? '');
  const vehicle = db.data.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return void res.status(404).json({ error: 'Unknown vehicle' });
  const plan = ops.plan(date);
  const now = ops.clock.now();
  const assignments = plan.assignments.map((a) => (a.vehicleId === vehicleId ? fn(a, now) : a));
  const r = ops.savePlan(date, assignments, { force: true, actor: actorOf(req, res) });
  ops.log({ kind: 'assignment', severity: 'info', title: title(vehicle.callsign), detail: `by ${actorOf(req, res)}`, refs: { vehicleId } });
  res.json(r.plan);
}

app.post('/api/plans/:date/dispatch', (req, res) =>
  patchAssignment(
    req,
    res,
    (a, now) => {
      const ret = a.returnAt && a.returnAt > hhmm(now) ? a.returnAt : DEFAULT_RETURN > hhmm(now) ? DEFAULT_RETURN : '23:59';
      return { ...a, departAt: hhmm(now), returnAt: ret };
    },
    (c) => `${c} dispatched now`,
  ),
);

app.post('/api/plans/:date/recall', (req, res) =>
  patchAssignment(req, res, (a, now) => ({ ...a, returnAt: hhmm(now) }), (c) => `${c} recalled to depot`),
);

app.post('/api/routes', (req, res) => {
  const legs = (req.body?.legs ?? []) as { id: string; from: LngLat; to: LngLat }[];
  const out: Record<string, ReturnType<typeof routeBetween>> = {};
  for (const leg of legs.slice(0, 80)) {
    if (!leg?.from || !leg?.to) continue;
    out[leg.id] = routeBetween(leg.from, leg.to);
  }
  res.json({ routes: out });
});

app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 3) return void res.json({ results: [] });
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '6',
    countrycodes: 'de',
    addressdetails: '0',
    viewbox: '7.9,50.4,9.1,49.7',
  });
  try {
    const r = await fetch(`${config.geocoder.url}/search?${params}`, {
      headers: { 'User-Agent': config.geocoder.userAgent, 'Accept-Language': 'de,en' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const list = (await r.json()) as { display_name: string; lat: string; lon: string }[];
    res.json({ results: list.map((x) => ({ label: x.display_name, lat: Number(x.lat), lng: Number(x.lon) })) });
  } catch (e) {
    res.status(502).json({ error: `Address search unavailable (${e instanceof Error ? e.message : e}). Drop a pin on the map instead.` });
  }
});

app.post('/api/sim/speed', (req, res) => {
  if (live) return void res.status(400).json({ error: 'Not available with live FleetGO data' });
  const speed = Number(req.body?.speed);
  if (!Number.isFinite(speed)) return void res.status(400).json({ error: 'speed required' });
  ops.clock.setSpeed(speed);
  broadcast('clock', ops.clock.snapshot());
  res.json(ops.clock.snapshot());
});

// --- master data CRUD -------------------------------------------------------------------------
type Collection = 'people' | 'projects' | 'vehicles';
const prefix: Record<Collection, string> = { people: 'p', projects: 'prj', vehicles: 'veh' };

function crud<T extends { id: string }>(name: Collection, sanitize: (input: Partial<T>, existing?: T) => T | string) {
  const list = () => db.data[name] as unknown as T[];
  const publish = () => broadcast('master', { [name]: list() });
  app.get(`/api/${name}`, (_req, res) => void res.json(list()));
  app.post(`/api/${name}`, (req, res) => {
    const item = sanitize({ ...req.body, id: `${prefix[name]}-${randomUUID().slice(0, 8)}` });
    if (typeof item === 'string') return void res.status(400).json({ error: item });
    list().push(item);
    db.save();
    publish();
    res.status(201).json(item);
  });
  app.put(`/api/${name}/:id`, (req, res) => {
    const idx = list().findIndex((x) => x.id === req.params.id);
    if (idx === -1) return void res.status(404).json({ error: 'not found' });
    const item = sanitize({ ...list()[idx], ...req.body, id: req.params.id }, list()[idx]);
    if (typeof item === 'string') return void res.status(400).json({ error: item });
    list()[idx] = item;
    db.save();
    publish();
    if (name === 'vehicles') resetSimVehicle(item.id);
    res.json(item);
  });
  app.delete(`/api/${name}/:id`, (req, res) => {
    const idx = list().findIndex((x) => x.id === req.params.id);
    if (idx === -1) return void res.status(404).json({ error: 'not found' });
    list().splice(idx, 1);
    const today = ops.today();
    for (const [date, plan] of Object.entries(db.data.plans)) {
      if (date < today) continue;
      let assignments = plan.assignments;
      if (name === 'people') assignments = unassignPerson(assignments, req.params.id);
      if (name === 'vehicles') assignments = assignments.filter((a) => a.vehicleId !== req.params.id);
      if (name === 'projects')
        assignments = assignments.map((a) =>
          a.destination?.kind === 'project' && a.destination.projectId === req.params.id ? { ...a, destination: null, destinationLocked: false } : a,
        );
      if (assignments !== plan.assignments) ops.savePlan(date, assignments, { force: true, actor: 'system' });
    }
    db.save();
    publish();
    res.status(204).end();
  });
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

crud<Person>('people', (p) => {
  if (!str(p.firstName) && !str(p.lastName)) return 'Name required';
  return {
    id: p.id!,
    firstName: str(p.firstName, 60),
    lastName: str(p.lastName, 60),
    role: (p.role ?? 'Operative') as Person['role'],
    licenses: Array.isArray(p.licenses) ? p.licenses : [],
    homeSiteId: sites.some((s) => s.id === p.homeSiteId) ? p.homeSiteId! : sites[0].id,
    status: (p.status ?? 'available') as Person['status'],
    phone: str(p.phone, 40) || undefined,
  };
});

crud<Project>('projects', (p) => {
  if (!str(p.name)) return 'Project name required';
  if (!p.location || !Number.isFinite(p.location.lat) || !Number.isFinite(p.location.lng)) return 'Project location required';
  return {
    id: p.id!,
    code: str(p.code, 30) || `PRJ-${p.id!.slice(-4).toUpperCase()}`,
    name: str(p.name, 120),
    client: str(p.client, 120),
    address: str(p.address, 200),
    location: { lat: Number(p.location.lat), lng: Number(p.location.lng) },
    status: (p.status ?? 'active') as Project['status'],
    priority: (p.priority ?? 'normal') as Project['priority'],
    crewTarget: p.crewTarget ? Math.max(1, Math.min(40, Number(p.crewTarget))) : undefined,
    color: /^#[0-9a-f]{6}$/i.test(p.color ?? '') ? p.color! : '#2f6bff',
    start: str(p.start, 10) || undefined,
    end: str(p.end, 10) || undefined,
    notes: str(p.notes, 2000) || undefined,
  };
});

crud<Vehicle>('vehicles', (v) => {
  if (!str(v.plate) && !str(v.callsign)) return 'Plate or call sign required';
  return {
    id: v.id!,
    callsign: str(v.callsign, 20) || str(v.plate, 20),
    plate: str(v.plate, 20),
    make: str(v.make, 40),
    model: str(v.model, 60),
    kind: (v.kind ?? 'van') as Vehicle['kind'],
    seats: Math.max(1, Math.min(4, Number(v.seats ?? 4))),
    requiredLicense: (v.requiredLicense ?? 'B') as Vehicle['requiredLicense'],
    homeSiteId: sites.some((s) => s.id === v.homeSiteId) ? v.homeSiteId! : sites[0].id,
    status: (v.status ?? 'active') as Vehicle['status'],
    fleetgo: v.fleetgo,
  };
});

// --- static geodata (gzipped once in memory) -------------------------------------------------
const geoFiles = new Map<string, { raw: Buffer; gz: Buffer; etag: string }>();
for (const f of readdirSync(config.geoDir)) {
  if (!/\.(geo)?json$/.test(f) || f === 'road-graph.json') continue;
  const raw = readFileSync(join(config.geoDir, f));
  geoFiles.set(f, { raw, gz: gzipSync(raw, { level: 9 }), etag: `"${raw.length.toString(36)}-${f.length}"` });
}
app.get('/api/geo/:name', (req, res) => {
  const file = geoFiles.get(req.params.name);
  if (!file) return void res.status(404).json({ error: 'unknown geodata file' });
  if (req.header('if-none-match') === file.etag) return void res.status(304).end();
  res.set({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', ETag: file.etag, Vary: 'Accept-Encoding' });
  if (/\bgzip\b/.test(req.header('accept-encoding') ?? '')) {
    res.set('Content-Encoding', 'gzip').send(file.gz);
  } else res.send(file.raw);
});
app.get('/api/sites/geo', (_req, res) => void res.json(siteGeo));

// --- production: serve the built web app ----------------------------------------------------
if (existsSync(config.webDist)) {
  app.use(express.static(config.webDist, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(config.webDist, 'index.html')));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`[trackliv] API on http://localhost:${config.port} (${live ? 'FleetGO live' : 'simulator'}), today ${todayISO()}`);
  if (live) startFleetGoSync();
  else startSimulator(config.simulator.tickMs);
});

process.on('SIGINT', () => {
  db.flush();
  process.exit(0);
});
process.on('SIGTERM', () => {
  db.flush();
  process.exit(0);
});
