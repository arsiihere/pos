import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Category, MenuItem } from '../../../api/cloud-admin';
import { t } from '../../../i18n';
import { button, click, fail, fakeApi, flush, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { GuardProvider } from '../guard';
import { CategoryForm } from './CategoryForm';
import { ItemForm } from './ItemForm';

// 01a v2.1 §8.1 (A-11, A-13): the item form's "Timing" group and the goes-with picker on item and category.

let ui: Mounted;
beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  ui = mount();
});
afterEach(() => {
  ui.unmount();
  sessionStorage.clear();
});

const cat = (id: string, name: string, extra: Partial<Category> = {}): Category => ({
  category_id: id, name, sort_order: 0, archived_at: null, availability_windows: [], goes_with: [], ...extra,
});
const CATEGORIES = [cat('C1', 'Karahi'), cat('C2', 'Drinks'), cat('C3', 'Old specials', { archived_at: 5 })];

function dish(id: string, name: string, extra: Partial<MenuItem> = {}): MenuItem {
  return {
    item_id: id, category_id: 'C1', tax_class_id: null, name, variant_group_id: null, variant_name: null, description: null,
    sort_order: 0, price_minor: 115_000, serve_mode: 'immediate', prep_buffer_ms: 0, cook_time_ms: 600_000,
    stock_time_ms: null, out_of_stock_behaviour: 'cook_fresh', sale_unit: 'piece', requires_weighing: false,
    stock_draws: [], availability_windows: [], weight_pct: 100, max_early_ms: 60_000, max_carry_ms: null,
    max_late_ms: null, adjust_time_ms: 180_000, goes_with: [], archived_at: null, routes: [], ...extra,
  };
}
const link = (target_kind: 'category' | 'item', target_id: string, excluded = false) => ({
  source_kind: 'item' as const, source_id: 'I1', target_kind, target_id, excluded,
});
const ITEMS = [dish('I1', 'Chicken Karahi'), dish('I2', 'Naan'), dish('I3', 'Raita'), dish('I4', 'Old curry', { archived_at: 5 })];

function server(on?: (call: Call) => Response | undefined) {
  return fakeApi((call) => {
    const answer = on?.(call);
    if (answer !== undefined) return answer;
    if (call.url.endsWith('/stations')) return ok({ stations: [] });
    if (call.url.startsWith('/v1/admin/stock-items')) return ok({ can_edit_tenant: true, stock_items: [] });
    if (call.url.startsWith('/v1/admin/categories')) return ok({ category: cat('C1', 'Karahi') });
    if (call.method === 'PATCH') return ok({ item: ITEMS[0] });
    return new Response(JSON.stringify({ data: { item: ITEMS[0] } }), { status: 201 });
  });
}

async function renderItem(api: ReturnType<typeof fakeApi>['api'], item: MenuItem | null) {
  await ui.render(
    <GuardProvider>
      <ItemForm api={api} item={item} taxClasses={[]} categories={CATEGORIES} items={ITEMS} branchIds={['B1']} onSaved={() => {}} onCancel={() => {}} />
    </GuardProvider>,
  );
  await flush();
}
const q = <T extends Element>(sel: string) => ui.container.querySelector<T>(sel);
const field = (name: string) => q<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
const patches = (calls: Call[]) => calls.filter((c) => c.method === 'PATCH').map((c) => c.body as Record<string, unknown>);

