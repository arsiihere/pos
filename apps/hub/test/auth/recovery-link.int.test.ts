import { issueAdminBootstrap } from '../../src/auth/bootstrap-tokens';
import { listRouteGuards } from '../../src/auth/guards';
import { afterEach, describe, expect, it } from 'vitest';
import { PIN } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 05a §6.11 (H-7, N-7, R-1, R-2): `POST /admin/recovery-link` at zero admin devices (M-8).

const cleanups: Array<() => Promise<void>> = [];

describe('05a §6.11 admin recovery link', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[05a #16a] at 0 a bootstrap token is issued (issued_by recovery, device_id = caller); the link signs in with a PIN; a second press while it is live → 200 { already_issued_until } and the first link still works; no admin session needed; at ≥ 1 → 403 recovery_not_needed', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet', profile: { access: 'everyone', screens: ['dine_in'] } });

    const issued = await press(hub, tablet.token);
    expect(issued.statusCode).toBe(200);
    const data = issued.json().data as { first_admin_url: string; expires_at: number };
    expect(data.expires_at).toBe(hub.clock.branchNow() + 1_800_000);
    expect(data.first_admin_url).toMatch(/^http:\/\/192\.168\.10\.2:3000\/admin\/bootstrap#t=.+$/);
    expect(data as Record<string, unknown>).toHaveProperty('first_admin_qr_svg', expect.stringContaining('<svg'));
    const events = bootstrapEvents(hub);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ schema_version: 2, device_id: tablet.deviceId, actor_id: null, payload: { issued_by: 'recovery', expires_at: data.expires_at } });

    const again = await press(hub, tablet.token);
    expect(again.statusCode).toBe(200);
    expect(again.json().data).toEqual({ already_issued_until: data.expires_at });
    expect(bootstrapEvents(hub)).toHaveLength(1);

    const signedIn = await hub.app.inject({
      method: 'POST',
      url: '/admin/auth/bootstrap',
      payload: { bootstrap_token: data.first_admin_url.slice(data.first_admin_url.indexOf('#t=') + 3), staff_id: 'S_OWNER', pin: PIN.a },
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().data.admin_session_token).toEqual(expect.any(String));

    const route = listRouteGuards(hub.app).find((r) => r.method === 'POST' && r.url === '/admin/recovery-link');
    expect(route?.guards).toEqual(['host', 'provisioned', 'guest', 'device']);
    const noDevice = await hub.app.inject({ method: 'POST', url: '/admin/recovery-link' });
    expect(noDevice.statusCode).toBe(401);
    expect(noDevice.json().error.code).toBe('DEVICE_TOKEN_INVALID');

    pairDevice(hub, { type: 'phone', ownerStaffId: 'S_OWNER', profile: { access: 'listed', staff_ids: ['S_OWNER'], screens: ['dine_in'] } });
    const notNeeded = await press(hub, tablet.token);
    expect(notNeeded.statusCode).toBe(403);
    expect(notNeeded.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'recovery_not_needed' } });
    expect(bootstrapEvents(hub)).toHaveLength(1);
  });

  it('[05a #16a] approve half: the owner approves their phone from the recovery session; then the count is 1 and recovery is not needed', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet', profile: { access: 'everyone', screens: ['dine_in'] } });
    const issued = await press(hub, tablet.token);
    expect(issued.statusCode).toBe(200);
    const url = issued.json().data.first_admin_url as string;
    const signedIn = await hub.app.inject({
      method: 'POST',
      url: '/admin/auth/bootstrap',
      payload: { bootstrap_token: url.slice(url.indexOf('#t=') + 3), staff_id: 'S_OWNER', pin: PIN.a },
    });
    expect(signedIn.statusCode).toBe(200);
    const adminToken = signedIn.json().data.admin_session_token as string;

    const created = await hub.app.inject({ method: 'POST', url: '/pair/requests', remoteAddress: '10.6.0.1', payload: { device_name: 'phone', hardware_hint: 'phone' } });
    const request = created.json().data as { request_id: string; display_code: string; poll_secret: string };
    const approved = await hub.app.inject({
      method: 'POST',
      url: '/admin/commands/approve-pairing-request',
      headers: { 'x-admin-session': adminToken },
      payload: {
        command_id: 'cmd-recovery-approve',
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'ApprovePairingRequest',
        payload: { request_id: request.request_id, display_code: request.display_code, device_type: 'phone', device_name: "Owner's phone", access: 'listed', staff_ids: ['S_OWNER'], screens: ['dine_in', 'manager'] },
        occurred_at: hub.clock.branchNow(),
        actor_id: 'S_OWNER',
        device_id: 'hub-admin',
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.result).toMatchObject({ device_type: 'phone', access: 'listed', screens: ['dine_in', 'manager'] });
    const polled = await hub.app.inject({ method: 'GET', url: `/pair/requests/${request.request_id}`, headers: { 'x-poll-secret': request.poll_secret } });
    expect(polled.json().data).toMatchObject({ status: 'approved', device_type: 'phone' });

    const notNeeded = await press(hub, tablet.token);
    expect(notNeeded.statusCode).toBe(403);
    expect(notNeeded.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'recovery_not_needed' } });
  });

  it('[05a #16a] any live bootstrap token (here one from setup) answers already_issued_until; a consumed or expired one does not; a kds device is refused', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet', profile: { access: 'everyone', screens: ['dine_in'] } });
    const setup = issueAs(hub, 'setup');
    const live = await press(hub, tablet.token);
    expect(live.statusCode).toBe(200);
    expect(live.json().data).toEqual({ already_issued_until: setup.expires_at });

    hub.clock.advance(1_800_000);
    const afterExpiry = await press(hub, tablet.token);
    expect(afterExpiry.statusCode).toBe(200);
    const url = afterExpiry.json().data.first_admin_url as string;
    const consumed = await hub.app.inject({
      method: 'POST',
      url: '/admin/auth/bootstrap',
      payload: { bootstrap_token: url.slice(url.indexOf('#t=') + 3), staff_id: 'S_OWNER', pin: PIN.a },
    });
    expect(consumed.statusCode).toBe(200);
    const afterConsumed = await press(hub, tablet.token);
    expect(afterConsumed.statusCode).toBe(200);
    expect(afterConsumed.json().data.first_admin_url).toEqual(expect.any(String));

    const kds = pairDevice(hub, { type: 'kds', stationId: 'ST_GRILL' });
    const refused = await press(hub, kds.token);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('DEVICE_TYPE_NOT_ALLOWED');
  });

  it('[05a §6.11 N-7] the admin-device-public group refuses an unknown token, a revoked device and a kds device; nothing is written', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet', profile: { access: 'everyone', screens: ['dine_in'] } });
    const kds = pairDevice(hub, { type: 'kds', stationId: 'ST_GRILL' });
    hub.deps.db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(hub.clock.branchNow(), tablet.deviceId);

    const unknown = await press(hub, 'not-a-paired-device-token');
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.code).toBe('DEVICE_TOKEN_INVALID');
    const revoked = await press(hub, tablet.token);
    expect(revoked.statusCode).toBe(403);
    expect(revoked.json().error.code).toBe('DEVICE_REVOKED');
    const refused = await press(hub, kds.token);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatchObject({ code: 'DEVICE_TYPE_NOT_ALLOWED', details: { device_type: 'kds' } });

    expect(bootstrapEvents(hub)).toHaveLength(0);
    expect(hub.deps.db.prepare('SELECT COUNT(*) AS n FROM admin_bootstrap_tokens').get()).toEqual({ n: 0 });
  });

  it('[05a §6.11 R-1] statements: 1 read of live bootstrap tokens + the issueAdminBootstrap transaction', async () => {
    const hub = await open();
    const tablet = pairDevice(hub, { type: 'tablet', profile: { access: 'everyone', screens: ['dine_in'] } });
    const kds = pairDevice(hub, { type: 'kds', stationId: 'ST_GRILL' });
    const counter = statementCounter(hub.deps.db);

    // Guard statements only: the kds device is refused before the handler reads anything.
    counter.reset();
    await press(hub, kds.token);
    const guards = counter.count;

    counter.reset();
    expect((await press(hub, tablet.token)).statusCode).toBe(200);
    const issuePath = counter.count;

    counter.reset();
    expect((await press(hub, tablet.token)).json().data.already_issued_until).toEqual(expect.any(Number));
    expect(counter.count).toBe(guards + 1);

    counter.reset();
    issueAs(hub, 'recovery');
    const transaction = counter.count;
    expect(issuePath).toBe(guards + 1 + transaction);
  });

  it('[05a H-7 R-2] setup, the CLI and restore still write AdminBootstrapTokenIssued v2 with device_id hub', async () => {
    const hub = await open();
    for (const issuedBy of ['setup', 'cli', 'restore'] as const) issueAs(hub, issuedBy);
    expect(bootstrapEvents(hub).map((e) => ({ v: e.schema_version, device_id: e.device_id, by: e.payload.issued_by }))).toEqual([
      { v: 2, device_id: 'hub', by: 'setup' },
      { v: 2, device_id: 'hub', by: 'cli' },
      { v: 2, device_id: 'hub', by: 'restore' },
    ]);
  });
});

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub);
  return hub;
}

function press(hub: TestHub, deviceToken: string) {
  return hub.app.inject({ method: 'POST', url: '/admin/recovery-link', headers: { authorization: `Bearer ${deviceToken}` } });
}

function issueAs(hub: TestHub, issuedBy: 'setup' | 'cli' | 'restore' | 'recovery'): { expires_at: number } {
  return hub.deps.writer.run((tx) =>
    issueAdminBootstrap(tx, issuedBy, { clock: hub.deps.clock, ids: hub.deps.ids, secrets: hub.deps.secrets }),
  ).result;
}

function bootstrapEvents(hub: TestHub): Array<{
  schema_version: number;
  device_id: string;
  actor_id: string | null;
  payload: { issued_by: string; expires_at: number };
}> {
  return (
    hub.deps.db
      .prepare(`SELECT schema_version, device_id, actor_id, payload FROM events WHERE event_type = 'AdminBootstrapTokenIssued' ORDER BY seq`)
      .all() as Array<{ schema_version: number; device_id: string; actor_id: string | null; payload: string }>
  ).map((row) => ({ ...row, payload: JSON.parse(row.payload) as { issued_by: string; expires_at: number } }));
}
