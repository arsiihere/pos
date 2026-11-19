// 05 §3.4–§3.8 (B4–B10): pure split arithmetic for bills — tax lists per profile (simple / compound, ≤ 4), the
// inclusive back-calculation, the whole-bill discount spread with the R3 cap, the sticky service charge, `higher_rate`,
// the untaxed rounding adjustment, the four dues and the refund dues, and item / amount / equal splits.
// Integer minor units in and out; BigInt inside; half up only at the points §3.5 names. No I/O, no event, no snapshot
// parser: the hub maps the snapshot and the bill's events onto these plain types. Browser-safe.
import { allocateDealMinor, type LineKind } from '../menu-lines.js';
import type {
  DISCOUNT_KINDS,
  MIXED_CLASS_RULES,
  PAYMENT_CLASSES,
  ROUNDING_APPLIES_TO,
  ROUNDING_METHODS,
} from './types.js';

type PaymentClass = (typeof PAYMENT_CLASSES)[number];
type IntegrationStatus = 'integrated' | 'not_integrated';

// ---------------------------------------------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------------------------------------------

/** One live bill line (§3.1, §3.4) in the open part of the bill. */
export interface ComputeLine {
  order_item_id: string;
  /** §3.4: an item, deal and option child are taxed under their own profile; a deal part never (base 0). */
  line_kind: LineKind;
  /** Live units in the open part (units invoiced by a closed split excluded). */
  units: number;
  unit_price_minor: number;
  /** Open base: the §3.1 line base minus Σ its closed-split shares (H2-2), in the bill's price mode. */
  base_minor: number;
  /** The line's tax profile (01a tax class, `ItemAdded.tax_class_id`); null = untaxed. */
  tax_profile_id: string | null;
}

/** One rate row of a tax (row A-1 `jurisdiction_tax_rates`, overrides already applied by the snapshot). */
export interface ComputeTaxRate {
  payment_class: PaymentClass;
  integration_status: IntegrationStatus;
  /** `YYYY-MM-DD`; the row is in force on and after this business date. */
  effective_from: string;
  rate_bp: number;
  ref: string | null;
}

export interface ComputeTax {
  seq: number;
  tax_code: string;
  label: string;
  /** Compound = charged on the base plus the taxes before it in the list. */
  compound: boolean;
  rates: readonly ComputeTaxRate[];
}

/** A tax profile resolved for the branch's jurisdiction: its ordered list of 1–4 taxes (§3.4). */
export interface ComputeTaxProfile {
  tax_profile_id: string;
  taxes: readonly ComputeTax[];
}

export interface ComputeRules {
  /** 01a S34: no line or charge is taxed while false. */
  tax_enabled: boolean;
  /** The bill's frozen price mode (`bills.prices_include_tax`, H9-9). */
  prices_include_tax: boolean;
  /** The bill's frozen rounding rule (`bills.rounding_json`, H16-2); step null = no rounding. */
  rounding: {
    step_minor: number | null;
    mode: (typeof ROUNDING_METHODS)[number];
    applies_to: (typeof ROUNDING_APPLIES_TO)[number];
  };
  mixed_class_rule: (typeof MIXED_CLASS_RULES)[number];
  /** The branch's fiscal integration status; picks the rate rows. */
  integration_status: IntegrationStatus;
  /** ISO 4217 minor-unit digits of the bill's currency (row F-6). Nothing here assumes 100 minor units. */
  currency_exponent: number;
}

/**
 * The bill's discount (§3.5 (2), B7). `value`: an amount in minor units, or a percent in basis points.
 * `frozen` is set after the first split close: the frozen amount, Σ the closed splits' D, and `bill_discount_lines`.
 */
export interface ComputeDiscount {
  kind: (typeof DISCOUNT_KINDS)[number];
  value: number;
  frozen: null | { amount_minor: number; closed_discount_minor: number; line_ids: readonly string[] };
}

/** The bill's sticky service charge (B8): its rate, whether it was removed, and the profile that taxes it. */
export interface ComputeServiceCharge {
  rate_bp: number;
  removed: boolean;
  tax_profile_id: string | null;
  source?: 'rule' | 'manual';
}

/** The open splits' plan (§3.8). `none` = the open remainder as one split. */
export type ComputePlan =
  | { mode: 'none'; split_no: number }
  | { mode: 'items'; splits: ReadonlyArray<{ split_no: number; lines: ReadonlyArray<{ order_item_id: string; units: number }> }> }
  | { mode: 'amount'; splits: ReadonlyArray<{ split_no: number; share_minor: number }> }
  | { mode: 'equal'; splits: ReadonlyArray<{ split_no: number }> };

/** One live payment of an open split. `tendered_minor` only on a cash `in` (absent = exact). */
export interface ComputePayment {
  split_no: number;
  payment_class: PaymentClass;
  direction: 'in' | 'out';
  amount_minor: number;
  tendered_minor?: number | null;
}

export interface ComputeBillInput {
  /** `YYYY-MM-DD`, the issue date the rate rows are read for (B5). */
  business_date: string;
  rules: ComputeRules;
  tax_profiles: readonly ComputeTaxProfile[];
  /** Lines in the order they were added (ties in every allocation go to the earlier line). */
  lines: readonly ComputeLine[];
  discount: ComputeDiscount | null;
  service_charge: ComputeServiceCharge | null;
  plan: ComputePlan;
  payments: readonly ComputePayment[];
}

/**
 * One line of one split: its units, base part and discount share. Item split: the assigned units; amount / equal
 * split: the line's live units (the whole line freezes at that close, §5 `closed_split_units`, H1-27).
 */
