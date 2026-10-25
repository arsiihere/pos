import { canonicalJson, sha256hex } from '@pos/domain/hash';
import type { DirectoryInput } from '@pos/events';
import type pg from 'pg';
import { TenantScopedRepository, type TenantContext } from '../../db/tenant-scoped-repository.js';
import { inTransaction } from '../../lib/idempotency.js';
import { loadDirectory } from '../hub-registration/repository.js';
import { buildSnapshot } from './builder.js';
import type { SyncConfigQueryInput } from './schemas.js';

export type SyncConfigResult =
  | { kind: 'not_modified' }
  | {
      kind: 'ok';
      data: {
        config: { snapshot_hash: string; snapshot: Record<string, unknown> } | null;
        directory: DirectoryInput | null;
      };
    };

// §6.1: one read-only REPEATABLE READ transaction, statement (1) included, so the label matches the content.
export async function syncConfig(
  pool: pg.Pool,
  tenant: TenantContext,
  query: SyncConfigQueryInput,
): Promise<SyncConfigResult> {
  const branchId = tenant.branchIds[0]!;
  return inTransaction(
    pool,
    async (client) => {
      const rows = await new TenantScopedRepository(tenant, client).query<{
        config_version: string;
        tax_enabled: boolean;
        day_stale_after_hours: number;
        day_min_gap_hours: number;
        directory_version: string;
        currency_code: string;
      }>(
        `SELECT b.config_version, b.tax_enabled, b.day_stale_after_hours, b.day_min_gap_hours,
                t.directory_version, t.currency_code
           FROM branches b
           JOIN tenants t ON t.tenant_id = b.tenant_id
          WHERE b.tenant_id = $1 AND b.branch_id = ANY($2) AND b.branch_id = $3`,
        [branchId],
      );
      const header = rows[0]!;
      const configVersion = Number(header.config_version);
      const directoryVersion = Number(header.directory_version);
      const configChanged = configVersion !== query.config_version;
      const directoryChanged = directoryVersion !== query.directory_version;
      if (!configChanged && !directoryChanged) return { kind: 'not_modified' };

      let config: { snapshot_hash: string; snapshot: Record<string, unknown> } | null = null;
      if (configChanged) {
        const wire = await buildSnapshot(client, tenant, branchId, {
          config_version: configVersion,
          currency_code: header.currency_code,
          tax_enabled: header.tax_enabled,
          day_stale_after_hours: header.day_stale_after_hours,
          day_min_gap_hours: header.day_min_gap_hours,
        });
        config = { snapshot_hash: sha256hex(canonicalJson(wire)), snapshot: wire };
      }
      const directory = directoryChanged ? (await loadDirectory(client, tenant.tenantId, branchId)).directory : null;
      return { kind: 'ok', data: { config, directory } };
    },
    { isolation: 'REPEATABLE READ', readOnly: true },
  );
}
