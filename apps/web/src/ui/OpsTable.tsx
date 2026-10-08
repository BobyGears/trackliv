import { fullName, isAtDepot, type OpsEvent } from '@trackliv/core';
import { AlertTriangle, CheckCircle2, ChevronRight, Info, OctagonAlert, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { runInfo, useOpsNow, vehicleDesc, stageLabel } from '../lib/derived';
import { PRIORITY_TONE, STAGE_TONE, fmtDuration, fmtTime } from '../lib/format';
import { useStore } from '../lib/store';
import { Avatar, AvatarStack, Panel, Pill, cx } from './kit';
import { t, tx } from '../lib/i18n';

type Tab = 'vehicles' | 'crew' | 'projects' | 'events';

export function OpsTable() {
  const [tab, setTab] = useState<Tab>('vehicles');
  const [q, setQ] = useState('');
  const vehicles = useStore((s) => s.vehicles);
  const people = useStore((s) => s.people);
  const projects = useStore((s) => s.projects);
  const plan = useStore((s) => s.plan);
  const events = useStore((s) => s.events);
  const telemetry = useStore((s) => s.telemetry);
  const sites = useStore((s) => s.sites);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const now = useOpsNow(2000);
  const assigned = useMemo(() => new Set(plan.assignments.flatMap((a) => a.crew)), [plan]);
  const needle = q.trim().toLowerCase();

  const tabs: { id: Tab; label: string; count: string }[] = [
    { id: 'vehicles', label: t('Vehicles'), count: `${plan.assignments.filter((a) => a.crew.length && a.stage !== 'planned' && a.stage !== 'completed').length}/${vehicles.length}` },
    { id: 'crew', label: t('Crew'), count: `${people.filter((p) => assigned.has(p.id)).length}/${people.length}` },
    { id: 'projects', label: t('Projects'), count: `${projects.filter((p) => p.status === 'active').length}` },
    { id: 'events', label: t('Events'), count: `${events.length}` },
  ];

  return (
    <Panel className="pointer-events-auto absolute bottom-3 right-3 z-20 flex h-[248px] w-[500px] flex-col overflow-hidden">
      <div className="flex items-center gap-1 border-b border-line px-2 pt-2">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={cx(
              '-mb-px flex items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-[12px] font-semibold',
              tab === tb.id ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {tb.label}
            <span className={cx('rounded-full px-1.5 text-[10.5px]', tab === tb.id ? 'bg-primary-weak text-primary' : 'bg-panel-3 text-muted')}>{tb.count}</span>
          </button>
        ))}
        <div className="flex-1" />
        <div className="mb-1.5 flex h-7 w-36 items-center gap-1.5 rounded-lg bg-panel-3 px-2">
          <Search size={12} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Filter')} className="w-full bg-transparent text-[12px] outline-none placeholder:text-subtle" />
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {tab === 'vehicles' &&
          vehicles
            .filter((v) => !needle || `${v.callsign} ${v.plate} ${v.model}`.toLowerCase().includes(needle))
            .map((v) => {
              const info = runInfo(v.id, now);
              if (!info) return null;
              const sel = selection?.type === 'vehicle' && selection.id === v.id;
              const tel = telemetry[v.id];
              return (
                <button
                  key={v.id}
                  onClick={() => select({ type: 'vehicle', id: v.id }, { focus: true })}
                  className={cx('grid w-full grid-cols-[56px_1fr_auto_86px_14px] items-center gap-2 rounded-lg px-2 py-1.5 text-left', sel ? 'bg-primary-weak' : 'hover:bg-panel-3')}
                >
                  <span className="mono text-[12px] font-semibold">{v.callsign}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium">{info.assignment?.crew.length ? info.destLabel : v.status === 'active' ? t('Unassigned') : t(v.status === 'maintenance' ? 'In maintenance' : 'Inactive')}</span>
                    <span className="block truncate text-[10.5px] text-muted">
                      {vehicleDesc(v)}
                      {tel && !isAtDepot(tel, sites) && tel.speedKmh > 2 ? ` · ${tel.speedKmh} km/h` : ''}
                    </span>
                  </span>
                  <span>{info.crew.length > 0 && <AvatarStack people={info.crew} size={18} max={3} />}</span>
                  <span className="flex justify-end">
                    <Pill tone={info.late ? 'danger' : STAGE_TONE[info.stage]}>{info.late ? t('Late') : info.stageLabel}</Pill>
                  </span>
                  <span className="text-right text-[10.5px] text-muted">
                    {info.stage === 'departed' && info.etaMin !== null ? fmtDuration(info.etaMin) : <ChevronRight size={13} />}
                  </span>
                </button>
              );
            })}
        {tab === 'crew' &&
          people
            .filter((p) => !needle || `${p.firstName} ${p.lastName} ${t(p.role)}`.toLowerCase().includes(needle))
            .sort((a, b) => Number(assigned.has(a.id)) - Number(assigned.has(b.id)) || a.lastName.localeCompare(b.lastName))
            .map((p) => {
              const a = plan.assignments.find((x) => x.crew.includes(p.id));
              const v = a ? vehicles.find((x) => x.id === a.vehicleId) : undefined;
              const sel = selection?.type === 'person' && selection.id === p.id;
              return (
                <button key={p.id} onClick={() => select({ type: 'person', id: p.id })} className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', sel ? 'bg-primary-weak' : 'hover:bg-panel-3')}>
                  <Avatar person={p} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">{fullName(p)}</span>
                    <span className="block text-[10.5px] text-muted">{t(p.role)}</span>
                  </span>
                  {p.status !== 'available' ? (
                    <Pill tone="warning">{t(p.status)}</Pill>
                  ) : v && a ? (
                    <span className="text-right text-[11px]">
                      <span className="mono block whitespace-nowrap font-semibold">{v.callsign}</span>
                      <span className="block text-muted">{stageLabel(a.stage)}</span>
                    </span>
                  ) : (
                    <Pill>{t('Unassigned')}</Pill>
                  )}
                </button>
              );
            })}
        {tab === 'projects' &&
          projects
            .filter((p) => p.status !== 'completed')
            .filter((p) => !needle || `${p.name} ${p.code} ${p.client} ${p.address}`.toLowerCase().includes(needle))
            .map((p) => {
              const runs = plan.assignments.filter((a) => a.crew.length && a.destination?.kind === 'project' && a.destination.projectId === p.id);
              const crew = runs.reduce((n, a) => n + a.crew.length, 0);
              const sel = selection?.type === 'project' && selection.id === p.id;
              return (
                <button key={p.id} onClick={() => select({ type: 'project', id: p.id }, { focus: true })} className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', sel ? 'bg-primary-weak' : 'hover:bg-panel-3', p.status !== 'active' && 'opacity-60')}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">{p.name}</span>
                    <span className="block truncate text-[10.5px] text-muted">
                      <span className="mono">{p.code}</span> · {p.address}
                    </span>
                  </span>
                  <Pill tone={PRIORITY_TONE[p.priority]}>{p.priority}</Pill>
                  <span className={cx('w-12 text-right text-[11.5px] font-semibold', crew >= (p.crewTarget ?? 0) ? 'text-success' : crew ? 'text-warning' : 'text-muted')}>
                    {crew}/{p.crewTarget ?? '–'}
                  </span>
                </button>
              );
            })}
        {tab === 'events' && <EventList events={events} filter={needle} />}
      </div>
    </Panel>
  );
}

