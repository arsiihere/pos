import { describe, expect, it, vi } from 'vitest';
import { deviceContextOf, MIN_NATIVE_API, nativeBridge, needsAppUpdate, readStaffBuild, revokeNotice, staffBuildAction } from './bridge';

// 05b §4.2: the page's PosNative bridge; tests 2 and 3 (pure decisions).

describe('[05b §4.2] nativeBridge', () => {
  it('no Capacitor / no PosNative → null (today\'s behaviour)', () => {
    expect(nativeBridge({})).toBeNull();
    expect(nativeBridge({ Capacitor: {} })).toBeNull();
    expect(nativeBridge({ Capacitor: { Plugins: {} } })).toBeNull();
    expect(nativeBridge(undefined)).toBeNull();
  });

  it('every call is feature-checked and never throws: missing methods, rejections and throws answer null', async () => {
    const plugin = {
      info: vi.fn(async () => ({ native_api: 1, version_code: 3, version_name: '1.0.3', device_owner: false })),
      confirmRevoked: vi.fn(async () => {
        throw new Error('NOT_ALLOWED_HERE');
      }),
      setSession: vi.fn(() => {
        throw new Error('sync throw');
      }),
    };
    const b = nativeBridge({ Capacitor: { Plugins: { PosNative: plugin } } })!;
    expect(await b.info()).toMatchObject({ native_api: 1 });
    expect(await b.confirmRevoked()).toBeNull();
    await expect(b.setSession({ signed_in: true, staff_id: 'S1' })).resolves.toBeUndefined();
    expect(plugin.setSession).toHaveBeenCalledWith({ signed_in: true, staff_id: 'S1' });
    expect(await b.health()).toBeNull();
    await expect(b.reportShown({ alert_id: 'A', step: 0 })).resolves.toBeUndefined();
    expect(b.onState(() => {})).toBeTypeOf('function');
  });

  it('onState: the listener gets state bodies; remove() calls the handle (promise or object)', async () => {
    let fire: (s: unknown) => void = () => {};
    const remove = vi.fn();
    const plugin = {
      addListener: vi.fn(async (_name: string, fn: (s: unknown) => void) => {
        fire = fn;
        return { remove };
      }),
    };
    const b = nativeBridge({ Capacitor: { Plugins: { PosNative: plugin } } })!;
    const got: unknown[] = [];
    const off = b.onState((s) => got.push(s));
    await Promise.resolve();
    expect(plugin.addListener.mock.calls[0]![0]).toBe('state');
    fire({ paired: true, alert_socket: 'up', binding_route_until: null, update_ready: false });
    fire(null);
    expect(got).toHaveLength(1);
    off();
    await Promise.resolve();
    expect(remove).toHaveBeenCalled();
    fire({ paired: false });
    expect(got).toHaveLength(1);
  });
});

describe('[05b test 2, M-13, O-17] staff-build decision', () => {
  const base = { native: true, pageBuild: 'aaa', hubBuild: 'bbb' };
  it('differs + signed out → reload', () => expect(staffBuildAction({ ...base, signedIn: false })).toBe('reload'));
  it('differs + signed in → banner (reload at sign-out)', () => expect(staffBuildAction({ ...base, signedIn: true })).toBe('banner'));
  it('same → nothing', () => expect(staffBuildAction({ ...base, hubBuild: 'aaa', signedIn: false })).toBe('none'));
  it('no PosNative → nothing (kiosks, phones, KDS)', () => expect(staffBuildAction({ ...base, native: false, signedIn: false })).toBe('none'));
  it('null or absent on either side → nothing', () => {
    expect(staffBuildAction({ ...base, pageBuild: null, signedIn: false })).toBe('none');
    expect(staffBuildAction({ ...base, hubBuild: undefined, signedIn: false })).toBe('none');
    expect(staffBuildAction({ ...base, hubBuild: '', signedIn: true })).toBe('none');
  });
  it('reads the pos-staff-build meta', () => {
    const doc = document.implementation.createHTMLDocument('x');
    expect(readStaffBuild(doc)).toBeNull();
    const meta = doc.createElement('meta');
    meta.name = 'pos-staff-build';
    meta.content = 'abc123';
    doc.head.appendChild(meta);
    expect(readStaffBuild(doc)).toBe('abc123');
  });
});

describe('[05b test 3, M-14] native / web compatibility', () => {
  it('MIN_NATIVE_API is 1', () => expect(MIN_NATIVE_API).toBe(1));
  it('below the minimum → "Update the app"; at or above → nothing; unknown → nothing', () => {
    expect(needsAppUpdate({ native_api: 0 })).toBe(true);
    expect(needsAppUpdate({ native_api: 1 })).toBe(false);
    expect(needsAppUpdate({ native_api: 2 })).toBe(false);
    expect(needsAppUpdate({ native_api: 1 }, 2)).toBe(true);
    expect(needsAppUpdate(null)).toBe(false);
    expect(needsAppUpdate({ native_api: Number.NaN })).toBe(false);
  });
});

describe('[05b §3.5, M-21] notice and context helpers', () => {
  it('00 §8.4 texts by reason; a hub that answered → no notice', () => {
    expect(revokeNotice('GUEST_NETWORK_FORBIDDEN')).toBe('native.notice.staff_wifi');
    expect(revokeNotice('HOST_NOT_ALLOWED')).toBe('native.notice.hub_address');
    expect(revokeNotice('UNREACHABLE')).toBe('native.notice.unreachable');
    expect(revokeNotice('no_answer')).toBe('native.notice.unreachable');
    expect(revokeNotice(null)).toBe('native.notice.unreachable');
    expect(revokeNotice('200')).toBeNull();
    // review B-client #1: native holds no token (after the one offer) → the page cannot confirm the tablet
    expect(revokeNotice('NO_NATIVE_TOKEN')).toBe('native.notice.cannot_confirm');
  });
  it('always_on = a point is set; lock_task = audience everyone', () => {
    expect(deviceContextOf({ access: 'everyone', point_id: 'PT-1' }, 'ur')).toEqual({ always_on: true, language: 'ur', lock_task: true });
    expect(deviceContextOf({ access: 'listed', point_id: null }, 'en')).toEqual({ always_on: false, language: 'en', lock_task: false });
  });
});
