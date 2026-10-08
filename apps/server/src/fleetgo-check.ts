// Signs in to the FleetGO dashboard once and reports what TrackLiv sees – without printing secrets.
//   ./deploy.sh --fleetgo-check        (on the server, uses /opt/trackliv/.env)
//   npm run fleetgo-check              (locally, uses .env)
import { config } from './config.ts';
import { FleetGoDashboard } from './fleetgoDashboard.ts';
import { maskUser } from './fleetgoExtract.ts';

const cfg = config.fleetgo;
const waitSeconds = Number(process.argv[2] ?? 75);

console.log(`TrackLiv · FleetGO check`);
console.log(`  dashboard: ${cfg.dashboardUrl}${cfg.dashboardPage ? ` (then ${cfg.dashboardPage})` : ''}`);
console.log(`  user:      ${cfg.username ? maskUser(cfg.username) : '(FLEETGO_USERNAME missing)'}`);
console.log(`  password:  ${cfg.password ? 'set' : '(FLEETGO_PASSWORD missing)'}`);
if (cfg.mode === 'api') console.log('  note: FLEETGO_CLIENT_ID/SECRET are set, so the server uses the official API instead of the dashboard');
console.log('');

const dash = new FleetGoDashboard({ ...cfg, pollSeconds: 10 }, (m) => console.log(`  … ${m}`));
let code = 0;
try {
  await dash.ensureSession();
  console.log(`  ✔ signed in – page "${await dash.pageTitle()}"`);
  const until = Date.now() + waitSeconds * 1000;
  while (Date.now() < until) {
    try {
      const vehicles = await dash.fleet();
      if (vehicles.length && Date.now() - dash.lastData < 15_000) break;
    } catch {
      /* still waiting for data */
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  const st = dash.status();
  console.log('');
  console.log(`Requests with data the dashboard made (best vehicle candidates first):`);
  for (const o of st.observed.slice(0, 25)) {
    const tag = o.vehicles && o.score ? `${o.vehicles} vehicle(s), score ${o.score}` : '–';
    console.log(`  ${String(o.status).padEnd(4)}${o.method.padEnd(5)}${o.url}`);
    console.log(`        ${tag} · ${o.status === 200 && o.detail.length > 2 ? o.detail : o.shape}`);
  }
  if (!st.observed.length) console.log('  (none – the dashboard did not request any data)');
  if (st.tried.length) {
    console.log('');
    console.log('Menu entries opened while looking for the vehicle positions:');
    for (const t of st.tried) console.log(`  ${t.found > 0 ? `✔ ${t.found} vehicles` : t.found < 0 ? '✗ could not open' : '– nothing'}  ${t.entry}`);
  }
  if (st.menu.length && !st.vehicles.length) {
    console.log('');
    console.log('FleetGO menu (pages TrackLiv can open):');
    for (const m of st.menu.slice(0, 40)) console.log(`  ${(m.text || '(no text)').padEnd(34)} ${m.path || '(click)'}`);
  }
  console.log('');
  if (st.vehicles.length) {
    console.log(`  ✔ ${st.vehicles.length} vehicles from ${st.source}`);
    if (st.vehiclePage) console.log(`    on the page ${st.vehiclePage} (remembered for next time)`);
    for (const v of st.vehicles.slice(0, 10)) {
      const pos = v.lat !== null && v.lng !== null ? `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}` : 'no position';
      console.log(`     ${v.plate.padEnd(16)} ${pos.padEnd(20)} ${v.ts ?? ''} ${v.speedKmh ? `${Math.round(v.speedKmh)} km/h` : ''}`);
    }
    if (st.vehicles.length > 10) console.log(`     … and ${st.vehicles.length - 10} more`);
  } else {
    code = 2;
    console.log(`  ✗ Signed in, but no vehicle list found yet (page: ${st.page}).`);
    console.log(`    Send this output to the developer – it contains no passwords or tokens.`);
    console.log(`    If you know the page with the live map, set FLEETGO_DASHBOARD_PAGE (a path from the menu above) in .env and run the check again.`);
  }
} catch (err) {
  code = 1;
  console.log(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await dash.close();
}
process.exit(code);
