import type { ID, InventoryItem } from '@trackliv/core';
import { ArrowDownToLine, LoaderCircle, Package, PackagePlus, Search, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fmtTime } from '../lib/format';
import { locale, t, tx } from '../lib/i18n';
import { useStore } from '../lib/store';
import { IconButton, SectionLabel, cx } from './kit';

/**
 * Machines and equipment from Registra Atlas' Inventar, on a vehicle or left at a project. Putting an article
 * here marks it "In Benutzung" in Atlas (with where it is); "Back to stock" makes it available again. The
 * office invoices it in Atlas as before. Only shown when TrackLiv is connected to Atlas.
 */

/** Keep the store in step right away (the server broadcasts the same change a moment later). */
function applyItem(item: InventoryItem) {
  useStore.setState((s) => {
    const others = s.inventory.items.filter((x) => x.id !== item.id);
    return { inventory: { ...s.inventory, items: item.use ? [...others, item] : others } };
  });
}

/** Where an article is, in TrackLiv's own words (current call sign / project name; Atlas' label as fallback). */
export function useWhere() {
  const vehicles = useStore((s) => s.vehicles);
  const projects = useStore((s) => s.projects);
  return (item: InventoryItem) => {
    const u = item.use;
    if (!u) return '';
    if (u.kind === 'vehicle') return vehicles.find((v) => v.id === u.ref)?.callsign ?? u.label;
    return projects.find((p) => p.id === u.ref)?.name ?? u.label;
  };
}

/** Articles on a vehicle / at a project (for badges). */
export function useInventoryAt(kind: 'vehicle' | 'project', ref: ID) {
  const items = useStore((s) => s.inventory.items);
  return useMemo(() => items.filter((i) => i.use?.kind === kind && i.use.ref === ref).sort((a, b) => a.name.localeCompare(b.name, 'de')), [items, kind, ref]);
}

const sinceLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? fmtTime(iso) : d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });
};

