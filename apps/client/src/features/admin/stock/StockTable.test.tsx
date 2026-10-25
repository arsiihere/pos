import type { HubConfigStatus, HubStockAnswer, HubStockItem, HubStockItemMeta } from '@pos/events';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHubAdmin } from '../../../api/hub-admin';
import { createHubClock } from '../../../app/hub-clock';
import { t } from '../../../i18n';
import { AlertBar } from './AlertBar';
import { ConfigStatus } from './ConfigStatus';
import { StockApp } from './StockApp';
import { StockTable } from './StockTable';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionStorage.clear();
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
    is_stock_tracked: true,
    out_of_stock_behaviour: 'cook_fresh',
    stock_unit: 'piece',
    sale_unit: 'piece',
    stock_per_sale_unit: 1,
    low_stock_threshold: null,
    carries_over: false,
    item_windows: [],
    category_windows: [],
    ...o,
  };
}

function item(itemId: string, o: Partial<HubStockItem> = {}): HubStockItem {
  return {
    item_id: itemId,
    on_hand: 5,
    reserved: 0,
    unit: 'piece',
    available: 5,
    level: 'ok',
    set_at: hubAt(9, 5),
    is_available: true,
    unavailable_since: null,
    ...o,
  };
}

function answer(o: Partial<HubStockAnswer> = {}): HubStockAnswer {
  return {
    unchanged: false,
    config_version: 42,
    meta_version: '42.1',
    stock_version: 7,
    hub_time: { now_ms: hubAt(11), utc_offset_ms: OFFSET },
    hub_local_date: '2026-10-25',
    business_day: { business_date: '2026-10-25', opened_at: hubAt(6), closed_at: null },
    business_day_started_at: hubAt(6),
    day_stale: false,
    day_stale_after_hours: 16,
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

function typeInto(input: HTMLInputElement | null, text: string): void {
  if (!input) throw new Error('input missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
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

describe('/admin/stock table', () => {
  it('[01a §10 #77] Save counts sends every touched row and no untouched row, reuses command_id on retry, shows Not counted today', async () => {
    const first = answer({
      items_meta: [meta('I1'), meta('I2', { stock_unit: 'g' }), meta('I3'), meta('I4', { is_stock_tracked: false })],
      items: [
        item('I1'),
        item('I2', { on_hand: 1500, unit: 'g', available: 1500 }),
        item('I3', { on_hand: 4, available: 0, level: 'not_counted', set_at: hubAt(5) }),
        item('I4', { on_hand: 0, available: 0, set_at: null }),
      ],
    });
    const { api, sent } = fakeHub([first], (_s, n) => {
      if (n === 0) throw new TypeError('network');
      return json(200, { data: { command_id: 'x', event_ids: [], result: { items: [] } } });
    });
    act(() => root.render(<StockApp api={api} />));
    await flush();

    expect(rowOf('I3').textContent).toContain(t('admin_stock.badge.not_counted'));
    for (const id of ['I1', 'I2', 'I4']) expect(rowOf(id).textContent).not.toContain(t('admin_stock.badge.not_counted'));
    expect(rowOf('I4').querySelector('input')).toBeNull();
    expect(rowOf('I2').querySelector('input')?.value).toBe('1.5');
    expect(rowOf('I1').textContent).toContain('09:05');

    // I1 edited back to the same number; I3 confirmed; I2 untouched.
    typeInto(rowOf('I1').querySelector('input'), '');
    typeInto(rowOf('I1').querySelector('input'), '5');
    act(() => button(rowOf('I3'), t('admin_stock.confirm')).click());
    await act(async () => button(container, t('admin_stock.save')).click());
    await flush();
    expect(container.textContent).toContain(t('admin_stock.errors.network'));

    await act(async () => button(container, t('admin_stock.save')).click());
    await flush();
    const saves = commandsTo(sent, 'set-precooked-stock');
    expect(saves).toHaveLength(2);
    expect(saves[0]?.body).toMatchObject({
      command_type: 'SetPrecookedStock',
      tenant_id: 'T1',
      branch_id: 'B1',
      payload: { entries: [{ item_id: 'I1', on_hand: 5 }, { item_id: 'I3', on_hand: 4 }] },
    });
    expect(saves[1]?.body?.['command_id']).toBe(saves[0]?.body?.['command_id']);
    expect(saves[1]?.body?.['payload']).toEqual(saves[0]?.body?.['payload']);

    // After a save the page refreshes; a later save is a new command.
    expect(sent.filter((s) => s.url.startsWith('/admin/queries/stock')).length).toBeGreaterThanOrEqual(2);
    typeInto(rowOf('I2').querySelector('input'), '2');
    await act(async () => button(container, t('admin_stock.save')).click());
    await flush();
    const third = commandsTo(sent, 'set-precooked-stock')[2];
    expect(third?.body?.['payload']).toEqual({ entries: [{ item_id: 'I2', on_hand: 2000 }] });
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
    expect(container.querySelector('.pos-banner--danger')?.textContent).toBe(
      'Menu update refused (hash_mismatch). The hub is still using version 42.',
    );

    render({ ...STATUS, last_problem: { outcome: 'rejected', reason: 'apply_failed', at: hubAt(11) } });
    expect(container.querySelector('.pos-banner--danger')?.textContent).toBe(
      'Menu update could not be applied. The hub is still using version 42.',
    );

    render({ ...STATUS, last_problem: { outcome: 'unauthorized', reason: null, at: hubAt(11) } });
    expect(container.querySelector('.pos-banner--danger')?.textContent).toBe("The hub's cloud key was refused. Call support.");

    render({ ...STATUS, config_version: null, last_poll: { outcome: 'not_ready', at: hubAt(11) } });
    expect(container.querySelector('[data-status-line]')?.textContent).toBe('Waiting for hub confirmation');
    expect(container.querySelector('.pos-banner--danger')).toBeNull();
  });

  it('[01a §10 #103 page part] Off since <day> for an item off before the day started; no badge for one off today', () => {
    const data = answer({
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
    expect(button(rowOf('I2'), t('admin_stock.off')).getAttribute('aria-pressed')).toBe('true');
    expect(button(rowOf('I3'), t('admin_stock.available')).getAttribute('aria-pressed')).toBe('true');
  });

  it('[01a §10 #132 page part] alert bar lists low then out; hidden when none', () => {
    const rows = [
      { meta: meta('I1', { name: 'Paye' }), item: item('I1', { level: 'out', available: 0 }) },
      { meta: meta('I2', { name: 'Chicken Karahi', stock_unit: 'g' }), item: item('I2', { level: 'low', unit: 'g', available: 900 }) },
      { meta: meta('I3', { name: 'Naan' }), item: item('I3', { level: 'ok' }) },
    ];
    act(() => root.render(<AlertBar rows={rows} />));
    expect(container.querySelector('[data-alert-bar]')?.textContent).toBe('Low: Chicken Karahi 0.9 kg · Out: Paye');

    act(() => root.render(<AlertBar rows={[rows[2]!]} />));
    expect(container.querySelector('[data-alert-bar]')).toBeNull();
  });

  it('[01a §10 #137 page part] with the device clock 3 h wrong, the hours badge follows hub_time', () => {
    fakeTimers();
    vi.setSystemTime(hubAt(14) + 3 * HOUR);
    const morning = [{ start_ms: 7 * HOUR, end_ms: 13 * HOUR }];
    const data = answer({
      hub_time: { now_ms: hubAt(14), utc_offset_ms: OFFSET },
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
    expect(button(rowOf('I3'), t('admin_stock.off')).getAttribute('aria-pressed')).toBe('true');
  });

  it('[01a §8.2] a refresh does not overwrite the row being edited', async () => {
    fakeTimers();
    const later = answer({ stock_version: 8, items_meta: null, items: [item('I1', { on_hand: 9, available: 9 })] });
    const { api } = fakeHub([answer(), later]);
    act(() => root.render(<StockApp api={api} />));
    await flush();

    typeInto(rowOf('I1').querySelector('input'), '7');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await flush();
    expect(rowOf('I1').querySelector('input')?.value).toBe('7');
    expect(rowOf('I1').textContent).toContain(`${t('admin_stock.available_label')} 9`);
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
    const unchanged = answer({ unchanged: true, items_meta: null, items: null });
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
    expect(rowOf('I1').querySelector('input')?.value).toBe('5');
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

function renderTable(data: HubStockAnswer): void {
  const clock = createHubClock(data.hub_time);
  const items = new Map((data.items ?? []).map((i) => [i.item_id, i]));
  const rows = (data.items_meta ?? []).map((m) => ({ meta: m, item: items.get(m.item_id)! }));
  act(() =>
    root.render(
      <StockTable
        rows={rows}
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
