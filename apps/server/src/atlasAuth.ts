import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * Sign in with Registra Atlas accounts – same e-mail and password as atlas.dd-gruppe.de, from Atlas'
 * own user database. TrackLiv never sees a password hash: it asks Atlas' account service (Konto-Dienst,
 * reached over the Docker network "atlas-konto") exactly like the Atlas web app does, with Atlas'
 * Supabase as the fallback when the Konto-Dienst does not answer (a wrong password never falls back).
 *
 * After a successful sign-in TrackLiv keeps its own session (cookie) and the Atlas refresh token
 * (encrypted, in <data>/sessions.json). Every 5 minutes of use it asks Atlas again, so a person who is
 * locked, deactivated or loses access in Atlas is signed out of TrackLiv too, and open live screens close.
 *
 *   ATLAS_AUTH_URL=http://registra-konto-dienst:8100   ATLAS_ANON_KEY=<Atlas' KONTO_ANON_KEY>
 *   ATLAS_SUPABASE_URL=https://….supabase.co           ATLAS_SUPABASE_ANON_KEY=<Atlas' public anon key>
 *   ATLAS_PRIMARY=an|aus     (Atlas' KONTO_PRIMAER – with "aus" only Supabase is asked)
 *   ATLAS_ACCESS=admins | all | a@dd-gruppe.de,b@dd-gruppe.de   (Atlas admins always have access)
 *
 * ./deploy.sh fills the first five in from the Atlas installation on the same server.
 */

export type ProviderName = 'konto' | 'supabase';
export interface Provider {
  name: ProviderName;
  url: string;
  key: string;
}
export interface Access {
  all: boolean;
  emails: Set<string>;
}
export interface AtlasConfig {
  providers: Provider[];
  access: Access;
  /** Where people manage their Atlas account (forgotten password …). */
  siteUrl: string;
  timeoutMs: number;
  /** Ask Atlas again after this long (ATLAS_RECHECK_S, default 5 minutes). */
  recheckMs: number;
}

export interface Profile {
  id: string;
  full_name?: string | null;
  email?: string | null;
  is_admin?: boolean;
  is_active?: boolean;
}

export interface AtlasIdentity {
  provider: ProviderName;
  uid: string;
  email: string;
  name: string;
  admin: boolean;
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user?: { id: string; email?: string };
}

const clean = (s: string | undefined) => (s ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
const off = (s: string | undefined) => /^(aus|off|0|false|nein|no)$/i.test(clean(s));

export function parseAccess(raw: string | undefined): Access {
  const parts = clean(raw).toLowerCase().split(/[\s,;]+/).filter(Boolean);
  return { all: parts.includes('all') || parts.includes('alle'), emails: new Set(parts.filter((p) => p.includes('@'))) };
}

/** null = no Atlas configured (TrackLiv's own user list is used). */
export function atlasConfig(env: NodeJS.ProcessEnv): AtlasConfig | null {
  const konto: Provider | null =
    clean(env.ATLAS_AUTH_URL) && clean(env.ATLAS_ANON_KEY) ? { name: 'konto', url: clean(env.ATLAS_AUTH_URL).replace(/\/+$/, ''), key: clean(env.ATLAS_ANON_KEY) } : null;
  const supabase: Provider | null =
    clean(env.ATLAS_SUPABASE_URL) && clean(env.ATLAS_SUPABASE_ANON_KEY)
      ? { name: 'supabase', url: clean(env.ATLAS_SUPABASE_URL).replace(/\/+$/, ''), key: clean(env.ATLAS_SUPABASE_ANON_KEY) }
      : null;
  // Same order as Atlas itself: Konto-Dienst first while it leads (KONTO_PRIMAER=an), otherwise Supabase only –
  // a Konto-Dienst that does not lead may hold outdated accounts.
  const providers = (off(env.ATLAS_PRIMARY) && supabase ? [supabase] : [konto, supabase]).filter((p): p is Provider => !!p);
  if (!providers.length) return null;
  return {
    providers,
    access: parseAccess(env.ATLAS_ACCESS ?? 'admins'),
    siteUrl: clean(env.ATLAS_URL) || 'https://atlas.dd-gruppe.de',
    timeoutMs: Number(env.ATLAS_TIMEOUT_MS) > 0 ? Number(env.ATLAS_TIMEOUT_MS) : 8000,
    recheckMs: Number(env.ATLAS_RECHECK_S) >= 30 ? Number(env.ATLAS_RECHECK_S) * 1000 : RECHECK_MS,
  };
}

// --- talking to Atlas ------------------------------------------------------------------------------

type Reply = { reachable: false } | { reachable: true; status: number; body: Record<string, unknown> };

async function call(cfg: AtlasConfig, p: Provider, method: string, path: string, opts: { body?: unknown; bearer?: string; clientIp?: string } = {}): Promise<Reply> {
  try {
    const headers: Record<string, string> = { apikey: p.key, Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
    // the Konto-Dienst throttles per client IP and trusts private-network proxies – pass the real one on
    if (opts.clientIp && p.name === 'konto') headers['X-Forwarded-For'] = opts.clientIp;
    const res = await fetch(`${p.url}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (res.status >= 500) return { reachable: false };
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      const parsed = text ? JSON.parse(text) : {};
      body = Array.isArray(parsed) ? { rows: parsed } : (parsed as Record<string, unknown>);
    } catch {
      /* not JSON */
    }
    return { reachable: true, status: res.status, body };
  } catch {
    return { reachable: false }; // network error, DNS, timeout
  }
}

async function profileOf(cfg: AtlasConfig, p: Provider, accessToken: string, uid: string): Promise<Profile | null | 'unreachable'> {
  const r = await call(cfg, p, 'GET', `/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=*`, { bearer: accessToken });
  if (!r.reachable) return 'unreachable';
  if (r.status !== 200) return null;
  return ((r.body.rows as Profile[] | undefined) ?? [])[0] ?? null;
}

/** Ends only this one Atlas session – the default ("global") would sign the person out of Atlas everywhere. */
async function endAtlasSession(cfg: AtlasConfig, p: Provider, accessToken: string) {
  await call(cfg, p, 'POST', '/auth/v1/logout?scope=local', { bearer: accessToken });
}

export type Verdict = { ok: true } | { ok: false; reason: 'inactive' | 'no-access' };
export function accessVerdict(access: Access, profile: Profile | null, email: string): Verdict {
  if (!profile || profile.is_active === false) return { ok: false, reason: 'inactive' };
  if (profile.is_admin || access.all || access.emails.has(email.toLowerCase())) return { ok: true };
  return { ok: false, reason: 'no-access' };
}

const REFUSED: Record<string, string> = {
  invalid_credentials: 'Wrong e-mail or password',
  user_banned: 'This Atlas account is locked',
  email_not_confirmed: 'This Atlas account is not confirmed yet',
  validation_failed: 'Wrong e-mail or password',
};
const VERDICT_MSG = {
  inactive: 'This Atlas account is deactivated',
  'no-access': 'Your Atlas account has no access to TrackLiv – please ask an administrator',
} as const;
export const UNREACHABLE = 'The Atlas sign-in is not reachable right now – please try again in a moment';

export type LoginResult =
  | { ok: true; identity: AtlasIdentity; tokens: Tokens }
  | { ok: false; status: number; error: string; failedPassword?: boolean };

export async function atlasLogin(cfg: AtlasConfig, email: string, password: string, clientIp?: string): Promise<LoginResult> {
  for (const p of cfg.providers) {
    const r = await call(cfg, p, 'POST', '/auth/v1/token?grant_type=password', { body: { email, password }, clientIp });
    if (!r.reachable) continue; // next provider – only when this one did not answer
    if (r.status !== 200) {
      const code = String(r.body.error_code ?? r.body.error ?? '');
      if (r.status === 429) return { ok: false, status: 429, error: String(r.body.msg ?? r.body.message ?? 'Too many attempts – try again in 15 minutes') };
      if (r.status === 401 && code === 'no_api_key') {
        console.error(`[auth] Atlas ${p.name} refused TrackLiv's API key – run ./deploy.sh again to copy the current one`);
        return { ok: false, status: 503, error: UNREACHABLE };
      }
      return { ok: false, status: 401, error: REFUSED[code] ?? 'Wrong e-mail or password', failedPassword: code === 'invalid_credentials' || !REFUSED[code] };
    }
    const tokens = r.body as unknown as Tokens;
    const uid = tokens.user?.id;
    if (!tokens.access_token || !tokens.refresh_token || !uid) return { ok: false, status: 503, error: UNREACHABLE };
    const profile = await profileOf(cfg, p, tokens.access_token, uid);
    if (profile === 'unreachable') return { ok: false, status: 503, error: UNREACHABLE };
    const mail = String(profile?.email ?? tokens.user?.email ?? email).toLowerCase();
    const verdict = accessVerdict(cfg.access, profile, mail);
    if (!verdict.ok) {
      void endAtlasSession(cfg, p, tokens.access_token);
      return { ok: false, status: 403, error: VERDICT_MSG[verdict.reason] };
    }
    return {
      ok: true,
      tokens,
      identity: { provider: p.name, uid, email: mail, name: (profile?.full_name ?? '').trim() || mail, admin: !!profile?.is_admin },
    };
  }
  return { ok: false, status: 503, error: UNREACHABLE };
}

/** Ask Atlas whether a session still holds: refresh the tokens and re-read the profile. */
export async function atlasRecheck(
  cfg: AtlasConfig,
  provider: ProviderName,
  refreshToken: string,
): Promise<{ ok: true; tokens: Tokens; identity: Omit<AtlasIdentity, 'provider'> } | { ok: false; revoked: boolean; tokens?: Tokens }> {
  const p = cfg.providers.find((x) => x.name === provider);
  if (!p) return { ok: false, revoked: true }; // that provider is no longer configured
  const r = await call(cfg, p, 'POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
  if (!r.reachable || r.status === 429) return { ok: false, revoked: false };
  if (r.status !== 200) return { ok: false, revoked: true }; // ended, expired, locked or deleted in Atlas
  const tokens = r.body as unknown as Tokens;
  const uid = tokens.user?.id;
  if (!tokens.refresh_token || !uid) return { ok: false, revoked: false };
  const profile = await profileOf(cfg, p, tokens.access_token, uid);
  if (profile === 'unreachable') return { ok: false, revoked: false, tokens };
  const mail = String(profile?.email ?? tokens.user?.email ?? '').toLowerCase();
  if (!accessVerdict(cfg.access, profile, mail).ok) {
    void endAtlasSession(cfg, p, tokens.access_token);
    return { ok: false, revoked: true };
  }
  return { ok: true, tokens, identity: { uid, email: mail, name: (profile?.full_name ?? '').trim() || mail, admin: !!profile?.is_admin } };
}

export async function atlasLogout(cfg: AtlasConfig, provider: ProviderName, accessToken: string | undefined, refreshToken: string) {
  const p = cfg.providers.find((x) => x.name === provider);
  if (!p) return;
  let token = accessToken;
  if (!token) {
    const r = await call(cfg, p, 'POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
    if (r.reachable && r.status === 200) token = String((r.body as unknown as Tokens).access_token ?? '');
  }
  if (token) await endAtlasSession(cfg, p, token);
}

// --- TrackLiv's sessions -------------------------------------------------------------------------------

/** Ask Atlas again after this long (default). */
export const RECHECK_MS = 5 * 60_000;
/** A session unused for this long ends (the cookie lives as long). */
export const IDLE_MS = 30 * 24 * 3600_000;
/** If Atlas cannot be reached, keep people signed in for at most this long without a successful check. */
const UNVERIFIED_MAX_MS = 7 * 24 * 3600_000;

interface Stored extends AtlasIdentity {
  /** encrypted refresh token */
  rt: string;
  created: number;
  lastSeen: number;
  checked: number;
}

export interface SessionInfo {
  key: string;
  user: string;
  email: string;
  admin: boolean;
}

const hashId = (id: string) => createHash('sha256').update(id).digest('hex');

export class AtlasSessions {
  private sessions = new Map<string, Stored>();
  /** short-lived, in memory only */
  private access = new Map<string, { token: string; exp: number }>();
  private inflight = new Map<string, Promise<Stored | null>>();
  private retryAt = new Map<string, number>();
  private dirty = false;
  private readonly key: Buffer;

  constructor(
    private cfg: AtlasConfig,
    secret: Buffer,
    private file: string | null,
    private onEnd: (key: string, s: Stored, why: string) => void = () => {},
    private now: () => number = Date.now,
  ) {
    this.key = createHash('sha256').update('trackliv-atlas-refresh:').update(secret).digest();
    this.load();
  }

  private enc(s: string) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const x = Buffer.concat([c.update(s, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), x]).toString('base64');
  }
  private dec(b: string): string | null {
    try {
      const buf = Buffer.from(b, 'base64');
      const d = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    } catch {
      return null; // other session secret – the session is void
    }
  }

  private load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, Stored>;
      for (const [k, s] of Object.entries(raw)) if (this.dec(s.rt) !== null && this.now() - s.lastSeen < IDLE_MS) this.sessions.set(k, s);
    } catch (e) {
      console.warn('[auth] could not read sessions.json – everybody signs in again:', (e as Error).message);
    }
  }

  /** Written right away after a token rotation (an old refresh token would end the Atlas session). */
  save(force = false) {
    if (!this.file || (!this.dirty && !force)) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.sessions)), { mode: 0o600 });
    renameSync(tmp, this.file);
    this.dirty = false;
  }

  /** New session after atlasLogin → the cookie value. */
  create(identity: AtlasIdentity, tokens: Tokens): string {
    const id = randomBytes(32).toString('base64url');
    const key = hashId(id);
    const t = this.now();
    this.sessions.set(key, { ...identity, rt: this.enc(tokens.refresh_token), created: t, lastSeen: t, checked: t });
    this.rememberAccess(key, tokens);
    this.save(true);
    return id;
  }

  private rememberAccess(key: string, tokens: Tokens) {
    if (tokens.access_token) this.access.set(key, { token: tokens.access_token, exp: (tokens.expires_at ?? 0) * 1000 || this.now() + 3000_000 });
  }

  private end(key: string, why: string) {
    const s = this.sessions.get(key);
    this.sessions.delete(key);
    this.access.delete(key);
    this.retryAt.delete(key);
    this.save(true);
    if (s) this.onEnd(key, s, why);
  }

  /** The signed-in person for a cookie, asking Atlas again when the last check is older than RECHECK_MS. */
  async resolve(cookieId: string | undefined): Promise<SessionInfo | null> {
    if (!cookieId) return null;
    const key = hashId(cookieId);
    let s: Stored | null | undefined = this.sessions.get(key);
    if (!s) return null;
    if (this.now() - s.lastSeen > IDLE_MS) {
      this.end(key, 'idle');
      return null;
    }
    s.lastSeen = this.now();
    this.dirty = true;
    if (this.now() - s.checked > this.cfg.recheckMs) s = await this.recheck(key);
    return s ? { key, user: s.name, email: s.email, admin: s.admin } : null;
  }

  /** One check at a time per session (refresh tokens rotate). */
  recheck(key: string): Promise<Stored | null> {
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.doRecheck(key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async doRecheck(key: string): Promise<Stored | null> {
    const s = this.sessions.get(key);
    if (!s) return null;
    if ((this.retryAt.get(key) ?? 0) > this.now()) return s; // Atlas was unreachable a moment ago
    const rt = this.dec(s.rt);
    if (!rt) {
      this.end(key, 'invalid');
      return null;
    }
    const r = await atlasRecheck(this.cfg, s.provider, rt);
    if (r.ok) {
      Object.assign(s, r.identity, { rt: this.enc(r.tokens.refresh_token), checked: this.now() });
      this.rememberAccess(key, r.tokens);
      this.retryAt.delete(key);
      this.save(true);
      return s;
    }
    if (r.tokens?.refresh_token) {
      // tokens rotated, but the profile could not be read – keep the new refresh token
      s.rt = this.enc(r.tokens.refresh_token);
      this.save(true);
    }
    if (r.revoked) {
      this.end(key, 'revoked');
      return null;
    }
    if (this.now() - s.checked > UNVERIFIED_MAX_MS) {
      this.end(key, 'unverified');
      return null;
    }
    this.retryAt.set(key, this.now() + 60_000);
    return s;
  }

  /** Check the sessions behind open live screens, which make no requests of their own. */
  async recheckDue(keys: Iterable<string>) {
    for (const key of new Set(keys)) {
      const s = this.sessions.get(key);
      if (s && this.now() - s.checked > this.cfg.recheckMs) await this.recheck(key);
    }
  }

  async logout(cookieId: string | undefined) {
    if (!cookieId) return;
    const key = hashId(cookieId);
    const s = this.sessions.get(key);
    if (!s) return;
    const rt = this.dec(s.rt);
    const access = this.access.get(key);
    this.sessions.delete(key);
    this.access.delete(key);
    this.save(true);
    if (rt) await atlasLogout(this.cfg, s.provider, access && access.exp > this.now() + 30_000 ? access.token : undefined, rt).catch(() => {});
  }

  get size() {
    return this.sessions.size;
  }
}

/** Startup report for the server log: which Atlas sign-in answers. */
export async function atlasProbe(cfg: AtlasConfig): Promise<string> {
  const parts = await Promise.all(
    cfg.providers.map(async (p) => {
      const r = await call(cfg, p, 'GET', '/auth/v1/health');
      return `${p.name === 'konto' ? 'Konto-Dienst' : 'Supabase'} ${r.reachable && r.status < 400 ? 'reachable' : 'NOT reachable'}`;
    }),
  );
  return parts.join(' · ');
}
