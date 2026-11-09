import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCloudAdmin } from '../../../api/cloud-admin';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { keyAt } from './bulk-add';
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

function button(label: string, within: ParentNode = container): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
  if (!found) throw new Error(`button ${label} missing`);
  return found;
}

// v1.1: the first floor's form is on the page; later floors are added from the app bar's dialog.
function addFloorForm(): HTMLFormElement {
  if (container.querySelector('form[data-form="add-floor"]') === null) {
    act(() => container.querySelector<HTMLButtonElement>('.pos-appbar .pos-btn--primary')?.click());
  }
  const form = container.querySelector<HTMLFormElement>('form[data-form="add-floor"]');
  if (!form) throw new Error('add floor form missing');
  return form;
}

// Pulse: Rename / Archive sit in the floor's More menu; Show archived is an app-bar More item.
function menuItem(more: HTMLButtonElement | null | undefined, label: string): HTMLButtonElement {
  if (!more) throw new Error('More button missing');
  act(() => more.click());
  const menu = more.parentElement?.querySelector('[role="menu"]');
  return button(label, menu ?? container);
}

const floorMore = (id: string) => container.querySelector<HTMLButtonElement>(`[data-floor-id="${id}"] button.pos-more`);
const barMore = () => container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more');

async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

const GROUND = { floor_id: 'F1', name: 'Ground', sort_order: 0, archived_at: null, zones: [] };

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

  it('[01a §8.1] a refused rename or sort change shows the saved value again, not the refused text', async () => {
    const { api } = fakeApi((call) => {
      if (call.method === 'GET') return json(200, { data: { floors: [{ ...GROUND, tables: [] }] } });
      return json(409, { error: { code: 'CONFIG_NAME_TAKEN', message: 'taken', details: { field: 'name' } } });
    });
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();

    const rename = menuItem(floorMore('F1'), t('floors.rename'));
    act(() => rename.click());
    const name = container.querySelector<HTMLInputElement>('[data-floor-id="F1"] input[name="name"]');
    typeInto(name, 'Basement');
    blur(name);
    await flush();
    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(t('errors.CONFIG_NAME_TAKEN'));
    expect(container.querySelector<HTMLInputElement>('[data-floor-id="F1"] input[name="name"]')?.value).toBe('Ground');

    const sort = container.querySelector<HTMLInputElement>('[data-floor-id="F1"] input[name="sort_order"]');
    typeInto(sort, '7');
    blur(sort);
    await flush();
    expect(container.querySelector<HTMLInputElement>('[data-floor-id="F1"] input[name="sort_order"]')?.value).toBe('0');
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
      { floor_id: 'F2', name: 'Basement', sort_order: 1, archived_at: 20, zones: [], tables: [] },
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
    // v1.1: a table opens its dialog (01a-S03 OwnerTableDialog).
    expect(container.querySelector('[data-table-id="T1"]')?.textContent).toContain(fill(t('owner.floors.seats_n'), { n: '4' }));
    act(() => container.querySelector<HTMLButtonElement>('[data-table-id="T1"]')?.click());
    expect(container.querySelector<HTMLInputElement>('[role="dialog"] input[name="name"]')?.value).toBe('Table 1');
    act(() => button(t('common.cancel'), container.querySelector('[role="dialog"]') ?? container).click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    const toggle = menuItem(barMore(), t('owner.common.show_archived'));
    expect(toggle.getAttribute('role')).toBe('menuitem');
    act(() => toggle.click());
    expect(shownFloors()).toEqual(['F1', 'F2']);
    expect(shownTables()).toEqual(['T1', 'T2']);
    expect(container.querySelector('[data-floor-id="F2"]')?.textContent).toContain(t('owner.common.restore'));

    const rename = menuItem(floorMore('F1'), t('floors.rename'));
    act(() => rename.click());
    const sort = container.querySelector<HTMLInputElement>('[data-floor-id="F1"] input[name="sort_order"]');
    expect(sort?.value).toBe('0');
    typeInto(sort, '3');
    blur(sort);
    await flush();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toMatchObject({ url: '/v1/admin/branches/B1/floors/F1', body: { sort_order: 3 }, key: undefined });
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });

  it('[01a §10 #163] bulk add: keys form key + i, progress, taken names refused, stop and resume, new key on a new floor, 101 refused, branch locked', async () => {
    let tables = [{ table_id: 'X5', name: 'T5', seats: 2, sort_order: 0, archived_at: null }];
    const floors = () => [
      { ...GROUND, tables },
      { floor_id: 'F2', name: 'Hall', sort_order: 1, archived_at: null, zones: [], tables: [] },
    ];
    let failAt: string | null = null;
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'GET') return json(200, { data: { floors: floors() } });
      const name = (call.body as { name: string }).name;
      if (name === failAt) {
        failAt = null;
        return 'network';
      }
      tables = [...tables, { table_id: `X${name}`, name, seats: 4, sort_order: 0, archived_at: null }];
      return json(201, { data: { table: { table_id: `X${name}`, name, seats: 4, sort_order: 0, archived_at: null, floor_id: 'F1' } } });
    });
    act(() => root.render(<FloorsView api={api} branchId="B1" branchIds={['B1', 'B2']} />));
    await flush();

    const f1 = () => container.querySelector('[data-floor-id="F1"]') ?? container;
    act(() => button(t('floors.add_tables'), f1()).click());
    const row = () => container.querySelector('[data-form="bulk-tables"]') ?? container;
    const field = (name: string) => row().querySelector<HTMLInputElement>(`input[name="${name}"]`);
    typeInto(field('first'), 'T1');
    typeInto(field('last'), 'T12');
    typeInto(field('seats'), '4');
    expect(row().textContent).toContain(fill(t('floors.adds_n'), { n: '12', list: 'T1, T2 … T12', seats: '4' }));

    // T5 is already a table at this branch: nothing is sent.
    await act(async () => button(fill(t('floors.add_n_tables'), { n: '12' }), row()).click());
    await flush();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(row().querySelector('.pos-banner--danger')?.textContent).toContain('T5');

    // A range of 101 is refused before anything else.
    typeInto(field('last'), 'T101');
    expect(row().textContent).toContain(t('floors.range_invalid'));
    expect(button(fill(t('floors.add_n_tables'), { n: '0' }), row()).disabled).toBe(true);

    // T6 … T12 with a lost answer on T8 (the 3rd): stop, then resume with the same keys.
    typeInto(field('first'), 'T6');
    typeInto(field('last'), 'T12');
    failAt = 'T8';
    await act(async () => button(fill(t('floors.add_n_tables'), { n: '7' }), row()).click());
    await flush();
    const posts = () => calls.filter((c) => c.method === 'POST');
    expect(posts().map((c) => (c.body as { name: string }).name)).toEqual(['T6', 'T7', 'T8']);
    const formKey = posts()[0]?.key ?? '';
    expect(posts().map((c) => c.key)).toEqual([0, 1, 2].map((i) => keyAt(formKey, i)));
    expect(row().querySelector('.pos-banner--danger')?.textContent).toContain('T8');

    // While the loop runs, the branch select is locked and the button counts.
    const select = container.querySelector<HTMLSelectElement>('select[name="branch"]');
    await act(async () => button(fill(t('floors.add_n_tables'), { n: '7' }), row()).click());
    await flush();
    expect(posts().slice(3).map((c) => [(c.body as { name: string }).name, c.key])).toEqual(
      ['T8', 'T9', 'T10', 'T11', 'T12'].map((name, j) => [name, keyAt(formKey, j + 2)]),
    );
    expect(container.querySelector('[data-form="bulk-tables"]')).toBeNull();
    expect(select?.disabled).toBe(false);

    // A new floor is a new form: its keys differ.
    const f2 = () => container.querySelector('[data-floor-id="F2"]') ?? container;
    act(() => button(t('floors.add_tables'), f2()).click());
    typeInto(field('first'), 'H1');
    typeInto(field('last'), 'H1');
    let release: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = api.createTable;
    api.createTable = async (...args) => {
      await slow;
      return original(...args);
    };
    let clicked: Promise<void> = Promise.resolve();
    act(() => {
      clicked = Promise.resolve(button(fill(t('floors.add_n_tables'), { n: '1' }), row()).click());
    });
    await flush();
    expect(row().textContent).toContain(fill(t('floors.adding_progress'), { i: '1', n: '1' }));
    expect(select?.disabled).toBe(true);
    release();
    await act(async () => clicked);
    await flush();
    expect(posts().at(-1)?.key).not.toBe(formKey);
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => keyAt(formKey, i))).not.toContain(posts().at(-1)?.key);
    expect(select?.disabled).toBe(false);
  });

  it('[01a hand-off S03] a floor More menu names the floor and its counts; Archive {floor} opens the confirm or the blocked dialog', async () => {
    const floors = [
      { ...GROUND, sort_order: 1, tables: [{ table_id: 'T1', name: 'T1', seats: 4, sort_order: 0, archived_at: null }] },
      { floor_id: 'F2', name: 'Roof', sort_order: 2, archived_at: null, zones: [], tables: [] },
    ];
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'GET') return json(200, { data: { floors } });
      return json(200, { data: { floor: { ...floors[1], archived_at: 5 } } });
    });
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();

    // No Rename / Archive buttons on the floor head any more.
    expect(container.querySelector('[data-floor-id="F1"] .pos-section__top')?.textContent).not.toContain(t('floors.rename'));
    expect(floorMore('F1')?.getAttribute('aria-label')).toBe(fill(t('common.more_for'), { name: 'Ground' }));
    expect(floorMore('F1')?.getAttribute('aria-haspopup')).toBe('menu');
    const blocked = menuItem(floorMore('F1'), fill(t('floors.menu_archive'), { floor: 'Ground' }));
    const menu = container.querySelector('[data-floor-id="F1"] [role="menu"]');
    expect(menu?.querySelector('.pos-menu__info')?.textContent).toBe(
      'Ground' + fill(t('floors.menu_info'), { n: '1', t: '1', s: '4' }),
    );
    expect(blocked.className).toContain('pos-menu__item--danger');
    act(() => blocked.click());
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(fill(t('archive.blocked_title'), { name: 'Ground' }));
    act(() => button(t('common.close'), container.querySelector('[role="dialog"]') ?? container).click());

    const archive = menuItem(floorMore('F2'), fill(t('floors.menu_archive'), { floor: 'Roof' }));
    act(() => archive.click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(fill(t('archive.item_title'), { name: 'Roof' }));
    await act(async () => button(fill(t('archive.archive_name'), { name: 'Roof' }), dialog ?? container).click());
    await flush();
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/v1/admin/branches/B1/floors/F2', body: { archived: true } });
  });

  it('[01a hand-off S03] Show archived (app-bar More) adds the "Archived shown" chip, which hides archived floors again', async () => {
    const floors = [
      { ...GROUND, tables: [] },
      { floor_id: 'F2', name: 'Rooftop', sort_order: 1, archived_at: 20, zones: [], tables: [] },
    ];
    const { api } = fakeApi(() => json(200, { data: { floors } }));
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();

    const shown = () => [...container.querySelectorAll<HTMLElement>('[data-floor-id]')].map((f) => f.dataset['floorId']);
    const chip = () => container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-filterchip');
    expect(chip()).toBeNull();
    expect(barMore()?.getAttribute('aria-label')).toBe(t('owner.floors.more'));
    const show = menuItem(barMore(), t('owner.common.show_archived'));
    act(() => show.click());
    expect(shown()).toEqual(['F1', 'F2']);
    expect(chip()?.textContent).toBe(t('floors.archived_shown'));
    expect(chip()?.getAttribute('aria-label')).toBe(t('floors.hide_archived'));
    expect(container.querySelector('[data-floor-id="F2"]')?.className).toContain('pos-section--archived');
    // One primary on the page: Add floor.
    expect(container.querySelectorAll('.pos-btn--primary')).toHaveLength(1);

    act(() => chip()?.click());
    expect(shown()).toEqual(['F1']);
    expect(chip()).toBeNull();

    // The More item reads Hide archived floors while they show.
    const again = menuItem(barMore(), t('owner.common.show_archived'));
    act(() => again.click());
    const hide = menuItem(barMore(), t('floors.hide_archived'));
    act(() => hide.click());
    expect(shown()).toEqual(['F1']);
  });
});

