import { childQuantity, optionChargeMinor, orderLineTotalMinor, type Unit } from '@pos/domain';
import type { BranchConfig, ConfigDeal, ConfigItem, ConfigModifierOption } from '@pos/events';
import type { CarType, EtaDraft, EtaPreviewBody, OrderType, SubmitLine } from '../contracts';

// 02b §8 Ordering screen (02-S05; #36 cart sorted by ETA): the cart the order screen keeps (and the device draft
// stores, Draft.cart), its money from @pos/domain exactly as the hub's buildSubmit computes ItemAdded.line_total_minor
// (apps/hub/src/orders/build-submit.ts), its eta-preview draft (§6.14) and its groups. Every id is device-minted
// (newUlid) when the line is added and never changes, so the preview `key` is the line's order_item_id and the
// frozen SubmitOrder (26d) sends the same ids.

export interface CartOption {
  option_id: string;
  quantity: number;
  /** a linked option's child line id (01c §3.4.2); a plain option has none */
  order_item_id?: string;
}

export interface CartDealChoice {
  deal_part_id: string;
  item_id: string;
  order_item_id: string;
  options?: CartOption[];
}

export interface CartLine {
  /** the line's order_item_id */
  key: string;
  item_id?: string;
  deal_id?: string;
  /** units (piece), g / ml (weighed), or null for "Weigh later" (§3.6) */
  quantity: number | null;
  options: CartOption[];
  deal_choices?: CartDealChoice[];
  kitchen_note?: string;
  /** a zone tile tap (§8 Zone items) */
  from_zone?: boolean;
  /** E-7 "Send it as a new item": the screen asks "Comp it?" once it is sent (badge "Sent again · asks to comp") */
  comp_it?: boolean;
  /** E-7 / Q-7: the line arrived without its choices; the screen opens its options sheet once (the sheet clears it) */
  pick_options?: boolean;
}

export interface Cart {
  lines: CartLine[];
  order_note?: string;
  /** 02b §8 Types: a takeaway's name / phone, a parking order's plate / type / phone (the new-order sheets) */
  takeaway?: { customer_name?: string; phone?: string };
  parking?: { car_number: string; car_type: CarType; phone?: string };
  /** IR-8: the queue log entry this cart was copied from (25c shows that row as "Copied") */
  from_entry_id?: string;
}

export const EMPTY_CART: Cart = { lines: [] };

// ----------------------------------------------------------------------------------------------- money

function optionOf(config: BranchConfig, option_id: string): ConfigModifierOption | undefined {
  for (const g of config.modifier_groups) {
    const o = g.options.find((x) => x.option_id === option_id);
    if (o !== undefined) return o;
  }
  return undefined;
}

function itemOf(config: BranchConfig, item_id: string | undefined): ConfigItem | undefined {
  return item_id === undefined ? undefined : config.items.find((i) => i.item_id === item_id);
}

function dealOf(config: BranchConfig, deal_id: string | undefined): ConfigDeal | undefined {
  return deal_id === undefined ? undefined : config.deals.find((d) => d.deal_id === deal_id);
}

/** 01c V20 (hub build-submit.ts:145-147 `unitOf` = ctx.draws(item).sale_unit): the item's sale unit frozen for the
 * open day (the device stock mirror's `saleUnit`), else the config's; null = not on the menu. */
export type UnitOf = (item_id: string) => Unit | null;

/** The config's own unit: for code that has no stock mirror (tests, a reading before the catch-up). */
export const configUnits =
  (config: BranchConfig): UnitOf =>
  (item_id) =>
    itemOf(config, item_id)?.sale_unit ?? null;

/**
 * One cart line's money, exactly as the hub's buildSubmit bills it (apps/hub/src/orders/build-submit.ts):
 * - item: orderLineTotalMinor(item, plain option charges, the day's sale unit) (:247-253) + each linked child's
 *   orderLineTotalMinor(option_child, option price, childQuantity) (:214, :233);
 * - "Weigh later" (quantity null): the parent is null until weighed (:247 → null), its linked children are billed
 *   now (childQuantity of a g / ml parent = the option quantity, :214) → `pending` with the children's money;
 * - deal: orderLineTotalMinor(deal, parts' extras and option charges, B2) (:330-340).
 * Anything missing (an item, option, deal, part or choice no longer on the menu, a deal without its quantity) →
 * `unknown`: the screen shows "—", never a lower price.
 */
