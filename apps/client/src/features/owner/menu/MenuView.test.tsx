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
    group_label: null,
    description: null,
    sort_order: 0,
    price_minor: 120_000,
    serve_mode: 'immediate',
    prep_buffer_ms: 0,
    cook_time_ms: 600_000,
    stock_time_ms: null,
    out_of_stock_behaviour: 'cook_fresh',
    stock_unit: 'piece',
    sale_unit: 'piece',
    stock_per_sale_unit: 1,
    low_stock_threshold: null,
    carries_over: false,
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
      categories: [{ category_id: 'C1', name: 'Karahi', sort_order: 0, archived_at: null, availability_windows: [] }],
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

    // With can_edit_tenant true the same menu has its save controls.
    act(() => root.unmount());
    root = createRoot(container);
    const editable = fakeApi(() => json(200, page([item('I1', 'Chicken Karahi')], null, true)));
    act(() => root.render(<MenuView api={editable.api} />));
    await flush();
    expect(container.textContent).not.toContain(t('owner.menu.read_only'));
    expect(container.querySelectorAll('form').length).toBeGreaterThan(0);
  });

  it('[01a §8.1, S48] typing sends one request after 300 ms; Load more appends the next page; a repeated item_id is shown once', async () => {
    vi.useFakeTimers();
    const { api, calls } = fakeApi((call) => {
      const url = new URL(call.url, 'http://cloud');
      if (url.searchParams.get('cursor') === 'c2') {
        return json(200, page([item('I3', 'Karahi Gosht'), item('I4', 'Karahi Mutton')], null));
      }
      if (url.searchParams.get('q') === 'kar') return json(200, page([item('I3', 'Karahi Gosht')], 'c2'));
      return json(200, page([item('I1', 'Aloo Paratha'), item('I2', 'Chicken Tikka')], 'c1'));
    });
    act(() => root.render(<MenuView api={api} />));
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/v1/admin/menu?status=active');
    expect(itemIds()).toEqual(['I1', 'I2']);

    const search = container.querySelector<HTMLInputElement>('input[name="q"]');
    typeInto(search, 'k');
    await flush(100);
    typeInto(search, 'ka');
    await flush(100);
    typeInto(search, 'kar');
    await flush(299);
    expect(calls).toHaveLength(1);
    await flush(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe('/v1/admin/menu?q=kar&status=active');
    expect(itemIds()).toEqual(['I3']);

    const loadMore = [...container.querySelectorAll('button')].find((b) => b.textContent === t('owner.menu.load_more'));
    if (!loadMore) throw new Error('Load more missing');
    await act(async () => loadMore.click());
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2]?.url).toBe('/v1/admin/menu?q=kar&status=active&cursor=c2');
    expect(itemIds()).toEqual(['I3', 'I4']);
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === t('owner.menu.load_more'))).toBe(false);
    await flush(1_000);
    expect(calls).toHaveLength(3);
  });
});
