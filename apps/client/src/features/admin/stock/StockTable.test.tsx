import type { HubConfigStatus, HubStockAnswer, HubStockDrawer, HubStockItem, HubStockItemMeta, HubStockRow, HubStockRowMeta } from '@pos/events';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHubAdmin } from '../../../api/hub-admin';
import { createHubClock } from '../../../app/hub-clock';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { AlertBar } from './AlertBar';
import { ConfigStatus } from './ConfigStatus';
import { pageRows } from './badges';
import { StockApp } from './StockApp';
import { StockTable } from './StockTable';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionStorage.clear();
  // S55: kept counts live in localStorage; each test starts without any.
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const HOUR = 3_600_000;
const OFFSET = 5 * HOUR;
// Hub wall time 2026-10-25 hh:mm at +5 h.
const hubAt = (h: number, m = 0) => Date.UTC(2026, 9, 25, h, m) - OFFSET;

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
    business_day: { business_date: '2026-10-25', opened_at: hubAt(6), closed_at: null },
    business_day_started_at: hubAt(6),
    day_stale: false,
    day_stale_after_hours: 16,
    day_min_gap_hours: 4,
    stock_items_meta: [stockMeta('I1')],
    stock: [stockNumbers('I1')],
    items_meta: [meta('I1')],
    items: [item('I1')],
    ...o,
  };
}

const STATUS: HubConfigStatus = {
  tenant_id: 'T1',
  branch_id: 'B1',
  config_version: 42,
  snapshot_schema_version: 1,
  applied_at: hubAt(8),
  directory_version: 2,
  last_poll: { outcome: 'applied', at: hubAt(11) },
  last_problem: null,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Sent {
  url: string;
  body: Record<string, unknown> | undefined;
}

// A hub over a fake fetch: stock answers are served in order (the last one repeats; 'offline' throws); commands are
// recorded and answered by `command`. A function stands for a non-200 answer.
function fakeHub(stock: Array<HubStockAnswer | 'offline' | (() => Response)>, command: (sent: Sent, n: number) => Response = () => json(200, {})) {
  const sent: Sent[] = [];
  let commands = 0;
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>);
    sent.push({ url, body });
    if (url.startsWith('/admin/queries/config-status')) return json(200, { data: STATUS });
    if (url.startsWith('/admin/queries/stock')) {
      const next = stock.length > 1 ? stock.shift() : stock[0];
      if (next === 'offline') throw new TypeError('network');
      if (typeof next === 'function') return next();
      return json(200, { data: next });
    }
    if (url.startsWith('/admin/commands/')) return command({ url, body }, commands++);
    throw new Error(`no route for ${url}`);
  });
  sessionStorage.setItem('admin_session_token', 'AS1');
  sessionStorage.setItem('admin_staff_id', 'S_MGR');
  const api = createHubAdmin({ fetch: fetchFn, readDeviceToken: async () => 'DT1', readDeviceId: async () => 'D1', onSignedOut: () => {} });
  return { api, sent };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

function rowOf(itemId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-item-id="${itemId}"]`);
  if (row === null) throw new Error(`row ${itemId} missing`);
  return row;
}

// 01c §8: one row per stock item (count, add, level); the menu item rows carry the Selling switch.
function stockRowOf(stockItemId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-stock-item-id="${stockItemId}"]`);
  if (row === null) throw new Error(`stock row ${stockItemId} missing`);
  return row;
}

function typeInto(input: HTMLInputElement | null, text: string): void {
  if (!input) throw new Error('input missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function saveButton(): HTMLButtonElement {
  // v1.1 (S54): the label carries the count ("Save 2 counts"); the button is found by its hook.
  const found = container.querySelector<HTMLButtonElement>('[data-save] button');
  if (found === null) throw new Error('save button missing');
  return found;
}

function button(scope: ParentNode, text: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text);
  if (found === undefined) throw new Error(`button ${text} missing`);
  return found;
}

function commandsTo(sent: Sent[], name: string): Sent[] {
  return sent.filter((s) => s.url === `/admin/commands/${name}`);
}

const fakeTimers = () =>
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });

// The danger banner's own line, without its detail (v1.1 adds one under the B10 text).
const dangerText = () => container.querySelector('.pos-banner--danger p')?.firstChild?.textContent;

