import type { EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, openDay, openSeating } from './fixtures';

// 02b v1.0.10 §6.19 test 41 (04 §4.5 Q-1): `alert_id` on OrderCancelled / OrderFoodCleared is ignored by the folds —
// the same stream with and without it gives identical `orders` / `order_lines` rows (02b) and `seating_orders` /
// `seatings` rows (02a, which folds OrderFoodCleared). Two fresh hubs, the same scenario, real events via the writer.
const hubs: TestHub[] = [];

afterEach(async () => {
  for (const h of hubs.splice(0)) await h.close();
});

type Snapshot = Record<string, unknown[]>;

function snapshot(hub: TestHub): Snapshot {
  const all = (sql: string) => hub.deps.db.prepare(sql).all();
  return {
    orders: all('SELECT * FROM orders ORDER BY order_id'),
    order_lines: all('SELECT * FROM order_lines ORDER BY order_item_id'),
    seating_orders: all('SELECT * FROM seating_orders ORDER BY order_id'),
    seatings: all('SELECT * FROM seatings ORDER BY seating_id'),
  };
}

function append(hub: TestHub, order_id: string, events: Array<{ event_type: string; payload: Record<string, unknown> }>): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) =>
    tx.append(
      events.map(
        (e): EventDraft => ({
          stream_type: 'order',
          stream_id: order_id,
          event_type: e.event_type,
          schema_version: 1,
          payload: e.payload,
          occurred_at: now,
          actor_id: 'S_WAIT',
          device_id: 'D_FIXTURE',
        }),
      ),
    ),
  );
}

/** Void the food line (food cleared, an unserved non-food line stays), then the last line (order cancelled). */
async function scenario(alertId: Record<string, unknown>): Promise<Snapshot[]> {
  const hub = await createTestHub();
  hubs.push(hub);
  openDay(hub, { stock: { [FX.stock]: 100_000 } });
  openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEAT1' });
  const { order_id } = appendOrder(hub, {
    order_id: 'O1',
    order_type: 'dine_in',
    seating_id: 'SEAT1',
    lines: [
      { order_item_id: 'L1', item_id: FX.naan },
      { order_item_id: 'L2', item_id: FX.naan },
    ],
  });
  const steps: Snapshot[] = [snapshot(hub)];
  append(hub, order_id, [
    { event_type: 'ItemVoided', payload: { order_item_id: 'L1', units: 1 } },
    { event_type: 'OrderFoodCleared', payload: { order_id, food_served: false, ...alertId } },
  ]);
  steps.push(snapshot(hub));
  append(hub, order_id, [
    { event_type: 'ItemVoided', payload: { order_item_id: 'L2', units: 1 } },
    { event_type: 'OrderCancelled', payload: { order_id, ...alertId } },
  ]);
  steps.push(snapshot(hub));
  return steps;
}

describe('[02b #41] OrderCancelled / OrderFoodCleared alert_id is ignored by the folds', () => {
  it('[02b #41] orders, order_lines, seating_orders and seatings rows are identical with and without alert_id', async () => {
    const bare = await scenario({});
    const withId = await scenario({ alert_id: 'A1' });
    expect(withId).toEqual(bare);
    // the stream reached the folds: food cleared, then the order cancelled
    expect(bare[1]!.seating_orders).not.toEqual(bare[0]!.seating_orders);
    expect((bare[2]!.orders[0] as { cancelled_at: number | null }).cancelled_at).not.toBeNull();
    // and the stored payloads differ only by alert_id
    const stored = hubs[1]!.deps.db
      .prepare("SELECT payload FROM events WHERE event_type IN ('OrderFoodCleared', 'OrderCancelled') ORDER BY seq")
      .all()
      .map((r) => JSON.parse((r as { payload: string }).payload) as { alert_id?: string });
    expect(stored.map((p) => p.alert_id)).toEqual(['A1', 'A1']);
  });
});
