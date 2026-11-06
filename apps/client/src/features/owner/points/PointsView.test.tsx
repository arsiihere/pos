import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { PointsView } from './PointsView';
import { button, click, fail, fakeApi, flush, mount, ok, setValue, type Call, type Mounted } from '../test-api';

let m: Mounted;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
});

const point = (id: string, name: string, extra: object = {}) => ({ point_id: id, name, sort_order: 0, archived_at: null, version: `v-${id}`, ...extra });
const PASS = point('PT1', 'Pass');
const WINDOW = point('PT2', 'Tandoor window', { sort_order: 3 });
const OLD = point('PT3', 'Old counter', { archived_at: 9 });
const stationRow = (id: string, name: string) => ({ station_id: id, name });

function setup(write?: (call: Call) => Response, points: object[] = [PASS, WINDOW, OLD]) {
  return fakeApi((call) => {
    if (call.method === 'GET') return ok({ stations: [stationRow('S1', 'Karahi'), stationRow('S2', 'Tawa'), stationRow('S3', 'Fryer')], points });
    return write?.(call) ?? ok({ point: PASS });
  });
}

async function open(api: ReturnType<typeof setup>['api']) {
  await m.render(<PointsView api={api} branchId="B1" />);
}

const rows = () => [...m.container.querySelectorAll<HTMLElement>('[data-point-id]')];
const row = (id: string) => m.container.querySelector<HTMLElement>(`[data-point-id="${id}"]`) as HTMLElement;
const dialog = () => m.container.querySelector('[role="dialog"]') as HTMLElement;

describe('owner points page (03a A-1; 01a §6.9a)', () => {
  it('[01a §8.1; 03a A-1] lists the branch points from the stations answer; archived ones are behind Show archived', async () => {
    const { api, calls } = setup();
    await open(api);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/v1/admin/branches/B1/stations' });
    expect(rows().map((r) => r.dataset['pointId'])).toEqual(['PT1', 'PT2']);
    expect(row('PT2').textContent).toContain(fill(t('owner.points.position_n'), { n: '3' }));
    await click(m.container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more') as HTMLButtonElement);
    await click(button(m.container.querySelector('.pos-appbar [role="menu"]') as HTMLElement, t('owner.common.show_archived')));
    expect(rows().map((r) => r.dataset['pointId'])).toEqual(['PT1', 'PT2', 'PT3']);
    expect(row('PT3').textContent).toContain(t('owner.common.restore'));
  });

  it('[01a §6.9a; 03a A-1] Add point POSTs name and sort_order with an Idempotency-Key', async () => {
    const { api, calls } = setup();
    await open(api);
    await click(button(m.container.querySelector('.pos-appbar') as HTMLElement, t('owner.points.add')));
    const form = dialog().querySelector('form') as HTMLFormElement;
    setValue(form.querySelector<HTMLInputElement>('input[name="name"]'), '  Bar pass ');
    setValue(form.querySelector<HTMLInputElement>('input[name="sort_order"]'), '4');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    const post = calls.find((c) => c.method === 'POST');
    expect(post).toMatchObject({ url: '/v1/admin/branches/B1/points', body: { name: 'Bar pass', sort_order: 4 } });
    expect(post?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });

  it('[01a §6.9a; R30] Rename PATCHes only the changed field with the held expected_version', async () => {
    const { api, calls } = setup();
    await open(api);
    await click(button(row('PT2'), t('owner.points.rename')));
    const form = dialog().querySelector('form') as HTMLFormElement;
    expect(form.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Tandoor window');
    setValue(form.querySelector<HTMLInputElement>('input[name="name"]'), 'Tandoor');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/v1/admin/branches/B1/points/PT2',
      body: { expected_version: 'v-PT2', name: 'Tandoor' },
    });
  });

  it('[01a §6.9a; 01c-B03] a stale rename shows "changed elsewhere" with Reload and keeps the typed name', async () => {
    const { api, calls } = setup(() => fail(409, 'CONFIG_STALE'));
    await open(api);
    await click(button(row('PT1'), t('owner.points.rename')));
    const form = dialog().querySelector('form') as HTMLFormElement;
    setValue(form.querySelector<HTMLInputElement>('input[name="name"]'), 'Hand-off');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(dialog().querySelector('[data-stale]')).not.toBeNull();
    expect(form.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Hand-off');
    await click(button(dialog(), t('stale.reload')));
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });

  it('[01a §6.9a] a name already used shows the server text under the dialog and keeps the form', async () => {
    const { api } = setup(() => fail(409, 'CONFIG_NAME_TAKEN', { field: 'name' }));
    await open(api);
    await click(button(m.container.querySelector('.pos-appbar') as HTMLElement, t('owner.points.add')));
    const form = dialog().querySelector('form') as HTMLFormElement;
    setValue(form.querySelector<HTMLInputElement>('input[name="name"]'), 'Pass');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(dialog().textContent).toContain(t('errors.CONFIG_NAME_TAKEN'));
  });

  it('[01a §6.9a] Archive asks first, then PATCHes archived: true', async () => {
    const { api, calls } = setup();
    await open(api);
    await click(button(row('PT2'), t('owner.common.archive')));
    expect(dialog().textContent).toContain(fill(t('archive.item_title'), { name: 'Tandoor window' }));
    await click(button(dialog(), fill(t('archive.archive_name'), { name: 'Tandoor window' })));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/v1/admin/branches/B1/points/PT2',
      body: { expected_version: 'v-PT2', archived: true },
    });
  });

  it('[01a §6.9a; 03a A-1] 409 CONFIG_IN_USE names the stations that use the point', async () => {
    const { api } = setup(() => fail(409, 'CONFIG_IN_USE', { entity: 'point', id: 'PT1', used_by: { entity: 'station', ids: ['S1', 'S3', 'S9'] } }));
    await open(api);
    await click(button(row('PT1'), t('owner.common.archive')));
    await click(button(dialog(), fill(t('archive.archive_name'), { name: 'Pass' })));
    const blocked = dialog();
    expect(blocked.textContent).toContain(fill(t('archive.blocked_title'), { name: 'Pass' }));
    expect(blocked.textContent).toContain(fill(t('owner.points.blocked_body'), { name: 'Pass', n: '3', names: 'Karahi, Fryer' }));
    expect(blocked.querySelector('[data-in-use]')?.textContent).toContain('Karahi');
    expect(blocked.querySelector('[data-in-use]')?.textContent).toContain('Fryer');
    expect(rows().map((r) => r.dataset['pointId'])).toEqual(['PT1', 'PT2']);
  });

  it('[01a §6.9a] Restore PATCHes archived: false; a stale answer shows the Reload banner and sends nothing more', async () => {
    const { api, calls } = setup(() => fail(409, 'CONFIG_STALE'));
    await open(api);
    await click(m.container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more') as HTMLButtonElement);
    await click(button(m.container.querySelector('.pos-appbar [role="menu"]') as HTMLElement, t('owner.common.show_archived')));
    await click(button(row('PT3'), t('owner.common.restore')));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ expected_version: 'v-PT3', archived: false });
    expect(m.container.querySelector('[data-stale]')).not.toBeNull();
    await click(button(m.container.querySelector('[data-stale]') as HTMLElement, t('stale.reload')));
    expect(m.container.querySelector('[data-stale]')).toBeNull();
  });

  it('[01a §8.1] a branch with no point shows the empty state', async () => {
    const { api } = setup(undefined, []);
    await open(api);
    expect(m.container.textContent).toContain(t('owner.points.empty'));
  });
});
