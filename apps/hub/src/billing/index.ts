// task 9 (§3.14, §3.15): the eight 05 alert kinds register at this module's load, before boot replays `alerts` (#89).
import './kinds/index.js';
// task 32a (§6.30, row V-3, H6-14): the audit maps of 05-1's events and the seven request actions, at module load
import './audit-map.js';
import { auditEventTypes } from '@pos/domain';
import type { PosEvent } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { currentDirectory } from '../auth/guards.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { registerTileMarks } from '../tables/tile-marks.js';
import type { ProjectionRegistry } from '../projections/registry.js';
import type { HubDeps } from '../server.js';
import { registerEventAudience } from '../ws/audience.js';
import type { SocketCtx } from '../ws/catch-up.js';
import { registerCloseSplit } from './commands/close-split.js'; // task 17
import { registerOpenShift } from './commands/open-shift.js';
import { registerOpenCashDrawer } from './commands/open-cash-drawer.js'; // task 23
import { registerPrintCheckBill } from './commands/print-check-bill.js';
import { registerPrintDocs } from './commands/print-docs.js'; // task 27
import { registerPrintReport } from './commands/print-report.js'; // task 27b
import { registerPayments } from './commands/payments.js'; // task 16
// task 13 (§6.6, §6.7, §3.14): ApplyDiscount / RemoveDiscount; the module load registers the discount apply
import { registerDiscount } from './commands/discount.js';
import { registerSetSplits } from './commands/set-splits.js';
import { billLineGuard, billMergeGuard } from './lanes/guards.js'; // task 24
import { registerLineGuard } from '../orders/line-guard.js'; // task 24
import { registerMergeGuard } from '../tables/merge-guard.js'; // task 24
// task 14 (§6.8, §3.14): RemoveServiceCharge / ApplyServiceCharge; the module load registers the remove_service_charge apply
import { registerServiceCharge } from './commands/service-charge.js';
// task 20 (§6.14, §3.14): RemoveComp; the module load registers the remove_comp apply
import { registerRemoveComp } from './commands/remove-comp.js';
// task 18 (§6.11, §3.14): WaiveBuyerId; the module load registers the close_without_buyer_id apply
import { registerWaiveBuyerId } from './commands/waive-buyer-id.js';
// task 31a (§6.28a): SetFiscalToken (admin, write-only)
import { registerSetFiscalToken } from './fiscal/credentials.js';
// task 22 (§6.20, §3.14): RecordPettyCash / SettlePettyAdvance; the module load registers the petty_cash apply
import { registerPettyCash } from './commands/petty-cash.js';
// task 21 (§6.17–§6.19, §3.14): CountShift / CloseShift / HandoverCount; the module load registers the shift_variance apply
import { registerShiftClose } from './commands/shift-close.js';
// task 19 (§6.13, §3.10): ReopenBill and the order-cancelled hook; the module load registers the reopen_bill apply
import { registerReopenBill } from './commands/reopen-bill.js';
// task 25 (§6.24, §6.25, B25): CarryOverOrders and 05's day-close guard (after 04's)
import { registerCarryOverOrders } from './commands/carry-over.js';
import { registerDayCloseAppender, registerDayCloseGuard } from '../commands/close-business-day.js';
import { billingDayCloseAppender, billingDayCloseGuard, bindDayClose } from './lanes/day-close.js';
import { NONE_ADAPTER_KEY, noneAdapter } from './fiscal/none.js';
import { fiscalAdapterFor, registerFiscalAdapter } from './fiscal/port.js';
// task 31 (§3.15, §6.27, §6.28): the stuck tick (01d registerTick, G-22), fiscal-status and RetryFiscalNow
import { registerFiscalStatus } from './fiscal/status.js';
import { fiscalWorkerSeams, startFiscalWorker, type FiscalFinalAnswer, type FiscalWorkerLog, type FiscalWorkRow, type LoadedSubmission } from './fiscal/worker.js';
import { billPrintsProjection, bindBillPrints } from './print/folds.js';
import { billingProjection } from './projections/billing.js';
import { shiftsProjection } from './projections/shifts.js';
import { covers, registerBillQuery } from './queries/bill.js';
import { billTileMarks } from './tile-marks.js';
import { registerBillPrintersQuery } from './queries/bill-printers.js'; // task 27
import { registerOpenBillsQuery } from './queries/open-bills.js';
import { registerReportQueries } from './queries/reports.js'; // task 26b
import { registerShiftQuery } from './queries/shift.js';

