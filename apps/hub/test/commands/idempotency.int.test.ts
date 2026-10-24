import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { applyStaffDirectory } from '../../src/auth/apply-directory';
import { swapDirectory } from '../../src/auth/guards';
import { activity, endSession, findSessionByToken, revokeDevice } from '../../src/auth/session-store';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

describe('command idempotency', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    activity.drain();
    activity.drainDevices();
  });

  it('[00 §10 #2] a retransmit from the same device returns the stored body and writes nothing', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const bound = await staff(hub, 'S_CASH');
    const first = await post(hub, { ...bound, commandId: 'cmd-2' });
    expect(first.statusCode).toBe(200);
    expect(first.headers['idempotent-replay']).toBeUndefined();
    const before = counts(hub);
    const replay = await post(hub, { ...bound, commandId: 'cmd-2' });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(counts(hub)).toEqual(before);
    endSessionNow(hub, bound.session.sessionId);
    const second = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: bound.device.deviceId });
    const beforeSecond = counts(hub);
    const otherSession = await post(hub, { device: bound.device, session: second, commandId: 'cmd-2' });
    expect(otherSession.statusCode).toBe(200);
    expect(otherSession.headers['idempotent-replay']).toBe('true');
    expect(otherSession.json()).toEqual(first.json());
    expect(counts(hub)).toEqual(beforeSecond);
  });

  it('[00 §10 #3] a retransmit after the session ended replays the stored response', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const bound = await staff(hub, 'S_CASH');
    const first = await post(hub, { ...bound, commandId: 'cmd-3' });
    expect(first.statusCode).toBe(200);
    endSessionNow(hub, bound.session.sessionId);
    const before = counts(hub);
    const replay = await post(hub, { ...bound, commandId: 'cmd-3' });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(counts(hub)).toEqual(before);

    const idle = await staff(hub, 'S_CASH', true);
    const committed = await post(hub, { ...idle, commandId: 'cmd-3-idle' });
    expect(committed.statusCode).toBe(200);
    const ttl = hub.deps.db.prepare('SELECT idle_ttl_ms FROM staff_sessions WHERE session_id = ?').pluck().get(idle.session.sessionId) as number;
    hub.clock.advance(ttl + 1);
    const beforeIdle = counts(hub);
    const idleReplay = await post(hub, { ...idle, commandId: 'cmd-3-idle' });
    expect(idleReplay.statusCode).toBe(200);
    expect(idleReplay.headers['idempotent-replay']).toBe('true');
    expect(idleReplay.json()).toEqual(committed.json());
    const tokenOnly = await post(hub, { ...idle, commandId: 'cmd-3-idle', omitSession: true });
    expect(tokenOnly.statusCode).toBe(200);
    expect(tokenOnly.headers['idempotent-replay']).toBe('true');
    expect(tokenOnly.json()).toEqual(committed.json());
    expect(counts(hub)).toEqual(beforeIdle);
    expect(hub.deps.db.prepare('SELECT ended_at FROM staff_sessions WHERE session_id = ?').pluck().get(idle.session.sessionId)).toBeNull();

    const fresh = await staff(hub, 'S_CASH', true);
    hub.clock.advance(ttl + 1);
    const expired = await post(hub, { ...fresh, commandId: 'cmd-3-new' });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('SESSION_EXPIRED');
    expect(hub.deps.db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck().get(fresh.session.sessionId)).toBe(
      'idle_timeout',
    );
    expect(sessionEnded(hub, fresh.session.sessionId)).toEqual([expect.objectContaining({ reason: 'idle_timeout' })]);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands WHERE command_id = ?').pluck().get('cmd-3-new')).toBe(0);
  });

  it('[00 §10 #4] a retransmit from another device is 400 and nothing is replayed', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const bound = await staff(hub, 'S_CASH');
    const first = await post(hub, { ...bound, commandId: 'cmd-4' });
    expect(first.statusCode).toBe(200);
    const other = await staff(hub, 'S_MGR', true);
    const before = counts(hub);
    const replay = await post(hub, { ...other, commandId: 'cmd-4', actorId: 'S_MGR' });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.code).toBe('VALIDATION_FAILED');
    expect(replay.json().error.details.issues).toEqual([{ path: 'command_id', message: 'command_id already used' }]);
    expect(replay.headers['idempotent-replay']).toBeUndefined();
    expect(replay.json()).not.toEqual(first.json());
    expect(counts(hub)).toEqual(before);
  });

  it('[00 §10 #5] a new command_id after the session ended is 401 SESSION_EXPIRED', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const bound = await staff(hub, 'S_CASH');
    endSessionNow(hub, bound.session.sessionId);
    const response = await post(hub, { ...bound, commandId: 'cmd-5' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('SESSION_EXPIRED');
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get()).toBe(0);
  });

  it('[00 §10 #58] two overlapping retransmits of one new command write one event set and return the same body', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const bound = await staff(hub, 'S_CASH');
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    hub.deps.testHooks = {
      async betweenGuardAndWriter() {
        entered += 1;
        if (entered === 1) await gate;
        else release?.();
      },
    };
    await hub.app.listen({ host: '127.0.0.1', port: 0 });
    const address = hub.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('hub did not listen');
    const payload = JSON.stringify({
      command_id: 'cmd-58',
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'TestNoop',
      payload: {},
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_CASH',
      device_id: bound.device.deviceId,
    });
    const headers = {
      host: '192.168.10.2:3000',
      authorization: `Bearer ${bound.device.token}`,
      'x-session-token': bound.session.token,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(payload)),
    };
    const [first, second] = await Promise.all([
      rawPost(address.port, headers, payload),
      rawPost(address.port, headers, payload),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
    expect([first.replay, second.replay].filter(Boolean)).toHaveLength(1);
    expect(hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE event_type = 'TestNooped'").pluck().get()).toBe(1);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get()).toBe(1);
  });

  it('[00 §10 #85] a revoke committed before the command transaction is 403 DEVICE_REVOKED and writes no command events', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const bound = await staff(hub, 'S_CASH');
    hub.deps.testHooks = {
      async betweenGuardAndWriter() {
        hub.deps.writer.run((tx) => {
          revokeDevice(tx, bound.device.deviceId, {
            reason: null,
            cause: 'manual',
            actorId: null,
            eventDeviceId: 'hub',
            revokedBy: null,
          });
        });
      },
    };
    const response = await post(hub, { ...bound, commandId: 'cmd-85' });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('DEVICE_REVOKED');
    expect(hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE event_type = 'TestNooped'").pluck().get()).toBe(0);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get()).toBe(0);
  });

  it('[00 §10 #86] ending the session before the transaction is 401, and removing the permission is 403', async () => {
    const ended = await createTestHub();
    cleanups.push(() => ended.close());
    const endedBound = await staff(ended, 'S_CASH');
    ended.deps.testHooks = {
      async betweenGuardAndWriter() {
        const row = findSessionByToken(ended.deps.db, endedBound.session.token);
        if (row === undefined) throw new Error('session missing');
        ended.deps.writer.run((tx) => {
          endSession(tx, row, 'forced', null, null, endedBound.device.deviceId);
        });
      },
    };
    const expired = await post(ended, { ...endedBound, commandId: 'cmd-86-end' });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('SESSION_EXPIRED');
    expect(ended.deps.db.prepare("SELECT COUNT(*) FROM events WHERE event_type = 'TestNooped'").pluck().get()).toBe(0);

    const denied = await createTestHub();
    cleanups.push(() => denied.close());
    const deniedBound = await staff(denied, 'S_CASH');
    const next = await aDirectory({ directory_version: 2 });
    const cashier = next.roles.find((role) => role.role_id === 'R_CASH');
    if (cashier === undefined) throw new Error('fixture has no cashier role');
    cashier.permissions = cashier.permissions.filter((permission) => permission.permission !== 'reprint-ticket');
    denied.deps.testHooks = {
      async betweenGuardAndWriter() {
        denied.deps.writer.run((tx) => {
          applyStaffDirectory(tx, next, (directory) => {
            swapDirectory(denied.app, directory);
          });
        });
      },
    };
    const response = await post(denied, { ...deniedBound, commandId: 'cmd-86-perm' });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');
    expect(response.json().error.details).toMatchObject({ permission: 'reprint-ticket' });
    expect(denied.deps.db.prepare("SELECT COUNT(*) FROM events WHERE event_type = 'TestNooped'").pluck().get()).toBe(0);
    expect(denied.deps.db.prepare('SELECT ended_at FROM staff_sessions WHERE session_id = ?').pluck().get(deniedBound.session.sessionId)).toBeNull();
  });

  it('[00 §10 #99] another command type, payload, device id or admin session is 400, and the same admin session replays', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const bound = await staff(hub, 'S_CASH');
    const first = await post(hub, { ...bound, commandId: 'cmd-99' });
    expect(first.statusCode).toBe(200);
    const otherType = await post(hub, {
      ...bound,
      name: 'test-approvable',
      commandType: 'TestApprovable',
      commandId: 'cmd-99',
    });
    expect(otherType.statusCode).toBe(400);
    expect(otherType.json().error.details.issues).toEqual([{ path: 'command_id', message: 'command_id already used' }]);
    const otherPayload = await post(hub, { ...bound, commandId: 'cmd-99', payload: { n: 1 } });
    expect(otherPayload.statusCode).toBe(400);
    expect(otherPayload.json().error.details.issues).toEqual([{ path: 'command_id', message: 'command_id already used' }]);
    const otherDevice = await post(hub, { ...bound, commandId: 'cmd-99', deviceId: 'other-device' });
    expect(otherDevice.statusCode).toBe(400);
    expect(otherDevice.json().error.code).toBe('VALIDATION_FAILED');
    expect(otherDevice.json().error.details.issues[0].path).toBe('device_id');

    const manager = await adminStaff(hub, 'S_MGR');
    const owner = await adminStaff(hub, 'S_OWNER');
    const admin = await post(hub, {
      ...manager,
      url: '/admin/commands/test-admin',
      name: 'test-admin',
      commandType: 'TestAdmin',
      commandId: 'cmd-admin',
      actorId: 'S_MGR',
    });
    expect(admin.statusCode).toBe(200);
    const otherAdmin = await post(hub, {
      ...owner,
      url: '/admin/commands/test-admin',
      name: 'test-admin',
      commandType: 'TestAdmin',
      commandId: 'cmd-admin',
      actorId: 'S_OWNER',
    });
    expect(otherAdmin.statusCode).toBe(400);
    expect(otherAdmin.json().error.details.issues).toEqual([{ path: 'command_id', message: 'command_id already used' }]);
    const sameAdmin = await post(hub, {
      ...manager,
      url: '/admin/commands/test-admin',
      name: 'test-admin',
      commandType: 'TestAdmin',
      commandId: 'cmd-admin',
    });
    expect(sameAdmin.statusCode).toBe(200);
    expect(sameAdmin.headers['idempotent-replay']).toBe('true');
    expect(sameAdmin.json()).toEqual(admin.json());
    const secondAdmin = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: manager.device.deviceId });
    const sameDevice = await post(hub, {
      device: manager.device,
      session: secondAdmin,
      url: '/admin/commands/test-admin',
      name: 'test-admin',
      commandType: 'TestAdmin',
      commandId: 'cmd-admin',
      actorId: 'S_OWNER',
    });
    expect(sameDevice.statusCode).toBe(400);
    expect(sameDevice.json().error.details.issues).toEqual([{ path: 'command_id', message: 'command_id already used' }]);
  });
});