export interface ComputeSplitLine {
  order_item_id: string;
  line_kind: LineKind;
  units: number;
  unit_price_minor: number;
  base_minor: number;
  discount_minor: number;
  tax_profile_id: string | null;
}

export interface ComputeSplitInput {
  split_no: number;
  business_date: string;
  rules: ComputeRules;
  tax_profiles: readonly ComputeTaxProfile[];
  lines: readonly ComputeSplitLine[];
  service_charge: ComputeServiceCharge | null;
  /** This split's live payments. */
  payments: readonly ComputePayment[];
}

// ---------------------------------------------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------------------------------------------

/** One tax row per (profile, tax code, payment class) (§3.5 (6), §6.1 `Totals.taxes`). */
export interface ComputeTaxRow {
  tax_profile_id: string;
  tax_code: string;
  label: string;
  seq: number;
  compound: boolean;
  payment_class: PaymentClass;
  rate_bp: number;
  rate_ref: string | null;
  base_minor: number;
  tax_minor: number;
}

/** §6.1 `Totals`, plus the pre-tax net `N` and the exact total `G` (§3.5 (3), (6)). */
export interface ComputeTotals {
  subtotal_minor: number;
  discount_minor: number;
  pre_tax_net_minor: number;
  service_charge_minor: number;
  taxes: ComputeTaxRow[];
  exact_total_minor: number;
  rounding_minor: number;
  total_minor: number;
}

export interface ComputeBlock {
  reason: 'tax_unresolved' | 'shares_sum';
  ids: string[];
}

export interface ComputeSplitResult {
  split_no: number;
  /** §3.5 (5): from the live `in` payments only. */
  payment_class: PaymentClass;
  mixed_rule: (typeof MIXED_CLASS_RULES)[number];
  totals: { cash: ComputeTotals; digital: ComputeTotals; as_paid: ComputeTotals };
  lines: ComputeSplitLine[];
  paid_cash_minor: number;
  paid_digital_minor: number;
  balance_minor: number;
  card_due_minor: number;
  cash_due_minor: number;
  card_refund_due_minor: number;
  cash_refund_due_minor: number;
  rounding_minor: number;
  change_minor: number;
  blocks: ComputeBlock[];
}

export interface ComputeBillResult {
  splits: ComputeSplitResult[];
  /** The open remainder as one unpaid split at the default class (cash): the check bill and the amount-plan total. */
  totals_default: ComputeTotals;
  /**
   * The same open remainder at the digital class (§3.5 (5), all digital → digital): the check bill's "total if paid
   * by card" line (§6.3, B17; 05-gaps G-25). Rounded by the bill's frozen rule (§3.5 (7)): under `applies_to: 'cash'`
   * it is not rounded, under `'all'` it is.
   */
  totals_default_digital: ComputeTotals;
  /** Σ the open lines' discount shares. */
  discount_minor: number;
  lines: Array<{ order_item_id: string; discount_minor: number; tags: Array<'tax_unresolved'> }>;
  blocks: ComputeBlock[];
}

// ---------------------------------------------------------------------------------------------------------------
// Integer helpers
// ---------------------------------------------------------------------------------------------------------------

const BP = 10_000n;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(msg: string): never {
  throw new Error(`compute: ${msg}`);
}

function nonNeg(name: string, n: number): bigint {
  if (!Number.isSafeInteger(n) || n < 0) fail(`${name} must be a non-negative safe integer`);
  return BigInt(n);
}

function toSafe(name: string, n: bigint): number {
  const out = Number(n);
  if (!Number.isSafeInteger(out)) fail(`${name} is not a safe integer`);
  return out;
}

/** round_half_up(num / den) for num ≥ 0, den > 0. */
function halfUp(num: bigint, den: bigint): bigint {
  if (num < 0n || den <= 0n) fail('halfUp needs num ≥ 0 and den > 0');
  return (2n * num + den) / (2n * den);
}

function apportionBig(total: bigint, weights: readonly bigint[]): bigint[] {
  if (total === 0n) return weights.map(() => 0n);
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) fail('apportion: a non-zero total over zero weights');
  const shares = weights.map((w) => (total * w) / sum);
  const rems = weights.map((w) => (total * w) % sum);
  let left = total - shares.reduce((a, b) => a + b, 0n);
  const order = weights.map((_, i) => i).sort((a, b) => {
    const ra = rems[a] as bigint;
    const rb = rems[b] as bigint;
    return ra === rb ? a - b : ra > rb ? -1 : 1;
  });
  for (const i of order) {
    if (left === 0n) break;
    shares[i] = (shares[i] as bigint) + 1n;
    left -= 1n;
  }
  return shares;
}

/**
 * §3.5 (6) H16-12: `floor(total × w_k / Σ w)` each, the left-over minor units one each to the largest fractional
 * parts, ties to the earlier entry; Σ = total, never negative. Weights are any non-negative integers in a common unit.
 */
export function apportionMinor(totalMinor: number, weights: readonly number[]): number[] {
  const total = nonNeg('apportionMinor total', totalMinor);
  const ws = weights.map((w) => nonNeg('apportionMinor weight', w));
  return apportionBig(total, ws).map((s) => toSafe('apportionMinor share', s));
}

function cappedBig(total: bigint, caps: readonly bigint[]): bigint[] {
  const sum = caps.reduce((a, b) => a + b, 0n);
  if (total > sum) fail('allocateCappedMinor: total exceeds Σ caps');
  const shares = apportionBig(total, caps);
  shares.forEach((s, i) => {
    if (s > (caps[i] as bigint)) fail('allocateCappedMinor: share above its cap');
  });
  return shares;
}

