import type { DirectoryInput } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { activity } from '../../src/auth/session-store';
import { commandRegistry } from '../../src/commands/route';
import { defineCommand } from '../../src/commands/registry';
import { payloadHash } from '../../src/lib/hash';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

describe('command route', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    activity.drain();
    activity.drainDevices();
  });

  it('[00 §10 #1] a no-op command writes one event and one processed_commands row with device_id', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const { device, session } = await staff(hub, 'S_CASH');
    const published = hub.published.length;
    const response = await post(hub, { name: 'test-noop', commandType: 'TestNoop', device, session, actorId: 'S_CASH', commandId: 'cmd-1' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.command_id).toBe('cmd-1');
    expect(response.json().data.event_ids).toHaveLength(1);
    expect(response.json().data.result).toEqual({ ok: true });
    const row = hub.deps.db
      .prepare('SELECT device_id, session_id, command_type, payload_hash FROM processed_commands WHERE command_id = ?')
      .get('cmd-1');
    expect(row).toEqual({
      device_id: device.deviceId,
      session_id: session.sessionId,
      command_type: 'TestNoop',
      payload_hash: payloadHash({}),
    });
    expect(hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE event_type = 'TestNooped'").pluck().get()).toBe(1);
    expect(activity.get(session.sessionId)).toBe(hub.clock.branchNow());
    expect(hub.published.length).toBe(published + 1);
    const mismatch = await post(hub, {
      name: 'test-noop',
      commandType: 'TestNoop',
      device,
      session,
      actorId: 'S_CASH',
      commandId: 'cmd-wrong-device',
      deviceId: 'other-device',
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('[00 §10 #6] a name that does not match command_type is 400 and an unknown name is 404', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const { device, session } = await staff(hub, 'S_CASH');
    const mismatch = await post(hub, { name: 'test-approvable', commandType: 'TestNoop', device, session, actorId: 'S_CASH' });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('VALIDATION_FAILED');
    const unknown = await post(hub, { name: 'not-a-command', commandType: 'TestNoop', device, session, actorId: 'S_CASH' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('[00 §10 #7] a branch_id other than config is 403 BRANCH_MISMATCH', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const { device, session } = await staff(hub, 'S_CASH');
    const response = await post(hub, {
      name: 'test-noop',
      commandType: 'TestNoop',
      device,
      session,
      actorId: 'S_CASH',
      branchId: 'other-branch',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('BRANCH_MISMATCH');
  });

  it('[00 §10 #110] a tenant_id other than config is 403 BRANCH_MISMATCH', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const { device, session } = await staff(hub, 'S_CASH');
    const response = await post(hub, {
      name: 'test-noop',
      commandType: 'TestNoop',
      device,
      session,
      actorId: 'S_CASH',
      tenantId: 'other-tenant',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('BRANCH_MISMATCH');
  });

  it('[00 §10 #8] an actor_id other than the session staff is 400', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const { device, session } = await staff(hub, 'S_CASH');
    const response = await post(hub, { name: 'test-noop', commandType: 'TestNoop', device, session, actorId: 'S_OWNER' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('[00 §10 #9] not_granted, denied and requires_approval are 403, and an approvable command receives the approver roles', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const directory = await aDirectory();
    directory.roles.push(
      {
        role_id: 'R_DENY',
        name: 'Deny',
        session_idle_ttl_ms: 60_000,
        permissions: [{ permission: 'reprint-ticket', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'branch' }],
      },
      {
        role_id: 'R_APPROVAL',
        name: 'Approval',
        session_idle_ttl_ms: 60_000,
        permissions: [
          { permission: 'reprint-ticket', grant_type: 'requires_approval', approver_role_id: 'R_MGR', approver_role_ids: ['R_MGR'], scope: 'branch' },
        ],
      },
    );
    const pin = directory.staff[0]?.pin_hash;
    if (pin === undefined) throw new Error('fixture has no pin hash');
    directory.staff.push(
      {
        staff_id: 'S_DENY',
        display_name: 'Deny',
        pin_hash: pin,
        role_ids: ['R_DENY'],
        denied_permissions: ['reprint-ticket'],
        lead_staff_id: null,
        floor_ids: [],
      },
      { staff_id: 'S_NEED', display_name: 'Need', pin_hash: pin, role_ids: ['R_APPROVAL'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
    );
    await seedDirectory(hub, directory);
    const waiter = await staff(hub, 'S_WAIT', directory);
    const denied = await staff(hub, 'S_DENY', directory);
    const needs = await staff(hub, 'S_NEED', directory);
    const cashier = await staff(hub, 'S_CASH', directory);
    const notGranted = await post(hub, { name: 'test-noop', commandType: 'TestNoop', ...waiter, actorId: 'S_WAIT' });
    expect(notGranted.statusCode).toBe(403);
    expect(notGranted.json().error.details).toEqual({ permission: 'reprint-ticket', grant: 'not_granted' });
    const deniedResponse = await post(hub, { name: 'test-noop', commandType: 'TestNoop', ...denied, actorId: 'S_DENY' });
    expect(deniedResponse.statusCode).toBe(403);
    expect(deniedResponse.json().error.details).toEqual({ permission: 'reprint-ticket', grant: 'denied' });
    const approval = await post(hub, { name: 'test-noop', commandType: 'TestNoop', ...needs, actorId: 'S_NEED' });
    expect(approval.statusCode).toBe(403);
    expect(approval.json().error.details).toEqual({ permission: 'reprint-ticket', grant: 'requires_approval' });
    const allowed = await post(hub, { name: 'test-approvable', commandType: 'TestApprovable', ...cashier, actorId: 'S_CASH' });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data.result).toEqual({
      permission: { grant: 'requires_approval', approver_role_ids: ['R_MGR'], scope: 'branch' },
    });
  });

  it('[00 §10 #10] a station session is 403 on a staff command and 200 with a null actor on a station command', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'kds', stationId: 'ST1' });
    const session = openSession(hub, { kind: 'station', deviceId: device.deviceId, stationId: 'ST1' });
    const bound = { device, session };
    const blocked = await post(hub, { name: 'test-noop', commandType: 'TestNoop', ...bound, actorId: null });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('PERMISSION_DENIED');
    expect(blocked.json().error.details).toMatchObject({ session_kind: 'station' });
    const allowed = await post(hub, { name: 'test-station', commandType: 'TestStation', ...bound, actorId: null, commandId: 'cmd-station' });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data.result).toEqual({ actor_id: null });
    expect(
      hub.deps.db.prepare("SELECT actor_id FROM events WHERE event_type = 'TestNooped' ORDER BY seq DESC LIMIT 1").pluck().get(),
    ).toBeNull();
  });

  it('[00 §10 #11] a handler DomainError returns the error envelope, writes nothing, and a retransmit is evaluated again', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const { device, session } = await staff(hub, 'S_CASH');
    const before = counts(hub);
    const first = await post(hub, { name: 'test-fails', commandType: 'TestFails', device, session, actorId: 'S_CASH', commandId: 'cmd-fail' });
    expect(first.statusCode).toBe(404);
    expect(first.json().error.code).toBe('STAFF_NOT_FOUND');
    const second = await post(hub, { name: 'test-fails', commandType: 'TestFails', device, session, actorId: 'S_CASH', commandId: 'cmd-fail' });
    expect(second.statusCode).toBe(404);
    expect(second.json().error.code).toBe('STAFF_NOT_FOUND');
    expect(counts(hub)).toEqual(before);
    expect(activity.get(session.sessionId)).toBeUndefined();
  });

  it('[00 §10 #12] a forced COMMIT failure leaves state unchanged and publishes nothing', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const { device, session } = await staff(hub, 'S_CASH');
    const state = hub.deps.state.get();
    const published = hub.published.length;
    const before = counts(hub);
    hub.deps.state.setReducer(() => {
      throw new Error('commit failed');
    });
    const response = await post(hub, { name: 'test-noop', commandType: 'TestNoop', device, session, actorId: 'S_CASH' });
    expect(response.statusCode).toBe(500);
    expect(hub.deps.state.get()).toBe(state);
    expect(hub.published.length).toBe(published);
    expect(counts(hub)).toEqual(before);
  });

  it('[00 §6.1] a command registered on the live registry is served', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const { device, session } = await staff(hub, 'S_CASH');
    commandRegistry(hub.app).register(
      defineCommand({
        commandType: 'TestLate',
        payloadSchema: z.object({}),
        sessionKind: 'device',
        permission: 'reprint-ticket',
        handle(_ctx, _payload, cmd) {
          return { events: [], result: { command_id: cmd.command_id } };
        },
      }),
    );
    const response = await post(hub, {
      name: 'test-late',
      commandType: 'TestLate',
      device,
      session,
      actorId: 'S_CASH',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.result).toEqual({ command_id: 'cmd-test-late' });
  });
});

async function staff(
  hub: TestHub,
  staffId: string,
  directory?: DirectoryInput,
): Promise<{ device: { deviceId: string; token: string }; session: { sessionId: string; token: string } }> {
  if (directory === undefined) await seedDirectory(hub);
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { device, session };
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
    name: string;
    commandType: string;
    device: { deviceId: string; token: string };
    session: { token: string };
    actorId: string | null;
    tenantId?: string;
    branchId?: string;
    commandId?: string;
    deviceId?: string;
    payload?: Record<string, unknown>;
  },
) {
  return hub.app.inject({
    method: 'POST',
    url: `/commands/${o.name}`,
    headers: {
      authorization: `Bearer ${o.device.token}`,
      'x-session-token': o.session.token,
    },
    payload: {
      command_id: o.commandId ?? `cmd-${o.name}`,
      tenant_id: o.tenantId ?? 'tenant-a',
      branch_id: o.branchId ?? 'branch-1',
      command_type: o.commandType,
      payload: o.payload ?? {},
      occurred_at: hub.clock.branchNow(),
      actor_id: o.actorId,
      device_id: o.deviceId ?? o.device.deviceId,
    },
  });
}
