import { applyEvent, availableStock, dayDraws, initialEngineState, openDayStartMs, saleUnitsAvailable, type EngineState } from '@pos/engine';
import { parseEvent, type BranchConfig, type DirectoryInput, type PosEvent } from '@pos/events';
import { aBranchConfig, aBranchConfigItemStock, aFireDispatched, anEngineConfigApplied, anOrderBatch, aStockSet } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

type Admin = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

const cleanups: Array<() => Promise<void>> = [];

describe('SetPrecookedStock (§6.17)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01a §10 #59] morning entry of 3 items → 3 StockSet events; the result shows on_hand, reserved 0, available', async () => {
    const { hub, admin } = await openDay();
    const now = hub.clock.branchNow();
    const res = await setStock(hub, admin, [
      { stock_item_id: 'I1', on_hand: 6 },
      { stock_item_id: 'I2', on_hand: 0 },
      { stock_item_id: 'I3', on_hand: 1_500 },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.result).toEqual({
      stock_items: [
        { stock_item_id: 'I1', on_hand: 6, reserved: 0, unit: 'piece', available: 6, level: 'ok', set_at: now },
        { stock_item_id: 'I2', on_hand: 0, reserved: 0, unit: 'piece', available: 0, level: 'out', set_at: now },
        { stock_item_id: 'I3', on_hand: 1_500, reserved: 0, unit: 'g', available: 1_500, level: 'ok', set_at: now },
      ],
    });
    expect(stockSets(hub)).toEqual([
      { stream_id: 'I1', payload: { stock_item_id: 'I1', on_hand: 6, unit: 'piece' } },
      { stream_id: 'I2', payload: { stock_item_id: 'I2', on_hand: 0, unit: 'piece' } },
      { stream_id: 'I3', payload: { stock_item_id: 'I3', on_hand: 1_500, unit: 'g' } },
    ]);
    expect(res.json().data.event_ids).toHaveLength(3);
    expect(engine(hub).stock.I3).toEqual({ on_hand: 1_500, reserved: 0, set_at: now, unit: 'g' });
  });

  it('[01a §10 #60] an on_hand equal to the current value still appends one StockSet and moves set_at to its recorded_at', async () => {
    const { hub, admin } = await openDay();
    await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 6 }], 'cmd-first');
    hub.clock.advance(120_000);
    const later = hub.clock.branchNow();
    const res = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 6 }], 'cmd-recount');
    expect(res.statusCode).toBe(200);
    expect(stockSets(hub)).toHaveLength(2);
    const [eventId] = res.json().data.event_ids as string[];
    const recordedAt = hub.deps.db.prepare('SELECT recorded_at FROM events WHERE event_id = ?').pluck().get(eventId);
    expect(recordedAt).toBe(later);
    expect(engine(hub).stock.I1?.set_at).toBe(recordedAt);
    expect(res.json().data.result.stock_items[0]).toMatchObject({ on_hand: 6, set_at: later });
  });

  it('[01a §10 #61] stock item not in config (unknown, or an item that is not stock-tracked) → 404 STOCK_ITEM_NOT_FOUND for the first such entry; nothing written for any entry', async () => {
    const { hub, admin } = await openDay(aBranchConfigItemStock());
    const missing = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 3 }, { stock_item_id: 'I9', on_hand: 1 }], 'cmd-missing');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('STOCK_ITEM_NOT_FOUND');
    expect(missing.json().error.details).toEqual({ stock_item_id: 'I9' });
    const untracked = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 3 }, { stock_item_id: 'I2', on_hand: 1 }, { stock_item_id: 'I8', on_hand: 1 }], 'cmd-untracked');
    expect(untracked.statusCode).toBe(404);
    expect(untracked.json().error.code).toBe('STOCK_ITEM_NOT_FOUND');
    expect(untracked.json().error.details).toEqual({ stock_item_id: 'I2' });
    expect(stockSets(hub)).toEqual([]);
    expect(engine(hub).stock).toEqual({});
    expect(processed(hub, 'cmd-missing') + processed(hub, 'cmd-untracked')).toBe(0);

    swapBranchConfig(null);
    const noConfig = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 3 }], 'cmd-no-config');
    expect(noConfig.statusCode).toBe(404);
    expect(noConfig.json().error).toMatchObject({ code: 'STOCK_ITEM_NOT_FOUND', details: { stock_item_id: 'I1' } });
  });

  it('[01a §10 #62] duplicate item_id in entries → 400 VALIDATION_FAILED; 201 entries → 400', async () => {
    const { hub, admin } = await openDay();
    const duplicate = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 3 }, { stock_item_id: 'I1', on_hand: 4 }], 'cmd-dup');
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error.code).toBe('VALIDATION_FAILED');
    const many = Array.from({ length: 201 }, (_, i) => ({ stock_item_id: `X${i}`, on_hand: 1 }));
    const tooMany = await setStock(hub, admin, many, 'cmd-201');
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.code).toBe('VALIDATION_FAILED');
    const empty = await setStock(hub, admin, [], 'cmd-empty');
    expect(empty.statusCode).toBe(400);
    const outOfRange = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 1_000_001 }], 'cmd-range');
    expect(outOfRange.statusCode).toBe(400);
    expect(stockSets(hub)).toEqual([]);
  });

  it('[01a §10 #63] without manage-stock → 403 PERMISSION_DENIED; the Manager role has it', async () => {
    const { hub, admin } = await openDay(undefined, undefined, { S_OWNER: ['manage-stock'] });
    const owner = adminOn(hub, 'S_OWNER');
    const denied = await setStock(hub, owner, [{ stock_item_id: 'I1', on_hand: 3 }], 'cmd-denied', 'S_OWNER');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');
    expect(denied.json().error.details).toMatchObject({ permission: 'manage-stock' });
    const manager = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 3 }], 'cmd-manager');
    expect(manager.statusCode).toBe(200);
  });

  it('[01a §10 #64] retransmit with the same command_id → identical response, Idempotent-Replay: true, no new events', async () => {
    const { hub, admin } = await openDay();
    const first = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 3 }], 'cmd-once');
    hub.clock.advance(5_000);
    const replay = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 3 }], 'cmd-once');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(stockSets(hub)).toHaveLength(1);
  });

  it('[01a §10 #65] forced COMMIT failure → EngineState.stock unchanged', async () => {
    let fail = false;
    const { hub, admin } = await openDay(undefined, {
      beforeCommit() {
        if (fail) throw new Error('forced commit failure');
      },
    });
    await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 3 }], 'cmd-before');
    const before = engine(hub).stock;
    fail = true;
    const failed = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 9 }, { stock_item_id: 'I3', on_hand: 500 }], 'cmd-fail');
    expect(failed.statusCode).toBe(500);
    expect(engine(hub).stock).toBe(before);
    expect(stockSets(hub)).toHaveLength(1);
  });

  it('[01a §10 #134] before any OpenBusinessDay: SetPrecookedStock and AddPrecookedStock → 409 BUSINESS_DAY_NOT_OPEN, no event, no processed_commands row; after the first open → 200', async () => {
    const hub = await open();
    withConfig(trackedConfig());
    const admin = adminOn(hub, 'S_MGR');
    const blocked = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 3 }], 'cmd-early');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('BUSINESS_DAY_NOT_OPEN');
    expect(stockSets(hub)).toEqual([]);
    expect(processed(hub, 'cmd-early')).toBe(0);
    const addBlocked = await post(hub, admin, 'add-precooked-stock', 'AddPrecookedStock', { entries: [{ stock_item_id: 'I1', quantity: 2 }] }, 'cmd-add-early');
    expect(addBlocked.statusCode).toBe(409);
    expect(addBlocked.json().error.code).toBe('BUSINESS_DAY_NOT_OPEN');
    expect(processed(hub, 'cmd-add-early')).toBe(0);
    expect(hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE stream_type = 'stock'").pluck().get()).toBe(0);
    const opened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open');
    expect(opened.statusCode).toBe(200);
    const allowed = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 3 }], 'cmd-after');
    expect(allowed.statusCode).toBe(200);
    expect(stockSets(hub)).toHaveLength(1);
  });

  it('[01c #63] SetPrecookedStock { stock_item_id: Karahi pot, on_hand: 6000 } → one StockSet v2; Half shows saleUnitsAvailable 12, Full 6', async () => {
    const { hub, admin } = await openConfigDay(aBranchConfig());
    const now = hub.clock.branchNow();
    const res = await setStock(hub, admin, [{ stock_item_id: 'K1', on_hand: 6_000 }], 'cmd-pot');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.result).toEqual({
      stock_items: [{ stock_item_id: 'K1', on_hand: 6_000, reserved: 0, unit: 'g', available: 6_000, level: 'ok', set_at: now }],
    });
    expect(stockEvents(hub)).toEqual([{ event_type: 'StockSet', schema_version: 2, stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 6_000, unit: 'g' } }]);
    const state = engine(hub);
    const pot = aBranchConfig().stock_items[0]!;
    const available = availableStock(state, 'K1', openDayStartMs(state), pot);
    const perSale = (itemId: string): number => {
      const item = aBranchConfig().items.find((candidate) => candidate.item_id === itemId)!;
      return dayDraws(state, item, { K1: 'g' }).stock_draws[0]!.quantity_per_sale_unit;
    };
    expect(saleUnitsAvailable(available, perSale('I1'))).toBe(12); // Half, 500 g
    expect(saleUnitsAvailable(available, perSale('I3'))).toBe(6); // Full, 1 000 g
  });

  it('[01c #64] unknown stock item → 404 STOCK_ITEM_NOT_FOUND; duplicate → 400 path entries.1.stock_item_id; retransmit → replay; COMMIT failure → state unchanged', async () => {
    let fail = false;
    const { hub, admin } = await openConfigDay(aBranchConfig(), {
      beforeCommit() {
        if (fail) throw new Error('forced commit failure');
      },
    });
    const unknown = await setStock(hub, admin, [{ stock_item_id: 'K1', on_hand: 1 }, { stock_item_id: 'I1', on_hand: 1 }, { stock_item_id: 'K9', on_hand: 1 }], 'cmd-unknown');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'STOCK_ITEM_NOT_FOUND', details: { stock_item_id: 'I1' } });
    expect(stockEvents(hub)).toEqual([]);
    expect(processed(hub, 'cmd-unknown')).toBe(0);

    const duplicate = await setStock(hub, admin, [{ stock_item_id: 'K1', on_hand: 1 }, { stock_item_id: 'K1', on_hand: 2 }], 'cmd-dup');
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error.code).toBe('VALIDATION_FAILED');
    expect(duplicate.json().error.details.issues.map((issue: { path: string }) => issue.path)).toEqual(['entries.1.stock_item_id']);

    const first = await setStock(hub, admin, [{ stock_item_id: 'K1', on_hand: 4_000 }], 'cmd-once');
    hub.clock.advance(5_000);
    const replay = await setStock(hub, admin, [{ stock_item_id: 'K1', on_hand: 4_000 }], 'cmd-once');
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(stockEvents(hub)).toHaveLength(1);

    const before = engine(hub).stock;
    fail = true;
    const failed = await setStock(hub, admin, [{ stock_item_id: 'K1', on_hand: 9_000 }], 'cmd-fail');
    expect(failed.statusCode).toBe(500);
    expect(engine(hub).stock).toBe(before);
    expect(stockEvents(hub)).toHaveLength(1);
  });

  it('[01c #65] my_stations holder of Karahi counts the Karahi pot → OK; the Tandoor\'s stock item → 403 outside_scope { stock_item_ids } after the 404 checks', async () => {
    const config = withTandoor(aBranchConfig());
    const { hub } = await openConfigDay(config, undefined, counterDirectory);
    const counter = adminOn(hub, 'S_CNT');

    const unknownFirst = await setStock(hub, counter, [{ stock_item_id: 'K2', on_hand: 10 }, { stock_item_id: 'K9', on_hand: 1 }], 'cmd-404', 'S_CNT');
    expect(unknownFirst.statusCode).toBe(404);
    expect(unknownFirst.json().error).toMatchObject({ code: 'STOCK_ITEM_NOT_FOUND', details: { stock_item_id: 'K9' } });

    const outside = await setStock(hub, counter, [{ stock_item_id: 'K2', on_hand: 10 }, { stock_item_id: 'K1', on_hand: 6_000 }], 'cmd-out', 'S_CNT');
    expect(outside.statusCode, outside.body).toBe(403);
    expect(outside.json().error).toMatchObject({
      code: 'PERMISSION_DENIED',
      details: { permission: 'manage-stock', reason: 'outside_scope', stock_item_ids: ['K2'] },
    });
    expect(stockEvents(hub)).toEqual([]);
    expect(processed(hub, 'cmd-404') + processed(hub, 'cmd-out')).toBe(0);

    const inside = await setStock(hub, counter, [{ stock_item_id: 'K1', on_hand: 6_000 }], 'cmd-in', 'S_CNT');
    expect(inside.statusCode, inside.body).toBe(200);
    expect(stockEvents(hub)).toHaveLength(1);
  });

  it('[01a §6.17 A-14] a count below reserved appends StockReleased { recount } for hidden lines, newest reserved_seq first, every draw, before the StockSet; frozen and fired lines keep theirs', async () => {
    const { hub, admin } = await openDay();
    seed(hub, [anEngineConfigApplied()]);
    counted(hub, 'I1', 6);
    counted(hub, 'I3', 1_000, 'g');
    hidden(hub, 'O1', [{ id: 'A', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }]);
    hidden(hub, 'O2', [{ id: 'B', draws: [{ stock_item_id: 'I1', quantity: 1 }, { stock_item_id: 'I3', quantity: 250 }], from_stock: true }], 100_000);
    hidden(hub, 'O3', [{ id: 'C', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }], 200_000);
    frozen(hub, 'O4', [{ id: 'Z', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }]);
    frozen(hub, 'O5', [{ id: 'W', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }]);
    fired(hub, 'W');
    expect(engine(hub).stock.I1).toMatchObject({ on_hand: 6, reserved: 5 });
    hub.clock.advance(1_000);
    const now = hub.clock.branchNow();
    const before = lastSeq(hub);

    const res = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 1 }], 'cmd-recount');

    expect(res.statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([
      { type: 'StockReleased', id: 'I1', line: 'C', q: 1, reason: 'recount' },
      { type: 'StockReleased', id: 'I1', line: 'B', q: 1, reason: 'recount' },
      { type: 'StockReleased', id: 'I3', line: 'B', q: 250, reason: 'recount' },
      { type: 'StockReleased', id: 'I1', line: 'A', q: 1, reason: 'recount' },
      { type: 'StockSet', id: 'I1', on_hand: 1, unit: 'piece' },
    ]);
    // The command stamps the envelope of every draft as its own, and event_ids lists the whole batch.
    const rows = rowsAfter(hub, before);
    for (const row of rows) expect(row).toMatchObject({ stream_type: 'stock', occurred_at: now, recorded_at: now, actor_id: 'S_MGR', device_id: admin.device.deviceId });
    expect(rows.map((row) => row.stream_id)).toEqual(['I1', 'I1', 'I3', 'I1', 'I1']);
    expect(res.json().data.event_ids).toEqual(rows.map((row) => row.event_id));
    // Result shape unchanged; on_hand < reserved only by the frozen and fired units.
    expect(res.json().data.result).toEqual({
      stock_items: [{ stock_item_id: 'I1', on_hand: 1, reserved: 2, unit: 'piece', available: 0, level: 'out', set_at: now }],
    });
    expect(engine(hub).stock.I3).toMatchObject({ on_hand: 1_000, reserved: 0 });
    expect(engine(hub).lines.A).toMatchObject({ from_stock: false, reserved_seq: null, cook_ms: COOK });
    expect(engine(hub).lines.B).toMatchObject({ from_stock: false, reserved_seq: null, cook_ms: COOK });
    expect(engine(hub).lines.Z).toMatchObject({ from_stock: true });
    expect(engine(hub).lines.Z!.reserved_seq).not.toBeNull();
    expect(engine(hub).lines.W!.reserved_seq).not.toBeNull();
    expectSameAsReplay(hub);

    const replay = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 1 }], 'cmd-recount');
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(res.json());
    expect(rowsAfter(hub, before)).toHaveLength(5);
  });

  it('[01a §6.17 A-14] the recount stops once reserved ≤ the count; a count at or above reserved releases nothing', async () => {
    const { hub, admin } = await openDay();
    seed(hub, [anEngineConfigApplied()]);
    counted(hub, 'I1', 6);
    hidden(hub, 'O1', [{ id: 'A', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }]);
    hidden(hub, 'O2', [{ id: 'B', draws: [{ stock_item_id: 'I1', quantity: 2 }], from_stock: true }], 100_000);
    hidden(hub, 'O3', [{ id: 'C', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }], 200_000);
    let before = lastSeq(hub);
    expect((await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 4 }], 'cmd-at')).statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([{ type: 'StockSet', id: 'I1', on_hand: 4, unit: 'piece' }]);
    before = lastSeq(hub);
    expect((await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 3 }], 'cmd-below')).statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([
      { type: 'StockReleased', id: 'I1', line: 'C', q: 1, reason: 'recount' },
      { type: 'StockSet', id: 'I1', on_hand: 3, unit: 'piece' },
    ]);
    expect(engine(hub).stock.I1).toMatchObject({ on_hand: 3, reserved: 3 });
    expectSameAsReplay(hub);
  });

  it('[01a §6.17 A-14] a unit-changing count with held reservations appends StockConsumed first, every draw of each holding line; held lines are not re-reserved (BF-9 parked, AD-29 Q6, tests #42, #118); a waiting hidden full-cook line gets the BF-8 reserve after the StockSet', async () => {
    const { hub, admin } = await openDay();
    seed(hub, [anEngineConfigApplied()]);
    counted(hub, 'I1', 5);
    counted(hub, 'I3', 6, 'piece'); // yesterday's unit: the day's frozen unit of I3 is g
    hidden(hub, 'O1', [{ id: 'H', draws: [{ stock_item_id: 'I3', quantity: 1 }], from_stock: true }]);
    frozen(hub, 'O2', [{ id: 'Z', draws: [{ stock_item_id: 'I3', quantity: 1 }, { stock_item_id: 'I1', quantity: 1 }], from_stock: true }]);
    hidden(hub, 'O3', [{ id: 'WAIT', draws: [{ stock_item_id: 'I3', quantity: 100 }] }], 100_000);
    hub.clock.advance(1_000);
    const before = lastSeq(hub);

    const res = await setStock(hub, admin, [{ stock_item_id: 'I3', on_hand: 500 }], 'cmd-unit');

    expect(res.statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([
      { type: 'StockConsumed', id: 'I3', line: 'H', q: 1 },
      { type: 'StockConsumed', id: 'I3', line: 'Z', q: 1 },
      { type: 'StockConsumed', id: 'I1', line: 'Z', q: 1 },
      { type: 'StockSet', id: 'I3', on_hand: 500, unit: 'g' },
      { type: 'StockReserved', id: 'I3', line: 'WAIT', q: 100 },
    ]);
    expect(res.json().data.result.stock_items).toEqual([
      { stock_item_id: 'I3', on_hand: 500, reserved: 100, unit: 'g', available: 400, level: 'ok', set_at: hub.clock.branchNow() },
    ]);
    expect(engine(hub).stock.I1).toMatchObject({ on_hand: 4, reserved: 0 });
    // BF-9 parked: consumed, so their later Start drafts no StockConsumed; no reservation in the new unit.
    expect(engine(hub).lines.H).toMatchObject({ from_stock: true, reserved_seq: null });
    expect(engine(hub).lines.Z).toMatchObject({ from_stock: true, reserved_seq: null });
    expect(engine(hub).lines.WAIT).toMatchObject({ from_stock: true, cook_ms: STOCK_COOK });
    expectSameAsReplay(hub);
  });

  it('[01a §6.17 A-14] a count that raises available reserves waiting hidden full-cook lines after the StockSet (BF-8); a frozen line is not a candidate', async () => {
    const { hub, admin } = await openDay();
    seed(hub, [anEngineConfigApplied()]);
    counted(hub, 'I1', 0);
    frozen(hub, 'O1', [{ id: 'Z', draws: [{ stock_item_id: 'I1', quantity: 1 }] }]);
    hidden(hub, 'O2', [{ id: 'W1', draws: [{ stock_item_id: 'I1', quantity: 1 }] }]);
    hidden(hub, 'O3', [{ id: 'W2', draws: [{ stock_item_id: 'I1', quantity: 1 }] }], 100_000);
    const before = lastSeq(hub);
    expect((await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 1 }], 'cmd-up')).statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([
      { type: 'StockSet', id: 'I1', on_hand: 1, unit: 'piece' },
      { type: 'StockReserved', id: 'I1', line: 'W1', q: 1 },
    ]);
    expect(engine(hub).lines.Z).toMatchObject({ from_stock: false });
    expect(engine(hub).lines.W2).toMatchObject({ from_stock: false });
    expectSameAsReplay(hub);
  });

  it('[01a §6.17 A-14] two entries in one command thread the batch (BF-8): a line released by the first entry is not released again by the second', async () => {
    const { hub, admin } = await openDay();
    seed(hub, [anEngineConfigApplied()]);
    counted(hub, 'I1', 2);
    counted(hub, 'I3', 500, 'g');
    hidden(hub, 'O1', [{ id: 'M', draws: [{ stock_item_id: 'I1', quantity: 1 }, { stock_item_id: 'I3', quantity: 250 }], from_stock: true }]);
    const before = lastSeq(hub);
    const res = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 0 }, { stock_item_id: 'I3', on_hand: 0 }], 'cmd-both');
    expect(res.statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([
      { type: 'StockReleased', id: 'I1', line: 'M', q: 1, reason: 'recount' },
      { type: 'StockReleased', id: 'I3', line: 'M', q: 250, reason: 'recount' },
      { type: 'StockSet', id: 'I1', on_hand: 0, unit: 'piece' },
      { type: 'StockSet', id: 'I3', on_hand: 0, unit: 'g' },
    ]);
    expect(engine(hub).stock.I1).toMatchObject({ on_hand: 0, reserved: 0 });
    expect(engine(hub).stock.I3).toMatchObject({ on_hand: 0, reserved: 0 });
    expectSameAsReplay(hub);
  });

  it('[01a §6.17 A-14] the releases and the StockSet are one transaction: a forced COMMIT failure writes none of them and leaves the state; the retry appends the whole batch', async () => {
    let fail = false;
    const { hub, admin } = await openDay(undefined, {
      beforeCommit() {
        if (fail) throw new Error('forced commit failure');
      },
    });
    seed(hub, [anEngineConfigApplied()]);
    counted(hub, 'I1', 2);
    hidden(hub, 'O1', [{ id: 'A', draws: [{ stock_item_id: 'I1', quantity: 2 }], from_stock: true }]);
    const state = engine(hub);
    const before = lastSeq(hub);
    fail = true;
    const failed = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 0 }], 'cmd-fail');
    expect(failed.statusCode).toBe(500);
    expect(rowsAfter(hub, before)).toEqual([]);
    expect(engine(hub)).toBe(state);
    expect(processed(hub, 'cmd-fail')).toBe(0);
    fail = false;
    expect((await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 0 }], 'cmd-fail')).statusCode).toBe(200);
    expect(logAfter(hub, before)).toEqual([
      { type: 'StockReleased', id: 'I1', line: 'A', q: 2, reason: 'recount' },
      { type: 'StockSet', id: 'I1', on_hand: 0, unit: 'piece' },
    ]);
  });

  it('[01a §6.17 A-14] the statement count changes only by the appends: each effect draft adds one INSERT', async () => {
    const { hub, admin } = await openDay();
    seed(hub, [anEngineConfigApplied()]);
    counted(hub, 'I1', 3);
    hidden(hub, 'O1', [{ id: 'A', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }]);
    hidden(hub, 'O2', [{ id: 'B', draws: [{ stock_item_id: 'I1', quantity: 1 }], from_stock: true }], 100_000);
    const counter = statementCounter(hub.deps.db);
    await setStock(hub, admin, [{ stock_item_id: 'I2', on_hand: 1 }], 'cmd-warm');
    counter.reset();
    await setStock(hub, admin, [{ stock_item_id: 'I2', on_hand: 2 }], 'cmd-plain');
    const plain = counter.count;
    counter.reset();
    const res = await setStock(hub, admin, [{ stock_item_id: 'I1', on_hand: 0 }], 'cmd-effects');
    const withEffects = counter.count;
    expect(res.json().data.event_ids).toHaveLength(3);
    expect(withEffects).toBe(plain + 2);
  });
});

