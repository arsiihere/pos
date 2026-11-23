import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import todo08b from '../../../../../../docs/design/handoff/08b/urdu-todo.md?raw';
import type { CloudAdmin } from '../../../api/cloud-admin';
import { en } from '../../../i18n/en';
import { BranchNames } from '../branch';
import { ChoiceGroupForm } from '../choice-groups/ChoiceGroupForm';
import { GuardProvider } from '../guard';
import { ItemForm } from '../menu/ItemForm';
import { MenuView } from '../menu/MenuView';
import { StockItemForm } from '../stock-items/StockItemForm';
import { button, click, fail, fakeApi, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { RecipeEditor } from './RecipeEditor';
import { RecipeList } from './RecipeList';

// 08 v1.1 Part B §8, §10.5 (tests 29–32): the owner Recipes page, the editor, the menu page's "No recipe" badge (01c
// C-12) and the B17 refusal text in the 01c / 08a forms (AD-9). The cloud is a fake fetch at the CloudAdmin boundary
// (wire shapes of packages/events/src/admin/recipes.ts), as the other owner-view tests.
let m: Mounted;
const B1 = 'B-LAKE';
const B2 = 'B-JOHAR';
const BRANCHES = [B1, B2];
const NAMES = new Map([
  [B1, 'Lake City'],
  [B2, 'Johar Town'],
]);
const T0 = Date.UTC(2026, 10, 20, 9, 0);

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  window.location.hash = '#/recipes';
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
});

async function render(node: ReactNode) {
  await m.render(
    <GuardProvider>
      <BranchNames.Provider value={NAMES}>{node}</BranchNames.Provider>
    </GuardProvider>,
  );
}

const cost = (status: 'costed' | 'partial' | 'no_recipe', minor: string | null, unknown_items: string[] = []) => ({ status, minor, unknown_items });
const summary = (over: Record<string, unknown>) => ({
  recipe_id: 'R-TAWA',
  owner_type: 'menu_item',
  owner_id: 'I-TAWA',
  owner_name: 'Tawa piece',
  owner_archived: false,
  archived: false,
  has_draft: false,
  published: { recipe_version_id: 'RV1', version_no: 1, published_at: T0 },
  plate_cost: cost('costed', '41200'),
  version: 'r1',
  ...over,
});
const ROWS = [
  summary({}),
  summary({ recipe_id: 'R-KAR', owner_id: 'I-KAR', owner_name: 'Chicken karahi', plate_cost: cost('partial', '38000', ['SI-GHEE']) }),
  summary({ recipe_id: 'R-LASSI', owner_id: 'I-LASSI', owner_name: 'Lassi', has_draft: true, plate_cost: cost('partial', null, ['SI-MILK']) }),
  summary({ recipe_id: null, owner_id: 'I-NAAN', owner_name: 'Naan', published: null, plate_cost: cost('no_recipe', null), version: null }),
  summary({ recipe_id: 'R-SPICY', owner_type: 'modifier_option', owner_id: 'O-SPICY', owner_name: 'Spicy', plate_cost: cost('costed', '0') }),
  summary({ recipe_id: 'R-PAYE', owner_type: 'stock_item', owner_id: 'SI-PAYE', owner_name: 'PAYE-COOKED', archived: true, plate_cost: cost('no_recipe', null), version: 'r5' }),
];
const LIST = { can_edit_tenant: true, coverage: { items_total: 52, items_with_recipe: 38, pct_bp: 7307 }, rows: ROWS };

const rowOf = (ownerId: string) => m.container.querySelector<HTMLElement>(`[data-owner-id="${ownerId}"]`)!;
const plate = (ownerId: string) => rowOf(ownerId).querySelector('[data-plate-cost]')?.textContent;

