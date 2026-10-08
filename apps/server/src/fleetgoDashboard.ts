import { createHash } from 'node:crypto';
import type { Browser, BrowserContext, Page, Request, Response } from 'playwright-core';
import { config } from './config.ts';
import type { FleetGoEquipment } from './fleetgo.ts';
import { extractVehicles, maskUser, redactUrl, shapeOf } from './fleetgoExtract.ts';

/**
 * FleetGO via the web dashboard – like signing in by hand.
 *
 * The official FleetGO API is only open to partners (API keys from FleetGO). This source signs in to
 * app.fleetgo.com with a normal FleetGO user in a headless Chromium (the sign-in page is Keycloak at
 * login.fleetgo.com), lets the dashboard load as it would in a browser and reads the vehicle positions
 * from the data the dashboard itself requests. The request that delivered them is then repeated every
 * poll from inside the signed-in page, so cookies, tokens and anti-forgery headers stay FleetGO's own.
 *
 * Nothing secret is logged: no password, cookies, tokens or headers; URLs without token-like values.
 */

const USER_SEL = '#username, input[name="username"], input[type="email"]';
const PASS_SEL = '#password, input[name="password"], input[type="password"]';
const SUBMIT_SEL = '#kc-login, button[type="submit"], input[type="submit"]';
const ERROR_SEL = '#input-error, .kc-feedback-text, .alert-error, .pf-c-alert__title, .pf-m-danger, [role="alert"]';
const OTP_SEL = '#otp, input[name="otp"], input[autocomplete="one-time-code"]';
/** Requests the dashboard doesn't need to deliver data – skipped to save memory and bandwidth. */
const BLOCKED_TYPES = new Set(['image', 'media', 'font']);
const BLOCKED_HOSTS = /(google-analytics|googletagmanager|doubleclick|hotjar|clarity\.ms|facebook|segment\.io|intercom)/i;
/** Headers a replayed request must not copy (the browser sets them, or they are per-connection). */
const DROP_HEADERS = /^(cookie|host|content-length|origin|referer|user-agent|accept-encoding|connection|sec-|:)/i;

export class FleetGoLoginError extends Error {
  constructor(
    message: string,
    readonly kind: 'credentials' | 'two-factor' | 'unexpected',
  ) {
    super(message);
  }
}

export interface ObservedRequest {
  method: string;
  url: string;
  status: number;
  shape: string;
  vehicles: number;
  score: number;
  at: number;
}

interface Recipe {
  key: string;
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

type Cfg = typeof config.fleetgo;

export class FleetGoDashboard {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private signedIn = false;
  private launchedAt = 0;
  private lastReload = 0;
  private nextAttemptAt = 0;
  private failures = 0;
  private lastError = '';
  private vehicles = new Map<string, FleetGoEquipment>();
  private source: { key: string; score: number } | null = null;
  private recipe: Recipe | null = null;
  lastData = 0;
  readonly observed = new Map<string, ObservedRequest>();

  constructor(
    private cfg: Cfg = config.fleetgo,
    private log: (msg: string) => void = (m) => console.log(`[fleetgo] ${m}`),
  ) {}

  private get appHost() {
    return new URL(this.cfg.dashboardUrl).host;
  }

  /** Current vehicles; signs in when needed and refreshes the data if it is older than one poll. */
  async fleet(): Promise<FleetGoEquipment[]> {
    await this.ensureSession();
    const pollMs = this.cfg.pollSeconds * 1000;
    if (Date.now() - this.lastData > pollMs * 0.8) await this.refresh();
    if (!this.lastData) {
      throw new Error('Signed in to FleetGO – waiting for the dashboard to load vehicle data (./deploy.sh --fleetgo-check shows what it sees)');
    }
    if (Date.now() - this.lastData > Math.max(5 * pollMs, 5 * 60_000)) {
      this.signedIn = false; // force a fresh page load / sign-in next time
      throw new Error(`No new vehicle data from the FleetGO dashboard for ${Math.round((Date.now() - this.lastData) / 60_000)} min`);
    }
    return [...this.vehicles.values()];
  }

  /** Launch the browser and sign in (used by fleet() and the check command). */
  async ensureSession(): Promise<void> {
    if (Date.now() < this.nextAttemptAt) {
      throw new Error(`${this.lastError} – next sign-in attempt ${new Date(this.nextAttemptAt).toLocaleTimeString('de-DE')}`);
    }
    try {
      if (this.browser && Date.now() - this.launchedAt > 12 * 3600_000) await this.close(); // fresh browser twice a day
      if (!this.browser?.isConnected()) await this.launch();
      if (!this.page || this.page.isClosed()) await this.openPage();
      if (!this.signedIn) await this.signIn();
      this.failures = 0;
    } catch (err) {
      this.signedIn = false;
      this.failures++;
      this.lastError = err instanceof Error ? err.message : String(err);
      // Wrong password: wait long, so FleetGO doesn't lock the user. Other errors: 1, 2, 4 … 15 min.
      const waitMin = err instanceof FleetGoLoginError && err.kind !== 'unexpected' ? 15 : Math.min(15, 2 ** (this.failures - 1));
      this.nextAttemptAt = Date.now() + waitMin * 60_000;
      if (!(err instanceof FleetGoLoginError)) await this.close().catch(() => {});
      throw err;
    }
  }

