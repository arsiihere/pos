import { afterEach, describe, expect, it } from 'vitest';
import { clearExpiredDeliveryTokens } from '../../src/auth/pair-requests';
import { qrSvg } from '../../src/lib/qr';
import { sha256hex } from '../../src/lib/hash';
import { registerSetupRoutes } from '../../src/setup/provision';
import { writeHubConfigAtomic } from '../../src/config/write';
import { statementCounter } from '../helpers/statement-counter';
import { aDirectory } from '../helpers/fixtures';
import { stubCloud } from '../helpers/stub-cloud';
import { aBranchConfig } from '@pos/events/testing';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('pairing requests', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #149] M92: the approved poll carries station_name from the branch config for a kds and null for a cashier screen', async () => {
    const hub = await open();
    const config = aBranchConfig();
    swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 2, appliedAt: 0 });
    const approve = async (type: string, stationId: string | null) => {
      const data = (await create(hub, 'Screen', '10.1.0.9')).json().data;
      const deviceId = hub.deps.ids.next();
      hub.deps.db
        .prepare(`INSERT INTO devices (device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by) VALUES (?, 'branch-1', ?, 'Screen', ?, ?, NULL, ?, 'S_OWNER')`)
        .run(deviceId, sha256hex(`secret-${deviceId}`), type, stationId, hub.clock.branchNow());
      hub.deps.db.prepare('UPDATE pair_requests SET approved_at = ?, approved_by = ?, device_id = ?, delivery_token = ? WHERE request_id = ?').run(hub.clock.branchNow(), 'S_OWNER', deviceId, `secret-${deviceId}`, data.request_id);
      return (await poll(hub, data.request_id, data.poll_secret)).json().data;
    };
    expect(await approve('kds', 'S1')).toMatchObject({ status: 'approved', station_id: 'S1', station_name: 'Karahi' });
    expect(await approve('cashier_kiosk', null)).toMatchObject({ status: 'approved', station_id: null, station_name: null });
  });

  it('[05a #25] hardware_hint is stored in the column; absent stays NULL; the display code and token are not in the stored hint', async () => {
    const hub = await open();
    const withHint = (await create(hub, 'Phone', '10.1.0.11', { hardware_hint: 'phone' })).json().data;
    const without = (await create(hub, 'Other', '10.1.0.12')).json().data;
    const hint = (id: string) => hub.deps.db.prepare('SELECT hardware_hint FROM pair_requests WHERE request_id = ?').pluck().get(id);
    expect(hint(withHint.request_id)).toBe('phone');
    expect(hint(without.request_id)).toBeNull();
    for (const value of ['tablet', 'cashier_kiosk', 'kds']) {
      const res = await create(hub, 'X', `10.1.1.${value.length}`, { hardware_hint: value });
      expect(res.statusCode).toBe(200);
      expect(hint(res.json().data.request_id)).toBe(value);
    }
  });

  it('[05a #25] hardware_hint outside the four values -> 400 and nothing stored', async () => {
    const hub = await open();
    const before = hub.deps.db.prepare('SELECT COUNT(*) FROM pair_requests').pluck().get();
    for (const bad of ['printer', '', 'PHONE', 7, null]) {
      const res = await create(hub, 'Bad', '10.1.0.20', { hardware_hint: bad });
      expect(res.statusCode).toBe(400);
    }
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM pair_requests').pluck().get()).toBe(before);
  });

  it('[05a §6.2] the approved poll adds screens from the device profile (ordered), [] for a kds or no profile; one statement', async () => {
    const hub = await open();
    const approve = async (type: string, stationId: string | null, screens: string[] | null) => {
      const data = (await create(hub, 'Screen', '10.1.0.30')).json().data;
      const deviceId = hub.deps.ids.next();
      hub.deps.db
        .prepare(`INSERT INTO devices (device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by) VALUES (?, 'branch-1', ?, 'Screen', ?, ?, NULL, ?, 'S_OWNER')`)
        .run(deviceId, sha256hex(`secret-${deviceId}`), type, stationId, hub.clock.branchNow());
      if (screens !== null) {
        hub.deps.db
          .prepare(`INSERT INTO device_profiles (device_id, access, screens, profile_version, needs_review) VALUES (?, 'everyone', ?, 1, 0)`)
          .run(deviceId, JSON.stringify(screens));
      }
      hub.deps.db.prepare('UPDATE pair_requests SET approved_at = ?, approved_by = ?, device_id = ?, delivery_token = ? WHERE request_id = ?').run(hub.clock.branchNow(), 'S_OWNER', deviceId, `secret-${deviceId}`, data.request_id);
      const counter = statementCounter(hub.deps.readDb);
      const res = await poll(hub, data.request_id, data.poll_secret);
      expect(counter.count).toBe(1);
      return res.json().data;
    };
    expect(await approve('tablet', null, ['pass', 'dine_in', 'cashier'])).toMatchObject({ status: 'approved', screens: ['pass', 'dine_in', 'cashier'] });
    expect(await approve('kds', 'S1', null)).toMatchObject({ status: 'approved', screens: [] });
    expect(await approve('phone', null, null)).toMatchObject({ status: 'approved', screens: [] });
  });

  it('[00 §10 #95] create → pending → approved (insert the approval rows directly) → token twice → after expires_at 404 and delivery_token cleared by clearExpiredDeliveryTokens; wrong secret 404; 11th pending → 503', async () => {
    const hub = await open();
    const before = hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get();
    const created = await create(hub, 'Till', '10.1.0.1');
    expect(created.statusCode).toBe(200);
    const data = created.json().data;
    expect(data.approve_url).toBe(`http://192.168.10.2:3000/admin/approve?r=${data.request_id}`);
    expect(data.approve_qr_svg).toBe(qrSvg(data.approve_url));
    expect(data.expires_at).toBe(hub.clock.branchNow() + 600_000);
    expect(data.display_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(before);
    const stored = hub.deps.db
      .prepare('SELECT poll_secret_hash, requester_ip FROM pair_requests WHERE request_id = ?')
      .get(data.request_id) as { poll_secret_hash: string; requester_ip: string };
    expect(stored).toEqual({ poll_secret_hash: sha256hex(data.poll_secret), requester_ip: '10.1.0.1' });

    const pending = await poll(hub, data.request_id, data.poll_secret);
    expect(pending.statusCode).toBe(200);
    expect(pending.json().data).toEqual({ status: 'pending' });

    const deviceId = hub.deps.ids.next();
    hub.deps.db
      .prepare(
        `INSERT INTO devices (
          device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by
        ) VALUES (?, 'branch-1', ?, 'Till', 'cashier_kiosk', NULL, NULL, ?, 'S_OWNER')`,
      )
      .run(deviceId, sha256hex('device-secret'), hub.clock.branchNow());
    hub.deps.db
      .prepare(
        `UPDATE pair_requests SET approved_at = ?, approved_by = ?, device_id = ?, delivery_token = ? WHERE request_id = ?`,
      )
      .run(hub.clock.branchNow(), 'S_OWNER', deviceId, 'device-secret', data.request_id);
    const approved = await poll(hub, data.request_id, data.poll_secret);
    const again = await poll(hub, data.request_id, data.poll_secret);
    expect(approved.json().data).toMatchObject({
      status: 'approved',
      device_id: deviceId,
      device_token: 'device-secret',
      device_type: 'cashier_kiosk',
      station_id: null,
      branch_name: 'Main',
    });
    expect(again.json().data.device_token).toBe('device-secret');

    const wrong = await poll(hub, data.request_id, 'not-the-secret');
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json().error.code).toBe('PAIRING_REQUEST_NOT_FOUND');

    hub.clock.advance(600_000);
    const expired = await poll(hub, data.request_id, data.poll_secret);
    expect(expired.statusCode).toBe(404);
    expect(expired.json().error.code).toBe('PAIRING_REQUEST_NOT_FOUND');
    hub.deps.writer.run((tx) => {
      clearExpiredDeliveryTokens(tx, hub.clock.branchNow());
    });
    const cleared = hub.deps.db.prepare('SELECT delivery_token FROM pair_requests WHERE request_id = ?').get(data.request_id);
    expect(cleared).toEqual({ delivery_token: null });

    for (let i = 0; i < 10; i += 1) {
      const made = await create(hub, `S${i}`, `10.2.0.${i + 1}`);
      expect(made.statusCode).toBe(200);
    }
    const full = await create(hub, 'overflow', '10.2.0.50');
    expect(full.statusCode).toBe(503);
    expect(full.json().error.code).toBe('SERVICE_UNAVAILABLE');
    expect(full.json().error.details.retry_after_ms).toBe(60_000);
  });

  it('[00 §6.31] polled after approval but after expires_at → 404 and no delivery_token in the row', async () => {
    const hub = await open();
    const created = await create(hub, 'KDS', '10.3.0.1');
    const data = created.json().data;
    hub.deps.db
      .prepare(`UPDATE pair_requests SET approved_at = ?, approved_by = 'S_OWNER', delivery_token = 'plain' WHERE request_id = ?`)
      .run(hub.clock.branchNow(), data.request_id);
    hub.clock.advance(600_000);
    const polled = await poll(hub, data.request_id, data.poll_secret);
    expect(polled.statusCode).toBe(404);
    hub.deps.writer.run((tx) => {
      clearExpiredDeliveryTokens(tx, hub.clock.branchNow());
    });
    const row = hub.deps.db.prepare('SELECT delivery_token FROM pair_requests WHERE request_id = ?').get(data.request_id);
    expect(row).toEqual({ delivery_token: null });
  });

  it('[00 §10 #130] third pending request from one IP → 429 IP_LOCKED_OUT with retry_after_ms; other IPs still succeed; 11th pending overall → 503', async () => {
    const hub = await open();
    expect((await create(hub, 'A', '10.4.0.1')).statusCode).toBe(200);
    expect((await create(hub, 'B', '10.4.0.1')).statusCode).toBe(200);
    const locked = await create(hub, 'C', '10.4.0.1');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('IP_LOCKED_OUT');
    expect(locked.json().error.details.retry_after_ms).toBe(600_000);
    expect((await create(hub, 'D', '10.4.0.2')).statusCode).toBe(200);
    for (let i = 0; i < 7; i += 1) expect((await create(hub, `E${i}`, `10.4.1.${i + 1}`)).statusCode).toBe(200);
    const full = await create(hub, 'F', '10.4.2.1');
    expect(full.statusCode).toBe(503);
    expect(full.json().error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('[00 §10 #131] the setup, pairing-token and pairing-request responses carry an SVG equal to qrSvg(their URL), with no <script>', async () => {
    const setup = await provision();
    expect(setup.first_admin_qr_svg).toBe(qrSvg(setup.first_admin_url));
    expect(setup.first_admin_qr_svg).not.toContain('<script');

    const hub = await open();
    const admin = adminOf(hub);
    const token = await hub.app.inject({
      method: 'POST',
      url: '/admin/commands/generate-device-pairing-token',
      headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
      payload: {
        command_id: 'cmd-qr',
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'GenerateDevicePairingToken',
        payload: { device_type: 'tablet' },
        occurred_at: hub.clock.branchNow(),
        actor_id: 'S_OWNER',
        device_id: admin.device.deviceId,
      },
    });
    const issued = token.json().data.result;
    expect(issued.pair_qr_svg).toBe(qrSvg(issued.pair_url));
    expect(issued.pair_qr_svg).not.toContain('<script');

    const request = await create(hub, 'Screen', '10.5.0.1');
    const body = request.json().data;
    expect(body.approve_qr_svg).toBe(qrSvg(body.approve_url));
    expect(body.approve_qr_svg).not.toContain('<script');
  });
});

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub);
  return hub;
}

