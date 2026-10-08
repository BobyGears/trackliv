import { destinationLabel, setTimes, type Assignment, type Vehicle } from '@trackliv/core';
import { CalendarRange, Clock } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useOpsNow } from '../lib/derived';
import { STAGE_TONE, TONE_HEX, fmtDate, hhmmToMin, minToHhmm, opsDayStart, opsTime } from '../lib/format';
import { useStore } from '../lib/store';
import { DateNav } from './DateNav';
import { AvatarStack, Panel, Pill, cx } from './kit';

const START = 5 * 60;
const END = 21 * 60;
const SPAN = END - START;
const SNAP = 5;

type Drag = { vehicleId: string; mode: 'move' | 'start' | 'end'; x0: number; dep: number; ret: number; width: number };

export function ScheduleView() {
  const vehicles = useStore((s) => s.vehicles);
  const sites = useStore((s) => s.sites);
  const plan = useStore((s) => s.plan);
  const projects = useStore((s) => s.projects);
  const people = useStore((s) => s.people);
  const date = useStore((s) => s.date);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const commit = useStore((s) => s.commit);
  const now = useOpsNow();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<{ vehicleId: string; dep: number; ret: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const dayStart = opsDayStart(date);
  const nowMin = (now - dayStart) / 60000;
  const pct = (min: number) => `${((Math.max(START, Math.min(END, min)) - START) / SPAN) * 100}%`;
  const isoMin = (iso?: string) => (iso ? (Date.parse(iso) - dayStart) / 60000 : null);

  const rows = useMemo(
    () =>
      sites.map((site) => ({
        site,
        vehicles: vehicles.filter((v) => v.homeSiteId === site.id),
      })),
    [sites, vehicles],
  );

  const onPointerDown = (e: React.PointerEvent, v: Vehicle, a: Assignment, mode: Drag['mode']) => {
    if (a.stage !== 'planned' && mode !== 'end') return;
    e.stopPropagation();
    const dep = hhmmToMin(a.departAt);
    const ret = hhmmToMin(a.returnAt);
    if (dep === null || ret === null) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ vehicleId: v.id, mode, x0: e.clientX, dep, ret, width: trackRef.current?.clientWidth ?? 1000 });
    setPreview({ vehicleId: v.id, dep, ret });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dMin = Math.round(((e.clientX - drag.x0) / drag.width) * SPAN / SNAP) * SNAP;
    let dep = drag.dep;
    let ret = drag.ret;
    if (drag.mode === 'move') {
      dep += dMin;
      ret += dMin;
    } else if (drag.mode === 'start') dep = Math.min(ret - 15, dep + dMin);
    else ret = Math.max(dep + 15, ret + dMin);
    dep = Math.max(START, dep);
    ret = Math.min(END, ret);
    setPreview({ vehicleId: drag.vehicleId, dep, ret });
  };
  const onPointerUp = () => {
    if (drag && preview && (preview.dep !== drag.dep || preview.ret !== drag.ret)) {
      const v = vehicles.find((x) => x.id === drag.vehicleId);
      commit((list) => setTimes(list, drag.vehicleId, { departAt: minToHhmm(preview.dep), returnAt: minToHhmm(preview.ret) }), `${v?.callsign} rescheduled ${minToHhmm(preview.dep)}–${minToHhmm(preview.ret)}`);
    }
    setDrag(null);
    setPreview(null);
  };

  const hours = Array.from({ length: (END - START) / 60 + 1 }, (_, i) => START + i * 60);

  return (
    <Panel className="pointer-events-auto absolute inset-x-3 bottom-3 z-20 flex h-[min(58%,560px)] flex-col overflow-hidden" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <CalendarRange size={16} className="text-primary" />
        <div>
          <div className="text-[14px] font-bold leading-tight">Schedule</div>
          <div className="text-[11px] text-muted">{fmtDate(date)} · drag a bar to move it, drag its edges to change departure / return</div>
        </div>
        <DateNav showCopy={false} />
        <div className="flex-1" />
        <Legend />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 grid grid-cols-[230px_1fr] border-b border-line bg-panel-solid/95 backdrop-blur">
          <div className="px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">Vehicle</div>
          <div ref={trackRef} className="relative h-7">
            {hours.map((h) => (
              <span key={h} className="mono absolute top-1.5 -translate-x-1/2 text-[10.5px] text-muted" style={{ left: pct(h) }}>
                {String(h / 60).padStart(2, '0')}
              </span>
            ))}
            {nowMin > START && nowMin < END && (
              <span className="mono absolute top-0.5 -translate-x-1/2 rounded bg-danger px-1 text-[10px] font-bold text-white" style={{ left: pct(nowMin) }}>
                {minToHhmm(nowMin)}
              </span>
            )}
          </div>
        </div>
        {rows.map(({ site, vehicles: vs }) => (
          <div key={site.id}>
            <div className="flex items-center gap-2 bg-panel-2 px-4 py-1 text-[11px] font-semibold text-ink-2">
              <span className="size-2 rounded-full" style={{ background: site.color }} /> {site.name} <span className="mono text-muted">{site.code}</span>
            </div>
            {vs.map((v) => {
              const a = plan.assignments.find((x) => x.vehicleId === v.id);
              const project = a?.destination?.kind === 'project' ? projects.find((p) => p.id === (a.destination as { projectId: string }).projectId) : undefined;
              const color = project?.color ?? (a?.destination ? '#7c5cff' : '#94a3b8');
              const pv = preview?.vehicleId === v.id ? preview : null;
              const dep = pv?.dep ?? hhmmToMin(a?.departAt);
              const ret = pv?.ret ?? hhmmToMin(a?.returnAt);
              const crew = (a?.crew ?? []).map((id) => people.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
              const sel = selection?.type === 'vehicle' && selection.id === v.id;
              const tDep = isoMin(a?.stageTimes.departed);
              const tArr = isoMin(a?.stageTimes.on_site);
              const tRet = isoMin(a?.stageTimes.returning);
              const tBack = isoMin(a?.stageTimes.completed);
              const planned = opsTime(date, a?.departAt);
              const late = a?.stage === 'planned' && a.crew.length > 0 && planned && now - planned.getTime() > 15 * 60000;
              return (
                <div key={v.id} className={cx('grid grid-cols-[230px_1fr] border-b border-line', sel && 'bg-primary-weak/60')}>
                  <button onClick={() => select({ type: 'vehicle', id: v.id })} className="flex min-w-0 items-center gap-2 px-4 py-2 text-left hover:bg-panel-3">
                    <span className="mono w-10 text-[12px] font-bold">{v.callsign}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold">{a?.crew.length ? destinationLabel(a.destination, projects) : v.status === 'active' ? 'Unassigned' : v.status}</span>
                      <span className="block">{crew.length ? <AvatarStack people={crew} size={16} max={4} /> : <span className="text-[10.5px] text-subtle">no crew</span>}</span>
                    </span>
                  </button>
                  <div className="relative h-[46px]">
                    {hours.map((h) => (
                      <span key={h} className="absolute inset-y-0 w-px bg-line" style={{ left: pct(h) }} />
                    ))}
                    {a && dep !== null && ret !== null && a.crew.length > 0 && (
                      <div
                        data-testid={`bar-${v.callsign}`}
                        onPointerDown={(e) => onPointerDown(e, v, a, 'move')}
                        className={cx('group absolute top-2 h-[30px] rounded-lg border', a.stage === 'planned' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default', pv && 'ring-2 ring-primary')}
                        style={{
                          left: pct(dep),
                          width: `calc(${pct(ret)} - ${pct(dep)})`,
                          background: `color-mix(in srgb, ${color} 16%, var(--panel-solid))`,
                          borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
                        }}
                        title={`${minToHhmm(dep)} – ${minToHhmm(ret)}`}
                      >
                        <span className="absolute inset-y-0 left-0 w-1 rounded-l-lg" style={{ background: color }} />
                        <span className="pointer-events-none flex h-full items-center gap-1.5 overflow-hidden whitespace-nowrap pl-2.5 pr-2 text-[11px] font-semibold" style={{ color: `color-mix(in srgb, ${color} 75%, var(--text))` }}>
                          <span className="mono">{minToHhmm(dep)}</span>
                          <span className="truncate">{destinationLabel(a.destination, projects)}</span>
                          <span className="ml-auto mono">{minToHhmm(ret)}</span>
                        </span>
                        {a.stage === 'planned' && <span onPointerDown={(e) => onPointerDown(e, v, a, 'start')} className="absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize" />}
                        <span onPointerDown={(e) => onPointerDown(e, v, a, 'end')} className="absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize" />
                      </div>
                    )}
                    {/* actual progress from GPS geofences */}
                    {tDep !== null && (
                      <span className="pointer-events-none absolute bottom-1 h-1 rounded-full" style={{ left: pct(tDep), width: `calc(${pct(tArr ?? Math.min(nowMin, END))} - ${pct(tDep)})`, background: TONE_HEX.primary }} />
                    )}
                    {tArr !== null && (
                      <span className="pointer-events-none absolute bottom-1 h-1 rounded-full" style={{ left: pct(tArr), width: `calc(${pct(tRet ?? Math.min(nowMin, END))} - ${pct(tArr)})`, background: TONE_HEX.success }} />
                    )}
                    {tRet !== null && (
                      <span className="pointer-events-none absolute bottom-1 h-1 rounded-full" style={{ left: pct(tRet), width: `calc(${pct(tBack ?? Math.min(nowMin, END))} - ${pct(tRet)})`, background: TONE_HEX.violet }} />
                    )}
                    {late && dep !== null && (
                      <span className="pointer-events-none absolute top-0.5 -translate-x-1/2" style={{ left: pct(dep) }}>
                        <Pill tone="danger" className="!px-1 !py-0 text-[9.5px]">
                          late
                        </Pill>
                      </span>
                    )}
                    {nowMin > START && nowMin < END && <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-danger/80" style={{ left: pct(nowMin) }} />}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-5 rounded border border-primary/50 bg-primary-weak" /> Planned
      </span>
      {(['departed', 'on_site', 'returning'] as const).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="h-1 w-4 rounded-full" style={{ background: TONE_HEX[STAGE_TONE[s]] }} />
          {s === 'departed' ? 'En route' : s === 'on_site' ? 'On site' : 'Returning'}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <Clock size={11} className="text-danger" /> Now
      </span>
    </div>
  );
}
