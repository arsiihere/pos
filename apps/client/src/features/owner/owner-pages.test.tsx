import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudAdmin, type MenuItem } from '../../api/cloud-admin';
import { fill } from '../../i18n/en';
import { t } from '../../i18n';
import { BranchPicker } from './BranchPicker';
import { BranchNames } from './branch';
import { FloorsView } from './floors/FloorsView';
import { GuardProvider } from './guard';
import { LoginView } from './login/LoginView';
import { ItemForm } from './menu/ItemForm';
import { MenuView } from './menu/MenuView';
import { shownRupees } from './money';
import { BranchSelect, Shell } from './Shell';
import { StationsView } from './stations/StationsView';

let container: HTMLDivElement;
let root: Root;

const USER = { user_id: 'U1', display_name: 'Arif', tenant_id: 'T1', allowed_branch_ids: ['01JB00000000000000000P0AB', '01JB00000000000000000M6PQ'] };
const [B1, B2] = USER.allowed_branch_ids as [string, string];

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  sessionStorage.setItem('owner_refresh_token', 'R1');
  sessionStorage.setItem('owner_user', JSON.stringify(USER));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface Call {
  method: string;
  url: string;
  body: unknown;
}

type Reply = Response | 'network';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function apiError(status: number, code: string, details: Record<string, unknown> = {}): Response {
  return json(status, { error: { code, message: 'server said no', details, request_id: 'R1' } });
}

function fakeApi(handler: (call: Call) => Reply | undefined) {
  const calls: Call[] = [];
  const api = createCloudAdmin({
    onLoggedOut: () => {},
    fetch: async (url, init) => {
      const call: Call = {
        method: init?.method ?? 'GET',
        url,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      };
      calls.push(call);
      const reply = handler(call) ?? defaults(call);
      if (reply === 'network') throw new TypeError('Failed to fetch');
      return reply;
    },
  });
  return { api, calls };
}

const PAYE: MenuItem = {
  item_id: 'I1',
  category_id: 'C1',
  tax_class_id: null,
  name: 'Paye',
  variant_group_id: null,
  variant_name: null,
  description: null,
  sort_order: 0,
  price_minor: 45_000,
  serve_mode: 'immediate',
  prep_buffer_ms: 0,
  cook_time_ms: 600_000,
  stock_time_ms: null,
  out_of_stock_behaviour: 'sold_out',
  sale_unit: 'piece',
  requires_weighing: false,
  stock_draws: [],
  availability_windows: [],
  archived_at: null,
  routes: [
    { branch_id: B1, station_id: 'S1', program_id: null, stock_program_id: null, price_minor_override: null },
    { branch_id: B2, station_id: 'S1', program_id: null, stock_program_id: null, price_minor_override: null },
  ],
};
const CATEGORY = { category_id: 'C1', name: 'Breakfast', sort_order: 1, archived_at: null, availability_windows: [] };
const TAX = { tax_class_id: 'X1', name: 'PRA cash', rate_bp: 1600, archived_at: null };
const SLOT = {
  station_id: 'S1',
  name: 'Tandoor',
  location_label: null,
  station_type: 'slot',
  capacity: 4,
  freshness_window_ms: null,
  completion_mode: 'two_tap',
  archived_at: null,
  programs: [],
};

function menuPage(items: MenuItem[], next: string | null = null) {
  return json(200, { data: { can_edit_tenant: true, tax_classes: [TAX], categories: [CATEGORY], variant_groups: [], items, next_cursor: next } });
}

function defaults(call: Call): Response {
  if (call.method === 'GET' && call.url.startsWith('/v1/admin/menu')) return menuPage([PAYE]);
  if (call.method === 'GET' && call.url.endsWith('/stations')) return json(200, { data: { stations: [SLOT] } });
  if (call.method === 'GET' && call.url.endsWith('/floors')) return json(200, { data: { floors: [] } });
  return json(200, { data: {} });
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms);
    else await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function render(node: ReactNode): void {
  act(() => root.render(<GuardProvider>{node}</GuardProvider>));
}

function button(label: string, within: ParentNode | null = container): HTMLButtonElement {
  // A tab's text is its label plus its count; match the label part too.
  const found = [...(within ?? container).querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label || b.childNodes[0]?.textContent === label,
  );
  if (!found) throw new Error(`button "${label}" missing`);
  return found;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
  await flush();
}

