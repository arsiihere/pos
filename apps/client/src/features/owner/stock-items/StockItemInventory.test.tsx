import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloudAdmin } from '../../../api/cloud-admin';
import { BranchNames } from '../branch';
import { GuardProvider } from '../guard';
import { button, click, fail, fakeApi, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { StockItemInventory } from './StockItemInventory';

// 08a §8.3 (tests 39–41): the item page — Units, Menu cost (I12), Yield (ingredients only). The cloud is a fake
// fetch at the CloudAdmin boundary, as the other owner-view tests.
let m: Mounted;
const B1 = 'B-LAKE';
const B2 = 'B-JOHAR';
const NAMES = new Map([
  [B1, 'Lake City'],
  [B2, 'Johar Town'],
]);
const T0 = Date.UTC(2026, 10, 20, 9, 0);

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  window.location.hash = '#/stock-items/SI-BEEF/inventory';
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
});

const wire = (over: Record<string, unknown>) => ({
  stock_item_id: 'SI-BEEF',
  name: 'Beef (raw)',
  stock_unit: 'g',
  carries_over: false,
  archived_at: null,
  kind: 'ingredient',
  code: 'BF-1',
  cost_category: 'food',
  is_a_item: true,
  version: 'v1',
  ...over,
});
const unitRow = (over: Record<string, unknown>) => ({
  unit_row_id: 'U2',
  unit_name: 'peti',
  base_unit: 'g',
  factor_num: '12000',
  factor_den: 1,
  is_current: true,
  note: null,
  recorded_by: 'O1',
  recorded_by_name: 'Owner',
  created_at: T0 + 2,
  ...over,
});
const priceRow = (over: Record<string, unknown>) => ({
  price_id: 'P2',
  branch_id: null,
  kind: 'manual',
  unit_name: 'kg',
  price_minor: 150000,
  stock_qty_num: '1000',
  stock_qty_den: '1',
  stock_unit: 'g',
  created_at: T0 + 2,
  valid_until_at: null,
  note: null,
  recorded_by: 'O1',
  recorded_by_name: 'Owner',
  ...over,
});
const yieldRow = (over: Record<string, unknown>) => ({
  yield_profile_id: 'Y2',
  yield_bp: 7120,
  test_ap_qty: '10000',
  test_ep_qty: '7120',
  test_unit: 'g',
  note: null,
  recorded_by: 'O1',
  recorded_by_name: 'Owner',
  created_at: T0 + 2,
  ...over,
});
const COST = { branch_id: null, price_id: 'P2', per_stock_unit: { num: '150', den: '1' }, display_per: { unit: 'kg', minor: '150000', below_one_minor: false } };
const BUILTIN_G = [
  { unit_name: 'kg', base: 'g', num: 1000, den: 1 },
  { unit_name: 'pao', base: 'g', num: 250, den: 1 },
  { unit_name: 'maund', base: 'g', num: 40000, den: 1 },
];

function detail(over: Record<string, unknown> = {}) {
  const active = yieldRow({});
  return {
    can_edit_tenant: true,
    stock_item: wire({}),
    builtin_units: BUILTIN_G,
    units: [
      unitRow({}),
      unitRow({ unit_row_id: 'U1', factor_num: '10000', is_current: false, created_at: T0 + 1 }),
      unitRow({ unit_row_id: 'U0', unit_name: 'box', base_unit: 'piece', factor_num: '6', is_current: false, created_at: T0 }),
    ],
    prices: [
      priceRow({ price_id: 'P3', kind: 'market_rate', branch_id: B1, price_minor: 160000, created_at: T0 + 3, valid_until_at: T0 + 3 + 86_400_000 }),
      priceRow({}),
      priceRow({ price_id: 'P1', unit_name: 'piece', stock_unit: 'piece', price_minor: 90000, created_at: T0 }),
    ],
    menu_cost: COST,
    yields: [active, yieldRow({ yield_profile_id: 'Y1', yield_bp: 7000, test_ap_qty: null, test_ep_qty: null, test_unit: null, created_at: T0 })],
    active_yield: active,
    ...over,
  };
}