describe('owner item Timing group and goes-with', () => {
  it('[01a A-11] the Timing group shows the five knobs, minutes for the times', async () => {
    const { api } = server();
    await renderItem(api, dish('I1', 'Chicken Karahi', { weight_pct: 150, max_early_ms: 120_000, max_carry_ms: 300_000, max_late_ms: null, adjust_time_ms: 45_000 }));
    const group = q<HTMLElement>('[data-section="timing"]')!;
    expect(group.textContent).toContain(t('item.timing'));
    expect((field('weight_pct') as HTMLInputElement).value).toBe('150');
    expect((field('max_early_minutes') as HTMLInputElement).value).toBe('2');
    expect((field('max_carry_minutes') as HTMLInputElement).value).toBe('5');
    expect((field('max_late_minutes') as HTMLInputElement).value).toBe('');
    expect((field('adjust_time_minutes') as HTMLInputElement).value).toBe('0.75');
  });

  it('[01a A-11] editing the knobs PATCHes minutes as ms; an emptied carry or late box sends null', async () => {
    const { api, calls } = server();
    await renderItem(api, dish('I1', 'Chicken Karahi', { max_carry_ms: 300_000, max_late_ms: 600_000 }));
    setValue(field('weight_pct'), '250');
    setValue(field('max_early_minutes'), '0');
    setValue(field('max_carry_minutes'), '');
    setValue(field('max_late_minutes'), '7.5');
    setValue(field('adjust_time_minutes'), '2');
    await click(button(ui.container, t('item.save')));
    expect(patches(calls)).toEqual([
      { weight_pct: 250, max_early_ms: 0, max_carry_ms: null, max_late_ms: 450_000, adjust_time_ms: 120_000 },
    ]);
  });

  it('[01a A-11] a knob outside its range is refused before sending', async () => {
    const { api, calls } = server();
    await renderItem(api, dish('I1', 'Chicken Karahi'));
    setValue(field('weight_pct'), '5');
    setValue(field('max_carry_minutes'), '11');
    await click(button(ui.container, t('item.save')));
    expect(patches(calls)).toEqual([]);
    expect(ui.container.textContent).toContain(t('item.timing.need_pct'));
  });

  it('[01a A-11] a new item POSTs the five knobs and offers no goes-with picker', async () => {
    const { api, calls } = server();
    await renderItem(api, null);
    expect((field('weight_pct') as HTMLInputElement).value).toBe('100');
    expect(q('[data-section="goes-with"]')).toBeNull();
    setValue(field('name'), 'Daal');
    setValue(field('price'), '300');
    setValue(field('cook_minutes'), '10');
    setValue(field('max_late_minutes'), '5');
    await click(button(ui.container, t('item.add')));
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body).toMatchObject({ weight_pct: 100, max_early_ms: 60_000, max_carry_ms: null, max_late_ms: 300_000, adjust_time_ms: 180_000 });
    expect(body).not.toHaveProperty('goes_with');
  });

  it('[01a A-13] the item picker adds category and item targets, marks an exclude, and drops archived targets on save', async () => {
    const { api, calls } = server();
    await renderItem(
      api,
      dish('I1', 'Chicken Karahi', { goes_with: [link('category', 'C3'), link('item', 'I4'), link('item', 'I3', true)] }),
    );
    const picker = q<HTMLElement>('[data-section="goes-with"]')!;
    // Archived targets are not shown; the self item and archived ones are not offered.
    expect(picker.querySelector('[data-goes-with="category:C3"]')).toBeNull();
    expect(picker.querySelector('[data-goes-with="item:I3"]')).not.toBeNull();
    const offered = [...(field('goes_with_add') as HTMLSelectElement).options].map((o) => o.value);
    expect(offered).toEqual(['', 'category:C1', 'category:C2', 'item:I2']);
    setValue(field('goes_with_add'), 'category:C2');
    setValue(field('goes_with_add'), 'item:I2');
    await click(picker.querySelector<HTMLButtonElement>('[data-goes-with="item:I2"] [role="checkbox"]')!);
    await click(button(ui.container, t('item.save')));
    expect(patches(calls)).toEqual([
      {
        goes_with: [
          { target_kind: 'item', target_id: 'I3', excluded: true },
          { target_kind: 'category', target_id: 'C2', excluded: false },
          { target_kind: 'item', target_id: 'I2', excluded: true },
        ],
      },
    ]);
  });

  it('[01a A-13] a 422 on goes_with shows under the picker', async () => {
    const { api } = server((call) => (call.method === 'PATCH' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'goes_with' }) : undefined));
    await renderItem(api, dish('I1', 'Chicken Karahi'));
    setValue(field('goes_with_add'), 'item:I2');
    await click(button(ui.container, t('item.save')));
    expect(q('[data-section="goes-with"]')!.textContent).toContain(t('goeswith.field_error'));
  });

  it('[01a A-13] the category picker adds targets but has no "Never suggest"', async () => {
    const { api, calls } = server();
    const category = cat('C1', 'Karahi', {
      goes_with: [{ source_kind: 'category', source_id: 'C1', target_kind: 'category', target_id: 'C3', excluded: false }],
    });
    await ui.render(
      <GuardProvider>
        <CategoryForm api={api} category={category} categories={CATEGORIES} items={ITEMS} onSaved={() => {}} onCancel={() => {}} />
      </GuardProvider>,
    );
    await flush();
    const picker = q<HTMLElement>('[data-section="goes-with"]')!;
    expect([...(field('goes_with_add') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'category:C2', 'item:I1', 'item:I2', 'item:I3']);
    setValue(field('goes_with_add'), 'item:I2');
    expect(picker.querySelector('[role="checkbox"]')).toBeNull();
    await click(button(ui.container, t('owner.category.save')));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      goes_with: [{ target_kind: 'item', target_id: 'I2', excluded: false }],
    });
  });
});
