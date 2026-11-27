// 05 §10.1 / §10.2 property tests (#10, #10d, #11c, #15e, #16b, #16c, #20c, #23) for §3.5–§3.8, B7, B9, B10.
// Plan PL-15: written without reading compute.ts. The file holds an INDEPENDENT MODEL of §3.5 rules (1)–(7), built from
// the spec text only (BigInt, half up at the named points only), and compares it with computeBill / computeSplit on
// seeded random bills. Every failure message prints the bill's own seed: `bill(<seed>)` regenerates that one bill.
import { describe, expect, it } from 'vitest';
import {
  allocateCappedMinor,
  apportionMinor,
  computeBill,
  computeSplit,
  SERVICE_CHARGE_ID,
  type ComputeBillInput,
  type ComputeBillResult,
  type ComputeDiscount,
  type ComputeLine,
  type ComputePayment,
  type ComputePlan,
  type ComputeRules,
  type ComputeServiceCharge,
  type ComputeSplitLine,
  type ComputeSplitResult,
  type ComputeTax,
  type ComputeTaxProfile,
  type ComputeTaxRate,
  type ComputeTaxRow,
  type ComputeTotals,
} from './compute.js';

type Cls = 'cash' | 'digital';
type Rounding = ComputeRules['rounding'];
type Status = ComputeRules['integration_status'];

const BUSINESS_DATE = '2026-11-19';
const LONG = 600_000; // per-test timeout (ms); never a timing assert (03a AD-32), the wall time is only logged

// ---------------------------------------------------------------------------------------------------------------
// Seeded PRNG (mulberry32, the packages/engine/test/sim/generate.ts pattern; no Math.random, F §6.7)
// ---------------------------------------------------------------------------------------------------------------

