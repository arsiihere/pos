import type {
  ItemAddedPayload,
  ItemRemovedPayload,
  ItemReturnedPayload,
  ItemServedPayload,
  ItemVoidedPayload,
  LineCompedPayload,
  LineWeightSetPayload,
  OrderCancelledPayload,
  OrderContactSetPayload,
  OrderPlacedPayload,
  OrdersBilledPayload,
  PosEvent,
  ZoneStockAddedPayload,
  ZoneStockSetPayload,
} from '@pos/events';
import type Database from 'better-sqlite3';
import type { Projection } from '../projections/registry.js';

// 02b §5: the one projection `orders` (with `reset`). It writes orders, order_lines and zone_stock and reads only
// its own events and its own three tables (02a T19: no fold reads another projection, so replay is identical in any
// registration order, test 28). Times are the envelope recorded_at. Folds never cascade (§3.4): every cascaded line
// has its own event.

// §5 projection bullet. OrderLinesAdded is listed there but carries no column of these tables: return_of comes from
// ItemAdded.return_of (owner 2026-11-11 AD-15), so OrderLinesAdded is not folded.
export const ORDERS_EVENT_TYPES: readonly string[] = [
  'OrderPlaced',
  'ItemAdded',
  'ItemRemoved',
  'ItemVoided',
  'ItemReturned',
  'ItemServed',
  'LineWeightSet',
  'LineComped',
  'OrderContactSet',
  'OrderCancelled',
  'OrdersBilled',
  'BusinessDayClosed',
  'ZoneStockAdded',
  'ZoneStockSet',
];

/** §5: the `orders` projection. */
export function ordersProjection(): Projection {
  return {
    name: 'orders',
    eventTypes: [...ORDERS_EVENT_TYPES],
    apply(tx, event) {
      applyOrders(tx, event);
    },
    reset(tx) {
      tx.prepare('DELETE FROM orders').run();
      tx.prepare('DELETE FROM order_lines').run();
      tx.prepare('DELETE FROM zone_stock').run();
    },
  };
}

function applyOrders(tx: Database.Database, event: PosEvent): void {
  const at = event.recorded_at;
  switch (event.event_type) {
    case 'OrderPlaced':
      return applyPlaced(tx, event);
    case 'ItemAdded':
      return applyAdded(tx, event.payload as ItemAddedPayload, at);
    case 'ItemRemoved':
      return applyRemoved(tx, event.payload as ItemRemovedPayload);
    case 'ItemVoided':
      return applyVoided(tx, event.payload as ItemVoidedPayload);
    case 'ItemReturned': {
      // §6.19 / O20: engine view only, money unchanged. A return is of the whole served line (§3.8): its live units.
      const p = event.payload as ItemReturnedPayload;
      tx.prepare('UPDATE order_lines SET returned_units = units - removed_units - voided_units WHERE order_item_id = ?').run(p.order_item_id);
      return;
    }
    case 'ItemServed': {
      // §6.19, §3.7 / §3.12 (Q-6): served_at = min(served_at ?? recorded_at, recorded_at); a served line keeps its first serve.
      const p = event.payload as ItemServedPayload;
      const servedAt = Math.min(p.served_at ?? at, at);
      tx.prepare(
        `UPDATE order_lines SET served_at = ?, served_source = ?
         WHERE served_at IS NULL AND order_item_id IN (SELECT value FROM json_each(?))`,
      ).run(servedAt, p.source, JSON.stringify(p.order_item_ids));
      return;
    }
    case 'LineWeightSet': {
      // §3.4 Weights / §6.19: the weighed line starts at 0; refundable_minor = line_total_minor.
      const p = event.payload as LineWeightSetPayload;
      tx.prepare('UPDATE order_lines SET quantity = ?, line_total_minor = ?, refundable_minor = ? WHERE order_item_id = ?').run(
        p.quantity,
        p.line_total_minor,
        p.line_total_minor,
        p.order_item_id,
      );
      return;
    }
    case 'LineComped': {
      // §3.4: a comp takes the next free shares; value_minor is this line's own share (children have their own event).
      const p = event.payload as LineCompedPayload;
      tx.prepare('UPDATE order_lines SET comped_units = comped_units + ?, comp_minor = comp_minor + ? WHERE order_item_id = ?').run(
        p.units,
        p.value_minor,
        p.order_item_id,
      );
      return;
    }
    case 'OrderContactSet': {
      // O17: the contact columns come only from this event.
      const p = event.payload as OrderContactSetPayload;
      tx.prepare('UPDATE orders SET customer_name = ?, phone = ? WHERE order_id = ?').run(p.customer_name, p.phone, p.order_id);
      return;
    }
    case 'OrderCancelled': {
      const p = event.payload as OrderCancelledPayload;
      tx.prepare('UPDATE orders SET cancelled_at = ? WHERE order_id = ? AND cancelled_at IS NULL').run(at, p.order_id);
      return;
    }
    case 'OrdersBilled': {
      // §3.3 Billed: every bill, every order type.
      const p = event.payload as OrdersBilledPayload;
      tx.prepare('UPDATE orders SET billed_at = ? WHERE billed_at IS NULL AND order_id IN (SELECT value FROM json_each(?))').run(
        at,
        JSON.stringify(p.order_ids),
      );
      return;
    }
    case 'BusinessDayClosed':
      return applyDayClosed(tx, at);
    case 'ZoneStockAdded': {
      const p = event.payload as ZoneStockAddedPayload;
      zoneAdd(tx, p.zone_id, p.item_id, p.quantity);
      return;
    }
    case 'ZoneStockSet': {
      const p = event.payload as ZoneStockSetPayload;
      tx.prepare(
        `INSERT INTO zone_stock (zone_id, item_id, on_hand) VALUES (?, ?, ?)
         ON CONFLICT (zone_id, item_id) DO UPDATE SET on_hand = excluded.on_hand`,
      ).run(p.zone_id, p.item_id, p.on_hand);
      return;
    }
    default:
      return;
  }
}