/**
 * §3.5 (2) H1-4: largest-remainder allocation of `totalMinor` by the caps as weights; `0 ≤ share ≤ cap` always
 * (property #10d); a total above Σ caps is refused.
 */
export function allocateCappedMinor(totalMinor: number, capsMinor: readonly number[]): number[] {
  const total = nonNeg('allocateCappedMinor total', totalMinor);
  const caps = capsMinor.map((c) => nonNeg('allocateCappedMinor cap', c));
  return cappedBig(total, caps).map((s) => toSafe('allocateCappedMinor share', s));
}

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------

function checkRules(rules: ComputeRules, business_date: string): void {
  if (!DATE_RE.test(business_date)) fail('business_date must be YYYY-MM-DD');
  if (rules.mixed_class_rule !== 'higher_rate') fail('mixed_class_rule must be higher_rate (v1.0, §3.6)');
  const { step_minor, mode, applies_to } = rules.rounding;
  if (step_minor !== null && (!Number.isSafeInteger(step_minor) || step_minor < 1)) fail('rounding step must be null or ≥ 1');
  if (mode !== 'nearest' && mode !== 'down' && mode !== 'up') fail('rounding mode');
  if (applies_to !== 'all' && applies_to !== 'cash') fail('rounding applies_to');
  if (!Number.isInteger(rules.currency_exponent) || rules.currency_exponent < 0 || rules.currency_exponent > 4) {
    fail('currency_exponent must be an integer 0–4');
  }
}

function checkServiceCharge(sc: ComputeServiceCharge | null): void {
  if (sc === null) return;
  nonNeg('service charge rate_bp', sc.rate_bp);
}

