// 02b §3.2 steps 3–7, §3.1, §3.10 routing, O3–O5 (zone candidates only), D25, 01c §4.3 / §3.4: buildSubmit is pure.
// No DB, no clock: the config, the payload and ctx are all it reads.
import { DomainError, type IsAvailable } from '@pos/domain';
import type { BranchConfig, ConfigItem, ItemAddedPayload } from '@pos/events';
import { describe, expect, it } from 'vitest';
import type { BuildSubmitCtx, SubmitInput } from '../../src/orders/contracts';
import { buildSubmit } from '../../src/orders/build-submit';
import { FX, fixtureMenu } from './fixtures';

const PKT = 5 * 3_600_000;
/** 04:00 UTC = 09:00 hub time (PKT) */
const NOW = Date.UTC(2026, 10, 10, 4, 0);
const ON: IsAvailable = () => true;

function ctx(o: Partial<BuildSubmitCtx> = {}): BuildSubmitCtx {
  return { now: NOW, utc_offset_ms: PKT, isAvailable: ON, primary_table_id: FX.table, follow_up: false, ...o };
}

const dineIn = (lines: SubmitInput['lines'], o: Partial<SubmitInput> = {}): SubmitInput => ({
  order_id: 'O1',
  order_type: 'dine_in',
  table_id: FX.table,
  seating_id: 'SEAT1',
  lines,
  ...o,
});

function caught(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error('expected a DomainError');
}

/** fixtureMenu() plus a family deal (01c §4.3 example), a batch station and a plain option group. */
function menu(): BranchConfig {
  const base = fixtureMenu();
  const plain = base.items.find((i) => i.item_id === FX.naan)!;
  const item = (item_id: string, name: string, o: Partial<ConfigItem>): ConfigItem => ({ ...plain, item_id, name, ...o });
  return {
    ...base,
    variant_groups: [{ variant_group_id: 'V_CK', category_id: 'C1', name: 'Chicken Karahi', description: null, sort_order: 0 }],
    tax_classes: [{ tax_class_id: 'X1', name: 'GST', rate_bp: 1_600, is_archived: false }],
    categories: [...base.categories, { category_id: 'C_DEAL', name: 'Deals', sort_order: 2, availability_windows: [] }],
    stations: [
      ...base.stations,
      {
        ...base.stations[0]!,
        station_id: 'S_TANDOOR',
        name: 'Tandoor',
        station_type: 'batch',
        freshness_window_ms: 600_000,
        programs: [
          { program_id: 'PR_BAKE', name: 'Bake', cook_time_ms: 480_000, is_archived: false },
          { program_id: 'PR_WARM', name: 'Warm', cook_time_ms: 120_000, is_archived: false },
        ],
      },
    ],
    modifier_groups: [
      // up to 5 raita per karahi (fixtureMenu allows 1 choice), so a child quantity 2 × 2 can be asserted
      ...base.modifier_groups.map((g) => (g.modifier_group_id === FX.optionGroup ? { ...g, max_choices: 5 } : g)),
      {
        modifier_group_id: 'M_EXTRA',
        name: 'Extras',
        min_choices: 0,
        max_choices: 2,
        sort_order: 1,
        has_plain_options: true,
        options: [{ option_id: 'O_BUTTER', name: 'Butter', price_minor: 2_000, max_quantity: 2, is_default: false, linked_item_id: null, sort_order: 0 }],
      },
      { modifier_group_id: 'M_SAUCE', name: 'Sauce', min_choices: 1, max_choices: 1, sort_order: 2, has_plain_options: true, options: [] },
    ],
    items: [
      ...base.items.map((i) => (i.item_id === FX.piece ? { ...i, tax_class_id: 'X1', modifier_group_ids: [FX.optionGroup, 'M_EXTRA'] } : i)),
      item('I_FULL', 'Chicken Karahi — Full', {
        price_minor: 220_000,
        variant_group_id: 'V_CK',
        variant_name: 'Full',
        cook_time_ms: 1_500_000,
        modifier_group_ids: ['M_EXTRA'],
      }),
      item('I_ROGHNI', 'Roghni Naan', { price_minor: 5_000 }),
      item('I_LASSI', 'Lassi jug', { price_minor: 75_000 }),
      item('I_BREAD', 'Tandoor bread', {
        station_id: 'S_TANDOOR',
        program_id: 'PR_BAKE',
        stock_program_id: 'PR_WARM',
        price_minor: 4_000,
      }),
      item('I_SET', 'Set plate', { modifier_group_ids: ['M_SAUCE'] }),
      item('I_BREAKFAST', 'Halwa puri', { availability_windows: [{ start_ms: 8 * 3_600_000, end_ms: 11 * 3_600_000 }] }),
    ],
    deals: [
      ...base.deals,
      {
        deal_id: 'D_FAMILY',
        category_id: 'C_DEAL',
        name: 'Family karahi deal',
        description: null,
        sort_order: 2,
        price_minor: 320_000,
        tax_class_id: 'X1',
        availability_windows: [],
        parts: [
          { deal_part_id: 'P_MAIN', quantity: 1, sort_order: 0, choices: [{ item_id: 'I_FULL', extra_price_minor: 0, sort_order: 0 }] },
          {
            deal_part_id: 'P_NAAN',
            quantity: 4,
            sort_order: 1,
            choices: [
              { item_id: FX.naan, extra_price_minor: 0, sort_order: 0 },
              { item_id: 'I_ROGHNI', extra_price_minor: 3_000, sort_order: 1 },
            ],
          },
          { deal_part_id: 'P_LASSI', quantity: 1, sort_order: 2, choices: [{ item_id: 'I_LASSI', extra_price_minor: 0, sort_order: 0 }] },
        ],
      },
    ],
  };
}

