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
        return json(201, { data: { category: { category_id: 'C9', name: 'x', sort_order: 0, archived_at: null, availability_windows: [], goes_with: [] } } });
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

// v1.1 (01a-S07): Available hours start from All day / Only at set hours.
function addHours(scope: ParentNode): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Add hours'));
}

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
  { category_id: 'C1', name: 'Karahi', sort_order: 0, archived_at: null, availability_windows: [], goes_with: [] },
  { category_id: 'C2', name: 'Gone', sort_order: 1, archived_at: 5, availability_windows: [], goes_with: [] },
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
      { branch_id: 'B1', station_id: 'S2', program_id: 'P1', stock_program_id: null, price_minor_override: null },
    ]);
  });

  it('[01a §8.1] editing the price leaves untouched odd times alone', async () => {
    const item = {
      item_id: 'I2',
      category_id: 'C1',
      tax_class_id: null,
      name: 'Nihari',
      variant_group_id: null,
      variant_name: null,
      description: null,
      sort_order: 0,
      price_minor: 90_000,
      serve_mode: 'immediate',
      prep_buffer_ms: 30_001,
      cook_time_ms: 100_001,
      stock_time_ms: 50_001,
      out_of_stock_behaviour: 'cook_fresh',
      sale_unit: 'g',
      requires_weighing: false,
      stock_draws: [],
      availability_windows: [],
      weight_pct: 100,
      max_early_ms: 60_000,
      max_carry_ms: null,
      max_late_ms: null,
      adjust_time_ms: 180_000,
      goes_with: [],
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
  it('[01a §8.1 Pulse 01a-S07] Kept ready off folds Ready-made stock to its head; on shows its fields', async () => {
    const { api } = fakeApi();
    await renderNewItem(api);
    const section = () => container.querySelector('[data-section="stock"]');
    expect(section()?.classList.contains('pos-section--folded')).toBe(true);
    expect(field('stock_time_minutes')).toBeNull();
    click(section()?.querySelector('[role="switch"]'));
    expect(section()?.classList.contains('pos-section--folded')).toBe(false);
    expect(field('stock_time_minutes')).not.toBeNull();
    click(section()?.querySelector('[role="switch"]'));
    expect(field('stock_time_minutes')).toBeNull();
  });

  it('[01a §8.1 Pulse 01a-S07] "How staff will see it" is a summary that folds; a new item has no More menu', async () => {
    const { api } = fakeApi();
    await renderNewItem(api);
    const toggle = container.querySelector<HTMLButtonElement>('aside .pos-summary__toggle');
    expect(toggle?.textContent).toBe(t('item.preview'));
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('aside')?.textContent).toContain('Chicken Karahi');
    click(toggle);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('aside')?.textContent).toBe(t('item.preview'));
    click(toggle);
    expect(container.querySelector('aside')?.textContent).toContain('Chicken Karahi');
    expect(container.querySelector('button.pos-more')).toBeNull();
    expect(buttonWith(t('item.archive'))).toBeUndefined();
  });
});
