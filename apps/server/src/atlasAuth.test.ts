import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AtlasSessions, RECHECK_MS, accessVerdict, atlasConfig, atlasLogin, parseAccess, type AtlasConfig } from './atlasAuth.ts';

/** A stand-in for Atlas' Konto-Dienst / Supabase: GoTrue token + logout, PostgREST profiles. */
function fakeAtlas(key: string) {
  const users = new Map([
    ['chef@dd-gruppe.de', { id: 'u-admin', password: 'richtig-123', profile: { full_name: 'Bera Chef', is_admin: true, is_active: true } }],
    ['dispo@dd-gruppe.de', { id: 'u-dispo', password: 'dispo-pass-1', profile: { full_name: 'Dana Dispo', is_admin: false, is_active: true } }],
  ]);
  const state = {
    down: false,
    calls: [] as string[],
    forwardedFor: [] as string[],
    logouts: [] as string[],
    access: new Map<string, string>(), // access token → uid
    refresh: new Map<string, string>(), // refresh token → uid (rotated on use)
  };
  let n = 0;
  const tokensFor = (uid: string, email: string) => {
    const access = `at-${uid}-${++n}`;
    const refresh = `rt-${uid}-${n}`;
    state.access.set(access, uid);
    state.refresh.set(refresh, uid);
    return { access_token: access, refresh_token: refresh, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email } };
  };
  const byId = (uid: string) => [...users.entries()].find(([, u]) => u.id === uid);
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      state.calls.push(`${req.method} ${req.url}`);
      if (req.headers['x-forwarded-for']) state.forwardedFor.push(String(req.headers['x-forwarded-for']));
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (state.down) return send(503, { message: 'down' });
      if (req.headers.apikey !== key) return send(401, { error_code: 'no_api_key' });
      const url = new URL(req.url ?? '/', 'http://x');
      const json = body ? JSON.parse(body) : {};
      const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (url.pathname === '/auth/v1/health') return send(200, { ok: true });
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        const u = users.get(json.email);
        if (!u || u.password !== json.password) return send(400, { error_code: 'invalid_credentials' });
        return send(200, tokensFor(u.id, json.email));
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        const uid = state.refresh.get(json.refresh_token);
        if (!uid) return send(400, { error_code: 'refresh_token_not_found' });
        state.refresh.delete(json.refresh_token);
        return send(200, tokensFor(uid, byId(uid)![0]));
      }
      if (url.pathname === '/rest/v1/profiles') {
        const uid = state.access.get(bearer);
        if (!uid) return send(401, { message: 'JWT expired' });
        const want = url.searchParams.get('id')?.replace(/^eq\./, '');
        const u = byId(uid);
        return send(200, want === uid && u ? [{ id: uid, email: u[0], ...u[1].profile }] : []);
      }
      if (url.pathname === '/auth/v1/logout') {
        state.logouts.push(`${state.access.get(bearer)}:${url.searchParams.get('scope')}`);
        return send(204, {});
      }
      send(404, {});
    });
  });
  return { server, state, users };
}

