import { getAlertIntents, nextAlertDueAt, pressureBand, type AlertIntents, type Diagnostic, type EngineState } from '@pos/engine';
import type { EventDraft, PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import { kindOf } from '../alerts/kinds.js';
import { alertDirectoryOf, alerts, type CloseItem, type RaiseInput } from '../alerts/raise.js';
import type { TickDef } from '../alerts/tick.js';
import { hostFlags, type DroppedLine } from './host-flags.js';
import { ENGINE_ALERT_KINDS, readLineFacts, slipDetails } from './kinds.js';
import { rawDbOf, readOnlyDb } from './read-only-tx.js';
import type { Writer } from './writer.js';
import type { WarnLog } from './reducer.js';

// 03a §6.2a: the `fires_alerts` tick, registered right after `fires` (registerEngineBootSteps).
// - due(db, state, now): in memory, no statement (01d idle rule): `now ≥ nextAlertDueAt(state, skipped)` (§3.8), or the
//   overload check finds a change against `overload_open` (§3.10), or the flags `day_closed` / `reconcile`, or a queued
//   dropped-line fact (AD-8). A raised slip or overload that persists unchanged is never due again.
// - intents(tx, state, now), inside the tick's own transaction:
//   1. listOpen slip_warning and station_overload: 2 statements; the second refreshes overload_open.
//   2. slips of getAlertIntents (minus `skipped`) → raise inputs; receiver per §3.8; unresolvable / schema-failing
//      inputs are skipped, logged once per key and added to `skipped`.
//   3. overload raise / close items (red_since, P-7).
//   4. closes: resolved slips `done` by their alert_id; with day_closed every open slip_warning `obsolete`.
//   5. one closeMany, then one raiseMany; one SlipWarned per raised slip from the returned alert_id, none when deduped.
//   6. the drafts: this tick's own transaction (a throw rolls back only this tick, 01d isolation).
// Statements with work: 2 + 0 (tableOwners is stubbed by placed_by, §4.4) + ≤ 1 (the slips' ItemAdded facts for their
// details, kinds.ts readLineFacts; only in a pass with a slip to raise) + closeMany's 1 + raiseMany's ≤ 6 + R + T, plus
// the appends. proposed (implementer): §6.2a / §10.5 state "2 + ≤ 1 + 01d bounds"; the §3.8 details (line name and
// quantity) are not in the engine state, so they cost this one extra read, whatever the number of slips.

// The kinds this tick raises, registered in kinds.ts (task 23, §6.4); re-exported for the tick's callers.
export { ENGINE_ALERT_KINDS };

interface AlertsHost {
  log?: WarnLog;
}

// Per hub, keyed by its connection (due gets the read-only view; rawDbOf maps it back).
const hosts = new WeakMap<Database.Database, AlertsHost>();

// registerEngineHost (P-6): binds this hub to the tick. The tick's host memory starts empty (as at a restart, P-7).
export function bindFiresAlertsTick(deps: { db: Database.Database }, log?: WarnLog): void {
  hosts.set(deps.db, { log });
  hostFlags.skipped = new Set();
  hostFlags.red_since = new Map();
  hostFlags.overload_open = new Set();
  hostFlags.overload_skipped = new Set();
  hostFlags.dropped_lines = [];
}

// 01a §2: a hub with no engine steps holds {}.
const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).lines === 'object';

// ------------------------------------------------------------------------------------------ after commit (0 statements)

/**
 * The writer's after-commit hook, run BEFORE afterEngineCommit logs and clears the diagnostics (index.ts). In memory:
 * - AD-8: each `invalid_event` diagnostic that dropped a line is queued for the next pass (the due sees the queue).
 *   proposed (implementer): "dropped a line" = an ItemAdded whose listed line the fold dropped (reason other than
 *   line_not_listed, and the line is gone from the fold's result), or a refused OrderPlaced / OrderLinesAdded (the whole
 *   batch is refused, so every line it listed is lost; AD-29 Q5's reused id is one such), or an ItemAdded refused for
 *   stream_id_mismatch (droppedLineOf). Other invalid_event folds change nothing and drop no line. The queue lives in memory; a restart before the next pass re-queues it from the replay (boot
 *   steps 3 and 6, review I1): the reconcile pass raises every drop of the replay window again — an open alert dedupes,
 *   one closed inside the window is raised again (noisy, never silent).
 * - §6.2a: a commit that contains BusinessDayClosed sets `day_closed`.
 * - §3.8: a key leaves `skipped` at the next commit that touches one of its orders.
 */
