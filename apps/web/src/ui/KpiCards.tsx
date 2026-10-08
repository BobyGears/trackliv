import { Building2, Clock3, Truck, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useKpis } from '../lib/derived';
import { useStore } from '../lib/store';
import { cx, Panel } from './kit';

function Kpi({
  icon,
  tint,
  label,
  value,
  total,
  sub,
  subTone,
  onClick,
}: {
  icon: ReactNode;
  tint: string;
  label: string;
  value: ReactNode;
  total?: ReactNode;
  sub: ReactNode;
  subTone?: 'good' | 'bad' | 'neutral';
  onClick?: () => void;
}) {
  return (
    <Panel className="pointer-events-auto w-[178px] cursor-pointer px-3 py-2.5 transition-shadow hover:shadow-float" onClick={onClick}>
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${tint} 14%, transparent)`, color: tint }}>
          {icon}
        </span>
        <span className="text-[11.5px] font-medium text-muted">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-[22px] font-bold leading-none tracking-tight">{value}</span>
        {total !== undefined && <span className="text-[13px] font-semibold text-subtle">/ {total}</span>}
      </div>
      <div
        className={cx(
          'mt-1 truncate text-[11px] font-medium',
          subTone === 'good' && 'text-success',
          subTone === 'bad' && 'text-danger',
          (!subTone || subTone === 'neutral') && 'text-muted',
        )}
      >
        {sub}
      </div>
    </Panel>
  );
}

export function KpiCards() {
  const k = useKpis();
  const setView = useStore((s) => s.setView);
  return (
    <div className="pointer-events-none absolute left-3 top-[76px] z-20 flex gap-2.5">
      <Kpi
        icon={<Users size={15} />}
        tint="#2f6bff"
        label="Crew deployed"
        value={k.crewAssigned}
        total={k.crewAvailable}
        sub={k.crewAvailable - k.crewAssigned > 0 ? `${k.crewAvailable - k.crewAssigned} unassigned · ${k.crewUnavailable} off` : `everyone assigned · ${k.crewUnavailable} off`}
        subTone={k.crewAvailable - k.crewAssigned > 0 ? 'neutral' : 'good'}
        onClick={() => setView('dispatch')}
      />
      <Kpi
        icon={<Truck size={15} />}
        tint="#12a150"
        label="Vehicles out"
        value={k.vehiclesOut}
        total={k.vehiclesTotal}
        sub={`${k.enRoute} en route · ${k.onSite} on site`}
      />
      <Kpi
        icon={<Clock3 size={15} />}
        tint="#d9820b"
        label="On-time departures"
        value={k.onTimePct === null ? '–' : `${k.onTimePct}%`}
        sub={k.late ? `${k.late} vehicle${k.late > 1 ? 's' : ''} late to leave` : `${k.departedCount} departed today`}
        subTone={k.late ? 'bad' : 'good'}
        onClick={() => setView('schedule')}
      />
      <Kpi
        icon={<Building2 size={15} />}
        tint="#7c5cff"
        label="Projects covered"
        value={k.projectsCovered}
        total={k.projectsActive}
        sub={
          k.issues.filter((i) => i.severity !== 'info').length
            ? `${k.issues.filter((i) => i.severity !== 'info').length} plan issue(s)`
            : k.projectsActive - k.projectsCovered > 0
              ? `${k.projectsActive - k.projectsCovered} without crew today`
              : 'all active projects staffed'
        }
        subTone={k.issues.some((i) => i.severity === 'error') ? 'bad' : k.projectsActive - k.projectsCovered > 0 ? 'neutral' : 'good'}
        onClick={() => setView('dispatch')}
      />
    </div>
  );
}
