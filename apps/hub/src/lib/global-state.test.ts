import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { globalStateClient, globalStateFor, reconnectDelayMs, type GlobalCtx, type GlobalSignal } from './global-state';
import { EN } from './strings';

const CTX: GlobalCtx = { loaded: true, device: 'screen', app: false, authed: true, tokenRotated: false, busyRetried: false };

function err(code: string, details?: Record<string, unknown>): GlobalSignal {
  return { kind: 'error', code, details };
}

describe('global states 00-F01…F08', () => {
  it('[00 §8.4 F01] network failure and WS 1012: banner when something is on screen, full screen when nothing loaded', () => {
    expect(globalStateFor({ kind: 'network' }, CTX)).toEqual({ id: 'F01', mode: 'banner' });
    expect(globalStateFor({ kind: 'close', code: 1012 }, CTX)).toEqual({ id: 'F01', mode: 'banner' });
    expect(globalStateFor({ kind: 'network' }, { ...CTX, loaded: false })).toEqual({ id: 'F01', mode: 'screen' });
  });

  it('[00 §8.4 F01] reconnect backoff is 0.5 s doubling to a 5 s ceiling', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(reconnectDelayMs)).toEqual([500, 1000, 2000, 4000, 5000, 5000, 5000]);
  });

  it('[00 §8.4 F02] DEVICE_TOKEN_INVALID, DEVICE_REVOKED and WS 4403 after auth → pair again; phone variant on phones', () => {
    for (const signal of [err('DEVICE_TOKEN_INVALID'), err('DEVICE_REVOKED'), { kind: 'close', code: 4403 } as const]) {
      expect(globalStateFor(signal, CTX)).toEqual({ id: 'F02', mode: 'screen', variant: 'screen' });
    }
    expect(globalStateFor(err('DEVICE_REVOKED'), { ...CTX, device: 'phone' })).toEqual({ id: 'F02', mode: 'screen', variant: 'phone' });
  });

  it('[00 §8.4 F03] GUEST_NETWORK_FORBIDDEN and WS 4403 before auth → staff Wi-Fi, with the name only when the hub sends one (Q6)', () => {
    expect(globalStateFor(err('GUEST_NETWORK_FORBIDDEN', { staff_wifi_name: ' AC-Staff ' }), CTX)).toEqual({ id: 'F03', mode: 'screen', ssid: 'AC-Staff' });
    expect(globalStateFor(err('GUEST_NETWORK_FORBIDDEN'), CTX)).toEqual({ id: 'F03', mode: 'screen', ssid: null });
    expect(globalStateFor(err('GUEST_NETWORK_FORBIDDEN', { staff_wifi_name: '' }), CTX)).toEqual({ id: 'F03', mode: 'screen', ssid: null });
    expect(globalStateFor({ kind: 'close', code: 4403 }, { ...CTX, authed: false })).toEqual({ id: 'F03', mode: 'screen', ssid: null });
  });

  it('[00 §8.4 F04] CLIENT_UPGRADE_REQUIRED and WS 4426 → update; app and browser variants', () => {
    expect(globalStateFor(err('CLIENT_UPGRADE_REQUIRED'), CTX)).toEqual({ id: 'F04', mode: 'screen', variant: 'browser' });
    expect(globalStateFor({ kind: 'close', code: 4426 }, { ...CTX, app: true })).toEqual({ id: 'F04', mode: 'screen', variant: 'app' });
  });

  it('[00 §8.4 F05] SERVICE_UNAVAILABLE retries once silently after retry_after_ms (capped at 5 s), then shows the busy banner', () => {
    expect(globalStateFor(err('SERVICE_UNAVAILABLE', { retry_after_ms: 1500 }), CTX)).toEqual({ id: 'F05', mode: 'retry', retryAfterMs: 1500 });
    expect(globalStateFor(err('SERVICE_UNAVAILABLE', { retry_after_ms: 60000 }), CTX)).toEqual({ id: 'F05', mode: 'retry', retryAfterMs: 5000 });
    expect(globalStateFor(err('SERVICE_UNAVAILABLE'), CTX)).toEqual({ id: 'F05', mode: 'retry', retryAfterMs: 1000 });
    expect(globalStateFor(err('SERVICE_UNAVAILABLE'), { ...CTX, busyRetried: true })).toEqual({ id: 'F05', mode: 'banner' });
  });

  it('[00 §8.4 F06, F07] HUB_NOT_PROVISIONED → being set up; HOST_NOT_ALLOWED → open by address, address only if the error carries it', () => {
    expect(globalStateFor(err('HUB_NOT_PROVISIONED'), CTX)).toEqual({ id: 'F06', mode: 'screen' });
    expect(globalStateFor(err('HOST_NOT_ALLOWED'), CTX)).toEqual({ id: 'F07', mode: 'screen', address: null });
    expect(globalStateFor(err('HOST_NOT_ALLOWED', { advertised_host: '192.168.0.107:3000' }), CTX)).toEqual({
      id: 'F07',
      mode: 'screen',
      address: '192.168.0.107:3000',
    });
  });

  it('[00 §8.4 F08] WS 4401 is F08 only after DeviceTokenRotated; plain 4401 and KDS "replaced" stay with the page', () => {
    expect(globalStateFor({ kind: 'close', code: 4401 }, { ...CTX, tokenRotated: true })).toEqual({ id: 'F08', mode: 'screen' });
    expect(globalStateFor({ kind: 'close', code: 4401 }, CTX)).toBeNull();
    expect(globalStateFor({ kind: 'close', code: 4401, reason: 'replaced' }, { ...CTX, tokenRotated: true })).toBeNull();
  });

  it('[00 §8.4] codes that are not global states return null', () => {
    for (const code of ['PIN_INVALID', 'SESSION_EXPIRED', 'PAIRING_REQUEST_NOT_FOUND', 'VALIDATION_FAILED']) {
      expect(globalStateFor(err(code), CTX)).toBeNull();
    }
    expect(globalStateFor({ kind: 'close', code: 1000 }, CTX)).toBeNull();
  });

  it('[00 §8.2] the page-script copy maps exactly like the module and looks up only keys that exist in EN', () => {
    const client = globalStateClient();
    const cases: Array<[GlobalSignal, GlobalCtx]> = [
      [{ kind: 'network' }, { ...CTX, loaded: false }],
      [{ kind: 'close', code: 4403 }, { ...CTX, authed: false }],
      [err('DEVICE_REVOKED'), { ...CTX, device: 'phone' }],
      [err('GUEST_NETWORK_FORBIDDEN', { staff_wifi_name: 'AC-Staff' }), CTX],
      [err('SERVICE_UNAVAILABLE', { retry_after_ms: 1500 }), CTX],
      [{ kind: 'close', code: 4401 }, { ...CTX, tokenRotated: true }],
    ];
    for (const [signal, ctx] of cases) {
      const fromPage: unknown = runInNewContext(`${client}\nglobalStateFor(signal, ctx)`, { signal, ctx, scriptJson: undefined });
      expect(JSON.parse(JSON.stringify(fromPage))).toEqual(globalStateFor(signal, ctx));
    }
    const keys = [...client.matchAll(/'(global\.[a-z_]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) expect(EN, key).toHaveProperty([key]);
  });
});