export function noteAlertFacts(state: unknown, appended: readonly PosEvent[]): void {
  if (!isEngineState(state)) return;
  for (const d of state.diagnostics) {
    const fact = droppedLineOf(d);
    if (fact !== null) hostFlags.dropped_lines.push(fact);
  }
  if (appended.some((e) => e.event_type === 'BusinessDayClosed')) hostFlags.day_closed = true;
  if (hostFlags.skipped.size > 0) {
    for (const e of appended) {
      if (e.stream_type !== 'order') continue;
      // AD-33 (M2): the tick's own event on a skipped key's order (none today) would also count, one extra retry.
      const key = state.orders[e.stream_id]?.table_key;
      if (key !== undefined) hostFlags.skipped.delete(key);
    }
  }
}

/**
 * AD-8: the dropped-line fact of one diagnostic, or null. Classified on event_type and reason alone (review 2), so the
 * after-commit hook and boot (a replayed drop, re-queued for the reconcile pass) agree whatever came later:
 * - a refused OrderPlaced / OrderLinesAdded (every line it listed is lost), `batch`;
 * - an ItemAdded with any reason but line_not_listed: the listed line was dropped (the catch that calls dropListed), or,
 *   for stream_id_mismatch (review M1), its placeholder stays and the order never plans. Noisy beats silent (AD-33).
 */
export function droppedLineOf(d: Diagnostic): DroppedLine | null {
  if (d.kind !== 'invalid_event') return null;
  const type = d.detail.event_type;
  const order_id = typeof d.detail.order_id === 'string' ? d.detail.order_id : null;
  const order_item_id = typeof d.detail.order_item_id === 'string' ? d.detail.order_item_id : null;
  const reason = String(d.detail.reason);
  if (type === 'OrderPlaced' || type === 'OrderLinesAdded') return { order_id, order_item_id, reason, batch: true };
  if (type !== 'ItemAdded' || reason === 'line_not_listed') return null;
  return { order_id, order_item_id, reason, batch: false };
}

/**
 * AD-8 / AD-33 (review 2): at SIGTERM, before the shutdown snapshot (which would move the replay past the drop), one
 * fires_alerts pass raises the queued dropped-line facts: 01d's tickPass body, `due` on the read-only view, then its own
 * writer.run. An empty queue: 0 statements. A throw is logged and never stops the snapshot or the stop.
 */
export function flushDroppedLines(deps: { db: Database.Database; writer: Writer; state: { get(): unknown }; clock: { branchNow(): number } }, log?: { error(obj: Record<string, unknown>, msg: string): void }): void {
  if (hostFlags.dropped_lines.length === 0 || !deps.db.open) return;
  try {
    const now = deps.clock.branchNow();
    if (!firesAlertsTick.due(readOnlyDb(deps.db), deps.state.get() as EngineState, now)) return;
    deps.writer.run((tx) => tx.append(firesAlertsTick.intents(tx, deps.state.get() as EngineState, now)));
  } catch (err) {
    log?.error({ tick: 'fires_alerts', err }, 'fires_alerts flush at SIGTERM failed');
  }
}

// ------------------------------------------------------------------------------------------------- overload (§3.10)

interface OverloadPlan {
  raise: AlertIntents['overload'];
  close: string[];
}

/**
 * §3.10 overload check, pure on the state plus the host's red_since (which it updates): per station its pressure band
 * and capped flag; a station red for pressure_alert_ms, or capped, and not open → raise; open and below amber → close.
 * proposed (implementer): a capped station below amber is not closed (it would be raised again at the next check, so
 * the pair would open a transaction every pass while it persists); it closes once it is neither capped nor amber+.
 */
