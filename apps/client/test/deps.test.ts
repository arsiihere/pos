import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import rootPkg from '../../../package.json';
import clientPkg from '../package.json';
import clientConfig from '../vitest.config';

// W0.7 (owner Q-32, Q-33): the two test dependencies — fake-indexeddb for the queue / draft store tests (25a),
// Playwright for the committed e2e specs, which the gate never runs.

type Pkg = Record<string, Record<string, string> | undefined>;

describe('[02 W0.7] test dependencies', () => {
  it('[02 W0.7] fake-indexeddb opens a database inside a jsdom test', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('w07-probe', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('entries');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction('entries', 'readwrite');
    tx.objectStore('entries').put({ queued_at: 1 }, 'E1');
    await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()));
    const read = await new Promise<unknown>((resolve) => {
      const get = db.transaction('entries').objectStore('entries').get('E1');
      get.onsuccess = () => resolve(get.result);
    });
    expect(read).toEqual({ queued_at: 1 });
    db.close();
  });

  it('[02 W0.7] the gate never runs e2e: vitest excludes apps/client/e2e and the root test script has no playwright', () => {
    expect(clientConfig.test?.exclude).toContain('e2e/**');
    const pkg = rootPkg as unknown as Pkg;
    expect(pkg['scripts']!['test']).not.toMatch(/playwright|e2e/);
    expect(pkg['scripts']!['test:e2e']).toBe('pnpm --filter @pos/client build && pnpm --filter @pos/client exec playwright test');
    // exact pins, devDependencies of the client only (Q-32, Q-33)
    const client = clientPkg as unknown as Pkg;
    expect(client['devDependencies']!['@playwright/test']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(client['devDependencies']!['fake-indexeddb']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(client['dependencies']?.['@playwright/test']).toBeUndefined();
    expect(client['dependencies']?.['fake-indexeddb']).toBeUndefined();
  });
});
