import type { Identifier, LineDetail } from '@pos/domain';
import type { KdsStationBody, WsPointLines, WsServerMessage, WsStationNotice, WsStationTakeover } from '@pos/events';
import type { HubResult } from '../../api/hub-admin';

// 03b client contracts, Pass side (W0.5, 03b v1.0.8 §3.4–§3.6, §6.6–§6.8, §6.11, §6.15, §6.16; owner Q-45, Q-46,
// Q-49, Q-55). The `point_view` body mirrors apps/hub/src/ws/point-catch-up.ts PointViewBody / PointLine (:37-43);
// HK2 (module-03b-hub-gaps) adds `stations[].screenless`, lines' `group_id` / `serve_mode`, which stay optional
// here: a client switches on the field being there, never on a flag (plan "Hub gaps"). Command payloads and results
// mirror apps/hub/src/kds/commands/{ready,handover}.ts, queries apps/hub/src/queries/{pass-receivers,order-tickets}.ts.
// The Pass's Start / Done / Undo / Give me more / Lane (screenless lines, takeover rows) use `KdsApi`
// (features/kds/contracts.ts) on the staff session.

// ------------------------------------------------------------------------------------------------ bodies / frames

/** HK2, Q-46: a line's serve group and mode (a return / released line is `immediate`); absent before HK2. */
export interface ServeFields {
  group_id?: string;
  serve_mode?: 'sync' | 'immediate';
}

/** §6.15 a Pass line: the details plus its live stage and whether it was handed over. */
export type PointLine = LineDetail & ServeFields & { stage: 'added' | 'cooking' | 'done'; handed_over: boolean };

export interface PointStation {
  station_id: string;
  name: string;
  lanes: KdsStationBody['lanes'];
  dark: boolean;
  /** HK2, Q-45: no kitchen screen (the Pass shows "No screen" and Start / Done); absent before HK2 */
  screenless?: boolean;
}

export interface PointOrder {
  order_id: string;
  identifier: Identifier;
  placed_at: number;
  lines: PointLine[];
  /** `by` = staff id (names from `staff-roster`, Q-55) */
  ready: { at: number; by: string | null } | null;
}

/** §6.15 catch-up part `point_view` (orders oldest first; `takeovers` = the bodies of this point's dark stations). */
export interface PointViewBody {
  point_id: string;
  stations: PointStation[];
  orders: PointOrder[];
  takeovers: KdsStationBody[];
}

/**
 * §6.16 `point_lines`, built on `@pos/events` `WsPointLines` (what `apply(frame: WsServerMessage)` narrows to): the
 * serve fields stay optional, as HK2 adds them (required on the hub once merged). P1 reads `point_lines` through it.
 */
export type PointLinesFrame = Omit<WsPointLines, 'lines'> & { lines: Array<WsPointLines['lines'][number] & ServeFields> };

export type { WsStationNotice, WsStationTakeover };

// ------------------------------------------------------------------------------------------------ commands / queries

export interface OrderAtPoint {
  order_id: string;
  point_id: string;
}

export interface HandoverPayload extends OrderAtPoint {
  receiver_staff_id: string;
  /** default: every done line of the order at this point */
  order_item_ids?: string[];
}

export interface HandoverResult {
  handover_id: string;
  served_card_alert_id: string;
  /** > 0 → "{n} handed to {name} · {k} left" and the card stays (§3.5 B4-2) */
  remaining: number;
}

/** `GET /queries/pass-receivers?order_id` (table team first). */
export interface PassReceiver {
  staff_id: string;
  name: string;
  table_team: boolean;
}

/** `GET /queries/order-tickets?order_id` (03c §6.8; `reprint-ticket` only). */
export interface OrderTicket {
  ticket_id: string;
  station_id: string;
  station_name: string;
  fired_at: number;
  printed: boolean;
  has_printer: boolean;
}

/** §6.6–§6.8, §6.11 (`run-pass`; a station session is refused). */
export interface PassApi {
  /** `already: true` → the order was Ready already (the existing state is shown) */
  markReadyToServe(p: OrderAtPoint): Promise<HubResult<{ alert_id: string; already?: true }>>;
  /** after the 30 s window `409 PASS_UNDO_WINDOW_CLOSED` */
  undoReadyToServe(p: OrderAtPoint): Promise<HubResult<{ alert_id: string }>>;
  handover(p: HandoverPayload): Promise<HubResult<HandoverResult>>;
  passReceivers(order_id: string): Promise<HubResult<{ receivers: PassReceiver[] }>>;
  orderTickets(order_id: string): Promise<HubResult<{ tickets: OrderTicket[] }>>;
}

// ------------------------------------------------------------------------------------------------ store

/**
 * What the Pass store holds for its point (03b §3.4, §3.6). A `catch_up` replaces all of it (sent on every
 * (re)connect, so a reconnect needs no other refresh): `view` and `takeovers` from the catch-up, `seen_at` emptied —
 * catch-up orders carry the hub's `placed_at` and `ready.at`. Frames after it update it in arrival order.
 */
export interface PassSnapshot {
  /** the last `point_view`, kept current by frames; null before the first catch-up */
  view: PointViewBody | null;
  /** live takeover bodies by station_id (§3.6 `station_takeover`), with their `has_printer` kept by `station_notice` */
  takeovers: ReadonlyMap<string, KdsStationBody>;
  /** Q-55: hub-clock ms at frame receipt (a live Ready's time, a live order's placed time); cleared by the next catch-up */
  seen_at: ReadonlyMap<string, number>;
}

/**
 * The Pass store (P1): as `KdsStore` (features/kds/contracts.ts). An event for an `order_item_id` the store does not
 * hold (another point's line) is ignored (Q-49, #76).
 */
export interface PassStore {
  hold(ids: readonly string[]): string[];
  apply(frame: WsServerMessage): void;
  snapshot(): PassSnapshot;
  subscribe(listener: () => void): () => void;
}
