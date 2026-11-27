import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ltr, monogram } from './TkSheetParts';
import { mount } from '../../../../../test/dom';
import type { AvailabilityInputs } from '../live/availability';
import type { StockLevel, StockMirror } from '../contracts';
import { configUnits, type CartLine } from '../order-screen/cart';
import { DealSheet } from './DealSheet';
import { OptionsSheet } from './OptionsSheet';

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

// ⚠️ 02b-TK L-CLIENT-6b item 3 (frames ItemSheet, ItemSheetEdit, ItemSheetKg, DealSheet; MAPPING TK-D03, TK-D04): the
// takeaway screen's sheets (look 'tk'). Same choices, checks and lines as the 02-D04 sheet (sheets.test.tsx); the
// frame's layout: sizes with price + time, add-on cards with steppers, cooking choices, the inline note, the footer.

describe('[02b-TK L-CLIENT-6b item 3] takeaway sheets', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  const sheetOf = (config: BranchConfig, o: { item_ids: string[]; initial?: CartLine | null; onAdd?: (l: CartLine) => void; onRemove?: () => void; inputs?: AvailabilityInputs }) => {
    const m = mount();
    m.render(
      <OptionsSheet
        look="tk"
        config={config}
        unitOf={configUnits(config)}
        inputs={o.inputs ?? inputs(config)}
        item_ids={o.item_ids}
        initial={o.initial ?? null}
        capOf={() => null}
        sheet={false}
        newKey={newKey}
        onAdd={o.onAdd ?? (() => {})}
        {...(o.onRemove === undefined ? {} : { onRemove: o.onRemove })}
        onClose={() => {}}
      />,
    );
    return m;
  };

  it('[frame ItemSheet] header, sizes with price and time, rule chips, add-on steppers; the primary shows the price and adds on Enter', () => {
    const config = cfg();
    const added: CartLine[] = [];
    const m = sheetOf(config, { item_ids: ['I1', 'I3'], onAdd: (l) => added.push(l), inputs: { ...inputs(config), stationWaitMs: () => 0 } });
    expect(m.container.querySelector('.tk-sheet__t h2')?.textContent).toBe('Chicken Karahi');
    expect(m.container.querySelector('.tk-sheet__t small')?.textContent).toMatch(/^Ready by/);
    expect([...m.container.querySelectorAll('.tk-var')].map((b) => b.textContent)).toEqual(['HalfRs 1,200 · 20 min', 'FullRs 1,200 · 20 min']);
    expect([...m.container.querySelectorAll('.tk-sec-h')].map((h) => h.textContent)).toEqual(['SizePick 1', 'GravyPick 1', 'Add-onsAny amount']);
    // the add-on with max_quantity 2 has a card with a stepper; Raita (once) too, in a group of steppers
    m.click(m.button('One more Extra naan'));
    m.click(m.button('One more Extra naan'));
    expect(m.container.querySelector('.tk-opt[aria-label="Extra naan"] output')?.textContent).toBe('2');
    expect(m.container.querySelector('.tk-opt[aria-label="Extra naan"]')?.className).toContain('is-on');
    expect(m.container.querySelector('.tk-sheet__go')?.textContent).toBe('Add to order·Rs 1,280Enter');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(added).toEqual([{ key: expect.any(String), item_id: 'I1', quantity: 1, options: [{ option_id: 'REG', quantity: 1 }, { option_id: 'NAAN', quantity: 2, order_item_id: expect.any(String) }] }]);
    m.unmount();
  });

  it('[frame ItemSheet] the inline kitchen note goes on the line; a sold-out add-on is off with its reason', () => {
    const config = cfg();
    const added: CartLine[] = [];
    const m = sheetOf(config, { item_ids: ['I1'], onAdd: (l) => added.push(l), inputs: inputs(config, stock({ I5: 0 }, { I5: 'out' })) });
    expect(m.container.querySelector('.tk-opt--off[aria-label="Raita"]')?.textContent).toBe('RaitaKitchen turned it offSold out');
    const note = m.container.querySelector<HTMLInputElement>('.tk-knote input')!;
    expect(note.placeholder).toBe('Kitchen note (80)');
    expect(note.maxLength).toBe(80);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(note, 'less oil');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    m.click(m.container.querySelector<HTMLButtonElement>('.tk-sheet__go'));
    expect(added[0]!.kitchen_note).toBe('less oil');
    m.unmount();
  });

  it('[frame ItemSheetKg] By kg: the 0.75 kg chip and the pad set the weight; Weigh later adds it pending (quantity null)', () => {
    const config = cfg();
    const added: CartLine[] = [];
    const m = sheetOf(config, { item_ids: ['I2'], onAdd: (l) => added.push(l) });
    expect(m.container.querySelector('.tk-sec-h')?.textContent).toBe('Weight50 g steps');
    m.click([...m.container.querySelectorAll<HTMLButtonElement>('.tk-kg__chips .tk-btn')].find((b) => b.textContent === '0.75 kg')!);
    expect(m.container.querySelector('.tk-kg__box b')?.textContent).toBe('0.75 kg');
    m.click(m.container.querySelector<HTMLButtonElement>('.tk-sheet__go'));
    expect(added[0]!.quantity).toBe(750);
    m.unmount();
    const later: CartLine[] = [];
    const m2 = sheetOf(config, { item_ids: ['I2'], onAdd: (l) => later.push(l) });
    m2.click(m2.button('Weigh later — price after weighing'));
    expect(m2.container.querySelector('.tk-sheet__go')?.textContent).toContain('Price after weighing');
    m2.click(m2.container.querySelector<HTMLButtonElement>('.tk-sheet__go'));
    expect(later[0]!.quantity).toBeNull();
    m2.unmount();
  });

  it('[frame ItemSheetEdit] editing: "Save changes · Rs X", the red trash on the left removes the line', () => {
    const config = cfg();
    const removed: number[] = [];
    const m = sheetOf(config, { item_ids: ['I1', 'I3'], initial: { key: 'L1', item_id: 'I3', quantity: 2, options: [{ option_id: 'REG', quantity: 1 }] }, onRemove: () => removed.push(1) });
    expect(m.container.querySelector('.tk-var[aria-pressed="true"]')?.textContent).toContain('Full');
    expect(m.container.querySelector('.tk-sheet__qty output')?.textContent).toBe('2');
    expect(m.container.querySelector('.tk-sheet__go')?.textContent).toBe('Save changes·Rs 2,400Enter');
    const trash = m.container.querySelector<HTMLButtonElement>('.tk-sheet__f > .tk-sheet__trash')!;
    expect(m.container.querySelector('.tk-sheet__f')!.firstElementChild).toBe(trash);
    m.click(trash);
    expect(removed).toEqual([1]);
    m.unmount();
  });

  it('[frame DealSheet] the deal: a part with several choices is big buttons, one choice (01c §3.4.3); the primary carries the price', () => {
    const config = cfg();
    const added: CartLine[] = [];
    const m = mount();
    m.render(<DealSheet look="tk" config={config} unitOf={configUnits(config)} inputs={inputs(config)} deal_id="D1" initial={null} sheet={false} newKey={newKey} onAdd={(l) => added.push(l)} onClose={() => {}} />);
    expect([...m.container.querySelectorAll('.tk-sec-h b')].map((b) => b.textContent)).toEqual(['1× — pick 1', '4× — pick 1']);
    expect(m.container.querySelector('.tk-sheet__go')?.getAttribute('aria-disabled')).toBe('true');
    const sections = m.container.querySelectorAll('section');
    m.click(m.button('Chicken Karahi — Half', sections[0]!));
    m.click(m.button('Naan', sections[1]!));
    expect(m.container.querySelector('.tk-sheet__go')?.textContent).toBe('Add to order·Rs 3,200Enter');
    m.click(m.container.querySelector<HTMLButtonElement>('.tk-sheet__go'));
    expect(added[0]!.deal_choices!.map((c) => [c.deal_part_id, c.item_id])).toEqual([['P1', 'I1'], ['P2', 'I4']]);
    m.unmount();
  });

  it('[urdu-todo] a time inside a sentence is an LTR isolate; the photo is the name\'s initials', () => {
    expect(ltr('7:02 AM')).toBe('\u20667:02 AM\u2069');
    expect(monogram('Chicken Karahi — Half')).toBe('CK');
    expect(monogram('Paye')).toBe('P');
  });
});
