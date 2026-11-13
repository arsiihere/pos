import { createContext } from 'react';
import type { BranchConfig } from '@pos/events';
import type { SeatingLine, SeatingOrder } from '../contracts';

// 02b v1.0.11 §8 Late cards (O18; owner ruling Q-10, hub H5; §10 #35): which late cards a seating's orders part shows.
// - With H5 (`open_slips` in the catch-up `orders` part, `SlipWarned` frames): every open slip warning is placed under
//   the seating that now holds its OLDEST order (S-7: after a split each warning sits under its oldest order's
//   table); all warnings placed on this seating make ONE card (a merge, O18), and "Send what's ready" sends one
//   `ReleaseItems` with every order of the card, so each warning's alert closes in that one `closeMany`.
// - Without H5 (interim Q-10 (b)): each open `slip_warning` row matched to this table by its lock's `table_code` is
//   its own card, answered alone (`AnswerRequest` accept / decline; the hub pre-ticks).

/** The alert rows the staff page holds (alerts store `AlertRow`), as far as a late card reads them. */
export interface LateAlertRow {
  alert_id: string;
  kind: string;
  state: 'open' | 'closed';
  lock: { table_code?: string | null };
  card?: { details?: { minutes_late?: number; lines?: Array<{ name: string; quantity: number; state: string }> } | null } | undefined;
}

/**
 * The page's alert rows for the late cards. The staff shell (lane A wiring, as IR-5's `alertRows` for the map)
 * provides them; until it does the list is empty: H5 cards still show from `open_slips`, the interim cards do not.
 */
export const LateAlertsContext = createContext<readonly LateAlertRow[]>([]);

export interface SlipRef {
  alert_id: string;
  order_ids: string[];
}

export type LateCardModel =
  | { mode: 'grouped'; key: string; alert_ids: string[]; order_ids: string[]; minutes: number | null }
  | { mode: 'alone'; key: string; alert_id: string; minutes: number | null; lines: Array<{ name: string; quantity: number; state: string }> };

const minutesOf = (rows: readonly LateAlertRow[], ids: readonly string[]): number | null => {
  let best: number | null = null;
  for (const r of rows) {
    const m = ids.includes(r.alert_id) ? r.card?.details?.minutes_late : undefined;
    if (m !== undefined && (best === null || m > best)) best = m;
  }
  return best;
};

/** The table codes a 01d lock shows ("F4", "F4 + F5"). */
const codesOf = (code: string): string[] => code.split('+').map((c) => c.trim()).filter((c) => c !== '');

export function lateCards(o: {
  /** this seating's current orders (seating-orders) */
  orders: readonly Pick<SeatingOrder, 'order_id' | 'placed_at'>[];
  /** H5: the open slips; undefined = H5 not on the hub yet */
  slips: readonly SlipRef[] | undefined;
  rows: readonly LateAlertRow[];
  /** placed_at of any open order of the branch (catch-up orders), for a slip's orders now on another seating */
  placedAt: (order_id: string) => number | null;
  /** this seating's table names, for the interim match by table_code */
  tableNames: readonly string[];
  /** alerts this device already answered or released (gone from the card before the frame says so) */
  done: ReadonlySet<string>;
}): LateCardModel[] {
  const mine = new Map(o.orders.map((x) => [x.order_id, x.placed_at]));
  const closed = new Set(o.rows.filter((r) => r.state === 'closed').map((r) => r.alert_id));
  if (o.slips !== undefined) {
    const alert_ids: string[] = [];
    const order_ids = new Set<string>();
    for (const slip of o.slips) {
      if (closed.has(slip.alert_id) || o.done.has(slip.alert_id)) continue;
      // the slip's oldest order (by placed_at); unknown times sort last
      let oldest: { id: string; at: number } | null = null;
      for (const id of slip.order_ids) {
        const at = mine.get(id) ?? o.placedAt(id);
        if (at === null || at === undefined) continue;
        if (oldest === null || at < oldest.at || (at === oldest.at && id < oldest.id)) oldest = { id, at };
      }
      const here = oldest === null ? slip.order_ids.some((id) => mine.has(id)) : mine.has(oldest.id);
      if (!here) continue;
      alert_ids.push(slip.alert_id);
      for (const id of slip.order_ids) if (mine.has(id)) order_ids.add(id);
    }
    if (alert_ids.length === 0) return [];
    return [{ mode: 'grouped', key: alert_ids.join(), alert_ids, order_ids: [...order_ids], minutes: minutesOf(o.rows, alert_ids) }];
  }
  const names = new Set(o.tableNames);
  return o.rows
    .filter((r) => r.kind === 'slip_warning' && r.state === 'open' && !o.done.has(r.alert_id))
    .filter((r) => {
      const code = r.lock.table_code ?? null;
      return code !== null && codesOf(code).some((c) => names.has(c));
    })
    .map((r) => ({ mode: 'alone' as const, key: r.alert_id, alert_id: r.alert_id, minutes: r.card?.details?.minutes_late ?? null, lines: r.card?.details?.lines ?? [] }));
}

/** 02b §3.8 / 03a D12: the goes-with partners of a line among the others (config `goes_with`, item or category). */
export function partnersOf(config: Pick<BranchConfig, 'goes_with' | 'items'> | null, line: SeatingLine, others: readonly SeatingLine[]): SeatingLine[] {
  if (config === null || line.item_id === null) return [];
  const cat = (item_id: string | null) => (item_id === null ? null : (config.items.find((i) => i.item_id === item_id)?.category_id ?? null));
  const matches = (kind: 'item' | 'category', id: string, l: SeatingLine) => (kind === 'item' ? l.item_id === id : cat(l.item_id) === id);
  const rules = config.goes_with.filter((g) => !g.excluded);
  return others.filter(
    (other) =>
      other.order_item_id !== line.order_item_id &&
      rules.some(
        (g) =>
          (matches(g.source_kind, g.source_id, line) && matches(g.target_kind, g.target_id, other)) ||
          (matches(g.source_kind, g.source_id, other) && matches(g.target_kind, g.target_id, line)),
      ),
  );
}
