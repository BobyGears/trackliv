import { isAtDepot } from '@trackliv/core';
import { Bell, CalendarRange, ChevronDown, Gauge, Map as MapIcon, Moon, Search, Sun, Users, Warehouse } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useOpsNow } from '../lib/derived';
import { fmtAgo, fmtDate, fmtTimeSec } from '../lib/format';
import { useStore, type View } from '../lib/store';
import { cx, IconButton, Kbd, Panel, Segmented } from './kit';

function Logo() {
  return (
    <div className="flex items-center gap-2 pr-1">
      <div className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-[#4f86ff] to-[#1f4fd6] shadow-[0_4px_12px_-2px_rgb(47_107_255/0.5)]">
        <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
          <path d="M16 5 27 11.3 16 17.6 5 11.3z" fill="#fff" />
          <path d="M5 14.5 14.6 20v9.5L5 24z" fill="#fff" opacity=".85" />
          <path d="M27 14.5 17.4 20v9.5L27 24z" fill="#fff" opacity=".6" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-bold tracking-tight">TrackLiv</div>
        <div className="text-[10px] font-medium text-muted">DTE GmbH · Dispatch</div>
      </div>
    </div>
  );
}

function SiteSwitcher() {
  const [open, setOpen] = useState(false);
  const sites = useStore((s) => s.sites);
  const vehicles = useStore((s) => s.vehicles);
  const telemetry = useStore((s) => s.telemetry);
  const selection = useStore((s) => s.selection);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);
  const current = selection?.type === 'site' ? sites.find((s) => s.id === selection.id) : null;
  const inYard = (siteId?: string) =>
    vehicles.filter((v) => (!siteId || v.homeSiteId === siteId) && telemetry[v.id] && isAtDepot(telemetry[v.id], siteId ? sites.filter((s) => s.id === siteId) : sites)).length;
  const go = (id: string | null) => {
    setOpen(false);
    const st = useStore.getState();
    st.setView('map');
    if (id) st.select({ type: 'site', id }, { focus: true });
    else {
      st.select(null);
      st.requestFocus({ kind: 'fit-all' });
    }
  };
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex h-9 items-center gap-2 rounded-xl border border-line bg-panel-solid px-2 pr-2.5 text-left hover:bg-panel-2"
      >
        <span className="grid size-6 place-items-center rounded-md text-white" style={{ background: current?.color ?? '#1f4fd6' }}>
          <Warehouse size={13} />
        </span>
        <span className="leading-tight">
          <span className="block max-w-44 truncate text-[12px] font-semibold">{current ? current.name : 'All projects · Rhein-Main'}</span>
          <span className="block text-[10.5px] text-muted">
            {current ? `${inYard(current.id)} in yard · ${current.code}` : `${inYard()}/${vehicles.length} vehicles in yard`}
          </span>
        </span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <Panel className="fade-in absolute right-0 top-11 z-50 w-72 p-1.5 shadow-float">
          <button onClick={() => go(null)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-panel-3">
            <span className="grid size-7 place-items-center rounded-md bg-panel-3 text-ink-2">
              <MapIcon size={14} />
            </span>
            <span>
              <span className="block font-semibold">Overview · all projects</span>
              <span className="block text-[11px] text-muted">Rhein-Main region</span>
            </span>
          </button>
          {sites.map((s) => (
            <button key={s.id} onClick={() => go(s.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-panel-3">
              <span className="grid size-7 place-items-center rounded-md text-white" style={{ background: s.color }}>
                <Warehouse size={14} />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">
                  {s.name} <span className="mono text-[10.5px] text-muted">{s.code}</span>
                </span>
                <span className="block truncate text-[11px] text-muted">{s.address} · 3D</span>
              </span>
            </button>
          ))}
        </Panel>
      )}
    </div>
  );
}

