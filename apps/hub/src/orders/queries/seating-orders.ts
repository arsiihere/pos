import { isOrderInEngine, type EngineLine, type EngineState } from '@pos/engine';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import { defineQuery, queryRegistry } from '../../queries/registry.js';
import type { LineView } from '../contracts.js';
import { ordersOf, seatingTotals } from '../exports.js';

// 02b v1.0.3 §6.15 GET /queries/seating-orders: the seating's orders (02a seating_orders, current, P-1c) by placed_at,
// with their lines (LineView, §4.2) and each line's engine stage, and the seating's total (§3.13). Statements: 2
// (ordersOf, seatingTotals); names from the directory and stages from EngineState, in memory. No contact (O17).
//
// `groups: [{ promise_ms }]` is NOT built: EngineState keeps no per-group promise (03a §3.3 EngineOrder.groups has
// target_land_ms only; slip.ts:40) and a third statement would break the count of 2 — STOP, task 21 report.

/**
 * A line's stage for the screens. `null`: a deal header or a zone-served line (never in the engine, 03a :245, O5), or a
 * line the engine does not hold. `out_of_engine`: the order has left the engine (abandon or exit, O16; the stage
 * name RemoveItems already uses). Else the EngineState stage.
 */
export type LineStage = EngineLine['stage'] | 'out_of_engine' | null;

export function lineStage(state: Readonly<EngineState>, line: LineView, inEngine: boolean): LineStage {
  if (line.line_kind === 'deal' || line.zone_served) return null;
  if (!inEngine) return 'out_of_engine';
  return state.lines[line.order_item_id]?.stage ?? null;
}

export interface SeatingOrder {
  order_id: string;
  placed_by: { staff_id: string; name: string | null };
  placed_at: number;
  follow_up: boolean;
  cancelled: boolean;
  billed: boolean;
  has_phone: boolean;
  lines: Array<LineView & { stage: LineStage }>;
}

export function seatingOrdersBody(
  db: Database.Database,
  state: Readonly<EngineState>,
  directory: StaffDirectory,
  seating_id: string,
  now: number,
): { orders: SeatingOrder[]; total_minor: number } {
  const orders = ordersOf(db, seating_id);
  const { total_minor } = seatingTotals(db, seating_id);
  return {
    orders: orders.map((o) => {
      const inEngine = isOrderInEngine(state, o.order_id, now);
      return {
        order_id: o.order_id,
        placed_by: { staff_id: o.placed_by, name: directory.get(o.placed_by)?.display_name ?? null },
        placed_at: o.placed_at,
        follow_up: o.follow_up,
        cancelled: o.cancelled,
        billed: o.billed,
        has_phone: o.has_phone,
        lines: o.lines.map((l) => ({ ...l, stage: lineStage(state, l, inEngine) })),
      };
    }),
    total_minor,
  };
}

export function registerSeatingOrdersQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'seating-orders',
      sessionKind: 'device',
      session: 'required',
      querySchema: z.object({ seating_id: z.string().min(1) }),
      handle: (ctx, q) => ({ data: seatingOrdersBody(ctx.db, ctx.state, ctx.directory, q.seating_id, ctx.now) }),
    }),
  );
}