function checkPayments(payments: readonly ComputePayment[]): void {
  for (const p of payments) {
    nonNeg('payment amount_minor', p.amount_minor);
    if (p.payment_class !== 'cash' && p.payment_class !== 'digital') fail('payment class');
    if (p.direction !== 'in' && p.direction !== 'out') fail('payment direction');
    if (p.tendered_minor !== undefined && p.tendered_minor !== null) {
      if (p.payment_class !== 'cash' || p.direction !== 'in') fail('tendered_minor only on a cash in');
      if (nonNeg('tendered_minor', p.tendered_minor) < BigInt(p.amount_minor)) fail('tendered_minor below amount_minor');
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tax resolution (§3.4, B5)
// ---------------------------------------------------------------------------------------------------------------

interface ResolvedTax {
  seq: number;
  tax_code: string;
  label: string;
  compound: boolean;
  rate: Record<PaymentClass, { rate_bp: bigint; ref: string | null }>;
}

/** The profile's taxes in list order with the rate row in force per class, or null when unresolved (§3.4). */
type Resolution = Map<string, ResolvedTax[] | null>;

function rateInForce(
  tax: ComputeTax,
  k: PaymentClass,
  status: IntegrationStatus,
  date: string,
): { rate_bp: bigint; ref: string | null } | null {
  let best: ComputeTaxRate | null = null;
  const keys = new Set<string>();
  for (const r of tax.rates) {
    if (!DATE_RE.test(r.effective_from)) fail(`rate effective_from of ${tax.tax_code}`);
    nonNeg('rate_bp', r.rate_bp);
    if (r.rate_bp > 10_000) fail('rate_bp above 10 000');
    const key = `${r.payment_class}|${r.integration_status}|${r.effective_from}`;
    if (keys.has(key)) fail(`two rate rows for ${tax.tax_code} with one key`);
    keys.add(key);
    if (r.payment_class !== k || r.integration_status !== status || r.effective_from > date) continue;
    if (best === null || r.effective_from > best.effective_from) best = r;
  }
  return best === null ? null : { rate_bp: BigInt(best.rate_bp), ref: best.ref };
}

function resolveProfiles(profiles: readonly ComputeTaxProfile[], rules: ComputeRules, date: string): Resolution {
  const out: Resolution = new Map();
  for (const p of profiles) {
    if (out.has(p.tax_profile_id)) fail(`duplicate tax profile ${p.tax_profile_id}`);
    if (p.taxes.length > 4) fail(`profile ${p.tax_profile_id} has more than 4 taxes`);
    const taxes = [...p.taxes].sort((a, b) => a.seq - b.seq);
    const codes = new Set<string>();
    let resolved: ResolvedTax[] | null = taxes.length === 0 ? null : [];
    for (let i = 0; i < taxes.length; i++) {
      const t = taxes[i] as ComputeTax;
      if (i > 0 && t.seq === (taxes[i - 1] as ComputeTax).seq) fail(`duplicate seq in profile ${p.tax_profile_id}`);
      if (codes.has(t.tax_code)) fail(`duplicate tax_code in profile ${p.tax_profile_id}`);
      codes.add(t.tax_code);
      const cash = rateInForce(t, 'cash', rules.integration_status, date);
      const digital = rateInForce(t, 'digital', rules.integration_status, date);
      if (cash === null || digital === null) resolved = null;
      else if (resolved !== null) resolved.push({ seq: t.seq, tax_code: t.tax_code, label: t.label, compound: t.compound, rate: { cash, digital } });
    }
    out.set(p.tax_profile_id, resolved);
  }
  return out;
}

/** The profile a line is taxed under (§3.4), or null when the line is untaxed. */
function lineProfile(line: { line_kind: LineKind; tax_profile_id: string | null }, rules: ComputeRules): string | null {
  if (!rules.tax_enabled || line.line_kind === 'deal_part') return null;
  return line.tax_profile_id;
}

function isUnresolved(profile: string | null, res: Resolution): boolean {
  return profile !== null && (res.get(profile) ?? null) === null;
}

/** The id a `tax_unresolved` block names for an applied service charge whose profile does not resolve. */
export const SERVICE_CHARGE_ID = 'service_charge';

function serviceChargeUnresolved(sc: ComputeServiceCharge | null, rules: ComputeRules, res: Resolution): boolean {
  if (sc === null || sc.removed) return false;
  return isUnresolved(lineProfile({ line_kind: 'item', tax_profile_id: sc.tax_profile_id }, rules), res);
}

// ---------------------------------------------------------------------------------------------------------------
// One split at one payment class (§3.5 (1)–(6))
// ---------------------------------------------------------------------------------------------------------------

interface Group {
  profile: string;
  a: bigint; // A_p: Σ (base − discount) of the profile's lines, in the bill's price mode
}

interface ExactTotals {
  subtotal: bigint;
  discount: bigint;
  net: bigint;
  sc: bigint;
  /** The profile the charge is taxed under; null = untaxed (none, tax disabled or unresolved). */
  scProfile: string | null;
  taxes: Array<Omit<ComputeTaxRow, 'base_minor' | 'tax_minor'> & { base: bigint; tax: bigint }>;
  exact: bigint;
}

function exactAt(
  k: PaymentClass,
  lines: readonly ComputeSplitLine[],
  sc: ComputeServiceCharge | null,
  rules: ComputeRules,
  res: Resolution,
): ExactTotals {
  let subtotal = 0n;
  let discount = 0n;
  let untaxed = 0n;
  const groups: Group[] = [];
  const byProfile = new Map<string, Group>();
  for (const l of lines) {
    const base = BigInt(l.base_minor);
    const d = BigInt(l.discount_minor);
    subtotal += base;
    discount += d;
    const p = lineProfile(l, rules);
    if (p === null || isUnresolved(p, res)) {
      untaxed += base - d;
      continue;
    }
    let g = byProfile.get(p);
    if (g === undefined) {
      g = { profile: p, a: 0n };
      byProfile.set(p, g);
      groups.push(g);
    }
    g.a += base - d;
  }

  // (3) pre-tax net per profile; inclusive: one rounding per profile on the exact rational back-calculation.
  const perProfile = groups.map((g) => {
    const taxes = res.get(g.profile) as ResolvedTax[];
    const n = taxes.length;
    const den = BP ** BigInt(n);
    const aNum: bigint[] = [];
    let earlier = 0n; // Σ_{j<k} a_j, numerators over den
    for (const t of taxes) {
      const r = t.rate[k].rate_bp;
      const a = t.compound ? (r * (den + earlier)) / BP : r * BP ** BigInt(n - 1);
      aNum.push(a);
      earlier += a;
    }
    let included = 0n;
    if (rules.prices_include_tax && earlier > 0n) included = halfUp(g.a * earlier, den + earlier);
    return { g, taxes, aNum, included, net: g.a - included };
  });
  const net = untaxed + perProfile.reduce((s, x) => s + x.net, 0n);

  // (4) service charge on the pre-tax net, never tax-inclusive, taxed under its profile.
  const scAmount = sc === null || sc.removed ? 0n : halfUp(net * BigInt(sc.rate_bp), BP);
  const scProfileRaw = sc === null || sc.removed ? null : lineProfile({ line_kind: 'item', tax_profile_id: sc.tax_profile_id }, rules);
  const scProfile = scProfileRaw !== null && !isUnresolved(scProfileRaw, res) ? scProfileRaw : null;
  if (scProfile !== null && scAmount > 0n && !byProfile.has(scProfile)) {
    const taxes = res.get(scProfile) as ResolvedTax[];
    const g = { profile: scProfile, a: 0n };
    byProfile.set(scProfile, g);
    perProfile.push({ g, taxes, aNum: taxes.map(() => 0n), included: 0n, net: 0n });
  }

  // (6) taxes per profile in list order: the exclusive part rounded at each tax, the included part apportioned.
  const rows: ExactTotals['taxes'] = [];
  for (const pp of perProfile) {
    const scPart = pp.g.profile === scProfile ? scAmount : 0n;
    const exclusivePart = (rules.prices_include_tax ? 0n : pp.net) + scPart;
    const includedShares = apportionBig(pp.included, pp.aNum);
    let earlierExclusive = 0n;
    let earlierRows = 0n;
    pp.taxes.forEach((t, i) => {
      const r = t.rate[k];
      const exBase = exclusivePart + (t.compound ? earlierExclusive : 0n);
      const exTax = halfUp(exBase * r.rate_bp, BP);
      const tax = exTax + (includedShares[i] as bigint);
      const base = pp.net + scPart + (t.compound ? earlierRows : 0n);
      earlierExclusive += exTax;
      earlierRows += tax;
      rows.push({
        tax_profile_id: pp.g.profile,
        tax_code: t.tax_code,
        label: t.label,
        seq: t.seq,
        compound: t.compound,
        payment_class: k,
        rate_bp: Number(r.rate_bp),
        rate_ref: r.ref,
        base,
        tax,
      });
    });
  }
  const exact = net + scAmount + rows.reduce((s, x) => s + x.tax, 0n);
  return { subtotal, discount, net, sc: scAmount, scProfile, taxes: rows, exact };
}

// ---------------------------------------------------------------------------------------------------------------
// Rounding (§3.5 (7), B9)
// ---------------------------------------------------------------------------------------------------------------

function rnd(x: bigint, rules: ComputeRules): bigint {
  const step = rules.rounding.step_minor;
  if (step === null) return x;
  const s = BigInt(step);
  const q = x / s;
  const rem = x % s;
  if (rem === 0n) return x;
  const down = q * s;
  switch (rules.rounding.mode) {
    case 'down':
      return down;
    case 'up':
      return down + s;
    case 'nearest':
      return 2n * rem >= s ? down + s : down;
  }
}

function floorStep(x: bigint, rules: ComputeRules): bigint {
  const step = rules.rounding.step_minor;
  if (step === null || x <= 0n) return x;
  const s = BigInt(step);
  return x - (x % s);
}

/** R for a split of class `k` (§3.5 (7)): `all` → every split; `cash` → only while the split's class is cash. */
function roundingFor(exact: bigint, k: PaymentClass, rules: ComputeRules): bigint {
  if (rules.rounding.step_minor === null) return 0n;
  if (rules.rounding.applies_to === 'cash' && k !== 'cash') return 0n;
  return rnd(exact, rules) - exact;
}

function totalsAt(
  k: PaymentClass,
  lines: readonly ComputeSplitLine[],
  sc: ComputeServiceCharge | null,
  rules: ComputeRules,
  res: Resolution,
): { totals: ComputeTotals; total: bigint } {
  const e = exactAt(k, lines, sc, rules, res);
  const r = roundingFor(e.exact, k, rules);
  const total = e.exact + r;
  return {
    total,
    totals: {
      subtotal_minor: toSafe('subtotal', e.subtotal),
      discount_minor: toSafe('discount', e.discount),
      pre_tax_net_minor: toSafe('net', e.net),
      service_charge_minor: toSafe('service charge', e.sc),
      taxes: e.taxes.map(({ base, tax, ...row }) => ({ ...row, base_minor: toSafe('tax base', base), tax_minor: toSafe('tax', tax) })),
      exact_total_minor: toSafe('exact total', e.exact),
      rounding_minor: toSafe('rounding', r),
      total_minor: toSafe('total', total),
    },
  };
}

/** §3.5 (5): from the live `in` payments only; both classes → the mixed rule (v1.0: higher_rate = cash). */
function classOf(hasCash: boolean, hasDigital: boolean): PaymentClass {
  if (hasDigital && !hasCash) return 'digital';
  return 'cash';
}

function checkSplitLines(lines: readonly ComputeSplitLine[]): void {
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.order_item_id)) fail(`duplicate line ${l.order_item_id} in a split`);
    seen.add(l.order_item_id);
    const base = nonNeg('base_minor', l.base_minor);
    if (nonNeg('discount_minor', l.discount_minor) > base) fail(`discount above base on ${l.order_item_id}`);
    nonNeg('unit_price_minor', l.unit_price_minor);
    nonNeg('units', l.units);
    if (l.line_kind === 'deal_part' && l.base_minor !== 0) fail(`deal part ${l.order_item_id} must have base 0 (§3.4)`);
  }
}

