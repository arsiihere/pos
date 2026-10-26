import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudAdmin } from '../../api/cloud-admin';
import { t } from '../../i18n';
import { App } from './App';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionStorage.clear();
  window.location.hash = '';
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

function typeInto(input: HTMLInputElement | null, text: string): void {
  if (!input) throw new Error('input missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submitLogin(email: string, password: string): Promise<void> {
  typeInto(container.querySelector<HTMLInputElement>('input[type="email"]'), email);
  typeInto(container.querySelector<HTMLInputElement>('input[type="password"]'), password);
  const form = container.querySelector('form');
  if (!form) throw new Error('form missing');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('owner app shell', () => {
  it("[01a §8.1] no token shows login; a successful login shows the branch picker with the JWT's branch ids", async () => {
    // The branch names read is refused here, so the ID tails show (S58).
    const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
      url === '/v1/auth/login'
        ? json(200, {
            data: {
              access_token: 'A1',
              access_expires_at: 1,
              refresh_token: 'R1',
              refresh_expires_at: 2,
              user: { user_id: 'U1', display_name: 'Owner', tenant_id: 'T1', allowed_branch_ids: ['B1', 'B2'] },
            },
          })
        : json(500, { error: { code: 'INTERNAL_ERROR', message: 'x', details: {}, request_id: 'R' } }),
    );
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} });
    act(() => root.render(<App api={api} />));

    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.textContent).toContain(t('owner.login.title'));
    expect(container.textContent).not.toContain('B1');

    await submitLogin('o@example.com', 'password1');

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual(['/v1/auth/login', '/v1/admin/branches']);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).toContain(t('owner.branch_title'));
    const branches = [...container.querySelectorAll<HTMLButtonElement>('[data-branch-id]')];
    expect(branches.map((b) => b.dataset['branchId'])).toEqual(['B1', 'B2']);
    // S58: with no names the ID tail shows.
    expect(branches.map((b) => b.querySelector('strong')?.textContent)).toEqual(['…B1', '…B2']);
    expect(window.location.hash).toBe('#/');

    act(() => branches[1]?.click());
    expect(container.textContent).toContain('B2');
    expect(branches[1]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('[01a §8.1] a failed login shows errors.LOGIN_INVALID text', async () => {
    const fetchFn = vi.fn(async () =>
      json(401, { error: { code: 'LOGIN_INVALID', message: 'x', details: {}, request_id: 'R1' } }),
    );
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} });
    act(() => root.render(<App api={api} />));

    await submitLogin('o@example.com', 'wrong-password');

    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(t('errors.LOGIN_INVALID'));
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe('o@example.com');
    expect(sessionStorage.getItem('owner_access_token')).toBeNull();
  });

  it('[01a §8.1] a locked-out login shows the lockout text, not the generic one', async () => {
    const fetchFn = vi.fn(async () =>
      json(429, { error: { code: 'IP_LOCKED_OUT', message: 'x', details: {}, request_id: 'R1' } }),
    );
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} });
    act(() => root.render(<App api={api} />));

    await submitLogin('o@example.com', 'wrong-password');

    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(t('errors.LOGIN_LOCKED_OUT'));
  });

  function signedIn(branches: string[]): void {
    sessionStorage.setItem('owner_access_token', 'A1');
    sessionStorage.setItem('owner_refresh_token', 'R1');
    sessionStorage.setItem(
      'owner_user',
      JSON.stringify({ user_id: 'U1', display_name: 'Arif', tenant_id: 'T1', allowed_branch_ids: branches }),
    );
  }

  // Answers by path: floors, stations and menu are empty; logout answers revoked; the branch list answers
  // the given names, or 404 without them.
  function routedFetch(fail: string[] = [], names?: Record<string, string>) {
    return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (fail.some((f) => url.startsWith(f))) throw new TypeError('network');
      if (url === '/v1/admin/branches' && names !== undefined)
        return json(200, {
          data: { branches: Object.entries(names).map(([branch_id, name]) => ({ branch_id, name, status: 'active' })) },
        });
      if (url.includes('/floors')) return json(200, { data: { floors: [] } });
      if (url.includes('/stations')) return json(200, { data: { stations: [] } });
      if (url.startsWith('/v1/admin/menu'))
        return json(200, { data: { can_edit_tenant: true, tax_classes: [], categories: [], items: [], next_cursor: null } });
      if (url === '/v1/auth/logout') return json(200, { data: { revoked: true } });
      return json(404, { error: { code: 'ROUTE_NOT_FOUND', message: 'x', details: {}, request_id: 'R' } });
    });
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('[01a §10 #164 app part] branch choice: one branch skips the picker; a pick survives a remount; a stale id is ignored; menu needs no branch; the app bar select switches', async () => {
    signedIn(['01JBRANCHONE0000000000P0AB']);
    let fetchFn = routedFetch();
    act(() => root.render(<App api={createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} })} />));
    await settle();
    expect(container.querySelector('[data-branch-id]')).toBeNull();
    expect(window.location.hash).toBe('#/menu');

    act(() => root.unmount());
    root = createRoot(container);
    sessionStorage.clear();
    window.location.hash = '';
    const two = ['01JBRANCHONE0000000000P0AB', '01JBRANCHTWO0000000000M6PQ'];
    signedIn(two);
    sessionStorage.setItem('owner_branch_id', 'NOT_ALLOWED');
    fetchFn = routedFetch();
    act(() => root.render(<App api={createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} })} />));
    await settle();
    const tiles = [...container.querySelectorAll<HTMLButtonElement>('[data-branch-id]')];
    expect(tiles.map((b) => b.querySelector('strong')?.textContent)).toEqual(['…P0AB', '…M6PQ']);
    expect(tiles.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);

    act(() => tiles[1]?.click());
    const go = container.querySelector<HTMLButtonElement>('button.pos-btn--primary');
    expect(go?.textContent).toBe('Continue with …M6PQ');
    await act(async () => go?.click());
    await settle();
    expect(window.location.hash).toBe('#/floors');
    expect(fetchFn.mock.calls.some(([u]) => u === `/v1/admin/branches/${two[1]}/floors`)).toBe(true);

    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<App api={createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} })} />));
    await settle();
    const select = container.querySelector<HTMLSelectElement>('select[name="branch"]');
    expect(select?.value).toBe(two[1]);
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual(['…P0AB', '…M6PQ']);
    await act(async () => {
      if (!select) return;
      select.value = two[0] ?? '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(fetchFn.mock.calls.at(-1)?.[0]).toBe(`/v1/admin/branches/${two[0]}/floors`);
    expect(sessionStorage.getItem('owner_branch_id')).toBe(two[0]);

    act(() => root.unmount());
    root = createRoot(container);
    sessionStorage.removeItem('owner_branch_id');
    window.location.hash = '#/menu';
    act(() => root.render(<App api={createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} })} />));
    await settle();
    expect(container.querySelector('h1.pos-appbar__title')?.textContent).toBe(t('owner.menu.title'));
    expect(container.querySelector('[data-branch-id]')).toBeNull();
  });

  it('[01a §10 #178] branch names from GET /v1/admin/branches on the picker, Continue and the Floors select; a refused read keeps the ID tails', async () => {
    const two = ['01JBRANCHONE0000000000P0AB', '01JBRANCHTWO0000000000M6PQ'];
    signedIn(two);
    const fetchFn = routedFetch([], { [two[0]!]: 'Gulberg', [two[1]!]: 'Johar Town' });
    act(() => root.render(<App api={createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} })} />));
    await settle();
    expect(fetchFn.mock.calls.filter(([url]) => url === '/v1/admin/branches')).toHaveLength(1);
    const tiles = [...container.querySelectorAll<HTMLButtonElement>('[data-branch-id]')];
    expect(tiles.map((b) => b.querySelector('strong')?.textContent)).toEqual(['Gulberg', 'Johar Town']);

    act(() => tiles[1]?.click());
    const go = container.querySelector<HTMLButtonElement>('button.pos-btn--primary');
    expect(go?.textContent).toBe('Continue with Johar Town');
    await act(async () => go?.click());
    await settle();
    const select = container.querySelector<HTMLSelectElement>('select[name="branch"]');
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual(['Gulberg', 'Johar Town']);

    act(() => root.unmount());
    root = createRoot(container);
    window.location.hash = '';
    sessionStorage.removeItem('owner_branch_id');
    const refused = routedFetch();
    act(() => root.render(<App api={createCloudAdmin({ fetch: refused, onLoggedOut: () => {} })} />));
    await settle();
    const tails = [...container.querySelectorAll<HTMLButtonElement>('[data-branch-id]')];
    expect(tails.map((b) => b.querySelector('strong')?.textContent)).toEqual(['…P0AB', '…M6PQ']);
    expect(container.querySelector('.pos-banner--danger')).toBeNull();
  });

  it('[01a §10 #169 page part] Sign out sends the logout, clears storage and shows login, also when the call fails', async () => {
    for (const fail of [[], ['/v1/auth/logout']]) {
      act(() => root.unmount());
      root = createRoot(container);
      sessionStorage.clear();
      window.location.hash = '#/menu';
      signedIn(['01JBRANCHONE0000000000P0AB']);
      const fetchFn = routedFetch(fail);
      act(() => root.render(<App api={createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} })} />));
      await settle();
      const signOut = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === t('owner.sign_out'),
      );
      await act(async () => signOut?.click());
      await settle();
      expect(fetchFn.mock.calls.some(([u]) => u === '/v1/auth/logout')).toBe(true);
      expect(sessionStorage.getItem('owner_access_token')).toBeNull();
      expect(sessionStorage.getItem('owner_branch_id')).toBeNull();
      expect(container.querySelector('input[type="email"]')).not.toBeNull();
    }
  });
});
