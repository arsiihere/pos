import type { EngineState } from '@pos/engine';
import type { BranchConfig, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registeredTicks } from '../../src/alerts/tick';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { passClosuresTick } from '../../src/kds/ticks';
import { SERVED_ESTIMATE_TICK, servedEstimateTick } from '../../src/orders/served-estimate-tick';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, seedDirectory, type TestHub } from '../helpers/test-hub';
import { COOK, FX, append, appendOrder, cookDirectory, fireLines, fixtureMenu, openDay, pairDevice, pairPassTablet, removeLine, serveLines } from '../kds/fixtures';

// 02b §3.7 "Estimated Served", §6.11 tick `served_estimate` (03b §4.3, task 0e; G-2): `due` = 03b's handoversDue when
// `served_estimate_ms` is not null; intents = servedDrafts(…, 'estimated') per order. Hand-overs through the real
// Handover route; serving / removing through real events; a tick pass is run as the loop runs it, with an injected clock.

let hub: TestHub;
const POINT = 'P1';
const ESTIMATE = 180_000;
const engine = (): EngineState => hub.deps.state.get() as EngineState;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
});
afterEach(async () => {
  counter = null;
  await hub.close();
});

function menu(served_estimate_ms: number | null): BranchConfig {
  const m = fixtureMenu();
  return { ...m, engine_settings: { ...m.engine_settings, served_estimate_ms } };
}

const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
function cook(order_id: string, ids: string[]): void {
  fireLines(hub, engine().lines[ids[0]!]!.station_id, ids);
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
}
const takeaway = (lines: Array<{ order_item_id: string; item_id: string }>) => appendOrder(hub, { order_type: 'takeaway', lines }).order_id;
const naans = (ids: string[]) => ids.map((order_item_id) => ({ order_item_id, item_id: FX.naan }));

interface Who {
  deviceId: string;
  token: string;
  sessionToken: string;
}
async function seed(): Promise<Who> {
  await seedDirectory(hub, await cookDirectory());
  const device = pairPassTablet(hub, { pointId: POINT });
  const session = openSession(hub, { kind: 'staff', staffId: COOK.staff, deviceId: device.deviceId });
  openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: pairDevice(hub, { type: 'tablet' }).deviceId }); // a signed-in receiver (03b B4-3)
  return { deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}
let seq = 0;
async function handover(who: Who, order_id: string, order_item_ids?: string[]): Promise<{ handover_id: string; served_card_alert_id: string }> {
  seq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/handover',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: `cmd-${seq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'Handover',
      payload: { order_id, point_id: POINT, receiver_staff_id: 'S_OWNER', ...(order_item_ids === undefined ? {} : { order_item_ids }) },
      occurred_at: hub.clock.branchNow(),
      actor_id: COOK.staff,
      device_id: who.deviceId,
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: { result: { handover_id: string; served_card_alert_id: string } } }).data.result;
}

interface Stored {
  event_type: string;
  stream_id: string;
  actor_id: string | null;
  device_id: string;
  payload: Record<string, unknown>;
}
/** One pass of the tick as the loop runs it: due (read-only view), then its own writer.run with the intents appended. */
let counter: ReturnType<typeof statementCounter> | null = null;
function pass(): { due: boolean; dueStatements: number; intentStatements: number; events: Stored[] } {
  const now = hub.clock.branchNow();
  counter ??= statementCounter(hub.deps.db);
  const before = counter.count;
  const due = servedEstimateTick.due(readOnlyDb(hub.deps.db), hub.deps.state.get(), now);
  const dueStatements = counter.count - before;
  if (!due) return { due, dueStatements, intentStatements: -1, events: [] };
  let intentStatements = -1;
  const { appended } = hub.deps.writer.run((tx) => {
    const start = counter!.count;
    const drafts = servedEstimateTick.intents(tx, hub.deps.state.get(), now);
    intentStatements = counter!.count - start;
    return tx.append(drafts);
  });
  return { due, dueStatements, intentStatements, events: appended.map((e) => ({ event_type: e.event_type, stream_id: e.stream_id, actor_id: e.actor_id, device_id: e.device_id, payload: e.payload as Record<string, unknown> })) };
}
const servedRow = (id: string) => hub.deps.db.prepare('SELECT served_at, served_source FROM order_lines WHERE order_item_id = ?').get(id) as { served_at: number | null; served_source: string | null };

