import { afterEach, describe, expect, it } from 'vitest';
import { MIN, NOW, row } from '../../../test/alert-rows';
import { mount, type Mounted } from '../../../test/dom';
import { Banners } from './Banner';
import { counterReady03b } from './labels-03b';
import type { AlertRow } from './store';

// 02b-TK L-CLIENT-1 item 2 (03b v1.0.16 §3.5 step 4 "the counter", "Order-level counter alert (R8, D8)", §6.21; R8;
// frames TokenLate, ReadyTiles, HandoverUndo): on a counter device (its profile shows the takeaway / parking screen) a
// `ready_to_serve` card for a takeaway ("#48") or parking ("PARKING") order is the order-level counter alert — the hub
// never sends a counter device a per-point Ready (excludesDevice). It reads "Bag ready — hand over at the counter";
// at 1× the window "Ready {n} min ago — not collected" (amber); at 2× (escalation) "Not collected for {n} min —
// managers told" (amber).

const ready = (code: string, over: Partial<AlertRow> = {}): AlertRow =>
  row({
    alert_id: 'R1',
    kind: 'ready_to_serve',
    family: 'action',
    set: 'recipient',
    lock: { kind_label_key: 'alert.ready_to_serve.lock', table_code: code, point_code: 'Pass', requester_name: null },
    card: { kind_label_key: 'alert.ready_to_serve.card', table_code: code, point_code: 'Pass', requester_name: null, device_name: null, details: { identifier: code === 'PARKING' ? 'LEA 123' : code, lines: [{ name: 'Paye', quantity: 2, state: 'done' }] } },
    raised_at: NOW - 2 * MIN,
    ...over,
  });

describe('[03b v1.0.16 §3.5 R8] the counter Ready on a counter device', () => {
  it('only for ready_to_serve cards of the screen the device shows; the steps read 0 / 1× / 2×', () => {
    expect(counterReady03b(ready('#48'), ['takeaway', 'cashier'], NOW)).toEqual({ title: 'Bag ready — hand over at the counter', line: null, late: false });
    expect(counterReady03b(ready('#48'), ['parking'], NOW)).toBeNull();
    expect(counterReady03b(ready('PARKING'), ['parking'], NOW)).not.toBeNull();
    expect(counterReady03b(ready('4'), ['takeaway', 'dine_in'], NOW)).toBeNull();
    expect(counterReady03b({ ...ready('#48'), card: undefined }, ['takeaway'], NOW)).toBeNull();
    expect(counterReady03b({ ...ready('#48'), kind: 'served_card' }, ['takeaway'], NOW)).toBeNull();
    expect(counterReady03b(ready('#48', { step: 1 }), ['takeaway'], NOW)).toEqual({ title: 'Bag ready — hand over at the counter', line: 'Ready 2 min ago — not collected', late: true });
    expect(counterReady03b(ready('#48', { step: 2, escalation: true, raised_at: NOW - 3 * MIN }), ['takeaway'], NOW)).toEqual({ title: 'Bag ready — hand over at the counter', line: 'Not collected for 3 min — managers told', late: true });
  });
});

let m: Mounted;
afterEach(() => m?.unmount());

describe('[03b v1.0.16 §3.5 R8, frame TokenLate] the counter banner', () => {
  it('a counter device: the counter card, amber at the escalation; another device keeps the Pass wording', () => {
    m = mount();
    m.render(<Banners banners={[ready('#48', { step: 2, escalation: true })]} nowMs={NOW} lockOnly={false} counterScreens={['takeaway']} onOpen={() => {}} onOpenInbox={() => {}} />);
    const b = m.container.querySelector('.abn')!;
    expect(b.classList.contains('abn--counter')).toBe(true);
    expect(b.classList.contains('c-warn')).toBe(true);
    expect(b.querySelector('.tcode')!.textContent).toBe('#48');
    expect(b.querySelector('.ac__title b')!.textContent).toBe('Bag ready — hand over at the counter');
    expect(b.querySelector('.ac__who')!.textContent).toBe('Not collected for 2 min — managers told');
    expect(b.textContent).toContain('Paye ×2');
    m.unmount();
    m = mount();
    m.render(<Banners banners={[ready('#48', { step: 2, escalation: true })]} nowMs={NOW} lockOnly={false} counterScreens={['dine_in']} onOpen={() => {}} onOpenInbox={() => {}} />);
    const p = m.container.querySelector('.abn')!;
    expect(p.classList.contains('abn--counter')).toBe(false);
    expect(p.querySelector('.ac__who')!.textContent).toBe('Pass · nobody came for 2 min');
  });
});