class Rng {
  private a: number;
  constructor(seed: number) {
    this.a = seed >>> 0;
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(0, xs.length - 1)];
  }
  shuffle<T>(xs: readonly T[]): T[] {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

/** The seed of bill `i` of a run: a bill regenerates from this number alone. */
function billSeed(master: number, i: number): number {
  let h = (master ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------------------------------------------
// THE MODEL — §3.5 from the spec text, BigInt throughout
// ---------------------------------------------------------------------------------------------------------------

const U = 10_000n; // basis points per unit
const sumB = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);
const max0 = (x: bigint): bigint => (x > 0n ? x : 0n);
const minB = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** round_half_up(num / den) for num ≥ 0, den > 0. */
function rhu(num: bigint, den: bigint): bigint {
  if (num < 0n || den <= 0n) throw new Error(`model rhu: ${num}/${den}`);
  return (2n * num + den) / (2n * den);
}

/**
 * §3.5 (2) H1-4 and §3.5 (6) H16-12, the one algorithm both name: floor(total × w / Σw) each, the left-over minor
 * units one each to the largest fractional parts, ties to the earlier entry.
 */
function largestRemainder(total: bigint, weights: readonly bigint[]): bigint[] {
  const sw = sumB(weights);
  if (sw === 0n) {
    if (total !== 0n) throw new Error('model largestRemainder: total over zero weights');
    return weights.map(() => 0n);
  }
  const out = weights.map((w) => (total * w) / sw);
  const frac = weights.map((w) => (total * w) % sw);
  let left = total - sumB(out);
  const order = weights.map((_, i) => i).sort((i, j) => (frac[j] > frac[i] ? 1 : frac[j] < frac[i] ? -1 : i - j));
  for (const i of order) {
    if (left === 0n) break;
    out[i] += 1n;
    left -= 1n;
  }
  return out;
}

/** menu-lines' allocateDealMinor as §3.5 / §3.8 use it: floor shares, the remainder to the last part. */
function dealAlloc(total: bigint, weights: readonly bigint[]): bigint[] {
  const sw = sumB(weights);
  const head =
    sw === 0n
      ? weights.slice(0, -1).map(() => total / BigInt(weights.length))
      : weights.slice(0, -1).map((w) => (total * w) / sw);
  return [...head, total - sumB(head)];
}

interface Ctx {
  date: string;
  rules: ComputeRules;
  profiles: ReadonlyMap<string, ComputeTaxProfile>;
  sc: ComputeServiceCharge | null;
}

function ctxOf(input: {
  business_date: string;
  rules: ComputeRules;
  tax_profiles: readonly ComputeTaxProfile[];
  service_charge: ComputeServiceCharge | null;
}): Ctx {
  return {
    date: input.business_date,
    rules: input.rules,
    profiles: new Map(input.tax_profiles.map((p) => [p.tax_profile_id, p])),
    sc: input.service_charge,
  };
}

/** B5 / §3.4: the row of the class and the branch's integration status in force at the date (the latest such). */
function pickRate(tax: ComputeTax, cls: Cls, ctx: Ctx): ComputeTaxRate {
  let best: ComputeTaxRate | null = null;
  for (const r of tax.rates) {
    if (r.payment_class !== cls || r.integration_status !== ctx.rules.integration_status) continue;
    if (r.effective_from > ctx.date) continue;
    if (best === null || r.effective_from > best.effective_from) best = r;
  }
  if (best === null) throw new Error(`model: tax ${tax.tax_code} unresolved for ${cls}`);
  return best;
}

/** §3.5 (7): rnd(x) to the step by mode on the magnitude; `nearest` half away from zero. */
function rnd(x: bigint, step: bigint, mode: Rounding['mode']): bigint {
  const neg = x < 0n;
  const m = neg ? -x : x;
  const q = m / step;
  const r = m % step;
  let v = q * step;
  if (mode === 'up' && r > 0n) v += step;
  if (mode === 'nearest' && 2n * r >= step) v += step;
  return neg ? -v : v;
}

/** §3.5 (7) rounding R for a total G at class `cls`. */
function roundingR(ctx: Ctx, g: bigint, cls: Cls): bigint {
  const { step_minor, mode, applies_to } = ctx.rules.rounding;
  if (step_minor === null) return 0n;
  if (applies_to === 'cash' && cls !== 'cash') return 0n;
  return rnd(g, BigInt(step_minor), mode) - g;
}

interface MLine {
  base: bigint;
  disc: bigint;
  profile: string | null;
  kind: ComputeLine['line_kind'];
}

interface MRow {
  tax_profile_id: string;
  tax_code: string;
  label: string;
  seq: number;
  compound: boolean;
  payment_class: Cls;
  rate_bp: number;
  rate_ref: string | null;
  base_minor: bigint;
  tax_minor: bigint;
}

interface MTotals {
  subtotal: bigint;
  discount: bigint;
  net: bigint;
  sc: bigint;
  taxes: MRow[];
  G: bigint;
  R: bigint;
  T: bigint;
  /** TI_p per profile (inclusive mode), for #11c. */
  ti: Map<string, bigint>;
}

/** §3.5 (1)–(7) totals of one split at class `cls`. */
function modelTotals(ctx: Ctx, lines: readonly MLine[], cls: Cls, target: bigint | null = null): MTotals {
  const taxOn = ctx.rules.tax_enabled;
  const inclusive = ctx.rules.prices_include_tax;
  const groupA = new Map<string, bigint>(); // A_p, profile → Σ (base − share)
  let untaxed = 0n;
  let S = 0n;
  let D = 0n;
  for (const l of lines) {
    S += l.base;
    D += l.disc;
    const a = l.base - l.disc;
    // §3.4: a deal part is never taxed (base 0), whatever profile it carries; it forms no tax row.
    if (taxOn && l.profile !== null && l.kind !== 'deal_part') groupA.set(l.profile, (groupA.get(l.profile) ?? 0n) + a);
    else untaxed += a;
  }
  const scApplied = ctx.sc !== null && !ctx.sc.removed;
  const scProfile = scApplied && taxOn ? (ctx.sc as ComputeServiceCharge).tax_profile_id : null;

  // (3) N_p and the included part (6b) per profile. Every taxed profile present on the split gets its rows, zero
  // rows included; the service charge's profile joins (with A = 0) only when SC > 0 (below).
  type G3 = { profile: ComputeTaxProfile; A: bigint; N: bigint; taxes: ComputeTax[]; rates: ComputeTaxRate[]; I: bigint[] };
  const groups: G3[] = [];
  const ti = new Map<string, bigint>();
  const group = (pid: string, A: bigint): void => {
    const profile = ctx.profiles.get(pid);
    if (profile === undefined) throw new Error(`model: profile ${pid} unresolved`);
    const taxes = [...profile.taxes].sort((x, y) => x.seq - y.seq);
    const rates = taxes.map((t) => pickRate(t, cls, ctx));
    let N = A;
    let I = taxes.map(() => 0n);
    if (inclusive) {
      // a_k = (r_k / U) × (1 | 1 + Σ_{j<k} a_j). With k 0-based here, α_k = a_k × U^(k+1) (an integer), and
      // w_k = α_k × U^(n−1−k) = a_k × U^n, so M = 1 + Σ w / U^n and the exact shares e_k ∝ w_k.
      const n = taxes.length;
      const alpha: bigint[] = [];
      for (let k = 0; k < n; k++) {
        const uk1 = U ** BigInt(k);
        let c = uk1;
        if (taxes[k].compound) for (let j = 0; j < k; j++) c += alpha[j] * U ** BigInt(k - 1 - j);
        alpha.push(BigInt(rates[k].rate_bp) * c);
      }
      const w = alpha.map((a, k) => a * U ** BigInt(n - 1 - k));
      const sw = sumB(w);
      const TI = sw === 0n ? 0n : rhu(A * sw, U ** BigInt(n) + sw); // A − A / M, M = 1 + Σw / U^n
      I = largestRemainder(TI, w);
      N = A - TI;
      ti.set(pid, TI);
    }
    groups.push({ profile, A, N, taxes, rates, I });
  };
  for (const [pid, A] of groupA) group(pid, A);
  const N = untaxed + sumB(groups.map((g) => g.N));
  const SC = scApplied ? rhu(N * BigInt((ctx.sc as ComputeServiceCharge).rate_bp), U) : 0n;
  if (scProfile !== null && SC > 0n && !groupA.has(scProfile)) group(scProfile, 0n);

  // (6) rows: the exclusive part (a) rounded per tax at its own point, plus the included part (b).
  const taxes: MRow[] = [];
  for (const g of groups) {
    const SCp = g.profile.tax_profile_id === scProfile ? SC : 0n;
    const X = (inclusive ? 0n : g.A) + SCp;
    let prevExcl = 0n;
    let prevRow = 0n;
    g.taxes.forEach((t, k) => {
      const Bk = X + (t.compound ? prevExcl : 0n);
      const Tk = rhu(Bk * BigInt(g.rates[k].rate_bp), U);
      const tax = Tk + g.I[k];
      taxes.push({
        tax_profile_id: g.profile.tax_profile_id,
        tax_code: t.tax_code,
        label: t.label,
        seq: t.seq,
        compound: t.compound,
        payment_class: cls,
        rate_bp: g.rates[k].rate_bp,
        rate_ref: g.rates[k].ref,
        base_minor: g.N + SCp + (t.compound ? prevRow : 0n),
        tax_minor: tax,
      });
      prevExcl += Tk;
      prevRow += tax;
    });
  }
  const G = N + SC + sumB(taxes.map((r) => r.tax_minor));
  const R = target === null ? roundingR(ctx, G, cls) : target - G;
  return { subtotal: S, discount: D, net: N, sc: SC, taxes, G, R, T: G + R, ti };
}

interface MSplit {
  payment_class: Cls;
  cash: MTotals;
  digital: MTotals;
  as_paid: MTotals;
  paid_cash: bigint;
  paid_digital: bigint;
  balance: bigint;
  card_due: bigint;
  cash_due: bigint;
  card_refund_due: bigint;
  cash_refund_due: bigint;
  rounding: bigint;
  change: bigint;
  /** B⁺ᶜ before the step floor (H15-5), for #20c's "closes as keyed" check. */
  cash_due_raw: bigint;
}

/** §3.5 (5) the split's class from its live `in` payments only (higher_rate: any cash → cash). */
function classOf(payments: readonly ComputePayment[]): Cls {
  const ins = payments.filter((p) => p.direction === 'in');
  if (ins.some((p) => p.payment_class === 'cash')) return 'cash';
  if (ins.some((p) => p.payment_class === 'digital')) return 'digital';
  return 'cash';
}

function netPaid(payments: readonly ComputePayment[], cls: Cls): bigint {
  let s = 0n;
  for (const p of payments) {
    if (p.payment_class !== cls) continue;
    s += p.direction === 'in' ? BigInt(p.amount_minor) : -BigInt(p.amount_minor);
  }
  return s;
}

/** §3.5 (5)–(7), §3.7: one split's class, totals, balance, the four dues and change. */
type Targets = { cash: number; digital: number } | null | undefined;

function modelSplit(ctx: Ctx, lines: readonly MLine[], payments: readonly ComputePayment[], targets: Targets = null): MSplit {
  const cls = classOf(payments);
  const cash = modelTotals(ctx, lines, 'cash', targets == null ? null : BigInt(targets.cash));
  const digital = modelTotals(ctx, lines, 'digital', targets == null ? null : BigInt(targets.digital));
  const asPaid = cls === 'cash' ? cash : digital;
  const Pd = netPaid(payments, 'digital');
  const Pc = netPaid(payments, 'cash');
  const B = asPaid.T - Pd - Pc;
  const hasCashIn = payments.some((p) => p.direction === 'in' && p.payment_class === 'cash');
  // H16-1: B⁺ᵏ = the balance as if one more live `in` of class k were on the split.
  const cardRaw = (hasCashIn ? cash : digital).T - Pd - Pc;
  const cashRaw = cash.T - Pd - Pc;
  const { step_minor, applies_to } = ctx.rules.rounding;
  const stepped = applies_to === 'cash' && step_minor !== null;
  const floorStep = (x: bigint): bigint => (stepped ? (x / BigInt(step_minor as number)) * BigInt(step_minor as number) : x);
  const neg = max0(-B);
  let change = 0n;
  for (const p of payments) {
    if (p.direction !== 'in' || p.payment_class !== 'cash') continue;
    const tendered = p.tendered_minor ?? p.amount_minor;
    change += BigInt(tendered) - BigInt(p.amount_minor);
  }
  return {
    payment_class: cls,
    cash,
    digital,
    as_paid: asPaid,
    paid_cash: Pc,
    paid_digital: Pd,
    balance: B,
    card_due: B > 0n ? max0(cardRaw) : 0n, // H17-1: both in-dues 0 while B ≤ 0
    cash_due: B > 0n ? floorStep(max0(cashRaw)) : 0n,
    card_refund_due: minB(max0(Pd), neg), // a type that paid nothing (or less than nothing) has 0
    cash_refund_due: floorStep(minB(max0(Pc), neg)),
    rounding: asPaid.R,
    change,
    cash_due_raw: cashRaw,
  };
}

/**
 * §3.8 owner ruling 2026-11-28 (QA BUG-1): the open remainder rounded once, W = rnd(G_whole − Σ R_closed) (a class
 * the rule does not round: W = G_whole); equal → floor(W / n) in whole steps, the last the rest; items / amount →
 * W in whole steps by largest remainder over the exact G_s (all 0 → the last takes W).
 */
function modelTargets(ctx: Ctx, cls: Cls, mode: ComputePlan['mode'], gWhole: bigint, closedR: bigint, gs: readonly bigint[]): { W: bigint; shares: bigint[] } {
  const { step_minor, mode: rmode, applies_to } = ctx.rules.rounding;
  const rounds = step_minor !== null && !(applies_to === 'cash' && cls !== 'cash');
  const step = rounds ? BigInt(step_minor as number) : 1n;
  const W = rounds ? max0(rnd(max0(gWhole - closedR), step, rmode)) : gWhole;
  const n = gs.length;
  if (n === 1) return { W, shares: [W] };
  const gsum = sumB(gs);
  const shares =
    mode === 'equal' ? gs.map(() => ((W / BigInt(n)) / step) * step) : gsum === 0n ? gs.map(() => 0n) : largestRemainder(W / step, gs).map((x) => x * step);
  let last = W - sumB(shares.slice(0, -1));
  for (let i = n - 2; i >= 0 && last < 0n; i--) {
    const take = minB(shares[i], -last);
    shares[i] -= take;
    last += take;
  }
  shares[n - 1] = last;
  return { W, shares };
}

interface MBill {
  shares: bigint[]; // per bill line, the discount share
  discount: bigint;
  sharesBlock: boolean;
  splits: Array<{ split_no: number; lines: ComputeSplitLine[]; targets: { cash: number; digital: number } }>;
  totalsDefault: MTotals;
}

/** §3.5 (2), B7 (R3, H2-8), §3.8: the discount spread and the open splits' lines per plan. */
function modelBill(input: ComputeBillInput): MBill {
  const ctx = ctxOf(input);
  const lines = input.lines;
  const bases = lines.map((l) => BigInt(l.base_minor));
  let shares = lines.map(() => 0n);
  const d = input.discount;
  if (d !== null) {
    if (d.frozen !== null) {
      const ids = new Set(d.frozen.line_ids);
      const elig = lines.map((l) => ids.has(l.order_item_id));
      const cap = sumB(bases.filter((_, i) => elig[i]));
      const open = max0(minB(BigInt(d.frozen.amount_minor) - BigInt(d.frozen.closed_discount_minor), cap));
      const eligBases = bases.filter((_, i) => elig[i]);
      const eligShares = largestRemainder(open, eligBases);
      let k = 0;
      shares = lines.map((_, i) => (elig[i] ? eligShares[k++] : 0n));
    } else {
      // §3.5 (2): D ≤ S always — an amount above Σ bases is capped at Σ bases.
      const total = d.kind === 'amount' ? minB(BigInt(d.value), sumB(bases)) : (sumB(bases) * BigInt(d.value)) / U;
      shares = largestRemainder(total, bases);
    }
  }
  const mlines: MLine[] = lines.map((l, i) => ({ base: bases[i], disc: shares[i], profile: l.tax_profile_id, kind: l.line_kind }));
  const closedR = BigInt(input.closed_rounding_minor ?? 0);
  const gWhole = (cls: Cls) => modelTotals(ctx, mlines, cls).G;
  const totalsDefault = modelTotals(ctx, mlines, 'cash', modelTargets(ctx, 'cash', 'none', gWhole('cash'), closedR, [gWhole('cash')]).W);
  const splitLine = (l: ComputeLine, units: number, base: bigint, disc: bigint): ComputeSplitLine => ({
    order_item_id: l.order_item_id,
    line_kind: l.line_kind,
    units,
    unit_price_minor: l.unit_price_minor,
    base_minor: Number(base),
    discount_minor: Number(disc),
    tax_profile_id: l.tax_profile_id,
  });
  // The plan's order of splits carries no meaning: "the last split" is the highest-numbered one (§3.8).
  const plan: ComputePlan =
    input.plan.mode === 'none' ? input.plan : ({ ...input.plan, splits: [...input.plan.splits].sort((a, b) => a.split_no - b.split_no) } as ComputePlan);
  let sharesBlock = false;
  let splits: Array<{ split_no: number; lines: ComputeSplitLine[] }> = [];
  if (plan.mode === 'none') {
    splits = [{ split_no: plan.split_no, lines: lines.map((l, i) => splitLine(l, l.units, bases[i], shares[i])) }];
  } else if (plan.mode === 'items') {
    const out = plan.splits.map((s) => ({ split_no: s.split_no, lines: [] as ComputeSplitLine[] }));
    lines.forEach((l, i) => {
      const parts: Array<{ k: number; units: number }> = [];
      plan.splits.forEach((s, k) => {
        const u = s.lines.filter((x) => x.order_item_id === l.order_item_id).reduce((a, x) => a + x.units, 0);
        if (u > 0) parts.push({ k, units: u });
      });
      if (parts.length === 0) return;
      const baseParts = dealAlloc(bases[i], parts.map((p) => BigInt(p.units)));
      const discParts = largestRemainder(shares[i], baseParts);
      parts.forEach((p, j) => out[p.k].lines.push(splitLine(l, p.units, baseParts[j], discParts[j])));
    });
    splits = out;
  } else {
    let weights: bigint[];
    if (plan.mode === 'equal') weights = plan.splits.map(() => 1n);
    else {
      const given = plan.splits.map((s) => BigInt(s.share_minor));
      const last = totalsDefault.T - sumB(given.slice(0, -1)); // H1-22: the last open share re-based
      weights = [...given.slice(0, -1), last];
      if (last < 1n) sharesBlock = true;
    }
    if (!sharesBlock) {
      const out = plan.splits.map((s) => ({ split_no: s.split_no, lines: [] as ComputeSplitLine[] }));
      lines.forEach((l, i) => {
        const baseParts = dealAlloc(bases[i], weights);
        const discParts = largestRemainder(shares[i], baseParts);
        out.forEach((o, k) => o.lines.push(splitLine(l, l.units, baseParts[k], discParts[k])));
      });
      splits = out;
    }
  }
  const sorted = [...splits].sort((a, b) => a.split_no - b.split_no);
  const tg = (cls: Cls) =>
    modelTargets(ctx, cls, plan.mode, gWhole(cls), closedR, sorted.map((x) => modelTotals(ctx, toMLines(x.lines), cls).G)).shares;
  const tc = tg('cash');
  const td = tg('digital');
  const withTargets = sorted.map((x, i) => ({ ...x, targets: { cash: Number(tc[i]), digital: Number(td[i]) } }));
  return { shares, discount: sumB(shares), sharesBlock, splits: withTargets, totalsDefault };
}

const toMLines = (lines: readonly ComputeSplitLine[]): MLine[] =>
  lines.map((l) => ({ base: BigInt(l.base_minor), disc: BigInt(l.discount_minor), profile: l.tax_profile_id, kind: l.line_kind }));

// ---------------------------------------------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------------------------------------------

type Plain = { [k: string]: unknown };

function normRows(rows: ReadonlyArray<ComputeTaxRow | MRow>): Plain[] {
  return rows
    .map((r) => ({
      tax_profile_id: r.tax_profile_id,
      tax_code: r.tax_code,
      label: r.label,
      seq: r.seq,
      compound: r.compound,
      payment_class: r.payment_class,
      rate_bp: r.rate_bp,
      rate_ref: r.rate_ref,
      base_minor: Number(r.base_minor),
      tax_minor: Number(r.tax_minor),
    }))
    .sort((a, b) => (a.tax_profile_id < b.tax_profile_id ? -1 : a.tax_profile_id > b.tax_profile_id ? 1 : a.seq - b.seq));
}

function normTotals(t: ComputeTotals | MTotals): Plain {
  if ('G' in t) {
    return {
      subtotal_minor: Number(t.subtotal),
      discount_minor: Number(t.discount),
      pre_tax_net_minor: Number(t.net),
      service_charge_minor: Number(t.sc),
      taxes: normRows(t.taxes),
      exact_total_minor: Number(t.G),
      rounding_minor: Number(t.R),
      total_minor: Number(t.T),
    };
  }
  return {
    subtotal_minor: t.subtotal_minor,
    discount_minor: t.discount_minor,
    pre_tax_net_minor: t.pre_tax_net_minor,
    service_charge_minor: t.service_charge_minor,
    taxes: normRows(t.taxes),
    exact_total_minor: t.exact_total_minor,
    rounding_minor: t.rounding_minor,
    total_minor: t.total_minor,
  };
}

function normSplit(s: ComputeSplitResult | MSplit): Plain {
  if ('as_paid' in s) {
    return {
      payment_class: s.payment_class,
      mixed_rule: 'higher_rate',
      cash: normTotals(s.cash),
      digital: normTotals(s.digital),
      as_paid: normTotals(s.as_paid),
      paid_cash_minor: Number(s.paid_cash),
      paid_digital_minor: Number(s.paid_digital),
      balance_minor: Number(s.balance),
      card_due_minor: Number(s.card_due),
      cash_due_minor: Number(s.cash_due),
      card_refund_due_minor: Number(s.card_refund_due),
      cash_refund_due_minor: Number(s.cash_refund_due),
      rounding_minor: Number(s.rounding),
      change_minor: Number(s.change),
    };
  }
  return {
    payment_class: s.payment_class,
    mixed_rule: s.mixed_rule,
    cash: normTotals(s.totals.cash),
    digital: normTotals(s.totals.digital),
    as_paid: normTotals(s.totals.as_paid),
    paid_cash_minor: s.paid_cash_minor,
    paid_digital_minor: s.paid_digital_minor,
    balance_minor: s.balance_minor,
    card_due_minor: s.card_due_minor,
    cash_due_minor: s.cash_due_minor,
    card_refund_due_minor: s.card_refund_due_minor,
    cash_refund_due_minor: s.cash_refund_due_minor,
    rounding_minor: s.rounding_minor,
    change_minor: s.change_minor,
  };
}

/** The first differing path between compute's value `a` and the model's `b`, or null. */
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return Object.is(a, b) ? null : `${path || '.'}: compute=${JSON.stringify(a)} model=${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: shape differs`;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) {
    return `${path}: length compute=${a.length} model=${b.length} compute=${JSON.stringify(a)} model=${JSON.stringify(b)}`;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff((a as Plain)[k], (b as Plain)[k], `${path}.${k}`);
    if (d !== null) return d;
  }
  return null;
}

