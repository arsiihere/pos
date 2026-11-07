import { canonicalJson } from '@pos/domain/hash';
import type { EngineState } from '@pos/engine';
import type { BranchConfig, EngineConfig, EventDraft } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import type { HubDeps } from '../server.js';
import { onBranchConfigApplied } from '../sync/branch-config-holder.js';
import { setEngineConfigOf } from './fires-tick.js';
import { hostFlags } from './host-flags.js';
import type { WriterTx } from './writer.js';

// 03a §3.11 (01a carried row, S43): the config hook. On every applied snapshot it computes E(next), exactly the
// EngineConfigAppliedV1 fields, and appends one EngineConfigApplied in the apply's own transaction when
// canonicalJson(E(next)) ≠ canonicalJson(state.config). E() is pure and reads nothing: an unchanged engine part runs no
// statement, a changed one only its append's (test #70). The same E() is task 22's configStale source (boot step 6, the
// fires catch-up), wired here at the server build (boot step 5), so before step 6 reads it.

type ConfigStation = BranchConfig['stations'][number];
type EngineStation = EngineConfig['stations'][number];

// §3.11 reference_cook_ms: the median cook_time_ms over the station's active routed items, base items only, the lower
// median for an even count, 0 when none.
// proposed (implementer): "active (not archived)" is presence in the snapshot: 01a S22 / §6.1 test 4 send no archived
// item (and no item without a route here), so every listed item is active. "Base items only" = plain items
// (variant_group_id null, 01c V2); a variant is not counted. "From-stock times not counted": stock_time_ms is never read.
// Clamped at 0, so a negative time (the snapshot's plain ints; the write routes refuse one) never fails the strict
// payload and the apply (S43).
function referenceCookMs(snapshot: BranchConfig, station_id: string): number {
  const times = snapshot.items
    .filter((i) => i.station_id === station_id && i.variant_group_id === null)
    .map((i) => i.cook_time_ms)
    .sort((a, b) => a - b);
  if (times.length === 0) return 0;
  return Math.max(0, times[Math.floor((times.length - 1) / 2)]!);
}

function engineStation(s: ConfigStation, snapshot: BranchConfig): EngineStation {
  return {
    station_id: s.station_id,
    name: s.name,
    station_type: s.station_type,
    capacity: s.capacity,
    freshness_window_ms: s.freshness_window_ms,
    completion_mode: s.completion_mode,
    policy: s.policy,
    freeze_ms: s.freeze_ms,
    min_slack_keep_ms: s.min_slack_keep_ms,
    promise_padding_ms: s.promise_padding_ms,
    pressure_window_ms: s.pressure_window_ms,
    pressure_amber_bp: s.pressure_amber_bp,
    pressure_red_bp: s.pressure_red_bp,
    pressure_alert_ms: s.pressure_alert_ms,
    pause_enabled: s.pause_enabled,
    lane_units: s.lane_units,
    reserve_units: s.reserve_units,
    point_id: s.point_id,
    alternates: s.alternates.map((a) => ({ station_id: a.station_id, order_types: [...a.order_types], home_for_order_types: [...a.home_for_order_types] })),
    carry_times: s.carry_times.map((c) => ({ point_id: c.point_id, carry_ms: c.carry_ms })),
    programs: s.programs.map((p) => ({ program_id: p.program_id, name: p.name, cook_time_ms: p.cook_time_ms, is_archived: p.is_archived })),
    reference_cook_ms: referenceCookMs(snapshot, s.station_id),
    is_archived: s.is_archived,
  };
}

// §3.11 E(next). Every station, archived ones included (P-8: every station is in the log), sorted by station_id in
// code-unit order (the payload's own check). proposed (implementer): a repeated station_id (never sent: it is the
// cloud's key) keeps its first row, so the strictly sorted payload cannot fail the apply (S43).
export function engineConfigOf(snapshot: BranchConfig): EngineConfig {
  const seen = new Set<string>();
  const stations: EngineStation[] = [];
  for (const s of snapshot.stations) {
    if (seen.has(s.station_id)) continue;
    seen.add(s.station_id);
    stations.push(engineStation(s, snapshot));
  }
  stations.sort((a, b) => (a.station_id < b.station_id ? -1 : a.station_id > b.station_id ? 1 : 0));
  const e = snapshot.engine_settings;
  return {
    config_version: snapshot.config_version,
    stations,
    settings: {
      weight_dine_in_pct: e.weight_dine_in_pct,
      weight_takeaway_pct: e.weight_takeaway_pct,
      weight_delivery_pct: e.weight_delivery_pct,
      weight_parking_pct: e.weight_parking_pct,
      weight_follow_up_pct: e.weight_follow_up_pct,
      promise_padding_dine_in_ms: e.promise_padding_dine_in_ms,
      promise_padding_takeaway_ms: e.promise_padding_takeaway_ms,
      promise_padding_delivery_ms: e.promise_padding_delivery_ms,
      promise_padding_parking_ms: e.promise_padding_parking_ms,
      slip_threshold_ms: e.slip_threshold_ms,
      slip_escalate_ms: e.slip_escalate_ms,
      cascade_step_ms: e.cascade_step_ms,
      min_gain_ms: e.min_gain_ms,
      returns_boost: e.returns_boost,
      order_abandon_ms: e.order_abandon_ms,
    },
  };
}

// 01a §2: a hub with no engine steps holds {}.
const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).lines === 'object';

// The onBranchConfigApplied body (inside the applying writer.run, before COMMIT). Never throws on a valid config (S43).
// proposed (implementer): the comparison is the spec's own, canonicalJson of the whole E(next), config_version included,
// so a new config_version alone (a price change at the next version) writes one EngineConfigApplied; at an equal
// config_version a non-engine change writes none.
export function engineConfigHook(_prev: BranchConfig | null, next: BranchConfig, tx: WriterTx): void {
  const state = tx.state;
  if (!isEngineState(state)) return;
  const e = engineConfigOf(next);
  // §3.11 "every hook run also re-evaluates" configStale: after this commit state.config is E(next) (appended now or
  // already equal) and branchConfig() is next, so it is false. A rolled-back apply leaves it as it was.
  tx.onCommit(() => {
    hostFlags.configStale = false;
  });
  if (canonicalJson(e) === canonicalJson(state.config ?? null)) return;
  const draft: EventDraft = {
    stream_type: 'station',
    stream_id: tx.branchId,
    event_type: 'EngineConfigApplied',
    schema_version: 1,
    payload: e as unknown as Record<string, unknown>,
    occurred_at: tx.clock.branchNow(),
    actor_id: null,
    device_id: 'hub',
  };
  tx.append([draft]);
}

// registerEngineHost (P-6), at the server build (boot step 5): E() for configStale, and the hook for this hub's
// connection only (the hook list is process-wide; every server build registers, and a close unsubscribes).
export function registerConfigHook(app: FastifyInstance, deps: Pick<HubDeps, 'db'>): void {
  setEngineConfigOf(engineConfigOf);
  const off = onBranchConfigApplied((prev, next, tx) => {
    if (tx.db === deps.db) engineConfigHook(prev, next, tx);
  });
  app.addHook('onClose', async () => {
    off();
  });
}
