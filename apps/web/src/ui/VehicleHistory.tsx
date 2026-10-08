import type { ID, Stop, Trip } from '@trackliv/core';
import { Building2, CalendarDays, ChevronLeft, ChevronRight, Loader2, MapPin, Route as RouteIcon, Warehouse } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type VehicleHistory as History } from '../lib/api';
import { addDays, fmtDate, fmtDistance, fmtDuration, fmtTime, opsDate } from '../lib/format';
import { plural, t } from '../lib/i18n';
import { useStore } from '../lib/store';
import { IconButton, SectionLabel, cx } from './kit';

/** Days TrackLiv keeps (apps/server/src/history.ts). */
const KEEP_DAYS = 120;
const STOP_COLOR = { site: '#1f4fd6', project: '#12a150', other: '#64748b' } as const;

type Entry = { kind: 'stop'; stop: Stop; n: number } | { kind: 'trip'; trip: Trip; i: number };

const ms = (s: number) => s * 1000;

function bbox(coords: [number, number][]): [number, number, number, number] | null {
  if (!coords.length) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of coords) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [w, s, e, n];
}

/**
 * Where a vehicle was on one day – like FleetGO's trip list: stops (depot, project or address) and the
 * trips between them, drawn on the map while this tab is open.
 */
export function VehicleHistory({ vehicleId }: { vehicleId: ID }) {
  const opsNow = useStore((s) => s.opsNow);
  const today = opsDate(opsNow());
  const [date, setDate] = useState(today);
  const [data, setData] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useStore((s) => s.track?.active ?? null);
  const setTrack = useStore((s) => s.setTrack);
  const requestFocus = useStore((s) => s.requestFocus);

  useEffect(() => {
    let alive = true;
    let first = true;
    setData(null);
    setLoading(true);
    const load = async () => {
      try {
        const h = await api.history(vehicleId, date);
        if (!alive) return;
        setData(h);
        setError(null);
        const prev = useStore.getState().track;
        const same = prev?.history.vehicleId === vehicleId && prev.history.date === date;
        setTrack({ history: h, active: same ? prev.active : null });
        if (first) {
          const b = bbox(h.points.map((p) => [p[1], p[2]]));
          if (b) requestFocus({ kind: 'bounds', bounds: b });
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
        first = false;
      }
    };
    void load();
    // today's track keeps growing
    const timer = date === opsDate(useStore.getState().opsNow()) ? setInterval(load, 60_000) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [vehicleId, date, setTrack, requestFocus]);

  // the track disappears from the map with the tab
  useEffect(() => () => useStore.getState().setTrack(null), []);

  const entries = useMemo<Entry[]>(() => {
    if (!data) return [];
    const list: Entry[] = [...data.stops.map((stop, k) => ({ kind: 'stop' as const, stop, n: k + 1 })), ...data.trips.map((trip, i) => ({ kind: 'trip' as const, trip, i }))];
    const start = (e: Entry) => (e.kind === 'stop' ? e.stop.start : e.trip.start);
    return list.sort((a, b) => start(a) - start(b) || (a.kind === 'stop' ? -1 : 1));
  }, [data]);

  const days = data?.days ?? [];
  const prevDay = days.find((d) => d < date) ?? addDays(date, -1);
  const nextDay = [...days].reverse().find((d) => d > date && d <= today) ?? (date < today ? addDays(date, 1) : null);
  const isToday = date === today;
  const oldest = addDays(today, -KEEP_DAYS);

  const focusTrip = (trip: Trip) => {
    if (!data) return;
    const b = bbox(data.points.filter((p) => p[0] >= trip.start && p[0] <= trip.end).map((p) => [p[1], p[2]]));
    if (b) requestFocus({ kind: 'bounds', bounds: b });
  };
  const hover = (i: number | null) => {
    const tr = useStore.getState().track;
    if (tr && tr.active !== i) setTrack({ ...tr, active: i });
  };

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex items-center gap-1.5">
        <IconButton size="sm" label={t('Previous day')} disabled={prevDay < oldest} onClick={() => setDate(prevDay)}>
          <ChevronLeft size={15} />
        </IconButton>
        <label className="relative flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line bg-panel-2 text-[12.5px] font-semibold hover:border-line-strong">
          <CalendarDays size={13} className="text-muted" />
          {fmtDate(date)}
          {isToday && <span className="font-medium text-primary">· {t('Today')}</span>}
          <input
            type="date"
            aria-label={t('Choose a day')}
            className="absolute inset-0 cursor-pointer opacity-0"
            value={date}
            min={oldest}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value > today ? today : e.target.value)}
          />
        </label>
        <IconButton size="sm" label={t('Next day')} disabled={!nextDay} onClick={() => nextDay && setDate(nextDay)}>
          <ChevronRight size={15} />
        </IconButton>
        {!isToday && (
          <button onClick={() => setDate(today)} className="h-8 rounded-lg px-2 text-[12px] font-semibold text-primary hover:bg-primary-weak">
            {t('Today')}
          </button>
        )}
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted">
          <Loader2 size={14} className="animate-spin" /> {t('Loading history…')}
        </div>
      )}
      {error && !data && <div className="rounded-lg bg-danger-weak px-3 py-2 text-[12px] text-danger">{t('Could not load the history')}</div>}

      {data && (
        <>
          <div className={cx('grid grid-cols-3 gap-1.5', !entries.length && 'hidden')}>
            <Total label={t('Distance')} value={fmtDistance(data.totals.distanceM)} />
            <Total label={t('Driving')} value={fmtDuration(data.totals.drivingS / 60)} />
            <Total label={t('Stops')} value={String(data.totals.stops)} />
          </div>
          {data.totals.firstDeparture !== undefined && (
            <div className="text-center text-[11.5px] text-muted">
              {t('On the road {from} – {to}', { from: fmtTime(ms(data.totals.firstDeparture)), to: fmtTime(ms(data.totals.lastArrival ?? data.totals.firstDeparture)) })}
            </div>
          )}

          {!entries.length ? (
            <div className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center">
              <RouteIcon size={20} className="mx-auto text-subtle" />
              <div className="mt-2 text-[12.5px] font-semibold">{t('Nothing recorded on this day')}</div>
              <div className="mt-1 text-[11.5px] text-muted">{t('TrackLiv records every position it receives and keeps it for {n} days.', { n: KEEP_DAYS })}</div>
            </div>
          ) : (
            <div>
              <SectionLabel right={<span className="text-[11px] text-muted">{t(plural(data.trips.length, '{n} trip', '{n} trips'), { n: data.trips.length })}</span>}>{t('Timeline')}</SectionLabel>
              <ol className="mt-1.5">
                {entries.map((e, k) => {
                  const last = k === entries.length - 1;
                  if (e.kind === 'stop') return <StopRow key={`s${e.n}`} stop={e.stop} n={e.n} ongoing={isToday && last} onClick={() => requestFocus({ kind: 'lnglat', lng: e.stop.location.lng, lat: e.stop.location.lat, zoom: 16.5 })} />;
                  return (
                    <TripRow
                      key={`t${e.i}`}
                      trip={e.trip}
                      active={active === e.i}
                      ongoing={isToday && last}
                      onHover={(on) => hover(on ? e.i : null)}
                      onClick={() => focusTrip(e.trip)}
                    />
                  );
                })}
              </ol>
            </div>
          )}
          <p className="text-[10.5px] leading-snug text-subtle">{t('Recorded by TrackLiv from the positions FleetGO reports (stops from 3 minutes).')}</p>
        </>
      )}
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2 px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-subtle">{label}</div>
      <div className="mt-0.5 text-[15px] font-bold tabular-nums">{value}</div>
    </div>
  );
}

