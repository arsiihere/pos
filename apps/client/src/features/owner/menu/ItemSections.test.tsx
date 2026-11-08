import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Category, MenuItem, StockItem, TaxClass, VariantGroup } from '../../../api/cloud-admin';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { button, click, fail, fakeApi, flush, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { GuardProvider } from '../guard';
import { ItemForm } from './ItemForm';
import { MenuView } from './MenuView';

// 01c §8, contract §2 (01c-S01): the item form's Size group, Weighed when served and Stock sections, the
// "Create a stock item with this name" mini-form (test #124), and the menu list's nested sizes (01a-S05).

let ui: Mounted;
beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  ui = mount();
});
afterEach(() => {
  ui.unmount();
  sessionStorage.clear();
  window.location.hash = '';
});

const TAXES: TaxClass[] = [{ tax_class_id: 'X1', name: 'Standard', rate_bp: 1600, archived_at: null }];
const CATEGORIES: Category[] = [
  { category_id: 'C1', name: 'Karahi', sort_order: 0, archived_at: null, availability_windows: [], goes_with: [] },
  { category_id: 'C2', name: 'BBQ', sort_order: 1, archived_at: null, availability_windows: [], goes_with: [] },
];
const GROUPS: VariantGroup[] = [
  { variant_group_id: 'VG1', name: 'Chicken Karahi', category_id: 'C1', description: null, sort_order: 0, archived_at: null, member_ids: ['I1', 'I2'], version: 'v1' },
];
const STATION = {
  station_id: 'S1',
  name: 'Karahi counter',
  location_label: null,
  station_type: 'slot',
  capacity: 4,
  freshness_window_ms: null,
  completion_mode: 'two_tap',
  archived_at: null,
  programs: [],
};

function item(extra: Partial<MenuItem> = {}): MenuItem {
  return {
    item_id: 'I1',
    category_id: 'C1',
    tax_class_id: null,
    name: 'Chicken Karahi — Half',
    variant_group_id: null,
    variant_name: null,
    description: null,
    sort_order: 0,
    price_minor: 115_000,
    serve_mode: 'immediate',
    prep_buffer_ms: 0,
    cook_time_ms: 600_000,
    stock_time_ms: null,
    out_of_stock_behaviour: 'cook_fresh',
    sale_unit: 'piece',
    requires_weighing: false, is_ready_item: false,
    stock_draws: [],
    availability_windows: [],
    weight_pct: 100,
    max_early_ms: 60_000,
    max_carry_ms: null,
    max_late_ms: null,
    adjust_time_ms: 180_000,
    goes_with: [],
    archived_at: null,
    routes: [{ branch_id: 'B1', station_id: 'S1', program_id: null, stock_program_id: null, price_minor_override: null }],
    ...extra,
  };
}

function pot(extra: Partial<StockItem> = {}): StockItem {
  return {
    stock_item_id: 'K1',
    name: 'Karahi pot',
    stock_unit: 'g',
    carries_over: false,
    archived_at: null,
    version: 'k1',
    branches: ['B1', 'B2', 'B3', 'B4'].map((b) => ({ branch_id: b, station_id: 'S1', low_stock_threshold: 1000, version: `${b}-v1` })),
    drawers: [],
    ...extra,
  };
}

