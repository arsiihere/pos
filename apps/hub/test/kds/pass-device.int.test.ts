import type { EngineState } from '@pos/engine';
import type { DeviceProfileSetPayload } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import type { StepDef } from '../../src/alerts/kinds';
import { batchReads, resolveStep, resolveTargets } from '../../src/alerts/targets';
import { alertsTick } from '../../src/alerts/tick';
import { deviceProfile } from '../../src/auth/device-profile';
import { StaffDirectory } from '../../src/auth/staff-directory';
import { devicePoint } from '../../src/kds/contracts';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { WsHub } from '../../src/ws/server';
import { createTestHub, openSession, pairDevice as pairDeviceRow, seedDirectory, type TestHub } from '../helpers/test-hub';
import { COOK, append, cookDirectory, openDay, pairKds, FX } from './fixtures';

// 05a §4.5 K-1 + D-4 (plan task 27): a "Pass tablet" is any non-kds device with `devices.point_id` set, in every reader
// (the devicePoint map, also refreshed after DeviceProfileSet; the `point` resolver; kds-config.pass_tablets; 01d
// always_on). The `device_roles` fold writes lane_label only; the DeviceProfileSet fold is the one writer of
// devices.point_id (§5.1, N-11). Tests 05a #22, #29.

const BRANCH = 'branch-1';
const ws = {} as WsHub;
const raisedStep: StepDef = { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] };

let hub: TestHub;
afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
});

function roleSet(device_id: string, point_id: string | null, lane_label: string | null = null) {
  return { stream_type: 'hub' as const, stream_id: BRANCH, event_type: 'DeviceRoleSet', payload: { device_id, point_id, lane_label } };
}

function profileSet(device_id: string, point_id: string | null, profile_version: number) {
  const payload: DeviceProfileSetPayload = {
    device_id,
    device_name: 'Phone',
    access: 'listed',
    staff_ids: [COOK.staff],
    screens: point_id === null ? ['dine_in'] : ['pass', 'dine_in'],
    point_id,
    profile_version,
    cause: profile_version === 1 ? 'approved' : 'edited',
    needs_review: false,
  };
  return { stream_type: 'hub' as const, stream_id: device_id, event_type: 'DeviceProfileSet', payload };
}

const pointOf = (id: string): string | null =>
  (hub.deps.db.prepare('SELECT point_id FROM devices WHERE device_id = ?').get(id) as { point_id: string | null }).point_id;