function StopRow({ stop, n, ongoing, onClick }: { stop: Stop; n: number; ongoing: boolean; onClick: () => void }) {
  const kind = stop.place?.kind ?? 'other';
  const Icon = kind === 'site' ? Warehouse : kind === 'project' ? Building2 : MapPin;
  const title = stop.place?.name ?? stop.address ?? t('Unknown place');
  const sub = stop.place ? stop.address : stop.address ? undefined : `${stop.location.lat.toFixed(5)}, ${stop.location.lng.toFixed(5)}`;
  const minutes = (stop.end - stop.start) / 60;
  return (
    <li>
      <button onClick={onClick} className="group flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-panel-3">
        <span className="mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full text-[10.5px] font-bold text-white ring-2 ring-panel-solid" style={{ background: STOP_COLOR[kind] }}>
          {n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <Icon size={12} className="shrink-0 text-muted" />
            <span className="truncate font-semibold">{title}</span>
          </span>
          <span className="block text-[11px] text-muted">
            {ongoing ? t('since {time}', { time: fmtTime(ms(stop.start)) }) : `${fmtTime(ms(stop.start))} – ${fmtTime(ms(stop.end))}`}
            {sub && <span className="block truncate text-subtle">{sub}</span>}
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-[11.5px] font-semibold tabular-nums text-ink-2">{fmtDuration(minutes)}</span>
      </button>
    </li>
  );
}

function TripRow({ trip, active, ongoing, onHover, onClick }: { trip: Trip; active: boolean; ongoing: boolean; onHover: (on: boolean) => void; onClick: () => void }) {
  const minutes = (trip.end - trip.start) / 60;
  return (
    <li className="relative pl-[18px]">
      <span className={cx('absolute bottom-0 left-[17px] top-0 w-[2px] rounded-full', active ? 'bg-primary' : 'bg-primary/35')} />
      <button
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        onClick={onClick}
        className={cx('ml-2 flex w-[calc(100%-8px)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11.5px]', active ? 'bg-primary-weak' : 'hover:bg-panel-3')}
      >
        <span className="min-w-0 flex-1 text-muted">
          <span className="font-semibold text-ink-2">{ongoing ? t('driving since {time}', { time: fmtTime(ms(trip.start)) }) : `${fmtTime(ms(trip.start))} – ${fmtTime(ms(trip.end))}`}</span>
          {' · '}
          {fmtDuration(minutes)}
          {trip.maxSpeedKmh > 0 && <span className="text-subtle">{' · '}{t('max {v} km/h', { v: trip.maxSpeedKmh })}</span>}
        </span>
        <span className="shrink-0 font-semibold tabular-nums text-ink">{fmtDistance(trip.distanceM)}</span>
      </button>
    </li>
  );
}
