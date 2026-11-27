import type { ReactNode } from 'react';

// ⚠️ 03b v1.0.17 §8 (QA design audit, frame PackerPass): the screen on the route may put one row of its own controls
// into the top bar — the Pass's order-type tabs (All / Dine-in / Takeaway / Parking) — and clears it when it goes. The
// bar draws it after the screen tabs. Off the Pass the slot is empty.

export interface BarSlotStore {
  get(): ReactNode;
  set(value: ReactNode): void;
  subscribe(listener: () => void): () => void;
}

export function createBarSlot(): BarSlotStore {
  let value: ReactNode = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
