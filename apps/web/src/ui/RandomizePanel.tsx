import { fullName, type ID } from '@trackliv/core';
import { AlertTriangle, ArrowRight, Dices, Lock, Shuffle, Truck, X } from 'lucide-react';
import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { Button, IconButton, Panel, SectionLabel, Segmented, Toggle, cx } from './kit';
import { t, plural } from '../lib/i18n';
import { destLabel } from '../lib/derived';

export function RandomizePanel() {
  const scenario = useStore((s) => s.scenario);
  const opts = useStore((s) => s.scenarioOptions);
  const people = useStore((s) => s.people);
  const vehicles = useStore((s) => s.vehicles);
  const projects = useStore((s) => s.projects);
  const sites = useStore((s) => s.sites);
  const preview = useStore((s) => s.previewRandomize);

  const byVehicle = useMemo(() => {
    if (!scenario) return [];
    const m = new Map<ID, { added: ID[]; removed: ID[]; dest?: { from: string; to: string } }>();
    const get = (id: ID) => {
      let e = m.get(id);
      if (!e) m.set(id, (e = { added: [], removed: [] }));
      return e;
    };
    for (const mv of scenario.diff.moves) {
      if (mv.to) get(mv.to).added.push(mv.personId);
      if (mv.from) get(mv.from).removed.push(mv.personId);
    }
    for (const d of scenario.diff.destinationChanges) {
      get(d.vehicleId).dest = { from: d.from ? destLabel(d.from, projects) : '—', to: d.to ? destLabel(d.to, projects) : '—' };
    }
    return vehicles.filter((v) => m.has(v.id)).map((v) => ({ v, ...m.get(v.id)! }));
  }, [scenario, vehicles, projects]);

  if (!scenario) return null;
  const s = scenario.stats;
  const name = (id: ID) => {
    const p = people.find((x) => x.id === id);
    return p ? fullName(p) : id;
  };

  return (
    <Panel className="fade-in flex w-[360px] shrink-0 flex-col overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-violet-weak text-violet">
            <Shuffle size={15} />
          </span>
          <div className="flex-1">
            <div className="text-[14px] font-bold leading-tight">{t('Randomize scenario')}</div>
            <div className="text-[11px] text-muted">
              {t('Seed')}{' '}<span className="mono font-semibold text-ink-2">{scenario.seed}</span>{' '}{t('· reproducible')}
            </div>
          </div>
          <IconButton size="sm" label={t('Discard')} onClick={() => useStore.getState().discardScenario()}>
            <X size={15} />
          </IconButton>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat value={`${s.peopleAssigned}`} sub={t('of {n} people', { n: s.peopleAssigned + s.peopleUnassigned })} />
          <Stat value={`${s.vehiclesStaffed}`} sub={t('vehicles staffed')} />
          <Stat value={`${s.projectsCovered}/${s.projectsActive}`} sub={t('projects covered')} />
        </div>
        {(s.pinnedPeople > 0 || s.pinnedVehicles > 0) && (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-violet-weak px-2.5 py-1.5 text-[11.5px] font-medium text-violet">
            <Lock size={12} />{' '}{t('Keeping')}{' '}{s.pinnedPeople}{' '}{t('pinned')}{' '}{s.pinnedPeople === 1 ? 'person' : 'people'} · {s.pinnedVehicles}{' '}{t('pinned vehicle')}{s.pinnedVehicles === 1 ? '' : 's'}
          </div>
        )}
        {s.frozenVehicles > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-panel-3 px-2.5 py-1.5 text-[11.5px] font-medium text-muted">
            <Truck size={12} />{' '}
            {opts.siteId
              ? t(plural(s.frozenVehicles, '{n} vehicle is already on the road or at the other depot and stays as is', '{n} vehicles are already on the road or at the other depot and stay as is'), { n: s.frozenVehicles })
              : t(plural(s.frozenVehicles, '{n} vehicle is already on the road and stays as is', '{n} vehicles are already on the road and stay as is'), { n: s.frozenVehicles })}
          </div>
        )}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <SectionLabel>{t('Rules')}</SectionLabel>
        <div className="mt-2 flex items-center justify-between">
          <span className="font-medium">{t('Preferred crew size')}</span>
          <Segmented
            size="sm"
            value={String(opts.targetCrew)}
            onChange={(v) => preview({ targetCrew: Number(v) })}
            options={['1', '2', '3', '4'].map((n) => ({ value: n, label: n }))}
          />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-medium">{t('Depots')}</span>
          <Segmented
            size="sm"
            value={opts.siteId ?? 'all'}
            onChange={(v) => preview({ siteId: v === 'all' ? undefined : v })}
            options={[{ value: 'all', label: t('All') }, ...sites.map((x) => ({ value: x.id, label: x.code }))]}
          />
        </div>
        <Toggle on={opts.requireDriver} onChange={(v) => preview({ requireDriver: v })} label={t('Licensed driver on every vehicle')} hint={t('Uses the licence class each vehicle needs (B, C1, C…)')} />
        <Toggle on={opts.coverAllProjects} onChange={(v) => preview({ coverAllProjects: v })} label={t('Cover every active project first')} hint={t('Then spread the rest by priority')} />
        <Toggle on={opts.preferHomeSite} onChange={(v) => preview({ preferHomeSite: v })} label={t('Prefer people’s own depot')} />
        <Toggle on={opts.topUpPinnedCrews} onChange={(v) => preview({ topUpPinnedCrews: v })} label={t('Top up pinned crews')} hint={t('Off: pinned vehicles keep exactly the people you pinned')} />

        {scenario.warnings.length > 0 && (
          <div className="mt-3 space-y-1">
            {scenario.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded-lg bg-warning-weak px-2.5 py-1.5 text-[11.5px] text-warning">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
              </div>
            ))}
          </div>
        )}

        <SectionLabel className="mt-4" right={<span className="text-[11px] text-muted">{scenario.diff.moves.length}{' '}{t('moves ·')}{' '}{scenario.diff.destinationChanges.length}{' '}{t('destinations')}</span>}>
          {t('Proposed changes')}
        </SectionLabel>
        <div className="mt-1.5 space-y-1.5">
          {byVehicle.length === 0 && <div className="py-3 text-[12px] text-muted">{t('Nothing would change.')}</div>}
          {byVehicle.map(({ v, added, removed, dest }) => (
            <div key={v.id} className="rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-[11.5px]">
              <div className="flex items-center gap-1.5 font-semibold">
                <span className="mono">{v.callsign}</span>
                {dest && (
                  <span className="flex min-w-0 items-center gap-1 text-muted">
                    <span className="truncate line-through decoration-subtle">{dest.from}</span>
                    <ArrowRight size={11} className="shrink-0" />
                    <span className="truncate font-semibold text-violet">{dest.to}</span>
                  </span>
                )}
              </div>
              {added.length > 0 && <div className="mt-0.5 text-success">+ {added.map(name).join(', ')}</div>}
              {removed.length > 0 && <div className={cx('mt-0.5 text-danger')}>− {removed.map(name).join(', ')}</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2 border-t border-line bg-panel-2 px-4 py-3">
        <Button variant="ghost" onClick={() => useStore.getState().discardScenario()}>
          {t('Discard')}
        </Button>
        <Button icon={<Dices size={14} />} onClick={() => useStore.getState().rerollScenario()}>
          {t('Reroll')}
        </Button>
        <Button variant="violet" className="flex-1" icon={<Shuffle size={14} />} onClick={() => useStore.getState().applyScenario()}>
          {t('Apply scenario')}
        </Button>
      </div>
    </Panel>
  );
}

function Stat({ value, sub }: { value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2 px-2.5 py-2">
      <div className="text-[18px] font-bold leading-none">{value}</div>
      <div className="mt-1 text-[10.5px] leading-tight text-muted">{sub}</div>
    </div>
  );
}
