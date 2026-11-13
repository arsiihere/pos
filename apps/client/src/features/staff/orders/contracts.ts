import type { HubResult } from '../../../api/hub-admin';
import type { CommandOptions } from '../api';
import type { QueueableCommand } from '../tables/contracts';

// 02b client contracts (W0.5, owner Q-1, Q-3): the shapes the 02b lanes and 02a's queue use. They mirror the hub
// exactly (apps/hub/src/orders/contracts.ts LineView :19-56; queries/seating-orders.ts SeatingOrder; queries/
// open-orders.ts OpenOrder; queries/eta-preview.ts EtaPreview; queries/zone-stock.ts ZoneStockBody; catch-up.ts;
// commands/*). Fields a hub-gap task adds (02-hub-gaps-plan.md H2–H6) are optional: an absent field = not there yet,
// and the consuming lane ships its fallback (never a flag).

export type OrderType = 'dine_in' | 'takeaway' | 'parking';
export type CarType = 'sedan' | 'mini' | 'large';
export type LineKind = 'item' | 'option_child' | 'deal' | 'deal_part';
export type SaleUnit = 'piece' | 'g' | 'ml';

/** H2 (Q-7): plain options of a line, as stored (`options_json`: name + quantity, no option_id). */
export interface LineOption {
  name: string;
  quantity: number;
}

/** H6 (Q-11): the line's open comp request. */
export interface PendingComp {
  alert_id: string;
  units: number;
  value_minor: number;
}

/** 02b §4.2 `LineView` (hub orders/contracts.ts). Money in minor units (paisa). */
export interface LineView {
  order_item_id: string;
  order_id: string;
  parent_order_item_id: string | null;
  line_kind: LineKind;
  item_id: string | null;
  deal_id: string | null;
  name: string;
  sale_unit: SaleUnit;
  /** null while a weight is pending */
  quantity: number | null;
  units: number;
  live_units: number;
  comped_units: number;
  removed_units: number;
  voided_units: number;
  returned_units: number;
  refundable_minor: number;
  comp_minor: number;
  comp_voided_minor: number;
  removed_minor: number;
  refund_minor: number;
  /** null while a weight is pending */
  line_total_minor: number | null;
  billed_minor: number;
  return_of: string | null;
  served_from_zone_id: string | null;
  zone_served: boolean;
  /** recorded_at of the ItemAdded (zone undo window, hub clock) */
  added_at: number;
  served_at: number | null;
  served_source: 'tap' | 'estimated' | 'zone' | null;
  is_food: boolean;
  kitchen_note: string | null;
  /** H2 (Q-7); absent until H2 lands → no options line */
  options?: LineOption[];
  /** H6 (Q-11); absent until H6 lands → the waiting card from this device's memory */
  pending_comp?: PendingComp | null;
}

/** 02b §6.15 line stage (hub seating-orders.ts LineStage = EngineLine['stage'] (packages/engine/src/state.ts:141) | 'out_of_engine' | null). */
export type LineStage = 'added' | 'cooking' | 'done' | 'served' | 'removed' | 'voided' | 'returned' | 'out_of_engine' | null;

export type SeatingLine = LineView & { stage: LineStage; fired: boolean };

/** 02b §6.15 order (hub SeatingOrder). */
export interface SeatingOrder {
  order_id: string;
  placed_by: { staff_id: string; name: string | null };
  placed_at: number;
  follow_up: boolean;
  cancelled: boolean;
  billed: boolean;
  has_phone: boolean;
  /** EngineOrder.promise_ms while the order is in the engine, else null */
  promise_ms: number | null;
  /** H2 (Q-7); absent until H2 lands → no order note line */
  order_note?: string | null;
  lines: SeatingLine[];
}

export interface SeatingOrdersBody {
  orders: SeatingOrder[];
  total_minor: number;
}

/** 02b §6.18a (H3, Q-8): one order in the SeatingOrder shape. */
export type OrderViewBody = SeatingOrder;

/** `orderView`: `missing` = the route is not there yet (404 without ORDER_NOT_FOUND) → the Served / Not served fallback. */
export type OrderViewAnswer = { kind: 'order'; order: OrderViewBody } | { kind: 'missing' };

/** 02b §6.16 row (hub OpenOrder). */
export interface OpenOrder {
  order_id: string;
  order_type: OrderType;
  table_key: string;
  token: number | null;
  car_number: string | null;
  car_type: CarType | null;
  has_phone: boolean;
  placed_at: number;
  business_date: string;
  from_date: string | null;
  ready: { n: number; m: number };
  promise_ms: number | null;
  abandoned: boolean;
  /** H4 (Q-9); absent until H4 → catch-up placed_by + staff-roster names */
  placed_by?: { staff_id: string; name: string | null };
  /** H4 (Q-9), dine-in rows; absent until H4 → the map tile whose seating_id = the table_key suffix */
  table_id?: string | null;
}

