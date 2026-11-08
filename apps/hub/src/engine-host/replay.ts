import { applyEvent, applyEvents, ENGINE_REPLAY_EVENTS, ENGINE_STATE_VERSION, fromCheckpoint, REPLAY_CHUNK, type Diagnostic, type EngineCheckpointV1, type EngineState, type Profile } from '@pos/engine';
import { parseEvent, type PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import { STOCK_VERSION_HUB_EVENTS, STOCK_VERSION_STOCK_EVENTS } from '../sync/stock-version.js';

interface EventRow {
  event_id: string;
  tenant_id: string;
  branch_id: string;
  stream_type: string;
  stream_id: string;
  event_type: string;
  schema_version: number;
  payload: string;
  occurred_at: number;
  recorded_at: number;
  actor_id: string | null;
  device_id: string;
  seq: number;
}

const STREAMS = ['order', 'station', 'stock', 'hub'] as const;
const quoted = (types: readonly string[]): string => types.map((t) => `'${t}'`).join(', ');

// §3.12: one statement per stream, served by events_branch_stream; the lists are constants.
function replaySql(stream: (typeof STREAMS)[number]): string {
  return `SELECT event_id, tenant_id, branch_id, stream_type, stream_id, event_type, schema_version,
       payload, occurred_at, recorded_at, actor_id, device_id, seq
FROM events
WHERE branch_id = ? AND stream_type = ? AND seq > ? AND event_type IN (${quoted(ENGINE_REPLAY_EVENTS[stream])})
ORDER BY seq`;
}

// §3.12, AD-6, AD-28: the four statements merged by seq, folded non-strict in chunks of REPLAY_CHUNK. Each chunk's
// diagnostics go to `report` and leave the state, so none survive a boot. proposed (implementer): `report` takes a
// Diagnostic (the plan's BreachReport became state.diagnostics under AD-6). Only the plain OrderLinesAdded throw on an
// absent order (§3.3) leaves here as a throw; a failing step stops boot (00 §3.8).
export function replayEngine(
  db: Database.Database,
  branchId: string,
  fromSeq: number,
  base: EngineState,
  report: (d: Diagnostic) => void,
): { state: EngineState; replayed: number } {
  const cursors = STREAMS.map((stream) => db.prepare(replaySql(stream)).iterate(branchId, stream, fromSeq) as IterableIterator<EventRow>);
  try {
    const heads = cursors.map((cursor) => cursor.next());
    let state = base;
    let replayed = 0;
    let chunk: PosEvent[] = [];
    const fold = (): void => {
      try {
        state = applyEvents(state, chunk, { strict: false });
      } catch (error) {
        reportBeforeThrow(state, chunk, report);
        throw error;
      }
      chunk = [];
      if (state.diagnostics.length === 0) return;
      for (const d of state.diagnostics) report(d);
      state = { ...state, diagnostics: [] };
    };
    for (;;) {
      let min = -1;
      heads.forEach((head, i) => {
        if (head.done !== true && (min < 0 || (head.value as EventRow).seq < (heads[min]!.value as EventRow).seq)) min = i;
      });
      if (min < 0) break;
      const row = heads[min]!.value as EventRow;
      chunk.push(parseEvent({ ...row, payload: JSON.parse(row.payload) as PosEvent['payload'] }));
      replayed += 1;
      if (chunk.length === REPLAY_CHUNK) fold();
      heads[min] = cursors[min]!.next();
    }
    fold();
    return { state, replayed };
  } finally {
    for (const cursor of cursors) cursor.return?.();
  }
}

// A throw inside a chunk (§3.3's plain OrderLinesAdded) would take the diagnostics of the chunk's earlier events with
// it: fold them one by one up to the throw and report what they noted. The failure path only; boot stops after it.
function reportBeforeThrow(base: EngineState, chunk: readonly PosEvent[], report: (d: Diagnostic) => void): void {
  let state = base;
  for (const event of chunk) {
    try {
      state = applyEvent(state, event, { strict: false });
    } catch {
      break;
    }
  }
  for (const d of state.diagnostics) report(d);
}

// §3.12, A-17, §6.19: the newest stock-page event over the whole log, which a replay from a snapshot cannot see.
// Two statements on events_branch_stream.
export function readStockVersion(db: Database.Database, branchId: string): number {
  const newest = (stream: string, types: readonly string[]): number =>
    (db
      .prepare(`SELECT seq FROM events WHERE branch_id = ? AND stream_type = '${stream}' AND event_type IN (${quoted(types)}) ORDER BY seq DESC LIMIT 1`)
      .pluck()
      .get(branchId) as number | undefined) ?? 0;
  const onStock = newest('stock', STOCK_VERSION_STOCK_EVENTS);
  const onHub = newest('hub', STOCK_VERSION_HUB_EVENTS);
  return Math.max(onStock, onHub);
}

export type SkipReason = 'engine_version' | 'checkpoint_schema' | 'unreadable';
export type Skip = (o: { table: 'engine_snapshots' | 'engine_checkpoints'; id: string; reason: SkipReason; found?: number }) => void;

export interface LoadedBase {
  state: EngineState | null;
  snapshot_seq: number | null;
  checkpoint_seq: number | null;
  checkpoint_taken_at: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// profile.ts's canonical form: strictly increasing integer boundaries, no zero-length segment, u ≥ 0, equal neighbours
// merged, u[0] > 0, last u = 0, or empty. A malformed last u makes earliestFit return NaN (task 4's review).
function isCanonicalProfile(p: unknown): p is Profile {
  if (!isRecord(p) || !Array.isArray(p.t) || !Array.isArray(p.u) || p.t.length !== p.u.length) return false;
  const t = p.t as unknown[];
  const u = p.u as unknown[];
  if (t.length === 0) return true;
  if (u[0] === 0 || u[u.length - 1] !== 0) return false;
  for (let i = 0; i < t.length; i += 1) {
    if (!Number.isInteger(t[i]) || !Number.isFinite(u[i]) || (u[i] as number) < 0) return false;
    if (i > 0 && ((t[i] as number) <= (t[i - 1] as number) || u[i] === u[i - 1])) return false;
  }
  return true;
}

// The state a snapshot row holds, or null when this build cannot use it. diagnostics is never stored (AD-6).
function parseSnapshot(json: string): EngineState | null {
  try {
    const s = JSON.parse(json) as unknown;
    if (!isRecord(s)) return null;
    const { stock, stations, orders, lines, slips, slip_due, business_day, config, next_alert_due_at } = s;
    if (![stock, stations, orders, lines, slips, slip_due].every(isRecord)) return null;
    if (business_day !== null && !isRecord(business_day)) return null;
    if (config !== null && !isRecord(config)) return null;
    if (next_alert_due_at !== null && typeof next_alert_due_at !== 'number') return null;
    for (const station of Object.values(stations as Record<string, unknown>)) {
      if (!isRecord(station) || !isCanonicalProfile(station.profile) || !Array.isArray(station.unfired) || !isRecord(station.loads)) return null;
    }
    return { ...(s as unknown as EngineState), diagnostics: [] };
  } catch {
    return null;
  }
}

function parseCheckpoint(json: string): EngineState | null {
  try {
    const body = JSON.parse(json) as unknown;
    if (!isRecord(body) || body.checkpoint_schema !== 1 || !isRecord(body.stock) || !isRecord(body.stations)) return null;
    if (body.business_day !== null && !isRecord(body.business_day)) return null;
    if (body.config !== null && !isRecord(body.config)) return null;
    return fromCheckpoint(body as unknown as EngineCheckpointV1);
  } catch {
    return null;
  }
}

// §3.12 step 2: two statements, each LIMIT 2, whatever is found: step 6 reads the checkpoint's taken_at on a snapshot
// boot too. proposed (implementer): "latest snapshot with engine_version = 3" and Review Focus 5's logged skip of a
// v4 row meet in the ORDER BY (ties broken by last_seq, then taken_at for checkpoints; task 21 review): rows of this build's version come first, so a row of another version can neither hide a
// usable one nor pass unseen unless two usable rows fill the LIMIT. The same for checkpoint_schema.
export function loadEngineBase(db: Database.Database, branchId: string, skip: Skip): LoadedBase {
  const snapshots = db
    .prepare(
      `SELECT snapshot_id, last_seq, engine_version, state_json FROM engine_snapshots
       WHERE branch_id = ? ORDER BY engine_version = ? DESC, taken_at DESC, last_seq DESC LIMIT 2`,
    )
    .all(branchId, ENGINE_STATE_VERSION) as Array<{ snapshot_id: string; last_seq: number; engine_version: number; state_json: string }>;
  const checkpoints = db
    .prepare(
      `SELECT checkpoint_id, taken_at, last_seq, checkpoint_schema, body_json FROM engine_checkpoints
       WHERE branch_id = ? ORDER BY checkpoint_schema = 1 DESC, last_seq DESC, taken_at DESC LIMIT 2`,
    )
    .all(branchId) as Array<{ checkpoint_id: string; taken_at: number; last_seq: number; checkpoint_schema: number; body_json: string }>;

  const out: LoadedBase = { state: null, snapshot_seq: null, checkpoint_seq: null, checkpoint_taken_at: null };
  for (const row of snapshots) {
    if (row.engine_version !== ENGINE_STATE_VERSION) {
      skip({ table: 'engine_snapshots', id: row.snapshot_id, reason: 'engine_version', found: row.engine_version });
    } else if (out.state === null) {
      const state = parseSnapshot(row.state_json);
      if (state === null) {
        skip({ table: 'engine_snapshots', id: row.snapshot_id, reason: 'unreadable' });
      } else {
        out.state = state;
        out.snapshot_seq = row.last_seq;
      }
    }
  }
  let checkpointState: EngineState | null = null;
  for (const row of checkpoints) {
    if (row.checkpoint_schema !== 1) {
      skip({ table: 'engine_checkpoints', id: row.checkpoint_id, reason: 'checkpoint_schema', found: row.checkpoint_schema });
    } else if (checkpointState === null) {
      checkpointState = parseCheckpoint(row.body_json);
      if (checkpointState === null) {
        skip({ table: 'engine_checkpoints', id: row.checkpoint_id, reason: 'unreadable' });
      } else {
        out.checkpoint_seq = row.last_seq;
        out.checkpoint_taken_at = row.taken_at;
      }
    }
  }
  out.state ??= checkpointState;
  return out;
}
