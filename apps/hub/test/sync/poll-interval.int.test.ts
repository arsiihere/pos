import { readFileSync } from 'node:fs';
import { CONFIG_POLL_INTERVAL_MS } from '@pos/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configPoller } from '../../src/sync/config-poller';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub } from '../helpers/test-hub';

const CONFIRMED = { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

describe('hub config poll interval (01b D-11, §4.4 row 14)', () => {
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('[01b #92 hub half] the poller schedules polls with CONFIG_POLL_INTERVAL_MS from @pos/events and declares no interval of its own', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const cloud = stubConfigCloud();
    const h = await createTestHub({ configClient: cloud, config: { provisioned: { ...CONFIRMED } } });
    cleanups.push(() => h.close());
    const poller = configPoller(h.app);
    poller.start();
    cleanups.push(() => poller.stop());

    // A poll at t + interval, none before; the next at t + 2 × interval.
    await vi.advanceTimersByTimeAsync(CONFIG_POLL_INTERVAL_MS - 1);
    expect(cloud.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(cloud.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(CONFIG_POLL_INTERVAL_MS - 1);
    expect(cloud.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cloud.calls).toHaveLength(2);

    // Source check: the poller imports the shared constant, it does not declare its own.
    const source = readFileSync(new URL('../../src/sync/config-poller.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/(const|let|var)\s+\w*INTERVAL\w*\s*=/);
    expect(source).not.toMatch(/\b60_?000\b/);
    expect(source).toMatch(/CONFIG_POLL_INTERVAL_MS/);
  });
});
