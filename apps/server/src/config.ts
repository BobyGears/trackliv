import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Minimal .env loader (KEY=value, # comments, optional quotes) – avoids an extra dependency. */
function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(resolve(ROOT, '.env'));

const env = process.env;
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(env.PORT, 8787),
  production: env.NODE_ENV === 'production',
  dataDir: resolve(ROOT, env.TRACKLIV_DATA_DIR ?? 'apps/server/var'),
  geoDir: resolve(ROOT, 'data/geo'),
  webDist: resolve(ROOT, 'apps/web/dist'),
  /** 'demo' seeds example people/projects/vehicles on first start, 'empty' starts blank. */
  seed: (env.TRACKLIV_SEED ?? 'demo') as 'demo' | 'empty',
  timezone: env.TZ ?? 'Europe/Berlin',
  fleetgo: {
    baseUrl: (env.FLEETGO_BASE_URL ?? 'https://api.fleetgo.com').replace(/\/$/, ''),
    loginPath: env.FLEETGO_LOGIN_PATH ?? '/api/session/login',
    fleetPath: env.FLEETGO_FLEET_PATH ?? '/api/equipment/Getfleet?groupId=0&hasDeviceOnly=false',
    tripsPath: env.FLEETGO_TRIPS_PATH ?? '/api/trips/GetTrips',
    clientId: env.FLEETGO_CLIENT_ID ?? '',
    clientSecret: env.FLEETGO_CLIENT_SECRET ?? '',
    username: env.FLEETGO_USERNAME ?? '',
    password: env.FLEETGO_PASSWORD ?? '',
    pollSeconds: num(env.FLEETGO_POLL_SECONDS, 30),
    /**
     * 'dashboard' = sign in to the FleetGO web dashboard with a normal user (headless browser),
     * 'api' = official partner API (needs FLEETGO_CLIENT_ID/SECRET). Picked automatically.
     */
    mode: (env.FLEETGO_MODE ||
      (env.FLEETGO_CLIENT_ID && env.FLEETGO_CLIENT_SECRET ? 'api' : env.FLEETGO_USERNAME && env.FLEETGO_PASSWORD ? 'dashboard' : 'off')) as
      | 'api'
      | 'dashboard'
      | 'off',
    dashboardUrl: (env.FLEETGO_DASHBOARD_URL ?? 'https://app.fleetgo.com').replace(/\/$/, ''),
    /** Optional page to open after signing in, if the start page doesn't load the vehicles (e.g. /Map). */
    dashboardPage: env.FLEETGO_DASHBOARD_PAGE ?? '',
    /** Only use responses whose URL contains this text as vehicle source (empty = automatic). */
    dashboardSource: env.FLEETGO_DASHBOARD_SOURCE ?? '',
    /** Chromium binary; empty = the one installed by Playwright (Docker image). */
    browserPath: env.FLEETGO_BROWSER ?? '',
    /** Add FleetGO vehicles that don't match a TrackLiv vehicle automatically. */
    autoImport: (env.FLEETGO_AUTO_IMPORT ?? 'true') !== 'false',
  },
  simulator: {
    /** Simulation clock speed (1 = real time). Only used without FleetGO credentials. */
    speed: num(env.SIM_SPEED, 1),
    tickMs: num(env.SIM_TICK_MS, 1000),
  },
  geocoder: {
    url: (env.GEOCODER_URL ?? 'https://nominatim.openstreetmap.org').replace(/\/$/, ''),
    userAgent: env.GEOCODER_USER_AGENT ?? 'TrackLiv/0.1 (DTE GmbH dispatch)',
  },
};

export const fleetgoConfigured = () =>
  config.fleetgo.mode === 'api'
    ? !!(config.fleetgo.clientId && config.fleetgo.clientSecret && config.fleetgo.username && config.fleetgo.password)
    : config.fleetgo.mode === 'dashboard' && !!(config.fleetgo.username && config.fleetgo.password);
