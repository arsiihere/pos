import type { HubConfigStatus, HubStockAnswer, HubStockDrawer, HubStockItem, HubStockItemMeta, HubStockRow, HubStockRowMeta } from '@pos/events';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHubAdmin } from '../../../api/hub-admin';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { draftKey } from './draft';
import { StockApp } from './StockApp';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

const HOUR = 3_600_000;
const OFFSET = 5 * HOUR;
const hubAt = (h: number, m = 0) => Date.UTC(2026, 9, 25, h, m) - OFFSET;
const OPENED = hubAt(6);

function meta(itemId: string, o: Partial<HubStockItemMeta> = {}): HubStockItemMeta {
  return {
    item_id: itemId,
    name: `Item ${itemId}`,
    group_label: null,
    category_id: 'C1',
    category_name: 'Mains',
    is_stock_tracked: true,
    out_of_stock_behaviour: 'cook_fresh',
    stock_item_ids: [itemId],
    item_windows: [],
    category_windows: [],
    ...o,
  };
}

function item(itemId: string, o: Partial<HubStockItem> = {}): HubStockItem {
  return { item_id: itemId, stock_item_ids: [itemId], is_available: true, unavailable_since: null, ...o };
}

// 01c §6.21: a stock item with the item's id, drawn by that item (the V1 view's shape).
function drawer(itemId: string, o: Partial<HubStockDrawer> = {}): HubStockDrawer {
  return { item_id: itemId, name: `Item ${itemId}`, variant_name: null, sale_unit: 'piece', quantity_per_sale_unit: 1, ...o };
}

function stockMeta(stockItemId: string, o: Partial<HubStockRowMeta> = {}): HubStockRowMeta {
  return {
    stock_item_id: stockItemId,
    name: `Item ${stockItemId}`,
    stock_unit: 'piece',
    carries_over: false,
    station_id: 'ST1',
    low_stock_threshold: null,
    has_tracked_drawers: true,
    drawers: [drawer(stockItemId)],
    ...o,
  };
}

function stockNumbers(stockItemId: string, o: Partial<HubStockRow> = {}): HubStockRow {
  return { stock_item_id: stockItemId, on_hand: 5, reserved: 0, unit: 'piece', available: 5, level: 'ok', set_at: hubAt(9, 5), ...o };
}

function answer(o: Partial<HubStockAnswer> = {}): HubStockAnswer {
  return {
    unchanged: false,
    manage_stock_scope: 'branch',
    config_version: 42,
    meta_version: '42.1',
    stock_version: 7,
    hub_time: { now_ms: hubAt(11), utc_offset_ms: OFFSET },
    hub_local_date: '2026-10-25',
    business_day: { business_date: '2026-10-25', opened_at: OPENED, closed_at: null },
    business_day_started_at: OPENED,
    day_stale: false,
    day_stale_after_hours: 16,
    day_min_gap_hours: 4,
    stock_items_meta: [stockMeta('I1'), stockMeta('I2')],
    stock: [stockNumbers('I1'), stockNumbers('I2')],
    items_meta: [meta('I1'), meta('I2')],
    items: [item('I1'), item('I2')],
    ...o,
  };
}

const STATUS: HubConfigStatus = {
  tenant_id: 'T1',
  branch_id: '01JB00000000000000000P0AB',
  config_version: 42,
  snapshot_schema_version: 1,
  applied_at: hubAt(8),
  directory_version: 2,
  last_poll: { outcome: 'applied', at: hubAt(11) },
  last_problem: null,
};
const BRANCH = STATUS.branch_id as string;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Sent {
  url: string;
  body: Record<string, unknown> | undefined;
}

type Route = (sent: Sent) => Response | 'offline' | undefined;

function signIn(staffId = 'S_MGR', name = 'Imran'): void {
  sessionStorage.setItem('admin_session_token', 'AS1');
  sessionStorage.setItem('admin_staff_id', staffId);
  sessionStorage.setItem('admin_name', name);
}

