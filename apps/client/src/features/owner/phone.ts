import { useSyncExternalStore } from 'react';

// Phone layout at ≤ 760 px (the kit's breakpoint): bottom tab bar, price-first item page (S50 a, g).
const QUERY = '(max-width: 760px)';

function media(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const list = media();
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
}

export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false);
}
