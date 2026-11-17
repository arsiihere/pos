import type { LineDetail } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import type { KdsRow, KdsView } from '../store';
import { comingUp } from './ComingUp';

// 03b v1.0.8 §3.3, #73 (K4; frame 03b-C06).

const d = (id: string, item_name: string, units: number) => ({ order_item_id: id, item_name, units }) as LineDetail;
const r = (id: string, name: string, units: number, stage: KdsRow['stage'] = 'cooking') => ({ order_item_id: id, stage, detail: d(id, name, units) }) as KdsRow;

describe('[03b #73] coming-up strip', () => {
  it('[03b #73] coming-up strip: live units by item name over Now + Next, largest first, max 6', () => {
    const plan = {
      station_id: 'ST',
      as_of_seq: 1,
      lines: [
        { order_item_id: 'N1', order_id: 'O', fire_ms: 0, deadline_ms: 0, mark: null, frozen: true },
        { order_item_id: 'N2', order_id: 'O', fire_ms: 0, deadline_ms: 0, mark: null, frozen: true },
        { order_item_id: 'L1', order_id: 'O', fire_ms: 0, deadline_ms: 0, mark: null, frozen: false },
      ],
    };
    const view = {
      rows: [r('A', 'Naan', 6), r('B', 'Roghni Naan', 8), r('C', 'Naan', 4), r('D', 'Kulcha', 4), r('E', 'Roti', 9, 'done'), r('F', 'Tea', 1), r('G', 'Paratha', 1), r('H', 'Puri', 1), { order_item_id: 'P', stage: 'added', detail: null } as unknown as KdsRow],
      plan,
      details: new Map([
        ['N1', d('N1', 'Naan', 12)],
        ['N2', d('N2', 'Roti', 2)],
        ['L1', d('L1', 'Naan', 50)],
      ]),
    } as unknown as KdsView;
    // Naan 6 + 4 + 12, Roti only its Next line (Later and done lines do not count); largest first, at most 6 (Puri drops)
    expect(comingUp(view)).toEqual([
      { name: 'Naan', units: 22 },
      { name: 'Roghni Naan', units: 8 },
      { name: 'Kulcha', units: 4 },
      { name: 'Roti', units: 2 },
      { name: 'Tea', units: 1 },
      { name: 'Paratha', units: 1 },
    ]);
  });
});
