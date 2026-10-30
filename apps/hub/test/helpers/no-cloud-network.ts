import { afterEach } from 'vitest';

// AD-29: no hub test may reach the cloud over the network. Every request to a
// test config's cloud host is recorded and refused as a network failure; the
// test that made it fails in afterEach. Boots pass stubConfigCloud() and stubCloud().
const CLOUD_HOSTS = new Set(['cloud.example']);
const hits: string[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (CLOUD_HOSTS.has(new URL(url).hostname)) {
    hits.push(url);
    throw new TypeError(`fetch failed: hub tests make no cloud request (${url})`);
  }
  return realFetch(input, init);
};

export function takeCloudHits(): string[] {
  return hits.splice(0);
}

afterEach(() => {
  const made = takeCloudHits();
  if (made.length > 0) throw new Error(`hub test reached the cloud: ${made.join(', ')}`);
});
