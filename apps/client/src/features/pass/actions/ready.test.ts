import { describe, expect, it } from 'vitest';
import type { HubResult } from '../../../api/hub-admin';
import type { PointOrder, PointViewBody } from '../contracts';
import { createPassNames } from '../names';
import { createPassStore } from '../store';
import { createPassApi, createReadyActions, readyBand, retrying } from './ready';

// 03b v1.0.8 §3.5, §6.6, §6.7 (P3, frames 03b-B10 in Pass / PassCards, 03b-B13): Ready to serve and Undo ready on the
// staff session (`run-pass`). One command at a time per card (ref guard); a lost reply is sent again with the same
// command_id (00 M19); the person who tapped is the Ready's name (Q-55).

type Sent = { type: string; payload: unknown; commandId: string | undefined };

function fakeCommand(answers: Array<HubResult<unknown>>) {
  const sent: Sent[] = [];
  const pending: Array<(r: HubResult<unknown>) => void> = [];
  let hold = false;
  const command = <T,>(type: string, payload: unknown, opts: { commandId?: string } = {}): Promise<HubResult<T>> => {
    sent.push({ type, payload, commandId: opts.commandId });
    if (hold) return new Promise((resolve) => pending.push(resolve as (r: HubResult<unknown>) => void));
    return Promise.resolve((answers.shift() ?? { ok: false, error: { kind: 'network' } }) as HubResult<T>);
  };
  return { command, sent, pending, hold: (v: boolean) => (hold = v) };
}
const api = (code: string, details: Record<string, unknown> = {}, status = 409): HubResult<never> => ({ ok: false, error: { kind: 'api', status, code, details } });

const order: PointOrder = {
  order_id: 'O1',
  identifier: { kind: 'table', label: 'T4' },
  placed_at: 0,
  lines: [
    {
      order_item_id: 'A',
      order_id: 'O1',
      station_id: 'ST',
      point_id: 'PT',
      identifier: { kind: 'table', label: 'T4' },
      order_type: 'dine_in',
      item_name: 'Naan',
      units: 1,
      line_kind: 'item',
      for_parent: null,
      deal_name: null,
      options: [],
      kitchen_note: null,
      order_note: null,
      return_of: null,
      cook_ms: 1,
      prep_ms: 0,
      from_stock: false,
      placed_by_name: null,
      stage: 'done',
      handed_over: false,
    },
  ],
  ready: null,
};

function setup(answers: Array<HubResult<unknown>>) {
  const fake = fakeCommand(answers);
  let n = 0;
  const passApi = createPassApi({ command: fake.command, query: <T,>() => Promise.resolve({ ok: true, data: { receivers: [] } } as HubResult<T>) }, () => `CMD-${(n += 1)}`);
  let now = 10_000;
  const store = createPassStore({ now: () => now });
  const view: PointViewBody = { point_id: 'PT', stations: [], takeovers: [], orders: [order] };
  store.apply({ type: 'catch_up', as_of_seq: 1, state: { point_view: view } });
  const names = createPassNames(() => new Promise(() => undefined));
  const ready = createReadyActions({ api: passApi, store, names, me: () => ({ staff_id: 'S-ASIF', name: 'Asif' }) });
  const frame = (event_type: string, payload: Record<string, unknown>) =>
    store.apply({ type: 'event', seq: 100 + n, event: { event_id: `E${event_type}`, event_type, schema_version: 1, payload } });
  return { fake, store, names, ready, frame, at: (ms: number) => (now = ms) };
}

