// 02b v1.0.20 §3.2 step 4a (STAB-5 phase 1, tests 37, 38): expandParts (pure) sends a slot-station piece line of
// quantity n as n one-unit lines with part_of; buildSubmit copies part_of to the line and its children.
import type { IsAvailable } from '@pos/domain';
import type { BranchConfig, ConfigItem } from '@pos/events';
import { describe, expect, it } from 'vitest';
import { buildSubmit } from '../../src/orders/build-submit';
import type { BuildSubmitCtx, SubmitInput } from '../../src/orders/contracts';
import { expandParts } from '../../src/orders/expand-parts';
import { FX, fixtureMenu } from './fixtures';

const ON: IsAvailable = () => true;
const NOW = Date.UTC(2026, 10, 10, 4, 0);

function menu(): BranchConfig {
  const base = fixtureMenu();
  const plain = base.items.find((i) => i.item_id === FX.naan)!;
  const item = (item_id: string, o: Partial<ConfigItem>): ConfigItem => ({ ...plain, item_id, name: item_id, ...o });
  return {
    ...base,
    stations: [...base.stations, { ...base.stations[0]!, station_id: 'S_TANDOOR', name: 'Tandoor', station_type: 'batch', programs: [{ program_id: 'PR', name: 'Bake', cook_time_ms: 180_000, is_archived: false }] }],
    items: [
      ...base.items,
      item('I_BREAD', { station_id: 'S_TANDOOR', program_id: 'PR' }),
      item('I_MEAT_KG', { requires_weighing: true, sale_unit: 'g' }),
    ],
  };
}
function ctx(config: BranchConfig, o: Partial<BuildSubmitCtx> = {}): BuildSubmitCtx {
  const draws: BuildSubmitCtx['draws'] = (item_id) => {
    const i = config.items.find((x) => x.item_id === item_id);
    return { sale_unit: i?.sale_unit ?? 'piece', stock_draws: (i?.stock_draws ?? []).map((d) => ({ ...d })) };
  };
  return { now: NOW, utc_offset_ms: 5 * 3_600_000, isAvailable: ON, draws, primary_table_id: null, follow_up: false, ...o };
}
const takeaway = (lines: SubmitInput['lines']): SubmitInput => ({ order_id: 'O1', order_type: 'takeaway', lines });

