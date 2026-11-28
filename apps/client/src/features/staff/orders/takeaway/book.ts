import type { LiveBus, LiveMessage } from '../../shell/live';
import type { CatchUpOrder, LineKind, OpenOrder, OrdersCatchUp } from '../contracts';

// 02b-TK C2-1 (02b v1.0.24 §6.16, §6.19, O17; ruling R3): what this device knows of each takeaway order, folded from
// the catch-up `orders` part and the order frames — the token, the customer's name and phone (a kiosk / the placer is
// sent them, O17; nothing is asked of the hub for search, R3), whether its bill closed (OrdersBilled), and its lines
// (names for the rail's sub-line, served / live for "Part given" and for dropping a handed-over token).
// Kept in memory only (never stored, never logged). A billed order leaves `open-orders` and the catch-up today
// (`billed_at IS NULL`); the book keeps it while it still has a line to hand over, so a paid token stays in the rail
// for this page's life. After a reload it is gone until 02b v1.0.25 (Part B) lists paid takeaways not handed over.

export interface BookLine {
  order_item_id: string;
  parent_order_item_id: string | null;
  line_kind: LineKind;
  name: string;
  /** pieces for a piece line; null for a weighed / measured line */
  pieces: number | null;
  live_units: number;
  served: boolean;
}

export interface BookOrder {
  order_id: string;
  token: number | null;
  business_date: string | null;
  placed_at: number | null;
  placed_by: string | null;
  customer_name: string | null;
  phone: string | null;
  billed: boolean;
  cancelled: boolean;
  /** the root order of a takeaway addition (OrderPlaced.adds_to_order_id), else null */
  adds_to_order_id: string | null;
  lines: Map<string, BookLine>;
}

