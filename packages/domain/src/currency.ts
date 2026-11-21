// 05 row F-6 (Foundation v1.14 §6 Money, D47): one major unit = 10^exponent minor units, the
// exponent being the currency's ISO 4217 minor-unit digits (PKR 2). An unknown code is refused.
// Browser-safe: no node:* import.

/** The minor-unit digits ISO 4217 assigns (the only values in the table). */
export type CurrencyExponent = 0 | 2 | 3 | 4;

/**
 * ISO 4217 list one, active codes with a numeric minor unit, as of amendment 180 (BGN withdrawn
 * 2026-01-01; XCG replaces ANG; ZWG replaces ZWL; SLE replaces SLL). CUC is left out (no longer
 * issued). Codes whose minor unit is "N.A." (precious metals, XDR, XSU, XUA, the bond-market
 * units, XTS, XXX) have no exponent and are refused, as is every withdrawn code.
 */
const MINOR_UNITS: Readonly<Record<string, CurrencyExponent>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, CurrencyExponent>, {
    // exponent 0
    BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0,
    UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
    // exponent 3
    BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
    // exponent 4
    CLF: 4, UYW: 4,
    // exponent 2
    AED: 2, AFN: 2, ALL: 2, AMD: 2, AOA: 2, ARS: 2, AUD: 2, AWG: 2, AZN: 2, BAM: 2, BBD: 2,
    BDT: 2, BMD: 2, BND: 2, BOB: 2, BOV: 2, BRL: 2, BSD: 2, BTN: 2, BWP: 2, BYN: 2,
    BZD: 2, CAD: 2, CDF: 2, CHE: 2, CHF: 2, CHW: 2, CNY: 2, COP: 2, COU: 2, CRC: 2, CUP: 2,
    CVE: 2, CZK: 2, DKK: 2, DOP: 2, DZD: 2, EGP: 2, ERN: 2, ETB: 2, EUR: 2, FJD: 2, FKP: 2,
    GBP: 2, GEL: 2, GHS: 2, GIP: 2, GMD: 2, GTQ: 2, GYD: 2, HKD: 2, HNL: 2, HTG: 2, HUF: 2,
    IDR: 2, ILS: 2, INR: 2, IRR: 2, JMD: 2, KES: 2, KGS: 2, KHR: 2, KPW: 2, KYD: 2, KZT: 2,
    LAK: 2, LBP: 2, LKR: 2, LRD: 2, LSL: 2, MAD: 2, MDL: 2, MGA: 2, MKD: 2, MMK: 2, MNT: 2,
    MOP: 2, MRU: 2, MUR: 2, MVR: 2, MWK: 2, MXN: 2, MXV: 2, MYR: 2, MZN: 2, NAD: 2, NGN: 2,
    NIO: 2, NOK: 2, NPR: 2, NZD: 2, PAB: 2, PEN: 2, PGK: 2, PHP: 2, PKR: 2, PLN: 2, QAR: 2,
    RON: 2, RSD: 2, RUB: 2, SAR: 2, SBD: 2, SCR: 2, SDG: 2, SEK: 2, SGD: 2, SHP: 2, SLE: 2,
    SOS: 2, SRD: 2, SSP: 2, STN: 2, SVC: 2, SYP: 2, SZL: 2, THB: 2, TJS: 2, TMT: 2, TOP: 2,
    TRY: 2, TTD: 2, TWD: 2, TZS: 2, UAH: 2, USD: 2, USN: 2, UYU: 2, UZS: 2, VED: 2, VES: 2,
    WST: 2, XCD: 2, XCG: 2, YER: 2, ZAR: 2, ZMW: 2, ZWG: 2,
  }),
);

/** Every code in the table, sorted (for tests and callers that list currencies). */
export const ISO_4217_CODES: readonly string[] = Object.freeze(Object.keys(MINOR_UNITS).sort());

/**
 * Thrown when a currency code is not in the ISO 4217 table (row F-6). Not a §9 error code: a caller on
 * an HTTP or CLI path maps it to its own error (seed-tenant, row H-5). Carries at most 8 characters of input.
 */
export class UnknownCurrencyError extends Error {
  readonly code = 'unknown_currency' as const;
  readonly currency_code: string;
  constructor(currency_code: string) {
    const shown = currency_code.slice(0, 8);
    super(`currencyExponent: unknown ISO 4217 currency code ${JSON.stringify(shown)}`);
    this.name = 'UnknownCurrencyError';
    this.currency_code = shown;
  }
}

/** ISO 4217 minor-unit digits of `code` (PKR → 2). Exact, case-sensitive; unknown → UnknownCurrencyError. */
export function currencyExponent(code: string): CurrencyExponent {
  if (!Object.hasOwn(MINOR_UNITS, code)) throw new UnknownCurrencyError(code);
  return MINOR_UNITS[code] as CurrencyExponent;
}