export interface OpenOrdersBody {
  orders: OpenOrder[];
}

/** 02b §6.14 (hub EtaPreview). */
export interface EtaPreviewBody {
  as_of_seq: number;
  groups: Array<{ promise_ms: number; keys: string[] }>;
  lines: Array<{ key: string; eta_ms: number | null; from_stock: boolean; zone_served: boolean; refused?: { code: string; details: Record<string, unknown> } }>;
}

/** 02b §6.17 (hub ZoneStockBody). */
export interface ZoneStockBody {
  zone_id: string;
  name: string;
  items: Array<{ item_id: string; name: string | null; on_hand: number; threshold: number }>;
}

/** 02b §6.18. */
export interface OrderContact {
  customer_name: string | null;
  phone: string | null;
}

// ----------------------------------------------------------------------------------------------- commands

export interface SubmitOption {
  option_id: string;
  quantity: number;
  order_item_id?: string;
}

/** 02b §6.1 line (hub submit-order.ts Line). Every id is device-minted (newUlid). */
export interface SubmitLine {
  order_item_id: string;
  item_id?: string;
  deal_id?: string;
  quantity?: number;
  options?: SubmitOption[];
  deal_choices?: Array<{ deal_part_id: string; item_id: string; order_item_id: string; options?: SubmitOption[] }>;
  kitchen_note?: string;
  from_zone?: boolean;
}

/** 02b §6.1 payload (hub submit-order.ts PayloadObject). */
export interface SubmitOrderPayload {
  order_id: string;
  order_type: OrderType;
  table_id?: string;
  seating_id?: string;
  takeaway?: { customer_name?: string; phone?: string };
  parking?: { car_number: string; car_type: CarType; phone?: string };
  order_note?: string;
  lines: SubmitLine[];
}

/** 02b §3.2 step 11 (hub submit-order.ts SubmitResult). */
export interface SubmitResult {
  order_id: string;
  token: number | null;
  groups: Array<{ group_id: string; promise_ms: number; order_item_ids: string[] }>;
  lines: Array<{ order_item_id: string; eta_ms: number | null; from_stock: boolean; zone_served: boolean }>;
}

/** 02b §6.14 draft: a SubmitOrder payload without ids; each line, option and deal choice has a temp `key`. */
export interface EtaDraft {
  order_type: OrderType;
  table_id?: string;
  seating_id?: string;
  takeaway?: SubmitOrderPayload['takeaway'];
  parking?: SubmitOrderPayload['parking'];
  order_note?: string;
  lines: Array<
    Omit<SubmitLine, 'order_item_id' | 'options' | 'deal_choices'> & {
      key: string;
      options?: Array<{ option_id: string; quantity: number; key?: string }>;
      deal_choices?: Array<{ deal_part_id: string; item_id: string; key: string; options?: Array<{ option_id: string; quantity: number; key?: string }> }>;
    }
  >;
}

export interface MarkServedPayload {
  lines: Array<{ order_id: string; order_item_ids: string[] }>;
}
export interface RemoveItemsPayload {
  order_id: string;
  /** required for dine-in */
  seating_id?: string;
  lines: Array<{ order_item_id: string; units?: number }>;
}
export interface CompLinePayload {
  order_item_id: string;
  units: number;
  /** Q-19: a config chip's label, or 'other' (then `note` is required) */
  reason_code: string;
  note?: string;
}
export type CompResult = { comped: true; value_minor: number } | { alert_id: string; pending: true; value_minor?: number };

/** 02b §6.1–§6.10 and §6.14–§6.18a (`api.ts` createOrdersApi). */
export interface OrdersApi {
  /** queueable: a replay passes the entry's `commandId` and `queuedAt` (02b §3.12) */
  submitOrder(p: SubmitOrderPayload, opts?: CommandOptions): Promise<HubResult<SubmitResult>>;
  removeItems(p: RemoveItemsPayload): Promise<HubResult<{ removed: Array<{ order_item_id: string; units: number }>; cancelled: boolean; comp_requests_closed: string[] }>>;
  setLineWeight(p: { order_item_id: string; quantity: number }): Promise<HubResult<{ line_total_minor: number }>>;
  /** queueable, as submitOrder */
  markServed(p: MarkServedPayload, opts?: CommandOptions): Promise<HubResult<{ served: number; skipped: string[] }>>;
  releaseItems(p: { order_ids: string[]; released: string[]; expedite: string[] }): Promise<HubResult<{ alerts_closed: number }>>;
  boostOrder(p: { order_id: string }): Promise<HubResult<Record<string, never>>>;
  returnToKitchen(p: { order_item_id: string; return_order_item_id: string; mode: 'fix' | 'remake' }): Promise<HubResult<{ eta_ms: number; promise_ms: number }>>;
  compLine(p: CompLinePayload): Promise<HubResult<CompResult>>;
  addZoneStock(p: { zone_id: string; item_id: string; quantity: number }): Promise<HubResult<{ on_hand: number }>>;
  setZoneStock(p: { zone_id: string; item_id: string; on_hand: number }): Promise<HubResult<{ on_hand: number }>>;
  /** §6.14: a draft over 8 KB (UTF-8) is refused locally, without a call */
  etaPreview(draft: EtaDraft): Promise<HubResult<EtaPreviewBody>>;
  seatingOrders(seating_id: string): Promise<HubResult<SeatingOrdersBody>>;
  openOrders(q?: { order_type?: 'takeaway' | 'parking' | 'all'; abandoned?: boolean }): Promise<HubResult<OpenOrdersBody>>;
  zoneStock(zone_id?: string): Promise<HubResult<ZoneStockBody[]>>;
  orderContact(order_id: string): Promise<HubResult<OrderContact>>;
  /** §6.18a (H3): a 404 that is not ORDER_NOT_FOUND = the route is not there yet → `{ kind: 'missing' }` */
  orderView(order_id: string): Promise<HubResult<OrderViewAnswer>>;
}

