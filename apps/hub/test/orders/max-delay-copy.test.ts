// 02b v1.0.24 §3.2 step 4b, §6.19 (STAB-7; 03a v1.2.10 §3.5.7 PR-1, To 02 #13; 01a v2.7.5 MD-5; review M-8): every
// engine line SubmitOrder builds carries ItemAdded.max_delay_ms = its own item's effective max delay; a deal header
// carries null. Test 58 (the SubmitOrder build part; the remake part is in return-to-kitchen.int.test.ts).
import type { IsAvailable } from '@pos/domain';
import type { BranchConfig, ItemAddedPayload } from '@pos/events';
import { describe, expect, it } from 'vitest';
import type { BuildSubmitCtx, SubmitInput } from '../../src/orders/contracts';
import { buildSubmit } from '../../src/orders/build-submit';
import { expandParts } from '../../src/orders/expand-parts';
import { FX, fixtureMenu } from './fixtures';

const PKT = 5 * 3_600_000;
const NOW = Date.UTC(2026, 10, 10, 4, 0);
const ON: IsAvailable = () => true;

/** Karahi 600 000, Naan empty (the branch default), Raita "No limit"; the branch default as given (or the key missing). */
function menu(defaultMs: number | null | 'missing' = 300_000): BranchConfig {
  const base = fixtureMenu();
  const { max_delay_default_ms: _drop, ...settings } = base.engine_settings;
  return {
    ...base,
    engine_settings: defaultMs === 'missing' ? settings : { ...settings, max_delay_default_ms: defaultMs },
    items: base.items.map((i) =>
      i.item_id === FX.piece
        ? { ...i, max_delay_ms: 600_000, max_delay_unlimited: false }
        : i.item_id === FX.naan
          ? { ...i, max_delay_ms: null, max_delay_unlimited: false, modifier_group_ids: [FX.optionGroup] }
          : i.item_id === FX.optionItem
            ? { ...i, max_delay_ms: null, max_delay_unlimited: true }
            : i,
    ),
  };
}

function ctx(config: BranchConfig): BuildSubmitCtx {
  return {
    now: NOW,
    utc_offset_ms: PKT,
    isAvailable: ON,
    draws: (item_id) => {
      const item = config.items.find((i) => i.item_id === item_id);
      return { sale_unit: item?.sale_unit ?? 'piece', stock_draws: (item?.stock_draws ?? []).map((d) => ({ ...d })) };
    },
    primary_table_id: FX.table,
    follow_up: false,
  };
}

const ORDER: SubmitInput = {
  order_id: 'O1',
  order_type: 'dine_in',
  table_id: FX.table,
  seating_id: 'SEAT1',
  lines: [
    { order_item_id: 'K', item_id: FX.piece, quantity: 2 },
    { order_item_id: 'N', item_id: FX.naan, quantity: 1, options: [{ option_id: FX.option, quantity: 1, order_item_id: 'R' }] },
    {
      order_item_id: 'D',
      deal_id: FX.deal,
      quantity: 1,
      deal_choices: [
        { deal_part_id: FX.dealParts[0], item_id: FX.piece, order_item_id: 'DK' },
        { deal_part_id: FX.dealParts[1], item_id: FX.naan, order_item_id: 'DN' },
      ],
    },
  ],
};

function delays(config: BranchConfig, input: SubmitInput = ORDER): Record<string, number | null | undefined> {
  const c = ctx(config);
  const built = buildSubmit(config, expandParts(config, input, c), c);
  const byId = (lines: ReadonlyArray<Pick<ItemAddedPayload, 'order_item_id' | 'max_delay_ms'>>) =>
    Object.fromEntries(lines.map((l) => [l.order_item_id, l.max_delay_ms]));
  // the engine line carries the ItemAdded copy (03a §4.2), so both agree
  expect(byId(built.proposed.lines)).toEqual(byId(built.itemAdded));
  return byId(built.itemAdded);
}

describe('[02b v1.0.24 §3.2 step 4b, #58] ItemAdded.max_delay_ms (STAB-7)', () => {
  it('[#58] the item value on both karahi parts and the deal karahi; the branch default on the naan and the deal naan; null on the "No limit" raita child and the deal header', () => {
    const got = delays(menu(300_000));
    const karahiParts = Object.keys(got).filter((id) => id === 'K' || id.startsWith('K-'));
    expect(karahiParts).toHaveLength(2); // 02b §3.2 step 4a: ×2 on a slot station is two parts
    for (const id of karahiParts) expect(got[id], id).toBe(600_000);
    expect(got).toMatchObject({ N: 300_000, R: null, D: null, DK: 600_000, DN: 300_000 });
  });

  it('[#58; M-8] an explicit null branch default is copied as null (fails on `?? 300000`)', () => {
    expect(delays(menu(null))).toMatchObject({ N: null, DN: null, DK: 600_000, R: null, D: null });
  });

  it('[#58; M-8] a snapshot without the key gives 300 000', () => {
    expect(delays(menu('missing'))).toMatchObject({ N: 300_000, DN: 300_000, DK: 600_000 });
  });

  it('[#58; M-10] "No limit" is null, never 1 800 000; an item without the keys reads the branch default', () => {
    const got = delays(menu(600_000));
    expect(got.R).toBeNull();
    // no max-delay keys anywhere: items read null / false, the default 300 000
    const plain = fixtureMenu();
    const bare = { ...plain, items: plain.items.map((i) => (i.item_id === FX.naan ? { ...i, modifier_group_ids: [FX.optionGroup] } : i)) };
    expect(delays(bare)).toMatchObject({ N: 300_000, R: 300_000, DK: 300_000, D: null });
  });
});