// `items`: getAlertIntents(state, now).overload, computed once by the caller (review I3). An open station that is no
// longer in the state or the config is not red any more: it closes `done` (review M6).
function overloadPlan(state: EngineState, items: AlertIntents['overload'], now: number, open: ReadonlySet<string>, raisable: boolean): OverloadPlan {
  const plan: OverloadPlan = { raise: [], close: [] };
  const configs = state.config?.stations ?? [];
  const checked = new Set<string>();
  for (const item of items) {
    const cfg = configs.find((s) => s.station_id === item.station_id);
    if (cfg === undefined) continue;
    checked.add(item.station_id);
    const band = pressureBand(item.pressure_bp, cfg);
    if (band !== 'red') hostFlags.red_since.delete(item.station_id);
    else if (!hostFlags.red_since.has(item.station_id)) hostFlags.red_since.set(item.station_id, now);
    const since = hostFlags.red_since.get(item.station_id);
    const red = since !== undefined && now - since >= cfg.pressure_alert_ms;
    if (open.has(item.station_id)) {
      if (band === 'green' && !item.capped) plan.close.push(item.station_id);
    } else if ((red || item.capped) && raisable && !hostFlags.overload_skipped.has(item.station_id)) {
      // AD-33 (M4): a station in overload_skipped leaves it only at a restart.
      plan.raise.push(item);
    }
  }
  for (const station of open) {
    if (checked.has(station)) continue;
    hostFlags.red_since.delete(station);
    plan.close.push(station);
  }
  return plan;
}

// --------------------------------------------------------------------------------------------------------- the tick

type Skip = { kind: string; table_key?: string; station_id?: string; order_item_id?: string | null; reason: string };

// §3.8 receiver: dine_in → 02's tableOwners (stubbed until 02 lands: the order's placed_by, §4.4; no owner → placed_by,
// v0.6 G4-2 #17); takeaway / delivery / parking → placed_by. A group mixing types uses its oldest order's rule.
function receiverOf(state: EngineState, oldest: string): string | null {
  return state.orders[oldest]?.placed_by ?? null;
}

