import {
  DEFAULT_RANDOMIZE_OPTIONS,
  destinationLocation,
  randomSeed,
  randomizePlan,
  type Assignment,
  type DayPlan,
  type FleetStatus,
  type ID,
  type OpResult,
  type OpsEvent,
  type Person,
  type PlanContext,
  type Project,
  type RandomizeOptions,
  type RandomizeResult,
  type Route,
  type Site,
  type Telemetry,
  type Vehicle,
} from '@trackliv/core';
import { create } from 'zustand';
import { ApiError, UNAUTHORIZED_EVENT, api, authApi, openStream, type ClockSnapshot, type SiteGeo } from './api';

export type ObjectType = 'vehicle' | 'person' | 'project' | 'site';
export interface Selection {
  type: ObjectType;
  id: ID;
}
export type View = 'map' | 'dispatch' | 'schedule' | 'data';
export type Theme = 'light' | 'dark';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

export type FocusRequest =
  | { kind: 'fit-all'; nonce: number }
  | { kind: 'site'; id: ID; nonce: number }
  | { kind: 'vehicle'; id: ID; nonce: number }
  | { kind: 'project'; id: ID; nonce: number }
  | { kind: 'lnglat'; lng: number; lat: number; zoom?: number; nonce: number };

/** One-shot "click on the map" request (custom destinations, project locations …). */
export interface MapPick {
  label: string;
  onPick: (loc: { lng: number; lat: number }) => void;
}

interface State {
  /** 'checking' → 'signed-out' (login screen) | 'ok' (app). */
  auth: 'checking' | 'signed-out' | 'ok';
  authEnabled: boolean;
  user: string | null;
  ready: boolean;
  error?: string;
  connected: boolean;
  mode: 'fleetgo' | 'simulator';
  today: string;
  date: string;
  clock: ClockSnapshot;
  skewMs: number;
  sites: Site[];
  siteGeo: SiteGeo[];
  vehicles: Vehicle[];
  people: Person[];
  projects: Project[];
  plan: DayPlan;
  confirmed: DayPlan;
  pending: number;
  telemetry: Record<ID, Telemetry>;
  events: OpsEvent[];
  unread: number;
  fleet: FleetStatus;
  routes: Record<string, Route>;

  view: View;
  selection: Selection | null;
  hover: Selection | null;
  theme: Theme;
  paletteOpen: boolean;
  eventsOpen: boolean;
  focus: FocusRequest | null;
  mapPick: MapPick | null;
  layers: { routes: boolean; labels: boolean; buildings: boolean; crew: boolean; streets: boolean };
  is3d: boolean;
  toasts: Toast[];
  history: Assignment[][];
  future: Assignment[][];

  scenario: RandomizeResult | null;
  scenarioOptions: RandomizeOptions;
  personSelection: ID[];
}

interface Actions {
  checkAuth(): Promise<void>;
  login(username: string, password: string): Promise<string | null>;
  logout(): Promise<void>;
  init(): Promise<void>;
  setView(v: View): void;
  select(s: Selection | null, opts?: { focus?: boolean }): void;
  setHover(s: Selection | null): void;
  toggleTheme(): void;
  setPalette(open: boolean): void;
  setEventsOpen(open: boolean): void;
  requestFocus(f: Omit<FocusRequest, 'nonce'> | FocusRequest): void;
  setMapPick(p: MapPick | null): void;
  toggleLayer(k: keyof State['layers']): void;
  set3d(on: boolean): void;
  toast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: number): void;
  commit(updater: (list: Assignment[]) => Assignment[] | OpResult, reason?: string): boolean;
  undo(): void;
  redo(): void;
  dispatchNow(vehicleId: ID): Promise<void>;
  recall(vehicleId: ID): Promise<void>;
  previewRandomize(opts?: Partial<RandomizeOptions>): void;
  rerollScenario(): void;
  applyScenario(): void;
  discardScenario(): void;
  setPersonSelection(ids: ID[]): void;
  togglePersonSelected(id: ID): void;
  setSimSpeed(speed: number): Promise<void>;
  setDate(date: string): Promise<void>;
  copyPlanFrom(date: string): Promise<void>;
  refreshRoutes(): Promise<void>;
  ctx(): PlanContext;
  opsNow(): number;
}

const emptyPlan = (date: string): DayPlan => ({ date, revision: 0, assignments: [], updatedAt: '' });

const loadTheme = (): Theme => {
  try {
    const t = localStorage.getItem('trackliv:theme');
    if (t === 'dark' || t === 'light') return t;
  } catch {
    /* storage blocked */
  }
  return 'light';
};

