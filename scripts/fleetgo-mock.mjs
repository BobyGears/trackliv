// A stand-in for FleetGO, built like the real one: dashboard on one host, Keycloak sign-in on
// another (form_post back to /kcoidc/signin-oidc), a generic POST "query" endpoint guarded by a
// session cookie and an anti-forgery header, places mixed in with vehicles, expiring sessions.
// Like a real account it opens on the trips page ("Fahrten Übersicht"); the vehicle positions are
// only loaded on another page of the menu, which is reached by a click (no link).
import { randomBytes } from 'node:crypto';
import express from 'express';

export async function startFleetGoMock({ username = 'dispo@example.de', password = 'right-password', appPort = 0, loginPort = 0 } = {}) {
  const sessions = new Set();
  const codes = new Set();
  const antiForgery = randomBytes(8).toString('hex');
  let tick = 0;
  const stats = { logins: 0, failedLogins: 0, vehicleQueries: 0, logouts: 0, tripQueries: 0 };

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
  const menu = `<nav><ul>
  <li><a href="/Trip_Index/View/Trip_Index">Fahrten Übersicht</a></li>
  <li><a href="/Report_Index/View/Report_Index">Berichte</a></li>
  <li data-url="/Map_Index/View/Map_Index" onclick="location.href=this.dataset.url">Live-Karte</li>
  <li onclick="location.href='/Fleet_Index/View/Fleet_Index'">Fahrzeuge</li>
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
  app.get('/Report_Index/View/Report_Index', authedPage(() => view('Berichte', '')));
  app.get('/Map_Index/View/Map_Index', authedPage(() => view('Karte', `post('/api/query', { kind: 'places' });`)));
  app.get('/Fleet_Index/View/Fleet_Index', authedPage(() => view('Fahrzeuge', `post('/api/query', { kind: 'places' }).then(() => post('/api/query', { kind: 'vehicles', groupId: 0 }));`)));
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
    close: () => Promise.all([new Promise((r) => appServer.close(r)), new Promise((r) => loginServer.close(r))]),
  };
}