// I1 piece, I2 piece (tracked here), I3 g: all stock-tracked, each its own stock item.
function trackedConfig(): BranchConfig {
  const base = aBranchConfigItemStock();
  const [k1, k3] = base.stock_items;
  return {
    ...base,
    stock_items: [k1!, k3!, { ...k1!, stock_item_id: 'I2', name: 'Mutton Karahi' }],
    items: base.items.map((item) =>
      item.item_id === 'I2' ? { ...item, stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'I2', quantity_per_sale_unit: 1 }] } : item,
    ),
  };
}

// 01c #65: a Tandoor station S2 with its own stock item K2 (naan dough, pieces).
function withTandoor(config: BranchConfig): BranchConfig {
  return {
    ...config,
    stations: [...config.stations, { ...config.stations[0]!, station_id: 'S2', name: 'Tandoor' }],
    stock_items: [
      ...config.stock_items,
      { stock_item_id: 'K2', name: 'Naan dough', stock_unit: 'piece', carries_over: false, station_id: 'S2', low_stock_threshold: null },
    ],
  };
}

// S_CNT: a stock counter (manage-stock with scope my_stations) counting stock at S1 (Karahi).
function counterDirectory(directory: DirectoryInput): void {
  directory.roles.push({
    role_id: 'R_CNT',
    name: 'Stock counter',
    session_idle_ttl_ms: 3_600_000,
    permissions: [
      { permission: 'access-hub-admin', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'branch' },
      { permission: 'manage-stock', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_stations' },
    ],
  });
  const cashier = directory.staff.find((staff) => staff.staff_id === 'S_CASH')!;
  directory.staff.push({ ...cashier, staff_id: 'S_CNT', display_name: 'Counter', role_ids: ['R_CNT'] });
  directory.responsibilities = [{ responsibility: 'count_stock', station_id: 'S1', staff_ids: ['S_CNT'], role_ids: [] }];
}

// The hub holds `config` (a schema-3 snapshot) and a day is open.
async function openConfigDay(
  config: BranchConfig,
  testHooks?: { beforeCommit?: () => void },
  editDirectory?: (directory: DirectoryInput) => void,
): Promise<{ hub: TestHub; admin: Admin }> {
  const hub = await createTestHub(testHooks === undefined ? undefined : { testHooks });
  cleanups.push(() => hub.close());
  const directory = await aDirectory();
  editDirectory?.(directory);
  await seedDirectory(hub, directory);
  withConfig(config);
  const admin = adminOn(hub, 'S_MGR');
  const opened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-day');
  if (opened.statusCode !== 200) throw new Error(`open failed: ${opened.body}`);
  return { hub, admin };
}

async function openDay(
  config: BranchConfig = trackedConfig(),
  testHooks?: { beforeCommit?: () => void },
  denied?: Record<string, string[]>,
): Promise<{ hub: TestHub; admin: Admin }> {
  const hub = await open(testHooks, denied);
  withConfig(config);
  const admin = adminOn(hub, 'S_MGR');
  const opened = await post(hub, admin, 'open-business-day', 'OpenBusinessDay', {}, 'cmd-open-day');
  if (opened.statusCode !== 200) throw new Error(`open failed: ${opened.body}`);
  return { hub, admin };
}

async function open(testHooks?: { beforeCommit?: () => void }, denied: Record<string, string[]> = {}): Promise<TestHub> {
  const hub = await createTestHub(testHooks === undefined ? undefined : { testHooks });
  cleanups.push(() => hub.close());
  const directory = await aDirectory();
  for (const staff of directory.staff) staff.denied_permissions = denied[staff.staff_id] ?? [];
  await seedDirectory(hub, directory);
  return hub;
}

function withConfig(config: BranchConfig): void {
  swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 2, appliedAt: 0 });
}

