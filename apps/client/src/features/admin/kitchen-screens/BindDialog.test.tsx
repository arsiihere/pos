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

function choose(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('bind dialog (03b-D03)', () => {
  it('[03b §3.8] bind dialog: point picker from kds-config points (archived points marked); SetDeviceRole; lane label only on a kds device', async () => {
    const hub = setup();
    await flush();
    m.click(m.button('Use a tablet as Pass tablet'));
    await flush();
    expect(hub.reads('/admin/queries/devices')).toBe(1);
    // tablets only (00 devices), never a kds or phone device
    const options = [...dialog().querySelectorAll('option')].map((o) => o.value).filter((v) => v !== '');
    expect(options).toEqual(['T-PASS', 'T-DEGH', 'T5']);
    const tiles = [...dialog().querySelectorAll<HTMLButtonElement>('.pos-tile')];
    expect(tiles.map((b) => b.firstChild?.textContent)).toEqual(['Pass', 'Degh', 'Old pass']);
    // the stations of each point under its name
    expect(tiles[0]?.querySelector('small')?.textContent).toBe('Tandoor, Fryer, Cold');
    const archived = tiles[2]!;
    expect(archived.disabled).toBe(true);
    expect(archived.textContent).toContain('Point archived');
    act(() => choose(dialog().querySelector('select')!, 'T5'));
    m.click(tiles[1]);
    expect(tiles[1]?.getAttribute('aria-pressed')).toBe('true');
    m.click(m.button('Save', dialog()));
    await flush();
    expect(hub.commands('SetDeviceRole')).toEqual([{ device_id: 'T5', point_id: 'P-DEGH' }]);
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    // lane labels: on kitchen screen rows only, never on a Pass tablet row
    const tablets = m.container.querySelector<HTMLElement>('[data-section="pass-tablets"]')!;
    expect(() => m.button('Lane label', tablets)).toThrow();
    expect(m.button('Lane label').closest('[data-section="pass-tablets"]')).toBeNull();
  });

  it('[03b §3.8] Change on a Pass tablet preselects its point; "Stop using as Pass tablet" sends point_id null', async () => {
    const hub = setup();
    await flush();
    const tablets = m.container.querySelector<HTMLElement>('[data-section="pass-tablets"]')!;
    m.click(m.button('Change', tablets));
    await flush();
    expect(dialog().querySelector<HTMLSelectElement>('select')?.value).toBe('T-PASS');
    expect(dialog().querySelector('.pos-tile[aria-pressed="true"]')?.firstChild?.textContent).toBe('Pass');
    m.click(m.button('Stop using as Pass tablet', dialog()));
    await flush();
    expect(hub.commands('SetDeviceRole')).toEqual([{ device_id: 'T-PASS', point_id: null }]);
  });

  it('[03b §3.8] 404 POINT_NOT_FOUND keeps the dialog with "That point no longer exists" and reloads the points', async () => {
    const hub = setup({ 'POST /admin/commands/set-device-role': refused(404, 'POINT_NOT_FOUND', { point_id: 'P-DEGH' }) });
    await flush();
    m.click(m.button('Use a tablet as Pass tablet'));
    await flush();
    act(() => choose(dialog().querySelector('select')!, 'T5'));
    m.click(m.button('Degh', dialog()));
    m.click(m.button('Save', dialog()));
    await flush();
    expect(dialog().textContent).toContain('That point no longer exists');
    expect(hub.reads('/admin/queries/kds-config')).toBe(2);
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
