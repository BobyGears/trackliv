#!/usr/bin/env node
// End-to-end check of the main dispatcher workflows in a real (headless) browser.
// Starts its own server on a throw-away data dir, serving the production build.
//
//   npm run build && node scripts/e2e.mjs        (add --headed to watch, --keep to keep the server running)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 8799;
const BASE = `http://localhost:${PORT}`;
const headed = process.argv.includes('--headed');
const dataDir = mkdtempSync(join(tmpdir(), 'trackliv-e2e-'));

if (!existsSync('apps/web/dist/index.html')) {
  console.error('Build the web app first: npm run build');
  process.exit(1);
}

const server = spawn('npx', ['tsx', 'apps/server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), TRACKLIV_DATA_DIR: dataDir, NODE_ENV: 'production', FLEETGO_CLIENT_ID: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

// Retry once: the server may close an idle keep-alive socket just as it is reused.
const api = async (path, init) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${BASE}${path}`, init);
      return await r.json();
    } catch (e) {
      if (i >= 2) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` – ${extra}` : ''}`);
  if (!ok) failures++;
};

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const h = await api('/api/health');
      if (h.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`server did not start:\n${serverLog}`);
}

async function drag(page, from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 12, a.y + a.height / 2 + ((b.y + b.height / 3 - a.y - a.height / 2) * i) / 12);
    await sleep(16);
  }
  await page.mouse.up();
}

