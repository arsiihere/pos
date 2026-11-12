import { AUDIT_ACTIONS, DomainError, type AuditMethod } from '@pos/domain';
import type { BranchConfig } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry, type QueryCtx } from '../queries/registry.js';

// 04 §6.5 `GET /queries/audit-log` and §6.5b `GET /queries/audit-staff` over the `audit` projection (a2) and
// `staff_names` (00 row H-1, upserted by every directory apply). Both need `view-audit-log` (scope `branch`), checked in
// the handler with ctx.directory.resolve (queries carry no permission field). Names are joined at read (OQ-E): a leaver
// keeps the last name a directory apply saw.
//
// audit-log, 1 statement: a plain UNION ALL of index-ordered branches with ONE outer ORDER BY recorded_at DESC, seq DESC
// LIMIT :limit + 1. Every branch's WHERE carries the range, its staff / action predicate and the row-value cursor
// predicate (recorded_at, seq) < (:r, :s), so SQLite plans MERGE (UNION ALL) over the ordered index scans and stops at
// the limit: no temp sort in any shape (test 52, EXPLAIN QUERY PLAN). Branches: one without filters
// (audit_entries_time); one per action (audit_entries_action); with staff_id an actor branch (audit_entries_actor) and an
// approver branch (audit_entries_appr, `actor_staff_id IS NOT approver_staff_id`, so a row whose actor is its approver
// is listed once and the cursor key stays unique); staff_id and k actions → 2k branches.

const DAY_MS = 86_400_000;
export const AUDIT_LOG_MAX_RANGE_MS = 31 * DAY_MS;

const issue = (path: string, message: string) => ({ path: [path], message });

/** §6.5 query string. `action` is a comma list ⊆ AUDIT_ACTIONS without repeats (C6 style). */
export const AuditLogQuery = z
  .object({
    // digits only: an empty or signed value is a 400, never coerced to 0
    from: z.string().regex(/^\d+$/).transform(Number),
    to: z.string().regex(/^\d+$/).transform(Number),
    staff_id: z.string().min(1).optional(),
    action: z.string().min(1).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().optional(),
  })
  .superRefine((q, rc) => {
    if (q.from >= q.to) rc.addIssue({ code: 'custom', ...issue('to', 'to must be after from') });
    else if (q.to - q.from > AUDIT_LOG_MAX_RANGE_MS) rc.addIssue({ code: 'custom', ...issue('to', 'range is at most 31 days') });
    if (q.action === undefined) return;
    const list = q.action.split(',');
    const known: readonly string[] = AUDIT_ACTIONS;
    list.forEach((a) => {
      if (!known.includes(a)) rc.addIssue({ code: 'custom', ...issue('action', `unknown action ${a.slice(0, 40)}`) });
    });
    if (new Set(list).size !== list.length) rc.addIssue({ code: 'custom', ...issue('action', 'action repeated') });
  });
type AuditLogQuery = z.infer<typeof AuditLogQuery>;

/** The statement's shape: which branches it unions. */
export interface AuditLogShape {
  staff: boolean;
  actions: number;
}

const COLUMNS = `e.seq, e.event_id, e.recorded_at, e.action, e.actor_staff_id, e.approver_staff_id, e.method, e.device_id,
  e.subject_type, e.subject_id, e.order_id, e.table_code, e.table_id, e.reason, e.outcome, e.amount_minor, e.detail_json,
  an.display_name AS actor_name, pn.display_name AS approver_name`;
const NAMES = `LEFT JOIN staff_names an ON an.staff_id = e.actor_staff_id
  LEFT JOIN staff_names pn ON pn.staff_id = e.approver_staff_id`;
// The upper end is the row-value cursor; with no cursor it is (to, 0), which equals recorded_at < to because event seq starts at 1.
const RANGE = `e.recorded_at >= @from AND (e.recorded_at, e.seq) < (@r, @s)`;

/** §6.5: the one statement for a shape (exported for test 52's EXPLAIN QUERY PLAN). */
export function auditLogSql(shape: AuditLogShape): string {
  const actionTerms = shape.actions === 0 ? [null] : Array.from({ length: shape.actions }, (_, i) => `e.action = @a${i}`);
  const branch = (who: string | null, action: string | null) =>
    `SELECT ${COLUMNS} FROM audit_entries e ${NAMES} WHERE ${[who, action, RANGE].filter((t) => t !== null).join(' AND ')}`;
  const branches: string[] = [];
  for (const action of actionTerms) {
    if (!shape.staff) branches.push(branch(null, action));
    else {
      branches.push(branch('e.actor_staff_id = @staff', action));
      branches.push(branch('e.approver_staff_id = @staff AND e.actor_staff_id IS NOT e.approver_staff_id', action));
    }
  }
  return `${branches.join('\nUNION ALL\n')}\nORDER BY recorded_at DESC, seq DESC LIMIT @limit`;
}

