import type { InventoryItem, InventoryState, InventoryUse } from '@trackliv/core';
import { atlasApi, type AtlasApiConfig } from './atlasApi.ts';

/**
 * Registra Atlas' Inventar in TrackLiv: machines and equipment can be put on a vehicle or left at a project.
 * Atlas stays the source of truth – putting an article to use marks it "in Benutzung" in Atlas (with where it
 * is and who did it), taking it back makes it available again. The office invoices it in Atlas as before.
 *
 * Atlas' permissions apply: the picker lists only the inventories (Bestände) the signed-in person may see in
 * Atlas, and Atlas checks every change against that person. What is already on a vehicle or at a project is
 * shown to everyone in TrackLiv (it is part of the dispatch picture).
 *
 * Atlas' internal routes (review-api, shared key – see atlasApi.ts):
 *   GET  /api/trackliv/intern/inventar?nur=einsatz           → { artikel } in use from TrackLiv (all inventories)
 *   GET  /api/trackliv/intern/inventar?benutzer=<atlas uid>  → { artikel } this person may see
 *   POST /api/trackliv/intern/inventar/:id/einsatz           { use: {kind, ref, label} | null, actor } → { artikel }
 */

/** The signed-in person (their Atlas account). */
export interface Actor {
  id: string;
  name: string;
  email?: string;
}

type Listener = (state: InventoryState) => void;

export class Inventory {
  private state: InventoryState;
  private timer: NodeJS.Timeout | null = null;
  private syncing: Promise<void> | null = null;

  constructor(
    private cfg: AtlasApiConfig | null,
    private onChange: Listener = () => {},
    private pollMs = 30_000,
  ) {
    this.state = { enabled: !!cfg, items: [] };
  }

  get current(): InventoryState {
    return this.state;
  }

  start() {
    if (!this.cfg || this.timer) return;
    void this.sync();
    this.timer = setInterval(() => void this.sync(), this.pollMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Tell the screens only when something they show changed (not for every sync time). */
  private set(next: Partial<InventoryState>) {
    const shown = (s: InventoryState) => JSON.stringify([s.enabled, s.items, s.error ?? null]);
    const prev = shown(this.state);
    this.state = { ...this.state, ...next };
    if (shown(this.state) !== prev) this.onChange(this.state);
  }

  /** Fetch the articles in use from TrackLiv (one request at a time). */
  sync(): Promise<void> {
    if (!this.cfg) return Promise.resolve();
    this.syncing ??= (async () => {
      const r = await atlasApi<{ artikel: InventoryItem[] }>(this.cfg!, 'GET', '/api/trackliv/intern/inventar?nur=einsatz');
      if (r.ok && Array.isArray(r.data?.artikel)) this.set({ items: r.data.artikel, syncedAt: new Date().toISOString(), error: undefined });
      else this.set({ error: r.ok ? 'Unexpected answer from Atlas' : r.status === 0 ? 'Atlas is not reachable' : r.error });
    })().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  /** Everything this person may see in Atlas' Inventar (for the picker). */
  async available(actor: Actor): Promise<{ ok: true; items: InventoryItem[] } | { ok: false; status: number; error: string }> {
    if (!this.cfg) return { ok: false, status: 503, error: 'Atlas Inventar is not connected' };
    const r = await atlasApi<{ artikel: InventoryItem[] }>(this.cfg, 'GET', `/api/trackliv/intern/inventar?benutzer=${encodeURIComponent(actor.id)}`);
    if (!r.ok) return { ok: false, status: r.status || 503, error: r.status === 0 ? 'Atlas is not reachable' : r.error };
    return { ok: true, items: Array.isArray(r.data?.artikel) ? r.data.artikel : [] };
  }

  /** Put an article to use on a vehicle / at a project (use = null: back to stock). */
  async setUse(id: string, use: Omit<InventoryUse, 'since' | 'by'> | null, actor: Actor): Promise<{ ok: true; item: InventoryItem } | { ok: false; status: number; error: string }> {
    if (!this.cfg) return { ok: false, status: 503, error: 'Atlas Inventar is not connected' };
    const r = await atlasApi<{ artikel: InventoryItem }>(this.cfg, 'POST', `/api/trackliv/intern/inventar/${encodeURIComponent(id)}/einsatz`, { use, actor });
    if (!r.ok) return { ok: false, status: r.status || 503, error: r.status === 0 ? 'Atlas is not reachable' : r.error };
    const item = r.data.artikel;
    const others = this.state.items.filter((x) => x.id !== item.id);
    this.set({ items: item.use ? [...others, item] : others });
    return { ok: true, item };
  }
}