try {
  await waitForServer();
  const boot = await api('/api/bootstrap');
  const [y, m, d] = boot.today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const person = (id) => boot.people.find((p) => p.id === id);
  const vehicle = (cs) => boot.vehicles.find((v) => v.callsign === cs);

  const browser = await chromium.launch({
    headless: !headed,
    executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.getByText('Today’s runs').waitFor({ timeout: 30000 });
  check('app loads with the map overview', true);

  // --- Dispatch: plan tomorrow ---------------------------------------------------------------
  await page.keyboard.press('2');
  await page.getByText('Dispatch board').waitFor();
  await page.getByRole('button', { name: 'Plan tomorrow' }).click();
  await page.getByText('Tomorrow ·').waitFor();
  check('switch to tomorrow’s plan', true);

  // Drag a person onto T-02
  const p1 = boot.people.find((p) => p.licenses.includes('B') && p.status === 'available');
  await drag(page, page.getByTestId(`drag-${p1.id}`), page.getByTestId('vehicle-card-T-02'));
  await sleep(800);
  let plan = await api(`/api/plans/${tomorrow}`);
  const t02 = vehicle('T-02');
  check('drag & drop assigns a person to a vehicle', plan.assignments.find((a) => a.vehicleId === t02.id)?.crew.includes(p1.id), `${p1.firstName} → T-02`);

  // Destination picker → project list
  await page.getByTestId('dest-T-02').click();
  await page.getByPlaceholder(/Search projects/).fill('Eschborn');
  await page.keyboard.press('Enter');
  await sleep(800);
  plan = await api(`/api/plans/${tomorrow}`);
  const eschborn = boot.projects.find((p) => p.name.includes('Eschborn'));
  check('destination picker sets a project', plan.assignments.find((a) => a.vehicleId === t02.id)?.destination?.projectId === eschborn.id);

  // Custom destination (label)
  await page.getByTestId('dest-T-02').click();
  await page.getByPlaceholder(/Search projects/).fill('Lager Rüsselsheim Notfall');
  await page.getByText('Use “Lager Rüsselsheim Notfall”').click();
  await sleep(800);
  plan = await api(`/api/plans/${tomorrow}`);
  const dest = plan.assignments.find((a) => a.vehicleId === t02.id)?.destination;
  check('custom destination can be entered', dest?.kind === 'custom' && dest.label === 'Lager Rüsselsheim Notfall');

  // Send a group to a task & pin
  const group = boot.people.filter((p) => p.status === 'available' && p.id !== p1.id && p.homeSiteId === 'hq-hafen').slice(0, 3);
  for (const p of group) await page.getByTestId(`roster-${p.id}`).locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Send to a task & pin' }).click();
  await page.getByTestId('group-dest').click();
  await page.getByPlaceholder(/Search projects/).fill('Gallus');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Assign & pin' }).click();
  await sleep(900);
  plan = await api(`/api/plans/${tomorrow}`);
  const gallus = boot.projects.find((p) => p.name.includes('Gallus'));
  const pinned = plan.assignments.find((a) => group.every((p) => a.crew.includes(p.id)));
  check(
    '“send to a task & pin” puts the group on one vehicle, pinned',
    !!pinned && group.every((p) => pinned.lockedCrew.includes(p.id)) && pinned.destinationLocked && pinned.destination?.projectId === gallus.id,
    pinned ? boot.vehicles.find((v) => v.id === pinned.vehicleId).callsign : 'not found',
  );

  // Randomize everyone else, apply
  await page.getByRole('button', { name: 'Randomize' }).click();
  await page.getByText('Randomize scenario').waitFor();
  await page.getByRole('button', { name: 'Apply scenario' }).click();
  await sleep(1000);
  plan = await api(`/api/plans/${tomorrow}`);
  const staffed = plan.assignments.filter((a) => a.crew.length);
  const assigned = new Set(plan.assignments.flatMap((a) => a.crew));
  const available = boot.people.filter((p) => p.status === 'available');
  const stillPinned = plan.assignments.find((a) => a.vehicleId === pinned?.vehicleId);
  check('randomize assigns every available person', available.every((p) => assigned.has(p.id)), `${assigned.size}/${available.length} on ${staffed.length} vehicles`);
  check('randomize keeps the pinned group and its destination', !!stillPinned && group.every((p) => stillPinned.crew.includes(p.id)) && stillPinned.destination?.projectId === gallus.id);
  check('every staffed vehicle has 1–4 people and a destination', staffed.every((a) => a.crew.length >= 1 && a.crew.length <= 4 && a.destination));
  const nobodyOff = boot.people.filter((p) => p.status !== 'available').every((p) => !assigned.has(p.id));
  check('sick / vacation / training people are not assigned', nobodyOff);

  // Undo
  const revBefore = plan.revision;
  await page.keyboard.press('Control+z');
  await sleep(900);
  plan = await api(`/api/plans/${tomorrow}`);
  check('undo reverts the randomized plan', plan.revision > revBefore && plan.assignments.filter((a) => a.crew.length).length < staffed.length);
  await page.keyboard.press('Control+Shift+z');
  await sleep(900);

  // --- Schedule: drag a bar ------------------------------------------------------------------
  await page.keyboard.press('3');
  const bar = page.locator('[data-testid^="bar-"]').first();
  await bar.waitFor();
  const barId = (await bar.getAttribute('data-testid')).replace('bar-', '');
  const beforeDep = plan.assignments.find((a) => a.vehicleId === vehicle(barId).id)?.departAt;
  plan = await api(`/api/plans/${tomorrow}`);
  const dep0 = plan.assignments.find((a) => a.vehicleId === vehicle(barId).id)?.departAt;
  const box = await bar.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await sleep(900);
  plan = await api(`/api/plans/${tomorrow}`);
  const dep1 = plan.assignments.find((a) => a.vehicleId === vehicle(barId).id)?.departAt;
  check('dragging a schedule bar reschedules the run', !!dep0 && dep1 !== dep0, `${barId} ${dep0} → ${dep1} (was ${beforeDep})`);

  // --- Data: create a project with a map pin --------------------------------------------------
  await page.keyboard.press('4');
  await page.getByText('Master data').waitFor();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByPlaceholder('e.g. Wohnanlage Musterstraße').fill('E2E Testbaustelle');
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await page.getByText('Click on the map to place').waitFor();
  await page.mouse.click(800, 600);
  await page.getByText('Location set').waitFor();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await sleep(800);
  const projects = await api('/api/projects');
  const created = projects.find((p) => p.name === 'E2E Testbaustelle');
  check('a new project can be created and placed on the map', !!created && Number.isFinite(created.location.lat));

  // --- Map: select a project from its marker --------------------------------------------------
  await page.keyboard.press('1');
  await page.locator('.tl-project', { hasText: 'Gewerbepark Eschborn' }).first().click();
  await page.getByText('Crew today', { exact: true }).waitFor({ timeout: 5000 });
  check('clicking a project marker opens its object panel', true);

  // --- Command palette --------------------------------------------------------------------------
  await page.keyboard.press('Control+k');
  await page.keyboard.type('T-03');
  await page.keyboard.press('Enter');
  await page.getByText('Run tracking').or(page.getByText('Today’s runs')).first().waitFor();
  check('command palette finds and selects a vehicle', await page.getByText('Telemetry').isVisible());

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  if (!process.argv.includes('--keep')) await browser.close();
} catch (e) {
  failures++;
  console.error('✗ e2e aborted:', e.message);
  console.error('--- server log (tail) ---\n' + serverLog.split('\n').slice(-25).join('\n'));
} finally {
  if (!process.argv.includes('--keep')) {
    server.kill('SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
  }
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
