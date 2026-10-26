import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { provisionedOf } from '../config/schema.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import type { WriterTx } from '../engine-host/writer.js';
import { sha256hex } from '../lib/hash.js';
import { qrSvg } from '../lib/qr.js';
import type { HubDeps } from '../server.js';

const Body = z.object({
  device_name: z.string().min(1).max(40),
});

const PENDING_CAP = 10;
const PER_IP_CAP = 2;

export function clearExpiredDeliveryTokens(tx: WriterTx, now: number): void {
  tx.db.prepare('UPDATE pair_requests SET delivery_token = NULL WHERE delivery_token IS NOT NULL AND expires_at <= ?').run(now);
}

export function registerPairRequestRoutes(app: FastifyInstance, deps: HubDeps): void {
  app.post('/pair/requests', { config: { group: 'pair-request' } }, async (request) => {
    const parsed = Body.safeParse(request.body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    const created = deps.writer.run((tx) => createRequest(deps, tx, parsed.data.device_name, request.ip)).result;
    return { data: created };
  });

  app.get('/pair/requests/:id', { config: { group: 'pair-request' } }, async (request) => {
    const id = (request.params as { id: string }).id;
    const secret = header(request.headers['x-poll-secret']);
    const row = deps.readDb
      .prepare(
        `SELECT r.poll_secret_hash, r.expires_at, r.approved_at, r.device_id, r.delivery_token,
                d.device_type, d.station_id
         FROM pair_requests r
         LEFT JOIN devices d ON d.device_id = r.device_id
         WHERE r.request_id = ?`,
      )
      .get(id) as
      | {
          poll_secret_hash: string;
          expires_at: number;
          approved_at: number | null;
          device_id: string | null;
          delivery_token: string | null;
          device_type: string | null;
          station_id: string | null;
        }
      | undefined;
    if (
      secret === undefined ||
      row === undefined ||
      row.poll_secret_hash !== sha256hex(secret) ||
      row.expires_at <= deps.clock.branchNow()
    ) {
      throw new DomainError('PAIRING_REQUEST_NOT_FOUND');
    }
    if (row.approved_at === null) return { data: { status: 'pending' } };
    return {
      data: {
        status: 'approved',
        device_id: row.device_id,
        device_token: row.delivery_token,
        device_type: row.device_type,
        station_id: row.station_id,
        // M92: the screen names its station while it opens.
        station_name: row.station_id === null ? null : (branchConfig()?.stations.find((station) => station.station_id === row.station_id)?.name ?? null),
        branch_name: provisionedOf(deps.config).branch_name,
      },
    };
  });
}

function createRequest(deps: HubDeps, tx: WriterTx, deviceName: string, requesterIp: string) {
  const now = tx.clock.branchNow();
  const branchId = tx.branchId;
  const oldest = tx.db
    .prepare(
      `SELECT MIN(expires_at) AS expires_at, COUNT(*) AS n
       FROM pair_requests
       WHERE branch_id = ? AND requester_ip = ? AND approved_at IS NULL AND expires_at > ?`,
    )
    .get(branchId, requesterIp, now) as { expires_at: number | null; n: number };
  if (oldest.n >= PER_IP_CAP) {
    throw new DomainError('IP_LOCKED_OUT', { retry_after_ms: (oldest.expires_at ?? now) - now });
  }
  const pending = tx.db
    .prepare(
      `SELECT COUNT(*) AS n FROM pair_requests WHERE branch_id = ? AND approved_at IS NULL AND expires_at > ?`,
    )
    .get(branchId, now) as { n: number };
  if (pending.n >= PENDING_CAP) throw new DomainError('SERVICE_UNAVAILABLE', { retry_after_ms: 60_000 });
  const requestId = tx.ids.next();
  const pollSecret = deps.secrets.token256();
  const displayCode = deps.secrets.crockford(6);
  const expiresAt = now + 600_000;
  tx.db
    .prepare(
      `INSERT INTO pair_requests (
        request_id, branch_id, poll_secret_hash, display_code, device_name, requester_ip, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(requestId, branchId, sha256hex(pollSecret), displayCode, deviceName, requesterIp, now, expiresAt);
  const host = deps.config.advertised_host ?? '';
  const approveUrl = `http://${host}:${deps.config.http_port}/admin/approve?r=${requestId}`;
  return {
    request_id: requestId,
    poll_secret: pollSecret,
    display_code: displayCode,
    expires_at: expiresAt,
    approve_url: approveUrl,
    approve_qr_svg: qrSvg(approveUrl),
  };
}

function header(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first.length === 0) return undefined;
  return first;
}
