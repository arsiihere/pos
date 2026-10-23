import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WriterTx } from '../engine-host/writer.js';
import { HUB_VERSION } from '../lib/health.js';
import { sha256hex } from '../lib/hash.js';
import type { HubDeps } from '../server.js';
import { currentDirectory } from './guards.js';
import { pairPage } from './pair-page.js';

const Body = z.object({
  pairing_token: z.string().min(1),
  pair_request_id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  device_name: z.string().min(1).max(40),
  device_type: z.enum(['tablet', 'phone', 'cashier_kiosk', 'kds']),
});

const ROTATE_WITHIN_MS = 600_000;

interface TokenRow {
  pairing_token_id: string;
  device_type: 'tablet' | 'phone';
  owner_staff_id: string | null;
  created_by: string;
  expires_at: number;
  consumed_at: number | null;
  consumed_request_id: string | null;
  device_id: string | null;
}

export function registerPairRoutes(app: FastifyInstance, deps: HubDeps): void {
  app.get('/pair', { config: { group: 'pair' } }, async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(pairPage());
  });

  app.post('/devices/pair', { config: { group: 'pair' } }, async (request) => {
    const parsed = Body.safeParse(request.body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    const paired = deps.writer.run((tx) => pairWithToken(app, deps, tx, parsed.data)).result;
    return { data: paired };
  });
}

function pairWithToken(
  app: FastifyInstance,
  deps: HubDeps,
  tx: WriterTx,
  body: z.infer<typeof Body>,
): {
  device_id: string;
  device_token: string;
  device_type: string;
  owner_staff_id: string | null;
  branch_id: string;
  branch_name: string;
  hub_version: string;
} {
  const now = tx.clock.branchNow();
  const row = tx.db
    .prepare(
      `SELECT pairing_token_id, device_type, owner_staff_id, created_by, expires_at,
              consumed_at, consumed_request_id, device_id
       FROM pairing_tokens WHERE token_hash = ?`,
    )
    .get(sha256hex(body.pairing_token)) as TokenRow | undefined;
  if (row === undefined || row.expires_at <= now) throw new DomainError('PAIRING_TOKEN_INVALID');
  if (row.device_type !== body.device_type) throw new DomainError('DEVICE_TYPE_NOT_ALLOWED');
  if (row.consumed_at !== null) return rotate(deps, tx, row, body.pair_request_id, now);
  if (row.device_type === 'phone') {
    const owner = row.owner_staff_id;
    if (owner === null || currentDirectory(app).get(owner) === undefined) throw new DomainError('PAIRING_TOKEN_INVALID');
  }
  const deviceId = tx.ids.next();
  const deviceToken = deps.secrets.token256();
  tx.db
    .prepare(
      `INSERT INTO devices (
        device_id, branch_id, token_hash, device_name, device_type,
        station_id, owner_staff_id, paired_at, paired_by
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      deviceId,
      tx.branchId,
      sha256hex(deviceToken),
      body.device_name,
      row.device_type,
      row.owner_staff_id,
      now,
      row.created_by,
    );
  tx.db
    .prepare(
      `UPDATE pairing_tokens SET consumed_at = ?, consumed_request_id = ?, device_id = ? WHERE pairing_token_id = ?`,
    )
    .run(now, body.pair_request_id, deviceId, row.pairing_token_id);
  tx.append([
    {
      stream_type: 'hub',
      stream_id: deviceId,
      event_type: 'DevicePaired',
      schema_version: 1,
      payload: {
        device_id: deviceId,
        device_name: body.device_name,
        device_type: row.device_type,
        station_id: null,
        owner_staff_id: row.owner_staff_id,
        pairing_token_id: row.pairing_token_id,
        pairing_request_id: null,
      },
      occurred_at: now,
      actor_id: row.created_by,
      device_id: deviceId,
    },
  ]);
  return response(deviceId, deviceToken, row.device_type, row.owner_staff_id, tx.branchId);
}

function rotate(
  deps: HubDeps,
  tx: WriterTx,
  row: TokenRow,
  pairRequestId: string,
  now: number,
): {
  device_id: string;
  device_token: string;
  device_type: string;
  owner_staff_id: string | null;
  branch_id: string;
  branch_name: string;
  hub_version: string;
} {
  const deviceId = row.device_id;
  const device =
    deviceId === null
      ? undefined
      : (tx.db.prepare('SELECT revoked_at FROM devices WHERE device_id = ?').get(deviceId) as
          | { revoked_at: number | null }
          | undefined);
  const within = row.consumed_at !== null && now - row.consumed_at < ROTATE_WITHIN_MS;
  if (deviceId === null || device === undefined || device.revoked_at !== null || row.consumed_request_id !== pairRequestId || !within) {
    throw new DomainError('PAIRING_TOKEN_INVALID');
  }
  const deviceToken = deps.secrets.token256();
  tx.db.prepare('UPDATE devices SET token_hash = ? WHERE device_id = ?').run(sha256hex(deviceToken), deviceId);
  tx.append([
    {
      stream_type: 'hub',
      stream_id: deviceId,
      event_type: 'DeviceTokenRotated',
      schema_version: 1,
      payload: { device_id: deviceId, pair_request_id: pairRequestId },
      occurred_at: now,
      actor_id: row.created_by,
      device_id: deviceId,
    },
  ]);
  return response(deviceId, deviceToken, row.device_type, row.owner_staff_id, tx.branchId);
}

function response(
  deviceId: string,
  deviceToken: string,
  deviceType: string,
  ownerStaffId: string | null,
  branchId: string,
): {
  device_id: string;
  device_token: string;
  device_type: string;
  owner_staff_id: string | null;
  branch_id: string;
  branch_name: string;
  hub_version: string;
} {
  return {
    device_id: deviceId,
    device_token: deviceToken,
    device_type: deviceType,
    owner_staff_id: ownerStaffId,
    branch_id: branchId,
    branch_name: '',
    hub_version: HUB_VERSION,
  };
}
