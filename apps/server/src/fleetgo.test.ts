import { describe, expect, it } from 'vitest';
import type { Vehicle } from '@trackliv/core';
import { matchVehicle, normalizePlate, parseEquipment, toTelemetry, vehicleFromEquipment } from './fleetgo.ts';

// Shape of one item returned by GET /api/equipment/Getfleet (as consumed by the RitAssist/FleetGO client).
const sample = {
  Id: 48211,
  EquipmentHeader: { SerialNumber: 'MTK-DT 103', Make: 'Volkswagen', Model: 'Crafter', EquipmentID: 'T-03' },
  EngineRunning: true,
  Odometer: 84211.4,
  Speed: 47,
  Location: { Latitude: 50.0512, Longitude: 8.5321, Altitude: 98, DateTime: '2026-10-08T07:41:12Z' },
};

const v = (id: string, plate: string, extra: Partial<Vehicle> = {}): Vehicle => ({
  id,
  callsign: id,
  plate,
  make: '',
  model: '',
  kind: 'van',
  seats: 4,
  requiredLicense: 'B',
  homeSiteId: 'hq-hafen',
  status: 'active',
  ...extra,
});

describe('FleetGO parsing', () => {
  it('normalises an equipment record', () => {
    const eq = parseEquipment(sample)!;
    expect(eq).toMatchObject({
      equipmentId: 48211,
      plate: 'MTK-DT 103',
      make: 'Volkswagen',
      lat: 50.0512,
      lng: 8.5321,
      speedKmh: 47,
      ignition: true,
      odometerKm: 84211.4,
      ts: '2026-10-08T07:41:12.000Z',
    });
    expect(toTelemetry(eq, 'veh-03', 'x')).toMatchObject({ vehicleId: 'veh-03', source: 'fleetgo', lat: 50.0512 });
  });

  it('tolerates missing positions and alternative field names', () => {
    const eq = parseEquipment({ id: '7', LicensePlate: 'MTK DT 9', LastLocation: { Latitude: '50.1', Longitude: '8.6' }, IgnitionOn: false })!;
    expect(eq.plate).toBe('MTK DT 9');
    expect(eq.lat).toBe(50.1);
    expect(parseEquipment({ foo: 1 })).toBeNull();
    expect(toTelemetry(parseEquipment({ Id: 1 })!, 'x', 'now')).toBeNull();
  });

  it('matches vehicles by FleetGO id first, then by licence plate', () => {
    const eq = parseEquipment(sample)!;
    const byPlate = v('veh-03', 'MTK DT103');
    const byId = v('veh-x', 'OTHER', { fleetgo: { equipmentId: 48211 } });
    expect(matchVehicle(eq, [byPlate])?.id).toBe('veh-03');
    expect(matchVehicle(eq, [byPlate, byId])?.id).toBe('veh-x');
    expect(normalizePlate('mtk-dt 103')).toBe('MTKDT103');
  });

  it('guesses a profile for unknown vehicles', () => {
    const eq = parseEquipment({ ...sample, EquipmentHeader: { SerialNumber: 'MTK-DT 200', Make: 'MAN', Model: 'TGL 8.190' } })!;
    const sites = [
      { id: 'hq-schieferstein', code: 'A', name: '', address: '', location: { lng: 8.4128, lat: 50.0068 }, geofenceRadiusM: 110, color: '' },
      { id: 'hq-hafen', code: 'B', name: '', address: '', location: { lng: 8.4137, lat: 50.0024 }, geofenceRadiusM: 110, color: '' },
    ];
    const veh = vehicleFromEquipment(eq, sites, 13);
    expect(veh).toMatchObject({ kind: 'truck', seats: 3, requiredLicense: 'C1', callsign: 'T-14', fleetgo: { equipmentId: 48211 } });
  });
});