function LiveClock() {
  const now = useOpsNow();
  const mode = useStore((s) => s.mode);
  const fleet = useStore((s) => s.fleet);
  const connected = useStore((s) => s.connected);
  const clock = useStore((s) => s.clock);
  const date = useStore((s) => s.today);
  const [open, setOpen] = useState(false);
  const ok = connected && fleet.connected;
  return (
    <div className="relative">
      <button
        onClick={() => mode === 'simulator' && setOpen(!open)}
        title={mode === 'fleetgo' ? `FleetGO · last sync ${fmtAgo(fleet.lastSync, now)}${fleet.error ? ` · ${fleet.error}` : ''}` : 'Simulated fleet (no FleetGO credentials configured)'}
        className="flex h-9 items-center gap-2 rounded-xl border border-line bg-panel-solid px-2.5"
      >
        <span className={cx('size-2 rounded-full', ok ? 'live-dot bg-success' : 'bg-danger')} />
        <span className={cx('text-[12px] font-semibold', ok ? 'text-success' : 'text-danger')}>{ok ? 'Live' : 'Offline'}</span>
        <span className="mono text-[12px] font-semibold text-ink">{fmtTimeSec(now)}</span>
        <span className="hidden text-[11px] text-muted xl:inline">{date && fmtDate(date)}</span>
        <span className={cx('rounded-md px-1.5 py-0.5 text-[10px] font-bold', mode === 'fleetgo' ? 'bg-success-weak text-success' : 'bg-violet-weak text-violet')}>
          {mode === 'fleetgo' ? 'FleetGO' : `SIM ×${clock.speed}`}
        </span>
      </button>
      {open && (
        <Panel className="fade-in absolute right-0 top-11 z-50 w-64 p-3 shadow-float">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <Gauge size={14} /> Simulation speed
          </div>
          <p className="mb-2 text-[11.5px] text-muted">No FleetGO credentials configured – vehicles are simulated on the real road network. Speed up to watch the day play out.</p>
          <div className="grid grid-cols-5 gap-1">
            {[1, 10, 30, 60, 300].map((s) => (
              <button
                key={s}
                onClick={() => {
                  void useStore.getState().setSimSpeed(s);
                  setOpen(false);
                }}
                className={cx('h-7 rounded-md text-[12px] font-semibold', clock.speed === s ? 'bg-primary text-white' : 'bg-panel-3 hover:bg-panel-2')}
              >
                ×{s}
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function PlanDateChip() {
  const date = useStore((s) => s.date);
  const today = useStore((s) => s.today);
  if (!date || date === today) return null;
  return (
    <button
      onClick={() => useStore.getState().setDate(today)}
      className="flex h-9 items-center gap-1.5 rounded-xl bg-violet-weak px-3 text-[12px] font-semibold text-violet"
      title="You are editing another day's plan – click to go back to today"
    >
      <CalendarRange size={14} /> Planning {fmtDate(date)}
      <span className="hidden font-medium opacity-80 2xl:inline">· back to today</span>
    </button>
  );
}

export function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const unread = useStore((s) => s.unread);
  const eventsOpen = useStore((s) => s.eventsOpen);
  const [user, setUser] = useState(() => {
    try {
      return localStorage.getItem('trackliv:user') || 'Dispatcher';
    } catch {
      return 'Dispatcher';
    }
  });
  return (
    <Panel className="pointer-events-auto absolute inset-x-3 top-3 z-30 flex h-[52px] items-center gap-3 px-2.5">
      <Logo />
      <div className="h-6 w-px bg-line" />
      <Segmented<View>
        value={view}
        onChange={setView}
        options={[
          { value: 'map', label: <><MapIcon size={14} /> Map</>, title: 'Map (1)' },
          { value: 'dispatch', label: <><Users size={14} /> Dispatch</>, title: 'Dispatch board (2)' },
          { value: 'schedule', label: <><CalendarRange size={14} /> Schedule</>, title: 'Schedule (3)' },
        ]}
      />
      <button
        onClick={() => useStore.getState().setPalette(true)}
        className="flex h-9 min-w-[150px] max-w-[460px] flex-1 items-center gap-2 rounded-xl border border-line bg-panel-2 px-3 text-left text-muted hover:border-line-strong"
      >
        <Search size={15} className="shrink-0" />
        <span className="flex-1 truncate">Search vehicles, crew, projects…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="flex-1" />
      <PlanDateChip />
      <SiteSwitcher />
      <LiveClock />
      <IconButton label={theme === 'light' ? 'Dark mode' : 'Light mode'} onClick={toggleTheme}>
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
      </IconButton>
      <div className="relative">
        <IconButton label="Event log" active={eventsOpen} onClick={() => useStore.getState().setEventsOpen(!eventsOpen)}>
          <Bell size={16} />
        </IconButton>
        {unread > 0 && (
          <span className="pointer-events-none absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9.5px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </div>
      <button
        className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-panel-3"
        title="Click to change your name (shown in the audit log)"
        onClick={() => {
          const name = prompt('Your name for the audit log', user);
          if (name) {
            try {
              localStorage.setItem('trackliv:user', name);
            } catch {
              /* ignore */
            }
            setUser(name);
          }
        }}
      >
        <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-slate-500 to-slate-700 text-[12px] font-bold text-white">
          {user
            .split(' ')
            .map((s) => s[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <span className="hidden text-left leading-tight lg:block">
          <span className="block text-[12px] font-semibold">{user}</span>
          <span className="block text-[10.5px] text-muted">Operations</span>
        </span>
      </button>
    </Panel>
  );
}
