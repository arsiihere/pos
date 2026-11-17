import { useEffect, useSyncExternalStore } from 'react';
import type { Toast } from '../../alerts/AnswerSheet';
import { Ico } from '../../alerts/ui';

// 02a-T01 / 02b-T01 Toasts (W0.6): one toast at a time for the whole staff page, 4 s. Every lane shows its toasts
// through the bus (the 01d answer sheet's toasts too), so two never stack.

export const TOAST_MS = 4_000;

export interface ToastBus {
  show(toast: Toast): void;
  current(): Toast | null;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export function createToastBus(): ToastBus {
  let current: Toast | null = null;
  const listeners = new Set<() => void>();
  const set = (t: Toast | null) => {
    current = t;
    for (const l of [...listeners]) l();
  };
  return {
    show: (t) => set({ ...t }),
    current: () => current,
    clear: () => set(null),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export function ToastView({ bus }: { bus: ToastBus }) {
  const toast = useSyncExternalStore(bus.subscribe, bus.current);
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => bus.clear(), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, bus]);
  if (toast === null) return null;
  return (
    <div className={`toast toast--${toast.tone ?? 'ok'}`} role="status">
      <Ico name={toast.tone === 'warn' ? 'warn' : toast.tone === 'info' ? 'info' : 'checkc'} />
      <div>
        {toast.text}
        {toast.sub !== undefined && <small>{toast.sub}</small>}
      </div>
    </div>
  );
}
