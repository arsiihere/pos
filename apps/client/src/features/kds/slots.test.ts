import type { LineDetail } from '@pos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { lineTags, passCardActions, registerLineTag, registerPassCardAction } from './slots';

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
    const run = () => undefined;
    const off = registerPassCardAction((o) => ({ key: 'reprint', label: `Reprint ${o.order_id}`, run }));
    expect(lineTags(line)).toEqual([{ key: 'printed', label: 'Printed' }]);
    expect(lineTags({ ...line, order_item_id: 'L2' })).toEqual([]);
    expect(passCardActions(order)).toEqual([{ key: 'reprint', label: 'Reprint O1', run }]);
    off();
    expect(passCardActions(order)).toEqual([]);
  });
});
