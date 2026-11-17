import { optionChargeMinor, orderLineTotalMinor } from '@pos/domain';
import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '../../../../../test/dom';
import type { AvailabilityInputs } from '../live/availability';
import type { StockLevel, StockMirror } from '../contracts';
import { cartLineMoney, configUnits, toSubmitLines, type CartLine } from '../order-screen/cart';
import { DealSheet } from './DealSheet';
import { NoteSheet, clamp } from './NoteSheet';
import { OptionsSheet } from './OptionsSheet';
import { preselect } from './preselect';
import { gramsOf } from './WeightChoice';

// I1 Half / I3 Full (variants V1); groups: G1 Gravy (choose 1: Regular default, Thick), G2 Add-ons (up to 3: Extra naan
// +Rs 40 max 2 linked to I4 Naan, Raita +Rs 80 linked to I5 Raita); I2 Fish by weight (g, weigh later allowed).
// Deal D1: part P1 1× (I1 | I3 +Rs 300), part P2 4× (I4 Naan | I5 Raita).
function cfg(): BranchConfig {
  const base = aBranchConfig();
  const plain = (id: string, name: string, o: Record<string, unknown> = {}) => ({ ...base.items.find((i) => i.item_id === 'I2')!, item_id: id, name, ...o });
  return {
    ...base,
    items: [
      ...base.items.map((i) =>
        i.item_id === 'I1' || i.item_id === 'I3'
          ? { ...i, modifier_group_ids: ['G1', 'G2'] }
          : i.item_id === 'I2'
            ? { ...i, name: 'Fish', sale_unit: 'g' as const, requires_weighing: true, price_minor: 280_000 }
            : i,
      ),
      plain('I4', 'Naan', { price_minor: 4_000 }),
      plain('I5', 'Raita', { price_minor: 8_000, out_of_stock_behaviour: 'sold_out', stock_time_ms: 60_000, stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 1 }] }),
    ],
    modifier_groups: [
      {
        modifier_group_id: 'G1',
        name: 'Gravy',
        min_choices: 1,
        max_choices: 1,
        sort_order: 1,
        has_plain_options: true,
        options: [
          { option_id: 'REG', name: 'Regular', price_minor: 0, max_quantity: 1, is_default: true, linked_item_id: null, sort_order: 1 },
          { option_id: 'THK', name: 'Thick', price_minor: 0, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 2 },
        ],
      },
      {
        modifier_group_id: 'G2',
        name: 'Add-ons',
        min_choices: 0,
        max_choices: 3,
        sort_order: 2,
        has_plain_options: false,
        options: [
          { option_id: 'NAAN', name: 'Extra naan', price_minor: 4_000, max_quantity: 2, is_default: false, linked_item_id: 'I4', sort_order: 1 },
          { option_id: 'RAITA', name: 'Raita', price_minor: 8_000, max_quantity: 1, is_default: false, linked_item_id: 'I5', sort_order: 2 },
        ],
      },
    ],
    deals: [
      {
        deal_id: 'D1',
        category_id: 'C1',
        name: 'Family Deal',
        description: null,
        sort_order: 1,
        price_minor: 320_000,
        tax_class_id: null,
        availability_windows: [],
        parts: [
          { deal_part_id: 'P1', quantity: 1, sort_order: 1, choices: [{ item_id: 'I1', extra_price_minor: 0, sort_order: 1 }, { item_id: 'I3', extra_price_minor: 30_000, sort_order: 2 }] },
          { deal_part_id: 'P2', quantity: 4, sort_order: 2, choices: [{ item_id: 'I4', extra_price_minor: 0, sort_order: 1 }, { item_id: 'I5', extra_price_minor: 0, sort_order: 2 }] },
        ],
      },
    ],
  };
}

const stock = (units: Record<string, number>, levels: Record<string, StockLevel> = {}): StockMirror => ({ available: (id) => units[id] ?? null, level: (id) => levels[id] ?? null, subscribe: () => () => {} });
function inputs(config: BranchConfig, s: StockMirror = stock({ I5: 10 }, { I5: 'ok' })): AvailabilityInputs {
  return { config, stock: s, off: new Set(), nowMs: Date.UTC(2025, 9, 20, 12), utcOffsetMs: 0, slowThresholdMs: null, stationWaitMs: () => null };
}
let n = 0;
const newKey = () => `N${++n}`;

