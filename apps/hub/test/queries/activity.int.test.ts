import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// ⚠️ 00 v1.14 M101 (owner 2026-11-28 Q8; QA BUG-12): the person's input on the device is activity. The staff client
// sends GET /queries/activity after a tap or key (at most once per 60 s); the hub refreshes the session's activity in
// memory, writes nothing (0 statements) and answers {}. Without a session it is refused like any session query.

describe('[00 v1.14 M101] the activity query', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    activity.drain();
    activity.drainDevices();
  });

  async function staff(hub: TestHub) {
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
    return { device, session };
  }
  const counts = (hub: TestHub) => ({
    events: hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
    commands: hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get() as number,
  });

  it('refreshes the staff session\'s activity, answers {}, writes nothing', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const bound = await staff(hub);
    const before = counts(hub);
    hub.clock.advance(5_000);
    expect(activity.get(bound.session.sessionId)).toBeUndefined();
    const res = await hub.app.inject({
      method: 'GET',
      url: '/queries/activity',
      headers: { authorization: `Bearer ${bound.device.token}`, 'x-session-token': bound.session.token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({});
    expect(activity.get(bound.session.sessionId)).toBe(hub.clock.branchNow());
    expect(counts(hub)).toEqual(before);
  });

  it('no session → 401 (the page signs out)', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const bound = await staff(hub);
    const res = await hub.app.inject({ method: 'GET', url: '/queries/activity', headers: { authorization: `Bearer ${bound.device.token}` } });
    expect(res.statusCode).toBe(401);
  });
});
