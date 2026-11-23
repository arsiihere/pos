import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screensOffered } from '@pos/domain';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import { createStaffApi } from '../staff/api';
import { createDevicesApi, type DeviceRow, type PendingRequest } from './api';
import { ApproveForm, defaultsFor } from './ApproveForm';
import { DeviceList } from './DeviceList';
import { EditForm } from './EditForm';

// 05a §6.3 (approve form, defaults by hint), §6.4 (edit form, CONFIG_STALE, DEVICE_ACCESS_SELF), §3.6 (screens per
// hardware), §8; task 32. The hub side is not built: a fetch stub at the api boundary answers the spec'd shapes.

let m: Mounted;
beforeEach(() => {
  m = mount();
});
afterEach(() => m.unmount());

interface Sent {
  url: string;
  payload: Record<string, unknown>;
}

function setup(commandReply: () => Response = () => reply(200, { data: { result: { device_id: 'D9', profile_version: 2 } } })) {
  const sent: Sent[] = [];
  const staff = createStaffApi({
    device: { token: 'DEV', id: 'D1', type: 'tablet' },
    meta: { tenantId: 'T', branchId: 'B', branchName: 'G', hubNowMs: 0, utcOffsetMs: 0 },
    fetch: async (url, init) => {
      if (url === '/queries/branch-config')
        return reply(200, { data: { snapshot: { points: [{ point_id: 'P1', name: 'Grill pass' }], stations: [{ station_id: 'K1', name: 'Grill' }] } } });
      if (url.startsWith('/commands/')) {
        sent.push({ url, payload: (JSON.parse(String(init?.body)) as { payload: Record<string, unknown> }).payload });
        return commandReply();
      }
      return reply(404, { error: { code: 'ROUTE_NOT_FOUND' } });
    },
    onSignedOut: () => {},
  });
  return { api: createDevicesApi(staff), sent };
}

