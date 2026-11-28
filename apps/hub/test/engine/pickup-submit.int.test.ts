// ⚠️ 03a v1.2.11 §10.3h test 192 (m-11; §3.5.8 PK-1, PK-2): submit and preview with a pickup on the hub. 02b v1.0.25
// (the takeaway pickup on SubmitOrder) is not built, so the test builds the §4.2 batch from a fixture ProposedOrder the
// way SubmitOrder does (checkOrderable → reserveStock → planOrder in one writer transaction, fakes.ts), and the preview
// is the eta-preview's engine call on the same draft (reserveStock, then calculateETA on the state before the submit).
import { calculateETA, initialEngineState, planOrder, reserveStock, type EngineState } from '@pos/engine';
import type { EngineConfig, PosEvent } from '@pos/events';
import { aBusinessDayOpened, anEngineConfigApplied } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { replayEngine } from '../../src/engine-host/replay';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { draftOf, fakeSubmit, proposedOf, type FakeOrder } from './fakes';

const MIN = 60_000;
const hubs: TestHub[] = [];

afterEach(async () => {
  for (const h of hubs.splice(0)) await h.close();
});

// One slot station S1 (Waada Guard, capacity 2) and the branch settings of anEngineConfigApplied (takeaway padding 3 min).
async function kitchen(): Promise<TestHub> {
  const hub = await createTestHub();
  hubs.push(hub);
  const base = anEngineConfigApplied().payload as unknown as EngineConfig;
  const config = { ...base, stations: [{ ...base.stations[0]!, station_id: 'S1', capacity: 2 }] };
  hub.deps.writer.run((tx) => tx.append([anEngineConfigApplied({ payload: config as unknown as Record<string, unknown> }), aBusinessDayOpened()].map((e: PosEvent) => draftOf(e, tx.clock.branchNow()))));
  return hub;
}

// A takeaway with a sync burger (10 min) and a held immediate drink (2 min).
function takeaway(order_id: string, pickup_at_ms: number | null): FakeOrder {
  return {
    order_id,
    order: { order_type: 'takeaway', table_id: null, table_key: `takeaway:${order_id}`, follow_up: false, pickup_at_ms },
    lines: [
      { order_item_id: `${order_id}-B`, item: { cook_time_ms: 10 * MIN, serve_mode: 'sync' } },
      { order_item_id: `${order_id}-D`, item: { cook_time_ms: 2 * MIN, serve_mode: 'immediate' } },
    ],
  };
}

describe('[03a #192] hub: submit and preview with a pickup (PK-1, PK-2; m-11)', () => {
  it('[03a #192] the stored promise_ms equal a fresh fold\'s targets + padding; the preview of the same draft gives the same promise_ms and eta_ms; the submit\'s statements are those of an order without pickup', async () => {
    const hub = await kitchen();
    const now = hub.clock.branchNow();
    const pickup = now + 30 * MIN;
    const fake = takeaway('OP', pickup);
    const before = hub.deps.state.get();
    const proposed = proposedOf(fake);
    const reserved = reserveStock(before, proposed, 0, [], {});
    const preview = calculateETA(before, proposed, now, reserved.from_stock);
    const plan = planOrder(before, proposed, now, reserved.from_stock);

    const counter = statementCounter(hub.deps.db);
    const appended = fakeSubmit(hub.deps, fake);
    const withPickup = counter.count;

    const placed = appended.find((e) => e.event_type === 'OrderPlaced')!.payload as { pickup_at_ms: number; groups: Array<{ group_id: string; target_land_ms: number; promise_ms: number }> };
    expect(placed.pickup_at_ms).toBe(pickup);
    // A fresh fold of the stored log (boot step 3 from seq 0).
    const fresh: EngineState = replayEngine(hub.deps.db, 'branch-1', 0, initialEngineState(), () => undefined).state;
    const padding = fresh.config!.settings.promise_padding_takeaway_ms;
    const order = fresh.orders.OP!;
    expect(order.pickup_at_ms).toBe(pickup);
    // ⚠️ 03a v1.2.12 (owner 2026-11-28, QA BUG-5): both groups land at pickup − padding (PK-2: T_L = max(p − padding,
    // land)), so each stored promise = target + padding = the pickup.
    expect(Object.values(order.groups).map((g) => g.target_land_ms)).toEqual([pickup - padding, pickup - padding]);
    expect(placed.groups.map((g) => g.promise_ms)).toEqual([pickup, pickup]);
    expect(placed.groups.map((g) => g.promise_ms)).toEqual(placed.groups.map((g) => order.groups[g.group_id]!.target_land_ms + padding));
    expect(placed.groups).toEqual(plan.groups);
    // The drink is held: unfired, booked to end by the pickup, not at its earliest fit.
    expect(fresh.lines['OP-D']).toMatchObject({ serve_mode: 'immediate', fired_at: null });
    expect(fresh.lines['OP-D']!.booked!.start).toBeGreaterThan(now + 20 * MIN);
    expect(fresh.lines['OP-D']!.booked!.end).toBeLessThanOrEqual(pickup - padding);
    expect({ ...fresh, diagnostics: [] }).toEqual({ ...hub.deps.state.get(), diagnostics: [] });

    // The preview of the same draft: the same promise_ms per group and eta_ms per line (a held line's eta = its T_L).
    expect(preview.groups.map((g) => g.promise_ms)).toEqual(placed.groups.map((g) => g.promise_ms));
    expect(preview.lines.map((l) => [l.order_item_id, l.eta_ms])).toEqual(plan.lines.map((l) => [l.order_item_id, l.eta_ms]));
    expect(preview.lines.find((l) => l.order_item_id === 'OP-D')!.eta_ms).toBe(pickup - padding); // ⚠️ v1.2.12: T_L = p − padding

    // The same order without pickup, on an identical hub: the submit makes the same statements (the engine is pure).
    const other = await kitchen();
    const plain = statementCounter(other.deps.db);
    fakeSubmit(other.deps, takeaway('OP', null));
    expect(withPickup).toBeGreaterThan(0);
    expect(withPickup).toBe(plain.count);
  });
});
