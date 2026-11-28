import type { OpenOrder } from '../contracts';
import type { BillRow } from '../unpaid/candidate';
import { allServed, anyServed, summaryOf, type BookOrder } from './book';

// 02b-TK C2-1 (02b v1.0.24 §6.16, §8; CHANGES §1 queue rail; R3): the takeaway queue rail's model. Pure.
// A token is every open order of one takeaway token (a root and its additions, 05 #44a: an addition keeps the root's
// token) — one tile or row, its bill facts from the newest order (05 #44e). Sections:
//   Ready — hand over: every counted line ready or served (ready n = m, §6.16 AD-39 R3), or part handed over;
//   Cooking: the rest, newest first (L-CLIENT-6a: a sent token goes to the top, CHANGES §2 Send);
//   Phone orders — later: ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §6.16 R3-M-1, §8 02b-R4-3; D1) the tokens not
//   ready whose effective pickup (`effective_pickup_at_ms`: null once boosted) is still ahead of hub now, by pickup;
//   an elapsed or boosted pickup is in the now queue with its real promise.
// Due / Paid: an order whose bill closed is billed (OrdersBilled); `open-orders` lists only unbilled orders today, so a
// token is Paid only when every order of it is billed and kept by the book (book.ts). A paid token handed over in
// full leaves the rail.

export interface QueueToken {
  /** `<business_date>:<token>`, or the order id of an order with no token */
  key: string;
  token: number | null;
  /** oldest first; [0] = the root (the `adds_to_order_id` of an addition) */
  order_ids: string[];
  newest_order_id: string;
  customer_name: string | null;
  phone: string | null;
  placed_at: number;
  promise_ms: number | null;
  ready: { n: number; m: number };
  paid: boolean;
  /** some line handed over, the rest not ready yet */
  part: boolean;
  summary: string;
  /**
   * ⚠️ 03b v1.0.16 §3.4 "Not collected" (R3-M-9), D8 (02b-TK L-CLIENT-2 item 2): the bag-ready time and the hub time
   * from which the token is amber — the latest of its orders' `ready_at` and `ready_at + bag_ready_window_ms`; null
   * while any of its orders has no pair (no epoch, or an older hub). Optional: a token built elsewhere has none.
   */
  ready_since?: number | null;
  late_from?: number | null;
  /**
   * ⚠️ 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §6.16, §8 OR-7): each order's billing facts, oldest first — the row's
   * `bill` and `unpaid_handover_approved`; on a hub without `bill`, a billed order (book) reads paid, else unknown.
   */
  bills?: Array<{ order_id: string } & BillRow>;
  /**
   * ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §6.16 R3-M-1; D1): the token's pickup as placed (kept after a boost) and its
   * effective scheduling pickup (null once boosted) — the latest of its orders'; null without one. Optional: a token
   * built elsewhere has none.
   */
  pickup_at_ms?: number | null;
  effective_pickup_at_ms?: number | null;
  /** ⚠️ 02b-TK L-CLIENT-5 item 2 (02b v1.0.25 §6.6, §8; D1): the token's orders still waiting for their pickup (not boosted) */
  pickup_order_ids?: string[];
  /**
   * ⚠️ 02b-TK L-CLIENT-5 item 3 (02b v1.0.25 §3.3 Day close, §6.16 `from_date`; DC-2): the token's business date when it
   * is not the open day's (a carried token), else null. Optional: a token built elsewhere has none.
   */
  from_date?: string | null;
  /**
   * ⚠️ 02b v1.0.25 §6.16 (owner ruling BR-1; 03a PK-5): the planned ready time to show as "Ready ~{planned}" beside the
   * struck promise (plannedReadyOf), else null. Optional: a token built elsewhere has none.
   */
  planned_ready_at_ms?: number | null;
  /**
   * ⚠️ 02b v1.0.29 §3.7a, §8 (owner 2026-11-28 QA-R2, BUG-7): every live line of every order handed over while a bill
   * is still Due (an approved unpaid hand-over) — the token is "Handed — owes", out of READY — HAND OVER; what it owes
   * (one due per bill). Optional: a token built elsewhere has none.
   */
  handed_all?: boolean;
  owed_minor?: number;
}