export type LineMoney = { kind: 'ok'; minor: number } | { kind: 'pending'; minor: number } | { kind: 'unknown' };

const UNKNOWN: LineMoney = { kind: 'unknown' };

export function cartLineMoney(config: BranchConfig, line: CartLine, unitOf: UnitOf): LineMoney {
  if (line.deal_id !== undefined) {
    const deal = dealOf(config, line.deal_id);
    if (deal === undefined || line.quantity === null) return UNKNOWN;
    const dealQty = line.quantity;
    const parts = [];
    for (const part of deal.parts) {
      const choice = line.deal_choices?.find((c) => c.deal_part_id === part.deal_part_id);
      if (choice === undefined) return UNKNOWN;
      const offered = part.choices.find((c) => c.item_id === choice.item_id);
      const unit = unitOf(choice.item_id);
      if (offered === undefined || unit === null) return UNKNOWN;
      // §3.4.3 (B2, build-submit.ts:281-286): a piece part's options per piece of the part; a g / ml part's once per deal
      const optionParent = unit === 'piece' ? part.quantity * dealQty : dealQty;
      const charges: number[] = [];
      for (const o of choice.options ?? []) {
        const option = optionOf(config, o.option_id);
        if (option === undefined) return UNKNOWN;
        charges.push(optionChargeMinor(option.price_minor, o.quantity, optionParent, 'piece'));
      }
      parts.push({ sale_unit: unit, quantity: part.quantity, extra_price_minor: offered.extra_price_minor, option_charges_minor: charges });
    }
    const total = orderLineTotalMinor({ line_kind: 'deal', price_minor: deal.price_minor, quantity: dealQty, parts });
    return total === null ? UNKNOWN : { kind: 'ok', minor: total };
  }
  const item = itemOf(config, line.item_id);
  const unit = line.item_id === undefined ? null : unitOf(line.item_id);
  if (item === undefined || unit === null) return UNKNOWN;
  // a piece parent always has its quantity (V18); only a weighed line may wait for its weight
  if (line.quantity === null && unit === 'piece') return UNKNOWN;
  let children = 0;
  const plain: number[] = [];
  for (const o of line.options) {
    const option = optionOf(config, o.option_id);
    if (option === undefined) return UNKNOWN;
    if (option.linked_item_id === null) {
      plain.push(optionChargeMinor(option.price_minor, o.quantity, line.quantity ?? 0, unit));
    } else {
      const childQty = childQuantity(o.quantity, line.quantity ?? 0, unit);
      const child = orderLineTotalMinor({ line_kind: 'option_child', price_minor: option.price_minor, quantity: childQty, option_charges_minor: [] });
      if (child === null) return UNKNOWN;
      children += child;
    }
  }
  const parent = orderLineTotalMinor({ line_kind: 'item', price_minor: item.price_minor, quantity: line.quantity, sale_unit: unit, option_charges_minor: plain });
  return parent === null ? { kind: 'pending', minor: children } : { kind: 'ok', minor: parent + children };
}

/** Σ of the lines' money (a pending weight's parent counts after weighing; its children now); null if a line is unknown. */
export function cartTotal(config: BranchConfig, cart: Cart, unitOf: UnitOf): number | null {
  let sum = 0;
  for (const l of cart.lines) {
    const m = cartLineMoney(config, l, unitOf);
    if (m.kind === 'unknown') return null;
    sum += m.minor;
  }
  return sum;
}

/** The count in the cart head ("6 items"): units of piece lines and deals, 1 per weighed line (the day's unit). */
export function cartCount(cart: Cart, unitOf: UnitOf): number {
  return cart.lines.reduce((n, l) => {
    if (l.deal_id === undefined && l.item_id !== undefined && unitOf(l.item_id) !== 'piece') return n + 1;
    return n + (l.quantity ?? 1);
  }, 0);
}

