import { describe, expect, it } from 'vitest';
import { reply } from '../../../test/dom';
import { createStaffApi, type Resolution } from './api';

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

// 02a W0.4: command() / query() exported for the 02a / 02b apis and the 02b queue; the full Resolution kept.
function recording(status = 200, body: unknown = { data: { command_id: 'C', event_ids: [], result: { done: true } } }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let signedOut = 0;
  const a = createStaffApi({
    device: { token: 'DEV', id: 'D1', type: 'tablet' },
    meta: { tenantId: 'T', branchId: 'B', branchName: 'G', hubNowMs: 0, utcOffsetMs: 0 },
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} });
      if (url === '/auth/pin') return reply(200, { data: { session_token: 'TOK-ALI', session_id: 'SS', staff_id: 'ALI', display_name: 'Ali', role_ids: [], idle_ttl_ms: 1 } });
      return reply(status, body);
    },
    newCommandId: () => 'NEW-ID',
    onSignedOut: () => void (signedOut += 1),
  });
  return { a, calls, signedOut: () => signedOut };
}
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

describe('[02b §3.12] staff api command() and query()', () => {
  it('[02b §3.12] command() sends a given command_id and X-Queued-At', async () => {
    const r = recording();
    await r.a.signIn('ALI', '1234', false);
    const answer = await r.a.command('MarkServed', { lines: [] }, { commandId: 'Q-ENTRY-1', queuedAt: 1_700_000_000_000 });
    expect(answer).toEqual({ ok: true, data: { done: true } });
    const sent = r.calls.at(-1)!;
    expect(sent.url).toBe('/commands/mark-served');
    expect(headersOf(sent.init)['X-Queued-At']).toBe('1700000000000');
    expect(headersOf(sent.init)['X-Session-Token']).toBe('TOK-ALI');
    const body = JSON.parse(sent.init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ command_id: 'Q-ENTRY-1', command_type: 'MarkServed', actor_id: 'ALI', device_id: 'D1', payload: { lines: [] } });

    // no options: a new id, no X-Queued-At
    await r.a.command('RequestBill', { table_id: 'TB4', seating_id: 'S1' });
    const plain = r.calls.at(-1)!;
    expect(plain.url).toBe('/commands/request-bill');
    expect(headersOf(plain.init)['X-Queued-At']).toBeUndefined();
    expect(JSON.parse(plain.init.body as string)).toMatchObject({ command_id: 'NEW-ID' });
  });

  it('[02b Q-2] command() replays with the queued person\'s session; their 401 does not sign the current person out', async () => {
    const r = recording(401, { error: { code: 'SESSION_EXPIRED', details: {} } });
    await r.a.signIn('ALI', '1234', false);
    const answer = await r.a.command('SubmitOrder', {}, { commandId: 'E1', queuedAt: 5, sessionToken: 'TOK-SARA', actorId: 'SARA' });
    const sent = r.calls.at(-1)!;
    expect(headersOf(sent.init)['X-Session-Token']).toBe('TOK-SARA');
    expect(JSON.parse(sent.init.body as string)).toMatchObject({ actor_id: 'SARA', command_id: 'E1' });
    expect(answer).toEqual({ ok: false, error: { kind: 'api', status: 401, code: 'SESSION_EXPIRED', details: {} } });
    expect(r.signedOut()).toBe(0);
    expect(r.a.sessionToken()).toBe('TOK-ALI');
    // the signed-in person's own token passed explicitly: their 401 signs them out as usual
    const own = await r.a.command('SubmitOrder', {}, { commandId: 'E2', sessionToken: 'TOK-ALI', actorId: 'ALI' });
    expect(own).toEqual({ ok: false, error: { kind: 'signed_out' } });
    expect(r.signedOut()).toBe(1);
  });

  it('[02a W0.4] query(path, schema?) returns data; a reply that fails the schema is refused', async () => {
    const r = recording(200, { data: { as_of_seq: 3, floors: [] } });
    expect(await r.a.query('/queries/table-map')).toEqual({ ok: true, data: { as_of_seq: 3, floors: [] } });
    const schema = { safeParse: (v: unknown) => ((v as { floors?: unknown }).floors === 'x' ? { success: true as const, data: v } : { success: false as const }) };
    const refused = await r.a.query('/queries/table-map', schema);
    expect(refused).toMatchObject({ ok: false, error: { kind: 'api', code: 'INVALID_RESPONSE' } });
    expect(r.calls.map((c) => [c.url, c.init.method])).toEqual([
      ['/queries/table-map', 'GET'],
      ['/queries/table-map', 'GET'],
    ]);
  });

  it('[02a §3.15] SessionInfo keeps grant and scope', async () => {
    const permissions = {
      'take-order': { grant: 'allowed', scope: 'my_floors' },
      'apply-comp': { grant: 'requires_approval', approver_role_ids: ['R-MGR'], scope: 'branch' },
      'clean-table': { grant: 'not_granted' },
    };
    const r = recording(200, { data: { permissions } });
    await r.a.signIn('ALI', '1234', false);
    const answer = await r.a.session();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const take: Resolution | undefined = answer.data.permissions['take-order'];
    const comp: Resolution | undefined = answer.data.permissions['apply-comp'];
    expect(take?.grant === 'allowed' ? take.scope : null).toBe('my_floors');
    expect(comp?.grant === 'requires_approval' ? [comp.scope, comp.approver_role_ids] : null).toEqual(['branch', ['R-MGR']]);
    expect(answer.data.permissions['clean-table']).toEqual({ grant: 'not_granted' });
  });
});