type PlannedRow = Pick<OpenOrder, 'ready' | 'promise_ms' | 'pickup_at_ms' | 'effective_pickup_at_ms' | 'planned_ready_at_ms'>;

/**
 * ⚠️ 02b v1.0.25 §6.16 `planned_ready_at_ms` (owner ruling BR-1): a token's "Ready ~{planned}" time — the latest planned
 * ready time of its orders not yet ready (ready n < m), only when every one of them is boosted (a pickup kept, the
 * effective pickup null: Customer is here) and has a planned time, and only when it is earlier than the token's
 * promise (the latest of its orders'). Else null: the token keeps showing the promise. The promise never changes (PK-5).
 */
export function plannedReadyOf(rows: readonly PlannedRow[]): number | null {
  const boosted = (r: PlannedRow) => r.pickup_at_ms != null && r.effective_pickup_at_ms === null;
  const open = rows.filter((r) => r.ready.n < r.ready.m);
  for (const r of open) if (!boosted(r) || r.planned_ready_at_ms == null) return null;
  // ⚠️ 02b v1.0.29 §6.16, §8 (owner 2026-11-28 QA-R2, BUG-12): a boosted order that is ready keeps its time (the hub
  // sends its latest done time), so "Ready ~" never reverts to the promise once the bag is ready; a ready order that
  // was never boosted plays no part
  const counted = [...open, ...rows.filter((r) => r.ready.n >= r.ready.m && boosted(r) && r.planned_ready_at_ms != null)];
  if (counted.length === 0) return null;
  const planned = Math.max(...counted.map((r) => r.planned_ready_at_ms!));
  const promise = latest(rows.map((r) => r.promise_ms));
  return promise !== null && planned < promise ? planned : null;
}

/** ⚠️ 02b v1.0.29 §8 (QA-R2, BUG-12): every counter time of an order or token — "Ready ~{planned}" or the promise. */
export function counterTimeOf(rows: readonly PlannedRow[]): { kind: 'planned'; at: number } | { kind: 'promise'; at: number } | null {
  const planned = plannedReadyOf(rows);
  if (planned !== null) return { kind: 'planned', at: planned };
  const promise = latest(rows.map((r) => r.promise_ms));
  return promise === null ? null : { kind: 'promise', at: promise };
}

/** A token's billing facts per order; a token built without them reads paid only when the book says so. */
export function billsOf(q: Pick<QueueToken, 'bills' | 'order_ids' | 'paid'>): Array<{ order_id: string } & BillRow> {
  return q.bills ?? q.order_ids.map((order_id) => ({ order_id, ...(q.paid ? { bill: { state: 'paid' as const, due_minor: 0 } } : {}) }));
}

export interface QueueModel {
  ready: QueueToken[];
  cooking: QueueToken[];
  later: QueueToken[];
  /** ⚠️ 02b v1.0.29 (QA-R2, BUG-7): handed over in full, still owing */
  owes: QueueToken[];
}

/** One order as the rail knows it: its open-orders row (the last one read) and its book entry. */
export interface KnownOrder {
  row: OpenOrder;
  book: BookOrder | undefined;
}

/**
 * The rail's orders: the takeaway rows of the latest `open-orders` read, plus each row read earlier whose order the
 * book now holds billed (paid) with something still to hand over (the hub no longer lists it).
 */
export function knownOrders(rows: readonly OpenOrder[], seen: ReadonlyMap<string, OpenOrder>, book: (order_id: string) => BookOrder | undefined): KnownOrder[] {
  const now = rows.filter((r) => r.order_type === 'takeaway');
  const listed = new Set(now.map((r) => r.order_id));
  const kept = [...seen.values()].filter((r) => {
    if (listed.has(r.order_id) || r.order_type !== 'takeaway') return false;
    const b = book(r.order_id);
    return b !== undefined && b.billed && !b.cancelled && !allServed(b);
  });
  return [...now, ...kept].map((row) => ({ row, book: book(row.order_id) }));
}