describe('[02b v1.0.20 §3.2 step 4a] expandParts', () => {
  it('[02b #37] karahi ×5 on a slot station → 5 lines of 1 (K, K-p2 … K-p5), each part_of K; totals sum to the unsplit line', () => {
    const config = menu();
    const input = takeaway([{ order_item_id: 'K', item_id: FX.piece, quantity: 5, kitchen_note: 'less oil' }]);
    const expanded = expandParts(config, input, ctx(config));
    expect(expanded.lines.map((l) => [l.order_item_id, l.quantity, l.part_of, l.kitchen_note])).toEqual([
      ['K', 1, 'K', 'less oil'],
      ['K-p2', 1, 'K', 'less oil'],
      ['K-p3', 1, 'K', 'less oil'],
      ['K-p4', 1, 'K', 'less oil'],
      ['K-p5', 1, 'K', 'less oil'],
    ]);
    const built = buildSubmit(config, expanded, ctx(config));
    expect(built.itemAdded.map((a) => [a.order_item_id, a.quantity, a.part_of])).toEqual(expanded.lines.map((l) => [l.order_item_id, 1, 'K']));
    const whole = buildSubmit(config, input, ctx(config));
    expect(built.itemAdded.reduce((n, a) => n + (a.line_total_minor ?? 0), 0)).toBe(whole.itemAdded[0]!.line_total_minor);
    expect(whole.itemAdded[0]!.part_of).toBeUndefined();
    expect(built.proposed.lines.map((l) => l.order_item_id)).toEqual(['K', 'K-p2', 'K-p3', 'K-p4', 'K-p5']);
  });

  it('[02b #38] a linked option gives one child per part (R, R-p2 …, part_of R); a plain option and the note on every part', () => {
    const config = menu();
    const input = takeaway([{ order_item_id: 'K', item_id: FX.piece, quantity: 3, options: [{ option_id: FX.option, quantity: 1, order_item_id: 'R' }] }]);
    const expanded = expandParts(config, input, ctx(config));
    expect(expanded.lines.map((l) => l.options?.map((o) => [o.order_item_id, o.part_of]))).toEqual([[['R', 'R']], [['R-p2', 'R']], [['R-p3', 'R']]]);
    const built = buildSubmit(config, expanded, ctx(config));
    const children = built.itemAdded.filter((a) => a.line_kind === 'option_child');
    expect(children.map((c) => [c.order_item_id, c.parent_order_item_id, c.quantity, c.part_of])).toEqual([
      ['R', 'K', 1, 'R'],
      ['R-p2', 'K-p2', 1, 'R'],
      ['R-p3', 'K-p3', 1, 'R'],
    ]);
  });

  // ⚠️ 02b v1.0.23 §3.2 step 4a (STAB-6): a batch-station piece line is now split per unit too (was: "not split: …, a
  // batch station, …").
  it('[02b #37] naan ×10 on a batch station → 10 lines of 1 (N, N-p2 … N-p10), each part_of N; totals sum to the unsplit line', () => {
    const config = menu();
    const input = takeaway([{ order_item_id: 'N', item_id: 'I_BREAD', quantity: 10 }]);
    const expanded = expandParts(config, input, ctx(config));
    expect(expanded.lines.map((l) => [l.order_item_id, l.quantity, l.part_of])).toEqual(
      Array.from({ length: 10 }, (_, i) => [i === 0 ? 'N' : `N-p${i + 1}`, 1, 'N']),
    );
    const built = buildSubmit(config, expanded, ctx(config));
    const whole = buildSubmit(config, input, ctx(config));
    expect(built.itemAdded.reduce((n, a) => n + (a.line_total_minor ?? 0), 0)).toBe(whole.itemAdded[0]!.line_total_minor);
    expect(built.itemAdded.map((a) => a.station_id)).toEqual(Array.from({ length: 10 }, () => 'S_TANDOOR'));
  });

  it('[02b #37] not split: quantity 1, a weighed item, a zone line, a deal', () => {
    const config = menu();
    const lines: SubmitInput['lines'] = [
      { order_item_id: 'A', item_id: FX.piece, quantity: 1 },
      { order_item_id: 'C', item_id: 'I_MEAT_KG', quantity: 750 },
      { order_item_id: 'Z', item_id: FX.piece, quantity: 2, from_zone: true },
    ];
    const expanded = expandParts(config, takeaway(lines), ctx(config));
    expect(expanded.lines).toEqual(lines);
  });
});

// 02b v1.0.21 §3.2 / §6.1 (STAB-5 owner option C, test 43): the serve choice at send.
describe('[02b v1.0.21] serve choice', () => {
  it('[02b #43] a line value wins over the order value, the order value over the item; every part and child takes it', () => {
    const config = menu();
    const itemMode = config.items.find((i) => i.item_id === FX.piece)!.serve_mode;
    const other = itemMode === 'sync' ? 'immediate' : 'sync';
    const lines: SubmitInput['lines'] = [
      { order_item_id: 'A', item_id: FX.piece, quantity: 2, options: [{ option_id: FX.option, quantity: 1, order_item_id: 'R' }] },
      { order_item_id: 'B', item_id: FX.piece, quantity: 1, serve_mode: itemMode },
    ];
    const modes = (input: SubmitInput) => {
      const built = buildSubmit(config, expandParts(config, input, ctx(config)), ctx(config));
      return Object.fromEntries(built.itemAdded.map((a) => [a.order_item_id, a.serve_mode]));
    };
    expect(modes(takeaway(lines))).toEqual({ A: itemMode, 'A-p2': itemMode, R: expect.any(String), 'R-p2': expect.any(String), B: itemMode });
    const chosen = modes({ ...takeaway(lines), serve_mode: other });
    expect([chosen.A, chosen['A-p2'], chosen.R, chosen['R-p2']]).toEqual([other, other, other, other]);
    expect(chosen.B).toBe(itemMode); // the line's own value wins
  });
});

