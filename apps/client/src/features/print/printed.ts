import type { WsServerMessage } from '@pos/events';

// 03c §3.8, §6.9 (03c-C01): the `printed` set of this screen. The catch-up part `kds_printed { order_item_ids }`
// replaces it (every (re)connect sends one; a catch-up without the part = nothing printed here), and each
// `printed_lines { order_item_ids }` frame adds to it. `apply` answers whether the set changed, so the caller calls
// notifySlots() only then.

export interface PrintedSet {
  has(order_item_id: string): boolean;
  apply(frame: WsServerMessage): boolean;
}

function idsOf(part: unknown): string[] {
  const ids = (part as { order_item_ids?: unknown } | null | undefined)?.order_item_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export function createPrintedSet(): PrintedSet {
  let printed = new Set<string>();
  return {
    has: (id) => printed.has(id),
    apply(frame) {
      if (frame.type === 'catch_up') {
        const next = new Set(idsOf(frame.state['kds_printed']));
        const same = next.size === printed.size && [...next].every((id) => printed.has(id));
        printed = next;
        return !same;
      }
      if (frame.type === 'printed_lines') {
        const added = frame.order_item_ids.filter((id) => !printed.has(id));
        for (const id of added) printed.add(id);
        return added.length > 0;
      }
      return false;
    },
  };
}
