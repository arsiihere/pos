import { afterEach, describe, expect, it } from 'vitest';
import { qrSvg } from '../../src/lib/qr';
import { sha256hex } from '../../src/lib/hash';
import { registerStationValidator, stationExists } from '../../src/auth/station-validator';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('GenerateDevicePairingToken', () => {
  afterEach(async () => {
    registerStationValidator(() => false);
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #28] GenerateDevicePairingToken: tablet ok; kds or cashier_kiosk → 400; no manage-devices → 403; retransmit → same token', async () => {
    const hub = await open();
    const admin = await adminOn(hub, 'S_OWNER');
    const created = await post(hub, admin, { device_type: 'tablet' });
    expect(created.statusCode).toBe(200);
    const result = created.json().data.result as {
      pairing_token: string;
      pairing_token_id: string;
      expires_at: number;
      pair_url: string;
      pair_qr_svg: string;
    };
    expect(result.expires_at).toBe(hub.clock.branchNow() + 600_000);
    expect(result.pair_url).toBe(`http://192.168.10.2:3000/pair?t=${result.pairing_token}`);
    expect(result.pair_qr_svg).toBe(qrSvg(result.pair_url));
    const row = hub.deps.db
      .prepare('SELECT token_hash, device_type, owner_staff_id, created_by, expires_at FROM pairing_tokens WHERE pairing_token_id = ?')
      .get(result.pairing_token_id) as {
      token_hash: string;
      device_type: string;
      owner_staff_id: string | null;
      created_by: string;
      expires_at: number;
    };
    expect(row).toEqual({
      token_hash: sha256hex(result.pairing_token),
      device_type: 'tablet',
      owner_staff_id: null,
      created_by: 'S_OWNER',
      expires_at: result.expires_at,
    });
    const event = hub.deps.db
      .prepare(`SELECT stream_id, payload FROM events WHERE event_type = 'DevicePairingTokenGenerated'`)
      .get() as { stream_id: string; payload: string };
    expect(event.stream_id).toBe(result.pairing_token_id);
    expect(JSON.parse(event.payload)).toMatchObject({
      pairing_token_id: result.pairing_token_id,
      device_type: 'tablet',
      owner_staff_id: null,
      expires_at: result.expires_at,
    });

    for (const deviceType of ['kds', 'cashier_kiosk']) {
      const rejected = await post(hub, admin, { device_type: deviceType }, `cmd-${deviceType}`);
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().error.code).toBe('VALIDATION_FAILED');
    }

    const deniedDir = await aDirectory();
    const owner = deniedDir.staff.find((staff) => staff.staff_id === 'S_OWNER');
    if (owner === undefined) throw new Error('owner missing');
    owner.denied_permissions = ['manage-devices'];
    const deniedHub = await open(deniedDir);
    const deniedAdmin = await adminOn(deniedHub, 'S_OWNER');
    const denied = await post(deniedHub, deniedAdmin, { device_type: 'tablet' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');

    const again = await post(hub, admin, { device_type: 'tablet' }, 'cmd-generate-device-pairing-token');
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json().data.result.pairing_token).toBe(result.pairing_token);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM pairing_tokens').pluck().get()).toBe(1);

    const withOwner = await post(hub, admin, { device_type: 'tablet', owner_staff_id: 'S_OWNER' }, 'cmd-tablet-owner');
    expect(withOwner.statusCode).toBe(400);
    expect(withOwner.json().error.code).toBe('VALIDATION_FAILED');
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM pairing_tokens').pluck().get()).toBe(1);
  });

  it('[00 §10 #80] Phone pairing: GenerateDevicePairingToken for phone without owner_staff_id → 400; unknown owner → 404; pair → device has owner_staff_id', async () => {
    const hub = await open();
    const admin = await adminOn(hub, 'S_OWNER');
    const missingOwner = await post(hub, admin, { device_type: 'phone' });
    expect(missingOwner.statusCode).toBe(400);
    expect(missingOwner.json().error.code).toBe('VALIDATION_FAILED');

    const unknown = await post(hub, admin, { device_type: 'phone', owner_staff_id: 'S_MISSING' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('STAFF_NOT_FOUND');
    expect(unknown.json().error.details).toEqual({ staff_id: 'S_MISSING' });
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM pairing_tokens').pluck().get()).toBe(0);

    const created = await post(hub, admin, { device_type: 'phone', owner_staff_id: 'S_OWNER' });
    expect(created.statusCode).toBe(200);
    const result = created.json().data.result as { pairing_token_id: string };
    const row = hub.deps.db
      .prepare('SELECT device_type, owner_staff_id FROM pairing_tokens WHERE pairing_token_id = ?')
      .get(result.pairing_token_id);
    expect(row).toEqual({ device_type: 'phone', owner_staff_id: 'S_OWNER' });
    const token = created.json().data.result as { pairing_token: string };
    const paired = await hub.app.inject({
      method: 'POST',
      url: '/devices/pair',
      payload: {
        pairing_token: token.pairing_token,
        pair_request_id: hub.deps.ids.next(),
        device_name: 'Phone',
        device_type: 'phone',
      },
    });
    expect(paired.statusCode).toBe(200);
    expect(paired.json().data.owner_staff_id).toBe('S_OWNER');
    const device = hub.deps.db.prepare('SELECT owner_staff_id FROM devices WHERE device_id = ?').get(paired.json().data.device_id);
    expect(device).toEqual({ owner_staff_id: 'S_OWNER' });
  });

  it('[00 §3.1 M31] stationExists is false until a validator is registered', () => {
    const tx = {} as Parameters<typeof stationExists>[0];
    expect(stationExists(tx, 'station-1')).toBe(false);
    registerStationValidator((_tx, id) => id === 'station-1');
    expect(stationExists(tx, 'station-1')).toBe(true);
    expect(stationExists(tx, 'station-2')).toBe(false);
  });
});

async function open(directory?: Awaited<ReturnType<typeof aDirectory>>): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, directory);
  return hub;
}

async function adminOn(hub: TestHub, staffId: string): Promise<{ device: { deviceId: string; token: string }; session: { token: string } }> {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId });
  return { device, session };
}

function post(
  hub: TestHub,
  admin: { device: { deviceId: string; token: string }; session: { token: string } },
  payload: Record<string, unknown>,
  commandId = 'cmd-generate-device-pairing-token',
) {
  return hub.app.inject({
    method: 'POST',
    url: '/admin/commands/generate-device-pairing-token',
    headers: {
      authorization: `Bearer ${admin.device.token}`,
      'x-admin-session': admin.session.token,
    },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'GenerateDevicePairingToken',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_OWNER',
      device_id: admin.device.deviceId,
    },
  });
}
