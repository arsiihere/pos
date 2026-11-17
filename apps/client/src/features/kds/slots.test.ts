import type { LineDetail } from '@pos/domain';
import type { WsServerMessage } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  lineActions,
  lineTags,
  notifySlots,
  onSlotsChanged,
  passCardActions,
  publishFrame,
  registerLineAction,
  registerLineTag,
  registerPassCardAction,
  runSlotAction,
  subscribeFrames,
  type LineActionCtx,
  type SlotAction,
} from './slots';

// 03b D12, §8: 03c adds to 03b's screens only through these two slots; 03b renders whatever is registered.
const line = { order_item_id: 'L1', station_id: 'S1' } as LineDetail;
const order = { order_id: 'O1', point_id: 'P1' };
const undo: Array<() => void> = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
});

describe('[03b D12] client slots', () => {
  it('[03b D12] slots render nothing when empty', () => {
    expect(lineTags(line)).toEqual([]);
    expect(passCardActions(order)).toEqual([]);
  });

  it('[03b D12] registered tags / actions are returned in registration order; null is skipped; unregister removes', () => {
    undo.push(registerLineTag((l) => (l.order_item_id === 'L1' ? { key: 'printed', label: 'Printed' } : null)));
    undo.push(registerLineTag(() => null));
    const run = () => Promise.resolve();
    const off = registerPassCardAction((o) => ({ key: 'reprint', label: `Reprint ${o.order_id}`, run }));
    expect(lineTags(line)).toEqual([{ key: 'printed', label: 'Printed' }]);
    expect(lineTags({ ...line, order_item_id: 'L2' })).toEqual([]);
    expect(passCardActions(order)).toEqual([{ key: 'reprint', label: 'Reprint O1', run }]);
    off();
    expect(passCardActions(order)).toEqual([]);
  });
});

// 03b v1.0.8 §8 (owner Q-50, W0.5): the row action, async run() with a toast, the frame feed and the re-render signal.
describe('[03b Q-50] slot extension', () => {
  it('[03b Q-50] registerLineAction gets the row and { station_id, has_printer, surface }; unregister removes it', async () => {
    const seen: Array<[string, LineActionCtx]> = [];
    const off = registerLineAction((l, ctx) => {
      seen.push([l.order_item_id, ctx]);
      return ctx.has_printer ? { key: 'reprint', label: 'Reprint', run: async () => ({ toast: 'Reprinting 1 tickets' }) } : null;
    });
    undo.push(registerLineAction(() => null));
    const kds: LineActionCtx = { station_id: 'S1', has_printer: true, surface: 'kds' };
    const takeover: LineActionCtx = { station_id: 'S2', has_printer: false, surface: 'takeover' };
    expect(lineActions(line, kds).map((a) => a.key)).toEqual(['reprint']);
    expect(lineActions(line, takeover)).toEqual([]);
    expect(seen).toEqual([
      ['L1', kds],
      ['L1', takeover],
    ]);
    off();
    expect(lineActions(line, kds)).toEqual([]);
    // the Pass card action keeps its name and is async too
    undo.push(registerPassCardAction(() => ({ key: 'reprint', label: 'Reprint', run: () => Promise.resolve() })));
    const [action] = passCardActions(order);
    await expect(action!.run()).resolves.toBeUndefined();
  });

  it('[03b Q-50] run() is awaited and its toast returned to the caller; a throwing run() → rejected promise, never a crash of the slot reader', async () => {
    let resolve!: (v: { toast: string }) => void;
    const slow: SlotAction = { key: 'slow', label: 'Slow', run: () => new Promise((r) => (resolve = r)) };
    const pending = runSlotAction(slow);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    resolve({ toast: 'Reprinting 2 tickets' });
    await expect(pending).resolves.toEqual({ toast: 'Reprinting 2 tickets' });
    await expect(runSlotAction({ key: 'v', label: 'V', run: () => Promise.resolve() })).resolves.toEqual({});

    const boom: SlotAction = {
      key: 'boom',
      label: 'Boom',
      run: () => {
        throw new Error('sync');
      },
    };
    await expect(runSlotAction(boom)).rejects.toThrow('sync');
    await expect(runSlotAction({ key: 'r', label: 'R', run: () => Promise.reject(new Error('async')) })).rejects.toThrow('async');

    // a slot function that throws is skipped; the reader still returns the others
    undo.push(
      registerLineAction(() => {
        throw new Error('bad slot');
      }),
    );
    undo.push(registerLineAction(() => boom));
    undo.push(
      registerLineTag(() => {
        throw new Error('bad tag');
      }),
    );
    undo.push(
      registerPassCardAction(() => {
        throw new Error('bad card');
      }),
    );
    expect(lineActions(line, { station_id: 'S1', has_printer: true, surface: 'kds' })).toEqual([boom]);
    expect(lineTags(line)).toEqual([]);
    expect(passCardActions(order)).toEqual([]);
  });

  it('[03b Q-50] subscribeFrames receives every published frame in order until unsubscribed', () => {
    const a: WsServerMessage[] = [];
    const b: WsServerMessage[] = [];
    const offA = subscribeFrames((f) => a.push(f));
    undo.push(subscribeFrames((f) => b.push(f)));
    const f1: WsServerMessage = { type: 'catch_up', as_of_seq: 4, state: { kds_printed: [] } };
    const f2: WsServerMessage = { type: 'printed_lines', station_id: 'S1', order_item_ids: ['L1'] };
    const f3: WsServerMessage = { type: 'station_notice', station_id: 'S1', kind: 'output', has_printer: false };
    publishFrame(f1);
    publishFrame(f2);
    offA();
    publishFrame(f3);
    expect(a).toEqual([f1, f2]);
    expect(b).toEqual([f1, f2, f3]);
    // a throwing subscriber does not stop the others
    undo.push(
      subscribeFrames(() => {
        throw new Error('bad subscriber');
      }),
    );
    const c: WsServerMessage[] = [];
    undo.push(subscribeFrames((f) => c.push(f)));
    expect(() => publishFrame(f2)).not.toThrow();
    expect(c).toEqual([f2]);
  });

  it('[03b Q-50] notifySlots calls each onSlotsChanged listener once', () => {
    let x = 0;
    let y = 0;
    const offX = onSlotsChanged(() => x++);
    undo.push(onSlotsChanged(() => y++));
    notifySlots();
    expect([x, y]).toEqual([1, 1]);
    offX();
    notifySlots();
    expect([x, y]).toEqual([1, 2]);
    // a throwing listener does not stop the others, nor reach the caller
    undo.push(
      onSlotsChanged(() => {
        throw new Error('bad screen');
      }),
    );
    let z = 0;
    undo.push(onSlotsChanged(() => z++));
    expect(() => notifySlots()).not.toThrow();
    expect([y, z]).toEqual([3, 1]);
  });
});