describe('[08b §8.1] Recipes page', () => {
  it('[08b #29] coverage text, filters, plate cost texts (never "Rs 0" for a missing cost), groups; restore 422 new_draft → "Make a new recipe version"', async () => {
    let patchAnswer = fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'archived', reason: 'unit_changed', hint: 'new_draft' });
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'PATCH') return patchAnswer;
      if (call.url.startsWith('/v1/admin/recipes')) return ok(LIST);
      if (call.url === '/v1/admin/stock-items') return ok({ can_edit_tenant: true, stock_items: [{ stock_item_id: 'SI-GHEE', name: 'Ghee' }] });
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });
    await render(<RecipeList api={api} branchIds={BRANCHES} />);

    expect(m.container.querySelector('[data-coverage]')?.textContent).toBe('38 of 52 items have a recipe — 73 %');
    expect([...m.container.querySelectorAll('[data-group] h2')].map((h) => h.textContent)).toEqual(['Menu items', 'Options', 'Prepared']);
    expect(m.container.textContent).toContain('Plate cost (menu cost)');
    expect(plate('I-TAWA')).toBe('Rs 412');
    expect(plate('I-KAR')).toBe('Rs 380 · partial');
    // §7 risk (1): the unknown items always show, named from one stock-item read (an id not in it: generic words)
    expect(rowOf('I-KAR').querySelector('[data-missing-cost]')?.textContent?.trim()).toBe('Missing cost: Ghee');
    expect(rowOf('I-LASSI').querySelector('[data-missing-cost]')?.textContent?.trim()).toBe('Missing cost: an archived stock item');
    expect(rowOf('I-TAWA').querySelector('[data-missing-cost]')).toBeNull();
    expect(calls.filter((c) => c.url === '/v1/admin/stock-items')).toHaveLength(1);
    expect(plate('I-LASSI')).toBe('No cost yet · partial');
    expect(plate('I-NAAN')).toBe('No recipe');
    // A known 0 (an empty "Spicy" option, M-6) is a real cost; a missing one never reads as zero.
    expect(plate('O-SPICY')).toBe('Rs 0');
    for (const id of ['I-LASSI', 'I-NAAN', 'SI-PAYE']) expect(rowOf(id).textContent).not.toContain('Rs 0');
    expect(rowOf('I-TAWA').querySelector('a')?.getAttribute('href')).toBe('#/recipes/R-TAWA');

    // Filters are the §6.1 query; the branch picker is the costs' branch_id.
    expect(calls.find((c) => c.url.startsWith('/v1/admin/recipes'))?.url).toBe('/v1/admin/recipes');
    await click(button(m.container, 'Missing'));
    expect(calls.at(-1)?.url).toBe('/v1/admin/recipes?filter=missing');
    await click(button(m.container, 'Partial'));
    expect(calls.at(-1)?.url).toBe('/v1/admin/recipes?filter=partial');
    setValue(m.container.querySelector<HTMLSelectElement>('select[name="cost_branch"]'), B2);
    expect(calls.at(-1)?.url).toBe(`/v1/admin/recipes?branch_id=${B2}&filter=partial`);
    await click(button(m.container, 'All'));
    expect(calls.at(-1)?.url).toBe(`/v1/admin/recipes?branch_id=${B2}`);

    // Restore of an archived recipe whose old version cannot come back (N-1, T-1).
    await click(button(rowOf('SI-PAYE'), 'Restore'));
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', url: '/v1/admin/recipes/R-PAYE', body: { expected_version: 'r5', archived: false } });
    const refusal = rowOf('SI-PAYE').querySelector('[data-new-draft]');
    expect(refusal?.textContent).toContain('Make a new recipe version');
    // the restore wording has no "Save the draft again" (it cannot come back)
    expect(refusal?.textContent).toContain("This old version can't come back: a stock item it uses, or the item itself, is now counted in another unit");
    expect(refusal?.textContent).not.toContain('Save the draft again');
    expect(refusal?.querySelector('a')?.getAttribute('href')).toBe('#/recipes/R-PAYE');

    // a stale restore (changed in another tab) reads the list again
    patchAnswer = fail(409, 'CONFIG_STALE', { entity: 'recipe', id: 'R-PAYE' });
    const reads = calls.filter((c) => c.method === 'GET' && c.url.startsWith('/v1/admin/recipes')).length;
    await click(button(rowOf('SI-PAYE'), 'Restore'));
    expect(calls.filter((c) => c.method === 'GET' && c.url.startsWith('/v1/admin/recipes')).length).toBe(reads + 1);
    expect(m.container.querySelector('.pos-banner--danger')?.textContent).toContain('The list is read again');
  });

  it('[08b #29] a row with no recipe offers Create recipe (POST with an Idempotency-Key) and opens the new recipe', async () => {
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'POST') return ok({ recipe: summary({ recipe_id: 'R-NAAN', owner_id: 'I-NAAN' }), draft: {} });
      return ok(LIST);
    });
    await render(<RecipeList api={api} branchIds={BRANCHES} />);
    await click(button(rowOf('I-NAAN'), 'Create recipe'));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post).toMatchObject({ url: '/v1/admin/recipes', body: { owner_type: 'menu_item', owner_id: 'I-NAAN' } });
    expect(post.key).toMatch(/^[0-9A-Z]{26}$/);
    expect(window.location.hash).toBe('#/recipes/R-NAAN');
  });
});

