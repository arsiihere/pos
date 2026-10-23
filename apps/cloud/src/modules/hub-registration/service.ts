import { DomainError } from '@pos/domain';
import type { DirectoryInput } from '@pos/events';
import type pg from 'pg';
import type { Clock } from '../../lib/clock.js';
import type { IdGen } from '../../lib/ids.js';
import type { SecretGen } from '../../lib/secrets.js';
import {
  codeHash,
  codeIsUsable,
  consumeCode,
  insertApiKey,
  loadDirectory,
  lockRegistrationCode,
  revokeLiveKey,
  sha256,
  type LockedCode,
} from './repository.js';

export interface RegisterHubResult {
  tenant_id: string;
  branch_id: string;
  branch_name: string;
  currency_code: string;
  kind: LockedCode['kind'];
  branch_api_key: string;
  directory: DirectoryInput;
  rotated: boolean;
}

export async function registerHub(
  pool: pg.Pool,
  input: { registrationCode: string; idempotencyKey: string; acceptedKinds: Array<LockedCode['kind']> },
  deps: { clock: Clock; ids: IdGen; secrets: SecretGen },
): Promise<RegisterHubResult> {
  const now = deps.clock.branchNow();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await lockRegistrationCode(client, codeHash(input.registrationCode));
    if (row === null || !codeIsUsable(row, input.idempotencyKey, now)) {
      throw new DomainError('REGISTRATION_CODE_INVALID');
    }
    if (!input.acceptedKinds.includes(row.kind)) throw new DomainError('REGISTRATION_CODE_KIND_UNSUPPORTED');
    const branchApiKey = deps.secrets.token256();
    const rotated = await revokeLiveKey(client, row.tenant_id, row.branch_id, now);
    await insertApiKey(client, row, deps.ids.next(), sha256(branchApiKey), now);
    if (row.consumed_at === null) await consumeCode(client, row.code_hash, now, input.idempotencyKey);
    const loaded = await loadDirectory(client, row.tenant_id, row.branch_id);
    await client.query('COMMIT');
    return {
      tenant_id: row.tenant_id,
      branch_id: row.branch_id,
      branch_name: loaded.branch_name,
      currency_code: loaded.currency_code,
      kind: row.kind,
      branch_api_key: branchApiKey,
      directory: loaded.directory,
      rotated,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