function typeInto(input: HTMLInputElement | null, text: string): void {
  if (!input) throw new Error('input missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]');

function itemForm(api: ReturnType<typeof fakeApi>['api'], onCancel = () => {}, onSaved = () => {}): ReactNode {
  return (
    <ItemForm
      api={api}
      item={PAYE}
      taxClasses={[TAX]}
      categories={[CATEGORY]}
      branchIds={USER.allowed_branch_ids}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  );
}

describe('owner pages (v1.1 design hand-off)', () => {
  it('[01a §10 #161 page part] archive asks first and names the thing; a table archives at once with an 8 s Undo; in-use shows what blocks it', async () => {
    // Item: the form's Archive item asks first; Cancel sends nothing.
    const item = fakeApi(() => undefined);
    render(itemForm(item.api));
    await flush();
    await click(button(t('item.archive')));
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Archive Paye?');
    expect(button('Archive Paye', dialog())).toBeTruthy();
    await click(button(t('common.cancel'), dialog()));
    expect(item.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

    // Category: confirm, then a 409 CONFIG_IN_USE shows the names, unresolved ids as "and N more".
    act(() => root.unmount());
    root = createRoot(container);
    const cat = fakeApi((call) =>
      call.method === 'PATCH' ? apiError(409, 'CONFIG_IN_USE', { used_by: { entity: 'menu_item', ids: ['I1', 'I404'] } }) : undefined,
    );
    render(<MenuView api={cat.api} />);
    await flush();
    await click(button(t('owner.menu.categories'), container.querySelector('.pos-seg')));
    await click(button(t('owner.common.archive'), container.querySelector('[data-category-id="C1"]')));
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Archive Breakfast?');
    await click(button(t('common.cancel'), dialog()));
    expect(cat.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    await click(button(t('owner.common.archive'), container.querySelector('[data-category-id="C1"]')));
    await click(button('Archive Breakfast', dialog()));
    expect(cat.calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/v1/admin/categories/C1', body: { archived: true } });
    expect(dialog()?.querySelector('h2')?.textContent).toBe("Breakfast can't be archived yet");
    expect(dialog()?.querySelector('[data-in-use]')?.textContent).toBe(`Paye${fill(t('archive.and_more'), { n: '1' })}`);
    expect(cat.calls.some((c) => c.url === '/v1/admin/menu?limit=200')).toBe(true);
    await click(button(t('common.close'), dialog()));

    // Tax class: confirm names it.
    await click(button(t('menu.tax_rates'), container.querySelector('.pos-seg')));
    await click(button(t('owner.common.archive'), container.querySelector('[data-tax-class-id="X1"]')));
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Archive PRA cash?');
    await click(button(t('common.cancel'), dialog()));

    // Station: confirm names it.
    act(() => root.unmount());
    root = createRoot(container);
    const st = fakeApi(() => undefined);
    render(<StationsView api={st.api} branchId={B1} />);
    await flush();
    await click(button(t('owner.common.edit'), container.querySelector('[data-station-id="S1"]')));
    // Pulse: Archive {station} is in the open station's More menu.
    await click(container.querySelector<HTMLButtonElement>('[data-station-id="S1"] button.pos-more') as HTMLButtonElement);
    await click(button('Archive Tandoor', container.querySelector('[data-station-id="S1"] [role="menu"]')));
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Archive Tandoor?');
    await click(button(t('common.cancel'), dialog()));
    expect(st.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

    // Floor with no tables: confirm. Table: at once, Undo within 8 s, then Undo refused by name.
    act(() => root.unmount());
    root = createRoot(container);
    vi.useFakeTimers();
    const table = { table_id: 'T7', name: 'T7', seats: 4, sort_order: 0, archived_at: null };
    let undoTaken = false;
    const fl = fakeApi((call) => {
      if (call.method === 'GET') {
        return json(200, {
          data: {
            floors: [
              { floor_id: 'F1', name: 'Ground', sort_order: 0, archived_at: null, tables: [table] },
              { floor_id: 'F2', name: 'Roof', sort_order: 1, archived_at: null, tables: [] },
            ],
          },
        });
      }
      if (undoTaken && (call.body as { archived?: boolean }).archived === false) return apiError(409, 'CONFIG_NAME_TAKEN');
      return undefined;
    });
    render(<FloorsView api={fl.api} branchId={B1} />);
    await flush();
    // Pulse: Archive {floor} is in the floor's More menu.
    await click(container.querySelector<HTMLButtonElement>('[data-floor-id="F2"] button.pos-more') as HTMLButtonElement);
    await click(button('Archive Roof', container.querySelector('[data-floor-id="F2"] [role="menu"]')));
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Archive Roof?');
    await click(button(t('common.cancel'), dialog()));

    const archiveTable = async () => {
      await click(container.querySelector<HTMLButtonElement>('[data-table-id="T7"]') as HTMLButtonElement);
      await click(button(t('owner.common.archive'), dialog()));
    };
    await archiveTable();
    expect(fl.calls.filter((c) => c.method === 'PATCH').map((c) => [c.url, c.body])).toEqual([
      [`/v1/admin/branches/${B1}/tables/T7`, { archived: true }],
    ]);
    await click(button(t('common.undo')));
    expect(fl.calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ archived: false });

    await archiveTable();
    expect(container.textContent).toContain(t('archive.archived'));
    await flush(8_000);
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === t('common.undo'))).toBe(false);

    undoTaken = true;
    await archiveTable();
    await click(button(t('common.undo')));
    expect(container.querySelector('.pos-banner--danger')?.textContent).toBe(
      fill(t('errors.CONFIG_NAME_TAKEN_table'), { name: 'T7', branch: '…P0AB' }),
    );
  });

  it('[01a §10 #162] the discard guard: Cancel, Back, a menu item, the branch select and Sign out ask first; an unchanged form leaves at once', async () => {
    const { api } = fakeApi(() => undefined);
    const onCancel = vi.fn();
    const signOut = vi.fn();
    const onBranch = vi.fn();
    render(
      <Shell route="/menu" userName="Arif" onSignOut={signOut}>
        <BranchSelect branchIds={USER.allowed_branch_ids} value={B1} onChange={onBranch} />
        {itemForm(api, onCancel)}
      </Shell>,
    );
    await flush();

    // Unchanged: Cancel leaves with no question.
    await click(button(t('owner.common.cancel')));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();

    typeInto(container.querySelector<HTMLInputElement>('input[name="price"]'), '500');
    typeInto(container.querySelector<HTMLInputElement>('input[name="cook_minutes"]'), '12');
    const ask = async (leave: () => Promise<void>) => {
      await leave();
      expect(dialog()?.querySelector('h2')?.textContent).toBe('Discard your changes to Paye?');
      expect(dialog()?.textContent).toContain('You changed the price and the cooking time.');
      await click(button(t('discard.keep'), dialog()));
      expect(dialog()).toBeNull();
    };
    await ask(() => click(button(t('owner.common.cancel'))));
    await ask(() => click(container.querySelector<HTMLAnchorElement>('.pos-appbar a[href="#/menu"]') as HTMLElement));
    await ask(() => click(container.querySelector<HTMLAnchorElement>('.pos-sidenav a[href="#/floors"]') as HTMLElement));
    await ask(async () => {
      const select = container.querySelector<HTMLSelectElement>('select[name="branch"]');
      await act(async () => {
        if (!select) return;
        select.value = B2;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    await ask(() => click(button(t('owner.sign_out'))));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onBranch).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('input[name="price"]')?.value).toBe('500');

    await click(button(t('owner.common.cancel')));
    await click(button(t('discard.discard'), dialog()));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('[01a §10 #164 item part] the Kitchen section has one row per allowed branch, labelled with the ID tail', async () => {
    const { api } = fakeApi(() => undefined);
    render(itemForm(api));
    await flush();
    const rows = [...container.querySelectorAll<HTMLElement>('[data-route-branch]')];
    expect(rows.map((r) => r.dataset['routeBranch'])).toEqual([B1, B2]);
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['…P0AB', '…M6PQ']);
  });

  it('[01a §10 #165 page part] a failed save keeps the typed price and disables Save; the probe clears the banner; nothing is re-sent', async () => {
    vi.useFakeTimers();
    let down = false;
    let probes = 0;
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'PATCH') return 'network';
      if (down && call.method === 'GET') {
        probes += 1;
        return probes === 1 ? 'network' : undefined;
      }
      return undefined;
    });
    render(itemForm(api));
    await flush();
    typeInto(container.querySelector<HTMLInputElement>('input[name="price"]'), '35');
    down = true;
    const save = () => button(t('item.save'));
    await click(save());
    expect(container.querySelector('.pos-banner--warn')?.textContent).toContain(t('common.cloud_down'));
    expect(save().disabled).toBe(true);
    await flush(500);
    expect(container.querySelector('.pos-banner--warn')?.textContent).toContain(t('common.cloud_down'));
    await flush(1_000);
    expect(container.querySelector('.pos-banner--warn')).toBeNull();
    expect(save().disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[name="price"]')?.value).toBe('35');
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(3);

    // The banner shows on Floors, Stations and Menu too; their add dialogs cannot save while it shows.
    const views: [(a: typeof api) => ReactNode, string | null][] = [
      [(a) => <FloorsView api={a} branchId={B1} />, t('owner.floors.add_floor')],
      [(a) => <StationsView api={a} branchId={B1} />, t('owner.stations.add_station')],
      [(a) => <MenuView api={a} />, null],
    ];
    for (const [view, add] of views) {
      act(() => root.unmount());
      root = createRoot(container);
      render(view(fakeApi(() => 'network').api));
      await flush();
      expect(container.querySelector('.pos-banner--warn')?.textContent).toContain(t('common.cloud_down'));
      if (add === null) continue;
      await click(button(add, container.querySelector('.pos-appbar')));
      expect(container.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')?.disabled).toBe(true);
    }

    // Login: the banner shows and Sign in stays enabled.
    act(() => root.unmount());
    root = createRoot(container);
    const login = fakeApi(() => 'network');
    render(<LoginView api={login.api} onLoggedIn={() => {}} />);
    typeInto(container.querySelector<HTMLInputElement>('input[type="email"]'), 'o@example.com');
    typeInto(container.querySelector<HTMLInputElement>('input[type="password"]'), 'password1');
    await act(async () => container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(container.querySelector('.pos-banner--warn')?.textContent).toContain(t('owner.login.cloud_down'));
    expect(button(t('owner.login.submit')).disabled).toBe(false);
  });

  it('[01a §10 #170] Saved for 3 s; no item total until the last page; no counts on the picker; the phone price page; a partial save re-sends only the failed branch', async () => {
    // Saved chip after a floor rename, gone after 3 s.
    vi.useFakeTimers();
    const fl = fakeApi((call) =>
      call.method === 'GET'
        ? json(200, { data: { floors: [{ floor_id: 'F1', name: 'Ground', sort_order: 0, archived_at: null, tables: [] }] } })
        : undefined,
    );
    render(<FloorsView api={fl.api} branchId={B1} />);
    await flush();
    await click(container.querySelector<HTMLButtonElement>('[data-floor-id="F1"] button.pos-more') as HTMLButtonElement);
    await click(button(t('floors.rename'), container.querySelector('[data-floor-id="F1"] [role="menu"]')));
    const name = container.querySelector<HTMLInputElement>('[data-floor-id="F1"] input[name="name"]');
    typeInto(name, 'Hall');
    act(() => name?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await flush();
    expect(container.querySelector('[data-floor-id="F1"] .pos-chip--ok')?.textContent).toBe(t('common.saved'));
    await flush(3_000);
    expect(container.querySelector('[data-floor-id="F1"] .pos-chip--ok')).toBeNull();
    vi.useRealTimers();

    // The Items tab shows a total only once next_cursor is null.
    act(() => root.unmount());
    root = createRoot(container);
    let next: string | null = 'c2';
    const menu = fakeApi((call) => (call.method === 'GET' ? menuPage([PAYE], next) : undefined));
    render(<MenuView api={menu.api} />);
    await flush();
    const itemsTab = () => button(t('owner.menu.items'), container.querySelector('.pos-seg'));
    expect(itemsTab().querySelector('.pos-seg__count')).toBeNull();
    next = null;
    await click(button(t('owner.menu.load_more')));
    expect(itemsTab().querySelector('.pos-seg__count')?.textContent).toBe('1');

    // The branch picker shows the ID tail and nothing else.
    act(() => root.unmount());
    root = createRoot(container);
    render(<BranchPicker branchIds={USER.allowed_branch_ids} selectedId={null} userName="Arif" onContinue={() => {}} onSignOut={() => {}} />);
    expect([...container.querySelectorAll('[data-branch-id]')].map((b) => b.textContent)).toEqual(['…P0AB', '…M6PQ']);

    // Phone: price first, "On sale at 1 of 2 branches" as text, no switch.
    act(() => root.unmount());
    root = createRoot(container);
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 760px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const phone = fakeApi(() => undefined);
    act(() =>
      root.render(
        <GuardProvider>
          <ItemForm
            api={phone.api}
            item={{ ...PAYE, routes: PAYE.routes.slice(0, 1) }}
            taxClasses={[TAX]}
            categories={[CATEGORY]}
            branchIds={USER.allowed_branch_ids}
            onSaved={() => {}}
            onCancel={() => {}}
          />
        </GuardProvider>,
      ),
    );
    await flush();
    const form = container.querySelector('form');
    expect(form?.querySelector('[name]')?.getAttribute('name')).toBe('price');
    expect(container.querySelector('[data-on-sale]')?.textContent).toBe('1 of 2 branches');
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.textContent).toContain(fill(t('item.price_was'), { old: '450' }));
    expect(button(t('item.save_price'))).toBeTruthy();
    vi.unstubAllGlobals();

    // Partial save: the PATCH saves, B2's route PUT fails; Save B2 again sends only that PUT.
    act(() => root.unmount());
    root = createRoot(container);
    let failB2 = true;
    const part = fakeApi((call) => {
      if (call.method === 'PUT' && call.url.endsWith(`/routes/${B2}`) && failB2) {
        failB2 = false;
        return apiError(422, 'CONFIG_REFERENCE_INVALID', { field: 'station_id', reason: 'wrong_branch' });
      }
      return undefined;
    });
    const onSaved = vi.fn();
    render(itemForm(part.api, () => {}, onSaved));
    await flush();
    typeInto(container.querySelector<HTMLInputElement>('input[name="price"]'), '500');
    for (const b of [B1, B2]) {
      const select = container.querySelector<HTMLSelectElement>(`[data-route-branch="${b}"] select[name="station_id"]`);
      await act(async () => {
        if (!select) return;
        select.value = '';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    await click(button(t('item.save')));
    const writes = () => part.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);
    expect(writes()).toEqual(['PATCH /v1/admin/menu-items/I1', `PUT /v1/admin/menu-items/I1/routes/${B1}`, `PUT /v1/admin/menu-items/I1/routes/${B2}`]);
    expect(container.querySelector('.pos-banner--warn')?.textContent).toContain(t('item.partial'));
    expect(container.querySelector(`[data-route-branch="${B2}"]`)?.className).toContain('pos-field--error');
    expect(container.textContent).toContain(t('errors.reference.wrong_branch'));
    expect(onSaved).not.toHaveBeenCalled();
    await click(button(fill(t('item.save_branch_again'), { branch: '…M6PQ' })));
    expect(writes().slice(3)).toEqual([`PUT /v1/admin/menu-items/I1/routes/${B2}`]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
  it('[01a §10 #179] Price here per branch: placeholder, PUT override and null, Not sold here disables it, a bad price and a refused PUT mark that row; a new item POSTs it; the menu chip names the branch', async () => {
    const names = new Map([
      [B1, 'Gulberg'],
      [B2, 'Johar Town'],
    ]);
    let refuse = false;
    const { api, calls } = fakeApi((call) => (refuse && call.method === 'PUT' ? apiError(400, 'VALIDATION_FAILED') : undefined));
    render(<BranchNames.Provider value={names}>{itemForm(api)}</BranchNames.Provider>);
    await flush();
    const row = (b: string) => container.querySelector<HTMLElement>(`[data-route-branch="${b}"]`);
    const priceAt = (b: string) => row(b)?.querySelector<HTMLInputElement>('input[name="price_minor_override"]') ?? null;
    const stationAt = (b: string) => row(b)?.querySelector<HTMLSelectElement>('select[name="station_id"]') ?? null;
    const puts = () => calls.filter((c) => c.method === 'PUT');
    const choose = async (select: HTMLSelectElement | null, value: string) =>
      act(async () => {
        if (!select) return;
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });

    expect(row(B1)?.querySelector('strong')?.textContent).toBe('Gulberg');
    expect(priceAt(B1)?.placeholder).toBe(fill(t('item.price_same'), { price: shownRupees(PAYE.price_minor) }));
    typeInto(priceAt(B1), '700');
    await click(button(t('item.save')));
    expect(puts()).toEqual([
      {
        method: 'PUT',
        url: `/v1/admin/menu-items/${PAYE.item_id}/routes/${B1}`,
        body: { station_id: 'S1', program_id: null, stock_program_id: null, price_minor_override: 70_000 },
      },
    ]);

    typeInto(priceAt(B1), '');
    await click(button(t('item.save')));
    expect(puts()).toHaveLength(2);
    expect(puts()[1]?.body).toMatchObject({ price_minor_override: null });

    await choose(stationAt(B2), '');
    expect(priceAt(B2)?.disabled).toBe(true);
    expect(priceAt(B2)?.placeholder).toBe(t('owner.item.not_sold_here'));
    await choose(stationAt(B2), 'S1');
    expect(priceAt(B2)?.disabled).toBe(false);

    typeInto(priceAt(B1), '7x');
    await click(button(t('item.save')));
    expect(puts()).toHaveLength(2);
    expect(row(B1)?.classList.contains('pos-field--error')).toBe(true);
    expect(row(B1)?.textContent).toContain(t('item.need_price'));

    typeInto(priceAt(B1), '800');
    refuse = true;
    await click(button(t('item.save')));
    expect(puts()).toHaveLength(3);
    expect(row(B1)?.classList.contains('pos-field--error')).toBe(true);
    expect(row(B2)?.classList.contains('pos-field--error')).toBe(false);

    act(() => root.unmount());
    root = createRoot(container);
    const fresh = fakeApi(() => undefined);
    render(
      <BranchNames.Provider value={names}>
        <ItemForm
          api={fresh.api}
          item={null}
          taxClasses={[TAX]}
          categories={[CATEGORY]}
          branchIds={USER.allowed_branch_ids}
          onSaved={() => {}}
          onCancel={() => {}}
        />
      </BranchNames.Provider>,
    );
    await flush();
    typeInto(container.querySelector<HTMLInputElement>('input[name="name"]'), 'Halwa Puri');
    typeInto(container.querySelector<HTMLInputElement>('input[name="price"]'), '300');
    typeInto(container.querySelector<HTMLInputElement>('input[name="cook_minutes"]'), '5');
    await choose(stationAt(B1), 'S1');
    typeInto(priceAt(B1), '350');
    await click(button(t('item.add')));
    const post = fresh.calls.find((c) => c.method === 'POST');
    expect((post?.body as { routes: unknown[] }).routes).toEqual([
      { branch_id: B1, station_id: 'S1', program_id: null, stock_program_id: null, price_minor_override: 35_000 },
    ]);

    act(() => root.unmount());
    root = createRoot(container);
    const withOverride: MenuItem = {
      ...PAYE,
      routes: [
        { branch_id: B1, station_id: 'S1', program_id: null, stock_program_id: null, price_minor_override: null },
        { branch_id: B2, station_id: 'S1', program_id: null, stock_program_id: null, price_minor_override: 230_000 },
      ],
    };
    const menu = fakeApi((call) => (call.method === 'GET' && call.url.startsWith('/v1/admin/menu') ? menuPage([withOverride]) : undefined));
    render(
      <BranchNames.Provider value={names}>
        <MenuView api={menu.api} />
      </BranchNames.Provider>,
    );
    await flush();
    const chips = [...container.querySelectorAll(`[data-item-id="${PAYE.item_id}"]`)]
      .map((name) => name.closest('.pos-list__row'))
      .flatMap((r) => [...(r?.querySelectorAll('.pos-chip') ?? [])].map((c) => c.textContent));
    expect(chips).toContain('Johar Town Rs 2,300');
    expect(chips.some((c) => c?.startsWith('Gulberg'))).toBe(false);
  });
});
