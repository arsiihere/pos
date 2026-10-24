import type { WriterTx } from '../engine-host/writer.js';
import type { Clock } from '../lib/clock.js';
import { sha256hex } from '../lib/hash.js';
import type { IdGen } from '../lib/ids.js';
import type { SecretGen } from '../lib/secrets.js';

const BOOTSTRAP_TTL_MS = 1_800_000;

export function issueAdminBootstrap(
  tx: WriterTx,
  issuedBy: 'setup' | 'cli' | 'restore',
  deps: { clock: Clock; ids: IdGen; secrets: SecretGen },
): { token: string; bootstrap_token_id: string; expires_at: number } {
  const now = deps.clock.branchNow();
  tx.db
    .prepare(
      `UPDATE admin_bootstrap_tokens SET expires_at = ?
       WHERE branch_id = ? AND consumed_at IS NULL AND expires_at > ?`,
    )
    .run(now, tx.branchId, now);
  const token = deps.secrets.token256();
  const bootstrapTokenId = deps.ids.next();
  const expiresAt = now + BOOTSTRAP_TTL_MS;
  tx.db
    .prepare(
      `INSERT INTO admin_bootstrap_tokens (
        bootstrap_token_id, branch_id, token_hash, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(bootstrapTokenId, tx.branchId, sha256hex(token), now, expiresAt);
  tx.append([
    {
      stream_type: 'hub',
      stream_id: tx.branchId,
      event_type: 'AdminBootstrapTokenIssued',
      schema_version: 1,
      payload: { bootstrap_token_id: bootstrapTokenId, expires_at: expiresAt, issued_by: issuedBy },
      occurred_at: now,
      actor_id: null,
      device_id: 'hub',
    },
  ]);
  return { token, bootstrap_token_id: bootstrapTokenId, expires_at: expiresAt };
}
