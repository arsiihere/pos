import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import { en } from '../../i18n/en';
import { tapAlert, type TapDeps } from '../alerts/deeplink-tap';
import { createStaffApi } from '../staff/api';
import { createDevicesApi, type DeviceRow, type DevicesData } from './api';
import { DeviceList, GROUPS, groupOf } from './DeviceList';

// 05a §6.8 (page groups, first match wins), §3.2 M-8 (warnings), §3.10 (link { type: 'devices' } → #/devices), §8; task 31.

let m: Mounted;
beforeEach(() => {
  m = mount();
});
afterEach(() => m.unmount());

const row = (over: Partial<DeviceRow> & { device_id: string }): DeviceRow => ({
  device_name: over.device_id,
  device_type: 'tablet',
  revoked_at: null,
  access: 'everyone',
  people: [],
  screens: ['dine_in'],
  point_id: null,
  profile_version: 1,
  needs_review: false,
  ...over,
});
const ALI = { staff_id: 'S1', display_name: 'Ali' };
const BILAL = { staff_id: 'S2', display_name: 'Bilal' };

function setup(data: Partial<DevicesData>) {
  const body: DevicesData = { devices: [], pending_requests: [], admin_warning: null, staff: [], ...data };
  const staff = createStaffApi({
    device: { token: 'DEV', id: 'D1', type: 'tablet' },
    meta: { tenantId: 'T', branchId: 'B', branchName: 'G', hubNowMs: 0, utcOffsetMs: 0 },
    fetch: async (url) => (url === '/queries/devices' ? reply(200, { data: body }) : reply(404, { error: { code: 'ROUTE_NOT_FOUND' } })),
    onSignedOut: () => {},
  });
  m.render(<DeviceList api={createDevicesApi(staff)} />);
}