function splitResult(input: ComputeSplitInput, res: Resolution): ComputeSplitResult {
  const { lines, service_charge: sc, rules, payments } = input;
  checkSplitLines(lines);
  let hasCash = false;
  let hasDigital = false;
  let paidCash = 0n;
  let paidDigital = 0n;
  let change = 0n;
  for (const p of payments) {
    if (p.split_no !== input.split_no) fail('a payment of another split');
    const amt = BigInt(p.amount_minor);
    const signed = p.direction === 'in' ? amt : -amt;
    if (p.payment_class === 'cash') {
      paidCash += signed;
      if (p.direction === 'in') {
        hasCash = true;
        change += BigInt(p.tendered_minor ?? p.amount_minor) - amt;
      }
    } else {
      paidDigital += signed;
      if (p.direction === 'in') hasDigital = true;
    }
  }
  const cls = classOf(hasCash, hasDigital);
  const cash = totalsAt('cash', lines, sc, rules, res);
  const digital = totalsAt('digital', lines, sc, rules, res);
  const asPaid = cls === 'cash' ? cash : digital;
  const paid = paidCash + paidDigital;
  const balance = asPaid.total - paid;

  // §3.5 (7) the four due fields (H16-1, H15-5, H17-1): no payment due while the balance is ≤ 0.
  let cardDue = 0n;
  let cashDue = 0n;
  if (balance > 0n) {
    const withDigital = classOf(hasCash, true) === 'cash' ? cash.total : digital.total;
    cardDue = withDigital - paid > 0n ? withDigital - paid : 0n;
    cashDue = cash.total - paid > 0n ? cash.total - paid : 0n;
    if (rules.rounding.applies_to === 'cash') cashDue = floorStep(cashDue, rules);
  }
  const owed = balance < 0n ? -balance : 0n;
  const min = (a: bigint, b: bigint) => (a < b ? a : b);
  const cardRefundDue = min(paidDigital > 0n ? paidDigital : 0n, owed);
  let cashRefundDue = min(paidCash > 0n ? paidCash : 0n, owed);
  if (rules.rounding.applies_to === 'cash') cashRefundDue = floorStep(cashRefundDue, rules);

  const unresolved = lines.filter((l) => isUnresolved(lineProfile(l, rules), res)).map((l) => l.order_item_id);
  const scCharged = cash.totals.service_charge_minor > 0 || digital.totals.service_charge_minor > 0;
  if (scCharged && serviceChargeUnresolved(sc, rules, res)) unresolved.push(SERVICE_CHARGE_ID);
  const blocks: ComputeBlock[] = unresolved.length > 0 ? [{ reason: 'tax_unresolved', ids: unresolved }] : [];

  return {
    split_no: input.split_no,
    payment_class: cls,
    mixed_rule: rules.mixed_class_rule,
    totals: { cash: cash.totals, digital: digital.totals, as_paid: asPaid.totals },
    lines: lines.map((l) => ({ ...l })),
    paid_cash_minor: toSafe('paid cash', paidCash),
    paid_digital_minor: toSafe('paid digital', paidDigital),
    balance_minor: toSafe('balance', balance),
    card_due_minor: toSafe('card due', cardDue),
    cash_due_minor: toSafe('cash due', cashDue),
    card_refund_due_minor: toSafe('card refund due', cardRefundDue),
    cash_refund_due_minor: toSafe('cash refund due', cashRefundDue),
    rounding_minor: asPaid.totals.rounding_minor,
    change_minor: toSafe('change', change),
    blocks,
  };
}

