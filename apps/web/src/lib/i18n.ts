import { DE, DE_PATTERNS } from './i18n.de';

/**
 * Tiny i18n: the English text is the key, German comes from i18n.de.ts (missing entries fall back
 * to English). `{name}` placeholders are filled from params. Server and planner messages, which
 * arrive as finished English sentences, are translated by pattern with `tx()`.
 */
export type Lang = 'de' | 'en';

const KEY = 'trackliv:lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch {
    /* private mode */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

let current: Lang = initial();
const listeners = new Set<(l: Lang) => void>();

export const getLang = () => current;
/** Locale for dates and numbers. */
export const locale = () => (current === 'de' ? 'de-DE' : 'en-GB');

export function setLang(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* private mode */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const l of listeners) l(lang);
}

export function onLangChange(fn: (l: Lang) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const fill = (s: string, params?: Record<string, string | number | undefined>) =>
  params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] === undefined ? m : String(params[k]))) : s;

/** Translate a UI text (English source text as key). */
export function t(en: string, params?: Record<string, string | number | undefined>): string {
  return fill(current === 'de' ? (DE[en] ?? en) : en, params);
}

/** Pick singular/plural: t(plural(n, '{n} vehicle', '{n} vehicles'), { n }). */
export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Translate a finished sentence from the server or planner (event log, plan checks, errors). */
export function tx(s: string | undefined | null): string {
  if (!s || current !== 'de') return s ?? '';
  if (DE[s]) return DE[s];
  for (const [re, de] of DE_PATTERNS) {
    if (re.test(s)) return typeof de === 'string' ? s.replace(re, de) : s.replace(re, (...m) => de(...(m as string[])));
  }
  return s;
}

if (typeof document !== 'undefined') document.documentElement.lang = current;
