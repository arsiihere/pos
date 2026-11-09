import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const hubs: TestHub[] = [];

describe('X-Queued-At and queueable commands (00 v1.8 H-1)', () => {
  afterEach(async () => {
    for (const hub of hubs.splice(0)) await hub.close();
  });

  it('[00 #157] X-Queued-At on a queueable command -> ctx.queuedAt clamped to [started_at - 120000, now]; on a non-queueable command -> ignored', async () => {
    const hub = await createTestHub();
    hubs.push(hub);
    await seedDirectory(hub);
    const device = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
    const startedAt = hub.clock.branchNow();
    hub.clock.advance(600_000);
    const now = hub.clock.branchNow();
    const send = async (type: 'TestQueueable' | 'TestNotQueueable', id: string, queuedAt?: string) => {
      const res = await hub.app.inject({
        method: 'POST',
        url: type === 'TestQueueable' ? '/commands/test-queueable' : '/commands/test-not-queueable',
        headers: {
          authorization: `Bearer ${device.token}`,
          'x-session-token': session.token,
          ...(queuedAt === undefined ? {} : { 'x-queued-at': queuedAt }),
        },
        payload: {
          command_id: id,
          tenant_id: 'tenant-a',
          branch_id: 'branch-1',
          command_type: type,
          payload: {},
          occurred_at: now,
          actor_id: 'S_CASH',
          device_id: device.deviceId,
        },
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { data: { result: { queued_at: number | null } } }).data.result.queued_at;
    };

    expect(await send('TestQueueable', 'c1', String(now - 5_000))).toBe(now - 5_000);
    expect(await send('TestQueueable', 'c2', String(startedAt - 500_000))).toBe(startedAt - 120_000);
    expect(await send('TestQueueable', 'c3', String(now + 900_000))).toBe(now);
    expect(await send('TestQueueable', 'c4')).toBeNull();
    expect(await send('TestQueueable', 'c5', 'not-a-number')).toBeNull();
    expect(await send('TestNotQueueable', 'c6', String(now - 5_000))).toBeNull();
  });
});