const byId = (lines: readonly ComputeSplitLine[]): Plain =>
  Object.fromEntries([...lines].map((l) => [l.order_item_id, { ...l }]));

/** Model vs computeBill on one input: discount spread, split lines, every split's totals and dues. */
function compareBill(input: ComputeBillInput, res: ComputeBillResult): string | null {
  const m = modelBill(input);
  const ctx = ctxOf(input);
  const reasons = res.blocks.map((b) => b.reason).sort();
  const want = m.sharesBlock ? ['shares_sum'] : [];
  let d = firstDiff(reasons, want, 'blocks');
  if (d !== null) return d;
  d = firstDiff(res.discount_minor, Number(m.discount), 'discount_minor');
  if (d !== null) return d;
  d = firstDiff(
    res.lines.map((l) => ({ id: l.order_item_id, d: l.discount_minor, tags: l.tags })),
    input.lines.map((l, i) => ({ id: l.order_item_id, d: Number(m.shares[i]), tags: [] })),
    'lines',
  );
  if (d !== null) return d;
  d = firstDiff(normTotals(res.totals_default), normTotals(m.totalsDefault), 'totals_default');
  if (d !== null) return d;
  if (m.sharesBlock) return null;
  d = firstDiff(res.splits.map((s) => s.split_no).sort(), m.splits.map((s) => s.split_no).sort(), 'split_nos');
  if (d !== null) return d;
  for (const ms of m.splits) {
    const cs = res.splits.find((s) => s.split_no === ms.split_no) as ComputeSplitResult;
    d = firstDiff(byId(cs.lines), byId(ms.lines), `split ${ms.split_no}.lines`);
    if (d !== null) return d;
    const pays = input.payments.filter((p) => p.split_no === ms.split_no);
    d = firstDiff(normSplit(cs), normSplit(modelSplit(ctx, toMLines(ms.lines), pays, ms.targets)), `split ${ms.split_no}`);
    if (d !== null) return d;
    d = firstDiff(cs.total_targets, ms.targets, `split ${ms.split_no}.total_targets`);
    if (d !== null) return d;
    d = firstDiff(cs.blocks, [], `split ${ms.split_no}.blocks`);
    if (d !== null) return d;
  }
  return null;
}

