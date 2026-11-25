import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import type { Shell } from '../../shell/hooks';
import { createContextSlot } from '../../shell/context-slot';
import { screenHarness } from './screen-harness';

// 02b-TK A2 item 1 (frames ShellAnatomy, TokenReady, PayCard; MAPPING TK-SH01; R3): the takeaway order screen fills
// the top bar's context slot — "New takeaway · Usman" / "Token after Send", the open token view's "Token 48 · Ali",
// the customer's name only for view-customer-contact holders — and clears it when it goes.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

const type = (el: Element | null, value: string) => {
  const input = el as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  act(() => void input.dispatchEvent(new Event('input', { bubbles: true })));
};
const nameInput = (m: Mounted) => m.container.querySelector<HTMLInputElement>('.cust input[name="customer_name"]');

afterEach(() => {
  document.body.innerHTML = '';
});

function rig(grants: Record<string, unknown> = {}) {
  const h = screenHarness({ grants });
  const slot = createContextSlot();
  (h.shell as Shell & { contextSlot: typeof slot }).contextSlot = slot;
  return { h, slot };
}

const SEE = { 'view-customer-contact': { grant: 'allowed', scope: 'branch' } };

describe('[02b-TK TK-SH01] the takeaway screen fills the context slot', () => {
  it('[frame ShellAnatomy] a new cart: "New takeaway" + "Token after Send"; the typed name joins it for a view-customer-contact holder', async () => {
    const { h, slot } = rig(SEE);
    const m = h.render();
    await flush();
    expect(slot.get()).toEqual({ label: 'New takeaway', token: null, name: null, sub: 'Token after Send' });
    type(nameInput(m), 'Usman');
    await flush();
    expect(slot.get()).toEqual({ label: 'New takeaway', token: null, name: 'Usman', sub: 'Token after Send' });
    m.unmount();
    expect(slot.get()).toBeNull();
  });

  it('[R3] without view-customer-contact the slot never shows a name', async () => {
    const { h, slot } = rig();
    const m = h.render();
    await flush();
    type(nameInput(m), 'Usman');
    await flush();
    expect(slot.get()?.name).toBeNull();
    m.click(m.container.querySelector('.tk-rt__open'));
    await flush();
    expect(slot.get()).toMatchObject({ label: 'Token', token: '48', name: null });
    m.unmount();
  });

  it('[frame TokenReady] the open token view: "Token 48 · Ali" with Paid / Due; closing it gives the cart\'s slot back', async () => {
    const { h, slot } = rig(SEE);
    const m = h.render();
    await flush();
    m.click(m.container.querySelector('.tk-rt__open'));
    await flush();
    expect(slot.get()).toMatchObject({ label: 'Token', token: '48', name: 'Ali' });
    expect(['Paid', 'Due']).toContain(slot.get()?.sub);
    m.click(m.container.querySelector('.tk-drawer .tk-x'));
    await flush();
    expect(slot.get()).toMatchObject({ label: 'New takeaway', token: null });
    m.unmount();
  });
});
