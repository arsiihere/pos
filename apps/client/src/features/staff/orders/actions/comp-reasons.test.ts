import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../../../i18n';
import { compPayload, reasonChips } from './comp-reasons';

afterEach(() => setLanguage('en'));

describe('[02b §3.9] comp reasons', () => {
  it('[02b Q-19] config chips send reason_code = label; one fixed Other chip sends "other" + required note', () => {
    // H9 fallback: the stored cloud default still has "Other" — it is not drawn, only the fixed one
    const chips = reasonChips(['Late', 'Wrong item', 'Quality', 'Guest', 'Other']);
    expect(chips.map((c) => [c.label, c.code])).toEqual([
      ['Late', 'Late'],
      ['Wrong item', 'Wrong item'],
      ['Quality', 'Quality'],
      ['Guest', 'Guest'],
      ['Other', 'other'],
    ]);
    expect(reasonChips([]).map((c) => c.code)).toEqual(['other']);

    const quality = chips[2]!;
    const other = chips[4]!;
    expect(compPayload({ order_item_id: 'L1', units: 1, max_units: 1, chip: quality, note: '' })).toEqual({ order_item_id: 'L1', units: 1, reason_code: 'Quality' });
    expect(compPayload({ order_item_id: 'L1', units: 1, max_units: 1, chip: other, note: '  ' })).toBeNull();
    expect(compPayload({ order_item_id: 'L1', units: 1, max_units: 1, chip: other, note: ' cold ' })).toEqual({ order_item_id: 'L1', units: 1, reason_code: 'other', note: 'cold' });
    expect(compPayload({ order_item_id: 'L1', units: 1, max_units: 1, chip: other, note: 'x'.repeat(200) })?.note).toHaveLength(120);
    expect(compPayload({ order_item_id: 'L1', units: 1, max_units: 1, chip: null, note: '' })).toBeNull();
    expect(compPayload({ order_item_id: 'L1', units: 2, max_units: 1, chip: quality, note: '' })).toBeNull();
  });
});
