import type { LineDetail } from '@pos/domain';
import type { WsServerMessage } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import type { PointLine, PointOrder, PointViewBody } from './contracts';
import { notCollectedMin } from './cards/readiness';
import { passLiveOf } from './live';
import { PassScreen } from './PassScreen';
import { createPassStore } from './store';

// 02b-TK L-CLIENT-1 item 2 (03b v1.0.16 §3.4 "Not collected" (R3-M-9), §3.5 R8, D8; frames TokenLate, ReadyTiles):
// every Pass card of a takeaway / parking order turns amber "Ready {n} min ago — not collected" at hub now ≥
// bag_ready_since + bag_ready_window_ms; the pair comes from the catch-up, `point_lines.orders` and the
// PassBagReadyChanged event; an incomplete or collected bag (the pair cleared) clears it.

const HOUR = 3_600_000;
const BASE = Date.UTC(2025, 9, 20, 8);
const MIN = 60_000;

function detail(id: string, order_id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id, order_id, station_id: 'KARAHI', point_id: 'PT', identifier: { kind: 'token', token: 46, date: null }, order_type: 'takeaway', item_name: 'Karahi',
    units: 1, line_kind: 'item', for_parent: null, deal_name: null, options: [], kitchen_note: null, order_note: null, return_of: null, cook_ms: 1, prep_ms: 0, from_stock: false,
    placed_by_name: null, ...over,
  };
}
function card(order_id: string, over: Partial<PointOrder> = {}, type: 'takeaway' | 'dine_in' = 'takeaway'): PointOrder {
  const identifier = type === 'takeaway' ? { kind: 'token' as const, token: 46, date: null } : { kind: 'table' as const, label: 'T3' };
  const l: PointLine = { ...detail(`${order_id}-L1`, order_id, { identifier, order_type: type }), stage: 'done', handed_over: false };
  return { order_id, identifier, placed_at: BASE - 20 * MIN, ready: { at: BASE - 17 * MIN, by: null, lines: [l.order_item_id] }, lines: [l], ...over };
}
const view = (orders: PointOrder[]): PointViewBody => ({ point_id: 'PT', stations: [], takeovers: [], orders });
const ev = (seq: number, payload: Record<string, unknown>): WsServerMessage => ({ type: 'event', seq, event: { event_id: `E${seq}`, event_type: 'PassBagReadyChanged', schema_version: 1, payload } }) as WsServerMessage;

describe('[03b v1.0.16 §3.4 Not collected (R3-M-9)] the amber clock', () => {
  it('minutes since the bag was ready once the window has passed; null before it, without a pair, or for dine-in', () => {
    const o = card('O46', { bag_ready_since: BASE - 17 * MIN, bag_ready_window_ms: MIN });
    expect(notCollectedMin(o, BASE)).toBe(17);
    expect(notCollectedMin(o, BASE - 16 * MIN - 1)).toBeNull();
    expect(notCollectedMin(o, BASE - 16 * MIN)).toBe(1);
    expect(notCollectedMin(card('O46', { bag_ready_since: null, bag_ready_window_ms: null }), BASE)).toBeNull();
    expect(notCollectedMin(card('O46'), BASE)).toBeNull();
    expect(notCollectedMin(card('O2', { bag_ready_since: BASE - 17 * MIN, bag_ready_window_ms: MIN }, 'dine_in'), BASE)).toBeNull();
  });

  it('[§6.22] PassBagReadyChanged sets the pair of a held order and clears it with ready: null; another order is ignored', () => {
    const store = createPassStore({ now: () => BASE });
    store.apply({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O46')]) } });
    store.apply(ev(2, { order_id: 'O46', ready: { bag_ready_since: BASE - 5 * MIN, bag_ready_window_ms: MIN, alert_id: 'A1', point_id: 'PT' } }));
    expect(store.snapshot().view!.orders[0]).toMatchObject({ bag_ready_since: BASE - 5 * MIN, bag_ready_window_ms: MIN });
    store.apply(ev(3, { order_id: 'O46', ready: null }));
    expect(store.snapshot().view!.orders[0]).toMatchObject({ bag_ready_since: null, bag_ready_window_ms: null });
    const before = store.snapshot();
    store.apply(ev(4, { order_id: 'O-OTHER', ready: null }));
    expect(store.snapshot()).toBe(before);
  });
});

let m: Mounted;
afterEach(() => m?.unmount());

describe('[03b v1.0.16 §3.4, frame TokenLate] the amber Pass card', () => {
  it('"Ready 17 min ago — not collected" on the card (pc--late); the pair cleared → no amber', async () => {
    const live = createLiveBus();
    const shell = {
      live,
      clock: { nowMs: () => BASE, utcOffsetMs: 5 * HOUR },
      api: { roster: () => new Promise(() => undefined), command: () => Promise.resolve({ ok: true, data: {} }), query: () => Promise.resolve({ ok: true, data: { orders: [] } }) },
      permissions: { allowed: (p: string) => p === 'run-pass' },
      toasts: { show: () => undefined },
      online: true,
      portrait: false,
      me: { staff_id: 'S1', name: 'Cook' },
      device: { token: 'DEV', id: 'D-P1', type: 'tablet' },
    } as unknown as Shell;
    const pass = passLiveOf(shell);
    const raw = (f: WsServerMessage) => {
      live.frame(f);
      pass.frame(f);
    };
    raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view([card('O46', { bag_ready_since: BASE - 17 * MIN, bag_ready_window_ms: MIN }), card('O2', {}, 'dine_in')]) } });
    m = mount();
    m.render(
      <ShellContext.Provider value={shell}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    await flush();
    const late = m.container.querySelector<HTMLElement>('.pc[data-order="O46"]')!;
    expect(late.classList.contains('pc--late')).toBe(true);
    expect(late.querySelector('.pc__late')!.textContent).toBe('Ready 17 min ago — not collected');
    expect(m.container.querySelector('.pc[data-order="O2"]')!.classList.contains('pc--late')).toBe(false);
    // incomplete again (D8): the hub clears the pair
    raw({ type: 'point_lines', point_id: 'PT', lines: [], orders: [{ order_id: 'O46', pickup_at_ms: null, boosted: false, pickup_readiness: null, no_station_lines: [], bag_ready_since: null, bag_ready_window_ms: null }] } as WsServerMessage);
    await flush();
    expect(m.container.querySelector('.pc[data-order="O46"]')!.classList.contains('pc--late')).toBe(false);
    expect(m.container.querySelector('.pc__late')).toBeNull();
  });
});
