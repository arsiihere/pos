// Engine-lane boot tests (02p tasks 15, 17), kept out of boot.int.test.ts (platform A's file).
// 01a v2.3 #194 third clause (02p M-6): the boot fold counts StockTransferredOut — 03a v1.2 Q-5 puts it on
// ENGINE_REPLAY_EVENTS.stock, so step 3's stock statement reads it and the replayed state lowers on_hand as live does.
import { fileURLToPath } from 'node:url';
import { applyEvents, ENGINE_STATE_VERSION, initialEngineState, ORDER_EXIT_AFTER_SERVED_MS, stockOf, toCheckpoint, type Diagnostic, type EngineState } from '@pos/engine';
import type { PosEvent } from '@pos/events';
import { aBusinessDayClosed, aBusinessDayOpened, anEngineConfigApplied, anOrderBatch, aStockSet } from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { engineStep2, engineStep3, replayEngine } from '../../src/engine-host/boot-steps';
import { hostFlags } from '../../src/engine-host/host-flags';
import { afterEngineCommit, foldEngineBatch } from '../../src/engine-host/reducer';
import type { StateHolder } from '../../src/engine-host/state-holder';
import type { BootContext } from '../../src/lib/boot';
import { ABSENT_ID, dealOrder, emptyOrder, foodAdded, readyAdded, readyShapes, served, voided, zoneAdded, zoneAndDealShapes } from './q3-lines';
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
  // E-4 (15b): `beforeC0` joins day D−1 before its close (so before C0), `beforeClose` day D before its close (so before
  // C); `afterC` follows C in the log.
  function q3Log(extra: Extra = {}): { log: PosEvent[]; c0: number; c: number } {
    const before = [
      ...at([anEngineConfigApplied()], T),
      ...at([aBusinessDayOpened({ payload: { business_date: '2025-10-19' } })], T + 1),
      ...at([...anOrderBatch({ order_id: 'O0', lines: [{ order_item_id: 'L0' }] }), zoneAdded('O0', 'Z0')], T + 2),
      ...at(extra.beforeC0 ?? [], T + 2),
      ...at([aBusinessDayClosed()], T + 3),
    ];
    const dayD = [
      ...at([aBusinessDayOpened({ payload: { business_date: '2025-10-20' } })], T + DAY),
      ...at([...dealOrder('O1', 'H1', ['P1', 'P2'], T + DAY + 1), zoneAdded('O1', 'Z1')], T + DAY + 1),
      ...at([emptyOrder('O2', T + DAY + 2), readyAdded('O2', 'R1')], T + DAY + 2),
      ...at([served('O1', ['P1', 'P2'], 'tap')], T + DAY + 3),
      ...at(extra.beforeClose ?? [], T + DAY + 4),
      ...at([aBusinessDayClosed()], T + DAY + 3 + ORDER_EXIT_AFTER_SERVED_MS + 1),
    ];
    const c = before.length + dayD.length;
    const log = seqd([...before, ...dayD, ...at(extra.afterC ?? [], T + DAY + 3 + ORDER_EXIT_AFTER_SERVED_MS + 2)], 1);
    return { log, c0: before.length, c };
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
  // `snapshotAt`: also a current-version snapshot at that seq, which step 2 prefers over the checkpoints.
  interface Extra { beforeC0?: PosEvent[]; beforeClose?: PosEvent[]; afterC?: PosEvent[] }
  async function restart(kind: Case, later: (log: PosEvent[]) => PosEvent[][], snapshotAt?: number, extra: Extra = {}) {
    const db = await migrated();
    const { log, c0, c } = q3Log(extra);
    insertRaw(db, log);
    if (snapshotAt !== undefined) {
      const stored: Partial<EngineState> = { ...applyEvents(initialEngineState(), log.slice(0, snapshotAt), { strict: false }) };
      delete stored.diagnostics;
      db.prepare(
        `INSERT INTO engine_snapshots (snapshot_id, branch_id, taken_at, last_seq, engine_version, state_json) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('s', BRANCH, log[snapshotAt - 1]!.recorded_at, snapshotAt, ENGINE_STATE_VERSION, JSON.stringify(stored));
    }
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
    const booted = state;
    const boot_ids = new Set(hostFlags.untrackedLineIds);
    let seq = log.length;
    for (const batch of later(log)) {
      const events = seqd(at(batch, T + 2 * DAY), seq + 1);
      seq += events.length;
      state = foldEngineBatch(state, events, () => 0);
      afterEngineCommit(holder, log2, events);
    }
    const read = step3.filter((s) => /json_array_length/.test(s.sql));
    return { db, step3, read, warns, c0, c, booted, boot_ids, state, ids: new Set(hostFlags.untrackedLineIds) };
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

    // ⚠️ Changed by 04 (row T-3): the R-3 test is removed — no line event reads the set's line ids any more, so R-3's
    // accepted warn is gone (the boot read and the line ids stay, test 130).
  });

  it('[03a #125, §3.12] a snapshot older than H: the replayed ItemAdded rows fill the set (the read starts at C0)', async () => {
    // The snapshot is at seq 2 (config, day D−1 open); O0 and its zone line Z0 come after it and before C0.
    const r = await restart('two readable', () => [[voided('O0', 'Z0')]], 2);
    expect(r.step3.filter((s) => s.method === 'iterate').map((s) => s.args[2])).toEqual([2, 2, 2, 2]);
    expect(r.read[0]!.args).toEqual([BRANCH, r.c0]);
    expect(r.ids.has('Z0')).toBe(true);
    expect(r.warns).toEqual([]);
  });

  // 03a v1.2 §3.12 (E-4, 15b check S-4, S-5): the full statement, whitespace collapsed.
  const BOOT_READ_SQL = [
    "SELECT event_type, CASE event_type WHEN 'ItemAdded' THEN json_extract(payload, '$.order_item_id') ELSE json_extract(payload, '$.order_id') END AS id FROM events",
    "WHERE branch_id = ? AND stream_type = 'order' AND seq > ? AND event_type IN ('ItemAdded', 'OrderPlaced', 'OrderLinesAdded')",
    "AND ((event_type = 'ItemAdded' AND (json_extract(payload, '$.served_from_zone_id') IS NOT NULL OR json_extract(payload, '$.line_kind') = 'deal'))",
    "OR (event_type = 'OrderPlaced' AND json_array_length(payload, '$.order_item_ids') = 0)",
    "OR (event_type = 'OrderLinesAdded' AND json_extract(payload, '$.order_header') IS NOT NULL AND json_array_length(payload, '$.order_item_ids') > 0))",
    'ORDER BY seq',
  ].join(' ');

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
        // E-4 (15b check S-4, S-5): the §3.12 full statement, two columns, the OrderLinesAdded arm, ORDER BY seq.
        expect(r.read[0]!.sql.replace(/\s+/g, ' ').trim()).toBe(BOOT_READ_SQL);
        expect(r.read[0]!.method).toBe('all');
      });
    }
  });
  // ---- 03a v1.2 §3.3 E-4, §3.12 (02p task 15b): the order header row in the id set at boot ----------------------------
  describe('[03a E-4] drinks first, food later across a restart', () => {
    // ⚠️ Changed by 04 (row T-3; G-18), 03a v1.2.4: the probe is an ItemServed { source: 'tap' } on an unknown line of
    // the order (order-level quiet still applies to it, so its warn proves the order left the set); an ItemVoided never logs.
    const unknownServed = (): PosEvent[][] => [[served('O2', ['X9'], 'tap')]];
    const servedWarn = (order_id: string, id: string) => expect.objectContaining({ event_type: 'ItemServed', order_id, order_item_id: id });

    it('[03a #133] the empty OrderPlaced is before C; restart; then the food OrderLinesAdded → the order is created and leaves the id set', async () => {
      const r = await restart('one', () => [foodAdded('O2', ['F1', 'F2']), [served('O2', ['X9'], 'tap')]]);
      expect(r.boot_ids.has('O2')).toBe(true);
      expect(r.state.orders.O2).toMatchObject({ table_key: 'dine_in:T-O2', line_ids: ['F1', 'F2'] });
      expect(r.ids.has('O2')).toBe(false);
      expect(r.warns).toEqual([servedWarn('O2', 'X9')]);
    });

    it('[03a #133] the food OrderLinesAdded after C, then restart: the replay hook and the read remove the id; a later ItemServed { source: tap } on an unknown line of that order is logged', async () => {
      for (const kind of ['one', 'two readable'] as const) {
        const r = await restart(kind, unknownServed, undefined, { afterC: foodAdded('O2', ['F1']) });
        expect(r.booted.orders.O2, kind).toBeDefined();
        expect(r.boot_ids.has('O2'), kind).toBe(false);
        expect(r.warns, kind).toEqual([servedWarn('O2', 'X9')]);
      }
    });

    it('[03a #133, §3.12] a snapshot older than H: the replay hook alone sees the empty order and its food (before C0); the id is added, then removed', async () => {
      const dayBefore = [emptyOrder('O3', T), ...foodAdded('O3', ['F3'])];
      const r = await restart('two readable', () => [[served('O3', ['X3'], 'tap')]], 2, { beforeC0: dayBefore });
      expect(r.step3.filter((s) => s.method === 'iterate').map((s) => s.args[2])).toEqual([2, 2, 2, 2]);
      expect(r.read[0]!.args).toEqual([BRANCH, r.c0]);
      expect(r.boot_ids.has('O3')).toBe(false);
      expect(r.warns).toEqual([servedWarn('O3', 'X3')]);
    });

    it('[03a #134] the newer of two checkpoints torn: the read starts at seq 0, the empty-order id is added then removed by the order_header row; later absent ids of that order are logged', async () => {
      const r = await restart('newer torn', unknownServed, undefined, { afterC: foodAdded('O2', ['F1']) });
      expect(r.read[0]!.args).toEqual([BRANCH, 0]);
      const rows = r.db.prepare(r.read[0]!.sql).all(...r.read[0]!.args) as Array<{ event_type: string; id: string }>;
      expect(rows.filter((row) => row.id === 'O2').map((row) => row.event_type)).toEqual(['OrderPlaced', 'OrderLinesAdded']);
      expect(r.boot_ids.has('O2')).toBe(false);
      expect(r.warns).toEqual([servedWarn('O2', 'X9')]);
    });

    it('[03a #135] a refused OrderLinesAdded with order_header (group_id_invalid) older than the replay removes the id through the read', async () => {
      // Two readable checkpoints: the replay starts at C, the read at C0, so only the read sees the refused row.
      const r = await restart('two readable', unknownServed, undefined, { beforeClose: foodAdded('O2', ['F1'], { group: 5 }) });
      expect(r.step3.filter((s) => s.method === 'iterate').map((s) => s.args[2])).toEqual([r.c, r.c, r.c, r.c]);
      expect(r.boot_ids.has('O2')).toBe(false);
      expect(r.warns).toEqual([servedWarn('O2', 'X9')]);
    });

    it('[03a #135] an empty addition (with and without order_header) keeps the order in the id set after a restart: the read does not return it', async () => {
      const empties = [...foodAdded('O2', []), ...foodAdded('O2', [], { header: null })];
      for (const where of ['beforeClose', 'afterC'] as const) {
        const r = await restart('two readable', () => readyShapes('O2', 'R1').map((e) => [e]), undefined, { [where]: empties });
        const rows = r.db.prepare(r.read[0]!.sql).all(...r.read[0]!.args) as Array<{ event_type: string; id: string }>;
        expect(rows.map((row) => row.event_type), where).not.toContain('OrderLinesAdded');
        expect(r.boot_ids.has('O2'), where).toBe(true);
        expect(r.booted.orders.O2, where).toBeUndefined();
        expect(r.warns, where).toEqual([]);
      }
    });

    it('[03a #135] a boot whose log holds a headerless OrderLinesAdded on an unknown order completes; the state equals the boot without it, diagnostics aside', async () => {
      const bad = foodAdded('O9', ['F1', 'F2'], { header: null });
      const r = await restart('one', () => [], undefined, { afterC: bad });
      const control = await restart('one', () => []);
      expect(r.booted.orders.O9).toBeUndefined();
      expect({ ...r.booted, diagnostics: [] }).toEqual({ ...control.booted, diagnostics: [] });
    });
  });
});

