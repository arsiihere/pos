import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDeviceKey } from '../../api/hub-admin';
import { reply } from '../../../test/dom';
import { readKdsPage, startStationSession } from './session';

// 03b v1.0.8 §8 (Q-42), 00 v1.9.2 §6.11, §8.2, §8.4 (K1): /kds/ owns the station session. It reads the device token of
// the pairing store, calls POST /auth/station itself and keeps the session token in memory only.

function putDeviceKeys(keys: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pos-device', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('device');
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('device', 'readwrite');
      for (const [k, v] of Object.entries(keys)) tx.objectStore('device').put(v, k);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

function storeKeys(): Promise<string[]> {
  return new Promise((resolve) => {
    const request = indexedDB.open('pos-device', 1);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('device').objectStore('device').getAllKeys();
      read.onsuccess = () => {
        db.close();
        resolve((read.result as string[]).sort());
      };
    };
  });
}

afterEach(() => {
  indexedDB.deleteDatabase('pos-device');
  document.head.innerHTML = '';
});

describe('[03b §8 Q-42] station session', () => {
  it('[03b §8 Q-42] /kds/ calls POST /auth/station with the stored device token; session token kept in memory only', async () => {
    await putDeviceKeys({ token: 'DEV-KDS', device_id: 'D-K1', device_type: 'kds' });
    const fetch = vi.fn(async () => reply(200, { data: { session_token: 'STATION-SESS', session_id: 'SS1', station_id: 'ST-TANDOOR' } }));
    const token = await readDeviceKey('token');
    const result = await startStationSession({ fetch, deviceToken: token! });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/auth/station');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer DEV-KDS');
    expect(result).toEqual({ kind: 'ok', session: { session_token: 'STATION-SESS', session_id: 'SS1', station_id: 'ST-TANDOOR' } });
    // memory only: nothing written to the pairing store, localStorage or sessionStorage
    expect(await storeKeys()).toEqual(['device_id', 'device_type', 'token']);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('[00 §8.4] the reply decides: 401 DEVICE_TOKEN_INVALID / 403 DEVICE_REVOKED unpair, 403 DEVICE_TYPE_NOT_ALLOWED is not a kitchen screen, no reply is a network failure', async () => {
    const answer = (r: () => Promise<Response>) => startStationSession({ fetch: r, deviceToken: 'T' });
    expect(await answer(async () => reply(401, { error: { code: 'DEVICE_TOKEN_INVALID', message: 'x' } }))).toEqual({ kind: 'unpaired' });
    expect(await answer(async () => reply(403, { error: { code: 'DEVICE_REVOKED', message: 'x' } }))).toEqual({ kind: 'unpaired' });
    expect(await answer(async () => reply(403, { error: { code: 'DEVICE_TYPE_NOT_ALLOWED', message: 'x', details: { device_type: 'tablet' } } }))).toEqual({ kind: 'not_kds' });
    expect(await answer(async () => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ kind: 'network' });
    expect(await answer(async () => reply(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'x', details: { retry_after_ms: 1500 } } }))).toEqual({
      kind: 'error',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      details: { retry_after_ms: 1500 },
    });
    // a 200 without a usable body is not a session
    expect(await answer(async () => reply(200, { data: { session_token: 5 } }))).toEqual({ kind: 'error', status: 200, code: 'INTERNAL_ERROR', details: {} });
  });

  it('[03b §8] page meta gives tenant / branch ids and the hub clock', () => {
    document.head.innerHTML = [
      '<meta name="pos-tenant-id" content="TEN-1">',
      '<meta name="pos-branch-id" content="BR-1">',
      '<meta name="pos-branch-name" content="Gulberg">',
      '<meta name="pos-hub-now-ms" content="1763000000000">',
      '<meta name="pos-hub-utc-offset-ms" content="18000000">',
    ].join('');
    let perf = 100;
    const page = readKdsPage(document, () => perf);
    expect(page?.meta).toMatchObject({ tenantId: 'TEN-1', branchId: 'BR-1', branchName: 'Gulberg' });
    expect(page?.clock.utcOffsetMs).toBe(18_000_000);
    perf = 2_100;
    expect(page?.clock.nowMs()).toBe(1_763_000_002_000);
    document.head.innerHTML = '';
    expect(readKdsPage(document)).toBeNull();
  });
});