function handler(read: () => unknown, write: (call: Call) => Response | undefined = () => undefined) {
  return (call: Call): Response => {
    if (call.method !== 'GET') {
      const answer = write(call);
      if (answer !== undefined) return answer;
    }
    if (call.method === 'GET' && call.url.startsWith('/v1/admin/stock-items/SI-BEEF/inventory')) return ok(read());
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}

async function render(api: CloudAdmin, branchId: string | null = null) {
  await m.render(
    <GuardProvider>
      <BranchNames.Provider value={NAMES}>
        <StockItemInventory api={api} stockItemId="SI-BEEF" branchIds={[B1, B2]} branchId={branchId} />
      </BranchNames.Provider>
    </GuardProvider>,
  );
}
const section = (name: string) => m.container.querySelector<HTMLElement>(`[data-section="${name}"]`);
const dialog = () => m.container.querySelector<HTMLElement>('[role="dialog"]')!;
const field = <T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(name: string) => dialog().querySelector<T>(`[name="${name}"]`);
const texts = (scope: ParentNode, selector: string) => [...scope.querySelectorAll(selector)].map((e) => e.textContent);

describe('[08a §8.3] item page: Units', () => {
  it('[08a #39] built-ins read-only, current units as sentences, other-base rows greyed "other unit" under history', async () => {
    const { api, calls } = fakeApi(handler(() => detail()));
    await render(api, B1);
    expect(calls[0]?.url).toBe(`/v1/admin/stock-items/SI-BEEF/inventory?branch_id=${B1}`);
    const units = section('units')!;
    expect(texts(units, '[data-builtin]')).toEqual(['1 kg = 1000 g', '1 pao = 250 g', '1 maund = 40000 g']);
    expect(texts(units, '[data-current-unit] strong')).toEqual(['1 peti = 12 kg']);
    await click(button(units, 'Unit history'));
    const history = [...units.querySelectorAll<HTMLElement>('[data-unit-row]')];
    expect(history.map((r) => r.querySelector('strong')?.textContent)).toEqual(['1 peti = 12 kg', '1 peti = 10 kg', '1 box = 6 pieces']);
    expect(history[2]?.classList.contains('is-archived')).toBe(true);
    expect(history[2]?.textContent).toContain('other unit');
    expect(history[0]?.classList.contains('is-archived')).toBe(false);
  });

  it('[08a #39] "Add or change a unit": "1 peti = 12 kg" sends 12000 / 1 with an Idempotency-Key; "1 piece = 182.5 g" sends 1825 / 10', async () => {
    let reads = 0;
    const { api, calls } = fakeApi(
      handler(
        () => (reads++, detail()),
        (call) => (call.method === 'POST' ? new Response(JSON.stringify({ data: { unit: unitRow({}) } }), { status: 201 }) : undefined),
      ),
    );
    await render(api);
    await click(button(section('units')!, 'Add or change a unit'));
    setValue(field('unit_name'), 'Peti');
    setValue(field('unit_amount'), '12');
    setValue(field<HTMLSelectElement>('unit_base'), 'kg');
    expect(dialog().querySelector('[data-unit-preview]')?.textContent).toBe('1 peti = 12 kg');
    await click(button(dialog(), 'Save unit'));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post).toMatchObject({ url: '/v1/admin/stock-items/SI-BEEF/units', body: { unit_name: 'peti', factor_num: 12000, factor_den: 1 } });
    expect(post.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(reads).toBe(2);

    await click(button(section('units')!, 'Add or change a unit'));
    setValue(field('unit_name'), 'piece');
    setValue(field('unit_amount'), '182.5');
    setValue(field<HTMLSelectElement>('unit_base'), 'g');
    expect(dialog().querySelector('[data-unit-preview]')?.textContent).toBe('1 piece = 182.5 g');
    await click(button(dialog(), 'Save unit'));
    const second = calls.filter((c) => c.method === 'POST')[1]!;
    expect(second.body).toEqual({ unit_name: 'piece', factor_num: 1825, factor_den: 10 });
    expect(second.key).not.toBe(post.key);
  });

  it('[08a #39] "1 l = 0.92 kg" on ghee sends 920 / 1; the stock unit or a built-in of it is refused before sending', async () => {
    const { api, calls } = fakeApi(handler(() => detail({ stock_item: wire({ name: 'Ghee', kind: 'ingredient' }), units: [] })));
    await render(api);
    await click(button(section('units')!, 'Add or change a unit'));
    setValue(field('unit_name'), 'KG');
    setValue(field('unit_amount'), '1');
    await click(button(dialog(), 'Save unit'));
    expect(dialog().querySelector('.pos-field__error')?.textContent).toBe('kg is already known for this item. Use another name.');
    setValue(field('unit_name'), 'l');
    setValue(field('unit_amount'), '0.92');
    setValue(field<HTMLSelectElement>('unit_base'), 'kg');
    await click(button(dialog(), 'Save unit'));
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ unit_name: 'l', factor_num: 920, factor_den: 1 }]);
  });
});

