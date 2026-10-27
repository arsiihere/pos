import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matchOwnerRoute, useHashRoute } from './router';

function Show() {
  return <p>{useHashRoute()}</p>;
}

describe('router', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.location.hash = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('[01a S35 b] useHashRoute follows hashchange', () => {
    act(() => root.render(<Show />));
    expect(container.textContent).toBe('/');

    act(() => {
      window.location.hash = '#/menu';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(container.textContent).toBe('/menu');

    act(() => {
      window.location.hash = '#/floors';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(container.textContent).toBe('/floors');
  });

  it('[01b §8] the router knows #/staff, #/roles, #/teams, #/stock-counting, #/branches, #/account/password', () => {
    expect(matchOwnerRoute('/staff')).toEqual({ name: 'staff' });
    expect(matchOwnerRoute('/staff/new')).toEqual({ name: 'staff_new' });
    expect(matchOwnerRoute('/staff/S1')).toEqual({ name: 'staff_edit', id: 'S1' });
    expect(matchOwnerRoute('/roles')).toEqual({ name: 'roles' });
    expect(matchOwnerRoute('/roles/R1')).toEqual({ name: 'role_edit', id: 'R1' });
    expect(matchOwnerRoute('/teams')).toEqual({ name: 'teams' });
    expect(matchOwnerRoute('/stock-counting')).toEqual({ name: 'stock_counting' });
    expect(matchOwnerRoute('/branches')).toEqual({ name: 'branches' });
    expect(matchOwnerRoute('/branches/B%201/settings')).toEqual({ name: 'branch_settings', id: 'B 1' });
    expect(matchOwnerRoute('/account/password')).toEqual({ name: 'account_password' });
    expect(matchOwnerRoute('/menu')).toBeNull();
    expect(matchOwnerRoute('/staff/S1/extra')).toBeNull();
  });
});
