import type { DirectoryInput } from '@pos/events';
import { canonicalJson, sha256hex } from '../../src/lib/hash';
import type { ConfigClient, ConfigFetch, ConfigQuery } from '../../src/sync/config-client';

export interface StubConfigCloud extends ConfigClient {
  calls: ConfigQuery[];
  // A value answers every call; a function answers per call (e.g. a held promise for concurrency tests).
  next: ConfigFetch | ((q: ConfigQuery) => Promise<ConfigFetch>);
  respondWithSnapshot(
    snapshot: Record<string, unknown>,
    o?: { directory?: DirectoryInput | null; snapshotHash?: string },
  ): void;
}

export function stubConfigCloud(): StubConfigCloud {
  const stub: StubConfigCloud = {
    calls: [],
    next: { kind: 'offline' },
    async fetchConfig(q) {
      stub.calls.push(q);
      return typeof stub.next === 'function' ? stub.next(q) : stub.next;
    },
    respondWithSnapshot(snapshot, o) {
      const text = JSON.stringify({
        data: {
          config: { snapshot_hash: o?.snapshotHash ?? sha256hex(canonicalJson(snapshot)), snapshot },
          directory: o?.directory ?? null,
        },
      });
      stub.next = { kind: 'ok', text };
    },
  };
  return stub;
}