// A small cloud: stations per branch, the stock item list (§6.6), POST/PUT stock items, item PATCH/POST.
// `lose` (test #124): the server does the call, then its answer is lost (the fetch fails).
function server(
  options: { stock?: StockItem[]; on?: (call: Call) => Response | undefined; lose?: (call: Call) => boolean } = {},
) {
  const stock = [...(options.stock ?? [])];
  // §6 Idempotency: the same key replays the stored 201; a new key with a taken name → 409.
  const byKey = new Map<string, StockItem>();
  return fakeApi((call) => {
    const answer = options.on?.(call);
    if (answer !== undefined) return answer;
    const reply = handle(call);
    if (options.lose?.(call) === true) throw new TypeError('Failed to fetch');
    return reply;
  });

  function handle(call: Call): Response {
    if (call.url.endsWith('/stations')) return ok({ stations: [STATION] });
    if (call.method === 'GET' && call.url.startsWith('/v1/admin/stock-items')) {
      return ok({ can_edit_tenant: true, stock_items: call.url.includes('archived') ? [] : stock });
    }
    if (call.method === 'POST' && call.url === '/v1/admin/stock-items') {
      const body = call.body as { name: string; stock_unit: 'g' };
      let made = call.key === undefined ? undefined : byKey.get(call.key);
      if (made === undefined) {
        if (stock.some((s) => s.name === body.name)) return fail(409, 'CONFIG_NAME_TAKEN', { entity: 'stock_item' });
        made = pot({ stock_item_id: 'K9', name: body.name, stock_unit: body.stock_unit, branches: ['B1', 'B2'].map((b) => ({ branch_id: b, station_id: null, low_stock_threshold: null, version: `${b}-none` })) });
        stock.push(made);
        if (call.key !== undefined) byKey.set(call.key, made);
      }
      return new Response(JSON.stringify({ data: { stock_item: made } }), { status: 201 });
    }
    const put = /^\/v1\/admin\/stock-items\/(\w+)\/branches\/(\w+)$/.exec(call.url);
    if (call.method === 'PUT' && put !== null) {
      const row = stock.find((s) => s.stock_item_id === put[1])?.branches.find((b) => b.branch_id === put[2]);
      const body = call.body as { expected_version: string; station_id: string };
      if (row === undefined || row.version !== body.expected_version) return fail(409, 'CONFIG_STALE', { entity: 'stock_item_branch' });
      row.station_id = body.station_id;
      row.version = `${put[2]}-v2`;
      return ok({ branch: row });
    }
    if (call.method === 'PATCH') return ok({ item: item() });
    return new Response(JSON.stringify({ data: { item: item({ item_id: 'I9' }) } }), { status: 201 });
  }
}

async function renderForm(api: ReturnType<typeof fakeApi>['api'], it: MenuItem | null, extra: { newSizeOf?: string; branchIds?: string[] } = {}) {
  await ui.render(
    <GuardProvider>
    <ItemForm
      api={api}
      item={it}
      taxClasses={TAXES}
      categories={CATEGORIES}
      branchIds={extra.branchIds ?? ['B1']}
      variantGroups={GROUPS}
      {...(extra.newSizeOf === undefined ? {} : { newSizeOf: extra.newSizeOf })}
      onSaved={() => {}}
      onCancel={() => {}}
    />
    </GuardProvider>,
  );
  await flush();
}

const q = <T extends Element>(sel: string) => ui.container.querySelector<T>(sel);
const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => q<T>(`[name="${name}"]`);
const section = (name: string) => q<HTMLElement>(`[data-section="${name}"]`);
const saveButton = () => button(ui.container, t('item.save'));
// The folded Branches and kitchen, Ready-made stock, Hours row; a missing row fails the test.
const foldRow = () => {
  const row = q<HTMLButtonElement>('button.pos-disclosure');
  if (row === null) throw new Error('fold row missing');
  return row;
};

async function save() {
  const form = q<HTMLFormElement>('form#item-form');
  if (form === null) throw new Error('form missing');
  await click(saveButton());
  await flush();
}

const patches = (calls: Call[]) => calls.filter((c) => c.method === 'PATCH').map((c) => c.body);

