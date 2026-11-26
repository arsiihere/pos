import { ORDER_EXIT_AFTER_SERVED_MS, type EngineState } from '@pos/engine';
import type { PosEvent } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { audienceAllows } from '../../src/ws/audience';
import type { SocketCtx } from '../../src/ws/catch-up';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type DeviceProfileInput, type TestHub } from '../helpers/test-hub';
import { FX, appendOrder, openDay, openSeating, pairDevice, pairKds, pairPassTablet, serveLines, signInCook } from './fixtures';

// 03b v1.0.16 §6.17 (02b-tk R8; hostile run 1 M-2, m-1, m-11; plan K-1, 03b task 42): the Pass events ReadyToServe,
// ReadyToServeUndone and Handover of a takeaway / parking order also reach every staff socket on a counter device (its
// current 05a profile shows `takeaway` / `parking`), whatever its hardware or point; ReadyRetargeted never does.
// Tests 97, 98, 106 (audience part). Memory, 0 statements.

let hub: TestHub;
afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
});

const engine = (): EngineState => hub.deps.state.get() as EngineState;

let seq = 5_000;
function ev(event_type: string, order_id: string, payload: Record<string, unknown>): PosEvent {
  seq += 1;
  return {
    event_id: `E${seq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', seq, stream_type: 'order', stream_id: order_id, event_type,
    schema_version: 1, payload, occurred_at: 0, recorded_at: 0, actor_id: null, device_id: 'hub',
  } as PosEvent;
}

const staff = (deviceId: string, deviceType: SocketCtx['deviceType'], id: string): SocketCtx => ({ deviceId, deviceType, sessionId: `X_${id}`, kind: 'staff', staffId: 'S_CASH', stationId: null, asOfSeq: 0 });

async function start(): Promise<Record<string, SocketCtx>> {
  hub = await createTestHub({ provisioned: true });
  await signInCook(hub, { pointId: 'P1' });
  openDay(hub);
  const dev = (type: 'cashier_kiosk' | 'tablet' | 'phone', profile: DeviceProfileInput) => pairDevice(hub, { type, profile }).deviceId;
  return {
    pass: staff(pairPassTablet(hub, { pointId: 'P1' }).deviceId, 'tablet', 'pass'),
    kioskTakeaway: staff(dev('cashier_kiosk', { access: 'everyone', screens: ['takeaway', 'cashier'] }), 'cashier_kiosk', 'kt'),
    tabletTakeaway: staff(dev('tablet', { access: 'everyone', screens: ['takeaway'] }), 'tablet', 'tt'),
    kioskDineIn: staff(dev('cashier_kiosk', { access: 'everyone', screens: ['dine_in', 'cashier'] }), 'cashier_kiosk', 'kd'),
    waiterPhone: staff(dev('phone', { access: 'everyone', screens: ['dine_in'] }), 'phone', 'wp'),
    kioskParking: staff(dev('cashier_kiosk', { access: 'everyone', screens: ['parking'] }), 'cashier_kiosk', 'kp'),
    kds: { deviceId: pairKds(hub, { stationId: FX.station }).deviceId, deviceType: 'kds', sessionId: 'X_kds', kind: 'station', staffId: null, stationId: FX.station, asOfSeq: 0 },
  };
}

const who = (seats: Record<string, SocketCtx>, event: PosEvent): string[] =>
  Object.entries(seats).filter(([, s]) => audienceAllows(event, s)).map(([k]) => k).sort();

const passEvents = (order_id: string): PosEvent[] => [
  ev('ReadyToServe', order_id, { order_id, point_id: 'P1', order_item_ids: ['L1'], added_ids: ['L1'], forced_ids: [], table_id: null, alert_id: 'A1' }),
  ev('ReadyToServeUndone', order_id, { order_id, point_id: 'P1', alert_id: 'A1' }),
  ev('Handover', order_id, { handover_id: 'H1', order_id, point_id: 'P1', receiver_staff_id: 'S_CASH', order_item_ids: ['L1'], alert_id: 'C1', ready_alert_closed: null }),
];

describe('[03b v1.0.16 §6.17] Pass events to the counter (K-1)', () => {
  it('#97: a takeaway order reaches the point Pass and the takeaway counter devices only; parking reaches parking; dine-in no counter; 0 statements', async () => {
    const seats = await start();
    const takeaway = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'L1', item_id: FX.piece }] }).order_id;
    const parking = appendOrder(hub, { order_type: 'parking', car_number: 'LEA-1', lines: [{ order_item_id: 'L2', item_id: FX.piece }] }).order_id;
    openSeating(hub, { table_id: 'T1', seating_id: 'SEAT1' });
    const dineIn = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'L3', item_id: FX.piece }] }).order_id;
    const counter = statementCounter(hub.deps.db);
    for (const e of passEvents(takeaway)) expect(who(seats, e), e.event_type).toEqual(['kioskTakeaway', 'pass', 'tabletTakeaway']);
    for (const e of passEvents(parking)) expect(who(seats, e), e.event_type).toEqual(['kioskParking', 'pass']);
    for (const e of passEvents(dineIn)) expect(who(seats, e), e.event_type).toEqual(['pass']);
    expect(counter.count).toBe(0);
    // an order never seen by the engine: no counter delivery
    for (const e of passEvents('O_UNKNOWN')) expect(who(seats, e), e.event_type).toEqual(['pass']);
  });

  it('#98: an order the engine drops in the same commit is still typed for that commit, dropped one commit later; ReadyRetargeted never reaches a counter', async () => {
    const seats = await start();
    const takeaway = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'L1', item_id: FX.piece }] }).order_id;
    const retarget = ev('ReadyRetargeted', takeaway, { order_id: takeaway, point_id: 'P1', table_id: 'T1', alert_id: 'A2', previous_alert_id: 'A1' });
    expect(who(seats, retarget)).toEqual(['pass']);
    serveLines(hub, takeaway, ['L1']);
    hub.clock.advance(ORDER_EXIT_AFTER_SERVED_MS);
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'L8', item_id: FX.piece }] }); // an engine event: the served order is dropped in this commit
    expect(engine().orders[takeaway]).toBeUndefined();
    const [undo] = passEvents(takeaway).slice(1);
    expect(who(seats, undo!)).toEqual(['kioskTakeaway', 'pass', 'tabletTakeaway']);
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'L9', item_id: FX.piece }] }); // one commit later
    expect(who(seats, undo!)).toEqual(['pass']);
  });

  it('#106 (audience): a Handover without a Ready on a takeaway — its ReadyToServe { alert_id: null } and Handover reach the counter', async () => {
    const seats = await start();
    const takeaway = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'L1', item_id: FX.piece }] }).order_id;
    const ready = ev('ReadyToServe', takeaway, { order_id: takeaway, point_id: 'P1', order_item_ids: ['L1'], added_ids: ['L1'], forced_ids: [], table_id: null, alert_id: null });
    expect(who(seats, ready)).toEqual(['kioskTakeaway', 'pass', 'tabletTakeaway']);
    expect(who(seats, passEvents(takeaway)[2]!)).toEqual(['kioskTakeaway', 'pass', 'tabletTakeaway']);
  });
});
