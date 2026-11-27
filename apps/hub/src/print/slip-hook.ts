import { TAKEAWAY_SLIP_REPLAY_MS } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type { FastifyBaseLogger } from 'fastify';
import type { HubConfig } from '../config/schema.js';
import type { WriterTx } from '../engine-host/writer.js';
import { slipPrinterRow } from './bill-routes.js';
import { queueSlipJob, rootOf, slipDoc, slipHeld, slipSettingOn, type TokenOrder } from './commands/print-takeaway-slip.js';
import { customerReadyAt } from './render/ready-at.js';

// 03c v1.0.16 §3.11 trigger 1, §4.2 `queueTakeawaySlipOnSubmit` (task 32; 02b-TK R6; hostile run 1): the Send · pay
// later slip, called by 02b's SubmitOrder after its append, in the same writer transaction (rows Q-TK-1…Q-TK-3), so
// the job commits and rolls back with the order and D32 covers every retransmit. Never throws: the work runs in a
// SAVEPOINT (better-sqlite3's nested transaction); any error rolls back to it, is logged `print.slip.failed` with
// ids only, and gives `skipped: 'failed'`. Statements ≤ 3 for a root (printer 1 + job 2), ≤ 4 for an addition (+ the
// token read). `deps` carries the hub config (branch name) and the logger, which the caller holds.

export interface SubmitSlipInput {
  order_id: string;
  adds_to_order_id: string | null;
  token: number;
  business_date: string;
  placed_at: number;
  pickup_at_ms: number | null;
  /** the submit's own plan (OrderPlaced.groups[]): the new order is not yet in this transaction's engine state */
  groups: ReadonlyArray<{ target_land_ms: number; promise_ms: number }>;
  device_id: string;
  /** the accepted, clamped `queued_at` (02b §3.12), null for a live submit */
  queued_at: number | null;
  now: number;
}

export type SubmitSlipSkipped = 'setting_off' | 'replay_late' | 'slip_held' | 'no_printer' | 'failed';

export interface SubmitSlipResult {
  printed: boolean;
  job_id: string | null;
  skipped: null | SubmitSlipSkipped;
}

export interface SubmitSlipDeps {
  config: HubConfig;
  log: FastifyBaseLogger;
}

/** Test seam (03c test 65: "a builder that throws (injected)"); never set in production. */
export const slipHookTestHooks: { beforeBuild?: () => void } = {};

// §6.14 step 3's token read (the new order is folded already: this runs after the append). 1 statement.
const TOKEN_SQL = `SELECT t.order_id, t.placed_at, t.billed_at, t.cancelled_at, t.pickup_at_ms
  FROM orders n JOIN orders t ON t.order_type = 'takeaway' AND t.business_date = n.business_date AND t.token = n.token
 WHERE n.order_id = ?`;

/**
 * §3.11 Ready time at submit: the earlier orders' live engine lines (`customerReadyAt` on the engine state as it is)
 * and the new order's groups (`target_land_ms` = its land, `promise_ms` = its ready). Any earlier line with no time →
 * no Ready line; the root's pickup when no land is after it; else the latest ready; nothing at all → null.
 */
function readyAtSubmit(state: EngineState, earlier: readonly string[], groups: SubmitSlipInput['groups'], pickup: number | null): number | null {
  const included = new Set(earlier);
  let land: number | null = null;
  let ready: number | null = null;
  for (const line of Object.values(state.lines)) {
    if (!included.has(line.order_id) || (line.stage !== 'added' && line.stage !== 'cooking' && line.stage !== 'done')) continue;
    const t = customerReadyAt(state, line);
    if (t === null) return null;
    land = Math.max(land ?? t.land_at, t.land_at);
    ready = Math.max(ready ?? t.ready_at, t.ready_at);
  }
  for (const g of groups) {
    land = Math.max(land ?? g.target_land_ms, g.target_land_ms);
    ready = Math.max(ready ?? g.promise_ms, g.promise_ms);
  }
  if (pickup !== null && land !== null && land <= pickup) return pickup;
  return ready;
}

export function queueTakeawaySlipOnSubmit(tx: WriterTx, input: SubmitSlipInput, deps: SubmitSlipDeps): SubmitSlipResult {
  const ids = { order_id: input.order_id, device_id: input.device_id };
  const skip = (skipped: SubmitSlipSkipped): SubmitSlipResult => ({ printed: false, job_id: null, skipped });
  try {
    return tx.db.transaction((): SubmitSlipResult => {
      if (!slipSettingOn()) return skip('setting_off');
      // §3.11 Queued replay: two stored times, never the arrival timing (AD-32)
      if (input.queued_at !== null && input.now - input.queued_at > TAKEAWAY_SLIP_REPLAY_MS) return skip('replay_late');
      let root: TokenOrder = { order_id: input.order_id, placed_at: input.placed_at, billed_at: null, cancelled_at: null, pickup_at_ms: input.pickup_at_ms };
      let earlier: string[] = [];
      if (input.adds_to_order_id !== null) {
        const orders = tx.db.prepare(TOKEN_SQL).all(input.order_id) as TokenOrder[];
        if (slipHeld(orders, input.order_id)) return skip('slip_held');
        root = rootOf(orders);
        earlier = orders.filter((o) => o.order_id !== input.order_id && o.cancelled_at === null).map((o) => o.order_id);
      }
      const printer = slipPrinterRow(tx.db, { device_id: input.device_id });
      if (printer === null) {
        deps.log.info({ ...ids, root_order_id: root.order_id }, 'print.slip.no_printer');
        return skip('no_printer');
      }
      slipHookTestHooks.beforeBuild?.();
      const ready_at = readyAtSubmit(tx.state as EngineState, earlier, input.groups, root.pickup_at_ms);
      const doc = slipDoc(deps.config, tx.clock, { reprint: false, token: input.token, root, ready_at }, printer.paper_width_mm, deps.log);
      const { job_id } = queueSlipJob(tx, printer.printer_id, doc, root.order_id);
      return { printed: true, job_id, skipped: null };
    })();
  } catch (e) {
    deps.log.warn({ ...ids, error: e instanceof Error ? e.name : 'unknown' }, 'print.slip.failed');
    return skip('failed');
  }
}
