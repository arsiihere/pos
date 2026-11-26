import type { Unit } from '@pos/domain';
import type { EngineConfig } from '@pos/events';

// 01a S14: all quantities are integers in `unit` (the stock item's stock unit, S44; 01c V5).
export interface StockEntry {
  on_hand: number;
  reserved: number;
  set_at: number | null;
  unit: Unit;
}

// 01c V20: an item's sale unit and draws, frozen for the open day.
export interface DayDraws {
  sale_unit: Unit;
  stock_draws: Array<{ stock_item_id: string; quantity_per_sale_unit: number }>;
}

// 01a S33: opened by BusinessDayOpened, closed by BusinessDayClosed.
// 01c §3.5.3: stock_units by stock_item_id, draws by item_id, frozen at the open.
export interface BusinessDay {
  business_date: string;
  opened_at: number;
  closed_at: number | null;
  stock_units: Record<string, Unit>;
  draws: Record<string, DayDraws>;
}

// 03a §3.3: integer ms; an Interval is [start, end).
export type Interval = { start: number; end: number };

// AD-6 (developer ruling 2026-11-05; supersedes the §6.1a `report` callback): a breach a non-strict fold
// clamped instead of throwing. The host logs it at warn after commit and clears the list; it is not part of
// snapshots / checkpoints nor of the ENGINE_STATE_VERSION key set.
// AD-4 (ruling 2026-11-05): 'over_capacity' is a warning, not a breach: a line whose units exceed the
// station's effective capacity, appended by the placing fold in strict and non-strict mode alike, with
// order_item_id, station_id and detail { units, capacity }. 'invalid_event' (AD-6, task 6 ruling): a writer
// bug a non-strict order fold skipped, detail { event_type, order_id, order_item_id, reason }. 'reserve_fallback'
// (task 11 review): a new line no allowed station could take (§3.5.5 reserve leaves it < 1 unit everywhere) was
// booked on its own station at full effective capacity (D3: never refused); order_item_id, station_id, detail
// { capacity, reserve_units }.
export type Diagnostic = {
  kind: 'profile_underflow' | 'stock_breach' | 'over_capacity' | 'invalid_event' | 'reserve_fallback';
  event_id?: string;
  order_item_id?: string;
  station_id?: string;
  stock_item_id?: string;
  detail: Readonly<Record<string, number | string | null>>;
};

// 03a §3.3, D24: sorted boundaries t; u[i] = units in use from t[i] to t[i + 1]. Built by profile.ts (task 4).
export type Profile = { t: number[]; u: number[] };

type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'parking';

// 03a §3.8 (v0.4, G2 #4).
export interface SlipRecord {
  order_ids: string[];
  last_estimate: number; // from the last SlipWarned
  alert_id: string | null; // from SlipWarned.alert_id; null after its AlertClosed is folded
  resolved_at: number | null; // recorded_at of the fold that resolved every group of the key
}

// 03a §3.3 batch load (F §4.7 BatchStationState semantics): an *unfired* load of a batch station. AD-5, confirmed
// with a change by task 13 (the v3 shape is unreleased):
//   - load_id: station_id + ':' + the earliest order_item_id at its forming; a name, not membership (v0.2.1): it
//     stays when that line is voided or removed before the fire; the fire fixes it in FireDispatched.load_id.
//   - program_id: the members' current program (BF-1 currentProgram); a load never mixes programs (D49).
//   - order_item_ids: the members, sorted; every member is an unfired 'added' line whose load_id is this id.
//   - fire_ms: the load's planned fire = booked.start − the largest member prep (prep is off-station, D35); every
//     member's fire_ms is this value.
//   - booked (AD-7 for loads, replaces fired_at): the exact booking of the load in the station profile — the whole
//     station (`capacity` units at forming; a load never overlaps another, F §4.7 step 3(b)) over the members'
//     cook. Members carry booked = null; the load is booked once and removed exactly once (AD-6 on the removal).
// A load leaves `loads` when it fires (FireDispatched; its lines then carry fired_at and load_id and pack as one
// unit, §3.3) or when its last member leaves, so a fired load is never a candidate for joiners (D34).
export interface Load {
  load_id: string;
  program_id: string;
  order_item_ids: string[];
  fire_ms: number;
  booked: { start: number; end: number; units: number };
}

