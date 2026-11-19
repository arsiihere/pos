import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { fakeHub, ok, refused, result, STATUS, type Route } from '../kitchen-screens/test-hub';
import { createPrintersApi, type PrintConfig } from './api';
import { PrintersApp } from './Printers';
import { BILL_DEVICES, PRINT_CONFIG, PRINT_QUEUE } from './test-data';

// 03c v1.0.13 §3.2, §6.6, §6.13 (05 row P-1, R-22; 05 test #85): the "Bill printers" section of the Printers page.
let m: Mounted;
const scrolled: string[] = [];
const realScroll = Element.prototype.scrollIntoView;

beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  } as Element['scrollIntoView'];
  sessionStorage.clear();
  sessionStorage.setItem('admin_session_token', 'S1');
  sessionStorage.setItem('admin_staff_id', 'ST1');
  m = mount();
});
afterEach(() => {
  m.unmount();
  Element.prototype.scrollIntoView = realScroll;
});

function setup(routes: Record<string, Route | Response> = {}, config: PrintConfig = PRINT_CONFIG) {
  const hub = fakeHub({
    'GET /admin/queries/print-config': ok(config),
    'GET /admin/queries/print-queue': ok(PRINT_QUEUE),
    'GET /admin/queries/devices': ok({ devices: BILL_DEVICES }),
    'GET /admin/queries/config-status': STATUS,
    ...routes,
  });
  const api = createPrintersApi({ fetch: hub.fetchFn, readDeviceToken: async () => 'TOK', readDeviceId: async () => 'D1', onSignedOut: () => {} });
  m.render(<PrintersApp api={api} />);
  return hub;
}

const section = () => m.container.querySelector<HTMLElement>('#bill-printers')!;
const row = (label: string) => [...section().querySelectorAll<HTMLElement>('.pos-list__row')].find((r) => r.querySelector('strong')?.textContent === label)!;
const select = (label: string) => row(label).querySelector<HTMLSelectElement>('select')!;
const printerName = (label: string) => select(label).selectedOptions[0]!.textContent;

