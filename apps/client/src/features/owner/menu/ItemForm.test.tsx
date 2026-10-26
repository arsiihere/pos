import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudAdmin, type Category, type MenuItem, type TaxClass } from '../../../api/cloud-admin';
import { t } from '../../../i18n';
import { CategoryForm } from './CategoryForm';
import { ItemForm } from './ItemForm';

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

const SLOT = {
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
const BATCH = {
  station_id: 'S2',
  name: 'Fryer',
  location_label: null,
  station_type: 'batch',
  capacity: 8,
  freshness_window_ms: 0,
  completion_mode: 'two_tap',
  archived_at: null,
  programs: [
    { program_id: 'P1', name: 'Fry', cook_time_ms: 360_000, archived_at: null },
    { program_id: 'P3', name: 'Old fry', cook_time_ms: 300_000, archived_at: 5 },
  ],
};
const ARCHIVED_STATION = { ...SLOT, station_id: 'S9', name: 'Old grill', archived_at: 5 };

function fakeApi() {
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
      if (call.method === 'GET') return json(200, { data: { stations: [SLOT, BATCH, ARCHIVED_STATION] } });
      if (url.startsWith('/v1/admin/categories')) {
        return json(201, { data: { category: { category_id: 'C9', name: 'x', sort_order: 0, archived_at: null, availability_windows: [] } } });
      }
      return json(201, { data: { item: { item_id: 'I9' } } });
    },
  });
  return { api, calls };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setValue(el: Element | null | undefined, value: string): void {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement)) throw new Error('field missing');
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

function click(el: Element | null | undefined): void {
  if (!(el instanceof HTMLElement)) throw new Error('element missing');
  act(() => el.click());
}

function field(name: string): HTMLInputElement | HTMLSelectElement | null {
  return container.querySelector<HTMLInputElement | HTMLSelectElement>(`form [name="${name}"]`);
}

function buttonWith(text: string, scope: ParentNode = container): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll('button')].find((b) => b.textContent === text);
}

// v1.1 (01a-S07): Sold by and Stock unit are segmented controls; the stock fields sit under Kept ready;
// Available hours start from All day / Only at set hours.
function pick(group: string, option: string): void {
  const box = container.querySelector(`.pos-seg[aria-label="${group}"]`);
  click(buttonWith(option, box ?? container));
}

