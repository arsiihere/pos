import type { BranchConfig } from '@pos/events';
import type { HubError } from '../../../../api/hub-admin';
import { t, type MessageKey } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { TABLE_ERROR_CODES, tableErrorKey } from '../../tables/errors';
import type { Enqueue } from '../../tables/contracts';
import type { CarType, Draft, DraftStore, EtaPreviewBody, LineOption, SubmitOrderPayload, SubmitResult } from '../contracts';
import { toSubmitLines, type Cart, type CartLine, type DraftTarget } from '../order-screen/cart';
import { preselect } from '../sheets/preselect';

// 02b §8 Ordering screen (Send freezes the cart), Types, Queue; §3.1, §3.2, §3.11, §6.1; §10 #35 (no "sent" before a
// 2xx, frozen cart, own pending ORDER_ITEM_ID_IN_USE shown as sent — the queue answers `sent` without a result,
// 25b), #36 (zone-empty flip, day not started). Send: build the SubmitOrder payload once and freeze it (deep copy,
// Object.freeze), hand it to the one queue (`Enqueue`, 25b: stored before the first send), and read its answer.

/** 02b §8 Types: phone 10–13 digits (hub submit-order.ts :20-48), plate /^[A-Za-z0-9 -]{2,12}$/, car type. */
export const PHONE_RE = /^\d{10,13}$/;
export const PLATE_RE = /^[A-Za-z0-9 -]{2,12}$/;

export interface OrderDetails {
  takeaway?: { customer_name?: string; phone?: string };
  parking?: { car_number: string; car_type: CarType; phone?: string };
}

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x);
  }
  return v;
}

/** #35 frozen cart: the payload Send sends, a frozen copy — a later cart change never reaches it. */
export function freezeSubmit(cart: Cart, target: DraftTarget, order_id: string): SubmitOrderPayload {
  const payload: SubmitOrderPayload = {
    order_id,
    order_type: target.order_type,
    ...(target.table_id === undefined ? {} : { table_id: target.table_id }),
    ...(target.seating_id === undefined ? {} : { seating_id: target.seating_id }),
    ...(target.order_type === 'takeaway' && cart.takeaway !== undefined ? { takeaway: { ...cart.takeaway } } : {}),
    ...(target.order_type === 'parking' && cart.parking !== undefined ? { parking: { ...cart.parking } } : {}),
    ...(cart.order_note === undefined ? {} : { order_note: cart.order_note }),
    lines: toSubmitLines(cart),
  };
  return deepFreeze(structuredClone(payload));
}

export type SendOutcome =
  /** a 2xx; `result` undefined = the hub had it already (own pending ORDER_ITEM_ID_IN_USE, 25b) */
  | { kind: 'sent'; result: SubmitResult | undefined }
  | { kind: 'queued'; entry_id: string }
  | { kind: 'day_not_open' }
  | { kind: 'refused'; error: Extract<HubError, { kind: 'api' }> }
  /** the queue would not take it (no session / person on this page): sign in again */
  | { kind: 'needs_hub' };

/** Enqueue first (stored before the first send), then the queue submits; the outcome by its answer. */
export async function sendOrder(enqueue: Enqueue, payload: SubmitOrderPayload, label: string): Promise<SendOutcome> {
  const meta = { label, ...(payload.table_id === undefined ? {} : { table_id: payload.table_id }), ...(payload.seating_id === undefined ? {} : { seating_id: payload.seating_id }) };
  const answer = await enqueue<SubmitResult | undefined>('SubmitOrder', payload, meta);
  switch (answer.status) {
    case 'sent':
      return { kind: 'sent', result: answer.result };
    case 'queued':
      return { kind: 'queued', entry_id: answer.entry_id };
    case 'refused':
      if (answer.error.code === 'BUSINESS_DAY_NOT_OPEN') return { kind: 'day_not_open' };
      return { kind: 'refused', error: answer.error };
    case 'needs_hub':
      // SubmitOrder is queueable (25b): the queue answers this only with no session or person on this page
      return { kind: 'needs_hub' };
  }
}

const ORDER_CODES = new Set([
  'ITEM_SOLD_OUT',
  'ITEM_UNAVAILABLE',
  'ITEM_OUT_OF_HOURS',
  'STATION_PAUSED',
  'MENU_ITEM_NOT_FOUND',
  'DEAL_NOT_FOUND',
  'OPTION_CHOICE_INVALID',
  'ORDER_ITEM_ID_IN_USE',
  'TABLE_ALREADY_LOCKED',
  'PERMISSION_DENIED',
  'VALIDATION_FAILED',
]);