describe('01c-S01 item form sections', () => {
  it('a plain item folds Size group to one line; Put in a size group picks the group, fills its category and needs a size name', async () => {
    const { api, calls } = server();
    await renderForm(api, item({ category_id: 'C2' }));
    expect(section('size')?.classList.contains('pos-section--quiet')).toBe(true);
    expect(section('size')?.textContent).toContain(t('item.size_section_plain'));
    expect(field('variant_group_id')).toBeNull();

    await click(button(section('size') as HTMLElement, t('item.put_in_group')));
    setValue(field('variant_group_id'), 'VG1');
    expect(field<HTMLSelectElement>('category_id')?.value).toBe('C1');

    await save();
    expect(patches(calls)).toHaveLength(0);
    expect(q('[data-fix-summary], .pos-banner--danger')?.textContent).toContain(t('item.need_size_name'));

    setValue(field('variant_name'), 'Half');
    await save();
    expect(patches(calls)).toEqual([{ category_id: 'C1', variant_group_id: 'VG1', variant_name: 'Half' }]);
  });

  it('Remove from size group sends variant_group_id and variant_name null together', async () => {
    const { api, calls } = server();
    await renderForm(api, item({ variant_group_id: 'VG1', variant_name: 'Half' }));
    expect(field<HTMLSelectElement>('variant_group_id')?.value).toBe('VG1');
    await click(button(section('size') as HTMLElement, t('item.size_remove')));
    expect(section('size')?.classList.contains('pos-section--quiet')).toBe(true);
    await save();
    expect(patches(calls)).toEqual([{ variant_group_id: null, variant_name: null }]);
  });

  it('Add a size (new_size_of) fills the size group and its category; the POST carries both', async () => {
    const { api, calls } = server();
    await renderForm(api, null, { newSizeOf: 'VG1' });
    expect(field<HTMLSelectElement>('variant_group_id')?.value).toBe('VG1');
    expect(field<HTMLSelectElement>('category_id')?.value).toBe('C1');
    setValue(field('name'), 'Chicken Karahi — Full');
    setValue(field('price'), '2,200');
    setValue(field('cook_minutes'), '20');
    setValue(field('variant_name'), 'Full');
    await click(button(ui.container, t('item.add')));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(post?.body).toMatchObject({ category_id: 'C1', variant_group_id: 'VG1', variant_name: 'Full', requires_weighing: false, stock_draws: [] });
  });

  it('Weighed when served shows only for kg / L items; on, it hides the stock link and drops the draw', async () => {
    const { api, calls } = server({ stock: [pot()] });
    await renderForm(api, item());
    expect(section('weighed')).toBeNull();
    ui.unmount();
    ui = mount();
    await renderForm(api, item({ sale_unit: 'g', stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 1 }] }));
    expect(field('stock_item_id')).not.toBeNull();
    await click(section('weighed')?.querySelector('[role="switch"]') as HTMLElement);
    expect(field('stock_item_id')).toBeNull();
    expect(section('draw')?.textContent).toContain(t('item.stock_not_used'));
    await save();
    expect(patches(calls)).toEqual([{ requires_weighing: true, stock_draws: [] }]);
  });

  it('Stock: uses per sale in the stock unit (kg), a summary of at most 3 branches + "+N more", Open stock item after the guard', async () => {
    const { api, calls } = server({ stock: [pot()] });
    await renderForm(api, item({ stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] }), { branchIds: ['B1', 'B2', 'B3', 'B4'] });
    expect(field<HTMLSelectElement>('stock_item_id')?.value).toBe('K1');
    expect(field<HTMLInputElement>('uses')?.value).toBe('0.5');
    const summary = q('[data-stock-summary]');
    expect(summary?.querySelector('b')?.textContent).toBe(
      fill(t('item.stock_head'), { name: 'Karahi pot', unit: 'g', keeps: t('item.no_keep') }),
    );
    expect(summary?.textContent).toContain(fill(t('item.stock_line_alert'), { branch: 'B1', station: 'Karahi counter', n: '1 kg' }));
    expect([...(summary?.querySelectorAll('span') ?? [])].map((s) => s.textContent)).toContain(fill(t('item.more_n'), { n: '1' }));

    setValue(field('uses'), '1');
    await save();
    expect(patches(calls)).toEqual([{ stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 1000 }] }]);

    // Unsaved changes: Open stock item asks first (the guard), and goes only after Discard.
    setValue(field('name'), 'Chicken Karahi — Small');
    await click(summary?.querySelector('a') as HTMLElement);
    expect(window.location.hash).not.toBe('#/stock-items/K1');
    expect(ui.container.textContent).toContain(fill(t('discard.title'), { name: 'Chicken Karahi — Half' }));
    await click(button(ui.container, t('discard.discard')));
    expect(window.location.hash).toBe('#/stock-items/K1');
  });

  it('a kg item with stock counted in pieces is stopped before sending (unit_mismatch on the stock field)', async () => {
    const { api, calls } = server({ stock: [pot({ stock_unit: 'piece' })] });
    await renderForm(api, item({ sale_unit: 'g' }));
    setValue(field('stock_item_id'), 'K1');
    setValue(field('uses'), '1');
    await save();
    expect(patches(calls)).toHaveLength(0);
    expect(q('#item-stock_item_id')?.closest('.pos-field')?.textContent).toContain(t('errors.reference.unit_mismatch'));
  });

  it('422 category_mismatch at variant_group_id marks the size group field under the one summary banner', async () => {
    const { api } = server({
      on: (call) => (call.method === 'PATCH' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'variant_group_id', reason: 'category_mismatch' }) : undefined),
    });
    await renderForm(api, item({ variant_group_id: 'VG1', variant_name: 'Half' }));
    setValue(field('variant_name'), 'Small');
    await save();
    expect(q('#item-variant_group_id')?.closest('.pos-field')?.textContent).toContain(t('errors.reference.category_mismatch'));
    expect(ui.container.querySelectorAll('.pos-banner--danger')).toHaveLength(1);
  });

  it('409 CONFIG_NAME_TAKEN { entity: variant } marks the size name; 409 CONFIG_IN_USE opens the in-use dialog', async () => {
    let answer = fail(409, 'CONFIG_NAME_TAKEN', { entity: 'variant' });
    const { api } = server({ on: (call) => (call.method === 'PATCH' ? answer : undefined) });
    await renderForm(api, item({ sale_unit: 'g', variant_group_id: 'VG1', variant_name: 'Half' }));
    setValue(field('variant_name'), 'Full');
    await save();
    expect(q('#item-variant_name')?.closest('.pos-field')?.textContent).toContain(t('errors.CONFIG_NAME_TAKEN'));

    answer = fail(409, 'CONFIG_IN_USE', { entity: 'menu_item', id: 'I1', used_by: { entity: 'modifier_group', ids: ['M1', 'M2'] } });
    await click(section('weighed')?.querySelector('[role="switch"]') as HTMLElement);
    await save();
    const dialog = q('[data-in-use]');
    expect(dialog?.textContent).toContain(fill(t('item.in_use_change'), { name: 'Chicken Karahi — Half' }));
    expect(dialog?.textContent).toContain(fill(t('item.in_use_groups'), { n: '2' }));
    expect(dialog?.querySelector('a')?.getAttribute('href')).toBe('#/choice-groups');
  });
});