/** Model vs computeSplit on one split input. */
function compareSplit(ctx: Ctx, lines: readonly ComputeSplitLine[], pays: readonly ComputePayment[], res: ComputeSplitResult, targets: Targets = null): string | null {
  return firstDiff(normSplit(res), normSplit(modelSplit(ctx, toMLines(lines), pays, targets)), `split ${res.split_no}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------------------------

interface GenOpts {
  priceMode?: boolean; // prices_include_tax
  rounding?: Rounding | 'random';
  roundingMode?: 'random';
  /** #20c: Punjab-shaped profiles — one simple tax each, class rates equal or 500 / 1600 bp. */
  punjab?: boolean;
  minLines?: number;
  maxLines?: number;
  discount?: 'random' | 'none' | 'percent_or_none' | 'heavy';
  sc?: 'random' | 'none';
  plans?: ReadonlyArray<ComputePlan['mode']>;
  /** Every base = unit price × units (no reduced open base); #20c needs it to remove units. */
  exactBase?: boolean;
  taxEnabled?: boolean;
}

function genRounding(rng: Rng): Rounding {
  return {
    step_minor: rng.pick([null, null, 1, 5, 10, 100, 100, 500, 1000]),
    mode: rng.pick(['nearest', 'down', 'up'] as const),
    applies_to: rng.pick(['all', 'cash'] as const),
  };
}

function genRates(rng: Rng, status: Status, cashBp: number, digitalBp: number): ComputeTaxRate[] {
  const other: Status = status === 'integrated' ? 'not_integrated' : 'integrated';
  const ref = (): string | null => (rng.chance(0.5) ? `SRO-${rng.int(1, 999)}` : null);
  const rows: ComputeTaxRate[] = [
    { payment_class: 'cash', integration_status: status, effective_from: '2026-07-01', rate_bp: cashBp, ref: ref() },
    { payment_class: 'digital', integration_status: status, effective_from: '2026-07-01', rate_bp: digitalBp, ref: ref() },
  ];
  // Rows that must NOT be used (B5): superseded, not yet in force, the other integration status.
  if (rng.chance(0.5)) rows.push({ payment_class: 'cash', integration_status: status, effective_from: '2025-01-01', rate_bp: (cashBp + 111) % 10_001, ref: 'OLD' });
  if (rng.chance(0.5)) rows.push({ payment_class: 'digital', integration_status: status, effective_from: '2026-11-20', rate_bp: (digitalBp + 77) % 10_001, ref: 'FUTURE' });
  if (rng.chance(0.5)) rows.push({ payment_class: 'cash', integration_status: other, effective_from: '2026-01-01', rate_bp: (cashBp + 333) % 10_001, ref: 'OTHER' });
  if (rng.chance(0.3)) rows.push({ payment_class: 'digital', integration_status: status, effective_from: BUSINESS_DATE, rate_bp: (digitalBp + 5) % 10_001, ref: 'TODAY' });
  return rng.shuffle(rows);
}

function genProfiles(rng: Rng, status: Status, punjab: boolean): ComputeTaxProfile[] {
  const n = rng.int(1, 3);
  const out: ComputeTaxProfile[] = [];
  const rateBp = (): number => rng.pick([0, 1, 500, 800, 950, 1300, 1600, 1700, 2500, rng.int(0, 3000), 9999]);
  for (let p = 0; p < n; p++) {
    const taxes: ComputeTax[] = [];
    const nt = punjab ? 1 : rng.int(1, 3);
    for (let k = 0; k < nt; k++) {
      let cash: number;
      let digital: number;
      if (punjab) {
        const same = rng.chance(0.4);
        cash = same ? rng.pick([500, 1600]) : 1600;
        digital = same ? cash : 500;
      } else {
        cash = rateBp();
        digital = rng.chance(0.4) ? cash : rateBp();
      }
      const rates = genRates(rng, status, cash, digital);
      taxes.push({ seq: k + 1, tax_code: `TX${p}${k}`, label: `Tax ${p}.${k}`, compound: !punjab && k > 0 && rng.chance(0.5), rates });
    }
    out.push({ tax_profile_id: `P${p}`, taxes: rng.shuffle(taxes) });
  }
  return out;
}

function genPrice(rng: Rng): number {
  const r = rng.next();
  if (r < 0.15) return rng.int(1, 999);
  if (r < 0.9) return rng.int(100, 500_000);
  return rng.int(100_000_000, 999_999_900); // Rs 9,999,999-scale (#11 BigInt case)
}

function genLines(rng: Rng, profiles: readonly ComputeTaxProfile[], o: GenOpts): ComputeLine[] {
  const n = rng.int(o.minLines ?? 1, o.maxLines ?? 40);
  const lines: ComputeLine[] = [];
  const profileOf = (): string | null => (rng.chance(0.85) ? rng.pick(profiles).tax_profile_id : null);
  while (lines.length < n) {
    const id = `L${String(lines.length).padStart(2, '0')}`;
    const r = rng.next();
    const kind = r < 0.75 ? 'item' : r < 0.87 ? 'option_child' : 'deal';
    const units = rng.int(1, 5);
    const price = genPrice(rng);
    let base = price * units;
    if (o.exactBase !== true && rng.chance(0.15)) base = rng.int(0, base);
    lines.push({ order_item_id: id, line_kind: kind, units, unit_price_minor: price, base_minor: base, tax_profile_id: profileOf() });
    if (kind === 'deal') {
      const parts = rng.int(0, 2);
      for (let k = 0; k < parts && lines.length < n; k++) {
        lines.push({
          order_item_id: `L${String(lines.length).padStart(2, '0')}`,
          line_kind: 'deal_part',
          units: rng.int(1, 3),
          unit_price_minor: 0,
          base_minor: 0,
          tax_profile_id: rng.chance(0.3) ? rng.pick(profiles).tax_profile_id : null, // never taxed (§3.4)
        });
      }
    }
  }
  return lines;
}

function genDiscount(rng: Rng, lines: readonly ComputeLine[], kind: GenOpts['discount']): ComputeDiscount | null {
  const total = lines.reduce((a, l) => a + l.base_minor, 0);
  if (kind === 'none') return null;
  if (kind === 'heavy') return { kind: 'percent', value: rng.pick([9900, 9999, 10_000, rng.int(9000, 10_000)]), frozen: null };
  const r = rng.next();
  if (r < 0.35) return null;
  if (kind === 'percent_or_none' || r < 0.7) {
    return { kind: 'percent', value: rng.pick([1000, 500, 9999, 10_000, 1, rng.int(0, 10_000)]), frozen: null };
  }
  return { kind: 'amount', value: rng.pick([0, total, rng.int(0, total), rng.int(0, Math.min(total, 1000))]), frozen: null };
}

function genSc(rng: Rng, profiles: readonly ComputeTaxProfile[], kind: GenOpts['sc']): ComputeServiceCharge | null {
  if (kind === 'none' || rng.chance(0.45)) return null;
  return {
    rate_bp: rng.pick([500, 1000, 1500, rng.int(0, 2000)]),
    removed: rng.chance(0.2),
    tax_profile_id: rng.chance(0.6) ? rng.pick(profiles).tax_profile_id : null,
    source: rng.pick(['rule', 'manual'] as const),
  };
}

/** An item plan: every live unit exactly once (§3.8); a deal and a deal part go whole. */
function genItemPlan(rng: Rng, lines: readonly ComputeLine[], n: number): ComputePlan {
  const splits = Array.from({ length: n }, (_, k) => ({ split_no: k + 1, lines: [] as Array<{ order_item_id: string; units: number }> }));
  for (const l of lines) {
    if (l.line_kind === 'deal' || l.line_kind === 'deal_part') {
      rng.pick(splits).lines.push({ order_item_id: l.order_item_id, units: l.units });
      continue;
    }
    const per = new Map<number, number>();
    for (let u = 0; u < l.units; u++) {
      const k = rng.int(0, n - 1);
      per.set(k, (per.get(k) ?? 0) + 1);
    }
    for (const [k, units] of [...per].sort((a, b) => a[0] - b[0])) splits[k].lines.push({ order_item_id: l.order_item_id, units });
  }
  const used = splits.filter((s) => s.lines.length > 0).map((s, k) => ({ ...s, split_no: k + 1 }));
  return used.length === 0 ? { mode: 'none', split_no: 1 } : { mode: 'items', splits: used };
}

function genPlan(rng: Rng, base: Omit<ComputeBillInput, 'plan' | 'payments'>, modes: ReadonlyArray<ComputePlan['mode']>): ComputePlan {
  const mode = rng.pick(modes);
  const n = rng.int(2, 4);
  if (mode === 'none') return { mode: 'none', split_no: rng.pick([1, 1, 2]) };
  if (mode === 'items') return genItemPlan(rng, base.lines, n);
  if (mode === 'equal') return { mode: 'equal', splits: Array.from({ length: n }, (_, k) => ({ split_no: k + 1 })) };
  // amount: shares of the open remainder's default-class total (the screen's number), ≥ 1 each, Σ = that total.
  const total = computeBill({ ...base, plan: { mode: 'none', split_no: 1 }, payments: [] }).totals_default.total_minor;
  if (total < n) return { mode: 'none', split_no: 1 };
  const shares: number[] = [];
  let left = total;
  for (let k = 0; k < n - 1; k++) {
    const s = rng.int(1, left - (n - 1 - k));
    shares.push(s);
    left -= s;
  }
  shares.push(left);
  return { mode: 'amount', splits: shares.map((share_minor, k) => ({ split_no: k + 1, share_minor })) };
}

function splitNosOf(plan: ComputePlan): number[] {
  return plan.mode === 'none' ? [plan.split_no] : plan.splits.map((s) => s.split_no);
}

/** Random live payments per split (both classes, a few cash with tender, an `out` never above its type's `in`). */
function genPayments(rng: Rng, plan: ComputePlan): ComputePayment[] {
  const out: ComputePayment[] = [];
  for (const split_no of splitNosOf(plan)) {
    const k = rng.int(0, 3);
    const paid = { cash: 0, digital: 0 };
    for (let i = 0; i < k; i++) {
      const payment_class: Cls = rng.pick(['cash', 'digital'] as const);
      const amount_minor = rng.int(1, 60_000);
      paid[payment_class] += amount_minor;
      const p: ComputePayment = { split_no, payment_class, direction: 'in', amount_minor };
      if (payment_class === 'cash' && rng.chance(0.5)) p.tendered_minor = amount_minor + rng.int(0, 5_000);
      out.push(p);
    }
    for (const c of ['cash', 'digital'] as const) {
      if (paid[c] > 1 && rng.chance(0.15)) out.push({ split_no, payment_class: c, direction: 'out', amount_minor: rng.int(1, paid[c]) });
    }
  }
  return rng.shuffle(out);
}

/** One bill, from its seed alone. */
function genBill(seed: number, o: GenOpts = {}): ComputeBillInput {
  const rng = new Rng(seed);
  const integration_status: Status = rng.pick(['integrated', 'not_integrated'] as const);
  const rules: ComputeRules = {
    tax_enabled: o.taxEnabled ?? rng.chance(0.93),
    prices_include_tax: o.priceMode ?? rng.chance(0.5),
    rounding: o.rounding === undefined || o.rounding === 'random' ? genRounding(rng) : o.rounding,
    mixed_class_rule: 'higher_rate',
    integration_status,
    currency_exponent: rng.pick([2, 2, 2, 0, 3]),
  };
  if (o.roundingMode === 'random') rules.rounding = { ...rules.rounding, mode: rng.pick(['nearest', 'down', 'up'] as const) };
  const tax_profiles = genProfiles(rng, integration_status, o.punjab === true);
  const lines = genLines(rng, tax_profiles, o);
  const base = {
    business_date: BUSINESS_DATE,
    rules,
    tax_profiles,
    lines,
    discount: genDiscount(rng, lines, o.discount ?? 'random'),
    service_charge: genSc(rng, tax_profiles, o.sc ?? 'random'),
  };
  const plan = genPlan(rng, base, o.plans ?? ['none', 'items', 'items', 'amount', 'equal']);
  return { ...base, plan, payments: genPayments(rng, plan) };
}

// ---------------------------------------------------------------------------------------------------------------
// Shared invariant checks
// ---------------------------------------------------------------------------------------------------------------

/** One rounding per split (B9): R = rnd(G) − G by the frozen rule, |R| < step, T = G + R. */
function roundingProblem(rules: ComputeRules, t: ComputeTotals, cls: Cls): string | null {
  const ctx = { date: BUSINESS_DATE, rules, profiles: new Map(), sc: null };
  const want = Number(roundingR(ctx, BigInt(t.exact_total_minor), cls));
  if (t.rounding_minor !== want) return `R ${t.rounding_minor} ≠ rnd(G) − G ${want}`;
  if (t.total_minor !== t.exact_total_minor + t.rounding_minor) return `T ${t.total_minor} ≠ G + R`;
  const step = rules.rounding.step_minor;
  if (step !== null && Math.abs(t.rounding_minor) >= step) return `|R| ${t.rounding_minor} ≥ step ${step}`;
  return null;
}

/** §3.5 (8): G = N + SC + Σ tax rows; no negative figure; D ≤ S. */
function totalsProblem(t: ComputeTotals): string | null {
  const taxSum = t.taxes.reduce((a, r) => a + r.tax_minor, 0);
  if (t.exact_total_minor !== t.pre_tax_net_minor + t.service_charge_minor + taxSum) {
    return `G ${t.exact_total_minor} ≠ N ${t.pre_tax_net_minor} + SC ${t.service_charge_minor} + Σ tax ${taxSum}`;
  }
  const figures: Array<[string, number]> = [
    ['subtotal', t.subtotal_minor],
    ['discount', t.discount_minor],
    ['net', t.pre_tax_net_minor],
    ['sc', t.service_charge_minor],
    ['G', t.exact_total_minor],
    ['T', t.total_minor],
    ...t.taxes.flatMap((r): Array<[string, number]> => [
      [`${r.tax_code}.base`, r.base_minor],
      [`${r.tax_code}.tax`, r.tax_minor],
    ]),
  ];
  for (const [k, v] of figures) if (!Number.isSafeInteger(v) || v < 0) return `${k} = ${v} (negative or not an integer)`;
  if (t.discount_minor > t.subtotal_minor) return `D ${t.discount_minor} > S ${t.subtotal_minor}`;
  return null;
}

/** §3.8 (owner ruling 2026-11-28): T = the allocated target, R = T − G, |R| < 2 steps (equal: n steps; null: a few units). */
function targetProblem(rules: ComputeRules, t: ComputeTotals, target: number, nEqual = 0): string | null {
  if (t.total_minor !== target) return `T ${t.total_minor} ≠ target ${target}`;
  if (t.total_minor !== t.exact_total_minor + t.rounding_minor) return `T ${t.total_minor} ≠ G + R`;
  // equal: the last split takes the remainder of n − 1 whole-step shares, so up to n steps
  const bound = rules.rounding.step_minor === null ? 100 : Math.max(2, nEqual) * rules.rounding.step_minor + 100; // + per-split tax rounding drift
  if (Math.abs(t.rounding_minor) >= bound) return `|R| ${t.rounding_minor} ≥ ${bound}`;
  return null;
}

const fmt = (seed: number, what: string): string => `bill(${seed}): ${what}`;

function report(failures: string[], label: string): void {
  expect(failures.length, `${label}: ${failures.length} failure(s); first:\n${failures.slice(0, 12).join('\n')}`).toBe(0);
}

// ---------------------------------------------------------------------------------------------------------------
// #10 — compute half
// ---------------------------------------------------------------------------------------------------------------

describe('05 §10.1 #10 property: random bills (compute half)', () => {
  for (const master of [0x0510_0001, 0x0510_0002]) {
    it(`[05 #10] Σ split S = Σ line bases; Σ printed tax = Σ tax rows; one rounding per split (or the bill's allocated total, §3.8 2026-11-28); no negative figure; = model (seed ${master})`, () => {
      const failures: string[] = [];
      for (let i = 0; i < 2_500; i++) {
        const seed = billSeed(master, i);
        const input = genBill(seed);
        const res = computeBill(input);
        const diff = compareBill(input, res);
        if (diff !== null) {
          failures.push(fmt(seed, `model ≠ compute at ${diff}`));
          continue;
        }
        if (res.blocks.length > 0) continue;
        const sumBases = input.lines.reduce((a, l) => a + l.base_minor, 0);
        const sumS = res.splits.reduce((a, s) => a + s.totals.as_paid.subtotal_minor, 0);
        if (sumS !== sumBases) failures.push(fmt(seed, `Σ split S ${sumS} ≠ Σ line bases ${sumBases}`));
        const sumD = res.splits.reduce((a, s) => a + s.totals.as_paid.discount_minor, 0);
        if (sumD !== res.discount_minor) failures.push(fmt(seed, `Σ split D ${sumD} ≠ bill D ${res.discount_minor}`));
        // Σ printed tax = Σ invoice tax rows: the tax the printed total carries (G − N − SC, every split) equals Σ rows
        const printed = res.splits.reduce((a, s) => a + s.totals.as_paid.exact_total_minor - s.totals.as_paid.pre_tax_net_minor - s.totals.as_paid.service_charge_minor, 0);
        const rowsSum = res.splits.reduce((a, s) => a + s.totals.as_paid.taxes.reduce((b, r) => b + r.tax_minor, 0), 0);
        if (printed !== rowsSum) failures.push(fmt(seed, `Σ printed tax ${printed} ≠ Σ tax rows ${rowsSum}`));
        for (const s of res.splits) {
          for (const [cls, t] of [['cash', s.totals.cash], ['digital', s.totals.digital], ['as_paid', s.totals.as_paid]] as const) {
            // one rounding per split alone, or (§3.8 owner ruling 2026-11-28) R = the bill's allocated target − G
            const k = cls === 'as_paid' ? s.payment_class : cls;
            const p = totalsProblem(t) ?? (res.splits.length === 1 && (input.closed_rounding_minor ?? 0) === 0 ? roundingProblem(input.rules, t, k) : targetProblem(input.rules, t, s.total_targets[k], input.plan.mode === 'equal' ? res.splits.length : 0));
            if (p !== null) failures.push(fmt(seed, `split ${s.split_no} ${cls}: ${p}`));
          }
          if (s.rounding_minor !== s.totals.as_paid.rounding_minor) failures.push(fmt(seed, `split ${s.split_no}: rounding_minor ≠ as_paid R`));
          for (const l of s.lines) {
            if (l.discount_minor < 0 || l.discount_minor > l.base_minor || l.base_minor < 0) {
              failures.push(fmt(seed, `split ${s.split_no} line ${l.order_item_id}: share ${l.discount_minor} of base ${l.base_minor}`));
            }
          }
          for (const k of ['card_due_minor', 'cash_due_minor', 'card_refund_due_minor', 'cash_refund_due_minor', 'change_minor'] as const) {
            if (s[k] < 0) failures.push(fmt(seed, `split ${s.split_no}: ${k} ${s[k]} < 0`));
          }
          // computeBill's split = computeSplit on the same lines and payments (one arithmetic, §3.5).
          const alone = computeSplit({
            split_no: s.split_no,
            business_date: input.business_date,
            rules: input.rules,
            tax_profiles: input.tax_profiles,
            lines: s.lines,
            service_charge: input.service_charge,
            payments: input.payments.filter((p) => p.split_no === s.split_no),
            total_targets: s.total_targets,
          });
          const d = firstDiff(normSplit(alone), normSplit(s), `computeSplit vs computeBill split ${s.split_no}`);
          if (d !== null) failures.push(fmt(seed, d));
        }
      }
      report(failures, `#10 seed ${master}`);
    }, LONG);
  }

  it('[05 #10 / #13b] an applied service charge whose profile does not resolve is a tax_unresolved block naming SERVICE_CHARGE_ID', () => {
    const input = genBill(billSeed(0x0510_0003, 0), { sc: 'none', plans: ['none'], taxEnabled: true });
    const line: ComputeLine = { order_item_id: 'A', line_kind: 'item', units: 1, unit_price_minor: 1_000, base_minor: 1_000, tax_profile_id: 'P0' };
    const res = computeBill({ ...input, lines: [line], discount: null, payments: [], service_charge: { rate_bp: 1000, removed: false, tax_profile_id: 'NO_SUCH_PROFILE' } });
    const block = res.blocks.find((b) => b.reason === 'tax_unresolved');
    expect(block?.ids).toContain(SERVICE_CHARGE_ID);
  });

  for (const master of [0x0510_0b01, 0x0510_0b02]) {
    it(`[05 #10 / #13b] unresolved profiles (absent, no tax list, rate row in the future, a class row missing, other status only): the tax_unresolved block lists exactly those lines (seed ${master})`, () => {
      const failures: string[] = [];
      for (let i = 0; i < 2_000; i++) {
        const seed = billSeed(master, i);
        const rng = new Rng(seed ^ 0x68e31da4);
        const input0 = genBill(seed, { plans: ['none', 'items', 'equal'] });
        const status = input0.rules.integration_status;
        const other: Status = status === 'integrated' ? 'not_integrated' : 'integrated';
        const row = (c: Cls, st: Status, from: string): ComputeTaxRate => ({ payment_class: c, integration_status: st, effective_from: from, rate_bp: 1_000, ref: null });
        const tax = (rates: ComputeTaxRate[]): ComputeTax => ({ seq: 1, tax_code: 'UX', label: 'UX', compound: false, rates });
        const bad: ComputeTaxProfile[] = [
          { tax_profile_id: 'UX_EMPTY', taxes: [] },
          { tax_profile_id: 'UX_FUTURE', taxes: [tax([row('cash', status, '2026-11-20'), row('digital', status, '2026-11-20')])] },
          { tax_profile_id: 'UX_NO_DIGITAL', taxes: [tax([row('cash', status, '2026-01-01')])] },
          { tax_profile_id: 'UX_OTHER_STATUS', taxes: [tax([row('cash', other, '2026-01-01'), row('digital', other, '2026-01-01')])] },
          {
            tax_profile_id: 'UX_SECOND_TAX',
            taxes: [tax([row('cash', status, '2026-01-01'), row('digital', status, '2026-01-01')]), { ...tax([row('cash', status, '2026-12-01')]), seq: 2, tax_code: 'UX2' }],
          },
        ];
        const badIds = [...bad.map((p) => p.tax_profile_id), 'UX_ABSENT'];
        const lines = input0.lines.map((l) =>
          l.line_kind !== 'deal_part' && rng.chance(0.2) ? { ...l, tax_profile_id: rng.pick(badIds) } : l,
        );
        const sc = input0.service_charge;
        const input: ComputeBillInput = {
          ...input0,
          tax_profiles: rng.shuffle([...input0.tax_profiles, ...bad]),
          lines,
          service_charge: sc !== null && sc.tax_profile_id !== null && badIds.includes(sc.tax_profile_id) ? { ...sc, tax_profile_id: null } : sc,
        };
        const want = input.rules.tax_enabled ? lines.filter((l) => l.tax_profile_id !== null && badIds.includes(l.tax_profile_id)).map((l) => l.order_item_id).sort() : [];
        let res: ComputeBillResult;
        try {
          res = computeBill(input);
        } catch (e) {
          failures.push(fmt(seed, `computeBill threw ${(e as Error).message}`));
          continue;
        }
        const blocks = res.blocks.filter((b) => b.reason === 'tax_unresolved');
        const got = blocks.flatMap((b) => b.ids).sort();
        if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(fmt(seed, `tax_unresolved ids ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`));
        if (want.length > 0 && blocks.length !== 1) failures.push(fmt(seed, `${blocks.length} tax_unresolved blocks`));
        for (const l of res.lines) {
          const tagged = l.tags.includes('tax_unresolved');
          if (tagged !== want.includes(l.order_item_id)) failures.push(fmt(seed, `${l.order_item_id} tag ${tagged}`));
        }
        if (want.length === 0) {
          const diff = compareBill(input, res);
          if (diff !== null) failures.push(fmt(seed, `model ≠ compute at ${diff}`));
        }
      }
      report(failures, `#13b unresolved seed ${master}`);
    }, LONG);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// #10d — allocateCappedMinor
// ---------------------------------------------------------------------------------------------------------------

describe('05 §10.1 #10d property: allocateCappedMinor', () => {
  it('[05 #10d] random bases incl. [99900, 99900, 99900, 100] / 299 700: Σ = total, 0 ≤ share ≤ base, deterministic tie order (= model)', () => {
    const master = 0x0510_0d01;
    const failures: string[] = [];
    const cases: Array<{ seed: number; total: number; caps: number[] }> = [
      { seed: -1, total: 299_700, caps: [99_900, 99_900, 99_900, 100] },
      { seed: -1, total: 1, caps: [3, 3, 3] },
      { seed: -1, total: 2, caps: [3, 3, 3] },
      { seed: -1, total: 0, caps: [0, 0] },
      { seed: -1, total: 5, caps: [0, 5, 0] },
      { seed: -1, total: 9_999, caps: [4_000, 4_000, 2_000] },
    ];
    for (let i = 0; i < 20_000; i++) {
      const seed = billSeed(master, i);
      const rng = new Rng(seed);
      const n = rng.int(1, 12);
      const caps = Array.from({ length: n }, () => rng.pick([0, 1, 3, 100, 99_900, rng.int(0, 1_000), rng.int(0, 999_999_900)]));
      const sum = caps.reduce((a, b) => a + b, 0);
      cases.push({ seed, total: rng.pick([0, sum, Math.max(0, sum - 1), rng.int(0, sum)]), caps });
    }
    for (const { seed, total, caps } of cases) {
      const got = allocateCappedMinor(total, caps);
      const again = allocateCappedMinor(total, [...caps]);
      const want = largestRemainder(BigInt(total), caps.map(BigInt)).map(Number);
      const tag = `seed ${seed} total ${total} caps ${JSON.stringify(caps)}`;
      if (got.reduce((a, b) => a + b, 0) !== total) failures.push(`${tag}: Σ ${JSON.stringify(got)} ≠ total`);
      if (got.some((s, k) => s < 0 || s > caps[k])) failures.push(`${tag}: share outside [0, base] ${JSON.stringify(got)}`);
      if (JSON.stringify(got) !== JSON.stringify(again)) failures.push(`${tag}: not deterministic`);
      if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${tag}: compute ${JSON.stringify(got)} model ${JSON.stringify(want)}`);
    }
    expect(allocateCappedMinor(299_700, [99_900, 99_900, 99_900, 100])).toEqual([99_867, 99_867, 99_866, 100]);
    expect(allocateCappedMinor(1, [3, 3, 3])).toEqual([1, 0, 0]); // ties go to the earlier line
    expect(allocateCappedMinor(2, [3, 3, 3])).toEqual([1, 1, 0]);
    expect(() => allocateCappedMinor(11, [5, 5])).toThrow(); // a total above Σ caps is refused
    report(failures, '#10d allocateCappedMinor');
  });

  it("[05 #10d] run 2's per-part case: base 10 000, 99.99 %, units 2-2-1 → no split net, tax or total below 0 (= model)", () => {
    for (const prices_include_tax of [false, true]) {
      const input = genBill(billSeed(0x0510_0d02, prices_include_tax ? 1 : 0), { priceMode: prices_include_tax, plans: ['none'] });
      const line: ComputeLine = { order_item_id: 'B', line_kind: 'item', units: 5, unit_price_minor: 2_000, base_minor: 10_000, tax_profile_id: 'P0' };
      const bill: ComputeBillInput = {
        ...input,
        rules: { ...input.rules, tax_enabled: true },
        lines: [line],
        discount: { kind: 'percent', value: 9_999, frozen: null },
        plan: {
          mode: 'items',
          splits: [
            { split_no: 1, lines: [{ order_item_id: 'B', units: 2 }] },
            { split_no: 2, lines: [{ order_item_id: 'B', units: 2 }] },
            { split_no: 3, lines: [{ order_item_id: 'B', units: 1 }] },
          ],
        },
        payments: [],
      };
      const res = computeBill(bill);
      expect(compareBill(bill, res), `prices_include_tax ${prices_include_tax}`).toBeNull();
      expect(res.splits.map((s) => s.lines[0].base_minor)).toEqual([4_000, 4_000, 2_000]);
      expect(res.splits.map((s) => s.lines[0].discount_minor)).toEqual([4_000, 3_999, 2_000]);
      for (const s of res.splits) for (const t of [s.totals.cash, s.totals.digital, s.totals.as_paid]) expect(totalsProblem(t)).toBeNull();
    }
  });

  for (const master of [0x0510_0d03, 0x0510_0d04]) {
    it(`[05 #10d] heavy discounts (90–100 %) over item / amount / equal splits: no split net, tax or total below 0 (= model) (seed ${master})`, () => {
      const failures: string[] = [];
      for (let i = 0; i < 1_500; i++) {
        const seed = billSeed(master, i);
        const input = genBill(seed, { discount: 'heavy' });
        const res = computeBill(input);
        const diff = compareBill(input, res);
        if (diff !== null) failures.push(fmt(seed, `model ≠ compute at ${diff}`));
        for (const s of res.splits) {
          for (const t of [s.totals.cash, s.totals.digital, s.totals.as_paid]) {
            const p = totalsProblem(t);
            if (p !== null) failures.push(fmt(seed, `split ${s.split_no}: ${p}`));
          }
          for (const l of s.lines) if (l.discount_minor < 0 || l.discount_minor > l.base_minor) failures.push(fmt(seed, `line ${l.order_item_id} share outside [0, base]`));
        }
      }
      report(failures, `#10d heavy seed ${master}`);
    }, LONG);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// #11c — both price modes
// ---------------------------------------------------------------------------------------------------------------

describe('05 §10.1 #11c property: both price modes', () => {
  it('[05 #11c] apportionMinor by exact shares: the review case (152, e = 124.69 / 27.43) = [125, 27]; random weights Σ = total (= model)', () => {
    expect(apportionMinor(152, [12_469, 2_743])).toEqual([125, 27]);
    const failures: string[] = [];
    const master = 0x0511_0c01;
    for (let i = 0; i < 20_000; i++) {
      const seed = billSeed(master, i);
      const rng = new Rng(seed);
      // half the cases big: weights to 10^12 and totals to 5 × 10^10, so total × weight passes 2^53
      const big = rng.chance(0.5);
      const w = Array.from({ length: rng.int(1, 4) }, () =>
        big ? rng.pick([0, 1, rng.int(0, 1_000_000_000_000), rng.int(1_000_000_000, 99_999_999_999)]) : rng.pick([0, 1, 500, 1600, rng.int(0, 1_000_000)]),
      );
      const total = w.some((x) => x > 0) ? (big ? rng.int(0, 50_000_000_000) : rng.int(0, 2_000_000)) : 0;
      const got = apportionMinor(total, w);
      const want = largestRemainder(BigInt(total), w.map(BigInt)).map(Number);
      if (JSON.stringify(got) !== JSON.stringify(want) || got.some((x) => x < 0)) {
        failures.push(`seed ${seed} apportionMinor(${total}, ${JSON.stringify(w)}): compute ${JSON.stringify(got)} model ${JSON.stringify(want)}`);
      }
    }
    report(failures, '#11c apportionMinor');
  });

  it('[05 #11 / #11c] BigInt-sized inclusive case: Rs 9,999,999 × 5 units + 3 more lines (Rs 56,066,269.03) on a 500 + 800c + 950c profile — exact, not float', () => {
    const rate = (payment_class: Cls, rate_bp: number): ComputeTaxRate => ({ payment_class, integration_status: 'integrated', effective_from: '2026-01-01', rate_bp, ref: null });
    const tax = (seq: number, rate_bp: number, compound: boolean): ComputeTax => ({ seq, tax_code: `T${seq}`, label: `T${seq}`, compound, rates: [rate('cash', rate_bp), rate('digital', rate_bp)] });
    const big = (id: string): ComputeLine => ({ order_item_id: id, line_kind: 'item', units: 5, unit_price_minor: 999_999_900, base_minor: 4_999_999_500, tax_profile_id: 'BIG' });
    const lines = [
      big('A'),
      { ...big('B'), units: 3, unit_price_minor: 200_000_000, base_minor: 600_000_000 },
      { ...big('C'), units: 1, unit_price_minor: 6_000_000, base_minor: 6_000_000 },
      { ...big('D'), units: 1, unit_price_minor: 627_403, base_minor: 627_403 },
    ];
    const input: ComputeBillInput = {
      business_date: BUSINESS_DATE,
      rules: { tax_enabled: true, prices_include_tax: true, rounding: { step_minor: null, mode: 'nearest', applies_to: 'all' }, mixed_class_rule: 'higher_rate', integration_status: 'integrated', currency_exponent: 2 },
      tax_profiles: [{ tax_profile_id: 'BIG', taxes: [tax(1, 500, false), tax(2, 800, true), tax(3, 950, true)] }],
      lines,
      discount: null,
      service_charge: null,
      plan: { mode: 'none', split_no: 1 },
      payments: [],
    };
    const res = computeBill(input);
    expect(compareBill(input, res)).toBeNull();
    const t = res.splits[0].totals.as_paid;
    // A = 5 606 626 903; TI = round_half_up(A − A / M) = 1 091 452 990, spread by exact shares e_k
    expect(t.exact_total_minor).toBe(5_606_626_903);
    expect(t.pre_tax_net_minor).toBe(5_606_626_903 - 1_091_452_990);
    const exact = [225_758_696, 379_274_609, 486_419_685];
    expect(t.taxes.map((r) => r.tax_minor)).toEqual(exact);
    // The same largest-remainder spread in float (Number) arithmetic gives a different answer: TI × w_k passes 2^53.
    const w = [500 * 100_000_000, 800 * (100_000_000 + 500 * 10_000), 950 * (100_000_000 + 500 * 10_000 + 800 * (10_000 + 500))];
    const sw = w.reduce((a, b) => a + b, 0);
    const fl = w.map((x) => Math.floor((1_091_452_990 * x) / sw));
    const fr = w.map((x) => (1_091_452_990 * x) % sw);
    let left = 1_091_452_990 - fl.reduce((a, b) => a + b, 0);
    for (const i of [0, 1, 2].sort((i, j) => fr[j] - fr[i] || i - j)) if (left-- > 0) fl[i]++;
    expect(fl).not.toEqual(exact);
  });

  for (const [master, priceMode] of [
    [0x0511_0c02, false],
    [0x0511_0c03, true],
  ] as const) {
    it(`[05 #11c] ${priceMode ? 'inclusive' : 'exclusive'}: G = N + SC + Σ tax rows; discount before tax; SC on the pre-tax net; = model (seed ${master})`, () => {
      const failures: string[] = [];
      for (let i = 0; i < 2_500; i++) {
        const seed = billSeed(master, i);
        const input = genBill(seed, { priceMode });
        const res = computeBill(input);
        const diff = compareBill(input, res);
        if (diff !== null) {
          failures.push(fmt(seed, `model ≠ compute at ${diff}`));
          continue;
        }
        const sc = input.service_charge;
        for (const s of res.splits) {
          for (const t of [s.totals.cash, s.totals.digital]) {
            const p = totalsProblem(t);
            if (p !== null) failures.push(fmt(seed, `split ${s.split_no}: ${p}`));
            // SC on the pre-tax net, both modes (OQ-10), from compute's own N.
            const wantSc = sc !== null && !sc.removed ? Number(rhu(BigInt(t.pre_tax_net_minor) * BigInt(sc.rate_bp), U)) : 0;
            if (t.service_charge_minor !== wantSc) failures.push(fmt(seed, `split ${s.split_no}: SC ${t.service_charge_minor} ≠ round_half_up(N × bp) ${wantSc}`));
            // The discount is taken before tax: exclusive, a profile's simple rows tax Σ (base − share) (+ SC_p).
            if (!priceMode && input.rules.tax_enabled) {
              for (const r of t.taxes) {
                if (r.compound && t.taxes.some((x) => x.tax_profile_id === r.tax_profile_id && x.seq < r.seq)) continue;
                const A = s.lines.filter((l) => l.tax_profile_id === r.tax_profile_id).reduce((a, l) => a + l.base_minor - l.discount_minor, 0);
                const scp = sc !== null && !sc.removed && sc.tax_profile_id === r.tax_profile_id ? t.service_charge_minor : 0;
                if (r.base_minor !== A + scp) failures.push(fmt(seed, `split ${s.split_no} ${r.tax_code}: base ${r.base_minor} ≠ A_p + SC_p ${A + scp}`));
              }
            }
          }
        }
      }
      report(failures, `#11c seed ${master}`);
    }, LONG);
  }

  for (const master of [0x0511_0c04, 0x0511_0c05]) {
    it(`[05 #11c] inclusive, no discount, no SC, one class → G = Σ menu amounts; one rounding per profile, Σ apportioned = TI_p (seed ${master})`, () => {
      const failures: string[] = [];
      for (let i = 0; i < 2_500; i++) {
        const seed = billSeed(master, i);
        const rng = new Rng(seed ^ 0x5bd1e995);
        const input0 = genBill(seed, { priceMode: true, discount: 'none', sc: 'none' });
        const cls: Cls = rng.pick(['cash', 'digital'] as const);
        // one class: every split's payments of that class only (or none)
        const input: ComputeBillInput = { ...input0, payments: input0.payments.filter((p) => p.payment_class === cls && p.direction === 'in') };
        const res = computeBill(input);
        const diff = compareBill(input, res);
        if (diff !== null) {
          failures.push(fmt(seed, `model ≠ compute at ${diff}`));
          continue;
        }
        const ctx = ctxOf(input);
        for (const s of res.splits) {
          const t = s.totals.as_paid;
          const menu = s.lines.reduce((a, l) => a + l.base_minor, 0);
          if (t.exact_total_minor !== menu) failures.push(fmt(seed, `split ${s.split_no}: G ${t.exact_total_minor} ≠ Σ menu amounts ${menu}`));
          const m = modelTotals(ctx, toMLines(s.lines), s.payment_class);
          for (const [pid, ti] of m.ti) {
            const got = t.taxes.filter((r) => r.tax_profile_id === pid).reduce((a, r) => a + r.tax_minor, 0);
            if (got !== Number(ti)) failures.push(fmt(seed, `split ${s.split_no} ${pid}: Σ rows ${got} ≠ TI_p ${ti}`));
          }
        }
      }
      report(failures, `#11c inclusive seed ${master}`);
    }, LONG);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// #15e — payment order
// ---------------------------------------------------------------------------------------------------------------

describe('05 §10.1 #15e property: payment order, rounding rules', () => {
  const rules: Array<[string, number, (rng: Rng) => Rounding]> = [
    ['all', 0x0515_0e10, (rng) => ({ step_minor: rng.pick([1, 5, 100, 500, 1000]), mode: rng.pick(['nearest', 'down', 'up'] as const), applies_to: 'all' })],
    ['cash', 0x0515_0e20, (rng) => ({ step_minor: rng.pick([5, 10, 100, 500]), mode: rng.pick(['nearest', 'down', 'up'] as const), applies_to: 'cash' })],
    ['none', 0x0515_0e30, () => ({ step_minor: null, mode: 'nearest', applies_to: 'all' })],
  ];
  for (const [name, seedBase, roundingOf] of rules) {
    for (const master of [seedBase + 1, seedBase + 2]) {
    it(`[05 #15e] rounding '${name}', seed ${master}: every order of payments, plan splits and tax profiles gives the same tax rows, R and total; tax rows never depend on R; a no-change reopen is identical`, () => {
      const failures: string[] = [];
      for (let i = 0; i < 1_500; i++) {
        const seed = billSeed(master, i);
        const rng = new Rng(seed ^ 0x27d4eb2f);
        const rounding = roundingOf(rng);
        const input = { ...genBill(seed, { rounding, maxLines: 20 }) };
        const first = computeBill(input);
        const diff = compareBill(input, first);
        if (diff !== null) {
          failures.push(fmt(seed, `model ≠ compute at ${diff}`));
          continue;
        }
        const key = (r: ComputeBillResult): string =>
          JSON.stringify({
            splits: [...r.splits].sort((a, b) => a.split_no - b.split_no).map((s) => [s.split_no, s.payment_class, normSplit(s), byId(s.lines)]),
            bill: [r.discount_minor, r.lines, normTotals(r.totals_default), r.blocks],
          });
        const want = key(first);
        const shufflePlan = (plan: ComputePlan): ComputePlan =>
          plan.mode === 'none' ? plan : ({ ...plan, splits: rng.shuffle<(typeof plan.splits)[number]>(plan.splits) } as ComputePlan);
        for (let p = 0; p < 6; p++) {
          // p 0–1: payments only; 2: plan splits only; 3: tax profiles only; 4–5: all three
          const variant: ComputeBillInput = {
            ...input,
            payments: p === 2 || p === 3 ? input.payments : rng.shuffle(input.payments),
            plan: p === 2 || p >= 4 ? shufflePlan(input.plan) : input.plan,
            tax_profiles: p >= 3 ? rng.shuffle(input.tax_profiles) : input.tax_profiles,
          };
          const again = computeBill(variant);
          if (key(again) !== want) failures.push(fmt(seed, `order variant ${p} changed the bill: ${firstDiff(JSON.parse(key(again)), JSON.parse(want))}`));
        }
        // tax rows never depend on R: the same bill with step null has the same rows and G
        // (on the same split lines: an amount plan's shares are of the rounded total, so the split itself may differ)
        const noRules = { ...input.rules, rounding: { ...input.rules.rounding, step_minor: null } };
        for (const s of first.splits) {
          const o = computeSplit({
            split_no: s.split_no,
            business_date: input.business_date,
            rules: noRules,
            tax_profiles: input.tax_profiles,
            lines: s.lines,
            service_charge: input.service_charge,
            payments: input.payments.filter((p) => p.split_no === s.split_no),
          });
          for (const k of ['cash', 'digital', 'as_paid'] as const) {
            if (JSON.stringify(normRows(s.totals[k].taxes)) !== JSON.stringify(normRows(o.totals[k].taxes)) || s.totals[k].exact_total_minor !== o.totals[k].exact_total_minor) {
              failures.push(fmt(seed, `split ${s.split_no} ${k}: tax rows / G change with R`));
            }
          }
        }
        // a reopen with no line change = the same input with the carried payments
        const reopen = computeBill(structuredClone(input));
        if (JSON.stringify(reopen) !== JSON.stringify(first)) failures.push(fmt(seed, 'a no-change reopen changed the result'));
      }
      report(failures, `#15e '${name}' seed ${master}`);
    }, LONG);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// #16b / #16c — the frozen discount (B7 R3, H2-8)
// ---------------------------------------------------------------------------------------------------------------

describe('05 §10.1 #16b / #16c property: frozen discount cap over bill_discount_lines (compute half)', () => {
  for (const master of [0x0516_0b01, 0x0516_0b02]) {
    it(`[05 #16b #16c] open D = min(frozen − Σ closed D, eligible open lines' total), never negative, never above a base; other lines carry none (seed ${master})`, () => {
      const failures: string[] = [];
      for (let i = 0; i < 3_000; i++) {
        const seed = billSeed(master, i);
        const rng = new Rng(seed ^ 0x165667b1);
        const input0 = genBill(seed, { discount: 'none' });
        const eligible = input0.lines.filter(() => rng.chance(0.6)).map((l) => l.order_item_id);
        const line_ids = rng.shuffle([...eligible, ...(rng.chance(0.5) ? ['CLOSED_A', 'CLOSED_B'] : [])]); // closed lines leave the open part
        const amount_minor = rng.pick([0, rng.int(0, 1_000), rng.int(0, 5_000_000)]);
        const closed = rng.pick([0, amount_minor, rng.int(0, amount_minor)]);
        const discount: ComputeDiscount = {
          kind: rng.pick(['amount', 'percent'] as const),
          value: rng.int(0, 10_000),
          frozen: { amount_minor, closed_discount_minor: closed, line_ids },
        };
        const input = { ...input0, discount };
        if (input.plan.mode === 'amount') {
          input.plan = genPlan(rng, input, ['amount']); // shares of this bill's total
          input.payments = genPayments(rng, input.plan);
        }
        const res = computeBill(input);
        const diff = compareBill(input, res);
        if (diff !== null) failures.push(fmt(seed, `model ≠ compute at ${diff}`));
        const ids = new Set(line_ids);
        const cap = input.lines.filter((l) => ids.has(l.order_item_id)).reduce((a, l) => a + l.base_minor, 0);
        const want = Math.max(0, Math.min(amount_minor - closed, cap));
        if (res.discount_minor !== want) failures.push(fmt(seed, `open D ${res.discount_minor} ≠ min(frozen − closed, cap) ${want}`));
        for (const l of res.lines) {
          const line = input.lines.find((x) => x.order_item_id === l.order_item_id) as ComputeLine;
          if (!ids.has(l.order_item_id) && l.discount_minor !== 0) failures.push(fmt(seed, `${l.order_item_id} not in bill_discount_lines carries ${l.discount_minor}`));
          if (l.discount_minor < 0 || l.discount_minor > line.base_minor) failures.push(fmt(seed, `${l.order_item_id} share ${l.discount_minor} outside [0, ${line.base_minor}]`));
        }
        for (const s of res.splits) for (const l of s.lines) if (!ids.has(l.order_item_id) && l.discount_minor !== 0) failures.push(fmt(seed, `split ${s.split_no}: ${l.order_item_id} carries a share`));
      }
      report(failures, `#16b/#16c seed ${master}`);
    }, LONG);
  }

  it('[05 #16b #16c] named: 10 % on Rs 2,000 (A split 1 closed, D 100); void B → open D 0; half of B → min(100, B); round C full price', () => {
    const rules: ComputeRules = {
      tax_enabled: true,
      prices_include_tax: false,
      rounding: { step_minor: 100, mode: 'nearest', applies_to: 'all' },
      mixed_class_rule: 'higher_rate',
      integration_status: 'integrated',
      currency_exponent: 2,
    };
    const tax_profiles: ComputeTaxProfile[] = [
      {
        tax_profile_id: 'FOOD',
        taxes: [
          {
            seq: 1,
            tax_code: 'PST',
            label: 'PST',
            compound: false,
            rates: [
              { payment_class: 'cash', integration_status: 'integrated', effective_from: '2026-01-01', rate_bp: 1600, ref: null },
              { payment_class: 'digital', integration_status: 'integrated', effective_from: '2026-01-01', rate_bp: 500, ref: null },
            ],
          },
        ],
      },
    ];
    const item = (id: string, units: number): ComputeLine => ({ order_item_id: id, line_kind: 'item', units, unit_price_minor: 100_000, base_minor: 100_000 * units, tax_profile_id: 'FOOD' });
    const frozen = { amount_minor: 20_000, closed_discount_minor: 10_000, line_ids: ['A', 'B'] };
    const bill = (lines: ComputeLine[]): ComputeBillInput => ({
      business_date: BUSINESS_DATE,
      rules,
      tax_profiles,
      lines,
      discount: { kind: 'percent', value: 1_000, frozen },
      service_charge: null,
      plan: { mode: 'none', split_no: 2 },
      payments: [],
    });
    // void B: the open part is empty → open discount 0, split 2 total 0
    const none = computeBill(bill([]));
    expect(none.discount_minor).toBe(0);
    expect(none.splits[0].totals.as_paid.total_minor).toBe(0);
    // B still whole: D = min(100, 1,000) = 100.00
    expect(computeBill(bill([item('B', 2)])).discount_minor).toBe(10_000);
    // void half of B: B Rs 500 (one unit of two) → min(100, 500) = 100.00
    const half: ComputeLine = { ...item('B', 1), unit_price_minor: 50_000, base_minor: 50_000 };
    expect(computeBill(bill([half])).discount_minor).toBe(10_000);
    // a small remainder of B below the open discount → capped at B's base
    const small: ComputeLine = { ...item('B', 1), unit_price_minor: 4_000, base_minor: 4_000 };
    const s = computeBill(bill([small]));
    expect(s.discount_minor).toBe(4_000);
    expect(s.splits[0].totals.as_paid.total_minor).toBe(0);
    // #16c: a Rs 1,000 round C joins split 2, B voided → open D = min(100, 0) = 0, C pays full Rs 1,000 (+ 16 % = 1,160)
    const c = computeBill(bill([item('C', 1)]));
    expect(c.discount_minor).toBe(0);
    expect(c.lines).toEqual([{ order_item_id: 'C', discount_minor: 0, tags: [] }]);
    expect(c.splits[0].totals.cash.total_minor).toBe(116_000);
    // C beside B: C still carries none
    const cb = computeBill(bill([item('B', 2), item('C', 1)]));
    expect(cb.lines.find((l) => l.order_item_id === 'C')?.discount_minor).toBe(0);
    expect(cb.discount_minor).toBe(10_000);
    for (const r of [none, s, c, cb]) for (const sp of r.splits) expect(totalsProblem(sp.totals.as_paid)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// #20c / #23 — the payment pad simulation
// ---------------------------------------------------------------------------------------------------------------

interface SimStats {
  bills: number;
  splits: number;
  stuck: number;
  payments: number;
  refundBills: number;
  fullRefunds: number;
  /** Amount-plan reopens whose re-based last share fell below 1 (§3.8 shares_sum): re-planned, padded as returned, or skipped. */
  amountReplanned: number;
  amountPaddedBlocked: number;
  amountSkipped: number;
  zeroTotalSplits: number;
}

interface PadSplit {
  split_no: number;
  lines: ComputeSplitLine[];
  /** §3.8: the split's totals as the bill allocated them (computeBill's `total_targets`). */
  total_targets?: { cash: number; digital: number };
}

type SplitCtx = Omit<ComputeBillInput, 'lines' | 'plan' | 'payments' | 'discount'>;

function runSplit(base: SplitCtx, s: PadSplit, payments: readonly ComputePayment[]): ComputeSplitResult {
  return computeSplit({
    split_no: s.split_no,
    business_date: base.business_date,
    rules: base.rules,
    tax_profiles: base.tax_profiles,
    lines: s.lines,
    service_charge: base.service_charge,
    payments,
    total_targets: s.total_targets ?? null,
  });
}

/** A random amount in [1, due] the pad accepts for class `cls` (under 'cash' a cash amount is a step multiple). */
function padAmount(rng: Rng, rules: ComputeRules, cls: Cls, due: number): number {
  const step = rules.rounding.step_minor;
  const stepped = cls === 'cash' && rules.rounding.applies_to === 'cash' && step !== null;
  if (rng.chance(0.4)) return due; // the shown due, keyed as shown
  if (!stepped) return rng.int(1, due);
  return rng.int(1, Math.floor(due / (step as number))) * (step as number);
}

/**
 * Pays one split to B = 0 through the pad: an `in` only while B > 0 (≤ its due), an `out` only while B < 0 (≤ its
 * type's refund due). Returns the payments added, or a stuck reason. Checks H17-1, H16-1, H15-5 and the refund rules.
 */
function padToZero(
  rng: Rng,
  seed: number,
  base: SplitCtx,
  s: PadSplit,
  carried: ComputePayment[],
  failures: string[],
  stats: SimStats,
  phase: 'sale' | 'refund',
): { payments: ComputePayment[]; stuck: string | null; last: ComputeSplitResult } {
  const pays = [...carried];
  const ctx = ctxOf({ ...base, service_charge: base.service_charge });
  const step = base.rules.rounding.step_minor;
  const cashStepped = base.rules.rounding.applies_to === 'cash' && step !== null;
  let r = runSplit(base, s, pays);
  const firstOutClass = r.payment_class;
  const firstOutTaxes = JSON.stringify(normRows(r.totals.as_paid.taxes));
  for (let iter = 0; iter < 120; iter++) {
    const mdiff = compareSplit(ctx, s.lines, pays, r, s.total_targets);
    if (mdiff !== null) failures.push(fmt(seed, `${phase}: model ≠ compute at ${mdiff}`));
    const B = r.balance_minor;
    if (B <= 0 && (r.card_due_minor !== 0 || r.cash_due_minor !== 0)) failures.push(fmt(seed, `${phase} split ${s.split_no}: B ${B} ≤ 0 but in-dues ${r.card_due_minor} / ${r.cash_due_minor} (H17-1)`));
    if (B === 0) return { payments: pays, stuck: null, last: r };
    if (B > 0) {
      const options: Cls[] = [];
      if (r.card_due_minor > 0) options.push('digital');
      if (r.cash_due_minor > 0) options.push('cash');
      if (options.length === 0) return { payments: pays, stuck: `B ${B} > 0 and both in-dues 0`, last: r };
      const cls = rng.pick(options);
      const due = cls === 'digital' ? r.card_due_minor : r.cash_due_minor;
      const amount_minor = padAmount(rng, base.rules, cls, due);
      if (cls === 'cash' && cashStepped && amount_minor % (step as number) !== 0) return { payments: pays, stuck: `shown cash due ${due} off the step`, last: r };
      const p: ComputePayment = { split_no: s.split_no, payment_class: cls, direction: 'in', amount_minor };
      if (cls === 'cash' && rng.chance(0.5)) p.tendered_minor = amount_minor + rng.int(0, 10_000);
      const hadCash = pays.some((x) => x.direction === 'in' && x.payment_class === 'cash');
      const rawCash = Number(modelSplit(ctx, toMLines(s.lines), pays, s.total_targets).cash_due_raw);
      pays.push(p);
      stats.payments++;
      r = runSplit(base, s, pays);
      if (amount_minor === due) {
        // every shown due is accepted as keyed and closes as the class it implies (H15-5, H15-6, H16-1)
        const implied: Cls = cls === 'cash' || hadCash ? 'cash' : 'digital';
        if (r.payment_class !== implied) failures.push(fmt(seed, `${phase} split ${s.split_no}: paid ${cls} due ${due}, class ${r.payment_class} ≠ implied ${implied}`));
        const closes = cls === 'digital' || !cashStepped || due === rawCash;
        if (closes && r.balance_minor !== 0) failures.push(fmt(seed, `${phase} split ${s.split_no}: the shown ${cls} due ${due} paid as keyed leaves B ${r.balance_minor}`));
        if (!closes && (r.balance_minor < 0 || r.balance_minor >= (step as number))) failures.push(fmt(seed, `${phase} split ${s.split_no}: floored cash due ${due} leaves B ${r.balance_minor}`));
      }
      continue;
    }
    // B < 0: the refund dues, per type up to what that type paid
    const options: Cls[] = [];
    if (r.card_refund_due_minor > 0) options.push('digital');
    if (r.cash_refund_due_minor > 0) options.push('cash');
    if (options.length === 0) return { payments: pays, stuck: `B ${B} < 0 and both refund dues 0`, last: r };
    const cls = rng.pick(options);
    const due = cls === 'digital' ? r.card_refund_due_minor : r.cash_refund_due_minor;
    const amount_minor = padAmount(rng, base.rules, cls, due);
    pays.push({ split_no: s.split_no, payment_class: cls, direction: 'out', amount_minor });
    stats.payments++;
    r = runSplit(base, s, pays);
    const paidType = Number(netPaid(pays, cls));
    if (paidType < 0) failures.push(fmt(seed, `split ${s.split_no}: ${cls} out exceeds what ${cls} paid (net ${paidType})`));
    if (r.payment_class !== firstOutClass) failures.push(fmt(seed, `split ${s.split_no}: a refund changed the class ${firstOutClass} → ${r.payment_class}`));
    if (JSON.stringify(normRows(r.totals.as_paid.taxes)) !== firstOutTaxes) failures.push(fmt(seed, `split ${s.split_no}: a refund changed the tax rows`));
  }
  return { payments: pays, stuck: 'iteration cap', last: r };
}

/** #23 at every close: Σ in − Σ out = split total; change = Σ (tendered − amount) ≤ Σ cash tendered. */
function closeChecks(seed: number, r: ComputeSplitResult, pays: readonly ComputePayment[], failures: string[]): void {
  const inSum = pays.filter((p) => p.direction === 'in').reduce((a, p) => a + p.amount_minor, 0);
  const outSum = pays.filter((p) => p.direction === 'out').reduce((a, p) => a + p.amount_minor, 0);
  if (inSum - outSum !== r.totals.as_paid.total_minor) failures.push(fmt(seed, `split ${r.split_no}: Σ in − Σ out ${inSum - outSum} ≠ total ${r.totals.as_paid.total_minor}`));
  const cashIns = pays.filter((p) => p.direction === 'in' && p.payment_class === 'cash');
  const change = cashIns.reduce((a, p) => a + (p.tendered_minor ?? p.amount_minor) - p.amount_minor, 0);
  const tendered = cashIns.reduce((a, p) => a + (p.tendered_minor ?? p.amount_minor), 0);
  if (r.change_minor !== change) failures.push(fmt(seed, `split ${r.split_no}: change ${r.change_minor} ≠ Σ (tendered − amount) ${change}`));
  if (r.change_minor > tendered) failures.push(fmt(seed, `split ${r.split_no}: change ${r.change_minor} > Σ cash tendered ${tendered}`));
}

/** The reopened bill (§3.10): random removals (a unit off the highest-numbered split holding it) and new rounds. */
function reopenBill(rng: Rng, input: ComputeBillInput, payments: ComputePayment[]): { bill: ComputeBillInput; full: boolean } {
  const full = rng.chance(0.15);
  const step = input.rules.rounding.step_minor ?? 100;
  let lines: ComputeLine[] = [];
  const removed = new Map<string, number>();
  if (!full) {
    for (const l of input.lines) {
      const r = rng.next();
      if (r < 0.2) {
        removed.set(l.order_item_id, l.units);
        continue;
      }
      if (r < 0.4 && l.units > 1) {
        const keep = rng.int(1, l.units - 1);
        removed.set(l.order_item_id, l.units - keep);
        lines.push({ ...l, units: keep, base_minor: l.unit_price_minor * keep });
        continue;
      }
      lines.push(l);
    }
  } else for (const l of input.lines) removed.set(l.order_item_id, l.units);
  const added: ComputeLine[] = [];
  if (!full) {
    const k = rng.int(0, 3);
    const profiles = input.tax_profiles;
    for (let i = 0; i < k; i++) {
      const price = rng.chance(0.5) ? rng.int(1, Math.max(1, Math.floor((step - 1) / 2))) : rng.int(100, 300_000); // incl. under half a step
      const units = rng.int(1, 3);
      added.push({
        order_item_id: `N${i}`,
        line_kind: 'item',
        units,
        unit_price_minor: price,
        base_minor: price * units,
        tax_profile_id: rng.chance(0.85) ? rng.pick(profiles).tax_profile_id : null,
      });
    }
  }
  lines = [...lines, ...added];
  let plan: ComputePlan = input.plan;
  if (plan.mode === 'items') {
    const splits = plan.splits.map((s) => ({ split_no: s.split_no, lines: s.lines.map((x) => ({ ...x })) }));
    for (const [id, units] of removed) {
      let left = units;
      for (const s of [...splits].sort((a, b) => b.split_no - a.split_no)) {
        for (const x of s.lines) {
          if (x.order_item_id !== id || left === 0) continue;
          const take = Math.min(left, x.units);
          x.units -= take;
          left -= take;
        }
      }
    }
    const last = splits.reduce((a, s) => (s.split_no > a.split_no ? s : a));
    for (const l of added) last.lines.push({ order_item_id: l.order_item_id, units: l.units }); // joins the highest-numbered open split
    plan = { mode: 'items', splits: splits.map((s) => ({ split_no: s.split_no, lines: s.lines.filter((x) => x.units > 0) })) };
  }
  return { bill: { ...input, lines, plan, payments }, full };
}

function simulateBill(seed: number, input: ComputeBillInput, failures: string[], stats: SimStats, stuckList: string[]): void {
  const rng = new Rng(seed ^ 0x2545f491);
  const base: SplitCtx = { business_date: input.business_date, rules: input.rules, tax_profiles: input.tax_profiles, service_charge: input.service_charge };
  stats.bills++;
  const stuck = (what: string): void => {
    stats.stuck++;
    stuckList.push(fmt(seed, what));
  };
  // (1) sales
  const sale = computeBill({ ...input, payments: [] });
  if (sale.blocks.length > 0) {
    failures.push(fmt(seed, `sale bill blocked ${JSON.stringify(sale.blocks)}`));
    return;
  }
  let payments: ComputePayment[] = [];
  const closed = new Map<number, ComputeSplitResult>();
  for (const s of rng.shuffle(sale.splits)) {
    stats.splits++;
    const pad = { split_no: s.split_no, lines: s.lines, total_targets: s.total_targets };
    const out = padToZero(rng, seed, base, pad, [], failures, stats, 'sale');
    if (out.stuck !== null) {
      stuck(`sale split ${s.split_no}: ${out.stuck}`);
      return;
    }
    if (out.payments.some((p) => p.direction === 'out')) failures.push(fmt(seed, `sale split ${s.split_no}: needed an out`));
    if (out.payments.length === 0) stats.zeroTotalSplits++;
    closeChecks(seed, out.last, out.payments, failures);
    // tax rows identical to the same bill with R forced to 0 (step null); R never in a tax row
    const noR = runSplit({ ...base, rules: { ...base.rules, rounding: { ...base.rules.rounding, step_minor: null } } }, { split_no: pad.split_no, lines: pad.lines }, out.payments);
    if (JSON.stringify(normRows(noR.totals.as_paid.taxes)) !== JSON.stringify(normRows(out.last.totals.as_paid.taxes))) {
      failures.push(fmt(seed, `sale split ${s.split_no}: tax rows differ from the R = 0 bill`));
    }
    if (noR.totals.as_paid.exact_total_minor !== out.last.totals.as_paid.exact_total_minor) failures.push(fmt(seed, `sale split ${s.split_no}: G differs from the R = 0 bill`));
    if (out.last.totals.as_paid.rounding_minor !== 0 && noR.totals.as_paid.rounding_minor !== 0) failures.push(fmt(seed, 'R not 0 with step null'));
    closed.set(s.split_no, out.last);
    payments = [...payments, ...out.payments];
  }
  // the whole bill with every payment: every split at B = 0
  const paidBill = computeBill({ ...input, payments });
  for (const s of paidBill.splits) {
    if (s.balance_minor !== 0) stuck(`sale: bill view split ${s.split_no} B ${s.balance_minor}`);
    if (s.card_due_minor !== 0 || s.cash_due_minor !== 0) failures.push(fmt(seed, `sale: paid split ${s.split_no} shows in-dues (H17-1)`));
  }
  // (3) no-change reopen: same input with the carried payments → 0 changes of G, R, tax, total; 0 stuck
  const again = computeBill(structuredClone({ ...input, payments }));
  for (const s of again.splits) {
    const c = closed.get(s.split_no) as ComputeSplitResult;
    const a = s.totals.as_paid;
    const b = c.totals.as_paid;
    if (a.exact_total_minor !== b.exact_total_minor || a.rounding_minor !== b.rounding_minor || a.total_minor !== b.total_minor || JSON.stringify(normRows(a.taxes)) !== JSON.stringify(normRows(b.taxes))) {
      failures.push(fmt(seed, `no-change reopen changed split ${s.split_no}`));
    }
    if (s.balance_minor !== 0 || s.card_refund_due_minor !== 0 || s.cash_refund_due_minor !== 0 || s.card_due_minor !== 0 || s.cash_due_minor !== 0) {
      stuck(`no-change reopen split ${s.split_no}: B ${s.balance_minor}, dues ${s.card_due_minor}/${s.cash_due_minor}/${s.card_refund_due_minor}/${s.cash_refund_due_minor}`);
    }
  }
  // (2) refunds: reopen with random removals and additions, then the shown dues per type in random order
  const reo = reopenBill(rng, input, payments);
  const full = reo.full;
  let bill = reo.bill;
  let reopened = computeBill(bill);
  let blockedPad = false;
  if (reopened.blocks.some((b) => b.reason === 'shares_sum') && bill.plan.mode === 'amount') {
    // The amount plan's re-based last share fell below 1 (§3.8): staff re-plan with SetSplits (same split numbers,
    // the splits keep their payments). When the new total cannot give every split ≥ 1 (e.g. a full refund, T = 0),
    // the pad still runs on the splits compute returns, so the refunds of amount splits are exercised.
    const splitNos = bill.plan.splits.map((x) => x.split_no);
    const total = reopened.totals_default.total_minor;
    if (total >= splitNos.length) {
      const shares: number[] = [];
      let left = total;
      for (let k = 0; k < splitNos.length - 1; k++) {
        const v = rng.int(1, left - (splitNos.length - 1 - k));
        shares.push(v);
        left -= v;
      }
      shares.push(left);
      bill = { ...bill, plan: { mode: 'amount', splits: splitNos.map((split_no, k) => ({ split_no, share_minor: shares[k] })) } };
      reopened = computeBill(bill);
      stats.amountReplanned++;
    } else if (splitNos.every((n) => reopened.splits.some((x) => x.split_no === n))) {
      stats.amountPaddedBlocked++;
      blockedPad = true;
    } else {
      stats.amountSkipped++;
      return;
    }
  }
  if (reopened.blocks.some((b) => b.reason !== 'shares_sum') || (!blockedPad && reopened.blocks.length > 0)) {
    failures.push(fmt(seed, `reopened bill blocked ${JSON.stringify(reopened.blocks)}`));
    return;
  }
  stats.refundBills++;
  if (full) stats.fullRefunds++;
  let finalPays: ComputePayment[] = [];
  for (const s of rng.shuffle(reopened.splits)) {
    const carried = payments.filter((p) => p.split_no === s.split_no);
    const out = padToZero(rng, seed, base, { split_no: s.split_no, lines: s.lines, total_targets: s.total_targets }, carried, failures, stats, 'refund');
    if (out.stuck !== null) {
      stuck(`refund split ${s.split_no}: ${out.stuck}`);
      return;
    }
    closeChecks(seed, out.last, out.payments, failures);
    if (full) {
      if (out.last.totals.as_paid.total_minor !== 0) failures.push(fmt(seed, `full refund split ${s.split_no}: T ${out.last.totals.as_paid.total_minor} ≠ 0`));
      for (const c of ['cash', 'digital'] as const) {
        const inC = carried.filter((p) => p.payment_class === c).reduce((a, p) => a + p.amount_minor, 0);
        const outC = out.payments.filter((p) => p.payment_class === c && p.direction === 'out').reduce((a, p) => a + p.amount_minor, 0);
        if (inC !== outC) failures.push(fmt(seed, `full refund split ${s.split_no}: ${c} paid ${inC}, returned ${outC}`));
      }
    }
    finalPays = [...finalPays, ...out.payments];
  }
  const settled = computeBill({ ...bill, payments: finalPays });
  for (const s of settled.splits) if (s.balance_minor !== 0) stuck(`refund: bill view split ${s.split_no} B ${s.balance_minor}`);
}

const SETUPS: Array<{ name: string; rounding: Rounding; randomMode: boolean }> = [
  { name: "all, step 100 minor (Rs 1 at exponent 2), nearest", rounding: { step_minor: 100, mode: 'nearest', applies_to: 'all' }, randomMode: false },
  { name: 'cash, step 5 minor (nearest / down / up)', rounding: { step_minor: 5, mode: 'nearest', applies_to: 'cash' }, randomMode: true },
  { name: 'none (step null)', rounding: { step_minor: null, mode: 'nearest', applies_to: 'all' }, randomMode: false },
];

describe('05 §10.1 #20c property: higher_rate × {all, cash, none}, 30 000 bills each, two seeds', () => {
  const timings: string[] = [];
  for (const setup of SETUPS) {
    for (const master of [0x0520_0c01, 0x0520_0c02]) {
      it(`[05 #20c] ${setup.name}, seed ${master}: sales, refunds and no-change reopens reach B = 0 — zero stuck splits`, () => {
        const t0 = performance.now();
        const failures: string[] = [];
        const stuckList: string[] = [];
        const stats: SimStats = { bills: 0, splits: 0, stuck: 0, payments: 0, refundBills: 0, fullRefunds: 0, amountReplanned: 0, amountPaddedBlocked: 0, amountSkipped: 0, zeroTotalSplits: 0 };
        for (let i = 0; i < 30_000; i++) {
          const seed = billSeed(master, i);
          const input = genBill(seed, {
            rounding: setup.rounding,
            roundingMode: setup.randomMode ? 'random' : undefined,
            punjab: true,
            maxLines: 8,
            discount: 'percent_or_none',
            exactBase: true,
          });
          simulateBill(seed, input, failures, stats, stuckList);
        }
        const ms = Math.round(performance.now() - t0);
        timings.push(`${setup.name} seed ${master}: ${ms} ms`);
        console.log(`[05 #20c] ${setup.name} seed ${master}: ${ms} ms wall; ${JSON.stringify(stats)}`);
        expect(stats.stuck, `stuck splits:\n${stuckList.slice(0, 12).join('\n')}`).toBe(0);
        report(failures, `#20c ${setup.name} seed ${master}`);
      }, LONG);
    }
  }
});

describe('05 §10.2 #23 property: payments at every close', () => {
  for (const master of [0x0523_0001, 0x0523_0002]) {
    it(`[05 #23] Σ in − Σ out = split total at every close; change = Σ (tendered − amount) ≤ Σ cash tendered (seed ${master})`, () => {
      const failures: string[] = [];
      const stuckList: string[] = [];
      const stats: SimStats = { bills: 0, splits: 0, stuck: 0, payments: 0, refundBills: 0, fullRefunds: 0, amountReplanned: 0, amountPaddedBlocked: 0, amountSkipped: 0, zeroTotalSplits: 0 };
      for (let i = 0; i < 2_000; i++) {
        const seed = billSeed(master, i);
        // any rounding rule, any profiles (1–3 taxes, compound), both modes; percent discounts so a reopen stays valid
        const input = genBill(seed, { rounding: 'random', maxLines: 15, discount: 'percent_or_none', exactBase: true });
        simulateBill(seed, input, failures, stats, stuckList);
      }
      expect(stats.stuck, `stuck splits:\n${stuckList.slice(0, 12).join('\n')}`).toBe(0);
      report(failures, `#23 seed ${master}`);
    }, LONG);
  }
});