async function listen(s: Server) {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

describe('Registra Atlas sign-in', () => {
  const konto = fakeAtlas('konto-anon-key-0123456789abcdef0123');
  const supa = fakeAtlas('supabase-anon-key-0123456789abcdef');
  let cfg: AtlasConfig;
  let dir: string;

  beforeAll(async () => {
    const [ku, su] = [await listen(konto.server), await listen(supa.server)];
    cfg = atlasConfig({
      ATLAS_AUTH_URL: ku,
      ATLAS_ANON_KEY: 'konto-anon-key-0123456789abcdef0123',
      ATLAS_SUPABASE_URL: su,
      ATLAS_SUPABASE_ANON_KEY: 'supabase-anon-key-0123456789abcdef',
      ATLAS_PRIMARY: 'an',
      ATLAS_ACCESS: 'admins',
      ATLAS_TIMEOUT_MS: '2000',
    })!;
    dir = mkdtempSync(join(tmpdir(), 'tl-atlas-'));
  });
  afterAll(() => {
    konto.server.close();
    supa.server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    for (const f of [konto, supa]) {
      f.state.down = false;
      f.state.calls.length = 0;
      f.state.logouts.length = 0;
      f.state.forwardedFor.length = 0;
    }
    konto.users.get('dispo@dd-gruppe.de')!.profile.is_active = true;
  });

  it('reads the configuration like Atlas does', () => {
    expect(atlasConfig({})).toBeNull();
    const both = { ATLAS_AUTH_URL: 'http://k:8100/', ATLAS_ANON_KEY: 'a', ATLAS_SUPABASE_URL: 'https://x.supabase.co', ATLAS_SUPABASE_ANON_KEY: 'b' };
    expect(atlasConfig({ ...both, ATLAS_PRIMARY: 'an' })!.providers.map((p) => p.name)).toEqual(['konto', 'supabase']);
    expect(atlasConfig({ ...both, ATLAS_PRIMARY: 'aus' })!.providers.map((p) => p.name)).toEqual(['supabase']);
    expect(atlasConfig({ ...both, ATLAS_PRIMARY: '"an"' })!.providers[0].url).toBe('http://k:8100');
    expect(parseAccess(undefined)).toEqual({ all: false, emails: new Set() });
    expect(parseAccess('all').all).toBe(true);
    expect([...parseAccess('A@dd-gruppe.de, b@dd-gruppe.de').emails]).toEqual(['a@dd-gruppe.de', 'b@dd-gruppe.de']);
  });

  it('signs in at the Konto-Dienst with the Atlas name, passing the client IP on', async () => {
    const r = await atlasLogin(cfg, 'chef@dd-gruppe.de', 'richtig-123', '203.0.113.7');
    expect(r.ok && r.identity).toEqual({ provider: 'konto', uid: 'u-admin', email: 'chef@dd-gruppe.de', name: 'Bera Chef', admin: true });
    expect(konto.state.forwardedFor).toContain('203.0.113.7');
    expect(supa.state.calls).toHaveLength(0);
  });

  it('a wrong password is refused and never retried at Supabase', async () => {
    const r = await atlasLogin(cfg, 'chef@dd-gruppe.de', 'falsch', '203.0.113.7');
    expect(r).toMatchObject({ ok: false, status: 401, error: 'Wrong e-mail or password', failedPassword: true });
    expect(supa.state.calls).toHaveLength(0);
  });

  it('falls back to Supabase only when the Konto-Dienst does not answer', async () => {
    konto.state.down = true;
    const r = await atlasLogin(cfg, 'chef@dd-gruppe.de', 'richtig-123');
    expect(r.ok && r.identity.provider).toBe('supabase');
    supa.state.down = true;
    expect(await atlasLogin(cfg, 'chef@dd-gruppe.de', 'richtig-123')).toMatchObject({ ok: false, status: 503 });
  });

  it('only admins and listed accounts get in; the refused Atlas session is ended locally', async () => {
    const r = await atlasLogin(cfg, 'dispo@dd-gruppe.de', 'dispo-pass-1');
    expect(r).toMatchObject({ ok: false, status: 403 });
    await new Promise((res) => setTimeout(res, 50));
    expect(konto.state.logouts).toEqual(['u-dispo:local']);
    const listed = { ...cfg, access: parseAccess('admins, dispo@dd-gruppe.de') };
    expect((await atlasLogin(listed, 'dispo@dd-gruppe.de', 'dispo-pass-1')).ok).toBe(true);
    konto.users.get('dispo@dd-gruppe.de')!.profile.is_active = false;
    expect(await atlasLogin(listed, 'dispo@dd-gruppe.de', 'dispo-pass-1')).toMatchObject({ ok: false, status: 403, error: 'This Atlas account is deactivated' });
  });

  it('the "TrackLiv" permission in Atlas lets non-admins in', () => {
    const access = parseAccess('admins');
    expect(accessVerdict(access, { id: 'u', is_active: true, can_trackliv: true }, 'dispo@dd-gruppe.de').ok).toBe(true);
    expect(accessVerdict(access, { id: 'u', is_active: true, can_trackliv: false }, 'dispo@dd-gruppe.de').ok).toBe(false);
    expect(accessVerdict(access, { id: 'u', is_active: false, can_trackliv: true }, 'dispo@dd-gruppe.de').ok).toBe(false);
  });

  it('sessions from Atlas\' menu are re-checked by asking Atlas for the account', async () => {
    let now = Date.now();
    let state: 'ok' | 'down' | 'gone' = 'ok';
    const ended: string[] = [];
    const store = new AtlasSessions(cfg, Buffer.alloc(32, 9), null, (_k, s, why) => ended.push(`${s.email}:${why}`), () => now, async (uid) =>
      state === 'ok' ? { ok: true, identity: { uid, email: 'dispo@dd-gruppe.de', name: 'Dana Dispo (neu)', admin: false } } : { ok: false, revoked: state === 'gone' },
    );
    const cookie = store.create({ provider: 'sso', uid: 'u-dispo', email: 'dispo@dd-gruppe.de', name: 'Dana Dispo', admin: false });
    expect(await store.resolve(cookie)).toMatchObject({ user: 'Dana Dispo' });
    now += RECHECK_MS + 1000;
    expect(await store.resolve(cookie)).toMatchObject({ user: 'Dana Dispo (neu)' }); // name follows Atlas
    now += RECHECK_MS + 1000;
    state = 'down';
    expect(await store.resolve(cookie)).not.toBeNull(); // Atlas unreachable: stays signed in
    now += RECHECK_MS + 1000;
    state = 'gone';
    expect(await store.resolve(cookie)).toBeNull();
    expect(ended).toEqual(['dispo@dd-gruppe.de:revoked']);
    await store.logout(cookie); // nothing to end in Atlas, no error
  });

  it('re-checks sessions with Atlas: rotation, outage, deactivation, logout, restart', async () => {
    let now = Date.now();
    const ended: string[] = [];
    const listed = { ...cfg, access: parseAccess('dispo@dd-gruppe.de') };
    const file = join(dir, 'sessions.json');
    const secret = Buffer.alloc(32, 7);
    const store = new AtlasSessions(listed, secret, file, (_k, s, why) => ended.push(`${s.email}:${why}`), () => now);
    const login = await atlasLogin(listed, 'dispo@dd-gruppe.de', 'dispo-pass-1');
    if (!login.ok) throw new Error(login.error);
    const cookie = store.create(login.identity, login.tokens);
    expect(await store.resolve(cookie)).toMatchObject({ user: 'Dana Dispo', admin: false });

    // 10 minutes later: refresh token rotates
    now += RECHECK_MS + 1000;
    const before = konto.state.calls.length;
    expect(await store.resolve(cookie)).toMatchObject({ user: 'Dana Dispo' });
    expect(konto.state.calls.slice(before).some((c) => c.includes('grant_type=refresh_token'))).toBe(true);

    // Atlas unreachable: stays signed in
    now += RECHECK_MS + 1000;
    konto.state.down = true;
    expect(await store.resolve(cookie)).not.toBeNull();
    konto.state.down = false;

    // survives a restart (same secret), not with another secret
    store.save(true);
    expect(await new AtlasSessions(listed, secret, file, () => {}, () => now).resolve(cookie)).not.toBeNull();
    expect(await new AtlasSessions(listed, Buffer.alloc(32, 8), file, () => {}, () => now).resolve(cookie)).toBeNull();

    // deactivated in Atlas → signed out at the next check
    konto.users.get('dispo@dd-gruppe.de')!.profile.is_active = false;
    now += 2 * RECHECK_MS;
    expect(await store.resolve(cookie)).toBeNull();
    expect(ended).toEqual(['dispo@dd-gruppe.de:revoked']);

    // logout ends only this Atlas session
    konto.users.get('dispo@dd-gruppe.de')!.profile.is_active = true;
    const again = await atlasLogin(listed, 'dispo@dd-gruppe.de', 'dispo-pass-1');
    if (!again.ok) throw new Error(again.error);
    const c2 = store.create(again.identity, again.tokens);
    await store.logout(c2);
    expect(await store.resolve(c2)).toBeNull();
    expect(konto.state.logouts.at(-1)).toBe('u-dispo:local');
  });
});
