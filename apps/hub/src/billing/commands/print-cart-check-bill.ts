// ⚠️ 05 v1.0.35 §6.3a `PrintCartCheckBill { draft, printer_id? }` (OR-5; hostile run 2 R2-B-1, R2-M-1 … R2-M-6, R2-m-1,
// R2-m-2, R2-m-7, R2-m-8; run 3 R3-M-1, R3-M-2, R3-M-3, R3-M-6, R3-m-2; D9), task 11a / 02b-TK CB-2: the paper check bill
// of an unsent takeaway / parking cart, or of an addition cart (a sent token plus unsent lines) as one combined paper.
// Nothing is billed or sent: one print job and one `CartCheckBillPrinted` (audited `cart_check_bill_printed`). The draft
// is priced only through 02b §4.2 `priceCartDraft`; the money is `computeBill` through the check bill's own path.
// Permission take-order (as PrintCheckBill); not queueable (X-Queued-At ignored, 00 H-1 (b)); idempotent by command_id.
import { DomainError, type ErrorCode } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import { CartCheckBillPrinted, CartCheckBillPrintedPayload, draftOf } from '@pos/events';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { hubTime } from '../../lib/hub-time.js';
import type { LineView } from '../../orders/contracts.js';
import { priceCartDraft, type CartBillLine } from '../../orders/exports.js';
import { DRAFT_MAX_BYTES, EtaDraftSchema, type EtaDraft } from '../../orders/queries/eta-preview.js';
import { billPrinterFor, printDocument } from '../../print/api.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { buildCartCheckBillDoc } from '../print/cart-docs.js';
import { billAccess } from '../queries/bill.js';
import { openBillOf, type BillHead } from './ensure-bill.js';
import { activePrinter, checkBillFrom, checkBillReads, NO_READS, type CheckBillReads } from './print-check-bill.js';

// R3-m-2: a dine-in (or unknown) order type is refused before the draft is read, at this exact path; the draft then
// takes eta-preview's schema and 8 KB bound (02b §6.14), its issues under `draft.`.
export const PrintCartCheckBillPayload = z
  .object({ draft: z.unknown(), printer_id: z.string().min(1).optional() })
  .strict()
  .transform((p, rc) => {
    const order_type = typeof p.draft === 'object' && p.draft !== null ? (p.draft as { order_type?: unknown }).order_type : undefined;
    if (order_type !== 'takeaway' && order_type !== 'parking') {
      rc.addIssue({ code: 'custom', path: ['payload', 'draft', 'order_type'], message: 'takeaway_or_parking_only' });
      return z.NEVER;
    }
    if (Buffer.byteLength(JSON.stringify(p.draft), 'utf8') > DRAFT_MAX_BYTES) {
      rc.addIssue({ code: 'custom', path: ['draft'], message: 'draft over 8 KB' });
      return z.NEVER;
    }
    const d = EtaDraftSchema.safeParse(p.draft);
    if (!d.success) {
      for (const i of d.error.issues) rc.addIssue({ code: 'custom', path: ['draft', ...i.path.map((x) => (typeof x === 'symbol' ? String(x) : x))], message: i.message });
      return z.NEVER;
    }
    return { draft: d.data, ...(p.printer_id === undefined ? {} : { printer_id: p.printer_id }) };
  });
type Payload = { draft: EtaDraft; printer_id?: string };

/** A plain cart's projected key bill (§6.3a Pricing): the order type's rules now, no discount, one open split, no payments. */
function projectedHead(order_type: 'takeaway' | 'parking', business_date: string): BillHead {
  return {
    bill_id: null,
    scope: 'key',
    seating_id: null,
    bill_key: null,
    order_type,
    state: 'projected',
    absorbed: false,
    reopen_mode: null,
    reopen_count: 0,
    opened_at: null,
    sc_bp: 0,
    sc_removed: false,
    discount: null,
    split_mode: null,
    buyer_waived: false,
    check_printed_at: null,
    prices_include_tax: null,
    rounding: null,
    discount_line_ids: [],
    seating: null,
    ref_order: null,
    business_date,
    as_of_seq: 0,
  };
}

/** §6.3a Mapping: a priced cart line as the bill line the `orders` fold would derive (exactly priceCartDraft's money). */
function cartLineView(c: CartBillLine, base_minor: number, now: number): LineView {
  return {
    order_item_id: c.order_item_id,
    order_id: 'cart',
    parent_order_item_id: c.parent_order_item_id,
    line_kind: c.line_kind,
    item_id: null,
    deal_id: null,
    name: c.name,
    sale_unit: 'piece',
    quantity: c.units,
    units: c.units,
    live_units: c.units,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: base_minor,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: base_minor,
    billed_minor: base_minor,
    part_of: c.part_of,
    return_of: null,
    served_from_zone_id: null,
    zone_served: false,
    added_at: now,
    served_at: null,
    served_source: null,
    is_food: false,
    kitchen_note: null,
    options: c.options,
    tax_profile_id: c.tax_profile_id,
    unit_price_minor: c.unit_price_minor,
  };
}

