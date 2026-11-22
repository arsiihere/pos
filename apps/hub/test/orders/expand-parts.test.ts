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

  it('[02b #37] not split: quantity 1, a batch station, a weighed item, a zone line, a deal', () => {
    const config = menu();
    const lines: SubmitInput['lines'] = [
      { order_item_id: 'A', item_id: FX.piece, quantity: 1 },
      { order_item_id: 'B', item_id: 'I_BREAD', quantity: 6 },
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