const familyDeal = (naan: string, quantity = 1): SubmitInput['lines'][number] => ({
  order_item_id: 'L_DEAL',
  deal_id: 'D_FAMILY',
  quantity,
  deal_choices: [
    { deal_part_id: 'P_MAIN', item_id: 'I_FULL', order_item_id: 'L_MAIN', options: [{ option_id: 'O_BUTTER', quantity: 1 }] },
    { deal_part_id: 'P_NAAN', item_id: naan, order_item_id: 'L_NAAN' },
    { deal_part_id: 'P_LASSI', item_id: 'I_LASSI', order_item_id: 'L_LASSI' },
  ],
});

const added = (out: { itemAdded: ItemAddedPayload[] }, id: string): ItemAddedPayload => {
  const line = out.itemAdded.find((a) => a.order_item_id === id);
  if (line === undefined) throw new Error(`no line ${id}`);
  return line;
};

describe('buildSubmit — 01c §4.3 copies [02b #2]', () => {
  it('[02b #2] an item line with a plain option and a linked option copies every 01c §4.3 field; the child follows its parent', () => {
    const out = buildSubmit(
      menu(),
      dineIn([
        {
          order_item_id: 'L1',
          item_id: FX.piece,
          quantity: 2,
          kitchen_note: 'less oil',
          options: [
            { option_id: 'O_BUTTER', quantity: 1 },
            { option_id: FX.option, quantity: 2, order_item_id: 'L1_RAITA' },
          ],
        },
      ]),
      ctx(),
    );
    expect(out.itemAdded.map((a) => a.order_item_id)).toEqual(['L1', 'L1_RAITA']);
    expect(added(out, 'L1')).toEqual({
      order_id: 'O1',
      order_item_id: 'L1',
      parent_order_item_id: null,
      line_kind: 'item',
      item_id: FX.piece,
      deal_id: null,
      deal_part_id: null,
      option_id: null,
      option_quantity: null,
      variant_group_id: null,
      variant_group_name: null,
      variant_name: null,
      name: 'Chicken Karahi',
      category_id: 'C1',
      requires_weighing: false,
      quantity: 2,
      sale_unit: 'piece',
      price_minor: 120_000,
      extra_price_minor: null,
      allocated_price_minor: null,
      tax_class_id: 'X1',
      station_id: FX.station,
      program_id: null,
      stock_program_id: null,
      program_cook_time_ms: null,
      stock_program_cook_time_ms: null,
      serve_mode: 'sync',
      prep_buffer_ms: 0,
      cook_time_ms: 1_200_000,
      stock_time_ms: 300_000,
      out_of_stock_behaviour: 'cook_fresh',
      stock_draws: [{ stock_item_id: FX.stock, quantity: 1_000 }],
      options: [{ option_id: 'O_BUTTER', modifier_group_id: 'M_EXTRA', name: 'Butter', price_minor: 2_000, quantity: 1, charge_minor: 4_000 }],
      line_total_minor: 244_000,
      kitchen_note: 'less oil',
      served_from_zone_id: null,
      is_ready_item: false,
    } satisfies ItemAddedPayload);
    expect(added(out, 'L1_RAITA')).toEqual({
      order_id: 'O1',
      order_item_id: 'L1_RAITA',
      parent_order_item_id: 'L1',
      line_kind: 'option_child',
      item_id: FX.optionItem,
      deal_id: null,
      deal_part_id: null,
      option_id: FX.option,
      option_quantity: 2,
      variant_group_id: null,
      variant_group_name: null,
      variant_name: null,
      name: 'Raita',
      category_id: 'C1',
      requires_weighing: false,
      quantity: 4,
      sale_unit: 'piece',
      price_minor: 10_000,
      extra_price_minor: null,
      allocated_price_minor: null,
      tax_class_id: null,
      station_id: FX.station,
      program_id: null,
      stock_program_id: null,
      program_cook_time_ms: null,
      stock_program_cook_time_ms: null,
      serve_mode: 'sync',
      prep_buffer_ms: 0,
      cook_time_ms: 60_000,
      stock_time_ms: null,
      out_of_stock_behaviour: 'cook_fresh',
      stock_draws: [],
      options: [],
      line_total_minor: 40_000,
      kitchen_note: null,
      served_from_zone_id: null,
      is_ready_item: false,
    } satisfies ItemAddedPayload);
  });

  it('[02b #2] family deal: allocation 229 315 / 12 508 / 78 177 by the reference choice; the deal line carries the bill', () => {
    const out = buildSubmit(menu(), dineIn([familyDeal(FX.naan)]), ctx());
    expect(out.itemAdded.map((a) => a.order_item_id)).toEqual(['L_DEAL', 'L_MAIN', 'L_NAAN', 'L_LASSI']);
    expect(added(out, 'L_DEAL')).toEqual({
      order_id: 'O1',
      order_item_id: 'L_DEAL',
      parent_order_item_id: null,
      line_kind: 'deal',
      item_id: null,
      deal_id: 'D_FAMILY',
      deal_part_id: null,
      option_id: null,
      option_quantity: null,
      variant_group_id: null,
      variant_group_name: null,
      variant_name: null,
      name: 'Family karahi deal',
      category_id: 'C_DEAL',
      requires_weighing: false,
      quantity: 1,
      sale_unit: 'piece',
      price_minor: 320_000,
      extra_price_minor: null,
      allocated_price_minor: null,
      tax_class_id: 'X1',
      station_id: null,
      program_id: null,
      stock_program_id: null,
      program_cook_time_ms: null,
      stock_program_cook_time_ms: null,
      serve_mode: null,
      prep_buffer_ms: null,
      cook_time_ms: null,
      stock_time_ms: null,
      out_of_stock_behaviour: null,
      stock_draws: [],
      options: [],
      // 320 000 + the main part's butter (2 000 × 1 × 1 deal portion, 01c §3.4.3)
      line_total_minor: 322_000,
      kitchen_note: null,
      served_from_zone_id: null,
      is_ready_item: false,
    } satisfies ItemAddedPayload);
    expect(added(out, 'L_MAIN')).toEqual({
      order_id: 'O1',
      order_item_id: 'L_MAIN',
      parent_order_item_id: 'L_DEAL',
      line_kind: 'deal_part',
      item_id: 'I_FULL',
      deal_id: 'D_FAMILY',
      deal_part_id: 'P_MAIN',
      option_id: null,
      option_quantity: null,
      variant_group_id: 'V_CK',
      variant_group_name: 'Chicken Karahi',
      variant_name: 'Full',
      name: 'Chicken Karahi — Full',
      category_id: 'C_DEAL',
      requires_weighing: false,
      quantity: 1,
      sale_unit: 'piece',
      price_minor: 220_000,
      extra_price_minor: 0,
      allocated_price_minor: 229_315,
      tax_class_id: 'X1',
      station_id: FX.station,
      program_id: null,
      stock_program_id: null,
      program_cook_time_ms: null,
      stock_program_cook_time_ms: null,
      serve_mode: 'sync',
      prep_buffer_ms: 0,
      cook_time_ms: 1_500_000,
      stock_time_ms: null,
      out_of_stock_behaviour: 'cook_fresh',
      stock_draws: [],
      options: [{ option_id: 'O_BUTTER', modifier_group_id: 'M_EXTRA', name: 'Butter', price_minor: 2_000, quantity: 1, charge_minor: 2_000 }],
      line_total_minor: 0,
      kitchen_note: null,
      served_from_zone_id: null,
      is_ready_item: false,
    } satisfies ItemAddedPayload);
    expect([added(out, 'L_NAAN'), added(out, 'L_LASSI')].map((l) => [l.quantity, l.allocated_price_minor, l.line_total_minor, l.category_id])).toEqual([
      [4, 12_508, 0, 'C_DEAL'],
      [1, 78_177, 0, 'C_DEAL'],
    ]);
  });

  it('[02b #2] a choice with an extra: the weight stays the reference choice (M9), the extra goes to that part only (B2)', () => {
    const out = buildSubmit(menu(), dineIn([familyDeal('I_ROGHNI', 2)]), ctx());
    // deal ×2: 640 000 allocated by the same weights; roghni extra 3 000 × 4 × 2 on the naan part
    expect(['L_MAIN', 'L_NAAN', 'L_LASSI'].map((id) => added(out, id).allocated_price_minor)).toEqual([458_631, 25_016 + 24_000, 156_353]);
    expect(added(out, 'L_NAAN')).toMatchObject({ item_id: 'I_ROGHNI', name: 'Roghni Naan', quantity: 8, price_minor: 5_000, extra_price_minor: 3_000 });
    // 640 000 + roghni 24 000 + butter 2 000 × 1 × 2
    expect(added(out, 'L_DEAL')).toMatchObject({ quantity: 2, line_total_minor: 668_000 });
  });

  it('[02b #2] a batch route copies the program cook times from the snapshot programs (B1); a slot route has none', () => {
    const out = buildSubmit(menu(), dineIn([{ order_item_id: 'L1', item_id: 'I_BREAD', quantity: 3 }, { order_item_id: 'L2', item_id: FX.naan, quantity: 1 }]), ctx());
    expect(added(out, 'L1')).toMatchObject({
      station_id: 'S_TANDOOR',
      program_id: 'PR_BAKE',
      stock_program_id: 'PR_WARM',
      program_cook_time_ms: 480_000,
      stock_program_cook_time_ms: 120_000,
      line_total_minor: 12_000,
    });
    expect(added(out, 'L2')).toMatchObject({ program_cook_time_ms: null, stock_program_cook_time_ms: null });
  });

  it('[02b #2] a weighed line without a weight: quantity and total null; is_ready_item copied', () => {
    const out = buildSubmit(menu(), dineIn([{ order_item_id: 'L1', item_id: FX.gram }, { order_item_id: 'L2', item_id: FX.ready, quantity: 2 }]), ctx());
    expect(added(out, 'L1')).toMatchObject({ requires_weighing: true, quantity: null, sale_unit: 'g', line_total_minor: null, stock_draws: [] });
    expect(added(out, 'L2')).toMatchObject({ is_ready_item: true, line_total_minor: 16_000 });
  });
});