export interface TokenBook {
  get(order_id: string): BookOrder | undefined;
  all(): BookOrder[];
  version(): number;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** The top-level live lines are all served (nothing left to hand over). */
export function allServed(o: BookOrder): boolean {
  const top = [...o.lines.values()].filter((l) => l.parent_order_item_id === null && l.line_kind !== 'option_child' && l.live_units > 0);
  return top.length > 0 && top.every((l) => l.served || (l.line_kind === 'deal' && dealServed(o, l.order_item_id)));
}

function dealServed(o: BookOrder, deal_id: string): boolean {
  const parts = [...o.lines.values()].filter((l) => l.parent_order_item_id === deal_id && l.live_units > 0);
  return parts.length > 0 && parts.every((l) => l.served);
}

/** Some top-level line (or deal part) was handed over. */
export function anyServed(o: BookOrder): boolean {
  return [...o.lines.values()].some((l) => l.live_units > 0 && l.served && l.line_kind !== 'option_child');
}

/**
 * "Chicken Karahi — Half · 4× Roghni Naan": the top-level live lines, one entry per name with its pieces added up
 * (L-CLIENT-6a item 4, frame HomeKiosk: a line split per unit, 02b v1.0.20 §3.2 `part_of`, or the same item sent twice
 * reads "4× Roghni Naan", not the name four times), in the order first sent.
 */
export function summaryOf(o: BookOrder): string {
  return groupedSummary(
    [...o.lines.values()]
      .filter((l) => l.parent_order_item_id === null && l.line_kind !== 'option_child' && l.live_units > 0)
      .map((l) => ({ name: l.name, qty: l.pieces ?? 1 })),
  );
}

/** "3× Naan · Chicken Karahi — Half": names in first-seen order, quantities added up, "n× " above 1. */
export function groupedSummary(parts: ReadonlyArray<{ name: string; qty: number }>): string {
  const totals = new Map<string, number>();
  for (const p of parts) totals.set(p.name, (totals.get(p.name) ?? 0) + p.qty);
  return [...totals].map(([name, n]) => (n > 1 ? `${n}× ${name}` : name)).join(' · ');
}

function fromCatchUp(o: CatchUpOrder): BookOrder {
  return {
    order_id: o.order_id,
    token: o.token,
    business_date: o.business_date,
    placed_at: o.placed_at,
    placed_by: o.placed_by,
    customer_name: o.customer_name ?? null,
    phone: o.phone ?? null,
    billed: o.billed,
    cancelled: o.cancelled,
    adds_to_order_id: null,
    lines: new Map(
      o.lines.map((l) => [
        l.order_item_id,
        {
          order_item_id: l.order_item_id,
          parent_order_item_id: l.parent_order_item_id,
          line_kind: l.line_kind,
          name: l.name,
          pieces: l.sale_unit === 'piece' ? l.live_units : null,
          live_units: l.live_units,
          served: l.served_at !== null,
        },
      ]),
    ),
  };
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function createTokenBook(live: LiveBus): TokenBook {
  const orders = new Map<string, BookOrder>();
  /** order_item_id → order_id (ItemServed names lines only) */
  const lineOrder = new Map<string, string>();
  let v = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    v += 1;
    for (const l of [...listeners]) l();
  };
  const blank = (order_id: string): BookOrder => ({
    order_id,
    token: null,
    business_date: null,
    placed_at: null,
    placed_by: null,
    customer_name: null,
    phone: null,
    billed: false,
    cancelled: false,
    adds_to_order_id: null,
    lines: new Map(),
  });
  const ensure = (order_id: string) => {
    let o = orders.get(order_id);
    if (o === undefined) orders.set(order_id, (o = blank(order_id)));
    return o;
  };
  const seed = (part: unknown) => {
    const list = (part as Partial<OrdersCatchUp> | undefined)?.orders;
    if (!Array.isArray(list)) return;
    const fresh = new Map(list.filter((o) => o.order_type === 'takeaway').map((o) => [o.order_id, fromCatchUp(o)] as const));
    // a billed order the catch-up no longer lists stays while it still has something to hand over
    for (const [id, o] of orders) if (!fresh.has(id) && o.billed && !o.cancelled && !allServed(o)) fresh.set(id, o);
    // the catch-up has no adds_to_order_id: keep what the frames told
    for (const [id, o] of fresh) o.adds_to_order_id = orders.get(id)?.adds_to_order_id ?? o.adds_to_order_id;
    orders.clear();
    lineOrder.clear();
    for (const [id, o] of fresh) {
      orders.set(id, o);
      for (const l of o.lines.keys()) lineOrder.set(l, id);
    }
  };
  seed(live.part('orders'));
  const onMessage = (m: LiveMessage) => {
    if (m.kind === 'forget') {
      orders.clear();
      lineOrder.clear();
      return changed();
    }
    if (m.kind === 'catch_up') {
      seed(m.state['orders']);
      return changed();
    }
    if (m.kind !== 'event') return;
    const p = m.event.payload;
    switch (m.event.event_type) {
      case 'OrderPlaced': {
        if (p['order_type'] !== 'takeaway' || typeof p['order_id'] !== 'string') return;
        const o = ensure(p['order_id']);
        if (typeof p['token'] === 'number') o.token = p['token'];
        if (typeof p['business_date'] === 'string') o.business_date = p['business_date'];
        if (typeof p['adds_to_order_id'] === 'string') o.adds_to_order_id = p['adds_to_order_id'];
        // placed_at / placed_by are envelope fields the frame does not carry: the open-orders row gives them
        return changed();
      }
      case 'ItemAdded': {
        const order_id = p['order_id'];
        const o = typeof order_id === 'string' ? orders.get(order_id) : undefined;
        if (o === undefined || typeof p['order_item_id'] !== 'string') return;
        const quantity = typeof p['quantity'] === 'number' ? p['quantity'] : null;
        o.lines.set(p['order_item_id'], {
          order_item_id: p['order_item_id'],
          parent_order_item_id: typeof p['parent_order_item_id'] === 'string' ? p['parent_order_item_id'] : null,
          line_kind: (p['line_kind'] as LineKind | undefined) ?? 'item',
          name: typeof p['name'] === 'string' ? p['name'] : '',
          pieces: p['sale_unit'] === 'piece' ? quantity : null,
          live_units: p['sale_unit'] === 'piece' ? (quantity ?? 1) : 1,
          served: false,
        });
        lineOrder.set(p['order_item_id'], o.order_id);
        return changed();
      }
      case 'OrderContactSet': {
        if (typeof p['order_id'] !== 'string') return;
        const o = ensure(p['order_id']);
        o.customer_name = typeof p['customer_name'] === 'string' ? p['customer_name'] : null;
        o.phone = typeof p['phone'] === 'string' ? p['phone'] : null;
        return changed();
      }
      case 'OrdersBilled':
      case 'OrdersUnbilled': {
        let hit = false;
        for (const id of ids(p['order_ids'])) {
          const o = orders.get(id);
          if (o === undefined) continue;
          o.billed = m.event.event_type === 'OrdersBilled';
          hit = true;
        }
        return hit ? changed() : undefined;
      }
      case 'ItemServed': {
        let hit = false;
        for (const id of ids(p['order_item_ids'])) {
          const line = orders.get(lineOrder.get(id) ?? '')?.lines.get(id);
          if (line === undefined) continue;
          line.served = true;
          hit = true;
        }
        return hit ? changed() : undefined;
      }
      case 'ItemRemoved':
      case 'ItemVoided': {
        const id = p['order_item_id'];
        const line = typeof id === 'string' ? orders.get(lineOrder.get(id) ?? '')?.lines.get(id) : undefined;
        if (line === undefined) return;
        const units = typeof p['units'] === 'number' ? p['units'] : line.live_units;
        line.live_units = Math.max(0, line.live_units - units);
        if (line.pieces !== null) line.pieces = line.live_units;
        return changed();
      }
      case 'OrderCancelled': {
        const o = typeof p['order_id'] === 'string' ? orders.get(p['order_id']) : undefined;
        if (o === undefined) return;
        o.cancelled = true;
        return changed();
      }
    }
  };
  const off = live.subscribe(onMessage);
  return {
    get: (order_id) => orders.get(order_id),
    all: () => [...orders.values()],
    version: () => v,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose: () => off(),
  };
}

/**
 * BUG-5 (QA round 2; 02b v1.0.30 §8 "Contact on this device"): the page's one token book per live bus. A screen
 * mounted later reads every frame heard since the catch-up (a book made per mount seeded from the bus's last
 * catch-up and lost each OrderContactSet sent after it). It lives as long as the bus and empties on `forget` (the
 * session ended, BUG-12), so nothing of one person's carries to the next. Screens never dispose it.
 */
const pageBooks = new WeakMap<LiveBus, TokenBook>();
export function tokenBookOf(live: LiveBus): TokenBook {
  let book = pageBooks.get(live);
  if (book === undefined) pageBooks.set(live, (book = createTokenBook(live)));
  return book;
}

/**
 * BUG-5: the open-orders rows whose contact the hub sends this socket (O17: every order on a cashier kiosk, the
 * person's own orders elsewhere) but the book has not got — a row it never heard of, or one with a phone and none
 * known. Never shown as masked: the caller re-reads (a fresh catch-up). Nobody signed in → none.
 */
export function contactGaps(
  rows: ReadonlyArray<Pick<OpenOrder, 'order_id' | 'has_phone'> & { placed_by?: { staff_id: string } | null }>,
  book: Pick<TokenBook, 'get'>,
  who: { kiosk: boolean; staffId: string | null },
): string[] {
  if (who.staffId === null) return [];
  return rows
    .filter((r) => who.kiosk || r.placed_by?.staff_id === who.staffId)
    .filter((r) => {
      const known = book.get(r.order_id);
      return known === undefined || (r.has_phone && (known.phone ?? '') === '');
    })
    .map((r) => r.order_id);
}
