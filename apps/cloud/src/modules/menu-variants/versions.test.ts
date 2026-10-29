import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { describe, expect, it } from 'vitest';
import {
  dealBranchVersion,
  modifierGroupBranchVersion,
  stockItemBranchVersion,
  toDealWire,
  toModifierGroupWire,
  toStockItemWire,
  toVariantGroupWire,
  type DealRow,
  type ModifierGroupRow,
  type ModifierOptionRow,
} from './versions';

const hash = (input: unknown): string => sha256hex(canonicalJson(input));

function anOption(o: Partial<ModifierOptionRow> = {}): ModifierOptionRow {
  return {
    option_id: 'O1',
    name: 'Raita',
    price_minor: 5_000,
    max_quantity: 1,
    is_default: false,
    linked_item_id: null,
    sort_order: 0,
    archived_at: null,
    ...o,
  };
}

function aGroupRow(o: Partial<ModifierGroupRow> = {}): ModifierGroupRow {
  return {
    modifier_group_id: 'MG1',
    name: 'Sides',
    min_choices: 0,
    max_choices: 2,
    sort_order: 1,
    archived_at: null,
    options: [
      anOption({ option_id: 'O3', name: 'Salad', sort_order: 1 }),
      anOption({ option_id: 'O2', name: 'Naan', price_minor: null, linked_item_id: 'I9', sort_order: 0 }),
      anOption({ option_id: 'O1', name: 'Raita', sort_order: 1, is_default: true }),
      anOption({ option_id: 'O0', name: 'Old', archived_at: 500 }),
    ],
    links: [
      { target_kind: 'item', target_id: 'I2', mode: 'detach' },
      { target_kind: 'category', target_id: 'C1', mode: 'attach' },
      { target_kind: 'item', target_id: 'I1', mode: 'attach' },
    ],
    ...o,
  };
}

function aDealRow(o: Partial<DealRow> = {}): DealRow {
  return {
    deal_id: 'D1',
    name: 'Family deal',
    category_id: 'C1',
    tax_class_id: null,
    description: null,
    sort_order: 0,
    price_minor: 250_000,
    archived_at: null,
    availability_windows: [
      { start_ms: 72_000_000, end_ms: 79_200_000 },
      { start_ms: 43_200_000, end_ms: 54_000_000 },
    ],
    parts: [
      {
        deal_part_id: 'P2',
        quantity: 1,
        sort_order: 0,
        archived_at: null,
        choices: [
          { item_id: 'I3', extra_price_minor: 0, sort_order: 1 },
          { item_id: 'I2', extra_price_minor: 10_000, sort_order: 0 },
          { item_id: 'I1', extra_price_minor: 0, sort_order: 1 },
        ],
      },
      { deal_part_id: 'P1', quantity: 2, sort_order: 0, archived_at: null, choices: [{ item_id: 'I5', extra_price_minor: 0, sort_order: 0 }] },
      { deal_part_id: 'P0', quantity: 1, sort_order: 0, archived_at: 900, choices: [] },
    ],
    ...o,
  };
}

const DEAL_INPUT = {
  deal_id: 'D1',
  name: 'Family deal',
  category_id: 'C1',
  tax_class_id: null,
  description: null,
  sort_order: 0,
  price_minor: 250_000,
  archived: false,
  availability_windows: [
    { start_ms: 43_200_000, end_ms: 54_000_000 },
    { start_ms: 72_000_000, end_ms: 79_200_000 },
  ],
  parts: [
    { deal_part_id: 'P1', quantity: 2, sort_order: 0, choices: [{ item_id: 'I5', extra_price_minor: 0, sort_order: 0 }] },
    {
      deal_part_id: 'P2',
      quantity: 1,
      sort_order: 0,
      choices: [
        { item_id: 'I2', extra_price_minor: 10_000, sort_order: 0 },
        { item_id: 'I1', extra_price_minor: 0, sort_order: 1 },
        { item_id: 'I3', extra_price_minor: 0, sort_order: 1 },
      ],
    },
  ],
};

