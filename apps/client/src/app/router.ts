import { useSyncExternalStore } from 'react';

// S35 b: views inside an entry use hash routes (`/owner/#/menu`); no router dependency.
function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function currentRoute(): string {
  const path = window.location.hash.replace(/^#/, '');
  return path === '' ? '/' : path;
}

export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, currentRoute);
}

export function navigate(path: string): void {
  window.location.hash = path;
}

// 01b §8: the owner app's 01b views. `null` for any other path (the 01a views match theirs in App).
export type OwnerRoute =
  | { name: 'staff' }
  | { name: 'staff_new' }
  | { name: 'staff_edit'; id: string }
  | { name: 'roles' }
  | { name: 'role_edit'; id: string }
  | { name: 'teams' }
  | { name: 'stock_counting' }
  | { name: 'branches' }
  | { name: 'branch_settings'; id: string }
  | { name: 'account_password' }
  // 01c §8 "Views": the Menu section's views (Items stay #/menu, 01a)
  | { name: 'size_groups' }
  | { name: 'size_group_edit'; id: string }
  | { name: 'stock_items' }
  | { name: 'stock_item_edit'; id: string }
  | { name: 'choice_groups' }
  | { name: 'choice_group_edit'; id: string }
  | { name: 'deals' };

const FIXED: Record<string, OwnerRoute> = {
  '/staff': { name: 'staff' },
  '/staff/new': { name: 'staff_new' },
  '/roles': { name: 'roles' },
  '/teams': { name: 'teams' },
  '/stock-counting': { name: 'stock_counting' },
  '/branches': { name: 'branches' },
  '/account/password': { name: 'account_password' },
  '/size-groups': { name: 'size_groups' },
  '/stock-items': { name: 'stock_items' },
  '/choice-groups': { name: 'choice_groups' },
  '/deals': { name: 'deals' },
};

// 01b §8, B05: while the owner must change the password every view redirects to #/account/password.
export const PASSWORD_ROUTE = '/account/password';

export function forcedRoute(path: string, mustChangePassword: boolean): string | null {
  return mustChangePassword && path !== PASSWORD_ROUTE ? PASSWORD_ROUTE : null;
}

export function matchOwnerRoute(path: string): OwnerRoute | null {
  const fixed = FIXED[path];
  if (fixed !== undefined) return fixed;
  const staff = /^\/staff\/([^/]+)$/.exec(path);
  if (staff !== null) return { name: 'staff_edit', id: decodeURIComponent(staff[1]!) };
  const role = /^\/roles\/([^/]+)$/.exec(path);
  if (role !== null) return { name: 'role_edit', id: decodeURIComponent(role[1]!) };
  // `new` opens an empty form (as #/staff/new); any other segment is the entity's id.
  const sizeGroup = /^\/size-groups\/([^/]+)$/.exec(path);
  if (sizeGroup !== null) return { name: 'size_group_edit', id: decodeURIComponent(sizeGroup[1]!) };
  const stockItem = /^\/stock-items\/([^/]+)$/.exec(path);
  if (stockItem !== null) return { name: 'stock_item_edit', id: decodeURIComponent(stockItem[1]!) };
  const choiceGroup = /^\/choice-groups\/([^/]+)$/.exec(path);
  if (choiceGroup !== null) return { name: 'choice_group_edit', id: decodeURIComponent(choiceGroup[1]!) };
  const settings = /^\/branches\/([^/]+)\/settings$/.exec(path);
  if (settings !== null) return { name: 'branch_settings', id: decodeURIComponent(settings[1]!) };
  return null;
}
