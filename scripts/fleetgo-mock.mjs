// A stand-in for FleetGO, built like the real one: dashboard on one host, Keycloak sign-in on
// another (form_post back to /kcoidc/signin-oidc), a generic POST "query" endpoint guarded by a
// session cookie and an anti-forgery header, places mixed in with vehicles, expiring sessions.
// Like DTE's account it opens on the trips page ("Fahrten Übersicht"); the vehicle positions are only
// loaded on "Karte". Menu links carry ?accountId=…, like FleetGO's.
import { randomBytes } from 'node:crypto';
import express from 'express';

// mapMode: 'query' – "Karte" asks for the vehicles with a POST query (repeatable);
//          'stream' – like DTE's real FleetGO: a live stream (server-sent events, read with fetch and a bearer
//                     token) sends the vehicle list once and then partial updates; a second stream sends signals;
//          'unreadable' – a format TrackLiv does not understand (to try out the report).
export async function startFleetGoMock({ username = 'dispo@example.de', password = 'right-password', appPort = 0, loginPort = 0, mapMode = 'query' } = {}) {
  const sessions = new Set();
  const codes = new Set();
  const antiForgery = randomBytes(8).toString('hex');
  let tick = 0;
  const stats = { logins: 0, failedLogins: 0, vehicleQueries: 0, logouts: 0, tripQueries: 0, streams: 0 };
  const streamClients = new Set();

  const app = express();
  const login = express();
  app.use(express.urlencoded({ extended: false }), express.json());
  login.use(express.urlencoded({ extended: false }));
  const appServer = await new Promise((r) => { const s = app.listen(appPort, '127.0.0.1', () => r(s)); });
  const loginServer = await new Promise((r) => { const s = login.listen(loginPort, '127.0.0.1', () => r(s)); });
  const appUrl = `http://127.0.0.1:${appServer.address().port}`;
  const loginUrl = `http://localhost:${loginServer.address().port}`; // different host, like login.fleetgo.com
  const sid = (req) => /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  const authed = (req) => sessions.has(sid(req));

  // ---- dashboard (app.fleetgo.com) ----
  const acc = '?accountId=3500000001';
  const menu = `<nav><ul>
  <li><a href="/Trip_Index/View/Trip_Index">Produktion</a></li>
  <li><a href="/Trip_Index/View/Trip_Index${acc}">Fahrten</a></li>
  <li><a href="/Location_Index/View/Location_Index${acc}">Standorte</a></li>
  <li><a href="/Map_Index/View/Map_Index${acc}">Karte</a></li>
  <li><a href="/Administrations/View/Administration_Index${acc}">Fahrzeuge</a></li>
  <li><a href="/Users/View/DefaultUser_Index${acc}">Benutzer</a></li>
  <li class="group">Berichte</li>
  <li><a href="/Vehicle_PeriodeKmReport/View/Vehicle_PeriodeKmReport${acc}">Letzte Fahrzeugdaten</a></li>
  <li><a href="/Account/LogOff">Abmelden</a></li>
</ul></nav>`;
  const view = (title, script) => `<!doctype html><title>FleetGO® - ${title}</title>${menu}<div id="main">${title}</div>
<script>
  const token = '${antiForgery}';
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requestverificationtoken': token }, body: JSON.stringify(body) });
  fetch('/api/UserViewSettings_Get');
  fetch('/api/notification');
  ${script}
</script>`;
  const authedPage = (handler) => (req, res) => (authed(req) ? res.type('html').send(handler()) : res.redirect('/LogOn'));
  app.get('/', (req, res) => (authed(req) ? res.redirect('/Trip_Index/View/Trip_Index') : res.redirect('/LogOn')));
  app.get('/Trip_Index/View/Trip_Index', authedPage(() => view('Fahrten Übersicht', `post('/api/trips/view/query', { page: 1 });`)));
  app.get('/Location_Index/View/Location_Index', authedPage(() => view('Standorte', `post('/api/query', { kind: 'places' });`)));
  const streamScript = `
  fetch('/api/signal/get').then(() => {
    // like fetch-event-source: fetch with a bearer token, read the body as it arrives
    fetch('/api/equipment/SubscribeAdministrations/', { headers: { Authorization: 'Bearer ' + token, Accept: 'text/event-stream' } })
      .then(async (r) => { const rd = r.body.getReader(); for (;;) { const { done } = await rd.read(); if (done) break; } });
    new EventSource('/api/signal/subscribe/');
  });`;
  app.get('/Map_Index/View/Map_Index', authedPage(() => view('Karte', mapMode === 'stream' ? streamScript : `post('/api/query', { kind: 'places' }).then(() => post('/api/query', { kind: 'vehicles', groupId: 0 }));`)));
  app.get('/api/signal/get', (req, res) => (authed(req) ? res.json([{ Id: 1, Name: 'Ignition' }, { Id: 2, Name: 'Speed' }]) : res.status(401).json({})));
  const sse = (req, res, first, every) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': hello\n\n');
    first(res);
    const t = setInterval(() => every(res), 700);
    streamClients.add(res);
    req.on('close', () => { clearInterval(t); streamClients.delete(res); });
  };
  app.get('/api/equipment/SubscribeAdministrations/', (req, res) => {
    if (!authed(req) || req.headers.authorization !== `Bearer ${antiForgery}`) return res.status(401).json({});
    stats.streams++;
    let n = 0;
    sse(req, res,
      (r) => r.write(`event: administrations\ndata: ${JSON.stringify({ Administrations: [101, 102, 103].map((Id, i) => ({ Id, LicensePlate: `MTK-DT ${Id}`, Description: ['Sprinter 1', 'Crafter 2', 'Atego 3'][i], Latitude: 50.0 + i * 0.01, Longitude: 8.4 + i * 0.01, Speed: 0, Direction: 0, Ignition: false, DateTime: new Date().toISOString() })) })}\n\n`),
      // only what changed, no plate; split over two chunks like a real network
      (r) => { n++; const msg = `event: position\ndata: ${JSON.stringify({ Id: 101, Latitude: 50.0 + n * 0.001, Longitude: 8.4, Speed: 48, Direction: 90, Ignition: true, DateTime: new Date().toISOString() })}\n\n`; r.write(msg.slice(0, 20)); setTimeout(() => r.write(msg.slice(20)), 50); },
    );
  });
  app.get('/api/signal/subscribe/', (req, res) => {
    if (!authed(req)) return res.status(401).json({});
    sse(req, res, () => {}, (r) => r.write(`data: ${JSON.stringify({ EquipmentId: 102, SignalId: 2, Value: 0 })}\n\n`));
  });
  app.get('/Administrations/View/Administration_Index', authedPage(() => view('Fahrzeuge', `post('/api/query', { kind: 'admin' });`)));
  for (const p of ['/Users/View/DefaultUser_Index', '/Vehicle_PeriodeKmReport/View/Vehicle_PeriodeKmReport']) app.get(p, authedPage(() => view('Seite', '')));
  app.get('/Account/LogOff', (req, res) => {
    stats.logouts++;
    sessions.delete(sid(req));
    res.redirect('/LogOn');
  });
  app.post('/api/trips/view/query', (req, res) => {
    if (!authed(req)) return res.status(401).json({});
    stats.tripQueries++;
    const trip = (i) => ({ id: i, start: { address: 'Hafenstraße 18, Flörsheim', latitude: 50.0, longitude: 8.43, date: '2026-10-08T06:45:00' }, end: { address: 'Hanauer Landstraße 1, Frankfurt', latitude: 50.11, longitude: 8.7, date: '2026-10-08T07:09:00' }, distance: 32.4, duration: 1440, equipment: { id: 101, name: 'MTK-DT 101' } });
    res.json({ rootGroup: { groups: [0, 1].map((g) => ({ items: [1, 2, 3].map((i) => trip(g * 10 + i)), summary: { totalDuration: 4320, totalDistance: 97.2, totalItemsCount: 3 }, groupedPropertyName: 'Equipment', groupValue: g })) }, totalItemsCount: 6 });
  });
  app.get('/LogOn', (_req, res) =>
    res.redirect(`${loginUrl}/realms/FleetGO/protocol/openid-connect/auth?client_id=fleetgo-hattem&redirect_uri=${encodeURIComponent(`${appUrl}/kcoidc/signin-oidc`)}&response_mode=form_post&state=st`),
  );
  app.post('/kcoidc/signin-oidc', (req, res) => {
    if (!codes.delete(req.body.code)) return res.status(400).send('bad code');
    const s = randomBytes(12).toString('hex');
    sessions.add(s);
    res.setHeader('Set-Cookie', `sid=${s}; Path=/; HttpOnly`).redirect('/');
  });
  app.get('/api/UserViewSettings_Get', (req, res) => (authed(req) ? res.json({ settings: { language: 'de', mapType: 'roadmap' } }) : res.status(401).json({})));
  app.get('/api/notification', (req, res) => (authed(req) ? res.json({ unread: 0 }) : res.status(401).json({})));
  app.post('/api/query', (req, res) => {
    if (!authed(req)) return res.status(401).json({ message: 'unauthorized' });
    if (req.headers['x-requestverificationtoken'] !== antiForgery) return res.status(400).json({ message: 'anti-forgery' });
    if (req.body.kind === 'admin') {
      // vehicle master data: plates and names, no positions
      return res.json({ data: { items: [101, 102, 103].map((id) => ({ id, licensePlate: `MTK-DT ${id}`, category: 'Transporter', tracker: `T-${id}` })) } });
    }
    if (req.body.kind === 'places') {
      return res.json({ data: { items: [
        { id: 1, name: 'Lager Schieferstein', latitude: 50.01, longitude: 8.42, radius: 150 },
        { id: 2, name: 'Lager Hafenstraße', latitude: 50.0, longitude: 8.43, radius: 120 },
        { id: 3, name: 'Kunde Mainz', latitude: 49.99, longitude: 8.27, radius: 80 },
        { id: 4, name: 'Kunde Wiesbaden', latitude: 50.08, longitude: 8.24, radius: 80 },
      ] } });
    }
    stats.vehicleQueries++;
    tick++;
    // a map format TrackLiv cannot read (for trying out the report)
    if (mapMode === 'unreadable') return res.json({ markers: [101, 102, 103].map((id) => ({ k: `MTK-DT ${id}`, p: '50.0;8.4', s: 0 })) });
    res.json({ success: true, data: { total: 3, items: [101, 102, 103].map((id, i) => ({
      id,
      licensePlate: `MTK-DT ${id}`,
      name: ['Sprinter 1', 'Crafter 2', 'Atego 3'][i],
      driver: null,
      lastPosition: { latitude: 50.0 + i * 0.01 + tick * 0.001, longitude: 8.4 + i * 0.01, timestamp: `/Date(${Date.now()})/`, address: 'Hafenstraße 18, Flörsheim' },
      speed: i === 0 ? 48 : 0,
      heading: 90 * i,
      ignition: i === 0,
    })) } });
  });
  app.post('/__expire', (_req, res) => { sessions.clear(); res.json({ ok: true }); });

  // ---- Keycloak (login.fleetgo.com) ----
  const page = (error) => `<!doctype html><title>Sign in to FleetGO</title>
<form id="kc-form-login" onsubmit="login.disabled = true; return true;" action="/realms/FleetGO/login-actions/authenticate?session_code=abc&amp;client_id=fleetgo-hattem" method="post">
  <label for="username">Email</label><input tabindex="2" id="username" class="pf-c-form-control" name="username" value="" type="text" autofocus autocomplete="username" />
  <label for="password">Password</label><input tabindex="3" id="password" class="pf-c-form-control" name="password" type="password" autocomplete="current-password" />
  ${error ? '<span id="input-error" class="pf-c-form__helper-text pf-m-error required kc-feedback-text" aria-live="polite">Invalid username or password.</span>' : ''}
  <input type="hidden" id="id-hidden-input" name="credentialId" />
  <input tabindex="7" class="pf-c-button pf-m-primary pf-m-block btn-lg" name="login" id="kc-login" type="submit" value="Sign In"/>
</form>`;
  login.get('/realms/FleetGO/protocol/openid-connect/auth', (_req, res) => res.redirect('/realms/FleetGO/login-actions/authenticate?client_id=fleetgo-hattem&tab_id=t1'));
  login.get('/realms/FleetGO/login-actions/authenticate', (_req, res) => res.type('html').send(page(false)));
  login.post('/realms/FleetGO/login-actions/authenticate', (req, res) => {
    if (req.body.username !== username || req.body.password !== password) {
      stats.failedLogins++;
      return res.type('html').send(page(true));
    }
    stats.logins++;
    const code = randomBytes(8).toString('hex');
    codes.add(code);
    res.type('html').send(`<!doctype html><body onload="document.forms[0].submit()"><form method="post" action="${appUrl}/kcoidc/signin-oidc">
<input type="hidden" name="code" value="${code}"/><input type="hidden" name="state" value="st"/><noscript><button>Continue</button></noscript></form></body>`);
  });

  return {
    appUrl,
    loginUrl,
    stats,
    expireSessions: () => sessions.clear(),
    /** end the live streams, like a server restart or a dropped connection */
    dropStreams: () => { for (const r of streamClients) r.destroy(); streamClients.clear(); },
    close: () => {
      for (const r of streamClients) r.destroy();
      appServer.closeAllConnections?.();
      return Promise.all([new Promise((r) => appServer.close(r)), new Promise((r) => loginServer.close(r))]);
    },
  };
}
