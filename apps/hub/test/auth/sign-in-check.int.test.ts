import { verify } from '@node-rs/argon2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PIN } from '../helpers/fixtures';
import { ALI, BILAL, directoryWith, withProfile } from '../helpers/device-access';
import { createTestHub, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 05a plan task 17: the §3.5 sign-in check of the REAL `POST /auth/pin` and `POST /admin/auth` (§6.5), tests #3 (PIN
// half), #4e, #26 and RF-1 (sign-in half, v1.0.1 R-1 / D-6). Ali = Manager (PIN.b), Bilal = Cashier (PIN.c).

vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...actual, verify: vi.fn((hash: string, pin: string) => actual.verify(hash, pin)) };
});
const verifySpy = vi.mocked(verify);

const CASH = 'S_CASH'; // aDirectory's Cashier, PIN.c: on no list below

describe('[05a §3.5] sign-in check on /auth/pin and /admin/auth', () => {
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => {
    verifySpy.mockClear();
  });
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function hub(): Promise<TestHub> {
    const h = await createTestHub();
    cleanups.push(() => h.close());
    await seedDirectory(h, await directoryWith());
    return h;
  }

  it('[05a #3] Bilal\'s correct PIN on Ali\'s listed phone → 403 DEVICE_ACCESS_DENIED; argon2 not called; no counter changed', async () => {
    const h = await hub();
    const phone = pairDevice(h, { type: 'phone', ownerStaffId: ALI, profile: { access: 'listed', staff_ids: [ALI], screens: ['dine_in', 'manager'] } });
    const before = lockouts(h);
    const refused = await pin(h, phone.token, BILAL, PIN.c);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatchObject({ code: 'DEVICE_ACCESS_DENIED', details: { device_id: phone.deviceId } });
    expect(verifySpy).not.toHaveBeenCalled();
    expect(lockouts(h)).toEqual(before);
    expect(staffSessions(h, phone.deviceId)).toEqual([]);

    const ali = await pin(h, phone.token, ALI, PIN.b);
    expect(ali.statusCode).toBe(200);
    // §6.5: the device block, as /queries/session reads it (§6.7)
    expect(ali.json().data).toMatchObject({ staff_id: ALI, device: { screens: ['dine_in', 'manager'], access: 'listed', point_id: null } });
    expect(ali.json().data.device).toEqual({ screens: ['dine_in', 'manager'], access: 'listed', point_id: null });
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it('[05a §6.5] /auth/pin on an everyone kiosk accepts any directory staff and returns the device block', async () => {
    const h = await hub();
    const kiosk = pairDevice(h, { type: 'cashier_kiosk', profile: { access: 'everyone', screens: ['takeaway', 'cashier'], point_id: null } });
    const res = await pin(h, kiosk.token, CASH, PIN.c);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.device).toEqual({ screens: ['takeaway', 'cashier'], access: 'everyone', point_id: null });
  });

  it('[05a #4e] /admin/auth on an everyone device → 403 listed_device_only, no PIN verified, no counter', async () => {
    const h = await hub();
    const tablet = pairDevice(h, { type: 'tablet', profile: { access: 'everyone', screens: ['dine_in'] } });
    const before = lockouts(h);
    for (const pinValue of [PIN.b, '0000']) {
      const res = await adminLogin(h, tablet.token, ALI, pinValue);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'access-hub-admin', reason: 'listed_device_only' } });
    }
    expect(verifySpy).not.toHaveBeenCalled();
    expect(lockouts(h)).toEqual(before);
    expect(adminSessions(h, tablet.deviceId)).toEqual([]);
  });

  it('[05a §3.5] /admin/auth on a listed device: an unlisted admin → 403 DEVICE_ACCESS_DENIED before argon2; a listed admin signs in', async () => {
    const h = await hub();
    const tablet = pairDevice(h, { type: 'tablet', profile: { access: 'listed', staff_ids: [ALI], screens: ['dine_in'] } });
    const before = lockouts(h);
    const owner = await adminLogin(h, tablet.token, 'S_OWNER', PIN.a);
    expect(owner.statusCode).toBe(403);
    expect(owner.json().error).toMatchObject({ code: 'DEVICE_ACCESS_DENIED', details: { device_id: tablet.deviceId } });
    expect(verifySpy).not.toHaveBeenCalled();
    expect(lockouts(h)).toEqual(before);

    const ali = await adminLogin(h, tablet.token, ALI, PIN.b);
    expect(ali.statusCode).toBe(200);
    expect(ali.json().data.staff_id).toBe(ALI);
  });

  it('[05a #26] takeover between two listed people works; an unlisted person gets 403 DEVICE_ACCESS_DENIED before any takeover', async () => {
    const h = await hub();
    const tablet = pairDevice(h, { type: 'tablet', profile: { access: 'listed', staff_ids: [ALI, BILAL], screens: ['dine_in'] } });
    const ali = await pin(h, tablet.token, ALI, PIN.b);
    expect(ali.statusCode).toBe(200);
    const aliSession = ali.json().data.session_id as string;

    verifySpy.mockClear();
    const before = lockouts(h);
    const cash = await pin(h, tablet.token, CASH, PIN.c, { takeover: true });
    expect(cash.statusCode).toBe(403);
    expect(cash.json().error).toMatchObject({ code: 'DEVICE_ACCESS_DENIED', details: { device_id: tablet.deviceId } });
    expect(verifySpy).not.toHaveBeenCalled();
    expect(lockouts(h)).toEqual(before);
    expect(staffSessions(h, tablet.deviceId)).toEqual([aliSession]);

    const asks = await pin(h, tablet.token, BILAL, PIN.c);
    expect(asks.statusCode).toBe(409);
    expect(asks.json().error).toMatchObject({ code: 'DEVICE_SESSION_ACTIVE', details: { staff_id: ALI, can_take_over: true } });
    const takes = await pin(h, tablet.token, BILAL, PIN.c, { takeover: true });
    expect(takes.statusCode).toBe(200);
    expect(endReason(h, aliSession)).toBe('taken_over');
    expect(staffSessions(h, tablet.deviceId)).toEqual([takes.json().data.session_id]);
  });

  it('[05a #26] takeover on an everyone device works for any directory staff', async () => {
    const h = await hub();
    const kiosk = pairDevice(h, { type: 'cashier_kiosk', profile: { access: 'everyone', screens: ['takeaway', 'cashier'] } });
    const bilal = await pin(h, kiosk.token, BILAL, PIN.c);
    const cash = await pin(h, kiosk.token, CASH, PIN.c, { takeover: true });
    expect(cash.statusCode).toBe(200);
    expect(endReason(h, bilal.json().data.session_id as string)).toBe('taken_over');
  });

  describe('[05a RF-1] a staff device with no profile keeps today\'s sign-in rule (v1.0.1 R-1, D-6)', () => {
    it('[05a RF-1] a phone owned by Ali accepts Ali and refuses Bilal\'s correct PIN with 403 DEVICE_ACCESS_DENIED (no argon2, nothing counted)', async () => {
      const h = await hub();
      const phone = pairDevice(h, { type: 'phone', ownerStaffId: ALI });
      const before = lockouts(h);
      const bilal = await pin(h, phone.token, BILAL, PIN.c);
      expect(bilal.statusCode).toBe(403);
      expect(bilal.json().error).toMatchObject({ code: 'DEVICE_ACCESS_DENIED', details: { device_id: phone.deviceId } });
      expect(verifySpy).not.toHaveBeenCalled();
      expect(lockouts(h)).toEqual(before);

      const ali = await pin(h, phone.token, ALI, PIN.b);
      expect(ali.statusCode).toBe(200);
      // §6.7 reading of no profile: `everyone`, no screens
      expect(ali.json().data.device).toEqual({ screens: [], access: 'everyone', point_id: null });
    });

    it('[05a RF-1] a phone with no profile and a null owner refuses every PIN', async () => {
      const h = await hub();
      const phone = pairDevice(h, { type: 'phone' });
      const before = lockouts(h);
      for (const [staffId, pinValue] of [[ALI, PIN.b], [BILAL, PIN.c], ['S_OWNER', PIN.a], [ALI, '0000']] as const) {
        const res = await pin(h, phone.token, staffId, pinValue);
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toMatchObject({ code: 'DEVICE_ACCESS_DENIED', details: { device_id: phone.deviceId } });
      }
      expect(verifySpy).not.toHaveBeenCalled();
      expect(lockouts(h)).toEqual(before);
      expect(staffSessions(h, phone.deviceId)).toEqual([]);
    });

    it('[05a RF-1] a tablet and a cashier_kiosk with no profile accept any directory staff', async () => {
      const h = await hub();
      for (const type of ['tablet', 'cashier_kiosk'] as const) {
        const device = pairDevice(h, { type });
        const ali = await pin(h, device.token, ALI, PIN.b);
        expect(ali.statusCode).toBe(200);
        const bilal = await pin(h, device.token, BILAL, PIN.c, { takeover: true });
        expect(bilal.statusCode).toBe(200);
        const cash = await pin(h, device.token, CASH, PIN.c, { takeover: true });
        expect(cash.statusCode).toBe(200);
        expect(cash.json().data.device).toEqual({ screens: [], access: 'everyone', point_id: null });
      }
    });

    it('[05a RF-1] /admin/auth on any no-profile device → 403 listed_device_only (mask half), no PIN verified', async () => {
      const h = await hub();
      const devices = [
        pairDevice(h, { type: 'phone', ownerStaffId: ALI }),
        pairDevice(h, { type: 'phone' }),
        pairDevice(h, { type: 'tablet' }),
        pairDevice(h, { type: 'cashier_kiosk' }),
      ];
      const before = lockouts(h);
      for (const device of devices) {
        const res = await adminLogin(h, device.token, ALI, PIN.b);
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'access-hub-admin', reason: 'listed_device_only' } });
        expect(adminSessions(h, device.deviceId)).toEqual([]);
      }
      expect(verifySpy).not.toHaveBeenCalled();
      expect(lockouts(h)).toEqual(before);
    });
  });

  describe('[05a §3.3a] the PIN hook resolves through the session view', () => {
    it('[05a §3.3a] /admin/auth: the device switched to everyone while argon2 ran → the view masks access-hub-admin (403 listed_device_only), no admin session', async () => {
      const h = await hub();
      const tablet = pairDevice(h, { type: 'tablet', profile: { access: 'listed', staff_ids: [ALI], screens: ['dine_in'] } });
      const actual = await vi.importActual<typeof import('@node-rs/argon2')>('@node-rs/argon2');
      verifySpy.mockImplementationOnce((hash, pinValue) => {
        withProfile(h, tablet.deviceId, { access: 'everyone', screens: ['dine_in'] });
        return actual.verify(hash, pinValue);
      });
      const res = await adminLogin(h, tablet.token, ALI, PIN.b);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'access-hub-admin', reason: 'listed_device_only' } });
      expect(adminSessions(h, tablet.deviceId)).toEqual([]);
    });

    it('[05a §3.5] /auth/pin: the person taken off the list while argon2 ran → 403 DEVICE_ACCESS_DENIED, no session', async () => {
      const h = await hub();
      const tablet = pairDevice(h, { type: 'tablet', profile: { access: 'listed', staff_ids: [ALI, BILAL], screens: ['dine_in'] } });
      const actual = await vi.importActual<typeof import('@node-rs/argon2')>('@node-rs/argon2');
      verifySpy.mockImplementationOnce((hash, pinValue) => {
        withProfile(h, tablet.deviceId, { access: 'listed', staff_ids: [ALI], screens: ['dine_in'] });
        return actual.verify(hash, pinValue);
      });
      const res = await pin(h, tablet.token, BILAL, PIN.c);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatchObject({ code: 'DEVICE_ACCESS_DENIED', details: { device_id: tablet.deviceId } });
      expect(staffSessions(h, tablet.deviceId)).toEqual([]);
    });
  });
});