describe('[05a §4.5 K-1, D-4] a non-kds device with a point is a Pass device', () => {
  it('[05a #22] a phone with pass + point_id receives ready_to_serve, is in always_on, and is listed in kds-config.pass_tablets', async () => {
    hub = await createTestHub({ provisioned: true });
    await seedDirectory(hub, await cookDirectory());
    openDay(hub);
    const phone = pairDeviceRow(hub, {
      type: 'phone',
      ownerStaffId: COOK.staff,
      name: 'Cook phone',
      profile: { access: 'listed', staff_ids: [COOK.staff], screens: ['pass', 'dine_in'], point_id: 'P1' },
    });
    // the DeviceProfileSet commit wrote the point and refreshed both maps (no manual loadDeviceMaps)
    expect(deviceProfile(phone.deviceId)?.point_id).toBe('P1');
    expect(devicePoint(phone.deviceId)).toBe('P1');
    openSession(hub, { kind: 'staff', staffId: COOK.staff, deviceId: phone.deviceId });

    // the `point` resolver reaches the phone and the person signed in on it
    const point = hub.deps.writer.run((tx) => resolveTargets(tx, [{ kind: 'point', point_id: 'P1' }])).result;
    expect(point.get('point:P1')).toEqual({ staff_ids: [COOK.staff], device_ids: [phone.deviceId] });

    // ready_to_serve step 3 (2 × window_ms) reaches the point's devices: the phone
    const { alert_id } = hub.deps.writer.run((tx) => {
      const r = alerts.raise(alerts.tickCtx(tx, hub.clock.branchNow()), {
        kind: 'ready_to_serve',
        subject: { stream_type: 'order', stream_id: 'O1' },
        target: { kind: 'person', staff_id: 'S_WAIT' },
        values: { order_id: 'O1', point_id: 'P1', table_id: 'T4', window_ms: 60_000 },
        details: { identifier: 'T4' },
        dedupe_key: 'ready_to_serve:O1:P1',
        display: { kind_label_key: 'alert.ready_to_serve.lock' },
      });
      tx.append(r.events);
      return r;
    }).result;
    for (const ms of [60_000, 60_000]) {
      hub.clock.advance(ms);
      const now = hub.clock.branchNow();
      hub.deps.writer.run((tx) => tx.append(alertsTick.intents(tx, tx.state as EngineState, now)));
    }
    const step3 = hub.deps.db.prepare('SELECT device_id FROM alert_recipients WHERE alert_id = ? AND step = 2').all(alert_id) as Array<{ device_id: string | null }>;
    expect(step3.map((r) => r.device_id)).toContain(phone.deviceId);

    // 01d §3.4 always_on (row D-4): the phone of an active point is in; a phone without a point is not
    const plain = pairDeviceRow(hub, { type: 'phone', ownerStaffId: 'S_WAIT', profile: { access: 'listed', staff_ids: ['S_WAIT'], screens: ['dine_in'] } });
    const dir = StaffDirectory.fromInput(await cookDirectory());
    const alwaysOn = hub.deps.writer.run((tx) => {
      const row = { alert_id: 'A1', kind: 't', requester_staff_id: null, target: { kind: 'always_on' as const }, values: {}, request: null, step: -1, raised_at: hub.clock.branchNow() };
      const reads = batchReads(tx, [row], { previousStep: false, steps: new Map([['A1', [0]]]) });
      return resolveStep(raisedStep, row, reads, dir, ws).map((r) => r.device_id);
    }).result;
    expect(alwaysOn).toContain(phone.deviceId);
    expect(alwaysOn).not.toContain(plain.deviceId);

    // kds-config.pass_tablets lists the phone (shape unchanged)
    const adminDevice = pairDeviceRow(hub, { type: 'tablet', name: 'Admin tab' });
    const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: adminDevice.deviceId });
    const res = await hub.app.inject({ method: 'GET', url: '/admin/queries/kds-config', headers: { authorization: `Bearer ${adminDevice.token}`, 'x-admin-session': session.token } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { pass_tablets: unknown[] } }).data.pass_tablets).toEqual([{ device_id: phone.deviceId, name: 'Cook phone', point_id: 'P1', state: 'offline' }]);
  });

  it('[05a #29] devices.point_id = the last DeviceProfileSet whatever the replay order; DeviceRoleSet writes the lane only', async () => {
    hub = await createTestHub({ provisioned: true });
    const phone = pairDeviceRow(hub, { type: 'phone', ownerStaffId: COOK.staff });
    const kds = pairKds(hub, { stationId: FX.station });
    // live: a historic DeviceRoleSet (point P_OLD) between two DeviceProfileSet; the role events never move the point
    append(hub, [roleSet(phone.deviceId, 'P_OLD')]);
    expect(pointOf(phone.deviceId)).toBeNull();
    append(hub, [profileSet(phone.deviceId, 'P1', 1)]);
    append(hub, [roleSet(phone.deviceId, 'P_OLD'), roleSet(kds.deviceId, 'P_OLD', 'Lane A')]);
    expect(pointOf(phone.deviceId)).toBe('P1');
    expect(devicePoint(phone.deviceId)).toBe('P1');
    expect(hub.deps.db.prepare('SELECT point_id, lane_label FROM devices WHERE device_id = ?').get(kds.deviceId)).toEqual({ point_id: null, lane_label: 'Lane A' });
    append(hub, [profileSet(phone.deviceId, 'P2', 2)]);
    append(hub, [roleSet(phone.deviceId, 'P1')]);
    expect(pointOf(phone.deviceId)).toBe('P2');

    // rebuild in either order: device_roles alone (after the profile fold), then both from seq 0
    hub.deps.db.prepare("UPDATE devices SET point_id = 'P_DRIFT' WHERE device_id = ?").run(phone.deviceId);
    hub.deps.db.prepare("DELETE FROM projection_checkpoints WHERE projection = 'device_profiles'").run();
    hub.deps.projections.catchUp(hub.deps.db, BRANCH);
    expect(pointOf(phone.deviceId)).toBe('P2');
    hub.deps.db.prepare("DELETE FROM projection_checkpoints WHERE projection = 'device_roles'").run();
    hub.deps.projections.catchUp(hub.deps.db, BRANCH);
    expect(pointOf(phone.deviceId)).toBe('P2');
    hub.deps.db.prepare("DELETE FROM projection_checkpoints WHERE projection IN ('device_roles', 'device_profiles')").run();
    hub.deps.projections.catchUp(hub.deps.db, BRANCH);
    expect(pointOf(phone.deviceId)).toBe('P2');
    expect(hub.deps.db.prepare('SELECT point_id, lane_label FROM devices WHERE device_id = ?').get(kds.deviceId)).toEqual({ point_id: null, lane_label: 'Lane A' });
  });
});
