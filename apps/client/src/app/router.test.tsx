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

  it('[01c §8] matches the Menu section views: size groups, stock items, choice groups, deals', () => {
    expect(matchOwnerRoute('/size-groups')).toEqual({ name: 'size_groups' });
    expect(matchOwnerRoute('/size-groups/new')).toEqual({ name: 'size_group_edit', id: 'new' });
    expect(matchOwnerRoute('/size-groups/VG%201')).toEqual({ name: 'size_group_edit', id: 'VG 1' });
    expect(matchOwnerRoute('/stock-items')).toEqual({ name: 'stock_items' });
    expect(matchOwnerRoute('/stock-items/SI1')).toEqual({ name: 'stock_item_edit', id: 'SI1' });
    expect(matchOwnerRoute('/choice-groups')).toEqual({ name: 'choice_groups' });
    expect(matchOwnerRoute('/choice-groups/new')).toEqual({ name: 'choice_group_edit', id: 'new' });
    expect(matchOwnerRoute('/choice-groups/MG1')).toEqual({ name: 'choice_group_edit', id: 'MG1' });
    expect(matchOwnerRoute('/deals')).toEqual({ name: 'deals' });
    expect(matchOwnerRoute('/stock-items/SI1/branches')).toBeNull();
  });
});
