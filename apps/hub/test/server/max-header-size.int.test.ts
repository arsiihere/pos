import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub } from '../helpers/test-hub';

// 02b §6.14 / AD-26: eta-preview drafts ride in the GET query string. inject() bypasses the HTTP
// parser limit, so only a real socket shows maxHeaderSize. /queries/session stands in (eta-preview
// is not registered on this branch); the point is the header limit, not the route.
const cleanups: Array<() => Promise<void>> = [];

function get(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('hub HTTP maxHeaderSize', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[02b §6.14 AD-26] a ~27 KB query string reaches the hub; > 64 KB still gets 431', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    const address = await hub.app.listen({ host: '127.0.0.1', port: 0 });
    const port = Number(new URL(address).port);
    const urdu = encodeURIComponent('نوٹس '.repeat(10)); // URL-encoded Urdu note line
    const big = '/queries/session?draft=' + urdu.repeat(100);
    expect(big.length).toBeGreaterThan(16_384);
    expect(big.length).toBeLessThan(65_536);
    expect(await get(port, big)).not.toBe(431);
    const huge = '/queries/session?draft=' + 'a'.repeat(70_000);
    expect(await get(port, huge)).toBe(431);
  });
});
