import { describe, expect, expectTypeOf, it } from 'vitest';
import * as domain from './index';
import { POINT_ORDER_TYPES, ROUTING_WARN_ORDER_TYPES, UNDO_DONE_MS, groupByPartOf, routePoint, sumOptionTexts, type Identifier, type LineDetail, type RoutablePoint } from './kds';

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
      // ⚠️ 03b v1.0.11 §4.4 (STAB-5): the first part of a split line; null = not split, absent from an older hub
      part_of?: string | null;
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

// ⚠️ 03b v1.0.16 owner clarification (PT-1, PT-2, PT-7), run 3 (R3-M-1, R3-M-2), §4.4: Pass points by order type.
describe('[03b PT-1] routePoint', () => {
  const pt = (point_id: string, order_types?: RoutablePoint['order_types'], o: Partial<RoutablePoint> = {}): RoutablePoint => ({
    point_id,
    name: point_id,
    sort_order: 1,
    is_archived: false,
    ...(order_types === undefined ? {} : { order_types }),
    ...o,
  });
  const both = (points: RoutablePoint[], station: { point_id: string }, t: (typeof POINT_ORDER_TYPES)[number]) => {
    const forward = routePoint(points, station, t);
    expect(routePoint([...points].reverse(), station, t), 'independent of input order').toEqual(forward);
    return forward;
  };

  it('exports the order-type lists', () => {
    expect(POINT_ORDER_TYPES).toEqual(['dine_in', 'takeaway', 'delivery', 'parking']);
    expect(ROUTING_WARN_ORDER_TYPES).toEqual(['dine_in', 'takeaway', 'parking']);
    expect(domain.routePoint).toBe(routePoint);
  });

  it('[03b #125] Main all + TA takeaway: takeaway → TA, other types → Main; an archived TA drops out; all-legacy points → the station default', () => {
    const points = [pt('Main', 'all'), pt('TA', ['takeaway'])];
    const station = { point_id: 'Main' };
    expect(both(points, station, 'takeaway')).toEqual({ point_id: 'TA', reason: 'match', tied_point_ids: [] });
    for (const t of ['dine_in', 'delivery', 'parking'] as const) expect(both(points, station, t)).toEqual({ point_id: 'Main', reason: 'match', tied_point_ids: [] });
    expect(both([pt('Main', 'all'), pt('TA', ['takeaway'], { is_archived: true })], station, 'takeaway')).toEqual({ point_id: 'Main', reason: 'match', tied_point_ids: [] });
    // Legacy: absent and 'all' accept every type; several of them tie, and the station default gets the line.
    const legacy = [pt('Main'), pt('B', 'all'), pt('A')];
    for (const t of POINT_ORDER_TYPES) expect(both(legacy, station, t)).toEqual({ point_id: 'Main', reason: 'tie', tied_point_ids: ['A', 'B', 'Main'] });
    expect(both([pt('Main')], station, 'parking')).toEqual({ point_id: 'Main', reason: 'match', tied_point_ids: [] });
  });

  it('[03b #127] ties: A and B takeaway with default Main all → Main, tied [A, B]; default A → A, same ids; a two-type set beats all; an explicit four-type set ties with all', () => {
    const points = [pt('Main', 'all'), pt('B', ['takeaway']), pt('A', ['takeaway'])];
    expect(both(points, { point_id: 'Main' }, 'takeaway')).toEqual({ point_id: 'Main', reason: 'tie', tied_point_ids: ['A', 'B'] });
    expect(both(points, { point_id: 'A' }, 'takeaway')).toEqual({ point_id: 'A', reason: 'tie', tied_point_ids: ['A', 'B'] });
    expect(both([pt('A', ['takeaway', 'parking']), pt('B', 'all')], { point_id: 'B' }, 'takeaway')).toEqual({ point_id: 'A', reason: 'match', tied_point_ids: [] });
    expect(both([pt('A', ['dine_in', 'takeaway', 'delivery', 'parking']), pt('B', 'all')], { point_id: 'B' }, 'takeaway')).toEqual({ point_id: 'B', reason: 'tie', tied_point_ids: ['A', 'B'] });
    // A repeated type counts once (01a A-9 repeat rule): still the smaller set.
    expect(both([pt('A', ['takeaway', 'takeaway']), pt('B', ['takeaway', 'parking'])], { point_id: 'B' }, 'takeaway')).toEqual({ point_id: 'A', reason: 'match', tied_point_ids: [] });
  });

  it('[03b #128] fallback: every point dine-in only → parking goes to the station default, never dropped', () => {
    const points = [pt('Main', ['dine_in']), pt('Side', ['dine_in'])];
    expect(both(points, { point_id: 'Main' }, 'parking')).toEqual({ point_id: 'Main', reason: 'fallback', tied_point_ids: [] });
  });

  it('[03b R3-M-1] effective default: the configured point while active, else the active point named Pass, then sort_order, then point_id; no active point → null', () => {
    const points = [pt('Z', ['dine_in'], { sort_order: 1 }), pt('P2', ['dine_in'], { name: 'Pass', sort_order: 9 }), pt('Old', 'all', { is_archived: true })];
    expect(both(points, { point_id: 'Old' }, 'parking')).toEqual({ point_id: 'P2', reason: 'fallback', tied_point_ids: [] });
    const noPass = [pt('b', ['dine_in'], { sort_order: 2 }), pt('c', ['dine_in'], { sort_order: 1 }), pt('a', ['dine_in'], { sort_order: 1 })];
    expect(both(noPass, { point_id: 'gone' }, 'parking')).toEqual({ point_id: 'a', reason: 'fallback', tied_point_ids: [] });
    expect(both([pt('Old', 'all', { is_archived: true })], { point_id: 'Old' }, 'dine_in')).toBeNull();
    expect(routePoint([], { point_id: 'Main' }, 'dine_in')).toBeNull();
  });
});
