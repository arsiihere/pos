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
});
