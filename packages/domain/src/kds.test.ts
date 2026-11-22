import { describe, expect, expectTypeOf, it } from 'vitest';
import * as domain from './index';
import { UNDO_DONE_MS, groupByPartOf, sumOptionTexts, type Identifier, type LineDetail } from './kds';

// 03b §4.4: shared, browser-safe types.
describe('[03b §4.4] kds types', () => {
  it('[03b §4.4, D16] UNDO_DONE_MS is 30 s and is exported from @pos/domain', () => {
    expect(UNDO_DONE_MS).toBe(30_000);
    expect(domain.UNDO_DONE_MS).toBe(30_000);
  });

  it('[03b §4.4] Identifier: table, token, parking', () => {
    expectTypeOf<Extract<Identifier, { kind: 'table' }>>().toEqualTypeOf<{ kind: 'table'; label: string }>();
    expectTypeOf<Extract<Identifier, { kind: 'token' }>>().toEqualTypeOf<{ kind: 'token'; token: number; date: string | null }>();
    expectTypeOf<Extract<Identifier, { kind: 'parking' }>>().toEqualTypeOf<{
      kind: 'parking';
      car_number: string;
      car_type: 'sedan' | 'mini' | 'large';
    }>();
    expectTypeOf<Identifier['kind']>().toEqualTypeOf<'table' | 'token' | 'parking'>();
  });

  it('[03b §4.4] LineDetail has exactly the spec fields and types', () => {
    expectTypeOf<LineDetail>().toEqualTypeOf<{
      order_item_id: string;
      order_id: string;
      station_id: string;
      point_id: string;
      identifier: Identifier;
      order_type: 'dine_in' | 'takeaway' | 'parking';
      item_name: string;
      units: number;
      line_kind: 'item' | 'option_child' | 'deal_part';
      for_parent: string | null;
      deal_name: string | null;
      options: string[];
      kitchen_note: string | null;
      order_note: string | null;
      return_of: { order_item_id: string; mode: 'fix' | 'remake'; item_name: string; identifier: Identifier } | null;
      cook_ms: number;
      prep_ms: number;
      from_stock: boolean;
      placed_by_name: string | null;
    }>();
    const line: LineDetail = {
      order_item_id: 'L1',
      order_id: 'O1',
      station_id: 'S1',
      point_id: 'P1',
      identifier: { kind: 'table', label: 'T4 + T5' },
      order_type: 'dine_in',
      item_name: 'Mutton Karahi',
      units: 1,
      line_kind: 'item',
      for_parent: null,
      deal_name: null,
      options: [],
      kitchen_note: null,
      order_note: null,
      return_of: null,
      cook_ms: 600_000,
      prep_ms: 0,
      from_stock: false,
      placed_by_name: null,
    };
    expect(line.identifier.kind).toBe('table');
  });
});

describe('[03b v1.0.11 §3.3, §3.4; 03c v1.0.15 §3.3] split-line parts (STAB-5)', () => {
  it('groupByPartOf: items with one key are one group at the first one\'s place; a null key stays alone', () => {
    const items = [
      { id: 'N', k: 'N' },
      { id: 'K', k: null },
      { id: 'N-p2', k: 'N' },
      { id: 'M', k: null },
      { id: 'N-p3', k: 'N' },
    ];
    expect(groupByPartOf(items, (i) => i.k).map((g) => g.map((i) => i.id))).toEqual([['N', 'N-p2', 'N-p3'], ['K'], ['M']]);
    expect(groupByPartOf([], () => 'x')).toEqual([]);
  });

  it('sumOptionTexts: option entries summed by name, first-seen order ("Raita" ×3 → "3 x Raita"); one list unchanged', () => {
    expect(sumOptionTexts([['Raita', '2 x No onion'], ['Raita', '2 x No onion'], ['Raita', '2 x No onion']])).toEqual(['3 x Raita', '6 x No onion']);
    expect(sumOptionTexts([['Extra butter'], ['Less salt']])).toEqual(['Extra butter', 'Less salt']);
    expect(sumOptionTexts([['2 x Raita', 'Mint']])).toEqual(['2 x Raita', 'Mint']);
    expect(sumOptionTexts([])).toEqual([]);
  });
});