/**
 * The toast of a refused Send, by the hub's code (02b §9, 02a §9; plan Global constraints): TABLE_SEATING_CHANGED is
 * "This table changed — refreshed" (the screen reads the map once more); the 02a table codes use 02a's texts; an
 * order code says why in the queue log's words ("Not sent — {item} sold out"); no session on this page → sign in.
 */
export function refusalText(config: BranchConfig, outcome: Extract<SendOutcome, { kind: 'refused' } | { kind: 'needs_hub' }>): string {
  if (outcome.kind === 'needs_hub') return t('send.needs_sign_in');
  const { code, details } = outcome.error;
  if (code === 'TABLE_SEATING_CHANGED') return t('tables.changed');
  if (ORDER_CODES.has(code)) {
    const d = (details ?? {}) as { item_id?: unknown; deal_id?: unknown };
    const item =
      (typeof d.item_id === 'string' ? config.items.find((i) => i.item_id === d.item_id)?.name : undefined) ??
      (typeof d.deal_id === 'string' ? config.deals.find((x) => x.deal_id === d.deal_id)?.name : undefined) ??
      t('send.an_item');
    return fill(t('send.refused_why'), { why: fill(t(`queue.why.${code}` as MessageKey), { item }) });
  }
  if ((TABLE_ERROR_CODES as readonly string[]).includes(code)) return t(tableErrorKey(outcome.error));
  return fill(t('send.refused_why'), { why: t('queue.why.other') });
}

const nameOf = (config: BranchConfig, line: CartLine): string =>
  line.deal_id !== undefined ? (config.deals.find((d) => d.deal_id === line.deal_id)?.name ?? '') : (config.items.find((i) => i.item_id === line.item_id)?.name ?? '');

/** 02-B07 "Time updated: Karahi 8:29 PM": the first line whose final time moved ≥ 60 s from the last preview. */
export function timeUpdated(config: BranchConfig, cart: Cart, preview: EtaPreviewBody | null, result: SubmitResult): { name: string; eta_ms: number } | null {
  if (preview === null) return null;
  for (const line of cart.lines) {
    const before = preview.lines.find((l) => l.key === line.key)?.eta_ms ?? null;
    const after = result.lines.find((l) => l.order_item_id === line.key)?.eta_ms ?? null;
    if (before !== null && after !== null && Math.abs(after - before) >= 60_000) return { name: nameOf(config, line), eta_ms: after };
  }
  return null;
}

/** #36 zone-empty flip: the from_zone lines the hub sent to the kitchen (zone_served false). */
export function zoneEmpty(config: BranchConfig, cart: Cart, result: SubmitResult): string[] {
  return cart.lines.filter((l) => l.from_zone === true && result.lines.find((r) => r.order_item_id === l.key)?.zone_served === false).map((l) => nameOf(config, l));
}

// ------------------------------------------------------------------------------------- E-7 CompItCart

/** A comp-it line that was sent: the order view's "Comp it?" prompt (27a2) takes it from here. */
export interface CompItSent {
  order_id: string;
  order_item_id: string;
  item_id: string;
  seating_id: string | null;
  /** true: the round is in the queue (offline); 27a2 waits for that line's ItemAdded frame before it asks */
  queued?: boolean;
}
const compItListeners = new Set<(sent: CompItSent) => void>();

/** 27a2 subscribes: called once per comp-it line when its SubmitOrder got its 2xx, or was queued (`queued: true`). */
export function onCompItSent(listener: (sent: CompItSent) => void): () => void {
  compItListeners.add(listener);
  return () => void compItListeners.delete(listener);
}

export function announceCompIt(payload: SubmitOrderPayload, cart: Cart, o: { queued?: boolean } = {}): void {
  for (const line of cart.lines) {
    if (line.comp_it !== true || line.item_id === undefined) continue;
    const sent: CompItSent = { order_id: payload.order_id, order_item_id: line.key, item_id: line.item_id, seating_id: payload.seating_id ?? null, ...(o.queued === true ? { queued: true } : {}) };
    for (const l of [...compItListeners]) l(sent);
  }
}

/**
 * 02b §8 Table view (E-7): "Send it as a new item" — the seating's order draft gets the item (its options ticked by
 * name, Q-7; H2 not there → the item's defaults) as a line marked `comp_it` (badge "Sent again · asks to comp"); the
 * caller then opens `#/order/dine_in/<seating_id>`. Appends to a draft already open for that seating.
 */
