import {
  fullName,
  type LicenseClass,
  type Person,
  type PersonRole,
  type PersonStatus,
  type Priority,
  type Project,
  type ProjectStatus,
  type Vehicle,
  type VehicleKind,
  type VehicleStatus,
} from '@trackliv/core';
import { Building2, Crosshair, Database, Loader2, MapPin, Plus, Save, Search, Trash2, Truck, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { PRIORITY_TONE } from '../lib/format';
import { useStore } from '../lib/store';
import { Avatar, Button, LicenseChips, Panel, Pill, Segmented, cx } from './kit';
import { vehicleDesc } from '../lib/derived';
import { t } from '../lib/i18n';

type Tab = 'projects' | 'people' | 'vehicles';

const LICENSES: LicenseClass[] = ['B', 'BE', 'C1', 'C1E', 'C', 'CE'];
const ROLES: PersonRole[] = ['Foreman', 'Driver', 'Technician', 'Operative', 'Apprentice'];
const PROJECT_COLORS = ['#2f6bff', '#e5484d', '#30a46c', '#8e4ec6', '#f76b15', '#12a594', '#d6409f', '#0090ff', '#ffc53d', '#7c66dc', '#46a758', '#a18072'];

/** Master data: projects (with map location), crew and vehicles. */
export function DataView() {
  const [tab, setTab] = useState<Tab>('projects');
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [q, setQ] = useState('');
  const picking = useStore((s) => !!s.mapPick);
  const projects = useStore((s) => s.projects);
  const people = useStore((s) => s.people);
  const vehicles = useStore((s) => s.vehicles);
  const sites = useStore((s) => s.sites);
  useEffect(() => setSelected(null), [tab]);
  const needle = q.trim().toLowerCase();

  const rows = useMemo(() => {
    if (tab === 'projects')
      return projects
        .filter((p) => !needle || `${p.name} ${p.code} ${p.client} ${p.address}`.toLowerCase().includes(needle))
        .map((p) => ({
          id: p.id,
          node: (
            <>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.name}</span>
                <span className="block truncate text-[11px] text-muted">
                  <span className="mono">{p.code}</span> · {p.address || 'no address'}
                </span>
              </span>
              <Pill tone={p.status === 'active' ? 'success' : 'neutral'}>{t(p.status)}</Pill>
            </>
          ),
        }));
    if (tab === 'people')
      return people
        .filter((p) => !needle || `${p.firstName} ${p.lastName} ${t(p.role)}`.toLowerCase().includes(needle))
        .sort((a, b) => a.lastName.localeCompare(b.lastName))
        .map((p) => ({
          id: p.id,
          node: (
            <>
              <Avatar person={p} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{fullName(p)}</span>
                <span className="flex items-center gap-1 text-[11px] text-muted">
                  {t(p.role)} · {sites.find((s) => s.id === p.homeSiteId)?.code} <LicenseChips licenses={p.licenses} />
                </span>
              </span>
              {p.status !== 'available' && <Pill tone="warning">{t(p.status)}</Pill>}
            </>
          ),
        }));
    return vehicles
      .filter((v) => !needle || `${v.callsign} ${v.plate} ${v.make} ${v.model}`.toLowerCase().includes(needle))
      .map((v) => ({
        id: v.id,
        node: (
          <>
            <span className="mono w-14 shrink-0 whitespace-nowrap font-bold">{v.callsign}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {vehicleDesc(v)}
              </span>
              <span className="block truncate text-[11px] text-muted">
                <span className="mono">{v.plate}</span> · {v.seats}{' '}{t('seats ·')}{' '}{v.requiredLicense} · {sites.find((s) => s.id === v.homeSiteId)?.code}
                {v.fleetgo?.equipmentId ? ' · FleetGO ✓' : ''}
              </span>
            </span>
            {v.status !== 'active' && <Pill tone="warning">{t(v.status)}</Pill>}
          </>
        ),
      }));
  }, [tab, projects, people, vehicles, sites, needle]);

  return (
    <div className={cx('pointer-events-auto absolute inset-x-3 bottom-3 top-[76px] z-20 flex gap-3 transition-opacity', picking && 'pointer-events-none opacity-0')}>
      <Panel className="flex w-[420px] shrink-0 flex-col overflow-hidden">
        <div className="border-b border-line px-4 pb-3 pt-3">
          <div className="flex items-center gap-2">
            <Database size={15} className="text-primary" />
            <span className="text-[14px] font-bold">{t('Master data')}</span>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'projects', label: <><Building2 size={13} />{' '}{t('Projects')}</> },
                { value: 'people', label: <><Users size={13} />{' '}{t('Crew')}</> },
                { value: 'vehicles', label: <><Truck size={13} />{' '}{t('Vehicles')}</> },
              ]}
            />
            <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setSelected('new')}>
              {t('New')}
            </Button>
          </div>
          <div className="mt-2.5 flex h-8 items-center gap-1.5 rounded-lg bg-panel-3 px-2">
            <Search size={13} className="text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Filter…')} className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-subtle" />
          </div>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', selected === r.id ? 'bg-primary-weak' : 'hover:bg-panel-3')}
            >
              {r.node}
            </button>
          ))}
          {rows.length === 0 && <div className="py-8 text-center text-[12px] text-muted">{t('Nothing here yet.')}</div>}
        </div>
        <div className="border-t border-line px-4 py-2 text-[11px] text-muted">
          {tab === 'vehicles'
            ? t('Vehicles are matched to FleetGO by equipment id or licence plate; unknown FleetGO vehicles are imported automatically.')
            : tab === 'projects'
              ? t('Only active projects are used by Randomize. Planned/paused projects stay pickable as destinations.')
              : t('People who are sick, on vacation or in training are never assigned by Randomize.')}
        </div>
      </Panel>
      <Panel className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selected === null ? (
          <div className="grid flex-1 place-items-center text-center text-muted">
            <div>
              <div className="text-[14px] font-semibold text-ink-2">{t('Select a record or create a new one')}</div>
              <div className="mt-1 text-[12px]">{t('Changes are saved to the TrackLiv server and pushed live to every open screen.')}</div>
            </div>
          </div>
        ) : tab === 'projects' ? (
          <ProjectForm key={String(selected)} project={projects.find((p) => p.id === selected)} onDone={setSelected} />
        ) : tab === 'people' ? (
          <PersonForm key={String(selected)} person={people.find((p) => p.id === selected)} onDone={setSelected} />
        ) : (
          <VehicleForm key={String(selected)} vehicle={vehicles.find((v) => v.id === selected)} onDone={setSelected} />
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function FormShell({ title, sub, children, onSave, onDelete, saving, canSave }: { title: string; sub?: string; children: ReactNode; onSave: () => void; onDelete?: () => void; saving: boolean; canSave: boolean }) {
  return (
    <>
      <div className="border-b border-line px-5 py-3">
        <div className="text-[16px] font-bold">{title}</div>
        {sub && <div className="text-[12px] text-muted">{sub}</div>}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="grid max-w-3xl grid-cols-2 gap-x-4 gap-y-3">{children}</div>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-2 px-5 py-3">
        {onDelete && (
          <Button variant="danger" icon={<Trash2 size={13} />} onClick={onDelete}>
            {t('Delete')}
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="primary" icon={saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} disabled={!canSave || saving} onClick={onSave}>
          {t('Save')}
        </Button>
      </div>
    </>
  );
}

function F({ label, children, wide, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: string }) {
  return (
    <label className={cx('block', wide && 'col-span-2')}>
      <span className="mb-1 block text-[11.5px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

const inputCls = 'h-9 w-full rounded-lg border border-line-strong bg-panel-solid px-2.5 text-[13px] outline-none focus:border-primary';

function useSave<T extends { id?: string }>(kind: 'people' | 'projects' | 'vehicles', label: (x: T) => string, onDone: (id: string | null) => void) {
  const [saving, setSaving] = useState(false);
  const toast = useStore((s) => s.toast);
  const save = async (item: Partial<T>) => {
    setSaving(true);
    try {
      const saved = await api.save(kind, item as never);
      toast({ kind: 'success', title: `${label(saved as unknown as T)} saved` });
      onDone((saved as { id: string }).id);
    } catch (e) {
      toast({ kind: 'error', title: t('Could not save'), detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id: string, name: string) => {
    if (!confirm(t("Delete {name}? This also removes it from today's and future plans.", { name }))) return;
    try {
      await api.remove(kind, id);
      toast({ kind: 'success', title: `${name} deleted` });
      onDone(null);
    } catch (e) {
      toast({ kind: 'error', title: t('Could not delete'), detail: e instanceof Error ? e.message : String(e) });
    }
  };
  return { saving, save, remove };
}

function ProjectForm({ project, onDone }: { project?: Project; onDone: (id: string | null) => void }) {
  const [d, setD] = useState<Partial<Project>>(
    project ?? { name: '', code: '', client: '', address: '', status: 'active', priority: 'normal', crewTarget: 3, color: PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)] },
  );
  const [geo, setGeo] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [geoBusy, setGeoBusy] = useState(false);
  const { saving, save, remove } = useSave<Project>('projects', (p) => p.name, onDone);
  const set = <K extends keyof Project>(k: K, v: Project[K]) => setD((x) => ({ ...x, [k]: v }));
  const lookup = async () => {
    if (!d.address || d.address.trim().length < 4) return;
    setGeoBusy(true);
    try {
      const r = await api.geocode(d.address);
      setGeo(r.results);
      if (!r.results.length) useStore.getState().toast({ kind: 'warning', title: t('Address not found'), detail: t('Drop a pin on the map instead.') });
    } catch (e) {
      useStore.getState().toast({ kind: 'warning', title: t('Address search unavailable'), detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setGeoBusy(false);
    }
  };
  const pick = () =>
    useStore.getState().setMapPick({
      label: t('Click on the map to place {name}', { name: d.name || t('the project') }),
      onPick: (loc) => {
        setD((x) => ({ ...x, location: loc }));
        useStore.getState().toast({ kind: 'success', title: t('Location set'), detail: `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)} – ${t('remember to save')}` });
      },
    });
  return (
    <FormShell
      title={project ? project.name : t('New project')}
      sub={project ? project.code : t('Projects appear on the map and in every destination picker')}
      saving={saving}
      canSave={!!d.name?.trim() && !!d.location}
      onSave={() => save(d)}
      onDelete={project ? () => remove(project.id, project.name) : undefined}
    >
      <F label={t('Project name')} wide>
        <input className={inputCls} value={d.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder={t('e.g. Wohnanlage Musterstraße')} />
      </F>
      <F label={t('Code')}>
        <input className={cx(inputCls, 'mono')} value={d.code ?? ''} onChange={(e) => set('code', e.target.value)} placeholder={t('PRJ-2613')} />
      </F>
      <F label={t('Client')}>
        <input className={inputCls} value={d.client ?? ''} onChange={(e) => set('client', e.target.value)} />
      </F>
      <F label={t('Address')} wide hint={d.location ? `${t('Map position')} ${d.location.lat.toFixed(5)}, ${d.location.lng.toFixed(5)}` : t('A map position is required – search the address or drop a pin.')}>
        <div className="flex gap-2">
          <input className={inputCls} value={d.address ?? ''} onChange={(e) => set('address', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder={t('Street, postcode city')} />
          <Button onClick={lookup} icon={geoBusy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}>
            {t('Find')}
          </Button>
          <Button onClick={pick} icon={<Crosshair size={13} />}>
            {t('Pin')}
          </Button>
        </div>
        {geo.length > 0 && (
          <div className="mt-1.5 rounded-lg border border-line bg-panel-2 p-1">
            {geo.map((g) => (
              <button
                key={`${g.lat},${g.lng}`}
                type="button"
                onClick={() => {
                  setD((x) => ({ ...x, location: { lat: g.lat, lng: g.lng }, address: x.address || g.label }));
                  setGeo([]);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] hover:bg-panel-3"
              >
                <MapPin size={12} className="text-primary" /> <span className="truncate">{g.label}</span>
              </button>
            ))}
          </div>
        )}
      </F>
      <F label={t('Status')}>
        <select className={inputCls} value={d.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
          {(['active', 'planned', 'paused', 'completed'] as ProjectStatus[]).map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
      </F>
      <F label={t('Priority')}>
        <div className="flex h-9 items-center gap-1">
          {(['low', 'normal', 'high', 'critical'] as Priority[]).map((p) => (
            <button key={p} type="button" onClick={() => set('priority', p)} className={cx('rounded-full', d.priority !== p && 'opacity-40 hover:opacity-80')}>
              <Pill tone={PRIORITY_TONE[p]}>{t(p)}</Pill>
            </button>
          ))}
        </div>
      </F>
      <F label={t('Crew needed per day')} hint={t('Randomize weights projects by priority and spreads vehicles')}>
        <input type="number" min={1} max={40} className={inputCls} value={d.crewTarget ?? ''} onChange={(e) => set('crewTarget', e.target.value ? Number(e.target.value) : undefined)} />
      </F>
      <F label={t('Colour')}>
        <div className="flex h-9 flex-wrap items-center gap-1.5">
          {PROJECT_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => set('color', c)} className={cx('size-6 rounded-full', d.color === c && 'ring-2 ring-ink ring-offset-2 ring-offset-[var(--panel-solid)]')} style={{ background: c }} aria-label={c} />
          ))}
        </div>
      </F>
      <F label={t('Start')}>
        <input type="date" className={inputCls} value={d.start ?? ''} onChange={(e) => set('start', e.target.value || undefined)} />
      </F>
      <F label={t('End')}>
        <input type="date" className={inputCls} value={d.end ?? ''} onChange={(e) => set('end', e.target.value || undefined)} />
      </F>
      <F label={t('Notes')} wide>
        <textarea className={cx(inputCls, 'h-20 py-2')} value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </F>
    </FormShell>
  );
}

function PersonForm({ person, onDone }: { person?: Person; onDone: (id: string | null) => void }) {
  const sites = useStore((s) => s.sites);
  const [d, setD] = useState<Partial<Person>>(person ?? { firstName: '', lastName: '', role: 'Operative', licenses: [], homeSiteId: sites[0]?.id, status: 'available' });
  const { saving, save, remove } = useSave<Person>('people', (p) => fullName(p), onDone);
  const set = <K extends keyof Person>(k: K, v: Person[K]) => setD((x) => ({ ...x, [k]: v }));
  const toggleLicense = (l: LicenseClass) => set('licenses', d.licenses?.includes(l) ? d.licenses.filter((x) => x !== l) : [...(d.licenses ?? []), l]);
  return (
    <FormShell
      title={person ? fullName(person) : t('New crew member')}
      sub={person?.id}
      saving={saving}
      canSave={!!(d.firstName?.trim() || d.lastName?.trim())}
      onSave={() => save(d)}
      onDelete={person ? () => remove(person.id, fullName(person)) : undefined}
    >
      <F label={t('First name')}>
        <input className={inputCls} value={d.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} />
      </F>
      <F label={t('Last name')}>
        <input className={inputCls} value={d.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} />
      </F>
      <F label={t('Role')}>
        <select className={inputCls} value={d.role} onChange={(e) => set('role', e.target.value as PersonRole)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(r)}
            </option>
          ))}
        </select>
      </F>
      <F label={t('Home depot')}>
        <select className={inputCls} value={d.homeSiteId} onChange={(e) => set('homeSiteId', e.target.value)}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
      </F>
      <F label={t('Driving licences')} wide hint={t('Each vehicle needs at least one crew member whose licence covers its class (CE covers C, C1, BE, B …)')}>
        <div className="flex flex-wrap gap-1.5">
          {LICENSES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => toggleLicense(l)}
              className={cx('mono h-8 min-w-11 rounded-lg border px-2 text-[12px] font-bold', d.licenses?.includes(l) ? 'border-primary bg-primary-weak text-primary' : 'border-line-strong text-muted hover:border-primary')}
            >
              {l}
            </button>
          ))}
        </div>
      </F>
      <F label={t('Status')}>
        <select className={inputCls} value={d.status} onChange={(e) => set('status', e.target.value as PersonStatus)}>
          {(['available', 'sick', 'vacation', 'training'] as PersonStatus[]).map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
      </F>
      <F label={t('Phone')}>
        <input className={inputCls} value={d.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+49 …" />
      </F>
    </FormShell>
  );
}

function VehicleForm({ vehicle, onDone }: { vehicle?: Vehicle; onDone: (id: string | null) => void }) {
  const sites = useStore((s) => s.sites);
  const [d, setD] = useState<Partial<Vehicle>>(
    vehicle ?? { callsign: '', plate: 'MTK-TE ', make: '', model: '', kind: 'van', seats: 4, requiredLicense: 'B', homeSiteId: sites[0]?.id, status: 'active' },
  );
  const { saving, save, remove } = useSave<Vehicle>('vehicles', (v) => v.callsign, onDone);
  const set = <K extends keyof Vehicle>(k: K, v: Vehicle[K]) => setD((x) => ({ ...x, [k]: v }));
  return (
    <FormShell
      title={vehicle ? `${vehicle.callsign} · ${vehicle.plate}` : t('New vehicle')}
      sub={vehicle ? vehicleDesc(vehicle) : t('Or let FleetGO import it automatically')}
      saving={saving}
      canSave={!!(d.callsign?.trim() || d.plate?.trim())}
      onSave={() => save(d)}
      onDelete={vehicle ? () => remove(vehicle.id, vehicle.callsign) : undefined}
    >
      <F label={t('Call sign')}>
        <input className={cx(inputCls, 'mono')} value={d.callsign ?? ''} onChange={(e) => set('callsign', e.target.value)} placeholder="T-14" />
      </F>
      <F label={t('Licence plate')} hint={t('Used to match FleetGO vehicles')}>
        <input className={cx(inputCls, 'mono')} value={d.plate ?? ''} onChange={(e) => set('plate', e.target.value)} />
      </F>
      <F label={t('Make')}>
        <input className={inputCls} value={d.make ?? ''} onChange={(e) => set('make', e.target.value)} />
      </F>
      <F label={t('Model')}>
        <input className={inputCls} value={d.model ?? ''} onChange={(e) => set('model', e.target.value)} />
      </F>
      <F label={t('Type')}>
        <select className={inputCls} value={d.kind} onChange={(e) => set('kind', e.target.value as VehicleKind)}>
          <option value="van">{t('Van')}</option>
          <option value="truck">{t('Box truck')}</option>
          <option value="pickup">{t('Pickup')}</option>
          <option value="car">{t('Car')}</option>
        </select>
      </F>
      <F label={t('Crew seats')} hint={t('1–4 people')}>
        <Segmented value={String(d.seats ?? 4)} onChange={(v) => set('seats', Number(v))} options={['1', '2', '3', '4'].map((n) => ({ value: n, label: n }))} />
      </F>
      <F label={t('Licence needed')}>
        <select className={inputCls} value={d.requiredLicense} onChange={(e) => set('requiredLicense', e.target.value as LicenseClass)}>
          {LICENSES.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </F>
      <F label={t('Home depot')}>
        <select className={inputCls} value={d.homeSiteId} onChange={(e) => set('homeSiteId', e.target.value)}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
      </F>
      <F label={t('Status')}>
        <select className={inputCls} value={d.status} onChange={(e) => set('status', e.target.value as VehicleStatus)}>
          <option value="active">{t('active')}</option>
          <option value="maintenance">{t('maintenance')}</option>
          <option value="inactive">{t('inactive')}</option>
        </select>
      </F>
      <F label={t('FleetGO equipment id')} hint={t('Optional – set automatically on the first match')}>
        <input
          className={cx(inputCls, 'mono')}
          value={d.fleetgo?.equipmentId !== undefined ? String(d.fleetgo.equipmentId) : ''}
          onChange={(e) => set('fleetgo', e.target.value ? { ...d.fleetgo, equipmentId: e.target.value } : undefined)}
        />
      </F>
    </FormShell>
  );
}
