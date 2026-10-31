import { describe, expect, it } from 'vitest';
import { takeCloudHits } from './helpers/no-cloud-network';

describe('no cloud network in hub tests', () => {
  it('[01c AD-29] a request to the test cloud host is refused and recorded', async () => {
    await expect(fetch('https://cloud.example/v1/sync/config')).rejects.toThrow(TypeError);
    expect(takeCloudHits()).toEqual(['https://cloud.example/v1/sync/config']);
  });
});
