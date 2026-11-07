import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { applyEvents, buildEngineState, ENGINE_REPLAY_EVENTS, ENGINE_STATE_VERSION, getTickIntents, initialEngineState, toCheckpoint, type EngineState } from '@pos/engine';
import { generateDay, runDay } from '@pos/engine/sim';
import type { EventDraft, PosEvent } from '@pos/events';
import {
  aBusinessDayClosed,
  aBusinessDayOpened,
  anAlertClosed,
  anAlertRaised,
  anEngineConfigApplied,
  anItemDone,
  anItemMadeAvailable,
  anItemMadeUnavailable,
  anOrderBatch,
  anOrderLinesAdded,
  aStockAdded,
  aStockConsumed,
  aStockReleased,
  aStockReserved,
  aStockSet,
} from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { engineStep2, engineStep3, engineStep6, readStockVersion, registerEngineBootSteps, replayEngine } from '../../src/engine-host/boot-steps';
import { hostFlags } from '../../src/engine-host/host-flags';
import { engineReducer, foldEngineBatch, touchedStations } from '../../src/engine-host/reducer';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { boot, registerBootStep, type BootContext, type BootHandle } from '../../src/lib/boot';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { setStockVersion, STOCK_VERSION_EVENTS, stockVersion } from '../../src/sync/stock-version';
import { freshDb } from '../helpers/db';
import { createLogCapture } from '../helpers/log-capture';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';

const WALL = 1_761_000_000_000;
const BRANCH = 'branch-1';
const TENANT = 'tenant-a';
const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

registerEngineBootSteps(() => performance.now());
registerRestaurantBootSteps();

// The hook of H-1's test: what step 6 left in the context, read after engine's step 6.
let lastCtx: BootContext | undefined;
registerBootStep('6', (ctx) => {
  lastCtx = ctx;
});

