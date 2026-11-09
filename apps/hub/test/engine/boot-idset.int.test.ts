// Engine-lane boot tests (02p tasks 15, 17), kept out of boot.int.test.ts (platform A's file).
// 01a v2.3 #194 third clause (02p M-6): the boot fold counts StockTransferredOut — 03a v1.2 Q-5 puts it on
// ENGINE_REPLAY_EVENTS.stock, so step 3's stock statement reads it and the replayed state lowers on_hand as live does.
import { fileURLToPath } from 'node:url';
import { applyEvents, initialEngineState, ORDER_EXIT_AFTER_SERVED_MS, stockOf, toCheckpoint, type Diagnostic, type EngineState } from '@pos/engine';
import type { PosEvent } from '@pos/events';
import { aBusinessDayClosed, aBusinessDayOpened, anEngineConfigApplied, anOrderBatch, aStockSet } from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { engineStep2, engineStep3, replayEngine } from '../../src/engine-host/boot-steps';
import { hostFlags } from '../../src/engine-host/host-flags';
import { afterEngineCommit, foldEngineBatch } from '../../src/engine-host/reducer';
import type { StateHolder } from '../../src/engine-host/state-holder';
import type { BootContext } from '../../src/lib/boot';
import { ABSENT_ID, dealOrder, emptyOrder, readyAdded, readyShapes, served, voided, zoneAdded, zoneAndDealShapes } from './q3-lines';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

const BRANCH = 'branch-1';
const TENANT = 'tenant-a';
const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

const eventIdOf = (seq: number): string => `01J${String(seq).padStart(23, '0')}`;
const stamped = (events: readonly PosEvent[], first: number): PosEvent[] =>
  events.map((event, i) => ({ ...event, tenant_id: TENANT, branch_id: BRANCH, seq: first + i, event_id: eventIdOf(first + i), recorded_at: T + i, occurred_at: T + i }));

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

const count = (id: string, on_hand: number): PosEvent => aStockSet({ stream_id: id, payload: { stock_item_id: id, on_hand, unit: 'piece' } });
const transferred = (id: string, quantity: number): PosEvent =>
  aStockSet({ event_type: 'StockTransferredOut', schema_version: 1, stream_id: id, payload: { stock_item_id: id, quantity, zone_id: 'Z1' } });