// ------------------------------------------------------------------------------------------------- editor

const line = (over: Record<string, unknown>) => ({
  line_no: 1,
  stock_item_id: 'SI-BEEF',
  stock_item_name: 'Beef (raw)',
  kind: 'ingredient',
  unit_name: 'g',
  qty: '250',
  qty_basis: 'EP',
  line_cost: cost('costed', '52669'),
  ...over,
});
const version = (over: Record<string, unknown>) => ({
  recipe_version_id: 'RV2',
  version_no: 2,
  status: 'draft',
  basis: 'per_unit',
  base_qty: null,
  measure_unit: null,
  batch_yield_qty: null,
  batch_stock_unit: null,
  misc_allowance_bp: 500,
  lines: [line({}), line({ line_no: 2, stock_item_id: 'SI-TP1', stock_item_name: 'TP-1 packet', kind: 'packet', qty: '15', qty_basis: 'AP', line_cost: cost('costed', '30') })],
  cost: cost('costed', '55333'),
  warnings: [],
  created_by_name: 'Owner',
  published_by_name: null,
  published_at: null,
  version: 'v-draft-2',
  ...over,
});
const PUBLISHED = version({
  recipe_version_id: 'RV1',
  version_no: 1,
  status: 'published',
  published_by_name: 'Owner',
  published_at: T0,
  version: 'v-pub-1',
});
const DETAIL = {
  can_edit_tenant: true,
  recipe: summary({ has_draft: true }),
  draft: version({}),
  published: PUBLISHED,
  history: [
    { recipe_version_id: 'RV2', version_no: 2, status: 'draft', published_at: null, published_by_name: null },
    { recipe_version_id: 'RV1', version_no: 1, status: 'published', published_at: T0, published_by_name: 'Owner' },
  ],
};

const stockWire = (id: string, name: string, kind: string, stock_unit = 'g') => ({
  stock_item_id: id,
  name,
  stock_unit,
  carries_over: false,
  archived_at: null,
  kind,
  code: null,
  cost_category: 'food',
  is_a_item: false,
  version: 'v1',
});
const BUILTIN_G = [
  { unit_name: 'kg', base: 'g', num: 1000, den: 1 },
  { unit_name: 'pao', base: 'g', num: 250, den: 1 },
  { unit_name: 'maund', base: 'g', num: 40000, den: 1 },
  { unit_name: 'lb', base: 'g', num: 45359237, den: 100000 },
  { unit_name: 'oz', base: 'g', num: 45359237, den: 1600000 },
];
const unitRow = (unit_name: string, base_unit: string, factor_num: string, is_current = true) => ({
  unit_row_id: `U-${unit_name}-${base_unit}`,
  unit_name,
  base_unit,
  factor_num,
  factor_den: 1,
  is_current,
  note: null,
  recorded_by: 'O1',
  recorded_by_name: 'Owner',
  created_at: T0,
});
const menuCost = (num: string) => ({ branch_id: null, price_id: 'P', per_stock_unit: { num, den: '1' }, display_per: { unit: 'kg', minor: '0', below_one_minor: false } });
const yieldRow = { yield_profile_id: 'Y1', yield_bp: 7120, test_ap_qty: null, test_ep_qty: null, test_unit: null, note: null, recorded_by: 'O1', recorded_by_name: 'Owner', created_at: T0 };
const INVENTORY: Record<string, unknown> = {
  'SI-BEEF': {
    can_edit_tenant: true,
    stock_item: stockWire('SI-BEEF', 'Beef (raw)', 'ingredient'),
    builtin_units: BUILTIN_G,
    units: [unitRow('peti', 'g', '12000'), unitRow('box', 'piece', '6', false)],
    prices: [],
    menu_cost: menuCost('150'),
    yields: [yieldRow],
    active_yield: yieldRow,
  },
  'SI-TP1': {
    can_edit_tenant: true,
    stock_item: stockWire('SI-TP1', 'TP-1 packet', 'packet'),
    builtin_units: BUILTIN_G,
    units: [],
    prices: [],
    menu_cost: menuCost('2'),
    yields: [],
    active_yield: null,
  },
  'SI-ONION': {
    can_edit_tenant: true,
    stock_item: stockWire('SI-ONION', 'Onion', 'ingredient'),
    builtin_units: BUILTIN_G,
    units: [],
    prices: [],
    menu_cost: null,
    yields: [],
    active_yield: null,
  },
};
const STOCK_LIST = [
  { ...stockWire('SI-BEEF', 'Beef (raw)', 'ingredient'), branches: [], drawers: [], menu_cost: null },
  { ...stockWire('SI-TP1', 'TP-1 packet', 'packet'), branches: [], drawers: [], menu_cost: null },
  { ...stockWire('SI-ONION', 'Onion', 'ingredient'), branches: [], drawers: [], menu_cost: null },
  { ...stockWire('SI-PAYE', 'PAYE-COOKED', 'prepared', 'piece'), branches: [], drawers: [], menu_cost: null },
];