describe('owner decision 2026-10-30: Branches and kitchen, Ready-made stock, Hours fold into one row', () => {
  const fold = () => q<HTMLButtonElement>('button.pos-disclosure');
  const foldBody = () => document.getElementById(fold()?.getAttribute('aria-controls') ?? '');

  it('an edit starts folded; the row sums up the stock draw when counted (stock time + draw), else "Not counted"', async () => {
    const { api } = server({ stock: [pot()] });
    await renderForm(api, item({ stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] }));
    expect(fold()?.getAttribute('aria-expanded')).toBe('false');
    expect(fold()?.textContent).toBe(`${t('item.fold_title')} · ${fill(t('item.fold_draw'), { stock: 'Karahi pot', qty: '\u20660.5 kg\u2069' })}`);
    // Kept mounted while closed: the sections are in the page, hidden.
    expect(foldBody()?.hidden).toBe(true);
    expect(foldBody()?.querySelector('[data-section="stock"]')).not.toBeNull();

    await click(foldRow());
    expect(fold()?.getAttribute('aria-expanded')).toBe('true');
    expect(foldBody()?.hidden).toBe(false);
    // 01c A2: Kept ready off → no stock time → not counted.
    await click(section('stock')?.querySelector('[role="switch"]') as HTMLElement);
    expect(fold()?.textContent).toBe(`${t('item.fold_title')} · ${t('item.fold_not_counted')}`);
  });

  it('a draw without a stock time or stock program, and an item with no draw, read "Not counted"', async () => {
    const { api } = server({ stock: [pot()] });
    await renderForm(api, item({ stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] }));
    expect(fold()?.textContent).toContain(t('item.fold_not_counted'));
    ui.unmount();
    ui = mount();
    await renderForm(api, item({ stock_time_ms: 300_000 }));
    expect(fold()?.textContent).toContain(t('item.fold_not_counted'));
  });

  it('a new item starts open; an error inside a folded row opens it, and the field shows its error', async () => {
    const { api, calls } = server();
    await renderForm(api, null);
    expect(fold()?.getAttribute('aria-expanded')).toBe('true');
    ui.unmount();
    ui = mount();
    await renderForm(api, item());
    expect(fold()?.getAttribute('aria-expanded')).toBe('false');
    setValue(field('cook_minutes'), '');
    await save();
    expect(patches(calls)).toHaveLength(0);
    expect(fold()?.getAttribute('aria-expanded')).toBe('true');
    expect(foldBody()?.hidden).toBe(false);
    expect(q('#item-cook_minutes')?.closest('.pos-field')?.textContent).toContain(t('item.need_cook'));
  });

  it('typed hours survive closing and reopening the row (kept mounted)', async () => {
    const { api } = server();
    await renderForm(api, item());
    await click(foldRow());
    const hours = () => q('[data-field="availability_windows"]') as HTMLElement;
    await click(button(hours(), t('owner.hours.set_hours')));
    setValue(hours().querySelector<HTMLInputElement>('input[name="start"]'), '07:00');
    await click(foldRow());
    await click(foldRow());
    expect(hours().querySelector<HTMLInputElement>('input[name="start"]')?.value).toBe('07:00');
  });
});

