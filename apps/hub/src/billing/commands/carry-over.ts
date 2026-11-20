// 05 §6.24 `CarryOverOrders` (task 25; B25, §3.13, H1-9, H6-10). The listed orders survive this day's close only
// (02b's fold skips a carried order at BusinessDayClosed, row Q-5; the day-close guard skips orders carried for the
// open day, `carried_orders`). A carried bill may already have payments (owner R4): the X / Z show them as carried
// forward, the next day's as brought forward (§6.26).
// Order (00 §3.7 pipeline, then the handler): Zod `.strict()` (400; `order_ids` 1..40, a repeated id is a 400 at its
// index) → the grant on `close-business-day` (403, the pipeline) → state: the open day (`409 BUSINESS_DAY_NOT_OPEN`),
// each order known and not cancelled (`400 VALIDATION_FAILED` at `order_ids.<i>`) and not billed (`409 ORDER_BILLED
// { order_id }`), in list order → scope (C8, last: the permission takes `branch` only, 01b) → `OrdersCarriedOver`.
// Statements (00 envelope excluded), fixed: the orders read (1), the note into `bill_texts` (1, with a note) — 2.
// Privacy: `note` is free text → `hashOmit` (row H-4); its text only in `bill_texts` under `note_id` (H3-5).
// A retransmit with the same command_id replays the stored answer (00 §3.7).
import { CARRY_OVER_REASONS, DomainError } from '@pos/domain';
import { draftOf, OrdersCarriedOver, OrdersCarriedOverPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';

/** §6.24 `{ order_ids: string[1..40], reason_code ∈ CARRY_OVER_REASONS, note? }`; §4.4 `note` ≤ 200. */
export const CarryOverOrdersPayload = z
  .object({
    order_ids: z.array(z.string().min(1).max(64)).min(1).max(40),
    reason_code: z.enum(CARRY_OVER_REASONS),
    note: z.string().max(200).optional(),
  })
  .strict()
  .superRefine((p, rc) => {
    p.order_ids.forEach((id, i) => {
      if (p.order_ids.indexOf(id) !== i) rc.addIssue({ code: z.ZodIssueCode.custom, path: ['order_ids', i], message: 'repeated order id' });
    });
  });
export type CarryOverOrdersPayload = z.infer<typeof CarryOverOrdersPayload>;

export interface CarryOverOrdersResult {
  business_date: string;
  order_ids: string[];
}

// Every listed id with its order's billed / cancelled columns (NULL row fields = unknown id), list order. 1 statement.
const READ = `SELECT j.key AS i, j.value AS order_id, o.order_id IS NOT NULL AS known, o.billed_at, o.cancelled_at
  FROM json_each(?) j LEFT JOIN orders o ON o.order_id = j.value
  ORDER BY j.key`;

interface Row {
  i: number;
  order_id: string;
  known: number;
  billed_at: number | null;
  cancelled_at: number | null;
}

/** C8, last: `close-business-day` takes `branch` only (01b PERMISSION_SCOPES); no scope resolved counts as `branch`. */
function requireScope(ctx: CommandCtx): void {
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : 'branch';
  if (scope !== 'branch') throw new DomainError('PERMISSION_DENIED', { permission: 'close-business-day', reason: 'outside_scope', required_scope: 'branch' });
}

export function registerCarryOverOrders(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'CarryOverOrders',
      payloadSchema: CarryOverOrdersPayload,
      // offered wherever the day is closed (01a §6.18b `CloseBusinessDay` is `'both'`, row A-5 / H-1)
      sessionKind: 'both',
      permission: 'close-business-day',
      hashOmit: ['note'], // row H-4: the note never reaches payload_hash
      handle(ctx, p) {
        const day = ctx.state.business_day;
        if (day === null || day.closed_at !== null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');

        const rows = ctx.tx.db.prepare(READ).all(JSON.stringify(p.order_ids)) as Row[]; // 1
        for (const r of rows) {
          if (r.known !== 1) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: `order_ids.${r.i}`, message: 'order not found' }] });
          if (r.cancelled_at !== null) throw new DomainError('VALIDATION_FAILED', { issues: [{ path: `order_ids.${r.i}`, message: 'order cancelled' }] });
          if (r.billed_at !== null) throw new DomainError('ORDER_BILLED', { order_id: r.order_id });
        }

        requireScope(ctx); // the last refusal (C8)

        const text = p.note === undefined || p.note.trim() === '' ? null : p.note;
        const note_id = text === null ? null : ctx.ids.next();
        if (note_id !== null) ctx.tx.db.prepare(`INSERT INTO bill_texts (subject_id, field, text) VALUES (?, 'note', ?)`).run(note_id, text); // 2

        const payload = OrdersCarriedOverPayload.parse({
          order_ids: p.order_ids,
          business_date: day.business_date,
          reason_code: p.reason_code,
          has_note: note_id !== null,
          note_id,
        });
        const event = draftOf(OrdersCarriedOver, {
          stream_type: 'hub',
          stream_id: ctx.branch.branchId,
          payload,
          occurred_at: ctx.clock.branchNow(),
          actor_id: ctx.actor.staffId,
          device_id: ctx.actor.deviceId,
        });
        const result: CarryOverOrdersResult = { business_date: day.business_date, order_ids: [...p.order_ids] };
        return { events: [event], result };
      },
    }),
  );
}
