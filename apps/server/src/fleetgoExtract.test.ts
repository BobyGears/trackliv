import { describe, expect, it } from 'vitest';
import { coordsOf, extractVehicles, maskUser, normalizeRecord, parseTime, redactUrl, shapeOf } from './fleetgoExtract.ts';

const vehicle = (i: number, extra: Record<string, unknown> = {}) => ({
  id: 100 + i,
  licensePlate: `MTK-DT ${100 + i}`,
  lastPosition: { latitude: 50 + i / 100, longitude: 8.4, timestamp: '2026-10-08T10:00:00Z' },
  speed: i * 10,
  ...extra,
});

describe('FleetGO dashboard data', () => {
  it('finds a nested vehicle list and normalises it', () => {
    const found = extractVehicles({ success: true, data: { total: 3, items: [vehicle(0), vehicle(1), vehicle(2)] } });
    expect(found?.candidate.path).toBe('data.items');
    expect(found?.vehicles.map((v) => v.plate)).toEqual(['MTK-DT 100', 'MTK-DT 101', 'MTK-DT 102']);
    expect(found?.vehicles[1]).toMatchObject({ equipmentId: 101, lat: 50.01, lng: 8.4, speedKmh: 10, ignition: true });
  });

  it('prefers vehicles over places with a radius and over a trip history', () => {
    const places = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `Kunde ${i}`, latitude: 50 + i / 100, longitude: 8.3, radius: 100 }));
    const trip = Array.from({ length: 400 }, (_, i) => ({ latitude: 50 + i / 1000, longitude: 8.3, speed: 50, time: i }));
    const found = extractVehicles({ places, trip, vehicles: [vehicle(0), vehicle(1)] });
    expect(found?.candidate.path).toBe('vehicles');
    expect(extractVehicles({ places })).toBeNull(); // never import customers as vehicles
  });

  it('understands other coordinate encodings', () => {
    expect(coordsOf({ Lat: '50.1', Lng: '8.2' })).toEqual({ lat: 50.1, lng: 8.2 });
    expect(coordsOf({ gps: { lat: 50123456, lon: 8234567 } })).toEqual({ lat: 50.123456, lng: 8.234567 }); // microdegrees
    expect(coordsOf({ geometry: { type: 'Point', coordinates: [8.2, 50.1] } })).toEqual({ lat: 50.1, lng: 8.2 });
    expect(coordsOf({ latitude: 0, longitude: 0 })).toBeNull();
    expect(coordsOf({ name: 'no position' })).toBeNull();
  });

  it('reads FleetGO/ASP.NET dates, booleans and names', () => {
    expect(parseTime('/Date(1700000000000+0100)/')).toBe('2023-11-14T22:13:20.000Z');
    expect(parseTime(1700000000)).toBe('2023-11-14T22:13:20.000Z');
    const v = normalizeRecord({ ObjectId: 7, Kenteken: 'MTK-DT 7', Name: 'Sprinter 7', Position: { Lat: 50, Lon: 8 }, Ignition: 'On', Direction: 270 });
    expect(v).toMatchObject({ equipmentId: 7, plate: 'MTK-DT 7', equipmentCode: 'Sprinter 7', ignition: true, heading: 270 });
  });

  it('still understands the official API format', () => {
    const v = normalizeRecord({ Id: 5, EquipmentHeader: { SerialNumber: 'MTK-DT 5' }, Location: { Latitude: 50, Longitude: 8.4 } });
    expect(v).toMatchObject({ equipmentId: 5, plate: 'MTK-DT 5', lat: 50, lng: 8.4 });
  });

  it('a single live update is recognised', () => {
    expect(extractVehicles(vehicle(3))?.vehicles[0].plate).toBe('MTK-DT 103');
    expect(extractVehicles({ settings: { language: 'de' } })).toBeNull();
  });

  it('reports structure and URLs without secrets', () => {
    expect(shapeOf({ data: { items: [vehicle(0)] }, token: 'abc' })).toBe('{data:{items:[1× {id, licensePlate, lastPosition:{latitude, longitude, timestamp}, speed}]}, token}');
    expect(redactUrl('https://app.fleetgo.com/api/query?groupId=0&access_token=eyJhbGciOi&x=1')).toBe('https://app.fleetgo.com/api/query?groupId=0&access_token=…&x=1');
    expect(maskUser('m.duranoglu@example.de')).toBe('m…@example.de');
  });
});
