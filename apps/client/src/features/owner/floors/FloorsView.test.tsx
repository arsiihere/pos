import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCloudAdmin } from '../../../api/cloud-admin';
import { t } from '../../../i18n';
import { FloorsView } from './FloorsView';

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

type Handler = (call: Call) => Response | 'network';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeApi(handler: Handler) {
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
      const reply = handler(call);
      if (reply === 'network') throw new TypeError('Failed to fetch');
      return reply;
    },
  });
  return { api, calls };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function typeInto(input: HTMLInputElement | null | undefined, text: string): void {
  if (!input) throw new Error('input missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function blur(input: HTMLInputElement | null | undefined): void {
  if (!input) throw new Error('input missing');
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

function addFloorForm(): HTMLFormElement {
  const form = container.querySelector<HTMLFormElement>('form[data-form="add-floor"]');
  if (!form) throw new Error('add floor form missing');
  return form;
}

async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

const GROUND = { floor_id: 'F1', name: 'Ground', sort_order: 0, archived_at: null };

describe('owner floors view', () => {
  it('[01a §10 #76] form retry reuses its Idempotency-Key; a newly opened form gets a new one', async () => {
    let failNextPost = true;
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'GET') return json(200, { data: { floors: [] } });
      if (failNextPost) {
        failNextPost = false;
        return 'network';
      }
      return json(201, { data: { floor: GROUND } });
    });
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();

    typeInto(addFloorForm().querySelector('input'), 'Ground');
    await submit(addFloorForm());
    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(t('errors.network'));
    expect(addFloorForm().querySelector('input')?.value).toBe('Ground');

    await submit(addFloorForm());
    const posts = () => calls.filter((c) => c.method === 'POST');
    expect(posts()).toHaveLength(2);
    expect(posts()[0]?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(posts()[1]?.key).toBe(posts()[0]?.key);
    expect(posts()[1]?.body).toEqual({ name: 'Ground' });
    expect(addFloorForm().querySelector('input')?.value).toBe('');
    expect(container.querySelector('.pos-banner--danger')).toBeNull();

    // After a success the form starts again with a new key.
    typeInto(addFloorForm().querySelector('input'), 'Roof');
    await submit(addFloorForm());
    expect(posts()[2]?.key).not.toBe(posts()[0]?.key);

    // A form opened again (the view mounted anew) has a new key too.
    act(() => root.render(<p />));
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();
    typeInto(addFloorForm().querySelector('input'), 'Terrace');
    await submit(addFloorForm());
    const keys = posts().map((c) => c.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys[3]).not.toBe(keys[2]);
  });

  it('[01a §8.1] a changed body after a lost response gets IDEMPOTENCY_KEY_MISMATCH: the list reloads and the next submit has a new key', async () => {
    const posts: Call[] = [];
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'GET') return json(200, { data: { floors: posts.length === 0 ? [] : [{ ...GROUND, tables: [] }] } });
      posts.push(call);
      if (posts.length === 1) return 'network';
      if (posts.length === 2) {
        return json(422, {
          error: { code: 'IDEMPOTENCY_KEY_MISMATCH', message: 'mismatch', details: { idempotency_key: call.key } },
        });
      }
      return json(201, { data: { floor: { ...GROUND, floor_id: 'F2', name: 'Roof' } } });
    });
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();

    typeInto(addFloorForm().querySelector('input'), 'Ground');
    await submit(addFloorForm());
    typeInto(addFloorForm().querySelector('input'), 'Ground floor');
    await submit(addFloorForm());

    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(t('errors.IDEMPOTENCY_KEY_MISMATCH'));
    expect(t('errors.IDEMPOTENCY_KEY_MISMATCH')).not.toBe(t('errors.UNKNOWN'));
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
    expect(container.querySelector('[data-floor-id="F1"]')).not.toBeNull();

    typeInto(addFloorForm().querySelector('input'), 'Roof');
    await submit(addFloorForm());
    expect(posts[1]?.key).toBe(posts[0]?.key);
    expect(posts[2]?.key).not.toBe(posts[0]?.key);
  });

  it('[01a §8.1] floors with tables, archived rows behind a toggle, sort number edit sends PATCH { sort_order }', async () => {
    const floors = [
      {
        ...GROUND,
        tables: [
          { table_id: 'T1', name: 'Table 1', seats: 4, sort_order: 0, archived_at: null },
          { table_id: 'T2', name: 'Old table', seats: null, sort_order: 1, archived_at: 10 },
        ],
      },
      { floor_id: 'F2', name: 'Basement', sort_order: 1, archived_at: 20, tables: [] },
    ];
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'GET') return json(200, { data: { floors } });
      return json(200, { data: { floor: { ...GROUND, sort_order: 3 } } });
    });
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();

    expect(calls[0]).toMatchObject({ method: 'GET', url: '/v1/admin/branches/B1/floors' });
    const shownFloors = () => [...container.querySelectorAll<HTMLElement>('[data-floor-id]')].map((f) => f.dataset['floorId']);
    const shownTables = () => [...container.querySelectorAll<HTMLElement>('[data-table-id]')].map((r) => r.dataset['tableId']);
    expect(shownFloors()).toEqual(['F1']);
    expect(shownTables()).toEqual(['T1']);
    expect(container.querySelector<HTMLInputElement>('[data-table-id="T1"] input[name="name"]')?.value).toBe('Table 1');
    expect(container.querySelector('[data-table-id="T1"]')?.textContent).toContain(`4 ${t('owner.floors.seats')}`);

    const toggle = container.querySelector<HTMLInputElement>('input[name="show_archived"]');
    act(() => toggle?.click());
    expect(shownFloors()).toEqual(['F1', 'F2']);
    expect(shownTables()).toEqual(['T1', 'T2']);
    expect(container.querySelector('[data-floor-id="F2"]')?.textContent).toContain(t('owner.common.restore'));

    const sort = container.querySelector<HTMLInputElement>('[data-floor-id="F1"] input[name="sort_order"]');
    expect(sort?.value).toBe('0');
    typeInto(sort, '3');
    blur(sort);
    await flush();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toMatchObject({ url: '/v1/admin/branches/B1/floors/F1', body: { sort_order: 3 }, key: undefined });
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });
});
