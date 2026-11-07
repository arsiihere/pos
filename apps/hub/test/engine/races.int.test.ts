// 03a task 27: race 74 on the hub (§10.3 #74, §3.7, §2.1 #2). Two submits claiming the last stock unit at once: one
// writer, and each fake submit reads the state inside its own transaction (02's SubmitOrder, stubbed §4.4), so the
// second sees the first's reservation: it gets full cook time (`cook_fresh`) or is refused (`sold_out`). Never a
// double reservation.
import { initialEngineState, openDayStartMs, type EngineState } from '@pos/engine';
import type { EventDraft, PosEvent } from '@pos/events';
import { aBranchConfigItemStock, aBusinessDayOpened, anEngineConfigApplied, aStockSet } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { replayEngine } from '../../src/engine-host/replay';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { fakeSubmitOrRefuse, type FakeOrder } from './fakes';

const COOK = 1_200_000;
const STOCK_COOK = 300_000;
const STOCK_ITEMS = aBranchConfigItemStock().stock_items;

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

// One line of item I1 (1 piece of stock item I1 per sale, 5 min from stock, 20 min fresh).
const orderOf = (order_id: string, behaviour: 'cook_fresh' | 'sold_out'): FakeOrder => ({
  order_id,
  lines: [
    {
      order_item_id: `${order_id}L1`,
      item: { item_id: 'I1', cook_time_ms: COOK, stock_time_ms: STOCK_COOK, stock_draws: [{ stock_item_id: 'I1', quantity: 1 }], out_of_stock_behaviour: behaviour },
    },
  ],
});

describe('03a #74 hub: two submits claiming the last stock unit', () => {
  let hub: TestHub | null = null;

  afterEach(async () => {
    await hub?.close();
    hub = null;
  });

  // The day open, then on_hand 1 of I1: one unit left.
  async function lastUnit(): Promise<TestHub> {
    const h = await createTestHub();
    hub = h;
    h.deps.writer.run((tx) => tx.append([anEngineConfigApplied(), aBusinessDayOpened(), aStockSet({ stream_id: 'I1', payload: { stock_item_id: 'I1', on_hand: 1, unit: 'piece' } })].map(draftOf)));
    return h;
  }

  // Both commands are in flight at once (the same tick of the event loop); the one writer runs them one after the other.
  async function race(h: TestHub, a: FakeOrder, b: FakeOrder): Promise<Array<{ refused: string[]; appended: PosEvent[] }>> {
    const stock = () => ({ dayStartMs: openDayStartMs(h.deps.state.get() as EngineState) ?? 0, stockItems: STOCK_ITEMS });
    const submit = async (o: FakeOrder) => {
      await Promise.resolve();
      return fakeSubmitOrRefuse(h.deps, o, stock());
    };
    return Promise.all([submit(a), submit(b)]);
  }

  const reservedEvents = (events: readonly PosEvent[]): PosEvent[] => events.filter((e) => e.event_type === 'StockReserved');

  function assertOneReservation(h: TestHub): void {
    const state = h.deps.state.get() as EngineState;
    expect(state.stock.I1).toMatchObject({ on_hand: 1, reserved: 1 });
    const rows = h.deps.db.prepare("SELECT COUNT(*) FROM events WHERE event_type = 'StockReserved'").pluck().get();
    expect(rows).toBe(1);
    // §2.1 #1: the log rebuilds the live state, with no breach.
    const kinds: string[] = [];
    const replayed = replayEngine(h.deps.db, 'branch-1', 0, initialEngineState(), (d) => kinds.push(d.kind));
    expect({ ...replayed.state, diagnostics: [] }).toStrictEqual({ ...state, diagnostics: [] });
    expect(kinds).toEqual([]);
  }

  it('[03a #74 hub] cook_fresh: the first is served from stock; the second gets full cook time and no reservation', async () => {
    const h = await lastUnit();
    const [first, second] = await race(h, orderOf('O1', 'cook_fresh'), orderOf('O2', 'cook_fresh'));
    expect(first!.refused).toEqual([]);
    expect(second!.refused).toEqual([]);
    expect(reservedEvents(first!.appended).map((e) => e.payload)).toEqual([{ stock_item_id: 'I1', order_item_id: 'O1L1', quantity: 1 }]);
    expect(reservedEvents(second!.appended)).toEqual([]);
    const placed = second!.appended.find((e) => e.event_type === 'OrderPlaced')!.payload as { lines: Array<{ from_stock: boolean }> };
    expect(placed.lines.map((l) => l.from_stock)).toEqual([false]);
    const state = h.deps.state.get() as EngineState;
    expect(state.lines.O1L1).toMatchObject({ from_stock: true, cook_ms: STOCK_COOK });
    expect(state.lines.O2L1).toMatchObject({ from_stock: false, cook_ms: COOK, reserved_seq: null });
    assertOneReservation(h);
  });

  it('[03a #74 hub] sold_out: the first is served from stock; the second is refused and writes nothing', async () => {
    const h = await lastUnit();
    const before = h.deps.writer.lastSeq();
    const [first, second] = await race(h, orderOf('O1', 'sold_out'), orderOf('O2', 'sold_out'));
    expect(first!.refused).toEqual([]);
    expect(reservedEvents(first!.appended)).toHaveLength(1);
    expect(second).toEqual({ refused: ['O2L1'], appended: [] });
    expect(h.deps.writer.lastSeq()).toBe(before + first!.appended.length);
    const state = h.deps.state.get() as EngineState;
    expect(state.orders.O2).toBeUndefined();
    expect(state.lines.O1L1).toMatchObject({ from_stock: true });
    assertOneReservation(h);
  });
});
