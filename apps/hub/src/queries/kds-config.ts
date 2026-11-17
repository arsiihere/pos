import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Resolution } from '../auth/staff-directory.js';
import { stationPresence } from '../kds/contracts.js';
import { archivedOpen } from '../kds/config-hook.js';
import { DEFAULT_SOUND_VOLUME } from '../ws/kds-catch-up.js';
import { wsHubFor } from '../ws/server.js';
import { defineQuery, queryRegistry, type QueryCtx } from './registry.js';

// 03b §6.12, §3.8 (task b23): GET /admin/queries/kds-config — admin session, `manage-devices` checked inside handle
// (queries have no permission field). Statements 3 (devices, settings, lanes) + memory: the config's stations, the
// socket lists (connected = a session socket on the device; signed_out = an alert-mode socket, 00 H-1; else offline),
// stationPresence() for dark (b20) and the engine for archived stations with open lines (§3.10). v1.0.8 (Q-48): + points[]
// and `name` on every warning, from the branch config (memory); statements unchanged.

type ScreenState = 'connected' | 'signed_out' | 'offline';

const DEVICES_SQL = `SELECT device_id, device_name, device_type, station_id, point_id, lane_label FROM devices
  WHERE revoked_at IS NULL AND ((device_type = 'kds' AND station_id IS NOT NULL) OR (device_type = 'tablet' AND point_id IS NOT NULL))
  ORDER BY paired_at, device_id`;

interface DeviceRow {
  device_id: string;
  device_name: string;
  device_type: string;
  station_id: string | null;
  point_id: string | null;
  lane_label: string | null;
}

function requireManageDevices(ctx: QueryCtx): void {
  const staffId = ctx.session?.staff_id ?? null;
  const resolution: Resolution = staffId === null ? { grant: 'not_granted' } : ctx.directory.resolve(staffId, 'manage-devices');
  if (resolution.grant !== 'allowed') throw new DomainError('PERMISSION_DENIED', { permission: 'manage-devices', grant: resolution.grant });
}

export function registerKdsConfigQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'kds-config',
      sessionKind: 'admin',
      session: 'none',
      countsAsActivity: false,
      querySchema: z.object({}),
      handle(ctx) {
        requireManageDevices(ctx);
        const devices = ctx.db.prepare(DEVICES_SQL).all() as DeviceRow[];
        const volumes = new Map(
          (ctx.db.prepare('SELECT station_id, sound_volume FROM kds_station_settings').all() as Array<{ station_id: string; sound_volume: number }>).map((r) => [
            r.station_id,
            r.sound_volume,
          ]),
        );
        const lanes = new Map(
          (ctx.db.prepare('SELECT station_id, lanes_on, lane_count FROM station_lanes').all() as Array<{ station_id: string; lanes_on: number | null; lane_count: number }>).map(
            (r) => [r.station_id, r],
          ),
        );

        const ws = wsHubFor(app);
        const connected = new Set(ws.connectedSessions().map((s) => s.deviceId));
        const alertMode = new Set(ws.alertSockets().map((s) => s.deviceId));
        const stateOf = (device_id: string): ScreenState => (connected.has(device_id) ? 'connected' : alertMode.has(device_id) ? 'signed_out' : 'offline');
        let presence: Map<string, { dark: boolean }>;
        try {
          presence = stationPresence();
        } catch {
          presence = new Map(); // b20 not provided (no presence tick yet): nothing is dark
        }

        const config = ctx.branchConfig;
        const stations = (config?.stations ?? [])
          .filter((s) => !s.is_archived)
          .map((s) => {
            const screens = devices.filter((d) => d.device_type === 'kds' && d.station_id === s.station_id);
            const row = lanes.get(s.station_id);
            const lane_count = row !== undefined ? row.lane_count : Math.max(1, screens.filter((d) => d.lane_label !== null).length);
            return {
              station_id: s.station_id,
              name: s.name,
              point_id: s.point_id,
              sound_volume: volumes.get(s.station_id) ?? DEFAULT_SOUND_VOLUME,
              lanes: { lanes_on: row !== undefined ? row.lanes_on : lane_count, lane_count },
              screens: screens.map((d) => ({ device_id: d.device_id, name: d.device_name, lane_label: d.lane_label, state: stateOf(d.device_id) })),
              dark: presence.get(s.station_id)?.dark ?? false,
            };
          });
        const pass_tablets = devices
          .filter((d) => d.device_type === 'tablet')
          .map((d) => ({ device_id: d.device_id, name: d.device_name, point_id: d.point_id!, state: stateOf(d.device_id) }));
        // Q-48: every point of the config (archived included) and the station name on each warning (archived stations included).
        const points = (config?.points ?? []).map((p) => ({ point_id: p.point_id, name: p.name, is_archived: p.is_archived }));
        const stationNames = new Map((config?.stations ?? []).map((s) => [s.station_id, s.name]));
        const warnings: Array<{ station_id: string; kind: 'archived_open_lines' | 'dark'; name: string }> = [
          ...archivedOpen(ctx.state, config, ctx.now).map((a) => ({ station_id: a.station_id, kind: 'archived_open_lines' as const, name: stationNames.get(a.station_id) ?? a.station_id })),
          ...stations.filter((s) => s.dark).map((s) => ({ station_id: s.station_id, kind: 'dark' as const, name: s.name })),
        ];
        return { data: { stations, pass_tablets, points, warnings } };
      },
    }),
  );
}
