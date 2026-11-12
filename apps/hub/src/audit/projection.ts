import { auditEventTypes, sealAuditActions, toAuditEntry, type AuditLookups, type AuditRequestRef } from '@pos/domain';
import type { PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import type { Projection } from '../projections/registry.js';

// 04 §5, §3.6: projection `audit`, events only. It reads and writes its own three tables and nothing else (test 54), so
// its registration order does not matter, and a rebuild from seq 0 equals live, row for row (tests 48, 55). Lookups are
// folded here: audit_requests from AlertRaised (request ≠ null) + RequestAnswered (answerer), audit_orders from
// OrderPlaced. Names are never stored (joined from staff_names at read, §6.5).

/** The lookup folds' event types beside the mapped ones (§6.6). AlertRaised is mapped too; RequestAnswered is mapped. */
const LOOKUP_EVENT_TYPES = ['AlertRaised', 'RequestAnswered', 'OrderPlaced'] as const;

/**
 * §6.6: the `audit` projection, with `reset` (AD-2: catch-up with no checkpoint rebuilds from seq 0). Its event types
 * are copied here, so the action registry is sealed: a later `registerAuditAction` throws instead of never folding.
 */
export function auditProjection(): Projection {
  sealAuditActions();
  return {
    name: 'audit',
    eventTypes: [...new Set([...auditEventTypes(), ...LOOKUP_EVENT_TYPES])],
    apply(tx, event) {
      applyAudit(tx, event);
    },
    reset(tx) {
      tx.prepare('DELETE FROM audit_entries').run();
      tx.prepare('DELETE FROM audit_requests').run();
      tx.prepare('DELETE FROM audit_orders').run();
    },
  };
}

function str(p: Record<string, unknown>, key: string): string | null {
  const v = p[key];
  return typeof v === 'string' ? v : null;
}

function applyAudit(tx: Database.Database, event: PosEvent): void {
  const p = event.payload;
  switch (event.event_type) {
    case 'AlertRaised': {
      // §5 audit_requests: every request kind (void, comp, table requests, …), never deleted by alert retention.
      if (p['request'] == null) break;
      const display = (p['display'] ?? {}) as Record<string, unknown>;
      tx.prepare(
        `INSERT INTO audit_requests (alert_id, kind, requester_staff_id, order_id, table_code, answerer_staff_id)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      ).run(
        str(p, 'alert_id'),
        str(p, 'kind'),
        str(p, 'requester_staff_id'),
        str(p, 'subject_stream_type') === 'order' ? str(p, 'subject_stream_id') : null,
        str(display, 'table_code'),
      );
      break;
    }
    case 'RequestAnswered':
      // §3.6 (H4-2): the answerer, read by the same command's later ItemMovedToStock (no look-ahead).
      tx.prepare('UPDATE audit_requests SET answerer_staff_id = ? WHERE alert_id = ?').run(str(p, 'answerer_staff_id'), str(p, 'alert_id'));
      break;
    case 'OrderPlaced':
      // §3.6 tableOf: the table the order was placed at (a later move does not change it).
      tx.prepare('INSERT INTO audit_orders (order_id, table_id) VALUES (?, ?)').run(str(p, 'order_id'), str(p, 'table_id'));
      break;
    default:
      break;
  }
  const entry = toAuditEntry(event, lookups(tx));
  if (entry === null) return;
  tx.prepare(
    `INSERT INTO audit_entries (seq, event_id, recorded_at, action, actor_staff_id, approver_staff_id, method, device_id,
       subject_type, subject_id, order_id, table_code, table_id, reason, outcome, amount_minor, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.seq,
    entry.event_id,
    entry.recorded_at,
    entry.action,
    entry.actor_staff_id,
    entry.approver_staff_id,
    entry.method,
    entry.device_id,
    entry.subject_type,
    entry.subject_id,
    entry.order_id,
    entry.table_code,
    entry.table_id,
    entry.reason,
    entry.outcome,
    entry.amount_minor,
    JSON.stringify(entry.detail),
  );
}

/** §3.6 lookups over the fold's own tables; each is read only when the map asks (1 statement per call). */
function lookups(tx: Database.Database): AuditLookups {
  return {
    requestOf(alert_id) {
      const row = tx
        .prepare('SELECT kind, requester_staff_id, order_id, table_code, answerer_staff_id FROM audit_requests WHERE alert_id = ?')
        .get(alert_id) as AuditRequestRef | undefined;
      return row ?? null;
    },
    tableOf(order_id) {
      const row = tx.prepare('SELECT table_id FROM audit_orders WHERE order_id = ?').get(order_id) as { table_id: string | null } | undefined;
      return row?.table_id ?? null;
    },
  };
}
