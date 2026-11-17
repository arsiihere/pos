import { DomainError, orderLineTotalMinor } from '@pos/domain';
import type { EventDraft, ItemAddedPayload, LineWeightSetPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { hasUnitOutOfBilling } from '../ledger.js';
import { requireNoVoidPending } from '../line-guard.js';

// 02b §6.3 SetLineWeight, §3.6 (pending, correction, total from the ItemAdded copy, 01c M7), §3.4 Weights
// (LINE_ALREADY_SETTLED; the LineWeightSet fold sets refundable_minor), §3.14 (scope `branch`). Not queueable (§3.12).
// Order of checks: payload (Zod: S59 steps of 50, 50–50 000) → line (404) → billed → weighed (not a return line, owner
// S-1) → settled → line guard with the line itself (⚠️ 04 row Q-3: 409 VOID_PENDING) → scope last (C8). An unknown
// line → 404 ORDER_NOT_FOUND { order_item_id } (owner S-2).
// Statements: 1 (the line, its order and its ItemAdded copy), +1 line guard when registered (04 Q-3, G-23); the append
// excluded.

export const SetLineWeightPayload = z.object({
  order_item_id: z.string().min(1),
  quantity: z.number().int().min(50).max(50_000).multipleOf(50),
});
type Payload = z.infer<typeof SetLineWeightPayload>;

interface Row {
  order_id: string;
  billed_at: number | null;
  comped_units: number;
  removed_units: number;
  voided_units: number;
  /** the line's ItemAdded payload (JSON), the copy priced at submit (D25) */
  added: string | null;
}

// One statement: the line, its order's billed_at and its ItemAdded copy (stream order:<order_id>, events_stream index).
const READ = `SELECT l.order_id, o.billed_at, l.comped_units, l.removed_units, l.voided_units,
       (SELECT e.payload FROM events e
         WHERE e.stream_type = 'order' AND e.stream_id = l.order_id AND e.event_type = 'ItemAdded'
           AND json_extract(e.payload, '$.order_item_id') = l.order_item_id
         ORDER BY e.seq LIMIT 1) AS added
  FROM order_lines l
  JOIN orders o ON o.order_id = l.order_id
 WHERE l.order_item_id = ?`;

type Copy = Pick<ItemAddedPayload, 'line_kind' | 'requires_weighing' | 'price_minor' | 'sale_unit' | 'options' | 'return_of'>;

function setLineWeight(ctx: CommandCtx, p: Payload): { events: EventDraft[]; result: unknown } {
  const row = ctx.tx.db.prepare(READ).get(p.order_item_id) as Row | undefined;
  if (row === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_item_id: p.order_item_id });
  if (row.billed_at !== null) throw new DomainError('ORDER_BILLED', { order_id: row.order_id });
  const copy = row.added === null ? null : (JSON.parse(row.added) as Copy);
  // §3.6: a weighed line is an item line with requires_weighing (01c V18: never a deal part, never a linked option).
  if (copy === null || copy.line_kind !== 'item' || !copy.requires_weighing) throw new DomainError('LINE_NOT_WEIGHED', { order_item_id: p.order_item_id });
  // Owner 2026-11-11 S-1 (a): a return line (§3.8, AD-15 return_of) carries no money (§3.4) → never weighed.
  if (copy.return_of !== undefined) throw new DomainError('LINE_NOT_WEIGHED', { order_item_id: p.order_item_id });
  // §3.4 Weights / §3.6: a correction is refused once any unit left billing (comped, removed or voided).
  if (hasUnitOutOfBilling(row)) throw new DomainError('LINE_ALREADY_SETTLED', { order_item_id: p.order_item_id });
  // §3.4 line guard (⚠️ 04 row Q-3): the line itself, after LINE_ALREADY_SETTLED, before scope.
  requireNoVoidPending(ctx.tx.db, row.order_id, [p.order_item_id]);

  checkScope(ctx, row.order_id);

  // 01c M7: orderLineTotalMinor over the ItemAdded copy (its price_minor and options as copied), never re-priced.
  const line_total_minor = orderLineTotalMinor({
    line_kind: 'item',
    price_minor: copy.price_minor,
    quantity: p.quantity,
    sale_unit: copy.sale_unit,
    option_charges_minor: copy.options.map((o) => o.charge_minor),
  }) as number;
  const payload: LineWeightSetPayload = { order_item_id: p.order_item_id, quantity: p.quantity, line_total_minor };
  const event: EventDraft = {
    stream_type: 'order',
    stream_id: row.order_id,
    event_type: 'LineWeightSet',
    schema_version: 1,
    payload,
    occurred_at: ctx.clock.branchNow(),
    actor_id: ctx.actor.staffId,
    device_id: ctx.actor.deviceId,
  };
  return { events: [event], result: { line_total_minor } };
}

/** §3.14 SetLineWeight scope `branch` (C8, last), 0 statements. */
function checkScope(ctx: CommandCtx, order_id: string): void {
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : null;
  if (ctx.actor.staffId === null || scope !== 'branch') throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', order_id });
}

export const setLineWeightCommand = defineCommand({
  commandType: 'SetLineWeight',
  payloadSchema: SetLineWeightPayload,
  sessionKind: 'device',
  permission: 'set-line-weight',
  handle: (ctx, payload) => setLineWeight(ctx, payload),
});

export function registerSetLineWeight(app: FastifyInstance): void {
  commandRegistry(app).register(setLineWeightCommand);
}
