// Starting data: DTE's vehicles and drivers as listed in FleetGO (plates match FleetGO, so live data
// links up by licence plate). Make/model, seats and home depot are placeholders – edit them in Data.
// The projects below are examples on real Rhein-Main streets (no house numbers); names and clients are fictional.
import type { Person, Project, Vehicle } from '@trackliv/core';

const SCH = 'hq-schieferstein';
const HAF = 'hq-hafen';
const BIS = 'hq-bischofsheim';

// [plate, home depot, regular driver in FleetGO]
const fleet: [string, string, string?][] = [
  ['MTK TE 800', SCH, 'Asen Yanakiev'],
  ['MTK TE 300', SCH, 'Armando'],
  ['MTK TE 710', SCH, 'Bayar Emre'],
  ['MTK TE 700', SCH],
  ['MTK-NB 678', SCH],
  ['MTK TE 810', HAF, 'Mustafa Sevik'],
  ['MTK TE 830', HAF, 'Balon SUB'],
  ['MTK-TE 322', HAF, 'Ermal'],
  ['MTK-TE 850', HAF, 'Harun Bayar'],
  ['MTK-TE 320', BIS],
  ['MTK-TE 860', BIS],
  ['MTK-TE 840', BIS, 'Eric Schulze'],
  ['MTK-TE 903', BIS],
];

export const demoVehicles: Vehicle[] = fleet.map(([plate, homeSiteId], i) => ({
  id: `veh-${String(i + 1).padStart(2, '0')}`,
  // call sign = the plate without the district, e.g. "TE 800"
  callsign: plate.replace(/^MTK[\s-]*/, '').replace('-', ' '),
  plate,
  make: '',
  model: '',
  kind: 'van',
  seats: 4,
  requiredLicense: 'B',
  homeSiteId,
  status: 'active',
}));

export const demoPeople: Person[] = fleet
  .filter((f): f is [string, string, string] => !!f[2])
  .map(([, homeSiteId, name], i) => {
    const [firstName, ...rest] = name.split(' ');
    return {
      id: `p-${String(i + 1).padStart(2, '0')}`,
      firstName,
      lastName: rest.join(' '),
      role: 'Driver',
      licenses: ['B'],
      homeSiteId,
      status: 'available',
    };
  });

const project = (
  n: number,
  name: string,
  client: string,
  address: string,
  lng: number,
  lat: number,
  priority: Project['priority'],
  crewTarget: number,
  color: string,
  status: Project['status'] = 'active',
): Project => ({
  id: `prj-26${String(n).padStart(2, '0')}`,
  code: `PRJ-26${String(n).padStart(2, '0')}`,
  name,
  client,
  address,
  location: { lng, lat },
  status,
  priority,
  crewTarget,
  color,
});

export const demoProjects: Project[] = [
  project(1, 'Bürohaus Ostend', 'Ostend Office Invest GmbH', 'Hanauer Landstraße, 60314 Frankfurt am Main', 8.70487, 50.1118, 'high', 6, '#2f6bff'),
  project(2, 'Quartier Gallus', 'Rhein-Main Wohnbau GmbH', 'Mainzer Landstraße, 60327 Frankfurt am Main', 8.64482, 50.10311, 'critical', 8, '#e5484d'),
  project(3, 'Gewerbepark Eschborn', 'Taunus Gewerbe KG', 'Sossenheimer Straße, 65760 Eschborn', 8.56598, 50.14157, 'normal', 4, '#30a46c'),
  project(4, 'Schulcampus Wiesbaden', 'Campus Wiesbaden Projekt GmbH', 'Gustav-Stresemann-Ring, 65189 Wiesbaden', 8.24966, 50.07186, 'high', 5, '#8e4ec6'),
  project(5, 'Wohnanlage Saarstraße', 'Mainzer Wohnen eG', 'Saarstraße, 55122 Mainz', 8.24698, 49.99659, 'normal', 4, '#f76b15'),
  project(6, 'Logistikhalle Rüsselsheim', 'LogiPark Süd GmbH', 'Rugbyring, 65428 Rüsselsheim am Main', 8.41038, 49.9861, 'normal', 3, '#12a594'),
  project(7, 'Hallenbau Kelsterbach', 'Airport Cargo Real Estate GmbH', 'Südliche Ringstraße, 65451 Kelsterbach', 8.52728, 50.05402, 'high', 4, '#d6409f'),
  project(8, 'Bürosanierung Darmstadt', 'Südhessen Immobilien AG', 'Mornewegstraße, 64293 Darmstadt', 8.63978, 49.87314, 'normal', 3, '#0090ff'),
  project(9, 'Ladenbau Offenbach', 'Kaiserlei Retail GmbH', 'Kaiserstraße, 63065 Offenbach am Main', 8.76028, 50.10057, 'low', 2, '#ffc53d'),
  project(10, 'Wohnbau Hofheim', 'Hofheimer Hausbau GmbH', 'Zeilsheimer Straße, 65719 Hofheim am Taunus', 8.44942, 50.08911, 'low', 2, '#7c66dc'),
  project(11, 'Praxisumbau Bad Homburg', 'Kurpark Medical GbR', 'Hessenring, 61348 Bad Homburg vor der Höhe', 8.6109, 50.224, 'normal', 2, '#46a758', 'planned'),
  project(12, 'Wohnquartier Hochheim', 'Weinberg Wohnen GmbH', 'Massenheimer Landstraße, 65239 Hochheim am Main', 8.35651, 50.01742, 'normal', 3, '#a18072', 'paused'),
];
