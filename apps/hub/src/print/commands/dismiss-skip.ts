import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts } from '../../alerts/raise.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';

// ⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-14) 03c §6.12, §3.7, §3.10: DismissPrintSkip { alert_id }. A staff session
// holding `force-release-table-lock` at `branch` scope (01d's `managers` set: exactly who receives `printer_problem`)
// closes one `printer_problem { problem: 'ticket_not_built' }` alert, which nothing else closes (C3-3). Not queueable.
// - Any other alert, or a printer_problem of another problem → 404 ALERT_NOT_FOUND (a dismiss never closes another
//   problem); a closed one → 409 ALERT_ALREADY_CLOSED { alert_id, reason }.
// - Else alerts.close(ctx, alert_id, 'done') (01d's owner close: AlertClosed { reason: 'done' } with the staff actor) and
//   the alert's print_fold_skips row is marked resolved.
// Statements 2 + 01d's close: the alert read, the skip update.

const Payload = z.object({ alert_id: z.string().min(1) });

const SKIP_KEY = 'printer_problem:ticket_not_built:';

interface AlertRow {
  kind: string;
  state: 'open' | 'closed';
  close_reason: string | null;
  dedupe_key: string;
  problem: unknown;
}

export const dismissPrintSkipCommand = defineCommand({
  commandType: 'DismissPrintSkip',
  payloadSchema: Payload,
  sessionKind: 'device',
  permission: 'force-release-table-lock',
  handle(ctx, payload) {
    // §3.10: `branch` scope, as 01d's managers() (a my_floors holder is not a manager).
    const grant = ctx.permission;
    if (grant === null || grant.grant !== 'allowed' || grant.scope !== 'branch') {
      throw new DomainError('PERMISSION_DENIED', { permission: 'force-release-table-lock', reason: 'outside_scope' });
    }
    const db = ctx.tx.db;
    const alert = db
      .prepare(`SELECT kind, state, close_reason, dedupe_key, json_extract(details_json, '$.problem') AS problem FROM alerts WHERE alert_id = ?`)
      .get(payload.alert_id) as AlertRow | undefined;
    if (alert === undefined || alert.kind !== 'printer_problem' || alert.problem !== 'ticket_not_built' || !alert.dedupe_key.startsWith(SKIP_KEY)) {
      throw new DomainError('ALERT_NOT_FOUND', { alert_id: payload.alert_id });
    }
    if (alert.state !== 'open') throw new DomainError('ALERT_ALREADY_CLOSED', { alert_id: payload.alert_id, reason: alert.close_reason });
    const events = alerts.close(ctx, payload.alert_id, 'done');
    // "resolved" = alerted (print/retention.ts step 3, the worker raises only for alerted_at IS NULL): the row keeps
    // its alert time, so the worker never raises it again and print-config lists it until retention.
    db.prepare('UPDATE print_fold_skips SET alerted_at = COALESCE(alerted_at, ?) WHERE event_id = ?').run(
      ctx.clock.branchNow(),
      alert.dedupe_key.slice(SKIP_KEY.length),
    );
    return { events, result: { dismissed: true } };
  },
});

export function registerDismissPrintSkip(app: FastifyInstance): void {
  commandRegistry(app).register(dismissPrintSkipCommand);
}
