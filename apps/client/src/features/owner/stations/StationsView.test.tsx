import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCloudAdmin } from '../../../api/cloud-admin';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { StationsView } from './StationsView';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  sessionStorage.clear();
});

interface Call {
  method: string;
  url: string;
  key: string | undefined;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeApi(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const api = createCloudAdmin({
    onLoggedOut: () => {},
    fetch: async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const call: Call = {
        method: init?.method ?? 'GET',
        url,
        key: headers['Idempotency-Key'],
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      };
      calls.push(call);
      return handler(call);
    },
  });
  return { api, calls };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setValue(el: HTMLInputElement | HTMLSelectElement | null | undefined, value: string): void {
  if (!el) throw new Error('field missing');
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

function button(label: string, within: ParentNode | null | undefined = container): HTMLButtonElement {
  const found = [...(within ?? container).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
  if (!found) throw new Error(`button ${label} missing`);
  return found;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
  await flush();
}

const station = (id: string) => container.querySelector(`[data-station-id="${id}"]`);

async function submit(form: HTMLFormElement | null): Promise<void> {
  if (!form) throw new Error('form missing');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

const KARAHI = {
  station_id: 'S1',
  name: 'Karahi',
  location_label: null,
  station_type: 'slot',
  capacity: 4,
  freshness_window_ms: null,
  completion_mode: 'two_tap',
  archived_at: null,
  programs: [],
};
const FRYER = {
  station_id: 'S2',
  name: 'Fryer',
  location_label: 'Back kitchen',
  station_type: 'batch',
  capacity: 8,
  freshness_window_ms: 120_000,
  completion_mode: 'single_tap',
  archived_at: null,
  programs: [{ program_id: 'P1', name: 'Fry 180 °C', cook_time_ms: 360_000, archived_at: null }],
};

describe('owner stations view', () => {
  it('[01a §8.1] a refused edit shows the saved value again, not the refused text', async () => {
    const { api } = fakeApi((call) => {
      if (call.method === 'GET') return json(200, { data: { stations: [KARAHI] } });
      return json(409, { error: { code: 'CONFIG_NAME_TAKEN', message: 'taken', details: { field: 'name' } } });
    });
    act(() => root.render(<StationsView api={api} branchId="B1" />));
    await flush();

    // v1.1: Edit opens the station; Save station sends the change. A refused save keeps what was typed
    // next to its error (the form is no longer saved field by field on blur).
    await click(button(t('owner.common.edit'), station('S1')));
    const name = container.querySelector<HTMLInputElement>('[data-station-id="S1"] input[name="name"]');
    setValue(name, 'Fryer');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(t('errors.CONFIG_NAME_TAKEN'));
    expect(container.querySelector<HTMLInputElement>('[data-station-id="S1"] input[name="name"]')?.value).toBe('Fryer');
    expect(container.querySelector('[data-station-id="S1"]')?.textContent).not.toContain(t('common.saved'));
  });

  it('[01a §8.1] freshness field only for batch; programs under batch stations; a 409 shows errors.CONFIG_IN_USE text', async () => {
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'GET' && call.url.startsWith('/v1/admin/menu')) {
        return json(200, {
          data: {
            can_edit_tenant: true,
            tax_classes: [],
            categories: [],
            items: [{ item_id: 'I1', name: 'Paye' }],
            next_cursor: null,
          },
        });
      }
      if (call.method === 'GET') return json(200, { data: { stations: [KARAHI, FRYER] } });
      if (call.method === 'PATCH') {
        return json(409, {
          error: {
            code: 'CONFIG_IN_USE',
            message: 'in use',
            details: { used_by: { entity: 'menu_item', ids: ['I1'] } },
            request_id: 'R1',
          },
        });
      }
      if (call.url.endsWith('/programs')) {
        return json(201, { data: { program: { program_id: 'P2', station_id: 'S2', name: 'Reheat', cook_time_ms: 120_000, archived_at: null } } });
      }
      return json(201, { data: { station: { ...KARAHI, station_id: 'S3', name: 'Grill' } } });
    });
    act(() => root.render(<StationsView api={api} branchId="B1" />));
    await flush();
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/v1/admin/branches/B1/stations' });

    // v1.1: each station opens with Edit (one at a time).
    await click(button(t('owner.common.edit'), station('S1')));
    const slot = station('S1');
    // Freshness only on the batch station, shown in minutes.
    expect(slot?.querySelector('input[name="freshness_minutes"]')).toBeNull();
    // Programs only under the batch station.
    expect(slot?.querySelector('[data-program-id]')).toBeNull();
    expect(slot?.textContent).not.toContain(t('owner.stations.add_program'));
    await click(button(t('common.close'), station('S1')));
    await click(button(t('owner.common.edit'), station('S2')));
    const batch = station('S2');
    expect(batch?.querySelector<HTMLInputElement>('input[name="freshness_minutes"]')?.value).toBe('2');
    expect(batch?.querySelector<HTMLSelectElement>('select[name="completion_mode"]')?.value).toBe('single_tap');
    const program = batch?.querySelector('[data-program-id="P1"]');
    expect(program?.querySelector('strong')?.textContent).toBe('Fry 180 °C');
    expect(program?.textContent).toContain('6 min');

    // The add form (a dialog from the app bar) shows the freshness field only once batch is chosen.
    await click(button(t('owner.stations.add_station'), container.querySelector('.pos-appbar')));
    const addStation = container.querySelector<HTMLFormElement>('form[data-form="add-station"]');
    expect(addStation?.querySelector('input[name="freshness_minutes"]')).toBeNull();
    await click(button(t('owner.stations.type_batch'), addStation));
    expect(addStation?.querySelector('input[name="freshness_minutes"]')).not.toBeNull();
    setValue(addStation?.querySelector<HTMLInputElement>('input[name="name"]'), 'Grill');
    setValue(addStation?.querySelector<HTMLInputElement>('input[name="capacity"]'), '3');
    setValue(addStation?.querySelector<HTMLInputElement>('input[name="freshness_minutes"]'), '1');
    await submit(addStation);
    const created = calls.find((c) => c.method === 'POST' && c.url === '/v1/admin/branches/B1/stations');
    expect(created?.body).toEqual({
      name: 'Grill',
      location_label: null,
      station_type: 'batch',
      capacity: 3,
      freshness_window_ms: 60_000,
      completion_mode: 'two_tap',
    });
    expect(created?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // A program is added under the batch station (its dialog), cook time typed in minutes.
    await click(button(t('owner.stations.add_program'), station('S2')));
    const addProgram = container.querySelector<HTMLFormElement>('[role="dialog"] form[data-form="add-program"]');
    setValue(addProgram?.querySelector<HTMLInputElement>('input[name="name"]'), 'Reheat');
    setValue(addProgram?.querySelector<HTMLInputElement>('input[name="cook_minutes"]'), '2');
    await submit(addProgram ?? null);
    const programPost = calls.find((c) => c.method === 'POST' && c.url.endsWith('/stations/S2/programs'));
    expect(programPost?.body).toEqual({ name: 'Reheat', cook_time_ms: 120_000 });
    expect(programPost?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // Changing the type of a station with routes → 409 CONFIG_IN_USE → the blocked dialog names the items
    // (S50 b), and the type can no longer be changed.
    await click(button(t('owner.common.edit'), station('S1')));
    await click(button(t('owner.stations.type_batch'), station('S1')));
    await click(button(t('owner.stations.save_station'), station('S1')));
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toMatchObject({ url: '/v1/admin/branches/B1/stations/S1', body: { station_type: 'batch' }, key: undefined });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("The cooking type can't change while items use Karahi");
    expect(dialog?.querySelector('[data-in-use]')?.textContent).toBe('Paye');
    await click(button(t('common.close'), dialog));
    expect(station('S1')?.textContent).toContain(t('owner.stations.type_locked'));
  });

  it('[01a hand-off S04] Archive {station} sits in the open station\'s More menu; a CONFIG_IN_USE answer shows the "Used by" hint with the names', async () => {
    let archiveAnswer: 'in-use' | 'ok' = 'in-use';
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'GET' && call.url.startsWith('/v1/admin/menu')) {
        return json(200, {
          data: {
            can_edit_tenant: true,
            tax_classes: [],
            categories: [],
            items: [
              { item_id: 'I1', name: 'Paye' },
              { item_id: 'I2', name: 'Chicken Biryani · Half' },
            ],
            next_cursor: null,
          },
        });
      }
      if (call.method === 'GET') return json(200, { data: { stations: [KARAHI, FRYER] } });
      if (archiveAnswer === 'in-use') {
        return json(409, {
          error: { code: 'CONFIG_IN_USE', message: 'in use', details: { used_by: { entity: 'menu_item', ids: ['I1', 'I2', 'I9'] } } },
        });
      }
      return json(200, { data: { station: { ...FRYER, archived_at: 5 } } });
    });
    act(() => root.render(<StationsView api={api} branchId="B1" />));
    await flush();

    // A closed station has no More menu; the open one has, with no Archive block at its foot.
    expect(station('S2')?.querySelector('.pos-more')).toBeNull();
    await click(button(t('owner.common.edit'), station('S2')));
    expect(station('S2')?.tagName).toBe('SECTION');
    expect(station('S2')?.textContent).not.toContain(t('owner.stations.archive_station'));
    expect(station('S2')?.querySelector('.pos-hint')).toBeNull();
    const more = station('S2')?.querySelector<HTMLButtonElement>('button.pos-more');
    expect(more?.getAttribute('aria-label')).toBe(fill(t('common.more_for'), { name: 'Fryer' }));
    await click(more as HTMLButtonElement);
    const menu = station('S2')?.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain(t('stations.menu_info'));
    const item = button(fill(t('stations.menu_archive'), { station: 'Fryer' }), menu);
    expect(item.className).toContain('pos-menu__item--danger');
    await click(item);
    const confirm = container.querySelector('[role="dialog"]');
    expect(confirm?.textContent).toContain(fill(t('archive.item_title'), { name: 'Fryer' }));
    await click(button(fill(t('archive.archive_name'), { name: 'Fryer' }), confirm));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/v1/admin/branches/B1/stations/S2', body: { archived: true } });
    const blocked = container.querySelector('[role="dialog"]');
    expect(blocked?.textContent).toContain(fill(t('archive.blocked_title'), { name: 'Fryer' }));
    await click(button(t('common.close'), blocked));

    // The station stays open and now names the items that use it.
    const hint = station('S2')?.querySelector<HTMLButtonElement>('button.pos-hint');
    expect(hint?.textContent).toBe(fill(t('stations.used_by_short'), { n: '3' }));
    const names = `Paye, Chicken Biryani · Half, ${fill(t('archive.and_more'), { n: '1' })}`;
    expect(hint?.title).toBe(names);
    expect(hint?.getAttribute('aria-label')).toBe(fill(t('stations.used_by_names'), { n: '3', names }));

    archiveAnswer = 'ok';
    await click(station('S2')?.querySelector<HTMLButtonElement>('button.pos-more') as HTMLButtonElement);
    await click(button(fill(t('stations.menu_archive'), { station: 'Fryer' }), station('S2')?.querySelector('[role="menu"]')));
    await click(button(fill(t('archive.archive_name'), { name: 'Fryer' }), container.querySelector('[role="dialog"]')));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
  });

  it('[01a hand-off S04] Show archived is an app-bar More item; its chip hides archived stations again', async () => {
    const { api } = fakeApi(() => json(200, { data: { stations: [KARAHI, { ...FRYER, archived_at: 9 }] } }));
    act(() => root.render(<StationsView api={api} branchId="B1" />));
    await flush();
    const shown = () => [...container.querySelectorAll<HTMLElement>('[data-station-id]')].map((x) => x.dataset['stationId']);
    expect(shown()).toEqual(['S1']);
    expect(container.querySelector('button[role="switch"]')).toBeNull();
    await click(container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more') as HTMLButtonElement);
    await click(button(t('owner.common.show_archived'), container.querySelector('.pos-appbar [role="menu"]')));
    expect(shown()).toEqual(['S1', 'S2']);
    expect(station('S2')?.textContent).toContain(t('owner.common.restore'));
    const chip = container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-filterchip');
    expect(chip?.getAttribute('aria-label')).toBe(t('stations.hide_archived'));
    await click(chip as HTMLButtonElement);
    expect(shown()).toEqual(['S1']);
  });
});
