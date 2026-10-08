// Demo master data so TrackLiv is usable before real data is entered.
// Project locations are real street segments in Rhein-Main (no house numbers); clients and names are fictional.
import type { Person, Project, Vehicle } from '@trackliv/core';

const SCH = 'hq-schieferstein';
const HAF = 'hq-hafen';

export const demoVehicles: Vehicle[] = [
  { id: 'veh-01', callsign: 'T-01', plate: 'MTK-DT 101', make: 'Mercedes-Benz', model: 'Sprinter 317 CDI', kind: 'van', seats: 4, requiredLicense: 'B', homeSiteId: SCH, status: 'active' },
  { id: 'veh-02', callsign: 'T-02', plate: 'MTK-DT 102', make: 'Mercedes-Benz', model: 'Sprinter 317 CDI', kind: 'van', seats: 4, requiredLicense: 'B', homeSiteId: SCH, status: 'active' },
  { id: 'veh-03', callsign: 'T-03', plate: 'MTK-DT 103', make: 'Volkswagen', model: 'Crafter 35 TDI', kind: 'van', seats: 4, requiredLicense: 'B', homeSiteId: SCH, status: 'active' },
  { id: 'veh-04', callsign: 'T-04', plate: 'MTK-DT 104', make: 'Volkswagen', model: 'Crafter 35 TDI', kind: 'van', seats: 4, requiredLicense: 'B', homeSiteId: SCH, status: 'active' },
  { id: 'veh-05', callsign: 'T-05', plate: 'MTK-DT 105', make: 'Ford', model: 'Transit Custom', kind: 'van', seats: 3, requiredLicense: 'B', homeSiteId: SCH, status: 'active' },
  { id: 'veh-06', callsign: 'T-06', plate: 'MTK-DT 106', make: 'MAN', model: 'TGL 8.190 Koffer', kind: 'truck', seats: 3, requiredLicense: 'C1', homeSiteId: SCH, status: 'active' },
  { id: 'veh-07', callsign: 'T-07', plate: 'MTK-DT 107', make: 'Volkswagen', model: 'Amarok', kind: 'pickup', seats: 4, requiredLicense: 'B', homeSiteId: SCH, status: 'maintenance' },
  { id: 'veh-08', callsign: 'T-08', plate: 'MTK-DT 108', make: 'Mercedes-Benz', model: 'Sprinter 317 CDI', kind: 'van', seats: 4, requiredLicense: 'B', homeSiteId: HAF, status: 'active' },
  { id: 'veh-09', callsign: 'T-09', plate: 'MTK-DT 109', make: 'Renault', model: 'Master L3H2', kind: 'van', seats: 3, requiredLicense: 'B', homeSiteId: HAF, status: 'active' },
  { id: 'veh-10', callsign: 'T-10', plate: 'MTK-DT 110', make: 'Ford', model: 'Transit 350', kind: 'van', seats: 4, requiredLicense: 'B', homeSiteId: HAF, status: 'active' },
  { id: 'veh-11', callsign: 'T-11', plate: 'MTK-DT 111', make: 'Iveco', model: 'Daily 70C18', kind: 'truck', seats: 3, requiredLicense: 'C1', homeSiteId: HAF, status: 'active' },
  { id: 'veh-12', callsign: 'T-12', plate: 'MTK-DT 112', make: 'Mercedes-Benz', model: 'Atego 1224', kind: 'truck', seats: 3, requiredLicense: 'C', homeSiteId: HAF, status: 'active' },
  { id: 'veh-13', callsign: 'T-13', plate: 'MTK-DT 113', make: 'Toyota', model: 'Hilux Double Cab', kind: 'pickup', seats: 4, requiredLicense: 'B', homeSiteId: HAF, status: 'active' },
];

type P = [string, string, Person['role'], Person['licenses'], string, Person['status']?];
const roster: P[] = [
  ['Jonas', 'Weber', 'Foreman', ['B', 'C1'], SCH],
  ['Mehmet', 'Yılmaz', 'Driver', ['B', 'CE'], SCH],
  ['Lukas', 'Schneider', 'Technician', ['B'], SCH],
  ['Piotr', 'Nowak', 'Operative', ['B'], SCH],
  ['Stefan', 'Becker', 'Foreman', ['B', 'BE'], SCH],
  ['Daniel', 'Hoffmann', 'Technician', [], SCH],
  ['Ali', 'Demir', 'Operative', ['B'], SCH],
  ['Tobias', 'Fischer', 'Technician', ['B'], SCH],
  ['Marco', 'Rossi', 'Operative', [], SCH],
  ['Sven', 'Wagner', 'Driver', ['B', 'C'], SCH],
  ['Kevin', 'Braun', 'Apprentice', [], SCH],
  ['Emre', 'Arslan', 'Operative', ['B'], SCH],
  ['Dennis', 'Wolf', 'Technician', ['B'], SCH, 'sick'],
  ['Florian', 'Koch', 'Operative', [], SCH],
  ['Nikola', 'Petrović', 'Operative', ['B'], SCH],
  ['Michael', 'Richter', 'Foreman', ['B'], SCH, 'vacation'],
  ['Patrick', 'Klein', 'Apprentice', [], SCH],
  ['Can', 'Öztürk', 'Technician', ['B'], HAF],
  ['Sebastian', 'Neumann', 'Foreman', ['B', 'C1E'], HAF],
  ['Ivan', 'Horvat', 'Operative', [], HAF],
  ['Thomas', 'Krüger', 'Driver', ['B', 'C'], HAF],
  ['Alexander', 'Lange', 'Technician', ['B'], HAF],
  ['Burak', 'Çelik', 'Operative', ['B'], HAF],
  ['Marcel', 'Zimmermann', 'Operative', [], HAF],
  ['Dominik', 'Hartmann', 'Technician', ['B'], HAF, 'training'],
  ['Luca', 'Bianchi', 'Operative', ['B'], HAF],
  ['Benjamin', 'Schmitt', 'Apprentice', [], HAF],
  ['Yusuf', 'Aydın', 'Operative', ['B'], HAF],
  ['Jan', 'Werner', 'Technician', ['B'], HAF],
  ['Felix', 'Krause', 'Operative', [], HAF],
  ['Kai', 'Schäfer', 'Driver', ['B', 'C1'], HAF],
  ['Robert', 'Maier', 'Operative', [], HAF],
];

export const demoPeople: Person[] = roster.map(([firstName, lastName, role, licenses, homeSiteId, status], i) => ({
  id: `p-${String(i + 1).padStart(2, '0')}`,
  firstName,
  lastName,
  role,
  licenses,
  homeSiteId,
  status: status ?? 'available',
}));

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