/** ⚠️ 02b v1.0.29 (QA-R2, BUG-7): what a token's Due bills owe — each bill's due once (`bill.key`, else the order). */
function owedOf(rows: readonly OpenOrder[]): number {
  const dues = new Map<string, number>();
  for (const r of rows) if (r.bill?.state === 'due') dues.set(r.bill.key ?? r.order_id, Math.max(0, r.bill.due_minor));
  return [...dues.values()].reduce((a, b) => a + b, 0);
}

const keyOf = (r: OpenOrder) => (r.token === null ? r.order_id : `${r.business_date}:${r.token}`);

/**
 * BUG-12: an order's sub-line — the device copy's lines (frames keep it current between reads), else the open-orders
 * row's `lines_summary` (02b v1.0.25 §6.16: "2× Roghni Naan", then "+n" for `lines_more`); '' when neither has a line.
 */
function summaryOfKnown(o: KnownOrder): string {
  const own = o.book === undefined ? '' : summaryOf(o.book);
  if (own !== '' || o.row.lines_summary === undefined) return own;
  const text = o.row.lines_summary.map((l) => (l.qty > 1 ? `${l.qty}× ${l.name}` : l.name)).join(' · ');
  const more = o.row.lines_more ?? 0;
  return more > 0 && text !== '' ? `${text} +${more}` : text;
}

/**
 * ⚠️ 03b v1.0.16 §3.4 "Not collected" (R3-M-9), §3.5, D8: whole minutes since the token's bag was ready, once hub now ≥
 * ready_at + window (the same rule as the Pass card, `notCollectedMin`); null before it or without the pair.
 */
export function notCollectedMinOf(q: QueueToken, nowMs: number): number | null {
  const since = q.ready_since ?? null;
  const from = q.late_from ?? null;
  if (since === null || from === null || nowMs < from) return null;
  return Math.floor((nowMs - since) / 60_000);
}

const latest = (xs: ReadonlyArray<number | null | undefined>): number | null => {
  const set = xs.filter((x): x is number => typeof x === 'number');
  return set.length === 0 ? null : Math.max(...set);
};

