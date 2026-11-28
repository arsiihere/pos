import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { setLanguage } from '../../../i18n';
import type { QueueEntry } from '../orders/contracts';
import { createMemoryQueueStore } from '../orders/queue/memory-store';
import { isOfflineBoot, OfflineBoot, registerStaffWorker } from './offline-boot';

// ⚠️ 02b v1.0.32 QO-2 (owner ruling R3-1 of 2026-11-28 QA-R3, BUG-3), 00 HPA v1.15 §8.2 SW-1: the kiosk boots from
// the service worker's cache when the hub is away and shows its own screen; only a paired cashier kiosk registers it.

const entry = (id: string, o: Partial<QueueEntry> = {}): QueueEntry => ({
  entry_id: id,
  command_type: 'SubmitOrder',
  payload: { order_id: id },
  queued_at: 1,
  staff_id: 'ali',
  device_id: 'kiosk-1',
  label: 'Takeaway',
  state: 'queued',
  ...o,
});

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  setLanguage('en');
  vi.useRealTimers();
});

describe('[02b #121 QO-2] offline boot', () => {
  it('reads the offline-boot marker the service worker puts in the cached index', () => {
    const doc = document.implementation.createHTMLDocument('x');
    expect(isOfflineBoot(doc)).toBe(false);
    const m = doc.createElement('meta');
    m.name = 'pos-offline-boot';
    m.content = '1';
    doc.head.appendChild(m);
    expect(isOfflineBoot(doc)).toBe(true);
  });

  it('"Can\'t reach the hub — N orders are safe on this device", the Offline pill, no sign-in; reloads once the hub answers', async () => {
    vi.useFakeTimers();
    const store = createMemoryQueueStore(
      new Map([
        ['E1', entry('E1')],
        ['E2', entry('E2', { state: 'log', log_reason: 'reloaded' })],
        ['E3', entry('E3', { command_type: 'MarkServed' })],
        ['E4', entry('E4', { state: 'log', log_reason: 'ITEM_SOLD_OUT' })],
      ]),
    );
    let up = false;
    const probe = vi.fn(async () => up);
    const reload = vi.fn();
    view = mount();
    view.render(<OfflineBoot branchName="Gulberg" store={store} probe={probe} reload={reload} everyMs={3000} />);
    await flush();
    expect(view.text()).toContain("Can't reach the hub");
    expect(view.text()).toContain("2 orders are safe on this device and will send when it's back");
    expect(view.container.querySelector('.live--off')?.textContent).toContain('Hub offline');
    expect(view.text()).toContain('Gulberg');
    expect(view.container.querySelector('input, [role="dialog"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(probe).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    up = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('one order / none; a store that cannot be read shows no count', async () => {
    const one = createMemoryQueueStore(new Map([['E1', entry('E1')]]));
    view = mount();
    view.render(<OfflineBoot branchName="" store={one} probe={async () => false} reload={() => {}} />);
    await flush();
    expect(view.text()).toContain("1 order is safe on this device and will send when it's back");
    view.unmount();
    view = mount();
    view.render(<OfflineBoot branchName="" store={createMemoryQueueStore()} probe={async () => false} reload={() => {}} />);
    await flush();
    expect(view.text()).toContain('Nothing is waiting on this device');
    view.unmount();
    const broken = { put: async () => {}, remove: async () => {}, list: async () => Promise.reject(new Error('blocked')) };
    view = mount();
    view.render(<OfflineBoot branchName="" store={broken} probe={async () => false} reload={() => {}} />);
    await flush();
    expect(view.text()).toContain("Can't reach the hub");
    expect(view.text()).not.toContain('order');
  });

  it('Urdu', async () => {
    setLanguage('ur');
    view = mount();
    view.render(<OfflineBoot branchName="" store={createMemoryQueueStore(new Map([['E1', entry('E1')], ['E2', entry('E2')]]))} probe={async () => false} reload={() => {}} />);
    await flush();
    expect(view.text()).toContain('ہب سے رابطہ نہیں ہو رہا');
    expect(view.container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});

describe('[00 HPA v1.15 §8.2 SW-1] the worker is the kiosk\'s only', () => {
  const nav = () => {
    const unregister = vi.fn(async () => true);
    const sw = {
      register: vi.fn(async () => ({})),
      getRegistrations: vi.fn(async () => [
        { scope: 'http://hub:3000/staff/', unregister },
        { scope: 'http://hub:3000/other/', unregister: vi.fn() },
      ]),
    };
    return { sw, unregister, navigator: { serviceWorker: sw } as unknown as Navigator };
  };

  it('a paired cashier kiosk registers /staff/sw.js for /staff/', async () => {
    const n = nav();
    await registerStaffWorker('cashier_kiosk', n.navigator);
    expect(n.sw.register).toHaveBeenCalledWith('/staff/sw.js', { scope: '/staff/' });
  });

  it('any other device registers none and drops a /staff/ worker it had; no service worker API → nothing', async () => {
    for (const type of ['tablet', 'phone', null] as const) {
      const n = nav();
      await registerStaffWorker(type, n.navigator);
      expect(n.sw.register).not.toHaveBeenCalled();
      expect(n.unregister).toHaveBeenCalledTimes(1);
    }
    await expect(registerStaffWorker('cashier_kiosk', {} as Navigator)).resolves.toBeUndefined();
    const failing = { serviceWorker: { register: async () => Promise.reject(new Error('insecure')) } } as unknown as Navigator;
    await expect(registerStaffWorker('cashier_kiosk', failing)).resolves.toBeUndefined();
  });
});
