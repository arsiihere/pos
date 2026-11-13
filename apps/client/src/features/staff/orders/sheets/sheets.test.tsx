import { optionChargeMinor, orderLineTotalMinor } from '@pos/domain';
import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '../../../../../test/dom';
import type { AvailabilityInputs } from '../live/availability';
import type { StockLevel, StockMirror } from '../contracts';
import { configUnits, type CartLine } from '../order-screen/cart';
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

  it('[02b §8 Ordering screen] deal parts are checked as the hub checks them (child position, V9; Q-64 open)', () => {
    const base = cfg();
    // I3 Full needs a gravy (G3, plain, no default): a deal part cannot pick it → off with the reason.
    // I1 Half's only required group is all-linked (G4): not offered in a child position → the hub takes it.
    const config: BranchConfig = {
      ...base,
      modifier_groups: [
        ...base.modifier_groups,
        { modifier_group_id: 'G3', name: 'Sauce', min_choices: 1, max_choices: 1, sort_order: 3, has_plain_options: true, options: [{ option_id: 'S1', name: 'Red', price_minor: 0, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 1 }] },
        { modifier_group_id: 'G4', name: 'Side', min_choices: 1, max_choices: 1, sort_order: 4, has_plain_options: false, options: [{ option_id: 'L1', name: 'Naan side', price_minor: 4_000, max_quantity: 1, is_default: false, linked_item_id: 'I4', sort_order: 1 }] },
      ],
      items: base.items.map((i) => (i.item_id === 'I3' ? { ...i, modifier_group_ids: ['G3'] } : i.item_id === 'I1' ? { ...i, modifier_group_ids: ['G4'] } : i)),
    };
    const m = mount();
    m.render(<DealSheet config={config} unitOf={configUnits(config)} inputs={inputs(config)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={() => {}} onClose={() => {}} />);
    expect(m.button('Chicken Karahi — Full · needs a choice a deal can’t make').hasAttribute('disabled')).toBe(true);
    const half = m.button('Chicken Karahi — Half');
    expect(half.hasAttribute('disabled')).toBe(false);
    m.click(half);
    m.click(m.button('Naan'));
    expect(m.button('Add to order').hasAttribute('disabled')).toBe(false);
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
});
