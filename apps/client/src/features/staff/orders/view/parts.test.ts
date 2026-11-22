import { describe, expect, it } from 'vitest';
import type { SeatingLine } from '../contracts';
import { voidPayload } from '../../../voids/model';
import { servedPayload } from '../actions/MarkServedSheet';
import { groupParts, partEntries } from './parts';

// 02b v1.0.21 §8 (STAB-5, test 42): the order view shows a split line's parts as one row per stage; an action on n of
// a grouped row names n parts.
const line = (id: string, o: Partial<SeatingLine> = {}): SeatingLine =>
  ({
    order_item_id: id, order_id: 'O1', parent_order_item_id: null, line_kind: 'item', item_id: 'I1', deal_id: null, name: 'Karahi',
    sale_unit: 'piece', quantity: 1, units: 1, live_units: 1, comped_units: 0, removed_units: 0, voided_units: 0, returned_units: 0,
    refundable_minor: 1_000, comp_minor: 0, comp_voided_minor: 0, removed_minor: 0, refund_minor: 0, line_total_minor: 1_000, billed_minor: 1_000,
    return_of: null, served_from_zone_id: null, zone_served: false, added_at: 0, served_at: null, served_source: null, is_food: true,
    kitchen_note: null, part_of: null, stage: 'added', fired: false, ...o,
  }) as SeatingLine;

describe('[02b v1.0.21 §8] order view parts', () => {
  it('[02b #42] parts in one stage fold into one row (units and money summed, part_ids kept); another stage is its own row; unsplit lines unchanged', () => {
    const lines = [
      line('K', { part_of: 'K', stage: 'cooking' }),
      line('K-p2', { part_of: 'K', stage: 'cooking' }),
      line('K-p3', { part_of: 'K', stage: 'added' }),
      line('N', { name: 'Naan' }),
    ];
    const rows = groupParts(lines);
    expect(rows.map((r) => [r.order_item_id, r.stage, r.live_units, r.line_total_minor, r.part_ids])).toEqual([
      ['K', 'cooking', 2, 2_000, ['K', 'K-p2']],
      ['K-p3', 'added', 1, 1_000, ['K-p3']],
      ['N', 'added', 1, 1_000, undefined],
    ]);
  });

  it('[02b #42] a child follows its parent part group (parent id = the row\'s first part)', () => {
    const rows = groupParts([
      line('K', { part_of: 'K' }),
      line('K-p2', { part_of: 'K' }),
      line('R', { part_of: 'R', line_kind: 'option_child', parent_order_item_id: 'K', name: 'Raita' }),
      line('R-p2', { part_of: 'R', line_kind: 'option_child', parent_order_item_id: 'K-p2', name: 'Raita' }),
    ]);
    expect(rows.map((r) => [r.order_item_id, r.parent_order_item_id, r.live_units])).toEqual([['K', null, 2], ['R', 'K', 2]]);
  });

  it('[02b #42] partEntries: n of a grouped row → n part ids of one unit each; an unsplit line keeps its units', () => {
    const rows = groupParts([line('K', { part_of: 'K' }), line('K-p2', { part_of: 'K' }), line('K-p3', { part_of: 'K' }), line('N', { units: 3, live_units: 3, quantity: 3 })]);
    expect(partEntries(rows, 'K', 2)).toEqual([{ order_item_id: 'K', units: 1 }, { order_item_id: 'K-p2', units: 1 }]);
    expect(partEntries(rows, 'N', 2)).toEqual([{ order_item_id: 'N', units: 2 }]);
  });

  it('[02b #42] Mark served on a grouped row names all its parts; Void of 2 of a grouped row names 2 parts of one unit', () => {
    const rows = groupParts([line('K', { part_of: 'K', stage: 'done' }), line('K-p2', { part_of: 'K', stage: 'done' }), line('K-p3', { part_of: 'K', stage: 'done' })]);
    expect(servedPayload(rows)).toEqual({ lines: [{ order_id: 'O1', order_item_ids: ['K', 'K-p2', 'K-p3'] }] });
    const choice = { reason: 'quality', note: '', disposition: 'wastage', dispositionNote: '' } as const;
    expect(voidPayload({ order_id: 'O1', order_item_id: 'K', units: 2, choice: choice as never, part_ids: rows[0]!.part_ids! })?.lines).toEqual([
      { order_item_id: 'K', units: 1, disposition: 'wastage' },
      { order_item_id: 'K-p2', units: 1, disposition: 'wastage' },
    ]);
  });
});
