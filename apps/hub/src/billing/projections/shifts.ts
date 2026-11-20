import type {
  HandoverCountedPayload,
  PaymentAddedPayload,
  PaymentRemovedPayload,
  PettyCashAdvancedPayload,
  PettyCashInPayload,
  PettyCashOutPayload,
  PettyCashSettledPayload,
  PosEvent,
  ShiftClosedPayload,
  ShiftCountedPayload,
  ShiftCountSkippedPayload,
  ShiftOpenedPayload,
  ShiftVarianceSignedOffPayload,
} from '@pos/events';
import type Database from 'better-sqlite3';
import type { Projection } from '../../projections/registry.js';

// 05 §5 (task 8): the projection `shifts` (with `reset`). Events only (R-44 / G-39): every fold reads the event and the
// projection's own five tables, never a `billing` table (bill_payments, bills, invoices, billing_day), 02a's / 02b's
// tables or the settings — so a rebuild from seq 0 equals live (#88, #47b) and a later settings change never moves a
// rebuilt shift (R-42, #50d). Times are the envelope's recorded_at; shifts.business_date is ShiftOpened's and
// shift_signoffs.business_date is ShiftVarianceSignedOff's (the open day of the answer, R-44).
// Expected cash (§3.7) = float + Σ cash `in` − Σ cash `out` + Σ settled-advance cash returned − Σ advances
// − Σ cash-outs + Σ cash-ins; tendered and change cancel out on the receiving shift, so only amount_minor moves it.
// Statements per event are fixed (one row per event, never a scan of payments or petty rows).
// Registered in registerHubProjections after `billing` (§6.30: after orders, tables and audit).

/** §5 shifts list. DrawerOpened is listed in §5 and writes no row (no drawer-open table, §5). */
export const SHIFTS_EVENT_TYPES: readonly string[] = [
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
  'PaymentAdded',
  'PaymentRemoved',
];

/** Every table of `shifts` (§5), cleared by reset. */
export const SHIFTS_TABLES = ['shifts', 'shift_signoffs', 'shift_handovers', 'shift_takings', 'petty_cash'] as const;

/** §5: the `shifts` projection. */
export function shiftsProjection(): Projection {
  return {
    name: 'shifts',
    eventTypes: [...SHIFTS_EVENT_TYPES],
    apply(tx, event) {
      applyShifts(tx, event);
    },
    reset(tx) {
      for (const table of SHIFTS_TABLES) tx.prepare(`DELETE FROM ${table}`).run();
    },
  };
}

