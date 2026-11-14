import type { WsServerMessage } from '@pos/events';
import type { HubResult } from '../../api/hub-admin';
import type { OrderTicket } from '../pass/contracts';

// 03c §3.5, §6.8; owner Q-52 (AD-K1): the Pass card's `order-tickets` cache, keyed by order id. A card's first
// render starts one read (the slot functions are synchronous, so the first render shows nothing and the answer
// re-renders through notifySlots). It is read again only for that order on a `FireDispatched` naming one of its lines
// (a new ticket may have fired), never by a timer. The line → order map comes from the Pass's own frames
// (catch-up `point_view`, `point_lines`, `kds_lines`); a fired line whose details come after its `FireDispatched`
// is matched when they arrive. A catch-up (every reconnect) forgets the cache: tickets may have fired meanwhile.
// A failed read stays failed (no Reprint) until one of those events; renders never retry it.

/** fired ids kept for a late match; other points' fires (the hub sends FireDispatched to every staff socket) roll off */
export const UNMATCHED_MAX = 500;

type Read = (order_id: string) => Promise<HubResult<{ tickets: OrderTicket[] }>>;

interface Entry {
  /** null = not read yet or the read failed */
  tickets: OrderTicket[] | null;
  loading: boolean;
  /** a FireDispatched came while the read ran: read once more when it ends */
  again: boolean;
}

export interface TicketsCache {
  /** the cached tickets (null while unknown); the first call for an order starts its read */
  tickets(order_id: string): OrderTicket[] | null;
  apply(frame: WsServerMessage): void;
}

function linesOfCatchUp(state: Record<string, unknown>): Array<{ order_item_id: string; order_id: string }> {
  const orders = (state['point_view'] as { orders?: unknown } | null | undefined)?.orders;
  if (!Array.isArray(orders)) return [];
  return orders.flatMap((o: { order_id?: unknown; lines?: unknown }) =>
    typeof o.order_id === 'string' && Array.isArray(o.lines)
      ? o.lines
          .map((l: { order_item_id?: unknown }) => l.order_item_id)
          .filter((id): id is string => typeof id === 'string')
          .map((order_item_id) => ({ order_item_id, order_id: o.order_id as string }))
      : [],
  );
}

export function createTicketsCache(read: Read, onChange: () => void): TicketsCache {
  let entries = new Map<string, Entry>();
  const orderOf = new Map<string, string>();
  // fired lines not mapped to an order yet
  let unmatched = new Set<string>();
  // a catch-up drops the answers of reads it outlived
  let generation = 0;

  const load = (order_id: string, entry: Entry) => {
    entry.loading = true;
    entry.again = false;
    const at = generation;
    void read(order_id).then(
      (answer) => finish(order_id, entry, at, answer.ok ? answer.data.tickets : null),
      () => finish(order_id, entry, at, null),
    );
  };

  const finish = (order_id: string, entry: Entry, at: number, tickets: OrderTicket[] | null) => {
    if (at !== generation || entries.get(order_id) !== entry) return;
    entry.loading = false;
    // a failed re-read keeps the tickets it had
    if (tickets !== null || entry.tickets === null) entry.tickets = tickets;
    onChange();
    if (entry.again) load(order_id, entry);
  };

  const refresh = (order_id: string) => {
    const entry = entries.get(order_id);
    if (entry === undefined) return; // never shown: its first render reads it
    if (entry.loading) entry.again = true;
    else load(order_id, entry);
  };

  const learn = (pairs: ReadonlyArray<{ order_item_id: string; order_id: string }>) => {
    const fired = new Set<string>();
    for (const { order_item_id, order_id } of pairs) {
      orderOf.set(order_item_id, order_id);
      if (unmatched.delete(order_item_id)) fired.add(order_id);
    }
    for (const order_id of fired) refresh(order_id);
  };

  return {
    tickets(order_id) {
      const entry = entries.get(order_id);
      if (entry !== undefined) return entry.tickets;
      const created: Entry = { tickets: null, loading: false, again: false };
      entries.set(order_id, created);
      load(order_id, created);
      return null;
    },
    apply(frame) {
      if (frame.type === 'catch_up') {
        generation += 1;
        const had = entries.size > 0;
        entries = new Map();
        unmatched = new Set();
        orderOf.clear();
        learn(linesOfCatchUp(frame.state));
        if (had) onChange();
        return;
      }
      if (frame.type === 'point_lines' || frame.type === 'kds_lines') {
        learn(frame.lines);
        return;
      }
      if (frame.type === 'event' && frame.event.event_type === 'FireDispatched') {
        const ids = frame.event.payload['order_item_ids'];
        if (!Array.isArray(ids)) return;
        const orders = new Set<string>();
        for (const id of ids) {
          if (typeof id !== 'string') continue;
          const order_id = orderOf.get(id);
          if (order_id !== undefined) {
            orders.add(order_id);
            continue;
          }
          unmatched.add(id);
          if (unmatched.size > UNMATCHED_MAX) unmatched.delete(unmatched.values().next().value!);
        }
        for (const order_id of orders) refresh(order_id);
      }
    },
  };
}
