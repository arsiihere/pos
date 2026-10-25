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
    const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      json(200, {
        data: {
          access_token: 'A1',
          access_expires_at: 1,
          refresh_token: 'R1',
          refresh_expires_at: 2,
          user: { user_id: 'U1', display_name: 'Owner', tenant_id: 'T1', allowed_branch_ids: ['B1', 'B2'] },
        },
      }),
    );
    const api = createCloudAdmin({ fetch: fetchFn, onLoggedOut: () => {} });
    act(() => root.render(<App api={api} />));

    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.textContent).toContain(t('owner.login.title'));
    expect(container.textContent).not.toContain('B1');

    await submitLogin('o@example.com', 'password1');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/v1/auth/login');
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).toContain(t('owner.branches.title'));
    const branches = [...container.querySelectorAll<HTMLButtonElement>('[data-branch-id]')];
    expect(branches.map((b) => b.dataset['branchId'])).toEqual(['B1', 'B2']);
    expect(branches.map((b) => b.textContent)).toEqual(['B1', 'B2']);
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
});