describe('R2-C review fixes', () => {
  const fold = () => q<HTMLButtonElement>('button.pos-disclosure');

  it('I1: equal units (g item, g stock) read "the amount sold", never a converted 1; a piece item shows the amount in the stock unit', async () => {
    const { api } = server({ stock: [pot()] });
    await renderForm(api, item({ sale_unit: 'g', stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 1 }] }));
    expect(fold()?.textContent).toBe(`${t('item.fold_title')} · ${fill(t('item.fold_draw_same'), { stock: 'Karahi pot' })}`);
    expect(fold()?.textContent).not.toContain('0.001');
    ui.unmount();
    ui = mount();
    await renderForm(api, item({ stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] }));
    expect(fold()?.textContent).toContain(fill(t('item.fold_draw'), { stock: 'Karahi pot', qty: '\u20660.5 kg\u2069' }));
  });

  it('I2: a fix link for a field inside the closed row opens the row, then focuses the field', async () => {
    const { api } = server();
    await renderForm(api, item());
    setValue(field('cook_minutes'), '');
    await save();
    expect(fold()?.getAttribute('aria-expanded')).toBe('true');
    await click(foldRow());
    expect(fold()?.getAttribute('aria-expanded')).toBe('false');
    const link = [...ui.container.querySelectorAll<HTMLButtonElement>('.pos-fixlinks__link')].find((b) => b.textContent?.includes(t('item.need_cook')));
    await click(link as HTMLElement);
    expect(fold()?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(q('#item-cook_minutes'));
  });

  it('m1: the "Not counted until Kept ready is on" note opens the row and moves to the Kept ready switch', async () => {
    const { api } = server({ stock: [pot()] });
    await renderForm(api, item({ stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] }));
    expect(fold()?.getAttribute('aria-expanded')).toBe('false');
    await click(button(q('[data-needs-ready]') as HTMLElement, t('item.show_kept_ready')));
    expect(fold()?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(section('stock')?.querySelector('[role="switch"]'));
  });
});

describe('01c P1: reference error keys', () => {
  it('422 unit_mismatch at stock_draws.0.stock_item_id marks the stock field with errors.reference.unit_mismatch', async () => {
    const { api } = server({
      stock: [pot()],
      on: (call) =>
        call.method === 'PATCH' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'stock_draws.0.stock_item_id', reason: 'unit_mismatch' }) : undefined,
    });
    await renderForm(api, item({ stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] }));
    setValue(field('uses'), '1');
    await save();
    expect(q('#item-stock_item_id')?.closest('.pos-field')?.textContent).toContain(t('errors.reference.unit_mismatch'));
    expect(q('#item-stock_item_id')?.closest('.pos-field')?.textContent).not.toContain(t('errors.reference.unit_mismatch_stock'));
    expect(ui.container.querySelectorAll('.pos-banner--danger')).toHaveLength(1);
  });
});

