import { DomainError, type Doc } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import { HUB_ENGINE_SETTING_DEFAULTS } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HubConfig } from '../../config/schema.js';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import type { WriterTx } from '../../engine-host/writer.js';
import { hubTime } from '../../lib/hub-time.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { printDocument } from '../api.js';
import { slipPrinterRow } from '../bill-routes.js';
import { clock12, dayText } from '../render/jobs.js';
import { takeawaySlipReadyAt } from '../render/ready-at.js';
import { buildTakeawaySlipDoc } from '../render/takeaway-slip.js';

// 03c v1.0.16 §3.11 (Takeaway token slip, P15), §6.14 `PrintTakeawaySlip`, §3.10 (task 31; 02b-TK R6; hostile runs 1–2).
// The token's orders, its root (first by placed_at, order_id; cancelled included), the addition rule, the duplicate
// check, the printer (`slipPrinterRow`) and the slip job (`printDocument` with `kind_label 'Token slip'` and the root's
// `order_id`). No event (owner decision D-4). The submit hook (§3.11 trigger 1, `print/slip-hook.ts`) shares the
// token rules and the build below.

export const TOKEN_SLIP_KIND_LABEL = 'Token slip';

export type SlipSkipped = 'setting_off' | 'slip_held' | 'already_printed' | 'no_printer';

/** One order of the token (`orders`, §5 of 02b), read only. */
export interface TokenOrder {
  order_id: string;
  placed_at: number;
  billed_at: number | null;
  cancelled_at: number | null;
  pickup_at_ms: number | null;
}

/** §3.11 Which orders: the root = the first by `(placed_at, order_id)`, cancelled included. */
export function rootOf(orders: readonly TokenOrder[]): TokenOrder {
  return [...orders].sort((a, b) => a.placed_at - b.placed_at || (a.order_id < b.order_id ? -1 : a.order_id > b.order_id ? 1 : 0))[0]!;
}

/** §3.11 Addition rule: an order that is not the root prints only when every other non-cancelled order is billed. */
export function slipHeld(orders: readonly TokenOrder[], order_id: string): boolean {
  if (rootOf(orders).order_id === order_id) return false;
  return orders.some((o) => o.order_id !== order_id && o.cancelled_at === null && o.billed_at === null);
}

/** §3.11 Setting: `takeaway_slip_on_send`, the one default source of 01a v2.11 TS-3. */
export function slipSettingOn(): boolean {
  return branchConfig()?.engine_settings.takeaway_slip_on_send ?? HUB_ENGINE_SETTING_DEFAULTS.takeaway_slip_on_send;
}

// §6.14 step 7 (hostile run 2 R2-m-3): a non-cancelled `document` job of the root that is a Token slip. 1 statement.
const DUPLICATE_SQL = `SELECT 1 FROM print_jobs WHERE kind = 'document' AND order_id = ? AND cancelled_at IS NULL
   AND json_extract(payload, '$.kind_label') = '${TOKEN_SLIP_KIND_LABEL}' LIMIT 1`;

export function slipAlreadyPrinted(db: Database.Database, root_order_id: string): boolean {
  return db.prepare(DUPLICATE_SQL).pluck().get(root_order_id) !== undefined;
}

/**
 * §3.11 QR: 00 HPA v1.13 `statusLink(order_id) → { path, url } | null`. Tier 1 injects a statusLink that always
 * returns null (no QR block, no scan lines; the slip still prints).
 */
export const statusLink = (order_id: string): { path: string; url: string } | null => {
  void order_id;
  return null;
};

/** §3.11 Layout inputs the caller knows: the token, its root and the Ready time (null → no Ready line). */
export interface SlipBuild {
  reprint: boolean;
  token: number;
  root: TokenOrder;
  ready_at: number | null;
}

/** §3.11: the slip `Doc` (pure, memory: hub config, hub time; `statusLink` null in Tier 1). */
export function slipDoc(config: HubConfig, clock: CommandCtx['clock'], b: SlipBuild, paper_width_mm: number): Doc {
  const { utc_offset_ms } = hubTime(clock);
  void statusLink(b.root.order_id); // Tier 1: always null, so the builder gets no status_url
  return buildTakeawaySlipDoc(
    {
      reprint: b.reprint,
      branch_name: config.provisioned?.branch_name ?? '',
      token: b.token,
      ready_at_text: b.ready_at === null ? null : clock12(b.ready_at, utc_offset_ms),
      status_url: null,
      placed_at_text: clock12(b.root.placed_at, utc_offset_ms),
      date_text: dayText(b.root.placed_at, utc_offset_ms),
    },
    paper_width_mm <= 58 ? 32 : 48,
  );
}