describe('[08a §8.3] item page: Menu cost', () => {
  it('[08a #41] the section is "Menu cost"; "Today\'s cost" appears only in its help line (I12)', async () => {
    const { api } = fakeApi(handler(() => detail()));
    await render(api, B1);
    const cost = section('menu-cost')!;
    expect(cost.querySelector('h2')?.textContent).toBe('Menu cost');
    expect(cost.querySelector('.pos-section__head p')?.textContent).toBe("Price you set. Today's cost from deliveries is on the hub (coming)");
    expect(m.container.textContent?.split("Today's cost").length).toBe(2);
    expect(cost.querySelector('[data-menu-cost]')?.textContent).toBe('Rs 1,500 / kg');
    // History: newest first, with who / when / branch / kind; a price in another stock unit is greyed.
    const rows = [...cost.querySelectorAll<HTMLElement>('[data-price-row]')];
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['Rs 1,600 per kg', 'Rs 1,500 per kg', 'Rs 900 per piece']);
    expect(rows[0]?.textContent).toContain("Today's market rate");
    expect(rows[0]?.textContent).toContain('Lake City');
    expect(rows[0]?.textContent).toContain('Owner');
    expect(rows[1]?.textContent).toContain('Manual');
    expect(rows[1]?.textContent).toContain('Every branch');
    expect(rows[2]?.classList.contains('is-archived')).toBe(true);
    expect(rows[2]?.textContent).toContain('other unit');
    // Opening the sheet keeps the I12 rule: the help line stays the only "Today's cost".
    await click(button(cost, 'Set price'));
    expect(m.container.textContent?.split("Today's cost").length).toBe(2);
  });

  it('[08a #38, I7] no menu cost shows "No price" in the warning style, never "Rs 0"', async () => {
    const { api } = fakeApi(handler(() => detail({ menu_cost: null, prices: [] })));
    await render(api);
    const shown = section('menu-cost')!.querySelector('[data-menu-cost]')!;
    expect(shown.textContent).toBe('No price');
    expect(shown.classList.contains('pos-chip--warn')).toBe(true);
    expect(m.container.textContent).not.toContain('Rs 0');
  });

  it('[08a #40] Manual has no branch or validity choice and sends kind, unit and amount only', async () => {
    const { api, calls } = fakeApi(
      handler(detail, (call) =>
        call.method === 'POST' ? new Response(JSON.stringify({ data: { price: priceRow({}), menu_cost: COST } }), { status: 201 }) : undefined,
      ),
    );
    await render(api);
    await click(button(section('menu-cost')!, 'Set price'));
    expect(dialog().querySelector('[aria-pressed="true"]')?.textContent).toBe('Manual');
    expect(field<HTMLSelectElement>('branch_id')).toBeNull();
    expect(dialog().querySelector('[data-valid-for]')).toBeNull();
    // The units resolveUnit accepts: the stock unit, its built-ins and the current item units.
    expect([...field<HTMLSelectElement>('unit_name')!.options].map((o) => o.value)).toEqual(['kg', 'g', 'pao', 'maund', 'peti']);
    setValue(field('price'), '1,500');
    await click(button(dialog(), 'Save price'));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/v1/admin/stock-items/SI-BEEF/prices');
    expect(post.body).toEqual({ kind: 'manual', unit_name: 'kg', price_minor: 150000 });
    expect(post.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('[08a #40] Today\'s market rate: every branch or one branch; Valid for defaults to 1 day → valid_for_hours 24; custom hours up to 720', async () => {
    const { api, calls } = fakeApi(
      handler(detail, (call) =>
        call.method === 'POST' ? new Response(JSON.stringify({ data: { price: priceRow({}), menu_cost: COST } }), { status: 201 }) : undefined,
      ),
    );
    await render(api);
    await click(button(section('menu-cost')!, 'Set price'));
    await click(button(dialog(), "Today's market rate"));
    const branch = field<HTMLSelectElement>('branch_id')!;
    expect([...branch.options].map((o) => o.textContent)).toEqual(['Every branch', 'Lake City', 'Johar Town']);
    expect(branch.value).toBe('');
    const validFor = dialog().querySelector<HTMLElement>('[data-valid-for]')!;
    expect(texts(validFor, 'button')).toEqual(['1 day', '2 days', '1 week', 'Custom']);
    expect(validFor.querySelector('[aria-pressed="true"]')?.textContent).toBe('1 day');
    setValue(branch, B1);
    setValue(field<HTMLSelectElement>('unit_name'), 'peti');
    setValue(field('price'), '18000');
    setValue(field('note'), 'Mandi, Monday');
    await click(button(dialog(), 'Save price'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      kind: 'market_rate',
      branch_id: B1,
      valid_for_hours: 24,
      unit_name: 'peti',
      price_minor: 1_800_000,
      note: 'Mandi, Monday',
    });

    await click(button(section('menu-cost')!, 'Set price'));
    await click(button(dialog(), "Today's market rate"));
    await click(button(dialog().querySelector('[data-valid-for]')!, 'Custom'));
    setValue(field('valid_for_hours'), '721');
    setValue(field('price'), '1500');
    await click(button(dialog(), 'Save price'));
    expect(dialog().querySelector('.pos-field__error')?.textContent).toBe('Type whole hours from 1 to 720.');
    setValue(field('valid_for_hours'), '72');
    await click(button(dialog(), 'Save price'));
    expect(calls.filter((c) => c.method === 'POST')[1]?.body).toEqual({ kind: 'market_rate', branch_id: null, valid_for_hours: 72, unit_name: 'kg', price_minor: 150000 });
  });

  it('[08a §9] 422 not_convertible and branch_id not_found show their own texts in the sheet', async () => {
    let answer = fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'unit_name', reason: 'not_convertible' });
    const { api } = fakeApi(handler(detail, (call) => (call.method === 'POST' ? answer : undefined)));
    await render(api);
    await click(button(section('menu-cost')!, 'Set price'));
    setValue(field('price'), '1500');
    await click(button(dialog(), 'Save price'));
    expect(dialog().querySelector('.pos-field__error')?.textContent).toBe("This unit can't be turned into the stock unit. Add the unit under Units first.");
    answer = fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'branch_id', reason: 'not_found' });
    await click(button(dialog(), 'Save price'));
    expect(dialog().querySelector('.pos-banner')?.textContent).toContain("This branch isn't here any more. Pick another branch.");
  });
});

