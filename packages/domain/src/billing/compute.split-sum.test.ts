// 05 §3.8 (owner ruling 2026-11-28, QA BUG-1): equal shares in whole rounding steps, the last split takes the
// remainder; Σ open split totals = the bill's total at every class and rounding mode; a split never carries its own
// rounding loss. Item / amount splits keep the same invariant.
import { describe, expect, it } from 'vitest';
import { computeBill, computeSplit, type ComputeBillInput, type ComputePlan, type ComputeRules } from './compute.js';
import { cashStepRules, line, noneRules, pkPbProfile, PK_RULES, rateBpProfile, TODAY } from './compute.fixtures.js';

const downRules: ComputeRules = { ...PK_RULES, rounding: { step_minor: 100, mode: 'down', applies_to: 'all' } };

function bill(over: Partial<ComputeBillInput> = {}): ComputeBillInput {
  return {
    business_date: TODAY,
    rules: downRules,
    tax_profiles: [rateBpProfile('zero', 'none', 0)],
    lines: [line('L1', 4_000, null)],
    discount: null,
    service_charge: null,
    plan: { mode: 'none', split_no: 1 },
    payments: [],
    ...over,
  };
}

const equal = (n: number, from = 1): ComputePlan => ({ mode: 'equal', splits: Array.from({ length: n }, (_, i) => ({ split_no: from + i })) });

describe('05 §3.8 equal split in whole rounding steps (QA BUG-1)', () => {
  it('[05 §3.8 BUG-1] Rs 40 split 3, rounding down → 13 / 13 / 14, Σ = Rs 40 at both classes', () => {
    const r = computeBill(bill({ plan: equal(3) }));
    expect(r.splits.map((s) => s.totals.cash.total_minor)).toEqual([1_300, 1_300, 1_400]);
    expect(r.splits.map((s) => s.totals.digital.total_minor)).toEqual([1_300, 1_300, 1_400]);
    expect(r.splits.map((s) => s.cash_due_minor)).toEqual([1_300, 1_300, 1_400]);
    expect(r.splits.map((s) => s.card_due_minor)).toEqual([1_300, 1_300, 1_400]);
    expect(r.totals_default.total_minor).toBe(4_000);
  });

  it('[05 §3.8 BUG-1] after split 1 closes at 13, the open remainder carries its rounding: 27 → 13 / 14', () => {
    // split 1 (G 13.33) closed at 13 (R −0.33); the open part's lines hold base 26.67
    const r = computeBill(bill({ lines: [line('L1', 2_667, null)], plan: equal(2, 2), closed_rounding_minor: -33 }));
    expect(r.totals_default.total_minor).toBe(2_700);
    expect(r.splits.map((s) => s.totals.cash.total_minor)).toEqual([1_300, 1_400]);
  });

  it('[05 §3.8 BUG-1] computeSplit with the bill’s total target gives the same total (close-split recompute)', () => {
    const r = computeBill(bill({ plan: equal(3) }));
    const last = r.splits[2]!;
    const s = computeSplit({
      split_no: 3,
      business_date: TODAY,
      rules: downRules,
      tax_profiles: [rateBpProfile('zero', 'none', 0)],
      lines: last.lines,
      service_charge: null,
      payments: [],
      total_targets: last.total_targets,
    });
    expect(s.totals.as_paid.total_minor).toBe(1_400);
    expect(s.rounding_minor).toBe(66); // G 13.34 → 14
  });
});

// Random property: Σ open split totals = the bill's open total, per class, for every rounding mode and plan kind.
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x1_0000_0000;
  };
}

describe('05 §3.8 property: Σ splits = bill (QA BUG-1)', () => {
  const ruleSets: Array<[string, ComputeRules]> = [];
  for (const mode of ['nearest', 'down', 'up'] as const) {
    ruleSets.push([`all/100/${mode}`, { ...PK_RULES, rounding: { step_minor: 100, mode, applies_to: 'all' } }]);
    ruleSets.push([`cash/5/${mode}`, cashStepRules({ rounding: { step_minor: 5, mode, applies_to: 'cash' } })]);
  }
  ruleSets.push(['none', noneRules()]);
  for (const [name, rules] of ruleSets) {
    it(`[05 §3.8 BUG-1] n = 2..8, equal / amount / items, both classes, ${name}`, () => {
      const rand = rng(0x0b1 + name.length * 7919 + name.charCodeAt(name.length - 1));
      const failures: string[] = [];
      for (let i = 0; i < 400; i++) {
        const n = 2 + Math.floor(rand() * 7);
        const nLines = 1 + Math.floor(rand() * 5);
        const lines = Array.from({ length: nLines }, (_, j) => line(`L${j}`, 1 + Math.floor(rand() * 200_000), rand() < 0.8 ? 'restaurant' : null, { units: n }));
        const closedR = rand() < 0.3 ? -Math.floor(rand() * 99) : 0;
        const nos = Array.from({ length: n }, (_, j) => j + 1);
        const kind = (['equal', 'amount', 'items'] as const)[Math.floor(rand() * 3)]!;
        const base: ComputeBillInput = {
          business_date: TODAY,
          rules,
          tax_profiles: [pkPbProfile()],
          lines,
          discount: rand() < 0.3 ? { kind: 'percent', value: 1_000, frozen: null } : null,
          service_charge: rand() < 0.3 ? { rate_bp: 500, removed: false, tax_profile_id: 'restaurant' } : null,
          plan: { mode: 'none', split_no: 1 },
          payments: [],
          closed_rounding_minor: closedR,
        };
        const whole = computeBill(base);
        let plan: ComputePlan;
        if (kind === 'equal') plan = equal(n);
        else if (kind === 'amount') {
          const t = whole.totals_default.total_minor;
          const each = Math.floor(t / n);
          plan = { mode: 'amount', splits: nos.map((s) => ({ split_no: s, share_minor: each })) };
        } else plan = { mode: 'items', splits: nos.map((s) => ({ split_no: s, lines: lines.map((l) => ({ order_item_id: l.order_item_id, units: 1 })) })) };
        const r = computeBill({ ...base, plan });
        if (r.blocks.length > 0) continue;
        for (const k of ['cash', 'digital'] as const) {
          const want = (k === 'cash' ? r.totals_default : r.totals_default_digital).total_minor;
          const sum = r.splits.reduce((a, s) => a + s.totals[k].total_minor, 0);
          if (sum !== want) failures.push(`#${i} ${kind} n=${n} ${k}: Σ ${sum} ≠ bill ${want}`);
          const dueSum = r.splits.reduce((a, s) => a + (k === 'cash' ? s.cash_due_minor : s.card_due_minor), 0);
          const wantDue = rules.rounding.applies_to === 'cash' && k === 'cash' && rules.rounding.step_minor !== null ? want - (want % rules.rounding.step_minor) : want;
          if (dueSum !== wantDue) failures.push(`#${i} ${kind} n=${n} ${k} due: Σ ${dueSum} ≠ ${wantDue}`);
          for (const s of r.splits) if (s.totals[k].total_minor < 0) failures.push(`#${i} split ${s.split_no} ${k} negative`);
        }
        if (kind === 'equal' && rules.rounding.step_minor !== null) {
          const step = rules.rounding.step_minor;
          for (const s of r.splits.slice(0, -1)) {
            if (s.totals.cash.total_minor % step !== 0) failures.push(`#${i} equal split ${s.split_no} cash ${s.totals.cash.total_minor} not in whole steps`);
          }
        }
      }
      expect(failures.slice(0, 10)).toEqual([]);
    });
  }
});
