import type { DirectoryInput } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { currentDirectory } from '../../src/auth/guards';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 01b R5: role names are display strings; every decision on the hub keys on role ids and grants.
const RENAMED: Record<string, string> = {
  R_OWNER: 'Malik',
  R_MGR: 'Incharge',
  R_CASH: 'Khazanchi',
  R_WAIT: 'Bera',
  R_DENY: 'Bawarchi',
  R_APPROVAL: 'Naya',
};

// aDirectory plus one person per permission class on `reprint-ticket` (the TestNoop permission):
// S_CASH allowed, S_NEED requires_approval, S_WAIT not_granted, S_DENY denied.
async function directory(): Promise<DirectoryInput> {
  const d = await aDirectory();
  d.roles.push(
    {
      role_id: 'R_DENY',
      name: 'Cook',
      session_idle_ttl_ms: 60_000,
      permissions: [{ permission: 'reprint-ticket', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'branch' }],
    },
    {
      role_id: 'R_APPROVAL',
      name: 'Waiter',
      session_idle_ttl_ms: 600_000,
      permissions: [
        { permission: 'reprint-ticket', grant_type: 'requires_approval', approver_role_id: 'R_MGR', approver_role_ids: ['R_MGR'], scope: 'branch' },
      ],
    },
  );
  const pin = d.staff[0]!.pin_hash;
  d.staff.push(
    { staff_id: 'S_DENY', display_name: 'Deny', pin_hash: pin, role_ids: ['R_DENY'], denied_permissions: ['reprint-ticket'], lead_staff_id: null, floor_ids: [] },
    { staff_id: 'S_NEED', display_name: 'Need', pin_hash: pin, role_ids: ['R_APPROVAL'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
  );
  return d;
}

function renamed(d: DirectoryInput): DirectoryInput {
  return { ...d, roles: d.roles.map((role) => ({ ...role, name: RENAMED[role.role_id] ?? `${role.name} renamed` })) };
}

function get(hub: TestHub, url: string, deviceToken: string, sessionToken?: string) {
  return hub.app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${deviceToken}`, ...(sessionToken === undefined ? {} : { 'x-session-token': sessionToken }) },
  });
}

function withoutRoleNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRoleNames);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'role_names').map(([key, child]) => [key, withoutRoleNames(child)]));
  }
  return value;
}

// Everything R5 says must not move, for one hub.
async function outcomes(hub: TestHub, d: DirectoryInput) {
  const dir = currentDirectory(hub.app);
  const staffIds = d.staff.map((s) => s.staff_id);
  const tablet = pairDevice(hub, { type: 'tablet' });
  const roster = (await get(hub, '/admin/login-roster', tablet.token)).json();
  const perStaff: Record<string, unknown> = {};
  for (const staffId of staffIds) {
    // One live session per device.
    const own = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId, deviceId: own.deviceId });
    const answer = (await get(hub, '/queries/session', own.token, session.token)).json();
    const command = await hub.app.inject({
      method: 'POST',
      url: '/commands/test-noop',
      headers: { authorization: `Bearer ${own.token}`, 'x-session-token': session.token },
      payload: {
        command_id: `cmd-${staffId}`,
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'TestNoop',
        payload: {},
        occurred_at: hub.clock.branchNow(),
        actor_id: staffId,
        device_id: own.deviceId,
      },
    });
    perStaff[staffId] = {
      permissions: dir.permissionsOf(staffId),
      ttl: dir.ttlFor(staffId),
      admin: dir.adminPermissions(staffId),
      hasAdmin: dir.hasAdmin(staffId),
      session: withoutRoleNames(answer),
      command: { status: command.statusCode, details: command.json().error?.details ?? null },
    };
  }
  return {
    perStaff,
    roster: (roster.data.staff as Array<{ staff_id: string }>).map((row) => row.staff_id).sort(),
    roleNames: Object.fromEntries(staffIds.map((id) => [id, dir.roleNames(id)])),
  };
}

describe('[01b R5] renamed default roles', () => {
  const hubs: TestHub[] = [];
  afterEach(async () => {
    for (const hub of hubs.splice(0)) await hub.close();
    activity.drain();
    activity.drainDevices();
  });

  async function hubWith(d: DirectoryInput): Promise<TestHub> {
    const hub = await createTestHub();
    hubs.push(hub);
    await seedDirectory(hub, d);
    return hub;
  }

  it('[01b #96] the fixture with every role renamed gives the same resolve, ttlFor, adminPermissions, session, roster and command outcomes', async () => {
    const original = await directory();
    const asIs = await outcomes(await hubWith(original), original);
    const other = renamed(original);
    const afterRename = await outcomes(await hubWith(other), other);

    expect(afterRename.perStaff).toEqual(asIs.perStaff);
    expect(afterRename.roster).toEqual(asIs.roster);
    expect(afterRename.roleNames).not.toEqual(asIs.roleNames);
    expect(afterRename.roleNames['S_WAIT']).toEqual(['Bera']);

    // The four permission classes are all exercised.
    const status = (id: string) => (asIs.perStaff[id] as { command: { status: number; details: unknown } }).command;
    expect(status('S_CASH').status).toBe(200);
    expect(status('S_NEED').details).toEqual({ permission: 'reprint-ticket', grant: 'requires_approval' });
    expect(status('S_WAIT').details).toEqual({ permission: 'reprint-ticket', grant: 'not_granted' });
    expect(status('S_DENY').details).toEqual({ permission: 'reprint-ticket', grant: 'denied' });
    expect(asIs.roster).toContain('S_MGR');
  });
});
