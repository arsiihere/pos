import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCloudAdmin } from '../../../api/cloud-admin';
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

    const name = container.querySelector<HTMLInputElement>('[data-station-id="S1"] input[name="name"]');
    setValue(name, 'Fryer');
    act(() => {
      name?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await flush();
    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(t('errors.CONFIG_NAME_TAKEN'));
    expect(container.querySelector<HTMLInputElement>('[data-station-id="S1"] input[name="name"]')?.value).toBe('Karahi');
  });

  it('[01a §8.1] freshness field only for batch; programs under batch stations; a 409 shows errors.CONFIG_IN_USE text', async () => {
    const { api, calls } = fakeApi((call) => {
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

    const slot = container.querySelector('[data-station-id="S1"]');
    const batch = container.querySelector('[data-station-id="S2"]');
    // Freshness only on the batch station, shown in minutes.
    expect(slot?.querySelector('input[name="freshness_minutes"]')).toBeNull();
    expect(batch?.querySelector<HTMLInputElement>('input[name="freshness_minutes"]')?.value).toBe('2');
    expect(batch?.querySelector<HTMLSelectElement>('select[name="completion_mode"]')?.value).toBe('single_tap');
    // Programs only under the batch station.
    expect(slot?.querySelector('[data-program-id]')).toBeNull();
    expect(slot?.querySelector('form[data-form="add-program"]')).toBeNull();
    const program = batch?.querySelector('[data-program-id="P1"]');
    expect(program?.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Fry 180 °C');
    expect(program?.querySelector<HTMLInputElement>('input[name="cook_minutes"]')?.value).toBe('6');

    // The add form shows the freshness field only once batch is chosen.
    const addStation = container.querySelector<HTMLFormElement>('form[data-form="add-station"]');
    expect(addStation?.querySelector('input[name="freshness_minutes"]')).toBeNull();
    setValue(addStation?.querySelector<HTMLSelectElement>('select[name="station_type"]'), 'batch');
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

    // A program is added under the batch station, cook time typed in minutes.
    const addProgram = container
      .querySelector('[data-station-id="S2"]')
      ?.querySelector<HTMLFormElement>('form[data-form="add-program"]');
    setValue(addProgram?.querySelector<HTMLInputElement>('input[name="name"]'), 'Reheat');
    setValue(addProgram?.querySelector<HTMLInputElement>('input[name="cook_minutes"]'), '2');
    await submit(addProgram ?? null);
    const programPost = calls.find((c) => c.method === 'POST' && c.url.endsWith('/stations/S2/programs'));
    expect(programPost?.body).toEqual({ name: 'Reheat', cook_time_ms: 120_000 });
    expect(programPost?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // Changing the type of a station with routes → 409 CONFIG_IN_USE → its text.
    setValue(
      container.querySelector('[data-station-id="S1"]')?.querySelector<HTMLSelectElement>('select[name="station_type"]'),
      'batch',
    );
    await flush();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toMatchObject({ url: '/v1/admin/branches/B1/stations/S1', body: { station_type: 'batch' }, key: undefined });
    const banner = container.querySelector('.pos-banner--danger');
    expect(banner?.textContent).toContain(t('errors.CONFIG_IN_USE'));
  });
});