describe('01c-S01 review fixes', () => {
  it('[01c A2] a linked stock item with Kept ready off says it is not counted yet; Kept ready on removes the note', async () => {
    const { api } = server({ stock: [pot()] });
    await renderForm(api, item({ stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] }));
    expect(q('[data-needs-ready]')?.textContent).toBe(`${t('item.stock_needs_ready')} ${t('item.show_kept_ready')}`);
    expect(section('draw')?.textContent).not.toContain('Counted each morning');
    await click(section('stock')?.querySelector('[role="switch"]') as HTMLElement);
    expect(q('[data-needs-ready]')).toBeNull();
  });

  it('CONFIG_IN_USE for another kind of user shows the generic banner, not an empty dialog', async () => {
    const { api } = server({
      on: (call) =>
        call.method === 'PATCH' ? fail(409, 'CONFIG_IN_USE', { entity: 'menu_item', used_by: { entity: 'variant_group', ids: ['VG1'] } }) : undefined,
    });
    await renderForm(api, item());
    setValue(field('name'), 'Paneer');
    await save();
    expect(q('[data-in-use]')).toBeNull();
    expect(q('.pos-banner--danger')?.textContent).toContain(t('errors.CONFIG_IN_USE'));
  });

  it('Cancel after a lost create keeps its key: reopening replays the 201 instead of name-taken', async () => {
    let lost = false;
    const { api, calls } = server({ lose: (call) => call.method === 'POST' && call.url === '/v1/admin/stock-items' && !lost && (lost = true) });
    await renderForm(api, item());
    await click(button(section('draw') as HTMLElement, t('item.create_stock')));
    await click(button(q('[data-mini]') as HTMLElement, t('item.create_link')));
    await click(button(q('[data-mini]') as HTMLElement, t('owner.common.cancel')));
    await click(button(section('draw') as HTMLElement, t('item.create_stock')));
    await click(button(q('[data-mini]') as HTMLElement, t('item.create_link')));
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]?.key).toBe(posts[0]?.key);
    expect(ui.container.textContent).not.toContain(t('errors.CONFIG_NAME_TAKEN'));
    expect(field<HTMLSelectElement>('stock_item_id')?.value).toBe('K9');
  });
});

describe('01c-S01 Create a stock item with this name', () => {
  it('opens inline, disables Save item, waits for uses when units differ, then runs the 3 calls in order', async () => {
    const { api, calls } = server();
    await renderForm(api, item({ variant_group_id: 'VG1', variant_name: 'Half' }));
    await click(button(section('draw') as HTMLElement, t('item.create_stock')));
    const mini = () => q<HTMLElement>('[data-mini]');
    expect(field<HTMLInputElement>('mini_name')?.value).toBe('Chicken Karahi');
    expect(saveButton().disabled).toBe(true);
    expect(field('mini_uses')).toBeNull();

    await click(button(mini() as HTMLElement, 'g'));
    const create = button(mini() as HTMLElement, t('item.create_link'));
    expect(create.disabled).toBe(true);
    setValue(field('mini_uses'), '0.5');
    expect(create.disabled).toBe(false);

    calls.length = 0;
    await click(create);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /v1/admin/stock-items',
      'GET /v1/admin/stock-items',
      'PUT /v1/admin/stock-items/K9/branches/B1',
      'PATCH /v1/admin/menu-items/I1',
      'GET /v1/admin/stock-items',
    ]);
    expect(calls[0]?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(calls[0]?.body).toEqual({ name: 'Chicken Karahi', stock_unit: 'g', carries_over: false });
    expect(calls[2]?.body).toEqual({ expected_version: 'B1-none', station_id: 'S1', low_stock_threshold: null });
    expect(calls[3]?.body).toEqual({ stock_draws: [{ stock_item_id: 'K9', quantity_per_sale_unit: 500 }] });
    expect(mini()).toBeNull();
    expect(field<HTMLSelectElement>('stock_item_id')?.value).toBe('K9');
    expect(saveButton().disabled).toBe(false);
  });

  it('[01c §10 #124] a lost POST is retried with the same key (replayed 201); a PUT whose answer was lost is skipped after the re-read', async () => {
    let lostPost = false;
    let lostPut = false;
    const { api, calls } = server({
      lose: (call) => {
        if (call.method === 'POST' && call.url === '/v1/admin/stock-items' && !lostPost) return (lostPost = true);
        if (call.method === 'PUT' && call.url.endsWith('/branches/B1') && !lostPut) return (lostPut = true);
        return false;
      },
    });
    await ui.render(
      <ItemForm
        api={api}
        item={item({ routes: ['B1', 'B2'].map((b) => ({ branch_id: b, station_id: 'S1', program_id: null, stock_program_id: null, price_minor_override: null })) })}
        taxClasses={TAXES}
        categories={CATEGORIES}
        branchIds={['B1', 'B2']}
        variantGroups={GROUPS}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    );
    await flush();
    await click(button(section('draw') as HTMLElement, t('item.create_stock')));
    const mini = () => q<HTMLElement>('[data-mini]') as HTMLElement;
    await click(button(mini(), 'g'));
    setValue(field('mini_uses'), '0.5');

    // 1. The POST's answer is lost: the mini-form stays; Create and link again sends the same key.
    await click(button(mini(), t('item.create_link')));
    expect(mini()).not.toBeNull();
    await click(button(mini(), t('item.create_link')));
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]?.key).toBe(posts[0]?.key);

    // 2. The B1 PUT's answer is lost: the part-way banner with Finish linking.
    const banner = () => q<HTMLElement>('[data-partway]');
    expect(banner()?.textContent).toContain(t('item.partway'));
    expect(banner()?.textContent).toContain(fill(t('item.partway_body'), { name: 'Chicken Karahi — Half' }));
    expect(q('[data-mini]')).toBeNull();
    const before = calls.length;
    await click(button(banner() as HTMLElement, t('item.finish_linking')));

    // The retry re-reads §6.6, skips B1 (already counted there), PUTs only B2 with the version just read, then links.
    const retry = calls.slice(before).map((c) => `${c.method} ${c.url}`);
    expect(retry.slice(0, 3)).toEqual([
      'GET /v1/admin/stock-items',
      'PUT /v1/admin/stock-items/K9/branches/B2',
      'PATCH /v1/admin/menu-items/I1',
    ]);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    expect(calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/B1'))).toHaveLength(1);
    expect(ui.container.textContent).not.toContain(t('stale.title'));
    expect(ui.container.textContent).not.toContain(t('errors.CONFIG_NAME_TAKEN'));
    expect(banner()).toBeNull();
    expect(field<HTMLSelectElement>('stock_item_id')?.value).toBe('K9');
  });
});