// 05 wiring entry (§6.30, task 7; H6-14: every later task adds only its own registration lines here, under its marker).
// Audit actions and alert kinds register at module load (P0.15, P0.7, G-20); projections in registerHubProjections
// (lib/boot.ts), before the audit seal; per-server registrations in registerBilling, removed when the server closes.

/** Called once from buildHubServer, after registerAudit. */
export function registerBilling(app: FastifyInstance, deps: HubDeps): void {
  // task 7 (§6.30, S-B): the OrdersCarriedOver audience (P0.13 writes the event; with no audience it reaches no socket)
  // task 33 (§6.30, H16-6, H17-4): the audience table of every 05 event (OrdersCarriedOver's is in it)
  const stopAudiences = registerBillingAudiences(app, deps);
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
  // §6.30, §3.15 (B20): the `none` adapter (every branch's PK built-in); the same object again is a no-op
  registerFiscalAdapter(noneAdapter);
  // task 27 (§6.22, §6.23, §6.23a): PrintBillDocument, RetargetBillPrint and the Print to picker's printer list
  registerPrintDocs(app);
  registerBillPrintersQuery(app);
  // task 27b (§6.22, R-87): PrintReport (X / Z at the report route → default)
  registerPrintReport(app);
  // task 18 (§6.11)
  registerWaiveBuyerId(app);
  // task 31a (§6.28a, B22): SetFiscalToken on /admin/commands/set-fiscal-token
  registerSetFiscalToken(app);
  // task 31 (§3.15 Stuck, §6.27, §6.28; G-22): the fiscal_outbox_stuck tick, fiscal-status and RetryFiscalNow
  registerFiscalStatus(app);
  // task 22 (§6.20)
  registerPettyCash(app);
  // task 21 (§6.17–§6.19)
  registerShiftClose(app);
  // task 23 (§6.21): OpenCashDrawer (no-sale; the kick on the device's own route, R-57)
  registerOpenCashDrawer(app);
  // task 24 (§3.9, row T-1; B15, row Q-3): 05's merge and line guards, after 04's (registerVoids runs first)
  registerMergeGuard(billMergeGuard);
  registerLineGuard(billLineGuard);
  // task 19 (§6.13, §3.10, row Q-7)
  registerReopenBill(app);
  // task 26b (§6.26): the X and Z queries (the ZReportIssued print fold is in print/folds.ts)
  registerReportQueries(app);
  // task 25 (§6.24, §6.25, §3.13, R-76, R-84, R-85): CarryOverOrders; the day-close guard after 04's (registerVoids runs first)
  registerCarryOverOrders(app);
  bindDayClose({ clock: deps.clock, warn: (fields, msg) => app.log.warn(fields, msg) });
  registerDayCloseGuard(billingDayCloseGuard);
  // the appender: AlertClosed for 05 + 02b comp requests, then ZReportIssued (before 03a's releases and BusinessDayClosed)
  registerDayCloseAppender(billingDayCloseAppender);
  // task 33 (§6.30, row T-4, R-30 / G-30): the table-tile marks reader, before listen (buildHubServer runs before it)
  registerTileMarks(billTileMarks);
  app.addHook('onClose', async () => {
    stopAudiences();
  });
  // task 33 (§6.30, #91b): the startup wiring check, last — a 05 event with no audience or audit map, or no `none`
  // fiscal adapter, fails boot
  checkBillingWiring(BILLING_AUDIENCE_TYPES, new Set(auditEventTypes()));
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

// ---------------------------------------------------------------------------------------------- audiences (task 33)

/** §6.29: the `bill`-stream events (@pos/events/src/events/bill/). */
export const BILL_STREAM: readonly string[] = [
  'BillOpened',
  'ChargeApplied',
  'ChargeRemoved',
  'CheckBillPrinted',
  'BillSplitsSet',
  'DiscountFrozen',
  'DiscountApplied',
  'DiscountRemoved',
  'PaymentAdded',
  'PaymentRemoved',
  'BuyerIdWaived',
  'InvoiceIssued',
  'BillReopened',
  'InvoiceCredited',
  'FiscalNumberAssigned',
  'FiscalSubmitRejected',
  'BillClosedEmpty',
];

/** §6.29: the `shift`-stream events (@pos/events/src/events/shift/). */
export const SHIFT_STREAM: readonly string[] = [
  'ShiftOpened',
  'ShiftCounted',
  'ShiftCountSkipped',
  'HandoverCounted',
  'ShiftClosed',
  'ShiftVarianceSignedOff',
  'PettyCashAdvanced',
  'PettyCashSettled',
  'PettyCashOut',
  'PettyCashIn',
  'DrawerOpened',
];

/** §6.29: 05's three `hub`-stream events. */
const FIVE_HUB_EVENTS: readonly string[] = ['OrdersCarriedOver', 'ZReportIssued', 'FiscalTokenSet'];

/** §6.29: every event 05 owns — the `bill` and `shift` streams and 05's three `hub` events. */
export const FIVE_EVENT_TYPES: readonly string[] = [...BILL_STREAM, ...SHIFT_STREAM, ...FIVE_HUB_EVENTS];

const REPORT_EVENTS: readonly string[] = ['OrdersCarriedOver', 'ZReportIssued'];

/**
 * 05 events with no audit action of their own (the two exceptions of the wiring check):
 * - `DiscountFrozen`: §6.29 (v1.0.7, R-41 / G-38) "no audit action of its own (the close audits `invoice_issued`)";
 * - `FiscalNumberAssigned`: row V-3 (04 v1.0.7 §3.6) lists no action for it (only the worker's rejection,
 *   `fiscal_rejected`); integrator-accepted reading, task 33.
 */
export const NO_AUDIT_ACTION: ReadonlySet<string> = new Set(['DiscountFrozen', 'FiscalNumberAssigned']);

const audienced = new Set<string>();
/** The 05 event types registerBilling has given a WS audience (through ws/audience.ts registerEventAudience). */
export const BILLING_AUDIENCE_TYPES: ReadonlySet<string> = audienced;

/**
 * §6.30, #91b: throws, naming every 05 event type with no WS audience or (outside NO_AUDIT_ACTION) no audit map, and
 * the `none` fiscal adapter when it is not registered (§6.30, §3.15). The branch's own adapter key is not known at boot
 * (the branch config arrives by sync), so only `none` is checked here.
 */
export function checkBillingWiring(
  withAudience: ReadonlySet<string>,
  withAudit: ReadonlySet<string>,
  hasAdapter: (key: string) => boolean = (key) => fiscalAdapterFor(key) !== null,
): void {
  const noAudience = FIVE_EVENT_TYPES.filter((t) => !withAudience.has(t));
  const noAudit = FIVE_EVENT_TYPES.filter((t) => !NO_AUDIT_ACTION.has(t) && !withAudit.has(t));
  const parts = [
    ...(noAudience.length > 0 ? [`no WS audience: ${noAudience.join(', ')}`] : []),
    ...(noAudit.length > 0 ? [`no audit map: ${noAudit.join(', ')}`] : []),
    ...(hasAdapter(NONE_ADAPTER_KEY) ? [] : [`no fiscal adapter: ${NONE_ADAPTER_KEY}`]),
  ];
  if (parts.length > 0) throw new Error(`05 startup wiring check failed (§6.30): ${parts.join('; ')}`);
}

interface BillHeadRow {
  scope: 'seating' | 'key';
  holder_staff_id: string | null;
  primary_table_id: string | null;
  placed_by_json: string;
}

// The bill's scope facts for §6.1's C8 test: its seating's holder and primary table, and the placers of its orders
// (payments.ts PAYMENT_OF's predicate) — 1 statement, once per event (memoised), only when a scoped holder is open.
const BILL_SCOPE_OF = `
SELECT b.scope, st.holder_staff_id, st.primary_table_id,
       (SELECT json_group_array(o.placed_by) FROM orders o
         WHERE o.cancelled_at IS NULL AND (
           o.order_id IN (SELECT order_id FROM bill_orders WHERE bill_id = b.bill_id)
           OR (b.state <> 'closed' AND b.absorbed_into IS NULL AND b.reopen_mode IS NOT 'corrections' AND o.billed_at IS NULL
               AND ((b.seating_id IS NOT NULL AND o.order_id IN (SELECT order_id FROM seating_orders WHERE seating_id = b.seating_id))
                 OR (b.table_key IS NOT NULL AND o.bill_key = b.table_key))
               AND NOT EXISTS (SELECT 1 FROM bill_orders bo WHERE bo.order_id = o.order_id AND bo.bill_id IS NOT b.bill_id)))) AS placed_by_json
FROM bills b
LEFT JOIN seatings st ON st.seating_id = b.seating_id
WHERE b.bill_id = ?`;

const SHIFT_OWNER_OF = `SELECT staff_id FROM shifts WHERE shift_id = ?`;

/**
 * §6.30 (H16-6, H17-4, B23), the audience table of every 05 event:
 * - `bill` stream (DiscountFrozen included, R-41) → cashier kiosks, and staff sockets holding `take-payment` (allowed or
 *   requires_approval) whose scope covers the bill as §6.1 (branch any; my_floors / own_tables / a key bill's placer);
 *   a `take-order`-only socket gets none of them (its check-bill view is a query, §6.1).
 * - `shift` stream → the shift's own staff (`shifts.staff_id`; `ShiftOpened` names it) and `close-shift-for-others`
 *   holders (allowed), on any device: a cashier never gets another person's ShiftCounted / HandoverCounted. Those two
 *   are the count itself, so their expected / variance reach a socket only after the count.
 * - `OrdersCarriedOver`, `ZReportIssued` → `view-reports` / `close-business-day` holders (allowed; both scope branch).
 * - `FiscalTokenSet` → admin sessions only: hub sockets are staff / station only (ws/catch-up.ts), so it reaches none.
 * Returns the unregister function (onClose).
 */
function registerBillingAudiences(app: FastifyInstance, deps: HubDeps): () => void {
  const directory = () => currentDirectory(app);
  const billScope = new WeakMap<PosEvent, BillHeadRow | null>();
  const shiftOwner = new WeakMap<PosEvent, string | null>();
  const billScopeOf = deps.readDb.prepare(BILL_SCOPE_OF);
  const shiftOwnerOf = deps.readDb.prepare(SHIFT_OWNER_OF);

  const billAudience = (event: PosEvent, socket: SocketCtx): boolean => {
    if (socket.deviceType === 'cashier_kiosk') return true;
    if (socket.kind !== 'staff' || socket.staffId === null) return false;
    const r = directory().resolve(socket.staffId, 'take-payment');
    if (r.grant !== 'allowed' && r.grant !== 'requires_approval') return false;
    if (r.scope === 'branch') return true;
    let head = billScope.get(event);
    if (head === undefined) {
      const bill_id = typeof event.payload['bill_id'] === 'string' ? event.payload['bill_id'] : event.stream_id;
      head = (billScopeOf.get(bill_id) as BillHeadRow | undefined) ?? null;
      billScope.set(event, head);
    }
    const config = branchConfig();
    if (head === null || config === null) return false;
    const seating = head.holder_staff_id === null || head.primary_table_id === null ? null : { holder_staff_id: head.holder_staff_id, primary_table_id: head.primary_table_id };
    return covers(directory(), config, socket.staffId, r.scope, { seating, scope: head.scope, placed_by: JSON.parse(head.placed_by_json) as string[] });
  };

  const shiftAudience = (event: PosEvent, socket: SocketCtx): boolean => {
    if (socket.kind !== 'staff' || socket.staffId === null) return false;
    if (directory().resolve(socket.staffId, 'close-shift-for-others').grant === 'allowed') return true;
    let owner = shiftOwner.get(event);
    if (owner === undefined) {
      const named = event.event_type === 'ShiftOpened' ? event.payload['staff_id'] : undefined;
      if (typeof named === 'string') owner = named;
      else {
        const shift_id = typeof event.payload['shift_id'] === 'string' ? event.payload['shift_id'] : event.stream_id;
        owner = (shiftOwnerOf.get(shift_id) as { staff_id: string } | undefined)?.staff_id ?? null;
      }
      shiftOwner.set(event, owner);
    }
    return owner === socket.staffId;
  };

  const reportAudience = (_event: PosEvent, socket: SocketCtx): boolean => {
    if (socket.kind !== 'staff' || socket.staffId === null) return false;
    const d = directory();
    return d.resolve(socket.staffId, 'view-reports').grant === 'allowed' || d.resolve(socket.staffId, 'close-business-day').grant === 'allowed';
  };

  // §6.28a: admin sessions hold no hub socket, so no socket qualifies
  const adminOnly = (): boolean => false;

  const table: Array<[readonly string[], (event: PosEvent, socket: SocketCtx) => boolean]> = [
    [BILL_STREAM, billAudience],
    [SHIFT_STREAM, shiftAudience],
    [REPORT_EVENTS, reportAudience],
    [['FiscalTokenSet'], adminOnly],
  ];
  const offs: Array<() => void> = [];
  for (const [types, audience] of table) {
    for (const t of types) {
      offs.push(registerEventAudience(t, audience));
      audienced.add(t);
    }
  }
  return () => {
    for (const off of offs) off();
  };
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
