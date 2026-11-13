import type { TableState } from '@pos/domain';
import type { HubError, HubResult } from '../../../api/hub-admin';
import type { CommandOptions } from '../api';

// 02a client contracts (W0.4, owner Q-3): the types every 02a lane and 02b reach 02a through. Shapes mirror the hub
// exactly (apps/hub/src/tables/queries.ts MapTile / TableMapBody :23-44, HandoverCandidate :200-206; command
// payloads and results apps/hub/src/tables/commands/*, docs/plans/02-client-gaps.md §1). Lanes replace the stub
// bodies that implement these, never the names.

// ------------------------------------------------------------------------------------------------ queries

export interface MapPerson {
  staff_id: string;
  name: string | null;
}

/** 02a §6.17 tile (`queries.ts` MapTile). */
export interface MapTile {
  table_id: string;
  name: string;
  seats: number | null;
  archived: boolean;
  state: TableState;
  seating_id: string | null;
  party_size: number | null;
  primary_table_id: string | null;
  joined_table_names: string[];
  holder: MapPerson | null;
  assignee: MapPerson | null;
  lock: (MapPerson & { mine: boolean }) | null;
  opened_at: number | null;
  bill_requested_at: number | null;
  live_order_count: number;
}

export interface MapZone {
  zone_id: string | null;
  name: string | null;
  tables: MapTile[];
}

export interface MapFloor {
  floor_id: string;
  name: string | null;
  archived: boolean;
  zones: MapZone[];
}

/** 02a §6.17 body; also the `catch_up.state.tables` part (at the socket's as_of_seq). */
export interface TableMapBody {
  as_of_seq: number;
  floors: MapFloor[];
}

/** 02a §6.18 row (`queries.ts` HandoverCandidate): holder and caller excluded, working first. */
export interface HandoverCandidate {
  staff_id: string;
  name: string;
  is_assignee: boolean;
  working: boolean;
  tables_held: number;
}

export interface HandoverCandidatesBody {
  staff: HandoverCandidate[];
}

// ----------------------------------------------------------------------------------------------- commands

/** Every 02a command carries the seating the screen showed (T18 → 409 TABLE_SEATING_CHANGED). */
export interface SeatingRef {
  table_id: string;
  seating_id: string;
}

export interface OpenTablePayload {
  table_id: string;
  seating_id?: string;
  party_size?: number;
}
export interface OpenTableResult {
  seating_id: string;
  primary_table_id: string;
  opened: boolean;
  holder_staff_id: string;
}
export interface ForceReleasePayload extends SeatingRef {
  /** Q-18: `<token>` or `<token>: <note>`, 1–120 characters. */
  reason: string;
}
export interface ForceMovePayload extends SeatingRef {
  to_staff_id: string;
  reason: string;
}
export interface HandoverPayload extends SeatingRef {
  to_staff_id: string;
  note?: string;
}
export interface MoveTablePayload {
  from_table_id: string;
  seating_id: string;
  to_table_id: string;
  reason?: string;
}
export interface MergeTablesPayload {
  into_table_id: string;
  into_seating_id: string;
  table_id: string;
  /** the absorbed party's seating, or null for a free table */
  table_seating_id: string | null;
}
export interface SplitSeatingPayload {
  from_table_id: string;
  seating_id: string;
  to_table_id: string;
  order_ids: string[];
}
export type CallWaiterChip = 'water' | 'clear' | 'come' | 'other';
export interface CallWaiterPayload extends SeatingRef {
  chip?: CallWaiterChip;
}
export type CallWaiterResult = { alert_id: string; repeated: true } | { alert_id: string; repeated: false; recipients: number };

/** 02a §6.1–§6.14: the 13 commands and the two queries (`api.ts` createTablesApi). */
export interface TablesApi {
  openTable(p: OpenTablePayload): Promise<HubResult<OpenTableResult>>;
  touchTableLock(p: SeatingRef): Promise<HubResult<{ touched: boolean }>>;
  releaseTableLock(p: SeatingRef): Promise<HubResult<{ released: boolean }>>;
  forceReleaseTableLock(p: ForceReleasePayload): Promise<HubResult<{ released: boolean }>>;
  takeOverTable(p: SeatingRef): Promise<HubResult<{ changed: boolean }>>;
  forceMoveTable(p: ForceMovePayload): Promise<HubResult<{ changed: boolean }>>;
  requestTableHandover(p: HandoverPayload): Promise<HubResult<{ alert_id: string }>>;
  moveTable(p: MoveTablePayload): Promise<HubResult<{ primary_table_id: string }>>;
  mergeTables(p: MergeTablesPayload): Promise<HubResult<{ seating_id: string; table_ids: string[] }>>;
  splitSeating(p: SplitSeatingPayload): Promise<HubResult<{ new_seating_id: string | null }>>;
  /** queueable: a queued replay passes the entry's `commandId` / `queuedAt` (and its person), never a new id */
  requestBill(p: SeatingRef, opts?: CommandOptions): Promise<HubResult<{ requested: boolean }>>;
  /** queueable, as requestBill */
  cleanTable(p: SeatingRef, opts?: CommandOptions): Promise<HubResult<{ reason: 'cleaned' | 'left_without_order' }>>;
  callWaiter(p: CallWaiterPayload): Promise<HubResult<CallWaiterResult>>;
  tableMap(floor_id?: string): Promise<HubResult<TableMapBody>>;
  handoverCandidates(table_id: string): Promise<HubResult<HandoverCandidatesBody>>;
}

