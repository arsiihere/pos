import { afterEach, describe, expect, it } from 'vitest';
import { endSession, type SessionRow } from '../../src/auth/session-store';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory } from '../helpers/test-hub';

describe('session store', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §3.4] a second endSession on a stale row writes no SessionEnded', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const opened = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
    const stale = hub.deps.db
      .prepare(
        `SELECT session_id, kind, staff_id, station_id, device_id, idle_ttl_ms, last_activity_at, ended_at, token_hash
         FROM staff_sessions WHERE session_id = ?`,
      )
      .get(opened.sessionId) as SessionRow;
    hub.deps.writer.run((tx) => {
      endSession(tx, stale, 'logout', null, null, device.deviceId);
    });
    hub.deps.writer.run((tx) => {
      endSession(tx, stale, 'forced', null, null, device.deviceId);
    });
    const reasons = hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'SessionEnded'`).all() as Array<{
      payload: string;
    }>;
    expect(reasons.map((row) => JSON.parse(row.payload).reason)).toEqual(['logout']);
    expect(hub.deps.db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck().get(opened.sessionId)).toBe(
      'logout',
    );
  });

  it('[00 §3.1 M7] ending a bootstrap session records device_id hub-admin', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    await seedDirectory(hub);
    const opened = openSession(hub, { kind: 'admin', staffId: 'S_OWNER' });
    endSessionNow(hub, opened.sessionId);
    expect(hub.deps.db.prepare(`SELECT device_id FROM events WHERE event_type = 'SessionEnded'`).pluck().get()).toBe('hub-admin');
  });
});
