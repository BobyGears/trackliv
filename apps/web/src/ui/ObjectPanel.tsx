import {
  STAGE_LABEL,
  assignPerson,
  canDrive,
  crewCapacity,
  destinationLocation,
  formatDistance,
  fullName,
  haversineM,
  isAtDepot,
  makeLocalProjection,
  setDestination,
  setTimes,
  setVehicleLock,
  toggleCrewLock,
  unassignPerson,
  validatePlan,
  type Destination,
  type ID,
  type Person,
  type PersonStatus,
} from '@trackliv/core';
import {
  ArrowUpRight,
  Building2,
  Crosshair,
  Fuel,
  Lock,
  MapPin,
  Navigation,
  Phone,
  Play,
  Plus,
  RotateCcw,
  Truck,
  Unlock,
  UserRound,
  Warehouse,
  X,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { runInfo, useOpsNow, vehicleKindLabel } from '../lib/derived';
import { PRIORITY_TONE, STAGE_TONE, fmtAgo, fmtDuration, fmtTime } from '../lib/format';
import { useStore, type Selection } from '../lib/store';
import { DestinationPicker } from './DestinationPicker';
import { Avatar, AvatarStack, Button, IconButton, LicenseChips, Panel, Pill, ProgressBar, Prop, SectionLabel, cx } from './kit';

export function ObjectPanel() {
  const selection = useStore((s) => s.selection);
  if (!selection) return null;
  return (
    <Panel className="pointer-events-auto absolute right-3 top-[76px] z-20 flex max-h-[calc(100%-330px)] min-h-[200px] w-[360px] flex-col overflow-hidden">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {selection.type === 'vehicle' && <VehiclePanel id={selection.id} />}
        {selection.type === 'person' && <PersonPanel id={selection.id} />}
        {selection.type === 'project' && <ProjectPanel id={selection.id} />}
        {selection.type === 'site' && <SitePanel id={selection.id} />}
      </div>
    </Panel>
  );
}

function Header({ kicker, title, sub, icon, color, actions }: { kicker: string; title: ReactNode; sub?: ReactNode; icon: ReactNode; color: string; actions?: ReactNode }) {
  const select = useStore((s) => s.select);
  return (
    <div className="sticky top-0 z-10 border-b border-line bg-panel-solid/80 px-4 pb-3 pt-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md text-white" style={{ background: color }}>
          {icon}
        </span>
        <span className="flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">{kicker}</span>
        {actions}
        <IconButton size="sm" label="Close" onClick={() => select(null)}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="mt-1.5 text-[19px] font-bold leading-tight tracking-tight">{title}</div>
      {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

function Linked({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-panel-3">
      {children}
      <ArrowUpRight size={14} className="shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

// ---------------------------------------------------------------------------------------------

function VehiclePanel({ id }: { id: ID }) {
  const now = useOpsNow();
  useStore((s) => s.plan);
  useStore((s) => s.telemetry[id]);
  const people = useStore((s) => s.people);
  const projects = useStore((s) => s.projects);
  const sites = useStore((s) => s.sites);
  const commit = useStore((s) => s.commit);
  const select = useStore((s) => s.select);
  const telemetry = useStore((s) => s.telemetry[id]);
  const [picker, setPicker] = useState(false);
  const [adding, setAdding] = useState(false);
  const destBtn = useRef<HTMLButtonElement>(null);
  const info = runInfo(id, now);
  if (!info) return null;
  const { vehicle: v, assignment: a, crew } = info;
  const ctx = useStore.getState().ctx();
  const cap = crewCapacity(v);
  const home = sites.find((s) => s.id === v.homeSiteId);
  const project = a?.destination?.kind === 'project' ? projects.find((p) => p.id === (a.destination as { projectId: string }).projectId) : undefined;
  const issues = validatePlan(a ? [a] : [], ctx).filter((i) => i.vehicleId === v.id);
  const fullyLocked = !!a && a.crew.length > 0 && a.crew.every((p) => a.lockedCrew.includes(p)) && (a.destinationLocked || !a.destination);
  const canDispatch = !!a?.crew.length && !!a.destination && (a.stage === 'planned' || a.stage === 'completed');
  const canRecall = a?.stage === 'departed' || a?.stage === 'on_site';
  const free = people
    .filter((p) => !a?.crew.includes(p.id))
    .sort((x, y) => Number(x.status !== 'available') - Number(y.status !== 'available') || Number(!!findVehicleOf(x.id)) - Number(!!findVehicleOf(y.id)));

  return (
    <>
      <Header
        kicker={`Vehicle · ${vehicleKindLabel[v.kind]} · ${v.make} ${v.model}`}
        title={
          <span className="flex items-center gap-2">
            {v.callsign}
            <span className="mono rounded-md border border-line-strong px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">{v.plate}</span>
          </span>
        }
        icon={<Truck size={13} />}
        color={project?.color ?? '#64748b'}
        actions={
          <IconButton size="sm" label="Focus on map" onClick={() => useStore.getState().requestFocus({ kind: 'vehicle', id })}>
            <Crosshair size={15} />
          </IconButton>
        }
      />
      <div className="space-y-4 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={STAGE_TONE[info.stage]} dot>
            {info.late ? 'Late to depart' : info.stageLabel}
          </Pill>
          {v.status !== 'active' && <Pill tone="warning">{v.status}</Pill>}
          {telemetry ? (
            <Pill tone={telemetry.ignition ? 'success' : 'neutral'}>{telemetry.ignition ? `Ignition on · ${telemetry.speedKmh} km/h` : 'Parked'}</Pill>
          ) : (
            <Pill tone="danger">No GPS signal</Pill>
          )}
          {fullyLocked && (
            <Pill tone="violet">
              <Lock size={10} /> pinned
            </Pill>
          )}
        </div>

        {/* Run progress, like the "battery" bar in the reference */}
        <div className="rounded-xl border border-line bg-panel-2 p-3">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-semibold">{a?.crew.length ? `${info.stageLabel} · ${info.destLabel}` : 'No run planned'}</span>
            <span className="text-muted">
              {info.etaMin !== null && (info.stage === 'departed' || info.stage === 'returning')
                ? `ETA ${fmtDuration(info.etaMin)}`
                : info.stage === 'planned' && a?.departAt
                  ? `leaves ${a.departAt}`
                  : info.stage === 'on_site' && a?.returnAt
                    ? `back ${a.returnAt}`
                    : ''}
            </span>
          </div>
          <div className="mt-2">
            <ProgressBar value={(info.progress ?? 0) * 100} tone={STAGE_TONE[info.stage] === 'neutral' ? 'primary' : STAGE_TONE[info.stage]} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted">
            <span>{home?.code}</span>
            <span>{info.remainingM !== null ? `${formatDistance(info.remainingM)} to go` : ''}</span>
            <span className="max-w-36 truncate">{info.destLabel}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {canDispatch && (
            <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => useStore.getState().dispatchNow(id)}>
              Dispatch now
            </Button>
          )}
          {canRecall && (
            <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => useStore.getState().recall(id)}>
              Recall to depot
            </Button>
          )}
          <Button
            size="sm"
            variant={fullyLocked ? 'violet' : 'secondary'}
            icon={fullyLocked ? <Lock size={13} /> : <Unlock size={13} />}
            disabled={!a?.crew.length}
            onClick={() => commit((list) => setVehicleLock(list, id, !fullyLocked), fullyLocked ? `${v.callsign} unpinned` : `${v.callsign} pinned`)}
            title="Pinned crews and destinations are kept by Randomize"
          >
            {fullyLocked ? 'Pinned' : 'Pin crew & destination'}
          </Button>
        </div>

        {issues.length > 0 && (
          <div className="space-y-1">
            {issues.map((i, k) => (
              <div key={k} className={cx('rounded-lg px-2.5 py-1.5 text-[12px]', i.severity === 'error' ? 'bg-danger-weak text-danger' : i.severity === 'warning' ? 'bg-warning-weak text-warning' : 'bg-panel-3 text-muted')}>
                {i.message}
              </div>
            ))}
          </div>
        )}

        <div>
          <SectionLabel right={<span className="text-[11px] text-muted">{a?.crew.length ?? 0} / {cap} seats</span>}>Crew</SectionLabel>
          <div className="mt-1.5 space-y-0.5">
            {crew.map((p, i) => {
              const locked = a?.lockedCrew.includes(p.id);
              return (
                <div key={p.id} className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-panel-3">
                  <Avatar person={p} size={26} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => select({ type: 'person', id: p.id })}>
                    <span className="block truncate font-semibold">
                      {fullName(p)}
                      {i === 0 && canDrive(p, v) && <span className="ml-1.5 text-[10.5px] font-medium text-primary">driver</span>}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-muted">
                      {p.role} <LicenseChips licenses={p.licenses} />
                    </span>
                  </button>
                  <IconButton size="sm" label={locked ? 'Unpin from vehicle' : 'Pin to this vehicle'} active={locked} onClick={() => commit((list) => toggleCrewLock(list, id, p.id))}>
                    {locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </IconButton>
                  <IconButton size="sm" label="Remove from vehicle" onClick={() => commit((list) => unassignPerson(list, p.id), `${fullName(p)} removed from ${v.callsign}`)}>
                    <X size={13} />
                  </IconButton>
                </div>
              );
            })}
            {(a?.crew.length ?? 0) < cap && !adding && (
              <button onClick={() => setAdding(true)} className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line-strong px-2 py-1.5 text-[12px] font-semibold text-muted hover:border-primary hover:text-primary">
                <Plus size={14} /> Add crew member
              </button>
            )}
            {adding && (
              <select
                autoFocus
                className="h-8 w-full rounded-lg border border-line-strong bg-panel-solid px-2 text-[12.5px]"
                defaultValue=""
                onBlur={() => setAdding(false)}
                onChange={(e) => {
                  const pid = e.target.value;
                  setAdding(false);
                  if (pid) commit((list) => assignPerson(list, ctx, pid, id), `Crew change on ${v.callsign}`);
                }}
              >
                <option value="" disabled>
                  Choose a person…
                </option>
                {free.map((p) => {
                  const on = findVehicleOf(p.id);
                  return (
                    <option key={p.id} value={p.id} disabled={p.status !== 'available'}>
                      {fullName(p)} · {p.role}
                      {p.licenses.length ? ` · ${p.licenses.join('/')}` : ''}
                      {on ? ` (on ${on})` : ''}
                      {p.status !== 'available' ? ` – ${p.status}` : ''}
                    </option>
                  );
                })}
              </select>
            )}
          </div>
        </div>

        <div>
          <SectionLabel>Assignment</SectionLabel>
          <div className="mt-1.5">
            <div className="flex min-h-7 items-center justify-between gap-3 border-b border-line py-1">
              <span className="text-muted">Destination</span>
              <button
                ref={destBtn}
                onClick={() => setPicker(true)}
                className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 font-semibold hover:bg-panel-3"
              >
                {a?.destinationLocked && <Lock size={11} className="text-violet" />}
                {project && <span className="size-2 rounded-full" style={{ background: project.color }} />}
                {!project && a?.destination && <MapPin size={12} className="text-violet" />}
                <span className="truncate">{a?.destination ? info.destLabel : 'Choose…'}</span>
              </button>
            </div>
            <div className="flex min-h-7 items-center justify-between gap-3 border-b border-line py-1">
              <span className="text-muted">Depart / return</span>
              <span className="flex items-center gap-1">
                <TimeInput value={a?.departAt} onChange={(t) => commit((list) => setTimes(list, id, { departAt: t }))} />
                <span className="text-subtle">→</span>
                <TimeInput value={a?.returnAt} onChange={(t) => commit((list) => setTimes(list, id, { returnAt: t }))} />
              </span>
            </div>
            {a?.stageTimes.departed && <Prop label="Departed">{fmtTime(a.stageTimes.departed)}</Prop>}
            {a?.stageTimes.on_site && <Prop label="Arrived on site">{fmtTime(a.stageTimes.on_site)}</Prop>}
            {a?.stageTimes.completed && <Prop label="Back at depot">{fmtTime(a.stageTimes.completed)}</Prop>}
          </div>
        </div>

        <div>
          <SectionLabel right={<span className="text-[11px] text-muted">{telemetry?.source === 'fleetgo' ? 'FleetGO' : 'Simulator'}</span>}>Telemetry</SectionLabel>
          <div className="mt-1.5">
            <Prop label="Last GPS fix">{telemetry ? fmtAgo(telemetry.ts, now) : '–'}</Prop>
            <Prop label="Speed">{telemetry ? `${telemetry.speedKmh} km/h` : '–'}</Prop>
            {telemetry?.fuelPct !== undefined && (
              <div className="flex min-h-7 items-center justify-between gap-3 border-b border-line py-1">
                <span className="flex items-center gap-1 text-muted">
                  <Fuel size={12} /> Fuel
                </span>
                <span className="flex w-36 items-center gap-2">
                  <ProgressBar value={telemetry.fuelPct} tone={telemetry.fuelPct < 25 ? 'warning' : 'success'} />
                  <span className="w-8 text-right font-medium">{telemetry.fuelPct}%</span>
                </span>
              </div>
            )}
            <Prop label="Odometer">{telemetry?.odometerKm ? `${Math.round(telemetry.odometerKm).toLocaleString('de-DE')} km` : '–'}</Prop>
            <Prop label="Position" mono>
              {telemetry ? `${telemetry.lat.toFixed(5)}, ${telemetry.lng.toFixed(5)}` : '–'}
            </Prop>
            <Prop label="Home depot">{home ? `${home.code} · ${home.name}` : '–'}</Prop>
            <Prop label="Licence needed">{v.requiredLicense}</Prop>
          </div>
        </div>

        {project && (
          <div>
            <SectionLabel>Linked project</SectionLabel>
            <div className="mt-1">
              <Linked onClick={() => select({ type: 'project', id: project.id })}>
                <span className="grid size-7 place-items-center rounded-md text-white" style={{ background: project.color }}>
                  <Building2 size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{project.name}</span>
                  <span className="block truncate text-[11px] text-muted">{project.address}</span>
                </span>
              </Linked>
            </div>
          </div>
        )}
      </div>
      {picker && destBtn.current && (
        <DestinationPicker
          anchor={destBtn.current}
          vehicleId={id}
          value={a?.destination ?? null}
          locked={!!a?.destinationLocked}
          onSelect={(dest: Destination | null, lock) => commit((list) => setDestination(list, id, dest, { lock }), `${v.callsign} → ${dest ? (dest.kind === 'project' ? projects.find((p) => p.id === dest.projectId)?.name : dest.label) : 'no destination'}`)}
          onClose={() => setPicker(false)}
        />
      )}
    </>
  );
}

function findVehicleOf(personId: ID): string | null {
  const s = useStore.getState();
  const a = s.plan.assignments.find((x) => x.crew.includes(personId));
  return a ? (s.vehicles.find((v) => v.id === a.vehicleId)?.callsign ?? null) : null;
}

/** 24-hour HH:MM field (native time inputs follow the browser locale and may show AM/PM). ↑/↓ = ±5 min. */
export function TimeInput({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const norm = (s: string): string | undefined | null => {
    const t = s.trim();
    if (!t) return undefined;
    const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(t);
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2] ?? 0);
    if (h > 23 || mi > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  };
  const commitDraft = () => {
    if (draft === null) return;
    const v = norm(draft);
    setDraft(null);
    if (v !== null && v !== value) onChange(v);
  };
  const step = (d: number) => {
    const base = norm(draft ?? value ?? '07:00') ?? '07:00';
    const [h, m] = base.split(':').map(Number);
    const t = (((h * 60 + m + d) % 1440) + 1440) % 1440;
    const next = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    setDraft(null);
    onChange(next);
  };
  const invalid = draft !== null && norm(draft) === null;
  return (
    <input
      inputMode="numeric"
      placeholder="--:--"
      value={draft ?? value ?? ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitDraft}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          step(5);
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          step(-5);
        }
        if (e.key === 'Escape') setDraft(null);
      }}
      className={cx(
        'mono h-7 w-[58px] rounded-md border bg-panel-solid px-1.5 text-center text-[12px] text-ink outline-none focus:border-primary',
        invalid ? 'border-danger' : 'border-line',
      )}
      title="HH:MM (24 h) · ↑/↓ ±5 min"
    />
  );
}

// ---------------------------------------------------------------------------------------------

const STATUS_TONE: Record<PersonStatus, 'success' | 'danger' | 'warning' | 'primary'> = {
  available: 'success',
  sick: 'danger',
  vacation: 'warning',
  training: 'primary',
};

function PersonPanel({ id }: { id: ID }) {
  const person = useStore((s) => s.people.find((p) => p.id === id));
  const plan = useStore((s) => s.plan);
  const vehicles = useStore((s) => s.vehicles);
  const sites = useStore((s) => s.sites);
  const commit = useStore((s) => s.commit);
  const select = useStore((s) => s.select);
  const now = useOpsNow();
  if (!person) return null;
  const a = plan.assignments.find((x) => x.crew.includes(id));
  const vehicle = a ? vehicles.find((v) => v.id === a.vehicleId) : undefined;
  const info = vehicle ? runInfo(vehicle.id, now) : null;
  const home = sites.find((s) => s.id === person.homeSiteId);
  const locked = !!a?.lockedCrew.includes(id);
  const ctx = useStore.getState().ctx();

  const setStatus = async (status: PersonStatus) => {
    try {
      await api.save<Person>('people', { ...person, status });
      if (status !== 'available' && a) commit((list) => unassignPerson(list, id), `${fullName(person)} is ${status} – removed from ${vehicle?.callsign}`);
    } catch (e) {
      useStore.getState().toast({ kind: 'error', title: 'Could not update status', detail: String(e) });
    }
  };

  return (
    <>
      <Header kicker={`Person · ${person.role}`} title={fullName(person)} sub={home ? `${home.code} · ${home.name}` : undefined} icon={<UserRound size={13} />} color="#64748b" />
      <div className="space-y-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar person={person} size={44} />
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap gap-1">
              {(['available', 'sick', 'vacation', 'training'] as PersonStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize', person.status !== s && 'text-muted hover:bg-panel-3')}
                  style={person.status === s ? { background: `var(--${STATUS_TONE[s]}-weak)`, color: `var(--${STATUS_TONE[s]})` } : undefined}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
              Licences <LicenseChips licenses={person.licenses} />
            </div>
          </div>
        </div>
        <div>
          <SectionLabel>Today</SectionLabel>
          {vehicle && info ? (
            <div className="mt-1.5 rounded-xl border border-line bg-panel-2 p-2">
              <Linked onClick={() => select({ type: 'vehicle', id: vehicle.id })}>
                <span className="grid size-8 place-items-center rounded-md bg-panel-solid text-ink-2 ring-1 ring-line">
                  <Truck size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {vehicle.callsign} <span className="mono text-[11px] text-muted">{vehicle.plate}</span>
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {info.stageLabel} · {info.destLabel}
                  </span>
                </span>
                <Pill tone={STAGE_TONE[info.stage]}>{STAGE_LABEL[info.stage]}</Pill>
              </Linked>
              <div className="mt-1 flex gap-1.5 px-1">
                <Button size="sm" variant={locked ? 'violet' : 'secondary'} icon={locked ? <Lock size={12} /> : <Unlock size={12} />} onClick={() => commit((list) => toggleCrewLock(list, vehicle.id, id))}>
                  {locked ? 'Pinned to vehicle' : 'Pin to vehicle'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => commit((list) => unassignPerson(list, id), `${fullName(person)} unassigned`)}>
                  Unassign
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-1.5 rounded-xl border border-dashed border-line-strong p-3 text-[12px] text-muted">
              {person.status === 'available' ? 'Not on a vehicle today.' : `Unavailable (${person.status}).`}
            </div>
          )}
          {person.status === 'available' && (
            <select
              className="mt-2 h-8 w-full rounded-lg border border-line-strong bg-panel-solid px-2 text-[12.5px]"
              value=""
              onChange={(e) => e.target.value && commit((list) => assignPerson(list, ctx, id, e.target.value), `${fullName(person)} moved`)}
            >
              <option value="">{vehicle ? 'Move to another vehicle…' : 'Assign to a vehicle…'}</option>
              {vehicles
                .filter((v) => v.status === 'active' && v.id !== vehicle?.id)
                .map((v) => {
                  const va = plan.assignments.find((x) => x.vehicleId === v.id);
                  const full = (va?.crew.length ?? 0) >= crewCapacity(v);
                  return (
                    <option key={v.id} value={v.id} disabled={full}>
                      {v.callsign} · {va?.crew.length ?? 0}/{crewCapacity(v)} {full ? '(full)' : ''} {canDrive(person, v) ? '· can drive' : ''}
                    </option>
                  );
                })}
            </select>
          )}
        </div>
        <div>
          <SectionLabel>Details</SectionLabel>
          <div className="mt-1.5">
            <Prop label="Role">{person.role}</Prop>
            <Prop label="Home depot">{home?.name ?? '–'}</Prop>
            <Prop label="Person ID" mono>
              {person.id}
            </Prop>
            {person.phone && (
              <Prop label="Phone">
                <a href={`tel:${person.phone}`} className="inline-flex items-center gap-1 text-primary">
                  <Phone size={12} /> {person.phone}
                </a>
              </Prop>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function ProjectPanel({ id }: { id: ID }) {
  const project = useStore((s) => s.projects.find((p) => p.id === id));
  const plan = useStore((s) => s.plan);
  const vehicles = useStore((s) => s.vehicles);
  const people = useStore((s) => s.people);
  const sites = useStore((s) => s.sites);
  const commit = useStore((s) => s.commit);
  const select = useStore((s) => s.select);
  const now = useOpsNow();
  if (!project) return null;
  const runs = plan.assignments.filter((a) => a.destination?.kind === 'project' && a.destination.projectId === id && a.crew.length);
  const crew = runs.flatMap((a) => a.crew).map((pid) => people.find((p) => p.id === pid)).filter((p): p is Person => !!p);
  const target = project.crewTarget ?? 0;
  const freeVehicles = vehicles.filter((v) => {
    const a = plan.assignments.find((x) => x.vehicleId === v.id);
    return v.status === 'active' && (!a || (a.stage === 'planned' && !a.destinationLocked && !(a.destination?.kind === 'project' && a.destination.projectId === id)));
  });
  const nearest = sites.map((s) => ({ s, d: haversineM(s.location, project.location) })).sort((a, b) => a.d - b.d)[0];

  return (
    <>
      <Header
        kicker={`Project · ${project.code}`}
        title={project.name}
        sub={project.client}
        icon={<Building2 size={13} />}
        color={project.color}
        actions={
          <IconButton size="sm" label="Focus on map" onClick={() => useStore.getState().requestFocus({ kind: 'project', id })}>
            <Crosshair size={15} />
          </IconButton>
        }
      />
      <div className="space-y-4 px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          <Pill tone={project.status === 'active' ? 'success' : 'neutral'} dot>
            {project.status}
          </Pill>
          <Pill tone={PRIORITY_TONE[project.priority]}>{project.priority} priority</Pill>
          {nearest && <Pill>{formatDistance(nearest.d)} from {nearest.s.code}</Pill>}
        </div>
        <div className="rounded-xl border border-line bg-panel-2 p-3">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-semibold">Crew today</span>
            <span className={cx('font-semibold', crew.length >= target ? 'text-success' : 'text-warning')}>
              {crew.length} / {target || '–'}
            </span>
          </div>
          <div className="mt-2">
            <ProgressBar value={target ? (crew.length / target) * 100 : crew.length ? 100 : 0} tone={crew.length >= target ? 'success' : 'warning'} />
          </div>
          <div className="mt-2">
            <AvatarStack people={crew} max={8} />
          </div>
        </div>
        <div>
          <SectionLabel right={<span className="text-[11px] text-muted">{runs.length}</span>}>Vehicles</SectionLabel>
          <div className="mt-1 space-y-0.5">
            {runs.length === 0 && <div className="py-2 text-[12px] text-muted">No vehicle is going here today.</div>}
            {runs.map((a) => {
              const v = vehicles.find((x) => x.id === a.vehicleId)!;
              const info = runInfo(v.id, now);
              return (
                <Linked key={a.vehicleId} onClick={() => select({ type: 'vehicle', id: v.id })}>
                  <span className="grid size-8 place-items-center rounded-md bg-panel-2 text-ink-2 ring-1 ring-line">
                    <Truck size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {v.callsign} <span className="font-normal text-muted">· {a.crew.length} crew</span>
                    </span>
                    <span className="block text-[11px] text-muted">
                      {a.departAt ?? '–'} → {a.returnAt ?? '–'}
                      {info?.etaMin !== null && info?.stage === 'departed' ? ` · ETA ${fmtDuration(info.etaMin)}` : ''}
                    </span>
                  </span>
                  <Pill tone={STAGE_TONE[a.stage]}>{STAGE_LABEL[a.stage]}</Pill>
                </Linked>
              );
            })}
          </div>
          {project.status === 'active' && freeVehicles.length > 0 && (
            <select
              className="mt-2 h-8 w-full rounded-lg border border-line-strong bg-panel-solid px-2 text-[12.5px]"
              value=""
              onChange={(e) => {
                const vid = e.target.value;
                if (vid) commit((list) => setDestination(list, vid, { kind: 'project', projectId: id }), `${vehicles.find((v) => v.id === vid)?.callsign} → ${project.name}`);
              }}
            >
              <option value="">Send another vehicle here…</option>
              {freeVehicles.map((v) => {
                const a = plan.assignments.find((x) => x.vehicleId === v.id);
                return (
                  <option key={v.id} value={v.id}>
                    {v.callsign} · {a?.crew.length ?? 0} crew{a?.destination ? ' (has another destination)' : ''}
                  </option>
                );
              })}
            </select>
          )}
        </div>
        <div>
          <SectionLabel>Details</SectionLabel>
          <div className="mt-1.5">
            <Prop label="Address">{project.address}</Prop>
            <Prop label="Client">{project.client}</Prop>
            <Prop label="Location" mono>
              {project.location.lat.toFixed(5)}, {project.location.lng.toFixed(5)}
            </Prop>
            <Prop label="Project ID" mono>
              {project.id}
            </Prop>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function SitePanel({ id }: { id: ID }) {
  const site = useStore((s) => s.sites.find((x) => x.id === id));
  const geo = useStore((s) => s.siteGeo.find((x) => x.id === id));
  const vehicles = useStore((s) => s.vehicles);
  const telemetry = useStore((s) => s.telemetry);
  const people = useStore((s) => s.people);
  const plan = useStore((s) => s.plan);
  const select = useStore((s) => s.select);
  const now = useOpsNow(5000);
  if (!site) return null;
  const assigned = new Set(plan.assignments.flatMap((a) => a.crew));
  const home = vehicles.filter((v) => v.homeSiteId === id);
  const inYard = home.filter((v) => telemetry[v.id] && isAtDepot(telemetry[v.id], [site]));
  const idle = people.filter((p) => p.homeSiteId === id && p.status === 'available' && !assigned.has(p.id));
  const off = people.filter((p) => p.homeSiteId === id && p.status !== 'available');
  let area = 0;
  if (geo) {
    const proj = makeLocalProjection(site.location);
    const ring = geo.footprint.map(([lng, lat]) => proj.toLocal({ lng, lat }));
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      area += p.x * q.y - q.x * p.y;
    }
    area = Math.abs(area) / 2;
  }
  return (
    <>
      <Header
        kicker={`HQ · ${site.code}`}
        title={site.name}
        sub={site.address}
        icon={<Warehouse size={13} />}
        color={site.color}
        actions={
          <IconButton size="sm" label="Fly to 3D view" onClick={() => useStore.getState().requestFocus({ kind: 'site', id })}>
            <Navigation size={15} />
          </IconButton>
        }
      />
      <div className="space-y-4 px-4 py-3">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="In yard" value={`${inYard.length}/${home.length}`} />
          <Stat label="Unassigned" value={idle.length} />
          <Stat label="Off today" value={off.length} />
        </div>
        <div>
          <SectionLabel>Vehicles based here</SectionLabel>
          <div className="mt-1 space-y-0.5">
            {home.map((v) => {
              const info = runInfo(v.id, now);
              return (
                <Linked key={v.id} onClick={() => select({ type: 'vehicle', id: v.id }, { focus: true })}>
                  <span className="mono w-11 font-semibold">{v.callsign}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{info?.assignment?.crew.length ? info.destLabel : v.status === 'active' ? 'Unassigned' : v.status}</span>
                  {info && <Pill tone={STAGE_TONE[info.stage]}>{info.stageLabel}</Pill>}
                </Linked>
              );
            })}
          </div>
        </div>
        {idle.length > 0 && (
          <div>
            <SectionLabel>Waiting for an assignment</SectionLabel>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {idle.map((p) => (
                <button key={p.id} onClick={() => select({ type: 'person', id: p.id })} className="flex items-center gap-1.5 rounded-full bg-panel-3 py-0.5 pl-0.5 pr-2 text-[11.5px] font-medium hover:bg-panel-2">
                  <Avatar person={p} size={18} /> {p.firstName}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <SectionLabel>Building (true scale)</SectionLabel>
          <div className="mt-1.5">
            <Prop label="Footprint">{area ? `${Math.round(area).toLocaleString('de-DE')} m²` : '–'}</Prop>
            <Prop label="Height">{geo?.heightM ? `${geo.heightM} m` : '–'}</Prop>
            <Prop label="Yard bays">{geo?.yard.length ?? 0}</Prop>
            <Prop label="Geofence">{site.geofenceRadiusM} m radius</Prop>
            <Prop label="Address point" mono>
              {site.location.lat.toFixed(5)}, {site.location.lng.toFixed(5)}
            </Prop>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-subtle">
            Footprint & height from OpenStreetMap / Microsoft building data via Overture Maps; address point from the Hessen address register.
          </p>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2 px-2.5 py-2">
      <div className="text-[18px] font-bold leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-muted">{label}</div>
    </div>
  );
}

export type { Selection };