async function staff(hub: TestHub, staffId: string, seeded = false) {
  if (!seeded) await seedDirectory(hub);
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { device, session };
}

function adminStaff(hub: TestHub, staffId: string) {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId });
  return { device, session };
}

function sessionEnded(hub: TestHub, sessionId: string): Array<{ reason?: string }> {
  const rows = hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'SessionEnded'`).all() as Array<{
    payload: string;
  }>;
  return rows
    .map((row) => JSON.parse(row.payload) as { session_id?: string; reason?: string })
    .filter((payload) => payload.session_id === sessionId);
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
    device: { deviceId: string; token: string };
    session: { token: string };
    commandId: string;
    actorId?: string;
    name?: string;
    commandType?: string;
    payload?: Record<string, unknown>;
    deviceId?: string;
    url?: string;
    omitSession?: boolean;
  },
) {
  const name = o.name ?? 'test-noop';
  const commandType = o.commandType ?? 'TestNoop';
  return hub.app.inject({
    method: 'POST',
    url: o.url ?? `/commands/${name}`,
    headers: {
      authorization: `Bearer ${o.device.token}`,
      ...(o.omitSession === true
        ? {}
        : { 'x-session-token': o.session.token, 'x-admin-session': o.session.token }),
    },
    payload: {
      command_id: o.commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: commandType,
      payload: o.payload ?? {},
      occurred_at: hub.clock.branchNow(),
      actor_id: o.actorId ?? 'S_CASH',
      device_id: o.deviceId ?? o.device.deviceId,
    },
  });
}

function rawPost(
  port: number,
  headers: Record<string, string>,
  payload: string,
): Promise<{ status: number; replay: boolean; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/commands/test-noop', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          replay: res.headers['idempotent-replay'] === 'true',
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
        });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}
