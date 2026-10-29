import { aBranchConfigV1 } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { currentDirectory } from '../../src/auth/guards';
import { configPoller } from '../../src/sync/config-poller';
import { aDirectory } from '../helpers/fixtures';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, openSession, pairDevice, type TestHub } from '../helpers/test-hub';

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

function snapshot(version: number): Record<string, unknown> {
  return aBranchConfigV1({ branch_id: BRANCH, config_version: version });
}

// P-3: the cloud half is `[01b #9]` in apps/cloud/test/staff-roles/leaving.int.test.ts. This half feeds the hub
// the v2 directory the cloud half asserts: the leaver is absent and the version is one higher.
describe('a leaver reaches the hub through the poll (01b §6.4, 00 M38)', () => {
  const hubs: TestHub[] = [];
  afterEach(async () => {
    for (const h of hubs.splice(0)) await h.close();
  });

  it('[01b #9 hub half] the leaver\'s sessions end staff_removed and their phone is revoked owner_removed', async () => {
    const cloud = stubConfigCloud();
    const h = await createTestHub({ configClient: cloud, config: { provisioned: { ...CONFIRMED } } });
    hubs.push(h);
    const first = await aDirectory({ directory_version: 7 });
    first.staff = first.staff.map((row) => (row.staff_id === 'S_WAIT' ? { ...row, lead_staff_id: 'S_MGR' } : row));
    cloud.respondWithSnapshot(snapshot(3), { directory: first });
    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'applied', directory_version: 7 });

    const phone = pairDevice(h, { type: 'phone', ownerStaffId: 'S_WAIT' });
    const session = openSession(h, { kind: 'staff', staffId: 'S_WAIT', deviceId: phone.deviceId });
    const tablet = pairDevice(h, { type: 'tablet' });
    const kept = openSession(h, { kind: 'staff', staffId: 'S_MGR', deviceId: tablet.deviceId });
    const next = await aDirectory({ directory_version: 8 });
    next.staff = next.staff.filter((row) => row.staff_id !== 'S_WAIT');
    cloud.respondWithSnapshot(snapshot(3), { directory: next });

    expect(await configPoller(h.app).pollOnce()).toMatchObject({ outcome: 'applied', directory_version: 8 });
    const batch = h.published.at(-1)!;
    expect(batch.map((e) => e.event_type).sort()).toEqual(['DeviceRevoked', 'SessionEnded', 'StaffDirectoryApplied']);
    expect(batch.find((e) => e.event_type === 'DeviceRevoked')).toMatchObject({
      payload: { device_id: phone.deviceId, cause: 'owner_removed' },
    });
    expect(batch.find((e) => e.event_type === 'SessionEnded')).toMatchObject({
      payload: expect.objectContaining({ session_id: session.sessionId, reason: 'staff_removed' }),
    });
    const ended = h.deps.db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck();
    expect(ended.get(session.sessionId)).toBe('staff_removed');
    expect(ended.get(kept.sessionId)).toBeNull();
    expect(h.deps.db.prepare('SELECT revoked_at FROM devices WHERE device_id = ?').pluck().get(phone.deviceId)).toBe(h.clock.branchNow());
    expect(currentDirectory(h.app).get('S_WAIT')).toBeUndefined();
  });
});
