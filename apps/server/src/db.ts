import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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

  /** One copy per day in <data>/backups (kept for 30 days). */
  snapshot() {
    if (!existsSync(FILE)) return;
    const dir = join(config.dataDir, 'backups');
    mkdirSync(dir, { recursive: true });
    const name = `db-${new Date().toISOString().slice(0, 10)}.json`;
    if (!existsSync(join(dir, name))) copyFileSync(FILE, join(dir, name));
    const old = readdirSync(dir)
      .filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .slice(0, -30);
    for (const f of old) unlinkSync(join(dir, f));
  }
}

export const db = new Db();

db.snapshot();
setInterval(() => db.snapshot(), 6 * 3600 * 1000).unref();
