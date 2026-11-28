import { describe, expect, it } from 'vitest';
import type { PointLine, PointOrder } from './contracts';
import { bagLate, bagsOf, bagState } from './bags';

// ⚠️ 03b v1.0.17 §3.4 (owner ruling 2026-11-28 "Pass bag = token", BUG-8): the Pass shows ONE card per takeaway /
// parking token — the root and its additions (05 #44a: an addition is its own order with the root's token). The card is
// Ready only when every order of the token is; an addition drops it back to Cooking; its amber "not collected" needs
// every order's bag epoch. Dine-in and token-less orders stay one card per order.

function line(id: string, order_id: string, stage: PointLine['stage'], over: Partial<PointLine> = {}): PointLine {
  return {
    order_item_id: id,
    order_id,
    station_id: 'ST',
    point_id: 'PT',
    identifier: { kind: 'token', token: 14, date: null },
    order_type: 'takeaway',
    item_name: id,
    units: 1,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 60_000,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    stage,
    handed_over: false,
    group_id: `G-${order_id}`,
    serve_mode: 'sync',
    ...over,
  };
}
const order = (order_id: string, lines: PointLine[], over: Partial<PointOrder> = {}): PointOrder => ({
  order_id,
  identifier: { kind: 'token', token: 14, date: null },
  placed_at: 0,
  lines,
  ready: null,
  ...over,
});

describe('[03b v1.0.17 §3.4] Pass bag = token (owner ruling 2026-11-28, BUG-8)', () => {
  it('groups a token\'s orders into one bag (root first); dine-in and other tokens stay their own card', () => {
    const root = order('O1', [line('A', 'O1', 'done')], { placed_at: 10 });
    const add = order('O2', [line('B', 'O2', 'cooking')], { placed_at: 20 });
    const other = order('O3', [line('C', 'O3', 'done')], { identifier: { kind: 'token', token: 15, date: null }, placed_at: 15 });
    const dine = order('O4', [line('D', 'O4', 'done', { order_type: 'dine_in', identifier: { kind: 'table', label: 'T1' } })], { identifier: { kind: 'table', label: 'T1' }, placed_at: 5 });
    const bags = bagsOf([dine, root, other, add]);
    expect(bags.map((b) => b.orders.map((o) => o.order_id))).toEqual([['O4'], ['O1', 'O2'], ['O3']]);
    const bag = bags[1]!;
    expect(bag.key).toBe('token::14');
    expect(bag.card.order_id).toBe('O1');
    expect(bag.card.placed_at).toBe(10);
    expect(bag.card.lines.map((l) => l.order_item_id)).toEqual(['A', 'B']);
    // the same token number on another business day is another bag
    const yesterday = order('O5', [line('E', 'O5', 'done')], { identifier: { kind: 'token', token: 14, date: '2026-11-26' } });
    expect(bagsOf([root, yesterday])).toHaveLength(2);
  });

  it('an addition after Ready drops the card back to Cooking; Ready only when every order is ready', () => {
    const sent = order('O1', [line('A', 'O1', 'done')], { ready: { at: 5, by: null, lines: ['A'] } });
    expect(bagState(bagsOf([sent])[0]!, 0).state).toBe('sent');
    const add = order('O2', [line('B', 'O2', 'cooking')], { placed_at: 9 });
    expect(bagState(bagsOf([sent, add])[0]!, 0).state).toBe('cooking');
    // the addition cooked: the bag is ready again (the root's Ready is open, the addition has a done line)
    const addDone = order('O2', [line('B', 'O2', 'done')], { placed_at: 9 });
    expect(bagState(bagsOf([sent, addDone])[0]!, 0).state).toBe('ready');
    // both marked ready → sent
    const addSent = { ...addDone, ready: { at: 12, by: null, lines: ['B'] } };
    expect(bagState(bagsOf([sent, addSent])[0]!, 0).state).toBe('sent');
    // an order already handed over in full does not hold the bag
    const gone = order('O0', [line('Z', 'O0', 'done', { handed_over: true })]);
    expect(bagState(bagsOf([gone, sent])[0]!, 0).state).toBe('sent');
  });

  it('amber "not collected" only when every open order of the token has its epoch past the window', () => {
    const epoch = { bag_ready_since: 1_000, bag_ready_window_ms: 60_000 };
    const root = order('O1', [line('A', 'O1', 'done')], { ...epoch, ready: { at: 1_000, by: null, lines: ['A'] } });
    expect(bagLate(bagsOf([root])[0]!, 200_000)).toBe(3);
    // the addition is cooking (no epoch): the root's amber is not shown (BUG-8)
    const add = order('O2', [line('B', 'O2', 'cooking')], { placed_at: 9, bag_ready_since: null, bag_ready_window_ms: null });
    expect(bagLate(bagsOf([root, add])[0]!, 200_000)).toBeNull();
    // both complete: the later epoch counts
    const addDone = order('O2', [line('B', 'O2', 'done')], { placed_at: 9, bag_ready_since: 61_000, bag_ready_window_ms: 60_000 });
    expect(bagLate(bagsOf([root, addDone])[0]!, 100_000)).toBeNull();
    expect(bagLate(bagsOf([root, addDone])[0]!, 181_000)).toBe(2);
  });
});
