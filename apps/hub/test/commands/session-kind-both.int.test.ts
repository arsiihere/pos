import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 00 v1.12 §3.7 / §4.2 (⚠️ Changed by 05 (row H-1)); 05 v1.0.4 §10 #80; 05-plan §2B.4 P0.4.
// `TestBoth` is the test-only `sessionKind: 'both'` command (permission `manage-roles`: S_OWNER has it,
// S_MGR and S_CASH do not), registered with the other test commands in `route.ts`.
describe("sessionKind 'both'", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    activity.drain();
    activity.drainDevices();
  });

  it("[05 #80] [00 H-1] a 'both' command is accepted on /commands and /admin/commands, one handler", async () => {
    const hub = await hubWithDirectory();
    const device = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: device.deviceId });
    const admin = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });

    const onDevice = await post(hub, { route: 'device', device, session: staff, commandId: 'both-1', actorId: 'S_OWNER' });
    expect(onDevice.statusCode).toBe(200);
    expect(onDevice.json().data.result).toEqual({ kind: 'staff', staff_id: 'S_OWNER', session_id: staff.sessionId });

    const onAdmin = await post(hub, { route: 'admin', device, session: admin, commandId: 'both-2', actorId: 'S_OWNER' });
    expect(onAdmin.statusCode).toBe(200);
    expect(onAdmin.json().data.result).toEqual({ kind: 'admin', staff_id: 'S_OWNER', session_id: admin.sessionId });

    expect(nooped(hub)).toEqual(['both-1', 'both-2']);
    expect(processed(hub)).toEqual([
      { command_id: 'both-1', command_type: 'TestBoth', session_id: staff.sessionId },
      { command_id: 'both-2', command_type: 'TestBoth', session_id: admin.sessionId },
    ]);
  });

  it("[05 #80] [00 H-1] the bootstrap admin session (no device) runs a 'both' command on /admin/commands", async () => {
    const hub = await hubWithDirectory();
    const bootstrap = openSession(hub, { kind: 'admin', staffId: 'S_OWNER' });
    const response = await post(hub, { route: 'admin', session: bootstrap, commandId: 'both-boot', actorId: 'S_OWNER', deviceId: 'hub-admin' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.result).toEqual({ kind: 'admin', staff_id: 'S_OWNER', session_id: bootstrap.sessionId });
  });

  it("[05 #80] [00 H-1] the permission is resolved from the session's staff on each route", async () => {
    const hub = await hubWithDirectory();
    const device = pairDevice(hub, { type: 'tablet' });
    const cashier = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
    const managerAdmin = openSession(hub, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId });

    const staffDenied = await post(hub, { route: 'device', device, session: cashier, commandId: 'both-deny-1', actorId: 'S_CASH' });
    expect(staffDenied.statusCode).toBe(403);
    expect(staffDenied.json().error.code).toBe('PERMISSION_DENIED');
    expect(staffDenied.json().error.details).toMatchObject({ permission: 'manage-roles', grant: 'not_granted' });

    const adminDenied = await post(hub, { route: 'admin', device, session: managerAdmin, commandId: 'both-deny-2', actorId: 'S_MGR' });
    expect(adminDenied.statusCode).toBe(403);
    expect(adminDenied.json().error.code).toBe('PERMISSION_DENIED');
    expect(adminDenied.json().error.details).toMatchObject({ permission: 'manage-roles', grant: 'not_granted' });

    expect(nooped(hub)).toEqual([]);
    expect(processed(hub)).toEqual([]);
  });

  it("[05 #80] [00 H-1] a retransmit on the same route replays; on the other route it is never a second run", async () => {
    const hub = await hubWithDirectory();
    const device = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: device.deviceId });
    const admin = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });

    // Same route, each route: M19 / M47 replay.
    const first = await post(hub, { route: 'device', device, session: staff, commandId: 'both-r1', actorId: 'S_OWNER' });
    expect(first.statusCode).toBe(200);
    const firstAdmin = await post(hub, { route: 'admin', device, session: admin, commandId: 'both-r2', actorId: 'S_OWNER' });
    expect(firstAdmin.statusCode).toBe(200);
    const before = counts(hub);
    const sameDevice = await post(hub, { route: 'device', device, session: staff, commandId: 'both-r1', actorId: 'S_OWNER' });
    expect(sameDevice.statusCode).toBe(200);
    expect(sameDevice.headers['idempotent-replay']).toBe('true');
    expect(sameDevice.json()).toEqual(first.json());
    const sameAdmin = await post(hub, { route: 'admin', device, session: admin, commandId: 'both-r2', actorId: 'S_OWNER' });
    expect(sameAdmin.statusCode).toBe(200);
    expect(sameAdmin.headers['idempotent-replay']).toBe('true');
    expect(sameAdmin.json()).toEqual(firstAdmin.json());

    // Other route, one command_id space: the admin-route row replays on /commands from the same
    // device (M19 / M47: device match) ...
    const adminToDevice = await post(hub, { route: 'device', device, session: staff, commandId: 'both-r2', actorId: 'S_OWNER' });
    expect(adminToDevice.statusCode).toBe(200);
    expect(adminToDevice.headers['idempotent-replay']).toBe('true');
    expect(adminToDevice.json()).toEqual(firstAdmin.json());
    // ... and the device-route row on /admin/commands is the admin rule (M47: admin replays match
    // `session_id`): another session, so 400, never a second run.
    const deviceToAdmin = await post(hub, { route: 'admin', device, session: admin, commandId: 'both-r1', actorId: 'S_OWNER' });
    expect(deviceToAdmin.statusCode).toBe(400);
    expect(deviceToAdmin.json().error.details.issues).toEqual([{ path: 'command_id', message: 'command_id already used' }]);
    expect(deviceToAdmin.headers['idempotent-replay']).toBeUndefined();
    expect(counts(hub)).toEqual(before);

    // A bootstrap admin's row (device 'hub-admin') never replays on /commands.
    const bootstrap = openSession(hub, { kind: 'admin', staffId: 'S_OWNER' });
    const boot = await post(hub, { route: 'admin', session: bootstrap, commandId: 'both-r3', actorId: 'S_OWNER', deviceId: 'hub-admin' });
    expect(boot.statusCode).toBe(200);
    const afterBoot = counts(hub);
    const bootToDevice = await post(hub, { route: 'device', device, session: staff, commandId: 'both-r3', actorId: 'S_OWNER' });
    expect(bootToDevice.statusCode).toBe(400);
    expect(bootToDevice.json().error.details.issues).toEqual([{ path: 'command_id', message: 'command_id already used' }]);

    expect(counts(hub)).toEqual(afterBoot);
    expect(nooped(hub)).toEqual(['both-r1', 'both-r2', 'both-r3']);
  });

  it("[05 #80] [00 H-1] 'device' and 'admin' commands still answer only on their own route", async () => {
    const hub = await hubWithDirectory();
    const device = pairDevice(hub, { type: 'tablet' });
    const staff = openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: device.deviceId });
    const admin = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });

    const deviceOnAdmin = await post(hub, {
      route: 'admin',
      device,
      session: admin,
      commandId: 'kind-1',
      actorId: 'S_OWNER',
      name: 'test-noop',
      commandType: 'TestNoop',
    });
    expect(deviceOnAdmin.statusCode).toBe(404);
    expect(deviceOnAdmin.json().error.code).toBe('ROUTE_NOT_FOUND');
    const adminOnDevice = await post(hub, {
      route: 'device',
      device,
      session: staff,
      commandId: 'kind-2',
      actorId: 'S_OWNER',
      name: 'test-admin',
      commandType: 'TestAdmin',
    });
    expect(adminOnDevice.statusCode).toBe(404);
    expect(adminOnDevice.json().error.code).toBe('ROUTE_NOT_FOUND');

    const deviceOnDevice = await post(hub, {
      route: 'device',
      device,
      session: staff,
      commandId: 'kind-3',
      actorId: 'S_OWNER',
      name: 'test-noop',
      commandType: 'TestNoop',
    });
    expect(deviceOnDevice.statusCode).toBe(200);
    const adminOnAdmin = await post(hub, {
      route: 'admin',
      device,
      session: admin,
      commandId: 'kind-4',
      actorId: 'S_OWNER',
      name: 'test-admin',
      commandType: 'TestAdmin',
    });
    expect(adminOnAdmin.statusCode).toBe(200);
    expect(processed(hub).map((row) => row.command_id)).toEqual(['kind-3', 'kind-4']);
  });

  async function hubWithDirectory(): Promise<TestHub> {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    return hub;
  }
});

