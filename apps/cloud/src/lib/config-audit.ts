import type { Clock } from './clock.js';
import type { TenantSql } from './config-version.js';
import type { IdGen } from './ids.js';

export type AuditEntity =
  | 'floor'
  | 'table'
  | 'station'
  | 'batch_program'
  | 'tax_class'
  | 'category'
  | 'menu_item'
  | 'item_route'
  | 'branch_settings'
  | 'staff' // 01b B21
  | 'role' // 01b B21
  | 'responsibility' // 01b B21
  | 'branch' // 01b §6.9
  | 'owner_user'
  | 'variant_group' // 01c §5.1
  | 'stock_item'
  | 'stock_item_branch'
  | 'modifier_group'
  | 'deal'
  | 'deal_branch';
export type AuditAction =
  | 'create'
  | 'update'
  | 'archive'
  | 'restore'
  | 'route_set'
  | 'route_removed'
  | 'pin_set' // 01b B21
  | 'left' // 01b B21
  | 'returned' // 01b B21
  | 'reports_to_reassigned' // 01b B15
  | 'password_change' // 01b B21
  | 'password_reset' // 01b B21, §6.14
  | 'branch_set' // 01c §5.1
  | 'branch_removed';

export interface AuditEntry {
  actor: { kind: 'owner'; ownerUserId: string } | { kind: 'cli' };
  entity: AuditEntity;
  entityId: string;
  branchId: string | null;
  action: AuditAction;
  before: object | null;
  after: object | null;
}

// S26: one insert-only row per config write, in the write's transaction, before bumpConfigVersion.
export async function writeConfigAudit(db: TenantSql, entry: AuditEntry, deps: { clock: Clock; ids: IdGen }): Promise<void> {
  const written = await db.query(
    `INSERT INTO config_audit
       (tenant_id, audit_id, actor_kind, actor_owner_user_id, branch_id, entity, entity_id, action, before, after, at)
     SELECT tenant_id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11 FROM tenants WHERE tenant_id = $1
     RETURNING audit_id`,
    [
      deps.ids.next(),
      entry.actor.kind,
      entry.actor.kind === 'owner' ? entry.actor.ownerUserId : null,
      entry.branchId,
      entry.entity,
      entry.entityId,
      entry.action,
      entry.before === null ? null : JSON.stringify(entry.before),
      entry.after === null ? null : JSON.stringify(entry.after),
      deps.clock.branchNow(),
    ],
  );
  if (written.length !== 1) throw new Error('config audit row not written');
}

export function auditActionFor(
  before: { archived_at: number | null },
  after: { archived_at: number | null },
): 'update' | 'archive' | 'restore' {
  if (before.archived_at === null && after.archived_at !== null) return 'archive';
  if (before.archived_at !== null && after.archived_at === null) return 'restore';
  return 'update';
}
