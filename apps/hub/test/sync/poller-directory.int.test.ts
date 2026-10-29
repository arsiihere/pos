import type { DirectoryInput } from '@pos/events';
import { aBranchConfigV1 } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { currentDirectory } from '../../src/auth/guards';
import { configPoller } from '../../src/sync/config-poller';
import { aDirectory } from '../helpers/fixtures';
import { stubConfigCloud, type StubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, openSession, pairDevice, type TestHub } from '../helpers/test-hub';

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

function snapshot(version: number): Record<string, unknown> {
  return aBranchConfigV1({ branch_id: BRANCH, config_version: version });
}

describe('config poller: staff directory part (S6)', () => {
  const hubs: TestHub[] = [];
  afterEach(async () => {
    for (const h of hubs.splice(0)) await h.close();
  });
  async function hubWithDirectory(): Promise<{ h: TestHub; cloud: StubConfigCloud }> {
    const cloud = stubConfigCloud();
    const h = await createTestHub({ configClient: cloud, config: { provisioned: { ...CONFIRMED } } });
    hubs.push(h);
    cloud.respondWithSnapshot(snapshot(3), { directory: await aDirectory({ directory_version: 1 }) });
    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'applied', directory_version: 1 });
    return { h, cloud };
  }
  const types = (h: TestHub) => h.published.at(-1)?.map((e) => e.event_type).sort();

  it('[01a §10 #51] a directory that removes a phone owner → DeviceRevoked owner_removed and SessionEnded staff_removed in the poll transaction', async () => {
    const { h, cloud } = await hubWithDirectory();
    const phone = pairDevice(h, { type: 'phone', ownerStaffId: 'S_CASH' });
    const session = openSession(h, { kind: 'staff', staffId: 'S_CASH', deviceId: phone.deviceId });
    const next = await aDirectory({ directory_version: 2 });
    next.staff = next.staff.filter((row) => row.staff_id !== 'S_CASH');
    cloud.respondWithSnapshot(snapshot(4), { directory: next });

    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'applied', config_version: 4, directory_version: 2 });
    expect(types(h)).toEqual(['BranchConfigApplied', 'DeviceRevoked', 'SessionEnded', 'StaffDirectoryApplied']);
    const batch = h.published.at(-1)!;
    expect(batch.find((e) => e.event_type === 'DeviceRevoked')).toMatchObject({
      actor_id: null,
      device_id: 'hub',
      payload: { device_id: phone.deviceId, reason: null, cause: 'owner_removed' },
    });
    expect(batch.find((e) => e.event_type === 'SessionEnded')).toMatchObject({
      payload: expect.objectContaining({ session_id: session.sessionId, reason: 'staff_removed' }),
    });
    expect(h.deps.db.prepare('SELECT revoked_at FROM devices WHERE device_id = ?').pluck().get(phone.deviceId)).toBe(
      h.clock.branchNow(),
    );
    expect(h.deps.db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck().get(session.sessionId)).toBe(
      'staff_removed',
    );
    expect(currentDirectory(h.app).get('S_CASH')).toBeUndefined();
  });

  it('[01a §10 #52] a malformed hash for an existing staff member keeps their row, no revoke', async () => {
    const { h, cloud } = await hubWithDirectory();
    const kept = h.deps.db.prepare('SELECT pin_hash, display_name FROM staff WHERE staff_id = ?').get('S_MGR');
    const phone = pairDevice(h, { type: 'phone', ownerStaffId: 'S_MGR' });
    const session = openSession(h, { kind: 'staff', staffId: 'S_MGR', deviceId: phone.deviceId });
    const next: DirectoryInput = await aDirectory({ directory_version: 2 });
    next.staff = next.staff.map((row) =>
      row.staff_id === 'S_MGR' ? { ...row, display_name: 'Renamed', pin_hash: 'not-a-hash' } : row,
    );
    cloud.respondWithSnapshot(snapshot(4), { directory: next });

    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'applied', directory_version: 2 });
    expect(types(h)).toEqual(['BranchConfigApplied', 'StaffDirectoryApplied']);
    expect(h.deps.db.prepare('SELECT pin_hash, display_name FROM staff WHERE staff_id = ?').get('S_MGR')).toEqual(kept);
    expect(h.deps.db.prepare('SELECT revoked_at FROM devices WHERE device_id = ?').pluck().get(phone.deviceId)).toBeNull();
    expect(h.deps.db.prepare('SELECT ended_at FROM staff_sessions WHERE session_id = ?').pluck().get(session.sessionId)).toBeNull();
    const applied = h.published.at(-1)!.find((e) => e.event_type === 'StaffDirectoryApplied');
    expect((applied?.payload as { skipped: unknown[] }).skipped).toContainEqual({
      kind: 'staff',
      id: 'S_MGR',
      reason: 'malformed pin_hash',
    });
    expect(currentDirectory(h.app).get('S_MGR')).toBeDefined();
  });
});