function choose(label: string, value: string): void {
  const el = select(label);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('[05 #85] Bill printers section (03c §3.2, §6.13)', () => {
  it('[05 #85, 03c §6.6] rows: all bills, reports, one per device that takes a bill (not a KDS, not revoked), and the zone routes that exist; each shows its printer', async () => {
    setup();
    await flush();
    expect(section().querySelector('h2')?.textContent).toBe('Bill printers');
    expect([...section().querySelectorAll('.pos-list__row strong')].map((s) => s.textContent)).toEqual([
      'All bills',
      'Reports (X and Z)',
      'Device: Counter kiosk',
      'Device: Waiter tablet',
      'Ground · Garden',
      'Roof · Patio',
      'Ground · Patio',
      'Floor Ground',
      'Floor Roof',
      'Ground · Old patio',
    ]);
    expect(printerName('All bills')).toBe('Tandoor printer');
    expect(printerName('Reports (X and Z)')).toBe('Same as all bills');
    expect(printerName('Device: Counter kiosk')).toBe('Use the next one');
    expect(printerName('Ground · Garden')).toBe('Cold printer');
    // only active printers can be picked
    expect([...select('All bills').options].map((o) => o.textContent)).toEqual(['No printer', 'Tandoor printer', 'Cold printer']);
  });

  it('[05 #85, 03c §6.13] a choice sends SetBillRoute { scope, ref_id, printer_id } and reads print-config again; "No printer" sends null', async () => {
    const hub = setup({ 'POST /admin/commands/set-bill-route': result({}) });
    await flush();
    const before = hub.reads('/admin/queries/print-config');
    choose('Device: Counter kiosk', 'P2');
    await flush();
    choose('Reports (X and Z)', 'P1');
    await flush();
    choose('All bills', '');
    await flush();
    expect(hub.commands('SetBillRoute')).toEqual([
      { scope: 'device', ref_id: 'D-K', printer_id: 'P2' },
      { scope: 'report', ref_id: '', printer_id: 'P1' },
      { scope: 'default', ref_id: '', printer_id: null },
    ]);
    expect(hub.reads('/admin/queries/print-config')).toBe(before + 3);
  });

  it('[05 #85, 03c §6.13] a refusal is shown, nothing else changes', async () => {
    setup({ 'POST /admin/commands/set-bill-route': refused(404, 'PRINTER_NOT_FOUND', { printer_id: 'P2' }) });
    await flush();
    choose('Device: Counter kiosk', 'P2');
    await flush();
    expect(section().querySelector('[role="alert"]')?.textContent).toBe('This printer was removed or archived — reload');
  });

  it('[05 #85, 00 M89] without manage-devices the section is read-only: names, no selects', async () => {
    sessionStorage.setItem('admin_permissions', JSON.stringify({ 'manage-devices': false }));
    setup();
    await flush();
    expect(section().querySelectorAll('select')).toHaveLength(0);
    expect(row('All bills').textContent).toContain('Tandoor printer');
  });

  it('[05 #85] the devices read failing leaves the device rows out; the default and report rows stay', async () => {
    setup({ 'GET /admin/queries/devices': refused(500, 'INTERNAL_ERROR') });
    await flush();
    expect([...section().querySelectorAll('.pos-list__row strong')].map((s) => s.textContent)).toEqual(['All bills', 'Reports (X and Z)', 'Ground · Garden', 'Roof · Patio', 'Ground · Patio', 'Floor Ground', 'Floor Roof', 'Ground · Old patio']);
  });

  it('[05 #85, 03c §6.2, R-22] archiving a printer a bill route holds → 409 CONFIG_IN_USE names the routes and offers "Go to Bill printers"', async () => {
    setup({
      'POST /admin/commands/save-printer': refused(409, 'CONFIG_IN_USE', { entity: 'printer', id: 'P2', used_by: { entity: 'bill_route', ids: ['device:D-K', 'zone:Z-GARDEN'] } }),
    });
    await flush();
    const article = [...m.container.querySelectorAll<HTMLElement>('article.pr')].find((a) => a.querySelector('.pr__h strong')?.textContent === 'Cold printer')!;
    article.querySelector<HTMLElement>('[aria-haspopup]')!.click();
    await flush();
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent?.includes('Archive'))!.click();
    await flush();
    [...document.querySelectorAll<HTMLButtonElement>('dialog button, [role="dialog"] button')].find((b) => b.textContent === 'Archive')!.click();
    await flush();
    const dialog = document.querySelector('dialog, [role="dialog"]')!;
    expect(dialog.textContent).toContain('Device: Counter kiosk and Ground · Garden still print at this printer. Change their bill printer first.');
    [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Go to Bill printers')!.click();
    await flush();
    expect(scrolled).toEqual(['bill-printers']);
  });

  it('[05 #85, R-38] zone and floor rows are labelled by name; every active one can take a route, SetBillRoute { zone | floor, id, printer }', async () => {
    const hub = setup({ 'POST /admin/commands/set-bill-route': result({}) });
    await flush();
    expect(printerName('Roof · Patio')).toBe('Use the next one');
    choose('Roof · Patio', 'P1');
    await flush();
    choose('Floor Ground', 'P2');
    await flush();
    expect(hub.commands('SetBillRoute')).toEqual([
      { scope: 'zone', ref_id: 'Z-ROOF', printer_id: 'P1' },
      { scope: 'floor', ref_id: 'F-1', printer_id: 'P2' },
    ]);
  });

  it('[05 #85, R-38] two floors can each have a "Patio": the rows are told apart by their floor and each sends its own zone id', async () => {
    const hub = setup({ 'POST /admin/commands/set-bill-route': result({}) });
    await flush();
    choose('Ground · Patio', 'P1');
    await flush();
    choose('Roof · Patio', 'P2');
    await flush();
    expect(hub.commands('SetBillRoute')).toEqual([
      { scope: 'zone', ref_id: 'Z-PATIO', printer_id: 'P1' },
      { scope: 'zone', ref_id: 'Z-ROOF', printer_id: 'P2' },
    ]);
  });

  it('[05 #85, R-38] an archived zone is listed (marked "archived", can be removed) only while it still has a route; an archived zone without one is not listed', async () => {
    const hub = setup({ 'POST /admin/commands/set-bill-route': result({}) });
    await flush();
    const old = row('Ground · Old patio');
    expect(old.textContent).toContain('archived');
    expect(m.container.textContent).not.toContain('Gone patio');
    expect(row('Ground · Garden').textContent).not.toContain('archived');
    choose('Ground · Old patio', '');
    await flush();
    expect(hub.commands('SetBillRoute')).toEqual([{ scope: 'zone', ref_id: 'Z-OLD', printer_id: null }]);
  });

  it('[05 #85, R-38] a route on a zone the config no longer has is listed by its id, marked archived', async () => {
    setup({}, { ...PRINT_CONFIG, bill_routes: [...PRINT_CONFIG.bill_routes, { scope: 'floor', ref_id: 'F-LOST', printer_id: 'P1' }] });
    await flush();
    expect(row('Floor F-LOST').textContent).toContain('archived');
  });
});
