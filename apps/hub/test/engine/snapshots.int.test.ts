// 03a task 21: the snapshot and checkpoint writers (§3.12, §5.1, §7.1; tests #61, #112).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { ENGINE_STATE_VERSION, initialEngineState, isOrderInEngine, noOrderInEngine, toCheckpoint, type EngineState } from '@pos/engine';
import { generateDay, runDay } from '@pos/engine/sim';
import type { EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed, aBusinessDayOpened, anEngineConfigApplied, anItemMadeUnavailable, anOrderBatch, aStockReleased, aStockSet } from '@pos/events/testing';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerEngineBootSteps } from '../../src/engine-host/boot-steps';
import { hostFlags } from '../../src/engine-host/host-flags';
import { loadEngineBase } from '../../src/engine-host/replay';
import { checkpointAfterPass, onSigterm, scheduleSnapshot, SNAPSHOT_EVERY, writeCheckpoint, writeSnapshotSync } from '../../src/engine-host/snapshots';
import { boot, type BootHandle } from '../../src/lib/boot';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';

registerEngineBootSteps(() => performance.now());
registerRestaurantBootSteps();

const BRANCH = 'branch-1';
const TENANT = 'tenant-a';
const WALL = 1_761_000_000_000;
const MIN = 60_000;
// §7.1 snapshot row (P-12): the full write — serialise + insert in its own transaction — on the peak state.
const SNAPSHOT_MS = 50;
const SNAPSHOT_SAMPLES = 15;

const nextImmediate = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function draftOf(event: PosEvent): EventDraft {
  return {
    stream_type: event.stream_type,
    stream_id: event.stream_id,
    event_type: event.event_type,
    schema_version: event.schema_version,
    payload: event.payload,
    occurred_at: event.occurred_at,
    actor_id: event.actor_id,
    device_id: event.device_id,
  };
}

const kSet = (i: number): PosEvent => aStockSet({ stream_id: `K${i}`, payload: { stock_item_id: `K${i}`, on_hand: i, unit: 'piece' } });

interface SnapshotRow { snapshot_id: string; taken_at: number; last_seq: number; engine_version: number; state_json: string }
interface CheckpointRow { checkpoint_id: string; taken_at: number; last_seq: number; checkpoint_schema: number; body_json: string }
const snapshotsOf = (db: Database.Database): SnapshotRow[] =>
  db.prepare('SELECT snapshot_id, taken_at, last_seq, engine_version, state_json FROM engine_snapshots ORDER BY last_seq, taken_at').all() as SnapshotRow[];
const checkpointsOf = (db: Database.Database): CheckpointRow[] =>
  db.prepare('SELECT checkpoint_id, taken_at, last_seq, checkpoint_schema, body_json FROM engine_checkpoints ORDER BY last_seq, taken_at').all() as CheckpointRow[];

function insertSnapshot(db: Database.Database, o: { id: string; taken_at: number; last_seq: number; engine_version?: number; branch?: string }): void {
  db.prepare('INSERT INTO engine_snapshots (snapshot_id, branch_id, taken_at, last_seq, engine_version, state_json) VALUES (?, ?, ?, ?, ?, ?)').run(
    o.id,
    o.branch ?? BRANCH,
    o.taken_at,
    o.last_seq,
    o.engine_version ?? ENGINE_STATE_VERSION,
    '{}',
  );
}
function insertCheckpoint(db: Database.Database, o: { id: string; taken_at: number; last_seq: number }): void {
  db.prepare('INSERT INTO engine_checkpoints (checkpoint_id, branch_id, taken_at, last_seq, checkpoint_schema, body_json) VALUES (?, ?, ?, ?, 1, ?)').run(
    o.id,
    BRANCH,
    o.taken_at,
    o.last_seq,
    JSON.stringify(toCheckpoint(initialEngineState(), o.last_seq)),
  );
}