// 03a §3.3.
export interface StationRuntime {
  station_id: string;
  type: 'slot' | 'batch';
  capacity: number;
  capacity_override: number | null; // effective = override ?? capacity (D37)
  paused: boolean; // D21
  profile: Profile;
  unfired: string[]; // OrderItemIds sorted by (fire, order_item_id)
  loads: Record<string, Load>; // batch only
}

// 03a §3.3 group (§3.2). ⚠️ 03a v1.2.10 §3.3, §3.5.7 PR-4 (STAB-7; v1.2.8 post-review B-2, M-10): v5 adds
// priority_land_ms (the group's priority land, §3.5.7 PR-4) and priority_delay_ms (delay(g, recorded_at) at its
// LinePrioritized fold); both null until the group is prioritised.
export interface EngineOrderGroup {
  target_land_ms: number;
  line_ids: string[];
  priority_land_ms: number | null;
  priority_delay_ms: number | null;
}

// 03a §3.3.
export interface EngineOrder {
  order_id: string;
  order_type: OrderType;
  table_key: string;
  table_id: string | null;
  follow_up: boolean;
  pickup_at_ms: number | null;
  placed_at: number;
  placed_by: string | null;
  target_land_ms: number; // copied from OrderPlaced (§3.5.1)
  promise_ms: number;
  boosted: boolean;
  line_ids: string[];
  awaiting: number; // lines listed but not yet seen
  last_served_at: number | null; // min(served_at, recorded_at) of the ItemServed that left no line open (⚠️ Changed by Q-6, owner ruling 2026-11-09: was its recorded_at)
  last_line_fold_at: number; // recorded_at of the latest fold that names the order or one of its lines
  next_group_index: number; // group ids are order_id + ':' + index
  groups: Record<string, EngineOrderGroup>;
}

