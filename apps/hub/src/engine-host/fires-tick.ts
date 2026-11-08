import { canonicalJson } from '@pos/domain/hash';
import { firesDue, getTickIntents, type EngineState, type TickDraft } from '@pos/engine';
import { CONFIG_POLL_INTERVAL_MS, type BranchConfig, type EngineConfig, type EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import type { TickDef } from '../alerts/tick.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { hostFlags } from './host-flags.js';
import { rawDbOf } from './read-only-tx.js';
import { checkpointAfterPass, type ErrorLog, type SnapshotDeps } from './snapshots.js';

// 03a §6.2, §3.6.1: the `fires` tick, registered right after 01d's `alerts` (registerEngineBootSteps). Engine intents
// only; its alerts are `fires_alerts`' (task 22a).
// - due(db, state, now): pure and in memory, no statement, no transaction (D44, 01d "idle kitchen"):
//   `firesDue(state, last_pass_ms, now).intents_due || configStale`. It also schedules the deferred day-close
//   checkpoint (§3.12; checkpointAfterPass: 0 statements, the write is its own setImmediate) and hands the stations
//   whose lines entered Next to the frame seam (§3.6.3, task 22b): sent from due when nothing else is due, else handed
//   to station-plan's after-commit hook (takeCommittedCrossed), so a station gets one frame per pass.
// - intents(tx, state, now): `state` is read inside the tick's own transaction (01d race rule, tests 71 and 73).
//   1. configStale → one EngineConfigApplied and nothing else (§3.11 catch-up, G2 #22); the flag clears after commit.
//   2–3. getTickIntents(state, now): fires, inferred Start / Done with their StockConsumed (stockEffects), cascade
//        shifts and the StockReleased { abandoned } of §3.6.1 item 4a.
//   4. the drafts, stamped (no envelope from the engine): one transaction, one applyEvents (the writer, AD-28).
//   After commit (the fold is in the state): the checkpoint check again (AD-20: an abandon pass's release is what
//   makes noOrderInEngine true, test 111 "that pass"), and the deferred freeze-entry stations.
// Statements: 0 in due; 0 reads in intents, so a pass with work runs only its appends.

interface FiresHost {
  deps: SnapshotDeps;
  log?: HostLog;
  // §3.6.3 frame seam: station-plan.ts (task 22b) sends `station_plan` for these stations; a no-op until bound.
  sendStationPlans: (station_ids: string[]) => void;
  // Stations crossed in a due that also had intents: their frames go out after that pass's commit.
  crossed: string[];
  // Task 22 review: the last_pass_ms of a due whose pass has not committed yet; null once it has. A next due that
  // finds it set (the commit failed, or intents never ran) restores it, so that interval's crossings are not lost.
  since: number | null;
  // The crossed stations of a committed pass, taken by station-plan's after-commit hook of that same commit.
  committed: string[];
}

// Per hub, keyed by its connection (due gets the read-only view; rawDbOf maps it back).
const hosts = new WeakMap<Database.Database, FiresHost>();

// registerEngineHost (P-6): binds this hub to the tick. §3.6.3: last_pass_ms starts at boot time.
// The host's log: errors, and the AD-35 (c) back-off warn line (app.log has both).
type HostLog = ErrorLog & { warn?(obj: Record<string, unknown>, msg: string): void };

export function bindFiresTick(deps: SnapshotDeps, log?: HostLog): void {
  hosts.set(deps.db, { deps, log, sendStationPlans: () => undefined, crossed: [], since: null, committed: [] });
  hostFlags.last_pass_ms = deps.clock.branchNow();
}

// §3.6.3 seam for task 22b: the sender of the freeze-entry `station_plan` frames.
export function onFreezeEntry(deps: Pick<SnapshotDeps, 'db'>, send: (station_ids: string[]) => void): void {
  const host = hosts.get(deps.db);
  if (host !== undefined) host.sendStationPlans = send;
}

// §3.6.3: the stations crossed by the pass that has just committed (tx.onCommit runs before the writer's after-commit
// hooks), once. Task 22b's after-commit hook merges them with the commit's touched stations.
export function takeCommittedCrossed(deps: Pick<SnapshotDeps, 'db'>): string[] {
  const host = hosts.get(deps.db);
  if (host === undefined || host.committed.length === 0) return [];
  const out = host.committed;
  host.committed = [];
  return out;
}

// §3.11 E(next): the EngineConfigAppliedV1 fields of the applied snapshot. Task 24's engineConfigOf (config-hook.ts)
// sets it at the server build (boot step 5, before step 6 reads it); without one configStale stays false.
type EngineConfigOf = (snapshot: BranchConfig) => EngineConfig;
let engineConfigOf: EngineConfigOf | null = null;
export function setEngineConfigOf(fn: EngineConfigOf | null): void {
  engineConfigOf = fn;
}

// E(branchConfig()), or null when there is no applied config or no E() yet.
function nextConfig(): EngineConfig | null {
  const snapshot = branchConfig();
  return snapshot === null || engineConfigOf === null ? null : engineConfigOf(snapshot);
}

// Batch 9 (task 24, review round 1): a catch-up that keeps failing must not block the fires pass forever, and the
// flag keeps its §3.11 meaning (only a committed catch-up pass or a committed hook run clears it).
// proposed (implementer): a catch-up pass that does not commit (E() throws, the append fails) is seen as failed at the
// next due. After CATCH_UP_ATTEMPTS failures in a row, due stops gating on configStale (ordinary fires passes run on
// the replayed config) and retries the catch-up once per CONFIG_POLL_INTERVAL_MS (01a's poll interval, 60 s), each
// failed retry logged once at error. The catch-up pass still writes only the config; a commit clears the flag, the
// count and the back-off. Times are the pass's `now` (the hub clock), never the wall clock.
const CATCH_UP_ATTEMPTS = 3;
interface CatchUp {
  failures: number; // catch-up passes in a row that did not commit
  retry_at: number; // once failures ≥ CATCH_UP_ATTEMPTS: the earliest next attempt
  pending: boolean; // this due chose a catch-up pass; still true at the next due → it did not commit
  warned_at: number | null; // AD-35 (c) amended: when the last back-off warn line was logged (null: none yet)
  passes: number; // ordinary backed-off passes since that line
}
const catchUps = new WeakMap<object, CatchUp>();

// Is this pass a catch-up pass? Pure and in memory (0 statements).
function catchUpDue(host: object, log: ErrorLog | undefined, now: number): boolean {
  let c = catchUps.get(host);
  if (c === undefined) {
    c = { failures: 0, retry_at: 0, pending: false, warned_at: null, passes: 0 };
    catchUps.set(host, c);
  }
  if (c.pending) {
    c.pending = false;
    c.failures += 1;
    if (c.failures >= CATCH_UP_ATTEMPTS) {
      c.retry_at = now + CONFIG_POLL_INTERVAL_MS;
      log?.error({ tick: 'fires', attempts: c.failures, retry_at: c.retry_at }, 'fires: config catch-up failed; retrying at a back-off');
    }
  }
  if (c.failures >= CATCH_UP_ATTEMPTS && now < c.retry_at) return false;
  c.pending = true;
  return true;
}

// AD-35 (c), owner ruling, amended by the owner 2026-11-08 (rate limit): while configStale is still set after the
// back-off, the first ordinary pass logs one warn line, then at most one line per CONFIG_POLL_INTERVAL_MS (so one per
// retry), with the failure count, the config version in use, the one the catch-up wants (E()'s, or null when there is
// no E() or it throws) and the ordinary passes run since the last line. Times are the pass's `now`. In memory,
// 0 statements; never throws.
function warnBackedOff(host: FiresHost, state: EngineState, now: number): void {
  const c = catchUps.get(host);
  if (c === undefined) return;
  if (c.warned_at !== null && now < c.warned_at + CONFIG_POLL_INTERVAL_MS) {
    c.passes += 1;
    return;
  }
  const passes = c.passes;
  c.warned_at = now;
  c.passes = 0;
  try {
    let wanted: number | null = null;
    try {
      wanted = nextConfig()?.config_version ?? null;
    } catch {
      wanted = null;
    }
    host.log?.warn?.(
      {
        tick: 'fires',
        failures: c.failures,
        config_version: state.config?.config_version ?? null,
        wanted_config_version: wanted,
        passes_since_last_line: passes,
      },
      'fires: config catch-up backed off; configStale still set',
    );
  } catch {
    // A log failure never stops the pass.
  }
}

// §3.11, §6.3 step 6: configStale = canonicalJson(E(branchConfig())) ≠ canonicalJson(state.config). Pure, 0 statements.
export function configStaleFor(state: EngineState): boolean {
  const next = nextConfig();
  return next !== null && canonicalJson(next) !== canonicalJson(state.config ?? null);
}

// 01a §2: a hub with no engine steps holds {}.
const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).lines === 'object';

