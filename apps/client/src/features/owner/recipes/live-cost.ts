import type { CostWire, InventoryDetail } from '@pos/events';

// 08 v1.1 Part B §8.2: the recipe editor's live cost, pure and i18n-free (no apps/client imports), so the cloud's
// client-contract test (apps/cloud/test/recipes/client-contract.int.test.ts) runs this very code against the real
// routes. Exact bigint fractions; rounded once, half away from zero (B9); misc at the top only (B5, AD-30).

export interface Frac {
  num: bigint;
  den: bigint;
}

const QTY_RE = /^(-?)(\d{1,6})(?:\.(\d{1,4}))?$/; // B4 (m-8)

// B4: a quantity "0.25" → 25 / 100; null when it does not match the pattern or is 0.
export function parseQty(text: string): Frac | null {
  const m = QTY_RE.exec(text.trim());
  if (m === null) return null;
  const frac = m[3] ?? '';
  const num = BigInt(`${m[2]!}${frac}`) * (m[1] === '-' ? -1n : 1n);
  if (num === 0n) return null;
  return { num, den: 10n ** BigInt(frac.length) };
}

// "Misc allowance %": up to 2 decimals → basis points 0 … 5 000 (B5), else null.
const PCT_RE = /^([0-9]{1,2})(?:\.([0-9]{1,2}))?$/;
export function parseMiscPercent(text: string): number | null {
  const m = PCT_RE.exec(text.trim());
  if (m === null) return null;
  const bp = Number(m[1]!) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp <= 5_000 ? bp : null;
}
export function miscPercentText(bp: number): string {
  const paisa = bp % 100;
  return paisa === 0 ? String(bp / 100) : `${Math.floor(bp / 100)}.${String(paisa).padStart(2, '0').replace(/0$/, '')}`;
}

// The unit pick-list of a line (08a I5, the units resolveUnit accepts): the stock unit, its built-ins (the big one
// first, as amounts are typed) and the item's current units on its stock unit.
export function unitChoices(data: InventoryDetail): string[] {
  const base = data.stock_item.stock_unit;
  const builtins = data.builtin_units.filter((b) => b.base === base).map((b) => b.unit_name);
  const own = data.units.filter((u) => u.is_current && u.base_unit === base).map((u) => u.unit_name);
  return [...new Set([base, ...builtins, ...own])];
}

// I5 on the read detail: stock unit 1/1, the item's current unit, else a built-in on that base; null → not convertible.
export function unitFactor(data: InventoryDetail, unitName: string): Frac | null {
  const name = unitName.trim().toLowerCase();
  const base = data.stock_item.stock_unit;
  if (name === base) return { num: 1n, den: 1n };
  const own = data.units.find((u) => u.is_current && u.base_unit === base && u.unit_name === name);
  if (own !== undefined) return { num: BigInt(own.factor_num), den: BigInt(own.factor_den) };
  const builtin = data.builtin_units.find((b) => b.base === base && b.unit_name === name);
  return builtin === undefined ? null : { num: BigInt(builtin.num), den: BigInt(builtin.den) };
}

// B4 (M-7): the basis the cloud derives when none is sent: per_batch → AP; an ingredient with an active yield → EP;
// every other line → AP. null while the item's yield is not read yet.
export function derivedBasis(basis: string, kind: string, hasYield: boolean | null): 'AP' | 'EP' | null {
  if (basis === 'per_batch' || kind !== 'ingredient') return 'AP';
  if (hasYield === null) return null;
  return hasYield ? 'EP' : 'AP';
}

export type LiveCost = { known: true; value: Frac } | { known: false };

// B9 for an ingredient or packet line: qty × unit factor × menu cost per stock unit ÷ (EP ingredient ? yield : 1).
// No menu cost, an unknown unit, EP with no yield (D9) or a prepared line (its batch cost is the cloud's) → unknown.
export function liveLineCost(data: InventoryDetail | undefined, line: { qty: string; unit_name: string; basis: 'AP' | 'EP' }): LiveCost {
  if (data === undefined || data.stock_item.kind === 'prepared' || data.menu_cost === null) return { known: false };
  const qty = parseQty(line.qty);
  const factor = unitFactor(data, line.unit_name);
  if (qty === null || factor === null) return { known: false };
  let num = qty.num * factor.num * BigInt(data.menu_cost.per_stock_unit.num);
  let den = qty.den * factor.den * BigInt(data.menu_cost.per_stock_unit.den);
  if (line.basis === 'EP' && data.stock_item.kind === 'ingredient') {
    if (data.active_yield === null) return { known: false };
    num *= 10_000n;
    den *= BigInt(data.active_yield.yield_bp);
  }
  return { known: true, value: { num, den } };
}

// B9: rounded to minor units once, half away from zero.
export function roundHalfAway(value: Frac): bigint {
  const negative = value.num < 0n !== value.den < 0n;
  const n = value.num < 0n ? -value.num : value.num;
  const d = value.den < 0n ? -value.den : value.den;
  const rounded = (2n * n + d) / (2n * d);
  return negative ? -rounded : rounded;
}

// Σ known lines × (10 000 + misc) / 10 000 (misc at the top only, B5; a batch recipe is never a top). Status as B9:
// partial when a line is unknown, minor null when nothing is known (an empty option recipe is a known 0, M-6).
// AD-25: an empty recipe of a non-option owner is partial with minor null (the cloud's CostWire); `option` = an
// option owner, whose empty recipe is a known 0.
export function livePlateCost(lines: readonly LiveCost[], miscBp: number, top: boolean, option = true): CostWire {
  if (lines.length === 0 && !option) return { status: 'partial', minor: null, unknown_items: [] };
  let num = 0n;
  let den = 1n;
  let known = 0;
  for (const line of lines) {
    if (!line.known) continue;
    known++;
    num = num * line.value.den + line.value.num * den;
    den *= line.value.den;
  }
  const partial = known < lines.length;
  if (known === 0 && lines.length > 0) return { status: 'partial', minor: null, unknown_items: [] };
  const total = top ? { num: num * BigInt(10_000 + miscBp), den: den * 10_000n } : { num, den };
  return { status: partial ? 'partial' : 'costed', minor: roundHalfAway(total).toString(), unknown_items: [] };
}