describe('[02b §8 Ordering screen] sheets', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('[02b §8 Ordering screen] options: defaults visible; a required group blocks Add and says what is missing (checkOptionChoices)', () => {
    const config = cfg();
    const added: CartLine[] = [];
    const m = mount();
    m.render(<OptionsSheet config={config} unitOf={configUnits(config)} inputs={inputs(config, stock({ I5: 0 }, { I5: 'out' }))} item_ids={['I1', 'I3']} initial={null} capOf={() => null} sheet={false} newKey={newKey} onAdd={(l) => added.push(l)} onClose={() => {}} />);
    // variants as a segmented control with prices; the default Regular is ticked
    expect([...m.container.querySelectorAll('.seg--opt button')].map((b) => b.textContent)).toEqual(['HalfRs 1,200', 'FullRs 1,200']);
    expect(m.button('Regular').getAttribute('aria-pressed')).toBe('true');
    expect(m.container.querySelector('.rule.ok')?.textContent).toBe('Choose 1');
    // a linked option whose item is sold out is off, with its reason
    const raita = m.button('Raita · sold out');
    expect(raita.hasAttribute('disabled')).toBe(true);
    // untick the only gravy → Add says what is missing
    m.click(m.button('Regular'));
    expect(m.container.querySelector('.rule.need')?.textContent).toBe('Choose 1');
    const add = m.button('Choose 1 in Gravy');
    expect(add.hasAttribute('disabled')).toBe(true);
    // pick Thick, Extra naan ×2 → Add on; the price = parent + 2 × 1 naan child line
    m.click(m.button('Thick'));
    m.click(m.button('Extra naan'));
    m.click(m.button('Extra naan'));
    expect(m.button('Extra naan').textContent).toContain('×2');
    expect(m.container.querySelector('.qline .pv strong')?.textContent).toBe('Rs 1,280');
    m.click(m.button('Add to order'));
    expect(added).toEqual([{ key: expect.any(String), item_id: 'I1', quantity: 1, options: [{ option_id: 'THK', quantity: 1 }, { option_id: 'NAAN', quantity: 2, order_item_id: expect.any(String) }] }]);
    m.unmount();
  });

  it('[02b §3.6] weighed item: Enter weight now (50 g steps, 50–50 000) or Weigh later (quantity null, "Weight pending")', () => {
    const config = cfg();
    const added: CartLine[] = [];
    const m = mount();
    m.render(<OptionsSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} item_ids={['I2']} initial={null} capOf={() => null} sheet={false} newKey={newKey} onAdd={(l) => added.push(l)} onClose={() => {}} />);
    const pad = (k: string) => m.click([...m.container.querySelectorAll<HTMLElement>('.wpad button')].find((b) => b.textContent === k)!);
    expect(m.button('Add to order').hasAttribute('disabled')).toBe(true); // nothing typed
    pad('1');
    pad('.');
    pad('2');
    pad('7'); // 1.27 kg → 1 250 g (50 g steps)
    expect(m.container.querySelector('.qline b')?.textContent).toBe('1.25 kg × Rs 2,800');
    expect(m.container.querySelector('.qline .pv strong')?.textContent).toBe('Rs 3,500');
    m.click(m.button('Add to order'));
    expect(added[0]).toMatchObject({ item_id: 'I2', quantity: 1_250 });
    // 0.02 kg is below 50 g; 51 kg is over 50 kg
    pad('Delete');
    pad('Delete');
    pad('Delete');
    pad('Delete');
    pad('0');
    pad('.');
    pad('0');
    pad('2');
    expect(m.button('Add to order').hasAttribute('disabled')).toBe(true);
    expect(m.text()).toContain('From 0.05 to 50 kg');
    m.unmount();
    // Weigh later (a new sheet): quantity null, price after weighing
    const m2 = mount();
    m2.render(<OptionsSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} item_ids={['I2']} initial={null} capOf={() => null} sheet={false} newKey={newKey} onAdd={(l) => added.push(l)} onClose={() => {}} />);
    m2.click(m2.button('Weigh later'));
    expect(m2.text()).toContain('Weight pending');
    expect(m2.container.querySelector('.qline .pv strong')?.textContent).toBe('Price after weighing');
    m2.click(m2.button('Add to order'));
    expect(added[1]).toMatchObject({ item_id: 'I2', quantity: null });
    m2.unmount();
  });

  it('[02b §8 Ordering screen] deal: parts, choices with extra price (optionChargeMinor), sold-out choice off', () => {
    const config = cfg();
    const added: CartLine[] = [];
    const m = mount();
    // Raita has 3 left: the 4× part cannot take it
    m.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config, stock({ I5: 3 }, { I5: 'low' }))} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={(l) => added.push(l)} onClose={() => {}} />);
    expect([...m.container.querySelectorAll('.dsh__h')].map((h) => h.textContent)).toEqual(['1×Part 1Choose 1', '4×Part 2Done']); // Naan is the only orderable bread
    expect(m.button('Raita · sold out').hasAttribute('disabled')).toBe(true);
    expect(m.button('Choose 1 in Part 1').hasAttribute('disabled')).toBe(true);
    expect(m.button('Chicken Karahi — Full').textContent).toContain('+Rs 300');
    m.click(m.button('Chicken Karahi — Full'));
    // Full takes its default plain gravy (child position): the price is the deal's orderLineTotalMinor
    const want = orderLineTotalMinor({
      line_kind: 'deal',
      price_minor: 320_000,
      quantity: 1,
      parts: [
        { sale_unit: 'piece', quantity: 1, extra_price_minor: 30_000, option_charges_minor: [optionChargeMinor(0, 1, 1, 'piece')] },
        { sale_unit: 'piece', quantity: 4, extra_price_minor: 0, option_charges_minor: [] },
      ],
    })!;
    expect(want).toBe(350_000);
    expect(m.container.querySelector('.qline .pv strong')?.textContent).toBe('Rs 3,500');
    m.click(m.button('Add to order'));
    expect(added[0]).toMatchObject({
      deal_id: 'D1',
      quantity: 1,
      deal_choices: [
        { deal_part_id: 'P1', item_id: 'I3', options: [{ option_id: 'REG', quantity: 1 }] },
        { deal_part_id: 'P2', item_id: 'I4' },
      ],
    });
    m.unmount();
  });

  it('[02b §8 Ordering screen] kitchen note ≤ 80, order note ≤ 200, dir auto, no quick chips', () => {
    for (const max of [80, 200] as const) {
      const saved: Array<string | undefined> = [];
      const m = mount();
      m.render(<NoteSheet title="Kitchen note · Chicken Karahi" max={max} initial="less spicy" sheet={false} onSave={(x) => saved.push(x)} onClose={() => {}} />);
      const area = m.container.querySelector('textarea')!;
      expect(area.getAttribute('dir')).toBe('auto');
      expect(area.maxLength).toBe(max);
      expect(m.text()).toContain(`10/${max}`);
      expect(m.container.querySelectorAll('.chip')).toHaveLength(0);
      m.click(m.button('Save note'));
      expect(saved).toEqual(['less spicy']);
      m.unmount();
    }
  });

  it('[02b Q-7] preselect(options by name) ticks matching choices; unmatched names stay unticked', () => {
    const config = cfg();
    const item = config.items.find((i) => i.item_id === 'I3')!;
    expect(preselect(config, item, [{ name: ' extra NAAN ', quantity: 5 }, { name: 'Thick', quantity: 1 }, { name: 'Gone option', quantity: 1 }], newKey)).toEqual([
      { option_id: 'NAAN', quantity: 2, order_item_id: expect.any(String) }, // max_quantity 2
      { option_id: 'THK', quantity: 1 },
    ]);
    expect(preselect(config, item, undefined, newKey)).toBeNull(); // H2 not there: keep the defaults
    // the sheet opens with the preselection, not the defaults
    const m = mount();
    m.render(<OptionsSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} item_ids={['I3']} initial={null} preset={preselect(config, item, [{ name: 'Thick', quantity: 1 }], newKey)} capOf={() => null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} />);
    expect(m.button('Thick').getAttribute('aria-pressed')).toBe('true');
    expect(m.button('Regular').getAttribute('aria-pressed')).toBe('false');
    m.unmount();
  });

  it('[02b §8 Ordering screen] the sheet reads the day-frozen sale unit (01c V20): a piece item frozen in g is weighed', () => {
    const config = cfg();
    const added: CartLine[] = [];
    const m = mount();
    const dayUnits = (id: string) => (id === 'I4' ? ('g' as const) : configUnits(config)(id));
    m.render(<OptionsSheet config={config} unitOf={dayUnits} inputs={inputs(config)} item_ids={['I4']} initial={null} capOf={() => null} sheet={false} newKey={newKey} onAdd={(l) => added.push(l)} onClose={() => {}} />);
    expect(m.container.querySelector('.wpad')).not.toBeNull();
    for (const k of ['0', '.', '5']) m.click([...m.container.querySelectorAll<HTMLElement>('.wpad button')].find((b) => b.textContent === k)!);
    // Naan Rs 40 "per kg" for the day: 500 g → lineTotalMinor(4 000, 500, 'g') = Rs 20
    expect(m.container.querySelector('.qline .pv strong')?.textContent).toBe('Rs 20');
    m.click(m.button('Add to order'));
    expect(added[0]).toMatchObject({ item_id: 'I4', quantity: 500 });
    m.unmount();
  });

  it('[02b Q-64] a deal part offers its plain options (01c V9): a required group with no default opens the picker; the deal bills them', () => {
    const base = cfg();
    // I3 Full needs a sauce (G3, plain, no default; Red +Rs 50). I1 Half's only required group is all-linked (G4): it is
    // not offered in a child position, so the hub takes Half with no options.
    const config: BranchConfig = {
      ...base,
      modifier_groups: [
        ...base.modifier_groups,
        {
          modifier_group_id: 'G3',
          name: 'Sauce',
          min_choices: 1,
          max_choices: 1,
          sort_order: 3,
          has_plain_options: true,
          options: [
            { option_id: 'S1', name: 'Red', price_minor: 5_000, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 1 },
            { option_id: 'S2', name: 'Green', price_minor: 0, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 2 },
          ],
        },
        { modifier_group_id: 'G4', name: 'Side', min_choices: 1, max_choices: 1, sort_order: 4, has_plain_options: false, options: [{ option_id: 'L1', name: 'Naan side', price_minor: 4_000, max_quantity: 1, is_default: false, linked_item_id: 'I4', sort_order: 1 }] },
      ],
      items: base.items.map((i) => (i.item_id === 'I3' ? { ...i, modifier_group_ids: ['G3'] } : i.item_id === 'I1' ? { ...i, modifier_group_ids: ['G4'] } : i)),
    };
    const added: CartLine[] = [];
    const m = mount();
    m.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={(l) => added.push(l)} onClose={() => {}} />);
    m.click(m.button('One more')); // 2 deals
    m.click(m.button('Naan'));
    m.click(m.button('Chicken Karahi — Full'));
    // the picker opened by itself: the part's plain groups only, the charge for this deal (piece part: 1 × 2 deals)
    expect(m.container.querySelector('#part-t')?.textContent).toBe('Chicken Karahi — Full');
    expect(m.button('Red').textContent).toContain('+Rs 100');
    expect(m.button('Choose 1 in Sauce').hasAttribute('disabled')).toBe(true);
    m.click(m.button('Cancel'));
    // back on the deal: the part asks for its options, Add says so
    expect([...m.container.querySelectorAll('.dsh__h .rule')].map((r) => r.textContent)).toEqual(['Choose options', 'Done']);
    expect(m.button('Choose options for Part 1').hasAttribute('disabled')).toBe(true);
    m.click(m.button('Options'));
    m.click(m.button('Red'));
    m.click(m.button('Done', m.container.querySelector('.acts')!));
    expect(m.container.querySelector('.dsh')?.textContent).toContain('+ Red');
    // the hub's bill (build-submit.ts dealLines :281-286, :330-340): 2 × Rs 3,200 + Full extra Rs 300 × 1 × 2
    // + Red optionChargeMinor(5 000, 1, part qty 1 × 2 deals, 'piece') = 640 000 + 60 000 + 10 000
    const HUB_DEAL = 710_000;
    expect(m.container.querySelector('.qline .pv strong')?.textContent).toBe('Rs 7,100');
    m.click(m.button('Add to order'));
    expect(cartLineMoney(config, added[0]!, configUnits(config))).toEqual({ kind: 'ok', minor: HUB_DEAL });
    // the payload carries the part's options exactly as dealLines reads them: deal_choices[].options [{ option_id, quantity }]
    expect(toSubmitLines({ lines: added })[0]!.deal_choices).toEqual([
      { deal_part_id: 'P1', item_id: 'I3', order_item_id: expect.any(String), options: [{ option_id: 'S1', quantity: 1 }] },
      { deal_part_id: 'P2', item_id: 'I4', order_item_id: expect.any(String) },
    ]);
    m.unmount();
    // Half (all-linked required group) is accepted in the child position with no options
    const h = mount();
    h.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} />);
    h.click(h.button('Chicken Karahi — Half'));
    h.click(h.button('Naan'));
    expect(h.button('Add to order').hasAttribute('disabled')).toBe(false);
    expect(h.container.querySelector('.dsh button.btn--quiet')).toBeNull(); // nothing plain to offer → no Options button
    h.unmount();
  });

  it('[02b Q-64] a g / ml part takes its option charge once per deal (B2)', () => {
    const base = cfg();
    const config: BranchConfig = {
      ...base,
      modifier_groups: [...base.modifier_groups, { modifier_group_id: 'G5', name: 'Masala', min_choices: 0, max_choices: 1, sort_order: 5, has_plain_options: true, options: [{ option_id: 'M1', name: 'Extra masala', price_minor: 3_000, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 1 }] }],
      items: base.items.map((i) => (i.item_id === 'I3' ? { ...i, sale_unit: 'g' as const, modifier_group_ids: ['G5'] } : i)),
    };
    const added: CartLine[] = [];
    const m = mount();
    m.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={(l) => added.push(l)} onClose={() => {}} />);
    m.click(m.button('One more'));
    m.click(m.button('One more')); // 3 deals
    m.click(m.button('Chicken Karahi — Full'));
    m.click(m.button('Naan'));
    m.click(m.button('Options'));
    expect(m.button('Extra masala').textContent).toContain('+Rs 90'); // once per deal (× 3 deals), never per gram
    m.click(m.button('Extra masala'));
    m.click(m.button('Done', m.container.querySelector('.acts')!));
    m.click(m.button('Add to order'));
    // hub: g part → optionChargeMinor(3 000, 1, dealQty 3, 'piece') = 9 000; extra 300 × deal qty 3 (g part, B2)
    const HUB = 3 * 320_000 + 30_000 * 3 + 9_000;
    expect(cartLineMoney(config, added[0]!, configUnits(config))).toEqual({ kind: 'ok', minor: HUB });
    m.unmount();
  });

  it('[02b §8 Ordering screen] a part chosen for 1 deal that cannot cover 2: the pill and Add agree', () => {
    const config = cfg();
    const m = mount();
    // Raita: 4 left → 4× Bread fits one deal, not two
    m.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config, stock({ I5: 4 }, { I5: 'low' }))} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} />);
    m.click(m.button('Chicken Karahi — Half'));
    m.click(m.button('Raita'));
    expect(m.button('Add to order').hasAttribute('disabled')).toBe(false);
    m.click(m.button('One more'));
    expect([...m.container.querySelectorAll('.dsh__h .rule')].map((r) => r.textContent)).toEqual(['Done', 'Choose 1']);
    expect(m.button('Choose 1 in Part 2').hasAttribute('disabled')).toBe(true);
    m.unmount();
  });

  it('[02b §3.6] the weight is read as whole grams, half-up to 50 g in integers; 50 kg is the top', () => {
    expect(gramsOf('8.075')).toBe(8_100);
    expect(gramsOf('0.075')).toBe(100);
    expect(gramsOf('16.025')).toBe(16_050);
    expect(gramsOf('44.975')).toBe(45_000);
    expect(gramsOf('0.024')).toBeNull(); // 0 g
    expect(gramsOf('0.025')).toBe(50);
    expect(gramsOf('50')).toBe(50_000);
    expect(gramsOf('50.024')).toBe(50_000);
    expect(gramsOf('50.025')).toBeNull(); // 50 050 g
    expect(gramsOf('50.05')).toBeNull();
  });

  it('[02b §3.6] Weigh later shows the add-ons billed now, as the cart does; an ml item rounds to 50 ml', () => {
    const base = cfg();
    const config: BranchConfig = { ...base, items: base.items.map((i) => (i.item_id === 'I2' ? { ...i, modifier_group_ids: ['G2'] } : i)) };
    const m = mount();
    m.render(<OptionsSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} item_ids={['I2']} initial={null} capOf={() => null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} />);
    m.click(m.button('Weigh later'));
    m.click(m.button('Extra naan'));
    // a g parent: childQuantity = the option qty → 1 naan Rs 40 billed now (build-submit.ts :214, :233)
    expect(m.container.querySelector('.qline .pv strong')?.textContent).toBe('Rs 40 now · the rest after weighing');
    expect(m.container.querySelector('.ac__who')?.textContent).toContain('rounds to 50 g');
    m.unmount();
    const ml: BranchConfig = { ...base, items: base.items.map((i) => (i.item_id === 'I2' ? { ...i, sale_unit: 'ml' as const } : i)) };
    const m2 = mount();
    m2.render(<OptionsSheet config={ml} unitOf={configUnits(ml)} inputs={inputs(ml)} item_ids={['I2']} initial={null} capOf={() => null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} />);
    expect(m2.container.querySelector('.ac__who')?.textContent).toContain('rounds to 50 ml');
    m2.unmount();
  });

  it('[02b §8 Ordering screen] Add twice before the sheet closes → one line', () => {
    const config = cfg();
    const added: CartLine[] = [];
    const m = mount();
    m.render(<OptionsSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} item_ids={['I1']} initial={null} capOf={() => null} sheet={false} newKey={newKey} onAdd={(l) => added.push(l)} onClose={() => {}} />);
    const add = m.button('Add to order');
    act(() => {
      add.click();
      add.click();
    });
    expect(added).toHaveLength(1);
    m.unmount();
    const deals: CartLine[] = [];
    const d = mount();
    d.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={(l) => deals.push(l)} onClose={() => {}} />);
    d.click(d.button('Chicken Karahi — Half'));
    d.click(d.button('Naan'));
    const addDeal = d.button('Add to order');
    act(() => {
      addDeal.click();
      addDeal.click();
    });
    expect(deals).toHaveLength(1);
    d.unmount();
  });

  it('[02b §8 Ordering screen] notes are counted and cut in UTF-16 units, as the hub counts them', () => {
    const saved: Array<string | undefined> = [];
    const m = mount();
    m.render(<NoteSheet title="Kitchen note" max={80} initial={'x'.repeat(100)} sheet={false} onSave={(x) => saved.push(x)} onClose={() => {}} />);
    expect(m.text()).toContain('80/80');
    m.click(m.button('Save note'));
    expect(saved[0]).toHaveLength(80);
    m.unmount();
    expect(clamp('😀'.repeat(50), 80)).toBe('😀'.repeat(40));
    expect(clamp('a' + '😀'.repeat(50), 80)).toBe('a' + '😀'.repeat(39)); // never half a pair
  });

  it('[02b §8 Ordering screen] a second tap in a choose-one group takes it off; a linked option short for the child quantity says why', () => {
    const base = cfg();
    const config: BranchConfig = { ...base, modifier_groups: base.modifier_groups.map((g) => (g.modifier_group_id === 'G1' ? { ...g, options: g.options.map((o) => ({ ...o, max_quantity: 2 })) } : g)) };
    const m = mount();
    // Raita has 1 left
    m.render(<OptionsSheet config={config} unitOf={configUnits(config)} inputs={inputs(config, stock({ I5: 1 }, { I5: 'low' }))} item_ids={['I1']} initial={null} capOf={() => null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} />);
    m.click(m.button('Regular'));
    expect(m.button('Regular').getAttribute('aria-pressed')).toBe('false'); // off, not ×2
    m.click(m.button('Regular'));
    m.click(m.button('Raita'));
    expect(m.button('Add to order').hasAttribute('disabled')).toBe(false);
    m.click(m.button('One more')); // 2 karahi → 2 raita needed, 1 left
    expect(m.button('Raita').textContent).toContain('· sold out');
    expect(m.button('Raita · sold out', m.container.querySelector('.acts')!).hasAttribute('disabled')).toBe(true);
    // Extra naan ×2 at 2 karahi: 4 naan child lines — Rs 2,400 + 4 × Rs 40 + Raita off
    m.click(m.button('Raita'));
    m.click(m.button('Extra naan'));
    m.click(m.button('Extra naan'));
    expect(m.container.querySelector('.qline .pv strong')?.textContent).toBe('Rs 2,560');
    m.unmount();
  });

  it('[02b §8 Ordering screen] a deal part item whose only required group is linked to a sold-out item is still taken (child position, V9)', () => {
    const base = cfg();
    // Half's required group G4 is all-linked to Raita (I5), and Raita is sold out: the line position refuses Half,
    // the child position does not offer G4 at all, so the hub takes Half as a deal part
    const config: BranchConfig = {
      ...base,
      modifier_groups: [...base.modifier_groups, { modifier_group_id: 'G4', name: 'Side', min_choices: 1, max_choices: 1, sort_order: 4, has_plain_options: false, options: [{ option_id: 'L1', name: 'Raita side', price_minor: 8_000, max_quantity: 1, is_default: false, linked_item_id: 'I5', sort_order: 1 }] }],
      items: base.items.map((i) => (i.item_id === 'I1' ? { ...i, modifier_group_ids: ['G4'] } : i)),
    };
    const soldOut = inputs(config, stock({ I5: 0 }, { I5: 'out' }));
    const m = mount();
    m.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={soldOut} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} />);
    expect(m.button('Chicken Karahi — Half').hasAttribute('disabled')).toBe(false);
    m.click(m.button('Chicken Karahi — Half'));
    m.click(m.button('Naan'));
    expect(m.button('Add to order').hasAttribute('disabled')).toBe(false);
    m.unmount();
  });

  it('[02b §8 Ordering screen] at deal qty 2 a choice that cannot cover part qty × 2 reads "sold out"', () => {
    const config = cfg();
    const m = mount();
    // Raita: 6 left → 4× Bread fits 1 deal (4), not 2 (8)
    m.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config, stock({ I5: 6 }, { I5: 'ok' }))} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} />);
    expect(m.button('Raita').hasAttribute('disabled')).toBe(false);
    m.click(m.button('One more'));
    const raita = m.button('Raita · sold out');
    expect(raita.hasAttribute('disabled')).toBe(true);
    m.unmount();
  });

  // --- #180 fix round 1 ------------------------------------------------------------------------------------------

  it('[02b Q-64] B2 pinned: a piece part of qty 4 with an option ×2 at 2 deals is charged per piece of the part', () => {
    const base = cfg();
    // Naan (I4, piece) in the 4× Bread part gets a plain group: Butter Rs 10, up to 2
    const config: BranchConfig = {
      ...base,
      modifier_groups: [...base.modifier_groups, { modifier_group_id: 'G6', name: 'Butter', min_choices: 0, max_choices: 2, sort_order: 6, has_plain_options: true, options: [{ option_id: 'B1', name: 'Butter', price_minor: 1_000, max_quantity: 2, is_default: false, linked_item_id: null, sort_order: 1 }] }],
      items: base.items.map((i) => (i.item_id === 'I4' ? { ...i, modifier_group_ids: ['G6'] } : i)),
    };
    const added: CartLine[] = [];
    const m = mount();
    m.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={(l) => added.push(l)} onClose={() => {}} />);
    m.click(m.button('One more')); // 2 deals
    m.click(m.button('Chicken Karahi — Half'));
    m.click(m.button('Naan'));
    m.click(m.button('Options', m.container.querySelectorAll('.dsh')[1]!)); // the Bread part's
    // one Butter on 4 naan × 2 deals = 8 pieces → Rs 80 (once per deal would be Rs 20)
    expect(m.button('Butter').textContent).toContain('+Rs 80');
    m.click(m.button('Butter'));
    m.click(m.button('Butter')); // ×2
    m.click(m.button('Done', m.container.querySelector('.acts')!));
    // hub (build-submit.ts :281-286, :330-340): 2 × 320 000 + optionChargeMinor(1 000, 2, 4 × 2, 'piece') = 640 000 + 16 000
    // (once per deal: 640 000 + 4 000; per option qty 1: 640 000 + 8 000)
    const HUB = 656_000;
    expect(m.container.querySelector('.qline .pv strong')?.textContent).toBe('Rs 6,560');
    m.click(m.button('Add to order'));
    expect(cartLineMoney(config, added[0]!, configUnits(config))).toEqual({ kind: 'ok', minor: HUB });
    expect(toSubmitLines({ lines: added })[0]!.deal_choices![1]).toEqual({ deal_part_id: 'P2', item_id: 'I4', order_item_id: expect.any(String), options: [{ option_id: 'B1', quantity: 2 }] });
    m.unmount();
  });

  it('[02b Q-64] B2 pinned: a g part weighing 500 takes its option once per deal, never per gram; shown and sent', () => {
    const base = cfg();
    const config: BranchConfig = {
      ...base,
      modifier_groups: [...base.modifier_groups, { modifier_group_id: 'G5', name: 'Masala', min_choices: 0, max_choices: 1, sort_order: 5, has_plain_options: true, options: [{ option_id: 'M1', name: 'Extra masala', price_minor: 3_000, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 1 }] }],
      items: base.items.map((i) => (i.item_id === 'I3' ? { ...i, sale_unit: 'g' as const, modifier_group_ids: ['G5'] } : i)),
      deals: base.deals.map((d) => ({ ...d, parts: d.parts.map((part) => (part.deal_part_id === 'P1' ? { ...part, quantity: 500 } : part)) })),
    };
    const added: CartLine[] = [];
    const m = mount();
    m.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={(l) => added.push(l)} onClose={() => {}} />);
    m.click(m.button('One more'));
    m.click(m.button('One more')); // 3 deals
    m.click(m.button('Chicken Karahi — Full'));
    m.click(m.button('Naan'));
    m.click(m.button('Options'));
    // the picker names the part's weight, and its chip the charge for this deal: once per deal × 3 → Rs 90 (per gram: Rs 45,000)
    expect(m.container.querySelector('.ac__who')?.textContent).toBe('For 1500 g in this deal');
    expect(m.button('Extra masala').textContent).toContain('+Rs 90');
    m.click(m.button('Extra masala'));
    m.click(m.button('Done', m.container.querySelector('.acts')!));
    // hub: g part extra 30 000 × deal qty 3 (not × 500 g); option optionChargeMinor(3 000, 1, dealQty 3, 'piece') = 9 000
    // (per gram it would be 3 000 × 1 500 = 4 500 000)
    const HUB = 3 * 320_000 + 30_000 * 3 + 9_000;
    expect(HUB).toBe(1_059_000);
    expect(m.container.querySelector('.qline .pv strong')?.textContent).toBe('Rs 10,590');
    m.click(m.button('Add to order'));
    expect(cartLineMoney(config, added[0]!, configUnits(config))).toEqual({ kind: 'ok', minor: HUB });
    expect(toSubmitLines({ lines: added })[0]).toMatchObject({ deal_id: 'D1', quantity: 3, deal_choices: [{ deal_part_id: 'P1', item_id: 'I3', options: [{ option_id: 'M1', quantity: 1 }] }, { deal_part_id: 'P2', item_id: 'I4' }] });
    m.unmount();
  });

  it('[02b Q-64] a part option a menu change removed is dropped in the picker, with a notice; the part can be finished', () => {
    const config = cfg();
    const added: CartLine[] = [];
    const m = mount();
    const draw = (c: BranchConfig) =>
      m.render(<DealSheet config={c} unitOf={configUnits(c)} inputs={inputs(c)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={(l) => added.push(l)} onClose={() => {}} />);
    draw(config);
    m.click(m.button('Chicken Karahi — Half'));
    m.click(m.button('Naan'));
    m.click(m.button('Options'));
    m.click(m.button('Thick'));
    m.click(m.button('Done', m.container.querySelector('.acts')!));
    expect(m.container.querySelector('.dsh')?.textContent).toContain('+ Thick');
    // the menu drops Thick
    const without: BranchConfig = { ...config, modifier_groups: config.modifier_groups.map((g) => (g.modifier_group_id === 'G1' ? { ...g, options: g.options.filter((o) => o.option_id !== 'THK') } : g)) };
    draw(without);
    expect(m.container.querySelector('.dsh')?.textContent).not.toContain('+ ');
    expect(m.button('Choose options for Part 1').hasAttribute('disabled')).toBe(true);
    m.click(m.button('Options'));
    expect(m.text()).toContain('Some options are no longer on the menu — pick again');
    m.click(m.button('Regular'));
    m.click(m.button('Done', m.container.querySelector('.acts')!));
    m.click(m.button('Add to order'));
    expect(added[0]!.deal_choices![0]!.options).toEqual([{ option_id: 'REG', quantity: 1 }]);
    m.unmount();
  });

  it('[02b Q-64] tapping the chosen item again keeps its (paid) options and the total', () => {
    const base = cfg();
    const config: BranchConfig = { ...base, modifier_groups: base.modifier_groups.map((g) => (g.modifier_group_id === 'G1' ? { ...g, options: g.options.map((o) => (o.option_id === 'THK' ? { ...o, price_minor: 5_000 } : o)) } : g)) };
    const m = mount();
    m.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} />);
    m.click(m.button('Chicken Karahi — Half'));
    m.click(m.button('Naan'));
    m.click(m.button('Options'));
    m.click(m.button('Thick'));
    m.click(m.button('Done', m.container.querySelector('.acts')!));
    expect(m.container.querySelector('.qline .pv strong')?.textContent).toBe('Rs 3,250');
    m.click(m.button('Chicken Karahi — Half'));
    expect(m.container.querySelector('#part-t')).toBeNull(); // filled: no picker
    expect(m.container.querySelector('.dsh')?.textContent).toContain('+ Thick');
    expect(m.container.querySelector('.qline .pv strong')?.textContent).toBe('Rs 3,250');
    m.unmount();
  });

  it('[02b Q-64] a part that auto-picks its only choice with an unfilled required group opens the picker', () => {
    const base = cfg();
    const config: BranchConfig = {
      ...base,
      modifier_groups: base.modifier_groups.map((g) => (g.modifier_group_id === 'G1' ? { ...g, options: g.options.map((o) => ({ ...o, is_default: false })) } : g)),
      deals: base.deals.map((d) => ({ ...d, parts: d.parts.map((part) => (part.deal_part_id === 'P1' ? { ...part, choices: part.choices.filter((c) => c.item_id === 'I1') } : part)) })),
    };
    const m = mount();
    m.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} />);
    expect(m.container.querySelector('#part-t')?.textContent).toBe('Chicken Karahi — Half');
    expect(m.button('Choose 1 in Gravy').hasAttribute('disabled')).toBe(true);
    m.unmount();
  });

  it('[02b Q-64] the picker item leaves the menu while it is open: back to the deal (kept), with a notice', () => {
    const config = cfg();
    const notices: string[] = [];
    const m = mount();
    const draw = (c: BranchConfig) =>
      m.render(<DealSheet config={c} unitOf={configUnits(c)} inputs={inputs(c)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} onNotice={(x) => notices.push(x)} />);
    draw(config);
    m.click(m.button('Chicken Karahi — Half'));
    m.click(m.button('Naan'));
    m.click(m.button('Options'));
    expect(m.container.querySelector('#part-t')).not.toBeNull();
    const gone: BranchConfig = { ...config, items: config.items.filter((i) => i.item_id !== 'I1') };
    draw(gone);
    expect(m.container.querySelector('#deal-t')?.textContent).toBe('Family Deal');
    expect(notices).toEqual(['This item changed — pick again']);
    expect(m.container.querySelectorAll('.dsh')[1]!.textContent).toContain('Done'); // the rest of the deal is kept
    // picking Full later does not reopen a picker it does not need (Regular is its default)
    m.click(m.button('Chicken Karahi — Full'));
    expect(m.container.querySelector('#part-t')).toBeNull();
    m.unmount();
  });

  it('[02b Q-64] a full multi-choice group refuses one more, with the group limit', () => {
    const base = cfg();
    const config: BranchConfig = {
      ...base,
      modifier_groups: [
        ...base.modifier_groups,
        {
          modifier_group_id: 'G7',
          name: 'Toppings',
          min_choices: 0,
          max_choices: 2,
          sort_order: 7,
          has_plain_options: true,
          options: ['A', 'B', 'C'].map((x, k) => ({ option_id: `T${x}`, name: `Top ${x}`, price_minor: 0, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: k })),
        },
      ],
      items: base.items.map((i) => (i.item_id === 'I4' ? { ...i, modifier_group_ids: ['G7'] } : i)),
    };
    const m = mount();
    m.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} />);
    m.click(m.button('Naan'));
    m.click(m.button('Options'));
    m.click(m.button('Top A'));
    m.click(m.button('Top B'));
    m.click(m.button('Top C'));
    expect(m.button('Top C').getAttribute('aria-pressed')).toBe('false');
    expect(m.text()).toContain('Up to 2 in Toppings');
    expect(m.button('Done', m.container.querySelector('.acts')!).hasAttribute('disabled')).toBe(false);
    m.unmount();
  });
});
