// 02b §3.4 (O19–O21; 01c §3.4.8): the per-line money ledger, pure (0 statements). Shares come from allocateDealMinor and
// cascade units from childQuantity (@pos/domain); neither is reimplemented here. Inputs are plain counters (a subset of
// LineView); a remade unit stays live for money (O20), so returned_units is never an input. A bad count throws: the
// commands validate units first (422) and call these with valid numbers only.
import { allocateDealMinor, childQuantity } from '@pos/domain';
import type { ItemRemovedPayload, ItemVoidedPayload, LineCompedPayload } from '@pos/events';
import type { LineShares, LineView } from './contracts.js';

/** §3.4 / §5: one line's unit counters and money columns. A LineView is one. */
export type LedgerLine = Pick<
  LineView,
  | 'refundable_minor'
  | 'units'
  | 'comped_units'
  | 'removed_units'
  | 'voided_units'
  | 'comp_minor'
  | 'comp_voided_minor'
  | 'removed_minor'
  | 'refund_minor'
>;
type Money = Pick<LineView, 'comp_minor' | 'comp_voided_minor' | 'removed_minor' | 'refund_minor'>;
export type LedgerAction = 'remove' | 'void' | 'comp';
/** A line a command names (or a part / child it cascades to). */
export type LedgerRef = LedgerLine & Pick<LineView, 'order_item_id'>;
export type LedgerParent = LedgerRef & Pick<LineView, 'line_kind' | 'sale_unit'>;