function adminOn(hub: TestHub, staffId: string): Admin {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId });
  return { device, session };
}

function setStock(hub: TestHub, admin: Admin, entries: Array<{ stock_item_id: string; on_hand: number }>, commandId = 'cmd-set', actorId = 'S_MGR') {
  return post(hub, admin, 'set-precooked-stock', 'SetPrecookedStock', { entries }, commandId, actorId);
}

function post(hub: TestHub, admin: Admin, name: string, commandType: string, payload: Record<string, unknown>, commandId: string, actorId = 'S_MGR') {
  return hub.app.inject({
    method: 'POST',
    url: `/admin/commands/${name}`,
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: commandType,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: actorId,
      device_id: admin.device.deviceId,
    },
  });
}

function engine(hub: TestHub): EngineState {
  return hub.deps.state.get();
}

function stockSets(hub: TestHub): Array<{ stream_id: string; payload: unknown }> {
  const rows = hub.deps.db
    .prepare("SELECT stream_id, payload FROM events WHERE event_type = 'StockSet' AND stream_type = 'stock' ORDER BY seq")
    .all() as Array<{ stream_id: string; payload: string }>;
  return rows.map((row) => ({ stream_id: row.stream_id, payload: JSON.parse(row.payload) }));
}

function processed(hub: TestHub, commandId: string): number {
  return hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands WHERE command_id = ?').pluck().get(commandId) as number;
}

