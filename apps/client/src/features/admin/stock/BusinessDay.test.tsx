import type { HubConfigStatus, HubStockAnswer, HubStockItem, HubStockItemMeta, HubStockRow, HubStockRowMeta } from '@pos/events';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHubAdmin } from '../../../api/hub-admin';
import { t } from '../../../i18n';
import { StockApp } from './StockApp';

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
});

const HOUR = 3_600_000;
const OFFSET = 5 * HOUR;
// Hub wall time 2026-10-<day> hh:mm at +5 h.
const hubAt = (day: number, h: number, m = 0) => Date.UTC(2026, 9, day, h, m) - OFFSET;

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
function stockMeta(stockItemId: string, o: Partial<HubStockRowMeta> = {}): HubStockRowMeta {
  return {
    stock_item_id: stockItemId,
    name: `Item ${stockItemId}`,
    stock_unit: 'piece',
    carries_over: false,
    station_id: 'ST1',
    low_stock_threshold: null,
    has_tracked_drawers: true,
    drawers: [{ item_id: stockItemId, name: `Item ${stockItemId}`, variant_name: null, sale_unit: 'piece', quantity_per_sale_unit: 1 }],
    ...o,
  };
}

function stock(stockItemId: string, o: Partial<HubStockRow> = {}): HubStockRow {
  return { stock_item_id: stockItemId, on_hand: 5, reserved: 0, unit: 'piece', available: 5, level: 'ok', set_at: hubAt(25, 9, 30), ...o };
}

const OPEN_DAY = { business_date: '2026-10-25', opened_at: hubAt(25, 9), closed_at: null };

function answer(o: Partial<HubStockAnswer> = {}): HubStockAnswer {
  return {
    unchanged: false,
    manage_stock_scope: 'branch',
    config_version: 42,
    meta_version: `42.${hubAt(25, 9)}`,
    stock_version: 7,
    hub_time: { now_ms: hubAt(26, 0), utc_offset_ms: OFFSET },
    hub_local_date: '2026-10-26',
    business_day: OPEN_DAY,
    business_day_started_at: hubAt(25, 9),
    day_stale: false,
    day_stale_after_hours: 16,
    day_min_gap_hours: 4,
    stock_items_meta: [stockMeta('I1'), stockMeta('I2', { stock_unit: 'g' }), stockMeta('I3', { carries_over: true })],
    stock: [stock('I1'), stock('I2', { on_hand: 2000, unit: 'g', available: 2000 }), stock('I3')],
    items_meta: [meta('I1'), meta('I2'), meta('I3')],
    items: [item('I1'), item('I2'), item('I3')],
    ...o,
  };
}

// No day open: the last one closed at 01:10; counts of non-carrying items read 0.
function closed(o: Partial<HubStockAnswer> = {}): HubStockAnswer {
  return answer({
    meta_version: '42.0',
    stock_version: 9,
    business_day: { ...OPEN_DAY, closed_at: hubAt(26, 1, 10) },
    business_day_started_at: null,
    stock: [
      stock('I1', { available: 0, level: 'not_counted' }),
      stock('I2', { on_hand: 2000, unit: 'g', available: 0, level: 'not_counted' }),
      stock('I3'),
    ],
    ...o,
  });
}

