import { EN } from '../../src/lib/strings';
import { request as httpRequest } from 'node:http';
import type { DirectoryInput } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256hex } from '../../src/lib/hash';
import { qrSvg } from '../../src/lib/qr';
import { loadHubConfig } from '../../src/config/load';
import { isProvisioned } from '../../src/config/schema';
import { writeHubConfigAtomic } from '../../src/config/write';
import { registerSetupRoutes, type SetupDeps } from '../../src/setup/provision';
import { aDirectory } from '../helpers/fixtures';
import { CloudError, CloudUnreachableError, stubCloud, type StubCloud } from '../helpers/stub-cloud';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs } from '../helpers/ws-client';

const BODY = {
  registration_code: 'abcd-efgh jkmn',
  guest_network_cidrs: ['192.168.20.0/24'],
  advertised_host: '192.168.10.2',
};
const WEAK_HASH = '$argon2id$v=19$m=1024,t=2,p=1$c2FsdHNhbHQ$aGFzaA';

describe('POST /setup/provision', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #132] setup stores branch_name in the config; /devices/pair, the approved poll and the WS catch-up return it', async () => {
    const ctx = await openSetup();
    cleanups.push(ctx.close);
    ctx.cloud.registerResult = cloudData(await aDirectory());
    expect((await post(ctx.hub)).statusCode).toBe(200);
    const saved = loadHubConfig(ctx.configPath);
    expect(saved.provisioned?.branch_name).toBe('Main');

    const hub = await createTestHub({ config: { provisioned: saved.provisioned } });
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    const now = hub.clock.branchNow();
    hub.deps.db
      .prepare(
        `INSERT INTO pairing_tokens (pairing_token_id, branch_id, token_hash, device_type, owner_staff_id, created_by, created_at, expires_at)
         VALUES ('pt-132', 'branch-1', ?, 'tablet', NULL, 'S_OWNER', ?, ?)`,
      )
      .run(sha256hex('pairing-132'), now, now + 600_000);
    const paired = await hub.app.inject({
      method: 'POST',
      url: '/devices/pair',
      payload: { pairing_token: 'pairing-132', pair_request_id: '0'.repeat(26), device_name: 'Till', device_type: 'tablet' },
    });
    expect(paired.statusCode).toBe(200);
    const tablet = paired.json().data as { device_id: string; device_token: string; branch_name: string };
    expect(tablet.branch_name).toBe('Main');

    const kiosk = pairDevice(hub, { type: 'cashier_kiosk' });
    hub.deps.db
      .prepare(
        `INSERT INTO pair_requests (request_id, branch_id, poll_secret_hash, display_code, device_name, requester_ip,
           created_at, expires_at, approved_at, approved_by, device_id, delivery_token)
         VALUES ('req-132', 'branch-1', ?, 'ABCDEF', 'Kiosk', '10.0.0.1', ?, ?, ?, 'S_OWNER', ?, ?)`,
      )
      .run(sha256hex('secret-132'), now, now + 600_000, now, kiosk.deviceId, kiosk.token);
    const poll = await hub.app.inject({ method: 'GET', url: '/pair/requests/req-132', headers: { 'x-poll-secret': 'secret-132' } });
    expect(poll.json().data).toMatchObject({ status: 'approved', branch_name: 'Main' });

    const session = openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: tablet.device_id });
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: tablet.device_token, session_token: session.token });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'catch_up', state: { hub: { branch_name: 'Main' } } });
  });

  it('[00 §10 #15] setup applies the directory, records HubProvisioned and a bootstrap token, and asks to exit', async () => {
    const ctx = await openSetup();
    cleanups.push(ctx.close);
    const page = await ctx.hub.app.inject({ method: 'GET', url: '/setup' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('first_admin_url');
    expect(page.body).toContain('first_admin_qr_svg');
    expect(page.body.toLowerCase()).not.toContain('<script src');

    const directory = await aDirectory();
    ctx.cloud.registerResult = cloudData(directory);
    const res = await post(ctx.hub);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      branch_name: 'Main',
      restarting: true,
    });
    expect(data.first_admin_url).toMatch(/^http:\/\/192\.168\.10\.2:3000\/admin\/bootstrap#t=/);
    expect(data.first_admin_qr_svg).toBe(qrSvg(data.first_admin_url));
    expect(data.first_admin_expires_at).toBe(1_761_000_000_000 + 1_800_000);
    expect(ctx.exits).toEqual([0]);
    expect(ctx.cloud.registerCalls).toEqual([
      {
        body: {
          registration_code: 'ABCDEFGHJKMN',
          hub_version: '0.0.0',
          accepted_kinds: ['new_branch'],
        },
        idempotencyKey: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      },
    ]);

    const saved = loadHubConfig(ctx.configPath);
    expect(saved.provisioned).toMatchObject({
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      branch_api_key: 'branch-key-plain',
    });
    expect(Buffer.from(saved.backup_encryption_key ?? '', 'base64')).toHaveLength(32);
    const token = String(data.first_admin_url).slice(String(data.first_admin_url).indexOf('#t=') + 3);
    const row = ctx.hub.deps.db
      .prepare('SELECT token_hash, expires_at, consumed_at FROM admin_bootstrap_tokens')
      .get() as { token_hash: string; expires_at: number; consumed_at: number | null };
    expect(row.token_hash).toBe(sha256hex(token));
    expect(row.token_hash).not.toBe(token);
    expect(row.expires_at).toBe(data.first_admin_expires_at);
    expect(row.consumed_at).toBeNull();
    expect(staffIds(ctx.hub)).toEqual(['S_CASH', 'S_MGR', 'S_OWNER', 'S_WAIT']);
    const stored = events(ctx.hub);
    const provisioned = stored.find((event) => event.event_type === 'HubProvisioned');
    expect(provisioned?.payload).toEqual({ tenant_id: 'tenant-a', branch_id: 'branch-1', hub_version: '0.0.0' });
    expect(stored.some((event) => event.event_type === 'AdminBootstrapTokenIssued' && event.payload.issued_by === 'setup')).toBe(
      true,
    );
    expect(stored.some((event) => event.event_type === 'StaffDirectoryApplied')).toBe(true);
  });

  it('[00 §10 #16] after provisioning the setup routes are 404', async () => {
    const ctx = await openSetup();
    cleanups.push(ctx.close);
    ctx.cloud.registerResult = cloudData(await aDirectory());
    expect((await post(ctx.hub)).statusCode).toBe(200);
    const again = await post(ctx.hub);
    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe('ROUTE_NOT_FOUND');
    const page = await ctx.hub.app.inject({ method: 'GET', url: '/setup' });
    expect(page.statusCode).toBe(404);
  });

  it('[00 §10 #141] M84: GET /setup before provisioning → 200 form; after → 404 page "already set up" with no form and no hub data', async () => {
    const ctx = await openSetup();
    cleanups.push(ctx.close);
    const before = await ctx.hub.app.inject({ method: 'GET', url: '/setup' });
    expect(before.statusCode).toBe(200);
    expect(before.body).toContain('id="setup"');
    ctx.cloud.registerResult = cloudData(await aDirectory());
    const provisioned = (await post(ctx.hub)).json().data;
    const after = await ctx.hub.app.inject({ method: 'GET', url: '/setup' });
    expect(after.statusCode).toBe(404);
    expect(after.headers['content-type']).toContain('text/html');
    expect(after.body).toContain(EN['setup.already_title']);
    expect(after.body).not.toContain('id="setup"');
    expect(after.body).not.toContain(provisioned.tenant_id);
    expect(after.body).not.toContain(provisioned.branch_id);
  });

  it('[00 §10 #17] a concurrent second provision is 409 SETUP_IN_PROGRESS', async () => {
    const ctx = await openSetup();
    cleanups.push(ctx.close);
    const directory = await aDirectory();
    let release: (value: unknown) => void = () => undefined;
    ctx.cloud.registerHub = (body, idempotencyKey) => {
      ctx.cloud.registerCalls.push({ body, idempotencyKey });
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const address = await ctx.hub.app.listen({ host: '127.0.0.1', port: 0 });
    const port = Number(new URL(address).port);
    const first = postRaw(port);
    await waitFor(() => ctx.cloud.registerCalls.length === 1);
    const second = await postRaw(port);
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe('SETUP_IN_PROGRESS');
    release(cloudData(directory));
    const done = await first;
    expect(done.status).toBe(200);
    expect(ctx.cloud.registerCalls).toHaveLength(1);
  });

  it('[00 §10 #18] cloud unreachable is 503 and cloud 401 and 422 pass through', async () => {
    const down = await openSetup();
    cleanups.push(down.close);
    down.cloud.registerError = new CloudUnreachableError();
    const unreachable = await post(down.hub);
    expect(unreachable.statusCode).toBe(503);
    expect(unreachable.json().error.code).toBe('SERVICE_UNAVAILABLE');
    expect(unreachable.json().error.details.retry_after_ms).toBe(5000);
    expect(unreachable.headers['retry-after']).toBe('5');
    expect(events(down.hub)).toEqual([]);
    expect(isProvisioned(loadHubConfig(down.configPath))).toBe(false);

    const denied = await openSetup();
    cleanups.push(denied.close);
    denied.cloud.registerError = new CloudError(401, 'REGISTRATION_CODE_INVALID', { same: true });
    const unauthorised = await post(denied.hub);
    expect(unauthorised.statusCode).toBe(401);
    expect(unauthorised.json().error.code).toBe('REGISTRATION_CODE_INVALID');
    expect(unauthorised.json().error.details).toMatchObject({ same: true });
    expect(events(denied.hub)).toEqual([]);

    const wrongKind = await openSetup();
    cleanups.push(wrongKind.close);
    wrongKind.cloud.registerError = new CloudError(422, 'REGISTRATION_CODE_KIND_UNSUPPORTED', {});
    const unsupported = await post(wrongKind.hub);
    expect(unsupported.statusCode).toBe(422);
    expect(unsupported.json().error.code).toBe('REGISTRATION_CODE_KIND_UNSUPPORTED');
    expect(events(wrongKind.hub)).toEqual([]);
  });

  it('[00 §10 #19] a weak pin hash is skipped and setup still succeeds', async () => {
    const ctx = await openSetup();
    cleanups.push(ctx.close);
    const directory = await aDirectory();
    directory.staff = directory.staff.map((staff) =>
      staff.staff_id === 'S_WAIT' ? { ...staff, pin_hash: WEAK_HASH } : staff,
    );
    ctx.cloud.registerResult = cloudData(directory);
    const res = await post(ctx.hub);
    expect(res.statusCode).toBe(200);
    expect(staffIds(ctx.hub)).toEqual(['S_CASH', 'S_MGR', 'S_OWNER']);
    const applied = events(ctx.hub).find((event) => event.event_type === 'StaffDirectoryApplied');
    expect(applied?.payload.skipped).toContainEqual({ kind: 'staff', id: 'S_WAIT', reason: 'weak pin_hash' });
    expect(ctx.exits).toEqual([0]);
  });

  it('[00 §10 #20] a crash after commit reuses the setup attempt and does not write a second HubProvisioned', async () => {
    let crash = true;
    const ctx = await openSetup({
      writeConfig(path, cfg) {
        if (cfg.provisioned !== undefined && crash) {
          crash = false;
          throw new Error('crash before config write');
        }
        writeHubConfigAtomic(path, cfg);
      },
    });
    cleanups.push(ctx.close);
    ctx.cloud.registerResult = cloudData(await aDirectory());
    const failed = await post(ctx.hub);
    expect(failed.statusCode).toBe(500);
    expect(ctx.exits).toEqual([]);
    expect(isProvisioned(loadHubConfig(ctx.configPath))).toBe(false);
    expect(events(ctx.hub).filter((event) => event.event_type === 'HubProvisioned')).toHaveLength(1);
    const retry = await post(ctx.hub);
    expect(retry.statusCode).toBe(200);
    expect(ctx.cloud.registerCalls.map((call) => call.idempotencyKey)).toEqual([
      ctx.cloud.registerCalls[0]?.idempotencyKey,
      ctx.cloud.registerCalls[0]?.idempotencyKey,
    ]);
    expect(events(ctx.hub).filter((event) => event.event_type === 'HubProvisioned')).toHaveLength(1);
    expect(isProvisioned(loadHubConfig(ctx.configPath))).toBe(true);
    const branchNow = ctx.hub.deps.clock.branchNow();
    const live = ctx.hub.deps.db
      .prepare(`SELECT COUNT(*) AS n FROM admin_bootstrap_tokens WHERE consumed_at IS NULL AND expires_at > ?`)
      .get(branchNow) as { n: number };
    expect(live.n).toBe(1);
    expect(events(ctx.hub).filter((event) => event.event_type === 'AdminBootstrapTokenIssued')).toHaveLength(2);
  });

  it('[00 §6.4] a flush failure after the provisioned config write still exits 0', async () => {
    const ctx = await openSetup();
    cleanups.push(ctx.close);
    ctx.cloud.registerResult = cloudData(await aDirectory());
    ctx.hub.app.addHook('onSend', async (request) => {
      if (request.url === '/setup/provision') throw new Error('flush failed');
    });
    const res = await post(ctx.hub);
    expect(res.statusCode).toBe(500);
    expect(isProvisioned(loadHubConfig(ctx.configPath))).toBe(true);
    expect(ctx.exits).toEqual([0]);
  });

  it('[00 §10 #105] empty cidrs, an advertised host that is not ours, and a malformed code are 400', async () => {
    const ctx = await openSetup();
    cleanups.push(ctx.close);
    const cases = [
      { ...BODY, guest_network_cidrs: [] },
      { ...BODY, guest_network_cidrs: ['192.168.020.0/24'] },
      { ...BODY, advertised_host: '203.0.113.9' },
      { ...BODY, registration_code: 'ABCD-EFGH-IJKL' },
    ];
    for (const body of cases) {
      const res = await post(ctx.hub, body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    expect(ctx.cloud.registerCalls).toEqual([]);
    expect(events(ctx.hub)).toEqual([]);
    expect(loadHubConfig(ctx.configPath).setup_attempt_id).toBeUndefined();
  });
});

function cloudData(directory: DirectoryInput): unknown {
  return {
    data: {
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      branch_name: 'Main',
      currency_code: 'PKR',
      kind: 'new_branch',
      branch_api_key: 'branch-key-plain',
      directory,
    },
  };
}

async function openSetup(o?: { writeConfig?: SetupDeps['writeConfig'] }): Promise<{
  hub: TestHub;
  cloud: StubCloud;
  exits: number[];
  configPath: string;
  close: () => Promise<void>;
}> {
  const hub = await createTestHub({ provisioned: false });
  delete hub.deps.config.backup_encryption_key;
  const configPath = `${hub.deps.config.data_dir}/config.json`;
  writeHubConfigAtomic(configPath, hub.deps.config);
  const cloud = stubCloud();
  const exits: number[] = [];
  registerSetupRoutes(hub.app, {
    ...hub.deps,
    cloud,
    configPath,
    exit: (code) => {
      exits.push(code);
    },
    writeConfig: o?.writeConfig,
  });
  return {
    hub,
    cloud,
    exits,
    configPath,
    close: () => hub.close(),
  };
}

function post(hub: TestHub, body: unknown = BODY) {
  return hub.app.inject({ method: 'POST', url: '/setup/provision', payload: body });
}

function postRaw(port: number, body: unknown = BODY): Promise<{ status: number; json: { error: { code: string } } }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/setup/provision',
        method: 'POST',
        headers: {
          host: '192.168.10.2:3000',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as { error: { code: string } } });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

async function waitFor(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting');
}

function events(hub: TestHub): Array<{ event_type: string; payload: Record<string, unknown> }> {
  const rows = hub.deps.db.prepare('SELECT event_type, payload FROM events ORDER BY seq').all() as Array<{
    event_type: string;
    payload: string;
  }>;
  return rows.map((row) => ({ event_type: row.event_type, payload: JSON.parse(row.payload) as Record<string, unknown> }));
}

function staffIds(hub: TestHub): string[] {
  return (hub.deps.db.prepare('SELECT staff_id FROM staff ORDER BY staff_id').all() as Array<{ staff_id: string }>).map(
    (row) => row.staff_id,
  );
}
