import type { LineDetail } from '@pos/domain';
import type { KdsStationBody, StationPlanBody, WsKdsLines, WsServerMessage, WsStationNotice, WsStationTakeover } from '@pos/events';
import type { HubResult } from '../../api/hub-admin';

// 03b client contracts, KDS side (W0.5, 03b v1.0.8 §3.3, §6.1–§6.5, §6.14, §6.16; owner Q-49, Q-50, Q-55). Every lane
// (K, P, A) reaches the KDS through these names. Frame and body types are the hub's own (`@pos/events` ws.ts
// :122-166); command payloads and results mirror apps/hub/src/kds/commands/* exactly (docs/plans/03b-client-gaps.md
// §1). Lanes replace the stub bodies that implement these, never the names.

// ------------------------------------------------------------------------------------------------ frames / bodies

/** §6.14 catch-up part `kds_station`; also the takeover frame's `view` (§3.6). `lanes.lanes_on` null = custom. */
export type { KdsStationBody };
/** §6.16 line details for ids a commit gained (once per id per socket, again on a units change or a table move, Q-47). */
export type { WsKdsLines };
/** §3.6 takeover start (`active: true`, with `view`) / end (`active: false`), to the point's Pass tablets. */
export type { WsStationTakeover };
/** §3.10 `archived` (open_lines) / `output` (has_printer, 03c §3.8). */
export type { WsStationNotice };
/** 03a §6 catch-up part / frame `station_plan` (the Next column). */
export type { StationPlanBody };

/** A Now row of `kds_station` (stage, fired / started times, mark, `done_undone`). */
export type KdsNowLine = KdsStationBody['now'][number];

// ------------------------------------------------------------------------------------------------ commands

export interface ItemRef {
  order_item_id: string;
}

/** §6.2 DoneItem: `confirm: true` after `422 ITEM_DONE_CONFIRM_REQUIRED` (the inline "Done early?"). */
export interface DoneItemPayload extends ItemRef {
  confirm?: boolean;
}

export interface GiveMeMorePayload {
  station_id: string;
  /** 1…10, default 1 */
  n?: number;
}

export interface SetLaneStatePayload {
  station_id: string;
  /** 1…lane_count (AD-46: Lane Off sends lane_count − 1 / lanes_on − 1, Lane On lane_count) */
  lanes_on: number;
}

export interface SetLaneStateResult {
  lanes_on: number;
  lane_count: number;
  capacity: number;
}

/**
 * §6.1–§6.5 station commands (`run-pass`, station-scoped; `POST /commands/<kebab>`). The KDS sends them on its
 * station session (K1); the Pass sends the same commands on the staff session for screenless lines and takeover
 * rows (P3, P4), so one shape serves both transports. A batch line (one `load_id`) answers every member id.
 */
export interface KdsApi {
  startItem(p: ItemRef): Promise<HubResult<{ started: string[] }>>;
  doneItem(p: DoneItemPayload): Promise<HubResult<{ done: string[] }>>;
  undoDone(p: ItemRef): Promise<HubResult<{ undone: string[]; ready_undone: Array<{ order_id: string; point_id: string }> }>>;
  /** `pulled: null` → "Nothing to pull right now" */
  giveMeMore(p: GiveMeMorePayload): Promise<HubResult<{ pulled: string[] | null }>>;
  setLaneState(p: SetLaneStatePayload): Promise<HubResult<SetLaneStateResult>>;
}

// ------------------------------------------------------------------------------------------------ store

/**
 * What the KDS store holds for its station (03b §3.3). A `catch_up` replaces all of it (the hub sends one on every
 * (re)connect, so a reconnect needs no other refresh): `station` and `details` from the catch-up parts, and
 * `arrived_at` emptied — catch-up lines carry their own hub times. Frames after it update it in arrival order.
 */
export interface KdsSnapshot {
  /** the last `kds_station` body, kept current by frames; null before the first catch-up */
  station: KdsStationBody | null;
  /** line details by order_item_id (catch-up `details` + `kds_lines`); an id without details shows a placeholder */
  details: ReadonlyMap<string, LineDetail>;
  /** Q-55: hub-clock ms at frame receipt for a line that arrived live; cleared by the next catch-up */
  arrived_at: ReadonlyMap<string, number>;
}

/**
 * The KDS store (K1). `apply` takes every socket frame (catch-up replaces, `kds_lines` fills details, line events
 * move stages); an event whose `order_item_id` the store does not hold is ignored (Q-49, #76: the hub sends
 * kitchen-progress events wider than one station, 03b §6.17). `hold(ids)` answers which of `ids` it holds.
 */
export interface KdsStore {
  hold(ids: readonly string[]): string[];
  apply(frame: WsServerMessage): void;
  snapshot(): KdsSnapshot;
  subscribe(listener: () => void): () => void;
}