describe('buildSubmit — ProposedOrder [02b §3.2 step 7, §3.1]', () => {
  it('[02b §3.2] every line, deal header included, in itemAdded order; the 03a §4.2 fields from the item and its station', () => {
    const out = buildSubmit(menu(), dineIn([familyDeal(FX.naan), { order_item_id: 'L1', item_id: FX.piece, quantity: 1 }]), ctx({ follow_up: true }));
    expect(out.proposed.order_id).toBe('O1');
    expect(out.proposed.order).toEqual({ order_type: 'dine_in', table_id: FX.table, table_key: 'dine_in:SEAT1', follow_up: true, pickup_at_ms: null });
    expect(out.proposed.lines.map((l) => l.order_item_id)).toEqual(out.itemAdded.map((a) => a.order_item_id));
    const { alternates, point_id, carry_ms, weight_pct, max_early_ms, max_late_ms, max_carry_ms, cook_ms_override, return_of, ...rest } =
      out.proposed.lines.find((l) => l.order_item_id === 'L1')!;
    expect(rest).toEqual(added(out, 'L1'));
    expect({ alternates, point_id, carry_ms, weight_pct, max_early_ms, max_late_ms, max_carry_ms, cook_ms_override, return_of }).toEqual({
      alternates: [],
      point_id: 'P1',
      carry_ms: 0,
      weight_pct: 100,
      max_early_ms: 60_000,
      max_late_ms: null,
      max_carry_ms: null,
      cook_ms_override: null,
      return_of: null,
    });
    expect(out.zoneCandidates).toEqual([]);
  });

  it('[02b §3.2] step 6: alternates, home and carry from 01a A-9 / A-10 for the order type', () => {
    const base = menu();
    const config: BranchConfig = {
      ...base,
      stations: base.stations.map((s) =>
        s.station_id === FX.station
          ? { ...s, alternates: [{ station_id: FX.zoneStation, order_types: ['takeaway'], home_for_order_types: ['takeaway'] }], carry_times: [{ point_id: 'P1', carry_ms: 30_000 }] }
          : s.station_id === FX.zoneStation
            ? { ...s, carry_times: [{ point_id: 'P1', carry_ms: 60_000 }] }
            : s,
      ),
      items: base.items.map((i) => (i.item_id === FX.piece ? { ...i, weight_pct: 150, max_early_ms: 90_000, max_late_ms: 600_000, max_carry_ms: 120_000 } : i)),
    };
    const line = [{ order_item_id: 'L1', item_id: FX.piece, quantity: 1 }];
    const take = buildSubmit(config, { order_id: 'O1', order_type: 'takeaway', lines: line }, ctx({ primary_table_id: null }));
    expect(take.proposed.lines[0]).toMatchObject({
      station_id: FX.station,
      alternates: [{ station_id: FX.zoneStation, carry_ms: 60_000, home: true }],
      point_id: 'P1',
      carry_ms: 30_000,
      weight_pct: 150,
      max_early_ms: 90_000,
      max_late_ms: 600_000,
      max_carry_ms: 120_000,
    });
    const dine = buildSubmit(config, dineIn(line), ctx());
    expect(dine.proposed.lines[0]).toMatchObject({ alternates: [], carry_ms: 30_000 });
  });

  it('[02b §3.1] takeaway: table_key takeaway:<order_id>, no table, follow_up false', () => {
    const out = buildSubmit(menu(), { order_id: 'O9', order_type: 'takeaway', lines: [{ order_item_id: 'L1', item_id: FX.naan, quantity: 1 }] }, ctx({ primary_table_id: null, follow_up: true }));
    expect(out.proposed.order).toEqual({ order_type: 'takeaway', table_id: null, table_key: 'takeaway:O9', follow_up: false, pickup_at_ms: null });
  });

  it('[02b §3.1] parking: table_key parking:<car_number_norm> (upper case, spaces and dashes removed)', () => {
    const input: SubmitInput = {
      order_id: 'O9',
      order_type: 'parking',
      parking: { car_number: 'leb-12 34', car_type: 'sedan' },
      lines: [{ order_item_id: 'L1', item_id: FX.naan, quantity: 1 }],
    };
    const out = buildSubmit(menu(), input, ctx({ primary_table_id: null }));
    expect(out.proposed.order).toEqual({ order_type: 'parking', table_id: null, table_key: 'parking:LEB1234', follow_up: false, pickup_at_ms: null });
    const other = buildSubmit(menu(), { ...input, order_id: 'O10', parking: { car_number: 'LEB 1234', car_type: 'mini' } }, ctx({ primary_table_id: null }));
    expect(other.proposed.order.table_key).toBe(out.proposed.order.table_key);
  });

  it('[02b #1] delivery → VALIDATION_FAILED path order_type', () => {
    const input = { order_id: 'O1', order_type: 'delivery', lines: [{ order_item_id: 'L1', item_id: FX.naan, quantity: 1 }] } as unknown as SubmitInput;
    const e = caught(() => buildSubmit(menu(), input, ctx({ primary_table_id: null })));
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.details).toEqual({ issues: [{ path: 'order_type', message: expect.any(String) }] });
  });
});

