// 04 §3.5 / §10 test 20c (task v5): 04's own identifier (apps/hub/src/voids/identifier.ts) — a copy of 03b's
// `identifierText` (with its 40-char slice) and of `passIdentity`'s dine-in branch, keyed on readOrder's head — gives
// exactly 03b's text for the eight §3.5 fixtures. 03b's side is read through its own exports (passScopedOrders +
// 02a currentTableOf + passIdentity), never copied into the test.
import type { EngineState } from '@pos/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandCtx } from '../../src/commands/registry';
import { passIdentity, passScopedOrders } from '../../src/kds/commands/handover';
import { readOrder } from '../../src/orders/exports';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { currentTableOf } from '../../src/tables/reads';
import { voidIdentifier } from '../../src/voids/identifier';
import type { TestHub } from '../helpers/test-hub';
import { statementCounter } from '../helpers/statement-counter';
import {
  closedSeating,
  earlierDayTakeaway,
  longLabelSeating,
  mergedSeating,
  noCurrentTable,
  openVoidsDay,
  parkingOrder,
  startVoids,
  takeawayOrder,
  tieMerge,
} from './fixtures';

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const state = (): EngineState => hub.deps.state.get();
/** readOrder needs only `ctx.tx.db` (orders/exports.ts). */
const ctx = (): CommandCtx => ({ tx: { db: hub.deps.db }, state: state() }) as unknown as CommandCtx;

const ours = (order_id: string): string => voidIdentifier(state(), readOrder(ctx(), order_id).order);
const theirs = (order_id: string): string =>
  passIdentity(state(), passScopedOrders(hub.deps.db, [order_id]).get(order_id)!, currentTableOf(hub.deps.db, [order_id])).identifier;

describe('[04 #20c] 04 identifier = 03b passIdentity / identifierText', () => {
  it('[04 #20c] the eight §3.5 fixtures: #12, #12 10 Nov, PARKING LEB 1234 SEDAN, T4 + T5, tie merge, > 40 chars, no current table, closed seating', async () => {
    hub = await startVoids({ open: false });
    const earlier = earlierDayTakeaway(hub, { date: '2025-11-10', token: 12 });
    openVoidsDay(hub);
    takeawayOrder(hub, { prefix: 'TW0' }); // today's token 1, so takeawayOrder's token fill reads today's date
    const today = takeawayOrder(hub, { token: 12 });
    const parking = parkingOrder(hub);
    const merged = mergedSeating(hub);
    const tie = tieMerge(hub);
    const long = longLabelSeating(hub);
    const none = noCurrentTable(hub);
    const closed = closedSeating(hub);

    const cases: Array<[string, string, string]> = [
      ['#12', today.order_id, '#12'],
      ['#12 10 Nov', earlier.order_id, '#12 10 Nov'],
      ['parking', parking.order_id, 'PARKING LEB 1234 SEDAN'],
      ['T4 + T5 (T4 order)', merged.order_ids[0]!, 'T4 + T5'],
      ['T4 + T5 (absorbed T5 order)', merged.order_ids[1]!, 'T4 + T5'],
      ['tie merge', tie.order_id, 'T6 + T7 + T8'],
      ['> 40 chars', long.order_id, long.label.slice(0, 40)],
      ['no current table', none.order_id, 'T2'],
      ['closed seating (G-14)', closed.order_id, 'T12'],
    ];
    for (const [name, order_id, want] of cases) {
      expect(ours(order_id), name).toBe(theirs(order_id));
      expect(ours(order_id), name).toBe(want);
    }
    expect(long.label.length).toBeGreaterThan(40);
    expect(ours(long.order_id)).toHaveLength(40);
  });

  it('[04 #20c] G-14: a closed seating keeps a non-null primary_table_id but table_ids = [] → the engine table, not the stale primary', async () => {
    hub = await startVoids();
    const closed = closedSeating(hub);
    const { order } = readOrder(ctx(), closed.order_id);
    expect(order.table_ids).toEqual([]);
    expect(order.primary_table_id).not.toBeNull();
    // the engine's table at submit decides; the head's primary_table_id is ignored
    const s = state();
    const moved = { ...s, orders: { ...s.orders, [closed.order_id]: { ...s.orders[closed.order_id]!, table_id: 'T4' } } } as EngineState;
    expect(voidIdentifier(moved, order)).toBe('T4');
  });

  it('[04 §3.5] voidIdentifier runs no statement (memory only)', async () => {
    hub = await startVoids();
    const m = mergedSeating(hub);
    const { order } = readOrder(ctx(), m.order_ids[0]!);
    const counter = statementCounter(hub.deps.db);
    expect(voidIdentifier(state(), order)).toBe('T4 + T5');
    expect(counter.count).toBe(0);
  });
});
