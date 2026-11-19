import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { fakeHub } from '../kitchen-screens/test-hub';
import { createFiscalApi } from './api';
import { FiscalApp } from './Fiscal';

let m: Mounted;

beforeEach(() => {
  sessionStorage.clear();
  m = mount();
});

afterEach(() => {
  m.unmount();
});

function setup() {
  const hub = fakeHub({});
  const api = createFiscalApi({ fetch: hub.fetchFn, readDeviceToken: async () => 'TOK', readDeviceId: async () => 'D1', onSignedOut: () => {} });
  m.render(<FiscalApp api={api} />);
  return hub;
}

describe('fiscal admin page shell (05 row H-2; the body is task 31a)', () => {
  it('[05 row H-2] without an admin session the page shows the admin sign-in, titled Fiscal', async () => {
    setup();
    await flush();
    expect(m.container.textContent).toContain('Fiscal');
    expect(m.container.querySelector('.pos-appbar__title')?.textContent).toBe('Fiscal');
  });

  it('[05 row H-2] with a session the shell shows the Fiscal app bar and reads nothing from the hub', async () => {
    sessionStorage.setItem('admin_session_token', 'S1');
    sessionStorage.setItem('admin_staff_id', 'ST1');
    const hub = setup();
    await flush();
    expect(m.container.querySelector('.pos-appbar__title')?.textContent).toBe('Fiscal');
    expect(hub.calls).toEqual([]);
  });
});
