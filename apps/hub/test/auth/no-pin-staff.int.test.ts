import { afterEach, describe, expect, it } from 'vitest';
import { PIN } from '../helpers/fixtures';
import { createTestHub, pairDevice, seedDirectory } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

// P-3: the cloud half (apps/cloud/test/staff-roles/team-tree.int.test.ts, [01b #62]) shows a Cook with no PIN is
// left out of the directory; this half feeds the hub that directory and checks the hub never sees them.
describe('staff with no PIN on the hub (01b B17, 00 §3.5 step 4)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[01b #62 hub half] a Cook with no PIN is absent from the staff roster; POST /auth/pin → 404 STAFF_NOT_FOUND, not counted', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    const tablet = pairDevice(hub, { type: 'tablet' });
    const auth = { authorization: `Bearer ${tablet.token}` };

    const roster = await hub.app.inject({ method: 'GET', url: '/queries/staff-roster', headers: auth });
    expect(roster.statusCode, roster.body).toBe(200);
    const ids = (roster.json().data.staff as Array<{ staff_id: string }>).map((row) => row.staff_id);
    expect(ids).toContain('S_OWNER');
    expect(ids).not.toContain('S_USMAN');

    const events = () => hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
    const before = events();
    const pin = await hub.app.inject({ method: 'POST', url: '/auth/pin', headers: auth, payload: { staff_id: 'S_USMAN', pin: PIN.a } });
    expect(pin.statusCode).toBe(404);
    expect(pin.json().error.code).toBe('STAFF_NOT_FOUND');
    expect(
      hub.deps.db.prepare(`SELECT COUNT(*) FROM auth_lockouts WHERE subject_type = 'staff' AND subject_id = 'S_USMAN'`).pluck().get(),
    ).toBe(0);
    expect(events()).toBe(before);
  });
});