let logger: FastifyBaseLogger | null = null;

/**
 * §6.3a Script: Zod → open day (409, 0) → `priceCartDraft` (≤ 1) → the first refused line's own code with `details.key`
 * → addition only: `openBillOf` (1; the target's type, date, cancelled state and placer) → Send's guards (404 / 422) →
 * an open target's reads (`checkBillReads`, ≤ 4) → billAccess take-order on the target's placers (C8) → `computeBill`
 * (combined on an open addition; draft alone on a CLOSED target) → printer (payload id: 1, else route 1 + row 1) →
 * `printDocument` (2) → `CartCheckBillPrinted`. No bill, order or `bill_print_jobs` row.
 */
function printCartCheckBill(ctx: CommandCtx, p: Payload) {
  const db = ctx.tx.db;
  const state = ctx.state as EngineState;
  const config = branchConfig();
  if (config === null || state.business_day === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const today = state.business_day.business_date;
  const order_type = p.draft.order_type as 'takeaway' | 'parking';
  const { now_ms: now, utc_offset_ms } = hubTime(ctx.clock);

  const priced = priceCartDraft(config, p.draft, { db, state, now, utc_offset_ms }); // ≤ 1
  const refused = priced.refusals[0];
  if (refused !== undefined) throw new DomainError(refused.code as ErrorCode, { ...refused.details, key: refused.key } as never);

  let head = projectedHead(order_type, today);
  let reads: CheckBillReads = NO_READS;
  let addition = false;
  const target = p.draft.adds_to_order_id;
  if (target !== undefined && target !== null) {
    const { head: h, missing } = openBillOf(db, { order_id: target }, today); // 1
    const o = h.ref_order;
    if (missing || o === null) throw new DomainError('ORDER_NOT_FOUND', { order_id: target });
    if (o.order_type !== 'takeaway' || o.business_date !== today || o.cancelled) {
      throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'adds_to_order_id' } as never);
    }
    // R3-M-1: a paid (CLOSED) token prints the draft alone; Send would open a new bill on the same key (#44e)
    if (h.state !== 'closed') {
      reads = checkBillReads(db, h, false); // ≤ 4
      head = h;
      addition = true;
    }
    // R3-M-3: the take-order scope covers the target and the combined bill (placers already read), closed target too
    billAccess(ctx.directory, config, ctx.actor.staffId, { seating: null, scope: 'key', placed_by: [o.placed_by, ...reads.orders.map((r) => r.placed_by)] }, ['take-order']);
  }

  const extra: LineView[] = [];
  const weighed: string[] = [];
  for (const c of priced.lines) {
    if (c.base_minor === null) {
      if (c.line_kind !== 'deal_part') weighed.push(c.name);
    } else extra.push(cartLineView(c, c.base_minor, now));
  }
  const check = checkBillFrom(config, head, reads, extra); // 0

  let printer: ReturnType<typeof activePrinter>;
  if (p.printer_id !== undefined) {
    printer = activePrinter(db, p.printer_id); // 1
    if (printer === null) throw new DomainError('PRINTER_NOT_FOUND', { printer_id: p.printer_id });
  } else {
    const routed = billPrinterFor(db, { device_id: ctx.actor.deviceId }); // 1
    printer = routed === null ? null : activePrinter(db, routed); // 1
  }

  const line_count = check.line_count + weighed.length;
  const job =
    printer === null
      ? null
      : printDocument(
          ctx.tx,
          printer.printer_id,
          buildCartCheckBillDoc(
            { check, printed_at: now, weighed, addition },
            { width_cols: printer.paper_width_mm === 58 ? 32 : 48, utc_offset_ms, branch_name: ctx.config.provisioned?.branch_name ?? '' },
          ),
          { kind_label: 'Check bill (not sent)' },
        ); // 2
  const total_default_minor = check.totals_default.total_minor;
  const payload = CartCheckBillPrintedPayload.parse({ job_id: job?.job_id ?? null, printer_id: printer?.printer_id ?? null, line_count, total_default_minor, device_id: ctx.actor.deviceId });
  const env = { occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  ctx.tx.onCommit(() => logger?.info({ staff_id: ctx.actor.staffId, device_id: ctx.actor.deviceId, job_id: payload.job_id, line_count, total_default_minor }, 'billing.cart_check_bill_printed'));
  return {
    events: [draftOf(CartCheckBillPrinted, { stream_type: 'hub', stream_id: ctx.branch.branchId, payload, ...env })],
    result: { printed: job !== null, job_id: job?.job_id ?? null, printer_name: printer?.name ?? null, totals_default: check.totals_default, due_minor: check.due_minor },
  };
}

export const printCartCheckBillCommand = defineCommand({
  commandType: 'PrintCartCheckBill',
  payloadSchema: PrintCartCheckBillPayload,
  sessionKind: 'device',
  permission: 'take-order',
  handle: (ctx, payload) => printCartCheckBill(ctx, payload as Payload),
});

export function registerPrintCartCheckBill(app: FastifyInstance): void {
  logger = app.log;
  commandRegistry(app).register(printCartCheckBillCommand);
}