const SEV_ICON = {
  info: <Info size={13} className="text-primary" />,
  success: <CheckCircle2 size={13} className="text-success" />,
  warning: <AlertTriangle size={13} className="text-warning" />,
  critical: <OctagonAlert size={13} className="text-danger" />,
};

export function EventList({ events, filter = '' }: { events: OpsEvent[]; filter?: string }) {
  const select = useStore((s) => s.select);
  const list = events.filter((e) => !filter || `${e.title} ${e.detail ?? ''}`.toLowerCase().includes(filter)).slice().reverse();
  if (!list.length) return <div className="px-2 py-6 text-center text-[12px] text-muted">{t('No events yet.')}</div>;
  return (
    <>
      {list.map((e) => (
        <button
          key={e.id}
          onClick={() => {
            if (e.refs?.vehicleId) select({ type: 'vehicle', id: e.refs.vehicleId }, { focus: true });
            else if (e.refs?.projectId) select({ type: 'project', id: e.refs.projectId }, { focus: true });
          }}
          className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-panel-3"
        >
          <span className="mt-0.5">{SEV_ICON[e.severity]}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-medium leading-snug">{tx(e.title)}</span>
            {e.detail && <span className="block truncate text-[10.5px] text-muted">{tx(e.detail)}</span>}
          </span>
          <span className="mono shrink-0 text-[10.5px] text-muted">{fmtTime(e.ts)}</span>
        </button>
      ))}
    </>
  );
}