const STATUS: HubConfigStatus = {
  tenant_id: 'T1',
  branch_id: 'B1',
  config_version: 42,
  snapshot_schema_version: 1,
  applied_at: hubAt(25, 8),
  directory_version: 2,
  last_poll: { outcome: 'applied', at: hubAt(26, 0) },
  last_problem: null,
  stuck_alerts: 0,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function ok(result: unknown): Response {
  return json(200, { data: { command_id: 'x', event_ids: [], result } });
}

const DAY_NOT_OPEN = () =>
  json(409, { error: { code: 'BUSINESS_DAY_NOT_OPEN', message: 'x', details: {}, request_id: 'R' } });

interface Sent {
  url: string;
  body: Record<string, unknown> | undefined;
}

// Stock answers in order (the last repeats); `command` answers each command by path.
function fakeHub(stock: HubStockAnswer[], command: (name: string, n: number) => Response) {
  const sent: Sent[] = [];
  let commands = 0;
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>);
    sent.push({ url, body });
    if (url.startsWith('/admin/queries/config-status')) return json(200, { data: STATUS });
    if (url.startsWith('/admin/queries/stock')) return json(200, { data: stock.length > 1 ? stock.shift() : stock[0] });
    if (url.startsWith('/admin/commands/')) return command(url.slice('/admin/commands/'.length), commands++);
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

// 01c §8: the count, Add and level are on the stock item's row.
function rowOf(itemId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-stock-item-id="${itemId}"]`);
  if (row === null) throw new Error(`row ${itemId} missing`);
  return row;
}

function field(itemId: string, name: 'on_hand' | 'add'): HTMLInputElement | null {
  return rowOf(itemId).querySelector<HTMLInputElement>(`[data-field="${name}"] input`);
}

function typeInto(input: HTMLInputElement | null, text: string): void {
  if (!input) throw new Error('input missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function buttons(scope: ParentNode, text: string): HTMLButtonElement[] {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === text);
}

function saveButton(): HTMLButtonElement {
  // v1.1 (S54): the label carries the count ("Save 2 counts"); the button is found by its hook.
  const found = container.querySelector<HTMLButtonElement>('[data-save] button');
  if (found === null) throw new Error('save button missing');
  return found;
}

function button(scope: ParentNode, text: string): HTMLButtonElement {
  const found = buttons(scope, text)[0];
  if (found === undefined) throw new Error(`button ${text} missing`);
  return found;
}

async function tap(target: HTMLButtonElement): Promise<void> {
  await act(async () => target.click());
  await flush();
}

// Pulse (01a hand-off CHANGES §2): the app bar's ⋯ More menu holds the menu status and Close day.
async function openMore(): Promise<void> {
  const more = container.querySelector<HTMLButtonElement>('.pos-appbar .pos-more');
  if (more === null) throw new Error('More button missing');
  await tap(more);
}

function commands(sent: Sent[]): Sent[] {
  return sent.filter((s) => s.url.startsWith('/admin/commands/'));
}

const OPENED = { business_date: '2026-10-26', opened_at: hubAt(26, 1, 15), changed: true, reason: 'opened' };
const CLOSED = { business_date: '2026-10-25', opened_at: hubAt(25, 9), closed_at: hubAt(26, 1), changed: true, reason: 'closed' };

describe('/admin/stock business day', () => {
  it('[01a §10 #133 page part] Start day with no day open keeps typed counts; a 409 save shows it and re-sends with the same command_id; Close day asks first', async () => {
    let refuse = true;
    const { api, sent } = fakeHub([closed(), answer()], (name) => {
      if (name === 'set-precooked-stock' && refuse) {
        refuse = false;
        return DAY_NOT_OPEN();
      }
      if (name === 'open-business-day') return ok(OPENED);
      if (name === 'close-business-day') return ok(CLOSED);
      return ok({ items: [] });
    });
    act(() => root.render(<StockApp api={api} />));
    await flush();

    // No day open: the large Start day sits above the rows; the closed line shows.
    const start = container.querySelector<HTMLElement>('[data-start-day]');
    expect(start).not.toBeNull();
    expect(start!.compareDocumentPosition(rowOf('I1')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).toContain('Day closed at 01:10');
    expect(rowOf('I1').textContent).toContain(t('admin_stock.badge.not_counted'));
    // Pulse (01a hand-off StockMore): Close day is a More menu item; with no day open it is not there.
    await openMore();
    expect(buttons(container, t('admin_stock.day.close'))).toHaveLength(0);
    await openMore();

    // A save while no day is open → 409 → the action next to the save; the tap opens the day and
    // re-sends the save with the same command_id; the typed count is kept until it is saved.
    typeInto(field('I1', 'on_hand'), '7');
    await tap(saveButton());
    expect(container.querySelector('[data-start-day="retry"]')).not.toBeNull();
    expect(field('I1', 'on_hand')?.value).toBe('7');
    await tap(button(container.querySelector('[data-start-day="retry"]')!, t('admin_stock.day.start_and_save')));

    const sentCommands = commands(sent);
    expect(sentCommands.map((c) => c.url)).toEqual([
      '/admin/commands/set-precooked-stock',
      '/admin/commands/open-business-day',
      '/admin/commands/set-precooked-stock',
    ]);
    expect(sentCommands[1]?.body?.['payload']).toEqual({});
    expect(sentCommands[2]?.body?.['command_id']).toBe(sentCommands[0]?.body?.['command_id']);
    expect(sentCommands[2]?.body?.['payload']).toEqual({ entries: [{ stock_item_id: 'I1', on_hand: 7 }] });
    expect(container.querySelector('[data-start-day]')).toBeNull();

    // Day open: the line and Close day; Close day asks first, then sends CloseBusinessDay.
    expect(container.textContent).toContain('Day open: Sun 25 Oct since 09:00 (15 h)');
    await openMore();
    await tap(button(container.querySelector('[role="menu"]')!, t('admin_stock.day.close')));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(t('admin_stock.day.close_confirm'));
    expect(commands(sent)).toHaveLength(3);
    await tap(button(container.querySelector('[role="dialog"]')!, t('admin_stock.day.close')));
    expect(commands(sent).at(-1)?.url).toBe('/admin/commands/close-business-day');
    expect(commands(sent).at(-1)?.body?.['payload']).toEqual({});
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('[01a §10 #156 page part] the category filter shows names; opened_recently names day_min_gap_hours', async () => {
    const twoHours = { day_min_gap_hours: 2 };
    const { api } = fakeHub(
      [
        answer({
          ...twoHours,
          items_meta: [meta('I1'), meta('I2', { category_id: 'C2', category_name: 'Breads' })],
          items: [item('I1'), item('I2')],
        }),
        answer(twoHours),
      ],
      () => ok({ ...CLOSED, closed_at: null, changed: false, reason: 'opened_recently' }),
    );
    act(() => root.render(<StockApp api={api} />));
    await flush();
    const options = [...container.querySelectorAll<HTMLOptionElement>(`select[aria-label="${t('admin_stock.category')}"] option`)];
    expect(options.map((o) => [o.value, o.textContent])).toEqual([
      ['', t('admin_stock.all_categories')],
      ['C1', 'Mains'],
      ['C2', 'Breads'],
    ]);

    await openMore();
    await tap(button(container.querySelector('[role="menu"]')!, t('admin_stock.day.close')));
    await tap(button(container.querySelector('[role="dialog"]')!, t('admin_stock.day.close')));
    expect(container.textContent).toContain('This day was started less than 2 h ago; nothing changed.');
  });

  it('[01a §8.2, S33] one tap on Start day sends OpenBusinessDay {} and keeps the typed counts; opened_recently on close says nothing changed', async () => {
    const { api, sent } = fakeHub([closed(), answer()], (name) => {
      if (name === 'open-business-day') return ok(OPENED);
      return ok({ ...CLOSED, closed_at: null, changed: false, reason: 'opened_recently' });
    });
    act(() => root.render(<StockApp api={api} />));
    await flush();
    typeInto(field('I2', 'on_hand'), '2.5');
    await tap(button(container.querySelector('[data-start-day]')!, t('admin_stock.day.start')));
    expect(commands(sent).map((c) => [c.url, c.body?.['payload']])).toEqual([['/admin/commands/open-business-day', {}]]);
    expect(field('I2', 'on_hand')?.value).toBe('2.5');

    await openMore();
    await tap(button(container.querySelector('[role="menu"]')!, t('admin_stock.day.close')));
    await tap(button(container.querySelector('[role="dialog"]')!, t('admin_stock.day.close')));
    expect(container.textContent).toContain('This day was started less than 4 h ago; nothing changed.');
  });

  it('[01a §10 #146 page part] the stale prompt: Close and start new day sends Close then Open with two command_ids; Keep this day open hides it', async () => {
    const stale = answer({ day_stale: true, hub_time: { now_ms: hubAt(26, 1, 1), utc_offset_ms: OFFSET } });
    const { api, sent } = fakeHub([stale], (name) => (name === 'open-business-day' ? ok(OPENED) : ok(CLOSED)));
    act(() => root.render(<StockApp api={api} />));
    await flush();

    const prompt = container.querySelector<HTMLElement>('[data-stale-prompt]');
    expect(prompt?.textContent).toContain("Yesterday's day is still open since 09:00. Close it and start a new day?");
    expect(prompt!.compareDocumentPosition(rowOf('I1')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await tap(button(prompt!, t('admin_stock.stale.close_and_start')));
    const sentCommands = commands(sent);
    expect(sentCommands.map((c) => c.url)).toEqual(['/admin/commands/close-business-day', '/admin/commands/open-business-day']);
    expect(sentCommands[0]?.body?.['command_id']).not.toBe(sentCommands[1]?.body?.['command_id']);

    // Still stale on the next answer (the fake keeps it): Keep this day open hides it until a reload.
    expect(container.querySelector('[data-stale-prompt]')).not.toBeNull();
    await tap(button(container.querySelector('[data-stale-prompt]')!, t('admin_stock.stale.keep')));
    expect(container.querySelector('[data-stale-prompt]')).toBeNull();
    expect(commands(sent)).toHaveLength(2);
  });

  it('[01a S45] Add sends AddPrecookedStock for one row with the parsed quantity', async () => {
    const { api, sent } = fakeHub([answer()], () => ok({ items: [] }));
    act(() => root.render(<StockApp api={api} />));
    await flush();
    expect(field('I1', 'add')).not.toBeNull();

    typeInto(field('I2', 'add'), '1.5');
    typeInto(field('I1', 'add'), '3');
    await tap(button(rowOf('I2'), t('admin_stock.add')));
    const sentCommands = commands(sent);
    expect(sentCommands).toHaveLength(1);
    expect(sentCommands[0]?.url).toBe('/admin/commands/add-precooked-stock');
    expect(sentCommands[0]?.body).toMatchObject({
      command_type: 'AddPrecookedStock',
      payload: { entries: [{ stock_item_id: 'I2', quantity: 1500 }] },
    });
    expect(field('I2', 'add')?.value).toBe('');
    expect(field('I1', 'add')?.value).toBe('3');
  });

  it('[01a §8.2, S33] the day line turns warn only once the day is older than day_stale_after_hours, as day_stale does', async () => {
    // performance is frozen, so the hub clock stays at hub_time.
    vi.useFakeTimers({ toFake: ['performance'] });
    const dayLine = () =>
      // v1.1 (B11): the day line is the app bar's chip.
      [...container.querySelectorAll<HTMLElement>('.pos-chip')].find((b) => b.textContent?.startsWith('Day open'));
    const atExactly = answer({ hub_time: { now_ms: hubAt(26, 1), utc_offset_ms: OFFSET } });
    const { api } = fakeHub([atExactly], () => ok({ items: [] }));
    act(() => root.render(<StockApp api={api} />));
    await flush();
    expect(dayLine()?.textContent).toContain('(16 h)');
    expect(dayLine()?.classList.contains('pos-chip--ok')).toBe(true);
    act(() => root.unmount());

    root = createRoot(container);
    const later = answer({ hub_time: { now_ms: hubAt(26, 1, 1), utc_offset_ms: OFFSET } });
    const { api: api2 } = fakeHub([later], () => ok({ items: [] }));
    act(() => root.render(<StockApp api={api2} />));
    await flush();
    expect(dayLine()?.classList.contains('pos-chip--warn')).toBe(true);
  });

  it('[01a §8.2] an Add answered 409 BUSINESS_DAY_NOT_OPEN is re-sent with the same command_id after Start day', async () => {
    let refuse = true;
    const { api, sent } = fakeHub([closed(), answer()], (name) => {
      if (name === 'add-precooked-stock' && refuse) {
        refuse = false;
        return DAY_NOT_OPEN();
      }
      if (name === 'open-business-day') return ok(OPENED);
      return ok({ items: [] });
    });
    act(() => root.render(<StockApp api={api} />));
    await flush();

    typeInto(field('I2', 'add'), '1.5');
    await tap(button(rowOf('I2'), t('admin_stock.add')));
    expect(container.querySelector('[data-start-day="retry"]')).not.toBeNull();
    expect(field('I2', 'add')?.value).toBe('1.5');
    await tap(button(container.querySelector('[data-start-day="retry"]')!, t('admin_stock.day.start_and_save')));

    const sentCommands = commands(sent);
    expect(sentCommands.map((c) => c.url)).toEqual([
      '/admin/commands/add-precooked-stock',
      '/admin/commands/open-business-day',
      '/admin/commands/add-precooked-stock',
    ]);
    expect(sentCommands[2]?.body?.['command_id']).toBe(sentCommands[0]?.body?.['command_id']);
    expect(sentCommands[2]?.body?.['payload']).toEqual({ entries: [{ stock_item_id: 'I2', quantity: 1500 }] });
    expect(field('I2', 'add')?.value).toBe('');
  });

  it('[01a S33] after another device closes the day, the next refresh shows Start day and Available 0 for non-carrying rows, typed counts kept', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    const { api } = fakeHub([answer(), closed()], () => ok({ items: [] }));
    act(() => root.render(<StockApp api={api} />));
    await flush();
    expect(container.querySelector('[data-start-day]')).toBeNull();
    typeInto(field('I1', 'on_hand'), '7');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await flush();
    expect(container.querySelector('[data-start-day]')).not.toBeNull();
    expect(rowOf('I1').querySelector('.pos-list__num')?.textContent).toBe('0');
    expect(rowOf('I2').querySelector('.pos-list__num')?.textContent).toBe('0 kg');
    expect(rowOf('I3').querySelector('.pos-list__num')?.textContent).toBe('5');
    expect(field('I1', 'on_hand')?.value).toBe('7');
  });
});
