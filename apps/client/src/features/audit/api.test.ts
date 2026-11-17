import { describe, expect, it, vi } from 'vitest';
import { reply } from '../../../test/dom';
import { createStaffApi } from '../staff/api';
import { auditLogPath } from './api';
import { ROWS } from './test-fixtures';

// 04 v1.0.4 §6.5 / §6.5b client (VU2a): the query string the hub's Zod accepts; the staff api's auditLog / auditStaff
// (as inbox()): the device token and the session, the whole body checked, data and meta.next_cursor kept.

const META = { tenantId: 'T', branchId: 'B', branchName: 'Gulberg', hubNowMs: 0, utcOffsetMs: 0 };
const Q = { from: 1, to: 2, staff_id: null, actions: [] };

async function signedIn(fetch: (u: string, i?: RequestInit) => Promise<Response>, onSignedOut = vi.fn()) {
  const routed = vi.fn(async (u: string, i?: RequestInit) =>
    u === '/auth/pin' ? reply(200, { data: { session_token: 'SESS', session_id: 'X', staff_id: 'S-1', display_name: 'Imran', role_ids: [], idle_ttl_ms: 1 } }) : fetch(u, i),
  );
  const api = createStaffApi({ device: { token: 'DEV', id: 'D', type: 'tablet' }, meta: META, fetch: routed, onSignedOut });
  await api.signIn('S-1', '1234', false);
  return { api, routed, onSignedOut };
}

describe('[04 v1.0.4 §6.5] audit-log request', () => {
  it('from / to as digits; staff_id when set; action a de-duplicated comma list of known actions; cursor; limit', () => {
    expect(auditLogPath({ from: 100, to: 200, staff_id: null, actions: [] }, null)).toBe('/queries/audit-log?from=100&to=200');
    expect(auditLogPath({ from: 100, to: 200, staff_id: 'S-1', actions: ['item_voided', 'void_requested', 'item_voided', 'nope'] }, 'CUR', 200)).toBe(
      '/queries/audit-log?from=100&to=200&staff_id=S-1&action=item_voided%2Cvoid_requested&cursor=CUR&limit=200',
    );
  });

  it('staff api auditLog: device token + session; keeps entries and meta.next_cursor; a body that does not match is refused', async () => {
    const { api, routed } = await signedIn(async () => reply(200, { data: { entries: ROWS }, meta: { next_cursor: 'C2' } }));
    expect(await api.auditLog(Q, 'C1')).toEqual({ ok: true, data: { entries: ROWS, next_cursor: 'C2' } });
    const call = routed.mock.calls.find(([u]) => u.startsWith('/queries/audit-log'))!;
    expect(call[0]).toBe('/queries/audit-log?from=1&to=2&cursor=C1');
    expect(call[1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer DEV', 'X-Session-Token': 'SESS' } });

    const bad = await signedIn(async () => reply(200, { data: { entries: [{ x: 1 }] }, meta: { next_cursor: null } }));
    expect(await bad.api.auditLog(Q, null)).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } });
    const noMeta = await signedIn(async () => reply(200, { data: { entries: ROWS } }));
    expect(await noMeta.api.auditLog(Q, null)).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } });
    const down = await signedIn(async () => Promise.reject(new Error('down')));
    expect(await down.api.auditLog(Q, null)).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('a 400 keeps its code; an ended session signs the page out (the staff api own path)', async () => {
    const refused = await signedIn(async () => reply(400, { error: { code: 'VALIDATION_FAILED', details: { issues: [] } } }));
    expect(await refused.api.auditLog(Q, null)).toEqual({ ok: false, error: { kind: 'api', status: 400, code: 'VALIDATION_FAILED', details: { issues: [] } } });
    const ended = await signedIn(async () => reply(401, { error: { code: 'SESSION_EXPIRED' } }));
    expect(await ended.api.auditLog(Q, null)).toEqual({ ok: false, error: { kind: 'signed_out' } });
    expect(ended.onSignedOut).toHaveBeenCalledOnce();
  });
});

describe('[04 v1.0.4 §6.5b] audit-staff request', () => {
  it('staff api auditStaff reads staff [{ staff_id, display_name, in_directory }]', async () => {
    const staff = [{ staff_id: 'S-D', display_name: 'Danish', in_directory: false }];
    const { api, routed } = await signedIn(async () => reply(200, { data: { staff } }));
    expect(await api.auditStaff()).toEqual({ ok: true, data: staff });
    expect(routed.mock.calls.some(([u]) => u === '/queries/audit-staff')).toBe(true);
    const bad = await signedIn(async () => reply(200, { data: { staff: [{ staff_id: 'S-D' }] } }));
    expect(await bad.api.auditStaff()).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } });
  });
});
