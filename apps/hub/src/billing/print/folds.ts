// 05 §6.4, §3.16, B17 (task 11): the live-only print folds of billing (§6.30 "live-only print folds"), 03c's job-fold
// pattern (print/tickets-projection.ts): projection `billing_prints`, forward-only (no `reset`), registered after
// `billing` and `shifts`, so it reads the bills / seating rows the earlier folds of the same event wrote. Its jobs are
// written only when mode === 'live', never in 'catchup' (D1: a replay or a rebuild never prints history). Total (R8):
// the print part runs in its own savepoint; a failure rolls back only the print, is logged with ids and never throws.
//
// 02a `BillRequested { seating_id, table_id, by_staff_id }` → the check bill of the seating's `bills` row when one
// exists (its service charge, discount, splits), else the projected bill (ensure-bill drafts are not possible in a
// fold), at `billPrinterFor({ zone_id, floor_id })` of the seating's primary table; the job in `bill_print_jobs`
// (`bill_id` = the bill, else NULL with `ref_id = seating_id`). No event, no 01d notice. No printer → logged, skipped.
import { DomainError } from '@pos/domain';
import type { BillRequestedPayload, PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import type { HubConfig } from '../../config/schema.js';
import type { WriterTx } from '../../engine-host/writer.js';
import type { Projection, ProjectionRegistry } from '../../projections/registry.js';
import { billPrinterFor } from '../../print/api.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { openBillOf } from '../commands/ensure-bill.js';
import { activePrinter, checkBillOf, queueCheckBill, tableRouteOf } from '../commands/print-check-bill.js';

export const BILL_PRINT_EVENT_TYPES = ['BillRequested'] as const;

/** One skipped print (ids and a short reason only). */
export interface BillPrintSkip {
  event_id: string;
  event_type: string;
  seating_id: string | null;
  reason: string;
}

interface Slot {
  log: ((line: BillPrintSkip) => void) | null;
  pending: BillPrintSkip[];
  config: HubConfig | null;
}

// As kitchen_tickets: boot replays projections before the server exists, so the log and the hub config bind later.
const slots = new WeakMap<ProjectionRegistry, Slot>();

/** Binds the hub log (`billing.print_skipped`) and the hub config (the branch name on the slip); flushes earlier lines. */
export function bindBillPrints(projections: ProjectionRegistry, o: { log: (line: BillPrintSkip) => void; config: HubConfig }): void {
  const slot = slots.get(projections);
  if (slot === undefined) return;
  slot.log = o.log;
  slot.config = o.config;
  for (const line of slot.pending.splice(0)) o.log(line);
}

class Skip extends Error {}

export function billPrintsProjection(projections: ProjectionRegistry): Projection {
  const slot: Slot = { log: null, pending: [], config: null };
  slots.set(projections, slot);
  const emit = (line: BillPrintSkip): void => {
    if (slot.log === null) slot.pending.push(line);
    else slot.log(line);
  };
  return {
    name: 'billing_prints',
    eventTypes: [...BILL_PRINT_EVENT_TYPES],
    apply(tx, event, mode) {
      if (mode !== 'live') return;
      const seating_id = (event.payload as Partial<BillRequestedPayload>).seating_id ?? null;
      try {
        tx.transaction(() => printRequestedBill(tx, event, slot.config))();
      } catch (error) {
        emit({ event_id: event.event_id, event_type: event.event_type, seating_id, reason: error instanceof Skip ? error.message : error instanceof DomainError ? error.code : 'fold_error' });
      }
    },
  };
}

/**
 * §6.4: openBillOf (1) → the check bill (≤ 4) → billPrinterFor (1) + the printer row (1) → printDocument (2) +
 * bill_print_jobs (1). The job id is the event's (`<event_id>:check`), its time the event's `recorded_at`; the same
 * event applied again finds its `bill_print_jobs` row claimed and skips cleanly (no second job, no log line).
 */
function printRequestedBill(db: Database.Database, event: PosEvent, hub: HubConfig | null): void {
  const p = event.payload as Partial<BillRequestedPayload>;
  if (typeof p.seating_id !== 'string' || p.seating_id.length === 0) throw new Skip('bad_payload');
  const config = branchConfig();
  if (config === null) throw new Skip('no_config');
  const { head } = openBillOf(db, { seating_id: p.seating_id }, null);
  if (head.state === 'closed' || head.absorbed || head.seating === null || head.seating.state === 'CLOSED') throw new Skip('bill_not_open');
  const check = checkBillOf(db, config, head, false);
  const routed = billPrinterFor(db, tableRouteOf(config, head.seating.primary_table_id));
  const printer = routed === null ? null : activePrinter(db, routed);
  if (printer === null) throw new Skip('no_printer');
  const job_id = `${event.event_id}:check`;
  queueCheckBill(foldTx(db, event, job_id), printer, check, {
    job_id,
    bill_id: head.bill_id,
    ref_id: head.bill_id === null ? p.seating_id : null,
    branch_name: hub?.provisioned?.branch_name ?? '',
  });
}

/** printDocument's transaction view inside a fold: the fold's connection, the event's time and a job id of its own. */
function foldTx(db: Database.Database, event: PosEvent, job_id: string): WriterTx {
  const refuse = (): never => {
    throw new Error('a print fold appends no event');
  };
  return {
    db,
    state: {},
    clock: { branchNow: () => event.recorded_at },
    ids: { next: () => job_id },
    branchId: event.branch_id,
    append: refuse,
    onCommit: refuse,
  };
}