describe('/admin/stock table', () => {
  it('[01a §10 #77] Save counts sends every touched row and no untouched row, reuses command_id on retry, shows Not counted today', async () => {
    const first = answer({
      stock_items_meta: [stockMeta('I1'), stockMeta('I2', { stock_unit: 'g', drawers: [drawer('I2', { sale_unit: 'g' })] }), stockMeta('I3')],
      stock: [
        stockNumbers('I1'),
        stockNumbers('I2', { on_hand: 1500, unit: 'g', available: 1500 }),
        stockNumbers('I3', { on_hand: 4, available: 0, level: 'not_counted', set_at: hubAt(5) }),
      ],
      items_meta: [meta('I1'), meta('I2'), meta('I3'), meta('I4', { is_stock_tracked: false, stock_item_ids: [] })],
      items: [item('I1'), item('I2'), item('I3'), item('I4', { stock_item_ids: [] })],
    });
    const { api, sent } = fakeHub([first], (_s, n) => {
      if (n === 0) throw new TypeError('network');
      return json(200, { data: { command_id: 'x', event_ids: [], result: { items: [] } } });
    });
    act(() => root.render(<StockApp api={api} />));
    await flush();

    // 01c §8: one row per stock item; I4 draws from none, so it is a Selling row only.
    expect([...container.querySelectorAll<HTMLElement>('[data-stock-item-id]')].map((r) => r.dataset['stockItemId'])).toEqual(['I1', 'I2', 'I3']);
    expect(stockRowOf('I3').textContent).toContain(t('admin_stock.badge.not_counted'));
    for (const id of ['I1', 'I2']) expect(stockRowOf(id).textContent).not.toContain(t('admin_stock.badge.not_counted'));
    expect(rowOf('I4').textContent).not.toContain(t('admin_stock.badge.not_counted'));
    expect(rowOf('I4').querySelector('input')).toBeNull();
    expect(rowOf('I4').querySelector('[role="switch"]')).not.toBeNull();
    expect(stockRowOf('I2').querySelector('input')?.value).toBe('1.5');
    expect(stockRowOf('I1').textContent).toContain('09:05');

    // I1 edited back to the same number; I3 confirmed; I2 untouched.
    typeInto(stockRowOf('I1').querySelector('input'), '');
    typeInto(stockRowOf('I1').querySelector('input'), '5');
    act(() => button(stockRowOf('I3'), t('admin_stock.confirm')).click());
    await act(async () => saveButton().click());
    await flush();
    expect(container.textContent).toContain(t('admin_stock.errors.network'));

    await act(async () => saveButton().click());
    await flush();
    const saves = commandsTo(sent, 'set-precooked-stock');
    expect(saves).toHaveLength(2);
    expect(saves[0]?.body).toMatchObject({
      command_type: 'SetPrecookedStock',
      tenant_id: 'T1',
      branch_id: 'B1',
      payload: { entries: [{ stock_item_id: 'I1', on_hand: 5 }, { stock_item_id: 'I3', on_hand: 4 }] },
    });
    expect(saves[1]?.body?.['command_id']).toBe(saves[0]?.body?.['command_id']);
    expect(saves[1]?.body?.['payload']).toEqual(saves[0]?.body?.['payload']);

    // After a save the page refreshes; a later save is a new command.
    expect(sent.filter((s) => s.url.startsWith('/admin/queries/stock')).length).toBeGreaterThanOrEqual(2);
    typeInto(stockRowOf('I2').querySelector('input'), '2');
    await act(async () => saveButton().click());
    await flush();
    const third = commandsTo(sent, 'set-precooked-stock')[2];
    expect(third?.body?.['payload']).toEqual({ entries: [{ stock_item_id: 'I2', on_hand: 2000 }] });
    expect(third?.body?.['command_id']).not.toBe(saves[0]?.body?.['command_id']);
  });

  it('[01a §10 #102 page part] danger banner for rejected, apply_failed and unauthorized; Waiting for hub confirmation for not_ready', () => {
    const clock = createHubClock({ now_ms: hubAt(11, 2), utc_offset_ms: OFFSET });
    const render = (status: HubConfigStatus) => act(() => root.render(<ConfigStatus status={status} clock={clock} />));

    render(STATUS);
    expect(container.querySelector('[data-status-line]')?.textContent).toBe('Menu version 42 · checked 2 min ago');
    expect(container.querySelector('.pos-banner--danger')).toBeNull();

    render({ ...STATUS, last_poll: { outcome: 'offline', at: hubAt(11) } });
    expect(container.querySelector('[data-status-line]')?.textContent).toBe('Menu version 42 · checked 2 min ago · offline');

    render({ ...STATUS, last_poll: { outcome: 'rejected', at: hubAt(11) }, last_problem: { outcome: 'rejected', reason: 'hash_mismatch', at: hubAt(11) } });
    expect(dangerText()).toBe(
      'Menu update refused (hash_mismatch). The hub is still using version 42.',
    );

    render({ ...STATUS, last_problem: { outcome: 'rejected', reason: 'apply_failed', at: hubAt(11) } });
    expect(dangerText()).toBe(
      'Menu update could not be applied. The hub is still using version 42.',
    );

    render({ ...STATUS, last_problem: { outcome: 'unauthorized', reason: null, at: hubAt(11) } });
    expect(dangerText()).toBe("The hub's cloud key was refused. Call support.");

    render({ ...STATUS, config_version: null, last_poll: { outcome: 'not_ready', at: hubAt(11) } });
    expect(container.querySelector('[data-status-line]')?.textContent).toBe('Waiting for hub confirmation');
    expect(container.querySelector('.pos-banner--danger')).toBeNull();
  });

  it('[01a §10 #103 page part] Off since <day> for an item off before the day started; no badge for one off today', () => {
    const data = answer({
      stock_items_meta: ['I1', 'I2', 'I3'].map((id) => stockMeta(id)),
      stock: ['I1', 'I2', 'I3'].map((id) => stockNumbers(id)),
      items_meta: [meta('I1'), meta('I2'), meta('I3')],
      items: [
        item('I1', { is_available: false, unavailable_since: Date.UTC(2026, 9, 24, 22) - OFFSET }),
        item('I2', { is_available: false, unavailable_since: hubAt(7) }),
        item('I3'),
      ],
    });
    renderTable(data);
    expect(rowOf('I1').textContent).toContain('Off since Sat 24 Oct');
    expect(rowOf('I2').textContent).not.toContain('Off since');
    expect(rowOf('I3').textContent).not.toContain('Off since');
    // v1.1 (S54 a): the Selling switch.
    expect(rowOf('I2').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    expect(rowOf('I3').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('[01a §10 #132 page part] alert bar lists low then out; hidden when none', () => {
    // 01c §8: the rows are stock items.
    const rows = [
      { meta: stockMeta('K1', { name: 'Paye' }), stock: stockNumbers('K1', { level: 'out', available: 0 }), drawers: [] },
      { meta: stockMeta('K2', { name: 'Chicken Karahi', stock_unit: 'g' }), stock: stockNumbers('K2', { level: 'low', unit: 'g', available: 900 }), drawers: [] },
      { meta: stockMeta('K3', { name: 'Naan' }), stock: stockNumbers('K3', { level: 'ok' }), drawers: [] },
    ];
    const picked: string[] = [];
    act(() => root.render(<AlertBar rows={rows} onPick={(id) => picked.push(id)} />));
    // v1.1 (B14): one chip per stock item, low first; a tap names the stock item.
    expect([...container.querySelectorAll('[data-alert-bar] .pos-chip')].map((c) => c.textContent)).toEqual([
      'Low: Chicken Karahi 0.9 kg',
      'Out: Paye',
    ]);
    act(() => container.querySelector<HTMLButtonElement>('[data-alert-bar] .pos-chip')?.click());
    expect(picked).toEqual(['K2']);

    act(() => root.render(<AlertBar rows={[rows[2]!]} onPick={() => {}} />));
    expect(container.querySelector('[data-alert-bar]')).toBeNull();
  });

  it('[01a §10 #137 page part] with the device clock 3 h wrong, the hours badge follows hub_time', () => {
    fakeTimers();
    vi.setSystemTime(hubAt(14) + 3 * HOUR);
    const morning = [{ start_ms: 7 * HOUR, end_ms: 13 * HOUR }];
    const data = answer({
      hub_time: { now_ms: hubAt(14), utc_offset_ms: OFFSET },
      stock_items_meta: ['I1', 'I2', 'I3'].map((id) => stockMeta(id)),
      stock: ['I1', 'I2', 'I3'].map((id) => stockNumbers(id)),
      items_meta: [
        meta('I1', { item_windows: morning }),
        meta('I2', { category_windows: [{ start_ms: 12 * HOUR, end_ms: 16 * HOUR }] }),
        meta('I3', { item_windows: [{ start_ms: 13 * HOUR, end_ms: 15 * HOUR }] }),
      ],
      items: [item('I1'), item('I2'), item('I3', { is_available: false, unavailable_since: hubAt(13, 30) })],
    });
    renderTable(data);
    expect(rowOf('I1').textContent).toContain('Hours 07:00–13:00');
    expect(rowOf('I2').textContent).not.toContain('Hours');
    // Off inside its window: Off wins, no hours badge.
    expect(rowOf('I3').textContent).not.toContain('Hours');
    expect(rowOf('I3').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  });

  it('[01a §8.2] a refresh does not overwrite the row being edited', async () => {
    fakeTimers();
    const later = answer({ stock_version: 8, stock_items_meta: null, items_meta: null, stock: [stockNumbers('I1', { on_hand: 9, available: 9 })] });
    const { api } = fakeHub([answer(), later]);
    act(() => root.render(<StockApp api={api} />));
    await flush();

    typeInto(stockRowOf('I1').querySelector('input'), '7');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await flush();
    expect(stockRowOf('I1').querySelector('input')?.value).toBe('7');
    expect(stockRowOf('I1').querySelector('.pos-list__num')?.textContent).toBe('9');
  });

  it('[01a S47] the badge changes within 60 s after a window end with no server answer', async () => {
    fakeTimers();
    const data = answer({
      hub_time: { now_ms: hubAt(12, 59) + 30_000, utc_offset_ms: OFFSET },
      items_meta: [meta('I1', { item_windows: [{ start_ms: 7 * HOUR, end_ms: 13 * HOUR }] })],
    });
    // The hub answers once, then cannot be reached.
    const { api } = fakeHub([data, 'offline']);
    act(() => root.render(<StockApp api={api} />));
    await flush();
    expect(rowOf('I1').textContent).not.toContain('Hours');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await flush();
    expect(container.textContent).toContain(t('admin_stock.reconnecting'));
    expect(rowOf('I1').textContent).toContain('Hours 07:00–13:00');
  });

  it('[01a §6.19] an unchanged answer keeps rows and sends no item data', async () => {
    fakeTimers();
    const unchanged = answer({ unchanged: true, stock_items_meta: null, stock: null, items_meta: null, items: null });
    const { api, sent } = fakeHub([answer(), unchanged]);
    act(() => root.render(<StockApp api={api} />));
    await flush();
    expect(rowOf('I1').textContent).toContain('Item I1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await flush();
    const reads = sent.filter((s) => s.url.startsWith('/admin/queries/stock')).map((s) => s.url);
    expect(reads).toEqual(['/admin/queries/stock', '/admin/queries/stock?meta_version=42.1&stock_version=7']);
    expect(rowOf('I1').textContent).toContain('Item I1');
    expect(stockRowOf('I1').querySelector('input')?.value).toBe('5');
  });

  it('[01a §8.2] an older stock answer landing after a newer one is dropped', async () => {
    fakeTimers();
    const held: Array<(r: Response) => void> = [];
    const fetchFn = vi.fn(async (url: string) => {
      if (url.startsWith('/admin/queries/config-status')) return json(200, { data: STATUS });
      if (url.startsWith('/admin/queries/stock')) return new Promise<Response>((resolve) => held.push(resolve));
      throw new Error(`no route for ${url}`);
    });
    sessionStorage.setItem('admin_session_token', 'AS1');
    sessionStorage.setItem('admin_staff_id', 'S_MGR');
    const api = createHubAdmin({ fetch: fetchFn, readDeviceToken: async () => 'DT1', readDeviceId: async () => 'D1', onSignedOut: () => {} });
    act(() => root.render(<StockApp api={api} />));
    await flush();

    // The first read is still in flight when the 15 s refresh goes out and is answered first.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(held).toHaveLength(2);
    held[1]!(json(200, { data: answer({ stock_version: 8, stock: [stockNumbers('I1', { on_hand: 9, available: 9 })] }) }));
    await flush();
    expect(stockRowOf('I1').querySelector('.pos-list__num')?.textContent).toBe('9');

    held[0]!(json(200, { data: answer() }));
    await flush();
    expect(stockRowOf('I1').querySelector('.pos-list__num')?.textContent).toBe('9');
  });

  it('[01a §8.2] a 403 on the stock query shows the permission text', async () => {
    fakeTimers();
    const denied = () =>
      json(403, { error: { code: 'PERMISSION_DENIED', message: 'x', details: {}, request_id: 'R' } });
    const { api } = fakeHub([denied, answer()]);
    act(() => root.render(<StockApp api={api} />));
    await flush();
    expect(container.textContent).toContain(t('admin_stock.errors.PERMISSION_DENIED'));

    // The next good answer clears it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await flush();
    expect(container.textContent).not.toContain(t('admin_stock.errors.PERMISSION_DENIED'));
    expect(rowOf('I1').textContent).toContain('Item I1');
  });
});

describe('/admin/stock rows per stock item (01c §8)', () => {
  const karahi = () =>
    stockMeta('K1', {
      name: 'Karahi pot',
      stock_unit: 'g',
      drawers: [
        drawer('I1', { name: 'Chicken Karahi — Half', variant_name: 'Half', quantity_per_sale_unit: 500 }),
        drawer('I3', { name: 'Chicken Karahi — Full', variant_name: 'Full', quantity_per_sale_unit: 1_000 }),
      ],
    });
  const stockRowIds = () => [...container.querySelectorAll<HTMLElement>('[data-stock-item-id]')].map((r) => r.dataset['stockItemId']);

  it('[01c §8] one row per stock item (count, add, level), its drawers under it with sale units available, a Selling switch per menu item', async () => {
    const data = answer({
      stock_items_meta: [karahi()],
      stock: [stockNumbers('K1', { unit: 'g', on_hand: 2_600, available: 2_600 })],
      items_meta: [
        meta('I1', { name: 'Chicken Karahi — Half', stock_item_ids: ['K1'] }),
        meta('I2', { name: 'Raita', is_stock_tracked: false, stock_item_ids: [] }),
        meta('I3', { name: 'Chicken Karahi — Full', stock_item_ids: ['K1'] }),
      ],
      items: [item('I1', { stock_item_ids: ['K1'] }), item('I2', { stock_item_ids: [] }), item('I3', { stock_item_ids: ['K1'], is_available: false })],
    });
    const { api, sent } = fakeHub([data], () => json(200, { data: { command_id: 'x', event_ids: [], result: {} } }));
    act(() => root.render(<StockApp api={api} />));
    await flush();

    expect(stockRowIds()).toEqual(['K1']);
    const k1 = stockRowOf('K1');
    expect(k1.textContent).toContain('Karahi pot');
    expect(k1.querySelector('.pos-list__num')?.textContent).toBe('2.6 kg');
    expect(k1.querySelector('[data-field="on_hand"] input')).not.toBeNull();
    expect(k1.querySelector('[data-field="add"] input')).not.toBeNull();
    expect(k1.querySelector('[role="switch"]')).toBeNull();
    // The drawers follow their stock row: sale units available (2 600 g at 500 g and 1 000 g), each its own switch.
    for (const id of ['I1', 'I3']) expect(k1.compareDocumentPosition(rowOf(id)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rowOf('I1').textContent).toContain('Chicken Karahi — Half');
    expect(rowOf('I1').querySelector('.pos-list__num')?.textContent).toBe('5');
    expect(rowOf('I3').querySelector('.pos-list__num')?.textContent).toBe('2');
    expect(rowOf('I1').querySelector('input')).toBeNull();
    expect(rowOf('I1').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(rowOf('I3').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    expect(rowOf('I2').querySelector('[role="switch"]')).not.toBeNull();
    expect(rowOf('I2').querySelector('input')).toBeNull();

    await act(async () => rowOf('I3').querySelector<HTMLElement>('[role="switch"]')?.click());
    await flush();
    expect(commandsTo(sent, 'set-item-availability')[0]?.body?.['payload']).toEqual({ item_id: 'I3', is_available: true });

    typeInto(k1.querySelector('[data-field="on_hand"] input'), '2');
    await act(async () => saveButton().click());
    await flush();
    expect(commandsTo(sent, 'set-precooked-stock')[0]?.body?.['payload']).toEqual({ entries: [{ stock_item_id: 'K1', on_hand: 2_000 }] });
  });

  it('[01c §8] a row with has_tracked_drawers false shows "Not used by any dish here" and still allows a count', async () => {
    const data = answer({
      stock_items_meta: [stockMeta('I1'), stockMeta('K2', { name: 'Spare dough', has_tracked_drawers: false, drawers: [] })],
      stock: [stockNumbers('I1'), stockNumbers('K2', { set_at: null, on_hand: 0, available: 0, level: 'not_counted' })],
    });
    const { api, sent } = fakeHub([data], () => json(200, { data: { command_id: 'x', event_ids: [], result: {} } }));
    act(() => root.render(<StockApp api={api} />));
    await flush();

    expect(t('admin_stock.badge.unused')).toBe('Not used by any dish here');
    expect(stockRowOf('K2').textContent).toContain('Not used by any dish here');
    expect(stockRowOf('I1').textContent).not.toContain('Not used by any dish here');
    typeInto(stockRowOf('K2').querySelector('[data-field="on_hand"] input'), '4');
    await act(async () => saveButton().click());
    await flush();
    expect(commandsTo(sent, 'set-precooked-stock')[0]?.body?.['payload']).toEqual({ entries: [{ stock_item_id: 'K2', on_hand: 4 }] });
  });

  it('[01c §6.21] under my_stations an item drawing from a stock item with no row here is a Selling row only; a drawer not on the page has no switch', async () => {
    const data = answer({
      manage_stock_scope: 'my_stations',
      stock_items_meta: [stockMeta('K1', { drawers: [drawer('I1'), drawer('I9', { name: 'Elsewhere dish' })] })],
      stock: [stockNumbers('K1')],
      items_meta: [meta('I1', { stock_item_ids: ['K1'] }), meta('I5', { name: 'Paye', stock_item_ids: ['K9'] })],
      items: [item('I1', { stock_item_ids: ['K1'] }), item('I5', { stock_item_ids: ['K9'] })],
    });
    const { api } = fakeHub([data]);
    act(() => root.render(<StockApp api={api} />));
    await flush();

    expect(stockRowIds()).toEqual(['K1']);
    expect(container.querySelector('[data-stock-item-id="K9"]')).toBeNull();
    expect(rowOf('I5').textContent).toContain('Paye');
    expect(rowOf('I5').querySelector('[role="switch"]')).not.toBeNull();
    expect(rowOf('I5').querySelector('input')).toBeNull();
    expect(rowOf('I1').querySelector('[role="switch"]')).not.toBeNull();
    expect(rowOf('I9').textContent).toContain('Elsewhere dish');
    expect(rowOf('I9').querySelector('[role="switch"]')).toBeNull();
  });

  it('[01c §6.18; 01c-B02 Q17] a save refused 404 STOCK_ITEM_NOT_FOUND shows the changed-in-setup banner, refreshes, and Save waits for Reload', async () => {
    const data = answer({ stock_items_meta: [karahi()], stock: [stockNumbers('K1', { unit: 'g', on_hand: 2_600, available: 2_600 })] });
    const { api, sent } = fakeHub([data], () =>
      json(404, { error: { code: 'STOCK_ITEM_NOT_FOUND', message: 'x', details: { stock_item_id: 'K1' }, request_id: 'R' } }),
    );
    act(() => root.render(<StockApp api={api} />));
    await flush();
    const reads = () => sent.filter((s) => s.url.startsWith('/admin/queries/stock')).length;
    const before = reads();

    typeInto(stockRowOf('K1').querySelector('[data-field="on_hand"] input'), '1');
    await act(async () => saveButton().click());
    await flush();
    const banner = container.querySelector<HTMLElement>('[data-changed-in-setup]');
    expect(banner?.textContent).toContain(t('admin_stock.changed_in_setup'));
    expect(banner?.textContent).toContain(t('admin_stock.nothing_saved'));
    expect(reads()).toBeGreaterThan(before);
    // Reload is the one primary; Save is disabled and not primary while the banner shows.
    const reload = button(banner!, t('admin_stock.reload'));
    expect(reload.className).toContain('pos-btn--primary');
    expect(container.querySelectorAll('.pos-btn--primary')).toHaveLength(1);
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().className).not.toContain('pos-btn--primary');
    // The typed count stays; Reload reads the rows again and lets Save go.
    expect(stockRowOf('K1').querySelector<HTMLInputElement>('[data-field="on_hand"] input')?.value).toBe('1');
    const afterSave = reads();
    await act(async () => reload.click());
    await flush();
    expect(reads()).toBeGreaterThan(afterSave);
    expect(container.querySelector('[data-changed-in-setup]')).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it('[01c-B02 Q17] an Add refused 404 STOCK_ITEM_NOT_FOUND shows the same banner', async () => {
    const data = answer({ stock_items_meta: [karahi()], stock: [stockNumbers('K1', { unit: 'g', on_hand: 2_600, available: 2_600 })] });
    const { api } = fakeHub([data], () =>
      json(404, { error: { code: 'STOCK_ITEM_NOT_FOUND', message: 'x', details: { stock_item_id: 'K1' }, request_id: 'R' } }),
    );
    act(() => root.render(<StockApp api={api} />));
    await flush();
    typeInto(stockRowOf('K1').querySelector('[data-field="add"] input'), '1');
    await act(async () => button(stockRowOf('K1'), t('admin_stock.add')).click());
    await flush();
    expect(container.querySelector('[data-changed-in-setup]')?.textContent).toContain(t('admin_stock.changed_in_setup'));
    expect(saveButton().disabled).toBe(true);
  });

  it('[01a hand-off S11 row] Left to sell is a button whose tooltip and label carry what is on orders', async () => {
    const data = answer({ stock_items_meta: [karahi()], stock: [stockNumbers('K1', { unit: 'g', on_hand: 4_500, reserved: 1_500, available: 3_000 })] });
    const { api } = fakeHub([data]);
    act(() => root.render(<StockApp api={api} />));
    await flush();
    const hint = stockRowOf('K1').querySelector<HTMLButtonElement>('button.pos-numbtn');
    expect(hint?.querySelector('.pos-list__num')?.textContent).toBe('3 kg');
    expect(hint?.getAttribute('aria-label')).toBe(fill(t('admin_stock.left_hint'), { n: '3 kg', m: '1.5 kg' }));
    const tip = container.querySelector(`#${hint?.getAttribute('aria-describedby') ?? 'none'}`);
    expect(tip?.getAttribute('role')).toBe('tooltip');
    expect(tip?.textContent).toBe(fill(t('admin_stock.on_orders'), { n: '1.5 kg' }));
    // Nothing on orders: a plain number, no button.
    act(() => root.unmount());
    root = createRoot(container);
    const none = fakeHub([answer({ stock_items_meta: [karahi()], stock: [stockNumbers('K1', { unit: 'g', on_hand: 3_000, available: 3_000 })] })]);
    act(() => root.render(<StockApp api={none.api} />));
    await flush();
    expect(stockRowOf('K1').querySelector('button.pos-numbtn')).toBeNull();
    expect(stockRowOf('K1').querySelector('.pos-list__num')?.textContent).toBe('3 kg');
  });
});

function renderTable(data: HubStockAnswer): void {
  const clock = createHubClock(data.hub_time);
  const rows = pageRows(data.stock_items_meta ?? [], data.stock ?? [], data.items_meta ?? [], data.items ?? []);
  act(() =>
    root.render(
      <StockTable
        rows={rows.stock}
        items={rows.items}
        startedAt={data.business_day_started_at}
        clock={clock}
        drafts={new Map()}
        onEdit={() => {}}
        onConfirm={() => {}}
        onToggle={() => {}}
      />,
    ),
  );
}