describe('buildSubmit — ids [02b §3.2 step 3, O3]', () => {
  it('[02b #5] an order_item_id repeated in the payload → VALIDATION_FAILED path lines.N.order_item_id', () => {
    const e = caught(() =>
      buildSubmit(menu(), dineIn([{ order_item_id: 'L1', item_id: FX.naan, quantity: 1 }, { order_item_id: 'L1', item_id: FX.naan, quantity: 1 }]), ctx()),
    );
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.details).toEqual({ issues: [{ path: 'lines.1.order_item_id', message: expect.any(String) }] });
  });

  it('[02b #5] an option child or deal part id repeating a line id → the path of the repeat', () => {
    const option = caught(() =>
      buildSubmit(menu(), dineIn([{ order_item_id: 'L1', item_id: FX.piece, quantity: 1, options: [{ option_id: FX.option, quantity: 1, order_item_id: 'L1' }] }]), ctx()),
    );
    expect(option.details).toEqual({ issues: [{ path: 'lines.0.options.0.order_item_id', message: expect.any(String) }] });
    const deal = familyDeal(FX.naan);
    const part = caught(() => buildSubmit(menu(), dineIn([{ order_item_id: 'L_NAAN', item_id: FX.naan, quantity: 1 }, deal]), ctx()));
    expect(part.details).toEqual({ issues: [{ path: 'lines.1.deal_choices.1.order_item_id', message: expect.any(String) }] });
  });
});

