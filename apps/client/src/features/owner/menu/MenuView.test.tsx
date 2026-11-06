import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudAdmin } from '../../../api/cloud-admin';
import { t } from '../../../i18n';
import { MenuView } from './MenuView';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
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

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeApi(handler: (call: Call) => Response) {
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
      return handler(call);
    },
  });
  return { api, calls };
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms);
    else await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function typeInto(input: HTMLInputElement | null | undefined, text: string): void {
  if (!input) throw new Error('input missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function item(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    item_id: id,
    category_id: 'C1',
    tax_class_id: null,
    name,
    variant_group_id: null,
    variant_name: null,
    description: null,
    sort_order: 0,
    price_minor: 120_000,
    serve_mode: 'immediate',
    prep_buffer_ms: 0,
    cook_time_ms: 600_000,
    stock_time_ms: null,
    out_of_stock_behaviour: 'cook_fresh',
    sale_unit: 'piece',
    requires_weighing: false,
    stock_draws: [],
    availability_windows: [],
    archived_at: null,
    routes: [],
    ...extra,
  };
}

function page(items: unknown[], next: string | null, canEdit = true) {
  return {
    data: {
      can_edit_tenant: canEdit,
      tax_classes: [{ tax_class_id: 'X1', name: 'Standard', rate_bp: 1600, archived_at: null }],
      categories: [{ category_id: 'C1', name: 'Karahi', sort_order: 0, archived_at: null, availability_windows: [], goes_with: [] }],
      variant_groups: [],
      items,
      next_cursor: next,
    },
  };
}

const itemIds = () => [...container.querySelectorAll('[data-item-id]')].map((el) => el.getAttribute('data-item-id'));