export const firesAlertsTick: TickDef = {
  name: 'fires_alerts',
  due(db, state, now) {
    if (!hosts.has(rawDbOf(db)) || !isEngineState(state)) return false;
    // §3.10: the check runs every pass so red_since follows the station, whatever else makes the pass due.
    const overload = overloadPlan(state, getAlertIntents(state, now).overload, now, hostFlags.overload_open, kindOf(ENGINE_ALERT_KINDS.overload) !== undefined);
    if (hostFlags.reconcile || hostFlags.day_closed || hostFlags.dropped_lines.length > 0) return true;
    if (overload.raise.length > 0 || overload.close.length > 0) return true;
    const at = nextAlertDueAt(state, hostFlags.skipped);
    return at !== null && now >= at;
  },
  intents(tx, state, now) {
    const host = hosts.get(tx.db);
    if (host === undefined || !isEngineState(state)) return [];
    const ctx = alerts.tickCtx(tx, now);
    const skips: Skip[] = [];

    // 1. The open alerts of both kinds: 2 statements.
    const openSlips = alerts.listOpen(tx.db, { kind: ENGINE_ALERT_KINDS.slip });
    const openOverloads = alerts.listOpen(tx.db, { kind: ENGINE_ALERT_KINDS.overload });
    const overloadAlert = new Map<string, string>();
    for (const a of openOverloads) {
      const station = (a.values as { station_id?: unknown }).station_id;
      if (typeof station === 'string') overloadAlert.set(station, a.alert_id);
    }
    const dayClosed = hostFlags.day_closed;
    const dropped = hostFlags.dropped_lines.slice();
    const intents = getAlertIntents(state, now);
    const inputs: RaiseInput[] = [];
    const meta: Array<{ slip?: AlertIntents['slips'][number]; station?: string }> = [];

    // 2. Slips (§3.8), with the defensive inputs rule.
    const directory = alertDirectoryOf(tx);
    const slipKind = kindOf(ENGINE_ALERT_KINDS.slip);
    const raisable: Array<{ slip: AlertIntents['slips'][number]; receiver: string; values: Record<string, unknown> }> = [];
    for (const slip of intents.slips) {
      if (hostFlags.skipped.has(slip.table_key)) continue;
      const receiver = receiverOf(state, slip.order_ids[0] as string);
      const values = { table_key: slip.table_key, order_ids: slip.order_ids, escalate_ms: state.config?.settings.slip_escalate_ms ?? 0 };
      let reason: string | null = null;
      if (slipKind === undefined) reason = 'kind_not_registered';
      else if (receiver === null) reason = 'no_receiver';
      else if (directory.get(receiver) === undefined) reason = 'receiver_not_in_directory';
      else if (!slipKind.values_schema.safeParse(values).success) reason = 'values_invalid';
      if (reason !== null || receiver === null) {
        skips.push({ kind: ENGINE_ALERT_KINDS.slip, table_key: slip.table_key, reason: reason ?? 'no_receiver' });
        continue;
      }
      raisable.push({ slip, receiver, values });
    }
    // §3.8 details: one read of the ItemAdded facts of every slip order of this pass (none when no slip is raisable).
    const facts = raisable.length > 0 && slipKind !== undefined ? readLineFacts(tx.db, state, raisable.flatMap((r) => r.slip.order_ids)) : new Map();
    for (const { slip, receiver, values } of raisable) {
      if (slipKind === undefined) break;
      const details = slipDetails(state, slip, facts);
      // proposed (implementer): details failing the kind's schema are skipped like values that fail it (§3.8).
      // Defensive, unreachable after review I3: minutes_late is a clamped int, quantity the engine units (≥ 1 on a filled
      // line), state a stage name, and an empty ItemAdded name falls back to the line id; only a line whose name and id
      // are both empty (which the schemas allow but no writer mints) would reach it.
      if (slipKind.details_schema === null || !slipKind.details_schema.safeParse(details).success) {
        skips.push({ kind: ENGINE_ALERT_KINDS.slip, table_key: slip.table_key, reason: 'details_invalid' });
        continue;
      }
      inputs.push({
        kind: slipKind.kind,
        subject: { stream_type: 'order', stream_id: slip.order_ids[0] as string }, // §3.8: the oldest order of the group
        target: { kind: 'person', staff_id: receiver },
        values,
        display: { kind_label_key: slipKind.labels.lock },
        details,
        dedupe_key: `slip:${slip.table_key}`,
        request: { receiver_staff_id: receiver },
      });
      meta.push({ slip });
    }

    // 3. Overload (§3.10), against the set just read.
    const overloadKind = kindOf(ENGINE_ALERT_KINDS.overload);
    const plan = overloadPlan(state, intents.overload, now, new Set(overloadAlert.keys()), overloadKind !== undefined);
    for (const item of plan.raise) {
      const values = { station_id: item.station_id, pressure_bp: item.pressure_bp, waiting: item.waiting };
      if (overloadKind === undefined || !overloadKind.values_schema.safeParse(values).success) {
        skips.push({ kind: ENGINE_ALERT_KINDS.overload, station_id: item.station_id, reason: 'values_invalid' });
        continue;
      }
      inputs.push({
        kind: overloadKind.kind,
        subject: { stream_type: 'station', stream_id: item.station_id },
        target: { kind: 'managers' },
        values,
        display: { kind_label_key: overloadKind.labels.lock },
        dedupe_key: `station_overload:${item.station_id}`,
      });
      meta.push({ station: item.station_id });
    }

    // AD-8: the queued dropped-line facts.
    const droppedKind = kindOf(ENGINE_ALERT_KINDS.lineDropped);
    for (const fact of dropped) {
      const input = droppedInput(fact, droppedKind);
      if (input === null) {
        const reason = droppedKind === undefined ? 'kind_not_registered' : fact.order_id === null || fact.order_item_id === null ? 'id_missing' : 'values_invalid';
        skips.push({ kind: ENGINE_ALERT_KINDS.lineDropped, order_item_id: fact.order_item_id, reason });
        continue;
      }
      inputs.push(input);
      meta.push({});
    }

    // 4. Closes: resolved slips done (state), overloads below amber done, with day_closed every open slip obsolete.
    const closes: CloseItem[] = [];
    const openSlipIds = new Set(openSlips.map((a) => a.alert_id));
    for (const r of intents.resolved) {
      if (hostFlags.skipped.has(r.table_key)) continue;
      if (openSlipIds.has(r.alert_id)) closes.push({ alert_id: r.alert_id, reason: 'done' });
      // proposed (implementer): an alert the state holds but that is no longer open (its AlertClosed never folded) would
      // keep the key due every pass; it is skipped like an input that cannot be raised.
      else skips.push({ kind: ENGINE_ALERT_KINDS.slip, table_key: r.table_key, reason: 'alert_not_open' });
    }
    const closedStations: string[] = [];
    for (const station of plan.close) {
      const alert_id = overloadAlert.get(station);
      if (alert_id === undefined) continue;
      closes.push({ alert_id, reason: 'done' });
      closedStations.push(station);
    }
    if (dayClosed) for (const a of openSlips) closes.push({ alert_id: a.alert_id, reason: 'obsolete', note: 'day_closed' });

    // 5. closeMany, then raiseMany (v0.6 G4-2 #19). proposed (implementer): when both run, the close drafts are appended
    // before raiseMany, so its dedupe read sees the old alert closed and a carried late order gets a new alert (#113);
    // the cost is that append's statements.
    const drafts: EventDraft[] = [];
    const closed = closes.length > 0 ? alerts.closeMany(ctx, closes) : [];
    if (closed.length > 0 && inputs.length > 0) tx.append(closed);
    else drafts.push(...closed);
    const results = inputs.length > 0 ? alerts.raiseMany(ctx, inputs) : [];
    const raisedStations: string[] = [];
    results.forEach((result, i) => {
      drafts.push(...result.events);
      const m = meta[i]!;
      if (m.station !== undefined) raisedStations.push(m.station);
      const slip = m.slip;
      if (slip === undefined) return;
      if (result.deduped) {
        // §3.8: no SlipWarned. proposed (implementer): the key would stay due every pass, so it joins `skipped`.
        skips.push({ kind: ENGINE_ALERT_KINDS.slip, table_key: slip.table_key, reason: 'deduped' });
        return;
      }
      drafts.push({
        stream_type: 'order',
        stream_id: slip.order_ids[0] as string,
        event_type: 'SlipWarned',
        schema_version: 1,
        payload: {
          table_key: slip.table_key,
          order_ids: slip.order_ids,
          alert_id: result.alert_id,
          estimated_land_ms: slip.estimate,
          target_land_ms: slip.target,
          promise_ms: slip.promise,
        },
        occurred_at: now,
        actor_id: null,
        device_id: 'hub',
      });
    });

    tx.onCommit(() => {
      hostFlags.reconcile = false;
      if (dayClosed) hostFlags.day_closed = false;
      hostFlags.dropped_lines.splice(0, dropped.length);
      const open = new Set(overloadAlert.keys());
      for (const s of raisedStations) open.add(s);
      for (const s of closedStations) open.delete(s);
      hostFlags.overload_open = open;
      for (const s of skips) {
        if (s.table_key !== undefined) hostFlags.skipped.add(s.table_key);
        if (s.station_id !== undefined) hostFlags.overload_skipped.add(s.station_id);
        // §3.8, §7.2: once per key (a key in `skipped` is not tried again until a commit touches its orders).
        host.log?.warn({ tick: 'fires_alerts', ...s }, 'fires_alerts: input skipped');
      }
    });
    return drafts;
  },
};