// §5 `orders` row (§6.19). placed_by = envelope actor_id, placed_at = recorded_at; contact columns stay NULL (O17).
// 02b writes only dine_in / takeaway / parking with business_date and a staff actor (§3.1, §3.2, E-1); an OrderPlaced
// without them (03a's `delivery`, an event logged before E-1) is not a 02b order and gets no row.
function applyPlaced(tx: Database.Database, event: PosEvent): void {
  const p = event.payload as OrderPlacedPayload;
  if (p.order_type === 'delivery' || p.business_date === undefined || event.actor_id === null) return;
  tx.prepare(
    `INSERT INTO orders (order_id, order_type, table_key, business_date, token, car_number, car_type, order_note,
                         placed_by, placed_at, follow_up, sent_after_reconnect)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.order_id,
    p.order_type,
    p.table_key,
    p.business_date,
    p.token ?? null,
    p.car_number ?? null,
    p.car_type ?? null,
    p.order_note ?? null,
    event.actor_id,
    event.recorded_at,
    p.follow_up ? 1 : 0,
    p.sent_after_reconnect === true ? 1 : 0,
  );
}

// §5 `order_lines` row from the ItemAdded copy (01c §4.3 + C-1); zone-served line → zone count − (§3.10).
function applyAdded(tx: Database.Database, p: ItemAddedPayload, at: number): void {
  const units = lineUnits(tx, p);
  const zoneServed = p.served_from_zone_id !== null;
  // §3.3 food line: engine line (station, not a deal; 03a isEngineLine) ∧ not zone-served ∧ ¬is_ready_item.
  const isFood = p.station_id !== null && p.line_kind !== 'deal' && !zoneServed && !p.is_ready_item;
  // A repeated ItemAdded of a known id changes nothing (as the engine's fold, 03a AD-8): the first copy stays.
  const inserted = tx.prepare(
    `INSERT INTO order_lines (order_item_id, order_id, parent_order_item_id, line_kind, item_id, deal_id, name, sale_unit,
                              quantity, units, line_total_minor, refundable_minor, return_of, served_from_zone_id, added_at,
                              is_food, kitchen_note, options_json, station_id, option_quantity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (order_item_id) DO NOTHING`,
  ).run(
    p.order_item_id,
    p.order_id,
    p.parent_order_item_id,
    p.line_kind,
    p.item_id,
    p.deal_id,
    p.name,
    p.sale_unit,
    p.quantity,
    units,
    p.line_total_minor,
    refundableMinor(p),
    p.return_of ?? null, // §3.8, AD-15: the returned line of a return line (fix and remake); absent on every other line
    p.served_from_zone_id,
    at,
    isFood ? 1 : 0,
    p.kitchen_note,
    // ⚠️ Changed by v1.0.7 (owner 2026-11-11, B3-2): the plain options as [{ name, quantity }], NULL for none.
    p.options.length === 0 ? null : JSON.stringify(p.options.map((o) => ({ name: o.name, quantity: o.quantity }))),
    // ⚠️ Changed by v1.0.12 (04 Q-14): the line's ItemAdded.station_id (NULL for a deal header; a routed line keeps its route).
    p.station_id,
    // ⚠️ Changed by v1.0.13 (owner 2026-11-12, 04 Q-19): the §3.4 cascade's null-quantity child rule reads it.
    p.option_quantity,
  );
  if (inserted.changes === 1 && zoneServed && p.item_id !== null) {
    tx.prepare('UPDATE zone_stock SET on_hand = on_hand - ? WHERE zone_id = ? AND item_id = ?').run(units, p.served_from_zone_id, p.item_id);
  }
}

// §3.4 Units: quantity for piece lines (deal and option_child lines included); 1 for g / ml and while a weight is
// pending (03a :246); a g / ml deal_part has the deal quantity (01c :309), read from its own deal line here.
function lineUnits(tx: Database.Database, p: ItemAddedPayload): number {
  if (p.line_kind === 'deal_part' && p.sale_unit !== 'piece') {
    const parent = tx.prepare('SELECT units FROM order_lines WHERE order_item_id = ?').get(p.parent_order_item_id) as { units: number } | undefined;
    return parent?.units ?? 1;
  }
  if (p.sale_unit !== 'piece' || p.quantity === null) return 1;
  return p.quantity;
}

// §3.4 Refundable amount: line_total_minor for item / option_child (0 while a weight is pending, LineWeightSet sets
// it); a deal_part's allocated_price_minor + its option charges; 0 for a deal line and for a return line (§3.8).
function refundableMinor(p: ItemAddedPayload): number {
  if (p.line_kind === 'deal' || p.return_of !== undefined) return 0;
  if (p.line_kind === 'deal_part') return (p.allocated_price_minor ?? 0) + p.options.reduce((sum, o) => sum + o.charge_minor, 0);
  return p.line_total_minor ?? 0;
}

interface LedgerRow {
  units: number;
  removed_units: number;
  voided_units: number;
  comped_units: number;
  comp_minor: number;
  refundable_minor: number;
  served_from_zone_id: string | null;
  item_id: string | null;
}

function ledgerRow(tx: Database.Database, orderItemId: string): LedgerRow | undefined {
  return tx
    .prepare(
      `SELECT units, removed_units, voided_units, comped_units, comp_minor, refundable_minor, served_from_zone_id, item_id
       FROM order_lines WHERE order_item_id = ?`,
    )
    .get(orderItemId) as LedgerRow | undefined;
}

// §3.4 Ledger. shares = allocateDealMinor(refundable_minor, [1 × units]): every share q = floor(refundable / units)
// except the last, q + r (BigInt-safe). Units leave billing in order; the k-th takes shares[k]. The comped
// take-back of one unit = comp_minor − q × (comped_units − 1). Private here: 02b's exported `lineShares`
// (orders/ledger.ts, §3.4) is the shared form of the same rule.
function shareOf(refundable: number, units: number, k: number): bigint {
  const total = BigInt(refundable);
  const n = BigInt(units);
  const q = total / n;
  return BigInt(k) === n - 1n ? total - q * (n - 1n) : q;
}

// ItemRemoved { order_item_id, units? }: absent units = all live units. Remove takes uncomped live units first
// (shares k …); then each comped unit leaves comped_units for removed_units and its take-back moves comp → removed.
// A zone-served line's units go back to the zone count, always (§3.10; the undo window is the command's check).
function applyRemoved(tx: Database.Database, p: ItemRemovedPayload): void {
  const line = ledgerRow(tx, p.order_item_id);
  if (line === undefined) return;
  const live = line.units - line.removed_units - line.voided_units;
  const n = Math.min(p.units ?? live, live);
  if (n <= 0) return;
  const uncomped = Math.min(n, live - line.comped_units);
  const k = line.comped_units + line.removed_units + line.voided_units;
  let removedMinor = 0n;
  for (let i = 0; i < uncomped; i += 1) removedMinor += shareOf(line.refundable_minor, line.units, k + i);
  let comped = line.comped_units;
  let compMinor = BigInt(line.comp_minor);
  const q = BigInt(line.refundable_minor) / BigInt(line.units);
  for (let i = uncomped; i < n; i += 1) {
    const takeBack = compMinor - q * BigInt(comped - 1);
    compMinor -= takeBack;
    removedMinor += takeBack;
    comped -= 1;
  }
  tx.prepare(
    `UPDATE order_lines SET removed_units = removed_units + ?, removed_minor = removed_minor + ?, comped_units = ?, comp_minor = ?
     WHERE order_item_id = ?`,
  ).run(n, Number(removedMinor), comped, Number(compMinor), p.order_item_id);
  if (line.served_from_zone_id !== null && line.item_id !== null) zoneAdd(tx, line.served_from_zone_id, line.item_id, n);
}

// ItemVoided (04): its own money (refund_minor, comp_voided_minor; absent → 0). Void takes uncomped live units first,
// so comped_units drops by max(0, units − (live − comped)) and that money leaves comp_minor for comp_voided_minor (O21).
// Voids never change a zone count (§3.10).
function applyVoided(tx: Database.Database, p: ItemVoidedPayload): void {
  const line = ledgerRow(tx, p.order_item_id);
  if (line === undefined) return;
  const live = line.units - line.removed_units - line.voided_units;
  const n = Math.min(p.units, live);
  if (n <= 0) return;
  const compedOut = Math.max(0, n - (live - line.comped_units));
  const compVoided = p.comp_voided_minor ?? 0;
  tx.prepare(
    `UPDATE order_lines SET voided_units = voided_units + ?, refund_minor = refund_minor + ?, comped_units = comped_units - ?,
       comp_minor = comp_minor - ?, comp_voided_minor = comp_voided_minor + ?
     WHERE order_item_id = ?`,
  ).run(n, p.refund_minor ?? 0, compedOut, compVoided, compVoided, p.order_item_id);
}

// §3.3 Day close: day_closed_at on every open order (any earlier date) that is cancelled, billed, or whose lines are
// all served, removed or voided. A deal line is never served itself (§3.4 Deal headers): only its parts count.
function applyDayClosed(tx: Database.Database, at: number): void {
  tx.prepare(
    `UPDATE orders SET day_closed_at = ?
     WHERE day_closed_at IS NULL
       AND (cancelled_at IS NOT NULL OR billed_at IS NOT NULL
            OR NOT EXISTS (SELECT 1 FROM order_lines l
                           WHERE l.order_id = orders.order_id AND l.line_kind <> 'deal' AND l.served_at IS NULL
                             AND l.units - l.removed_units - l.voided_units > 0))`,
  ).run(at);
}

function zoneAdd(tx: Database.Database, zoneId: string, itemId: string, quantity: number): void {
  tx.prepare(
    `INSERT INTO zone_stock (zone_id, item_id, on_hand) VALUES (?, ?, ?)
     ON CONFLICT (zone_id, item_id) DO UPDATE SET on_hand = on_hand + excluded.on_hand`,
  ).run(zoneId, itemId, quantity);
}