describe('owner menu view', () => {
  it('[01a §8.1] a load error is cleared by the next successful load', async () => {
    let fail = true;
    const { api } = fakeApi(() => {
      if (fail) throw new TypeError('Failed to fetch');
      return json(200, page([item('I1', 'Karahi')], null));
    });
    act(() => root.render(<MenuView api={api} />));
    await flush();
    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(t('errors.network'));

    fail = false;
    typeInto(container.querySelector<HTMLInputElement>('input[name="q"]'), 'kar');
    await flush(350);
    expect(itemIds()).toEqual(['I1']);
    expect(container.querySelector('.pos-banner--danger')).toBeNull();
  });

  it('[01a §10 #75] an item name with markup renders as text, with no img element', async () => {
    const name = '<img src=x onerror=alert(1)>';
    const { api } = fakeApi(() => json(200, page([item('I1', name)], null)));
    act(() => root.render(<MenuView api={api} />));
    await flush();

    expect(container.querySelector('[data-item-id="I1"]')?.textContent).toContain(name);
    expect(container.querySelector('img')).toBeNull();
  });

  it('[01a §10 #139 page part] can_edit_tenant false opens read-only with the info line', async () => {
    const { api } = fakeApi(() => json(200, page([item('I1', 'Chicken Karahi')], null, false)));
    act(() => root.render(<MenuView api={api} />));
    await flush();

    expect(container.textContent).toContain(t('owner.menu.read_only'));
    expect(container.querySelector('.pos-banner--info')?.textContent).toContain(t('owner.menu.read_only'));
    expect(container.querySelectorAll('form')).toHaveLength(0);
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).not.toContain(t('owner.common.archive'));
    expect(labels).not.toContain(t('owner.menu.add_tax_class'));
    expect(container.querySelector('[data-item-id="I1"]')?.textContent).toContain('Chicken Karahi');
    expect(container.querySelector('.pos-appbar .pos-btn--primary')).toBeNull();
    expect(labels).toContain(t('menu.view'));
    expect(labels).not.toContain(t('owner.common.edit'));

    // With can_edit_tenant true the same menu has its save controls.
    act(() => root.unmount());
    root = createRoot(container);
    const editable = fakeApi(() => json(200, page([item('I1', 'Chicken Karahi')], null, true)));
    act(() => root.render(<MenuView api={editable.api} />));
    await flush();
    expect(container.textContent).not.toContain(t('owner.menu.read_only'));
    // v1.1: the editable menu's save controls start from the app bar's New item (B01 hides it).
    expect(container.querySelector('.pos-appbar .pos-btn--primary')?.textContent).toBe(t('owner.menu.new_item'));
  });

  it('[01a §8.1, S48] typing sends one request after 300 ms; Load more appends the next page; a repeated item_id is shown once', async () => {
    vi.useFakeTimers();
    const { api, calls: allCalls } = fakeApi((call) => {
      const url = new URL(call.url, 'http://cloud');
      if (url.searchParams.get('cursor') === 'c2') {
        return json(200, page([item('I3', 'Karahi Gosht'), item('I4', 'Karahi Mutton')], null));
      }
      if (url.searchParams.get('q') === 'kar') return json(200, page([item('I3', 'Karahi Gosht')], 'c2'));
      return json(200, page([item('I1', 'Aloo Paratha'), item('I2', 'Chicken Tikka')], 'c1'));
    });
    // The menu reads only (the view also reads the stock items once, 01c size rows).
    const menuCalls = () => allCalls.filter((c) => c.url.startsWith('/v1/admin/menu'));
    act(() => root.render(<MenuView api={api} />));
    await flush();
    expect(menuCalls()).toHaveLength(1);
    expect(menuCalls()[0]?.url).toBe('/v1/admin/menu?status=active');
    expect(itemIds()).toEqual(['I1', 'I2']);

    const search = container.querySelector<HTMLInputElement>('input[name="q"]');
    typeInto(search, 'k');
    await flush(100);
    typeInto(search, 'ka');
    await flush(100);
    typeInto(search, 'kar');
    await flush(299);
    expect(menuCalls()).toHaveLength(1);
    await flush(1);
    expect(menuCalls()).toHaveLength(2);
    expect(menuCalls()[1]?.url).toBe('/v1/admin/menu?q=kar&status=active');
    expect(itemIds()).toEqual(['I3']);

    const loadMore = [...container.querySelectorAll('button')].find((b) => b.textContent === t('owner.menu.load_more'));
    if (!loadMore) throw new Error('Load more missing');
    await act(async () => loadMore.click());
    await flush();
    expect(menuCalls()).toHaveLength(3);
    expect(menuCalls()[2]?.url).toBe('/v1/admin/menu?q=kar&status=active&cursor=c2');
    expect(itemIds()).toEqual(['I3', 'I4']);
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === t('owner.menu.load_more'))).toBe(false);
    await flush(1_000);
    expect(menuCalls()).toHaveLength(3);
  });
  it('[01a §8.1 Pulse 01a-S05] Show archived items is in the app-bar More menu; the Archived shown chip goes back to active', async () => {
    const { api, calls } = fakeApi((call) =>
      json(200, page(call.url.includes('status=archived') ? [item('I9', 'Kheer', { archived_at: 1 })] : [item('I1', 'Chicken Karahi')], null)),
    );
    act(() => root.render(<MenuView api={api} />));
    await flush();
    // No Active / Archived segmented in the toolbar any more.
    expect(container.textContent).not.toContain(t('owner.menu.status_archived'));
    const more = container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more');
    expect(more?.getAttribute('aria-label')).toBe(t('owner.menu.more'));
    await act(async () => more?.click());
    const show = [...container.querySelectorAll<HTMLButtonElement>('.pos-appbar [role="menuitem"]')].find(
      (b) => b.textContent === t('menu.show_archived_items'),
    );
    await act(async () => show?.click());
    await flush();
    expect(calls.at(-1)?.url).toContain('status=archived');
    expect(itemIds()).toEqual(['I9']);
    const chip = container.querySelector<HTMLButtonElement>('button.pos-filterchip');
    expect(chip?.textContent).toBe(t('menu.archived_shown'));
    expect(chip?.getAttribute('aria-label')).toBe(t('menu.hide_archived_items'));
    await act(async () => chip?.click());
    await flush();
    expect(calls.at(-1)?.url).toContain('status=active');
    expect(itemIds()).toEqual(['I1']);
    expect(container.querySelector('button.pos-filterchip')).toBeNull();
  });

  it('[01a §8.1 Pulse 01a-S05] a row shows "{n} of {m} branches" as text, a warn chip only when partial, and no hours or sold-out tags', async () => {
    sessionStorage.setItem('owner_user', JSON.stringify({ user_id: 'U1', display_name: 'A', tenant_id: 'T1', allowed_branch_ids: ['B1', 'B2'], must_change_password: false }));
    const route = (b: string) => ({ branch_id: b, station_id: 'S1', program_id: null, stock_program_id: null, price_minor_override: null });
    const { api } = fakeApi(() =>
      json(
        200,
        page(
          [
            item('I1', 'Naan', { routes: [route('B1'), route('B2')], description: 'Made to order', out_of_stock_behaviour: 'sold_out', availability_windows: [{ start_ms: 25_200_000, end_ms: 46_800_000 }] }),
            item('I2', 'Lassi', { routes: [route('B1')] }),
          ],
          null,
        ),
      ),
    );
    act(() => root.render(<MenuView api={api} />));
    await flush();
    const row = (id: string) => container.querySelector(`[data-item-id="${id}"]`)?.closest('.pos-list__row');
    expect(row('I1')?.querySelector('.pos-list__name span')?.textContent).toBe('Made to order');
    expect(row('I1')?.querySelector('.pos-list__meta')?.textContent).toBe('2 of 2 branches');
    expect(row('I1')?.querySelector('.pos-chip')).toBeNull();
    expect(row('I1')?.textContent).not.toContain('07:00');
    expect(row('I1')?.textContent).not.toContain(t('menu.sold_out_when_gone'));
    expect(row('I2')?.querySelector('.pos-chip--warn')?.textContent).toBe('1 of 2 branches');
  });

  it('[01a §8.1 Pulse 01a-S05] with the inline tax form open, Add tax rate is the one primary', async () => {
    const { api } = fakeApi(() => json(200, page([item('I1', 'Chicken Karahi')], null)));
    act(() => root.render(<MenuView api={api} />));
    await flush();
    const tab = [...container.querySelectorAll<HTMLButtonElement>('.pos-seg__opt')].find((b) => b.childNodes[0]?.textContent === t('menu.tax_rates'));
    await act(async () => tab?.click());
    // The app-bar More is the items list's (Show archived items); the tax tab has none.
    expect(container.querySelector('.pos-appbar button.pos-more')).toBeNull();
    const add = container.querySelector<HTMLButtonElement>('.pos-appbar .pos-btn--primary');
    expect(add?.textContent).toBe(t('menu.new_tax'));
    await act(async () => add?.click());
    const primaries = [...container.querySelectorAll('.pos-btn--primary')].map((b) => b.textContent);
    expect(primaries).toEqual([t('owner.menu.add_tax_class')]);
  });
  it('[01a §8.1 01a-S06] category Edit opens the category dialog over the Categories tab', async () => {
    const { api } = fakeApi(() => json(200, page([item('I1', 'Chicken Karahi')], null)));
    act(() => root.render(<MenuView api={api} />));
    await flush();
    const tab = [...container.querySelectorAll<HTMLButtonElement>('.pos-seg__opt')].find((b) => b.childNodes[0]?.textContent === t('owner.menu.categories'));
    await act(async () => tab?.click());
    const edit = [...container.querySelectorAll<HTMLButtonElement>('[data-category-id="C1"] button')].find((b) => b.textContent === t('owner.common.edit'));
    await act(async () => edit?.click());
    expect(container.querySelector('[role="dialog"] form[data-form="category"]')).not.toBeNull();
    // The list stays under the dialog.
    expect(container.querySelector('[data-category-id="C1"]')).not.toBeNull();
  });
});