describe('02b tick served_estimate (§3.7, §6.11; 03b §4.3 task 0e)', () => {
  it('[02b §6.11] registered once per process', async () => {
    const second = await createTestHub({ provisioned: true });
    await second.close();
    expect(registeredTicks().filter((t) => t.name === SERVED_ESTIMATE_TICK)).toEqual([servedEstimateTick]);
  });

  it('[02b §6.11] null setting = not due, even for a hand-over long past any cut-off', async () => {
    openDay(hub, { menu: menu(null) });
    const who = await seed();
    const a = takeaway(naans(['A1']));
    cook(a, ['A1']);
    await handover(who, a);
    hub.clock.advance(3_600_000);
    expect(pass().due).toBe(false);
    expect(servedRow('A1').served_at).toBeNull();
  });

  it('[02b §3.7] after served_estimate_ms: ItemServed { estimated } per order (unsettled handed lines only) + OrderFoodServed; the card then closes', async () => {
    openDay(hub, { menu: menu(ESTIMATE) });
    const who = await seed();
    const a = takeaway(naans(['A1', 'A2', 'A3', 'A4']));
    const b = takeaway(naans(['B1']));
    cook(a, ['A1', 'A2', 'A3', 'A4']);
    cook(b, ['B1']);
    const ha = await handover(who, a, ['A1', 'A2', 'A3']); // A4 done but never handed
    await handover(who, b);
    serveLines(hub, a, ['A1']); // the waiter's own tap: settled
    removeLine(hub, a, 'A3'); // removed: settled

    hub.clock.advance(ESTIMATE - 10_000);
    expect(pass(), 'not before the cut-off').toMatchObject({ due: false, dueStatements: 1 });
    hub.clock.advance(10_000);

    const run = pass();
    // due = handoversDue (2); intents = handoversDue (2) + orderLines (1); servedDrafts and stockEffects run on memory
    expect(run).toMatchObject({ due: true, dueStatements: 2, intentStatements: 3 });
    const served = run.events.filter((e) => e.event_type === 'ItemServed');
    expect(served.map((e) => [e.stream_id, e.payload])).toEqual([
      [a, { order_item_ids: ['A2'], source: 'estimated' }],
      [b, { order_item_ids: ['B1'], source: 'estimated' }],
    ]);
    for (const e of run.events) expect(e).toMatchObject({ actor_id: null, device_id: 'hub' });
    // per order: ItemServed → OrderFoodServed (naan is food, §3.3) → its stock effects
    const types = run.events.map((e) => `${e.event_type}:${e.stream_id === a ? 'a' : e.stream_id === b ? 'b' : e.stream_id}`);
    expect(types.indexOf('ItemServed:a')).toBeLessThan(types.indexOf('OrderFoodServed:a'));
    expect(types.indexOf('OrderFoodServed:a')).toBeLessThan(types.indexOf('ItemServed:b'));
    expect(types).toContain('OrderFoodServed:b');

    expect(servedRow('A2').served_source).toBe('estimated');
    expect(servedRow('A1').served_source).toBe('tap');
    expect(servedRow('A4').served_at).toBeNull();
    expect(engine().lines.A2?.stage).toBe('served');
    expect(pass().due, 'settled: nothing left').toBe(false);

    // 03b §3.5: the estimate settles the hand-over, so pass_closures closes its card `done`
    const now = hub.clock.branchNow();
    hub.deps.writer.run((tx) => tx.append(passClosuresTick.intents(tx, engine(), now)));
    expect(hub.deps.db.prepare('SELECT state, close_reason FROM alerts WHERE alert_id = ?').get(ha.served_card_alert_id)).toEqual({ state: 'closed', close_reason: 'done' });
  });

  it('[02b §6.11] race rule: a line served by tap between due and intents → intents re-selects and writes nothing', async () => {
    openDay(hub, { menu: menu(ESTIMATE) });
    const who = await seed();
    const a = takeaway(naans(['A1']));
    cook(a, ['A1']);
    await handover(who, a);
    hub.clock.advance(ESTIMATE);
    const now = hub.clock.branchNow();
    expect(servedEstimateTick.due(readOnlyDb(hub.deps.db), engine(), now)).toBe(true);
    serveLines(hub, a, ['A1']);
    const drafts: EventDraft[] = hub.deps.writer.run((tx) => servedEstimateTick.intents(tx, engine(), now)).result;
    expect(drafts).toEqual([]);
    expect(servedRow('A1').served_source).toBe('tap');
  });

  it('[02b §3.7] two due hand-overs of one order → one ItemServed for that order with both hand-overs\' lines', async () => {
    openDay(hub, { menu: menu(ESTIMATE) });
    const who = await seed();
    const a = takeaway(naans(['A1', 'A2']));
    cook(a, ['A1', 'A2']);
    await handover(who, a, ['A1']);
    await handover(who, a, ['A2']);
    hub.clock.advance(ESTIMATE);
    const run = pass();
    expect(run.events.filter((e) => e.event_type === 'ItemServed').map((e) => e.payload)).toEqual([{ order_item_ids: ['A1', 'A2'], source: 'estimated' }]);
    expect(run.events.filter((e) => e.event_type === 'OrderFoodServed')).toHaveLength(1);
  });
});