// ------------------------------------------------------------------------------------------ catch-up part

/** 02b §4.2 `ordersOf` row as the catch-up sends it (hub OrderView + O17 contact). No stage, no promise. */
export interface CatchUpOrder {
  order_id: string;
  order_type: OrderType;
  table_key: string;
  business_date: string;
  token: number | null;
  car_number: string | null;
  car_type: CarType | null;
  order_note: string | null;
  /** envelope actor_id of OrderPlaced */
  placed_by: string;
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
  /** kiosk and the placer only (O17) */
  customer_name?: string | null;
  phone?: string | null;
}

/** 02b §6.19 catch-up part `orders` (hub catch-up.ts OrdersCatchUp). */
export interface OrdersCatchUp {
  orders: CatchUpOrder[];
  zone_stock: ZoneStockBody[];
  /** H5 (Q-10); absent until H5 → each late card answered alone */
  open_slips?: Array<{ alert_id: string; order_ids: string[] }>;
}

// ------------------------------------------------------------------------------------ queue and drafts (25a)

/** 02b §3.12: one queued command. Stored before the first send; never a session token (Q-2). */
export interface QueueEntry {
  /** the command_id, the same on every replay */
  entry_id: string;
  command_type: QueueableCommand;
  /** frozen at enqueue (the cart is frozen, #35) */
  payload: unknown;
  /** hub-clock ms (device clock + the hub_time offset) */
  queued_at: number;
  staff_id: string;
  device_id: string;
  table_id?: string;
  seating_id?: string;
  label: string;
  state: 'queued' | 'log';
  /** why it is in the queue log: the hub's code, or 'reloaded' (Q-2: after a reload every entry goes to the log) */
  log_reason?: string;
  /** of the hub's error `details` with that code, only the refused item / deal id the row names (review #165); never
   *  a name or another person's id */
  log_details?: { item_id?: string; deal_id?: string };
}

/** Q-1: the queue store (IndexedDB `pos-queue` now; SQLite with 01d 9b). No Capacitor import. */
export interface QueueStore {
  put(entry: QueueEntry): Promise<void>;
  /** in queued_at order, then entry_id */
  list(): Promise<QueueEntry[]>;
  remove(entry_id: string): Promise<void>;
}

/** 02b §3.12 "Drafts in progress": per (device, staff), survive restarts. */
export interface Draft {
  draft_id: string;
  device_id: string;
  staff_id: string;
  order_type: OrderType;
  table_id?: string;
  seating_id?: string;
  /** the cart as the order screen keeps it (26b owns the shape) */
  cart: unknown;
  /** hub-clock ms */
  updated_at: number;
  held: boolean;
}

export interface DraftStore {
  put(draft: Draft): Promise<void>;
  list(device_id: string, staff_id: string): Promise<Draft[]>;
  remove(draft_id: string): Promise<void>;
}

// ------------------------------------------------------------------------------------- live mirrors (26a)

export type StockLevel = 'ok' | 'low' | 'out' | 'not_counted';

/** Q-22: stock from catch-up + Stock* frames folded with @pos/engine; sale units per menu item. */
export interface StockMirror {
  /** sale units the item can still sell now; null = not stock-tracked */
  available(item_id: string): number | null;
  level(item_id: string): StockLevel | null;
  subscribe(listener: () => void): () => void;
}

// ------------------------------------------------------------------------------------- idle lock (25d)

/** 02b §8 Device idle lock (00 H-1, Q-21): wall-clock idle since the last tap; idle_ttl_ms ≤ 0 = lock at once. */
export interface IdleLock {
  /** call on every tap; false when the TTL had already run out (the tap is swallowed and the lock shows) */
  touch(): boolean;
  locked(): boolean;
  subscribe(listener: () => void): () => void;
}
