import { ENGINE_STATE_VERSION, noOrderInEngine, toCheckpoint, type EngineState } from '@pos/engine';
import type { PosEvent } from '@pos/events';
import type { HubDeps } from '../server.js';
import { hostFlags } from './host-flags.js';

// §3.12, F §5.8: a snapshot every 500 committed events; the newest 2 kept (snapshots of the current version, and
// checkpoints); D26's checkpoint document is schema 1.
export const SNAPSHOT_EVERY = 500;
export const SNAPSHOTS_KEPT = 2;
export const CHECKPOINTS_KEPT = 2;
export const CHECKPOINT_SCHEMA = 1;

export type SnapshotDeps = Pick<HubDeps, 'config' | 'db' | 'clock' | 'ids' | 'writer' | 'state'>;
export interface ErrorLog {
  error(obj: Record<string, unknown>, msg: string): void;
}

// The scheduled callbacks per hub (keyed by its writer), so a close can cancel them and a second schedule is a no-op.
interface Pending {
  snapshot: NodeJS.Immediate | null;
  checkpoint: NodeJS.Immediate | null;
}
const pending = new WeakMap<SnapshotDeps['writer'], Pending>();
const pendingOf = (deps: SnapshotDeps): Pending => {
  let p = pending.get(deps.writer);
  if (p === undefined) {
    p = { snapshot: null, checkpoint: null };
    pending.set(deps.writer, p);
  }
  return p;
};

// 01a §2, S15: a hub with no engine steps holds {}; it has nothing to snapshot.
const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).stock === 'object';

function writable(deps: SnapshotDeps): string | null {
  const branchId = deps.config.provisioned?.branch_id;
  if (branchId === undefined || !deps.db.open) return null;
  // Invariant (task 21): a snapshot or checkpoint never shares a transaction with a command or tick.
  if (deps.db.inTransaction) throw new Error('engine snapshot or checkpoint inside another transaction');
  return branchId;
}

