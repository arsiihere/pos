// 02b v1.0.3 contracts (§4.2, §3.2–§3.5, §3.10, §5, §6.1; owner 2026-11-10 AD-8–AD-10). Types only: the wave-1+
// lanes implement against them.
import type { IsAvailable } from '@pos/domain';
import type { dayDraws, ProposedOrder } from '@pos/engine';
import type { BranchConfig, EventDraft, ItemAddedPayload } from '@pos/events';
import type Database from 'better-sqlite3';
import type { CommandCtx } from '../commands/registry.js';

/** §4.4: the order types 02b takes (03a's `delivery` is refused until P2). */
export type OrderType = 'dine_in' | 'takeaway' | 'parking';
/** §4.4 (S10). */
export type CarType = 'sedan' | 'mini' | 'large';

/**
 * §4.2 `orderLines` row: the §4.2 fields plus the §5 `order_lines` columns the commands read (SQL nullability).
 * Derived: `live_units` = units − removed − voided; `billed_minor` per §3.4; `zone_served` = served_from_zone_id set.
 * Flags are booleans here (`is_food` is the 0/1 column): readers convert SQLite 0/1 → boolean; never cast rows.
 */
export interface LineView {
  order_item_id: string;
  order_id: string;
  parent_order_item_id: string | null;
  line_kind: ItemAddedPayload['line_kind'];
  item_id: string | null;
  deal_id: string | null;
  name: string;
  sale_unit: ItemAddedPayload['sale_unit'];
  /** NULL while a weight is pending */
  quantity: number | null;
  units: number;
  live_units: number;
  comped_units: number;
  removed_units: number;
  voided_units: number;
  /** engine view only; a remade unit stays live for money (O20) */
  returned_units: number;
  refundable_minor: number;
  comp_minor: number;
  comp_voided_minor: number;
  removed_minor: number;
  refund_minor: number;
  /** NULL while a weight is pending */
  line_total_minor: number | null;
  billed_minor: number;
  /** the returned line of a return line (money 0) */
  return_of: string | null;
  served_from_zone_id: string | null;
  zone_served: boolean;
  /** recorded_at of the ItemAdded (zone undo window) */
  added_at: number;
  served_at: number | null;
  served_source: 'tap' | 'estimated' | 'zone' | null;
  /** §3.3 food line: engine line ∧ not zone-served ∧ ¬is_ready_item */
  is_food: boolean;
  kitchen_note: string | null;
}

/**
 * §4.2 `ordersOf` row: the plan's fields plus the §5 `orders` columns. No contact values (O17): `has_phone` only;
 * `cancelled` / `billed` = their `_at` column set. Readers convert SQLite 0/1 → boolean; never cast rows.
 */
export interface OrderView {
  order_id: string;
  order_type: OrderType;
  table_key: string;
  business_date: string;
  /** takeaway only */
  token: number | null;
  car_number: string | null;
  car_type: CarType | null;
  order_note: string | null;
  /** envelope actor_id of OrderPlaced */
  placed_by: string;
  /** recorded_at of OrderPlaced */
  placed_at: number;
  follow_up: boolean;
  cancelled: boolean;
  cancelled_at: number | null;
  billed: boolean;
  billed_at: number | null;
  day_closed_at: number | null;
  sent_after_reconnect: boolean;
  has_phone: boolean;
  lines: LineView[];
}

/** §4.2 / §3.13: Σ billed_minor over the seating's live orders (02a seating_orders); 1 statement. */
export type SeatingTotals = (db: Database.Database, seating_id: string) => { total_minor: number; order_count: number };

/** §4.2: Map<order_id, LineView[]>; 1 statement. */
export type OrderLines = (db: Database.Database, order_ids: readonly string[]) => Map<string, LineView[]>;

/** §4.2: the seating's orders (02a seating_orders, P-1c) with their lines; 1 statement. */
export type OrdersOf = (db: Database.Database, seating_id: string) => OrderView[];

/** §3.4 ledger (pure, 0 statements): shares k … k+n−1, and the comped take-back rule applied n times. */
export type LineShares = (line: {
  refundable_minor: number;
  units: number;
  comped_units: number;
  removed_units: number;
  voided_units: number;
  comp_minor: number;
}) => { next_share_minor(n: number): number; comped_take_back_minor(n: number): number };

/**
 * §4.2: OrderCancelled, OrderFoodCleared, comp-request closes after units leave billing (04 voids); 2 statements.
 * AD-9: takes the caller's command ctx (`ctx.tx` is the transaction; §4.2's `tx` read as a name; 02a `RequireLock`
 * precedent), so the comp-request closes carry the caller's actor and device.
 */
