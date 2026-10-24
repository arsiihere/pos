import { afterEach, describe, expect, it } from 'vitest';
import { registerStationValidator } from '../../src/auth/station-validator';
import { sha256hex } from '../../src/lib/hash';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('ApprovePairingRequest', () => {
  afterEach(async () => {
    registerStationValidator(() => false);
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #96] kds with station → device with station_id, DevicePaired { pairing_request_id }; wrong display code → 404; approved twice → 404; unknown station → 404; no manage-devices → 403; result never contains the token', async () => {
    const hub = await open();
    registerStationValidator((_tx, id) => id === 'STATION-1');
    const admin = adminOf(hub);
    const created = await hub.app.inject({
      method: 'POST',
      url: '/pair/requests',
      remoteAddress: '10.8.0.1',
      payload: { device_name: 'Kitchen' },
    });
    const request = created.json().data as { request_id: string; display_code: string; poll_secret: string };
    const approved = await approve(hub, admin, {
      request_id: request.request_id,
      display_code: request.display_code,
      device_type: 'kds',
      station_id: 'STATION-1',
    });
    expect(approved.statusCode).toBe(200);
    const result = approved.json().data.result as Record<string, unknown>;
    expect(result).toEqual({ device_id: result.device_id, device_type: 'kds', station_id: 'STATION-1' });
    expect(JSON.stringify(result)).not.toContain('device_token');
    const device = hub.deps.db
      .prepare('SELECT device_type, station_id, device_name, paired_by, token_hash FROM devices WHERE device_id = ?')
      .get(result.device_id) as {
      device_type: string;
      station_id: string | null;
      device_name: string;
      paired_by: string;
      token_hash: string;
    };
    expect(device).toMatchObject({ device_type: 'kds', station_id: 'STATION-1', device_name: 'Kitchen', paired_by: 'S_OWNER' });
    const stored = hub.deps.db
      .prepare('SELECT delivery_token, approved_by FROM pair_requests WHERE request_id = ?')
      .get(request.request_id) as { delivery_token: string; approved_by: string };
    expect(stored.approved_by).toBe('S_OWNER');
    expect(sha256hex(stored.delivery_token)).toBe(device.token_hash);
    expect(JSON.stringify(result)).not.toContain(stored.delivery_token);
    const event = JSON.parse(
      hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'DevicePaired'`).pluck().get() as string,
    ) as { pairing_request_id: string | null; pairing_token_id: string | null; station_id: string | null };
    expect(event).toMatchObject({
      pairing_request_id: request.request_id,
      pairing_token_id: null,
      station_id: 'STATION-1',
    });

    const other = await hub.app.inject({
      method: 'POST',
      url: '/pair/requests',
      remoteAddress: '10.8.0.2',
      payload: { device_name: 'Bar' },
    });
    const second = other.json().data as { request_id: string; display_code: string };
    const wrong = await approve(
      hub,
      admin,
      {
        request_id: second.request_id,
        display_code: 'ZZZZZZ',
        device_type: 'kds',
        station_id: 'STATION-1',
      },
      'cmd-wrong-code',
    );
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json().error.code).toBe('PAIRING_REQUEST_NOT_FOUND');
    const stillPending = hub.deps.db
      .prepare('SELECT approved_at FROM pair_requests WHERE request_id = ?')
      .get(second.request_id) as { approved_at: number | null };
    expect(stillPending.approved_at).toBeNull();

    const twice = await approve(hub, admin, {
      request_id: request.request_id,
      display_code: request.display_code,
      device_type: 'kds',
      station_id: 'STATION-1',
    }, 'cmd-twice');
    expect(twice.statusCode).toBe(404);
    expect(twice.json().error.code).toBe('PAIRING_REQUEST_NOT_FOUND');

    const third = await hub.app.inject({
      method: 'POST',
      url: '/pair/requests',
      remoteAddress: '10.8.0.4',
      payload: { device_name: 'Pass' },
    });
    const thirdBody = third.json().data as { request_id: string; display_code: string };
    const unknown = await approve(
      hub,
      admin,
      {
        request_id: thirdBody.request_id,
        display_code: thirdBody.display_code,
        device_type: 'kds',
        station_id: 'missing',
      },
      'cmd-unknown-station',
    );
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('STATION_NOT_FOUND');

    const deniedDir = await aDirectory();
    const owner = deniedDir.staff.find((staff) => staff.staff_id === 'S_OWNER');
    if (owner === undefined) throw new Error('owner missing');
    owner.denied_permissions = ['manage-devices'];
    const deniedHub = await open(deniedDir);
    const deniedAdmin = adminOf(deniedHub);
    const pending = await deniedHub.app.inject({
      method: 'POST',
      url: '/pair/requests',
      remoteAddress: '10.8.0.3',
      payload: { device_name: 'Denied' },
    });
    const pendingBody = pending.json().data as { request_id: string; display_code: string };
    const denied = await approve(deniedHub, deniedAdmin, {
      request_id: pendingBody.request_id,
      display_code: pendingBody.display_code,
      device_type: 'cashier_kiosk',
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');

    const page = await hub.app.inject({
      method: 'GET',
      url: '/admin/approve?r=req-1',
      headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('URLSearchParams');
    expect(page.body).toContain('display_code');
    expect(page.body).toContain('station_id');
    expect(page.body).toContain('approve-pairing-request');
  });
});

async function open(directory?: Awaited<ReturnType<typeof aDirectory>>): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, directory);
  return hub;
}

function adminOf(hub: TestHub): { device: { deviceId: string; token: string }; session: { token: string } } {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });
  return { device, session };
}

function approve(
  hub: TestHub,
  admin: { device: { deviceId: string; token: string }; session: { token: string } },
  payload: Record<string, unknown>,
  commandId = 'cmd-approve-pairing-request',
) {
  return hub.app.inject({
    method: 'POST',
    url: '/admin/commands/approve-pairing-request',
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'ApprovePairingRequest',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_OWNER',
      device_id: admin.device.deviceId,
    },
  });
}