function create(hub: TestHub, deviceName: string, remoteAddress: string, extra: Record<string, unknown> = {}) {
  return hub.app.inject({
    method: 'POST',
    url: '/pair/requests',
    remoteAddress,
    payload: { device_name: deviceName, ...extra },
  });
}

function poll(hub: TestHub, id: string, secret: string) {
  return hub.app.inject({
    method: 'GET',
    url: `/pair/requests/${id}`,
    headers: { 'x-poll-secret': secret },
  });
}

function adminOf(hub: TestHub): { device: { deviceId: string; token: string }; session: { token: string } } {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });
  return { device, session };
}

async function provision(): Promise<{ first_admin_url: string; first_admin_qr_svg: string }> {
  const hub = await createTestHub({ provisioned: false });
  cleanups.push(() => hub.close());
  delete hub.deps.config.backup_encryption_key;
  const configPath = `${hub.deps.config.data_dir}/config.json`;
  writeHubConfigAtomic(configPath, hub.deps.config);
  const cloud = stubCloud();
  cloud.registerResult = {
    data: {
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      branch_name: 'Main',
      currency_code: 'PKR',
      kind: 'new_branch',
      branch_api_key: 'branch-key-plain',
      directory: await aDirectory(),
    },
  };
  registerSetupRoutes(hub.app, { ...hub.deps, cloud, configPath, exit: () => undefined });
  const response = await hub.app.inject({
    method: 'POST',
    url: '/setup/provision',
    payload: {
      registration_code: 'abcd-efgh jkmn',
      guest_network_cidrs: ['192.168.20.0/24'],
      advertised_host: '192.168.10.2',
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data as { first_admin_url: string; first_admin_qr_svg: string };
}
