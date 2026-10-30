import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloudAdmin } from '../../../api/cloud-admin';
import { BranchNames } from '../branch';
import { GuardProvider } from '../guard';
import { button, click, fail, fakeApi, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { StockItemForm } from './StockItemForm';
import { StockItemList } from './StockItemList';

let m: Mounted;
const B1 = 'B-GULBERG';
const B2 = 'B-JOHAR';
const B3 = 'B-DHA';
const BRANCHES = [B1, B2, B3];
const NAMES = new Map([
  [B1, 'Gulberg'],
  [B2, 'Johar Town'],
  [B3, 'DHA'],
]);

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  window.location.hash = '#/stock-items';
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
});

const station = (station_id: string, name: string, archived_at: number | null = null) => ({
  station_id,
  name,
  location_label: null,
  station_type: 'slot',
  capacity: 4,
  freshness_window_ms: null,
  completion_mode: 'single_tap',
  archived_at,
  programs: [],
});
const STATIONS: Record<string, unknown[]> = {
  [B1]: [station('S1', 'Karahi counter'), station('S2', 'BBQ')],
  [B2]: [station('S3', 'Karahi counter')],
  [B3]: [station('S4', 'Karahi counter')],
};
const POT = {
  stock_item_id: 'SI1',
  name: 'Karahi pot',
  stock_unit: 'g',
  carries_over: false,
  archived_at: null,
  version: 'v1',
  branches: [
    { branch_id: B1, station_id: 'S1', low_stock_threshold: 1000, version: 'r1' },
    { branch_id: B2, station_id: 'S3', low_stock_threshold: null, version: 'r2' },
    { branch_id: B3, station_id: null, low_stock_threshold: null, version: 'r3' },
  ],
  drawers: [
    { item_id: 'I1', name: 'Chicken Karahi — Half', variant_name: 'Half', quantity_per_sale_unit: 500 },
    { item_id: 'I2', name: 'Chicken Karahi — Full', variant_name: 'Full', quantity_per_sale_unit: 1000 },
  ],
};
const DRINK = {
  stock_item_id: 'SI2',
  name: 'Soft drink 1.5 L',
  stock_unit: 'piece',
  carries_over: true,
  archived_at: null,
  version: 'v2',
  branches: BRANCHES.map((branch_id) => ({ branch_id, station_id: null, low_stock_threshold: null, version: `n-${branch_id}` })),
  drawers: [{ item_id: 'I9', name: 'Soft drink 1.5 L', variant_name: null, quantity_per_sale_unit: 1 }],
};
const OLD = { ...DRINK, stock_item_id: 'SI3', name: 'Old raita', archived_at: 1, drawers: [] };

