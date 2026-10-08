// Drives the FleetGO dashboard connector against the mock in a real headless Chromium.
//   npm run test:fleetgo            mock only
//   npm run test:fleetgo -- --real  also check that the real FleetGO sign-in page has the expected fields
import { existsSync } from 'node:fs';
import { config } from '../apps/server/src/config.ts';
import { FleetGoDashboard, FleetGoLoginError } from '../apps/server/src/fleetgoDashboard.ts';
import { startFleetGoMock } from './fleetgo-mock.mjs';

const browserPath = process.env.FLEETGO_BROWSER || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '');
const mock = await startFleetGoMock();
const base = { ...config.fleetgo, mode: 'dashboard', dashboardUrl: mock.appUrl, dashboardPage: '', dashboardSource: '', pollSeconds: 2, browserPath };
const quiet = () => {};
let failed = 0;
const check = (ok, name, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` – ${detail}` : ''}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForFleet(dash, ms = 30_000) {
  const until = Date.now() + ms;
  let last;
  while (Date.now() < until) {
    try {
      const v = await dash.fleet();
      if (v.length) return v;
    } catch (e) {
      last = e;
    }
    await sleep(500);
  }
  throw last ?? new Error('no vehicles');
}

try {
  // 1. wrong password → clear error, no retry storm
  const wrong = new FleetGoDashboard({ ...base, username: 'dispo@example.de', password: 'nope' }, quiet);
  try {
    await wrong.ensureSession();
    check(false, 'wrong password is rejected');
  } catch (e) {
    check(e instanceof FleetGoLoginError && e.kind === 'credentials' && /Invalid username or password/.test(e.message), 'wrong password is rejected', e.message);
    const again = await wrong.ensureSession().then(() => 'signed in', (e2) => e2.message);
    check(/next sign-in attempt/.test(again) && mock.stats.failedLogins === 1, 'no new attempt right away (protects the FleetGO user from a lockout)');
  }
  await wrong.close();

  // 2. sign in, find the vehicles among other data
  const dash = new FleetGoDashboard({ ...base, username: 'dispo@example.de', password: 'right-password' }, quiet);
  const vehicles = await waitForFleet(dash);
  const st = dash.status();
  check(vehicles.length === 3, 'signs in and finds the vehicles', `${vehicles.length} vehicles from ${st.source}`);
  check(vehicles.map((v) => v.plate).join(',') === 'MTK-DT 101,MTK-DT 102,MTK-DT 103', 'plates', vehicles.map((v) => v.plate).join(', '));
  const v1 = vehicles[0];
  check(Math.abs(v1.lat - 50.0) < 0.05 && Math.abs(v1.lng - 8.4) < 0.01 && v1.speedKmh === 48 && v1.ignition && !!v1.ts, 'position, speed, ignition, time', JSON.stringify({ lat: v1.lat, lng: v1.lng, speed: v1.speedKmh, ts: v1.ts }));
  check(!st.vehicles.some((v) => /Lager|Kunde/.test(v.plate)), 'places/geofences are not taken for vehicles');
  check(st.observed.some((o) => /UserViewSettings_Get/.test(o.url)), 'report lists the other dashboard requests');

  // 3. later polls repeat the vehicle request inside the signed-in page (cookie + anti-forgery header)
  const q0 = mock.stats.vehicleQueries;
  await sleep(2_200);
  const later = await dash.fleet();
  check(mock.stats.vehicleQueries > q0 && later[0].lat > v1.lat, 'next poll fetches fresh positions', `query #${mock.stats.vehicleQueries}, lat ${v1.lat.toFixed(4)} → ${later[0].lat.toFixed(4)}`);

  // 4. session expires → signs in again by itself
  const loginsBefore = mock.stats.logins;
  mock.expireSessions();
  await sleep(2_200);
  const afterExpiry = await waitForFleet(dash, 40_000);
  check(afterExpiry.length === 3 && mock.stats.logins === loginsBefore + 1, 'signs in again after the session expired', `${mock.stats.logins - loginsBefore} new sign-in`);

  // 5. nothing secret in the report
  const report = JSON.stringify(dash.status());
  check(!report.includes('right-password') && !/sid=|requestverificationtoken"?:\s*"[0-9a-f]{16}/i.test(report), 'report contains no password, cookie or token');
  await dash.close();

  // 6. optional: the real FleetGO sign-in page still has the fields we fill in (no sign-in attempt)
  if (process.argv.includes('--real')) {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, executablePath: browserPath || undefined, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto('https://app.fleetgo.com', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const host = new URL(page.url()).host;
    const fields = await Promise.all(['#username', '#password', '#kc-login'].map((s) => page.locator(s).isVisible()));
    check(host === 'login.fleetgo.com' && fields.every(Boolean), 'real FleetGO sign-in page has #username, #password, #kc-login', `${host} ${fields}`);
    await browser.close();
  }
} catch (e) {
  check(false, 'unexpected error', e instanceof Error ? e.stack : String(e));
} finally {
  await mock.close();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
