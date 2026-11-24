import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { flush } from '../../../../../test/dom';
import { readDeviceKey } from '../../../../api/hub-admin';

vi.mock('../../../../api/hub-admin', async (original) => ({
  ...(await original<object>()),
  readDeviceKey: vi.fn(async () => null),
}));

vi.mock('../../StaffApp', () => ({ StaffApp: () => { throw new Error('staff shell mounted'); } }));

it('[02b §8/O17; CustomerDisplay] bootstraps the real route without reading storage or fetching', async () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  window.location.hash = '#/customer-display';
  const getItem = vi.spyOn(Storage.prototype, 'getItem');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  try {
    await act(async () => { await import('../../main'); });
    await flush();
    expect(root.querySelector('.cd')?.textContent).toMatch(/Welcome.*خوش آمدید/);
    expect(readDeviceKey).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    root.remove();
    window.location.hash = '';
    getItem.mockRestore();
    vi.unstubAllGlobals();
  }
});
