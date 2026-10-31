import type { DirectoryInput } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { loadHubConfig } from '../src/config/load';
import { writeHubConfigAtomic } from '../src/config/write';
import { registerSetupRoutes } from '../src/setup/provision';
import { PIN, aDirectory, pinHash } from './helpers/fixtures';
import { stubCloud } from './helpers/stub-cloud';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from './helpers/test-hub';

const REGISTRATION_CODE = 'ZZ73-SECR-ETKM';
const BRANCH_API_KEY = 'branch-key-73-secret';

const cleanups: Array<() => Promise<void>> = [];

describe('log redaction', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #73] no secret from setup, bootstrap, admin auth, pairing token, pair, pairing request, PIN login, station login, logout appears in the logs', async () => {
    const setupSecrets = await runSetup();
    const authSecrets = await runAuth();
    expect(setupSecrets.length).toBeGreaterThan(0);
    expect(authSecrets.length).toBeGreaterThan(0);
  });
});

async function runSetup(): Promise<string[]> {
  const hub = await createTestHub({ provisioned: false });
  cleanups.push(() => hub.close());
  delete hub.deps.config.backup_encryption_key;
  const configPath = `${hub.deps.config.data_dir}/config.json`;
  writeHubConfigAtomic(configPath, hub.deps.config);
  const cloud = stubCloud();
  cloud.registerResult = cloudData(await aDirectory(), BRANCH_API_KEY);
  registerSetupRoutes(hub.app, { ...hub.deps, cloud, configPath, exit: () => undefined });

  const provisioned = await hub.app.inject({
    method: 'POST',
    url: '/setup/provision',
    payload: {
      registration_code: REGISTRATION_CODE,
      guest_network_cidrs: ['192.168.20.0/24'],
      advertised_host: '192.168.10.2',
    },
  });
  expect(provisioned.statusCode).toBe(200);
  const firstAdminUrl = provisioned.json().data.first_admin_url as string;
  const bootstrapToken = firstAdminUrl.slice(firstAdminUrl.indexOf('#t=') + 3);
  const boot = await hub.app.inject({
    method: 'POST',
    url: '/admin/auth/bootstrap',
    payload: { bootstrap_token: bootstrapToken, staff_id: 'S_OWNER', pin: PIN.a },
  });
  expect(boot.statusCode).toBe(200);
  const adminSessionToken = boot.json().data.admin_session_token as string;
  const savedKey = loadHubConfig(configPath).backup_encryption_key ?? '';

  const secrets = [
    REGISTRATION_CODE,
    normalise(REGISTRATION_CODE),
    BRANCH_API_KEY,
    bootstrapToken,
    PIN.a,
    adminSessionToken,
    savedKey,
  ];
  assertAbsent(hub, secrets);
  return secrets;
}

async function runAuth(): Promise<string[]> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  const ownerPin = '573920';
  const cashierPin = '482631';
  const directory = await aDirectory();
  const [ownerHash, cashierHash] = await Promise.all([pinHash(ownerPin), pinHash(cashierPin)]);
  const owner = directory.staff.find((staff) => staff.staff_id === 'S_OWNER');
  const cashier = directory.staff.find((staff) => staff.staff_id === 'S_CASH');
  if (owner === undefined || cashier === undefined) throw new Error('staff missing');
  owner.pin_hash = ownerHash;
  cashier.pin_hash = cashierHash;
  await seedDirectory(hub, directory);
  const adminDevice = pairDevice(hub, { type: 'tablet' });
  const adminSession = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: adminDevice.deviceId });
  const generated = await hub.app.inject({
    method: 'POST',
    url: '/admin/commands/generate-device-pairing-token',
    headers: { authorization: `Bearer ${adminDevice.token}`, 'x-admin-session': adminSession.token },
    payload: {
      command_id: 'cmd-redact-pair',
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'GenerateDevicePairingToken',
      payload: { device_type: 'tablet' },
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_OWNER',
      device_id: adminDevice.deviceId,
    },
  });
  expect(generated.statusCode).toBe(200);
  const pairingToken = generated.json().data.result.pairing_token as string;
  const pairPage = await hub.app.inject({ method: 'GET', url: `/pair?t=${pairingToken}` });
  expect(pairPage.statusCode).toBe(200);
  const paired = await hub.app.inject({
    method: 'POST',
    url: '/devices/pair',
    payload: {
      pairing_token: pairingToken,
      pair_request_id: hub.deps.ids.next(),
      device_name: 'Till',
      device_type: 'tablet',
    },
  });
  expect(paired.statusCode).toBe(200);
  const deviceToken = paired.json().data.device_token as string;

  const requested = await hub.app.inject({
    method: 'POST',
    url: '/pair/requests',
    payload: { device_name: 'Front' },
    remoteAddress: '192.168.10.9',
  });
  expect(requested.statusCode).toBe(200);
  const pollSecret = requested.json().data.poll_secret as string;
  const requestId = requested.json().data.request_id as string;
  const polled = await hub.app.inject({
    method: 'GET',
    url: `/pair/requests/${requestId}`,
    headers: { 'x-poll-secret': pollSecret },
  });
  expect(polled.statusCode).toBe(200);

  const tablet = pairDevice(hub, { type: 'tablet' });
  const pinLogin = await hub.app.inject({
    method: 'POST',
    url: '/auth/pin',
    headers: { authorization: `Bearer ${tablet.token}` },
    payload: { staff_id: 'S_CASH', pin: cashierPin },
  });
  expect(pinLogin.statusCode).toBe(200);
  const sessionToken = pinLogin.json().data.session_token as string;
  const loggedOut = await hub.app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { authorization: `Bearer ${tablet.token}`, 'x-session-token': sessionToken },
    payload: {},
  });
  expect(loggedOut.statusCode).toBe(200);

  const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
  const station = await hub.app.inject({
    method: 'POST',
    url: '/auth/station',
    headers: { authorization: `Bearer ${kds.token}` },
    payload: {},
  });
  expect(station.statusCode).toBe(200);
  const stationToken = station.json().data.session_token as string;

  const adminLogin = await hub.app.inject({
    method: 'POST',
    url: '/admin/auth',
    headers: { authorization: `Bearer ${tablet.token}` },
    payload: { staff_id: 'S_OWNER', pin: ownerPin },
  });
  expect(adminLogin.statusCode).toBe(200);
  const adminToken = adminLogin.json().data.admin_session_token as string;

  const secrets = [
    adminDevice.token,
    adminSession.token,
    pairingToken,
    deviceToken,
    pollSecret,
    tablet.token,
    cashierPin,
    sessionToken,
    kds.token,
    stationToken,
    ownerPin,
    adminToken,
  ];
  assertAbsent(hub, secrets);
  expect(hub.logs()).toContain('[Redacted]');
  return secrets;
}

function assertAbsent(hub: TestHub, secrets: string[]): void {
  const logs = hub.logs();
  expect(logs.length).toBeGreaterThan(0);
  for (const secret of secrets) {
    expect(logs, secret).not.toContain(secret);
  }
}

function normalise(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

function cloudData(directory: DirectoryInput, branchApiKey: string): unknown {
  return {
    data: {
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      branch_name: 'Main',
      currency_code: 'PKR',
      kind: 'new_branch',
      branch_api_key: branchApiKey,
      directory,
    },
  };
}
