import { describe, expect, it } from 'vitest';
import { rankMenu, type MenuEntry } from './fleetgoDashboard.ts';

// DTE's real FleetGO menu (German), as the check listed it
const q = '?accountId=3500000255';
const MENU: MenuEntry[] = [
  ['Produktion', '/Trip_Index/View/Trip_Index'],
  ['Fahrten', `/Trip_Index/View/Trip_Index${q}`],
  ['Standorte', `/Location_Index/View/Location_Index${q}`],
  ['Zeit vor Ort', `/Trip_TimePerLocation/View/Trip_TimePerLocation${q}`],
  ['Sensordaten', `/SensorData_Index/View/SensorData_Index${q}`],
  ['Karte', `/Map_Index/View/Map_Index${q}`],
  ['Fahrzeuge', `/Administrations/View/Administration_Index${q}`],
  ['Benutzer', `/Users/View/DefaultUser_Index${q}`],
  ['Fahrzeugkategorien', `/VehicleCategories/View/VehicleCategory_Index${q}`],
  ['Dongles/Tracker', `/DonglesTrackers/View/DeviceReferenceDongle_Index${q}`],
  ['Cockpit', `/Reports_Cockpit/View/Reports_Cockpit${q}`],
  ['Fahrten pro Fahrzeug', `/Vehicle_RittenPerVoertuigReport/View/Vehicle_RittenPerVoertuigReport${q}`],
  ['Letzte Fahrzeugdaten', `/Vehicle_PeriodeKmReport/View/Vehicle_PeriodeKmReport${q}`],
  ['Zeit am Standort', `/Vehicle_TijdPerLocatieReport/View/Vehicle_TijdPerLocatieReport${q}`],
  ['Abmelden', '/Account/LogOff'],
  ['Berichte', ''],
  ['1', ''],
].map(([text, path]) => ({ text, path }));

describe('FleetGO menu', () => {
  it('opens the map first, never sign-out, users or reports', () => {
    const ranked = rankMenu(MENU, '/Trip_Index/View/Trip_Index');
    expect(ranked[0].text).toBe('Karte');
    const names = ranked.map((r) => r.text);
    for (const never of ['Abmelden', 'Benutzer', 'Fahrten', 'Produktion', 'Cockpit', 'Fahrten pro Fahrzeug', 'Letzte Fahrzeugdaten', 'Fahrzeugkategorien', 'Berichte', '1']) {
      expect(names).not.toContain(never);
    }
  });
});
