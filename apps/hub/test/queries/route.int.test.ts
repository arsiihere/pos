import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

describe('query route', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    activity.drain();
    activity.drainDevices();
  });

  it('[00 §10 #13] a query makes no writes and refreshes activity only when countsAsActivity is true', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const bound = await staff(hub);
    const before = counts(hub);
    const quiet = await get(hub, bound, '/queries/test-quiet');
    expect(quiet.statusCode).toBe(200);
    expect(quiet.json().data).toEqual({ ok: true });
    expect(counts(hub)).toEqual(before);
    expect(activity.get(bound.session.sessionId)).toBeUndefined();
    const active = await get(hub, bound, '/queries/test-activity');
    expect(active.statusCode).toBe(200);
    expect(active.json().data).toEqual({ ok: true });
    expect(counts(hub)).toEqual(before);
    expect(activity.get(bound.session.sessionId)).toBe(hub.clock.branchNow());
  });

  it('[00 §6.2] a limit above 200 is 400', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const device = pairDevice(hub, { type: 'tablet' });
    const omitted = await hub.app.inject({
      method: 'GET',
      url: '/queries/test-page',
      headers: { authorization: `Bearer ${device.token}` },
    });
    expect(omitted.statusCode).toBe(200);
    expect(omitted.json().data).toEqual({ limit: 50 });
    const max = await hub.app.inject({
      method: 'GET',
      url: '/queries/test-page?limit=200',
      headers: { authorization: `Bearer ${device.token}` },
    });
    expect(max.statusCode).toBe(200);
    expect(max.json().data).toEqual({ limit: 200 });
    const response = await hub.app.inject({
      method: 'GET',
      url: '/queries/test-page?limit=201',
      headers: { authorization: `Bearer ${device.token}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('[00 §6.2] a device type outside deviceTypes is 403 DEVICE_TYPE_NOT_ALLOWED', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const kds = pairDevice(hub, { type: 'kds', stationId: 'ST_KDS' });
    const response = await hub.app.inject({
      method: 'GET',
      url: '/queries/test-tablet',
      headers: { authorization: `Bearer ${kds.token}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('DEVICE_TYPE_NOT_ALLOWED');
  });
});

async function staff(hub: TestHub) {
  await seedDirectory(hub);
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
  return { device, session };
}

function counts(hub: TestHub): { events: number; commands: number } {
  return {
    events: hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
    commands: hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get() as number,
  };
}

function get(hub: TestHub, bound: { device: { token: string }; session: { token: string } }, url: string) {
  return hub.app.inject({
    method: 'GET',
    url,
    headers: {
      authorization: `Bearer ${bound.device.token}`,
      'x-session-token': bound.session.token,
    },
  });
}