// 02b v1.0.22 §3.2 step 4a (STAB-5 phase 5, test 45): a deal is split per deal unit when a part cooks on a slot station.
describe('[02b v1.0.22] deals split per deal unit', () => {
  it('[02b #45] deal ×2 with a slot-station part → D, D-p2 with their parts (Da, Da-p2 …), part_of on headers and parts; totals sum to the unsplit deal', () => {
    const config = menu();
    const deal = { order_item_id: 'D', deal_id: FX.deal, quantity: 2, deal_choices: [
      { deal_part_id: FX.dealParts[0]!, item_id: FX.piece, order_item_id: 'Da' },
      { deal_part_id: FX.dealParts[1]!, item_id: FX.naan, order_item_id: 'Db' },
    ] };
    const input = takeaway([deal]);
    const expanded = expandParts(config, input, ctx(config));
    expect(expanded.lines.map((l) => [l.order_item_id, l.quantity, l.part_of, l.deal_choices?.map((c) => [c.order_item_id, c.part_of])])).toEqual([
      ['D', 1, 'D', [['Da', 'Da'], ['Db', 'Db']]],
      ['D-p2', 1, 'D', [['Da-p2', 'Da'], ['Db-p2', 'Db']]],
    ]);
    const built = buildSubmit(config, expanded, ctx(config));
    const headers = built.itemAdded.filter((a) => a.line_kind === 'deal');
    expect(headers.map((h) => [h.order_item_id, h.quantity, h.part_of])).toEqual([['D', 1, 'D'], ['D-p2', 1, 'D']]);
    expect(built.itemAdded.filter((a) => a.line_kind === 'deal_part').map((p) => [p.order_item_id, p.part_of])).toEqual([['Da', 'Da'], ['Db', 'Db'], ['Da-p2', 'Da'], ['Db-p2', 'Db']]);
    const whole = buildSubmit(config, input, ctx(config));
    const total = (xs: typeof built.itemAdded) => xs.filter((a) => a.line_kind === 'deal').reduce((n, a) => n + (a.line_total_minor ?? 0), 0);
    expect(total(built.itemAdded)).toBe(total(whole.itemAdded));
    const allocated = (xs: typeof built.itemAdded) => xs.filter((a) => a.line_kind === 'deal_part').reduce((n, a) => n + (a.allocated_price_minor ?? 0), 0);
    expect(allocated(built.itemAdded)).toBe(allocated(whole.itemAdded));
  });

  // ⚠️ 02b v1.0.23 §3.2 step 4a (STAB-6): a deal whose only cooked part is on a batch station is split per deal unit too
  // (was: "a deal whose parts are all batch / weighed stays one line"); a part of quantity > 1 within one deal unit is
  // not split (Q5, m-1).
  it('[02b #45] deal ×2 whose cooked part is a naan on a batch station → D, D-p2; a deal of weighed parts only stays one line', () => {
    const base = menu();
    const config: BranchConfig = {
      ...base,
      items: [...base.items, { ...base.items.find((i) => i.item_id === 'I_MEAT_KG')!, item_id: 'I_MEAT2' }],
      deals: [
        { ...base.deals[0]!, deal_id: 'D_BREAD', parts: [{ deal_part_id: 'DP_B', quantity: 2, sort_order: 0, choices: [{ item_id: 'I_BREAD', extra_price_minor: 0, sort_order: 0 }] }] },
        { ...base.deals[0]!, deal_id: 'D_KG', parts: [{ deal_part_id: 'DP_K', quantity: 1, sort_order: 0, choices: [{ item_id: 'I_MEAT_KG', extra_price_minor: 0, sort_order: 0 }] }] },
      ],
    };
    const bread = { order_item_id: 'D', deal_id: 'D_BREAD', quantity: 2, deal_choices: [{ deal_part_id: 'DP_B', item_id: 'I_BREAD', order_item_id: 'Db' }] };
    const kg = { order_item_id: 'G', deal_id: 'D_KG', quantity: 2, deal_choices: [{ deal_part_id: 'DP_K', item_id: 'I_MEAT_KG', order_item_id: 'Gk' }] };
    const expanded = expandParts(config, takeaway([bread, kg]), ctx(config));
    expect(expanded.lines.map((l) => [l.order_item_id, l.quantity, l.part_of, l.deal_choices?.map((c) => [c.order_item_id, c.part_of])])).toEqual([
      ['D', 1, 'D', [['Db', 'Db']]],
      ['D-p2', 1, 'D', [['Db-p2', 'Db']]],
      ['G', 2, undefined, [['Gk', undefined]]],
    ]);
    // the naan part of quantity 2 inside one deal unit stays one line of 2 (Q5)
    const built = buildSubmit(config, expanded, ctx(config));
    expect(built.itemAdded.filter((a) => a.line_kind === 'deal_part' && a.station_id === 'S_TANDOOR').map((a) => [a.order_item_id, a.quantity])).toEqual([['Db', 2], ['Db-p2', 2]]);
  });
});