// 01a v2.2 / v2.3 §8.1 (02a A-1, 02b A-1): zones sit under their floor; a zone has its own routes and stock items.
describe('owner floors view: zones', () => {
  // AD-16: the floors list carries each zone's lists.
  const ZONE = {
    zone_id: 'Z1',
    name: 'Garden',
    sort_order: 0,
    archived_at: null,
    routes: [{ item_id: 'I1', station_id: 'S1' }],
    stock_items: [{ item_id: 'I2', threshold: 3 }],
  };
  const OLD_ZONE = { zone_id: 'Z2', name: 'Old', sort_order: 1, archived_at: 5, routes: [], stock_items: [] };
  const item = (item_id: string, extra: Record<string, unknown> = {}) => ({
    item_id,
    name: `Item ${item_id}`,
    sale_unit: 'piece',
    requires_weighing: false,
    archived_at: null,
    routes: [{ branch_id: 'B1', station_id: 'S1' }],
    ...extra,
  });
  const MENU = {
    can_edit_tenant: true,
    tax_classes: [],
    categories: [],
    variant_groups: [],
    items: [
      item('I1'),
      item('I2'),
      item('I3'),
      item('I4', { sale_unit: 'g' }),
      item('I5', { requires_weighing: true }),
      item('I6', { routes: [] }),
      item('I7', { archived_at: 9 }),
    ],
    next_cursor: null,
  };
  const STATIONS = {
    stations: [
      { station_id: 'S1', name: 'Karahi', archived_at: null, programs: [] },
      { station_id: 'S2', name: 'Counter', archived_at: null, programs: [] },
      { station_id: 'S9', name: 'Old grill', archived_at: 5, programs: [] },
    ],
    points: [],
  };

  function zoned(zone = { ...ZONE, floor_id: 'F1' }) {
    return fakeApi((call) => {
      if (call.url.endsWith('/floors')) return json(200, { data: { floors: [{ ...GROUND, zones: [ZONE, OLD_ZONE], tables: [] }] } });
      if (call.url.includes('/menu')) return json(200, { data: MENU });
      if (call.url.endsWith('/stations')) return json(200, { data: STATIONS });
      return json(200, { data: { zone } });
    });
  }

  const zoneChip = (id: string) => container.querySelector<HTMLButtonElement>(`[data-floor-id="F1"] [data-zone-id="${id}"]`);
  const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]');
  const input = (name: string, within: ParentNode = container) => within.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
  function choose(select: HTMLSelectElement | null | undefined, value: string): void {
    if (!select) throw new Error('select missing');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  async function openZone(): Promise<void> {
    act(() => zoneChip('Z1')?.click());
    await flush();
    await flush();
  }

  it('[01a #181 client] zones listed under their floor; an archived zone only behind Show archived', async () => {
    const { api } = zoned();
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();
    expect(zoneChip('Z1')?.textContent).toBe('Garden');
    expect(zoneChip('Z2')).toBeNull();
    const show = menuItem(barMore(), t('owner.common.show_archived'));
    act(() => show.click());
    expect(zoneChip('Z2')?.textContent).toContain('Old');
    expect(zoneChip('Z2')?.className).toContain('is-muted');
  });

  it('[01a #189 client] zone editor sends routes / stock_items as replace lists, only the list that changed', async () => {
    const { api, calls } = zoned();
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();
    await openZone();

    // AD-16: the lists come from the floors list; opening the editor writes nothing.
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
    const stock = (id: string) => dialog()?.querySelector<HTMLElement>(`[data-zone-stock="${id}"]`);
    const route = (id: string) => dialog()?.querySelector<HTMLElement>(`[data-zone-route="${id}"]`);
    expect((input('threshold', stock('I2') ?? container) as HTMLInputElement).value).toBe('3');
    expect((input('station_id', route('I1') ?? container) as HTMLSelectElement).value).toBe('S1');
    // Only active stations; only piece items that are not weighed and are sold at this branch.
    expect([...(input('station_id', route('I1') ?? container) as HTMLSelectElement).options].map((o) => o.value)).toEqual(['S1', 'S2']);
    expect([...(input('stock_add') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'I1', 'I3']);

    // Remove the route and save: routes is [] (clear), stock_items is absent (keep).
    act(() => button(t('zones.remove'), route('I1') ?? container).click());
    await act(async () => button(t('zones.save'), dialog() ?? container).click());
    await flush();
    const patches = () => calls.filter((c) => c.method === 'PATCH');
    expect(patches()).toHaveLength(1);
    expect(patches()[0]?.url).toBe('/v1/admin/branches/B1/zones/Z1');
    expect(patches()[0]?.body).toEqual({ routes: [] });

    // Add a stock item and give it a threshold: the whole stock list is sent, routes are not.
    await openZone();
    choose(input('stock_add') as HTMLSelectElement, 'I3');
    typeInto(input('threshold', dialog()?.querySelector<HTMLElement>('[data-zone-stock="I3"]') ?? container) as HTMLInputElement, '5');
    await act(async () => button(t('zones.save'), dialog() ?? container).click());
    await flush();
    expect(patches().at(-1)?.body).toEqual({
      stock_items: [
        { item_id: 'I2', threshold: 3 },
        { item_id: 'I3', threshold: 5 },
      ],
    });
  });

  it('[01a #189 client] a new zone is created with its floor, name and lists, under an Idempotency-Key', async () => {
    const { api, calls } = zoned();
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();
    act(() => button(t('zones.add'), container.querySelector('[data-floor-id="F1"]') ?? container).click());
    await flush();
    await flush();
    typeInto(input('name', dialog() ?? container) as HTMLInputElement, 'Roof');
    choose(input('route_add') as HTMLSelectElement, 'I3');
    await act(async () => button(t('zones.save'), dialog() ?? container).click());
    await flush();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/v1/admin/branches/B1/zones');
    expect(post?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(post?.body).toEqual({ floor_id: 'F1', name: 'Roof', routes: [{ item_id: 'I3', station_id: 'S1' }] });
  });

  it('[01a AD-7] a refused list entry shows the text of its reason on the zone editor', async () => {
    const { api } = fakeApi((call) => {
      if (call.url.endsWith('/floors')) return json(200, { data: { floors: [{ ...GROUND, zones: [{ ...ZONE, routes: [], stock_items: [] }], tables: [] }] } });
      if (call.url.includes('/menu')) return json(200, { data: MENU });
      if (call.url.endsWith('/stations')) return json(200, { data: STATIONS });
      if (call.body && (call.body as { stock_items?: unknown }).stock_items !== undefined) {
        return json(422, { error: { code: 'CONFIG_REFERENCE_INVALID', message: 'x', details: { field: 'stock_items.0.item_id', reason: 'not_piece' } } });
      }
      return json(200, { data: { zone: { ...ZONE, floor_id: 'F1', routes: [], stock_items: [] } } });
    });
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();
    await openZone();
    choose(input('stock_add') as HTMLSelectElement, 'I3');
    await act(async () => button(t('zones.save'), dialog() ?? container).click());
    await flush();
    expect(dialog()?.textContent).toContain(t('errors.reference.not_piece'));
  });

  it('[01a AD-17] archiving a zone asks first, naming the zone and its tables; there is no Undo chip', async () => {
    const { api, calls } = zoned();
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();
    await openZone();
    act(() => button(t('owner.common.archive'), dialog() ?? container).click());
    await flush();
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
    const confirm = [...container.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1);
    expect(confirm?.textContent).toContain('Garden');
    expect(confirm?.textContent).toContain(t('zones.archive_confirm_body'));
    await act(async () => button(fill(t('archive.archive_name'), { name: 'Garden' }), confirm ?? container).click());
    await flush();
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ archived: true }]);
    expect(container.textContent).not.toContain(t('common.undo'));
  });

  it('[01a S50 e] pickers read every menu page; a stored row whose item is not in the menu shows a neutral label, never its id', async () => {
    const gone = { ...ZONE, routes: [{ item_id: 'I1', station_id: 'S1' }, { item_id: 'GONE-ID', station_id: 'S1' }] };
    const { api, calls } = fakeApi((call) => {
      if (call.url.endsWith('/floors')) return json(200, { data: { floors: [{ ...GROUND, zones: [gone], tables: [] }] } });
      if (call.url.includes('/menu')) {
        return call.url.includes('cursor=c2')
          ? json(200, { data: { ...MENU, items: [item('I8')], next_cursor: null } })
          : json(200, { data: { ...MENU, items: [item('I1')], next_cursor: 'c2' } });
      }
      return json(200, { data: STATIONS });
    });
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();
    await openZone();
    expect(calls.filter((c) => c.url.includes('/menu'))).toHaveLength(2);
    expect([...(input('route_add') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'I8']);
    expect(dialog()?.textContent).not.toContain('GONE-ID');
    expect(dialog()?.textContent).toContain(t('zones.unknown_item'));
  });

  it('[01a AD-6] a floor archive refused with CONFIG_IN_USE reloads and names the real blocker, not a confirm again', async () => {
    let zonesNow: unknown[] = [];
    const { api } = fakeApi((call) => {
      if (call.url.endsWith('/floors')) return json(200, { data: { floors: [{ ...GROUND, zones: zonesNow, tables: [] }] } });
      zonesNow = [ZONE];
      return json(409, { error: { code: 'CONFIG_IN_USE', message: 'x', details: { used_by: { entity: 'zone', ids: ['Z1'] } } } });
    });
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();
    const archive = menuItem(floorMore('F1'), fill(t('floors.menu_archive'), { floor: 'Ground' }));
    act(() => archive.click());
    await act(async () => button(fill(t('archive.archive_name'), { name: 'Ground' }), dialog() ?? container).click());
    await flush();
    await flush();
    expect(dialog()?.textContent).toContain('Garden');
    expect(dialog()?.textContent).toContain(fill(t('archive.floor_zones_body'), { n: '1' }));
  });

  it('[01a AD-6] a floor with active zones lists them in the blocked dialog; Archive all archives the zones, then the floor', async () => {
    const { api, calls } = zoned();
    act(() => root.render(<FloorsView api={api} branchId="B1" />));
    await flush();
    const more = floorMore('F1');
    const archive = menuItem(more, fill(t('floors.menu_archive'), { floor: 'Ground' }));
    act(() => archive.click());
    const blocked = dialog();
    expect(blocked?.textContent).toContain('Garden');
    expect(blocked?.textContent).not.toContain('Old');
    await act(async () => button(fill(t('archive.floor_zones_then_floor'), { n: '1' }), blocked ?? container).click());
    await flush();
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches.map((c) => [c.url, c.body])).toEqual([
      ['/v1/admin/branches/B1/zones/Z1', { archived: true }],
      ['/v1/admin/branches/B1/floors/F1', { archived: true }],
    ]);
  });
});