describe('[05a §6.8 m-15] page groups, first match wins', () => {
  const cases: Array<[string, DeviceRow, (typeof GROUPS)[number]]> = [
    ['kds is Kitchen, even with a listed person', row({ device_id: 'a', device_type: 'kds', access: null, screens: [] }), 'kitchen'],
    ['listed with one person is Personal, whatever its first screen', row({ device_id: 'b', device_type: 'phone', access: 'listed', people: [ALI], screens: ['manager'] }), 'personal'],
    ['listed with two people goes by its first screen', row({ device_id: 'c', access: 'listed', people: [ALI, BILAL], screens: ['manager'] }), 'back_office'],
    ['takeaway is Counter', row({ device_id: 'd', device_type: 'cashier_kiosk', screens: ['takeaway', 'cashier'] }), 'counter'],
    ['cashier first is Counter', row({ device_id: 'e', screens: ['cashier', 'dine_in'] }), 'counter'],
    ['parking is Counter', row({ device_id: 'f', screens: ['parking'] }), 'counter'],
    ['dine_in is Floor', row({ device_id: 'g', screens: ['dine_in', 'manager'] }), 'floor'],
    ['pass is Pass', row({ device_id: 'h', screens: ['pass'], point_id: 'P1' }), 'pass'],
    ['manager is Back office', row({ device_id: 'i', screens: ['manager'] }), 'back_office'],
    ['the first screen wins over a later one', row({ device_id: 'j', screens: ['manager', 'takeaway'] }), 'back_office'],
  ];
  for (const [name, device, group] of cases) {
    it(`[05a §6.8] ${name}`, () => expect(groupOf(device)).toBe(group));
  }

  it('[05a §6.8] the page shows Waiting, Kitchen, Personal, Counter, Floor, Pass, Back office in that order; hardware is an icon with a label, not a heading', async () => {
    setup({
      pending_requests: [{ request_id: 'R1', device_name: 'Counter 3', hardware_hint: 'cashier_kiosk', created_at: 1 }],
      devices: [
        row({ device_id: 'bo', device_name: 'Office', screens: ['manager'] }),
        row({ device_id: 'ps', device_name: 'Pass 1', screens: ['pass'], point_id: 'P1' }),
        row({ device_id: 'fl', device_name: 'Floor 1', screens: ['dine_in'] }),
        row({ device_id: 'ct', device_name: 'Counter 1', device_type: 'cashier_kiosk', screens: ['takeaway'] }),
        row({ device_id: 'pe', device_name: "Ali's phone", device_type: 'phone', access: 'listed', people: [ALI], screens: ['dine_in'] }),
        row({ device_id: 'kd', device_name: 'Grill', device_type: 'kds', access: null, screens: [] }),
        row({ device_id: 'rv', device_name: 'Gone', revoked_at: 5 }),
      ],
    });
    await flush();
    const headings = [...m.container.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual(['Waiting', 'Kitchen', 'Personal', 'Counter', 'Floor', 'Pass', 'Back office']);
    expect(m.text()).toContain('Counter 3');
    expect(m.text()).not.toContain('Gone');
    expect(m.container.querySelectorAll('[data-hardware]').length).toBe(7);
    const grill = m.container.querySelector('[data-device="kd"] [data-hardware]');
    expect(grill?.getAttribute('data-hardware')).toBe('kds');
    expect(m.container.querySelector('[data-device="pe"]')?.textContent).toContain('Ali');
  });

  it('[05a §6.8] a group with no rows is not shown', async () => {
    setup({ devices: [row({ device_id: 'fl', screens: ['dine_in'] })] });
    await flush();
    expect([...m.container.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Floor']);
  });
});

describe('[05a §6.8, §3.2 M-12] needs review chip', () => {
  it('[05a §6.8] shows on flagged rows only', async () => {
    setup({
      devices: [row({ device_id: 'x', device_name: 'Flagged', needs_review: true }), row({ device_id: 'y', device_name: 'Fine', needs_review: false })],
    });
    await flush();
    expect(m.container.querySelector('[data-device="x"]')?.textContent).toContain('needs review');
    expect(m.container.querySelector('[data-device="y"]')?.textContent).not.toContain('needs review');
  });
});

describe('[05a §3.2 M-8] admin warnings', () => {
  it('[05a M-8] admin_warning 0 shows "No device can manage devices"', async () => {
    setup({ admin_warning: 0 });
    await flush();
    expect(m.text()).toContain('No device can manage devices');
    expect(m.text()).not.toContain('Only one device can manage devices');
  });
  it('[05a M-8] admin_warning 1 shows "Only one device can manage devices — add a backup"', async () => {
    setup({ admin_warning: 1 });
    await flush();
    expect(m.text()).toContain('Only one device can manage devices — add a backup');
    expect(m.text()).not.toContain('No device can manage devices');
  });
  it('[05a M-8] admin_warning null shows neither', async () => {
    setup({ admin_warning: null });
    await flush();
    expect(m.text()).not.toContain('manage devices');
  });
  it('[05a M-8] the copy is the spec string', () => {
    expect(en['devices.warn.none']).toBe('No device can manage devices');
    expect(en['devices.warn.one']).toBe('Only one device can manage devices — add a backup');
  });
});

describe('[05a §3.10 D-3, §8] the device_waiting link { type: "devices" }', () => {
  it('[05a §3.10] a tap on a row whose target is { type: "devices" } opens #/devices, no sheet and no read', async () => {
    window.location.hash = '#/inbox';
    const navigated: string[] = [];
    let seen = 0;
    let sheet = 0;
    const deps = {
      seen: () => void (seen += 1),
      openSheet: () => void (sheet += 1),
      navigate: (href: string) => void (navigated.push(href), (window.location.hash = href)),
      toast: () => {},
      orders: {},
      tables: {},
    } as unknown as TapDeps;
    const outcome = await tapAlert(
      {
        alert_id: 'A1',
        kind: 'device_waiting',
        raised_at: 1,
        lock: { kind_label_key: 'alert.device_waiting.lock', table_code: null, point_code: null, requester_name: null },
        target: { type: 'devices' } as never,
      },
      deps,
    );
    expect(outcome).toBe('navigated');
    expect(navigated).toEqual(['/devices']);
    expect(window.location.hash).toBe('#/devices');
    expect(seen).toBe(1);
    expect(sheet).toBe(0);
  });
});
