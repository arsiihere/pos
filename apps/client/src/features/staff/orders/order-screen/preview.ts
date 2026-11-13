import type { HubResult } from '../../../../api/hub-admin';
import type { LiveBus, LiveMessage } from '../../shell/live';
import type { EtaDraft, EtaPreviewBody } from '../contracts';

// 02b §8 Ordering screen, §6.14: the live times of the cart. `eta-preview` runs 250 ms after the last change, and
// again (same debounce) on BranchConfigApplied, a Stock* frame, BusinessDayOpened / Closed, a station frame or a catch-up carrying
// `stations_live`. A reply older than a later request is dropped. "Time updated" (02-B07): a line whose group
// promise moved by ≥ 60 s against the previous reply is in `moved` until the next reply. Preview failed or offline
// → no times ("—", "Times will be set when sent"); Send stays on (it queues, 26d). Logs nothing.

export const PREVIEW_DEBOUNCE_MS = 250;
export const MOVED_MS = 60_000;

export type PreviewState =
  | { kind: 'none' }
  | { kind: 'ok'; body: EtaPreviewBody; moved: ReadonlySet<string> }
  | { kind: 'failed' };

const REFETCH = new Set([
  'BranchConfigApplied',
  'StockSet',
  'StockAdded',
  'StockTransferredOut',
  'StockReserved',
  'StockReleased',
  'StockConsumed',
  'ItemMadeAvailable',
  'ItemMadeUnavailable',
  'StationPauseSet',
  'StationCapacitySet',
  'EngineConfigApplied',
  'BusinessDayOpened',
  'BusinessDayClosed',
]);

export interface PreviewOptions {
  etaPreview: (draft: EtaDraft) => Promise<HubResult<EtaPreviewBody>>;
  live: LiveBus;
  online: () => boolean;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface Preview {
  /** the cart changed (null = empty cart: no call, state none) */
  set(draft: EtaDraft | null): void;
  state(): PreviewState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** Each line's group promise (key → promise_ms). */
function promiseByKey(body: EtaPreviewBody): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of body.groups) for (const k of g.keys) out.set(k, g.promise_ms);
  return out;
}

export function createPreview(o: PreviewOptions): Preview {
  const later = o.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const cancel = o.clearTimeout ?? ((h: unknown) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>));
  let draft: EtaDraft | null = null;
  let state: PreviewState = { kind: 'none' };
  let last: EtaPreviewBody | null = null;
  let timer: unknown = null;
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (next: PreviewState) => {
    state = next;
    for (const l of [...listeners]) l();
  };

  const run = async () => {
    timer = null;
    const gen = ++generation;
    if (draft === null) return publish({ kind: 'none' });
    if (!o.online()) return publish({ kind: 'failed' });
    const answer = await o.etaPreview(draft);
    if (disposed || gen !== generation) return;
    if (!answer.ok) return publish({ kind: 'failed' });
    const before = last === null ? null : promiseByKey(last);
    const now = promiseByKey(answer.data);
    const moved = new Set<string>();
    if (before !== null) {
      for (const [k, p] of now) {
        const was = before.get(k);
        if (was !== undefined && Math.abs(p - was) >= MOVED_MS) moved.add(k);
      }
    }
    last = answer.data;
    publish({ kind: 'ok', body: answer.data, moved });
  };
  const schedule = () => {
    if (disposed) return;
    if (timer !== null) cancel(timer);
    timer = later(() => void run(), PREVIEW_DEBOUNCE_MS);
  };

  const off = o.live.subscribe((m: LiveMessage) => {
    if (draft === null) return;
    if ((m.kind === 'event' && REFETCH.has(m.event.event_type)) || (m.kind === 'catch_up' && m.state['stations_live'] !== undefined) || m.kind === 'reconnect') schedule();
  });

  return {
    set(next) {
      draft = next;
      if (next === null) {
        last = null;
        if (timer !== null) cancel(timer);
        timer = null;
        generation += 1;
        publish({ kind: 'none' });
        return;
      }
      schedule();
    },
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      off();
      if (timer !== null) cancel(timer);
    },
  };
}
