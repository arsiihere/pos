import { verify } from '@node-rs/argon2';
import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { currentDirectory } from '../../src/auth/guards';
import { aDirectory, pinHash } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

// 01b #3 hub half (plan P-3): the cloud half asserts `PUT /v1/admin/staff/:id/pin` stores an argon2id hash with
// m=19456,t=2,p=1 and sends it in `loadDirectory`; here the hub applies that shape.
describe('PIN from the cloud (01b §6.3, 00 M50, M52)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    activity.drain();
    activity.drainDevices();
  });

  it('[01b #3 hub half] a cloud-set M8 hash is applied, not skipped; a second hash ends the person\'s sessions credentials_changed', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const first = await pinHash('0123');
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    const directory = await aDirectory();
    directory.staff.push({
      staff_id: 'S_NEW',
      display_name: 'Bilal',
      pin_hash: first,
      role_ids: ['R_WAIT'],
      denied_permissions: [],
      lead_staff_id: null,
      floor_ids: [],
    });
    await seedDirectory(hub, directory);
    expect(currentDirectory(hub.app).get('S_NEW')?.pin_hash).toBe(first);
    expect(await verify(first, '0123')).toBe(true);
    expect(lastApplied(hub).skipped).toEqual([]);

    const device = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId: 'S_NEW', deviceId: device.deviceId });
    const other = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: pairDevice(hub, { type: 'tablet' }).deviceId });

    const reset = await aDirectory({ directory_version: 2 });
    reset.staff.push({ ...directory.staff.at(-1)!, pin_hash: await pinHash('4321') });
    await seedDirectory(hub, reset);
    const endOf = (id: string) => hub.deps.db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck().get(id);
    expect(endOf(session.sessionId)).toBe('credentials_changed');
    expect(endOf(other.sessionId)).toBeNull();
    expect(lastApplied(hub).skipped).toEqual([]);
  });
});

function lastApplied(hub: TestHub): { skipped: unknown[] } {
  const payload = hub.deps.db
    .prepare(`SELECT payload FROM events WHERE event_type = 'StaffDirectoryApplied' ORDER BY seq DESC LIMIT 1`)
    .pluck()
    .get() as string;
  return JSON.parse(payload) as { skipped: unknown[] };
}