function pin(h: TestHub, token: string, staffId: string, pinValue: string, extra: { takeover?: boolean } = {}) {
  return h.app.inject({ method: 'POST', url: '/auth/pin', headers: { authorization: `Bearer ${token}` }, payload: { staff_id: staffId, pin: pinValue, ...extra } });
}

function adminLogin(h: TestHub, token: string, staffId: string, pinValue: string) {
  return h.app.inject({ method: 'POST', url: '/admin/auth', headers: { authorization: `Bearer ${token}` }, payload: { staff_id: staffId, pin: pinValue } });
}

function lockouts(h: TestHub): unknown[] {
  return h.deps.db.prepare('SELECT subject_type, subject_id, failed_count, window_started_at, locked_until FROM auth_lockouts ORDER BY subject_type, subject_id').all();
}

function staffSessions(h: TestHub, deviceId: string): string[] {
  return (
    h.deps.db.prepare("SELECT session_id FROM staff_sessions WHERE device_id = ? AND kind = 'staff' AND ended_at IS NULL").all(deviceId) as Array<{ session_id: string }>
  ).map((row) => row.session_id);
}

function adminSessions(h: TestHub, deviceId: string): string[] {
  return (
    h.deps.db.prepare("SELECT session_id FROM staff_sessions WHERE device_id = ? AND kind = 'admin'").all(deviceId) as Array<{ session_id: string }>
  ).map((row) => row.session_id);
}

function endReason(h: TestHub, sessionId: string): string | null {
  return (h.deps.db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').get(sessionId) as { end_reason: string | null }).end_reason;
}
