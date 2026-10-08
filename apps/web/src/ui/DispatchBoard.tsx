import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  assignPerson,
  canDrive,
  clearUnlocked,
  crewCapacity,
  destinationLabel,
  fullName,
  pinGroupToTask,
  setDestination,
  setTimes,
  STAGE_LABEL,
  setVehicleLock,
  toggleCrewLock,
  unassignPerson,
  validatePlan,
  type Assignment,
  type Destination,
  type ID,
  type Person,
  type Vehicle,
} from '@trackliv/core';
import {
  AlertTriangle,
  Car,
  Check,
  Eraser,
  GripVertical,
  Lock,
  MapPin,
  Play,
  Redo2,
  Search,
  Send,
  Shuffle,
  Truck,
  Undo2,
  Unlock,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { STAGE_TONE } from '../lib/format';
import { useStore } from '../lib/store';
import { DestinationPicker } from './DestinationPicker';
import { TimeInput } from './ObjectPanel';
import { DateNav } from './DateNav';
import { RandomizePanel } from './RandomizePanel';
import { Avatar, Button, IconButton, LicenseChips, Panel, Pill, Segmented, cx } from './kit';
import { vehicleDesc } from '../lib/derived';

type RosterFilter = 'all' | 'unassigned' | 'assigned' | 'off';

/** Drop where the pointer is; fall back to overlap for keyboard / edge cases. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

export function DispatchBoard() {
  const vehicles = useStore((s) => s.vehicles);
  const people = useStore((s) => s.people);
  const projects = useStore((s) => s.projects);
  const sites = useStore((s) => s.sites);
  const plan = useStore((s) => s.plan);
  const scenario = useStore((s) => s.scenario);
  const history = useStore((s) => s.history);
  const future = useStore((s) => s.future);
  const personSelection = useStore((s) => s.personSelection);
  const commit = useStore((s) => s.commit);
  const [siteFilter, setSiteFilter] = useState<string>('all');
  const [dragging, setDragging] = useState<Person | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const ctx = useStore.getState().ctx();
  const shown = scenario ? scenario.assignments : plan.assignments;
  const issues = useMemo(() => validatePlan(plan.assignments, ctx), [plan, ctx]);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const visibleVehicles = vehicles.filter((v) => siteFilter === 'all' || v.homeSiteId === siteFilter);

  const onDragStart = (e: DragStartEvent) => {
    const pid = (e.active.data.current as { personId?: string } | undefined)?.personId;
    setDragging(people.find((p) => p.id === pid) ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (scenario) return;
    const pid = (e.active.data.current as { personId?: string } | undefined)?.personId;
    const over = e.over ? String(e.over.id) : null;
    if (!over || !pid) return;
    const p = people.find((x) => x.id === pid);
    if (!p) return;
    if (over === 'roster') {
      commit((list) => unassignPerson(list, pid), `${fullName(p)} unassigned`);
      return;
    }
    const vid = over.split(':')[1];
    const v = vehicles.find((x) => x.id === vid);
    if (!v) return;
    if (v.status !== 'active') {
      useStore.getState().toast({ kind: 'warning', title: `${v.callsign} is in ${v.status}` });
      return;
    }
    if (p.status !== 'available') {
      useStore.getState().toast({ kind: 'warning', title: `${fullName(p)} is ${p.status}` });
      return;
    }
    commit((list) => assignPerson(list, ctx, pid, vid), `${fullName(p)} → ${v.callsign}`);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="pointer-events-auto absolute inset-x-3 bottom-3 top-[76px] z-20 flex gap-3">
        <Roster siteFilter={siteFilter} onGroup={() => setGroupOpen(true)} />
        <Panel className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-line px-4 pb-2 pt-2.5">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold leading-tight">{scenario ? 'Scenario preview' : 'Dispatch board'}</div>
                <div className="truncate text-[11.5px] text-muted">
                  {scenario ? 'Proposed by Randomize – nothing is saved until you apply it' : 'Drag people onto vehicles · click a destination to change it · 🔒 pins survive Randomize'}
                </div>
              </div>
              {!scenario && (
                <>
                  <IconButton label="Undo (⌘Z)" disabled={!history.length} onClick={() => useStore.getState().undo()}>
                    <Undo2 size={15} />
                  </IconButton>
                  <IconButton label="Redo (⌘⇧Z)" disabled={!future.length} onClick={() => useStore.getState().redo()}>
                    <Redo2 size={15} />
                  </IconButton>
                  <Button
                    size="sm"
                    icon={<Eraser size={13} />}
                    onClick={() => commit((list) => clearUnlocked(list), 'Cleared all unpinned assignments')}
                    title="Remove everyone and every destination that is not pinned (vehicles on the road are kept)"
                  >
                    Clear unpinned
                  </Button>
                  <Button size="sm" variant="violet" icon={<Shuffle size={13} />} onClick={() => useStore.getState().previewRandomize({ siteId: siteFilter === 'all' ? undefined : siteFilter })}>
                    Randomize
                  </Button>
                </>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {!scenario && <DateNav />}
              {!scenario && (
                <div className="flex gap-1">
                  {errors > 0 && <Pill tone="danger">{errors} error{errors > 1 ? 's' : ''}</Pill>}
                  {warnings > 0 && (
                    <span title={issues.filter((i) => i.severity === 'warning').map((i) => i.message).join('\n')}>
                      <Pill tone="warning">
                        <AlertTriangle size={11} /> {warnings} warning{warnings > 1 ? 's' : ''}
                      </Pill>
                    </span>
                  )}
                  {errors + warnings === 0 && (
                    <Pill tone="success">
                      <Check size={11} /> Plan OK
                    </Pill>
                  )}
                </div>
              )}
              <div className="flex-1" />
              <Segmented
                size="sm"
                value={siteFilter}
                onChange={setSiteFilter}
                options={[{ value: 'all', label: 'All depots' }, ...sites.map((s) => ({ value: s.id, label: s.code }))]}
              />
            </div>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
            {sites
              .filter((s) => siteFilter === 'all' || s.id === siteFilter)
              .map((site) => {
                const vs = visibleVehicles.filter((v) => v.homeSiteId === site.id);
                if (!vs.length) return null;
                return (
                  <div key={site.id} className="mb-4">
                    <div className="mb-2 flex items-center gap-2 px-1">
                      <span className="size-2 rounded-full" style={{ background: site.color }} />
                      <span className="text-[12px] font-semibold">{site.name}</span>
                      <span className="mono text-[11px] text-muted">{site.code}</span>
                      <span className="text-[11px] text-subtle">· {vs.length} vehicles</span>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5">
                      {vs.map((v) => (
                        <VehicleCard
                          key={v.id}
                          vehicle={v}
                          assignment={shown.find((a) => a.vehicleId === v.id)}
                          before={scenario ? plan.assignments.find((a) => a.vehicleId === v.id) : undefined}
                          readOnly={!!scenario}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            {projects.length === 0 && <div className="text-muted">No projects yet.</div>}
          </div>
        </Panel>
        {scenario && <RandomizePanel />}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="flex items-center gap-2 rounded-full bg-panel-solid py-1 pl-1 pr-3 text-[12px] font-semibold shadow-float ring-2 ring-primary">
            <Avatar person={dragging} size={24} /> {fullName(dragging)}
          </div>
        )}
      </DragOverlay>
      {groupOpen && personSelection.length > 0 && <GroupDialog personIds={personSelection} onClose={() => setGroupOpen(false)} />}
    </DndContext>
  );
}

// --- Roster -------------------------------------------------------------------------------------

function Roster({ siteFilter, onGroup }: { siteFilter: string; onGroup: () => void }) {
  const people = useStore((s) => s.people);
  const sites = useStore((s) => s.sites);
  const plan = useStore((s) => s.plan);
  const scenario = useStore((s) => s.scenario);
  const sel = useStore((s) => s.personSelection);
  const setSel = useStore((s) => s.setPersonSelection);
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [q, setQ] = useState('');
  const { setNodeRef, isOver } = useDroppable({ id: 'roster' });
  const where = useMemo(() => {
    const m = new Map<ID, Assignment>();
    for (const a of (scenario?.assignments ?? plan.assignments)) for (const p of a.crew) m.set(p, a);
    return m;
  }, [plan, scenario]);
  const needle = q.trim().toLowerCase();
  const list = people
    .filter((p) => siteFilter === 'all' || p.homeSiteId === siteFilter)
    .filter((p) => !needle || `${p.firstName} ${p.lastName} ${p.role} ${p.licenses.join(' ')}`.toLowerCase().includes(needle))
    .filter((p) =>
      filter === 'all' ? true : filter === 'off' ? p.status !== 'available' : filter === 'assigned' ? where.has(p.id) : p.status === 'available' && !where.has(p.id),
    );
  const counts = {
    unassigned: people.filter((p) => p.status === 'available' && !where.has(p.id)).length,
    off: people.filter((p) => p.status !== 'available').length,
  };

  return (
    <Panel className={cx('flex w-[300px] shrink-0 flex-col overflow-hidden transition-shadow', isOver && 'ring-2 ring-primary')}>
      <div className="border-b border-line px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-2">
          <Users size={15} className="text-primary" />
          <span className="text-[14px] font-bold">Crew roster</span>
          <span className="text-[11.5px] text-muted">{people.length} people</span>
        </div>
        <div className="mt-2 flex h-8 items-center gap-1.5 rounded-lg bg-panel-3 px-2">
          <Search size={13} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, role, licence…" className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-subtle" />
        </div>
        <div className="mt-2">
          <Segmented<RosterFilter>
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'unassigned', label: `Free ${counts.unassigned}` },
              { value: 'assigned', label: 'On vehicle' },
              { value: 'off', label: `Off ${counts.off}` },
            ]}
          />
        </div>
      </div>
      <div ref={setNodeRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {sites
          .filter((s) => siteFilter === 'all' || s.id === siteFilter)
          .map((site) => {
            const group = list.filter((p) => p.homeSiteId === site.id);
            if (!group.length) return null;
            return (
              <div key={site.id} className="mb-2">
                <div className="flex items-center gap-1.5 px-1.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">
                  <span className="size-1.5 rounded-full" style={{ background: site.color }} />
                  {site.code} · {site.name}
                </div>
                {group.map((p) => (
                  <RosterRow key={p.id} person={p} assignment={where.get(p.id)} selected={sel.includes(p.id)} disabled={!!scenario} />
                ))}
              </div>
            );
          })}
        {list.length === 0 && <div className="px-2 py-6 text-center text-[12px] text-muted">Nobody matches.</div>}
      </div>
      {sel.length > 0 && !scenario ? (
        <div className="border-t border-line bg-panel-2 p-2.5">
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <span className="font-semibold">{sel.length} selected</span>
            <button className="text-muted hover:text-ink" onClick={() => setSel([])}>
              Clear
            </button>
          </div>
          <Button variant="primary" className="w-full" icon={<Send size={13} />} onClick={onGroup} disabled={sel.length > 4}>
            {sel.length > 4 ? 'Max. 4 people per vehicle' : 'Send to a task & pin'}
          </Button>
          <p className="mt-1.5 text-[11px] leading-snug text-muted">They go together on one vehicle and stay there when you randomize everyone else.</p>
        </div>
      ) : (
        <div className="border-t border-line px-3 py-2 text-[11px] leading-snug text-muted">
          Tick people to send them to a task together. Drag a person onto a vehicle, or back here to unassign.
        </div>
      )}
    </Panel>
  );
}

function RosterRow({ person, assignment, selected, disabled }: { person: Person; assignment?: Assignment; selected: boolean; disabled: boolean }) {
  const vehicles = useStore((s) => s.vehicles);
  const toggle = useStore((s) => s.togglePersonSelected);
  const select = useStore((s) => s.select);
  // Draggable ids must be unique per element (a person is also draggable from their seat).
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `roster:${person.id}`,
    data: { personId: person.id },
    disabled: disabled || person.status !== 'available',
  });
  const v = assignment ? vehicles.find((x) => x.id === assignment.vehicleId) : undefined;
  const locked = assignment?.lockedCrew.includes(person.id);
  const off = person.status !== 'available';
  return (
    <div
      ref={setNodeRef}
      data-testid={`roster-${person.id}`}
      className={cx('group flex items-center gap-2 rounded-lg px-1.5 py-1', selected ? 'bg-primary-weak' : 'hover:bg-panel-3', isDragging && 'opacity-40', off && 'opacity-60')}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={off || disabled}
        onChange={() => toggle(person.id)}
        className="size-3.5 shrink-0 accent-[var(--primary)]"
        aria-label={`Select ${fullName(person)}`}
      />
      <span {...listeners} {...attributes} data-testid={`drag-${person.id}`} className={cx('flex min-w-0 flex-1 items-center gap-2', !off && !disabled && 'cursor-grab active:cursor-grabbing')}>
        <Avatar person={person} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold">{fullName(person)}</span>
          <span className="flex items-center gap-1 text-[10.5px] text-muted">
            {person.role} <LicenseChips licenses={person.licenses} />
          </span>
        </span>
      </span>
      {off ? (
        <Pill tone="warning">{person.status}</Pill>
      ) : v ? (
        <button onClick={() => select({ type: 'vehicle', id: v.id })} className="flex items-center gap-1 rounded-md bg-panel-3 px-1.5 py-0.5 text-[11px] font-semibold hover:bg-panel-2" title={`On ${v.callsign}`}>
          {locked && <Lock size={10} className="text-violet" />}
          <span className="mono">{v.callsign}</span>
        </button>
      ) : (
        <GripVertical size={14} className="text-subtle opacity-0 group-hover:opacity-100" />
      )}
    </div>
  );
}

// --- Vehicle card -------------------------------------------------------------------------------

function VehicleCard({ vehicle, assignment, before, readOnly }: { vehicle: Vehicle; assignment?: Assignment; before?: Assignment; readOnly: boolean }) {
  const people = useStore((s) => s.people);
  const projects = useStore((s) => s.projects);
  const commit = useStore((s) => s.commit);
  const select = useStore((s) => s.select);
  const { setNodeRef, isOver } = useDroppable({ id: `vehicle:${vehicle.id}`, disabled: readOnly || vehicle.status !== 'active' });
  const [picker, setPicker] = useState(false);
  const destBtn = useRef<HTMLButtonElement>(null);
  const a = assignment;
  const cap = crewCapacity(vehicle);
  const crew = (a?.crew ?? []).map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
  const project = a?.destination?.kind === 'project' ? projects.find((p) => p.id === (a.destination as { projectId: string }).projectId) : undefined;
  const inactive = vehicle.status !== 'active';
  const onRoad = !!a && a.stage !== 'planned';
  const fullyLocked = !!a && a.crew.length > 0 && a.crew.every((p) => a.lockedCrew.includes(p)) && (a.destinationLocked || !a.destination);
  const hasDriver = crew.some((p) => canDrive(p, vehicle));
  const destChanged = !!before && JSON.stringify(before.destination) !== JSON.stringify(a?.destination ?? null);
  const accent = project?.color ?? (a?.destination ? '#7c5cff' : 'var(--border-strong)');

  return (
    <div
      ref={setNodeRef}
      data-testid={`vehicle-card-${vehicle.callsign}`}
      className={cx(
        'relative flex flex-col overflow-hidden rounded-xl border bg-panel-solid shadow-sm transition-all',
        isOver ? 'border-primary ring-2 ring-primary/40' : 'border-line',
        inactive && 'opacity-60',
      )}
    >
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <div className="flex items-center gap-2 py-2 pl-3.5 pr-2">
        <span className="grid size-7 place-items-center rounded-lg bg-panel-3 text-ink-2">{vehicle.kind === 'truck' ? <Truck size={14} /> : <Car size={14} />}</span>
        <button className="min-w-0 flex-1 text-left" onClick={() => select({ type: 'vehicle', id: vehicle.id })}>
          <span className="flex items-center gap-1.5">
            <span className="mono text-[13px] font-bold">{vehicle.callsign}</span>
            <span className="mono text-[10.5px] text-muted">{vehicle.plate}</span>
          </span>
          <span className="block truncate text-[10.5px] text-muted">
            {vehicleDesc(vehicle)} · {vehicle.requiredLicense}
          </span>
        </button>
        {inactive ? (
          <Pill tone="warning">{vehicle.status}</Pill>
        ) : (
          <Pill tone={STAGE_TONE[a?.stage ?? 'planned']}>{STAGE_LABEL[a?.stage ?? 'planned']}</Pill>
        )}
        {!readOnly && !inactive && (
          <IconButton
            size="sm"
            label={fullyLocked ? 'Unpin vehicle' : 'Pin crew & destination'}
            active={fullyLocked}
            disabled={!a?.crew.length}
            onClick={() => commit((list) => setVehicleLock(list, vehicle.id, !fullyLocked))}
          >
            {fullyLocked ? <Lock size={13} /> : <Unlock size={13} />}
          </IconButton>
        )}
      </div>

      <div className="space-y-1 px-2.5 pb-2 pl-3.5">
        {Array.from({ length: cap }).map((_, i) => {
          const p = crew[i];
          if (!p) {
            return (
              <div
                key={`empty-${i}`}
                className={cx(
                  'flex h-9 items-center gap-2 rounded-lg border border-dashed px-2 text-[11.5px]',
                  isOver ? 'border-primary text-primary' : 'border-line-strong text-subtle',
                )}
              >
                <UserPlus size={13} /> {inactive ? 'Unavailable' : 'Empty seat'}
              </div>
            );
          }
          const locked = a?.lockedCrew.includes(p.id);
          const isNew = !!before && !before.crew.includes(p.id);
          return <SeatRow key={p.id} person={p} vehicle={vehicle} locked={!!locked} isNew={isNew} readOnly={readOnly || onRoad} driver={i === 0 && canDrive(p, vehicle)} />;
        })}
      </div>

      <div className="mt-auto space-y-1.5 border-t border-line bg-panel-2 px-2.5 py-2 pl-3.5">
        <button
          ref={destBtn}
          data-testid={`dest-${vehicle.callsign}`}
          disabled={readOnly || inactive}
          onClick={() => setPicker(true)}
          className={cx(
            'flex w-full items-center gap-2 rounded-lg border bg-panel-solid px-2 py-1.5 text-left transition-colors enabled:hover:border-primary',
            destChanged ? 'border-violet ring-1 ring-violet/40' : 'border-line',
          )}
        >
          {project ? (
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: project.color }} />
          ) : (
            <MapPin size={13} className={a?.destination ? 'text-violet' : 'text-subtle'} />
          )}
          <span className="min-w-0 flex-1">
            <span className={cx('block truncate text-[12px] font-semibold', !a?.destination && 'text-muted')}>
              {a?.destination ? destinationLabel(a.destination, projects) : 'Set destination…'}
            </span>
            {a?.destination && (
              <span className="block truncate text-[10.5px] text-muted">{project ? project.address : a.destination.kind === 'custom' ? a.destination.address ?? (a.destination.location ? 'Pinned on map' : 'Label only') : ''}</span>
            )}
          </span>
          {a?.destinationLocked && <Lock size={12} className="shrink-0 text-violet" />}
          {destChanged && <span className="text-[10px] font-bold text-violet">NEW</span>}
        </button>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1">
            {readOnly ? (
              <span className="mono text-[11.5px] text-muted">
                {a?.departAt ?? '–'} → {a?.returnAt ?? '–'}
              </span>
            ) : (
              <>
                <TimeInput value={a?.departAt} onChange={(t) => commit((list) => setTimes(list, vehicle.id, { departAt: t }))} />
                <span className="text-subtle">→</span>
                <TimeInput value={a?.returnAt} onChange={(t) => commit((list) => setTimes(list, vehicle.id, { returnAt: t }))} />
              </>
            )}
          </span>
          {!readOnly && a?.crew.length && a.destination && a.stage === 'planned' ? (
            <IconButton size="sm" label="Dispatch now" onClick={() => useStore.getState().dispatchNow(vehicle.id)}>
              <Play size={13} />
            </IconButton>
          ) : null}
        </div>
        {crew.length > 0 && !hasDriver && (
          <div className="flex items-center gap-1 text-[11px] font-medium text-warning">
            <AlertTriangle size={11} /> Nobody holds licence {vehicle.requiredLicense}
          </div>
        )}
        {crew.length > 0 && !a?.destination && (
          <div className="flex items-center gap-1 text-[11px] font-medium text-warning">
            <AlertTriangle size={11} /> No destination
          </div>
        )}
      </div>
      {picker && destBtn.current && (
        <DestinationPicker
          anchor={destBtn.current}
          vehicleId={vehicle.id}
          value={a?.destination ?? null}
          locked={!!a?.destinationLocked}
          onSelect={(dest: Destination | null, lock) =>
            commit((list) => setDestination(list, vehicle.id, dest, { lock }), `${vehicle.callsign} → ${dest ? destinationLabel(dest, projects) : 'no destination'}`)
          }
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}

function SeatRow({ person, vehicle, locked, isNew, readOnly, driver }: { person: Person; vehicle: Vehicle; locked: boolean; isNew: boolean; readOnly: boolean; driver: boolean }) {
  const commit = useStore((s) => s.commit);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `seat:${vehicle.id}:${person.id}`, data: { personId: person.id }, disabled: readOnly });
  return (
    <div
      ref={setNodeRef}
      className={cx(
        'group flex h-9 items-center gap-2 rounded-lg px-1.5',
        isNew ? 'bg-violet-weak ring-1 ring-violet/40' : locked ? 'bg-panel-3' : 'hover:bg-panel-3',
        isDragging && 'opacity-40',
      )}
    >
      <span {...listeners} {...attributes} className={cx('flex min-w-0 flex-1 items-center gap-2', !readOnly && 'cursor-grab active:cursor-grabbing')}>
        <Avatar person={person} size={24} ring={locked ? 'var(--violet)' : undefined} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold leading-tight">
            {fullName(person)}
            {driver && <span className="ml-1 text-[10px] font-semibold text-primary">driver</span>}
            {isNew && <span className="ml-1 text-[10px] font-bold text-violet">NEW</span>}
          </span>
          <span className="block truncate text-[10.5px] leading-tight text-muted">
            {person.role}
            {person.licenses.length ? ` · ${person.licenses.join('/')}` : ''}
          </span>
        </span>
      </span>
      {!readOnly && (
        <span className={cx('flex items-center', locked ? '' : 'opacity-0 group-hover:opacity-100')}>
          <IconButton size="sm" label={locked ? 'Unpin' : 'Pin to this vehicle'} active={locked} onClick={() => commit((list) => toggleCrewLock(list, vehicle.id, person.id))}>
            {locked ? <Lock size={12} /> : <Unlock size={12} />}
          </IconButton>
          <IconButton size="sm" label="Remove" onClick={() => commit((list) => unassignPerson(list, person.id), `${fullName(person)} removed from ${vehicle.callsign}`)}>
            <X size={12} />
          </IconButton>
        </span>
      )}
      {readOnly && locked && <Lock size={12} className="mr-1 text-violet" />}
    </div>
  );
}

// --- "Send selected people to a task" ----------------------------------------------------------

function GroupDialog({ personIds, onClose }: { personIds: ID[]; onClose: () => void }) {
  const people = useStore((s) => s.people);
  const vehicles = useStore((s) => s.vehicles);
  const projects = useStore((s) => s.projects);
  const plan = useStore((s) => s.plan);
  const commit = useStore((s) => s.commit);
  const [vehicleId, setVehicleId] = useState<string>('auto');
  const [dest, setDest] = useState<Destination | null>(null);
  const [picker, setPicker] = useState(false);
  const destBtn = useRef<HTMLButtonElement>(null);
  const group = personIds.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
  const ctx = useStore.getState().ctx();
  const vehicleOptions = vehicles.filter((v) => v.status === 'active' && crewCapacity(v) >= group.length);

  const apply = () => {
    if (!dest) return;
    let chosen: string | undefined;
    const ok = commit((list) => {
      const r = pinGroupToTask(list, ctx, { personIds, destination: dest, vehicleId: vehicleId === 'auto' ? undefined : vehicleId });
      if (r.ok) chosen = r.vehicleId;
      return r;
    }, `${group.map((p) => p.firstName).join(', ')} pinned to ${destinationLabel(dest, projects)}`);
    if (ok) {
      const v = vehicles.find((x) => x.id === chosen);
      useStore.getState().toast({ kind: 'success', title: `${group.length} people pinned to ${v?.callsign ?? 'a vehicle'}`, detail: `→ ${destinationLabel(dest, projects)}. Randomize will keep them there.` });
      useStore.getState().setPersonSelection([]);
      onClose();
    }
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-[60] grid place-items-center bg-black/20 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Panel className="fade-in w-[460px] p-4 shadow-float">
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-bold">Send to a task</div>
          <IconButton size="sm" label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </div>
        <p className="mt-0.5 text-[12px] text-muted">These people ride together, and both crew and destination get pinned so Randomize leaves them alone.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {group.map((p) => (
            <span key={p.id} className="flex items-center gap-1.5 rounded-full bg-panel-3 py-0.5 pl-0.5 pr-2 text-[12px] font-semibold">
              <Avatar person={p} size={20} /> {fullName(p)}
              <LicenseChips licenses={p.licenses} />
            </span>
          ))}
        </div>
        <Field label="Destination">
          <button ref={destBtn} data-testid="group-dest" onClick={() => setPicker(true)} className="flex h-9 w-full items-center gap-2 rounded-lg border border-line-strong bg-panel-solid px-2.5 text-left hover:border-primary">
            <MapPin size={14} className="text-primary" />
            <span className={cx('flex-1 truncate font-semibold', !dest && 'text-muted')}>{dest ? destinationLabel(dest, projects) : 'Choose a project or custom destination…'}</span>
          </button>
        </Field>
        <Field label="Vehicle">
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="h-9 w-full rounded-lg border border-line-strong bg-panel-solid px-2 text-[12.5px]">
            <option value="auto">Pick the best free vehicle automatically</option>
            {vehicleOptions.map((v) => {
              const a = plan.assignments.find((x) => x.vehicleId === v.id);
              const driverOk = group.some((p) => canDrive(p, v));
              return (
                <option key={v.id} value={v.id}>
                  {v.callsign} · {v.model} · {a?.crew.length ?? 0}/{crewCapacity(v)} seats used{driverOk ? '' : ` · nobody has ${v.requiredLicense}`}
                </option>
              );
            })}
          </select>
        </Field>
        {!group.some((p) => p.licenses.length) && (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-warning-weak px-2.5 py-1.5 text-[11.5px] text-warning">
            <AlertTriangle size={12} /> Nobody in this group has a driving licence.
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Lock size={13} />} disabled={!dest} onClick={apply}>
            Assign & pin
          </Button>
        </div>
      </Panel>
      {picker && destBtn.current && (
        <DestinationPicker
          anchor={destBtn.current}
          vehicleId={vehicleId === 'auto' ? (vehicleOptions[0]?.id ?? '') : vehicleId}
          value={dest}
          locked
          allowMapPick={false}
          onSelect={(d) => setDest(d)}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-3 block">
      <span className="mb-1 block text-[11.5px] font-semibold text-ink-2">{label}</span>
      {children}
    </label>
  );
}
