import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { fakeHub, ok, refused, result, STATUS, type Route } from '../kitchen-screens/test-hub';
import { createFiscalApi, type FiscalCredential } from './api';
import { FiscalApp } from './Fiscal';

// 05 row H-2, §6.28a, §6.28b (R-63), B22: the /admin/fiscal/ page — one write-only field per (pos_id, credential name),
// "Set on <date>" / "Not set" from the fiscal-credentials read. The secrets scan: after a submit the token is in no
// input, no DOM text or attribute and no browser storage.

let m: Mounted;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m = mount();
});

afterEach(() => {
  m.unmount();
});

const READ = 'GET /admin/queries/fiscal-credentials';
const SET = 'POST /admin/commands/set-fiscal-token';
const SET_AT = Date.UTC(2026, 10, 18, 9, 0);

const LIST: FiscalCredential[] = [
  { pos_id: 'POS-1', label: 'Counter', name: 'token', set_at: SET_AT },
  { pos_id: 'POS-2', label: 'Bar', name: 'api_key', set_at: null },
  { pos_id: 'POS-2', label: 'Bar', name: 'token', set_at: null },
];

function signIn() {
  sessionStorage.setItem('admin_session_token', 'S1');
  sessionStorage.setItem('admin_staff_id', 'ST1');
}

function setup(routes: Record<string, Route | Response> = {}) {
  const hub = fakeHub({ [READ]: ok({ credentials: LIST }), 'GET /admin/queries/config-status': STATUS, ...routes });
  const api = createFiscalApi({ fetch: hub.fetchFn, readDeviceToken: async () => 'TOK', readDeviceId: async () => 'D1', onSignedOut: () => {} });
  m.render(<FiscalApp api={api} />);
  return hub;
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const rows = () => [...m.container.querySelectorAll<HTMLElement>('[data-credential]')];
const rowOf = (key: string) => {
  const row = rows().find((r) => r.dataset['credential'] === key);
  if (row === undefined) throw new Error(`no row ${key}`);
  return row;
};
const inputOf = (key: string) => rowOf(key).querySelector<HTMLInputElement>('input')!;
const saveOf = (key: string) => rowOf(key).querySelector<HTMLButtonElement>('button[type="submit"]')!;

/** B22: the token is nowhere on the page or in browser storage. */
function leaks(token: string): string[] {
  const places: string[] = [];
  if (document.documentElement.outerHTML.includes(token) || document.title.includes(token)) places.push('DOM');
  for (const input of document.querySelectorAll('input')) if (input.value.includes(token)) places.push('input value (document)');
  for (const input of m.container.querySelectorAll('input')) if (input.value.includes(token)) places.push('input value');
  for (const store of [sessionStorage, localStorage]) {
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i)!;
      if (k.includes(token) || (store.getItem(k) ?? '').includes(token)) places.push(store === sessionStorage ? 'sessionStorage' : 'localStorage');
    }
  }
  return places;
}

