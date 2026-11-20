import { currencyExponent } from '@pos/domain';

// 05 §8 i18n (D47, J-1, row F-6): amounts are formatted only here, with the currency's ISO 4217 exponent — never a
// hard-coded 2 decimals. PKR reads "Rs 6,624.00" (the 02b / brief look); another code is its own symbol
// ("KWD 6.624"). Latin digits in both languages (R20); the element showing it is set LTR (`MONEY_DIR`).

/** "Rs 6,624.00" for 662400 PKR; "-Rs 1,462.00" for a negative amount. Throws on a non-integer or unknown code. */
export function billMoney(minor: number, currencyCode: string): string {
  if (!Number.isSafeInteger(minor)) throw new Error('billMoney: minor units must be a safe integer');
  const exponent = currencyExponent(currencyCode);
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = exponent === 0 ? whole : `${whole}.${digits.slice(digits.length - exponent)}`;
  const shown = `${currencyCode === 'PKR' ? 'Rs' : currencyCode} ${text}`;
  return minor < 0 ? `-${shown}` : shown;
}

/** The `dir` of an element that shows money, in both languages. */
export const MONEY_DIR = 'ltr' as const;

/** Brief §3.1.1: "46 min", "1 h 05 min", "4 h 12 min" (Latin, unchanged in Urdu, frame OpenBillsUrdu). */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
