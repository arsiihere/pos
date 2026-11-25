import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { flush } from '../../../../../test/dom';
import { screenHarness } from './screen-harness';

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));

describe('02b §8 takeaway device layouts', () => {
  it('7a HomeTablet places the ready strip before the menu beside the cart', async () => {
    const m = screenHarness({ device: 'tablet' }).render();
    try {
      await flush();
      expect(m.container.querySelector('.osc--tk-tablet .tk-mid > .tk-rstrip')).not.toBeNull();
      expect(m.container.querySelector('.osc--tk-tablet > .cart')).not.toBeNull();
    } finally { m.unmount(); }
  });

  it('7b QueueTablet keeps the strip mounted, masks contact and offers a drawer close control', async () => {
    const m = screenHarness({ device: 'tablet' }).render();
    try {
      await flush();
      m.click(m.button('All orders'));
      const drawer = m.container.querySelector('.tk-q--drawer');
      expect(drawer?.textContent).not.toContain('Ali');
      expect(m.container.querySelector('.tk-rstrip')).not.toBeNull();
      m.click(m.button('Close', drawer!));
      expect(m.container.querySelector('.tk-q--drawer')).toBeNull();
    } finally { m.unmount(); }
  });

  it('7b closes the tablet queue drawer before showing the payment panel', async () => {
    const m = screenHarness({ device: 'tablet', bills: {} }).render();
    try {
      await flush();
      m.click(m.button('All orders'));
      m.click(m.button('Take payment', m.container.querySelector('.tk-q--drawer')!));
      expect(m.container.querySelector('.tk-q--drawer')).toBeNull();
      expect(m.container.querySelector('.tk-paypanel')).not.toBeNull();
    } finally { m.unmount(); }
  });

  it('7c PhoneMenu and PhoneCart share a compact total and Ready by bar', async () => {
    const m = screenHarness({ phone: true, rows: [] }).render();
    try {
      await flush();
      const bar = m.container.querySelector('.ph-bar');
      expect(bar?.textContent).toContain('Ready by');
      expect(bar?.textContent).toContain('Rs 0');
      m.click(m.button('Cart'));
      expect(m.container.querySelector('input[name="phone"]')?.getAttribute('inputmode')).toBe('tel');
    } finally { m.unmount(); }
  });

  it('7d opens a full-screen PhoneToken from PhoneQueue and returns to the queue', async () => {
    const m = screenHarness({ phone: true }).render();
    try {
      await flush();
      m.click(m.button('Queue'));
      await flush();
      expect(m.container.querySelector('.tk-q--tab .tk-ready')).not.toBeNull();
      m.click(m.container.querySelector('.tk-rt__open'));
      await flush();
      const token = m.container.querySelector('.tk-drawer--phone');
      expect(token?.textContent).toContain('Hand over all');
      expect(token?.textContent).not.toContain('Ali');
      m.click(m.button('Close', token!));
      expect(m.container.querySelector('.tk-q--tab')).not.toBeNull();
    } finally { m.unmount(); }
  });

  it('7d keeps contact out of the phone sent toast and queue label without a grant', async () => {
    const h = screenHarness({ phone: true, rows: [], answer: () => ({ status: 'sent', result: { token: 49, groups: [], lines: [] } }) });
    const m = h.render();
    try {
      await flush();
      const input = m.container.querySelector<HTMLInputElement>('input[name="customer_name"]');
      expect(input).toBeNull();
      m.click(m.button('Cart'));
      const name = m.container.querySelector<HTMLInputElement>('input[name="customer_name"]')!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Sample Customer');
        name.dispatchEvent(new Event('input', { bubbles: true }));
      });
      m.click(m.button('Menu'));
      m.click(m.button('Sides'));
      m.click(m.container.querySelector('.mi[aria-label="Naan"]'));
      m.click(m.button('Send'));
      await flush(8);
      expect(h.sent[0]?.payload).toMatchObject({ takeaway: { customer_name: 'Sample Customer' } });
      expect(h.sent[0]?.meta.label).not.toContain('Sample Customer');
      expect(h.toasts.at(-1)?.text).not.toContain('Sample Customer');
    } finally { m.unmount(); }
  });

  it('7e PhoneOffline shows unavailable times and queues Send without Pay', async () => {
    const h = screenHarness({ phone: true, online: false, rows: [], answer: () => ({ status: 'queued', entry_id: 'Q1' }) });
    const m = h.render();
    try {
      await flush();
      m.click(m.button('Sides'));
      m.click(m.container.querySelector('.mi[aria-label="Naan"]'));
      expect(m.container.querySelector('.ph-bar__time')?.textContent).toBe('—');
      m.click(m.button('Send'));
      await flush();
      expect(h.sent.some(({ type }) => type === 'SubmitOrder')).toBe(true);
      expect(m.buttons().some((button) => button.textContent?.includes('Send & pay'))).toBe(false);
    } finally { m.unmount(); }
  });
});
