import { formatDistance, haversineM, type Destination, type ID, type LngLat } from '@trackliv/core';
import { Crosshair, Loader2, Lock, MapPin, Search, Unlock, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { PRIORITY_TONE } from '../lib/format';
import { useStore } from '../lib/store';
import { cx, Pill, Toggle } from './kit';

interface Props {
  anchor: HTMLElement;
  vehicleId: ID;
  value: Destination | null;
  locked: boolean;
  onSelect: (dest: Destination | null, lock: boolean) => void;
  onClose: () => void;
  /** Offer "drop a pin on the map" (sets the destination of `vehicleId` directly). */
  allowMapPick?: boolean;
}

type Row =
  | { kind: 'project'; id: ID }
  | { kind: 'label'; label: string }
  | { kind: 'geo'; label: string; location: LngLat };

export function DestinationPicker({ anchor, vehicleId, value, locked, onSelect, onClose, allowMapPick = true }: Props) {
  const projects = useStore((s) => s.projects);
  const vehicles = useStore((s) => s.vehicles);
  const sites = useStore((s) => s.sites);
  const plan = useStore((s) => s.plan);
  const [q, setQ] = useState('');
  const [lock, setLock] = useState(locked || false);
  const [geo, setGeo] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [geoState, setGeoState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [geoError, setGeoError] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number }>({ left: 0, top: 0, maxH: 480 });

  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const home = sites.find((s) => s.id === vehicle?.homeSiteId)?.location;

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const W = 400;
    const left = Math.min(window.innerWidth - W - 12, Math.max(12, r.left));
    const below = window.innerHeight - r.bottom - 16;
    const above = r.top - 16;
    if (below >= 360 || below >= above) setPos({ left, top: r.bottom + 6, maxH: Math.min(560, below) });
    else setPos({ left, top: Math.max(12, r.top - Math.min(560, above) - 6), maxH: Math.min(560, above) });
  }, [anchor]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [anchor, onClose]);

  // Address search (debounced)
  useEffect(() => {
    setGeo([]);
    if (q.trim().length < 4) return setGeoState('idle');
    setGeoState('loading');
    const t = setTimeout(async () => {
      try {
        const r = await api.geocode(q.trim());
        setGeo(r.results);
        setGeoState('idle');
      } catch (e) {
        setGeoError(e instanceof Error ? e.message : String(e));
        setGeoState('error');
      }
    }, 450);
    return () => clearTimeout(t);
  }, [q]);

  const crewByProject = useMemo(() => {
    const m = new Map<ID, number>();
    for (const a of plan.assignments) if (a.destination?.kind === 'project') m.set(a.destination.projectId, (m.get(a.destination.projectId) ?? 0) + a.crew.length);
    return m;
  }, [plan]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects
      .filter((p) => p.status !== 'completed')
      .filter((p) => !needle || `${p.name} ${p.code} ${p.client} ${p.address}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const order = { active: 0, planned: 1, paused: 2, completed: 3 };
        return order[a.status] - order[b.status] || (home ? haversineM(home, a.location) - haversineM(home, b.location) : 0);
      });
  }, [projects, q, home]);

  const rows: Row[] = [
    ...list.map((p) => ({ kind: 'project' as const, id: p.id })),
    ...(q.trim().length >= 2 ? [{ kind: 'label' as const, label: q.trim() }] : []),
    ...geo.map((g) => ({ kind: 'geo' as const, label: g.label, location: { lng: g.lng, lat: g.lat } })),
  ];

  const choose = (row: Row) => {
    if (row.kind === 'project') onSelect({ kind: 'project', projectId: row.id }, lock);
    else if (row.kind === 'label') onSelect({ kind: 'custom', label: row.label }, lock);
    else onSelect({ kind: 'custom', label: row.label.split(',').slice(0, 2).join(','), address: row.label, location: row.location }, lock);
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && rows[active]) {
      e.preventDefault();
      choose(rows[active]);
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="glass fade-in fixed z-[70] flex w-[400px] flex-col overflow-hidden rounded-2xl shadow-float"
      style={{ left: pos.left, top: pos.top, maxHeight: pos.maxH }}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Search size={15} className="text-muted" />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          placeholder="Search projects, or type a custom destination / address…"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
        />
        <button onClick={onClose} className="text-muted hover:text-ink">
          <X size={15} />
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">Projects</div>
        {list.length === 0 && <div className="px-2 py-2 text-[12px] text-muted">No project matches “{q}”.</div>}
        {list.map((p, i) => {
          const isCurrent = value?.kind === 'project' && value.projectId === p.id;
          const crew = crewByProject.get(p.id) ?? 0;
          return (
            <button
              key={p.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose({ kind: 'project', id: p.id })}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
                active === i ? 'bg-panel-3' : '',
                p.status !== 'active' && 'opacity-60',
              )}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-semibold">{p.name}</span>
                  {isCurrent && <Pill tone="primary">current</Pill>}
                  {p.status !== 'active' && <Pill>{p.status}</Pill>}
                </span>
                <span className="block truncate text-[11px] text-muted">
                  <span className="mono">{p.code}</span> · {p.address}
                </span>
              </span>
              <span className="shrink-0 text-right text-[11px] leading-tight">
                <span className="block font-semibold text-ink-2">{home ? formatDistance(haversineM(home, p.location)) : ''}</span>
                <span className={cx('block', crew >= (p.crewTarget ?? 0) ? 'text-success' : 'text-muted')}>
                  {crew}/{p.crewTarget ?? '–'} crew
                </span>
              </span>
              <Pill tone={PRIORITY_TONE[p.priority]} className="hidden sm:inline-flex">
                {p.priority}
              </Pill>
            </button>
          );
        })}

        <div className="px-2 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">Custom destination</div>
        {q.trim().length >= 2 && (
          <button
            onMouseEnter={() => setActive(list.length)}
            onClick={() => choose({ kind: 'label', label: q.trim() })}
            className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', active === list.length && 'bg-panel-3')}
          >
            <MapPin size={15} className="text-violet" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">Use “{q.trim()}”</span>
              <span className="block text-[11px] text-muted">Label only – drop a pin to enable arrival tracking</span>
            </span>
          </button>
        )}
        {geoState === 'loading' && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-muted">
            <Loader2 size={13} className="animate-spin" /> Looking up address…
          </div>
        )}
        {geoState === 'error' && <div className="px-2 py-1.5 text-[11.5px] text-warning">{geoError}</div>}
        {geo.map((g, i) => {
          const idx = list.length + (q.trim().length >= 2 ? 1 : 0) + i;
          return (
            <button
              key={`${g.lat},${g.lng}`}
              onMouseEnter={() => setActive(idx)}
              onClick={() => choose({ kind: 'geo', label: g.label, location: { lng: g.lng, lat: g.lat } })}
              className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', active === idx && 'bg-panel-3')}
            >
              <MapPin size={15} className="text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{g.label}</span>
                <span className="block text-[11px] text-muted">
                  {home ? `${formatDistance(haversineM(home, g))} from ${vehicle?.callsign ?? ''} depot` : ''}
                </span>
              </span>
            </button>
          );
        })}
        {allowMapPick && (
        <button
          onClick={() => {
            const st = useStore.getState();
            const lock_ = lock;
            st.setView('map');
            st.setMapPick({
              label: `Click on the map to set ${vehicle?.callsign ?? 'the vehicle'}’s destination`,
              onPick: (loc) => {
                const label = q.trim() || `Pin ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`;
                onSelect({ kind: 'custom', label, location: loc }, lock_);
                useStore.getState().toast({ kind: 'success', title: `${vehicle?.callsign ?? 'Vehicle'} → ${label}`, detail: 'Type a name in the search box first to label the pin.' });
              },
            });
            onClose();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-panel-3"
        >
          <Crosshair size={15} className="text-ink-2" />
          <span>
            <span className="block font-semibold">Drop a pin on the map</span>
            <span className="block text-[11px] text-muted">Click anywhere to set an exact destination</span>
          </span>
        </button>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-2 px-3 py-1.5">
        <div className="flex-1">
          <Toggle
            on={lock}
            onChange={setLock}
            label={
              <span className="inline-flex items-center gap-1.5 text-[12px]">
                {lock ? <Lock size={12} /> : <Unlock size={12} />} Pin destination
              </span>
            }
            hint="Randomize keeps pinned destinations"
          />
        </div>
        {value && (
          <button
            onClick={() => {
              onSelect(null, false);
              onClose();
            }}
            className="text-[12px] font-semibold text-danger hover:underline"
          >
            Clear
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
