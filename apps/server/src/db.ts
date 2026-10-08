import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DayPlan, OpsEvent, Person, Project, Vehicle } from '@trackliv/core';
import { config } from './config.ts';

export interface DbShape {
  version: 1;
  vehicles: Vehicle[];
  people: Person[];
  projects: Project[];
  plans: Record<string, DayPlan>;
  events: OpsEvent[];
}

const FILE = join(config.dataDir, 'db.json');
const MAX_EVENTS = 1500;

/** Tiny JSON-file store. Good enough for one dispatch office; swap for Postgres later. */
class Db {
  data: DbShape;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    mkdirSync(config.dataDir, { recursive: true });
    this.data = existsSync(FILE)
      ? (JSON.parse(readFileSync(FILE, 'utf8')) as DbShape)
      : { version: 1, vehicles: [], people: [], projects: [], plans: {}, events: [] };
  }

  get isEmpty() {
    return !existsSync(FILE);
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 400);
  }

  flush() {
    if (this.data.events.length > MAX_EVENTS) this.data.events = this.data.events.slice(-MAX_EVENTS);
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, FILE);
  }
}

export const db = new Db();