/** One split's totals, tax rows, rounding, balance and dues (§3.5, §3.6, §3.7). Pure. */
export function computeSplit(input: ComputeSplitInput): ComputeSplitResult {
  checkRules(input.rules, input.business_date);
  checkServiceCharge(input.service_charge);
  checkPayments(input.payments);
  const res = resolveProfiles(input.tax_profiles, input.rules, input.business_date);
  return splitResult(input, res);
}

// ---------------------------------------------------------------------------------------------------------------
// Per-line tax spread (§6.12 step 6, J-2; 05-gaps G-8)
// ---------------------------------------------------------------------------------------------------------------

/** One tax of a line or of the service charge (§6.12 `InvoiceIssued.lines[].taxes[]`, `service_charge.taxes[]`). */
export interface ComputeSpreadTax {
  tax_code: string;
  payment_class: PaymentClass;
  rate_bp: number;
  /** R-19: the line's (or the charge's) taxable base for this tax. */
  base_minor: number;
  tax_minor: number;
}

export interface ComputeLineTaxes {
  /** The split's class (§3.5 (5)); every tax below is at its rates. */
  payment_class: PaymentClass;
  /** One entry per input line, in input order; an untaxed, unresolved or deal-part line has no taxes. */
  lines: Array<{ order_item_id: string; taxes: ComputeSpreadTax[] }>;
  /**
   * Null when there is no applied charge or its amount is 0 (R-21). `tax_profile_id` is the profile the charge is taxed under: null (no taxes)
   * when it is untaxed, tax is disabled, or its profile is unresolved (then the close is blocked, #13b).
   */
  service_charge: null | { amount_minor: number; tax_profile_id: string | null; taxes: ComputeSpreadTax[] };
}

/**
 * §6.12 step 6 (J-2), owner rulings R-18 / R-19 (2026-11-19, 05-gaps G-8). Per (profile, tax) row of the split's
 * as-paid totals:
 * - the service charge's part (R-18) is rounded on its own: `round_half_up(B × r / 10000)`, B = the charge amount
 *   for a simple tax, plus the charge's earlier parts of the profile for a compound one; it is `service_charge.taxes`,
 *   never in the lines;
 * - the lines get the row − the charge's part, spread over the profile's lines by line net (base − discount share)
 *   with `apportionMinor`; Σ lines + the charge = the row exactly;
 * - R-20, inclusive mode: the rows are spread in seq order with `allocateCappedMinor` over each line's headroom
 *   (line net − its taxes of the profile so far), so a line's taxes never exceed its net.
 * Bases (R-19): exclusive → line net; inclusive → line net − Σ the line's taxes of the profile; compound → plus the
 * line's earlier taxes of the profile (seq order). The charge is never tax-inclusive (§3.5 (4)): its base is its
 * amount, plus its earlier parts for a compound tax. Σ bases + the charge's = the row's base. Pure.
 */
