import { config } from './config.ts';
import { db } from './db.ts';
import { FleetGoClient, matchVehicle, toTelemetry, vehicleFromEquipment } from './fleetgo.ts';
import { FleetGoDashboard } from './fleetgoDashboard.ts';
import { sites } from './geodata.ts';
import { broadcast } from './hub.ts';
import { ops } from './ops.ts';

/** Polls FleetGO (official API or the web dashboard) and feeds live positions into the tracker. */
export function startFleetGoSync() {
  const client = config.fleetgo.mode === 'api' ? new FleetGoClient() : new FleetGoDashboard();
  let running = false;
  let lastLogged = '';
  const poll = async () => {
    if (running) return; // a dashboard sign-in can take longer than one poll interval
    running = true;
    try {
      const fleet = await client.fleet();
      const telemetry = [];
      let matched = 0;
      let imported = 0;
      for (const eq of fleet) {
        let vehicle = matchVehicle(eq, db.data.vehicles);
        if (!vehicle && config.fleetgo.autoImport) {
          vehicle = vehicleFromEquipment(eq, sites, db.data.vehicles.length);
          db.data.vehicles.push(vehicle);
          imported++;
        }
        if (!vehicle) continue;
        matched++;
        if (!vehicle.fleetgo?.equipmentId) {
          vehicle.fleetgo = { ...vehicle.fleetgo, equipmentId: eq.equipmentId, serial: eq.plate };
          db.save();
        }
        const t = toTelemetry(eq, vehicle.id, ops.nowISO());
        if (t) telemetry.push(t);
      }
      if (imported) {
        db.save();
        broadcast('vehicles', db.data.vehicles);
        ops.log({ kind: 'fleet', severity: 'info', title: `Imported ${imported} vehicle(s) from FleetGO`, detail: 'Check seats, type and home depot in Fleet settings.' });
      }
      ops.ingest(telemetry);
      ops.checkLateDepartures();
      const wasDown = !ops.fleet.connected;
      ops.setFleetStatus({ source: 'fleetgo', connected: true, lastSync: ops.nowISO(), error: undefined, vehiclesMatched: matched, vehiclesTotal: fleet.length });
      if (wasDown) ops.log({ kind: 'fleet', severity: 'success', title: 'FleetGO connected', detail: `${matched} of ${fleet.length} vehicles matched` });
      lastLogged = '';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (ops.fleet.connected) ops.log({ kind: 'fleet', severity: 'critical', title: 'FleetGO sync failed', detail: message });
      ops.setFleetStatus({ source: 'fleetgo', connected: false, error: message });
      if (message !== lastLogged) console.error('[fleetgo]', message);
      lastLogged = message;
    } finally {
      running = false;
    }
  };
  ops.setFleetStatus({ source: 'fleetgo', connected: false, pollSeconds: config.fleetgo.pollSeconds });
  console.log(
    config.fleetgo.mode === 'api'
      ? `[fleetgo] polling ${config.fleetgo.baseUrl} every ${config.fleetgo.pollSeconds}s`
      : `[fleetgo] reading the FleetGO dashboard (${config.fleetgo.dashboardUrl}) every ${config.fleetgo.pollSeconds}s`,
  );
  void poll();
  setInterval(poll, config.fleetgo.pollSeconds * 1000);
}
