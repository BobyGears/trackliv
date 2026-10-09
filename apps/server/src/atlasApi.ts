/**
 * TrackLiv ↔ Registra Atlas, server to server: Atlas' API (review-api) answers TrackLiv on its internal
 * routes /api/trackliv/intern/… when TrackLiv shows the shared key that both installations hold.
 *
 *   ATLAS_API_URL=http://registra-review-api:3000      (inside the Docker network)
 *   ATLAS_TRACKLIV_KEY=<TRACKLIV_SCHLUESSEL from Atlas' .env>
 *
 * ./deploy.sh fills both in from the Atlas installation on the same server. Used for the automatic
 * sign-in from Atlas' menu (one-time tickets), for re-checking those sessions, and for Atlas' Inventar.
 */

export interface AtlasApiConfig {
  url: string;
  key: string;
  timeoutMs: number;
}

const clean = (s: string | undefined) => (s ?? '').trim().replace(/^['"]|['"]$/g, '').trim();

export function atlasApiConfig(env: NodeJS.ProcessEnv): AtlasApiConfig | null {
  const url = clean(env.ATLAS_API_URL).replace(/\/+$/, '');
  const key = clean(env.ATLAS_TRACKLIV_KEY);
  if (!url || key.length < 32) return null;
  return { url, key, timeoutMs: Number(env.ATLAS_TIMEOUT_MS) > 0 ? Number(env.ATLAS_TIMEOUT_MS) : 8000 };
}

export type ApiReply<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

/** status 0 = Atlas not reachable (network error, timeout, 5xx) */
export async function atlasApi<T>(cfg: AtlasApiConfig, method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiReply<T>> {
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      method,
      headers: { 'X-TrackLiv-Key': cfg.key, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (res.status >= 500) return { ok: false, status: 0, error: (data as { error?: string } | null)?.error ?? `Atlas HTTP ${res.status}` };
    if (!res.ok) return { ok: false, status: res.status, error: (data as { error?: string } | null)?.error ?? `Atlas HTTP ${res.status}` };
    return { ok: true, status: res.status, data: data as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** An Atlas account as Atlas reports it to TrackLiv. */
export interface AtlasUser {
  id: string;
  email: string;
  full_name?: string | null;
  is_admin?: boolean;
  is_active?: boolean;
  can_trackliv?: boolean;
}

/** Redeem the one-time ticket from Atlas' menu → the account it was issued for. */
export const redeemTicket = (cfg: AtlasApiConfig, ticket: string) => atlasApi<{ user: AtlasUser }>(cfg, 'POST', '/api/trackliv/intern/anmeldung', { ticket });

/** The account's current state (active, admin, TrackLiv permission). */
export const atlasUser = (cfg: AtlasApiConfig, id: string) => atlasApi<{ user: AtlasUser }>(cfg, 'GET', `/api/trackliv/intern/benutzer/${encodeURIComponent(id)}`);
