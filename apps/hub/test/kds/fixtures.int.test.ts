import type { EngineState } from '@pos/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { currentDirectory } from '../../src/auth/guards';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { COOK, FX, appendOrder, fireLines, openDay, pairKds, pairPassTablet, removeLine, serveLines, signInCook, voidLine } from './fixtures';

// 03b phase 0 P0.12: the fixtures do what they say, on real tables and real events.
let hub: TestHub;
afterEach(async () => {
  await hub?.close();
});

const engine = (): EngineState => hub.deps.state.get() as EngineState;
const row = (id: string) =>
  hub.deps.db.prepare('SELECT units, removed_units, voided_units, served_at FROM order_lines WHERE order_item_id = ?').get(id) as Record<string, number | null>;

describe('[03b P0.12] kds fixtures self-test', () => {
  it('[03b P0.12] a Cook with run-pass signs in on a Pass tablet bound to a point', async () => {
    hub = await createTestHub({ provisioned: true });
    const cook = await signInCook(hub, { pointId: 'P1' });
    expect(currentDirectory(hub.app).resolve(COOK.staff, 'run-pass')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(currentDirectory(hub.app).resolve(COOK.staff, 'reprint-ticket')).toEqual({ grant: 'allowed', scope: 'branch' });
    expect(hub.deps.db.prepare('SELECT device_type, point_id, lane_label FROM devices WHERE device_id = ?').get(cook.deviceId)).toEqual({
      device_type: 'tablet',
      point_id: 'P1',
      lane_label: null,
    });
    expect(hub.deps.db.prepare('SELECT staff_id, device_id, ended_at FROM staff_sessions WHERE session_id = ?').get(cook.sessionId)).toEqual({
      staff_id: COOK.staff,
      device_id: cook.deviceId,
      ended_at: null,
    });
  });

  it('[03b P0.12] a kds device with and without a lane label; a tablet without a point is not a Pass tablet', async () => {
    hub = await createTestHub({ provisioned: true });
    const lane = pairKds(hub, { stationId: FX.station, laneLabel: 'Left' });
    const plain = pairKds(hub, { stationId: FX.station });
    const tablet = pairPassTablet(hub, { pointId: 'P1' });
    const devices = hub.deps.db.prepare('SELECT device_id, device_type, station_id, point_id, lane_label FROM devices ORDER BY device_id').all();
    expect(devices).toEqual(
      expect.arrayContaining([
        { device_id: lane.deviceId, device_type: 'kds', station_id: FX.station, point_id: null, lane_label: 'Left' },
        { device_id: plain.deviceId, device_type: 'kds', station_id: FX.station, point_id: null, lane_label: null },
        { device_id: tablet.deviceId, device_type: 'tablet', station_id: null, point_id: 'P1', lane_label: null },
      ]),
    );
  });

  it('[03b P0.12] fire a line at its station; serve, remove and void helpers write real events the folds apply', async () => {
    hub = await createTestHub({ provisioned: true });
    openDay(hub);
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'L1', item_id: FX.naan, quantity: 2 },
        { order_item_id: 'L2', item_id: FX.naan },
        { order_item_id: 'L3', item_id: FX.naan, quantity: 3 },
      ],
    });
    expect(engine().lines.L1!.fired_at).toBeNull();
    const [fired] = fireLines(hub, FX.station, ['L1', 'L2', 'L3']);
    expect(fired!.event_type).toBe('FireDispatched');
    for (const id of ['L1', 'L2', 'L3']) expect(engine().lines[id]!.fired_at, id).toBe(fired!.recorded_at);

    removeLine(hub, order_id, 'L1', 1);
    expect(row('L1')).toMatchObject({ units: 2, removed_units: 1 });
    voidLine(hub, order_id, 'L3', 1);
    expect(row('L3')).toMatchObject({ units: 3, voided_units: 1 });
    serveLines(hub, order_id, ['L2']);
    expect(row('L2')!.served_at).not.toBeNull();
    expect(engine().lines.L2!.stage).toBe('served');
  });
});