export function InventorySection({ kind, refId, dropAt }: { kind: 'vehicle' | 'project'; refId: ID; dropAt?: { id: ID; name: string } }) {
  const enabled = useStore((s) => s.inventory.enabled);
  const error = useStore((s) => s.inventory.error);
  const here = useInventoryAt(kind, refId);
  const where = useWhere();
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  if (!enabled) return null;

  const run = async (id: string, fn: () => Promise<{ item: InventoryItem }>, done: (item: InventoryItem) => string) => {
    setBusy(id);
    try {
      const r = await fn();
      applyItem(r.item);
      useStore.getState().toast({ kind: 'success', title: done(r.item) });
    } catch (e) {
      useStore.getState().toast({ kind: 'error', title: t('Atlas Inventar'), detail: tx(e instanceof Error ? e.message : String(e)) });
    } finally {
      setBusy(null);
    }
  };
  const release = (item: InventoryItem) => run(item.id, () => api.inventoryRelease(item.id), (i) => t('{item} is back in stock', { item: i.name }));
  const drop = (item: InventoryItem, project: { id: ID; name: string }) =>
    run(item.id, () => api.inventoryUse(item.id, 'project', project.id), (i) => t('{item} left at {where}', { item: i.name, where: project.name }));

  return (
    <div data-inventory={kind}>
      <SectionLabel right={<span className="text-[11px] text-muted">{here.length}</span>}>{t('Equipment & material')}</SectionLabel>
      <div className="mt-1.5 space-y-0.5">
        {here.length === 0 && !picking && (
          <div className="py-1 text-[12px] text-muted">{kind === 'vehicle' ? t('Nothing from the inventory on board.') : t('Nothing from the inventory left here.')}</div>
        )}
        {here.map((item) => (
          <div key={item.id} className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-panel-3" data-inventory-item={item.id}>
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-panel-2 text-ink-2 ring-1 ring-line">
              {busy === item.id ? <LoaderCircle size={14} className="animate-spin" /> : <Package size={14} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {item.name}
                {item.number && <span className="mono ml-1.5 text-[10.5px] font-medium text-muted">{item.number}</span>}
              </span>
              <span className="block truncate text-[11px] text-muted">
                {item.stock}
                {item.use ? ` · ${t('since {time}', { time: sinceLabel(item.use.since) })}` : ''}
                {item.use?.by ? ` · ${item.use.by}` : ''}
              </span>
            </span>
            {dropAt && (
              <IconButton size="sm" label={t('Leave at {where}', { where: dropAt.name })} disabled={!!busy} onClick={() => drop(item, dropAt)}>
                <ArrowDownToLine size={13} />
              </IconButton>
            )}
            <IconButton size="sm" label={t('Back to stock')} disabled={!!busy} onClick={() => release(item)}>
              <Undo2 size={13} />
            </IconButton>
          </div>
        ))}
        {!picking ? (
          <button
            onClick={() => setPicking(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line-strong px-2 py-1.5 text-[12px] font-semibold text-muted hover:border-primary hover:text-primary"
            data-inventory-add
          >
            <PackagePlus size={14} />{' '}{t('Add from the Atlas inventory')}
          </button>
        ) : (
          <InventoryPicker
            kind={kind}
            refId={refId}
            where={where}
            onClose={() => setPicking(false)}
            onPick={(item) =>
              run(item.id, () => api.inventoryUse(item.id, kind, refId), (i) => {
                setPicking(false);
                return kind === 'vehicle' ? t('{item} loaded', { item: i.name }) : t('{item} left here', { item: i.name });
              })
            }
            busy={busy}
          />
        )}
        {error && <div className="pt-1 text-[11px] text-warning">{t('Atlas Inventar')}: {tx(error)}</div>}
      </div>
    </div>
  );
}

function InventoryPicker({
  kind,
  refId,
  where,
  onPick,
  onClose,
  busy,
}: {
  kind: 'vehicle' | 'project';
  refId: ID;
  where: (i: InventoryItem) => string;
  onPick: (i: InventoryItem) => void;
  onClose: () => void;
  busy: string | null;
}) {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    let alive = true;
    api
      .inventoryAvailable()
      .then((r) => alive && setItems(r.items))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rank = (i: InventoryItem) => (i.available ? 0 : i.use ? 1 : 2);
    return (items ?? [])
      .filter((i) => !(i.use?.kind === kind && i.use.ref === refId))
      .filter((i) => !needle || `${i.name} ${i.number ?? ''} ${i.stock} ${i.status}`.toLowerCase().includes(needle))
      .sort((a, b) => rank(a) - rank(b) || a.stock.localeCompare(b.stock, 'de') || a.name.localeCompare(b.name, 'de'));
  }, [items, q, kind, refId]);

  return (
    <div className="rounded-lg border border-line-strong bg-panel-solid" data-inventory-picker>
      <div className="flex items-center gap-1.5 border-b border-line px-2">
        <Search size={13} className="text-muted" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder={t('Search the Atlas inventory…')}
          className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
        />
        <IconButton size="sm" label={t('Close')} onClick={onClose}>
          <X size={13} />
        </IconButton>
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {!items && !err && (
          <div className="flex items-center gap-2 px-2 py-2 text-[12px] text-muted">
            <LoaderCircle size={13} className="animate-spin" /> {t('Loading the inventory from Atlas…')}
          </div>
        )}
        {err && <div className="px-2 py-2 text-[12px] text-danger">{tx(err)}</div>}
        {items && list.length === 0 && <div className="px-2 py-2 text-[12px] text-muted">{items.length ? t('Nothing found.') : t('Your Atlas inventories are empty.')}</div>}
        {list.map((i) => {
          const movable = !i.available && !!i.use;
          const blocked = !i.available && !i.use;
          return (
            <button
              key={i.id}
              disabled={blocked || !!busy}
              onClick={() => onPick(i)}
              className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel-3 disabled:cursor-not-allowed disabled:opacity-50')}
              data-inventory-option={i.id}
            >
              {busy === i.id ? <LoaderCircle size={14} className="shrink-0 animate-spin text-muted" /> : <Package size={14} className="shrink-0 text-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold">
                  {i.name}
                  {i.number && <span className="mono ml-1.5 text-[10.5px] font-medium text-muted">{i.number}</span>}
                </span>
                <span className="block truncate text-[11px] text-muted">
                  {i.stock}
                  {movable ? ` · ${t('at {where}, move here', { where: where(i) })}` : i.status ? ` · ${i.status}` : ''}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="border-t border-line px-2.5 py-1.5 text-[10.5px] leading-snug text-muted">
        {t('Atlas then shows it as "In Benutzung" with where it is; invoicing stays in Atlas.')}
      </div>
    </div>
  );
}
