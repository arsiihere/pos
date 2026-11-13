import { describe, expect, it, vi } from 'vitest';
import { reply } from '../../../../test/dom';
import type { KdsRow } from '../store';
import { buttonFor, createKdsApi, messageFor, undoLeft } from './actions';

// 03b v1.0.8 §3.2, §6.1–§6.5, #72 (K3): station commands on the station session; the rules for buttons and errors.

const row = (o: Partial<KdsRow>, from_stock = false): KdsRow =>
  ({ order_item_id: 'A', order_id: 'O', stage: 'added', fired_at: 0, started_at: null, mark: null, done_undone: false, done_at: null, detail: { from_stock }, ...o }) as KdsRow;

describe('[03b §3.2] station commands', () => {
  it('[03b §6.1] StartItem goes to /commands/start-item with the station session, actor_id null, the page ids and the hub clock', async () => {
    const fetch = vi.fn(async () => reply(200, { data: { command_id: 'C1', event_ids: ['E1'], result: { started: ['A'] } } }));
    const api = createKdsApi({ fetch, meta: { tenantId: 'TEN', branchId: 'BR', branchName: '', hubNowMs: 0, utcOffsetMs: 0 }, deviceId: 'D-K1', deviceToken: 'DEV', sessionToken: 'SS', nowMs: () => 1_234.4, newCommandId: () => 'CMD-1' });
    expect(await api.startItem({ order_item_id: 'A' })).toEqual({ ok: true, data: { started: ['A'] } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/commands/start-item');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer DEV', 'X-Session-Token': 'SS' });
    expect(JSON.parse(init.body as string)).toEqual({
      command_id: 'CMD-1',
      tenant_id: 'TEN',
      branch_id: 'BR',
      command_type: 'StartItem',
      payload: { order_item_id: 'A' },
      occurred_at: 1_234,
      actor_id: null,
      device_id: 'D-K1',
    });
    fetch.mockImplementationOnce(async () => reply(409, { error: { code: 'ITEM_WRONG_STAGE', message: 'x', details: { stage: 'done' } } }));
    expect(await api.doneItem({ order_item_id: 'A' })).toEqual({ ok: false, error: { kind: 'api', status: 409, code: 'ITEM_WRONG_STAGE', details: { stage: 'done' } } });
    expect((fetch.mock.calls[1] as unknown as [string])[0]).toBe('/commands/done-item');
    fetch.mockImplementationOnce(async () => Promise.reject(new TypeError('down')));
    expect(await api.giveMeMore({ station_id: 'S' })).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('[03b §3.2 D32] a lost reply keeps the command_id for the re-tap (Start, Done, Undo, Give me more); a hub answer frees it', async () => {
    let n = 0;
    const replies: Array<() => Promise<Response>> = [];
    const fetch = vi.fn(async () => replies.shift()!());
    const api = createKdsApi({ fetch, meta: { tenantId: 'T', branchId: 'B', branchName: '', hubNowMs: 0, utcOffsetMs: 0 }, deviceId: 'D', deviceToken: 'DEV', sessionToken: 'SS', nowMs: () => 0, newCommandId: () => `C${++n}` });
    const ids = () => fetch.mock.calls.map((c) => (JSON.parse((c as unknown as [string, RequestInit])[1].body as string) as { command_id: string }).command_id);
    const lost = () => Promise.reject(new TypeError('down'));
    const noBody = async () => new Response('', { status: 200 });
    const ok = (result: unknown) => async () => reply(200, { data: { command_id: 'x', event_ids: [], result } });
    const refused = async () => reply(409, { error: { code: 'ITEM_WRONG_STAGE', message: 'x', details: { stage: 'done' } } });
    const calls: Array<[() => Promise<unknown>, Array<() => Promise<Response>>]> = [
      [() => api.startItem({ order_item_id: 'A' }), [lost, noBody, ok({ started: ['A'] }), ok({ started: ['A'] })]],
      [() => api.doneItem({ order_item_id: 'A' }), [lost, refused, ok({ done: ['A'] })]],
      [() => api.undoDone({ order_item_id: 'A' }), [lost, ok({ undone: ['A'], ready_undone: [] }), ok({ undone: ['A'], ready_undone: [] })]],
      [() => api.giveMeMore({ station_id: 'S' }), [lost, lost, ok({ pulled: ['X'] }), ok({ pulled: null })]],
    ];
    for (const [call, rs] of calls) {
      fetch.mockClear();
      replies.push(...rs);
      for (let i = 0; i < rs.length; i += 1) await call();
      const sent = ids();
      // every attempt until the hub answered carries the first id; the tap after the answer a new one
      const answeredAt = rs.findIndex((r) => r !== lost && r !== noBody);
      expect(new Set(sent.slice(0, answeredAt + 1)).size, sent.join()).toBe(1);
      expect(sent[answeredAt + 1], sent.join()).not.toBe(sent[0]);
    }
    // another payload is another intent: its own id
    fetch.mockClear();
    replies.push(lost, lost);
    await api.startItem({ order_item_id: 'B' });
    await api.startItem({ order_item_id: 'C' });
    expect(new Set(ids()).size).toBe(2);
  });

  it('[03b §3.3] one button per card: two_tap Start then Done, single / auto Done only, from-stock Done only, Undo inside UNDO_DONE_MS', () => {
    expect(buttonFor(row({}), 'two_tap', 0)).toBe('start');
    expect(buttonFor(row({}), null, 0)).toBe('start');
    expect(buttonFor(row({}), 'single_tap', 0)).toBe('done');
    expect(buttonFor(row({}), 'auto_done', 0)).toBe('done');
    expect(buttonFor(row({}, true), 'two_tap', 0)).toBe('done');
    expect(buttonFor(row({ stage: 'cooking' }), 'two_tap', 0)).toBe('done');
    expect(buttonFor(row({ stage: 'done', done_at: 1_000 }), 'two_tap', 30_999)).toBe('undo');
    expect(undoLeft(row({ stage: 'done', done_at: 1_000 }), 7_000)).toBe(24_000);
    expect(buttonFor(row({ stage: 'done', done_at: 1_000 }), 'two_tap', 31_000)).toBeNull();
  });

  it('[03b §3.2] refused taps → the inline line; the loser of two Done taps and a Start someone else did show nothing', () => {
    const err = (code: string, details: Record<string, unknown> = {}) => ({ kind: 'api' as const, status: 409, code, details });
    expect(messageFor('done', err('ITEM_WRONG_STAGE', { stage: 'done' }))).toBeNull();
    expect(messageFor('start', err('ITEM_WRONG_STAGE', { stage: 'cooking' }))).toBeNull();
    expect(messageFor('done', err('ITEM_WRONG_STAGE', { stage: 'added' }))).toEqual({ kind: 'start_first' });
    expect(messageFor('undo', err('ITEM_WRONG_STAGE', { stage: 'handed_over' }))).toEqual({ kind: 'line', key: 'kds.handed_over', tone: 'mute' });
    expect(messageFor('done', err('ITEM_WRONG_STAGE', { stage: 'out_of_engine' }))).toEqual({ kind: 'line', key: 'kds.gone', tone: 'danger' });
    expect(messageFor('done', err('ORDER_NOT_FOUND'))).toEqual({ kind: 'line', key: 'kds.gone', tone: 'danger' });
    expect(messageFor('done', err('ITEM_WRONG_STAGE', { stage: 'served' }))).toEqual({ kind: 'changed', stage: 'served' });
    expect(messageFor('undo', err('ITEM_UNDO_WINDOW_CLOSED'))).toEqual({ kind: 'line', key: 'kds.undo_closed', tone: 'mute' });
    expect(messageFor('start', err('PERMISSION_DENIED'))).toEqual({ kind: 'line', key: 'kds.not_this_station', tone: 'danger' });
    expect(messageFor('done', err('ITEM_DONE_CONFIRM_REQUIRED', { elapsed_ms: 120_000, cook_ms: 360_000 }))).toEqual({ kind: 'confirm', elapsed_ms: 120_000, cook_ms: 360_000 });
    expect(messageFor('done', { kind: 'network' })).toBeNull();
    expect(messageFor('start', err('SESSION_EXPIRED'))).toEqual({ kind: 'code', code: 'SESSION_EXPIRED' });
  });
});