function writeConfig(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-engine-boot-'));
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
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const eventIdOf = (seq: number): string => `01J${String(seq).padStart(23, '0')}`;

// The same events as the log will hold them: this branch, the seqs from `first` on (a line's reserved_seq reads seq).
function stamped(events: readonly PosEvent[], first: number): PosEvent[] {
  return events.map((event, i) => ({ ...event, tenant_id: TENANT, branch_id: BRANCH, seq: first + i, event_id: eventIdOf(first + i) }));
}

function insertRaw(db: Database.Database, events: readonly PosEvent[]): void {
  const insert = db.prepare(
    `INSERT INTO events (event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
       schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const e of events) {
      insert.run(e.event_id, e.tenant_id, e.branch_id, e.stream_type, e.stream_id, e.event_type, e.schema_version, JSON.stringify(e.payload), e.occurred_at, e.recorded_at, e.actor_id, e.device_id, e.seq);
    }
  })();
}

function stateJson(state: EngineState): string {
  const stored: Partial<EngineState> = { ...state };
  delete stored.diagnostics;
  return JSON.stringify(stored);
}

function insertSnapshot(db: Database.Database, o: { id: string; taken_at: number; last_seq: number; engine_version?: number; state_json: string }): void {
  db.prepare(
    `INSERT INTO engine_snapshots (snapshot_id, branch_id, taken_at, last_seq, engine_version, state_json) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(o.id, BRANCH, o.taken_at, o.last_seq, o.engine_version ?? ENGINE_STATE_VERSION, o.state_json);
}

function insertCheckpoint(db: Database.Database, o: { id: string; taken_at: number; last_seq: number; checkpoint_schema?: number; body_json: string }): void {
  db.prepare(
    `INSERT INTO engine_checkpoints (checkpoint_id, branch_id, taken_at, last_seq, checkpoint_schema, body_json) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(o.id, BRANCH, o.taken_at, o.last_seq, o.checkpoint_schema ?? 1, o.body_json);
}

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

type LogLine = Record<string, unknown> & { level: number; msg?: string };
function linesOf(text: string): LogLine[] {
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LogLine);
}

// Records what really runs: every statement's SQL, method and arguments (statementCounter does not see iterate).
interface Recorded { sql: string; method: string; args: unknown[] }
function recorder(db: Database.Database): { calls: Recorded[]; stop(): void } {
  const calls: Recorded[] = [];
  const prepare = db.prepare;
  db.prepare = ((sql: string) => {
    const statement = prepare.call(db, sql);
    for (const method of ['get', 'all', 'run', 'iterate'] as const) {
      const original = (statement[method] as (...args: unknown[]) => unknown).bind(statement);
      (statement as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        calls.push({ sql, method, args });
        return original(...args);
      };
    }
    return statement;
  }) as typeof db.prepare;
  return {
    calls,
    stop() {
      db.prepare = prepare;
    },
  };
}

describe('03a boot steps 2, 3, 6 and the engine reducer', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  // A first boot migrates the file and leaves HubStarted at seq 1; `prepare` writes what the next boot finds.
  async function restart(prepare: (db: Database.Database, next: number) => void, wall = WALL + 60_000): Promise<{ booted: BootHandle; logs: () => LogLine[] }> {
    const cfg = writeConfig();
    cleanups.push(cfg.cleanup);
    const first = await boot({ configPath: cfg.path, wallNow: () => WALL, monoNow: () => 0, ifaces: ['192.168.10.2'], configClient: stubConfigCloud(), logStream: quiet() });
    prepare(first.deps.db, first.deps.writer.lastSeq() + 1);
    await first.stop();
    const capture = createLogCapture();
    setStockVersion(-1);
    const booted = await boot({ configPath: cfg.path, wallNow: () => wall, monoNow: () => 0, ifaces: ['192.168.10.2'], configClient: stubConfigCloud(), logStream: capture.stream });
    cleanups.push(() => booted.stop());
    return { booted, logs: () => linesOf(capture.text()) };
  }
  function quiet(): Writable {
    return new Writable({ write: (_chunk, _enc, done) => done() });
  }
  const engine = (booted: BootHandle) => booted.deps.state.get();
  const bootLine = (logs: LogLine[], step: string) => logs.find((l) => l.step === step && 'events_replayed' in l);
  const skipLines = (logs: LogLine[]) => logs.filter((l) => l.msg === 'engine boot: unreadable row skipped');

  async function migrated(): Promise<Database.Database> {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    await runMigrations(fx.db, { dir: migrations, clock: fixedClock(T) });
    return fx.db;
  }
  function ctxOf(db: Database.Database): BootContext {
    return { db, config: { provisioned: { branch_id: BRANCH, tenant_id: TENANT, branch_name: 'Main', branch_api_key: 'k' } } } as unknown as BootContext;
  }

  let simEvents: PosEvent[] = [];
  beforeAll(() => {
    simEvents = runDay(generateDay(7)).events.slice(0, 1_600);
  }, 180_000);
  const lateWall = () => Math.max(WALL, simEvents[simEvents.length - 1]!.recorded_at) + 60_000;

  describe('[03a #57] the base of the replay', () => {
    it('[03a #57] a v3 snapshot is loaded and only the events after its last_seq are replayed; the state equals a full replay', async () => {
      let whole: EngineState = initialEngineState();
      const { booted, logs } = await restart((db, next) => {
        const log = stamped(simEvents, next);
        insertRaw(db, log);
        const at = next + 1_099;
        insertSnapshot(db, { id: 's1', taken_at: WALL, last_seq: at, state_json: stateJson(buildEngineState(log.slice(0, 1_100), { strict: false })) });
        whole = buildEngineState(log, { strict: false });
      }, lateWall());
      expect(engine(booted)).toEqual({ ...whole, diagnostics: [] });
      expect(bootLine(logs(), '3')).toMatchObject({ snapshot_seq: 1_100 + 1, checkpoint_seq: null, events_replayed: 500 });
      expect(hostFlags.snapshot_loaded).toBe(true);
    });

    it('[03a #57] a v2 snapshot is skipped → the checkpoint → a one-day replay', async () => {
      const opened = aBusinessDayOpened();
      const { booted, logs } = await restart((db, next) => {
        const day1 = stamped([aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 5, unit: 'piece' } })], next);
        insertRaw(db, day1);
        const held = buildEngineState(day1, { strict: false });
        insertCheckpoint(db, { id: 'c1', taken_at: WALL, last_seq: next, body_json: JSON.stringify(toCheckpoint(held, next)) });
        insertSnapshot(db, { id: 's-old', taken_at: WALL, last_seq: next, engine_version: 2, state_json: '{"stock":{}}' });
        insertRaw(db, stamped([opened, aStockAdded({ stream_id: 'K1', payload: { stock_item_id: 'K1', quantity: 2, unit: 'piece' } })], next + 1));
      });
      const logged = logs();
      expect(skipLines(logged)).toEqual([expect.objectContaining({ table: 'engine_snapshots', id: 's-old', reason: 'engine_version', found: 2 })]);
      expect(bootLine(logged, '3')).toMatchObject({ snapshot_seq: null, checkpoint_seq: 2, events_replayed: 2 });
      expect(engine(booted).stock.K1).toMatchObject({ on_hand: 7 });
      expect(engine(booted).business_day?.business_date).toBe(opened.payload.business_date);
      expect(hostFlags.snapshot_loaded).toBe(false);
    });

    it('[03a #57] no snapshot and no checkpoint → a replay from seq 0', async () => {
      const { booted, logs } = await restart((db, next) => {
        insertRaw(db, stamped([aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 5, unit: 'piece' } })], next));
      });
      expect(bootLine(logs(), '3')).toMatchObject({ snapshot_seq: null, checkpoint_seq: null, events_replayed: 1 });
      expect(engine(booted).stock.K1).toMatchObject({ on_hand: 5 });
    });
  });

  describe('[03a Review Focus 5] a row this build cannot read', () => {
    const live = aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 5, unit: 'piece' } });
    const good = (stock: number): string =>
      stateJson({ ...initialEngineState(), stock: { K9: { on_hand: stock, reserved: 0, set_at: WALL, unit: 'piece' } } });

    it('[03a Review Focus 5] engine_version 4 newest → one log line, the v3 row is used, boot completes', async () => {
      const { booted, logs } = await restart((db, next) => {
        insertRaw(db, stamped([live], next));
        insertSnapshot(db, { id: 'v3', taken_at: WALL, last_seq: next, state_json: good(3) });
        insertSnapshot(db, { id: 'v4', taken_at: WALL + 5, last_seq: next, engine_version: 4, state_json: '{"from":"the future"}' });
      });
      expect(skipLines(logs())).toEqual([expect.objectContaining({ table: 'engine_snapshots', id: 'v4', reason: 'engine_version', found: 4 })]);
      expect(engine(booted).stock.K9).toMatchObject({ on_hand: 3 });
      expect(booted.step()).toBe('8');
    });

    it('[03a Review Focus 5] two engine_version 4 rows never hide a v3 row (a statement keeps LIMIT 2)', async () => {
      const db = await migrated();
      insertSnapshot(db, { id: 'v3', taken_at: WALL, last_seq: 0, state_json: good(3) });
      insertSnapshot(db, { id: 'v4a', taken_at: WALL + 5, last_seq: 0, engine_version: 4, state_json: '{}' });
      insertSnapshot(db, { id: 'v4b', taken_at: WALL + 6, last_seq: 0, engine_version: 4, state_json: '{}' });
      const ctx = ctxOf(db);
      engineStep2(ctx);
      engineStep3(ctx);
      expect((ctx.initialState as EngineState).stock.K9).toMatchObject({ on_hand: 3 });
    });

    it('[03a Review Focus 5] checkpoint_schema 2 → one log line, the fallback (seq 0), boot completes', async () => {
      const { booted, logs } = await restart((db, next) => {
        insertRaw(db, stamped([live], next));
        insertCheckpoint(db, { id: 'c2', taken_at: WALL, last_seq: next, checkpoint_schema: 2, body_json: '{"checkpoint_schema":2}' });
      });
      expect(skipLines(logs())).toEqual([expect.objectContaining({ table: 'engine_checkpoints', id: 'c2', reason: 'checkpoint_schema', found: 2 })]);
      expect(bootLine(logs(), '3')).toMatchObject({ checkpoint_seq: null, events_replayed: 1 });
      expect(engine(booted).stock.K1).toMatchObject({ on_hand: 5 });
      expect(booted.step()).toBe('8');
    });

    it('[03a Review Focus 5] a truncated state_json → one log line, the second row is used', async () => {
      const { booted, logs } = await restart((db, next) => {
        insertRaw(db, stamped([live], next));
        insertSnapshot(db, { id: 'older', taken_at: WALL, last_seq: next, state_json: good(2) });
        insertSnapshot(db, { id: 'torn', taken_at: WALL + 5, last_seq: next, state_json: good(4).slice(0, 20) });
      });
      expect(skipLines(logs())).toEqual([expect.objectContaining({ table: 'engine_snapshots', id: 'torn', reason: 'unreadable' })]);
      expect(engine(booted).stock.K9).toMatchObject({ on_hand: 2 });
      expect(booted.step()).toBe('8');
    });

    it('[03a Review Focus 5] a truncated body_json → one log line, fallback to seq 0', async () => {
      const { booted, logs } = await restart((db, next) => {
        insertRaw(db, stamped([live], next));
        insertCheckpoint(db, { id: 'torn', taken_at: WALL, last_seq: next, body_json: '{"checkpoint_schema":1,"sto' });
      });
      expect(skipLines(logs())).toEqual([expect.objectContaining({ table: 'engine_checkpoints', id: 'torn', reason: 'unreadable' })]);
      expect(engine(booted).stock.K1).toMatchObject({ on_hand: 5 });
    });

    it.each([
      ['a last u > 0', { t: [10, 20], u: [1, 2] }],
      ['a first u = 0', { t: [10, 20], u: [0, 0] }],
      ['equal neighbours', { t: [10, 20, 30], u: [1, 1, 0] }],
      ['t not increasing', { t: [20, 20], u: [1, 0] }],
      ['lengths differ', { t: [10, 20], u: [1] }],
      ['a negative u', { t: [10, 20, 30], u: [1, -1, 0] }],
      ['a fractional boundary', { t: [10.5, 20], u: [1, 0] }],
    ])('[03a task 4 carried] a snapshot whose profile has %s is skipped like a truncated row', async (_name, profile) => {
      const station = { station_id: 'S1', type: 'slot', capacity: 4, capacity_override: null, paused: false, profile, unfired: [], loads: {} };
      const { booted, logs } = await restart((db, next) => {
        insertRaw(db, stamped([live], next));
        insertSnapshot(db, { id: 'bad', taken_at: WALL, last_seq: next, state_json: stateJson({ ...initialEngineState(), stations: { S1: station } } as unknown as EngineState) });
      });
      expect(skipLines(logs())).toEqual([expect.objectContaining({ table: 'engine_snapshots', id: 'bad', reason: 'unreadable' })]);
      expect(engine(booted).stations).toEqual({});
      expect(engine(booted).stock.K1).toMatchObject({ on_hand: 5 });
    });

    it('[03a §3.12] valid JSON of the wrong shape is skipped too; a loaded state gets diagnostics: []', async () => {
      const db = await migrated();
      insertSnapshot(db, { id: 'shape', taken_at: WALL + 5, last_seq: 0, state_json: '{"stock":[]}' });
      insertSnapshot(db, { id: 'good', taken_at: WALL, last_seq: 0, state_json: good(1) });
      const ctx = ctxOf(db);
      engineStep2(ctx);
      engineStep3(ctx);
      const state = ctx.initialState as EngineState;
      expect(state.stock.K9).toMatchObject({ on_hand: 1 });
      expect(state.diagnostics).toEqual([]);
    });
  });

  describe('[03a #58] only the four lists are read', () => {
    function mixedLog(next: number): PosEvent[] {
      return stamped(
        [
          aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 5, unit: 'piece' } }),
          { ...aStockSet(), stream_type: 'audit', stream_id: 'A1', event_type: 'SessionStarted', payload: {} } as PosEvent,
          anAlertRaised({ stream_type: 'order', stream_id: 'O-other' }),
          anAlertClosed({ stream_type: 'order', stream_id: 'O-other', payload: { alert_id: 'not-a-slip' } }),
          aBusinessDayOpened({ stream_type: 'hub', stream_id: BRANCH }),
        ],
        next,
      );
    }

    it('[03a #58] an audit row and a non-slip order-stream alert change nothing; the reads name four streams, never audit', async () => {
      const db = await migrated();
      const log = mixedLog(1);
      insertRaw(db, log);
      const rec = recorder(db);
      const out = replayEngine(db, BRANCH, 0, initialEngineState(), () => undefined);
      rec.stop();
      expect(rec.calls.map((c) => c.args[1])).toEqual(['order', 'station', 'stock', 'hub']);
      for (const c of rec.calls) expect(c.sql).not.toContain('audit');
      // StockSet, the non-slip AlertClosed (on the order list, a no-op), BusinessDayOpened; never the audit row or AlertRaised
      expect(out.replayed).toBe(3);
      expect(out.state.slips).toEqual({});
      expect(out.state.stock.K1).toMatchObject({ on_hand: 5 });
    });

    it('[03a #58, §10.5] step 2 = 2, step 3 = 4 + 2, step 6 = 0 statements; the real statements use the index, no sort', async () => {
      const db = await migrated();
      const ctx = ctxOf(db);
      const rec = recorder(db);
      engineStep2(ctx);
      const step2 = rec.calls.splice(0);
      engineStep3(ctx);
      const step3 = rec.calls.splice(0);
      ctx.clock = fixedClock(T);
      engineStep6(ctx);
      const step6 = rec.calls.splice(0);
      rec.stop();
      expect(step2).toHaveLength(2);
      expect(step3).toHaveLength(6);
      expect(step6).toHaveLength(0);
      for (const c of step2) expect(c.sql).toMatch(/LIMIT 2/);
      const replay = step3.filter((c) => c.method === 'iterate');
      const version = step3.filter((c) => c.method !== 'iterate');
      expect(replay).toHaveLength(4);
      expect(version).toHaveLength(2);
      for (const c of replay) {
        const plan = (db.prepare(`EXPLAIN QUERY PLAN ${c.sql}`).all(...c.args) as Array<{ detail: string }>).map((r) => r.detail).join('\n');
        expect(plan).toContain('USING INDEX events_branch_stream (branch_id=? AND stream_type=? AND seq>?)');
        expect(plan).not.toContain('TEMP B-TREE');
      }
      for (const c of version) {
        const plan = (db.prepare(`EXPLAIN QUERY PLAN ${c.sql}`).all(...c.args) as Array<{ detail: string }>).map((r) => r.detail).join('\n');
        expect(plan).toContain('USING INDEX events_branch_stream (branch_id=? AND stream_type=?)');
        expect(plan).not.toContain('TEMP B-TREE');
      }
      // every list of ENGINE_REPLAY_EVENTS, each type in its own statement
      for (const [i, stream] of (['order', 'station', 'stock', 'hub'] as const).entries()) {
        for (const type of ENGINE_REPLAY_EVENTS[stream]) expect(replay[i]!.sql).toContain(`'${type}'`);
      }
    });

    it('[03a §3.12] the four statements merge by seq: a fold sees the log order across streams', async () => {
      const db = await migrated();
      // day opened (hub) → stock set (stock) → day closed (hub): closed_at must read the third event.
      insertRaw(db, stamped([aBusinessDayOpened({ recorded_at: 100 }), aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 5, unit: 'piece' }, recorded_at: 200 }), aBusinessDayClosed({ recorded_at: 300 })], 1));
      const out = replayEngine(db, BRANCH, 0, initialEngineState(), () => undefined);
      expect(out.replayed).toBe(3);
      expect(out.state.business_day).toMatchObject({ opened_at: 100, closed_at: 300 });
    });

    it('[03a AD-28] more than a chunk folds to the same state as one fold (and iterators are closed for the next statement)', async () => {
      const db = await migrated();
      const log = stamped(simEvents, 1);
      insertRaw(db, log);
      const out = replayEngine(db, BRANCH, 0, initialEngineState(), () => undefined);
      expect(out.replayed).toBe(log.filter((e) => [...ENGINE_REPLAY_EVENTS.order, ...ENGINE_REPLAY_EVENTS.station, ...ENGINE_REPLAY_EVENTS.stock, ...ENGINE_REPLAY_EVENTS.hub].includes(e.event_type as never)).length);
      expect(out.state).toEqual({ ...applyEvents(initialEngineState(), log, { strict: false }), diagnostics: [] });
      db.prepare('SELECT 1').get();
    });
  });

  it('[03a #64] crash restart of 500 events ≤ 2 s (steps 2–3)', async () => {
    const { logs } = await restart((db, next) => {
      const log = stamped(simEvents, next);
      insertRaw(db, log);
      insertSnapshot(db, { id: 's1', taken_at: WALL, last_seq: next + 1_099, state_json: stateJson(buildEngineState(log.slice(0, 1_100), { strict: false })) });
    }, lateWall());
    const two = bootLine(logs(), '2');
    const three = bootLine(logs(), '3');
    expect(three?.events_replayed).toBe(500);
    expect(three?.ms as number).toBeGreaterThan(0); // a real measurement, not the unset source
    expect((two?.ms as number) + (three?.ms as number)).toBeLessThanOrEqual(2_000);
  });

  describe('[03a #85, 01a A-17] stock_version', () => {
    it('[01a A-17] STOCK_VERSION_EVENTS: nine types, and the three new stock events are in it', () => {
      expect([...STOCK_VERSION_EVENTS].sort()).toEqual(
        ['BusinessDayClosed', 'BusinessDayOpened', 'ItemMadeAvailable', 'ItemMadeUnavailable', 'StockAdded', 'StockConsumed', 'StockReleased', 'StockReserved', 'StockSet'].sort(),
      );
    });

    const fullScan = (db: Database.Database): number => {
      const rows = db.prepare('SELECT seq, event_type FROM events WHERE branch_id = ? ORDER BY seq').all(BRANCH) as Array<{ seq: number; event_type: string }>;
      let version = 0;
      for (const row of rows) if (STOCK_VERSION_EVENTS.has(row.event_type)) version = row.seq;
      return version;
    };

    it.each([
      ['StockSet', aStockSet()],
      ['StockAdded', aStockAdded()],
      ['ItemMadeUnavailable', anItemMadeUnavailable()],
      ['ItemMadeAvailable', anItemMadeAvailable()],
      ['StockReserved', aStockReserved()],
      ['StockReleased', aStockReleased()],
      ['StockConsumed', aStockConsumed()],
      ['BusinessDayOpened', aBusinessDayOpened()],
      ['BusinessDayClosed', aBusinessDayClosed()],
    ])('[03a #85] %s newest: a snapshot boot reads the same version as a full scan', async (_type, event) => {
      let seq = 0;
      const { booted } = await restart((db, next) => {
        seq = next + 1;
        insertRaw(db, stamped([aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 1, unit: 'piece' } }), event], next));
        // every stock event sits below the snapshot's last_seq, where a replay cannot see it
        insertSnapshot(db, { id: 's1', taken_at: WALL, last_seq: seq, state_json: stateJson(initialEngineState()) });
      });
      expect(stockVersion()).toBe(seq);
      expect(stockVersion()).toBe(fullScan(booted.deps.db));
    });

    it('[03a #85] a later event off both lists leaves the version; an empty log reads 0', async () => {
      const db = await migrated();
      expect(readStockVersion(db, BRANCH)).toBe(0);
      insertRaw(db, stamped([aStockSet(), anAlertClosed({ stream_type: 'order', stream_id: 'O' }), aBusinessDayOpened(), anEngineConfigApplied()], 1));
      expect(readStockVersion(db, BRANCH)).toBe(3);
      expect(readStockVersion(db, BRANCH)).toBe(fullScan(db));
    });
  });

  describe('[00 H-1] ctx.clock and ctx.missedFires', () => {
    it('[00 H-1] ctx.clock is set after 3a; step 6 reads it for a dry count; step 8 writes it; boot writes no fire', async () => {
      let expected = 0;
      let before = 0;
      const { booted } = await restart((db, next) => {
        const log = stamped(simEvents, next);
        insertRaw(db, log);
        const state = buildEngineState(log, { strict: false });
        expected = getTickIntents(state, lateWall())
          .filter((d) => d.event_type === 'FireDispatched')
          .reduce((n, d) => n + (d.payload as { order_item_ids: string[] }).order_item_ids.length, 0);
        before = (db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'FireDispatched'`).pluck().get() as number);
      }, lateWall());
      expect(lastCtx?.clock).toBeDefined();
      expect(lastCtx?.clock?.branchNow()).toBe(booted.deps.clock.branchNow());
      expect(lastCtx?.missedFires).toBe(expected);
      expect(expected).toBeGreaterThan(0);
      const db = booted.deps.db;
      const started = db.prepare(`SELECT payload FROM events WHERE event_type = 'HubStarted' ORDER BY seq DESC LIMIT 1`).pluck().get() as string;
      expect((JSON.parse(started) as { missed_fires: number }).missed_fires).toBe(expected);
      expect(db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'FireDispatched'`).pluck().get()).toBe(before);
    });

    it('[03a invariant] a boot appends no engine event: only HubStarted', async () => {
      let lastBefore = 0;
      const { booted } = await restart((db, next) => {
        lastBefore = next - 1;
      });
      const after = booted.deps.db.prepare('SELECT event_type FROM events WHERE seq > ?').pluck().all(lastBefore);
      expect(after).toEqual(['HubStarted']);
    });
  });

  describe('[03a §3.12] step 6 flags', () => {
    it('[03a §3.12] closed day, checkpoint older than the close → checkpoint_pending and day_closed; reconcile set', async () => {
      await restart((db, next) => {
        insertCheckpoint(db, { id: 'old', taken_at: WALL - 10, last_seq: 0, body_json: JSON.stringify(toCheckpoint(initialEngineState(), 0)) });
        insertRaw(db, stamped([aBusinessDayOpened({ recorded_at: WALL }), aBusinessDayClosed({ recorded_at: WALL + 1 })], next));
      });
      expect(hostFlags).toMatchObject({ checkpoint_pending: true, day_closed: true, reconcile: true });
    });

    it('[03a §3.12] closed day, checkpoint at or after the close → not pending; day_closed stays', async () => {
      await restart((db, next) => {
        insertRaw(db, stamped([aBusinessDayOpened({ recorded_at: WALL }), aBusinessDayClosed({ recorded_at: WALL + 1 })], next));
        const body = toCheckpoint(buildEngineState(stamped([aBusinessDayOpened({ recorded_at: WALL }), aBusinessDayClosed({ recorded_at: WALL + 1 })], next), { strict: false }), next + 1);
        insertCheckpoint(db, { id: 'c', taken_at: WALL + 1, last_seq: next + 1, body_json: JSON.stringify(body) });
      });
      expect(hostFlags).toMatchObject({ checkpoint_pending: false, day_closed: true });
    });

    it('proposed (implementer): a closed day with no checkpoint read at all → pending', async () => {
      await restart((db, next) => {
        insertRaw(db, stamped([aBusinessDayOpened({ recorded_at: WALL }), aBusinessDayClosed({ recorded_at: WALL + 1 })], next));
      });
      expect(hostFlags).toMatchObject({ checkpoint_pending: true, day_closed: true });
    });

    it('[03a §3.12] an open day → neither flag', async () => {
      await restart((db, next) => {
        insertRaw(db, stamped([aBusinessDayOpened({ recorded_at: WALL })], next));
      });
      expect(hostFlags).toMatchObject({ checkpoint_pending: false, day_closed: false, reconcile: true });
    });
  });

  describe('[03a §7.2] logging', () => {
    const set = aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 5, unit: 'g' } });
    const breach = aStockAdded({ stream_id: 'K1', payload: { stock_item_id: 'K1', quantity: 1, unit: 'piece' } });

    it('[03a §7.2] a replayed breach is logged with replay: true at warn, once; the state holds no diagnostics', async () => {
      let id = '';
      const { booted, logs } = await restart((db, next) => {
        const log = stamped([set, breach], next);
        id = log[1]!.event_id;
        insertRaw(db, log);
      });
      const warns = logs().filter((l) => l.kind === 'stock_breach');
      expect(warns).toEqual([expect.objectContaining({ level: 40, event_id: id, stock_item_id: 'K1', on_hand: 5, reserved: 0, replay: true })]);
      expect(engine(booted).diagnostics).toEqual([]);
    });

    it('[03a §7.2] a boot log line per step: { step, snapshot_seq, checkpoint_seq, events_replayed, ms }', async () => {
      const { logs } = await restart(() => undefined);
      expect(bootLine(logs(), '2')).toMatchObject({ step: '2', snapshot_seq: null, checkpoint_seq: null, events_replayed: 0, ms: expect.any(Number) });
      expect(bootLine(logs(), '3')).toMatchObject({ step: '3', snapshot_seq: null, checkpoint_seq: null, events_replayed: 0, ms: expect.any(Number) });
    });

    it('[03a §3.3, §3.12] OrderLinesAdded on an absent order stops boot: the spec\'s throw', async () => {
      const cfg = writeConfig();
      cleanups.push(cfg.cleanup);
      const first = await boot({ configPath: cfg.path, wallNow: () => WALL, monoNow: () => 0, ifaces: ['192.168.10.2'], configClient: stubConfigCloud(), logStream: quiet() });
      insertRaw(first.deps.db, stamped([anOrderLinesAdded()], first.deps.writer.lastSeq() + 1));
      await first.stop();
      await expect(boot({ configPath: cfg.path, wallNow: () => WALL + 1_000, monoNow: () => 0, ifaces: ['192.168.10.2'], configClient: stubConfigCloud(), logStream: quiet() })).rejects.toThrow('OrderLinesAdded for order');
    });
  });

  describe('[03a AD-6, AD-28, P-7] the live fold', () => {
    let hub: TestHub;
    async function open(): Promise<TestHub> {
      hub = await createTestHub();
      cleanups.push(() => hub.close());
      return hub;
    }
    const warns = () => linesOf(hub.logs()).filter((l) => l.level === 40);
    const engineNow = () => hub.deps.state.get();
    const append = (events: PosEvent[]) => hub.deps.writer.run((tx) => tx.append(events.map(draftOf))).appended;

    it('[03a AD-28] a transaction is folded with one batch call, however many appends; a single reducer is not used', async () => {
      await open();
      const calls: number[] = [];
      const held = engineNow();
      hub.deps.state.setReducer(
        () => {
          throw new Error('the per-event reducer must not run');
        },
        (s, events) => {
          calls.push(events.length);
          return foldEngineBatch(s, events, () => 0);
        },
      );
      hub.deps.writer.run((tx) => {
        tx.append([aStockSet(), aStockSet()].map(draftOf));
        tx.append([draftOf(aStockAdded())]);
      });
      expect(calls).toEqual([3]);
      expect(engineNow()).not.toBe(held);
      expect(engineNow().stock.I1).toMatchObject({ on_hand: 15 });
    });

    it('[00 writer] a reducer given without a batch form still folds event by event', async () => {
      await open();
      const seen: string[] = [];
      hub.deps.state.setReducer((s, e) => {
        seen.push(e.event_type);
        return s;
      });
      append([aStockSet(), aStockAdded()]);
      expect(seen).toEqual(['StockSet', 'StockAdded']);
    });

    it('[03a AD-6] a live breach: warn after commit without replay, then cleared; a rollback logs nothing', async () => {
      await open();
      append([set(), breachEvent()]);
      const live = warns().filter((l) => l.kind === 'stock_breach');
      expect(live).toEqual([expect.objectContaining({ stock_item_id: 'K1', on_hand: 5, reserved: 0 })]);
      expect(live[0]).not.toHaveProperty('replay');
      expect(engineNow().diagnostics).toEqual([]);

      expect(() =>
        hub.deps.writer.run((tx) => {
          tx.append([draftOf(breachEvent())]);
          throw new Error('rolled back');
        }),
      ).toThrow('rolled back');
      expect(warns().filter((l) => l.kind === 'stock_breach')).toHaveLength(1);
    });

    it('[03a §3.3] OrderLinesAdded on an absent order throws in the live fold and rolls the transaction back', async () => {
      await open();
      const seq = hub.deps.writer.lastSeq();
      expect(() => append([anOrderLinesAdded()])).toThrow('OrderLinesAdded for order');
      expect(hub.deps.db.prepare('SELECT COALESCE(MAX(seq), 0) FROM events').pluck().get()).toBe(seq);
    });

    it('[03a §3.3] an absent-id fold is logged once { event_type, order_id, order_item_id } and commits', async () => {
      await open();
      const done = anItemDone({ stream_id: 'O-gone', payload: { order_item_id: 'L-gone' } });
      const [committed] = append([done]);
      expect(committed?.seq).toBeGreaterThan(0);
      const lines = warns().filter((l) => l.event_type === 'ItemDone');
      expect(lines).toEqual([expect.objectContaining({ event_type: 'ItemDone', order_id: 'O-gone', order_item_id: 'L-gone' })]);
    });

    it('[03a §3.3] a line added earlier in the same transaction is not absent; a served list logs only its absent ids', async () => {
      await open();
      append([anEngineConfigApplied()]);
      append([...anOrderBatch({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] }), anItemDone({ stream_id: 'O1', payload: { order_item_id: 'L1' } })]);
      expect(warns().filter((l) => 'order_item_id' in l && l.msg === 'engine fold: absent id')).toEqual([]);
      append([
        {
          ...anItemDone({ stream_id: 'O1' }),
          event_type: 'ItemServed',
          payload: { order_item_ids: ['L1', 'L-gone'], source: 'tap' },
        } as PosEvent,
      ]);
      const absent = warns().filter((l) => l.msg === 'engine fold: absent id');
      expect(absent).toEqual([expect.objectContaining({ event_type: 'ItemServed', order_id: 'O1', order_item_id: 'L-gone' })]);
    });

    it('[03a §7.1, P-7] a slow fold warns { event_type, station_id, lines, ms } per touched station, a fast one does not', async () => {
      await open();
      append([anEngineConfigApplied()]);
      expect(warns().filter((l) => l.msg === 'engine fold: slow re-plan')).toEqual([]);
      let t = 0;
      const fake = () => {
        t += 60;
        return t;
      };
      hub.deps.state.setReducer(engineReducer, (s, events) => foldEngineBatch(s, events, fake));
      append(anOrderBatch({ order_id: 'O1', lines: [{ order_item_id: 'L1' }] }));
      const slow = warns().filter((l) => l.msg === 'engine fold: slow re-plan');
      expect(slow).toEqual([expect.objectContaining({ event_type: 'OrderPlaced', station_id: 'S1', lines: 1, ms: 60 })]);
    });

    it('[03a AD-6] a repeating reserve_fallback is logged once per line', async () => {
      await open();
      const diag = { kind: 'reserve_fallback' as const, event_id: 'e', order_item_id: 'L9', station_id: 'S1', detail: { capacity: 1, reserve_units: 1 } };
      hub.deps.state.setReducer(engineReducer, (s) => ({ ...s, diagnostics: [diag, diag] }));
      append([aStockSet()]);
      append([aStockSet()]);
      expect(warns().filter((l) => l.kind === 'reserve_fallback')).toHaveLength(1);
      expect(engineNow().diagnostics).toEqual([]);
    });

    it('[03a P-7] touchedStations finds the copied stations by reference', () => {
      const station = { station_id: 'S1', type: 'slot' as const, capacity: 1, capacity_override: null, paused: false, profile: { t: [], u: [] }, unfired: [], loads: {} };
      const prev = { ...initialEngineState(), stations: { S1: station, S2: { ...station, station_id: 'S2' } } };
      const next = { ...prev, stations: { ...prev.stations, S2: { ...prev.stations.S2, paused: true }, S3: { ...station, station_id: 'S3' } } };
      expect(touchedStations(prev, next).sort()).toEqual(['S2', 'S3']);
      expect(touchedStations(prev, prev)).toEqual([]);
    });

    const set = () => aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 5, unit: 'g' } });
    const breachEvent = () => aStockAdded({ stream_id: 'K1', payload: { stock_item_id: 'K1', quantity: 1, unit: 'piece' } });
  });

  it('[03a §6.3] main.ts registers the engine boot steps', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8');
    expect(source).toMatch(/import \{ registerEngineBootSteps \} from '\.\/engine-host\/boot-steps\.js';/);
    expect(source.indexOf('registerEngineBootSteps(monoNow)')).toBeGreaterThan(-1);
    expect(source.indexOf('registerEngineBootSteps(monoNow)')).toBeLessThan(source.indexOf('boot({'));
  });
});
