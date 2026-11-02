import { describe, expect, it } from 'vitest';
import { reply } from '../../../test/dom';
import { createStaffApi } from './api';

// 01d task 41 (review fix): inbox, requests and receipts replies are parsed with the @pos/events schemas.

function api(body: unknown) {
  const a = createStaffApi({
    device: { token: 'DEV', id: 'D1', type: 'tablet' },
    meta: { tenantId: 'T', branchId: 'B', branchName: 'G', hubNowMs: 0, utcOffsetMs: 0 },
    fetch: async () => reply(200, body),
    onSignedOut: () => {},
  });
  return a;
}

describe('[01d task 41] staff api', () => {
  it('refuses inbox, requests and receipts replies that do not match their schema', async () => {
    const bad = { data: { alerts: [{ alert_id: 'A' }], requests: [{ alert_id: 'R' }], kind: 1 }, meta: { next_cursor: null } };
    for (const call of [(a: ReturnType<typeof api>) => a.inbox(null), (a: ReturnType<typeof api>) => a.requests(), (a: ReturnType<typeof api>) => a.receipts('A')]) {
      const answer = await call(api(bad));
      expect(answer.ok).toBe(false);
      if (!answer.ok) expect(answer.error).toMatchObject({ kind: 'api', code: 'INVALID_RESPONSE' });
    }
  });

  it('accepts a valid inbox page with its cursor', async () => {
    const answer = await api({ data: { alerts: [] }, meta: { next_cursor: 'c2' } }).inbox(null);
    expect(answer).toEqual({ ok: true, data: { alerts: [], next_cursor: 'c2' } });
  });
});
