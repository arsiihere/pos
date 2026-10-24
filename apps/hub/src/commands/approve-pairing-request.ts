import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sha256hex } from '../lib/hash.js';
import { stationExists } from '../auth/station-validator.js';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';

const Payload = z.object({
  request_id: z.string().min(1),
  display_code: z.string().min(1),
  device_type: z.enum(['cashier_kiosk', 'kds']),
  station_id: z.string().min(1).optional(),
});

const PAGE = `<!doctype html>
<html><body>
<form id="approve">
  <label>Display code <input name="display_code"></label>
  <label>Type <select name="device_type"><option>cashier_kiosk</option><option>kds</option></select></label>
  <label>Station <input name="station_id"></label>
  <button type="submit">Approve</button>
</form>
<script>
const requestId = new URLSearchParams(location.search).get('r');
document.getElementById('approve').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const station = form.get('station_id');
  fetch('/admin/commands/approve-pairing-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      command_type: 'ApprovePairingRequest',
      payload: {
        request_id: requestId,
        display_code: form.get('display_code'),
        device_type: form.get('device_type'),
        station_id: station === '' ? undefined : station,
      },
    }),
  });
});
</script>
</body></html>`;

export function registerApprovePairingRequest(app: FastifyInstance): void {
  app.get('/admin/approve', { config: { group: 'admin' } }, async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(PAGE);
  });
  commandRegistry(app).register(
    defineCommand({
      commandType: 'ApprovePairingRequest',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-devices',
      handle(ctx, payload) {
        const kds = payload.device_type === 'kds';
        const stationId = payload.station_id ?? null;
        if (kds !== (stationId !== null)) {
          throw new DomainError('VALIDATION_FAILED', {
            issues: [{ path: 'station_id', message: 'required iff kds' }],
          });
        }
        if (kds && stationId !== null && !stationExists(ctx.tx, stationId)) throw new DomainError('STATION_NOT_FOUND');
        const now = ctx.clock.branchNow();
        const row = ctx.tx.db
          .prepare(
            `SELECT request_id, display_code, device_name, expires_at, approved_at
             FROM pair_requests WHERE request_id = ? AND branch_id = ?`,
          )
          .get(payload.request_id, ctx.branch.branchId) as
          | {
              request_id: string;
              display_code: string;
              device_name: string;
              expires_at: number;
              approved_at: number | null;
            }
          | undefined;
        if (row === undefined || row.expires_at <= now || row.approved_at !== null || row.display_code !== payload.display_code) {
          throw new DomainError('PAIRING_REQUEST_NOT_FOUND');
        }
        const actor = ctx.actor.staffId;
        if (actor === null) throw new DomainError('PERMISSION_DENIED', { permission: 'manage-devices' });
        const deviceId = ctx.ids.next();
        const deviceToken = ctx.secrets.token256();
        ctx.tx.db
          .prepare(
            `INSERT INTO devices (
              device_id, branch_id, token_hash, device_name, device_type,
              station_id, owner_staff_id, paired_at, paired_by
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          )
          .run(deviceId, ctx.branch.branchId, sha256hex(deviceToken), row.device_name, payload.device_type, stationId, now, actor);
        ctx.tx.db
          .prepare(
            `UPDATE pair_requests
             SET approved_at = ?, approved_by = ?, device_id = ?, delivery_token = ?
             WHERE request_id = ?`,
          )
          .run(now, actor, deviceId, deviceToken, row.request_id);
        return {
          events: [
            {
              stream_type: 'hub',
              stream_id: deviceId,
              event_type: 'DevicePaired',
              schema_version: 1,
              payload: {
                device_id: deviceId,
                device_name: row.device_name,
                device_type: payload.device_type,
                station_id: stationId,
                owner_staff_id: null,
                pairing_token_id: null,
                pairing_request_id: row.request_id,
              },
              occurred_at: now,
              actor_id: actor,
              device_id: deviceId,
            },
          ],
          result: { device_id: deviceId, device_type: payload.device_type, station_id: stationId },
        };
      },
    }),
  );
}
