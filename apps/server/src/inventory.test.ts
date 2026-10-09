import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS test helper
import { startAtlasMock } from '../../../scripts/atlas-mock.mjs';
import { atlasApiConfig } from './atlasApi.ts';
import { Inventory } from './inventory.ts';

const KEY = 'ef01'.repeat(16);
const DISPO = { id: '22222222-2222-4222-8222-222222222222', name: 'Dana Dispo' };
const BUERO = { id: '33333333-3333-4333-8333-333333333333', name: 'Bodo Büro' };

describe("Registra Atlas' Inventar", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let atlas: any;
  beforeAll(async () => {
    atlas = await startAtlasMock({ anonKey: 'x'.repeat(32), tracklivKey: KEY });
  });
  afterAll(() => atlas.close());

  it('is off without the shared key', () => {
    expect(atlasApiConfig({ ATLAS_API_URL: 'http://x', ATLAS_TRACKLIV_KEY: 'short' })).toBeNull();
    const inv = new Inventory(null);
    expect(inv.current.enabled).toBe(false);
  });

  it('lists what this person may pick, puts it to use and takes it back', async () => {
    const changes: number[] = [];
    const inv = new Inventory(atlasApiConfig({ ATLAS_API_URL: atlas.url, ATLAS_TRACKLIV_KEY: KEY }), (s) => changes.push(s.items.length));
    await inv.sync();
    expect(inv.current).toMatchObject({ enabled: true, items: [] });

    const a = await inv.available(DISPO);
    expect(a.ok && a.items.map((i) => i.id).sort()).toEqual(['a-bagger', 'a-geruest', 'a-ruettler', 'a-saege']);
    const denied = await inv.available(BUERO);
    expect(denied).toMatchObject({ ok: false, status: 403 });

    const put = await inv.setUse('a-ruettler', { kind: 'vehicle', ref: 'veh-1', label: 'TE 710' }, DISPO);
    expect(put.ok && put.item.use).toMatchObject({ kind: 'vehicle', ref: 'veh-1', label: 'TE 710', by: 'Dana Dispo' });
    expect(inv.current.items.map((i) => i.id)).toEqual(['a-ruettler']);
    const broken = await inv.setUse('a-saege', { kind: 'vehicle', ref: 'veh-1', label: 'TE 710' }, DISPO);
    expect(broken).toMatchObject({ ok: false, status: 409 });

    // a change made in Atlas shows up with the next sync
    atlas.items.find((x: { id: string }) => x.id === 'a-ruettler').use = null;
    await inv.sync();
    expect(inv.current.items).toEqual([]);
    expect(changes).toEqual([1, 0]);
  });

  it('reports Atlas being unreachable without losing what it knew', async () => {
    const inv = new Inventory({ url: 'http://127.0.0.1:9', key: KEY, timeoutMs: 500 });
    await inv.sync();
    expect(inv.current).toMatchObject({ enabled: true, items: [], error: 'Atlas is not reachable' });
    expect(await inv.available(DISPO)).toMatchObject({ ok: false, status: 503 });
  });
});