// ------------------------------------------------------------------------------------------- cursor (G-5)

/** Copied from 01d alerts-inbox (G-5): base64url JSON, Zod-checked; the last row's (recorded_at, seq). */
const CursorSchema = z.object({ r: z.number().int(), s: z.number().int() }).strict();

function encodeCursor(row: { recorded_at: number; seq: number }): string {
  return Buffer.from(JSON.stringify({ r: row.recorded_at, s: row.seq })).toString('base64url');
}

function decodeCursor(cursor: string | null): { r: number; s: number } | null {
  if (cursor === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    parsed = null;
  }
  const result = CursorSchema.safeParse(parsed);
  if (!result.success) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'cursor', message: 'cursor is not valid' }] });
  return result.data;
}

// ------------------------------------------------------------------------------------------- handlers

function requireViewAuditLog(ctx: QueryCtx): void {
  const staffId = ctx.session?.staff_id ?? null;
  const grant = staffId === null ? 'not_granted' : ctx.directory.resolve(staffId, 'view-audit-log').grant;
  if (grant !== 'allowed') throw new DomainError('PERMISSION_DENIED', { permission: 'view-audit-log', grant });
}

interface Row {
  seq: number;
  event_id: string;
  recorded_at: number;
  action: string;
  actor_staff_id: string | null;
  approver_staff_id: string | null;
  method: AuditMethod | null;
  device_id: string;
  subject_type: string;
  subject_id: string;
  order_id: string | null;
  table_code: string | null;
  table_id: string | null;
  reason: string | null;
  outcome: string | null;
  amount_minor: number | null;
  detail_json: string;
  actor_name: string | null;
  approver_name: string | null;
}

/** The table's config name; an archived table falls back to the stored table_code, then the id (comp-line `tableCode`). */
function tableName(config: BranchConfig | null, row: Row): string | null {
  if (row.table_id !== null) {
    for (const floor of config?.floors ?? []) {
      const table = floor.tables.find((t) => t.table_id === row.table_id);
      if (table !== undefined) return table.name;
    }
  }
  return row.table_code ?? row.table_id;
}

function auditLog(ctx: QueryCtx, q: AuditLogQuery): { data: unknown; meta: unknown } {
  requireViewAuditLog(ctx);
  const actions = q.action === undefined ? [] : q.action.split(',');
  const cursor = decodeCursor(ctx.page.cursor);
  const params: Record<string, string | number> = {
    from: q.from,
    // The row-value cursor is the range's upper end in every branch (index range, §6.5). No cursor, or one past `to`:
    // (to, 0), which equals recorded_at < to because event seq starts at 1.
    ...(cursor !== null && cursor.r < q.to ? { r: cursor.r, s: cursor.s } : { r: q.to, s: 0 }),
    limit: ctx.page.limit + 1,
  };
  if (q.staff_id !== undefined) params.staff = q.staff_id;
  actions.forEach((a, i) => (params[`a${i}`] = a));
  const rows = ctx.db.prepare(auditLogSql({ staff: q.staff_id !== undefined, actions: actions.length })).all(params) as Row[];
  const more = rows.length > ctx.page.limit;
  const page = more ? rows.slice(0, ctx.page.limit) : rows;
  // §6.5 AuditEntryView: the row as stored (detail_json included) plus actor_name, approver_name, table_name.
  const entries = page.map((row) => ({ ...row, table_name: tableName(ctx.branchConfig, row) }));
  const last = page[page.length - 1];
  return { data: { entries }, meta: { next_cursor: more && last !== undefined ? encodeCursor(last) : null } };
}

/** §6.5b: everyone in staff_names (leavers included), 1 statement; `in_directory` from the directory in memory. */
function auditStaff(ctx: QueryCtx): { data: unknown } {
  requireViewAuditLog(ctx);
  const rows = ctx.db.prepare('SELECT staff_id, display_name FROM staff_names ORDER BY display_name').all() as Array<{ staff_id: string; display_name: string }>;
  return {
    data: {
      staff: rows.map((r) => ({ ...r, in_directory: ctx.directory.get(r.staff_id) !== undefined || ctx.directory.isNoPin(r.staff_id) })),
    },
  };
}

/** §6.6: called by audit/lanes/A1.ts register(). */
export function registerAuditQueries(app: FastifyInstance): void {
  const registry = queryRegistry(app);
  registry.register(
    defineQuery({
      resource: 'audit-log',
      sessionKind: 'device',
      session: 'required',
      querySchema: AuditLogQuery,
      handle: (ctx, q) => auditLog(ctx, q),
    }),
  );
  registry.register(
    defineQuery({
      resource: 'audit-staff',
      sessionKind: 'device',
      session: 'required',
      querySchema: z.object({}),
      handle: (ctx) => auditStaff(ctx),
    }),
  );
}