function nooped(hub: TestHub): string[] {
  return (
    hub.deps.db.prepare("SELECT payload FROM events WHERE event_type = 'TestNooped' ORDER BY seq").pluck().all() as string[]
  ).map((payload) => (JSON.parse(payload) as { command_id: string }).command_id);
}

function processed(hub: TestHub): Array<{ command_id: string; command_type: string; session_id: string | null }> {
  return hub.deps.db
    .prepare('SELECT command_id, command_type, session_id FROM processed_commands ORDER BY recorded_at, command_id')
    .all() as Array<{ command_id: string; command_type: string; session_id: string | null }>;
}

function counts(hub: TestHub): { events: number; commands: number } {
  return {
    events: hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
    commands: hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get() as number,
  };
}

function post(
  hub: TestHub,
  o: {
    route: 'device' | 'admin';
    device?: { deviceId: string; token: string };
    session: { token: string };
    commandId: string;
    actorId: string;
    name?: string;
    commandType?: string;
    deviceId?: string;
  },
) {
  const name = o.name ?? 'test-both';
  const deviceId = o.deviceId ?? o.device?.deviceId;
  if (deviceId === undefined) throw new Error('post needs a device or a deviceId');
  return hub.app.inject({
    method: 'POST',
    url: o.route === 'device' ? `/commands/${name}` : `/admin/commands/${name}`,
    headers: {
      ...(o.device === undefined ? {} : { authorization: `Bearer ${o.device.token}` }),
      ...(o.route === 'device' ? { 'x-session-token': o.session.token } : { 'x-admin-session': o.session.token }),
    },
    payload: {
      command_id: o.commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: o.commandType ?? 'TestBoth',
      payload: {},
      occurred_at: hub.clock.branchNow(),
      actor_id: o.actorId,
      device_id: deviceId,
    },
  });
}
