import { phoneKey } from './phone-key.js';
import type {
  ItemAddedPayload,
  ItemRemovedPayload,
  ItemReturnedPayload,
  ItemServedPayload,
  ItemVoidedPayload,
  LineCompedPayload,
  LineCompRemovedPayload,
  LineWeightSetPayload,
  OrderCancelledPayload,
  OrderContactSetPayload,
  OrderPlacedPayload,
  OrdersBilledPayload,
  OrdersCarriedOverPayload,
  OrdersUnbilledPayload,
  OpenOrderBillChangedPayload,
  PosEvent,
  UnpaidHandoverApprovedPayload,
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
  // ⚠️ Changed by 05 (rows Q-2, Q-4, Q-5), 02b v1.0.16 §5.
  'OrdersUnbilled',
  'LineCompRemoved',
  'OrdersCarriedOver',
  'BusinessDayClosed',
  'ZoneStockAdded',
  'ZoneStockSet',
  // ⚠️ Changed by v1.0.25 run 3 (R3-M-1), §5: pickup_boosted (0029_orders_takeaway)
  'OrderBoosted',
  // ⚠️ Changed by v1.0.25 run 3 (R3-M-2, R3-M-5, R3-M-8), §5, §6.19 (D2): the named order's unpaid hand-over approval
  // and its clear (OrdersBilled / OrdersUnbilled clear it too)
  'UnpaidHandoverApproved',
  'OpenOrderBillChanged',
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
      // §3.4 Weights / §6.19: the weighed line starts at 0; refundable_minor = line_total_minor. ⚠️ Changed by 05
      // (R-7, R-17): unit_price_minor = round_half_up(line_total_minor ÷ units); only item lines are weighed
      // (set-line-weight) and a weighed line has 1 unit, so it is the weighed total (§3.4; same statement).
      const p = event.payload as LineWeightSetPayload;
      tx.prepare(
        `UPDATE order_lines SET quantity = ?, line_total_minor = ?, refundable_minor = ?, unit_price_minor = ?
         WHERE order_item_id = ?`,
      ).run(p.quantity, p.line_total_minor, p.line_total_minor, p.line_total_minor, p.order_item_id);
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
      // ⚠️ Changed by v1.0.25 (02b-TK R1), §3.1, §5: + phone_key, the matching key (never leaves the hub)
      tx.prepare('UPDATE orders SET customer_name = ?, phone = ?, phone_key = ? WHERE order_id = ?').run(
        p.customer_name,
        p.phone,
        p.phone === null ? null : phoneKey(p.phone),
        p.order_id,
      );
      return;
    }
    case 'OrderBoosted': {
      // ⚠️ Changed by v1.0.25 run 3 (R3-M-1), §3.8, D1: a boost of a pickup order keeps the pickup time and marks it
      const p = event.payload as { order_id: string };
      tx.prepare('UPDATE orders SET pickup_boosted = 1 WHERE order_id = ? AND pickup_at_ms IS NOT NULL').run(p.order_id);
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
      clearApprovals(tx, p.order_ids); // ⚠️ 02b v1.0.25 §6.19 (R3-M-5): the last close ends the effective approval
      return;
    }
    case 'OrdersUnbilled': {
      // ⚠️ Changed by 05 (row Q-2), §3.3 Unbilled: back to the state before BILLED, and off the day close (H1-11).
      const p = event.payload as OrdersUnbilledPayload;
      tx.prepare('UPDATE orders SET billed_at = NULL, day_closed_at = NULL WHERE order_id IN (SELECT value FROM json_each(?))').run(
        JSON.stringify(p.order_ids),
      );
      clearApprovals(tx, p.order_ids); // ⚠️ 02b v1.0.25 §6.19 (R3-M-5): a reopen ends the effective approval
      return;
    }
    case 'UnpaidHandoverApproved': {
      // ⚠️ 02b v1.0.25 §5, §6.19 (R3-M-2, R3-M-8; D2): the named order only, with the due verified at approval time
      const p = event.payload as UnpaidHandoverApprovedPayload;
      tx.prepare('UPDATE orders SET unpaid_handover_approved_at = ?, unpaid_handover_approved_due_minor = ? WHERE order_id = ?').run(at, p.due_minor, p.order_id);
      return;
    }
    case 'OpenOrderBillChanged': {
      // ⚠️ 02b v1.0.25 §6.19 (R3-M-3, R3-M-5, R3-M-8; D2): the writer decided which approvals ended; no billing read here
      const p = event.payload as OpenOrderBillChangedPayload;
      clearApprovals(tx, p.approval_cleared_order_ids);
      return;
    }
    case 'LineCompRemoved': {
      // ⚠️ Changed by 05 (row Q-4), §3.9: this line's own units and comp share leave the comp, never below 0.
      const p = event.payload as LineCompRemovedPayload;
      tx.prepare(
        'UPDATE order_lines SET comped_units = MAX(0, comped_units - ?), comp_minor = MAX(0, comp_minor - ?) WHERE order_item_id = ?',
      ).run(p.units, p.comp_minor, p.order_item_id);
      return;
    }
    case 'OrdersCarriedOver': {
      // ⚠️ Changed by 05 (row Q-5), §3.3 Day close: 05's hub-stream event (05 §6.24); only order_ids is read here.
      const p = event.payload as OrdersCarriedOverPayload;
      tx.prepare('UPDATE orders SET carried_over = 1 WHERE order_id IN (SELECT value FROM json_each(?))').run(JSON.stringify(p.order_ids));
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
                         placed_by, placed_at, follow_up, sent_after_reconnect, bill_key, pickup_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    billKey(tx, p),
    // ⚠️ Changed by v1.0.25 (02b-TK R4), §5: the event's pickup (null on every order logged before v1.0.25)
    p.pickup_at_ms ?? null,
  );
}