/** §3.11 Job: `printDocument(tx, printer_id, doc, { kind_label: 'Token slip', order_id: root })` (2 statements). */
export function queueSlipJob(tx: WriterTx, printer_id: string, doc: Doc, root_order_id: string): { job_id: string } {
  return printDocument(tx, printer_id, doc, { kind_label: TOKEN_SLIP_KIND_LABEL, order_id: root_order_id });
}

// §6.14 step 3: the named order LEFT JOIN the takeaway orders of its (business_date, token) (index orders_token_day).
// A non-takeaway order has no token, so only its own row returns. 1 statement.
const TOKEN_SQL = `SELECT n.order_type, n.cancelled_at AS n_cancelled_at, n.billed_at AS n_billed_at, n.token,
       t.order_id, t.placed_at, t.billed_at, t.cancelled_at, t.pickup_at_ms
  FROM orders n
  LEFT JOIN orders t ON n.order_type = 'takeaway' AND t.order_type = 'takeaway'
                    AND t.business_date = n.business_date AND t.token = n.token
 WHERE n.order_id = ?`;

interface TokenRow extends Partial<TokenOrder> {
  order_type: string;
  n_cancelled_at: number | null;
  n_billed_at: number | null;
  token: number | null;
}

const Payload = z
  .object({
    order_id: z.string().min(1).max(64),
    reason: z.enum(['pay_later', 'reprint']),
    printer_id: z.string().min(1).max(64).optional(),
  })
  .strict();

export interface SlipResult {
  printed: boolean;
  job_id: string | null;
  skipped: null | SlipSkipped;
}

function handle(ctx: CommandCtx, payload: z.infer<typeof Payload>, log: FastifyInstance['log']): SlipResult {
  const db = ctx.tx.db;
  // Step 3: the token (1).
  const rows = db.prepare(TOKEN_SQL).all(payload.order_id) as TokenRow[];
  // Step 4: refusals, in this order.
  const named = rows[0];
  if (named === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_id: payload.order_id });
  const refuse = (reason: 'not_takeaway' | 'cancelled' | 'billed'): never => {
    throw new DomainError('TAKEAWAY_SLIP_NOT_ALLOWED', { order_id: payload.order_id, reason });
  };
  if (named.order_type !== 'takeaway') refuse('not_takeaway');
  if (named.n_cancelled_at !== null) refuse('cancelled');
  if (named.n_billed_at !== null) refuse('billed');
  const orders = rows as TokenOrder[];
  // Step 5: the root.
  const root = rootOf(orders);
  const pay_later = payload.reason === 'pay_later';
  const skip = (skipped: SlipSkipped): SlipResult => ({ printed: false, job_id: null, skipped });
  // Step 6 (0 statements).
  if (pay_later && !slipSettingOn()) return skip('setting_off');
  if (pay_later && slipHeld(orders, payload.order_id)) return skip('slip_held');
  // Step 7 (1).
  if (pay_later && slipAlreadyPrinted(db, root.order_id)) return skip('already_printed');
  // Step 8 (1): a given printer not active → 404; no route → no_printer (logged with ids).
  const printer = slipPrinterRow(db, { ...(payload.printer_id === undefined ? {} : { printer_id: payload.printer_id }), device_id: ctx.actor.deviceId });
  if (printer === null) {
    if (payload.printer_id !== undefined) throw new DomainError('PRINTER_NOT_FOUND', { printer_id: payload.printer_id });
    log.info({ order_id: payload.order_id, root_order_id: root.order_id, device_id: ctx.actor.deviceId }, 'print.slip.no_printer');
    return skip('no_printer');
  }
  // Step 9: build (memory) and queue (2).
  const live = orders.filter((o) => o.cancelled_at === null).map((o) => o.order_id);
  const ready_at = takeawaySlipReadyAt(ctx.state as EngineState, live, root.pickup_at_ms);
  const doc = slipDoc(ctx.config, ctx.clock, { reprint: !pay_later, token: named.token!, root, ready_at }, printer.paper_width_mm);
  const { job_id } = queueSlipJob(ctx.tx, printer.printer_id, doc, root.order_id);
  return { printed: true, job_id, skipped: null };
}

export function printTakeawaySlipCommand(log: FastifyInstance['log']) {
  return defineCommand({
    commandType: 'PrintTakeawaySlip',
    payloadSchema: Payload,
    sessionKind: 'device',
    // §3.10 (owner decision D-3): `take-order`, any scope, scope not applied; a `requires_approval` grant reads as
    // allowed (the command has no approval flow: `approvable` only lets that grant through to this handler).
    permission: 'take-order',
    approvable: true,
    handle: (ctx, payload) => ({ events: [], result: handle(ctx, payload, log) }),
  });
}

export function registerPrintTakeawaySlip(app: FastifyInstance): void {
  commandRegistry(app).register(printTakeawaySlipCommand(app.log));
}
