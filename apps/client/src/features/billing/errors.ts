import { en, errorKey, type MessageKey } from '../../i18n/en';

// 05 §8 "Errors" / §9 (plan §3.1 task 43a): the texts of 05-1's §9 codes and the labels of 05-1's alert kinds
// (§3.14, §3.15). 05-2's codes (petty cash, Z, day close, skip count) and kinds (petty_cash, shift_variance) are 43b's.

/** Every 05-1 §9 key, reason / state variants included (brief §6.8). */
export const BILLING_ERROR_KEYS_05_1 = [
  'errors.BILL_NOT_FOUND',
  'errors.SHIFT_NOT_FOUND',
  'errors.INVOICE_NOT_FOUND',
  'errors.PAYMENT_NOT_FOUND',
  'errors.PAYMENT_MODE_NOT_FOUND',
  'errors.BILL_NOT_OPEN',
  'errors.BILL_NOT_OPEN_cancelled',
  'errors.BILL_CLOSE_BLOCKED',
  'errors.DISCOUNT_PENDING',
  'errors.SERVICE_CHARGE_NOT_APPLIED',
  'errors.BUYER_ID_REQUIRED',
  'errors.BILL_TOTAL_CHANGED',
  'errors.BILL_BALANCE_DUE',
  'errors.BILL_PARTLY_PAID',
  'errors.LINE_IN_CLOSED_SPLIT',
  'errors.BILL_HAS_PAYMENTS',
  'errors.BILL_HAS_PAYMENTS_tables',
  'errors.BILL_REOPEN_PENDING',
  'errors.BILL_REOPEN_NOT_SUPPORTED',
  'errors.LINE_NOT_COMPED',
  'errors.SHIFT_NOT_OPEN.no_shift',
  'errors.SHIFT_NOT_OPEN.no_drawer_shift',
  'errors.SHIFT_NOT_OPEN.not_open',
  'errors.SHIFT_NOT_OPEN.payment_shift_closed',
  'errors.SHIFT_ALREADY_OPEN',
  'errors.DRAWER_IN_USE',
  'errors.BILL_SPLIT_INVALID.units_missing',
  'errors.BILL_SPLIT_INVALID.units_exceed',
  'errors.BILL_SPLIT_INVALID.deal_whole',
  'errors.BILL_SPLIT_INVALID.option_with_parent',
  'errors.BILL_SPLIT_INVALID.shares_sum',
  'errors.BILL_SPLIT_INVALID.split_closed',
  'errors.DISCOUNT_TOO_LARGE',
  'errors.PAYMENT_MODE_NOT_FISCAL',
  'errors.PAYMENT_EXCEEDS_BALANCE',
  'errors.PAYMENT_EXCEEDS_BALANCE_zero_in',
  'errors.PAYMENT_EXCEEDS_BALANCE_zero_out',
  'errors.PAYMENT_REFERENCE_REQUIRED',
  'errors.PAYMENT_CASH_STEP',
  'errors.DRAWER_DEVICE_INVALID',
  'errors.PERMISSION_DENIED.not_own_payment',
  'errors.PERMISSION_DENIED.outside_scope',
] as const satisfies readonly MessageKey[];

/** 05-1's kinds (§3.14 discount … close_without_buyer_id; §3.15 fiscal_outbox_stuck): `alert.<kind>.*` (brief §6.7). */
export const BILLING_KIND_KEYS_05_1 = [
  ...(['discount', 'remove_service_charge', 'reopen_bill', 'remove_comp', 'close_without_buyer_id', 'fiscal_outbox_stuck'] as const).flatMap(
    (kind) => [`alert.${kind}.name`, `alert.${kind}.card`, `alert.${kind}.lock`] as const,
  ),
  'alert.fiscal_outbox_stuck.help',
] as const satisfies readonly MessageKey[];

/** §9 codes whose `details.reason` picks the text (`errors.<code>.<reason>`). */
const BY_REASON = new Set(['SHIFT_NOT_OPEN', 'BILL_SPLIT_INVALID', 'PERMISSION_DENIED']);

const has = (key: string): key is MessageKey => key in en;

/**
 * The text key for a billing refusal (`409` / `422` / `404` / `403` with its `details`). `direction` is the payment's
 * own (`AddPayment`): a `PAYMENT_EXCEEDS_BALANCE` at `balance_minor: 0` reads "nothing left" (in) or "nothing to give
 * back" (out). A key the catalogue lacks reads the generic text, never the raw code.
 */
export function billingErrorKey(
  code: string,
  details: Record<string, unknown>,
  ctx: { direction?: 'in' | 'out' } = {},
): MessageKey {
  if (BY_REASON.has(code)) {
    const reason = details['reason'];
    const key = `errors.${code}.${typeof reason === 'string' ? reason : ''}`;
    // an unknown reason, or a PERMISSION_DENIED `{ permission, grant }` (no reason; the caller routes it to the 01d
    // approval / permission UI), and BILL_CLOSE_BLOCKED's reasons are shown as `billing.blocks.*` by the bill screen:
    // the generic text (PERMISSION_DENIED's own errors.* text is the owner app's tenant-wide one)
    return has(key) ? key : 'errors.UNKNOWN';
  }
  if (code === 'BILL_NOT_OPEN' && details['state'] === 'cancelled') return 'errors.BILL_NOT_OPEN_cancelled';
  if (code === 'BILL_HAS_PAYMENTS' && !Array.isArray(details['split_nos'])) return 'errors.BILL_HAS_PAYMENTS_tables';
  if (code === 'PAYMENT_EXCEEDS_BALANCE' && details['balance_minor'] === 0 && ctx.direction !== undefined) {
    return ctx.direction === 'in' ? 'errors.PAYMENT_EXCEEDS_BALANCE_zero_in' : 'errors.PAYMENT_EXCEEDS_BALANCE_zero_out';
  }
  return errorKey(code);
}