// The host's stamp of an engine draft (the engine knows no envelope): the pass's now, no actor, the hub as device. The
// writer adds event_id, seq and recorded_at.
type Stampable = Pick<EventDraft, 'stream_type' | 'stream_id' | 'event_type' | 'schema_version'> & { payload: TickDraft['payload'] | EngineConfig };
function stamp(d: Stampable, now: number): EventDraft {
  return {
    stream_type: d.stream_type,
    stream_id: d.stream_id,
    event_type: d.event_type,
    schema_version: d.schema_version,
    payload: d.payload as Record<string, unknown>,
    occurred_at: now,
    actor_id: null,
    device_id: 'hub',
  };
}

export const firesTick: TickDef = {
  name: 'fires',
  due(db, state, now) {
    const host = hosts.get(rawDbOf(db));
    if (host === undefined || !isEngineState(state)) return false;
    // Task 22 review: the previous pass with intents did not commit; its interval is seen again.
    if (host.since !== null) {
      hostFlags.last_pass_ms = host.since;
      host.since = null;
      host.crossed = [];
    }
    // §3.12: a pass with no work can still be the first at which no order is in the engine (an exit by time alone).
    checkpointAfterPass(host.deps, now, host.log);
    // §3.11: the catch-up pass. last_pass_ms is left as it is, so the next pass still sees this interval's crossings.
    if (!hostFlags.configStale) catchUps.delete(host);
    else if (catchUpDue(host, host.log, now)) return true;
    else warnBackedOff(host, state, now);
    const since = hostFlags.last_pass_ms;
    const { intents_due, crossed } = firesDue(state, since, now);
    hostFlags.last_pass_ms = now;
    if (intents_due) {
      // §3.6.3: one frame per station per pass; with intents, from that pass's after-commit instead.
      host.crossed = crossed;
      host.since = since;
    } else if (crossed.length > 0) host.sendStationPlans(crossed);
    return intents_due;
  },
  intents(tx, state, now) {
    const host = hosts.get(tx.db);
    if (host === undefined || !isEngineState(state)) return [];
    if (hostFlags.configStale && catchUps.get(host)?.pending === true) {
      tx.onCommit(() => {
        catchUps.delete(host);
        hostFlags.configStale = false;
      });
      // Re-selected inside the transaction: a config hook that applied it meanwhile leaves nothing to write.
      const next = nextConfig();
      if (next === null || canonicalJson(next) === canonicalJson(state.config ?? null)) return [];
      return [stamp({ stream_type: 'station', stream_id: tx.branchId, event_type: 'EngineConfigApplied', schema_version: 1, payload: next }, now)];
    }
    const drafts = getTickIntents(state, now).map((d) => stamp(d, now));
    const crossed = host.crossed;
    tx.onCommit(() => {
      host.crossed = [];
      host.since = null;
      host.committed = crossed;
      checkpointAfterPass(host.deps, now, host.log);
    });
    return drafts;
  },
};
