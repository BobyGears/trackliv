import { fullName } from '@trackliv/core';
import {
  Building2,
  CalendarRange,
  Crosshair,
  Database,
  Gauge,
  Moon,
  Redo2,
  ScanSearch,
  Search,
  Shuffle,
  Truck,
  Undo2,
  UserRound,
  Users,
  Warehouse,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { Kbd, cx } from './kit';
import { vehicleDesc } from '../lib/derived';

interface Item {
  id: string;
  group: string;
  icon: ReactNode;
  title: string;
  sub?: string;
  keywords: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const vehicles = useStore((s) => s.vehicles);
  const people = useStore((s) => s.people);
  const projects = useStore((s) => s.projects);
  const sites = useStore((s) => s.sites);
  const mode = useStore((s) => s.mode);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const st = useStore.getState;
    const close = () => st().setPalette(false);
    const goObj = (type: 'vehicle' | 'person' | 'project' | 'site', id: string) => () => {
      close();
      st().setView('map');
      st().select({ type, id }, { focus: type !== 'person' });
    };
    const actions: Item[] = [
      { id: 'a-rand', group: 'Actions', icon: <Shuffle size={15} />, title: 'Randomize assignments', sub: 'Preview a random crew/project plan – pins are kept', keywords: 'random shuffle shake assign plan', run: () => { close(); st().setView('dispatch'); st().previewRandomize(); } },
      { id: 'a-disp', group: 'Actions', icon: <Users size={15} />, title: 'Open dispatch board', keywords: 'board crew roster assign', run: () => { close(); st().setView('dispatch'); } },
      { id: 'a-sched', group: 'Actions', icon: <CalendarRange size={15} />, title: 'Open schedule', keywords: 'gantt timeline time', run: () => { close(); st().setView('schedule'); } },
      { id: 'a-data', group: 'Actions', icon: <Database size={15} />, title: 'Manage projects, crew & vehicles', keywords: 'data master add new project person vehicle edit settings', run: () => { close(); st().setView('data'); } },
      { id: 'a-fit', group: 'Actions', icon: <ScanSearch size={15} />, title: 'Show all projects', sub: 'Regional overview', keywords: 'fit overview region map zoom', run: () => { close(); st().setView('map'); st().select(null); st().requestFocus({ kind: 'fit-all' }); } },
      { id: 'a-theme', group: 'Actions', icon: <Moon size={15} />, title: 'Toggle dark mode', keywords: 'theme dark light night', run: () => { close(); st().toggleTheme(); } },
      { id: 'a-undo', group: 'Actions', icon: <Undo2 size={15} />, title: 'Undo last change', keywords: 'undo revert', run: () => { close(); st().undo(); } },
      { id: 'a-redo', group: 'Actions', icon: <Redo2 size={15} />, title: 'Redo', keywords: 'redo', run: () => { close(); st().redo(); } },
      ...(mode === 'simulator'
        ? [1, 10, 60].map((sp) => ({ id: `a-sim-${sp}`, group: 'Actions', icon: <Gauge size={15} />, title: `Simulation speed ×${sp}`, keywords: `sim speed fast ${sp}`, run: () => { close(); void st().setSimSpeed(sp); } }))
        : []),
    ];
    return [
      ...actions,
      ...sites.map((s) => ({ id: `s-${s.id}`, group: 'HQs', icon: <Warehouse size={15} />, title: `${s.name} (3D)`, sub: s.address, keywords: `${s.code} ${s.name} ${s.address} hq depot lager`, run: goObj('site', s.id) })),
      ...vehicles.map((v) => ({ id: `v-${v.id}`, group: 'Vehicles', icon: <Truck size={15} />, title: `${v.callsign} · ${v.plate}`, sub: vehicleDesc(v), keywords: `${v.callsign} ${v.plate} ${v.make} ${v.model} ${v.kind}`, run: goObj('vehicle', v.id) })),
      ...people.map((p) => ({ id: `p-${p.id}`, group: 'Crew', icon: <UserRound size={15} />, title: fullName(p), sub: `${p.role}${p.status !== 'available' ? ` · ${p.status}` : ''}`, keywords: `${p.firstName} ${p.lastName} ${p.role} ${p.licenses.join(' ')}`, run: goObj('person', p.id) })),
      ...projects.map((p) => ({ id: `j-${p.id}`, group: 'Projects', icon: <Building2 size={15} />, title: p.name, sub: `${p.code} · ${p.address}`, keywords: `${p.name} ${p.code} ${p.client} ${p.address}`, run: goObj('project', p.id) })),
    ];
  }, [vehicles, people, projects, sites, mode]);

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = terms.length ? items.filter((it) => terms.every((t) => `${it.title} ${it.sub ?? ''} ${it.keywords}`.toLowerCase().includes(t))) : items.filter((i) => i.group === 'Actions' || i.group === 'HQs');
    return list.slice(0, 40);
  }, [q, items]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  let lastGroup = '';
  return (
    <div className="pointer-events-auto fixed inset-0 z-[80] bg-black/25 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().setPalette(false)}>
      <div className="glass fade-in mx-auto mt-[12vh] w-[620px] max-w-[calc(100%-32px)] overflow-hidden rounded-2xl shadow-float">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search size={17} className="text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                results[active]?.run();
              } else if (e.key === 'Escape') {
                useStore.getState().setPalette(false);
              }
            }}
            placeholder="Search vehicles, crew, projects, HQs – or type a command"
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-subtle"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} className="scroll-thin max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 && <div className="px-3 py-6 text-center text-muted">No results for “{q}”.</div>}
          {results.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {header && <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">{header}</div>}
                <button
                  data-idx={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={it.run}
                  className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left', active === i && 'bg-primary-weak')}
                >
                  <span className={cx('grid size-7 place-items-center rounded-md', active === i ? 'bg-primary text-white' : 'bg-panel-3 text-ink-2')}>{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{it.title}</span>
                    {it.sub && <span className="block truncate text-[11.5px] text-muted">{it.sub}</span>}
                  </span>
                  {active === i && <Crosshair size={14} className="text-primary" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-line bg-panel-2 px-4 py-2 text-[11px] text-muted">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span className="ml-auto">
            <Kbd>1</Kbd>–<Kbd>4</Kbd> switch view · <Kbd>R</Kbd> randomize · <Kbd>⌘Z</Kbd> undo
          </span>
        </div>
      </div>
    </div>
  );
}
