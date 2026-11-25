import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { StaffApp } from '../../StaffApp';
import { screenHarness } from '../takeaway/screen-harness';
import { CustomerDisplay } from './CustomerDisplay';
import { cartDisplay, createDisplayPublisher, openDisplayChannel, type DisplayMessage } from './channel';

const ready = Date.UTC(2026, 10, 24, 8, 42);
const cart: DisplayMessage = {
  v: 1, kind: 'cart', lines: [{ name: 'Naan', qty: 2, line_minor: 119_000 }],
  total_minor: 119_000, ready_by_ms: ready, lang: 'en',
};

class Channel extends EventTarget {
  static channels: Channel[] = [];
  constructor(readonly name: string) {
    super();
    Channel.channels.push(this);
  }
  postMessage(data: unknown) {
    for (const peer of Channel.channels) {
      if (peer !== this && peer.name === this.name) peer.dispatchEvent(new MessageEvent('message', { data }));
    }
  }
  close() {
    Channel.channels = Channel.channels.filter((peer) => peer !== this);
  }
}

describe('counter-facing display [02b §8/O17; CustomerDisplay]', () => {
  let view: Mounted;
  beforeEach(() => {
    Channel.channels = [];
    vi.stubGlobal('BroadcastChannel', Channel);
    view = mount();
  });
  afterEach(() => {
    view.unmount();
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  function deliver(data: unknown) {
    const channel = new Channel('pos-customer-display');
    act(() => channel.postMessage(data));
    channel.close();
  }

  it('constructs a payload with only menu facts even when the cart contains contact and notes', () => {
    const line = { key: 'L1', item_id: 'N1', quantity: 2, options: [], kitchen_note: 'Private' };
    const draft = { lines: [line], takeaway: { customer_name: 'Private Customer', phone: '03001234567' } };
    expect(cartDisplay(draft, () => 'Naan', () => 119_000, 119_000, ready, 'en')).toEqual(cart);
  });

  it('starts idle, renders cart, ignores malformed data and shows confirmed payment', () => {
    view.render(<CustomerDisplay utcOffsetMs={18_000_000} />);
    expect(view.text()).toContain('Welcome');
    deliver({ ...cart, v: 2 });
    deliver({ ...cart, lines: [{ ...cart.lines[0], line_minor: Infinity }] });
    deliver({ ...cart, customer_name: 'Private Customer', phone: '03001234567' });
    expect(view.text()).toContain('Welcome');
    deliver(cart);
    expect(view.text()).toContain('Naan');
    expect(view.text()).toContain('2×');
    expect(view.text()).toContain('Rs 1,190');
    expect(view.text()).toContain('Ready by');
    expect(view.text()).toContain('1:42 PM');
    deliver({ ...cart, kind: 'paid', change_minor: 31_000 });
    expect(view.text()).toMatch(/Paid · ادا ہو گیا/);
    expect(view.text()).toContain('Rs 310');
    expect(view.text()).not.toMatch(/Private Customer|03001234567/);
    deliver({ ...cart, kind: 'idle', lines: [], ready_by_ms: null, total_minor: 0 });
    expect(view.text()).toContain('Welcome');
    expect(view.text()).not.toContain('Naan');
  });

  it.each(['en', 'ur'] as const)('shows both languages with LTR numbers on a %s kiosk', (lang) => {
    view.render(<CustomerDisplay utcOffsetMs={18_000_000} />);
    expect(view.text()).toMatch(/Welcome.*خوش آمدید/);
    deliver({ ...cart, lang, lines: [...cart.lines, { name: 'Raita · رائتہ', qty: 1, line_minor: 12000 }] });
    expect(view.text()).toMatch(/Your order · آپ کا آرڈر/);
    expect(view.text()).toMatch(/Total · کل/);
    expect(view.text()).toMatch(/Ready by · تیار ہوگا/);
    expect(view.text()).toMatch(/Thank you!.*شکریہ! اپنا ٹوکن پرچی پر دیکھیں/);
    expect(view.text()).toContain('Raita · رائتہ');
    expect(view.container.querySelector('[lang="ur"][dir="rtl"]')?.textContent).toBeTruthy();
    const numbers = [...view.container.querySelectorAll('[dir="ltr"]')].map((node) => node.textContent);
    expect(numbers).toEqual(expect.arrayContaining(['2×', 'Rs 1,190', '1:42 PM']));
  });

  it('opens the route without a session or calls to fetch', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    window.location.hash = '#/customer-display';
    view.render(<StaffApp />);
    await flush();
    expect(view.text()).toContain('Welcome');
    expect(fetch).not.toHaveBeenCalled();
    expect(view.container.querySelector('input')).toBeNull();
  });

  it('coalesces cart and preview changes, delivers paid immediately and clears on exit', () => {
    vi.useFakeTimers();
    const receiver = new Channel('pos-customer-display');
    const received = vi.fn<(event: MessageEvent<DisplayMessage>) => void>();
    receiver.addEventListener('message', (event) => received(event as MessageEvent<DisplayMessage>));
    const publisher = createDisplayPublisher('en');
    try {
      publisher.publish(cart);
      publisher.publish({ ...cart, ready_by_ms: ready + 60_000 });
      expect(received).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
      expect(received).toHaveBeenCalledTimes(1);
      expect(received.mock.calls[0]?.[0].data.ready_by_ms).toBe(ready + 60_000);

      publisher.publish(cart);
      publisher.publish({ ...cart, kind: 'paid', change_minor: 0 });
      expect(received).toHaveBeenCalledTimes(2);
      expect(received.mock.calls[1]?.[0].data.kind).toBe('paid');
      vi.advanceTimersByTime(150);
      expect(received).toHaveBeenCalledTimes(2);
      publisher.close();
      expect(received.mock.calls[2]?.[0].data.kind).toBe('idle');
    } finally {
      receiver.close();
      vi.useRealTimers();
    }
  });

  it.each([false, true])('posts only cart facts and signals payment only for a confirmed close (%s)', async (closed) => {
    const total = { subtotal_minor: 4000, discount_minor: 0, service_charge_minor: 0, taxes: [], rounding_minor: 0, total_minor: 4000 };
    const reply = { ok: true, data: { total_minor: 4000, change_minor: 600, bill_state: 'closed', receipt: { job_id: null } } };
    const harness = screenHarness({
      rows: [],
      answer: (type) => type === 'SubmitOrder' ? { status: 'sent' } : undefined,
      bill: () => ({ state: 'projected', currency: { code: 'PKR', exponent: 2 }, splits: [{ split_no: 1, state: 'open', payments: [], totals: { cash: total, digital: total, as_paid: total }, balance_minor: 4000 }] }),
      command: (type) => type === 'AddPayment'
        ? { ok: true, data: { totals: { as_paid: total }, balance_minor: 0 } }
        : closed ? reply : { ok: false, error: { kind: 'api', status: 409, code: 'BILL_BALANCE_DUE', details: {} } },
    });
    const receiver = new Channel('pos-customer-display');
    const messages: unknown[] = [];
    receiver.addEventListener('message', (event) => messages.push((event as MessageEvent<unknown>).data));
    const order = harness.render();
    try {
      await flush();
      for (const [field, value] of [['customer_name', 'Private Customer'], ['phone', '03001234567']]) {
        const input = order.container.querySelector<HTMLInputElement>(`input[name="${field}"]`)!;
        act(() => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }
      order.click(order.button('Sides', order.container.querySelector('.cats')!));
      order.click(order.container.querySelector('.mi[aria-label="Naan"]'));
      await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ kind: 'cart', lines: [{ name: 'Naan', qty: 1, line_minor: 4000 }] })));
      order.click(order.button('Send & pay'));
      await flush(8);
      order.click(order.button('Exact'));
      order.click(order.button('Paid · print receipt'));
      await flush(8);
      expect(harness.sent[0]?.payload).toMatchObject({ takeaway: { customer_name: 'Private Customer', phone: '03001234567' } });
      expect(harness.commands.map((command) => command.type)).toEqual(['AddPayment', 'CloseSplit']);
      expect(messages.filter((message) => (message as DisplayMessage).kind === 'paid')).toEqual(closed
        ? [expect.objectContaining({ change_minor: 600, total_minor: 4000 })] : []);
      expect(JSON.stringify(messages)).not.toMatch(/customer_name|phone|Private Customer|03001234567/);
    } finally {
      order.unmount();
      receiver.close();
    }
  });

  it('shows the queued token’s confirmed amount and change, then goes idle on Next customer', async () => {
    const total = { subtotal_minor: 4000, discount_minor: 0, service_charge_minor: 0, taxes: [], rounding_minor: 0, total_minor: 4000 };
    const h = screenHarness({
      bills: { O48: { state: 'projected', currency: { code: 'PKR', exponent: 2 }, splits: [{ split_no: 1, state: 'open', payments: [], totals: { cash: total, digital: total, as_paid: total }, balance_minor: 4000 }] } },
      command: (type) => type === 'AddPayment'
        ? { ok: true, data: { totals: { as_paid: total }, balance_minor: 0 } }
        : { ok: true, data: { total_minor: 4000, change_minor: 600, bill_state: 'closed', receipt: { job_id: null } } },
    });
    view.render(<CustomerDisplay utcOffsetMs={0} />);
    const order = h.render();
    try {
      await flush();
      order.click(order.button('Take payment', order.container.querySelector('.tk-rt')!));
      await flush(8);
      expect(view.text()).toContain('Welcome');
      order.click(order.button('Exact'));
      order.click(order.button('Paid · print receipt'));
      await flush(8);
      expect(view.text()).toContain('Paid');
      expect(view.text()).toContain('Rs 40');
      expect(view.text()).toContain('Rs 6');
      expect(view.text()).not.toContain('Ali');
      order.click(order.button('Next customer'));
      await flush();
      expect(view.text()).toContain('Welcome');
    } finally { order.unmount(); }
  });

  it('keeps idle when the channel constructor throws', () => {
    vi.stubGlobal('BroadcastChannel', class { constructor() { throw new Error('blocked'); } });
    expect(openDisplayChannel()).toBeNull();
    view.render(<CustomerDisplay utcOffsetMs={0} />);
    expect(view.text()).toContain('Welcome');
  });
});
