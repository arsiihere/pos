import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createMemoryDraftStore } from '../drafts/memory-drafts';
import { DraftStoreContext } from '../order-screen/OrderScreen';
import { NewOrderSheet } from './NewOrderSheet';

const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const T = Date.UTC(2025, 9, 20, 15);

function render(initial: 'takeaway' | 'parking' | null = null) {
  const drafts = createMemoryDraftStore();
  const shell = { device: { token: 'tok', id: 'DV1', type: 'tablet' }, me: { staff_id: 'ST1', name: 'Ali' }, clock: { nowMs: () => T, utcOffsetMs: 0 }, phone: false, portrait: false } as unknown as Shell;
  const closed: number[] = [];
  const m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <DraftStoreContext.Provider value={drafts}>
        <NewOrderSheet initial={initial} onClose={() => closed.push(1)} />
      </DraftStoreContext.Provider>
    </ShellContext.Provider>,
  );
  return { m, drafts, closed };
}

/** React reads a typed value through the native setter and an `input` event. */
const type = (_m: ReturnType<typeof mount>, el: Element, value: string) => {
  const input = el as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  act(() => void input.dispatchEvent(new Event('input', { bubbles: true })));
};

describe('[02b §8 Types] new order', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    nav.to = [];
  });

  it('[02b §8 Types] New order offers Takeaway / Parking; dine-in starts from the map', () => {
    const { m } = render();
    expect(m.text()).toContain('Dine-in starts from a table on the map.');
    expect([...m.container.querySelectorAll('.bchip')].map((b) => b.textContent)).toEqual(['Takeaway', 'Parking']);
    m.click(m.button('Takeaway'));
    expect(m.text()).toContain('Both optional. The token comes after Send.');
    m.unmount();
  });

  it('[02b §8 Types] takeaway: name and phone optional (10–13 digits, inline error) → big token after Send', async () => {
    const { m, drafts } = render('takeaway');
    const [name, phone] = [...m.container.querySelectorAll('input')];
    await flush();
    type(m, name!, 'Usman');
    type(m, phone!, '0300 12345');
    await flush();
    expect(m.text()).toContain('Enter 10 to 13 digits');
    expect(m.button('Next').hasAttribute('disabled')).toBe(true);
    type(m, phone!, '0300 1234567');
    await flush();
    expect(m.text()).not.toContain('Enter 10 to 13 digits');
    m.click(m.button('Next'));
    await flush();
    const [d] = await drafts.list('DV1', 'ST1');
    expect(d).toMatchObject({ order_type: 'takeaway', held: false, cart: { lines: [], takeaway: { customer_name: 'Usman', phone: '03001234567' } } });
    expect(nav.to).toEqual([`/order/takeaway/${d!.draft_id}`]);
    m.unmount();
    // Skip: no details at all
    const skip = render('takeaway');
    skip.m.click(skip.m.button('Skip'));
    await flush();
    expect((await skip.drafts.list('DV1', 'ST1'))[0]!.cart).toEqual({ lines: [] });
    skip.m.unmount();
  });

  it('[02b §8 Types] parking: plate LTR mono /^[A-Za-z0-9 -]{2,12}$/; Small car = mini', async () => {
    const { m, drafts } = render('parking');
    const [plate, phone] = [...m.container.querySelectorAll('input')];
    expect(plate!.getAttribute('dir')).toBe('ltr');
    expect(plate!.classList.contains('inp--plate')).toBe(true);
    expect(m.button('Next').hasAttribute('disabled')).toBe(true);
    type(m, plate!, 'leb_1234');
    await flush();
    expect(m.text()).toContain('2 to 12 English letters, digits, space or dash');
    type(m, plate!, 'leb 1234');
    await flush();
    expect(m.button('Next').hasAttribute('disabled')).toBe(true); // the car type is required
    m.click(m.button('Small car'));
    type(m, phone!, '123');
    await flush();
    expect(m.button('Next').hasAttribute('disabled')).toBe(true);
    type(m, phone!, '');
    await flush();
    m.click(m.button('Next'));
    await flush();
    expect((await drafts.list('DV1', 'ST1'))[0]!.cart).toEqual({ lines: [], parking: { car_number: 'LEB 1234', car_type: 'mini' } });
    m.unmount();
  });
});
