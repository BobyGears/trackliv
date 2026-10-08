import { describe, expect, it } from 'vitest';
import { DE, DE_PATTERNS } from './i18n.de';
import { plural, setLang, t, tx } from './i18n';

describe('i18n', () => {
  it('translates UI texts and fills placeholders', () => {
    setLang('de');
    expect(t('Dispatch board')).toBe('Dispositionstafel');
    expect(t('{n}/{total} vehicles in yard', { n: 3, total: 13 })).toBe('3/13 Fahrzeuge auf dem Hof');
    expect(t(plural(1, '{n} vehicle late to leave', '{n} vehicles late to leave'), { n: 1 })).toBe('1 Fahrzeug fährt verspätet ab');
    expect(t('Something new')).toBe('Something new'); // missing → English
    setLang('en');
    expect(t('Dispatch board')).toBe('Dispatch board');
    expect(t('{n}/{total} vehicles in yard', { n: 3, total: 13 })).toBe('3/13 vehicles in yard');
  });

  it('translates server and planner sentences', () => {
    setLang('de');
    expect(tx('TE 800 departed HQ-SCH → Hallenbau Kelsterbach')).toBe('TE 800 ist von HQ-SCH losgefahren → Hallenbau Kelsterbach');
    expect(tx('TE 840 · On site')).toBe('TE 840 · Vor Ort');
    expect(tx('Asen Yanakiev is vacation')).toBe('Asen Yanakiev ist im Urlaub');
    expect(tx('TE 322: nobody holds licence C1')).toBe('TE 322: niemand hat Führerschein C1');
    expect(tx('Ermal → TE 860')).toBe('Ermal → TE 860'); // names stay
    expect(tx('Wrong name or password')).toBe('Name oder Passwort falsch');
    setLang('en');
    expect(tx('TE 840 · On site')).toBe('TE 840 · On site');
  });

  it('every placeholder in a German text also exists in the English key', () => {
    for (const [en, de] of Object.entries(DE)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      expect(ph(de), en).toBe(ph(en));
    }
    expect(DE_PATTERNS.length).toBeGreaterThan(20);
  });
});