describe('menu-variants versions (01c §5.4, V13)', () => {
  it('[01c §5.4] variant group: exactly the six input keys; member_ids and archived_at time are not hashed', () => {
    const row = {
      variant_group_id: 'VG1',
      name: 'Karahi',
      category_id: 'C1',
      description: null,
      sort_order: 2,
      archived_at: null,
      member_ids: ['I2', 'I1'],
    };
    const wire = toVariantGroupWire(row);
    expect(wire).toEqual({ ...row, member_ids: ['I1', 'I2'], version: wire.version });
    expect(wire.version).toBe(
      hash({ variant_group_id: 'VG1', name: 'Karahi', category_id: 'C1', description: null, sort_order: 2, archived: false }),
    );
    expect(toVariantGroupWire({ ...row, member_ids: [] }).version).toBe(wire.version);
    const archived = toVariantGroupWire({ ...row, archived_at: 1_000 });
    expect(archived.version).not.toBe(wire.version);
    expect(toVariantGroupWire({ ...row, archived_at: '2000' }).version).toBe(archived.version);
    expect(toVariantGroupWire({ ...row, archived_at: '2000' }).archived_at).toBe(2_000);
  });

  it('[01c §5.4] stock item: exactly the five input keys', () => {
    const row = { stock_item_id: 'SI1', name: 'Naan dough', stock_unit: 'g' as const, carries_over: true, archived_at: null };
    const wire = toStockItemWire(row);
    expect(wire).toEqual({ ...row, version: wire.version });
    expect(wire.version).toBe(hash({ stock_item_id: 'SI1', name: 'Naan dough', stock_unit: 'g', carries_over: true, archived: false }));
  });

  it('[01c §5.4] stock item branch: exactly the five keys; no row is is_counted: false and stable; BIGINT strings hash like numbers', () => {
    const set = stockItemBranchVersion('SI1', 'B1', { station_id: 'ST1', low_stock_threshold: 20 });
    expect(set).toEqual({ branch_id: 'B1', station_id: 'ST1', low_stock_threshold: 20, version: set.version });
    expect(set.version).toBe(hash({ stock_item_id: 'SI1', branch_id: 'B1', is_counted: true, station_id: 'ST1', low_stock_threshold: 20 }));
    expect(stockItemBranchVersion('SI1', 'B1', { station_id: 'ST1', low_stock_threshold: '20' }).version).toBe(set.version);
    const none = stockItemBranchVersion('SI1', 'B1', null);
    expect(none).toEqual({ branch_id: 'B1', station_id: null, low_stock_threshold: null, version: none.version });
    expect(none.version).toBe(hash({ stock_item_id: 'SI1', branch_id: 'B1', is_counted: false, station_id: null, low_stock_threshold: null }));
    expect(stockItemBranchVersion('SI1', 'B1', null).version).toBe(none.version);
    expect(stockItemBranchVersion('SI1', 'B2', null).version).not.toBe(none.version);
  });

  it('[01c §5.4] modifier group: active options by sort_order then option_id, links by kind then id; archived options and branches not hashed', () => {
    const wire = toModifierGroupWire(aGroupRow(), [], []);
    const options = [
      { option_id: 'O2', name: 'Naan', price_minor: null, max_quantity: 1, is_default: false, linked_item_id: 'I9', sort_order: 0 },
      { option_id: 'O1', name: 'Raita', price_minor: 5_000, max_quantity: 1, is_default: true, linked_item_id: null, sort_order: 1 },
      { option_id: 'O3', name: 'Salad', price_minor: 5_000, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 1 },
    ];
    const links = [
      { target_kind: 'category', target_id: 'C1', mode: 'attach' },
      { target_kind: 'item', target_id: 'I1', mode: 'attach' },
      { target_kind: 'item', target_id: 'I2', mode: 'detach' },
    ];
    expect(wire.version).toBe(
      hash({ modifier_group_id: 'MG1', name: 'Sides', min_choices: 0, max_choices: 2, sort_order: 1, archived: false, options, links }),
    );
    expect(wire.options).toEqual(options);
    expect(wire.links).toEqual(links);
    expect(wire.archived_options).toEqual([{ option_id: 'O0', name: 'Old' }]);
    expect(wire.archived_at).toBeNull();
    expect(toModifierGroupWire(aGroupRow({ options: aGroupRow().options.slice().reverse() }), [], []).version).toBe(wire.version);
    expect(toModifierGroupWire(aGroupRow({ options: aGroupRow().options.slice(0, 3) }), ['B1'], []).version).toBe(wire.version);
    const asStrings = aGroupRow().options.map((option) => ({ ...option, price_minor: option.price_minor === null ? null : String(option.price_minor) }));
    expect(toModifierGroupWire(aGroupRow({ options: asStrings }), [], []).version).toBe(wire.version);
  });

  it('[01c §5.4, V19] modifier group at a branch: active options only, by option_id; no rows → [] and stable', () => {
    const active = new Set(['O1', 'O3']);
    const rows = [
      { option_id: 'O3', is_offered: true, price_minor_override: '7000' },
      { option_id: 'O1', is_offered: false, price_minor_override: null },
      { option_id: 'O0', is_offered: false, price_minor_override: null },
    ];
    const branch = modifierGroupBranchVersion('MG1', 'B1', rows, active);
    const options = [
      { option_id: 'O1', is_offered: false, price_minor_override: null },
      { option_id: 'O3', is_offered: true, price_minor_override: 7_000 },
    ];
    expect(branch).toEqual({ branch_id: 'B1', options, version: hash({ modifier_group_id: 'MG1', branch_id: 'B1', options }) });
    const none = modifierGroupBranchVersion('MG1', 'B1', [], active);
    expect(none.version).toBe(hash({ modifier_group_id: 'MG1', branch_id: 'B1', options: [] }));
    expect(modifierGroupBranchVersion('MG1', 'B1', [rows[2]!], active).version).toBe(none.version);

    const wire = toModifierGroupWire(aGroupRow(), ['B2', 'B1'], [
      { branch_id: 'B1', option_id: 'O3', is_offered: true, price_minor_override: 7_000 },
      { branch_id: 'B1', option_id: 'O1', is_offered: false, price_minor_override: null },
      { branch_id: 'B1', option_id: 'O0', is_offered: false, price_minor_override: null },
    ]);
    expect(wire.branches).toEqual([
      modifierGroupBranchVersion('MG1', 'B1', rows, new Set(['O1', 'O2', 'O3'])),
      modifierGroupBranchVersion('MG1', 'B2', [], new Set(['O1', 'O2', 'O3'])),
    ]);
  });

  it('[01c §5.4] deal: windows by start then end, active parts by sort_order then id, choices by sort_order then item_id', () => {
    const wire = toDealWire(aDealRow());
    expect(wire.version).toBe(hash(DEAL_INPUT));
    expect(wire.parts).toEqual(DEAL_INPUT.parts);
    expect(wire.availability_windows).toEqual(DEAL_INPUT.availability_windows);
    expect(wire.archived_parts).toEqual([{ deal_part_id: 'P0' }]);
    const strings = aDealRow({
      price_minor: '250000',
      parts: aDealRow().parts.map((part) => ({
        ...part,
        choices: part.choices.map((c) => ({ ...c, extra_price_minor: String(c.extra_price_minor) })),
      })),
    });
    expect(toDealWire(strings).version).toBe(wire.version);
    expect(toDealWire(strings).price_minor).toBe(250_000);
    expect(toDealWire(aDealRow({ archived_at: 5 })).version).toBe(hash({ ...DEAL_INPUT, archived: true }));
  });

  it('[01c §5.4] deal branch: exactly the four keys; no row is is_sold: false and stable', () => {
    const sold = dealBranchVersion('D1', 'B1', { price_minor_override: '230000' });
    expect(sold).toEqual({
      branch_id: 'B1',
      is_sold: true,
      price_minor_override: 230_000,
      version: hash({ deal_id: 'D1', branch_id: 'B1', is_sold: true, price_minor_override: 230_000 }),
    });
    const none = dealBranchVersion('D1', 'B1', null);
    expect(none).toEqual({
      branch_id: 'B1',
      is_sold: false,
      price_minor_override: null,
      version: hash({ deal_id: 'D1', branch_id: 'B1', is_sold: false, price_minor_override: null }),
    });
    expect(dealBranchVersion('D1', 'B1', null).version).toBe(none.version);
    expect(dealBranchVersion('D1', 'B1', { price_minor_override: null }).version).not.toBe(none.version);
  });
});
