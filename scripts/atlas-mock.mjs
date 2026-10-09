// A stand-in for Registra Atlas, for tests: Konto-Dienst sign-in (GoTrue + PostgREST profiles) and Atlas' internal
// TrackLiv routes (one-time tickets, account check, Inventar). Mirrors the rules of Atlas' api/trackliv.mjs and
// api/inventar.js closely enough to exercise TrackLiv's side.
//
//   import { startAtlasMock } from './atlas-mock.mjs';
//   const atlas = await startAtlasMock({ anonKey, tracklivKey });   // atlas.url, atlas.ticket(uid), atlas.state
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export async function startAtlasMock({ anonKey, tracklivKey, port = 0 }) {
  const users = new Map([
    ['chef@dd-gruppe.de', { id: '11111111-1111-4111-8111-111111111111', password: 'chef-pass-123', full_name: 'Bera Chef', is_admin: true, is_active: true, can_trackliv: false }],
    ['dispo@dd-gruppe.de', { id: '22222222-2222-4222-8222-222222222222', password: 'dispo-pass-123', full_name: 'Dana Dispo', is_admin: false, is_active: true, can_trackliv: true }],
    ['buero@dd-gruppe.de', { id: '33333333-3333-4333-8333-333333333333', password: 'buero-pass-123', full_name: 'Bodo Büro', is_admin: false, is_active: true, can_trackliv: false }],
  ]);
  const byId = (id) => [...users.entries()].map(([email, u]) => ({ email, ...u })).find((u) => u.id === id) ?? null;
  const darf = (u) => !!u && u.is_active && (u.is_admin || u.can_trackliv);
  const ausgabe = (u) => ({ id: u.id, email: u.email, full_name: u.full_name, is_admin: u.is_admin, is_active: u.is_active, can_trackliv: u.can_trackliv });

  const stocks = [
    { id: 'b-geraete', name: 'Geräte Flörsheim', art: 'bestand', frei: 'Verfügbar' },
    { id: 'b-miete', name: 'Mietpark', art: 'vermietung', frei: 'Verfügbar' },
    { id: 'b-verkauf', name: 'Verkauf', art: 'verkauf', frei: 'Auf Lager' },
  ];
  const items = [
    { id: 'a-ruettler', stockId: 'b-geraete', name: 'Rüttelplatte Wacker DPU 6555', number: 'INV-0042', status: 'Verfügbar' },
    { id: 'a-bagger', stockId: 'b-geraete', name: 'Minibagger Kubota KX019', number: 'INV-0007', status: 'Reserviert' },
    { id: 'a-saege', stockId: 'b-geraete', name: 'Betonsäge Husqvarna', number: 'INV-0051', status: 'Defekt' },
    { id: 'a-geruest', stockId: 'b-miete', name: 'Rollgerüst 6 m', status: 'Verfügbar' },
    { id: 'a-verkauf', stockId: 'b-verkauf', name: 'Kabeltrommel 50 m', status: 'Auf Lager' },
  ].map((a) => ({ ...a, use: null, before: null }));
  const stock = (a) => stocks.find((b) => b.id === a.stockId);
  const available = (a) => {
    const b = stock(a);
    if (!b || b.art === 'verkauf' || a.use) return false;
    const e = a.status.toLowerCase();
    return e === b.frei.toLowerCase() || e === 'reserviert';
  };
  const out = (a) => ({ id: a.id, stockId: a.stockId, stock: stock(a).name, name: a.name, number: a.number, status: a.status, available: available(a), use: a.use });

  const state = { users, items, tickets: new Map(), calls: [], access: new Map(), log: [] };
  let n = 0;

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      state.calls.push(`${req.method} ${url.pathname}${url.search}`);
      const send = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data ?? {}));
      };
      let json = {};
      try {
        json = body ? JSON.parse(body) : {};
      } catch {
        return send(400, { error: 'bad json' });
      }

      // --- Atlas' internal TrackLiv routes (shared key) ---
      if (url.pathname.startsWith('/api/trackliv/intern/')) {
        if (req.headers['x-trackliv-key'] !== tracklivKey) return send(403, { error: 'kein Zutritt' });
        const rest = url.pathname.slice('/api/trackliv/intern/'.length);
        if (rest === 'anmeldung' && req.method === 'POST') {
          const t = state.tickets.get(String(json.ticket ?? ''));
          if (!t || t.used || t.expires < Date.now()) return send(410, { error: 'Anmeldelink abgelaufen oder schon benutzt' });
          t.used = true;
          const u = byId(t.uid);
          if (!u) return send(404, { error: 'Konto nicht gefunden' });
          if (!darf(u)) return send(403, { error: 'Keine Freigabe für TrackLiv' });
          return send(200, { user: ausgabe(u) });
        }
        let m = rest.match(/^benutzer\/([^/]+)$/);
        if (m && req.method === 'GET') {
          const u = byId(decodeURIComponent(m[1]));
          return u ? send(200, { user: ausgabe(u) }) : send(404, { error: 'Konto nicht gefunden' });
        }
        if (rest === 'inventar' && req.method === 'GET') {
          if (url.searchParams.get('nur') === 'einsatz') return send(200, { artikel: items.filter((a) => a.use).map(out) });
          const u = byId(url.searchParams.get('benutzer') ?? '');
          if (!darf(u)) return send(403, { error: 'Keine Freigabe für TrackLiv' });
          return send(200, { artikel: items.filter((a) => stock(a).art !== 'verkauf').map(out) });
        }
        m = rest.match(/^inventar\/([^/]+)\/einsatz$/);
        if (m && req.method === 'POST') {
          const u = byId(String(json.actor?.id ?? ''));
          if (!darf(u)) return send(403, { error: 'Keine Freigabe für TrackLiv' });
          const a = items.find((x) => x.id === decodeURIComponent(m[1]));
          if (!a) return send(404, { error: 'Artikel nicht gefunden' });
          if (json.use) {
            const { kind, ref, label } = json.use;
            if (!['vehicle', 'project'].includes(kind) || !ref || !label) return send(400, { error: 'Ziel unbrauchbar' });
            if (!a.use && !available(a)) return send(409, { error: `„${a.name}" ist gerade „${a.status}" und lässt sich nicht einsetzen.` });
            if (!a.use) a.before = a.status;
            a.use = { kind, ref, label, since: new Date().toISOString(), by: u.full_name };
            if (stock(a).art !== 'vermietung') a.status = 'In Benutzung';
            state.log.push({ action: 'einsatz', id: a.id, kind, ref, label, actor: u.id });
          } else {
            if (!a.use) return send(409, { error: 'Der Artikel ist nicht über TrackLiv in Benutzung.' });
            a.use = null;
            if (a.status === 'In Benutzung') a.status = a.before ?? stock(a).frei;
            state.log.push({ action: 'zurueck', id: a.id, actor: u.id });
          }
          return send(200, { artikel: out(a) });
        }
        return send(404, { error: 'unbekannt' });
      }

      // --- test helpers ---
      if (url.pathname === '/__ticket' && req.method === 'POST') return send(200, { ticket: issue(String(json.uid ?? ''), json.ageMs ?? 0) });

      // --- Konto-Dienst (GoTrue + PostgREST) ---
      if (req.headers.apikey !== anonKey) return send(401, { error_code: 'no_api_key' });
      const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (url.pathname === '/auth/v1/health') return send(200, { ok: true });
      if (url.pathname === '/auth/v1/token') {
        const grant = url.searchParams.get('grant_type');
        let u = null;
        if (grant === 'password') {
          const found = users.get(String(json.email ?? ''));
          if (!found || found.password !== json.password) return send(400, { error_code: 'invalid_credentials' });
          u = byId(found.id);
        } else if (grant === 'refresh_token') {
          const uid = String(json.refresh_token ?? '').split('~')[1];
          u = uid ? byId(uid) : null;
          if (!u) return send(400, { error_code: 'refresh_token_not_found' });
        }
        if (!u) return send(400, {});
        const access = `at~${u.id}~${++n}`;
        state.access.set(access, u.id);
        return send(200, { access_token: access, refresh_token: `rt~${u.id}~${n}`, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: u.id, email: u.email } });
      }
      if (url.pathname === '/rest/v1/profiles') {
        const uid = state.access.get(bearer);
        if (!uid) return send(401, { message: 'JWT expired' });
        const u = byId(uid);
        const want = url.searchParams.get('id')?.replace(/^eq\./, '');
        return send(200, u && want === uid ? [ausgabe(u)] : []);
      }
      if (url.pathname === '/auth/v1/logout') return send(204, {});
      send(404, {});
    });
  });

  /** What Atlas' POST /api/trackliv/anmeldelink does: a one-time ticket for this account (60 s). */
  function issue(uid, ageMs = 0) {
    const ticket = randomBytes(32).toString('base64url');
    state.tickets.set(ticket, { uid, expires: Date.now() + 60_000 - ageMs, used: false });
    return ticket;
  }

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, server, state, users, items, ticket: issue, close: () => new Promise((r) => server.close(r)) };
}