export function spreadLineTaxes(input: ComputeSplitInput): ComputeLineTaxes {
  const split = computeSplit(input);
  const k = split.payment_class;
  const { rules, lines, service_charge: sc } = input;
  const res = resolveProfiles(input.tax_profiles, rules, input.business_date);
  const e = exactAt(k, lines, sc, rules, res);
  const out: ComputeLineTaxes['lines'] = lines.map((l) => ({ order_item_id: l.order_item_id, taxes: [] }));
  const scTaxes: ComputeSpreadTax[] = [];

  const profiles: string[] = [];
  for (const row of e.taxes) if (!profiles.includes(row.tax_profile_id)) profiles.push(row.tax_profile_id);
  for (const profile of profiles) {
    const rows = e.taxes.filter((row) => row.tax_profile_id === profile);
    const idx: number[] = [];
    lines.forEach((l, i) => {
      if (lineProfile(l, rules) === profile) idx.push(i);
    });
    const nets = idx.map((i) => BigInt((lines[i] as ComputeSplitLine).base_minor) - BigInt((lines[i] as ComputeSplitLine).discount_minor));
    const charged = e.sc > 0n && profile === e.scProfile;

    // R-18: the charge's part per row, rounded on its own; the lines' taxes = the rest, spread by line net.
    // R-20: in inclusive mode a line's taxes of the profile never exceed its net — each row (seq order) is spread
    // with the capped allocator over each line's headroom (net − its taxes of the profile so far).
    let chargeEarlier = 0n;
    const chargeParts: bigint[] = [];
    const lineTaxes: bigint[][] = []; // [row][line]
    const headroom = [...nets];
    for (const row of rows) {
      const r = BigInt(row.rate_bp);
      const part = charged ? halfUp((e.sc + (row.compound ? chargeEarlier : 0n)) * r, BP) : 0n;
      // Dead invariant: the charge's own rounding on a part of the row's base never exceeds the row (part ≤ row).
      if (part > row.tax) fail(`spreadLineTaxes: the charge part exceeds the ${profile}/${row.tax_code} row`);
      chargeParts.push(part);
      chargeEarlier += part;
      if (idx.length === 0) {
        lineTaxes.push([]);
        continue;
      }
      if (!rules.prices_include_tax) {
        lineTaxes.push(apportionBig(row.tax - part, nets));
        continue;
      }
      // Invariant: Σ headroom ≥ the lines' part, because Σ the lines' parts over the rows = TI_p ≤ A_p (§3.5 (3)).
      const room = headroom.reduce((a, b) => a + b, 0n);
      if (row.tax - part > room) fail(`spreadLineTaxes: invariant — the ${profile}/${row.tax_code} lines' tax exceeds their headroom`);
      const shares = cappedBig(row.tax - part, headroom);
      shares.forEach((x, j) => (headroom[j] = (headroom[j] as bigint) - x));
      lineTaxes.push(shares);
    }

    // R-19: bases.
    const spread = (base: bigint, tax: bigint, row: (typeof rows)[number]): ComputeSpreadTax => {
      // Dead invariant: R-20 keeps a line's inclusive taxes ≤ its net, so no base is negative.
      if (base < 0n) fail(`spreadLineTaxes: a negative base on ${profile}/${row.tax_code}`);
      return {
        tax_code: row.tax_code,
        payment_class: k,
        rate_bp: row.rate_bp,
        base_minor: toSafe('spread base', base),
        tax_minor: toSafe('spread tax', tax),
      };
    };
    idx.forEach((i, j) => {
      const own = lineTaxes.map((t) => t[j] as bigint);
      const net = (nets[j] as bigint) - (rules.prices_include_tax ? own.reduce((a, b) => a + b, 0n) : 0n);
      let earlier = 0n;
      rows.forEach((row, q) => {
        const tax = own[q] as bigint;
        (out[i] as ComputeLineTaxes['lines'][number]).taxes.push(spread(net + (row.compound ? earlier : 0n), tax, row));
        earlier += tax;
      });
    });
    if (charged) {
      let earlier = 0n;
      rows.forEach((row, q) => {
        const tax = chargeParts[q] as bigint;
        scTaxes.push(spread(e.sc + (row.compound ? earlier : 0n), tax, row));
        earlier += tax;
      });
    }
  }
  return {
    payment_class: k,
    lines: out,
    // R-21: an applied charge of 0 (rate 0 or net 0) is no charge, as removed / absent.
    service_charge: e.sc > 0n ? { amount_minor: toSafe('service charge', e.sc), tax_profile_id: e.scProfile, taxes: scTaxes } : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The bill: discount spread, split allocation (§3.5 (2), §3.8)
// ---------------------------------------------------------------------------------------------------------------

/** Each open line's discount share (§3.5 (2), B7, R3). */
function discountShares(lines: readonly ComputeLine[], discount: ComputeDiscount | null): bigint[] {
  const bases = lines.map((l) => BigInt(l.base_minor));
  if (discount === null) return bases.map(() => 0n);
  if (discount.frozen === null) {
    const sum = bases.reduce((a, b) => a + b, 0n);
    const value = nonNeg('discount value', discount.value);
    if (discount.kind === 'percent' && value > BP) fail('discount percent above 10 000 bp');
    const d = discount.kind === 'amount' ? value : (sum * value) / BP;
    return cappedBig(d < sum ? d : sum, bases);
  }
  // Frozen at the first close (R3, Q-1): min(frozen − Σ closed D, the eligible open lines' current total).
  const f = discount.frozen;
  const eligible = new Set(f.line_ids);
  const caps = lines.map((l, i) => (eligible.has(l.order_item_id) ? (bases[i] as bigint) : 0n));
  const cap = caps.reduce((a, b) => a + b, 0n);
  const remaining = nonNeg('frozen amount', f.amount_minor) - nonNeg('closed discount', f.closed_discount_minor);
  const d = remaining < 0n ? 0n : remaining < cap ? remaining : cap;
  return cappedBig(d, caps);
}

interface Part {
  split_no: number;
  units: number;
  base: bigint;
}

function splitNos(plan: ComputePlan): number[] {
  const nos = plan.mode === 'none' ? [plan.split_no] : plan.splits.map((s) => s.split_no);
  if (nos.length === 0) fail('a plan needs at least one split');
  for (const n of nos) if (!Number.isSafeInteger(n) || n < 1) fail('split_no must be ≥ 1');
  if (new Set(nos).size !== nos.length) fail('duplicate split_no');
  return [...nos].sort((a, b) => a - b);
}

/** Item plan (§3.8): uncovered live units join the highest-numbered split; excess units leave the highest first. */
function itemParts(
  l: ComputeLine,
  plan: Extract<ComputePlan, { mode: 'items' }>,
  nos: readonly number[],
): Part[] {
  const units = new Map<number, number>(nos.map((n) => [n, 0]));
  for (const s of plan.splits) {
    for (const e of s.lines) {
      if (e.order_item_id !== l.order_item_id) continue;
      if (!Number.isSafeInteger(e.units) || e.units < 0) fail('plan units must be a non-negative integer');
      units.set(s.split_no, (units.get(s.split_no) as number) + e.units);
    }
  }
  const planned = [...units.values()].reduce((a, b) => a + b, 0);
  const highest = nos[nos.length - 1] as number;
  if (planned < l.units) units.set(highest, (units.get(highest) as number) + (l.units - planned));
  let excess = planned - l.units;
  for (let i = nos.length - 1; i >= 0 && excess > 0; i--) {
    const n = nos[i] as number;
    const take = Math.min(excess, units.get(n) as number);
    units.set(n, (units.get(n) as number) - take);
    excess -= take;
  }
  const holding = nos.filter((n) => (units.get(n) as number) > 0);
  if (holding.length === 0) return [{ split_no: highest, units: 0, base: BigInt(l.base_minor) }];
  const baseParts = allocateDealMinor(l.base_minor, holding.map((n) => units.get(n) as number));
  return holding.map((n, i) => ({ split_no: n, units: units.get(n) as number, base: BigInt(baseParts[i] as number) }));
}

function weightedParts(l: ComputeLine, nos: readonly number[], weights: readonly number[]): Part[] {
  const baseParts = allocateDealMinor(l.base_minor, weights);
  return nos.map((n, i) => ({ split_no: n, units: l.units, base: BigInt(baseParts[i] as number) }));
}

function checkLines(lines: readonly ComputeLine[]): void {
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.order_item_id)) fail(`duplicate line ${l.order_item_id}`);
    seen.add(l.order_item_id);
    nonNeg('base_minor', l.base_minor);
    nonNeg('units', l.units);
    nonNeg('unit_price_minor', l.unit_price_minor);
    if (l.line_kind === 'deal_part' && l.base_minor !== 0) fail(`deal part ${l.order_item_id} must have base 0 (§3.4)`);
  }
}

