import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { BASE_GAIN, type AudioSink } from '../../alerts/sounds';
import { createKitchenScreensApi, type KdsConfig } from './api';
import { KitchenScreensApp } from './KitchenScreens';
import { CONFIG, DEVICES, STATUS, fakeHub, ok, refused, result, type Route } from './test-hub';

let m: Mounted;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('admin_session_token', 'S1');
  sessionStorage.setItem('admin_staff_id', 'ST1');
  sessionStorage.setItem('admin_name', 'Imran');
  window.location.hash = '';
  m = mount();
});

afterEach(() => {
  m.unmount();
  vi.useRealTimers();
  window.location.hash = '';
});

function setup(routes: Record<string, Route | Response> = {}, config: KdsConfig = CONFIG) {
  const hub = fakeHub({
    'GET /admin/queries/kds-config': ok(config),
    'GET /admin/queries/devices': ok(DEVICES),
    'GET /admin/queries/config-status': STATUS,
    ...routes,
  });
  const api = createKitchenScreensApi({ fetch: hub.fetchFn, readDeviceToken: async () => 'TOK', readDeviceId: async () => 'D1', onSignedOut: () => {} });
  const played: Array<{ sound: string; gain: number }> = [];
  const sink: AudioSink = { play: (sound, gain) => played.push({ sound, gain }) };
  m.render(<KitchenScreensApp api={api} sink={sink} />);
  return { hub, played };
}

function card(name: string): HTMLElement {
  const found = [...m.container.querySelectorAll<HTMLElement>('article.ks')].find((a) => a.querySelector('.ks__h strong')?.textContent === name);
  if (found === undefined) throw new Error(`no station card ${name}`);
  return found;
}

function slide(input: HTMLInputElement, value: number) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
  });
}