let toastId = 1;
let queue: Promise<void> = Promise.resolve();

/** Keep crew/destination/time edits from `snapshot` but the live stage fields from `current`. */
function restoreEditable(current: Assignment[], snapshot: Assignment[]): Assignment[] {
  return current.map((a) => {
    const s = snapshot.find((x) => x.vehicleId === a.vehicleId);
    if (!s) return a;
    return {
      ...a,
      crew: s.crew,
      lockedCrew: s.lockedCrew,
      destination: s.destination,
      destinationLocked: s.destinationLocked,
      departAt: s.departAt,
      returnAt: s.returnAt,
      note: s.note,
    };
  });
}

let closeStream: (() => void) | null = null;

export const useStore = create<State & Actions>()((set, get) => ({
  auth: 'checking',
  authEnabled: false,
  user: null,
  ready: false,
  connected: false,
  mode: 'simulator',
  today: '',
  date: '',
  clock: { realEpoch: Date.now(), opsEpoch: Date.now(), speed: 1 },
  skewMs: 0,
  sites: [],
  siteGeo: [],
  vehicles: [],
  people: [],
  projects: [],
  plan: emptyPlan(''),
  confirmed: emptyPlan(''),
  pending: 0,
  telemetry: {},
  events: [],
  unread: 0,
  fleet: { source: 'simulator', connected: false, pollSeconds: 1 },
  routes: {},

  view: 'map',
  selection: null,
  hover: null,
  theme: loadTheme(),
  paletteOpen: false,
  eventsOpen: false,
  focus: null,
  mapPick: null,
  layers: { routes: true, labels: true, buildings: true, crew: true, streets: true },
  is3d: true,
  toasts: [],
  history: [],
  future: [],

  scenario: null,
  scenarioOptions: { ...DEFAULT_RANDOMIZE_OPTIONS, seed: randomSeed() },
  personSelection: [],

  async checkAuth() {
    try {
      const me = await authApi.me();
      set({ authEnabled: me.authEnabled, user: me.user, auth: !me.authEnabled || me.user ? 'ok' : 'signed-out' });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async login(username, password) {
    try {
      const r = await authApi.login(username, password);
      try {
        localStorage.setItem('trackliv:user', r.user);
      } catch {
        /* ignore */
      }
      set({ user: r.user, auth: 'ok' });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  },

  async logout() {
    await authApi.logout().catch(() => undefined);
    closeStream?.();
    closeStream = null;
    set({ user: null, auth: 'signed-out', ready: false });
  },

  async init() {
    try {
      const t0 = Date.now();
      const [b, siteGeo] = await Promise.all([api.bootstrap(), api.siteGeo()]);
      // Server wall clock at response time, derived from its ops clock snapshot.
      const serverWall =
        b.clock.speed > 0 ? b.clock.realEpoch + (Date.parse(b.serverTime) - b.clock.opsEpoch) / b.clock.speed : (t0 + Date.now()) / 2;
      const skewMs = serverWall - (t0 + Date.now()) / 2;
      set({
        ready: true,
        mode: b.mode,
        today: b.today,
        date: b.plan.date,
        clock: b.clock,
        skewMs: Number.isFinite(skewMs) && Math.abs(skewMs) > 1500 ? skewMs : 0,
        sites: b.sites,
        siteGeo,
        vehicles: b.vehicles,
        people: b.people,
        projects: b.projects,
        plan: b.plan,
        confirmed: b.plan,
        telemetry: Object.fromEntries(b.telemetry.map((t) => [t.vehicleId, t])),
        events: b.events,
        fleet: b.fleet,
      });
      void get().refreshRoutes();
      closeStream?.();
      closeStream = openStream({
        telemetry: (list) =>
          set((s) => {
            const telemetry = { ...s.telemetry };
            for (const t of list) telemetry[t.vehicleId] = t;
            return { telemetry };
          }),
        plan: (p) => {
          if (p.date !== get().date) return;
          if (p.revision <= get().confirmed.revision) return;
          const prev = get().confirmed;
          set((s) => ({ confirmed: p, plan: s.pending ? s.plan : p }));
          const destChanged = p.assignments.some((a) => {
            const o = prev.assignments.find((x) => x.vehicleId === a.vehicleId);
            return JSON.stringify(o?.destination) !== JSON.stringify(a.destination);
          });
          if (destChanged) void get().refreshRoutes();
        },
        event: (e) => set((s) => ({ events: [...s.events.slice(-499), e], unread: s.eventsOpen ? 0 : s.unread + 1 })),
        fleet: (fleet) => set({ fleet }),
        clock: (clock) => set({ clock }),
        master: (m) => {
          set(m as Partial<State>);
          if (m.projects) void get().refreshRoutes();
        },
        vehicles: (vehicles) => set({ vehicles }),
        status: (connected) => set({ connected }),
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  setView: (view) => set({ view }),
  select: (selection, opts) => {
    set({ selection });
    if (selection && opts?.focus) get().requestFocus({ kind: selection.type, id: selection.id } as FocusRequest);
  },
  setHover: (hover) => set({ hover }),
  toggleTheme: () => {
    const theme = get().theme === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem('trackliv:theme', theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setEventsOpen: (eventsOpen) => set({ eventsOpen, unread: eventsOpen ? 0 : get().unread }),
  requestFocus: (f) => set({ focus: { ...f, nonce: Date.now() + Math.random() } as FocusRequest }),
  setMapPick: (mapPick) => set({ mapPick }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  set3d: (is3d) => set({ is3d }),
  toast: (t) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), t.kind === 'error' ? 7000 : 4200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  commit(updater, reason) {
    const run = (list: Assignment[]): { ok: true; list: Assignment[]; note?: string } | { ok: false; error: string } => {
      const r = updater(list);
      if (Array.isArray(r)) return { ok: true, list: r };
      return r.ok ? { ok: true, list: r.assignments, note: r.note } : { ok: false, error: r.error };
    };
    const before = get().plan.assignments;
    const first = run(before);
    if (!first.ok) {
      get().toast({ kind: 'warning', title: first.error });
      return false;
    }
    if (first.note) get().toast({ kind: 'info', title: first.note });
    set((s) => ({
      plan: { ...s.plan, assignments: first.list },
      history: [...s.history.slice(-49), before],
      future: [],
      pending: s.pending + 1,
    }));
    const date = get().date;
    queue = queue.then(async () => {
      let base = get().confirmed;
      for (let attempt = 0; attempt < 3; attempt++) {
        const next = run(base.assignments);
        if (!next.ok) {
          get().toast({ kind: 'warning', title: next.error });
          break;
        }
        try {
          const saved = await api.putPlan(date, next.list, base.revision, attempt === 0 ? reason : undefined);
          set((s) => ({ confirmed: saved, plan: s.pending <= 1 ? saved : s.plan }));
          break;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            base = (e.body as { plan: DayPlan }).plan;
            set({ confirmed: base });
            continue;
          }
          get().toast({ kind: 'error', title: 'Could not save the plan', detail: e instanceof Error ? e.message : String(e) });
          set((s) => ({ plan: s.confirmed }));
          break;
        }
      }
      set((s) => ({ pending: Math.max(0, s.pending - 1) }));
      if (get().pending === 0) set((s) => ({ plan: s.confirmed }));
    });
    const destChanged = first.list.some((a) => {
      const o = before.find((x) => x.vehicleId === a.vehicleId);
      return JSON.stringify(o?.destination) !== JSON.stringify(a.destination) || (o?.crew.length ?? 0) !== a.crew.length;
    });
    if (destChanged) void queue.then(() => get().refreshRoutes());
    return true;
  },

  undo() {
    const { history, plan } = get();
    const prev = history[history.length - 1];
    if (!prev) return;
    const current = plan.assignments;
    get().commit((list) => restoreEditable(list, prev), 'Undo');
    set((s) => ({ history: s.history.slice(0, -2), future: [...s.future, current] }));
  },
  redo() {
    const { future } = get();
    const next = future[future.length - 1];
    if (!next) return;
    get().commit((list) => restoreEditable(list, next), 'Redo');
    set({ future: future.slice(0, -1) });
  },

  async dispatchNow(vehicleId) {
    try {
      const plan = await api.dispatch(get().date, vehicleId);
      set({ confirmed: plan, plan });
    } catch (e) {
      get().toast({ kind: 'error', title: 'Dispatch failed', detail: String(e) });
    }
  },
  async recall(vehicleId) {
    try {
      const plan = await api.recall(get().date, vehicleId);
      set({ confirmed: plan, plan });
    } catch (e) {
      get().toast({ kind: 'error', title: 'Recall failed', detail: String(e) });
    }
  },

  previewRandomize(opts) {
    const scenarioOptions = { ...get().scenarioOptions, ...opts };
    const scenario = randomizePlan(get().ctx(), get().plan.assignments, scenarioOptions);
    set({ scenario, scenarioOptions });
  },
  rerollScenario() {
    get().previewRandomize({ seed: randomSeed() });
  },
  applyScenario() {
    const sc = get().scenario;
    if (!sc) return;
    const ok = get().commit(
      (list) => restoreEditable(list, sc.assignments),
      `Randomized plan · seed ${sc.seed} · ${sc.diff.moves.length} moves`,
    );
    if (ok) {
      set({ scenario: null, scenarioOptions: { ...get().scenarioOptions, seed: randomSeed() } });
      get().toast({
        kind: 'success',
        title: 'Randomized plan applied',
        detail: `${sc.stats.peopleAssigned} people on ${sc.stats.vehiclesStaffed} vehicles · ${sc.stats.projectsCovered} projects`,
        action: { label: 'Undo', run: () => get().undo() },
      });
    }
  },
  discardScenario: () => set({ scenario: null }),
  setPersonSelection: (personSelection) => set({ personSelection }),
  togglePersonSelected: (id) =>
    set((s) => ({
      personSelection: s.personSelection.includes(id) ? s.personSelection.filter((x) => x !== id) : [...s.personSelection, id],
    })),

  async setSimSpeed(speed) {
    try {
      const clock = await api.simSpeed(speed);
      set({ clock });
    } catch (e) {
      get().toast({ kind: 'error', title: 'Could not change simulation speed', detail: String(e) });
    }
  },

  async setDate(date) {
    if (date === get().date) return;
    try {
      const plan = await api.plan(date);
      set({ date, plan, confirmed: plan, history: [], future: [], scenario: null, pending: 0 });
      void get().refreshRoutes();
    } catch (e) {
      get().toast({ kind: 'error', title: 'Could not load plan', detail: String(e) });
    }
  },

  async copyPlanFrom(from) {
    try {
      const src = await api.plan(from);
      const ok = get().commit(
        (list) =>
          list.map((a) => {
            const o = src.assignments.find((x) => x.vehicleId === a.vehicleId);
            return o
              ? { ...a, crew: o.crew, lockedCrew: o.lockedCrew, destination: o.destination, destinationLocked: o.destinationLocked, departAt: o.departAt, returnAt: o.returnAt, note: o.note }
              : a;
          }),
        `Copied plan from ${from}`,
      );
      if (ok) get().toast({ kind: 'success', title: `Copied crews and destinations from ${from}`, action: { label: 'Undo', run: () => get().undo() } });
    } catch (e) {
      get().toast({ kind: 'error', title: 'Could not copy plan', detail: String(e) });
    }
  },

  async refreshRoutes() {
    const { plan, vehicles, projects, sites } = get();
    const legs = plan.assignments
      .map((a) => {
        const v = vehicles.find((x) => x.id === a.vehicleId);
        const site = sites.find((s) => s.id === v?.homeSiteId);
        const to = a.crew.length ? destinationLocation(a.destination, projects) : null;
        return v && site && to ? { id: v.id, from: site.location, to } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (!legs.length) return set({ routes: {} });
    try {
      const { routes } = await api.routes(legs);
      set({ routes });
    } catch {
      /* routes are decoration – ignore */
    }
  },

  ctx: () => {
    const { vehicles, people, projects, sites } = get();
    return { vehicles, people, projects, sites };
  },
  opsNow: () => {
    const { clock, skewMs } = get();
    return clock.opsEpoch + (Date.now() + skewMs - clock.realEpoch) * clock.speed;
  },
}));

// An expired session anywhere sends the user back to the sign-in screen.
if (typeof window !== 'undefined') {
  window.addEventListener(UNAUTHORIZED_EVENT, () => {
    const st = useStore.getState();
    if (st.authEnabled && st.auth === 'ok') {
      closeStream?.();
      closeStream = null;
      useStore.setState({ auth: 'signed-out', ready: false, user: null });
    }
  });
}

// Convenience selectors ---------------------------------------------------------------------
export const useVehicle = (id: ID | undefined) => useStore((s) => s.vehicles.find((v) => v.id === id));
export const usePerson = (id: ID | undefined) => useStore((s) => s.people.find((p) => p.id === id));
export const useProject = (id: ID | undefined) => useStore((s) => s.projects.find((p) => p.id === id));
export const useAssignment = (vehicleId: ID | undefined) =>
  useStore((s) => s.plan.assignments.find((a) => a.vehicleId === vehicleId));