function applyShifts(tx: Database.Database, event: PosEvent): void {
  const at = event.recorded_at;
  switch (event.event_type) {
    case 'ShiftOpened': {
      // B11: drawer_device_id non-null = a drawer shift; expected starts at the float.
      const p = event.payload as ShiftOpenedPayload;
      tx.prepare(
        `INSERT INTO shifts (shift_id, staff_id, drawer_device_id, business_date, opened_at, float_minor, state, expected_cash_minor)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      ).run(p.shift_id, p.staff_id, p.drawer_device_id, p.business_date, at, p.float_minor, p.float_minor);
      return;
    }
    case 'PaymentAdded': {
      const p = event.payload as PaymentAddedPayload;
      return movePayment(tx, p, p.change_minor ?? 0, 1);
    }
    case 'PaymentRemoved': {
      // R-44: reversed from the event's own copy of the payment (the same (shift, mode, taker) row).
      const p = event.payload as PaymentRemovedPayload;
      return movePayment(tx, p, p.change_minor, -1);
    }
    case 'PettyCashAdvanced':
      return insertPetty(tx, event.payload as PettyCashAdvancedPayload, 'advance', -1, at);
    case 'PettyCashOut':
      return insertPetty(tx, event.payload as PettyCashOutPayload, 'out', -1, at);
    case 'PettyCashIn':
      return insertPetty(tx, event.payload as PettyCashInPayload, 'in', 1, at);
    case 'PettyCashSettled': {
      // §3.12: the advance settles (possibly on another shift); the returned cash lands on the settling shift.
      const p = event.payload as PettyCashSettledPayload;
      tx.prepare(
        `UPDATE petty_cash SET settled_at = ?, settled_shift_id = ?, spent_minor = ?, returned_minor = ?
         WHERE entry_id = ? AND kind = 'advance' AND settled_at IS NULL`,
      ).run(at, p.shift_id, p.spent_minor, p.returned_minor, p.entry_id);
      tx.prepare('UPDATE shifts SET expected_cash_minor = expected_cash_minor + ? WHERE shift_id = ?').run(p.returned_minor, p.shift_id);
      return;
    }
    case 'ShiftCounted': {
      // R-42 / G-39: variance_state and variance_alert_id from the event alone; the threshold is never read.
      const p = event.payload as ShiftCountedPayload;
      tx.prepare(
        `UPDATE shifts SET counted_minor = ?, counted_at = ?, variance_minor = ?, variance_alert_id = ?,
           variance_state = CASE WHEN ? IS NULL THEN NULL ELSE 'pending' END
         WHERE shift_id = ?`,
      ).run(p.counted_minor, at, p.variance_minor, p.variance_alert_id, p.variance_alert_id, p.shift_id);
      return;
    }
    case 'ShiftCountSkipped': {
      const p = event.payload as ShiftCountSkippedPayload;
      tx.prepare('UPDATE shifts SET count_skipped = 1 WHERE shift_id = ?').run(p.shift_id);
      return;
    }
    case 'HandoverCounted': {
      // §6.19: the shift stays open; no variance_state, no sign-off.
      const p = event.payload as HandoverCountedPayload;
      tx.prepare(
        `INSERT INTO shift_handovers (shift_id, at, counted_minor, expected_minor, variance_minor, by_staff_id) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(p.shift_id, at, p.counted_minor, p.expected_minor, p.variance_minor, p.by_staff_id);
      return;
    }
    case 'ShiftClosed': {
      const p = event.payload as ShiftClosedPayload;
      tx.prepare(`UPDATE shifts SET state = 'closed', closed_at = ?, closed_by = ? WHERE shift_id = ?`).run(at, p.closed_by, p.shift_id);
      return;
    }
    case 'ShiftVarianceSignedOff': {
      // H8-1, R-44: business_date = the open day of the answer, from the event.
      const p = event.payload as ShiftVarianceSignedOffPayload;
      tx.prepare('UPDATE shifts SET variance_state = ? WHERE shift_id = ?').run(p.outcome, p.shift_id);
      tx.prepare(
        'INSERT INTO shift_signoffs (shift_id, outcome, approver_staff_id, signed_at, business_date) VALUES (?, ?, ?, ?, ?)',
      ).run(p.shift_id, p.outcome, p.approver_staff_id, at, p.business_date);
      return;
    }
    case 'DrawerOpened':
      return; // §5 lists it; no table holds drawer opens (the audit does)
  }
}

/**
 * §3.7, Q10: a payment (sign 1) or its removal (sign −1) on its own shift. Cash moves expected by ± amount (`in` +,
 * `out` −); every class moves the (shift, mode, taker) takings row: in / out by amount, change by the tender's change.
 * 2 statements.
 */
function movePayment(
  tx: Database.Database,
  p: Pick<PaymentAddedPayload, 'shift_id' | 'mode_id' | 'payment_class' | 'direction' | 'amount_minor' | 'taken_by_staff_id'>,
  change: number,
  sign: 1 | -1,
): void {
  const signed = sign * (p.direction === 'in' ? p.amount_minor : -p.amount_minor);
  tx.prepare(`UPDATE shifts SET expected_cash_minor = expected_cash_minor + ? WHERE shift_id = ? AND ? = 'cash'`).run(
    signed,
    p.shift_id,
    p.payment_class,
  );
  const inMinor = p.direction === 'in' ? sign * p.amount_minor : 0;
  const outMinor = p.direction === 'out' ? sign * p.amount_minor : 0;
  tx.prepare(
    `INSERT INTO shift_takings (shift_id, mode_id, taken_by_staff_id, in_minor, out_minor, change_minor) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (shift_id, mode_id, taken_by_staff_id) DO UPDATE SET
       in_minor = in_minor + excluded.in_minor, out_minor = out_minor + excluded.out_minor,
       change_minor = change_minor + excluded.change_minor`,
  ).run(p.shift_id, p.mode_id, p.taken_by_staff_id, inMinor, outMinor, sign * change);
}

/** §3.12: one petty-cash row on its shift; an advance / out takes cash out (−), an in puts it back (+). 2 statements. */
function insertPetty(
  tx: Database.Database,
  p: PettyCashAdvancedPayload | PettyCashOutPayload | PettyCashInPayload,
  kind: 'advance' | 'out' | 'in',
  sign: 1 | -1,
  at: number,
): void {
  tx.prepare(
    `INSERT INTO petty_cash (entry_id, shift_id, kind, amount_minor, category_id, advance_staff_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(p.entry_id, p.shift_id, kind, p.amount_minor, p.category_id, p.advance_staff_id, at);
  tx.prepare('UPDATE shifts SET expected_cash_minor = expected_cash_minor + ? WHERE shift_id = ?').run(sign * p.amount_minor, p.shift_id);
}
