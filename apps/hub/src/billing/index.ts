// task 9 (§3.14, §3.15): the eight 05 alert kinds register at this module's load, before boot replays `alerts` (#89).
import './kinds/index.js';
// task 32a (§6.30, row V-3, H6-14): the audit maps of 05-1's events and the seven request actions, at module load
import './audit-map.js';
import type { FastifyInstance } from 'fastify';
import { currentDirectory } from '../auth/guards.js';
import type { ProjectionRegistry } from '../projections/registry.js';
import type { HubDeps } from '../server.js';
import { registerEventAudience } from '../ws/audience.js';
import type { SocketCtx } from '../ws/catch-up.js';
import { registerCloseSplit } from './commands/close-split.js'; // task 17
import { registerOpenShift } from './commands/open-shift.js';
import { registerPrintCheckBill } from './commands/print-check-bill.js';
import { registerPrintDocs } from './commands/print-docs.js'; // task 27
import { registerPayments } from './commands/payments.js'; // task 16
// task 13 (§6.6, §6.7, §3.14): ApplyDiscount / RemoveDiscount; the module load registers the discount apply
import { registerDiscount } from './commands/discount.js';
import { registerSetSplits } from './commands/set-splits.js';
// task 14 (§6.8, §3.14): RemoveServiceCharge / ApplyServiceCharge; the module load registers the remove_service_charge apply
import { registerServiceCharge } from './commands/service-charge.js';
// task 20 (§6.14, §3.14): RemoveComp; the module load registers the remove_comp apply
import { registerRemoveComp } from './commands/remove-comp.js';
import { fiscalAdapterFor } from './fiscal/port.js';
import { fiscalWorkerSeams, startFiscalWorker, type FiscalFinalAnswer, type FiscalWorkerLog, type FiscalWorkRow, type LoadedSubmission } from './fiscal/worker.js';
import { billPrintsProjection, bindBillPrints } from './print/folds.js';
import { billingProjection } from './projections/billing.js';
import { shiftsProjection } from './projections/shifts.js';
import { registerBillQuery } from './queries/bill.js';
import { registerBillPrintersQuery } from './queries/bill-printers.js'; // task 27
import { registerOpenBillsQuery } from './queries/open-bills.js';
import { registerShiftQuery } from './queries/shift.js';

// 05 wiring entry (§6.30, task 7; H6-14: every later task adds only its own registration lines here, under its marker).
// Audit actions and alert kinds register at module load (P0.15, P0.7, G-20); projections in registerHubProjections
// (lib/boot.ts), before the audit seal; per-server registrations in registerBilling, removed when the server closes.

/** Called once from buildHubServer, after registerAudit. */
export function registerBilling(app: FastifyInstance, deps: HubDeps): void {
  // task 7 (§6.30, S-B): the OrdersCarriedOver audience (P0.13 writes the event; with no audience it reaches no socket)
  const stopCarryAudience = registerOrdersCarriedOverAudience(app);
  // task 10 (§6.1, §6.2): the bill view and the open-bills list (ensure bill is a helper of the bill commands)
  registerBillQuery(app);
  registerOpenBillsQuery(app);
  // task 15 (§6.15, §6.16): OpenShift and the blind shift view
  registerOpenShift(app);
  registerShiftQuery(app);
  // task 12 (§6.5): SetSplits
  registerSetSplits(app);
  // task 14 (§6.8)
  registerServiceCharge(app);
  // task 11 (§6.3, §6.4): PrintCheckBill; the live-only print folds' log and hub config (branch name on the slip)
  registerPrintCheckBill(app);
  bindBillPrints(deps.projections, { log: (line) => app.log.warn(line, 'billing.print_skipped'), config: deps.config });
  // task 20 (§6.14)
  registerRemoveComp(app);
  // task 16 (§6.9, §6.10): AddPayment and RemovePayment
  registerPayments(app);
  // task 13 (§6.6, §6.7)
  registerDiscount(app);
  // task 17 (§6.12): CloseSplit and the buyer-ID document filler (row P-5)
  registerCloseSplit(app);
  // task 27 (§6.22, §6.23, §6.23a): PrintBillDocument, RetargetBillPrint and the Print to picker's printer list
  registerPrintDocs(app);
  registerBillPrintersQuery(app);
  app.addHook('onClose', async () => {
    stopCarryAudience();
  });
}

/** §5, G-20: inside registerHubProjections, after orders, tables and audit (also the test hub and the big fixture). */
export function registerBillingProjections(projections: ProjectionRegistry): void {
  // task 7 (billing)
  projections.register(billingProjection());
  // task 8 (shifts; §6.30: after billing)
  projections.register(shiftsProjection());
  // task 11 (§6.4, §6.30: the live-only print folds, after billing and shifts)
  projections.register(billPrintsProjection(projections));
}

/**
 * §6.30: `OrdersCarriedOver` → sockets whose staff hold `view-reports` or `close-business-day` (01d's holders: an
 * `allowed` grant), resolved through the hub's StaffDirectory in memory. Returns the unregister function.
 * Scope is not read: both permissions take `branch` only (01b v1.10 §3.3, `PERMISSION_SCOPES`), and the 01d
 * `permission` target likewise reads scope only for a `range_of` (alerts/targets.ts permissionHolders), which this
 * audience has none of.
 */
function registerOrdersCarriedOverAudience(app: FastifyInstance): () => void {
  return registerEventAudience('OrdersCarriedOver', (_event, socket: SocketCtx) => {
    if (socket.kind !== 'staff' || socket.staffId === null) return false;
    const directory = currentDirectory(app);
    return (
      directory.resolve(socket.staffId, 'view-reports').grant === 'allowed' ||
      directory.resolve(socket.staffId, 'close-business-day').grant === 'allowed'
    );
  });
}

// ---------------------------------------------------------------------------------------------- workers (G-21, H-3)

/** The fiscal worker's two seams (29b registers the real ones with one line below its marker). */
export interface FiscalWorkerSeams {
  loadSubmission(deps: HubDeps, row: FiscalWorkRow): LoadedSubmission | Promise<LoadedSubmission>;
  onAnswer(deps: HubDeps, row: FiscalWorkRow, answer: FiscalFinalAnswer): void | Promise<void>;
}

let seams: FiscalWorkerSeams | null = null;

export function registerFiscalWorkerSeams(s: FiscalWorkerSeams): void {
  seams = s;
}

/** Tests only: back to "no seams registered". */
export function resetFiscalWorkerSeams(): void {
  seams = null;
}

// task 29b (§3.15, G-21, H6-14): the real seams, at module load (boot imports this file)
registerFiscalWorkerSeams(fiscalWorkerSeams);

/**
 * G-21: boot calls this after listen, beside the print worker (P0.18), and joins the returned stop to `beat.stop`.
 * Starts the fiscal worker only when loadSubmission and onAnswer are registered; with none it starts nothing, reads
 * nothing and fails nothing.
 * Call once per boot; stop before re-boot.
 */
export function startBillingWorkers(deps: HubDeps, log: FiscalWorkerLog): () => void {
  const s = seams;
  if (s === null) return () => undefined;
  return startFiscalWorker({
    db: deps.db,
    clock: deps.clock,
    adapterFor: fiscalAdapterFor,
    loadSubmission: (row) => s.loadSubmission(deps, row),
    onAnswer: (row, answer) => s.onAnswer(deps, row, answer),
    log,
  });
}