describe('buildSubmit — config checks [02b #6, §3.2 step 4]', () => {
  const offFor = (...ids: string[]): IsAvailable => (id) => !ids.includes(id);

  it('[02b #6] unknown item → MENU_ITEM_NOT_FOUND; unknown deal → DEAL_NOT_FOUND', () => {
    expect(caught(() => buildSubmit(menu(), dineIn([{ order_item_id: 'L1', item_id: 'I_NOPE', quantity: 1 }]), ctx()))).toMatchObject({
      code: 'MENU_ITEM_NOT_FOUND',
      details: { item_id: 'I_NOPE' },
    });
    expect(caught(() => buildSubmit(menu(), dineIn([{ order_item_id: 'L1', deal_id: 'D_NOPE', quantity: 1 }]), ctx()))).toMatchObject({
      code: 'DEAL_NOT_FOUND',
      details: { deal_id: 'D_NOPE' },
    });
  });

  it('[02b #6] manual Off → ITEM_UNAVAILABLE { item_id }, also for a deal part choice', () => {
    expect(caught(() => buildSubmit(menu(), dineIn([{ order_item_id: 'L1', item_id: FX.naan, quantity: 1 }]), ctx({ isAvailable: offFor(FX.naan) })))).toMatchObject({
      code: 'ITEM_UNAVAILABLE',
      details: { item_id: FX.naan },
    });
    expect(caught(() => buildSubmit(menu(), dineIn([familyDeal(FX.naan)]), ctx({ isAvailable: offFor('I_LASSI') })))).toMatchObject({
      code: 'ITEM_UNAVAILABLE',
      details: { item_id: 'I_LASSI' },
    });
  });

  it('[02b #6] out of hours on hub time → ITEM_OUT_OF_HOURS { item_id, opens_at_ms }; the offset comes from ctx', () => {
    const line = [{ order_item_id: 'L1', item_id: 'I_BREAKFAST', quantity: 1 }];
    // 09:00 hub time (PKT): inside 08:00–11:00
    expect(buildSubmit(menu(), dineIn(line), ctx()).itemAdded).toHaveLength(1);
    // the same instant read at UTC is 04:00: outside; it opens at 08:00 the same day
    expect(caught(() => buildSubmit(menu(), dineIn(line), ctx({ utc_offset_ms: 0 })))).toMatchObject({
      code: 'ITEM_OUT_OF_HOURS',
      details: { item_id: 'I_BREAKFAST', opens_at_ms: Date.UTC(2026, 10, 10, 8, 0) },
    });
    // 12:00 hub time: it opens at 08:00 the next day
    expect(caught(() => buildSubmit(menu(), dineIn(line), ctx({ now: Date.UTC(2026, 10, 10, 7, 0) })))).toMatchObject({
      code: 'ITEM_OUT_OF_HOURS',
      details: { item_id: 'I_BREAKFAST', opens_at_ms: Date.UTC(2026, 10, 11, 3, 0) },
    });
  });

  it("[02b #6] outside the category's window → ITEM_OUT_OF_HOURS; windows that never overlap → opens_at_ms null", () => {
    const base = menu();
    const withCategory = (w: { start_ms: number; end_ms: number }): BranchConfig => ({
      ...base,
      categories: base.categories.map((c) => (c.category_id === 'C1' ? { ...c, availability_windows: [w] } : c)),
    });
    const line = [{ order_item_id: 'L1', item_id: FX.naan, quantity: 1 }];
    // category 18:00–23:00, now 09:00 hub time
    expect(caught(() => buildSubmit(withCategory({ start_ms: 18 * 3_600_000, end_ms: 23 * 3_600_000 }), dineIn(line), ctx()))).toMatchObject({
      code: 'ITEM_OUT_OF_HOURS',
      details: { item_id: FX.naan, opens_at_ms: Date.UTC(2026, 10, 10, 13, 0) },
    });
    const breakfast = [{ order_item_id: 'L1', item_id: 'I_BREAKFAST', quantity: 1 }];
    expect(caught(() => buildSubmit(withCategory({ start_ms: 18 * 3_600_000, end_ms: 23 * 3_600_000 }), dineIn(breakfast), ctx()))).toMatchObject({
      code: 'ITEM_OUT_OF_HOURS',
      details: { item_id: 'I_BREAKFAST', opens_at_ms: null },
    });
  });

  it('[02b #6] a required group that cannot be satisfied → ITEM_UNAVAILABLE', () => {
    expect(caught(() => buildSubmit(menu(), dineIn([{ order_item_id: 'L1', item_id: 'I_SET', quantity: 1 }]), ctx()))).toMatchObject({
      code: 'ITEM_UNAVAILABLE',
      details: { item_id: 'I_SET' },
    });
  });

  it('[02b #6] a linked option whose item is Off or out of hours → OPTION_CHOICE_INVALID { order_item_id, violations }', () => {
    const line = [{ order_item_id: 'L1', item_id: FX.piece, quantity: 1, options: [{ option_id: FX.option, quantity: 1, order_item_id: 'L1_R' }] }];
    const off = caught(() => buildSubmit(menu(), dineIn(line), ctx({ isAvailable: offFor(FX.optionItem) })));
    expect(off.code).toBe('OPTION_CHOICE_INVALID');
    expect(off.details).toEqual({ order_item_id: 'L1', violations: [{ reason: 'linked_not_orderable', modifier_group_id: FX.optionGroup, option_id: FX.option }] });
    const base = menu();
    const late: BranchConfig = {
      ...base,
      items: base.items.map((i) => (i.item_id === FX.optionItem ? { ...i, availability_windows: [{ start_ms: 18 * 3_600_000, end_ms: 23 * 3_600_000 }] } : i)),
    };
    expect(caught(() => buildSubmit(late, dineIn(line), ctx()))).toMatchObject({ code: 'OPTION_CHOICE_INVALID', details: { order_item_id: 'L1' } });
  });

  it('[02b §3.2] a deal part carrying a linked option → OPTION_CHOICE_INVALID linked_in_child (01c V9)', () => {
    const base = menu();
    const config: BranchConfig = { ...base, items: base.items.map((i) => (i.item_id === 'I_FULL' ? { ...i, modifier_group_ids: [FX.optionGroup] } : i)) };
    const deal = familyDeal(FX.naan);
    deal.deal_choices![0] = { deal_part_id: 'P_MAIN', item_id: 'I_FULL', order_item_id: 'L_MAIN', options: [{ option_id: FX.option, quantity: 1 }] };
    const e = caught(() => buildSubmit(config, dineIn([deal]), ctx()));
    expect(e.code).toBe('OPTION_CHOICE_INVALID');
    expect(e.details).toMatchObject({ order_item_id: 'L_MAIN', violations: [{ reason: 'linked_in_child' }] });
  });

  it('[02b §3.2] an option above its max_quantity → OPTION_CHOICE_INVALID quantity_out_of_range', () => {
    const e = caught(() => buildSubmit(menu(), dineIn([{ order_item_id: 'L1', item_id: FX.piece, quantity: 1, options: [{ option_id: 'O_BUTTER', quantity: 3 }] }]), ctx()));
    expect(e).toMatchObject({ code: 'OPTION_CHOICE_INVALID', details: { order_item_id: 'L1', violations: [{ reason: 'quantity_out_of_range', option_id: 'O_BUTTER' }] } });
  });
});