export type LineChangeDrafts = (
  ctx: CommandCtx,
  order_id: string,
  changes: { order_item_id: string; units_out: number }[],
) => EventDraft[];

/**
 * §3.3 / §3.5 (pure): OrderFoodServed / OrderFoodCleared for an order's lines after a serve, a change or a return.
 * `lines` = the order's lines AFTER the change (served_at set, the return line included).
 * AD-13: for `served`, `OrderFoodServed` only when `order_item_ids` (the lines this ItemServed served) include a
 * food line (§3.3); `lines` stays the order's lines after the change.
 * AD-10: drafts without time / actor / device (as engine `StockReservedDraft` / `ItemsReleasedDraft`); the caller
 * adds the envelope (`occurred_at`, `actor_id`, `device_id`).
 */
export type FoodDrafts = (
  order_id: string,
  lines: readonly LineView[],
  after: { kind: 'served'; order_item_ids: readonly string[] } | 'change' | 'return',
) => Pick<EventDraft, 'stream_type' | 'stream_id' | 'event_type' | 'schema_version' | 'payload'>[];

/** §3.10: the zone_stock_low / zone_stock_out raise and close drafts for count changes (before → after). */
export type ZoneAlertDrafts = (ctx: CommandCtx, changes: { zone_id: string; item_id: string; before: number; after: number }[]) => EventDraft[];

/** §6.1 option choice of a line or a deal part. */
export interface SubmitOption {
  option_id: string;
  quantity: number;
  order_item_id?: string;
}

/** §6.1 SubmitOrder payload (typed from the §6.1 payload table; the zod schema is lane 2A's). */
export interface SubmitInput {
  order_id: string;
  order_type: OrderType;
  table_id?: string;
  seating_id?: string;
  takeaway?: { customer_name?: string; phone?: string };
  parking?: { car_number: string; car_type: CarType; phone?: string };
  /** ≤ 200 */
  order_note?: string;
  /** 1–40 */
  lines: Array<{
    order_item_id: string;
    item_id?: string;
    deal_id?: string;
    variant_id?: string;
    quantity?: number;
    options?: SubmitOption[];
    deal_choices?: Array<{ deal_part_id: string; item_id: string; order_item_id: string; options?: SubmitOption[] }>;
    /** ≤ 80 */
    kitchen_note?: string;
    from_zone?: boolean;
  }>;
}

/** AD-8: what `buildSubmit` needs beyond config and payload; the caller reads it. */
export interface BuildSubmitCtx {
  /** hub time (ms) for availability windows (S47) */
  now: number;
  /**
   * AD-12: the hub's UTC offset (ms) from `hubTime(clock)` (apps/hub/src/lib/hub-time.ts), passed with `now`; never read
   * the runtime timezone (packages/domain/src/availability-windows.ts rule, S47).
   */
  utc_offset_ms: number;
  /** the item_availability callback, as `isItemOrderable` / `checkOptionChoices` (@pos/domain menu-lines) take it */
  isAvailable: IsAvailable;
  /**
   * 01c V20 (owner 2026-11-11 S-1): the day-frozen sale unit and stock draws of an item. The caller passes
   * `id => dayDraws(ctx.state, configItem(id), configStockUnits)`; buildSubmit copies these into
   * `ItemAdded.stock_draws` / `ProposedLine`. Every stock path uses dayDraws; never the config's own draws.
   */
  draws: (item_id: string) => ReturnType<typeof dayDraws>;
  /** the seating's primary table (02a `seatingOf`) for zone routing; null for takeaway / parking */
  primary_table_id: string | null;
  /** §3.3, computed by the caller (dine-in only; false for takeaway / parking) */
  follow_up: boolean;
}

/**
 * §3.2 steps 4–7 (pure): the ProposedOrder, every line's ItemAdded payload, and the order_item_ids of the lines that
 * may be zone-served (step 5 before the count check).
 * AD-8: `proposed` and `itemAdded` build the zone candidates as KITCHEN lines; `zoneCandidates` lists their
 * order_item_ids. The caller (SubmitOrder) removes the zone-served ones from `proposed` after the zone count check
 * and sets `served_from_zone_id` on their ItemAdded.
 */
export type BuildSubmit = (
  config: BranchConfig,
  input: SubmitInput,
  ctx: BuildSubmitCtx,
) => { proposed: ProposedOrder; itemAdded: ItemAddedPayload[]; zoneCandidates: string[] };
