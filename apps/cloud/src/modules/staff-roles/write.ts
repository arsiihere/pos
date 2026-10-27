import { DomainError } from '@pos/domain';
import type { ChangedVersions } from '@pos/events';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { TenantLevelRepository } from '../../db/tenant-level-repository.js';
import type { TenantContext } from '../../db/tenant-scoped-repository.js';
import type { Clock } from '../../lib/clock.js';
import { inTransaction, withIdempotency, type IdempotentResult } from '../../lib/idempotency.js';
import type { IdGen } from '../../lib/ids.js';
import type { CloudTestHooks } from '../../server.js';
import { bumpDirectoryVersion, lockTenant, selectOwner, selectStaff } from './repository.js';
import { staffVersion, toStaffWire } from './versions.js';

export interface StaffRolesDeps {
  pool: pg.Pool;
  clock: Clock;
  ids: IdGen;
  log?: FastifyBaseLogger;
  testHooks?: CloudTestHooks;
}

export interface OwnerRequest {
  tenant: TenantContext;
  ownerUserId: string;
  idempotencyKey: string | undefined;
  method: string;
  path: string;
  log: Pick<FastifyBaseLogger, 'error'>;
}

export interface DirectoryWriteCtx {
  client: pg.PoolClient;
  repo: TenantLevelRepository;
  tenant: TenantContext;
  ownerUserId: string;
  ownerStaffId: string | null;
  deps: StaffRolesDeps;
  changed: ChangedVersionsCollector;
}

// 01b §6, J-5: the other records a write changed by cascade; their versions are built at the end, from the
// written state, by the one builder (B23). Roles and responsibility sets join with the tasks that change them.
export class ChangedVersionsCollector {
  private readonly staffIds = new Set<string>();

  staff(staffId: string): void {
    this.staffIds.add(staffId);
  }

  async resolve(ctx: Pick<DirectoryWriteCtx, 'repo'>, target?: { staffId?: string }): Promise<ChangedVersions> {
    const ids = [...this.staffIds].filter((id) => id !== target?.staffId).sort();
    const staff =
      ids.length === 0
        ? []
        : (await selectStaff(ctx.repo, { ids })).map((row) => ({ staff_id: row.staff_id, version: staffVersion(toStaffWire(row)) }));
    staff.sort((a, b) => (a.staff_id < b.staff_id ? -1 : a.staff_id > b.staff_id ? 1 : 0));
    return { staff, roles: [], responsibilities: [] };
  }
}

// 01b §6 directory write script: [idempotency key] → tenant row FOR NO KEY UPDATE (B11) → owner row and the
// B8 tenant-wide check → fn (targets, version check, guards, rules, write, audit) → directory_version + 1 →
// [response stored on the key] → COMMIT. `fn` returns `bump: false` for a no-op (nothing written).
export async function directoryWrite<T>(
  deps: StaffRolesDeps,
  req: OwnerRequest,
  o: { idempotent: boolean; body?: unknown },
  fn: (ctx: DirectoryWriteCtx) => Promise<{ body: T; bump: boolean }>,
): Promise<IdempotentResult<T>> {
  const run = async (client: pg.PoolClient) => {
    const repo = new TenantLevelRepository(req.tenant, client);
    await lockTenant(repo);
    const owner = await selectOwner(repo, req.ownerUserId);
    if (owner === undefined || !owner.covers_every_branch) {
      throw new DomainError('PERMISSION_DENIED', { reason: 'tenant_wide_write' });
    }
    const out = await fn({
      client,
      repo,
      tenant: req.tenant,
      ownerUserId: req.ownerUserId,
      ownerStaffId: owner.staff_id,
      deps,
      changed: new ChangedVersionsCollector(),
    });
    if (out.bump) await bumpDirectoryVersion(repo);
    return { status: 200, body: out.body };
  };
  if (o.idempotent) {
    return withIdempotency(
      {
        pool: deps.pool,
        clock: deps.clock,
        tenant: req.tenant,
        log: req.log,
        ...(deps.testHooks !== undefined ? { testHooks: deps.testHooks } : {}),
      },
      { key: req.idempotencyKey, method: req.method, path: req.path, body: o.body },
      run,
    );
  }
  const out = await inTransaction(deps.pool, run);
  return { ...out, replay: false };
}
