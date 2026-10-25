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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  sessionStorage.clear();
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const STATUS = {
  tenant_id: 'T1',
  branch_id: 'B1',
  config_version: 3,
  snapshot_schema_version: 1,
  applied_at: 10,
  directory_version: 2,
  last_poll: { outcome: 'applied', at: 20 },
  last_problem: null,
};

const ROSTER = {
  staff: [
    { staff_id: 'S_OWNER', display_name: 'Owner', locked_until: null },
    { staff_id: 'S_MGR', display_name: 'Manager', locked_until: null },
  ],
};

function routed(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = url.split('?')[0] ?? url;
    const reply = routes[`${init?.method ?? 'GET'} ${path}`];
    if (reply === undefined) throw new Error(`no route for ${path}`);
    return reply();
  });
  return { calls, fetchFn };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function pressPin(digits: string): void {
  const keys = [...container.querySelectorAll<HTMLButtonElement>('.pos-pin__key')];
  for (const digit of digits) act(() => keys.find((k) => k.textContent === digit)?.click());
}

describe('/admin/stock login', () => {
  it('[01a §8.2] no admin session shows the roster; tile + PIN stores admin_session_token and shows the stock view', async () => {
    const { calls, fetchFn } = routed({
      'GET /admin/login-roster': () => json(200, { data: ROSTER }),
      'POST /admin/auth': () =>
        json(200, {
          data: { admin_session_token: 'AS1', session_id: 'SES1', staff_id: 'S_MGR', display_name: 'Manager', idle_ttl_ms: 1 },
        }),
      'GET /admin/queries/config-status': () => json(200, { data: STATUS }),
    });
    const api = createHubAdmin({
      fetch: fetchFn,
      readDeviceToken: async () => 'DT1',
      readDeviceId: async () => 'D1',
      onSignedOut: () => {},
    });

    act(() => root.render(<StockApp api={api} />));
    await flush();

    expect(container.textContent).toContain(t('admin_stock.login.title'));
    const tiles = [...container.querySelectorAll<HTMLButtonElement>('.pos-staff__tile')];
    expect(tiles.map((b) => b.textContent)).toEqual(['Owner', 'Manager']);
    expect(container.querySelector('[data-view="stock"]')).toBeNull();

    act(() => tiles[1]?.click());
    pressPin('0123');
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('.pos-pin__key')].find((k) => k.textContent === t('pin.submit'))?.click();
    });
    await flush();

    const auth = calls.find((c) => c.url === '/admin/auth');
    expect(JSON.parse(String(auth?.init?.body))).toEqual({ staff_id: 'S_MGR', pin: '0123' });
    expect(sessionStorage.getItem('admin_session_token')).toBe('AS1');
    expect(container.querySelector('.pos-staff')).toBeNull();
    expect(container.querySelector('[data-view="stock"]')).not.toBeNull();
    expect(container.textContent).toContain(t('admin_stock.title'));
    // D7: the stock view reads config-status on open, before any command.
    expect(calls.some((c) => c.url === '/admin/queries/config-status')).toBe(true);
  });

  it('[01a §8.2] a wrong PIN shows errors.PIN_INVALID text and keeps the roster', async () => {
    const { fetchFn } = routed({
      'GET /admin/login-roster': () => json(200, { data: ROSTER }),
      'POST /admin/auth': () =>
        json(401, { error: { code: 'PIN_INVALID', message: 'x', details: { attempts_remaining: 4 }, request_id: 'R' } }),
    });
    const api = createHubAdmin({
      fetch: fetchFn,
      readDeviceToken: async () => 'DT1',
      readDeviceId: async () => 'D1',
      onSignedOut: () => {},
    });

    act(() => root.render(<StockApp api={api} />));
    await flush();
    act(() => container.querySelectorAll<HTMLButtonElement>('.pos-staff__tile')[1]?.click());
    pressPin('9999');
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('.pos-pin__key')].find((k) => k.textContent === t('pin.submit'))?.click();
    });
    await flush();

    expect(container.textContent).toContain(t('errors.PIN_INVALID'));
    expect(container.querySelector('.pos-pin.is-error')).not.toBeNull();
    expect(container.querySelector('.pos-staff')).not.toBeNull();
    expect(sessionStorage.getItem('admin_session_token')).toBeNull();
  });
});
