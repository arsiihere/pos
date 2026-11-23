import { afterEach, describe, expect, it } from 'vitest';
import { ALI, directoryWith, signInOn, withProfile } from '../helpers/device-access';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 05a §3.3a (00 §3.6, §3.7 row H-3): the call sites that resolve for a session get its view, so the listed-only mask
// applies from one point. The pipeline's `authorize` adds `reason: 'listed_device_only'`; handler-owned `403`s keep
// their details (N-6). Queued commands resolve at execution time.

const TENANT = 'tenant-a';
const BRANCH = 'branch-1';

let commandNo = 0;
const nextId = (): string => `cs-${(commandNo += 1)}`;

interface Seat {
  deviceId: string;
  deviceToken: string;
  sessionToken: string;
}

describe('[05a §3.3a] session view call sites', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function hub(): Promise<TestHub> {
    const h = await createTestHub();
    cleanups.push(() => h.close());
    await seedDirectory(h, await directoryWith());
    return h;
  }

  function seat(h: TestHub, access: 'everyone' | 'listed', kind: 'staff' | 'admin' = 'staff'): Seat {
    const profile = access === 'listed' ? { access, staff_ids: [ALI], screens: ['manager' as const] } : { access, screens: ['manager' as const] };
    const device = pairDevice(h, { type: 'tablet', profile });
    const session = kind === 'staff' ? signInOn(h, device.deviceId, ALI) : adminOn(h, device.deviceId);
    return { deviceId: device.deviceId, deviceToken: device.token, sessionToken: session.token };
  }

  // An admin session bound to the device, as `/admin/auth` writes it.
  const adminOn = (h: TestHub, deviceId: string) => openSession(h, { kind: 'admin', staffId: ALI, deviceId });

  function setPresence(h: TestHub, s: Seat, o: { commandId?: string; queuedAt?: number } = {}) {
    return h.app.inject({
      method: 'POST',
      url: '/commands/set-presence',
      headers: {
        authorization: `Bearer ${s.deviceToken}`,
        'x-session-token': s.sessionToken,
        ...(o.queuedAt === undefined ? {} : { 'x-queued-at': String(o.queuedAt) }),
      },
      payload: {
        command_id: o.commandId ?? nextId(),
        tenant_id: TENANT,
        branch_id: BRANCH,
        command_type: 'SetPresence',
        payload: { staff_ids: [ALI], present: true },
        occurred_at: h.clock.branchNow(),
        actor_id: ALI,
        device_id: s.deviceId,
      },
    });
  }

  it('[05a #4a] pipeline: a listed-only command (SetPresence, manage-staff) from an `everyone` device → 403 PERMISSION_DENIED with reason listed_device_only', async () => {
    // 4a's ApprovePairingRequest variant lands with plan task 15 (the command is admin-only until then).
    const h = await hub();
    const res = await setPresence(h, seat(h, 'everyone'));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({
      code: 'PERMISSION_DENIED',
      details: { permission: 'manage-staff', grant: 'not_granted', reason: 'listed_device_only' },
    });
    // The same person on a listed device passes the permission step (BUSINESS_DAY_NOT_OPEN is the handler's own check).
    const listed = await setPresence(h, seat(h, 'listed'));
    expect(listed.json().error?.code).toBe('BUSINESS_DAY_NOT_OPEN');
  });

  it('[05a #4b] check inside a handler: the fiscal credentials query on an `everyone` device → 403 with its existing details', async () => {
    const h = await hub();
    const s = seat(h, 'everyone', 'admin');
    const res = await h.app.inject({
      method: 'GET',
      url: '/admin/queries/fiscal-credentials',
      headers: { authorization: `Bearer ${s.deviceToken}`, 'x-admin-session': s.sessionToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
  });

  it('[05a #4c] query: the audit query on an `everyone` device → 403 (existing details); listed device → 200', async () => {
    const h = await hub();
    const get = (s: Seat) =>
      h.app.inject({ method: 'GET', url: `/queries/audit-log?from=${h.clock.branchNow() - 1000}&to=${h.clock.branchNow()}`, headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken } });
    const res = await get(seat(h, 'everyone'));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual(expect.objectContaining({ code: 'PERMISSION_DENIED', details: { permission: 'view-audit-log', grant: 'not_granted' } }));
    expect((await get(seat(h, 'listed'))).statusCode).toBe(200);
  });

  it('[05a #20] a command queued on a listed device and replayed after the device became `everyone` is masked (fail-closed)', async () => {
    const h = await hub();
    const s = seat(h, 'listed');
    const queuedAt = h.clock.branchNow();
    withProfile(h, s.deviceId, { access: 'everyone', screens: ['manager'] });
    const res = await setPresence(h, s, { queuedAt });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details).toMatchObject({ permission: 'manage-staff', reason: 'listed_device_only' });
  });
});

