import { randomUUID } from 'node:crypto';
import {
  STAGE_LABEL,
  destinationLabel,
  destinationLocation,
  emptyAssignment,
  nextStage,
  timeOnDate,
  todayISO,
  type Assignment,
  type DayPlan,
  type FleetStatus,
  type OpsEvent,
  type Stage,
  type Telemetry,
} from '@trackliv/core';
import { OpsClock } from './clock.ts';
import { db } from './db.ts';
import { recordHistory } from './history.ts';
import { sites } from './geodata.ts';
import { broadcast } from './hub.ts';

const LATE_AFTER_MIN = 15;

/** Central operational state: plans, live telemetry, stage tracking and the event log. */
class Ops {
  clock = new OpsClock();
  telemetry = new Map<string, Telemetry>();
  fleet: FleetStatus = { source: 'simulator', connected: true, pollSeconds: 1 };
  /** While true (simulator fast-forward on boot) nothing is broadcast. */
  silent = false;
  private lateFlagged = new Set<string>();

  today(): string {
    return todayISO(new Date(this.clock.now()));
  }

  nowISO(): string {
    return new Date(this.clock.now()).toISOString();
  }

  plan(date = this.today()): DayPlan {
    let plan = db.data.plans[date];
    if (!plan) {
      plan = { date, revision: 0, assignments: [], updatedAt: this.nowISO() };
      db.data.plans[date] = plan;
    }
    // Every vehicle has a row, in vehicle order.
    const byId = new Map(plan.assignments.map((a) => [a.vehicleId, a]));
    plan.assignments = db.data.vehicles.map((v) => byId.get(v.id) ?? emptyAssignment(v.id));
    return plan;
  }

  savePlan(
    date: string,
    assignments: Assignment[],
    opts: { baseRevision?: number; actor?: string; reason?: string; force?: boolean } = {},
  ): { ok: true; plan: DayPlan } | { ok: false; plan: DayPlan } {
    const current = this.plan(date);
    if (!opts.force && opts.baseRevision !== undefined && opts.baseRevision !== current.revision) {
      return { ok: false, plan: current };
    }
    const known = new Set(db.data.vehicles.map((v) => v.id));
    const next: DayPlan = {
      date,
      revision: current.revision + 1,
      assignments: assignments.filter((a) => known.has(a.vehicleId)),
      updatedAt: this.nowISO(),
      updatedBy: opts.actor ?? current.updatedBy,
    };
    db.data.plans[date] = next;
    db.save();
    if (!this.silent) broadcast('plan', next);
    return { ok: true, plan: this.plan(date) };
  }

  log(e: Omit<OpsEvent, 'id' | 'ts'> & { ts?: string }): OpsEvent {
    const event: OpsEvent = { id: randomUUID(), ts: e.ts ?? this.nowISO(), ...e };
    db.data.events.push(event);
    db.save();
    if (!this.silent) broadcast('event', event);
    return event;
  }

  recentEvents(limit = 300): OpsEvent[] {
    return db.data.events.slice(-limit);
  }

  setFleetStatus(patch: Partial<FleetStatus>) {
    this.fleet = { ...this.fleet, ...patch };
    if (!this.silent) broadcast('fleet', this.fleet);
  }

  /** Store positions, advance geofence stages, flag anomalies, and push to clients. */
  ingest(list: Telemetry[]) {
    for (const t of list) this.telemetry.set(t.vehicleId, t);
    recordHistory(list);
    this.trackStages(list);
    if (!this.silent) broadcast('telemetry', list);
  }