// AD-8 developer condition: an `info` alert to managers, values { order_id, order_item_id, reason }, dedupe per
// order_item_id. proposed (implementer): a refused batch's key also names its order, `engine_line_dropped:<order_id>:
// <order_item_id>`: its id is the first reused (or offending) id, which another line holds or may later hold, so a plain
// per-id key could dedupe a real drop of that line into this alert (or the reverse). Device-minted ids (ULIDs) hold no
// ':', so the two key shapes never meet; a line's own drop keeps `engine_line_dropped:<order_item_id>`.
function droppedInput(fact: DroppedLine, kind: ReturnType<typeof kindOf>): RaiseInput | null {
  if (kind === undefined || fact.order_id === null || fact.order_item_id === null) return null;
  const values = { order_id: fact.order_id, order_item_id: fact.order_item_id, reason: fact.reason };
  if (!kind.values_schema.safeParse(values).success) return null;
  return {
    kind: kind.kind,
    subject: { stream_type: 'order', stream_id: fact.order_id },
    target: { kind: 'managers' },
    values,
    display: { kind_label_key: kind.labels.lock },
    dedupe_key: fact.batch ? `engine_line_dropped:${fact.order_id}:${fact.order_item_id}` : `engine_line_dropped:${fact.order_item_id}`,
  };
}