/** Units of one menu item in the cart (the tile's in-cart badge and the stock cap, O15). */
export function unitsOf(cart: Cart, item_id: string): number {
  return cart.lines.reduce((n, l) => (l.item_id === item_id && l.deal_id === undefined ? n + (l.quantity ?? 0) : n), 0);
}

// ---------------------------------------------------------------------------------------------- edits

const plainLine = (l: CartLine, item_id: string, from_zone: boolean) =>
  l.item_id === item_id && l.options.length === 0 && l.kitchen_note === undefined && (l.from_zone === true) === from_zone && l.quantity !== null;

/** A tap on a simple tile: one more on the item's plain line, or a new line of 1. */
export function addTap(cart: Cart, item_id: string, newKey: () => string, o: { from_zone?: boolean } = {}): Cart {
  const from_zone = o.from_zone === true;
  const i = cart.lines.findIndex((l) => plainLine(l, item_id, from_zone));
  if (i >= 0) return { ...cart, lines: cart.lines.map((l, j) => (j === i ? { ...l, quantity: (l.quantity ?? 0) + 1 } : l)) };
  const line: CartLine = { key: newKey(), item_id, quantity: 1, options: [], ...(from_zone ? { from_zone: true } : {}) };
  return { ...cart, lines: [...cart.lines, line] };
}

/** Adds a line built by a sheet (options, deal, weight; 26c). */
export function addLine(cart: Cart, line: CartLine): Cart {
  return { ...cart, lines: [...cart.lines, line] };
}

export function replaceLine(cart: Cart, line: CartLine): Cart {
  return { ...cart, lines: cart.lines.map((l) => (l.key === line.key ? line : l)) };
}

/** The stepper (piece lines and deals): at least 1; `cap` = the most units the line may hold (O15). */
export function setUnits(cart: Cart, key: string, units: number, cap: number | null = null): Cart {
  const n = Math.max(1, cap === null ? units : Math.min(units, cap));
  return { ...cart, lines: cart.lines.map((l) => (l.key === key && l.quantity !== null ? { ...l, quantity: n } : l)) };
}

export function removeLine(cart: Cart, key: string): Cart {
  return { ...cart, lines: cart.lines.filter((l) => l.key !== key) };
}

// --------------------------------------------------------------------------------------- preview draft

export interface DraftTarget {
  order_type: OrderType;
  table_id?: string;
  seating_id?: string;
}

/** §6.14: the SubmitOrder lines without ids; the temp keys are the device ids, so a reply maps onto the lines. */
export function toEtaDraft(cart: Cart, target: DraftTarget): EtaDraft {
  return {
    order_type: target.order_type,
    ...(target.table_id === undefined ? {} : { table_id: target.table_id }),
    ...(target.seating_id === undefined ? {} : { seating_id: target.seating_id }),
    ...(cart.order_note === undefined ? {} : { order_note: cart.order_note }),
    ...(target.order_type === 'takeaway' && cart.takeaway !== undefined ? { takeaway: { ...cart.takeaway } } : {}),
    ...(target.order_type === 'parking' && cart.parking !== undefined ? { parking: { ...cart.parking } } : {}),
    lines: cart.lines.map((l) => ({
      key: l.key,
      ...(l.item_id === undefined ? {} : { item_id: l.item_id }),
      ...(l.deal_id === undefined ? {} : { deal_id: l.deal_id }),
      ...(l.quantity === null ? {} : { quantity: l.quantity }),
      ...(l.options.length === 0 ? {} : { options: l.options.map((o) => ({ option_id: o.option_id, quantity: o.quantity, ...(o.order_item_id === undefined ? {} : { key: o.order_item_id }) })) }),
      ...(l.deal_choices === undefined
        ? {}
        : {
            deal_choices: l.deal_choices.map((c) => ({
              deal_part_id: c.deal_part_id,
              item_id: c.item_id,
              key: c.order_item_id,
              ...(c.options === undefined ? {} : { options: c.options.map((o) => ({ option_id: o.option_id, quantity: o.quantity, ...(o.order_item_id === undefined ? {} : { key: o.order_item_id }) })) }),
            })),
          }),
      ...(l.kitchen_note === undefined ? {} : { kitchen_note: l.kitchen_note }),
      ...(l.from_zone === true ? { from_zone: true } : {}),
    })),
  };
}

