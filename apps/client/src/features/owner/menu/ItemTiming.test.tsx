import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Category, MenuItem } from '../../../api/cloud-admin';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { button, click, fail, fakeApi, flush, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { GuardProvider } from '../guard';
import { CategoryForm } from './CategoryForm';
import { ItemForm } from './ItemForm';
import { KNOBS, rangeText } from './timing';

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
    stock_time_ms: null, out_of_stock_behaviour: 'cook_fresh', sale_unit: 'piece', requires_weighing: false, is_ready_item: false,
    stock_draws: [], availability_windows: [], weight_pct: 100, max_early_ms: 60_000, max_carry_ms: null,
    max_late_ms: null, adjust_time_ms: 180_000, max_delay_ms: null, max_delay_unlimited: false, goes_with: [], archived_at: null, routes: [], ...extra,
  };
}
const link = (target_kind: 'category' | 'item', target_id: string, excluded = false) => ({
  source_kind: 'item' as const, source_id: 'I1', target_kind, target_id, excluded,
});
const ITEMS = [dish('I1', 'Chicken Karahi'), dish('I2', 'Naan'), dish('I3', 'Raita'), dish('I4', 'Old curry', { archived_at: 5 })];

// The menu read answers active and archived rows apart (loadEveryItem); `menuFails` loses it.
function server(on?: (call: Call) => Response | undefined, menuFails = false) {
  return fakeApi((call) => {
    const answer = on?.(call);
    if (answer !== undefined) return answer;
    if (call.url.startsWith('/v1/admin/menu?') || call.url === '/v1/admin/menu') {
      if (menuFails) return fail(500, 'INTERNAL');
      const archived = call.url.includes('status=archived');
      return ok({
        can_edit_tenant: true, tax_classes: [], categories: CATEGORIES, variant_groups: [],
        items: ITEMS.filter((i) => (i.archived_at !== null) === archived), next_cursor: null,
      });
    }
    if (call.url.endsWith('/stations')) return ok({ stations: [] });
    if (call.url.startsWith('/v1/admin/stock-items')) return ok({ can_edit_tenant: true, stock_items: [] });
    if (call.url.startsWith('/v1/admin/categories')) return ok({ category: cat('C1', 'Karahi') });
    if (call.method === 'PATCH') return ok({ item: ITEMS[0] });
    return new Response(JSON.stringify({ data: { item: ITEMS[0] } }), { status: 201 });
  });
}

async function renderCategory(api: ReturnType<typeof fakeApi>['api'], category: Category) {
  await ui.render(
    <GuardProvider>
      <CategoryForm api={api} category={category} categories={CATEGORIES} onSaved={() => {}} onCancel={() => {}} />
    </GuardProvider>,
  );
  await flush();
}

async function renderItem(api: ReturnType<typeof fakeApi>['api'], item: MenuItem | null) {
  await ui.render(
    <GuardProvider>
      <ItemForm api={api} item={item} taxClasses={[]} categories={CATEGORIES} branchIds={['B1']} onSaved={() => {}} onCancel={() => {}} />
    </GuardProvider>,
  );
  await flush();
}
const q = <T extends Element>(sel: string) => ui.container.querySelector<T>(sel);
const field = (name: string) => q<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
const patches = (calls: Call[]) => calls.filter((c) => c.method === 'PATCH').map((c) => c.body as Record<string, unknown>);