function options(group: string): (string | null)[] {
  return [...(container.querySelector(`.pos-seg[aria-label="${group}"]`)?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
}

function toggle(label: string): void {
  click([...container.querySelectorAll('button[role="switch"]')].find((b) => b.textContent === label));
}

function addHours(scope: ParentNode): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Add hours'));
}

const STOCK = t('owner.item.stock_unit');
const SALE = t('owner.item.sale_unit');

async function submitForm(): Promise<void> {
  const form = container.querySelector('form');
  if (!form) throw new Error('form missing');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

const TAXES: TaxClass[] = [
  { tax_class_id: 'X1', name: 'Standard', rate_bp: 1600, archived_at: null },
  { tax_class_id: 'X2', name: 'Old rate', rate_bp: 1700, archived_at: 5 },
];
const CATEGORIES: Category[] = [
  { category_id: 'C1', name: 'Karahi', sort_order: 0, archived_at: null, availability_windows: [] },
  { category_id: 'C2', name: 'Gone', sort_order: 1, archived_at: 5, availability_windows: [] },
];

async function renderNewItem(api: ReturnType<typeof fakeApi>['api'], onSaved = () => {}): Promise<void> {
  act(() =>
    root.render(
      <ItemForm
        api={api}
        item={null}
        taxClasses={TAXES}
        categories={CATEGORIES}
        branchIds={['B1']}
        onSaved={onSaved}
        onCancel={() => {}}
      />,
    ),
  );
  await flush();
  setValue(field('name'), 'Chicken Karahi');
  setValue(field('price'), '1,200');
  setValue(field('cook_minutes'), '10');
}

function posted(calls: Call[]): Record<string, unknown> {
  const call = calls.find((c) => c.method === 'POST');
  if (!call) throw new Error('no POST');
  return call.body as Record<string, unknown>;
}

describe('owner item and category forms', () => {
  it('[01a S34] a new item defaults to No tax and sends tax_class_id null', async () => {
    const { api, calls } = fakeApi();
    const onSaved = vi.fn();
    await renderNewItem(api, onSaved);

    const tax = field('tax_class_id') as HTMLSelectElement;
    expect(tax.options[0]?.textContent).toBe(t('owner.item.no_tax'));
    expect(tax.value).toBe('');
    expect([...tax.options].map((o) => o.value)).toEqual(['', 'X1']);
    expect([...(field('category_id') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['C1']);

    await submitForm();
    const call = calls.find((c) => c.method === 'POST');
    expect(call?.url).toBe('/v1/admin/menu-items');
    expect(call?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(posted(calls)).toMatchObject({
      category_id: 'C1',
      tax_class_id: null,
      name: 'Chicken Karahi',
      price_minor: 120_000,
      serve_mode: 'immediate',
      cook_time_ms: 600_000,
      out_of_stock_behaviour: 'cook_fresh',
      routes: [],
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('[01a S11] a batch station shows the program select, a slot station hides it', async () => {
    const { api, calls } = fakeApi();
    await renderNewItem(api);
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/v1/admin/branches/B1/stations' });

    const route = container.querySelector('[data-route-branch="B1"]');
    const station = route?.querySelector<HTMLSelectElement>('select[name="station_id"]');
    expect(station?.options[0]?.textContent).toBe(t('owner.item.not_sold_here'));
    expect([...(station?.options ?? [])].map((o) => o.value)).toEqual(['', 'S1', 'S2']);
    expect(route?.querySelector('select[name="program_id"]')).toBeNull();

    setValue(station, 'S2');
    const program = route?.querySelector<HTMLSelectElement>('select[name="program_id"]');
    expect([...(program?.options ?? [])].map((o) => o.value)).toEqual(['P1']);
    const stockProgram = route?.querySelector<HTMLSelectElement>('select[name="stock_program_id"]');
    expect([...(stockProgram?.options ?? [])].map((o) => o.value)).toEqual(['', 'P1']);

    setValue(station, 'S1');
    expect(route?.querySelector('select[name="program_id"]')).toBeNull();
    expect(route?.querySelector('select[name="stock_program_id"]')).toBeNull();

    setValue(station, 'S2');
    await submitForm();
    expect(posted(calls)['routes']).toEqual([
      { branch_id: 'B1', station_id: 'S2', program_id: 'P1', stock_program_id: null },
    ]);
  });

  it('[01a S44] g / piece shows "Pieces per …" and sends stock_per_sale_unit; changing a unit shows the next-day warning', async () => {
    const { api, calls } = fakeApi();
    await renderNewItem(api);
    expect(field('stock_per_sale_unit')).toBeNull();
    expect(container.textContent).not.toContain(t('owner.item.unit_change_warning'));
    toggle(t('item.kept_ready'));
    expect(options(STOCK)).toEqual([t('owner.item.unit_piece'), t('owner.item.unit_g'), t('owner.item.unit_ml')]);

    pick(STOCK, t('owner.item.unit_g'));
    expect(field('stock_per_sale_unit')).not.toBeNull();
    expect(container.textContent).toContain(t('owner.item.per_piece_g'));
    expect(container.textContent).toContain(t('owner.item.unit_change_warning'));
    setValue(field('stock_per_sale_unit'), '250');
    await submitForm();
    expect(posted(calls)).toMatchObject({ stock_unit: 'g', sale_unit: 'piece', stock_per_sale_unit: 250 });

    // Sold by the kg: equal units hide the field and send 1; it can only be counted in kg then.
    pick(SALE, t('owner.item.unit_g'));
    expect(field('stock_per_sale_unit')).toBeNull();
    expect(options(STOCK)).toEqual([t('owner.item.unit_g')]);

    // An existing item shows the warning only once a unit changes.
    act(() => root.unmount());
    root = createRoot(container);
    const item = {
      item_id: 'I1',
      category_id: 'C1',
      tax_class_id: 'X1',
      name: 'Paye',
      group_label: null,
      description: null,
      sort_order: 0,
      price_minor: 90_000,
      serve_mode: 'immediate',
      prep_buffer_ms: 0,
      cook_time_ms: 600_000,
      stock_time_ms: null,
      out_of_stock_behaviour: 'sold_out',
      stock_unit: 'piece',
      sale_unit: 'piece',
      stock_per_sale_unit: 1,
      low_stock_threshold: null,
      carries_over: false,
      availability_windows: [],
      archived_at: null,
      routes: [],
    } satisfies MenuItem;
    const edit = fakeApi();
    act(() =>
      root.render(
        <ItemForm
          api={edit.api}
          item={item}
          taxClasses={TAXES}
          categories={CATEGORIES}
          branchIds={['B1']}
          onSaved={() => {}}
          onCancel={() => {}}
        />,
      ),
    );
    await flush();
    expect(container.textContent).not.toContain(t('owner.item.unit_change_warning'));
    toggle(t('item.kept_ready'));
    pick(STOCK, t('owner.item.unit_ml'));
    expect(container.textContent).toContain(t('owner.item.unit_change_warning'));
    setValue(field('stock_per_sale_unit'), '330');
    await submitForm();
    const patch = edit.calls.find((c) => c.method === 'PATCH');
    expect(patch).toMatchObject({ url: '/v1/admin/menu-items/I1', key: undefined });
    expect(patch?.body).toEqual({ stock_unit: 'ml', stock_per_sale_unit: 330 });
  });

  it('[01a §8.1, S46] editing the price leaves untouched odd times alone; a stock unit change clears the threshold', async () => {
    const item = {
      item_id: 'I2',
      category_id: 'C1',
      tax_class_id: null,
      name: 'Nihari',
      group_label: null,
      description: null,
      sort_order: 0,
      price_minor: 90_000,
      serve_mode: 'immediate',
      prep_buffer_ms: 30_001,
      cook_time_ms: 100_001,
      stock_time_ms: 50_001,
      out_of_stock_behaviour: 'cook_fresh',
      stock_unit: 'g',
      sale_unit: 'g',
      stock_per_sale_unit: 1,
      low_stock_threshold: 1500,
      carries_over: false,
      availability_windows: [],
      archived_at: null,
      routes: [],
    } satisfies MenuItem;
    const edit = fakeApi();
    act(() =>
      root.render(
        <ItemForm
          api={edit.api}
          item={item}
          taxClasses={TAXES}
          categories={CATEGORIES}
          branchIds={['B1']}
          onSaved={() => {}}
          onCancel={() => {}}
        />,
      ),
    );
    await flush();
    setValue(field('price'), '950');
    await submitForm();
    expect(edit.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ price_minor: 95_000 });

    const threshold = () => container.querySelector<HTMLInputElement>('[data-field="low_stock_threshold"] input');
    expect(threshold()?.value).toBe('1.5');
    pick(SALE, t('owner.item.unit_piece'));
    expect(threshold()?.value).toBe('1.5');
    pick(STOCK, t('owner.item.unit_piece'));
    expect(threshold()?.value).toBe('');
  });

  it('[01a S46, S41] threshold 1.5 kg sends 1500; Keeps overnight sends carries_over true', async () => {
    const { api, calls } = fakeApi();
    await renderNewItem(api);
    toggle(t('item.kept_ready'));
    pick(SALE, t('owner.item.unit_g'));
    const threshold = container.querySelector('[data-field="low_stock_threshold"]');
    expect(threshold?.textContent).toContain(t('quantity.kg'));
    setValue(threshold?.querySelector('input'), '1.5');
    const keeps = [...container.querySelectorAll('button[role="switch"]')].find((b) => b.textContent === t('owner.item.carries_over'));
    expect(keeps?.getAttribute('aria-checked')).toBe('false');
    click(keeps);
    await submitForm();
    expect(posted(calls)).toMatchObject({
      stock_unit: 'g',
      sale_unit: 'g',
      stock_per_sale_unit: 1,
      low_stock_threshold: 1500,
      carries_over: true,
    });
  });

  it('[01a S47] 07:00–13:00 sends { 25200000, 46800000 }; a fifth row cannot be added; equal times show a field error', async () => {
    const { api, calls } = fakeApi();
    await renderNewItem(api);
    const hours = () => container.querySelector('[data-field="availability_windows"]');
    const rows = () => [...(hours()?.querySelectorAll('[data-window-row]') ?? [])];
    expect(rows()).toHaveLength(0);
    expect(hours()?.textContent).toContain(t('owner.hours.always'));

    click(buttonWith(t('owner.hours.set_hours'), hours() ?? container));
    expect(rows()).toHaveLength(1);
    setValue(rows()[0]?.querySelector('input[name="start"]'), '07:00');
    setValue(rows()[0]?.querySelector('input[name="end"]'), '13:00');
    for (let i = 1; i < 4; i += 1) click(addHours(hours() ?? container));
    expect(rows()).toHaveLength(4);
    expect(addHours(hours() ?? container)).toBeUndefined();

    // Equal times: a field error on that row, and nothing is sent.
    setValue(rows()[1]?.querySelector('input[name="start"]'), '10:00');
    setValue(rows()[1]?.querySelector('input[name="end"]'), '10:00');
    expect(rows()[1]?.textContent).toContain(t('owner.hours.equal'));
    await submitForm();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    for (let i = 3; i >= 1; i -= 1) click(buttonWith(t('owner.hours.remove'), rows()[i]));
    expect(rows()).toHaveLength(1);
    await submitForm();
    expect(posted(calls)['availability_windows']).toEqual([{ start_ms: 25_200_000, end_ms: 46_800_000 }]);

    // A category takes the same hours field.
    act(() => root.unmount());
    root = createRoot(container);
    const cat = fakeApi();
    act(() => root.render(<CategoryForm api={cat.api} category={null} onSaved={() => {}} onCancel={() => {}} />));
    setValue(field('name'), 'Breakfast');
    click(buttonWith(t('owner.hours.set_hours'), hours() ?? container));
    setValue(rows()[0]?.querySelector('input[name="start"]'), '22:00');
    setValue(rows()[0]?.querySelector('input[name="end"]'), '02:00');
    await submitForm();
    const created = cat.calls.find((c) => c.method === 'POST');
    expect(created?.url).toBe('/v1/admin/categories');
    expect(created?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(created?.body).toEqual({
      name: 'Breakfast',
      sort_order: 0,
      availability_windows: [{ start_ms: 79_200_000, end_ms: 7_200_000 }],
    });
  });
});