function editorHandler(detail: unknown, write: (call: Call) => Response | undefined = () => undefined) {
  return (call: Call): Response => {
    const written = call.method === 'GET' ? undefined : write(call);
    if (written !== undefined) return written;
    const inv = /^\/v1\/admin\/stock-items\/([^/?]+)\/inventory/.exec(call.url);
    if (inv !== null) {
      const found = INVENTORY[decodeURIComponent(inv[1]!)];
      return found === undefined ? fail(404, 'STOCK_ITEM_NOT_FOUND') : ok(found);
    }
    if (call.url.startsWith('/v1/admin/stock-items')) return ok({ can_edit_tenant: true, stock_items: STOCK_LIST });
    if (call.method === 'GET' && call.url.startsWith('/v1/admin/recipes/')) return ok(detail);
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}
const editor = (api: CloudAdmin, id = 'R-TAWA') => render(<RecipeEditor api={api} recipeId={id} branchIds={BRANCHES} />);
const lineRow = (id: string) => m.container.querySelector<HTMLElement>(`[data-line="${id}"]`)!;
const options = (select: HTMLSelectElement | null) => [...(select?.options ?? [])].map((o) => o.value);
const selectedText = (select: HTMLSelectElement | null) => select?.selectedOptions[0]?.textContent;

describe('[08b §8.2] Recipe editor', () => {
  it('[08b #30] owner header; unit pick-list of the units resolveUnit accepts; AP / EP shows the derived default', async () => {
    const { api } = fakeApi(editorHandler(DETAIL));
    await editor(api);
    expect(m.container.querySelector('[data-owner-header]')?.textContent).toContain('Tawa piece');
    expect(m.container.querySelector('[data-owner-header]')?.textContent).toContain('Menu item');

    // g item: the stock unit, its built-ins (with P-3's lb / oz) and its current g units — never a unit on another base.
    const unit = lineRow('SI-BEEF').querySelector<HTMLSelectElement>('select[name="unit"]');
    expect(options(unit).sort()).toEqual(['g', 'kg', 'lb', 'maund', 'oz', 'pao', 'peti']);
    // beef has an active yield → EP is the default (M-7); the packet → AP
    const beefBasis = lineRow('SI-BEEF').querySelector<HTMLSelectElement>('select[name="qty_basis"]');
    expect(beefBasis?.value).toBe('');
    expect(selectedText(beefBasis)).toBe('Default: EP');
    expect(selectedText(lineRow('SI-TP1').querySelector<HTMLSelectElement>('select[name="qty_basis"]'))).toBe('Default: AP');

    // An ingredient with no yield, added from the search across kinds, defaults to AP.
    setValue(m.container.querySelector<HTMLInputElement>('input[name="line_search"]'), 'o');
    const found = [...m.container.querySelectorAll('[data-add-stock]')].map((b) => b.getAttribute('data-add-stock'));
    expect(found).toEqual(['SI-ONION', 'SI-PAYE']);
    await click(m.container.querySelector<HTMLButtonElement>('[data-add-stock="SI-ONION"]')!);
    expect(selectedText(lineRow('SI-ONION').querySelector<HTMLSelectElement>('select[name="qty_basis"]'))).toBe('Default: AP');
  });

  it('[08b #30] live line cost and plate cost (menu cost) while typing; Save draft sends the derived basis as absent', async () => {
    const saved = version({ version: 'v-draft-3' });
    const { api, calls } = fakeApi(editorHandler(DETAIL, (call) => (call.method === 'PUT' ? ok({ draft: saved }) : undefined)));
    await editor(api);
    const plateCost = () => m.container.querySelector('[data-plate-cost]')?.textContent;
    const lineCost = (id: string) => lineRow(id).querySelector('[data-line-cost]')?.textContent;
    expect(plateCost()).toBe('Rs 553.33');
    expect(lineCost('SI-BEEF')).toBe('Rs 526.69');

    // 0.5 kg beef EP at Rs 150 / g menu cost ÷ 71.2 % yield; × 1.05 misc at the top (B5, B9; rounded once)
    setValue(lineRow('SI-BEEF').querySelector<HTMLInputElement>('input[name="qty"]'), '0.5');
    setValue(lineRow('SI-BEEF').querySelector<HTMLSelectElement>('select[name="unit"]'), 'kg');
    expect(lineCost('SI-BEEF')).toBe('Rs 1,053.37');
    expect(lineCost('SI-TP1')).toBe('Rs 0.30');
    expect(plateCost()).toBe('Rs 1,106.35');
    // EP on an item with no yield, or no menu cost, is unknown: partial, never Rs 0 (D9)
    setValue(m.container.querySelector<HTMLInputElement>('input[name="line_search"]'), 'oni');
    await click(m.container.querySelector<HTMLButtonElement>('[data-add-stock="SI-ONION"]')!);
    setValue(lineRow('SI-ONION').querySelector<HTMLInputElement>('input[name="qty"]'), '30');
    expect(lineCost('SI-ONION')).toBe('No cost yet');
    expect(plateCost()).toBe('Rs 1,106.35 · partial');
    expect(m.container.querySelector('[data-missing-cost]')?.textContent).toBe('Missing cost: Onion');
    // §7 risk (3): live per-line hints while editing (onion: no yield, no menu cost)
    expect([...lineRow('SI-ONION').querySelectorAll('[data-line-warning]')].map((w) => w.textContent)).toEqual([
      'Default: AP — no yield',
      'Onion: no menu cost yet, so the plate cost is partial.',
    ]);
    expect(lineRow('SI-BEEF').querySelector('[data-line-warning]')).toBeNull();
    setValue(lineRow('SI-TP1').querySelector<HTMLSelectElement>('select[name="qty_basis"]'), 'AP');

    await click(button(m.container, 'Save draft'));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/v1/admin/recipes/R-TAWA/draft');
    expect(put.body).toEqual({
      expected_version: 'v-draft-2',
      misc_allowance_bp: 500,
      lines: [
        { stock_item_id: 'SI-BEEF', unit_name: 'kg', qty: '0.5' },
        { stock_item_id: 'SI-TP1', unit_name: 'g', qty: '15', qty_basis: 'AP' },
        { stock_item_id: 'SI-ONION', unit_name: 'g', qty: '30' },
      ],
    });
  });

  it('[08b #30] publish errors mapped: a line reason under its line, a graph reason in the banner; warnings shown per line', async () => {
    let answer = fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'lines.1.stock_item_id', reason: 'archived' });
    const warned = {
      ...DETAIL,
      draft: version({ cost: cost('partial', '52669', ['SI-TP1']), warnings: [{ code: 'no_menu_cost', line_no: 2 }, { code: 'main_line_off' }] }),
    };
    const { api, calls } = fakeApi(editorHandler(warned, (call) => (call.method === 'POST' ? answer : undefined)));
    await editor(api);
    // a line warning sits in its row (line_no − 1 = the row index); a recipe-level one under the plate cost
    expect([...lineRow('SI-TP1').querySelectorAll('[data-line-warning]')].map((w) => w.textContent)).toEqual(['TP-1 packet: no menu cost yet, so the plate cost is partial.']);
    expect(lineRow('SI-BEEF').querySelector('[data-line-warning]')).toBeNull();
    expect([...m.container.querySelectorAll('[data-warning]')].map((w) => w.textContent)).toEqual(['No main ingredient line is near the recipe amount. Check the amounts.']);
    // §7 risk (1): the cloud's unknown_items, named from the lines
    expect(m.container.querySelector('[data-missing-cost]')?.textContent).toBe('Missing cost: TP-1 packet');

    await click(button(m.container, 'Publish'));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/v1/admin/recipes/R-TAWA/publish', body: { expected_version: 'v-draft-2' } });
    expect(lineRow('SI-TP1').querySelector('.pos-field__error')?.textContent).toBe('This stock item was archived. Remove the line or pick another one.');

    answer = fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'lines', reason: 'cycle' });
    await click(button(m.container, 'Publish'));
    expect(m.container.querySelector('.pos-banner--danger')?.textContent).toContain('This would make a recipe use itself');
    answer = fail(409, 'CONFIG_STALE', { entity: 'recipe_version' });
    await click(button(m.container, 'Publish'));
    expect(m.container.querySelector('[data-stale]')).not.toBeNull();
  });

  it('[08b #30] draft PUT and publish carry the picked branch (AD-26 d); removing every line of a dish reads "No cost yet · partial" (AD-25)', async () => {
    const { api, calls } = fakeApi(
      editorHandler(DETAIL, (call) => (call.method === 'PUT' ? ok({ draft: version({ version: 'v-draft-3' }) }) : call.method === 'POST' ? ok({ published: PUBLISHED }) : undefined)),
    );
    await render(<RecipeEditor api={api} recipeId="R-TAWA" branchIds={BRANCHES} branchId={B1} />);
    expect(calls.find((c) => c.url.startsWith('/v1/admin/recipes/'))?.url).toBe(`/v1/admin/recipes/R-TAWA?branch_id=${B1}`);
    await click(m.container.querySelector<HTMLButtonElement>('button[aria-label="Remove Beef (raw)"]')!);
    await click(m.container.querySelector<HTMLButtonElement>('button[aria-label="Remove TP-1 packet"]')!);
    expect(m.container.querySelector('[data-plate-cost]')?.textContent).toBe('No cost yet · partial');
    await click(button(m.container, 'Publish'));
    expect(calls.find((c) => c.method === 'PUT')?.url).toBe(`/v1/admin/recipes/R-TAWA/draft?branch_id=${B1}`);
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: `/v1/admin/recipes/R-TAWA/publish?branch_id=${B1}`, key: undefined, body: { expected_version: 'v-draft-3' } });
  });

  it('[08b #30] batch and measure bases: "makes 160 piece", "per kg" / "per litre"; archived recipe restore 422 new_draft', async () => {
    const batch = {
      ...DETAIL,
      recipe: summary({ recipe_id: 'R-PAYE', owner_type: 'stock_item', owner_id: 'SI-PAYE', owner_name: 'PAYE-COOKED', archived: true, version: 'r5' }),
      draft: null,
      published: version({ status: 'published', basis: 'per_batch', batch_yield_qty: '160', batch_stock_unit: 'piece', version: 'v-pub' }),
    };
    const { api, calls } = fakeApi(
      editorHandler(batch, (call) =>
        call.method === 'PATCH' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'archived', reason: 'unit_changed', hint: 'new_draft' }) : undefined,
      ),
    );
    await editor(api, 'R-PAYE');
    expect(m.container.querySelector<HTMLInputElement>('input[name="batch_yield_qty"]')?.value).toBe('160');
    expect(m.container.querySelector('[data-makes]')?.textContent).toBe('makes 160 piece');
    await click(button(m.container, 'Restore'));
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', url: '/v1/admin/recipes/R-PAYE', body: { expected_version: 'r5', archived: false } });
    expect(m.container.querySelector('[data-new-draft]')?.textContent).toContain('Make a new recipe version');

    m.unmount();
    m = mount();
    for (const [unit, text] of [
      ['g', 'per kg'],
      ['ml', 'per litre'],
    ] as const) {
      const measure = { ...DETAIL, draft: version({ basis: 'per_measure', base_qty: 1000, measure_unit: unit }) };
      const other = fakeApi(editorHandler(measure));
      await editor(other.api, 'R-KAR');
      expect(m.container.querySelector('[data-basis]')?.textContent).toBe(text);
      m.unmount();
      m = mount();
    }
  });
});

