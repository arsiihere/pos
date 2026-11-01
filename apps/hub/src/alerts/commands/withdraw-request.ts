import { DomainError } from '@pos/domain';
import { WithdrawRequestPayload, type EventDraft, type RequestWithdrawnPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { readOnlyTx } from '../../engine-host/read-only-tx.js';
import { checkAlertIds, pendingRequest, readAlert, recordOf, requestKindOf } from './request-row.js';

// 01d §6.3 `WithdrawRequest`, §3.3 "Withdraw", §3.5 read-only contract (`onWithdraw`).
// Processing: alert → 404; open → else 409; session staff = requester → else 403 not_requester (a deduped
// raiser who is not the requester included, §4.2); `RequestWithdrawn` on the request's subject, then the
// kind's optional `onWithdraw` on a read-only view, every draft checked for this alert's id (else 500).
// Statements: 1 (the alert row) plus the kind's `onWithdraw` reads. No `preRead`: no PIN, so nothing runs
// before the writer that the authoritative check in `handle` does not already cover.
// No `request_result`: the requester is the one who withdrew (§3.10 raises it on answer / close).
// `alert_closed` to every recipient of every step is sent after commit by ws-frames.ts (task 20), not here.

type Payload = WithdrawRequestPayload;

function handle(ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: { alert_id: string } } {
  // 00 v1.6 §3.7 H-3: the pipeline's `authorize` has refused a station session or one without staff
  const staffId = ctx.actor.staffId;
  if (ctx.actor.kind === 'station') throw new DomainError('PERMISSION_DENIED', { session_kind: 'station' });
  if (staffId === null) throw new DomainError('PERMISSION_DENIED', { grant: 'not_granted' });
  const { row, part } = pendingRequest(readAlert(ctx.tx.db, payload.alert_id), payload.alert_id, ctx.directory);
  if (row.requester_staff_id !== staffId) throw new DomainError('PERMISSION_DENIED', { reason: 'not_requester' });
  const { request } = requestKindOf(row, 'WithdrawRequest');
  const record = recordOf(row, part);
  const withdrawn: RequestWithdrawnPayload = { alert_id: row.alert_id, by_staff_id: staffId };
  const events: EventDraft[] = [
    {
      stream_type: row.subject_stream_type,
      stream_id: row.subject_stream_id,
      event_type: 'RequestWithdrawn',
      schema_version: 1,
      payload: withdrawn,
      occurred_at: ctx.clock.branchNow(),
      actor_id: staffId,
      device_id: ctx.actor.deviceId,
    },
  ];
  if (request.onWithdraw !== undefined) {
    // a DomainError from the kind reaches the requester and nothing is written (§6.3 Errors)
    const drafts = request.onWithdraw({ ...ctx, tx: readOnlyTx(ctx.tx), alert: record });
    events.push(...checkAlertIds('WithdrawRequest', 'onWithdraw', record, drafts));
  }
  return { events, result: { alert_id: row.alert_id } };
}

export function registerWithdrawRequest(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'WithdrawRequest',
      payloadSchema: WithdrawRequestPayload,
      sessionKind: 'device',
      permission: 'checked-in-handler',
      handle: (ctx, payload) => handle(ctx, payload),
    }),
  );
}