function count(fn: string, name: string, n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${fn}: ${name} must be a non-negative integer`);
}

function units(fn: string, n: number, max: number): void {
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`${fn}: units must be an integer in 1 … ${max}`);
}

const pick = (l: LedgerLine): LedgerLine => ({
  refundable_minor: l.refundable_minor,
  units: l.units,
  comped_units: l.comped_units,
  removed_units: l.removed_units,
  voided_units: l.voided_units,
  comp_minor: l.comp_minor,
  comp_voided_minor: l.comp_voided_minor,
  removed_minor: l.removed_minor,
  refund_minor: l.refund_minor,
});

/** §3.4: `live_units = units − removed − voided` (remade units stay live, O20). */
export const liveUnits = (l: Pick<LedgerLine, 'units' | 'removed_units' | 'voided_units'>): number =>
  l.units - l.removed_units - l.voided_units;

/** §3.4: the money out of billing, `comp + comp_voided + removed + refund` (≤ refundable, the CHECK). */
export const moneyOutMinor = (l: Money): number => l.comp_minor + l.comp_voided_minor + l.removed_minor + l.refund_minor;

/** §3.4 / §3.6: any unit out of billing (comped, removed or voided) → a weight is refused `LINE_ALREADY_SETTLED`. */
export const hasUnitOutOfBilling = (l: Pick<LedgerLine, 'comped_units' | 'removed_units' | 'voided_units'>): boolean =>
  l.comped_units + l.removed_units + l.voided_units > 0;

/**
 * §3.4 `lineShares`: shares = allocateDealMinor(refundable, [1 × units]) (every share q, the last q + r). The k-th unit to
 * leave billing (k = comped + removed + voided) takes shares[k]; one comped unit's take-back is comp_minor − q × (comped − 1).
 */
export const lineShares: LineShares = (line) => {
  const fn = 'lineShares';
  count(fn, 'refundable_minor', line.refundable_minor);
  count(fn, 'comp_minor', line.comp_minor);
  for (const k of ['comped_units', 'removed_units', 'voided_units'] as const) count(fn, k, line[k]);
  if (!Number.isSafeInteger(line.units) || line.units < 1) throw new Error(`${fn}: units must be a positive integer`);
  const out = line.comped_units + line.removed_units + line.voided_units;
  if (out > line.units) throw new Error(`${fn}: more units out of billing than the line has`);
  const shares = allocateDealMinor(line.refundable_minor, Array.from({ length: line.units }, () => 1));
  const q = shares[0] as number;
  return {
    next_share_minor(n: number): number {
      count(fn, 'n', n);
      if (out + n > line.units) throw new Error(`${fn}: only ${line.units - out} free shares`);
      let total = 0;
      for (let k = out; k < out + n; k++) total += shares[k] as number;
      return total;
    },
    comped_take_back_minor(n: number): number {
      count(fn, 'n', n);
      if (n > line.comped_units) throw new Error(`${fn}: only ${line.comped_units} comped units`);
      let comped = line.comped_units;
      let comp = line.comp_minor;
      let total = 0;
      for (let i = 0; i < n; i++) {
        // The remainder share, if the comp holds it, goes first; otherwise q.
        const back = comp - q * (comped - 1);
        if (back < 0 || back > comp) throw new Error(`${fn}: comp_minor does not match comped_units`);
        comp -= back;
        comped -= 1;
        total += back;
      }
      return total;
    },
  };
};

// Remove / void take uncomped live units first; then comped units, each taking its share back out of comp_minor.
function takeOut(fn: string, line: LedgerLine, n: number): { fresh: number; back: number; taken_comped: number } {
  units(fn, n, liveUnits(line));
  const uncomped = Math.min(n, liveUnits(line) - line.comped_units);
  const s = lineShares(line);
  return { fresh: s.next_share_minor(uncomped), back: s.comped_take_back_minor(n - uncomped), taken_comped: n - uncomped };
}

/** §3.4 remove n units: the uncomped shares and the comped take-backs move to removed_minor. */
export function removeUnits(line: LedgerLine, n: number): { after: LedgerLine; removed_minor: number } {
  const { fresh, back, taken_comped } = takeOut('removeUnits', line, n);
  const after = pick(line);
  after.removed_units += n;
  after.comped_units -= taken_comped;
  after.comp_minor -= back;
  after.removed_minor += fresh + back;
  return { after, removed_minor: fresh + back };
}

/** §3.4 void n units: uncomped shares → refund_minor; a comped unit's take-back → comp_voided_minor, never a refund (O21). */
export function voidUnits(line: LedgerLine, n: number): { after: LedgerLine; refund_minor: number; comp_voided_minor: number } {
  const { fresh, back, taken_comped } = takeOut('voidUnits', line, n);
  const after = pick(line);
  after.voided_units += n;
  after.comped_units -= taken_comped;
  after.comp_minor -= back;
  after.refund_minor += fresh;
  after.comp_voided_minor += back;
  return { after, refund_minor: fresh, comp_voided_minor: back };
}

/** §3.4 / §3.9 comp n units (≤ live − comped): the next free shares; value_minor is this line's own share. */
export function compUnits(line: LedgerLine, n: number): { after: LedgerLine; value_minor: number } {
  units('compUnits', n, liveUnits(line) - line.comped_units);
  const value = lineShares(line).next_share_minor(n);
  const after = pick(line);
  after.comped_units += n;
  after.comp_minor += value;
  return { after, value_minor: value };
}

/**
 * §3.4 cascade (01c :309, :312): the units n parent units give a part / child line. Per parent unit a deal part gives its
 * per-portion units and an option child its option quantity (both = child units / parent units), through childQuantity;
 * capped at the child's live units (remove / void) or live − comped (comp). The parent's last live unit (for comp, its
 * last uncomped live unit) takes every remaining part / child unit. Call with both lines as they are before the action.
 */
export function cascadeUnits(action: LedgerAction, parent: LedgerParent, n: number, child: LedgerLine): number {
  const fn = 'cascadeUnits';
  if (parent.line_kind !== 'item' && parent.line_kind !== 'deal') throw new Error(`${fn}: a ${parent.line_kind} line has no children`);
  if (child.units % parent.units !== 0) throw new Error(`${fn}: child units are not a multiple of the parent's`);
  const cap = action === 'comp' ? liveUnits(child) - child.comped_units : liveUnits(child);
  const parentLeft = action === 'comp' ? liveUnits(parent) - parent.comped_units : liveUnits(parent);
  units(fn, n, parentLeft);
  if (n === parentLeft) return cap;
  const perParentUnit = child.units / parent.units;
  // 01c §3.4.2: an option child follows its parent's sale unit; a deal part's quantity = part qty × deal qty.
  return Math.min(childQuantity(perParentUnit, n, parent.line_kind === 'deal' ? 'piece' : parent.sale_unit), cap);
}

/** One line of a planned action: its units, its ledger after, its own event payload. */
export interface PlannedLine<P> {
  order_item_id: string;
  units: number;
  after: LedgerLine;
  payload: P;
}

// The parent's n units, then each part / child its cascaded units; a line the cascade gives 0 units gets no event.
function targets(action: LedgerAction, parent: LedgerParent, children: readonly LedgerRef[], n: number): { line: LedgerRef; units: number }[] {
  const out: { line: LedgerRef; units: number }[] = [{ line: parent, units: n }];
  for (const c of children) {
    const u = cascadeUnits(action, parent, n, c);
    if (u > 0) out.push({ line: c, units: u });
  }
  return out;
}

