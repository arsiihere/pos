import type { LiveBus } from '../../shell/live';

// 02b-TK C1-1 (02b §8 Queue "Day not started", §6.14; audit #1): is a business day open, from what the staff socket
// already carries — the catch-up `stock` part's `business_day` (hub ws/restaurant-catch-up.ts: null before the first
// day, `closed_at` set once closed) and the BusinessDayOpened / BusinessDayClosed frames. 'unknown' until a catch-up
// with a `stock` part arrived (the screen then waits for eta-preview or Send to say so). Logs nothing.

export type DayOpen = 'open' | 'closed' | 'unknown';

export interface DayWatch {
  state(): DayOpen;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

function fromStock(part: unknown): DayOpen {
  if (typeof part !== 'object' || part === null || !('business_day' in part)) return 'unknown';
  const day = (part as { business_day: unknown }).business_day;
  if (day === null || typeof day !== 'object') return 'closed';
  return (day as { closed_at?: unknown }).closed_at == null ? 'open' : 'closed';
}

export function createDayWatch(live: LiveBus): DayWatch {
  let state: DayOpen = fromStock(live.part('stock'));
  const listeners = new Set<() => void>();
  const set = (next: DayOpen) => {
    if (next === state) return;
    state = next;
    for (const l of [...listeners]) l();
  };
  const off = live.subscribe((m) => {
    if (m.kind === 'catch_up' && m.state['stock'] !== undefined) set(fromStock(m.state['stock']));
    if (m.kind === 'event' && m.event.event_type === 'BusinessDayOpened') set('open');
    if (m.kind === 'event' && m.event.event_type === 'BusinessDayClosed') set('closed');
  });
  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose: off,
  };
}