describe('01a-S05 menu list with size groups (01c Q12) and the 01c-S09 links', () => {
  function menuServer(items: MenuItem[]) {
    return server({
      stock: [pot()],
      on: (call) =>
        call.method === 'GET' && call.url.startsWith('/v1/admin/menu')
          ? ok({ can_edit_tenant: true, tax_classes: TAXES, categories: CATEGORIES, variant_groups: GROUPS, items, next_cursor: null })
          : undefined,
    });
  }
  const half = item({ variant_group_id: 'VG1', variant_name: 'Half', stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }] });
  const naan = item({ item_id: 'I3', name: 'Naan', category_id: 'C2' });
  const full = item({ item_id: 'I2', name: 'Chicken Karahi — Full', variant_group_id: 'VG1', variant_name: 'Full' });

  it('nests the sizes under their size group row (Open → the size group), each size named by its size', async () => {
    window.location.hash = '#/menu';
    const { api } = menuServer([half, naan, full]);
    await ui.render(<MenuView api={api} />);
    await flush();
    const rows = [...ui.container.querySelectorAll('.pos-list__row')];
    expect(rows.map((r) => r.className.includes('--group') ? 'group' : r.className.includes('--size') ? 'size' : 'item')).toEqual([
      'group',
      'size',
      'size',
      'item',
    ]);
    expect(rows[0]?.textContent).toContain('Chicken Karahi');
    expect(rows[0]?.textContent).toContain(fill(t('menu.size_group_sub'), { n: '2' }));
    expect(rows[0]?.querySelector('a')?.getAttribute('href')).toBe('#/size-groups/VG1');
    expect(rows[1]?.querySelector('strong')?.textContent).toBe('Half');
    expect(rows[1]?.textContent).toContain(fill(t('size_group.draws'), { qty: '0.5 kg', stock: 'Karahi pot' }));
    expect(rows[3]?.querySelector('strong')?.textContent).toBe('Naan');
  });

  it('#/menu?item=<id> opens that item; #/menu?new_size_of=<group> opens a new size of it; Cancel goes back to #/menu', async () => {
    window.location.hash = '#/menu?item=I2';
    const { api } = menuServer([half, full]);
    await ui.render(<MenuView api={api} />);
    await flush();
    expect(field<HTMLInputElement>('name')?.value).toBe('Chicken Karahi — Full');
    await click(button(ui.container, t('owner.common.cancel')));
    expect(window.location.hash).toBe('#/menu');
    await flush();
    expect(field('variant_group_id')).toBeNull();

    window.location.hash = '#/menu?new_size_of=VG1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flush();
    expect(field<HTMLSelectElement>('variant_group_id')?.value).toBe('VG1');
    expect(field<HTMLSelectElement>('category_id')?.value).toBe('C1');
    expect(field<HTMLInputElement>('name')?.value).toBe('');
  });
});
