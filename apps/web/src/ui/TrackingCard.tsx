import { STAGES, STAGE_LABEL, type Stage } from '@trackliv/core';
import { Check, Flag, Home, MapPin, Truck, Undo2, Warehouse } from 'lucide-react';
import type { ReactNode } from 'react';
import { runInfo, useOpsNow } from '../lib/derived';
import { STAGE_TONE, TONE_HEX, fmtDuration, fmtTime, opsTime } from '../lib/format';
import { useStore } from '../lib/store';
import { AvatarStack, Panel, Pill, cx } from './kit';

const ICONS: Record<Stage, ReactNode> = {
  planned: <Warehouse size={14} />,
  departed: <Truck size={14} />,
  on_site: <MapPin size={14} />,
  returning: <Undo2 size={14} />,
  completed: <Home size={14} />,
};

const STEP_LABEL: Record<Stage, string> = {
  planned: 'Crew ready',
  departed: 'Departed',
  on_site: 'On site',
  returning: 'Returning',
  completed: 'Back at HQ',
};

function Stepper({ current, times, counts }: { current?: Stage; times?: Partial<Record<Stage, string | undefined>>; counts?: Record<Stage, number> }) {
  const idx = current ? STAGES.indexOf(current) : -1;
  return (
    <div className="flex items-start">
      {STAGES.map((s, i) => {
        const done = idx >= 0 && i < idx;
        const now = i === idx;
        const color = TONE_HEX[STAGE_TONE[s]];
        return (
          <div key={s} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <div className={cx('h-0.5 flex-1', i === 0 ? 'opacity-0' : done || now ? 'bg-primary' : 'bg-line-strong')} />
              <div
                className={cx('grid size-8 shrink-0 place-items-center rounded-full border-2 transition-colors', counts ? '' : done ? 'border-primary bg-primary text-white' : now ? 'text-white' : 'border-line-strong bg-panel-solid text-subtle')}
                style={counts ? { borderColor: color, color, background: `color-mix(in srgb, ${color} 12%, var(--panel-solid))` } : now ? { background: color, borderColor: color } : undefined}
              >
                {counts ? <span className="text-[12px] font-bold">{counts[s]}</span> : done ? <Check size={14} strokeWidth={3} /> : ICONS[s]}
              </div>
              <div className={cx('h-0.5 flex-1', i === STAGES.length - 1 ? 'opacity-0' : done ? 'bg-primary' : 'bg-line-strong')} />
            </div>
            <div className={cx('mt-1.5 text-center text-[11.5px] font-semibold', now ? 'text-ink' : 'text-ink-2')}>{counts ? STAGE_LABEL[s] : STEP_LABEL[s]}</div>
            {times && <div className="mono text-center text-[10.5px] text-muted">{times[s] ?? '–'}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function TrackingCard() {
  const selection = useStore((s) => s.selection);
  const plan = useStore((s) => s.plan);
  const date = useStore((s) => s.date);
  const projects = useStore((s) => s.projects);
  const select = useStore((s) => s.select);
  const now = useOpsNow();
  const vehicleId = selection?.type === 'vehicle' ? selection.id : null;
  const info = vehicleId ? runInfo(vehicleId, now) : null;

  if (!info || !info.assignment?.crew.length) {
    const crewed = plan.assignments.filter((a) => a.crew.length);
    const counts = Object.fromEntries(STAGES.map((s) => [s, crewed.filter((a) => a.stage === s).length])) as Record<Stage, number>;
    const next = crewed
      .filter((a) => a.stage === 'planned' && a.departAt)
      .sort((a, b) => (a.departAt! < b.departAt! ? -1 : 1))[0];
    const nextV = next ? useStore.getState().vehicles.find((v) => v.id === next.vehicleId) : null;
    return (
      <Panel className="pointer-events-auto absolute bottom-3 left-3 z-20 w-[min(640px,calc(100%-560px))] min-w-[460px] px-4 pb-3.5 pt-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <Flag size={14} className="text-primary" /> Today’s runs
            <span className="text-[11.5px] font-normal text-muted">{crewed.length} vehicles with crew</span>
          </div>
          {next && nextV ? (
            <button className="text-[11.5px] text-muted hover:text-primary" onClick={() => select({ type: 'vehicle', id: nextV.id }, { focus: true })}>
              Next departure <span className="mono font-semibold text-ink">{next.departAt}</span> · {nextV.callsign}
            </button>
          ) : (
            <span className="text-[11.5px] text-muted">Select a vehicle to track its run</span>
          )}
        </div>
        <Stepper counts={counts} />
      </Panel>
    );
  }

  const a = info.assignment;
  const planned = (hhmm?: string) => (hhmm ? `${hhmm}` : undefined);
  const times: Partial<Record<Stage, string | undefined>> = {
    planned: a.departAt ? `dep ${a.departAt}` : undefined,
    departed: a.stageTimes.departed ? fmtTime(a.stageTimes.departed) : planned(a.departAt),
    on_site: a.stageTimes.on_site
      ? fmtTime(a.stageTimes.on_site)
      : info.stage === 'departed' && info.etaMin !== null
        ? `ETA ${fmtTime(now + info.etaMin * 60000)}`
        : undefined,
    returning: a.stageTimes.returning ? fmtTime(a.stageTimes.returning) : planned(a.returnAt),
    completed: a.stageTimes.completed ? fmtTime(a.stageTimes.completed) : undefined,
  };
  const project = a.destination?.kind === 'project' ? projects.find((p) => p.id === (a.destination as { projectId: string }).projectId) : undefined;
  const depart = opsTime(date, a.departAt);
  const late = info.late && depart ? Math.round((now - depart.getTime()) / 60000) : 0;

  return (
    <Panel className="pointer-events-auto absolute bottom-3 left-3 z-20 flex w-[min(760px,calc(100%-560px))] min-w-[560px] gap-4 px-4 pb-3.5 pt-3">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            Run tracking
            <span className="mono text-[11px] font-medium text-muted">
              RUN-{date.replaceAll('-', '').slice(2)}-{info.vehicle.callsign}
            </span>
          </div>
          {late > 0 ? <Pill tone="danger">{late} min late</Pill> : <Pill tone={STAGE_TONE[info.stage]}>{info.stageLabel}</Pill>}
        </div>
        <Stepper current={info.stage} times={times} />
      </div>
      <div className="w-[230px] shrink-0 rounded-xl border border-line bg-panel-2 p-2.5">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg text-white" style={{ background: project?.color ?? '#64748b' }}>
            <Truck size={16} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold">
              {info.vehicle.callsign} → {info.destLabel}
            </div>
            <div className="truncate text-[11px] text-muted">{project?.address ?? (a.destination?.kind === 'custom' ? a.destination.address ?? 'Custom destination' : '')}</div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <AvatarStack people={info.crew} size={22} />
          <span className="text-[11px] font-medium text-muted">
            {info.stage === 'departed' && info.etaMin !== null ? `${fmtDuration(info.etaMin)} left` : `${info.crew.length} crew`}
          </span>
        </div>
      </div>
    </Panel>
  );
}
