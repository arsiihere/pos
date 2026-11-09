import { DomainError } from '@pos/domain';
import type { AlertDisplay, EventDraft } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts } from '../../alerts/index.js';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { callWaiterKind } from '../call-waiter-kind.js';
import { checkTakeOrderScope, currentSeating } from './bill-clean.js';

// 02a §3.13, §6.14 CallWaiter: kind `call_waiter` to `W ∪ {holder}` minus the caller (skip_requester, D-3).
// Not queueable (§8 Offline, P-1f): the route ignores X-Queued-At (ctx.queuedAt null). No lock (D39).

export const CallWaiterPayload = z.object({
  table_id: z.string().min(1),
  seating_id: z.string().min(1),
  chip: z.enum(['water', 'clear', 'come', 'other']).optional(),
});
type CallWaiterPayload = z.infer<typeof CallWaiterPayload>;

type CallWaiterResult = { alert_id: string; repeated: true } | { alert_id: string; repeated: false; recipients: number };

/** §3.12 lock-safe label: the primary table's config name; its id when archived (absent from the config, §3.14). */
function tableCode(table_id: string): string {
  for (const floor of branchConfig()?.floors ?? []) {
    const table = floor.tables.find((t) => t.table_id === table_id);
    if (table !== undefined) return table.name;
  }
  return table_id;
}

// §6 Common rules: seating checks; NEEDS_CLEANING → 409 (§9); scope last (C8); then the raise.
function callWaiter(ctx: CommandCtx, payload: CallWaiterPayload): { events: EventDraft[]; result: CallWaiterResult } {
  const seating = currentSeating(ctx, payload);
  if (seating.state === 'NEEDS_CLEANING') throw new DomainError('TABLE_NEEDS_CLEANING', { table_id: payload.table_id });
  checkTakeOrderScope(ctx, payload.table_id, seating.holder_staff_id);

  const display: AlertDisplay = { kind_label_key: callWaiterKind.labels.lock, table_code: tableCode(seating.primary_table_id) };
  const raised = alerts.raise(ctx, {
    kind: callWaiterKind.kind,
    subject: { stream_type: 'table', stream_id: seating.primary_table_id },
    target: { kind: 'table_team', table_id: payload.table_id, depth: 'direct' },
    values: {
      table_id: payload.table_id,
      seating_id: seating.seating_id,
      ...(payload.chip === undefined ? {} : { chip: payload.chip }),
    },
    display,
    dedupe_key: `call_waiter:${seating.seating_id}`,
    requester_staff_id: ctx.actor.staffId,
  });
  if (raised.deduped) return { events: [], result: { alert_id: raised.alert_id, repeated: true } };
  // §3.13: n = the step-0 recipients of the AttemptSent draft raise returns (0 → "Nobody else is working")
  const sent = raised.events.find((e) => e.event_type === 'AttemptSent');
  const recipients = (sent?.payload as { recipients?: unknown[] } | undefined)?.recipients?.length ?? 0;
  return { events: raised.events, result: { alert_id: raised.alert_id, repeated: false, recipients } };
}

export const callWaiterCommand = defineCommand({
  commandType: 'CallWaiter',
  payloadSchema: CallWaiterPayload,
  sessionKind: 'device',
  permission: 'take-order',
  handle: (ctx, payload) => callWaiter(ctx, payload),
});

export function registerCallWaiter(app: FastifyInstance): void {
  commandRegistry(app).register(callWaiterCommand);
}