describe('owner item Timing group and goes-with', () => {
  it('[01a §8.1] a save with something to fix brings the summary into view (Save is in the bar over a long form)', async () => {
    const seen: Element[] = [];
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = function (this: Element) {
      seen.push(this);
    };
    const { api } = server();
    await renderItem(api, dish('I1', 'Chicken Karahi'));
    setValue(field('weight_pct'), '5');
    await click(button(ui.container, t('item.save')));
    expect(seen.at(-1)).toBe(q('.pos-banner--danger[role="alert"]'));
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

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

  it.each([
    ['weight_pct', '5', () => t('item.timing.need_pct')],
    ['max_early_minutes', '61', () => rangeText(KNOBS[0]!)],
    ['max_carry_minutes', '11', () => rangeText(KNOBS[1]!)],
    ['max_late_minutes', '121', () => rangeText(KNOBS[2]!)],
    ['adjust_time_minutes', '61', () => rangeText(KNOBS[3]!)],
  ])('[01a A-11] %s outside its range is refused before sending', async (name, value, message) => {
    const { api, calls } = server();
    await renderItem(api, dish('I1', 'Chicken Karahi'));
    setValue(field(name), value);
    await click(button(ui.container, t('item.save')));
    expect(patches(calls)).toEqual([]);
    expect(q(`#item-${name}`)!.closest('label')!.textContent).toContain(message());
  });

  it('[01a A-11] a time left as stored keeps its exact ms; clearing max_late sends null', async () => {
    const { api, calls } = server();
    await renderItem(api, dish('I1', 'Chicken Karahi', { max_early_ms: 61_234, max_late_ms: 300_000 }));
    setValue(field('max_late_minutes'), '');
    await click(button(ui.container, t('item.save')));
    expect(patches(calls)).toEqual([{ max_late_ms: null }]);
  });

  // 01a v2.7.5 §8.1 MD-6, #205 (STAB-7; re-review F-1): Max delay next to "Can be ready early by"; empty = the
  // branch default (its current value shown), 1–30 minutes, or "No limit (priority after 30 min)".
  const settings = (max_delay_default_ms: number | null) => (call: Call) =>
    call.url === '/v1/admin/branches/B1/settings' ? ok({ branch: { branch_id: 'B1', max_delay_default_ms, version: 'v1' } }) : undefined;
  const noLimit = () => q<HTMLButtonElement>('[data-field="max_delay"] [role="switch"]')!;

  it('[01a v2.7.5 #205] Max delay sits next to "Can be ready early by"; empty shows "Branch default (5 min)" from the branch settings', async () => {
    const { api } = server(settings(300_000));
    await renderItem(api, dish('I1', 'Chicken Karahi'));
    const early = q('#item-max_early_minutes')!.closest('label')!;
    const delay = q('#item-max_delay_minutes')!.closest('label')!;
    expect(early.nextElementSibling).toBe(delay.closest('[data-field="max_delay"]') ?? delay);
    expect((field('max_delay_minutes') as HTMLInputElement).value).toBe('');
    expect((field('max_delay_minutes') as HTMLInputElement).placeholder).toBe(fill(t('item.timing.max_delay_default'), { n: '5' }));
    expect(q('[data-field="max_delay"]')!.textContent).toContain(t('timing.max_delay_no_limit'));
    expect(noLimit().getAttribute('aria-checked')).toBe('false');
  });

  it('[01a v2.7.5 #205] saving 10 sends max_delay_ms 600 000; 30 is accepted; 0 and 31 are refused before sending', async () => {
    const { api, calls } = server(settings(300_000));
    await renderItem(api, dish('I1', 'Chicken Karahi'));
    for (const typed of ['0', '31']) {
      setValue(field('max_delay_minutes'), typed);
      await click(button(ui.container, t('item.save')));
      expect(patches(calls), typed).toEqual([]);
    }
    setValue(field('max_delay_minutes'), '30');
    await click(button(ui.container, t('item.save')));
    expect(patches(calls)).toEqual([{ max_delay_ms: 1_800_000 }]);
  });

  it('[01a v2.7.5 #205] "No limit" sends max_delay_unlimited true with max_delay_ms null; a new item posts 10 min as 600 000', async () => {
    const { api, calls } = server(settings(null));
    await renderItem(api, dish('I1', 'Chicken Karahi', { max_delay_ms: 600_000 }));
    expect((field('max_delay_minutes') as HTMLInputElement).value).toBe('10');
    await click(noLimit());
    await click(button(ui.container, t('item.save')));
    expect(patches(calls)).toEqual([{ max_delay_ms: null, max_delay_unlimited: true }]);
  });

  it('[01a v2.7.5 #205] a new item posts the typed max delay; an item stored as "No limit" shows the switch on', async () => {
    const { api, calls } = server(settings(300_000));
    await renderItem(api, null);
    setValue(field('name'), 'Daal');
    setValue(field('price'), '300');
    setValue(field('cook_minutes'), '10');
    setValue(field('max_delay_minutes'), '10');
    await click(button(ui.container, t('item.add')));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ max_delay_ms: 600_000, max_delay_unlimited: false });
    ui.unmount();
    ui = mount();
    const again = server(settings(300_000));
    await renderItem(again.api, dish('I1', 'Chicken Karahi', { max_delay_unlimited: true }));
    expect(noLimit().getAttribute('aria-checked')).toBe('true');
    expect((field('max_delay_minutes') as HTMLInputElement).disabled).toBe(true);
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

  it('[01a A-13] the item picker offers the whole menu, adds targets, and drops only a known-archived one', async () => {
    const { api, calls } = server();
    await renderItem(
      api,
      dish('I1', 'Chicken Karahi', { goes_with: [link('category', 'C3'), link('item', 'I4'), link('item', 'I3', true)] }),
    );
    const picker = q<HTMLElement>('[data-section="goes-with"]')!;
    expect(picker.querySelector('[data-goes-with="category:C3"]')).toBeNull();
    expect(picker.querySelector('[data-goes-with="item:I4"]')).toBeNull();
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

  it('[01a A-13] a target the menu read did not return stays, with its exclude, after an add', async () => {
    const { api, calls } = server();
    await renderItem(api, dish('I1', 'Chicken Karahi', { goes_with: [link('item', 'I77', true), link('category', 'C88')] }));
    expect(q('[data-goes-with="item:I77"]')).not.toBeNull();
    setValue(field('goes_with_add'), 'item:I2');
    await click(button(ui.container, t('item.save')));
    expect(patches(calls)).toEqual([
      {
        goes_with: [
          { target_kind: 'item', target_id: 'I77', excluded: true },
          { target_kind: 'category', target_id: 'C88', excluded: false },
          { target_kind: 'item', target_id: 'I2', excluded: false },
        ],
      },
    ]);
  });

  it('[01a A-13] an unrelated edit with stored links sends no goes_with', async () => {
    const { api, calls } = server();
    await renderItem(api, dish('I1', 'Chicken Karahi', { goes_with: [link('item', 'I77', true), link('item', 'I4')] }));
    setValue(field('weight_pct'), '120');
    await click(button(ui.container, t('item.save')));
    expect(patches(calls)).toEqual([{ weight_pct: 120 }]);
  });

  it('[01a A-13] a failed menu read disables the picker and sends no goes_with', async () => {
    const { api, calls } = server(undefined, true);
    await renderItem(api, dish('I1', 'Chicken Karahi', { goes_with: [link('item', 'I77', true)] }));
    expect(field('goes_with_add')!.disabled).toBe(true);
    setValue(field('weight_pct'), '120');
    await click(button(ui.container, t('item.save')));
    expect(patches(calls)).toEqual([{ weight_pct: 120 }]);
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
    await renderCategory(api, category);
    const picker = q<HTMLElement>('[data-section="goes-with"]')!;
    expect([...(field('goes_with_add') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'category:C2', 'item:I1', 'item:I2', 'item:I3']);
    setValue(field('goes_with_add'), 'item:I2');
    expect(picker.querySelector('[role="checkbox"]')).toBeNull();
    await click(button(ui.container, t('owner.category.save')));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      goes_with: [{ target_kind: 'item', target_id: 'I2', excluded: false }],
    });
  });

  it('[01a A-13] a category save that changes only the name sends no goes_with, even when the menu read finishes meanwhile', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { api, calls } = fakeApi(async (call) => {
      if (call.url.startsWith('/v1/admin/menu')) {
        await gate;
        return ok({ can_edit_tenant: true, tax_classes: [], categories: CATEGORIES, variant_groups: [], items: call.url.includes('archived') ? [] : ITEMS, next_cursor: null });
      }
      return ok({ category: cat('C1', 'Karahi') });
    });
    const stored = { source_kind: 'category' as const, source_id: 'C1', target_kind: 'item' as const, target_id: 'I77', excluded: false };
    await renderCategory(api, cat('C1', 'Karahi', { goes_with: [stored] }));
    expect(field('goes_with_add')!.disabled).toBe(true);
    release();
    await flush();
    setValue(field('name'), 'Karahi 2');
    await click(button(ui.container, t('owner.category.save')));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ name: 'Karahi 2' });
  });

  it('[01a A-13] a failed menu read says so on the picker instead of "Reading the menu…"', async () => {
    const { api } = server(undefined, true);
    await renderItem(api, dish('I1', 'Chicken Karahi'));
    const section = q<HTMLElement>('[data-section="goes-with"]')!;
    expect(section.textContent).toContain(t('goeswith.failed'));
    expect(section.textContent).not.toContain(t('goeswith.loading'));
  });

  it('[01a A-13] the menu read follows next_cursor: a target on page 2 is offered', async () => {
    const { api, calls } = fakeApi((call) => {
      if (call.url.startsWith('/v1/admin/menu')) {
        const archived = call.url.includes('status=archived');
        const second = call.url.includes('cursor=P2');
        const items = archived ? [] : second ? [dish('I9', 'Page two dish')] : [dish('I1', 'Chicken Karahi')];
        return ok({ can_edit_tenant: true, tax_classes: [], categories: CATEGORIES, variant_groups: [], items, next_cursor: !archived && !second ? 'P2' : null });
      }
      return ok({ item: ITEMS[0] });
    });
    await renderItem(api, dish('I1', 'Chicken Karahi'));
    expect([...(field('goes_with_add') as HTMLSelectElement).options].map((o) => o.value)).toContain('item:I9');
    expect(calls.filter((c) => c.url.startsWith('/v1/admin/menu') && !c.url.includes('archived'))).toHaveLength(2);
  });

  it('[01a A-13] a category name edited before the menu read finishes is saved, and no goes_with is sent', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { api, calls } = fakeApi(async (call) => {
      if (call.url.startsWith('/v1/admin/menu')) {
        await gate;
        return ok({ can_edit_tenant: true, tax_classes: [], categories: CATEGORIES, variant_groups: [], items: call.url.includes('archived') ? [] : ITEMS, next_cursor: null });
      }
      return ok({ category: cat('C1', 'Karahi') });
    });
    const stored = { source_kind: 'category' as const, source_id: 'C1', target_kind: 'item' as const, target_id: 'I77', excluded: false };
    await renderCategory(api, cat('C1', 'Karahi', { goes_with: [stored] }));
    setValue(field('name'), 'Karahi 2');
    release();
    await flush();
    expect((field('name') as HTMLInputElement).value).toBe('Karahi 2');
    await click(button(ui.container, t('owner.category.save')));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ name: 'Karahi 2' });
  });
});