describe('03a boot step 3: the engine-lane id sets', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  async function migrated(): Promise<Database.Database> {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    await runMigrations(fx.db, { dir: migrations, clock: fixedClock(T) });
    return fx.db;
  }

  it('[01a #194] the boot fold counts StockTransferredOut', async () => {
    const db = await migrated();
    // K1 counted 5, 2 moved to a zone, then 4 more (clamps at 0, a breach); an item never counted moves 1 (a breach, no entry).
    const log = stamped([count('K1', 5), transferred('K1', 2), count('K2', 7), transferred('K2', 3), transferred('K1', 4), transferred('NEVER_SEEN', 1)], 1);
    insertRaw(db, log);
    const reported: Diagnostic[] = [];
    const out = replayEngine(db, BRANCH, 0, initialEngineState(), (d) => reported.push(d));
    expect(out.replayed).toBe(log.length);
    expect(stockOf(out.state, 'K1').on_hand).toBe(0);
    expect(stockOf(out.state, 'K2').on_hand).toBe(4);
    expect(out.state.stock.NEVER_SEEN).toBeUndefined();
    expect(reported.map((d) => [d.kind, d.event_id])).toEqual([
      ['stock_breach', log[4]!.event_id],
      ['stock_breach', log[5]!.event_id],
    ]);
    // Boot = live: the same state as folding the log in the hub's non-strict mode.
    expect({ ...out.state, diagnostics: [] }).toEqual({ ...applyEvents(initialEngineState(), log, { strict: false }), diagnostics: [] });
  });

  // ---- 03a v1.2 Q-3, R-3, AD-E18 (02p task 15): the host id set at boot -------------------------------------------

  // Keeps each event's recorded_at; stamps this branch and the seqs from `first` on.
  const seqd = (events: readonly PosEvent[], first: number): PosEvent[] =>
    events.map((event, i) => ({ ...event, tenant_id: TENANT, branch_id: BRANCH, seq: first + i, event_id: eventIdOf(first + i) }));
  const at = (events: readonly PosEvent[], t: number): PosEvent[] => events.map((e) => ({ ...e, recorded_at: t, occurred_at: t }));
  const DAY = 86_400_000;

  // §3.12 "Q-3 id set at boot": day D−1 (an order O0 with a zone line Z0, closed → checkpoint C0); day D: O1 with deal
  // header H1 (parts P1, P2) and zone line Z1, O2 a ready-items-only order (R1, AD-E18); P1, P2 served; O1 leaves the
  // engine with its bill unpaid; BusinessDayClosed → checkpoint C, last_seq after H1, Z1 and O2.
  function q3Log(): { log: PosEvent[]; c0: number; c: number } {
    const before = [
      ...at([anEngineConfigApplied()], T),
      ...at([aBusinessDayOpened({ payload: { business_date: '2025-10-19' } })], T + 1),
      ...at([...anOrderBatch({ order_id: 'O0', lines: [{ order_item_id: 'L0' }] }), zoneAdded('O0', 'Z0')], T + 2),
      ...at([aBusinessDayClosed()], T + 3),
    ];
    const dayD = [
      ...at([aBusinessDayOpened({ payload: { business_date: '2025-10-20' } })], T + DAY),
      ...at([...dealOrder('O1', 'H1', ['P1', 'P2'], T + DAY + 1), zoneAdded('O1', 'Z1')], T + DAY + 1),
      ...at([emptyOrder('O2', T + DAY + 2), readyAdded('O2', 'R1')], T + DAY + 2),
      ...at([served('O1', ['P1', 'P2'], 'tap')], T + DAY + 3),
      ...at([aBusinessDayClosed()], T + DAY + 3 + ORDER_EXIT_AFTER_SERVED_MS + 1),
    ];
    const log = seqd([...before, ...dayD], 1);
    return { log, c0: before.length, c: log.length };
  }

  const checkpointRow = (db: Database.Database, id: string, log: PosEvent[], last_seq: number, torn = false): void => {
    const body = JSON.stringify(toCheckpoint(applyEvents(initialEngineState(), log.slice(0, last_seq), { strict: false }), last_seq));
    db.prepare(
      `INSERT INTO engine_checkpoints (checkpoint_id, branch_id, taken_at, last_seq, checkpoint_schema, body_json) VALUES (?, ?, ?, ?, 1, ?)`,
    ).run(id, BRANCH, log[last_seq - 1]!.recorded_at, last_seq, torn ? body.slice(0, 25) : body);
  };

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
    return { calls, stop: () => void (db.prepare = prepare) };
  }

  const ctxOf = (db: Database.Database): BootContext =>
    ({ db, config: { provisioned: { branch_id: BRANCH, tenant_id: TENANT, branch_name: 'Main', branch_api_key: 'k' } } }) as unknown as BootContext;

  type Case = 'one' | 'two readable' | 'newer torn';
  // Boot steps 2 and 3 on the log and the case's checkpoint rows, then each later event in its own commit through the
  // host's after-commit hook (the live writer's path): what the absent-id log says.
  async function restart(kind: Case, later: (log: PosEvent[]) => PosEvent[][]) {
    const db = await migrated();
    const { log, c0, c } = q3Log();
    insertRaw(db, log);
    if (kind !== 'one') checkpointRow(db, 'c0', log, c0);
    checkpointRow(db, 'c', log, c, kind === 'newer torn');
    hostFlags.untrackedLineIds.add('from-before-the-restart');
    const ctx = ctxOf(db);
    const rec = recorder(db);
    engineStep2(ctx);
    rec.calls.splice(0);
    engineStep3(ctx);
    const step3 = rec.calls.splice(0);
    rec.stop();
    let state = ctx.initialState as EngineState;
    const holder = { get: () => state, swap: (s: EngineState) => void (state = s) } as unknown as StateHolder<EngineState>;
    const warns: Array<Record<string, unknown>> = [];
    const log2 = { warn: (obj: Record<string, unknown>, msg: string) => void (msg === ABSENT_ID && warns.push(obj)) };
    let seq = c;
    for (const batch of later(log)) {
      const events = seqd(at(batch, T + 2 * DAY), seq + 1);
      seq += events.length;
      state = foldEngineBatch(state, events, () => 0);
      afterEngineCommit(holder, log2, events);
    }
    const read = step3.filter((s) => /json_array_length/.test(s.sql));
    return { db, step3, read, warns, c0, c, ids: new Set(hostFlags.untrackedLineIds) };
  }
  const afterRestart = (): PosEvent[][] => [...zoneAndDealShapes('O1', 'Z1', 'H1'), ...readyShapes('O2', 'R1')].map((e) => [e]);

  describe('[03a #125] restart from a checkpoint: no false warn (§3.12 sequence)', () => {
    it('[03a #125] one checkpoint C only → the read starts at seq 0; no false warn', async () => {
      const r = await restart('one', afterRestart);
      expect(r.read).toHaveLength(1);
      expect(r.read[0]!.args).toEqual([BRANCH, 0]);
      expect(r.warns).toEqual([]);
      expect(r.ids.has('from-before-the-restart')).toBe(false);
      for (const id of ['Z0', 'Z1', 'H1', 'O2']) expect(r.ids.has(id), id).toBe(true);
    });

    it('[03a #125] two readable checkpoints → the read starts at the older last_seq; no false warn', async () => {
      const r = await restart('two readable', afterRestart);
      expect(r.read[0]!.args).toEqual([BRANCH, r.c0]);
      expect(r.warns).toEqual([]);
      expect([...r.ids].sort()).toEqual(['H1', 'O2', 'Z1']);
    });

    it('[03a #125] two with the newer one torn → boot restores from the older, the read starts at seq 0; no false warn', async () => {
      const r = await restart('newer torn', afterRestart);
      // Restored from the older row: the replay statements start at C0's last_seq.
      expect(r.step3.filter((s) => s.method === 'iterate').map((s) => s.args[2])).toEqual([r.c0, r.c0, r.c0, r.c0]);
      expect(r.read[0]!.args).toEqual([BRANCH, 0]);
      expect(r.warns).toEqual([]);
      for (const id of ['Z0', 'Z1', 'H1', 'O2']) expect(r.ids.has(id), id).toBe(true);
    });

    it('[03a R-3] a line older than H (two readable checkpoints) logs one warn line; with one checkpoint it is silent', async () => {
      const older = (): PosEvent[][] => [[voided('O0', 'Z0')]];
      expect((await restart('two readable', older)).warns).toEqual([expect.objectContaining({ event_type: 'ItemVoided', order_id: 'O0', order_item_id: 'Z0' })]);
      expect((await restart('one', older)).warns).toEqual([]);
    });
  });

  describe('[03a #130] the boot id-set read (R-3)', () => {
    for (const kind of ['one', 'two readable', 'newer torn'] as const) {
      it(`[03a #130] ${kind}: step 3 = 4 + 2 + 1 statements; the read's bound; EXPLAIN shows events_branch_stream`, async () => {
        const r = await restart(kind, () => []);
        expect(r.step3).toHaveLength(7);
        expect(r.step3.filter((s) => s.method === 'iterate')).toHaveLength(4);
        expect(r.step3.filter((s) => /ORDER BY seq DESC LIMIT 1/.test(s.sql))).toHaveLength(2);
        expect(r.read).toHaveLength(1);
        expect(r.read[0]!.args).toEqual([BRANCH, kind === 'two readable' ? r.c0 : 0]);
        const plan = (r.db.prepare(`EXPLAIN QUERY PLAN ${r.read[0]!.sql}`).all(...r.read[0]!.args) as Array<{ detail: string }>).map((p) => p.detail).join('\n');
        expect(plan).toContain('USING INDEX events_branch_stream (branch_id=? AND stream_type=? AND seq>?)');
        expect(plan).not.toContain('TEMP B-TREE');
      });
    }
  });
});

