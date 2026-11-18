import type { AlertLinkTarget } from '@pos/events';
import type { HubError } from '../../api/hub-admin';
import type { OrdersApi, OrderViewBody, ZoneStockBody } from '../staff/orders/contracts';
import { allServed } from '../staff/orders/table-view/Round';
import { orderViewHref, tableHref, zonesHref, type StaffFocus } from '../staff/shell/routes';
import type { MapTile, TableMapBody, TablesApi } from '../staff/tables/contracts';

// 01d v1.3 §3.13.3: the open check of a deep link. It uses only reads the target screen makes anyway (order-view,
// the table map, zone-stock) and hands their results to that screen. It never navigates on a guess: a read that
// fails is "cannot check" (rule 2), and a hub without the order-view route ({ kind: 'missing' }) too (G-3).
// The order's `table_key` is never read: it is stale after TablesMerged / SeatingSplit (B1); order-view's
// `seating_id` is the seating the order is in now.

/** What the check needs of an alert row (any surface: inbox, banner, requests-to-answer, call card). */
export interface CheckRow {
  alert_id: string;
  kind: string;
  raised_at: number;
  state?: 'open' | 'closed' | undefined;
  target: AlertLinkTarget;
}

export interface CheckDeps {
  orders: Pick<OrdersApi, 'orderView' | 'zoneStock'>;
  tables: Pick<TablesApi, 'tableMap'>;
  /** the table map the client already holds (Tables screen + its live frames); null → one `table-map` read */
  heldMap?: () => TableMapBody | null;
}

/** The reads the screen reuses (§3.13.3 "Reads per tap"). */
export type Preload = { order_view: OrderViewBody } | { zone_stock: ZoneStockBody[] };

export type CheckResult =
  | { kind: 'open'; href: string; focus: StaffFocus; preload?: Preload }
  | { kind: 'not_open' }
  /** §3.13.3 / rule 4 (B2): the request itself is closed; the only result that stops an AnswerSheet */
  | { kind: 'request_closed' }
  | { kind: 'cannot_check'; error: HubError };

/** §3.13.3: kinds 1, 2, 3, 7 are requests on their own alert; their state is checked first. */
const REQUEST_KINDS: ReadonlySet<string> = new Set(['void_approval', 'comp', 'table_handover', 'slip_warning']);

/** G-3: a hub without the order-view route. Cannot happen with a v1.3 hub (the route exists since 02b v1.0.11). */
const ROUTE_MISSING: HubError = { kind: 'api', status: 404, code: 'ROUTE_NOT_FOUND', details: {} };

const NOT_OPEN = { kind: 'not_open' } as const;
const isApi = (e: HubError, status: number, code: string) => e.kind === 'api' && e.status === status && e.code === code;

function* tilesOf(map: TableMapBody): Generator<MapTile> {
  for (const floor of map.floors) for (const zone of floor.zones) yield* zone.tables;
}

/** §3.13.3 step 4: the seating's place is its primary tile (`primary_table_id` = its own `table_id`). */
function primaryTileOf(map: TableMapBody, seating_id: string): MapTile | null {
  for (const t of tilesOf(map)) if (t.seating_id === seating_id && t.primary_table_id === t.table_id) return t;
  return null;
}

async function mapOf(deps: CheckDeps): Promise<{ ok: true; map: TableMapBody } | { ok: false; error: HubError }> {
  const held = deps.heldMap?.() ?? null;
  if (held !== null) return { ok: true, map: held };
  const answer = await deps.tables.tableMap();
  return answer.ok ? { ok: true, map: answer.data } : { ok: false, error: answer.error };
}

async function checkOrder(row: CheckRow, order_id: string, focus: StaffFocus, deps: CheckDeps): Promise<CheckResult> {
  const answer = await deps.orders.orderView(order_id);
  if (!answer.ok) return isApi(answer.error, 404, 'ORDER_NOT_FOUND') ? NOT_OPEN : { kind: 'cannot_check', error: answer.error };
  if (answer.data.kind === 'missing') return { kind: 'cannot_check', error: ROUTE_MISSING };
  const body = answer.data.order;
  if (body.cancelled || body.billed) return NOT_OPEN;
  if (focus.kind === 'line') {
    const l = body.lines.find((x) => x.order_item_id === focus.order_item_id);
    // a served line stays open (DL Q-2 (a)); a partial void keeps its other units (m4)
    if (l === undefined || l.live_units <= 0) return NOT_OPEN;
  }
  // DL Q-2 (a): only ready_to_serve reads "every counted line served" as not open (Round's allServed rule)
  if (row.kind === 'ready_to_serve' && allServed(body)) return NOT_OPEN;
  const preload: Preload = { order_view: body };
  if (body.order_type !== 'dine_in') return { kind: 'open', href: orderViewHref(order_id, focus), focus, preload };
  // a dine-in order placed onto a seating that was not open has no seating (02b §6.18a, tables/projection.ts): the
  // order is open, but it has no place on the map → not open (h4 review)
  const seating_id = body.seating_id;
  if (seating_id === null) return NOT_OPEN;
  const map = await mapOf(deps);
  if (!map.ok) return { kind: 'cannot_check', error: map.error };
  const t = primaryTileOf(map.map, seating_id);
  if (t === null) return NOT_OPEN;
  return { kind: 'open', href: tableHref(t.table_id, seating_id, focus), focus, preload };
}

async function checkZoneItem(zone_id: string, item_id: string, deps: CheckDeps): Promise<CheckResult> {
  // the same read #/zones makes (no zone_id): an archived zone is not listed (m3)
  const answer = await deps.orders.zoneStock();
  if (!answer.ok) return isApi(answer.error, 404, 'ZONE_NOT_FOUND') ? NOT_OPEN : { kind: 'cannot_check', error: answer.error };
  const zone = answer.data.find((z) => z.zone_id === zone_id);
  if (zone === undefined || !zone.items.some((i) => i.item_id === item_id)) return NOT_OPEN;
  const focus: StaffFocus = { kind: 'item', zone_id, item_id };
  return { kind: 'open', href: zonesHref(focus), focus, preload: { zone_stock: answer.data } };
}

async function checkTable(table_id: string, seating_id: string, deps: CheckDeps): Promise<CheckResult> {
  const map = await mapOf(deps);
  if (!map.ok) return { kind: 'cannot_check', error: map.error };
  const t = primaryTileOf(map.map, seating_id);
  if (t === null) return NOT_OPEN;
  const focus: StaffFocus = { kind: 'table' };
  return { kind: 'open', href: tableHref(t.table_id, seating_id, focus), focus };
}

/** §3.13.3: is the alert's place still open, and where is it. */
export async function checkTarget(row: CheckRow, deps: CheckDeps): Promise<CheckResult> {
  if (REQUEST_KINDS.has(row.kind) && row.state === 'closed') return { kind: 'request_closed' };
  const target = row.target;
  switch (target.type) {
    case 'order_line':
      return checkOrder(row, target.order_id, { kind: 'line', order_item_id: target.order_item_id }, deps);
    case 'order':
      return checkOrder(row, target.order_id, { kind: 'order', order_id: target.order_id }, deps);
    case 'zone_item':
      return checkZoneItem(target.zone_id, target.item_id, deps);
    case 'table':
      return checkTable(target.table_id, target.seating_id, deps);
  }
}