  private async launch() {
    const { chromium } = await import('playwright-core');
    this.browser = await chromium.launch({
      headless: true,
      executablePath: this.cfg.browserPath || undefined,
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--mute-audio', '--no-first-run'],
    });
    this.launchedAt = Date.now();
    this.browser.on('disconnected', () => {
      this.browser = null;
      this.page = null;
      this.signedIn = false;
    });
    this.context = await this.browser.newContext({
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      viewport: { width: 1440, height: 900 },
    });
    await this.context.route('**/*', (route) => {
      const req = route.request();
      if (BLOCKED_TYPES.has(req.resourceType()) || BLOCKED_HOSTS.test(new URL(req.url()).host)) return route.abort();
      return route.continue();
    });
  }

  private async openPage() {
    this.page = await this.context!.newPage();
    this.page.setDefaultTimeout(45_000);
    this.page.on('response', (r) => void this.onResponse(r));
    this.page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string') return;
        // SignalR separates messages with \x1e; invocations carry their data in "arguments"
        for (const part of payload.split('\x1e')) {
          if (!part.trim()) continue;
          try {
            const msg = JSON.parse(part) as { arguments?: unknown; target?: string };
            this.ingest(msg.arguments ?? msg, `ws ${redactUrl(ws.url())}${msg.target ? ` ${msg.target}` : ''}`, 'WS', 101);
          } catch {
            /* not JSON */
          }
        }
      });
    });
    this.page.on('framenavigated', (frame) => {
      if (frame === this.page?.mainFrame() && new URL(frame.url()).host !== this.appHost) this.signedIn = false;
    });
  }

  private async onLoginForm(): Promise<boolean> {
    const page = this.page!;
    return (await page.locator(PASS_SEL).first().isVisible().catch(() => false)) || (await page.locator(USER_SEL).first().isVisible().catch(() => false));
  }

  private async signIn() {
    const page = this.page!;
    const { username, password } = this.cfg;
    if (!username || !password) throw new FleetGoLoginError('FLEETGO_USERNAME / FLEETGO_PASSWORD are not set', 'credentials');
    this.log(`signing in to ${this.cfg.dashboardUrl} as ${maskUser(username)}`);
    await page.goto(this.cfg.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    if (await this.onLoginForm()) {
      await page.locator(USER_SEL).first().fill(username);
      if (!(await page.locator(PASS_SEL).first().isVisible().catch(() => false))) {
        // two-step sign-in pages ask for the user first
        await page.locator(SUBMIT_SEL).first().click();
        await page.locator(PASS_SEL).first().waitFor({ state: 'visible', timeout: 20_000 });
      }
      await page.locator(PASS_SEL).first().fill(password);
      await page.locator(SUBMIT_SEL).first().click();
      await page.waitForURL((url) => url.host === this.appHost, { timeout: 45_000, waitUntil: 'domcontentloaded' }).catch(() => {});
      if (new URL(page.url()).host !== this.appHost || (await this.onLoginForm())) {
        if (await page.locator(OTP_SEL).first().isVisible().catch(() => false)) {
          throw new FleetGoLoginError('FleetGO asks for a two-factor code – use a FleetGO user without two-factor sign-in for TrackLiv', 'two-factor');
        }
        const msg = (await page.locator(ERROR_SEL).first().textContent({ timeout: 2_000 }).catch(() => null))?.trim();
        throw new FleetGoLoginError(`FleetGO sign-in failed: ${msg || `still on ${redactUrl(page.url())}`}`, msg ? 'credentials' : 'unexpected');
      }
    } else if (new URL(page.url()).host !== this.appHost) {
      throw new FleetGoLoginError(`FleetGO sign-in page not recognised (${redactUrl(page.url())})`, 'unexpected');
    }

    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (this.cfg.dashboardPage) {
      await page.goto(new URL(this.cfg.dashboardPage, this.cfg.dashboardUrl).href, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    }
    this.signedIn = true;
    this.lastReload = Date.now();
    this.log(`signed in (${redactUrl(page.url())})`);
  }

  /** Get fresh data: repeat the request that delivered the vehicles, or reload the dashboard. */
  private async refresh() {
    const page = this.page!;
    const pollMs = this.cfg.pollSeconds * 1000;
    if (!this.recipe) {
      // the vehicle request is not known yet (or arrives via websocket) – reload now and then
      if (Date.now() - this.lastReload > Math.max(2 * pollMs, 60_000)) {
        this.lastReload = Date.now();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        if (await this.onLoginForm()) {
          this.signedIn = false;
          await this.ensureSession();
        }
      }
      return;
    }
    if (Date.now() - this.lastReload > 30 * 60_000) {
      // reload the dashboard every 30 min so it renews its own tokens
      this.lastReload = Date.now();
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    }
    const r = this.recipe;
    const res = await page.evaluate(
      async ({ url, method, body, headers }) => {
        try {
          const resp = await fetch(url, { method, body, headers, credentials: 'include' });
          const ct = resp.headers.get('content-type') ?? '';
          return { status: resp.status, json: ct.includes('json') ? await resp.text() : null };
        } catch (e) {
          return { status: 0, json: null, error: String(e) };
        }
      },
      { url: r.url, method: r.method, body: r.body, headers: r.headers },
    );
    if (res.status === 401 || res.status === 403 || (res.status === 200 && res.json === null)) {
      this.signedIn = false; // session expired – sign in again on the next poll
      throw new Error(`FleetGO session expired (HTTP ${res.status}) – signing in again`);
    }
    if (res.status !== 200 || !res.json) throw new Error(`FleetGO dashboard request failed (HTTP ${res.status})`);
    this.ingest(JSON.parse(res.json), r.key, r.method, res.status);
  }

  private async onResponse(resp: Response) {
    try {
      const req: Request = resp.request();
      if (!['xhr', 'fetch'].includes(req.resourceType())) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json') || resp.status() !== 200) {
        this.note(req.method(), redactUrl(resp.url()).split('?')[0], resp.status(), ct.includes('json') ? '(json)' : `(${ct.split(';')[0] || 'no body'})`, 0, 0);
        return;
      }
      const text = await resp.text();
      if (text.length > 8_000_000) return;
      const json = JSON.parse(text) as unknown;
      // one endpoint (e.g. a generic "query") can return different things depending on the body
      const body = req.postData();
      const key = `${req.method()} ${redactUrl(resp.url()).split('?')[0]}${body ? ` ·${createHash('sha1').update(body).digest('hex').slice(0, 6)}` : ''}`;
      const accepted = this.ingest(json, key, req.method(), 200);
      if (accepted) {
        const headers = Object.fromEntries(Object.entries(await req.allHeaders()).filter(([k]) => !DROP_HEADERS.test(k)));
        this.recipe = { key, url: resp.url(), method: req.method(), body: body ?? undefined, headers };
      }
    } catch {
      /* body not available (navigation, aborted) */
    }
  }

  private note(method: string, url: string, status: number, shape: string, vehicles: number, score: number) {
    const key = `${method} ${url}`;
    this.observed.set(key, { method, url, status, shape, vehicles, score, at: Date.now() });
    if (this.observed.size > 80) this.observed.delete(this.observed.keys().next().value!);
  }

  /** Take vehicles from a JSON document if it is the (best) vehicle source. Returns true if used. */
  private ingest(json: unknown, key: string, method: string, status: number): boolean {
    const found = extractVehicles(json);
    const path = key.replace(/^\S+\s/, '');
    const hint = /(vehicle|equipment|fleet|asset|object|position|location|tracking|map|unit|query)/i.test(path)
      ? 1.5
      : /(poi|place|geofence|zone|address|trip|history|route)/i.test(path)
        ? 0.2
        : 1;
    const score = found ? found.candidate.score * hint : 0;
    this.note(method, path, status, shapeOf(json).slice(0, 240), found?.vehicles.length ?? 0, Math.round(score * 10) / 10);
    if (!found) return false;
    if (this.cfg.dashboardSource && !key.includes(this.cfg.dashboardSource)) return false;
    const isSource = this.source?.key === key;
    const single = found.candidate.items.length === 1 && found.candidate.path === '';
    if (single && this.source && !isSource) {
      // live update of one vehicle (e.g. via websocket): only for vehicles we already know
      const v = found.vehicles[0];
      if (!this.vehicles.has(String(v.equipmentId))) return false;
      this.vehicles.set(String(v.equipmentId), v);
      this.lastData = Date.now();
      return false;
    }
    if (!isSource && this.source && score < this.source.score * 1.5) return false;
    if (!isSource) this.log(`vehicle data found: ${found.vehicles.length} vehicles from ${key}`);
    this.source = { key, score: isSource ? Math.max(score, this.source!.score) : score };
    this.vehicles = new Map(found.vehicles.map((v) => [String(v.equipmentId), v]));
    this.lastData = Date.now();
    return true;
  }

  /** Where the browser is and what it has seen – for the check command. */
  status() {
    return {
      signedIn: this.signedIn,
      page: this.page && !this.page.isClosed() ? redactUrl(this.page.url()) : null,
      source: this.source?.key ?? null,
      vehicles: [...this.vehicles.values()],
      lastData: this.lastData,
      observed: [...this.observed.values()].sort((a, b) => b.score - a.score || b.at - a.at),
    };
  }

  async pageTitle() {
    return this.page && !this.page.isClosed() ? this.page.title().catch(() => '') : '';
  }

  async close() {
    const b = this.browser;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.signedIn = false;
    await b?.close().catch(() => {});
  }
}
