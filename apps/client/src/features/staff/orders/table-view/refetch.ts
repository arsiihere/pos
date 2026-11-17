import type { HubResult } from '../../../../api/hub-admin';
import type { LiveBus } from '../../shell/live';

// 02b v1.0.11 §8 Table view (owner ruling Q-6, hub H1; integrator ruling IR-6): an open view (the table view's orders
// part, the takeaway / parking order view) reads its query again once, debounced 250 ms, on any order frame that may
// be about it — the stage frames ItemStarted / ItemDone / ItemDoneUndone / FireDispatched included — and on a socket
// reconnect or the page turning visible. No timer, no "Refresh" line. Only the newest read answers, and a reply is
// dropped when a triggering frame came after its request; that frame's debounced read answers instead (IR-6).

export const REFETCH_DEBOUNCE_MS = 250;

/** 02b §6.19 order frames the views show, and the Q-6 stage frames (H1). */
export const ORDER_FRAMES: ReadonlySet<string> = new Set([
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
  'OrderFoodServed',
  'OrderFoodCleared',
  'OrdersBilled',
  'LineWeightSet',
  'LineComped',
  'OrderContactSet',
  'ItemStarted',
  'ItemDone',
  'ItemDoneUndone',
  'FireDispatched',
]);

/** 02a frames that move orders between seatings (the seating's order list changes). */
export const SEATING_FRAMES: ReadonlySet<string> = new Set(['TableMoved', 'TablesMerged', 'SeatingSplit']);

export const idsOf = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A frame names one of these orders (order_id / order_ids) or lines; a frame naming neither may be about them. */
export function concerns(payload: Record<string, unknown>, orderIds: ReadonlySet<string>, lineIds: ReadonlySet<string>): boolean {
  const orders = [...idsOf(payload['order_id']), ...idsOf(payload['order_ids'])];
  const lines = [...idsOf(payload['order_item_id']), ...idsOf(payload['order_item_ids'])];
  if (orders.length === 0 && lines.length === 0) return true;
  return orders.some((o) => orderIds.has(o)) || lines.some((l) => lineIds.has(l));
}

export type LiveEvent = { event_type: string; payload: Record<string, unknown> };

export interface LiveReader {
  /** read now (mount, after an own action); a newer read or a later triggering frame wins over it */
  read(): Promise<void>;
  dispose(): void;
}

export function createLiveReader<T>(o: {
  live: LiveBus;
  query: () => Promise<HubResult<T>>;
  /** this view's frames */
  relevant: (event: LiveEvent) => boolean;
  /** called before the debounced read: e.g. a fallback view folds ItemServed itself */
  onFrame?: (event: LiveEvent) => void;
  onAnswer: (answer: HubResult<T>) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): LiveReader {
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let generation = 0;
  let triggers = 0;
  let timer: unknown = null;
  let disposed = false;
  const read = async () => {
    const gen = ++generation;
    const at = triggers;
    const answer = await o.query();
    if (disposed || gen !== generation || at !== triggers) return;
    o.onAnswer(answer);
  };
  const later = () => {
    triggers += 1;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      void read();
    }, REFETCH_DEBOUNCE_MS);
  };
  const off = o.live.subscribe((m) => {
    if (m.kind === 'reconnect' || m.kind === 'visible') return later();
    if (m.kind !== 'event') return;
    const event: LiveEvent = { event_type: m.event.event_type, payload: m.event.payload };
    if (!o.relevant(event)) return;
    o.onFrame?.(event);
    later();
  });
  return {
    read,
    dispose() {
      disposed = true;
      off();
      if (timer !== null) clearTimer(timer);
    },
  };
}
