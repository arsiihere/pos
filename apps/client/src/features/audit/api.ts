import { AUDIT_ACTIONS, type AuditEntry } from '@pos/domain';
import type { HubResult } from '../../api/hub-admin';

// 04 v1.0.4 §6.5 `GET /queries/audit-log` and §6.5b `GET /queries/audit-staff` (VU2): the shapes, the query string and
// the whole-body checks. The requests themselves are the staff api's `auditLog` / `auditStaff` (features/staff/api.ts,
// as `inbox()`), so they go through the shell's fetch and session handling; the screen reads them from `shell.api`.

/** §6.5 AuditEntryView: the stored row (`detail` as the `detail_json` text) plus the names joined at read. */
export type AuditEntryView = Omit<AuditEntry, 'detail'> & {
  detail_json: string;
  actor_name: string | null;
  approver_name: string | null;
  table_name: string | null;
};

/** §6.5b row. */
export interface AuditStaffRow {
  staff_id: string;
  display_name: string;
  in_directory: boolean;
}

/** The query: `[from, to)` Unix ms (whole hub days, ≤ 31 days), staff as actor or approver, actions ⊆ AUDIT_ACTIONS. */
export interface AuditQuery {
  from: number;
  to: number;
  staff_id: string | null;
  /** empty = every action (no `action` parameter) */
  actions: readonly string[];
}

export interface AuditPage {
  entries: AuditEntryView[];
  next_cursor: string | null;
}

/** What the audit screen and its export need from the staff api (`StaffApi` has both). */
export interface AuditApi {
  auditLog(q: AuditQuery, cursor: string | null, limit?: number): Promise<HubResult<AuditPage>>;
  auditStaff(): Promise<HubResult<AuditStaffRow[]>>;
}

/** The query string of §6.5 (the hub's Zod: digits only, a de-duplicated comma list). */
export function auditLogPath(q: AuditQuery, cursor: string | null, limit?: number): string {
  const params = new URLSearchParams({ from: String(q.from), to: String(q.to) });
  if (q.staff_id !== null) params.set('staff_id', q.staff_id);
  const known: readonly string[] = AUDIT_ACTIONS;
  const actions = [...new Set(q.actions)].filter((a) => known.includes(a));
  if (actions.length > 0) params.set('action', actions.join(','));
  if (cursor !== null) params.set('cursor', cursor);
  if (limit !== undefined) params.set('limit', String(limit));
  return `/queries/audit-log?${params.toString()}`;
}

type Check<T> = { safeParse(v: unknown): { success: true; data: T } | { success: false } };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrOrNull = (v: unknown) => v === null || typeof v === 'string';
const isNumOrNull = (v: unknown) => v === null || typeof v === 'number';

function isEntry(v: unknown): v is AuditEntryView {
  return (
    isObj(v) &&
    typeof v['seq'] === 'number' &&
    typeof v['recorded_at'] === 'number' &&
    typeof v['action'] === 'string' &&
    typeof v['detail_json'] === 'string' &&
    ['actor_staff_id', 'approver_staff_id', 'actor_name', 'approver_name', 'table_code', 'table_name', 'reason', 'outcome', 'method'].every((k) => isStrOrNull(v[k])) &&
    isNumOrNull(v['amount_minor'])
  );
}

/** §6.5 reply, the whole body: `{ data: { entries }, meta: { next_cursor } }`. */
export const AuditLogResponse: Check<{ data: { entries: AuditEntryView[] }; meta: { next_cursor: string | null } }> = {
  safeParse(v) {
    const data = isObj(v) ? v['data'] : null;
    const meta = isObj(v) ? v['meta'] : null;
    const entries = isObj(data) ? data['entries'] : null;
    const next = isObj(meta) ? meta['next_cursor'] : undefined;
    if (!Array.isArray(entries) || !entries.every(isEntry) || !isStrOrNull(next)) return { success: false };
    return { success: true, data: { data: { entries }, meta: { next_cursor: next as string | null } } };
  },
};

/** §6.5b reply, the whole body: `{ data: { staff } }`. */
export const AuditStaffResponse: Check<{ data: { staff: AuditStaffRow[] } }> = {
  safeParse(v) {
    const data = isObj(v) ? v['data'] : null;
    const staff = isObj(data) ? data['staff'] : null;
    const ok =
      Array.isArray(staff) && staff.every((s) => isObj(s) && typeof s['staff_id'] === 'string' && typeof s['display_name'] === 'string' && typeof s['in_directory'] === 'boolean');
    return ok ? { success: true, data: { data: { staff: staff as AuditStaffRow[] } } } : { success: false };
  },
};