function handler(write: (call: Call) => Response | undefined = () => undefined, canEdit = true, items: unknown[] = [POT, DRINK]) {
  return (call: Call): Response => {
    const written = call.method === 'GET' ? undefined : write(call);
    if (written !== undefined) return written;
    if (call.url === '/v1/admin/stock-items') return ok({ can_edit_tenant: canEdit, stock_items: items });
    if (call.url === '/v1/admin/stock-items?status=archived') return ok({ can_edit_tenant: canEdit, stock_items: [OLD] });
    const stations = /^\/v1\/admin\/branches\/([^/]+)\/stations$/.exec(call.url);
    if (stations !== null) return ok({ stations: STATIONS[decodeURIComponent(stations[1]!)] ?? [] });
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}

async function render(node: ReactNode) {
  await m.render(
    <GuardProvider>
      <BranchNames.Provider value={NAMES}>{node}</BranchNames.Provider>
    </GuardProvider>,
  );
}
const form = (api: CloudAdmin, id: string) => render(<StockItemForm api={api} stockItemId={id} branchIds={BRANCHES} />);
const row = (name: string) => m.container.querySelector<HTMLElement>(`[data-branch-row="${name}"]`)!;

describe('[01c-S06] stock items list', () => {
  it('Stock item · Counted in · Used by · Counted at chips; a warn chip when no branch counts it; rows open', async () => {
    const { api } = fakeApi(handler());
    await render(<StockItemList api={api} branchIds={BRANCHES} />);
    const rows = [...m.container.querySelectorAll<HTMLElement>('.pos-list__row')];
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['Karahi pot', 'Soft drink 1.5 L']);
    const pot = rows[0]!;
    expect(pot.querySelector('.pos-list__name span')?.textContent).toBe('Counted fresh each morning');
    expect(pot.querySelector('.pos-c01unit')?.textContent).toBe('g');
    expect(pot.querySelector('.pos-list__muted')?.textContent).toBe('Half 0.5 kg, Full 1 kg');
    expect([...pot.querySelectorAll('.pos-chip')].map((c) => c.textContent)).toEqual(['Gulberg: Karahi counter', 'Johar Town: Karahi counter']);
    expect(pot.querySelector('a.pos-rowlink')?.getAttribute('href')).toBe('#/stock-items/SI1');
    const drink = rows[1]!;
    expect(drink.querySelector('.pos-list__name span')?.textContent).toBe('Keeps overnight');
    expect(drink.querySelector('.pos-c01unit')?.textContent).toBe('pieces');
    expect(drink.querySelector('.pos-chip--warn')?.textContent).toBe('Not counted anywhere yet');
  });

  it('search matches dish names too; ⋯ Show archived reads status=archived', async () => {
    const { api, calls } = fakeApi(handler());
    await render(<StockItemList api={api} branchIds={BRANCHES} />);
    setValue(m.container.querySelector<HTMLInputElement>('input[name="q"]'), 'full');
    expect([...m.container.querySelectorAll('.pos-list__row strong')].map((s) => s.textContent)).toEqual(['Karahi pot']);
    setValue(m.container.querySelector<HTMLInputElement>('input[name="q"]'), '');
    await click(m.container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more')!);
    await click(button(m.container, 'Show archived stock items'));
    expect(calls.some((c) => c.url === '/v1/admin/stock-items?status=archived')).toBe(true);
    expect([...m.container.querySelectorAll('.pos-list__row strong')].map((s) => s.textContent)).toEqual(['Old raita']);
  });

  it('empty: the empty card with New stock item; read-only hides New', async () => {
    const { api } = fakeApi(handler(undefined, true, []));
    await render(<StockItemList api={api} branchIds={BRANCHES} />);
    expect(m.container.querySelector('.pos-empty h3')?.textContent).toBe('No stock items yet');
    expect(m.container.querySelector('.pos-empty a.pos-btn--primary')?.getAttribute('href')).toBe('#/stock-items/new');
    m.unmount();
    m = mount();
    const readOnly = fakeApi(handler(undefined, false));
    await render(<StockItemList api={readOnly.api} branchIds={BRANCHES} />);
    expect(m.container.querySelector('.pos-btn--primary')).toBeNull();
  });
});

describe('[01c-S07] stock item form', () => {
  it('[S50 c] the back link goes through the unsaved-changes guard', async () => {
    const { api } = fakeApi(handler());
    window.location.hash = '#/stock-items/SI1';
    await form(api, 'SI1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Big pot');
    await click(m.container.querySelector<HTMLAnchorElement>('.pos-appbar a[href="#/stock-items"]')!);
    expect(window.location.hash).toBe('#/stock-items/SI1');
    expect(m.container.querySelector('[role="dialog"]')).not.toBeNull();
    await click(button(m.container.querySelector('[role="dialog"]')!, 'Discard changes'));
    expect(window.location.hash).toBe('#/stock-items');
  });

  it('an archived stock item shows its branch rows read-only', async () => {
    const { api } = fakeApi(handler());
    await form(api, 'SI3');
    await click(row('Gulberg').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    expect(row('Gulberg').querySelector<HTMLButtonElement>('button[role="switch"]')?.disabled).toBe(true);
  });

  it('a page Reload with an unsaved branch row asks first', async () => {
    const { api } = fakeApi(handler((call) => (call.method === 'PATCH' ? fail(409, 'CONFIG_STALE', { entity: 'stock_item', id: 'SI1' }) : undefined)));
    await form(api, 'SI1');
    await click(row('Johar Town').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    setValue(row('Johar Town').querySelector<HTMLInputElement>('input[name="low_stock_threshold"]'), '3');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Big pot');
    await click(button(m.container.querySelector('.pos-appbar')!, 'Save'));
    await click(button(m.container.querySelector('[data-stale]')!, 'Reload'));
    expect(m.container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(row('Johar Town').querySelector<HTMLInputElement>('input[name="low_stock_threshold"]')?.value).toBe('3');
  });

  it('new: Counted in defaults to piece; POST with an Idempotency-Key; the new stock item opens for its branch rows', async () => {
    const created = { ...DRINK, stock_item_id: 'SI7', name: 'Raita', stock_unit: 'piece' };
    const { api, calls } = fakeApi(handler((call) => (call.method === 'POST' ? ok({ stock_item: created }) : undefined)));
    await form(api, 'new');
    expect(m.container.querySelector('.pos-seg__opt[aria-pressed="true"]')?.textContent).toBe('piece');
    expect(m.container.querySelector('[data-branches] .pos-note')?.textContent).toBe('Create the stock item first. Then choose where it is counted.');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Raita');
    await click(m.container.querySelector<HTMLButtonElement>('button[role="switch"]')!);
    await click(button(m.container, 'Create stock item'));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post).toMatchObject({ url: '/v1/admin/stock-items', body: { name: 'Raita', stock_unit: 'piece', carries_over: true } });
    expect(post.key).toMatch(/^[0-9A-Z]{26}$/);
    expect(window.location.hash).toBe('#/stock-items/SI7');
  });

  it('edit: a unit change shows the notice before Save; PATCH sends expected_version and the change', async () => {
    const { api, calls } = fakeApi(handler((call) => (call.method === 'PATCH' ? ok({ stock_item: POT }) : undefined)));
    await form(api, 'SI1');
    expect(m.container.querySelector('[data-unit-notice]')).toBeNull();
    await click(button(m.container, 'piece'));
    const notice = m.container.querySelector('[data-unit-notice]')!;
    expect(notice.querySelector('p')?.firstChild?.textContent).toBe("New unit starts at each branch's next day open.");
    expect(notice.querySelector('small')?.textContent).toBe("Today's counts stay in g; count in piece from tomorrow.");
    await click(button(m.container, 'Save'));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/v1/admin/stock-items/SI1',
      body: { expected_version: 'v1', stock_unit: 'piece' },
    });
  });

  it('422 unit_mismatch at stock_unit: the Counted in field error and one summary banner', async () => {
    const { api } = fakeApi(
      handler((call) => (call.method === 'PATCH' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'stock_unit', reason: 'unit_mismatch' }) : undefined)),
    );
    await form(api, 'SI1');
    await click(button(m.container, 'piece'));
    await click(button(m.container, 'Save'));
    const unit = m.container.querySelector('#si-unit')!;
    expect(unit.classList.contains('pos-field--error')).toBe(true);
    expect(unit.querySelector('.pos-field__error')?.textContent).toBe('Some dishes use this stock in the old unit. Change those dishes first.');
    const summary = m.container.querySelectorAll('[data-fix-summary]');
    expect(summary).toHaveLength(1);
    expect(summary[0]?.querySelector('a')?.textContent).toBe('Counted in');
    // Picking the old unit again clears the field error and the summary with it.
    await click(button(m.container, 'g'));
    expect(m.container.querySelector('#si-unit')?.classList.contains('pos-field--error')).toBe(false);
    expect(m.container.querySelector('[data-fix-summary]')).toBeNull();
  });

  it('branch rows: chips when collapsed; the row Save shows only after a change and PUTs that row with its version', async () => {
    const saved = { branch_id: B2, station_id: 'S3', low_stock_threshold: 1500, version: 'r2b' };
    const { api, calls } = fakeApi(handler((call) => (call.method === 'PUT' ? ok({ branch: saved }) : undefined)));
    await form(api, 'SI1');
    expect([...row('Gulberg').querySelectorAll('.pos-chip')].map((c) => c.textContent)).toEqual(['Counted at Karahi counter', 'Alert below 1 kg']);
    expect(row('DHA').querySelector('.pos-chip')?.textContent).toBe('Not counted here');
    expect(m.container.querySelector('.pos-btn--row')).toBeNull();
    await click(row('Johar Town').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    setValue(row('Johar Town').querySelector<HTMLInputElement>('input[name="low_stock_threshold"]'), '1.5');
    expect(row('Johar Town').classList.contains('is-dirty')).toBe(true);
    expect(row('Johar Town').querySelector('.pos-input-affix span')?.textContent).toBe('kg');
    await click(row('Johar Town').querySelector<HTMLButtonElement>('.pos-btn--row')!);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put).toMatchObject({
      url: `/v1/admin/stock-items/SI1/branches/${B2}`,
      key: undefined,
      body: { expected_version: 'r2', station_id: 'S3', low_stock_threshold: 1500 },
    });
    expect(row('Johar Town').querySelector('.pos-btn--row')).toBeNull();
    expect(row('Johar Town').classList.contains('is-dirty')).toBe(false);
  });

  it('Counted here off sends station_id null and no threshold; the "no row" version is re-read', async () => {
    const { api, calls } = fakeApi(handler((call) => (call.method === 'PUT' ? ok({ branch: null }) : undefined)));
    await form(api, 'SI1');
    await click(row('Gulberg').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    await click(row('Gulberg').querySelector<HTMLButtonElement>('button[role="switch"]')!);
    expect(row('Gulberg').querySelector('select')).toBeNull();
    const reads = calls.filter((c) => c.url === '/v1/admin/stock-items').length;
    await click(row('Gulberg').querySelector<HTMLButtonElement>('.pos-btn--row')!);
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ expected_version: 'r1', station_id: null });
    expect(calls.filter((c) => c.url === '/v1/admin/stock-items').length).toBe(reads + 1);
  });

  it('409 CONFIG_STALE on a row: the banner shows in that row only, the draft stays, the page Save stays enabled', async () => {
    const { api } = fakeApi(handler((call) => (call.method === 'PUT' ? fail(409, 'CONFIG_STALE', { entity: 'stock_item_branch', id: 'SI1' }) : undefined)));
    await form(api, 'SI1');
    await click(row('DHA').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    await click(row('DHA').querySelector<HTMLButtonElement>('button[role="switch"]')!);
    setValue(row('DHA').querySelector<HTMLInputElement>('input[name="low_stock_threshold"]'), '2');
    await click(row('DHA').querySelector<HTMLButtonElement>('.pos-btn--row')!);
    expect(row('DHA').querySelector('[data-stale]')).not.toBeNull();
    expect(m.container.querySelectorAll('[data-stale]')).toHaveLength(1);
    expect(row('DHA').querySelector<HTMLInputElement>('input[name="low_stock_threshold"]')?.value).toBe('2');
    expect(button(m.container.querySelector('.pos-appbar')!, 'Save').disabled).toBe(false);
    await click(button(row('DHA'), 'Reload'));
    expect(row('DHA').querySelector('[data-stale]')).toBeNull();
    expect(row('DHA').querySelector('.pos-chip')?.textContent).toBe('Not counted here');
  });

  it('a row 422 station archived maps to the station field', async () => {
    const { api } = fakeApi(
      handler((call) => (call.method === 'PUT' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'station_id', reason: 'archived' }) : undefined)),
    );
    await form(api, 'SI1');
    await click(row('Gulberg').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    setValue(row('Gulberg').querySelector<HTMLSelectElement>('select[name="station_id"]'), 'S2');
    await click(row('Gulberg').querySelector<HTMLButtonElement>('.pos-btn--row')!);
    expect(row('Gulberg').querySelector('.pos-field--error .pos-field__error')?.textContent).toBe('This was archived. Pick another one.');
  });

  it('dishes that use it, each with Open; Archive blocked → 01c-D04 naming the dishes', async () => {
    const { api } = fakeApi(
      handler((call) =>
        call.method === 'PATCH'
          ? fail(409, 'CONFIG_IN_USE', { entity: 'stock_item', id: 'SI1', used_by: { entity: 'menu_item', ids: ['I1', 'I2', 'I8'] } })
          : undefined,
      ),
    );
    await form(api, 'SI1');
    const dishes = [...m.container.querySelectorAll('[data-dishes] .pos-list__row')];
    expect(dishes.map((d) => d.querySelector('.pos-list__name span')?.textContent)).toEqual(['Uses 0.5 kg a sale', 'Uses 1 kg a sale']);
    expect(dishes[0]?.querySelector('a')?.getAttribute('href')).toBe('#/menu?item=I1');
    await click(m.container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more')!);
    await click(button(m.container, 'Archive stock item'));
    const dialog = m.container.querySelector('[role="alertdialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe("Karahi pot can't be archived yet");
    expect(dialog.querySelectorAll('.pos-inuse__row')).toHaveLength(2);
    expect(dialog.querySelector('.pos-note')?.textContent).toBe('and 1 more');
  });

  it('404 STOCK_ITEM_NOT_FOUND replaces the form; 409 CONFIG_STALE keeps the draft and disables Save', async () => {
    let answer = fail(409, 'CONFIG_STALE', { entity: 'stock_item', id: 'SI1' });
    const { api } = fakeApi(handler((call) => (call.method === 'PATCH' ? answer : undefined)));
    await form(api, 'SI1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Big pot');
    await click(button(m.container, 'Save'));
    expect(m.container.querySelector('[data-stale]')).not.toBeNull();
    expect(m.container.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Big pot');
    expect(button(m.container.querySelector('.pos-appbar')!, 'Save').disabled).toBe(true);
    m.unmount();
    m = mount();
    answer = fail(404, 'STOCK_ITEM_NOT_FOUND');
    await form(api, 'SI1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Big pot');
    await click(button(m.container, 'Save'));
    expect(m.container.querySelector('.pos-gone h2')?.textContent).toBe("This stock item isn't here any more");
    expect(button(m.container, 'Back to Stock items')).toBeTruthy();
  });

  it('read-only (can_edit_tenant false): own fields disabled and no Save, but branch rows stay editable', async () => {
    const { api, calls } = fakeApi(handler((call) => (call.method === 'PUT' ? ok({ branch: { ...POT.branches[1], version: 'r2c', low_stock_threshold: 2000 } }) : undefined), false));
    await form(api, 'SI1');
    expect(m.container.querySelector<HTMLInputElement>('input[name="name"]')?.disabled).toBe(true);
    expect(m.container.querySelector('.pos-appbar .pos-btn--primary')).toBeNull();
    await click(row('Johar Town').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    setValue(row('Johar Town').querySelector<HTMLInputElement>('input[name="low_stock_threshold"]'), '2');
    await click(row('Johar Town').querySelector<HTMLButtonElement>('.pos-btn--row')!);
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ expected_version: 'r2', station_id: 'S3', low_stock_threshold: 2000 });
  });
});