function stockEvents(hub: TestHub): Array<{ event_type: string; schema_version: number; stream_id: string; payload: unknown }> {
  const rows = hub.deps.db
    .prepare("SELECT event_type, schema_version, stream_id, payload FROM events WHERE stream_type = 'stock' ORDER BY seq")
    .all() as Array<{ event_type: string; schema_version: number; stream_id: string; payload: string }>;
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
}

// 03a lines through a real fold (A-14): the engine config and the §4.2 submit batches go through the hub's event
// store, so the command's ctx.state is what applyEvent makes of them.
const COOK = 1_200_000;
const STOCK_COOK = 60_000;
type Draw = { stock_item_id: string; quantity: number };
type LineSpec = { id: string; draws: Draw[]; from_stock?: boolean };
type Row = { event_id: string; tenant_id: string; branch_id: string; stream_type: PosEvent['stream_type']; stream_id: string; event_type: string; schema_version: number; payload: string; occurred_at: number; recorded_at: number; actor_id: string | null; device_id: string; seq: number };

function seed(hub: TestHub, events: PosEvent[]): void {
  const occurred_at = hub.clock.branchNow();
  hub.deps.writer.run((tx) => tx.append(events.map((event) => ({ ...event, occurred_at }))));
}

function counted(hub: TestHub, stock_item_id: string, on_hand: number, unit: 'piece' | 'g' = 'piece'): void {
  seed(hub, [aStockSet({ stream_id: stock_item_id, payload: { stock_item_id, on_hand, unit } })]);
}