describe('fiscal admin page (05 row H-2, §6.28a, §6.28b)', () => {
  it('[05 row H-2] without an admin session the page shows the admin sign-in, titled Fiscal', async () => {
    setup();
    await flush();
    expect(m.container.querySelector('.pos-appbar__title')?.textContent).toBe('Fiscal');
    expect(rows()).toEqual([]);
  });

  it('[05 §6.28b, row H-2] reads fiscal-credentials once: one row per (pos_id, name), "Set on <date>" / "Not set"; every field write-only and empty', async () => {
    signIn();
    const hub = setup();
    await flush();
    expect(hub.reads('/admin/queries/fiscal-credentials')).toBe(1);
    expect(rows().map((r) => r.dataset['credential'])).toEqual(['POS-1:token', 'POS-2:api_key', 'POS-2:token']);
    expect(rowOf('POS-1:token').textContent).toContain('Counter');
    expect(rowOf('POS-1:token').textContent).toContain('POS-1');
    expect(rowOf('POS-1:token').textContent).toContain('Set on 18 Nov');
    expect(rowOf('POS-2:api_key').textContent).toContain('api_key');
    expect(rowOf('POS-2:api_key').textContent).toContain('Not set');
    for (const input of m.container.querySelectorAll<HTMLInputElement>('input')) {
      expect([input.type, input.value, input.getAttribute('autocomplete')]).toEqual(['password', '', 'off']);
    }
    // Save needs a value
    expect(saveOf('POS-2:token').disabled).toBe(true);
  });

  it('[05 §6.28a, B22] Save sends SetFiscalToken { pos_id, name, token }; the field is cleared at once; the row shows the new set time; the token is kept nowhere', async () => {
    signIn();
    const hub = setup({
      [SET]: () => result({ pos_id: 'POS-2', name: 'token', set_at: SET_AT }),
    });
    await flush();
    const token = 'SECRET-TOKEN-PAGE-0001';
    type(inputOf('POS-2:token'), token);
    expect(saveOf('POS-2:token').disabled).toBe(false);
    act(() => saveOf('POS-2:token').click());
    // cleared before the answer arrives
    expect(inputOf('POS-2:token').value).toBe('');
    await flush();
    expect(hub.commands('SetFiscalToken')).toEqual([{ pos_id: 'POS-2', name: 'token', token }]);
    expect(rowOf('POS-2:token').textContent).toContain('Set on 18 Nov');
    expect(rowOf('POS-2:api_key').textContent).toContain('Not set');
    expect(hub.reads('/admin/queries/fiscal-credentials')).toBe(1); // the result updates the row; no second read
    expect(leaks(token)).toEqual([]);
  });

  it('[05 §6.28a, 00 §3.7] every Save is a new command_id (a resend with another token must never replay an earlier one)', async () => {
    signIn();
    const hub = setup({ [SET]: () => result({ pos_id: 'POS-1', name: 'token', set_at: SET_AT }) });
    await flush();
    for (const token of ['SECRET-A-0002', 'SECRET-B-0003']) {
      type(inputOf('POS-1:token'), token);
      act(() => saveOf('POS-1:token').click());
      await flush();
    }
    const ids = hub.calls.filter((c) => c.body?.['command_type'] === 'SetFiscalToken').map((c) => c.body?.['command_id']);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(leaks('SECRET-A-0002')).toEqual([]);
    expect(leaks('SECRET-B-0003')).toEqual([]);
  });

  it('[05 §6.28a] a refusal shows the error on the row; the field stays empty (re-enter to retry); the set time is unchanged; the token is kept nowhere', async () => {
    signIn();
    setup({ [SET]: refused(422, 'CONFIG_REFERENCE_INVALID', { field: 'pos_id', reason: 'not_found' }) });
    await flush();
    const token = 'SECRET-REFUSED-0004';
    type(inputOf('POS-2:token'), token);
    act(() => saveOf('POS-2:token').click());
    await flush();
    expect(rowOf('POS-2:token').querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(rowOf('POS-2:token').textContent).toContain('Not set');
    expect(inputOf('POS-2:token').value).toBe('');
    expect(leaks(token)).toEqual([]);
  });

  it('[05 §6.28a] a network failure: error shown, field empty, token kept nowhere', async () => {
    signIn();
    setup({ [SET]: () => new Error('offline') });
    await flush();
    const token = 'SECRET-OFFLINE-0005';
    type(inputOf('POS-1:token'), token);
    act(() => saveOf('POS-1:token').click());
    await flush();
    expect(rowOf('POS-1:token').querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(inputOf('POS-1:token').value).toBe('');
    expect(leaks(token)).toEqual([]);
  });

  it('[05 §6.28b] a refused read (no manage-fiscal-settings) shows the error and no fields', async () => {
    signIn();
    setup({ [READ]: refused(403, 'PERMISSION_DENIED', { permission: 'manage-fiscal-settings', grant: 'not_granted' }) });
    await flush();
    expect(m.container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(rows()).toEqual([]);
    expect(m.container.querySelectorAll('input')).toHaveLength(0);
  });

  it('[05 §6.28b] an empty list (no POS IDs or no branch config) says so', async () => {
    signIn();
    setup({ [READ]: ok({ credentials: [] }) });
    await flush();
    expect(rows()).toEqual([]);
    expect(m.container.textContent).toContain('No POS IDs');
  });
});
