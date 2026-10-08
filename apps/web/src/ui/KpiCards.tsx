import { Building2, Clock3, Truck, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useKpis } from '../lib/derived';
import { useStore } from '../lib/store';
import { cx, Panel } from './kit';
import { t, plural } from '../lib/i18n';

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
        label={t('Crew deployed')}
        value={k.crewAssigned}
        total={k.crewAvailable}
        sub={k.crewAvailable - k.crewAssigned > 0 ? t('{n} unassigned · {off} off', { n: k.crewAvailable - k.crewAssigned, off: k.crewUnavailable }) : t('everyone assigned · {off} off', { off: k.crewUnavailable })}
        subTone={k.crewAvailable - k.crewAssigned > 0 ? 'neutral' : 'good'}
        onClick={() => setView('dispatch')}
      />
      <Kpi
        icon={<Truck size={15} />}
        tint="#12a150"
        label={t('Vehicles out')}
        value={k.vehiclesOut}
        total={k.vehiclesTotal}
        sub={t('{a} en route · {b} on site', { a: k.enRoute, b: k.onSite })}
      />
      <Kpi
        icon={<Clock3 size={15} />}
        tint="#d9820b"
        label={t('On-time departures')}
        value={k.onTimePct === null ? '–' : `${k.onTimePct}%`}
        sub={k.late ? t(plural(k.late, '{n} vehicle late to leave', '{n} vehicles late to leave'), { n: k.late }) : t('{n} departed today', { n: k.departedCount })}
        subTone={k.late ? 'bad' : 'good'}
        onClick={() => setView('schedule')}
      />
      <Kpi
        icon={<Building2 size={15} />}
        tint="#7c5cff"
        label={t('Projects covered')}
        value={k.projectsCovered}
        total={k.projectsActive}
        sub={
          k.issues.filter((i) => i.severity !== 'info').length
            ? t('{n} plan issue(s)', { n: k.issues.filter((i) => i.severity !== 'info').length })
            : k.projectsActive - k.projectsCovered > 0
              ? t('{n} without crew today', { n: k.projectsActive - k.projectsCovered })
              : t('all active projects staffed')
        }
        subTone={k.issues.some((i) => i.severity === 'error') ? 'bad' : k.projectsActive - k.projectsCovered > 0 ? 'neutral' : 'good'}
        onClick={() => setView('dispatch')}
      />
    </div>
  );
}