function submit(hub: TestHub, order_id: string, lines: LineSpec[], land: number, pickup?: number): void {
  seed(
    hub,
    anOrderBatch({
      order_id,
      lines: lines.map((l) => ({
        order_item_id: l.id,
        item: { name: 'Seekh kebab', quantity: 1, stock_time_ms: STOCK_COOK, stock_draws: l.draws, out_of_stock_behaviour: 'cook_fresh' },
        line: { from_stock: l.from_stock ?? false },
      })),
      order: {
        groups: [{ group_id: `${order_id}:0`, target_land_ms: land, promise_ms: land + 180_000, order_item_ids: lines.map((l) => l.id) }],
        ...(pickup === undefined ? {} : { order_type: 'delivery', pickup_at_ms: pickup }),
      },
      reserved: lines.filter((l) => l.from_stock === true).flatMap((l) => l.draws.map((d) => ({ ...d, order_item_id: l.id }))),
    }),
  );
}

// A delivery picked up in an hour or later: its lines are hidden (fire_ms > now + freeze_ms).
function hidden(hub: TestHub, order_id: string, lines: LineSpec[], later = 0): void {
  const pickup = hub.clock.branchNow() + 3_600_000 + later;
  submit(hub, order_id, lines, pickup, pickup);
}

// A land this close fires at once: frozen (on the chef's Next list).
function frozen(hub: TestHub, order_id: string, lines: LineSpec[]): void {
  submit(hub, order_id, lines, hub.clock.branchNow() + COOK + 30_000);
}