/** `nowMs` (hub clock): a pickup ahead of it waits under Phone orders — later; without it, every effective pickup does. */
export function buildQueue(orders: readonly KnownOrder[], nowMs = -Infinity): QueueModel {
  const groups = new Map<string, KnownOrder[]>();
  for (const o of orders) groups.set(keyOf(o.row), [...(groups.get(keyOf(o.row)) ?? []), o]);
  const tokens: QueueToken[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.row.placed_at - b.row.placed_at || (a.row.order_id < b.row.order_id ? -1 : 1));
    const ready = sorted.reduce((s, o) => ({ n: s.n + o.row.ready.n, m: s.m + o.row.ready.m }), { n: 0, m: 0 });
    const promises = sorted.map((o) => o.row.promise_ms).filter((p): p is number => p !== null);
    const named = sorted.find((o) => (o.book?.customer_name ?? '') !== '');
    const phoned = sorted.find((o) => (o.book?.phone ?? '') !== '');
    const allReady = ready.m > 0 && ready.n === ready.m;
    const pairs = sorted.map((o) => (o.row.ready_at == null || o.row.bag_ready_window_ms == null ? null : { since: o.row.ready_at, until: o.row.ready_at + o.row.bag_ready_window_ms }));
    const complete = pairs.every((p) => p !== null);
    tokens.push({
      key,
      token: sorted[0]!.row.token,
      order_ids: sorted.map((o) => o.row.order_id),
      newest_order_id: sorted.at(-1)!.row.order_id,
      customer_name: named?.book?.customer_name ?? null,
      phone: phoned?.book?.phone ?? null,
      placed_at: sorted[0]!.row.placed_at,
      promise_ms: promises.length === 0 ? null : Math.max(...promises),
      ready,
      // BUG-12 (02b v1.0.25 §6.16): paid by the row's own `bill`, or by an OrdersBilled this device heard since (a kept
      // row the hub no longer lists, or a frame newer than the read); never Due only because the device has no copy
      paid: sorted.every((o) => o.row.bill?.state === 'paid' || o.book?.billed === true),
      part: !allReady && sorted.some((o) => o.book !== undefined && anyServed(o.book)),
      summary: sorted
        .map((o) => summaryOfKnown(o))
        .filter((s) => s !== '')
        .join(' · '),
      ready_since: complete ? Math.max(...pairs.map((p) => p!.since)) : null,
      late_from: complete ? Math.max(...pairs.map((p) => p!.until)) : null,
      bills: sorted.map((o) => ({
        order_id: o.row.order_id,
        ...(o.row.bill !== undefined ? { bill: o.row.bill } : o.book?.billed === true ? { bill: { state: 'paid' as const, due_minor: 0 } } : {}),
        ...(o.row.unpaid_handover_approved === undefined ? {} : { unpaid_handover_approved: o.row.unpaid_handover_approved }),
      })),
      pickup_at_ms: latest(sorted.map((o) => o.row.pickup_at_ms)),
      effective_pickup_at_ms: latest(sorted.map((o) => o.row.effective_pickup_at_ms)),
      from_date: sorted[0]!.row.from_date ?? null,
      pickup_order_ids: sorted.filter((o) => o.row.effective_pickup_at_ms != null).map((o) => o.row.order_id),
      planned_ready_at_ms: plannedReadyOf(sorted.map((o) => o.row)),
      handed_all: sorted.every((o) => o.row.handed !== undefined && o.row.handed.m > 0 && o.row.handed.n === o.row.handed.m),
      owed_minor: owedOf(sorted.map((o) => o.row)),
    });
  }
  const newestFirst = (a: QueueToken, b: QueueToken) => b.placed_at - a.placed_at || (a.key < b.key ? 1 : -1);
  const byPromise = (a: QueueToken, b: QueueToken) => (a.promise_ms ?? Infinity) - (b.promise_ms ?? Infinity) || a.placed_at - b.placed_at;
  // ⚠️ 02b v1.0.29 (QA-R2, BUG-7): a token handed over in full that still owes is neither ready nor cooking
  const isOwes = (q: QueueToken) => q.handed_all === true && !q.paid;
  const isReady = (q: QueueToken) => !isOwes(q) && ((q.ready.m > 0 && q.ready.n === q.ready.m) || q.part);
  const isLater = (q: QueueToken) => !isOwes(q) && !isReady(q) && q.effective_pickup_at_ms != null && q.effective_pickup_at_ms > nowMs;
  const byPickup = (a: QueueToken, b: QueueToken) => a.effective_pickup_at_ms! - b.effective_pickup_at_ms! || a.placed_at - b.placed_at;
  return {
    ready: tokens.filter(isReady).sort(byPromise),
    // L-CLIENT-6a item 4 (CHANGES §2 Send "the token goes to the top of Cooking"; frame SentToast): newest first
    cooking: tokens.filter((q) => !isOwes(q) && !isReady(q) && !isLater(q)).sort(newestFirst),
    later: tokens.filter(isLater).sort(byPickup),
    owes: tokens.filter(isOwes).sort(newestFirst),
  };
}

const digits = (s: string) => s.replace(/\D/g, '');

/**
 * R3: the rail's search, on this device only — a token ("53", "5" → 53, 54…), a customer name (any part, any case),
 * or the last 4 digits of the phone ("4567"). Empty → everything.
 */
export function matchesQuery(q: QueueToken, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (text === '') return true;
  if (/^\d+$/.test(text)) {
    if (q.token !== null && String(q.token).startsWith(text)) return true;
    return text.length === 4 && q.phone !== null && digits(q.phone).endsWith(text);
  }
  return (q.customer_name ?? '').toLowerCase().includes(text);
}