// Records the SQL of every statement run, in order (the statements' own methods, as statementCounter).
function sqlRecorder(db: Database.Database): { sql: string[]; stop(): void } {
  const sql: string[] = [];
  const prepare = db.prepare;
  db.prepare = ((text: string) => {
    const statement = prepare.call(db, text);
    for (const method of ['get', 'all', 'run', 'iterate'] as const) {
      const original = (statement[method] as (...args: unknown[]) => unknown).bind(statement);
      (statement as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        sql.push(text.replace(/\s+/g, ' ').trim());
        return original(...args);
      };
    }
    return statement;
  }) as typeof db.prepare;
  return {
    sql,
    stop() {
      db.prepare = prepare;
    },
  };
}

function writeConfig(): { path: string; dataDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-engine-snap-'));
  const dataDir = join(dir, 'data');
  const backupDir = join(dir, 'backup');
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  const path = join(dir, 'config.json');
  writeFileSync(
    path,
    JSON.stringify({
      cloud_base_url: 'https://cloud.example',
      http_port: 3000,
      data_dir: dataDir,
      backup_dir: backupDir,
      min_client_version: '1.0.0',
      backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
      advertised_host: '192.168.10.2',
      provisioned: { tenant_id: TENANT, branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'test-branch-api-key', confirmed_at: 1 },
    }),
  );
  return { path, dataDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const quiet = (): Writable => new Writable({ write: (_chunk, _enc, done) => done() });

describe('03a task 21: snapshot and checkpoint writers', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  let hub: TestHub;
  async function open(): Promise<TestHub> {
    hub = await createTestHub();
    cleanups.push(() => hub.close());
    hostFlags.checkpoint_pending = false;
    return hub;
  }
  const engine = (): EngineState => hub.deps.state.get();
  const append = (events: readonly PosEvent[]): PosEvent[] => hub.deps.writer.run((tx) => tx.append(events.map(draftOf))).appended;

  // A monotonic source that moves, so two snapshots of one boot never share a taken_at.
  async function bootAt(cfg: { path: string }, wall: number): Promise<BootHandle> {
    let mono = 0;
    const booted = await boot({ configPath: cfg.path, wallNow: () => wall, monoNow: () => (mono += 1), ifaces: ['192.168.10.2'], configClient: stubConfigCloud(), logStream: quiet() });
    return booted;
  }

  // ------------------------------------------------------------------------------------------------- #61 snapshots
  describe('[03a #61] snapshots', () => {
    it('[03a #61] a commit crossing a multiple of 500 schedules one snapshot with setImmediate: none inside the commit; last_seq and state are read in the callback', async () => {
      await open();
      append(Array.from({ length: SNAPSHOT_EVERY - 1 }, (_, i) => kSet(i)));
      expect(hub.deps.writer.lastSeq()).toBe(SNAPSHOT_EVERY - 1);
      await nextImmediate();
      expect(snapshotsOf(hub.deps.db)).toEqual([]);

      const rec = sqlRecorder(hub.deps.db);
      hub.deps.writer.run((tx) => {
        tx.append([draftOf(kSet(900)), draftOf(kSet(901))]);
      });
      const insideCommit = [...rec.sql];
      // A later commit before the callback: the snapshot holds it too (same callback reads both).
      append([kSet(902)]);
      expect(snapshotsOf(hub.deps.db)).toEqual([]);
      await nextImmediate();
      rec.stop();
      expect(insideCommit.some((s) => s.includes('engine_snapshots'))).toBe(false);
      const rows = snapshotsOf(hub.deps.db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ last_seq: SNAPSHOT_EVERY + 2, engine_version: ENGINE_STATE_VERSION, taken_at: hub.clock.branchNow() });
      // AD-6: diagnostics never stored; boot reads it back with diagnostics: [] and equal to the live state.
      expect(JSON.parse(rows[0]!.state_json)).not.toHaveProperty('diagnostics');
      const base = loadEngineBase(hub.deps.db, BRANCH, () => undefined);
      expect(base.snapshot_seq).toBe(SNAPSHOT_EVERY + 2);
      expect(base.state).toEqual({ ...engine(), diagnostics: [] });
      expect(base.state!.stock.K902).toMatchObject({ on_hand: 902 });

      // The next commit inside the same 500 schedules nothing.
      append([kSet(903)]);
      await nextImmediate();
      expect(snapshotsOf(hub.deps.db)).toHaveLength(1);
    });

    it('[03a #61] two crossing commits before the callback give one snapshot', async () => {
      await open();
      append(Array.from({ length: SNAPSHOT_EVERY }, (_, i) => kSet(i)));
      append(Array.from({ length: SNAPSHOT_EVERY }, (_, i) => kSet(i)));
      await nextImmediate();
      await nextImmediate();
      expect(snapshotsOf(hub.deps.db).map((r) => r.last_seq)).toEqual([2 * SNAPSHOT_EVERY]);
    });

    it('[03a #61] the write is its own transaction (insert + 2 deletes = 3 statements); it never runs inside a command transaction', async () => {
      await open();
      append([kSet(1)]);
      const counter = statementCounter(hub.deps.db);
      expect(hub.deps.db.inTransaction).toBe(false);
      writeSnapshotSync(hub.deps);
      expect(counter.count).toBe(3);
      expect(() => hub.deps.writer.run(() => writeSnapshotSync(hub.deps))).toThrow(/transaction/);
      expect(snapshotsOf(hub.deps.db)).toHaveLength(1);
    });

    it('[03a #61] keeps the newest 2 of the current version and deletes every older-version row after a fresh one; other branches untouched', async () => {
      await open();
      append([kSet(1)]);
      insertSnapshot(hub.deps.db, { id: 'v2a', taken_at: WALL - 5, last_seq: 0, engine_version: ENGINE_STATE_VERSION - 1 });
      insertSnapshot(hub.deps.db, { id: 'v4a', taken_at: WALL + 5_000, last_seq: 0, engine_version: ENGINE_STATE_VERSION + 1 });
      insertSnapshot(hub.deps.db, { id: 'old1', taken_at: WALL - 3, last_seq: 0 });
      insertSnapshot(hub.deps.db, { id: 'old2', taken_at: WALL - 2, last_seq: 0 });
      insertSnapshot(hub.deps.db, { id: 'other', taken_at: WALL - 1, last_seq: 0, branch: 'branch-x' });
      writeSnapshotSync(hub.deps);
      const ids = (hub.deps.db.prepare('SELECT snapshot_id FROM engine_snapshots ORDER BY snapshot_id').pluck().all() as string[]).sort();
      const fresh = snapshotsOf(hub.deps.db).find((r) => r.last_seq === 1)!.snapshot_id;
      expect(ids).toEqual([fresh, 'old2', 'other'].sort());
      // A same-ms second write (a fixed clock) keeps itself and the newest before it.
      append([kSet(2)]);
      writeSnapshotSync(hub.deps);
      expect(snapshotsOf(hub.deps.db).filter((r) => r.last_seq > 0).map((r) => r.last_seq)).toEqual([1, 2]);
      expect(snapshotsOf(hub.deps.db).filter((r) => r.last_seq > 0)).toHaveLength(2);
    });

    it('[03a #61] step 2 falls back to the second row (LIMIT 2) when the newest written row is torn', async () => {
      await open();
      append([kSet(1)]);
      writeSnapshotSync(hub.deps);
      const held = engine();
      hub.clock.advance(1_000);
      append([kSet(2)]);
      writeSnapshotSync(hub.deps);
      hub.deps.db.prepare('UPDATE engine_snapshots SET state_json = substr(state_json, 1, 40) WHERE last_seq = 2').run();
      const skipped: unknown[] = [];
      const base = loadEngineBase(hub.deps.db, BRANCH, (s) => skipped.push(s));
      expect(skipped).toEqual([expect.objectContaining({ reason: 'unreadable' })]);
      expect(base.snapshot_seq).toBe(1);
      expect(base.state).toEqual({ ...held, diagnostics: [] });
    });

    it('[03a #61] a failed scheduled write is logged, never thrown out of the event loop', async () => {
      await open();
      append([kSet(1)]);
      const errors: Array<Record<string, unknown>> = [];
      hub.deps.db.exec('DROP TABLE engine_snapshots');
      scheduleSnapshot(hub.deps, { error: (obj) => errors.push(obj) });
      await nextImmediate();
      expect(errors).toHaveLength(1);
    });

    it('[03a #61] after a boot that loaded no snapshot (seq 0 or a checkpoint), one fresh snapshot follows startup; a boot that loaded one writes none', async () => {
      const cfg = writeConfig();
      cleanups.push(cfg.cleanup);
      const first = await bootAt(cfg, WALL);
      expect(hostFlags.snapshot_loaded).toBe(false);
      const startedSeq = first.deps.writer.lastSeq();
      await nextImmediate();
      const rows = snapshotsOf(first.deps.db);
      expect(rows.map((r) => r.last_seq)).toEqual([startedSeq]);
      await first.stop();

      const second = await bootAt(cfg, WALL + MIN);
      cleanups.push(() => second.stop());
      expect(hostFlags.snapshot_loaded).toBe(true);
      await nextImmediate();
      await nextImmediate();
      expect(snapshotsOf(second.deps.db).map((r) => r.last_seq)).toEqual([startedSeq]);
    });

    it('[03a #61] SIGTERM writes one snapshot synchronously before the database closes, then stops the hub', async () => {
      const cfg = writeConfig();
      cleanups.push(cfg.cleanup);
      const booted = await bootAt(cfg, WALL);
      await nextImmediate();
      booted.deps.writer.run((tx) => tx.append([draftOf(kSet(7))]));
      const live = booted.deps.state.get();
      const lastSeq = booted.deps.writer.lastSeq();
      const exits: number[] = [];
      const done = onSigterm(booted, (code) => exits.push(code));
      // Synchronous: the row is there before the handler yields.
      expect(snapshotsOf(booted.deps.db).map((r) => r.last_seq)).toContain(lastSeq);
      await done;
      expect(exits).toEqual([0]);
      expect(booted.deps.db.open).toBe(false);
      const db = new Database(join(cfg.dataDir, 'hub.sqlite'), { readonly: true });
      try {
        const base = loadEngineBase(db, BRANCH, () => undefined);
        expect(base.snapshot_seq).toBe(lastSeq);
        expect(base.state).toEqual({ ...live, diagnostics: [] });
      } finally {
        db.close();
      }
    });
  });

  // ------------------------------------------------------------------------------------------- §3.12 checkpoint
  describe('[03a §3.12 checkpoint]', () => {
    const OPEN = WALL;
    const setK1 = aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 2_000, unit: 'g' } });
    const fromStock = { order_item_id: 'L1', item: { stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'K1', quantity: 500 }] }, line: { from_stock: true } };

    it('[03a §3.12 checkpoint] the close commit with StockReleased { day_closed } → written at once, last_seq = that commit\'s max seq, the predicate read after the fold', async () => {
      await open();
      hub.clock.set(OPEN);
      append([anEngineConfigApplied(), aBusinessDayOpened(), setK1]);
      append(anOrderBatch({ lines: [fromStock], reserved: [{ stock_item_id: 'K1', order_item_id: 'L1', quantity: 500 }] }));
      expect(engine().lines.L1!.reserved_seq).toEqual(expect.any(Number));
      hub.clock.set(OPEN + MIN);
      append([{ ...anOrderBatch()[0]!, event_type: 'ItemServed', payload: { order_item_ids: ['L1'], source: 'tap' } } as PosEvent]);
      const closeAt = OPEN + 40 * MIN;
      hub.clock.set(closeAt);
      // AD-20: out of the engine by the predicate, but its line still holds a reservation: no checkpoint before the fold.
      expect(noOrderInEngine(engine(), closeAt)).toBe(false);
      const appended = append([
        aStockReleased({ payload: { stock_item_id: 'K1', order_item_id: 'L1', quantity: 500, reason: 'day_closed' } }),
        aBusinessDayClosed(),
      ]);
      const rows = checkpointsOf(hub.deps.db);
      expect(rows).toHaveLength(1);
      const commitMax = appended[appended.length - 1]!.seq;
      expect(appended[0]!.seq).toBeLessThan(commitMax);
      expect(rows[0]).toMatchObject({ last_seq: commitMax, checkpoint_schema: 1, taken_at: closeAt });
      expect(JSON.parse(rows[0]!.body_json)).toEqual(JSON.parse(JSON.stringify(toCheckpoint(engine(), commitMax))));
      expect(JSON.parse(rows[0]!.body_json).business_day.closed_at).toBe(closeAt);
      expect(JSON.parse(rows[0]!.body_json)).not.toHaveProperty('diagnostics');
      expect(hostFlags.checkpoint_pending).toBe(false);
      expect(engine().lines.L1?.reserved_seq ?? null).toBeNull();
      // At most one per business day: later passes write nothing.
      checkpointAfterPass(hub.deps, closeAt + 60 * MIN);
      await nextImmediate();
      expect(checkpointsOf(hub.deps.db)).toHaveLength(1);
    });

    it('[03a §3.12 checkpoint] the checkpoint write is 2 statements in its own transaction and keeps the newest 2', async () => {
      await open();
      insertCheckpoint(hub.deps.db, { id: 'c1', taken_at: WALL - 3, last_seq: 0 });
      insertCheckpoint(hub.deps.db, { id: 'c2', taken_at: WALL - 2, last_seq: 0 });
      append([kSet(1)]);
      const counter = statementCounter(hub.deps.db);
      writeCheckpoint(hub.deps, 1);
      expect(counter.count).toBe(2);
      const ids = checkpointsOf(hub.deps.db).map((r) => r.checkpoint_id);
      expect(ids).toHaveLength(2);
      expect(ids).not.toContain('c1');
      expect(() => hub.deps.writer.run(() => writeCheckpoint(hub.deps, 1))).toThrow(/transaction/);
    });

    // An order kept over the close (§3.3): placed before the close, served after it.
    async function keptOverClose(): Promise<{ closeAt: number; servedAt: number }> {
      await open();
      hub.clock.set(OPEN);
      append([anEngineConfigApplied(), aBusinessDayOpened()]);
      append(anOrderBatch());
      const closeAt = OPEN + 60 * MIN; // "23:00"
      hub.clock.set(closeAt);
      append([aBusinessDayClosed()]);
      expect(checkpointsOf(hub.deps.db)).toEqual([]);
      expect(hostFlags.checkpoint_pending).toBe(true);
      const servedAt = closeAt + 20 * MIN; // "23:20"
      hub.clock.set(servedAt);
      append([{ ...anOrderBatch()[0]!, event_type: 'ItemServed', payload: { order_item_ids: ['L1'], source: 'tap' } } as PosEvent]);
      return { closeAt, servedAt };
    }

    it('[03a #112] served at 23:20; at 23:50, after a pass with no listed event, the deferred checkpoint is written while the order is still in state.orders', async () => {
      const { servedAt } = await keptOverClose();
      const before = servedAt + 29 * MIN; // "23:49": still in the engine
      hub.clock.set(before);
      checkpointAfterPass(hub.deps, before);
      await nextImmediate();
      expect(checkpointsOf(hub.deps.db)).toEqual([]);
      expect(hostFlags.checkpoint_pending).toBe(true);

      const at = servedAt + 30 * MIN; // "23:50"
      hub.clock.set(at);
      expect(isOrderInEngine(engine(), 'O1', at)).toBe(false);
      checkpointAfterPass(hub.deps, at);
      // Scheduled, not written in the pass: a commit before the callback is inside the checkpoint's last_seq. It is not
      // a listed event, so no removal step runs (§3.3) and the order stays in state.orders.
      expect(checkpointsOf(hub.deps.db)).toEqual([]);
      append([anItemMadeUnavailable()]);
      await nextImmediate();
      const rows = checkpointsOf(hub.deps.db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ last_seq: hub.deps.writer.lastSeq(), taken_at: at });
      expect(JSON.parse(rows[0]!.body_json)).toEqual(JSON.parse(JSON.stringify(toCheckpoint(engine(), hub.deps.writer.lastSeq()))));
      expect(Object.keys(engine().orders)).toEqual(['O1']);
      expect(hostFlags.checkpoint_pending).toBe(false);
      // At most one per business day.
      checkpointAfterPass(hub.deps, at + MIN);
      await nextImmediate();
      expect(checkpointsOf(hub.deps.db)).toHaveLength(1);
    });

    it('[03a §3.12 checkpoint] a BusinessDayOpened commit before the deferred write clears the flag and the previous checkpoint stands', async () => {
      const { servedAt } = await keptOverClose();
      insertCheckpoint(hub.deps.db, { id: 'prev', taken_at: WALL - 1, last_seq: 0 });
      hub.clock.set(servedAt + MIN);
      append([aBusinessDayOpened({ payload: { business_date: '2025-10-21' } })]);
      expect(hostFlags.checkpoint_pending).toBe(false);
      const at = servedAt + 30 * MIN;
      hub.clock.set(at);
      checkpointAfterPass(hub.deps, at);
      await nextImmediate();
      expect(checkpointsOf(hub.deps.db).map((r) => r.checkpoint_id)).toEqual(['prev']);
    });

    it('[03a §3.12 checkpoint] an open committed between the schedule and its callback: the callback writes nothing', async () => {
      const { servedAt } = await keptOverClose();
      const at = servedAt + 30 * MIN;
      hub.clock.set(at);
      checkpointAfterPass(hub.deps, at);
      append([aBusinessDayOpened({ payload: { business_date: '2025-10-21' } })]);
      await nextImmediate();
      expect(checkpointsOf(hub.deps.db)).toEqual([]);
      expect(hostFlags.checkpoint_pending).toBe(false);
    });
  });

  // ------------------------------------------------------------------------------------------------ §7.1 snapshot
  describe('[03a §7.1 snapshot] the full write on the peak state', () => {
    let peak: { state: EngineState; lines: number; seq: number } | null = null;
    beforeAll(() => {
      // P-12: the normal peak day of seed 7 (AD-27), its state with the most lines (task 18's snapshot row). States are
      // immutable, so the peak is kept by reference.
      let best = -1;
      runDay(generateDay(7), {
        watch: (state, seq) => {
          const n = Object.keys(state.lines).length;
          if (n > best) {
            best = n;
            peak = { state, lines: n, seq };
          }
        },
      });
    }, 300_000);

    it('[03a §7.1 snapshot] serialise + insert in its own transaction ≤ 50 ms at design size (every sample)', async () => {
      await open();
      const p = peak!;
      expect(p.lines).toBeGreaterThanOrEqual(1_000);
      hub.deps.state.swap(p.state);
      const ms: number[] = [];
      for (let i = 0; i < SNAPSHOT_SAMPLES; i += 1) {
        hub.clock.advance(1);
        const a = performance.now();
        writeSnapshotSync(hub.deps);
        ms.push(performance.now() - a);
      }
      const rows = snapshotsOf(hub.deps.db);
      expect(rows).toHaveLength(2);
      const bytes = rows[1]!.state_json.length;
      const sorted = [...ms].sort((x, y) => x - y);
      // For the status board's §7.1 row.
      console.info(`[03a §7.1 snapshot] ${JSON.stringify({ samples: ms.map((x) => Math.round(x * 10) / 10), p50: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1], bytes, lines: p.lines, seq: p.seq })}`);
      expect(Math.max(...ms)).toBeLessThanOrEqual(SNAPSHOT_MS);
    });
  });
});