/**
 * The open part of a bill: discount spread, the open splits per plan, each split's totals and dues, the default-class
 * totals of the open remainder, and the `blocks` compute can decide (`tax_unresolved`, `shares_sum`). Pure.
 */
export function computeBill(input: ComputeBillInput): ComputeBillResult {
  const { rules, business_date, lines, plan } = input;
  checkRules(rules, business_date);
  checkServiceCharge(input.service_charge);
  checkPayments(input.payments);
  checkLines(lines);
  const res = resolveProfiles(input.tax_profiles, rules, business_date);
  const nos = splitNos(plan);
  for (const p of input.payments) if (!nos.includes(p.split_no)) fail(`payment on split ${p.split_no}, not in the plan`);

  const shares = discountShares(lines, input.discount);
  const lineRows = lines.map((l, i) => ({
    order_item_id: l.order_item_id,
    line_kind: l.line_kind,
    units: l.units,
    unit_price_minor: l.unit_price_minor,
    base_minor: l.base_minor,
    discount_minor: toSafe('discount share', shares[i] as bigint),
    tax_profile_id: l.tax_profile_id,
  }));

  const splitInput = (split_no: number, splitLines: ComputeSplitLine[]): ComputeSplitInput => ({
    split_no,
    business_date,
    rules,
    tax_profiles: input.tax_profiles,
    lines: splitLines,
    service_charge: input.service_charge,
    payments: input.payments.filter((p) => p.split_no === split_no),
  });

  // The open remainder as one unpaid split; its cash totals are the default-class totals (check bill, amount plan),
  // its digital totals the check bill's "total if paid by card" (§6.3, G-25).
  const whole = splitResult({ ...splitInput(nos[0] as number, lineRows), payments: [] }, res);
  const totalsDefault = whole.totals.cash;
  const totalsDefaultDigital = whole.totals.digital;
  const blocks: ComputeBlock[] = [...whole.blocks];

  const perSplit = new Map<number, ComputeSplitLine[]>(nos.map((n) => [n, []]));
  if (plan.mode === 'none') {
    perSplit.set(plan.split_no, lineRows);
  } else {
    let weights: number[] | null = null;
    if (plan.mode === 'equal') weights = nos.map(() => 1);
    if (plan.mode === 'amount') {
      const byNo = new Map(plan.splits.map((s) => [s.split_no, s.share_minor]));
      const head = nos.slice(0, -1).map((n) => {
        const v = byNo.get(n);
        if (v === undefined) fail(`amount plan split ${n} has no share`);
        nonNeg('share_minor', v);
        return v;
      });
      const last = BigInt(totalsDefault.total_minor) - head.reduce((a, b) => a + BigInt(b), 0n);
      if (last < 1n) blocks.push({ reason: 'shares_sum', ids: [String(nos[nos.length - 1])] });
      weights = [...head, last > 0n ? toSafe('last share', last) : 0];
    }
    lines.forEach((l, i) => {
      const parts = plan.mode === 'items' ? itemParts(l, plan, nos) : weightedParts(l, nos, weights as number[]);
      const dParts = cappedBig(shares[i] as bigint, parts.map((p) => p.base));
      parts.forEach((p, j) => {
        (perSplit.get(p.split_no) as ComputeSplitLine[]).push({
          order_item_id: l.order_item_id,
          line_kind: l.line_kind,
          units: p.units,
          unit_price_minor: l.unit_price_minor,
          base_minor: toSafe('base part', p.base),
          discount_minor: toSafe('discount part', dParts[j] as bigint),
          tax_profile_id: l.tax_profile_id,
        });
      });
    });
  }

  const splits = nos.map((n) => splitResult(splitInput(n, perSplit.get(n) as ComputeSplitLine[]), res));

  return {
    splits,
    totals_default: totalsDefault,
    totals_default_digital: totalsDefaultDigital,
    discount_minor: lineRows.reduce((a, l) => a + l.discount_minor, 0),
    lines: lineRows.map((l) => ({
      order_item_id: l.order_item_id,
      discount_minor: l.discount_minor,
      tags: isUnresolved(lineProfile(l, rules), res) ? ['tax_unresolved' as const] : [],
    })),
    blocks,
  };
}
