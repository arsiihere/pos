import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { createKitchenScreensApi } from './api';
import { KitchenScreensApp } from './KitchenScreens';
import { CONFIG, DEVICES, STATUS, fakeHub, ok, refused, result, type Route } from './test-hub';

let m: Mounted;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('admin_session_token', 'S1');
  sessionStorage.setItem('admin_staff_id', 'ST1');
  window.location.hash = '';
  m = mount();
});

afterEach(() => {
  m.unmount();
  window.location.hash = '';
});

function setup(routes: Record<string, Route | Response> = {}) {
  const hub = fakeHub({
    'GET /admin/queries/kds-config': ok(CONFIG),
    'GET /admin/queries/devices': ok(DEVICES),
    'GET /admin/queries/config-status': STATUS,
    'POST /admin/commands/set-device-role': (body) => result({ device_id: (body?.['payload'] as { device_id: string }).device_id, point_id: null, lane_label: null }),
    ...routes,
  });
  const api = createKitchenScreensApi({ fetch: hub.fetchFn, readDeviceToken: async () => 'TOK', readDeviceId: async () => 'D1', onSignedOut: () => {} });
  m.render(<KitchenScreensApp api={api} sink={{ play: () => {} }} />);
  return hub;
}

function dialog(): HTMLElement {
  const d = m.container.querySelector<HTMLElement>('[role="dialog"]');
  if (d === null) throw new Error('no dialog');
  return d;
}

describe('bind dialog (05a K-2, 03b-D03)', () => {
  it('[05a K-2] "Use a tablet as Pass tablet" lists every unrevoked non-kds device with a link to its edit form; no point picker, nothing sent', async () => {
    const hub = setup();
    await flush();
    m.click(m.button('Use a tablet as Pass tablet'));
    await flush();
    expect(hub.reads('/admin/queries/devices')).toBe(1);
    // every non-kds row (tablets and the phone), never the kitchen screen
    const rows = [...dialog().querySelectorAll<HTMLElement>('[data-device]')];
    expect(rows.map((r) => r.dataset['device'])).toEqual(['T-PASS', 'T-DEGH', 'T5', 'PH1']);
    expect(rows.map((r) => r.querySelector('a')?.getAttribute('href'))).toEqual([
      '/staff/#/devices?edit=T-PASS',
      '/staff/#/devices?edit=T-DEGH',
      '/staff/#/devices?edit=T5',
      '/staff/#/devices?edit=PH1',
    ]);
    expect(dialog().querySelector('.pos-tile')).toBeNull();
    expect(() => m.button('Save', dialog())).toThrow();
    expect(hub.commands('SetDeviceRole')).toEqual([]);
    // lane labels: on kitchen screen rows only, never on a Pass tablet row
    m.click(m.button('Cancel', dialog()));
    const tablets = m.container.querySelector<HTMLElement>('[data-section="pass-tablets"]')!;
    expect(() => m.button('Lane label', tablets)).toThrow();
    expect(m.button('Lane label').closest('[data-section="pass-tablets"]')).toBeNull();
  });

  it('[05a K-2] Change on a Pass tablet lists that device first, linking to its edit form; there is no "Stop using" command any more', async () => {
    const hub = setup();
    await flush();
    const tablets = m.container.querySelector<HTMLElement>('[data-section="pass-tablets"]')!;
    m.click(m.button('Change', [...tablets.querySelectorAll<HTMLElement>('.scr')][1]!));
    await flush();
    expect(dialog().querySelector<HTMLElement>('[data-device]')?.dataset['device']).toBe('T-DEGH');
    expect(() => m.button('Stop using as Pass tablet', dialog())).toThrow();
    expect(hub.commands('SetDeviceRole')).toEqual([]);
  });

  it('[03b §3.8] lane label dialog: Save sends the trimmed label; Remove label sends null; VALIDATION_FAILED → "Lane labels are only for kitchen screens"', async () => {
    const hub = setup();
    await flush();
    const tandoor = [...m.container.querySelectorAll<HTMLElement>('article.ks')][0]!;
    m.click(m.buttons().filter((b) => b.textContent?.includes('Lane label') && tandoor.contains(b))[1]);
    expect(dialog().textContent).toContain('Lane label · Tandoor Right');
    expect(dialog().querySelector<HTMLInputElement>('input')?.value).toBe('Right');
    m.click(m.button('Remove label', dialog()));
    await flush();
    expect(hub.commands('SetDeviceRole')).toEqual([{ device_id: 'K-TR', lane_label: null }]);
    m.unmount();

    m = mount();
    const refusedHub = setup({ 'POST /admin/commands/set-device-role': refused(400, 'VALIDATION_FAILED', { field: 'lane_label' }) });
    await flush();
    m.click(m.button('Lane label'));
    const input = dialog().querySelector<HTMLInputElement>('input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '  Front  ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    m.click(m.button('Save', dialog()));
    await flush();
    expect(refusedHub.commands('SetDeviceRole')).toEqual([{ device_id: 'K-TL', lane_label: 'Front' }]);
    expect(dialog().textContent).toContain('Lane labels are only for kitchen screens');
  });
});
