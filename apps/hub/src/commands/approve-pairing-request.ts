import { DomainError } from '@pos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { encodeCrockford128 } from '../auth/pair-page.js';
import { stationExists } from '../auth/station-validator.js';
import { sha256hex } from '../lib/hash.js';
import type { HubDeps } from '../server.js';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';

const Payload = z.object({
  request_id: z.string().min(1),
  display_code: z.string().min(1),
  device_type: z.enum(['cashier_kiosk', 'kds']),
  station_id: z.string().min(1).optional(),
});

function approvePage(ctx: {
  tenant_id: string;
  branch_id: string;
  device_id: string;
  staff_id: string;
  device_token: string;
  admin_session_token: string;
}): string {
  const json = JSON.stringify(ctx).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html><body>
<form id="approve">
  <label>Display code <input name="display_code"></label>
  <label>Type <select name="device_type"><option>cashier_kiosk</option><option>kds</option></select></label>
  <label>Station <input name="station_id"></label>
  <button type="submit">Approve</button>
</form>
<script>
${encodeCrockford128.toString()}
const ctx = ${json};
const requestId = new URLSearchParams(location.search).get('r');
document.getElementById('approve').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const station = form.get('station_id');
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  fetch('/admin/commands/approve-pairing-request', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + ctx.device_token,
      'x-admin-session': ctx.admin_session_token,
    },
    body: JSON.stringify({
      command_id: encodeCrockford128(bytes),
      tenant_id: ctx.tenant_id,
      branch_id: ctx.branch_id,
      command_type: 'ApprovePairingRequest',
      payload: {
        request_id: requestId,
        display_code: form.get('display_code'),
        device_type: form.get('device_type'),
        station_id: station === '' ? undefined : station,
      },
      occurred_at: Date.now(),
      actor_id: ctx.staff_id,
      device_id: ctx.device_id,
    }),
  });
});
</script>
</body></html>`;
}

export function registerApprovePairingRequest(app: FastifyInstance, deps: HubDeps): void {
  app.get('/admin/approve', { config: { group: 'admin' } }, async (request, reply) => {
    const device = request.device;
    const staffId = request.session?.staff_id;
    const provisioned = deps.config.provisioned;
    if (device === undefined || staffId == null || provisioned === undefined) throw new DomainError('ADMIN_SESSION_REQUIRED');
    return reply.type('text/html; charset=utf-8').send(
      approvePage({
        tenant_id: provisioned.tenant_id,
        branch_id: provisioned.branch_id,
        device_id: device.device_id,
        staff_id: staffId,
        device_token: bearer(request),
        admin_session_token: header(request, 'x-admin-session'),
      }),
    );
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
        if (kds && stationId !== null && !stationExists(ctx.tx, stationId)) {
          throw new DomainError('STATION_NOT_FOUND', { station_id: stationId });
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

function header(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first ?? '';
}

function bearer(request: FastifyRequest): string {
  const value = header(request, 'authorization');
  return value.startsWith('Bearer ') ? value.slice('Bearer '.length) : '';
}
