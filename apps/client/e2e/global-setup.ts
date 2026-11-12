import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aBranchConfig } from '@pos/events/testing';
import { swapBranchConfig } from '../../hub/src/sync/branch-config-holder';
import { createTestHub, pairDevice, seedDirectory } from '../../hub/test/helpers/test-hub';

// W0.7 (Q-32): one hub for the whole run — a provisioned test hub (in-memory clock, SQLite under TMPDIR), the
// fixture staff directory and branch config, one paired tablet; it serves the built /staff/ (run the client
// build first: `pnpm test:e2e` does). The specs read where it listens from POS_E2E_HUB (a JSON file).

export interface E2eHub {
  baseURL: string;
  device: { token: string; device_id: string; device_type: 'tablet' };
}

/** A free local port: the hub checks Host = advertised_host:http_port (00 host guard), so it is fixed before boot. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const port = await freePort();
  const hub = await createTestHub({ config: { advertised_host: '127.0.0.1', http_port: port } });
  await seedDirectory(hub);
  swapBranchConfig({ config: aBranchConfig(), snapshotHash: 'e'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
  const tablet = pairDevice(hub, { type: 'tablet', name: 'Tablet e2e' });
  await hub.app.listen({ host: '127.0.0.1', port });
  const info: E2eHub = { baseURL: `http://127.0.0.1:${port}`, device: { token: tablet.token, device_id: tablet.deviceId, device_type: 'tablet' } };
  const file = join(tmpdir(), `pos-e2e-hub-${process.pid}.json`);
  writeFileSync(file, JSON.stringify(info));
  process.env['POS_E2E_HUB'] = file;
  return async () => {
    await hub.close();
  };
}