// §3.12: the state and writer.lastSeq() read together, in one synchronous step (no commit can run between them), then
// one transaction of 3 statements: the insert, the delete of other-version rows (D62: after a fresh one is written),
// the delete beyond the newest 2. diagnostics is never stored (AD-6). Returns the last_seq written, or null.
// proposed (implementer): "the newest 2" are ranked by last_seq, then taken_at: a clock moved back could give a fresh
// row an older taken_at, and ranking by taken_at would then delete the row just written. Boot step 2 still picks
// between the 2 kept by taken_at; each is a whole state at its own last_seq.
export function writeSnapshotSync(deps: SnapshotDeps): number | null {
  const branchId = writable(deps);
  if (branchId === null) return null;
  const state = deps.state.get();
  if (!isEngineState(state)) return null;
  const last_seq = deps.writer.lastSeq();
  // AD-6: diagnostics is host scratch, never stored (a shallow copy: the parts are shared, not copied).
  const stored: Partial<EngineState> = { ...state };
  delete stored.diagnostics;
  const json = JSON.stringify(stored);
  const db = deps.db;
  db.transaction(() => {
    db.prepare(
      'INSERT INTO engine_snapshots (snapshot_id, branch_id, taken_at, last_seq, engine_version, state_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(deps.ids.next(), branchId, deps.clock.branchNow(), last_seq, ENGINE_STATE_VERSION, json);
    db.prepare('DELETE FROM engine_snapshots WHERE branch_id = ? AND engine_version <> ?').run(branchId, ENGINE_STATE_VERSION);
    db.prepare(
      `DELETE FROM engine_snapshots WHERE branch_id = ? AND snapshot_id NOT IN (
         SELECT snapshot_id FROM engine_snapshots WHERE branch_id = ?
         ORDER BY last_seq DESC, taken_at DESC, snapshot_id DESC LIMIT ?)`,
    ).run(branchId, branchId, SNAPSHOTS_KEPT);
  }).immediate();
  return last_seq;
}

// §3.12: scheduled with setImmediate, outside the command's response path; one pending at a time per hub (a second
// crossing before the callback is covered by the one snapshot, which reads the state current at that moment).
export function scheduleSnapshot(deps: SnapshotDeps, log?: ErrorLog): void {
  const p = pendingOf(deps);
  if (p.snapshot !== null) return;
  p.snapshot = setImmediate(() => {
    p.snapshot = null;
    try {
      writeSnapshotSync(deps);
    } catch (err) {
      log?.error({ err }, 'engine snapshot failed');
    }
  });
}

// D26 day-close checkpoint: the body from toCheckpoint (stock, stations, config, business_day; never orders or
// diagnostics), in its own transaction of 2 statements: the insert and the delete beyond the newest 2.
export function writeCheckpoint(deps: SnapshotDeps, last_seq: number): void {
  const branchId = writable(deps);
  if (branchId === null) return;
  const state = deps.state.get();
  if (!isEngineState(state)) return;
  const json = JSON.stringify(toCheckpoint(state, last_seq));
  const db = deps.db;
  db.transaction(() => {
    db.prepare(
      'INSERT INTO engine_checkpoints (checkpoint_id, branch_id, taken_at, last_seq, checkpoint_schema, body_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(deps.ids.next(), branchId, deps.clock.branchNow(), last_seq, CHECKPOINT_SCHEMA, json);
    db.prepare(
      `DELETE FROM engine_checkpoints WHERE branch_id = ? AND checkpoint_schema = ? AND checkpoint_id NOT IN (
         SELECT checkpoint_id FROM engine_checkpoints WHERE branch_id = ? AND checkpoint_schema = ?
         ORDER BY last_seq DESC, taken_at DESC, checkpoint_id DESC LIMIT ?)`,
    ).run(branchId, CHECKPOINT_SCHEMA, branchId, CHECKPOINT_SCHEMA, CHECKPOINTS_KEPT);
  }).immediate();
}

// §3.12 deferred checkpoint, for the fires tick (task 22): called after the pass's fold (AD-20, test 111 "that pass")
// with the pass's `now`. At the first pass at which noOrderInEngine holds it schedules the write with setImmediate;
// the callback reads the state and writer.lastSeq() together (every commit is whole, so never a seq inside one) and
// writes only while checkpoint_pending still holds (a BusinessDayOpened commit in between clears it) and the
// predicate still holds at its own time. At most one per business day: the write clears the flag. 0 statements here.
export function checkpointAfterPass(deps: SnapshotDeps, now: number, log?: ErrorLog): void {
  if (!hostFlags.checkpoint_pending) return;
  const state = deps.state.get();
  if (!isEngineState(state) || !noOrderInEngine(state, now)) return;
  const p = pendingOf(deps);
  if (p.checkpoint !== null) return;
  p.checkpoint = setImmediate(() => {
    p.checkpoint = null;
    if (!hostFlags.checkpoint_pending) return;
    const current = deps.state.get();
    if (!isEngineState(current) || !noOrderInEngine(current, Math.max(now, deps.clock.branchNow()))) return;
    try {
      writeCheckpoint(deps, deps.writer.lastSeq());
      hostFlags.checkpoint_pending = false;
    } catch (err) {
      log?.error({ err }, 'engine checkpoint failed');
    }
  });
}

// The writer's after-commit hook (index.ts), 0 statements unless it writes the close checkpoint:
// - a commit crossing a multiple of SNAPSHOT_EVERY schedules a snapshot;
// - HubStarted (the last append of startup, F §5.8 step 8) after a boot that loaded no current-version snapshot
//   schedules one fresh snapshot (test 61);
// - the commit that folds BusinessDayClosed: noOrderInEngine on the state after this commit's fold, at the close's
//   recorded_at → the checkpoint at once with last_seq = this commit's max seq (it holds the StockReleased
//   { day_closed } of the close); else checkpoint_pending. A BusinessDayOpened commit clears checkpoint_pending.
export function afterSnapshotCommit(deps: SnapshotDeps, appended: readonly PosEvent[], log?: ErrorLog): void {
  const first = appended[0];
  const last = appended[appended.length - 1];
  if (first === undefined || last === undefined) return;
  if (Math.floor(last.seq / SNAPSHOT_EVERY) > Math.floor((first.seq - 1) / SNAPSHOT_EVERY)) scheduleSnapshot(deps, log);
  let day: PosEvent | undefined;
  let started = false;
  for (const e of appended) {
    if (e.event_type === 'BusinessDayClosed' || e.event_type === 'BusinessDayOpened') day = e;
    else if (e.event_type === 'HubStarted') started = true;
  }
  if (started && !hostFlags.snapshot_loaded) scheduleSnapshot(deps, log);
  if (day === undefined) return;
  // proposed (implementer): with both in one commit, the last one decides (the state after the commit holds it).
  if (day.event_type === 'BusinessDayOpened') {
    hostFlags.checkpoint_pending = false;
    return;
  }
  const state = deps.state.get();
  // proposed (implementer): the state must still be this commit's (no other commit ran in an earlier after-commit
  // hook); otherwise the pair (state, this commit's max seq) would not match, and the write is deferred, where
  // last_seq is writer.lastSeq() read with the state.
  if (isEngineState(state) && deps.writer.lastSeq() === last.seq && noOrderInEngine(state, day.recorded_at)) {
    try {
      writeCheckpoint(deps, last.seq);
      hostFlags.checkpoint_pending = false;
      return;
    } catch (err) {
      log?.error({ err }, 'engine checkpoint failed');
    }
  }
  hostFlags.checkpoint_pending = true;
}

// A closing hub cancels what it scheduled (the database closes next).
export function cancelScheduled(deps: SnapshotDeps): void {
  const p = pending.get(deps.writer);
  if (p === undefined) return;
  if (p.snapshot !== null) clearImmediate(p.snapshot);
  if (p.checkpoint !== null) clearImmediate(p.checkpoint);
  p.snapshot = null;
  p.checkpoint = null;
}

// §3.12, F §5.8: SIGTERM writes one snapshot synchronously, then the hub stops (ticks first, then the server, then the
// database closes). main.ts registers it once boot has completed. A failed snapshot is logged; the stop still runs.
export async function onSigterm(
  handle: { deps: SnapshotDeps; app: { log: ErrorLog }; stop(): Promise<void> },
  exit: (code: number) => void = (code) => process.exit(code),
): Promise<void> {
  try {
    cancelScheduled(handle.deps);
    writeSnapshotSync(handle.deps);
  } catch (err) {
    handle.app.log.error({ err }, 'engine snapshot at SIGTERM failed');
  }
  try {
    await handle.stop();
    exit(0);
  } catch (err) {
    handle.app.log.error({ err }, 'hub stop at SIGTERM failed');
    exit(1);
  }
}