export async function startCompItCart(o: {
  drafts: DraftStore;
  config: BranchConfig;
  device_id: string;
  staff_id: string;
  table_id: string;
  seating_id: string;
  item_id: string;
  options?: LineOption[];
  newKey: () => string;
  nowMs: number;
}): Promise<void> {
  const item = o.config.items.find((i) => i.item_id === o.item_id);
  if (item === undefined) return;
  // Q-7: the stored options ticked by name (H2); without them nothing is ticked — never a priced default the guest
  // did not have. An item with choices opens its options sheet on arrival (`pick_options`).
  const options = preselect(o.config, item, o.options, o.newKey) ?? [];
  const choices = item.modifier_group_ids.length > 0 || item.requires_weighing || item.sale_unit !== 'piece';
  const line: CartLine = { key: o.newKey(), item_id: o.item_id, quantity: item.sale_unit === 'piece' ? 1 : null, options, comp_it: true, ...(choices ? { pick_options: true } : {}) };
  const list = await o.drafts.list(o.device_id, o.staff_id).catch(() => [] as Draft[]);
  const open = list.find((d) => !d.held && d.order_type === 'dine_in' && d.seating_id === o.seating_id);
  const cart = open !== undefined ? toCart(open.cart, o.newKey) : null;
  await o.drafts.put({
    draft_id: open?.draft_id ?? o.newKey(),
    device_id: o.device_id,
    staff_id: o.staff_id,
    order_type: 'dine_in',
    table_id: o.table_id,
    seating_id: o.seating_id,
    cart: { ...(cart ?? { lines: [] }), lines: [...(cart?.lines ?? []), line] },
    updated_at: o.nowMs,
    held: false,
  });
}

// ------------------------------------------------------------------------------------- IR-7 copy_of

function isCartShape(v: unknown): v is Cart {
  return typeof v === 'object' && v !== null && Array.isArray((v as { lines?: unknown }).lines);
}

/**
 * Integrator ruling IR-7 (25c "Copy to a new order"): a draft whose cart is `{ copy_of: SubmitOrderPayload }` becomes
 * this screen's cart with fresh ids for every line, linked option child and deal part (the copy is a new order);
 * quantities (a null weight stays "Weigh later"), options, deal choices, kitchen notes, the order note and the
 * takeaway / parking details are kept, and `from_entry_id` (IR-8: the queue log row shows "Copied"). A cart already in this shape is returned as it is; anything else → null.
 */
export function toCart(stored: unknown, newKey: () => string): Cart | null {
  if (isCartShape(stored)) return stored;
  const copyCart = stored as { copy_of?: SubmitOrderPayload; from_entry_id?: unknown } | null;
  const copy = copyCart?.copy_of;
  if (copy === undefined || copy === null || !Array.isArray(copy.lines)) return null;
  const fresh = (opts: SubmitOrderPayload['lines'][number]['options']) => (opts ?? []).map((o) => ({ option_id: o.option_id, quantity: o.quantity, ...(o.order_item_id === undefined ? {} : { order_item_id: newKey() }) }));
  const lines: CartLine[] = copy.lines.map((l) => ({
    key: newKey(),
    ...(l.item_id === undefined ? {} : { item_id: l.item_id }),
    ...(l.deal_id === undefined ? {} : { deal_id: l.deal_id }),
    quantity: l.quantity ?? null,
    options: fresh(l.options),
    ...(l.deal_choices === undefined
      ? {}
      : { deal_choices: l.deal_choices.map((c) => ({ deal_part_id: c.deal_part_id, item_id: c.item_id, order_item_id: newKey(), ...(c.options === undefined ? {} : { options: fresh(c.options) }) })) }),
    ...(l.kitchen_note === undefined ? {} : { kitchen_note: l.kitchen_note }),
    ...(l.from_zone === true ? { from_zone: true } : {}),
  }));
  return {
    lines,
    ...(copy.order_note === undefined ? {} : { order_note: copy.order_note }),
    ...(copy.takeaway === undefined ? {} : { takeaway: { ...copy.takeaway } }),
    ...(copy.parking === undefined ? {} : { parking: { ...copy.parking } }),
    // IR-8: the queue log row it was copied from keeps showing "Copied"
    ...(typeof copyCart?.from_entry_id === 'string' ? { from_entry_id: copyCart.from_entry_id } : {}),
  };
}
