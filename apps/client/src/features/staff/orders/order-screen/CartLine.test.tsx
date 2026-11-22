import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../../../../../test/dom';
import { CartLineRow, type LineView } from './CartLine';

// 02b v1.0.21 §8 (STAB-5, test 41): a split line's row shows each part time with its count under the clock time.
let m: Mounted;
afterEach(() => m?.unmount());

const config = aBranchConfig();
const item = config.items[0]!;
const view = (o: Partial<LineView> = {}): LineView => ({
  line: { key: 'K', item_id: item.item_id, quantity: 5, options: [] },
  eta_ms: 2_400_000,
  moved: false,
  zone_name: null,
  problem: null,
  open: false,
  cap: null,
  ...o,
});
const actions = { toggle: () => undefined, setUnits: () => undefined, remove: () => undefined, edit: () => undefined };

describe('[02b v1.0.21 §8] cart row part times', () => {
  it('[02b #41] parts with two times → "4 ready ~12:20 AM · 1 ready ~12:40 AM"; one time → nothing extra', () => {
    m = mount();
    m.render(<CartLineRow view={view({ parts: [{ n: 4, eta_ms: 1_200_000 }, { n: 1, eta_ms: 2_400_000 }] })} config={config} unitOf={() => 'piece'} utcOffsetMs={0} actions={actions} />);
    expect(m.container.querySelector('.ln__parts')?.textContent).toBe('4 ready ~12:20 AM · 1 ready ~12:40 AM');
    m.render(<CartLineRow view={view()} config={config} unitOf={() => 'piece'} utcOffsetMs={0} actions={actions} />);
    expect(m.container.querySelector('.ln__parts')).toBeNull();
  });

  // 02b v1.0.23 §8 (STAB-6, test 57): naan ×10 on a batch station (02b #56: 3 parts in the next round, 7 in the one after)
  it('[02b #57] naan ×10 split over two rounds → "3 ready ~2:10 PM · 7 ready ~2:14 PM" (the v1.0.21 row, unchanged)', () => {
    m = mount();
    const t = (h: number, min: number): number => (h * 60 + min) * 60_000;
    m.render(<CartLineRow view={view({ line: { key: 'N', item_id: item.item_id, quantity: 10, options: [] }, eta_ms: t(14, 14), parts: [{ n: 3, eta_ms: t(14, 10) }, { n: 7, eta_ms: t(14, 14) }] })} config={config} unitOf={() => 'piece'} utcOffsetMs={0} actions={actions} />);
    expect(m.container.querySelector('.ln__parts')?.textContent).toBe('3 ready ~2:10 PM · 7 ready ~2:14 PM');
  });
});
