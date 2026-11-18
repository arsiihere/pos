import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../../../../../test/dom';
import type { SeatingLine, SeatingOrder } from '../contracts';
import { Round, type RoundProps } from './Round';

// 02b v1.0.15 §8 (01d v1.3 L-4b, review m6): Round's optional `forceOpen` — a folded (all served) round renders
// open for a deep link, and the person can still fold it again.

const NOW = Date.UTC(2026, 10, 13, 15, 15);

function sline(order_item_id: string, over: Partial<SeatingLine> = {}): SeatingLine {
  return {
    order_item_id,
    order_id: 'O2',
    parent_order_item_id: null,
    line_kind: 'item',
    item_id: `I-${order_item_id}`,
    deal_id: null,
    name: order_item_id,
    sale_unit: 'piece',
    quantity: 1,
    units: 1,
    live_units: 1,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: 50_000,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: 50_000,
    billed_minor: 50_000,
    return_of: null,
    served_from_zone_id: null,
    zone_served: false,
    added_at: NOW - 5 * 60_000,
    served_at: NOW - 60_000,
    served_source: null,
    is_food: true,
    kitchen_note: null,
    stage: 'served',
    fired: true,
    ...over,
  };
}

const served: SeatingOrder = {
  order_id: 'O2',
  placed_by: { staff_id: 'ST-ALI', name: 'Ali' },
  placed_at: NOW - 10 * 60_000,
  follow_up: false,
  cancelled: false,
  billed: false,
  has_phone: false,
  promise_ms: null,
  lines: [sline('L1'), sline('L2')],
};

let m: Mounted;
afterEach(() => m.unmount());

function show(over: Partial<RoundProps> = {}) {
  const props: RoundProps = { order: served, n: 1, utcOffsetMs: 0, selected: null, onSelect: () => {}, controls: () => null, below: () => null, ...over };
  m.render(<Round {...props} />);
  return props;
}

const lines = () => [...m.container.querySelectorAll<HTMLElement>('div.ol[data-line]')].map((l) => l.dataset.line);
const head = () => m.container.querySelector<HTMLElement>('.rnd__h')!;

describe('[02b §8] Round forceOpen', () => {
  it('[02b §8] without forceOpen a fully served round is folded, as before', () => {
    m = mount();
    show();
    expect(lines()).toEqual([]);
    expect(head().getAttribute('aria-expanded')).toBe('false');
  });

  it('[02b §8] forceOpen opens a folded round; the person can fold it again', () => {
    m = mount();
    show({ forceOpen: true });
    expect(lines()).toEqual(['L1', 'L2']);
    expect(head().getAttribute('aria-expanded')).toBe('true');
    m.click(head());
    expect(lines()).toEqual([]);
    // a re-render with the same prop does not force it open again
    show({ forceOpen: true });
    expect(lines()).toEqual([]);
    m.click(head());
    expect(lines()).toEqual(['L1', 'L2']);
  });

  it('[02b §8] forceOpen set after mount (the deep link reads after the rounds load) unfolds the round', () => {
    m = mount();
    show();
    expect(lines()).toEqual([]);
    show({ forceOpen: true });
    expect(lines()).toEqual(['L1', 'L2']);
  });

  it('[02b §8] forceOpen on a round that is not all served changes nothing', () => {
    m = mount();
    show({ order: { ...served, lines: [sline('L1', { served_at: null, stage: 'cooking' })] }, forceOpen: true });
    expect(lines()).toEqual(['L1']);
    expect(head().hasAttribute('aria-expanded')).toBe(false);
  });
});