describe('buildSubmit — zone routing [02b #11, §3.10, O4]', () => {
  it('[02b #11] the route of the primary table zone wins over the branch route, for item and deal part lines', () => {
    const lines = [{ order_item_id: 'L1', item_id: FX.naan, quantity: 2 }, { order_item_id: 'L2', item_id: FX.piece, quantity: 1 }, familyDeal(FX.naan)];
    const zoned = buildSubmit(menu(), dineIn(lines, { table_id: FX.zoneTable }), ctx({ primary_table_id: FX.zoneTable }));
    expect(added(zoned, 'L1').station_id).toBe(FX.zoneStation);
    expect(added(zoned, 'L_NAAN').station_id).toBe(FX.zoneStation);
    expect(added(zoned, 'L2').station_id).toBe(FX.station);
    expect(zoned.proposed.lines.find((l) => l.order_item_id === 'L1')).toMatchObject({ station_id: FX.zoneStation, point_id: 'P1' });
    const plain = buildSubmit(menu(), dineIn(lines), ctx({ primary_table_id: FX.table }));
    expect(added(plain, 'L1').station_id).toBe(FX.station);
  });

  it('[02b #11] takeaway and parking ignore zone routes', () => {
    const lines = [{ order_item_id: 'L1', item_id: FX.naan, quantity: 2 }];
    const take = buildSubmit(menu(), { order_id: 'O1', order_type: 'takeaway', lines }, ctx({ primary_table_id: FX.zoneTable }));
    expect(added(take, 'L1').station_id).toBe(FX.station);
    const park = buildSubmit(menu(), { order_id: 'O1', order_type: 'parking', parking: { car_number: 'AB 12', car_type: 'large' }, lines }, ctx({ primary_table_id: FX.zoneTable }));
    expect(added(park, 'L1').station_id).toBe(FX.station);
  });
});