const STAFF = [{ staff_id: 'S1', display_name: 'Ali' }, { staff_id: 'S2', display_name: 'Bilal' }];
const type = (el: Element | null, value: string) => {
  if (el === null) throw new Error('no field');
  const input = el as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const field = (name: string) => m.container.querySelector(`[data-field="${name}"] input, [data-field="${name}"] select`);
const screensChecked = () => [...m.container.querySelectorAll<HTMLInputElement>('[data-field="screens"] input')].filter((i) => i.checked).map((i) => i.parentElement?.textContent);
const req = (hint: PendingRequest['hardware_hint']): PendingRequest => ({ request_id: 'R1', device_name: 'Counter 2', hardware_hint: hint, created_at: 1 });

describe('[05a §6.3] form defaults by hint', () => {
  it('[05a §6.3] defaultsFor: phone, kiosk or none, tablet', () => {
    expect(defaultsFor('phone')).toMatchObject({ access: 'listed', screens: ['dine_in'] });
    expect(defaultsFor('cashier_kiosk')).toMatchObject({ access: 'everyone', screens: ['takeaway', 'cashier', 'manager'] });
    expect(defaultsFor(null)).toMatchObject({ access: 'everyone', screens: ['takeaway', 'cashier', 'manager'] });
    expect(defaultsFor('tablet')).toMatchObject({ access: 'everyone', screens: ['dine_in', 'manager'] });
  });

  it('[05a §6.3] a phone request opens as listed with Dine-in ticked, a tablet as everyone with Dine-in and Manager', async () => {
    const { api } = setup();
    m.render(<ApproveForm api={api} people={STAFF} request={req('phone')} onDone={() => {}} onCancel={() => {}} />);
    await flush();
    expect(m.container.querySelector('[data-field="people"]')).not.toBeNull();
    expect(screensChecked()).toEqual(['Dine in']);
    m.render(<ApproveForm key="t" api={api} people={STAFF} request={req('tablet')} onDone={() => {}} onCancel={() => {}} />);
    await flush();
    expect(m.container.querySelector('[data-field="people"]')).toBeNull();
    expect(screensChecked()).toEqual(['Dine in', 'Manager tools']);
  });

  it('[05a §3.6] a phone is not offered Cashier; a kiosk is', async () => {
    const { api } = setup();
    m.render(<ApproveForm api={api} people={STAFF} request={req('phone')} onDone={() => {}} onCancel={() => {}} />);
    await flush();
    const offered = [...m.container.querySelectorAll('[data-field="screens"] label')].map((l) => l.textContent);
    expect(offered).toEqual(screensOffered('phone').map((s) => ({ dine_in: 'Dine in', takeaway: 'Takeaway', parking: 'Parking', cashier: 'Cash desk', pass: 'Pass', manager: 'Manager tools' })[s]));
    expect(offered).not.toContain('Cash desk');
    m.render(<ApproveForm key="k" api={api} people={STAFF} request={req('cashier_kiosk')} onDone={() => {}} onCancel={() => {}} />);
    await flush();
    expect(m.text()).toContain('Cash desk');
  });
});

describe('[05a §6.3] the display code is always typed', () => {
  it('[05a §6.3] the code field is empty when the request is known (r fills the request, not the code), and Approve waits for it', async () => {
    const { api, sent } = setup();
    m.render(<ApproveForm api={api} people={STAFF} request={req('tablet')} onDone={() => {}} onCancel={() => {}} />);
    await flush();
    expect((field('code') as HTMLInputElement).value).toBe('');
    expect(m.button('Approve', m.container.querySelector('.pos-row') ?? undefined).hasAttribute('disabled')).toBe(true);
    type(field('code'), '4821');
    m.click(m.button('Approve', m.container.querySelector('.pos-row') ?? undefined));
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('/commands/approve-pairing-request');
    expect(sent[0]?.payload).toEqual({
      request_id: 'R1',
      display_code: '4821',
      device_type: 'tablet',
      device_name: 'Counter 2',
      access: 'everyone',
      screens: ['dine_in', 'manager'],
    });
  });
});

describe('[05a §6.3 step 3] pass ⇔ point', () => {
  it('[05a §6.3] ticking Pass shows the point picker and Approve waits for one; the point is sent only with Pass', async () => {
    const { api, sent } = setup();
    m.render(<ApproveForm api={api} people={STAFF} request={req('tablet')} onDone={() => {}} onCancel={() => {}} />);
    await flush();
    expect(m.container.querySelector('[data-field="point"]')).toBeNull();
    const pass = [...m.container.querySelectorAll<HTMLInputElement>('[data-field="screens"] input')].find((i) => i.parentElement?.textContent === 'Pass');
    m.click(pass);
    expect(m.container.querySelector('[data-field="point"]')).not.toBeNull();
    type(field('code'), '1');
    const approve = () => m.button('Approve', m.container.querySelector('.pos-row') ?? undefined);
    expect(approve().hasAttribute('disabled')).toBe(true);
    const sel = field('point') as HTMLSelectElement;
    act(() => {
      sel.value = 'P1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    m.click(approve());
    await flush();
    expect(sent[0]?.payload).toMatchObject({ screens: ['dine_in', 'manager', 'pass'], point_id: 'P1' });
  });

  it('[05a §6.3] unticking Pass drops the point', async () => {
    const { api, sent } = setup();
    m.render(<ApproveForm api={api} people={STAFF} request={req('tablet')} onDone={() => {}} onCancel={() => {}} />);
    await flush();
    const pass = [...m.container.querySelectorAll<HTMLInputElement>('[data-field="screens"] input')].find((i) => i.parentElement?.textContent === 'Pass');
    m.click(pass);
    m.click(pass);
    type(field('code'), '1');
    m.click(m.button('Approve', m.container.querySelector('.pos-row') ?? undefined));
    await flush();
    expect(sent[0]?.payload).not.toHaveProperty('point_id');
  });
});

describe('[05a §6.3] kds', () => {
  it('[05a §6.3] a kds request sends station_id and nothing about access or screens', async () => {
    const { api, sent } = setup();
    m.render(<ApproveForm api={api} people={STAFF} request={req('kds')} onDone={() => {}} onCancel={() => {}} />);
    await flush();
    expect(m.container.querySelector('[data-field="screens"]')).toBeNull();
    type(field('code'), '77');
    const sel = field('station') as HTMLSelectElement;
    act(() => {
      sel.value = 'K1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    m.click(m.button('Approve', m.container.querySelector('.pos-row') ?? undefined));
    await flush();
    expect(sent[0]?.payload).toEqual({ request_id: 'R1', display_code: '77', device_type: 'kds', device_name: 'Counter 2', station_id: 'K1' });
  });
});

const device = (over: Partial<DeviceRow> = {}): DeviceRow => ({
  device_id: 'D5',
  device_name: 'Front tablet',
  device_type: 'tablet',
  revoked_at: null,
  access: 'listed',
  people: [{ staff_id: 'S1', display_name: 'Ali' }],
  screens: ['dine_in'],
  point_id: null,
  profile_version: 3,
  needs_review: false,
  ...over,
});

describe('[05a §6.4] edit form', () => {
  it('[05a §6.4] opens on the current profile and sends expected_version', async () => {
    const { api, sent } = setup();
    m.render(<EditForm api={api} people={STAFF} device={device()} onDone={() => {}} onCancel={() => {}} onReload={() => {}} />);
    await flush();
    expect(screensChecked()).toEqual(['Dine in']);
    m.click(m.button('Save'));
    await flush();
    expect(sent[0]?.url).toBe('/commands/set-device-profile');
    expect(sent[0]?.payload).toEqual({
      device_id: 'D5',
      expected_version: 3,
      device_name: 'Front tablet',
      access: 'listed',
      staff_ids: ['S1'],
      screens: ['dine_in'],
    });
  });

  it('[05a §6.4] 409 CONFIG_STALE shows "Changed elsewhere" with Reload, keeps what was typed, and disables Save', async () => {
    const { api } = setup(() => reply(409, { error: { code: 'CONFIG_STALE', details: { device_id: 'D5', profile_version: 4 } } }));
    let reloaded = 0;
    m.render(<EditForm api={api} people={STAFF} device={device()} onDone={() => {}} onCancel={() => {}} onReload={() => void (reloaded += 1)} />);
    await flush();
    type(field('name'), 'Renamed');
    m.click(m.button('Save'));
    await flush();
    expect(m.text()).toContain('Changed elsewhere');
    expect((field('name') as HTMLInputElement).value).toBe('Renamed');
    expect(m.button('Save').hasAttribute('disabled')).toBe(true);
    m.click(m.button('Reload'));
    expect(reloaded).toBe(1);
  });

  it('[05a §6.4 M-6] 422 DEVICE_ACCESS_SELF says "You would lose access on this device"', async () => {
    const { api } = setup(() => reply(422, { error: { code: 'DEVICE_ACCESS_SELF', details: { device_id: 'D5' } } }));
    m.render(<EditForm api={api} people={STAFF} device={device()} onDone={() => {}} onCancel={() => {}} onReload={() => {}} />);
    await flush();
    m.click(m.button('Save'));
    await flush();
    expect(m.text()).toContain('You would lose access on this device');
  });
});

describe('[05a v1.0.2 G-e] the hub derives the clear: no point_id without Pass, no staff_ids on everyone', () => {
  it('[05a G-e] removing Pass sends screens without pass and no point_id', async () => {
    const { api, sent } = setup();
    m.render(<EditForm api={api} people={STAFF} device={device({ access: 'everyone', people: [], screens: ['dine_in', 'pass'], point_id: 'P1' })} onDone={() => {}} onCancel={() => {}} onReload={() => {}} />);
    await flush();
    const pass = [...m.container.querySelectorAll<HTMLInputElement>('[data-field="screens"] input')].find((i) => i.parentElement?.textContent === 'Pass');
    m.click(pass);
    m.click(m.button('Save'));
    await flush();
    expect(sent[0]?.payload).toMatchObject({ screens: ['dine_in'] });
    expect(sent[0]?.payload).not.toHaveProperty('point_id');
  });

  it('[05a G-e] switching to everyone sends access and no staff_ids', async () => {
    const { api, sent } = setup();
    m.render(<EditForm api={api} people={STAFF} device={device()} onDone={() => {}} onCancel={() => {}} onReload={() => {}} />);
    await flush();
    m.click(m.container.querySelector('input[name="dv-access"]'));
    m.click(m.button('Save'));
    await flush();
    expect(sent[0]?.payload).toMatchObject({ access: 'everyone' });
    expect(sent[0]?.payload).not.toHaveProperty('staff_ids');
  });
});

describe('[05a v1.0.2 G-f] the picker reads the devices reply, not the roster', () => {
  it('[05a G-f] the people list is the whole directory from `staff`', async () => {
    const { api } = setup();
    m.render(<ApproveForm api={api} people={STAFF} request={req('phone')} onDone={() => {}} onCancel={() => {}} />);
    await flush();
    expect([...m.container.querySelectorAll('[data-field="people"] label')].map((l) => l.textContent)).toEqual(['Ali', 'Bilal']);
  });
  it('[05a G-f] createDevicesApi has no roster read', () => {
    expect('people' in setup().api).toBe(false);
  });
});

describe('[05a §6.3] name suggestion', () => {
  it('[05a §6.3] a request with no name gets "Counter 2" for a kiosk and "Ali\'s phone" once Ali is picked', async () => {
    const { api } = setup();
    const unnamed = (hint: PendingRequest['hardware_hint']): PendingRequest => ({ ...req(hint), device_name: '' });
    m.render(<ApproveForm api={api} people={STAFF} request={unnamed('cashier_kiosk')} onDone={() => {}} onCancel={() => {}} />);
    await flush();
    expect((field('name') as HTMLInputElement).value).toBe('Counter 2');
    m.render(<ApproveForm key="p" api={api} people={STAFF} request={unnamed('phone')} onDone={() => {}} onCancel={() => {}} />);
    await flush();
    m.click(m.container.querySelector('[data-field="people"] input'));
    expect((field('name') as HTMLInputElement).value).toBe("Ali's phone");
  });
});

describe('[05a §8] the list opens the forms', () => {
  it('[05a §8] Approve on a Waiting row opens the approve form with an empty code; Edit is not offered on a kds row', async () => {
    const { api } = setup();
    const staff = createStaffApi({
      device: { token: 'DEV', id: 'D1', type: 'tablet' },
      meta: { tenantId: 'T', branchId: 'B', branchName: 'G', hubNowMs: 0, utcOffsetMs: 0 },
      fetch: async (url) =>
        url === '/queries/devices'
          ? reply(200, { data: { devices: [device(), device({ device_id: 'K', device_name: 'Grill', device_type: 'kds', access: null, screens: [] })], pending_requests: [req('tablet')], admin_warning: null, staff: STAFF } })
          : reply(404, { error: { code: 'ROUTE_NOT_FOUND' } }),
      onSignedOut: () => {},
    });
    void api;
    m.render(<DeviceList api={createDevicesApi(staff)} />);
    await flush();
    expect(m.container.querySelector('[data-device="K"] button')).toBeNull();
    m.click(m.button('Approve', m.container.querySelector('[data-request="R1"]') ?? undefined));
    await flush();
    expect((field('code') as HTMLInputElement).value).toBe('');
  });
});

describe('[05a §8, row 32] #/devices?r=<request_id>: the QR fills the request, never the code', () => {
  const listApi = () =>
    createDevicesApi(
      createStaffApi({
        device: { token: 'DEV', id: 'D1', type: 'tablet' },
        meta: { tenantId: 'T', branchId: 'B', branchName: 'G', hubNowMs: 0, utcOffsetMs: 0 },
        fetch: async (url) =>
          url === '/queries/devices' ? reply(200, { data: { devices: [], pending_requests: [req('tablet')], admin_warning: null, staff: STAFF } }) : reply(404, { error: { code: 'ROUTE_NOT_FOUND' } }),
        onSignedOut: () => {},
      }),
    );
  it('[05a §8] a known r opens the approve form for that request with the code field empty', async () => {
    m.render(<DeviceList api={listApi()} openRequestId="R1" />);
    await flush();
    expect(m.container.querySelector('[data-field="code"]')).not.toBeNull();
    expect((field('code') as HTMLInputElement).value).toBe('');
    expect((field('name') as HTMLInputElement).value).toBe('Counter 2');
  });
  it('[05a §8] an unknown r shows just the list', async () => {
    m.render(<DeviceList api={listApi()} openRequestId="NOPE" />);
    await flush();
    expect(m.container.querySelector('[data-field="code"]')).toBeNull();
    expect(m.text()).toContain('Waiting');
  });
});

describe('[05a K-2, §8] #/devices?edit=<device_id>: opens the edit form for that non-kds row', () => {
  const dev = (id: string, type: 'tablet' | 'kds', over: Record<string, unknown> = {}) => ({
    device_id: id, device_name: `Dev ${id}`, device_type: type, revoked_at: null,
    access: type === 'kds' ? null : 'everyone', people: [], screens: type === 'kds' ? [] : ['dine_in'], point_id: null, profile_version: 1, needs_review: false, ...over,
  });
  const api = () =>
    createDevicesApi(
      createStaffApi({
        device: { token: 'DEV', id: 'D1', type: 'tablet' },
        meta: { tenantId: 'T', branchId: 'B', branchName: 'G', hubNowMs: 0, utcOffsetMs: 0 },
        fetch: async (url) =>
          url === '/queries/devices'
            ? reply(200, { data: { devices: [dev('T1', 'tablet'), dev('K1', 'kds'), dev('T2', 'tablet', { revoked_at: 5 })], pending_requests: [], admin_warning: null, staff: STAFF } })
            : reply(404, { error: { code: 'ROUTE_NOT_FOUND' } }),
        onSignedOut: () => {},
      }),
    );
  it('a known non-kds id opens its edit form', async () => {
    m.render(<DeviceList api={api()} openEditId="T1" />);
    await flush();
    expect((field('name') as HTMLInputElement).value).toBe('Dev T1');
  });
  it('an unknown, kitchen or removed id shows just the list', async () => {
    for (const id of ['NOPE', 'K1', 'T2']) {
      m.render(<DeviceList api={api()} openEditId={id} />);
      await flush();
      expect(m.container.querySelector('[data-field="name"]'), id).toBeNull();
      expect(m.text()).toContain('Dev T1');
    }
  });
});
