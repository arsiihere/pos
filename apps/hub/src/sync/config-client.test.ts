/// <reference types="node" />
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpConfigClient } from './config-client';

const realFetch = globalThis.fetch;
const QUERY = { config_version: 4, directory_version: 9 };

describe('httpConfigClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('[01a §3.4] 304 → not_modified; 200 → ok with the exact body text; 503 and a thrown fetch → offline; 401 → error with code', async () => {
    const client = httpConfigClient('https://cloud.example/v1/', 'key-1');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    expect(await client.fetchConfig(QUERY)).toEqual({ kind: 'not_modified' });
    const text = '{"data":{"config":null,"directory":null}}  ';
    fetchMock.mockResolvedValueOnce(new Response(text, { status: 200 }));
    expect(await client.fetchConfig(QUERY)).toEqual({ kind: 'ok', text });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    expect(await client.fetchConfig(QUERY)).toEqual({ kind: 'offline' });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await client.fetchConfig(QUERY)).toEqual({ kind: 'offline' });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'no', details: { reason: 'bad_key' }, request_id: 'r' } }),
        { status: 401 },
      ),
    );
    expect(await client.fetchConfig(QUERY)).toEqual({
      kind: 'error',
      status: 401,
      code: 'UNAUTHENTICATED',
      details: { reason: 'bad_key' },
    });
  });

  it('[01a §3.4, S48] the request carries exactly config_version and directory_version, Accept-Encoding gzip, and a 30 000 ms timeout by default', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(new Response(null, { status: 304 }));
    await httpConfigClient('https://cloud.example', 'key-1').fetchConfig(QUERY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://cloud.example/v1/sync/config');
    expect([...parsed.searchParams.entries()]).toEqual([
      ['config_version', '4'],
      ['directory_version', '9'],
    ]);
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer key-1');
    expect(headers.get('accept-encoding')).toBe('gzip');
    expect(init.method ?? 'GET').toBe('GET');
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    await httpConfigClient('https://cloud.example', 'key-1', 5_000).fetchConfig(QUERY);
    expect(timeout).toHaveBeenLastCalledWith(5_000);
  });

  it('[01a S48] a real gzip response from a local node:http server decodes to the original text', async () => {
    globalThis.fetch = realFetch;
    const text = JSON.stringify({ data: { config: null, directory: null }, pad: 'x'.repeat(5_000) });
    const seen: Array<string | undefined> = [];
    const server: Server = createServer((request, response) => {
      seen.push(request.headers['accept-encoding']);
      response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      response.end(gzipSync(text));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const result = await httpConfigClient(`http://127.0.0.1:${port}`, 'key-1').fetchConfig(QUERY);
      expect(result).toEqual({ kind: 'ok', text });
      expect(seen).toEqual(['gzip']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