// ------------------------------------------------------------------------------------------- menu badge (C-12)

const menuItem = (item_id: string, name: string, extra: Record<string, unknown> = {}) => ({
  item_id,
  category_id: 'C1',
  tax_class_id: null,
  name,
  variant_group_id: null,
  variant_name: null,
  description: null,
  sort_order: 0,
  price_minor: 120_000,
  serve_mode: 'cook_to_order',
  prep_buffer_ms: 0,
  cook_time_ms: 600_000,
  stock_time_ms: null,
  out_of_stock_behaviour: 'sold_out',
  sale_unit: 'piece',
  requires_weighing: false,
  stock_draws: [],
  availability_windows: [],
  archived_at: null,
  routes: [],
  ...extra,
});

describe('[08b §8.3, 01c C-12] menu page badge', () => {
  it('[08b #31] "No recipe" on every active item without a published recipe (data from GET /v1/admin/recipes)', async () => {
    window.location.hash = '#/menu';
    const recipes = {
      ...LIST,
      rows: [
        summary({ owner_id: 'I1' }),
        summary({ recipe_id: null, owner_id: 'I2', published: null, plate_cost: cost('no_recipe', null) }),
        summary({ recipe_id: 'R3', owner_id: 'I3', published: null, has_draft: true, plate_cost: cost('no_recipe', null) }),
        summary({ recipe_id: 'R4', owner_id: 'I4', archived: true, plate_cost: cost('no_recipe', null) }),
        summary({ recipe_id: null, owner_type: 'modifier_option', owner_id: 'O1', published: null, plate_cost: cost('no_recipe', null) }),
      ],
    };
    const page = {
      can_edit_tenant: true,
      tax_classes: [],
      categories: [{ category_id: 'C1', name: 'Karahi', sort_order: 0, archived_at: null, availability_windows: [], goes_with: [] }],
      variant_groups: [],
      items: [menuItem('I1', 'Tawa piece'), menuItem('I2', 'Naan'), menuItem('I3', 'Lassi'), menuItem('I4', 'Old karahi')],
      next_cursor: null,
    };
    const { api, calls } = fakeApi((call) => {
      if (call.url.startsWith('/v1/admin/recipes')) return ok(recipes);
      if (call.url.startsWith('/v1/admin/stock-items')) return ok({ can_edit_tenant: true, stock_items: [] });
      return ok(page);
    });
    await render(<MenuView api={api} />);
    expect(calls.some((c) => c.url === '/v1/admin/recipes')).toBe(true);
    const badge = (id: string) => m.container.querySelector(`[data-item-id="${id}"]`)?.closest('.pos-list__row')?.querySelector('[data-no-recipe]')?.textContent;
    expect(badge('I1')).toBeUndefined();
    expect(badge('I2')).toBe('No recipe');
    expect(badge('I3')).toBe('No recipe');
    expect(badge('I4')).toBe('No recipe');
  });

  it('[08b #31] a failed recipes read shows no badge and no error', async () => {
    window.location.hash = '#/menu';
    const page = { can_edit_tenant: true, tax_classes: [], categories: [], variant_groups: [], items: [menuItem('I1', 'Naan')], next_cursor: null };
    const { api } = fakeApi((call) => (call.url.startsWith('/v1/admin/recipes') ? fail(500, 'INTERNAL') : call.url.startsWith('/v1/admin/stock-items') ? ok({ can_edit_tenant: true, stock_items: [] }) : ok(page)));
    await render(<MenuView api={api} />);
    expect(m.container.querySelector('[data-no-recipe]')).toBeNull();
    expect(m.container.querySelector('.pos-banner--danger')).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------ labels, B17 texts

const RECIPE_409 = () => fail(409, 'CONFIG_IN_USE', { entity: 'stock_item', id: 'SI1', used_by: { entity: 'recipe', ids: ['R-TAWA'] } });

describe('[08b §8.4, §8.5] labels and the B17 refusal text', () => {
  it('[08b #32] "Plate cost (menu cost)"; no "today\'s cost" outside the 08a help line; every 08b key is on the 08b Urdu to-do list', () => {
    expect(en['recipes.col_cost']).toBe('Plate cost (menu cost)');
    expect(en['recipe.plate_cost']).toBe('Plate cost (menu cost)');
    const today = Object.entries(en).filter(([, text]) => text.toLowerCase().includes("today's cost"));
    expect(today.map(([key]) => key)).toEqual(['stock_inv.menu_cost_help']);
    const ours = Object.keys(en).filter((k) => k.startsWith('recipes.') || k.startsWith('recipe.') || k.startsWith('recipe_in_use.') || ['owner.nav.recipes', 'menu.no_recipe'].includes(k));
    expect(ours.length).toBeGreaterThan(40);
    for (const key of ours) expect(todo08b.includes(`| \`${key}\` |`), key).toBe(true);
  });

  it('[08b #32] stock item archive refused by a recipe (B17, C-11): "archive the recipe first" with a link to the recipe', async () => {
    window.location.hash = '#/stock-items/SI1';
    const pot = { ...stockWire('SI1', 'Beef (raw)', 'ingredient'), branches: [], drawers: [], menu_cost: null };
    const { api } = fakeApi((call) => {
      if (call.method === 'PATCH') return RECIPE_409();
      if (call.url.startsWith('/v1/admin/stock-items')) return ok({ can_edit_tenant: true, stock_items: call.url.includes('archived') ? [] : [pot] });
      if (call.url.includes('/stations')) return ok({ stations: [] });
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });
    await render(<StockItemForm api={api} stockItemId="SI1" branchIds={BRANCHES} />);
    await click(m.container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more')!);
    await click(button(m.container, 'Archive stock item'));
    const note = m.container.querySelector('[data-recipe-in-use]');
    expect(note?.textContent).toContain('archive the recipe first');
    expect(note?.querySelector('a')?.getAttribute('href')).toBe('#/recipes/R-TAWA');
    expect(m.container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('[08b #32] choice group save refused by an option recipe (C-15): the same text and link', async () => {
    window.location.hash = '#/choice-groups/MG1';
    const group = {
      modifier_group_id: 'MG1',
      name: 'Spice level',
      min_choices: 0,
      max_choices: 1,
      sort_order: 0,
      archived_at: null,
      options: [{ option_id: 'O1', name: 'Spicy', price_minor: 0, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 0 }],
      archived_options: [],
      links: [],
      branches: [],
      version: 'v1',
    };
    const { api } = fakeApi((call) => {
      if (call.method === 'PATCH') return RECIPE_409();
      if (call.url.startsWith('/v1/admin/modifier-groups')) return ok({ can_edit_tenant: true, modifier_groups: call.url.includes('archived') ? [] : [group] });
      if (call.url.startsWith('/v1/admin/menu')) return ok({ can_edit_tenant: true, tax_classes: [], categories: [], variant_groups: [], items: [], next_cursor: null });
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });
    await render(<ChoiceGroupForm api={api} groupId="MG1" />);
    setValue(m.container.querySelector<HTMLInputElement>('input[name="max_choices"]'), '1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Spice');
    await click(button(m.container.querySelector('.pos-appbar')!, 'Save'));
    const note = m.container.querySelector('[data-recipe-in-use]');
    expect(note?.textContent).toContain('archive the recipe first');
    expect(note?.querySelector('a')?.getAttribute('href')).toBe('#/recipes/R-TAWA');
  });

  it('[08b #32] menu item save refused by its recipe (C-14 sale unit): the same text and link, no dialog', async () => {
    const item = {
      item_id: 'I-KAR',
      category_id: 'C1',
      tax_class_id: null,
      name: 'Chicken karahi',
      variant_group_id: null,
      variant_name: null,
      description: null,
      sort_order: 0,
      price_minor: 90_000,
      serve_mode: 'cook_to_order',
      prep_buffer_ms: 0,
      cook_time_ms: 600_000,
      stock_time_ms: null,
      out_of_stock_behaviour: 'sold_out',
      sale_unit: 'piece',
      requires_weighing: false,
      is_ready_item: false,
      stock_draws: [],
      availability_windows: [],
      weight_pct: 100,
      max_early_ms: 60_000,
      max_carry_ms: null,
      max_late_ms: null,
      adjust_time_ms: 180_000,
      max_delay_ms: null,
      max_delay_unlimited: false,
      goes_with: [],
      archived_at: null,
      routes: [],
    } as const;
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'PATCH') return fail(409, 'CONFIG_IN_USE', { entity: 'menu_item', id: 'I-KAR', used_by: { entity: 'recipe', ids: ['R-KAR'] } });
      return ok({ stations: [], stock_items: [], can_edit_tenant: true });
    });
    await render(
      <ItemForm
        api={api}
        item={item as unknown as Parameters<typeof ItemForm>[0]['item']}
        taxClasses={[]}
        categories={[{ category_id: 'C1', name: 'Karahi', sort_order: 0, archived_at: null, availability_windows: [], goes_with: [] }]}
        branchIds={[B1]}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    );
    setValue(m.container.querySelector<HTMLInputElement>('form [name="price"]'), '950');
    const form = m.container.querySelector('form')!;
    await click(m.container.querySelector<HTMLButtonElement>('button[type="submit"]') ?? (form as unknown as HTMLButtonElement));
    expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    const note = m.container.querySelector('[data-recipe-in-use]');
    expect(note?.textContent).toContain('archive the recipe first');
    expect(note?.querySelector('a')?.getAttribute('href')).toBe('#/recipes/R-KAR');
    expect(m.container.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