// ---------------------------------------------------------------------------------------- map store (21a)

/** 21a: the map from catch-up + frame-driven `table-map` reads (Q-5, Q-35); no timer. */
export interface MapStore {
  /** the last map, or null before catch-up / the first read */
  current(): TableMapBody | null;
  tile(table_id: string): MapTile | null;
  /** one debounced `table-map` read */
  refresh(): void;
  subscribe(listener: () => void): () => void;
}

// ------------------------------------------------------------------------------------- command queue (25b)

/** 02b §3.12: the only queueable commands (00 v1.8 H-1); anything else answers `needs_hub` offline. */
export type QueueableCommand = 'RequestBill' | 'CleanTable' | 'SubmitOrder' | 'MarkServed';

export interface EnqueueMeta {
  table_id?: string;
  seating_id?: string;
  /** what the queue log shows ("Ask for bill · F4"); ids and counts only in logs */
  label: string;
}

/**
 * Q-3 / 02b §3.12 (integrator ruling, review #133):
 * - `sent`: a 2xx (never before it, #35).
 * - `refused`: the hub's definitive 4xx answer to a direct online send; the caller shows it (toast). Never a 5xx,
 *   `426 CLIENT_UPGRADE_REQUIRED`, `403 DEVICE_REVOKED`, a network error, or a 2xx whose body was lost or cut off.
 * - `queued`: those non-answers for a queueable command while a queue is registered: the entry stays (removed only
 *   on a 2xx or a 4xx, §3.12) and is sent again with the same command_id.
 * - `needs_hub`: the same non-answers with no queue registered (the W0.6 stub until 25b; 02a Ask for bill / Clean
 *   show "Needs the hub").
 * - `logged: true` on `queued` (integrator ruling IR-12, additive): the entry went straight to the queue log (its
 *   session ended, or a 4xx the log keeps): it waits for "Send again", never for the hub — the caller shows the
 *   queue-log wording, not "Will be sent when the hub is back".
 */
export type EnqueueResult<R = unknown> =
  | { status: 'sent'; result: R }
  | { status: 'queued'; entry_id: string; logged?: true }
  | { status: 'needs_hub' }
  | { status: 'refused'; error: Extract<HubError, { kind: 'api' }> };

/**
 * Q-3: the one queue interface 02a and 02b send queueable commands through. W0.6 ships a stub that answers
 * `needs_hub`; 25b implements it (stored before the first send, replay in queued_at order with X-Queued-At and the
 * same command_id).
 */
export interface Enqueue {
  <R = unknown>(type: QueueableCommand, payload: unknown, meta: EnqueueMeta): Promise<EnqueueResult<R>>;
  /** entries waiting for this table ("Waiting to send" on the tile, Q-17) */
  pendingFor(table_id: string): number;
  /** every entry waiting to send (the offline bar) */
  pendingCount(): number;
  subscribe(listener: () => void): () => void;
}

// ---------------------------------------------------------------------------------------- table lock (23a)

/** 02a §8 Banners (02a-B10): which banner the order screen shows. Names come from the roster / the frame. */
export type LockBannerState =
  | { kind: 'released_by'; table: string; by_name: string | null; reason: string | null }
  | { kind: 'released_ttl'; table: string; minutes: number }
  | { kind: 'other_device'; table: string }
  | { kind: 'holder_changed'; table: string; holder_name: string | null; can_send: boolean }
  | { kind: 'force_moved_to_me'; table: string };

/**
 * 02a §8 Order screen (D61): Touch once a minute while mounted, Release on unmount, both dropped offline; lock
 * frames → banner. `canSend` false after the holder changed away from me, unless take-order-anywhere.
 */
export type UseTableLock = (ref: SeatingRef | null) => {
  banner: LockBannerState | null;
  canSend: boolean;
  release(): Promise<void>;
};

export interface LockBannerProps {
  state: LockBannerState | null;
  /** "Keep as draft": the draft stays on the device, the screen goes back */
  onKeepDraft(): void;
}

// --------------------------------------------------------------------------- 02a → 02b slot (table sheet)

/** 22a mounts 02b's orders part inside the table sheet (27a3). */
export interface OrdersPartProps {
  seating_id: string;
  table_ids: string[];
  primary_table_id: string;
  holder_staff_id: string;
  /** I hold the seating */
  mine: boolean;
}

// ------------------------------------------------------------------------------------ device-local flags

/** Q-16: "Call sent · n min" lives on the calling device only, in memory (lost on reload). */
export interface LocalFlags {
  /** hub-clock ms of the last call sent from this device for the table */
  callSentAt(table_id: string): number | null;
  markCallSent(table_id: string, at_ms: number): void;
  clearCallSent(table_id: string): void;
  subscribe(listener: () => void): () => void;
}
