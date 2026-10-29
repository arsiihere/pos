import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpCloudClient } from './cloud-client';

describe('httpCloudClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('[00 §6.4] a cloud_base_url that already ends in /v1 calls /v1/hubs/register and /v1/hubs/confirm once', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    });
    const prefixed = httpCloudClient('https://api.example-pos.app/v1/');
    await prefixed.registerHub(
      { registration_code: 'code', hub_version: '0.0.0', accepted_kinds: ['new_branch'] },
      'idem',
    );
    await prefixed.confirmHub('branch-api-key', { hub_version: '0.0.0' });
    const bare = httpCloudClient('https://api.example-pos.app');
    await bare.registerHub(
      { registration_code: 'code', hub_version: '0.0.0', accepted_kinds: ['new_branch'] },
      'idem',
    );
    expect(urls).toEqual([
      'https://api.example-pos.app/v1/hubs/register',
      'https://api.example-pos.app/v1/hubs/confirm',
      'https://api.example-pos.app/v1/hubs/register',
    ]);
  });
});