/** §6.1: the SubmitOrder lines (26d freezes them with the payload). */
export function toSubmitLines(cart: Cart): SubmitLine[] {
  return cart.lines.map((l) => ({
    order_item_id: l.key,
    ...(l.item_id === undefined ? {} : { item_id: l.item_id }),
    ...(l.deal_id === undefined ? {} : { deal_id: l.deal_id }),
    ...(l.quantity === null ? {} : { quantity: l.quantity }),
    ...(l.options.length === 0 ? {} : { options: l.options.map((o) => ({ ...o })) }),
    ...(l.deal_choices === undefined ? {} : { deal_choices: l.deal_choices.map((c) => ({ ...c, ...(c.options === undefined ? {} : { options: c.options.map((o) => ({ ...o })) }) })) }),
    ...(l.kitchen_note === undefined ? {} : { kitchen_note: l.kitchen_note }),
    ...(l.from_zone === true ? { from_zone: true } : {}),
  }));
}

// --------------------------------------------------------------------------------------------- groups

export interface ShownLine {
  line: CartLine;
  /** null: no preview time (none yet, failed, offline, or a counter line) */
  eta_ms: number | null;
  refused: { code: string; details: Record<string, unknown> } | null;
}

export type CartGroup =
  | { kind: 'counter'; lines: ShownLine[] }
  | { kind: 'promise'; promise_ms: number; lines: ShownLine[] }
  /** no preview: one group, times "—" ("Times will be set when sent") */
  | { kind: 'pending'; lines: ShownLine[] };

/**
 * #36 (E2-ETA AC2): counter lines first ("From the counter · Now": zone-served, or no kitchen time); then the
 * preview's groups by promise, each line by its time (then cart order). A line the reply does not cover (added since)
 * waits in a pending group. Without a preview, every line is in one pending group in cart order.
 */
export function groupCart(cart: Cart, preview: EtaPreviewBody | null): CartGroup[] {
  if (preview === null) return cart.lines.length === 0 ? [] : [{ kind: 'pending', lines: cart.lines.map((line) => ({ line, eta_ms: null, refused: null })) }];
  const byKey = new Map(preview.lines.map((l) => [l.key, l]));
  const groupOf = new Map<string, number>();
  preview.groups.forEach((g, i) => g.keys.forEach((k) => groupOf.set(k, i)));
  const counter: ShownLine[] = [];
  const pending: ShownLine[] = [];
  const promised = new Map<number, ShownLine[]>();
  for (const line of cart.lines) {
    const p = byKey.get(line.key);
    if (p === undefined) {
      pending.push({ line, eta_ms: null, refused: null });
      continue;
    }
    const shown: ShownLine = { line, eta_ms: p.eta_ms, refused: p.refused ?? null };
    const g = groupOf.get(line.key);
    if (p.zone_served || (p.refused === undefined && (p.eta_ms === null || g === undefined))) counter.push({ ...shown, eta_ms: null });
    else if (g === undefined) pending.push(shown);
    else promised.set(g, [...(promised.get(g) ?? []), shown]);
  }
  const order = (a: ShownLine, b: ShownLine) => (a.eta_ms ?? Number.MAX_SAFE_INTEGER) - (b.eta_ms ?? Number.MAX_SAFE_INTEGER);
  const out: CartGroup[] = [];
  if (counter.length > 0) out.push({ kind: 'counter', lines: counter });
  [...promised.entries()]
    .sort(([a], [b]) => preview.groups[a]!.promise_ms - preview.groups[b]!.promise_ms || a - b)
    .forEach(([g, lines]) => out.push({ kind: 'promise', promise_ms: preview.groups[g]!.promise_ms, lines: [...lines].sort(order) }));
  if (pending.length > 0) out.push({ kind: 'pending', lines: pending });
  return out;
}