describe('buildSubmit — zone candidates [02b §3.2 step 5, O5, AD-8]', () => {
  it('[02b §3.2] a from_zone item line of the zone table zone is a candidate, built as a kitchen line', () => {
    const out = buildSubmit(menu(), dineIn([{ order_item_id: 'L1', item_id: FX.zoneItem, quantity: 2, from_zone: true }], { table_id: FX.zoneTable }), ctx({ primary_table_id: FX.zoneTable }));
    expect(out.zoneCandidates).toEqual(['L1']);
    expect(added(out, 'L1')).toMatchObject({ station_id: FX.station, served_from_zone_id: null, line_kind: 'item' });
    expect(out.proposed.lines.map((l) => l.order_item_id)).toEqual(['L1']);
  });

  it('[02b §3.2] not a candidate: no from_zone, a table without the zone item, takeaway, an item the zone does not stock, with options', () => {
    const base = menu();
    const config: BranchConfig = { ...base, items: base.items.map((i) => (i.item_id === FX.zoneItem ? { ...i, modifier_group_ids: ['M_EXTRA'] } : i)) };
    const zoneCtx = ctx({ primary_table_id: FX.zoneTable });
    const cola = (o: object = {}) => ({ order_item_id: 'L1', item_id: FX.zoneItem, quantity: 1, from_zone: true, ...o });
    expect(buildSubmit(config, dineIn([cola({ from_zone: undefined })]), zoneCtx).zoneCandidates).toEqual([]);
    expect(buildSubmit(config, dineIn([cola()]), ctx({ primary_table_id: FX.table })).zoneCandidates).toEqual([]);
    expect(buildSubmit(config, { order_id: 'O1', order_type: 'takeaway', lines: [cola()] }, zoneCtx).zoneCandidates).toEqual([]);
    expect(buildSubmit(config, dineIn([cola({ item_id: FX.naan })]), zoneCtx).zoneCandidates).toEqual([]);
    expect(buildSubmit(config, dineIn([cola({ options: [{ option_id: 'O_BUTTER', quantity: 1 }] })]), zoneCtx).zoneCandidates).toEqual([]);
  });
});

describe('buildSubmit — pure, config at submit [02b #3 pure, D25]', () => {
  it('[02b #3 pure] the lines use the config it is given, and the inputs are not mutated', () => {
    const before = menu();
    const after: BranchConfig = { ...before, items: before.items.map((i) => (i.item_id === FX.naan ? { ...i, price_minor: 3_500, cook_time_ms: 240_000 } : i)) };
    const input = dineIn([{ order_item_id: 'L1', item_id: FX.naan, quantity: 2 }]);
    const snapshot = JSON.stringify([before, after, input]);
    const a = buildSubmit(before, input, ctx());
    const b = buildSubmit(after, input, ctx());
    expect(added(a, 'L1')).toMatchObject({ price_minor: 3_000, cook_time_ms: 300_000, line_total_minor: 6_000 });
    expect(added(b, 'L1')).toMatchObject({ price_minor: 3_500, cook_time_ms: 240_000, line_total_minor: 7_000 });
    expect(buildSubmit(after, input, ctx())).toEqual(b);
    expect(JSON.stringify([before, after, input])).toBe(snapshot);
  });
});
