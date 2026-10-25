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