describe('kitchen screens page', () => {
  it('[03b §3.8] stations with screens (connected / signed out / offline), lanes, volume, dark; Pass tablets and their points', async () => {
    const config: KdsConfig = { ...CONFIG, stations: CONFIG.stations.map((s) => (s.station_id === 'S-D' ? { ...s, dark: true } : s)) };
    setup({}, config);
    await flush();
    const tandoor = card('Tandoor');
    expect(tandoor.textContent).toContain('Point: Pass');
    expect(tandoor.textContent).toContain('2 of 2 lanes on');
    expect(tandoor.textContent).toContain('Tandoor Left');
    expect(tandoor.textContent).toContain('Lane: Left');
    expect(tandoor.querySelector('.pos-chip--ok')?.textContent).toBe('Connected');
    expect(tandoor.querySelector('.pos-chip--danger')?.textContent).toBe('Offline');
    expect(tandoor.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe('80');
    expect(card('Fryer').textContent).toContain('Custom capacity');
    expect(card('Fryer').querySelector('.pos-chip--warn')?.textContent).toBe('Signed out');
    expect(card('Fryer').textContent).toContain('No lane label');
    // one lane: no lanes chip; no screen: the D11 line and no volume control
    expect(card('Degh').textContent).not.toContain('lanes on');
    expect(card('Cold').textContent).toContain('No screen — its lines show on the Pass');
    expect(card('Cold').querySelector('input[type="range"]')).toBeNull();
    // dark: the card is marked and says where the tickets are
    expect(card('Degh').classList.contains('ks--dark')).toBe(true);
    expect(card('Degh').textContent).toContain('Screen offline — its tickets are on the Pass');
    const tablets = m.container.querySelector<HTMLElement>('[data-section="pass-tablets"]');
    expect(tablets?.textContent).toContain('Pass tablet');
    expect(tablets?.textContent).toContain('Point: Pass');
    expect(tablets?.textContent).toContain('Degh tablet');
    expect(tablets?.textContent).toContain('Point: Degh');
    expect(tablets?.textContent).toContain('“Signed out” is normal');
  });

  it('[03b §3.8] volume save → SetStationScreen → "Saved. Tandoor screens use it on the next sound"; "Play on this device" plays locally', async () => {
    const { hub, played } = setup({ 'POST /admin/commands/set-station-screen': result({ station_id: 'S-T', sound_volume: 40 }) });
    await flush();
    const tandoor = card('Tandoor');
    m.click(m.button('Play on this device', tandoor));
    expect(played).toEqual([{ sound: 'info', gain: BASE_GAIN * 0.8 }]);
    expect(hub.commands('SetStationScreen')).toEqual([]);
    slide(tandoor.querySelector<HTMLInputElement>('input[type="range"]')!, 40);
    await flush();
    expect(hub.commands('SetStationScreen')).toEqual([{ station_id: 'S-T', sound_volume: 40 }]);
    expect(m.container.querySelector('.ad-toast')?.textContent).toContain('Saved. Tandoor screens use it on the next sound.');
    // the slider plays at the value it shows, not the saved one
    m.click(m.button('Play on this device', card('Tandoor')));
    expect(played.at(-1)).toEqual({ sound: 'info', gain: BASE_GAIN * 0.4 });
  });

  it('[03b §3.8] a volume refused 404 STATION_NOT_FOUND says so and reloads; no toast', async () => {
    const { hub } = setup({ 'POST /admin/commands/set-station-screen': refused(404, 'STATION_NOT_FOUND') });
    await flush();
    slide(card('Tandoor').querySelector<HTMLInputElement>('input[type="range"]')!, 20);
    await flush();
    expect(m.text()).toContain('This station is no longer there — reload');
    expect(m.container.querySelector('.ad-toast')).toBeNull();
    expect(hub.reads('/admin/queries/kds-config')).toBe(2);
  });

  it('[03b §3.8 Q-43] #bind=<device_id> opens the bind dialog for that device', async () => {
    window.location.hash = '#bind=T5';
    setup();
    await flush();
    const dialog = m.container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain('Use as Pass tablet for…');
    expect(dialog?.querySelector<HTMLSelectElement>('select')?.value).toBe('T5');
    expect(dialog?.textContent).toContain('“Tablet 5” will show the Pass after sign-in');
  });

  it('[03b Q-48] warnings name the station, also an archived one; without HK6 fields → ids shown', async () => {
    const named: KdsConfig = {
      ...CONFIG,
      stations: CONFIG.stations.map((s) => (s.station_id === 'S-T' ? { ...s, dark: true } : s)),
      pass_tablets: [{ device_id: 'T-OLD', name: 'Old tablet', point_id: 'P-OLD', state: 'connected' }],
      warnings: [
        { station_id: 'S-T', kind: 'dark', name: 'Tandoor' },
        { station_id: 'S-G', kind: 'archived_open_lines', name: 'Grill' },
      ],
    };
    setup({}, named);
    await flush();
    const banners = m.container.querySelector<HTMLElement>('.pos-banners');
    expect(banners?.textContent).toContain('Tandoor screen is offline');
    expect(banners?.textContent).toContain('Grill is archived but still has open tickets');
    expect(m.container.querySelector('[data-section="pass-tablets"]')?.textContent).toContain('Point archived — bind to another point');
    m.unmount();

    m = mount();
    sessionStorage.setItem('admin_session_token', 'S1');
    const withoutPoints: KdsConfig = { ...named };
    delete withoutPoints.points;
    setup({}, { ...withoutPoints, warnings: [{ station_id: 'S-T', kind: 'dark' }, { station_id: 'S-G', kind: 'archived_open_lines' }] });
    await flush();
    const before = m.container.querySelector<HTMLElement>('.pos-banners');
    expect(before?.textContent).toContain('Tandoor screen is offline'); // an active station: its name from stations[]
    expect(before?.textContent).toContain('S-G is archived but still has open tickets');
    expect(card('Tandoor').textContent).toContain('Point: P-PASS');
    expect(m.container.querySelector('[data-section="pass-tablets"]')?.textContent).toContain('Point: P-OLD');
  });

  it('[03b Q-54] no timer: reads kds-config on open, on Refresh and once after each own command', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    const { hub } = setup({
      'POST /admin/commands/set-station-screen': result({ station_id: 'S-T', sound_volume: 50 }),
      'POST /admin/commands/set-device-role': result({ device_id: 'K-F', point_id: null, lane_label: 'Front' }),
    });
    await flush();
    expect(hub.reads('/admin/queries/kds-config')).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(hub.reads('/admin/queries/kds-config')).toBe(1);
    m.click(m.button('Reload'));
    await flush();
    expect(hub.reads('/admin/queries/kds-config')).toBe(2);
    slide(card('Tandoor').querySelector<HTMLInputElement>('input[type="range"]')!, 50);
    await flush();
    expect(hub.reads('/admin/queries/kds-config')).toBe(3);
    m.click(m.button('Lane label', card('Fryer')));
    const input = m.container.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Front');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    m.click(m.button('Save', m.container.querySelector('[role="dialog"]')!));
    await flush();
    expect(hub.commands('SetDeviceRole')).toEqual([{ device_id: 'K-F', lane_label: 'Front' }]);
    expect(hub.reads('/admin/queries/kds-config')).toBe(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(hub.reads('/admin/queries/kds-config')).toBe(4);
  });

  it('[03b §3.8] no stations → "No stations yet"; 403 PERMISSION_DENIED → the no-permission banner; hub down → the offline banner', async () => {
    setup({}, { stations: [], pass_tablets: [], points: [], warnings: [] });
    await flush();
    expect(m.text()).toContain('No stations yet');
    expect(m.text()).toContain('Add stations in the owner app first');
    m.unmount();
    m = mount();
    setup({ 'GET /admin/queries/kds-config': refused(403, 'PERMISSION_DENIED', { permission: 'manage-devices' }) });
    await flush();
    expect(m.text()).toContain('You do not have permission for this. Ask a manager.');
    m.unmount();
    m = mount();
    setup({ 'GET /admin/queries/kds-config': () => new Error('down') });
    await flush();
    expect(m.text()).toContain('The hub cannot be reached');
  });

  it('[00 §8.2] without an admin session the page shows the admin roster and PIN pad, then the stations', async () => {
    sessionStorage.clear();
    const hub = fakeHub({
      'GET /admin/login-roster': ok({ staff: [{ staff_id: 'ST1', display_name: 'Imran', locked_until: null, role_names: ['Manager'] }] }),
      'POST /admin/auth': ok({ admin_session_token: 'S9', staff_id: 'ST1', display_name: 'Imran' }),
      'GET /admin/queries/kds-config': ok(CONFIG),
    });
    const api = createKitchenScreensApi({ fetch: hub.fetchFn, readDeviceToken: async () => 'TOK', readDeviceId: async () => 'D1', onSignedOut: () => {} });
    m.render(<KitchenScreensApp api={api} sink={{ play: () => {} }} />);
    await flush();
    expect(hub.reads('/admin/queries/kds-config')).toBe(0);
    m.click(m.button('Imran'));
    for (const d of ['1', '2', '3', '4']) m.click(m.button(d));
    m.click(m.button('Enter'));
    await flush();
    expect(sessionStorage.getItem('admin_session_token')).toBe('S9');
    expect(hub.reads('/admin/queries/kds-config')).toBe(1);
    expect(card('Tandoor')).toBeTruthy();
  });
});
