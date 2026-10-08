import type { Priority, Stage } from '@trackliv/core';
import { t, locale } from './i18n';

/** All operational times are shown in the depots' time zone, whatever the browser's zone is. */
export const OPS_TZ = 'Europe/Berlin';

const hm = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: OPS_TZ });
const hms = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: OPS_TZ });

export const fmtTime = (iso: string | number | undefined | null) => {
  if (iso === undefined || iso === null || iso === '') return '–';
  return hm.format(new Date(iso));
};

export const fmtTimeSec = (ms: number) => hms.format(new Date(ms));

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: OPS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Offset of OPS_TZ from UTC (ms) at a given instant. */
function tzOffset(ms: number) {
  const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/** UTC timestamp of 00:00 on `date` (YYYY-MM-DD) in the depots' time zone. */
export function opsDayStart(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffset(guess);
  return guess - tzOffset(first);
}

/** "HH:MM" on `date` in the depots' time zone → Date. */
export function opsTime(date: string, hhmm: string | undefined): Date | null {
  if (!hhmm || !date) return null;
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(opsDayStart(date) + (h * 60 + mi) * 60000);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short', day: '2-digit', month: 'short' });

export function fmtAgo(iso: string | undefined, now: number): string {
  if (!iso) return t('never');
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 10) return t('just now');
  if (s < 60) return t('{s}s ago', { s });
  const m = Math.round(s / 60);
  if (m < 60) return t('{m} min ago', { m });
  const h = Math.floor(m / 60);
  return t('{h} h {m} min ago', { h, m: m % 60 });
}

export function fmtDuration(min: number): string {
  if (!Number.isFinite(min)) return '–';
  if (min < 60) return `${Math.max(0, Math.round(min))} min`;
  return `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;
}

export const hhmmToMin = (s: string | undefined) => {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

export const minToHhmm = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'violet' | 'cyan';

export const STAGE_TONE: Record<Stage, Tone> = {
  planned: 'neutral',
  departed: 'primary',
  on_site: 'success',
  returning: 'violet',
  completed: 'cyan',
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  low: 'neutral',
  normal: 'primary',
  high: 'warning',
  critical: 'danger',
};

export const TONE_HEX: Record<Tone, string> = {
  neutral: '#64748b',
  primary: '#2f6bff',
  success: '#12a150',
  warning: '#d9820b',
  danger: '#e5484d',
  violet: '#7c5cff',
  cyan: '#0ea5b7',
};
