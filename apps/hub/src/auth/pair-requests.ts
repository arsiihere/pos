import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EventDraft } from '@pos/events';
import { DEVICE_WAITING, DEVICE_WAITING_KEY } from '../alerts/kinds.js';
import { alerts, type AlertCtx } from '../alerts/raise.js';
import { provisionedOf } from '../config/schema.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import type { WriterTx } from '../engine-host/writer.js';
import { sha256hex } from '../lib/hash.js';
import { qrSvg } from '../lib/qr.js';
import type { HubDeps } from '../server.js';

const Body = z.object({
  device_name: z.string().min(1).max(40),
  // 05a §6.1: a default for the form only (M-2).
  hardware_hint: z.enum(['tablet', 'cashier_kiosk', 'kds', 'phone']).optional(),
});

const PENDING_CAP = 10;
const PER_IP_CAP = 2;

export function clearExpiredDeliveryTokens(tx: WriterTx, now: number): void {
  tx.db.prepare('UPDATE pair_requests SET delivery_token = NULL WHERE delivery_token IS NOT NULL AND expires_at <= ?').run(now);
}

/**
 * 05a §3.10 close (row D-3): one read gives the pending requests other than the ones just approved / expired and the
 * open `device_waiting` (the §6.3 "pending read for the close (1)"); when none is pending and one is open, the
 * `AlertClosed` draft (+ the close's own row read). Called inside ApprovePairingRequest's transaction (`done`) and the
 * session sweeper's existing write (`obsolete`). Returns [] when it stays open or none is open.
 */
export function closeDeviceWaitingWhenIdle(ctx: AlertCtx, now: number, reason: 'done' | 'obsolete'): EventDraft[] {
  const row = ctx.tx.db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM pair_requests WHERE branch_id = ? AND approved_at IS NULL AND expires_at > ?) AS pending,
         (SELECT alert_id FROM alerts WHERE state = 'open' AND kind = ? AND dedupe_key = ?) AS alert_id`,
    )
    .get(ctx.tx.branchId, now, DEVICE_WAITING.kind, DEVICE_WAITING_KEY) as { pending: number; alert_id: string | null };
  if (row.pending > 0 || row.alert_id === null) return [];
  return alerts.close(ctx, row.alert_id, reason);
}

export function registerPairRequestRoutes(app: FastifyInstance, deps: HubDeps): void {
  app.post('/pair/requests', { config: { group: 'pair-request' } }, async (request) => {
    const parsed = Body.safeParse(request.body);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    const created = deps.writer.run((tx) => createRequest(deps, tx, parsed.data.device_name, parsed.data.hardware_hint ?? null, request.ip)).result;
    return { data: created };
  });

  app.get('/pair/requests/:id', { config: { group: 'pair-request' } }, async (request) => {
    const id = (request.params as { id: string }).id;
    const secret = header(request.headers['x-poll-secret']);
    const row = deps.readDb
      .prepare(
        `SELECT r.poll_secret_hash, r.expires_at, r.approved_at, r.device_id, r.delivery_token,
                d.device_type, d.station_id, p.screens
         FROM pair_requests r
         LEFT JOIN devices d ON d.device_id = r.device_id
         LEFT JOIN device_profiles p ON p.device_id = r.device_id
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
          screens: string | null;
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
        // 05a §6.2: from the device's profile; a kds (or a device without one) has none.
        screens: row.screens === null ? [] : (JSON.parse(row.screens) as string[]),
        // M92: the screen names its station while it opens.
        station_name: row.station_id === null ? null : (branchConfig()?.stations.find((station) => station.station_id === row.station_id)?.name ?? null),
        branch_name: provisionedOf(deps.config).branch_name,
      },
    };
  });
}

function createRequest(deps: HubDeps, tx: WriterTx, deviceName: string, hardwareHint: string | null, requesterIp: string) {
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
        request_id, branch_id, poll_secret_hash, display_code, device_name, requester_ip, created_at, expires_at, hardware_hint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(requestId, branchId, sha256hex(pollSecret), displayCode, deviceName, requesterIp, now, expiresAt, hardwareHint);
  // 05a §3.10 / §6.1 (row D-3): raise `device_waiting` when none is open. `raise`'s own dedupe read is the "when none
  // is open" check (1 statement; an open one → `deduped`, nothing to append, no other read). Raised as the hub (actor
  // null, device 'hub'); no values and a label key only: never the code or the requester's device name.
  const raised = alerts.raise(alerts.tickCtx(tx, now), {
    kind: DEVICE_WAITING.kind,
    subject: { stream_type: 'hub', stream_id: branchId },
    target: { kind: 'permission', permission: 'manage-devices' },
    display: { kind_label_key: DEVICE_WAITING.labels.lock },
    dedupe_key: DEVICE_WAITING_KEY,
  });
  if (!raised.deduped) tx.append(raised.events);
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
