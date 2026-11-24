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
});
