import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sha256hex } from '../lib/hash.js';
import { qrSvg } from '../lib/qr.js';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';

const Payload = z.object({
  device_type: z.enum(['tablet', 'phone']),
  owner_staff_id: z.string().min(1).optional(),
});

export function registerGenerateDevicePairingToken(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'GenerateDevicePairingToken',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-devices',
      handle(ctx, payload) {
        const phone = payload.device_type === 'phone';
        const owner = payload.owner_staff_id ?? null;
        if (phone !== (owner !== null)) {
          throw new DomainError('VALIDATION_FAILED', {
            issues: [{ path: 'owner_staff_id', message: 'required iff phone' }],
          });
        }
        if (phone && (owner === null || ctx.directory.get(owner) === undefined)) {
          throw new DomainError('STAFF_NOT_FOUND');
        }
        const createdBy = ctx.actor.staffId;
        if (createdBy === null) throw new DomainError('PERMISSION_DENIED', { permission: 'manage-devices' });
        const now = ctx.clock.branchNow();
        const token = ctx.secrets.bytes(32).toString('base64url');
        const pairingTokenId = ctx.ids.next();
        const expiresAt = now + 600_000;
        ctx.tx.db
          .prepare(
            `INSERT INTO pairing_tokens (
              pairing_token_id, branch_id, token_hash, device_type, owner_staff_id,
              created_by, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            pairingTokenId,
            ctx.branch.branchId,
            sha256hex(token),
            payload.device_type,
            owner,
            createdBy,
            now,
            expiresAt,
          );
        const host = ctx.config.advertised_host;
        if (host === undefined) throw new DomainError('HUB_NOT_PROVISIONED');
        const pairUrl = `http://${host}:${ctx.config.http_port}/pair?t=${token}`;
        return {
          events: [
            {
              stream_type: 'hub',
              stream_id: ctx.branch.branchId,
              event_type: 'DevicePairingTokenGenerated',
              schema_version: 1,
              payload: {
                pairing_token_id: pairingTokenId,
                device_type: payload.device_type,
                owner_staff_id: owner,
                expires_at: expiresAt,
              },
              occurred_at: now,
              actor_id: createdBy,
              device_id: ctx.actor.deviceId,
            },
          ],
          result: {
            pairing_token: token,
            pairing_token_id: pairingTokenId,
            expires_at: expiresAt,
            pair_url: pairUrl,
            pair_qr_svg: qrSvg(pairUrl),
          },
        };
      },
    }),
  );
}
