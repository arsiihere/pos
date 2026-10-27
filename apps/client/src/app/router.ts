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
  | { name: 'account_password' };

const FIXED: Record<string, OwnerRoute> = {
  '/staff': { name: 'staff' },
  '/staff/new': { name: 'staff_new' },
  '/roles': { name: 'roles' },
  '/teams': { name: 'teams' },
  '/stock-counting': { name: 'stock_counting' },
  '/branches': { name: 'branches' },
  '/account/password': { name: 'account_password' },
};

export function matchOwnerRoute(path: string): OwnerRoute | null {
  const fixed = FIXED[path];
  if (fixed !== undefined) return fixed;
  const staff = /^\/staff\/([^/]+)$/.exec(path);
  if (staff !== null) return { name: 'staff_edit', id: decodeURIComponent(staff[1]!) };
  const role = /^\/roles\/([^/]+)$/.exec(path);
  if (role !== null) return { name: 'role_edit', id: decodeURIComponent(role[1]!) };
  const settings = /^\/branches\/([^/]+)\/settings$/.exec(path);
  if (settings !== null) return { name: 'branch_settings', id: decodeURIComponent(settings[1]!) };
  return null;
}
