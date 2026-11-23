import type { OpenOrder } from '../contracts';
import { allServed, anyServed, summaryOf, type BookOrder } from './book';

// 02b-TK C2-1 (02b v1.0.24 §6.16, §8; CHANGES §1 queue rail; R3): the takeaway queue rail's model. Pure.
// A token is every open order of one takeaway token (a root and its additions, 05 #44a: an addition keeps the root's
// token) — one tile or row, its bill facts from the newest order (05 #44e). Sections:
//   Ready — hand over: every counted line ready or served (ready n = m, §6.16 AD-39 R3), or part handed over;
//   Cooking: the rest, by promise;
//   Phone orders — later: empty until 02b v1.0.25 gives a pickup time (`pickup_at_ms`, R4, Part B).
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
}

export interface QueueModel {
  ready: QueueToken[];
  cooking: QueueToken[];
  later: QueueToken[];
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

const keyOf = (r: OpenOrder) => (r.token === null ? r.order_id : `${r.business_date}:${r.token}`);

export function buildQueue(orders: readonly KnownOrder[]): QueueModel {
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
      paid: sorted.every((o) => o.book?.billed === true),
      part: !allReady && sorted.some((o) => o.book !== undefined && anyServed(o.book)),
      summary: sorted
        .map((o) => (o.book === undefined ? '' : summaryOf(o.book)))
        .filter((s) => s !== '')
        .join(' · '),
    });
  }
  const byPromise = (a: QueueToken, b: QueueToken) => (a.promise_ms ?? Infinity) - (b.promise_ms ?? Infinity) || a.placed_at - b.placed_at;
  const isReady = (q: QueueToken) => (q.ready.m > 0 && q.ready.n === q.ready.m) || q.part;
  return {
    ready: tokens.filter(isReady).sort(byPromise),
    cooking: tokens.filter((q) => !isReady(q)).sort(byPromise),
    // R4 (02b v1.0.25, Part B): no pickup time on the hub yet, so no order waits for a later pickup
    later: [],
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