function fired(hub: TestHub, order_item_id: string): void {
  seed(hub, [aFireDispatched({ payload: { station_id: 'S1', order_item_ids: [order_item_id], load_id: null, due_at: hub.clock.branchNow(), reason: 'scheduled' } })]);
}

function lastSeq(hub: TestHub): number {
  return hub.deps.db.prepare('SELECT COALESCE(MAX(seq), 0) FROM events').pluck().get() as number;
}

function rowsAfter(hub: TestHub, seq: number): Row[] {
  return hub.deps.db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq').all(seq) as Row[];
}

// The real event log after `seq`, in seq order.
function logAfter(hub: TestHub, seq: number): Array<Record<string, unknown>> {
  return rowsAfter(hub, seq).map((row) => {
    const p = JSON.parse(row.payload) as Record<string, unknown>;
    return {
      type: row.event_type,
      ...(typeof p.stock_item_id === 'string' ? { id: p.stock_item_id } : {}),
      ...(typeof p.order_item_id === 'string' ? { line: p.order_item_id } : {}),
      ...(typeof p.quantity === 'number' ? { q: p.quantity } : {}),
      ...(typeof p.on_hand === 'number' ? { on_hand: p.on_hand } : {}),
      ...(typeof p.unit === 'string' ? { unit: p.unit } : {}),
      ...(typeof p.reason === 'string' ? { reason: p.reason } : {}),
    };
  });
}

// Every event of the log folded from nothing: what a restart rebuilds must be what the commit swapped in.
function replayed(hub: TestHub): EngineState {
  return rowsAfter(hub, 0).reduce(
    (state, row) => applyEvent(state, parseEvent({ ...row, payload: JSON.parse(row.payload) as PosEvent['payload'] }), { strict: false }),
    initialEngineState(),
  );
}

function expectSameAsReplay(hub: TestHub): void {
  const live = hub.deps.state.get();
  const again = replayed(hub);
  expect(again.stock).toEqual(live.stock);
  expect(again.lines).toEqual(live.lines);
  expect(live.diagnostics.filter((d) => d.kind === 'stock_breach')).toEqual([]);
}