describe('[08a §8.3] item page: Yield', () => {
  it('[08a #41] Yield is shown for an ingredient, hidden for a prepared item and a packet', async () => {
    const { api } = fakeApi(handler(() => detail()));
    await render(api);
    expect(section('yield')?.querySelector('[data-active-yield]')?.textContent).toBe('71.2 %');
    for (const kind of ['prepared', 'packet']) {
      m.unmount();
      m = mount();
      const other = fakeApi(handler(() => detail({ stock_item: wire({ kind }), yields: [], active_yield: null })));
      await render(other.api);
      expect(section('menu-cost'), kind).not.toBeNull();
      expect(section('yield'), kind).toBeNull();
    }
  });

  it('[08a §8.3, I8] "Record a test" sends AP and EP in the stock unit (typed in kg); "Set yield %" sends yield_bp', async () => {
    const { api, calls } = fakeApi(
      handler(detail, (call) => (call.method === 'POST' ? new Response(JSON.stringify({ data: { yield: yieldRow({}) } }), { status: 201 }) : undefined)),
    );
    await render(api);
    await click(button(section('yield')!, 'Record a test'));
    setValue(field('test_ap_qty'), '10');
    setValue(field('test_ep_qty'), '7.12');
    await click(button(dialog(), 'Save yield'));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/v1/admin/stock-items/SI-BEEF/yields',
      body: { test_ap_qty: 10000, test_ep_qty: 7120 },
    });
    await click(button(section('yield')!, 'Set yield %'));
    setValue(field('yield_pct'), '600');
    await click(button(dialog(), 'Save yield'));
    expect(dialog().querySelector('.pos-field__error')?.textContent).toBe('Type a yield from 0.01 % to 500 %.');
    setValue(field('yield_pct'), '71.5');
    await click(button(dialog(), 'Save yield'));
    expect(calls.filter((c) => c.method === 'POST')[1]?.body).toEqual({ yield_bp: 7150 });
    // m-15: AP / EP may be typed in g too (whole grams), sent in the stock unit.
    await click(button(section('yield')!, 'Record a test'));
    expect([...field<HTMLSelectElement>('test_unit')!.options].map((o) => o.textContent)).toEqual(['kg', 'g']);
    setValue(field<HTMLSelectElement>('test_unit'), 'g');
    setValue(field('test_ap_qty'), '10000');
    setValue(field('test_ep_qty'), '7120');
    await click(button(dialog(), 'Save yield'));
    expect(calls.filter((c) => c.method === 'POST')[2]?.body).toEqual({ test_ap_qty: 10000, test_ep_qty: 7120 });
  });

  it('[08a §8.3] yield history shows the test AP / EP through formatQuantity', async () => {
    const { api } = fakeApi(handler(() => detail()));
    await render(api);
    await click(button(section('yield')!, 'Yield history'));
    const rows = [...section('yield')!.querySelectorAll<HTMLElement>('[data-yield-row]')];
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['71.2 %', '70.0 %']);
    expect(rows[0]?.textContent).toContain('Test: 10 kg → 7.12 kg');
    expect(rows[1]?.textContent).not.toContain('Test:');
  });
});

describe('[08a §8.3] item page: read-only and gone', () => {
  it('can_edit_tenant false hides every write; 404 shows the gone card', async () => {
    const { api } = fakeApi(handler(() => detail({ can_edit_tenant: false })));
    await render(api);
    expect(m.container.textContent).not.toContain('Set price');
    expect(m.container.textContent).not.toContain('Add or change a unit');
    expect(m.container.textContent).not.toContain('Record a test');
    m.unmount();
    m = mount();
    const gone = fakeApi(() => fail(404, 'STOCK_ITEM_NOT_FOUND'));
    await render(gone.api);
    expect(m.container.querySelector('.pos-gone h2')?.textContent).toBe("This stock item isn't here any more");
  });
});