/** §3.4 / §3.5: remove n parent units and the cascade; one `ItemRemoved { order_item_id, units }` per line. */
export function planRemove(
  parent: LedgerParent,
  children: readonly LedgerRef[],
  n: number,
): { lines: PlannedLine<ItemRemovedPayload>[]; removed_minor: number } {
  let total = 0;
  const lines = targets('remove', parent, children, n).map(({ line, units: u }) => {
    const r = removeUnits(line, u);
    total += r.removed_minor;
    return { order_item_id: line.order_item_id, units: u, after: r.after, payload: { order_item_id: line.order_item_id, units: u } };
  });
  return { lines, removed_minor: total };
}

/** §3.4 (To 04): void n parent units and the cascade; one `ItemVoided` per line with its own refund / comp-voided money. */
export function planVoid(
  parent: LedgerParent,
  children: readonly LedgerRef[],
  n: number,
): { lines: PlannedLine<ItemVoidedPayload>[]; refund_minor: number; comp_voided_minor: number } {
  let refund = 0;
  let compVoided = 0;
  const lines = targets('void', parent, children, n).map(({ line, units: u }) => {
    const v = voidUnits(line, u);
    refund += v.refund_minor;
    compVoided += v.comp_voided_minor;
    const payload: ItemVoidedPayload = {
      order_item_id: line.order_item_id,
      units: u,
      refund_minor: v.refund_minor,
      comp_voided_minor: v.comp_voided_minor,
    };
    return { order_item_id: line.order_item_id, units: u, after: v.after, payload };
  });
  return { lines, refund_minor: refund, comp_voided_minor: compVoided };
}

/** The LineComped fields the command supplies (same on every line of one comp; §3.9). */
export type CompMeta = Pick<LineCompedPayload, 'reason_code' | 'note' | 'requester_staff_id' | 'alert_id' | 'approver_staff_id'>;

/**
 * §3.4 / §3.9: comp n parent units and the cascade; one `LineComped` per line carrying only its own value; value_minor
 * (the request amount and the command result) is the sum over every line touched.
 */
export function planComp(
  parent: LedgerParent,
  children: readonly LedgerRef[],
  n: number,
  meta: CompMeta,
): { lines: PlannedLine<LineCompedPayload>[]; value_minor: number } {
  let total = 0;
  const lines = targets('comp', parent, children, n).map(({ line, units: u }) => {
    const c = compUnits(line, u);
    total += c.value_minor;
    const payload: LineCompedPayload = { order_item_id: line.order_item_id, units: u, value_minor: c.value_minor, ...meta };
    return { order_item_id: line.order_item_id, units: u, after: c.after, payload };
  });
  return { lines, value_minor: total };
}

/**
 * §3.4 billed_minor: item / option_child = refundable − money out; deal_part = 0 (01c :303); deal = line_total − Σ over
 * its parts of their money out (`parts` = the deal's part lines; only a deal takes them).
 */
export function billedMinor(
  line: Money & Pick<LineView, 'line_kind' | 'refundable_minor' | 'line_total_minor'>,
  parts: readonly Money[] = [],
): number {
  if (line.line_kind !== 'deal' && parts.length > 0) throw new Error(`billedMinor: a ${line.line_kind} line has no parts`);
  switch (line.line_kind) {
    case 'item':
    case 'option_child':
      return line.refundable_minor - moneyOutMinor(line);
    case 'deal_part':
      return 0;
    case 'deal':
      return (line.line_total_minor ?? 0) - parts.reduce((a, p) => a + moneyOutMinor(p), 0);
  }
}

/**
 * §3.4 (run 4 M-1): removing (or 04 voiding) fewer than all live units of a deal with a g/ml part, or of a g/ml deal_part
 * alone, while that part is open in the engine (stage before served) → `422 { reason: 'gml_deal_part_partial' }`.
 * `parts`: for a deal, its part lines; for a deal_part, the line itself. `open_in_engine` is the caller's stage read.
 */
export function gmlDealPartPartial(input: {
  line_kind: LineView['line_kind'];
  live_units: number;
  units: number;
  parts: readonly { sale_unit: LineView['sale_unit']; open_in_engine: boolean }[];
}): boolean {
  if (input.line_kind !== 'deal' && input.line_kind !== 'deal_part') return false;
  if (input.units >= input.live_units) return false;
  return input.parts.some((p) => p.sale_unit !== 'piece' && p.open_in_engine);
}