describe('[02b §3.12] command() failure modes (review #133)', () => {
  it('[02b §3.12] a lost or cut 2xx body is a retryable network result, never a throw; a 5xx stays an api error', async () => {
    for (const body of ['', '{"data":', 'null']) {
      const a = createStaffApi({
        device: { token: 'DEV', id: 'D1', type: 'tablet' },
        meta: { tenantId: 'T', branchId: 'B', branchName: 'G', hubNowMs: 0, utcOffsetMs: 0 },
        fetch: async () => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
        onSignedOut: () => {},
      });
      await expect(a.command('SubmitOrder', {}, { commandId: 'E1' })).resolves.toEqual({ ok: false, error: { kind: 'network' } });
    }
    // a 2xx without `result`
    const noResult = recording(200, { data: { command_id: 'C' } });
    expect(await noResult.a.command('MarkServed', { lines: [] })).toEqual({ ok: false, error: { kind: 'network' } });
    const busy = recording(503, { error: { code: 'SERVICE_UNAVAILABLE', details: {} } });
    expect(await busy.a.command('SubmitOrder', {}, { commandId: 'E1' })).toMatchObject({ ok: false, error: { kind: 'api', status: 503 } });
  });

  it('[02b §3.12] X-Queued-At is the rounded hub-clock value; an unusable value sends none', async () => {
    const r = recording();
    await r.a.command('MarkServed', { lines: [] }, { commandId: 'E1', queuedAt: 1_700_000_000_000.6 });
    expect(headersOf(r.calls.at(-1)!.init)['X-Queued-At']).toBe('1700000000001');
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      await r.a.command('MarkServed', { lines: [] }, { commandId: 'E1', queuedAt: bad });
      expect(headersOf(r.calls.at(-1)!.init)['X-Queued-At'], String(bad)).toBeUndefined();
    }
  });

  it('[02b Q-2] a sessionToken without its actorId is refused locally and nothing is sent', async () => {
    const r = recording();
    const bad = { commandId: 'E1', sessionToken: 'TOK-SARA' } as unknown as Parameters<typeof r.a.command>[2];
    expect(await r.a.command('SubmitOrder', {}, bad)).toMatchObject({ ok: false, error: { kind: 'api', code: 'CLIENT_SESSION_WITHOUT_ACTOR' } });
    expect(r.calls).toHaveLength(0);
  });
});