  private trackStages(list: Telemetry[]) {
    if (!list.length) return;
    const date = this.today();
    const plan = this.plan(date);
    let changed = false;
    const assignments = plan.assignments.map((a) => {
      const t = list.find((x) => x.vehicleId === a.vehicleId);
      if (!t) return a;
      const vehicle = db.data.vehicles.find((v) => v.id === a.vehicleId);
      if (!vehicle) return a;
      const hasRun = a.crew.length > 0 || !!a.destination;
      const dest = destinationLocation(a.destination, db.data.projects);
      const ns: Stage = nextStage(a, t, sites, dest);
      if (ns === a.stage) return a;

      if (!hasRun) {
        if (ns === 'departed' && a.stage === 'planned') {
          this.log({
            ts: t.ts,
            kind: 'alert',
            severity: 'warning',
            title: `${vehicle.callsign} left the depot without an assignment`,
            refs: { vehicleId: vehicle.id },
          });
        }
        changed = true;
        return { ...a, stage: ns, stageTimes: { ...a.stageTimes, [ns]: t.ts } };
      }

      const stageTimes: Assignment['stageTimes'] = { ...a.stageTimes, [ns]: t.ts };
      if (ns === 'planned') {
        delete stageTimes.planned;
        delete stageTimes.departed;
        delete stageTimes.on_site;
      }
      changed = true;
      this.logStage(vehicle.callsign, vehicle.id, a, ns, t);
      return { ...a, stage: ns, stageTimes };
    });
    if (changed) this.savePlan(date, assignments, { force: true, actor: 'tracker' });
  }

  private logStage(callsign: string, vehicleId: string, a: Assignment, ns: Stage, t: Telemetry) {
    const destName = destinationLabel(a.destination, db.data.projects);
    const projectId = a.destination?.kind === 'project' ? a.destination.projectId : undefined;
    const home = sites.find((s) => s.id === db.data.vehicles.find((v) => v.id === vehicleId)?.homeSiteId);
    let title = `${callsign} · ${STAGE_LABEL[ns]}`;
    let severity: OpsEvent['severity'] = 'info';
    let detail: string | undefined;
    if (ns === 'departed') {
      title = `${callsign} departed ${home?.code ?? 'depot'} → ${destName}`;
      const planned = timeOnDate(this.today(), a.departAt);
      if (planned) {
        const late = Math.round((Date.parse(t.ts) - planned.getTime()) / 60000);
        if (late > LATE_AFTER_MIN) {
          severity = 'warning';
          detail = `${late} min after the planned ${a.departAt}`;
        } else {
          detail = `planned ${a.departAt}`;
        }
      }
    } else if (ns === 'on_site') {
      title = `${callsign} arrived at ${destName}`;
      severity = 'success';
    } else if (ns === 'returning') {
      title = `${callsign} left ${destName}, heading back`;
    } else if (ns === 'completed') {
      title = `${callsign} back at depot`;
      severity = 'success';
    } else if (ns === 'planned') {
      title = `${callsign} returned before reaching ${destName}`;
      severity = 'warning';
    }
    this.log({
      ts: t.ts,
      kind: 'stage',
      severity,
      title,
      detail,
      refs: { vehicleId, projectId, personIds: a.crew },
    });
  }

  /** Raise a one-time alert for crewed vehicles that should have left by now. */
  checkLateDepartures() {
    const date = this.today();
    const now = this.clock.now();
    for (const a of this.plan(date).assignments) {
      if (a.stage !== 'planned' || !a.crew.length || !a.destination) continue;
      const planned = timeOnDate(date, a.departAt);
      if (!planned) continue;
      const key = `${date}:${a.vehicleId}:${a.departAt}`;
      if (now - planned.getTime() > LATE_AFTER_MIN * 60000 && !this.lateFlagged.has(key)) {
        this.lateFlagged.add(key);
        const v = db.data.vehicles.find((x) => x.id === a.vehicleId);
        this.log({
          ts: new Date(planned.getTime() + LATE_AFTER_MIN * 60000).toISOString(),
          kind: 'alert',
          severity: 'warning',
          title: `${v?.callsign ?? a.vehicleId} has not departed yet`,
          detail: `Planned departure ${a.departAt}`,
          refs: { vehicleId: a.vehicleId, personIds: a.crew },
        });
      }
    }
  }
}

export const ops = new Ops();