// ⚠️ Changed by 05 (row Q-6), 02b v1.0.16 §3.1, §5: takeaway 'takeaway:' + root (an addition takes the bill_key of the
// order it adds to, which already names its root), parking table_key + ':' + business_date (the normalised plate),
// dine-in NULL (05 bills it through seating_orders). Reads only `orders` (T19). SubmitOrder checks the target's row
// first, and the target's OrderPlaced has a lower seq, so the row is always there; if it were not, NULL (no guessed key,
// and no throw that would stop a refold at boot).
function billKey(tx: Database.Database, p: OrderPlacedPayload): string | null {
  if (p.order_type === 'parking') return `${p.table_key}:${p.business_date!}`;
  if (p.order_type !== 'takeaway') return null;
  if (p.adds_to_order_id === undefined) return `takeaway:${p.order_id}`;
  const row = tx.prepare('SELECT bill_key FROM orders WHERE order_id = ?').get(p.adds_to_order_id) as { bill_key: string | null } | undefined;
  return row?.bill_key ?? null;
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
                              is_food, kitchen_note, options_json, station_id, option_quantity, tax_profile_id, unit_price_minor, part_of,
                              option_id, deal_part_id, option_refs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    // ⚠️ Changed by 05 (row Q-1): the item's tax profile (the event field keeps its name); NULL = untaxed.
    p.tax_class_id,
    // ⚠️ Changed by 05 (R-7, R-17): per line kind from its own line_total_minor and units; NULL while a weight is pending.
    unitPriceMinor(p.line_total_minor, units),
    // ⚠️ Changed by v1.0.20 (STAB-5): the first part of a split line (§3.2 step 4a); NULL = not split.
    p.part_of ?? null,
    // ⚠️ Changed by v1.0.25 (02b-TK R1, G-4), §5: the line's refs (customer-orders); options as [{ option_id, quantity }]
    p.option_id,
    p.deal_part_id,
    p.options.length === 0 ? null : JSON.stringify(p.options.map((o) => ({ option_id: o.option_id, quantity: o.quantity }))),
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

// ⚠️ Changed by 05 (R-7, R-17), 02b v1.0.16 §5: round_half_up(line_total_minor ÷ units) in integers,
// floor((2 × t + u) ÷ (2 × u)) (BigInt, as shareOf). NULL while a weight is pending (no total); a deal_part (total 0) = 0;
// item, deal and option_child lines from their own total and units. Totals are never negative (01c §3.4.4).
function unitPriceMinor(line_total_minor: number | null, units: number): number | null {
  // units < 1 never reaches the fold (the command schema has quantity ≥ 1); NULL rather than a BigInt RangeError, so a
  // seq-0 refold can never stop the hub at boot.
  if (line_total_minor === null || units < 1) return null;
  const t = BigInt(line_total_minor);
  const u = BigInt(units);
  return Number((2n * t + u) / (2n * u));
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
// ⚠️ Changed by 05 (row Q-5): a carried order (carried_over = 1) is skipped and its flag cleared in the same fold, so it
// keeps day_closed_at = NULL for this close only.
function applyDayClosed(tx: Database.Database, at: number): void {
  tx.prepare(
    `UPDATE orders SET day_closed_at = ?
     WHERE day_closed_at IS NULL AND carried_over = 0
       AND (cancelled_at IS NOT NULL OR billed_at IS NOT NULL
            OR NOT EXISTS (SELECT 1 FROM order_lines l
                           WHERE l.order_id = orders.order_id AND l.line_kind <> 'deal' AND l.served_at IS NULL
                             AND l.units - l.removed_units - l.voided_units > 0))`,
  ).run(at);
  tx.prepare('UPDATE orders SET carried_over = 0 WHERE carried_over = 1').run();
}

function zoneAdd(tx: Database.Database, zoneId: string, itemId: string, quantity: number): void {
  tx.prepare(
    `INSERT INTO zone_stock (zone_id, item_id, on_hand) VALUES (?, ?, ?)
     ON CONFLICT (zone_id, item_id) DO UPDATE SET on_hand = on_hand + excluded.on_hand`,
  ).run(zoneId, itemId, quantity);
}

// ⚠️ 02b v1.0.25 §6.19 (D2): both approval columns back to null for these orders (one statement).
function clearApprovals(tx: Database.Database, order_ids: readonly string[]): void {
  if (order_ids.length === 0) return;
  tx.prepare(
    'UPDATE orders SET unpaid_handover_approved_at = NULL, unpaid_handover_approved_due_minor = NULL WHERE order_id IN (SELECT value FROM json_each(?)) AND unpaid_handover_approved_at IS NOT NULL',
  ).run(JSON.stringify(order_ids));
}
