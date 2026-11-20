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
  const shown = `${currencySymbol(currencyCode)} ${text}`;
  return minor < 0 ? `-${shown}` : shown;
}

/** The amount alone, no symbol ("150.00"), for a totals row whose currency the table head names. */
export function amountText(minor: number, currencyCode: string): string {
  return billMoney(minor, currencyCode).replace(/^(-?)\S+ /, '$1');
}

/** A signed amount alone ("+0.40", "-0.60", "0.00"): the rounding adjustment's row. */
export function signedAmountText(minor: number, currencyCode: string): string {
  // the frames' signs: "+0.40" and "−0.40" (U+2212)
  if (minor > 0) return `+${amountText(minor, currencyCode)}`;
  if (minor < 0) return `\u2212${amountText(-minor, currencyCode)}`;
  return amountText(0, currencyCode);
}

/** A rate in basis points as the screens show it: 500 → "5 %", 1250 → "12.5 %". */
export function rateText(bp: number): string {
  return `${Number((bp / 100).toFixed(2))} %`;
}

/** The `dir` of an element that shows money, in both languages. */
export const MONEY_DIR = 'ltr' as const;

/** Brief §3.1.1: "46 min", "1 h 05 min", "4 h 12 min" (Latin, unchanged in Urdu, frame OpenBillsUrdu). */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** H16-13: the hub's cap on a money amount (any currency). */
const MAX_MINOR = Math.min(1e12, Number.MAX_SAFE_INTEGER);

/**
 * Typed major units → minor units at `exponent` (row F-6), by string arithmetic (no float). Commas only as
 * thousands groups ("4,000.00"); decimals up to the exponent, extra trailing zeros allowed ("12.0" at 0). Null for
 * anything else, for 0, and above the hub's cap.
 */
export function parseMinor(text: string, exponent: number): number | null {
  const m = /^((?:[0-9]{1,3}(?:,[0-9]{3})+)|[0-9]+)(?:\.([0-9]+))?$/.exec(text.trim());
  if (m === null) return null;
  let frac = m[2] ?? '';
  if (frac.length > exponent) {
    if (!/^0+$/.test(frac.slice(exponent))) return null;
    frac = frac.slice(0, exponent);
  }
  const digits = ((m[1] as string).replaceAll(',', '') + frac.padEnd(exponent, '0')).replace(/^0+(?=\d)/, '');
  if (digits.length > 16) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_MINOR ? value : null;
}

/** Typed percent → basis points 1–10 000, at most 2 decimals ("12.5" → 1250), by string arithmetic; else null. */
export function parsePercentBp(text: string): number | null {
  const m = /^([0-9]{1,3})(?:\.([0-9]{1,2}))?$/.exec(text.trim());
  if (m === null) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp >= 1 && bp <= 10_000 ? bp : null;
}

/** The symbol a money field shows: "Rs" for PKR (as billMoney), else the ISO code. */
export function currencySymbol(currencyCode: string): string {
  return currencyCode === 'PKR' ? 'Rs' : currencyCode;
}