/** "All ready by": the latest promise of the preview, or null. */
export function readyBy(preview: EtaPreviewBody | null): number | null {
  if (preview === null || preview.groups.length === 0) return null;
  return Math.max(...preview.groups.map((g) => g.promise_ms));
}

// -------------------------------------------------------------------------------------------- problems

export type LineProblem =
  | { kind: 'only_left'; n: number }
  | { kind: 'station_paused' }
  | { kind: 'sold_out' }
  | { kind: 'not_now' }
  | { kind: 'off' };

/**
 * §3.2 step 5, §3.10 (hub submit-order.ts zoneServe :280-305, build-submit.ts :383-386): the from_zone lines the
 * zone count covers — a from_zone line with no options, whole (its quantity ≤ what is left), claimed in line order.
 * A covered line is served at the table's zone counter: it never reaches the engine's sold-out check (step 8).
 */
export function zoneCovered(cart: Cart, zoneOnHand: (item_id: string) => number | null): Set<string> {
  const left = new Map<string, number>();
  const out = new Set<string>();
  for (const line of cart.lines) {
    if (line.from_zone !== true || line.item_id === undefined || line.options.length > 0 || line.quantity === null) continue;
    const have = left.get(line.item_id) ?? zoneOnHand(line.item_id);
    if (have === null || have < line.quantity) continue;
    left.set(line.item_id, have - line.quantity);
    out.add(line.key);
  }
  return out;
}

/** Units of one item the kitchen must make (every line but the zone-covered ones): the stock cap counts these. */
export function kitchenUnits(cart: Cart, item_id: string, covered: ReadonlySet<string>, except?: string): number {
  return cart.lines.reduce((n, l) => (l.item_id === item_id && l.deal_id === undefined && !covered.has(l.key) && l.key !== except ? n + (l.quantity ?? 0) : n), 0);
}

/**
 * 02-B05 / B07: a line the hub would refuse. From the preview's `refused` (ITEM_SOLD_OUT { available },
 * STATION_PAUSED, ITEM_OUT_OF_HOURS, ITEM_UNAVAILABLE) or, for a sold_out item, the device's own stock count
 * (`capOf`: the units left; the kitchen lines of that item over it → "Only n left"). A zone-covered line is never
 * a stock problem (`covered`). ITEM_SOLD_OUT's `available` is already what is left after the payload's earlier
 * lines (hub submit-order.ts soldOutDetails :375-401, shared with eta-preview), so "Set to n" uses it as given.
 */
export function lineProblems(cart: Cart, preview: EtaPreviewBody | null, capOf: (item_id: string) => number | null, covered: ReadonlySet<string> = new Set()): Map<string, LineProblem> {
  const out = new Map<string, LineProblem>();
  const refused = new Map((preview?.lines ?? []).flatMap((l) => (l.refused === undefined ? [] : [[l.key, l.refused] as const])));
  const used = new Map<string, number>();
  for (const line of cart.lines) {
    const r = refused.get(line.key);
    if (r !== undefined) {
      const available = r.details['available'];
      if (r.code === 'ITEM_SOLD_OUT') out.set(line.key, typeof available === 'number' && available > 0 ? { kind: 'only_left', n: available } : { kind: 'sold_out' });
      else if (r.code === 'STATION_PAUSED') out.set(line.key, { kind: 'station_paused' });
      else if (r.code === 'ITEM_OUT_OF_HOURS') out.set(line.key, { kind: 'not_now' });
      else out.set(line.key, { kind: 'off' });
      continue;
    }
    if (line.item_id === undefined || line.quantity === null || covered.has(line.key)) continue;
    const cap = capOf(line.item_id);
    if (cap === null) continue;
    const before = used.get(line.item_id) ?? 0;
    used.set(line.item_id, before + line.quantity);
    if (before + line.quantity > cap) {
      const left = Math.max(0, cap - before);
      out.set(line.key, left > 0 ? { kind: 'only_left', n: left } : { kind: 'sold_out' });
    }
  }
  return out;
}
