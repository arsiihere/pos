import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import type { NativeBridge, NativeHealth } from './bridge';
import { DeviceHealth } from './DeviceHealth';

// 05b M-18 / C-1 (plan B7, render test): the Me screen's device-health card.

const HEALTHY: NativeHealth = {
  service_connected: true,
  alert_socket: 'up',
  last_frame_age_ms: 12_400,
  wake_lock: true,
  store_readable: true,
  device_owner: false,
  lock_task_state: 'none',
  post_notifications: true,
  channels: { pos_urgent_v1: { exists: true, importance: 4, sound: 'x' } },
  fsi_allowed: true,
  battery_exempt: true,
  exact_alarms: true,
  can_install: true,
  native_api: 1,
  version_name: '1.0.3',
};

function bridge(h: NativeHealth | null): NativeBridge & { openSetting: ReturnType<typeof vi.fn>; setWakeLock: ReturnType<typeof vi.fn>; health: ReturnType<typeof vi.fn> } {
  return {
    info: async () => null,
    confirmRevoked: async () => null,
    setSession: async () => {},
    setDeviceContext: async () => {},
    reportShown: async () => {},
    health: vi.fn(async () => h),
    openSetting: vi.fn(async () => {}),
    setWakeLock: vi.fn(async () => {}),
    checkForUpdate: async () => null,
    onState: () => () => {},
  };
}

let m: Mounted;
afterEach(() => m?.unmount());

const row = (key: string) => m.container.querySelector<HTMLElement>(`[data-row="${key}"]`);

describe('[05b M-18, C-1] device-health card', () => {
  it('renders every row from health(); a healthy tablet has no red row', async () => {
    m = mount();
    m.render(<DeviceHealth native={bridge(HEALTHY)} />);
    await flush();
    expect(m.text()).toContain('Device health');
    for (const k of ['service', 'socket', 'last_frame', 'notifications', 'channels', 'fsi', 'battery', 'exact', 'install', 'store', 'owner', 'lock', 'wake', 'version', 'api']) expect(row(k), k).not.toBeNull();
    expect(m.container.querySelectorAll('[data-ok="false"]')).toHaveLength(0);
    expect(row('last_frame')!.textContent).toContain('12 s ago');
    expect(row('version')!.textContent).toContain('1.0.3');
    expect(row('api')!.textContent).toContain('1');
    expect(m.text()).not.toContain('Fix');
  });

  it('red rows; non-device-owner "Fix" opens the matching setting; the wake-lock toggle', async () => {
    const b = bridge({ ...HEALTHY, service_connected: false, alert_socket: null, post_notifications: false, battery_exempt: false, fsi_allowed: false, can_install: false, exact_alarms: false });
    m = mount();
    m.render(<DeviceHealth native={b} />);
    await flush();
    for (const k of ['service', 'socket', 'notifications', 'battery', 'fsi', 'install', 'exact']) expect(row(k)!.dataset['ok'], k).toBe('false');
    expect(row('service')!.className).toContain('c-danger');
    m.click(m.button('Fix', row('battery')!));
    await flush();
    expect(b.openSetting).toHaveBeenCalledWith({ which: 'battery' });
    m.click(m.button('Fix', row('notifications')!));
    m.click(m.button('Fix', row('fsi')!));
    m.click(m.button('Fix', row('install')!));
    await flush();
    expect(b.openSetting.mock.calls.map((c) => (c[0] as { which: string }).which)).toEqual(['battery', 'notifications', 'fsi', 'install']);
    m.click(m.button('Turn off', row('wake')!));
    await flush();
    expect(b.setWakeLock).toHaveBeenCalledWith({ on: false });
    expect(b.health.mock.calls.length).toBeGreaterThan(1); // read again after each action
  });

  it('a device-owner tablet shows red rows without Fix buttons', async () => {
    m = mount();
    m.render(<DeviceHealth native={bridge({ ...HEALTHY, device_owner: true, battery_exempt: false })} />);
    await flush();
    expect(row('battery')!.dataset['ok']).toBe('false');
    expect(row('owner')!.textContent).toContain('Yes');
    expect(m.text()).not.toContain('Fix');
  });

  it('no answer → "The tablet did not answer"', async () => {
    m = mount();
    m.render(<DeviceHealth native={bridge(null)} />);
    await flush();
    expect(m.text()).toContain('The tablet did not answer');
  });
});