describe('[03b §3.5] Ready to serve', () => {
  it('[03b §3.5] Ready to serve → MarkReadyToServe; already → the existing state; Undo ready 30 s, then PASS_UNDO_WINDOW_CLOSED → toast', async () => {
    const { fake, store, names, ready, frame, at } = setup([
      { ok: true, data: { alert_id: 'AL1' } },
      { ok: true, data: { alert_id: 'AL1', already: true } },
      api('PASS_UNDO_WINDOW_CLOSED', { order_id: 'O1', point_id: 'PT' }),
    ]);
    expect(await ready.markReady('O1', 'PT')).toEqual({});
    expect(fake.sent[0]).toMatchObject({ type: 'MarkReadyToServe', payload: { order_id: 'O1', point_id: 'PT' } });
    // the frame after the reply: the Ready shows this tablet's person (Q-55)
    at(12_000);
    frame('ReadyToServe', { order_id: 'O1', point_id: 'PT', order_item_ids: ['A'], table_id: null, alert_id: 'AL1' });
    const r = store.snapshot().view!.orders[0]!.ready!;
    expect(r).toEqual({ at: 12_000, by: 'S-ASIF' });
    expect(names.name(r.by)).toBe('Asif');

    // the band: "Ready · {time} · {name}", count-up, Undo for UNDO_DONE_MS (30 s) from the Ready
    expect(readyBand(r, 12_000 + 12_000, 0, names)).toEqual({ text: 'Ready · 12:00 AM · Asif', since: '0:12', undoLeft: '0:18' });
    expect(readyBand(r, 12_000 + 30_001, 0, names).undoLeft).toBeNull();
    expect(readyBand({ at: 12_000, by: null }, 12_000, 0, names).text).toBe('Ready · 12:00 AM');

    // a second tap on another device's Ready: `already` shows the existing state, no claim
    store.apply({ type: 'catch_up', as_of_seq: 50, state: { point_view: { point_id: 'PT', stations: [], takeovers: [], orders: [order] } } });
    expect(await ready.markReady('O1', 'PT')).toEqual({});
    fake.sent.length = 0;
    // Undo after the window: the hub refuses → toast, nothing else
    expect(await ready.undoReady('O1', 'PT')).toEqual({ toast: 'Too late to undo' });
    expect(fake.sent[0]).toMatchObject({ type: 'UndoReadyToServe', payload: { order_id: 'O1', point_id: 'PT' } });
  });

  it('[03b §3.5] `already: true` does not claim the Ready for this person', async () => {
    const { ready, store, frame } = setup([{ ok: true, data: { alert_id: 'AL9', already: true } }]);
    frame('ReadyToServe', { order_id: 'O1', point_id: 'PT', order_item_ids: ['A'], table_id: null, alert_id: 'AL9' });
    await ready.markReady('O1', 'PT');
    expect(store.snapshot().view!.orders[0]!.ready!.by).toBeNull();
  });

  it('[03b §3.5] a double tap sends once; a lost reply is sent again with the same command_id; errors map to card lines (B13)', async () => {
    const { fake, ready } = setup([{ ok: true, data: { alert_id: 'AL1' } }, { ok: true, data: { alert_id: 'AL1', already: true } }]);
    fake.hold(true);
    const first = ready.markReady('O1', 'PT');
    expect(ready.busy('O1')).toBe(true);
    expect(await ready.markReady('O1', 'PT')).toEqual({ busy: true });
    expect(fake.sent).toHaveLength(1);
    fake.pending[0]!({ ok: false, error: { kind: 'network' } });
    expect(await first).toEqual({ message: { text: 'No connection to the hub — try again.', tone: 'danger' } });
    expect(ready.busy('O1')).toBe(false);
    fake.hold(false);
    await ready.markReady('O1', 'PT');
    expect(fake.sent.map((s) => s.commandId)).toEqual(['CMD-1', 'CMD-1']);
    // answered → the next Ready is a new command
    await ready.markReady('O1', 'PT');
    expect(fake.sent[2]!.commandId).toBe('CMD-2');

    const { ready: r2 } = setup([api('ITEM_WRONG_STAGE', { stage: 'served' }), api('ORDER_NOT_IN_ENGINE'), api('PERMISSION_DENIED', {}, 403)]);
    expect(await r2.markReady('O1', 'PT')).toEqual({ message: { text: 'Nothing left to serve on this order', tone: 'danger' } });
    expect(await r2.markReady('O1', 'PT')).toEqual({ message: { text: 'This order is no longer in the kitchen', tone: 'danger' } });
    expect((await r2.markReady('O1', 'PT')).message?.tone).toBe('danger');
  });

  it('[00 M19] retrying(): one id per command and payload until the hub answers', async () => {
    const fake = fakeCommand([{ ok: false, error: { kind: 'network' } }, api('X'), { ok: true, data: 1 }]);
    let n = 0;
    const send = retrying(fake.command, () => `ID${(n += 1)}`);
    await send('StartItem', { order_item_id: 'A' });
    await send('StartItem', { order_item_id: 'B' });
    await send('StartItem', { order_item_id: 'A' });
    await send('StartItem', { order_item_id: 'A' });
    expect(fake.sent.map((s) => [(s.payload as { order_item_id: string }).order_item_id, s.commandId])).toEqual([
      ['A', 'ID1'],
      ['B', 'ID2'],
      ['A', 'ID1'],
      ['A', 'ID3'],
    ]);
  });

  it('[00 M19] a hub answer for any command on the same line / order drops that target\'s open ids: Done (lost) → Undo → Done is a new command; Ready (lost) → Undo → Ready too', async () => {
    const fake = fakeCommand([{ ok: false, error: { kind: 'network' } }, { ok: true, data: {} }, { ok: true, data: {} }]);
    let n = 0;
    const send = retrying(fake.command, () => `ID${(n += 1)}`);
    await send('DoneItem', { order_item_id: 'A' });
    await send('UndoDone', { order_item_id: 'A' });
    await send('DoneItem', { order_item_id: 'A' });
    expect(fake.sent.map((x) => [x.type, x.commandId])).toEqual([
      ['DoneItem', 'ID1'],
      ['UndoDone', 'ID2'],
      ['DoneItem', 'ID3'],
    ]);
    const g = fakeCommand([{ ok: false, error: { kind: 'network' } }, { ok: true, data: {} }, { ok: true, data: {} }, { ok: false, error: { kind: 'network' } }, api('X'), { ok: true, data: {} }]);
    let k = 0;
    const s2 = retrying(g.command, () => `R${(k += 1)}`);
    await s2('MarkReadyToServe', { order_id: 'O1', point_id: 'PT' });
    await s2('UndoReadyToServe', { order_id: 'O1', point_id: 'PT' });
    await s2('MarkReadyToServe', { order_id: 'O1', point_id: 'PT' });
    // another order's answer leaves this order's open id alone
    await s2('MarkReadyToServe', { order_id: 'O2', point_id: 'PT' });
    await s2('MarkReadyToServe', { order_id: 'O1', point_id: 'PT' });
    await s2('MarkReadyToServe', { order_id: 'O2', point_id: 'PT' });
    expect(g.sent.map((x) => [x.type, (x.payload as { order_id: string }).order_id, x.commandId])).toEqual([
      ['MarkReadyToServe', 'O1', 'R1'],
      ['UndoReadyToServe', 'O1', 'R2'],
      ['MarkReadyToServe', 'O1', 'R3'],
      ['MarkReadyToServe', 'O2', 'R4'],
      ['MarkReadyToServe', 'O1', 'R5'],
      ['MarkReadyToServe', 'O2', 'R4'],
    ]);
  });

  it('[03b §3.9] PERMISSION_DENIED (run-pass taken away) → "You can see the Pass but not run it. Ask a manager."', async () => {
    const { ready } = setup([api('PERMISSION_DENIED', {}, 403)]);
    expect(await ready.markReady('O1', 'PT')).toEqual({ message: { text: 'You can see the Pass but not run it. Ask a manager.', tone: 'danger' } });
  });

  it('[00 M19] a lost reply, then signed_out (the session ended), keeps the id: only a hub answer clears it', async () => {
    const fake = fakeCommand([{ ok: false, error: { kind: 'network' } }, { ok: false, error: { kind: 'signed_out' } }, { ok: true, data: {} }]);
    let n = 0;
    const send = retrying(fake.command, () => `C${(n += 1)}`);
    await send('GiveMeMore', { station_id: 'ST' });
    await send('GiveMeMore', { station_id: 'ST' });
    await send('GiveMeMore', { station_id: 'ST' });
    expect(fake.sent.map((x) => x.commandId)).toEqual(['C1', 'C1', 'C1']);
  });
});