// 03a §3.3.
export interface EngineLine {
  order_item_id: string;
  order_id: string;
  group_id: string;
  serve_mode: 'sync' | 'immediate';
  station_id: string;
  alternates: Array<{ station_id: string; carry_ms: number; home: boolean }>;
  point_id: string | null;
  carry_ms: number;
  units: number;
  prep_ms: number;
  cook_ms: number;
  full_cook_ms: number;
  from_stock: boolean;
  program_id: string | null;
  stock_cook_ms: number | null; // the ItemAdded copy of the stock cook time, null when none
  stock_program_id: string | null; // ItemAdded.stock_program_id (D25 copy); batch only
  draws: Array<{ stock_item_id: string; quantity: number; reserved: number }>; // ItemAdded.stock_draws as copied
  reserved_seq: number | null; // seq of the line's latest StockReserved; null only when every draws[].reserved is 0
  weight_pct: number;
  max_early_ms: number;
  max_late_ms: number | null;
  max_carry_ms: number | null;
  stage: 'added' | 'cooking' | 'done' | 'served' | 'removed' | 'voided' | 'returned';
  fire_ms: number | null; // planned fire
  deadline_ms: number; // latest fire
  fired_at: number | null;
  started_at: number | null;
  done_at: number | null;
  mark: null | 'expedite' | 'boost' | 'pulled' | 'return' | 'moved';
  return_of: { order_item_id: string; mode: 'fix' | 'remake' } | null; // D28
  load_id: string | null;
  // AD-7 (controller ruling 2026-11-05): the exact booking in the station profile (after occupancy(), AD-4),
  // set at every addInterval of the line; a removal removes exactly this and clears it, never recomputed.
  booked: { start: number; end: number; units: number } | null;
  // §3.5.6 / AD-15 (controller ruling 2026-11-06): the overload search left the line at its max_late_ms cap or
  // placed it after the others. Recomputed at every re-placement (false outside the search); §3.10 reads it on
  // unfired lines only (getAlertIntents overload[].capped, task 15). Leftovers include uncapped lines when the
  // 16-probe budget runs out (AD-15 Q4a), so capped = true does not imply max_late_ms ≠ null.
  capped: boolean;
  // §3.5.5 (task 11 review): the routed station (ItemAdded.station_id, the D25 home route, §4.2), never filtered by
  // max_carry_ms; kept because station_id / alternates change when the line moves (route.ts R1).
  routed_station_id: string;
  // §3.5.2, AD-29 Q11 P9: an ItemsReleased expedite. `mark` changes as §3.4 says (the screen shows why the line moved), so
  // the follow-up weight reads this and never the mark. Never cleared.
  expedited: boolean;
  // AD-4, AD-29 Q11 P4: a fired member's load rounds, from the load's stored booking at the fire (null for a line fired
  // with no load, and before the fire, when the load's `booked` holds them). profile.ts occupiedCook reads it.
  rounds: number | null;
  // 03a v1.2.2 (owner 2026-11-11, B2-2): false at ItemAdded, set by ItemDoneUndone's fold, cleared by nothing. The
  // auto_done inference (tick.ts doneDue) skips a flagged line: after an Undo Done it waits for a tapped Done.
  done_undone: boolean;
  // ⚠️ 03a v1.2.10 §3.3, §3.5.7 PR-1, PR-4, §3.3 BQ-1 (STAB-6, STAB-7; v5): the ItemAdded.max_delay_ms copy (D25; absent
  // = null = no limit, MAX_DELAY_NO_LIMIT_MS applies); priority_at = the recorded_at of the LinePrioritized fold that
  // made the line priority (set once, never cleared); arrived_at = the recorded_at of the OrderPlaced / OrderLinesAdded
  // that listed the line (the BQ-1 arrival key, review M-3).
  max_delay_ms: number | null;
  priority_at: number | null;
  arrived_at: number;
  // ⚠️ 03a v1.2.11 §3.3 "D7 Pass archive fold" (run 3 reconcile (a); 03b v1.0.16 §6.22): the source of the line's last
  // recorded PassPointLinesMoved (null until moved), kept for Pass catch-up ("Moved from <point>"). v6 (unreleased).
  from_point_id: string | null;
  from_point_name: string | null;
}

// 03a §3.3: EngineState v5 (ENGINE_STATE_VERSION = 5, D62; v1.2.2 B2-2: v4 adds EngineLine.done_undone; 03a v1.2.10
// STAB-6/7: v5 adds the line and group priority fields and priority_due).
export interface EngineState {
  stock: Record<string, StockEntry>; // unchanged (01a S14, 01c V5)
  business_day: BusinessDay | null; // unchanged (01a S33, 01c §3.5.3)
  config: EngineConfig | null; // last EngineConfigApplied (§3.11)
  stations: Record<string, StationRuntime>;
  orders: Record<string, EngineOrder>;
  lines: Record<string, EngineLine>;
  slips: Record<string, SlipRecord>; // by table_key (§3.8)
  next_alert_due_at: number | null; // minimum of slip_due (§3.8)
  slip_due: Record<string, number>; // per table_key crossing / close time
  priority_due: Record<string, number>; // ⚠️ 03a v1.2.10 §3.5.7 PR-3 (B-1, R-3): per group_id level crossing
  diagnostics: Diagnostic[]; // AD-6: host scratch, outside the v3 key set
}

export function initialEngineState(): EngineState {
  return {
    stock: {},
    business_day: null,
    config: null,
    stations: {},
    orders: {},
    lines: {},
    slips: {},
    next_alert_due_at: null,
    slip_due: {},
    priority_due: {},
    diagnostics: [],
  };
}