function fakeHub(stock: () => HubStockAnswer | 'offline', route: Route = () => undefined) {
  const sent: Sent[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>);
    const s = { url, body };
    sent.push(s);
    const custom = route(s);
    if (custom === 'offline') throw new TypeError('network');
    if (custom !== undefined) return custom;
    if (url.startsWith('/admin/queries/config-status')) return json(200, { data: STATUS });
    if (url.startsWith('/admin/queries/stock')) {
      const next = stock();
      if (next === 'offline') throw new TypeError('network');
      return json(200, { data: next });
    }
    if (url.startsWith('/admin/commands/')) return json(200, { data: { result: { items: [] } } });
    if (url === '/admin/auth/logout') return json(200, { data: { session_id: 'SES1', ended_at: 1, already_ended: false } });
    throw new Error(`no route for ${url}`);
  });
  const api = createHubAdmin({ fetch: fetchFn, readDeviceToken: async () => 'DT1', readDeviceId: async () => 'D1', onSignedOut: () => {} });
  return { api, sent };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

async function mount(api: ReturnType<typeof fakeHub>['api']): Promise<void> {
  act(() => root.render(<StockApp api={api} />));
  await flush();
  await flush();
}

async function remount(api: ReturnType<typeof fakeHub>['api']): Promise<void> {
  act(() => root.unmount());
  root = createRoot(container);
  await mount(api);
}

const rowOf = (id: string) => {
  const row = container.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
  if (row === null) throw new Error(`row ${id} missing`);
  return row;
};
// 01c §8: one row per stock item (count, add, level); the menu item rows carry the Selling switch.
const stockRowOf = (id: string) => {
  const row = container.querySelector<HTMLElement>(`[data-stock-item-id="${id}"]`);
  if (row === null) throw new Error(`stock row ${id} missing`);
  return row;
};
const count = (id: string) => stockRowOf(id).querySelector<HTMLInputElement>('[data-field="on_hand"] input');

