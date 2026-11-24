import type { HubResult } from '../../api/hub-admin';
import type { LiveBus, LiveMessage } from '../staff/shell/live';

// 02b-tk C3-4: the takeaway promises the Pass's Takeaway filter sorts by. `point_view` carries no promise (03b §6.15),
// so the Pass reads 02b §6.16 `GET /queries/open-orders?order_type=takeaway` (any device session; `promise_ms` per
// order) while the Takeaway filter is on: at start, 100 ms after the last station-load event (the 03a v1.2.7 To 02 #9
// list: these move a promise), on a catch-up, a reconnect and the page becoming visible, and every 30 s. An answer
// older than a later read is dropped; a failed read keeps the last promises.

const PROMISE_EVENTS: ReadonlySet<string> = new Set([
  'OrderPlaced',
  'ItemAdded',
  'OrderLinesAdded',
  'ItemRemoved',
  'ItemVoided',
  'ItemServed',
  'ItemReturned',
  'ItemsReleased',
  'OrderBoosted',
  'OrderCancelled',
  'FireDispatched',
  'ItemStarted',
  'ItemDone',
  'ItemDoneUndone',
  'StationCapacitySet',
  'StationPauseSet',
  'EngineConfigApplied',
]);
const DEBOUNCE_MS = 100;
const EVERY_MS = 30_000;

export interface TakeawayPromises {
  /** order_id → promise_ms (null while the order is not in the engine) */
  promises(): ReadonlyMap<string, number | null>;
  start(): void;
  stop(): void;
  subscribe(listener: () => void): () => void;
}

function parse(data: unknown): Map<string, number | null> | null {
  const orders = (data as { orders?: unknown } | null)?.orders;
  if (!Array.isArray(orders)) return null;
  const out = new Map<string, number | null>();
  for (const o of orders as Array<{ order_id?: unknown; promise_ms?: unknown }>) {
    if (typeof o.order_id === 'string') out.set(o.order_id, typeof o.promise_ms === 'number' ? o.promise_ms : null);
  }
  return out;
}

export function createTakeawayPromises(o: { live: LiveBus; read: () => Promise<HubResult<unknown>> }): TakeawayPromises {
  let current: ReadonlyMap<string, number | null> = new Map();
  const listeners = new Set<() => void>();
  let running = false;
  let asked = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const read = async () => {
    pending = null;
    if (!running) return;
    const mine = (asked += 1);
    const answer = await o.read();
    if (!running || mine !== asked || !answer.ok) return;
    const next = parse(answer.data);
    if (next === null) return;
    current = next;
    for (const l of [...listeners]) l();
  };
  const schedule = () => {
    if (!running) return;
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => void read(), DEBOUNCE_MS);
  };
  const onMessage = (m: LiveMessage) => {
    if (m.kind === 'catch_up' || m.kind === 'reconnect' || m.kind === 'visible' || (m.kind === 'event' && PROMISE_EVENTS.has(m.event.event_type))) schedule();
  };

  return {
    promises: () => current,
    start() {
      if (running) return;
      running = true;
      unsubscribe = o.live.subscribe(onMessage);
      poll = setInterval(schedule, EVERY_MS);
      void read();
    },
    stop() {
      running = false;
      if (pending !== null) clearTimeout(pending);
      if (poll !== null) clearInterval(poll);
      unsubscribe?.();
      pending = poll = unsubscribe = null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
