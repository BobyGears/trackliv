#!/usr/bin/env node
// End-to-end check of the Registra Atlas connection in a real (headless) browser, against a stand-in for Atlas
// (scripts/atlas-mock.mjs): sign-in from Atlas' menu with a one-time ticket, who may and may not get in, and
// Atlas' Inventar on vehicles and projects (put on, leave at the project, back to stock).
//
//   npm run build && node scripts/e2e-atlas.mjs        (add --headed to watch)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startAtlasMock } from './atlas-mock.mjs';

const PORT = 8798;
const BASE = `http://localhost:${PORT}`;
const headed = process.argv.includes('--headed');
const dataDir = mkdtempSync(join(tmpdir(), 'trackliv-e2e-atlas-'));
const ANON = 'konto-anon-key-0123456789abcdef0123';
const KEY = 'ab12'.repeat(16);

if (!existsSync('apps/web/dist/index.html')) {
  console.error('Build the web app first: npm run build');
  process.exit(1);
}

const atlas = await startAtlasMock({ anonKey: ANON, tracklivKey: KEY });
const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    TRACKLIV_DATA_DIR: dataDir,
    NODE_ENV: 'production',
    FLEETGO_CLIENT_ID: '',
    TRACKLIV_USERS: '',
    TRACKLIV_SESSION_SECRET: 'cd'.repeat(32),
    ATLAS_AUTH_URL: atlas.url,
    ATLAS_ANON_KEY: ANON,
    ATLAS_SUPABASE_URL: '',
    ATLAS_PRIMARY: 'an',
    ATLAS_ACCESS: 'admins',
    ATLAS_API_URL: atlas.url,
    ATLAS_TRACKLIV_KEY: KEY,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* gone */
  }
};
process.on('exit', stop);
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` – ${extra}` : ''}`);
  if (!ok) failures++;
};
const uid = (email) => atlas.users.get(email).id;
const item = (id) => atlas.items.find((a) => a.id === id);

try {
  for (let i = 0; ; i++) {
    try {
      if ((await (await fetch(`${BASE}/api/health`)).json()).ok) break;
    } catch {
      /* not up yet */
    }
    if (i > 60) throw new Error(`server did not start:\n${serverLog}`);
    await sleep(500);
  }

  // --- tickets, server side --------------------------------------------------------------------
  const noFollow = (t) => fetch(`${BASE}/api/auth/atlas?ticket=${t}`, { redirect: 'manual' });
  let r = await noFollow(atlas.ticket(uid('buero@dd-gruppe.de')));
  check('a ticket for an account without the TrackLiv permission is refused', r.status === 303 && r.headers.get('location') === '/?anmeldung=kein-zugang' && !r.headers.get('set-cookie'));
  r = await noFollow(atlas.ticket(uid('dispo@dd-gruppe.de'), 61_000));
  check('an expired ticket is refused', r.headers.get('location') === '/?anmeldung=abgelaufen');
  const once = atlas.ticket(uid('dispo@dd-gruppe.de'));
  r = await noFollow(once);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  check('a valid ticket signs in and goes to the app', r.headers.get('location') === '/' && cookie.startsWith('tl_session='));
  r = await noFollow(once);
  check('the same ticket does not work twice', r.headers.get('location') === '/?anmeldung=abgelaufen');
  const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { cookie } })).json();
  check('the session belongs to the person the ticket was for', me.user === 'Dana Dispo', me.user);
  const boot = await (await fetch(`${BASE}/api/bootstrap`, { headers: { cookie } })).json();
  check('bootstrap says Atlas Inventar is connected', boot.inventory?.enabled === true && Array.isArray(boot.inventory.items));
  const avail = await (await fetch(`${BASE}/api/inventory/available`, { headers: { cookie } })).json();
  check('the picker list comes from Atlas for this person (no sales stock)', avail.items?.length === 4 && !avail.items.some((i) => i.stock === 'Verkauf'));

  // --- browser ------------------------------------------------------------------------------
  const browser = await chromium.launch({
    headless: !headed,
    executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  globalThis.__page = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) errors.push(`CSP: ${m.text()}`);
  });

  await page.goto(`${BASE}/api/auth/atlas?ticket=${atlas.ticket(uid('buero@dd-gruppe.de'))}`);
  await page.getByText('Your Atlas account has no access to TrackLiv').waitFor({ timeout: 30000 });
  check('without permission: the sign-in screen says why', new URL(page.url()).search === '', page.url());

  await page.goto(`${BASE}/api/auth/atlas?ticket=${atlas.ticket(uid('dispo@dd-gruppe.de'))}`);
  await page.getByText('Today’s runs').waitFor({ timeout: 30000 });
  check('with permission: the Atlas menu link opens TrackLiv signed in', true);

  // vehicle with a project as today's destination
  const run = boot.plan.assignments.find((a) => a.crew.length && a.destination?.kind === 'project');
  const v = boot.vehicles.find((x) => x.id === run.vehicleId);
  const project = boot.projects.find((p) => p.id === run.destination.projectId);
  const open = async (text) => {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(/Search vehicles, crew, projects/).fill(text);
    await sleep(300);
    await page.keyboard.press('Enter');
  };
  await open(v.callsign);
  const section = page.locator('[data-inventory="vehicle"]');
  await section.waitFor();
  check('the vehicle panel has an equipment section', (await section.innerText()).includes('Nothing from the inventory on board.'));

  await section.locator('[data-inventory-add]').click();
  const picker = section.locator('[data-inventory-picker]');
  await picker.locator('[data-inventory-option="a-ruettler"]').waitFor();
  check('a defective machine cannot be picked', await picker.locator('[data-inventory-option="a-saege"]').isDisabled());
  check('reserved and available machines can be picked', !(await picker.locator('[data-inventory-option="a-bagger"]').isDisabled()) && !(await picker.locator('[data-inventory-option="a-ruettler"]').isDisabled()));
  await picker.getByPlaceholder('Search the Atlas inventory…').fill('rüttel');
  check('the picker search filters', (await picker.locator('[data-inventory-option]').count()) === 1);
  await picker.locator('[data-inventory-option="a-ruettler"]').click();
  await section.locator('[data-inventory-item="a-ruettler"]').waitFor();
  const label = v.plate && v.plate !== v.callsign ? `${v.callsign} · ${v.plate}` : v.callsign;
  check(
    'putting it on the vehicle marks it "In Benutzung" in Atlas, done by the signed-in person',
    item('a-ruettler').status === 'In Benutzung' && item('a-ruettler').use?.kind === 'vehicle' && item('a-ruettler').use.ref === v.id && item('a-ruettler').use.label === label && atlas.state.log.at(-1).actor === uid('dispo@dd-gruppe.de'),
    item('a-ruettler').use?.label,
  );
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  await page.getByTestId(`vehicle-card-${v.callsign}`).locator('[data-inventory-badge]').waitFor();
  check('the dispatch card shows the equipment badge', (await page.getByTestId(`vehicle-card-${v.callsign}`).locator('[data-inventory-badge]').innerText()).trim() === '1');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await open(v.callsign);
  await section.waitFor();

  // rented-out articles stay "Vermietet"-like (status unchanged), and can go on the vehicle as well
  await section.locator('[data-inventory-add]').click();
  await picker.locator('[data-inventory-option="a-geruest"]').click();
  await section.locator('[data-inventory-item="a-geruest"]').waitFor();
  if (process.env.E2E_PANEL_SHOT) {
    await section.locator('[data-inventory-add]').click();
    await picker.locator('[data-inventory-option]').first().waitFor();
    await page.screenshot({ path: process.env.E2E_PANEL_SHOT });
    await picker.getByRole('button', { name: 'Close' }).click();
  }
  check('an article from a rental stock keeps its status', item('a-geruest').status === 'Verfügbar' && !!item('a-geruest').use);

  // leave the machine at the project
  await section.locator('[data-inventory-item="a-ruettler"]').getByRole('button', { name: `Leave at ${project.name}` }).click();
  await section.locator('[data-inventory-item="a-ruettler"]').waitFor({ state: 'detached' });
  check('"leave at the project" moves it in Atlas', item('a-ruettler').use?.kind === 'project' && item('a-ruettler').use.ref === project.id && item('a-ruettler').status === 'In Benutzung');

  const shot = await fetch(`${BASE}/api/inventory`, { headers: { cookie } }).then((x) => x.json());
  check('everyone sees what is out (shared state)', shot.items.length === 2, `${shot.items.length}`);

  // project panel → back to stock
  await open(project.name);
  const psec = page.locator('[data-inventory="project"]');
  await psec.locator('[data-inventory-item="a-ruettler"]').waitFor();
  check('the project panel lists what was left there', true);
  await psec.locator('[data-inventory-item="a-ruettler"]').getByRole('button', { name: 'Back to stock' }).click();
  await psec.locator('[data-inventory-item="a-ruettler"]').waitFor({ state: 'detached' });
  check('"back to stock" makes it available again in Atlas', !item('a-ruettler').use && item('a-ruettler').status === 'Verfügbar');

  const events = await fetch(`${BASE}/api/bootstrap`, { headers: { cookie } }).then((x) => x.json());
  const titles = events.events.map((e) => e.title);
  check('the event log records it', titles.some((x) => x.includes('loaded onto')) && titles.some((x) => x.includes('left at')) && titles.some((x) => x.includes('back to stock')));

  check('no page errors / CSP violations', errors.length === 0, errors.join(' | '));
  await browser.close();
} catch (e) {
  console.error(e);
  failures++;
  if (process.env.E2E_SHOT) await globalThis.__page?.screenshot({ path: process.env.E2E_SHOT }).catch(() => {});
}
stop();
await atlas.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall Atlas checks passed');
process.exit(failures ? 1 : 0);