function typeInto(input: HTMLInputElement | null, text: string): void {
  if (!input) throw new Error('input missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function button(label: string, within: ParentNode | null = container): HTMLButtonElement {
  const found = [...(within ?? container).querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label || b.childNodes[0]?.textContent === label,
  );
  if (!found) throw new Error(`button "${label}" missing`);
  return found;
}

async function tap(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
  await flush();
  await flush();
}

const saveButton = () => container.querySelector<HTMLButtonElement>('[data-save] button') as HTMLButtonElement;
const commandsTo = (sent: Sent[], name: string) => sent.filter((s) => s.url === `/admin/commands/${name}`);
const keyFor = (staff = 'S_MGR', opened = OPENED) => draftKey(BRANCH, opened, staff);

function stubPhone(phone: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && query === '(max-width: 760px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('/admin/stock (v1.1 design hand-off)', () => {
  it('[01a §10 #166] kept counts: written per staff and day, restored for the same person and day only, never over a newer count', async () => {
    signIn();
    let stock = answer();
    const { api } = fakeHub(() => stock);
    await mount(api);

    typeInto(count('I1'), '7');
    const kept = JSON.parse(localStorage.getItem(keyFor()) ?? 'null') as { entries: unknown[] };
    expect(kept.entries).toEqual([{ stock_item_id: 'I1', on_hand: 7, unit: 'piece', base_set_at: hubAt(9, 5) }]);

    // Same person, same day: back as touched with the banner.
    await remount(api);
    expect(count('I1')?.value).toBe('7');
    expect(container.querySelector('[data-kept]')?.textContent).toContain(fill(t('admin_stock.kept.title'), { n: '1', time: '11:00' }));
    expect(stockRowOf('I1').textContent).toContain(t('admin_stock.kept.not_saved_yet'));

    // Another person: nothing comes back, the draft stays.
    signIn('S_OTHER', 'Bilal');
    await remount(api);
    expect(count('I1')?.value).toBe('5');
    expect(localStorage.getItem(keyFor())).not.toBeNull();

    // Someone added to I1 since: not restored, listed as changed.
    signIn();
    stock = answer({ stock: [stockNumbers('I1', { set_at: hubAt(10), on_hand: 9 }), stockNumbers('I2')] });
    await remount(api);
    expect(count('I1')?.value).toBe('9');
    expect(container.querySelector('[data-kept]')?.textContent).toContain('Item I1 (9)');

    // An entry for a stock item no longer counted here is dropped.
    localStorage.setItem(
      keyFor(),
      JSON.stringify({ saved_at: hubAt(10), entries: [{ stock_item_id: 'I9', on_hand: 3, unit: 'piece', base_set_at: null }] }),
    );
    stock = answer();
    await remount(api);
    expect(container.querySelector('[data-kept]')).toBeNull();

    // A new day on the same date: nothing restored, the old draft deleted.
    localStorage.setItem(
      keyFor(),
      JSON.stringify({ saved_at: hubAt(10), entries: [{ stock_item_id: 'I1', on_hand: 3, unit: 'piece', base_set_at: hubAt(9, 5) }] }),
    );
    stock = answer({ business_day: { business_date: '2026-10-25', opened_at: hubAt(15), closed_at: null }, business_day_started_at: hubAt(15) });
    await remount(api);
    expect(count('I1')?.value).toBe('5');
    expect(localStorage.getItem(keyFor())).toBeNull();

    // No day open: typing writes nothing.
    stock = answer({ business_day: { business_date: '2026-10-25', opened_at: OPENED, closed_at: hubAt(10) }, business_day_started_at: null });
    await remount(api);
    typeInto(count('I1'), '4');
    expect(Object.keys(localStorage).filter((k) => k.startsWith('stock-draft:'))).toEqual([]);

    // Deleted on a successful save, and on Discard.
    stock = answer();
    await remount(api);
    typeInto(count('I1'), '6');
    expect(localStorage.getItem(keyFor())).not.toBeNull();
    await tap(saveButton());
    expect(localStorage.getItem(keyFor())).toBeNull();
    typeInto(count('I2'), '2');
    await remount(api);
    await tap(button(t('admin_stock.kept.discard'), container.querySelector('[data-kept]')));
    expect(localStorage.getItem(keyFor())).toBeNull();
    expect(count('I2')?.value).toBe('5');

    // A storage that throws is ignored.
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    await remount(api);
    typeInto(count('I1'), '8');
    expect(count('I1')?.value).toBe('8');
  });

  it('[01a §10 #167] All N are still right: one save with the shown carried-over counts and the typed one; over 200 rows in parts', { timeout: 30_000 }, async () => {
    signIn();
    const carried = (id: string, onHand: number) => ({ m: stockMeta(id, { carries_over: true }), s: stockNumbers(id, { set_at: hubAt(1), on_hand: onHand }) });
    const rows = [carried('I1', 8), carried('I2', 12), carried('I3', 20), { m: stockMeta('I4'), s: stockNumbers('I4', { set_at: null, level: 'not_counted' }) }];
    const ids = ['I1', 'I2', 'I3', 'I4'];
    const { api, sent } = fakeHub(() =>
      answer({ stock_items_meta: rows.map((r) => r.m), stock: rows.map((r) => r.s), items_meta: ids.map((id) => meta(id)), items: ids.map((id) => item(id)) }),
    );
    await mount(api);

    expect(container.querySelector('[data-carry]')?.textContent).toContain(fill(t('admin_stock.carry.title'), { n: '3' }));
    typeInto(count('I2'), '9');
    expect(container.querySelector('[data-carry]')?.textContent).toContain(fill(t('admin_stock.carry.all'), { n: '2' }));
    await tap(button(fill(t('admin_stock.carry.all'), { n: '2' })));
    const saves = commandsTo(sent, 'set-precooked-stock');
    expect(saves).toHaveLength(1);
    expect(saves[0]?.body?.['payload']).toEqual({
      entries: [
        { stock_item_id: 'I1', on_hand: 8 },
        { stock_item_id: 'I2', on_hand: 9 },
        { stock_item_id: 'I3', on_hand: 20 },
      ],
    });
    // The callout hides once every carried-over row is touched (the fake hub still answers the old counts).
    for (const id of ['I1', 'I2']) typeInto(count(id), '1');
    expect(container.querySelector('[data-carry]')).not.toBeNull();
    typeInto(count('I3'), '1');
    expect(container.querySelector('[data-carry]')).toBeNull();

    // 201 touched rows → 200 + 1, each with its own command_id; the failed part keeps its row and id.
    act(() => root.unmount());
    root = createRoot(container);
    const many = Array.from({ length: 201 }, (_, i) => `M${String(i).padStart(3, '0')}`);
    let failSecond = true;
    const big = fakeHub(
      () =>
        answer({
          stock_items_meta: many.map((id) => stockMeta(id, { carries_over: true })),
          stock: many.map((id) => stockNumbers(id, { set_at: hubAt(1) })),
          items_meta: many.map((id) => meta(id)),
          items: many.map((id) => item(id)),
        }),
      (s) => {
        if (s.url !== '/admin/commands/set-precooked-stock') return undefined;
        const entries = (s.body?.['payload'] as { entries: unknown[] }).entries;
        if (entries.length === 1 && failSecond) {
          failSecond = false;
          return 'offline';
        }
        return undefined;
      },
    );
    await mount(big.api);
    await tap(button(fill(t('admin_stock.carry.all'), { n: '201' })));
    const parts = commandsTo(big.sent, 'set-precooked-stock');
    expect(parts.map((p) => (p.body?.['payload'] as { entries: unknown[] }).entries.length)).toEqual([200, 1]);
    expect(parts[0]?.body?.['command_id']).not.toBe(parts[1]?.body?.['command_id']);
    expect(stockRowOf('M200').className).toContain('is-touched');
    expect(stockRowOf('M000').className).not.toContain('is-touched');
    await tap(saveButton());
    const again = commandsTo(big.sent, 'set-precooked-stock');
    expect(again).toHaveLength(3);
    expect(again[2]?.body?.['command_id']).toBe(parts[1]?.body?.['command_id']);
  });

  it('[01a §10 #168] the words, the Selling switch, the level filter with the category filter, a low chip focusing its row, the stale buttons', async () => {
    signIn();
    const items_meta = [
      meta('I1', { name: 'Karahi' }),
      meta('I2', { name: 'Paye', category_id: 'C2', category_name: 'Breakfast' }),
      meta('I3', { name: 'Raita', is_stock_tracked: false, stock_item_ids: [] }),
    ];
    const items = [item('I1'), item('I2'), item('I3', { stock_item_ids: [], is_available: false })];
    const stock_items_meta = [
      stockMeta('I1', { name: 'Karahi', drawers: [drawer('I1', { name: 'Karahi' })] }),
      stockMeta('I2', { name: 'Paye', drawers: [drawer('I2', { name: 'Paye' })] }),
    ];
    const numbers = [stockNumbers('I1', { level: 'low', available: 2, reserved: 1 }), stockNumbers('I2', { set_at: null, level: 'not_counted', available: 0 })];
    const { api } = fakeHub(() => answer({ stock_items_meta, stock: numbers, items_meta, items, day_stale: true }));
    await mount(api);

    expect(stockRowOf('I1').querySelector('.pos-list__num')?.textContent).toBe('2');
    expect(stockRowOf('I1').textContent).toContain(fill(t('admin_stock.on_orders'), { n: '1' }));
    expect(button(t('admin_stock.confirm'), stockRowOf('I1'))).toBeTruthy();
    expect(container.textContent).not.toContain('Available');
    const sw = rowOf('I3').querySelector('[role="switch"]');
    expect(sw?.getAttribute('aria-checked')).toBe('false');
    expect(sw?.getAttribute('aria-label')).toBe(`${t('admin_stock.col.selling')}: Raita`);

    const seg = container.querySelector('.pos-seg[aria-label="Show"]');
    const counts = [...(seg?.querySelectorAll('.pos-seg__count') ?? [])].map((c) => c.textContent);
    expect(counts).toEqual(['1', '1', '1', '3']);
    const shown = () => [...container.querySelectorAll<HTMLElement>('[data-item-id]')].map((r) => r.dataset['itemId']);
    await tap(button(t('admin_stock.filter.to_count'), seg));
    expect(shown()).toEqual(['I2']);
    await tap(button(t('admin_stock.filter.off'), seg));
    expect(shown()).toEqual(['I3']);
    await tap(button(t('admin_stock.filter.all'), seg));
    const category = container.querySelector<HTMLSelectElement>(`select[aria-label="${t('admin_stock.category')}"]`);
    await act(async () => {
      if (!category) return;
      category.value = 'C2';
      category.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(shown()).toEqual(['I2']);
    expect([...(seg?.querySelectorAll('.pos-seg__count') ?? [])].map((c) => c.textContent)).toEqual(['1', '0', '0', '1']);

    // The low chip shows every row again and focuses Karahi's count.
    await tap(container.querySelector<HTMLButtonElement>('[data-alert-bar] button') as HTMLButtonElement);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(shown()).toEqual(['I1', 'I2', 'I3']);
    expect(document.activeElement).toBe(count('I1'));

    const stale = container.querySelector('[data-stale-prompt]');
    expect(button(t('admin_stock.stale.close_and_start'), stale).textContent).toBe('Close it and start today');
    expect(button(t('admin_stock.stale.keep'), stale).textContent).toBe('Keep it open');
  });

  it('[01a §10 #171] phone add sheet in the display unit; sign-in: nobody, locked minutes, tries left, Retry now, no stock job', async () => {
    // Phone: +5 on a kg item sends 5 000 g.
    stubPhone(true);
    signIn();
    const { api, sent } = fakeHub(() =>
      answer({
        stock_items_meta: [stockMeta('I1', { name: 'Karahi', stock_unit: 'g', drawers: [drawer('I1', { name: 'Karahi', quantity_per_sale_unit: 250 })] })],
        stock: [stockNumbers('I1', { unit: 'g', on_hand: 3000, available: 3000 })],
        items_meta: [meta('I1', { name: 'Karahi' })],
        items: [item('I1')],
      }),
    );
    await mount(api);
    // 01c §8: the drawer under the stock row, with its sale units available (3 000 g at 250 g a piece).
    expect(rowOf('I1').querySelector('.pos-list__num')?.textContent).toBe('12');
    await tap(button(t('admin_stock.add'), stockRowOf('I1')));
    const sheet = container.querySelector('.pos-sheet');
    expect(sheet?.getAttribute('role')).toBe('dialog');
    await tap(button('+5', sheet));
    expect(sheet?.textContent).toContain(fill(t('admin_stock.sheet.after'), { left: '8 kg' }));
    await tap(button(fill(t('admin_stock.sheet.add_n'), { n: '5 kg' }), sheet));
    expect(commandsTo(sent, 'add-precooked-stock')[0]?.body?.['payload']).toEqual({ entries: [{ stock_item_id: 'I1', quantity: 5000 }] });
    vi.unstubAllGlobals();

    // Sign-in states.
    sessionStorage.clear();
    let roster: Response | 'offline' = json(200, { data: { staff: [] } });
    let pinReply: () => Response = () => json(500, {});
    const login = fakeHub(() => answer(), (s) => {
      if (s.url === '/admin/login-roster') return roster;
      if (s.url === '/admin/auth') return pinReply();
      return undefined;
    });
    await remount(login.api);
    expect(container.textContent).toContain(t('admin_stock.login.no_admins'));

    roster = 'offline';
    await remount(login.api);
    expect(container.textContent).toContain(t('admin_stock.login.offline'));
    roster = json(200, {
      data: {
        staff: [
          { staff_id: 'S1', display_name: 'Imran', role_names: [], locked_until: null },
          { staff_id: 'S2', display_name: 'Bilal', role_names: [], locked_until: Date.now() + 13 * 60_000 + 1_000 },
        ],
      },
    });
    await tap(button(t('admin_stock.login.retry_now')));
    const tiles = [...container.querySelectorAll<HTMLButtonElement>('.pos-staff__tile')];
    expect(tiles[1]?.querySelector('small')?.textContent).toBe('Locked · 14 min');

    const tryPin = async () => {
      await tap(tiles[0] as HTMLButtonElement);
      for (const d of ['1', '2', '3', '4']) act(() => button(d, container.querySelector('.pos-pin')).click());
      await tap(button(t('pin.submit'), container.querySelector('.pos-pin')));
    };
    pinReply = () => json(401, { error: { code: 'PIN_INVALID', message: 'x', details: { attempts_remaining: 2 } } });
    await tryPin();
    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(fill(t('admin_stock.login.tries_left'), { n: '2' }));
    pinReply = () => json(401, { error: { code: 'PIN_INVALID', message: 'x', details: { attempts_remaining: 3 } } });
    await tryPin();
    expect(container.querySelector('.pos-banner--danger')?.textContent).not.toContain('tries left');
    pinReply = () => json(429, { error: { code: 'PIN_LOCKED_OUT', message: 'x', details: { retry_after_ms: 61_000 } } });
    await tryPin();
    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(fill(t('admin_stock.login.locked_for'), { n: '2' }));

    // Signed in without the stock job: the stock query's 403 shows the permission text.
    signIn();
    const denied = fakeHub(() => answer(), (s) =>
      s.url.startsWith('/admin/queries/stock') ? json(403, { error: { code: 'PERMISSION_DENIED', message: 'x', details: {} } }) : undefined,
    );
    await remount(denied.api);
    expect(container.textContent).toContain(t('admin_stock.errors.PERMISSION_DENIED'));
  });

  it('[01a §10 #172] header, the shared 00 session keys, sign out, the hub admin side menu, the saved line', async () => {
    stubPhone(false);
    // A session written by /admin: the keys only, no stock-page login.
    signIn('S_MGR', 'Imran');
    sessionStorage.setItem('admin_permissions', '{"manage-devices":true}');
    sessionStorage.setItem('admin_bootstrap', '0');
    const { api, sent } = fakeHub(() => answer());
    await mount(api);
    expect(container.querySelector('.pos-appbar')?.textContent).toContain(fill(t('admin_stock.signed_in_as'), { name: 'Imran' }));
    expect(container.querySelector('.pos-appbar')?.textContent).toContain('Day open: Sun 25 Oct since 06:00 (5 h)');
    expect(container.querySelector('[data-status-line]')?.textContent).toBe('Menu version 42 · checked just now');

    // From tablet width: the 00-S20 side menu, Stock current.
    const links = [...container.querySelectorAll<HTMLAnchorElement>('.pos-sidenav a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/admin#', '/admin#devices', '/admin#sessions', '/admin#lockouts', '/admin/stock/']);
    expect(links.at(-1)?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('.pos-sidenav__brand strong')?.textContent).toBe('…P0AB');

    // Saved line, then the waiting line while the hub is away.
    typeInto(count('I1'), '6');
    await tap(saveButton());
    expect(container.querySelector('.pos-actionbar__info')?.textContent).toContain(fill(t('admin_stock.saved_at'), { n: '1', time: '11:00' }));
    typeInto(count('I2'), '3');

    // Sign out with touched rows asks first; Keep on this tablet signs out and keeps the draft.
    await tap(button(t('admin_stock.sign_out')));
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe(fill(t('admin_stock.sign_out_ask'), { n: '1' }));
    await tap(button(t('admin_stock.sign_out_keep'), container.querySelector('[role="dialog"]')));
    expect(sent.some((s) => s.url === '/admin/auth/logout')).toBe(true);
    for (const key of ['admin_session_token', 'admin_staff_id', 'admin_name', 'admin_permissions', 'admin_bootstrap']) {
      expect(sessionStorage.getItem(key), key).toBeNull();
    }
    expect(localStorage.getItem(keyFor())).not.toBeNull();
    expect(container.textContent).toContain(t('admin_stock.login.title'));

    // An idle sign-out answer clears the keys too.
    signIn();
    sessionStorage.setItem('admin_permissions', '{}');
    const idle = fakeHub(() => answer(), (s) =>
      s.url.startsWith('/admin/queries/stock') ? json(401, { error: { code: 'ADMIN_SESSION_REQUIRED', message: 'x', details: {} } }) : undefined,
    );
    await remount(idle.api);
    expect(sessionStorage.getItem('admin_name')).toBeNull();
    expect(sessionStorage.getItem('admin_permissions')).toBeNull();

    // Phone: no side menu.
    stubPhone(true);
    signIn();
    await remount(fakeHub(() => answer()).api);
    expect(container.querySelector('.pos-sidenav')).toBeNull();
  });

  it('[01a §10 #172 waiting part] while the hub is unreachable the action bar counts the waiting counts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    signIn();
    let offline = false;
    const { api } = fakeHub(() => (offline ? 'offline' : answer()));
    await mount(api);
    typeInto(count('I1'), '6');
    typeInto(count('I2'), '3');
    offline = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await flush();
    expect(container.textContent).toContain(t('admin_stock.reconnecting'));
    expect(container.querySelector('.pos-actionbar__info')?.textContent).toContain(fill(t('admin_stock.waiting'), { n: '2' }));
    expect(count('I1')?.value).toBe('6');
  });
});

describe('[01b §4.4 row 13] stock page day actions under my_stations', () => {
  const refused = (status: number, code: string, details: Record<string, unknown> = {}) =>
    json(status, { error: { code, message: 'x', details } });
  const hasButton = (label: string) => [...container.querySelectorAll('button')].some((b) => b.textContent?.includes(label));
  const staleDay = { day_stale: true, business_day: { business_date: '2026-10-24', opened_at: OPENED, closed_at: null } };
  const noDay = { business_day: null, business_day_started_at: null };

  it('[01b #71 page part] my_stations hides Start day, Close day and the stale-day prompt; branch scope keeps them', async () => {
    signIn('S_USMAN', 'Usman');
    await mount(fakeHub(() => answer({ manage_stock_scope: 'my_stations', ...staleDay })).api);
    expect(hasButton(t('admin_stock.day.close'))).toBe(false);
    expect(container.textContent).not.toContain(t('admin_stock.stale.close_and_start'));
    expect(container.textContent).toContain(t('admin_stock.counter.note'));
    expect(container.querySelector('[data-item-id="I1"]')).not.toBeNull();

    // No day open: no Start day; an "ask someone" notice above the rows, which stay.
    await remount(fakeHub(() => answer({ manage_stock_scope: 'my_stations', ...noDay })).api);
    expect(hasButton(t('admin_stock.day.start'))).toBe(false);
    expect(container.querySelector('[data-start-day]')).toBeNull();
    expect(container.textContent).toContain("The day hasn't been started");
    expect(container.textContent).toContain('Ask someone who can start the day.');
    expect(container.querySelector('[data-item-id="I1"]')).not.toBeNull();

    // The same answers with branch scope render as before.
    signIn();
    await remount(fakeHub(() => answer(staleDay)).api);
    expect(hasButton(t('admin_stock.day.close'))).toBe(true);
    expect(container.textContent).toContain(t('admin_stock.stale.close_and_start'));
    expect(container.textContent).not.toContain(t('admin_stock.counter.note'));
    await remount(fakeHub(() => answer(noDay)).api);
    expect(container.querySelector('[data-start-day="rows"]')).not.toBeNull();
  });

  it('[01b #71 page part] under my_stations a 409 BUSINESS_DAY_NOT_OPEN asks for someone who can start the day', async () => {
    signIn('S_USMAN', 'Usman');
    const { api, sent } = fakeHub(
      () => answer({ manage_stock_scope: 'my_stations' }),
      (s) => (s.url === '/admin/commands/set-precooked-stock' ? refused(409, 'BUSINESS_DAY_NOT_OPEN') : undefined),
    );
    await mount(api);
    typeInto(count('I1'), '6');
    await tap(saveButton());
    expect(container.textContent).toContain("The day hasn't been started. Ask someone who can start the day.");
    expect(container.querySelector('[data-start-day]')).toBeNull();
    expect(commandsTo(sent, 'open-business-day')).toHaveLength(0);
    expect(count('I1')?.value).toBe('6');
  });

  it('[01b §4.4 row 11] with my_stations and no day open, a row’s Selling switch still sends set-item-availability', async () => {
    signIn('S_USMAN', 'Usman');
    const { api, sent } = fakeHub(() => answer({ manage_stock_scope: 'my_stations', ...noDay }));
    await mount(api);
    const sw = rowOf('I1').querySelector<HTMLElement>('[role="switch"]');
    expect(sw).not.toBeNull();
    if (sw) await tap(sw);
    expect(commandsTo(sent, 'set-item-availability')).toHaveLength(1);
    expect(commandsTo(sent, 'set-item-availability')[0]?.body).toMatchObject({ payload: { item_id: 'I1', is_available: false } });
  });

  it('[01b §4.4 rows 11, 13; S33] with my_stations and yesterday’s day closed: rows stay, Selling switch works, a save asks for someone who can start the day', async () => {
    signIn('S_USMAN', 'Usman');
    const closedDay = {
      business_day: { business_date: '2026-10-24', opened_at: OPENED, closed_at: OPENED + 12 * 3_600_000 },
      business_day_started_at: null,
    };
    const { api, sent } = fakeHub(
      () => answer({ manage_stock_scope: 'my_stations', ...closedDay }),
      (s) => (s.url === '/admin/commands/set-precooked-stock' ? refused(409, 'BUSINESS_DAY_NOT_OPEN') : undefined),
    );
    await mount(api);
    expect(container.querySelector('[data-item-id="I1"]')).not.toBeNull();
    expect(container.querySelector('[data-start-day]')).toBeNull();
    expect(hasButton(t('admin_stock.day.start'))).toBe(false);
    expect(hasButton(t('admin_stock.day.close'))).toBe(false);
    expect(container.textContent).toContain(t('admin_stock.counter.not_started'));

    const sw = rowOf('I1').querySelector<HTMLElement>('[role="switch"]');
    expect(sw).not.toBeNull();
    if (sw) await tap(sw);
    expect(commandsTo(sent, 'set-item-availability')).toHaveLength(1);

    typeInto(count('I1'), '6');
    await tap(saveButton());
    expect(commandsTo(sent, 'set-precooked-stock')).toHaveLength(1);
    expect(container.textContent).toContain(t('admin_stock.counter.not_started'));
    expect(container.querySelector('[data-start-day]')).toBeNull();
    expect(commandsTo(sent, 'open-business-day')).toHaveLength(0);
    expect(count('I1')?.value).toBe('6');
  });

  it('[01b §4.4 row 13] (review N-6) a refused save or Add with the no-day banner showing adds no second warning; the banner takes focus', async () => {
    stubPhone(true);
    signIn('S_USMAN', 'Usman');
    const { api } = fakeHub(
      () => answer({ manage_stock_scope: 'my_stations', ...noDay }),
      (s) =>
        s.url === '/admin/commands/set-precooked-stock' || s.url === '/admin/commands/add-precooked-stock'
          ? refused(409, 'BUSINESS_DAY_NOT_OPEN')
          : undefined,
    );
    await mount(api);
    const sentence = t('admin_stock.counter.not_started');
    const times = () => (container.textContent ?? '').split(sentence).length - 1;
    const banner = container.querySelector<HTMLElement>('[data-not-started]');
    expect(banner?.textContent).toContain(sentence);
    expect(times()).toBe(1);

    typeInto(count('I1'), '6');
    await tap(saveButton());
    expect(times()).toBe(1);
    expect(document.activeElement).toBe(banner);
    expect(count('I1')?.value).toBe('6');

    (document.activeElement as HTMLElement | null)?.blur();
    await tap(button(t('admin_stock.add'), stockRowOf('I1')));
    const sheet = container.querySelector('.pos-sheet');
    await tap(button('+5', sheet));
    await tap(button(fill(t('admin_stock.sheet.add_n'), { n: '5' }), sheet));
    expect(times()).toBe(1);
    expect(document.activeElement).toBe(container.querySelector('[data-not-started]'));
    vi.unstubAllGlobals();
  });

  it('[01b §4.4 row 11] a change outside the counter’s stations shows the outside_scope text and refreshes', async () => {
    signIn('S_USMAN', 'Usman');
    let reads = 0;
    const { api } = fakeHub(
      () => {
        reads += 1;
        return answer({ manage_stock_scope: 'my_stations' });
      },
      (s) =>
        s.url === '/admin/commands/set-precooked-stock'
          ? refused(403, 'PERMISSION_DENIED', { permission: 'manage-stock', reason: 'outside_scope', required_scope: 'my_stations' })
          : undefined,
    );
    await mount(api);
    const before = reads;
    typeInto(count('I1'), '6');
    await tap(saveButton());
    expect(container.textContent).toContain(t('admin_stock.errors.outside_scope'));
    expect(reads).toBeGreaterThan(before);
  });
});
