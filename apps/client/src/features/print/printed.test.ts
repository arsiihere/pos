import { afterEach, describe, expect, it } from 'vitest';
import { lineTags, onSlotsChanged, publishFrame } from '../kds/slots';
import { registerPrintSlots } from './register';
import { catchUp, fakeTransport, line } from './test-fakes';

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
});

function changes(): { count: () => number; off: () => void } {
  let n = 0;
  const off = onSlotsChanged(() => {
    n += 1;
  });
  return { count: () => n, off };
}

describe('printed tag (03c-C01)', () => {
  it('[03c §3.8] printed tag from catch-up kds_printed + printed_lines frames (subscribeFrames); notifySlots after each change', () => {
    stop = registerPrintSlots();
    const seen = changes();
    expect(lineTags(line('L1'))).toEqual([]);
    publishFrame(catchUp({ kds_printed: { order_item_ids: ['L1', 'L2'] } }));
    expect(seen.count()).toBe(1);
    expect(lineTags(line('L1'))).toEqual([{ key: 'printed', label: 'Printed' }]);
    expect(lineTags(line('L2'))).toEqual([{ key: 'printed', label: 'Printed' }]);
    expect(lineTags(line('L3'))).toEqual([]);
    publishFrame({ type: 'printed_lines', station_id: 'S-T', order_item_ids: ['L3'] });
    expect(seen.count()).toBe(2);
    expect(lineTags(line('L3'))).toEqual([{ key: 'printed', label: 'Printed' }]);
    // the same ids again change nothing: no re-render
    publishFrame({ type: 'printed_lines', station_id: 'S-T', order_item_ids: ['L3'] });
    expect(seen.count()).toBe(2);
    // a catch-up replaces the set (reconnect)
    publishFrame(catchUp({ kds_printed: { order_item_ids: ['L2'] } }));
    expect(seen.count()).toBe(3);
    expect(lineTags(line('L1'))).toEqual([]);
    expect(lineTags(line('L2'))).toHaveLength(1);
    // a catch-up without the part (not a printing socket) empties it; other frames are ignored
    publishFrame(catchUp({}));
    expect(lineTags(line('L2'))).toEqual([]);
    publishFrame({ type: 'kds_lines', station_id: 'S-T', lines: [line('L9')] });
    expect(seen.count()).toBe(4);
    seen.off();
  });

  it('[03c §3.8 IR-15] registering again (StrictMode, then with a transport) replaces the slots, never duplicates; unregister removes them', () => {
    registerPrintSlots();
    stop = registerPrintSlots(fakeTransport());
    publishFrame(catchUp({ kds_printed: { order_item_ids: ['L1'] } }));
    expect(lineTags(line('L1'))).toHaveLength(1);
    stop();
    stop = null;
    expect(lineTags(line('L1'))).toEqual([]);
  });
});
