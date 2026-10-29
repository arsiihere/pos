import { ConfigStatusResponse } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { onBranchConfigApplied } from '../../src/sync/branch-config-holder';
import { configPoller } from '../../src/sync/config-poller';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { stubConfigCloud, type StubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

type Admin = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

function snapshot(version: number): Record<string, unknown> {
  return aBranchConfig({ branch_id: BRANCH, config_version: version });
}

describe('GET /admin/queries/config-status (§6.21)', () => {
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function hub(o: { confirmed?: boolean } = {}): Promise<{ h: TestHub; cloud: StubConfigCloud; admin: Admin }> {
    const cloud = stubConfigCloud();
    const h = await createTestHub({
      configClient: cloud,
      ...(o.confirmed === false ? {} : { config: { provisioned: { ...CONFIRMED } } }),
    });
    cleanups.push(() => h.close());
    await seedDirectory(h, await aDirectory());
    const device = pairDevice(h, { type: 'tablet' });
    const session = openSession(h, { kind: 'admin', staffId: 'S_MGR', deviceId: device.deviceId });
    return { h, cloud, admin: { device, session } };
  }

  function status(h: TestHub, admin: Admin) {
    return h.app.inject({
      method: 'GET',
      url: '/admin/queries/config-status',
      headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
    });
  }

  it('[01a §10 #56] config status shows the last outcome and versions; no config_epoch or epoch_changed_at field', async () => {
    const { h, cloud, admin } = await hub();
    cloud.respondWithSnapshot(snapshot(3), { directory: await aDirectory({ directory_version: 2 }) });
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('applied');
    const appliedAt = h.deps.db
      .prepare(`SELECT recorded_at FROM events WHERE event_type = 'BranchConfigApplied'`)
      .pluck()
      .get() as number;
    const polledAt = h.clock.branchNow();
    h.clock.advance(120_000);

    const counter = statementCounter(h.deps.readDb);
    const res = await status(h, admin);
    expect(res.statusCode).toBe(200);
    expect(counter.count).toBe(2);
    const data = res.json().data;
    expect(data).toEqual({
      tenant_id: 'tenant-a',
      branch_id: BRANCH,
      config_version: 3,
      snapshot_schema_version: 2,
      applied_at: appliedAt,
      directory_version: 2,
      last_poll: { outcome: 'applied', at: polledAt },
      last_problem: null,
    });
    expect(data).not.toHaveProperty('config_epoch');
    expect(data).not.toHaveProperty('epoch_changed_at');

    cloud.next = { kind: 'offline' };
    await configPoller(h.app).pollOnce();
    expect((await status(h, admin)).json().data.last_poll).toEqual({ outcome: 'offline', at: h.clock.branchNow() });
  });

  it('[01a §10 #102] after a hash-mismatch poll last_problem is { rejected, hash_mismatch, at }; it clears after the next unchanged or applied', async () => {
    const { h, cloud, admin } = await hub();
    cloud.respondWithSnapshot(snapshot(3));
    await configPoller(h.app).pollOnce();

    h.clock.advance(60_000);
    cloud.respondWithSnapshot(snapshot(4), { snapshotHash: 'f'.repeat(64) });
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('rejected');
    const at = h.clock.branchNow();
    let data = (await status(h, admin)).json().data;
    expect(data.last_problem).toEqual({ outcome: 'rejected', reason: 'hash_mismatch', at });
    expect(data.last_poll).toEqual({ outcome: 'rejected', at });
    expect(data.config_version).toBe(3);

    h.clock.advance(60_000);
    cloud.next = { kind: 'not_modified' };
    await configPoller(h.app).pollOnce();
    data = (await status(h, admin)).json().data;
    expect(data.last_problem).toBeNull();
    expect(data.last_poll.outcome).toBe('unchanged');

    cloud.respondWithSnapshot(snapshot(5), { snapshotHash: 'f'.repeat(64) });
    await configPoller(h.app).pollOnce();
    expect((await status(h, admin)).json().data.last_problem).toMatchObject({ reason: 'hash_mismatch' });
    cloud.respondWithSnapshot(snapshot(5));
    await configPoller(h.app).pollOnce();
    data = (await status(h, admin)).json().data;
    expect(data.last_problem).toBeNull();
    expect(data.config_version).toBe(5);
  });

  it('[01a §6.21] not_ready on an unconfirmed hub', async () => {
    const { h, cloud, admin } = await hub({ confirmed: false });
    const before = (await status(h, admin)).json().data;
    expect(before).toEqual({
      tenant_id: 'tenant-a',
      branch_id: BRANCH,
      config_version: null,
      snapshot_schema_version: null,
      applied_at: null,
      directory_version: 1,
      last_poll: null,
      last_problem: null,
    });
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('not_ready');
    expect(cloud.calls).toHaveLength(0);
    const data = (await status(h, admin)).json().data;
    expect(data.last_poll).toEqual({ outcome: 'not_ready', at: h.clock.branchNow() });
    expect(data.last_problem).toBeNull();
  });

  it('[01a §6.21] apply_failed reason', async () => {
    const { h, cloud, admin } = await hub();
    const state = { fail: true };
    cleanups.push(
      onBranchConfigApplied(() => {
        if (state.fail) throw new Error('hook refused config');
      }),
    );
    cloud.respondWithSnapshot(snapshot(3));
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('rejected');
    const data = (await status(h, admin)).json().data;
    expect(data.last_problem).toEqual({ outcome: 'rejected', reason: 'apply_failed', at: h.clock.branchNow() });
    expect(data.config_version).toBeNull();

    state.fail = false;
    await configPoller(h.app).pollOnce();
    expect((await status(h, admin)).json().data).toMatchObject({ config_version: 3, last_problem: null });
  });

  it('[01a §6.21, D7] the answer carries the provisioned tenant_id and branch_id; a command built from them is accepted', async () => {
    const { h, admin } = await hub();
    const res = await status(h, admin);
    // D5: the real answer parses with the shared @pos/events schema.
    const data = ConfigStatusResponse.parse(res.json()).data;
    expect(data).toMatchObject({ tenant_id: 'tenant-a', branch_id: BRANCH });
    expect(data.tenant_id).toBe(h.deps.config.provisioned?.tenant_id);

    const command = await h.app.inject({
      method: 'POST',
      url: '/admin/commands/open-business-day',
      headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
      payload: {
        command_id: 'cmd-d7-open',
        tenant_id: data.tenant_id,
        branch_id: data.branch_id,
        command_type: 'OpenBusinessDay',
        payload: {},
        occurred_at: h.clock.branchNow(),
        actor_id: 'S_MGR',
        device_id: admin.device.deviceId,
      },
    });
    expect(command.statusCode).toBe(200);
    expect(command.json().data.result).toMatchObject({ changed: true, reason: 'opened' });
  });
});
