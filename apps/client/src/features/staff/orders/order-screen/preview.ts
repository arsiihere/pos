import type { HubResult } from '../../../../api/hub-admin';
import type { LiveBus, LiveMessage } from '../../shell/live';
import type { EtaDraft, EtaPreviewBody } from '../contracts';
import { pickupError, type PickupProblem } from './pickup';
import { STATION_LOAD_EVENTS } from '../live/availability';

// 02b §8 Ordering screen, §6.14: the live times of the cart. `eta-preview` runs 250 ms after the last change, and
// again (same debounce) on BranchConfigApplied, a Stock* frame, BusinessDayOpened / Closed, a station frame or a catch-up carrying
// `stations_live`. A reply older than a later request is dropped. "Time updated" (02-B07): a line whose group
// promise moved by ≥ 60 s against the previous reply is in `moved` until the next reply. Preview failed or offline
// → no times ("—", "Times will be set when sent"); Send stays on (it queues, 26d). 02b-TK C1-1 (02b §6.14, §8; audit
// #1): a `409 BUSINESS_DAY_NOT_OPEN` keeps its code as `day_not_open` (the cart says "Times show after Start day" and
// Send waits); a catch-up carrying `stock` (its business day) refetches too. Logs nothing.
// 02b-TK A2 item 5a (frame CartTimeDelta; MAPPING TK-S02 "previous vs new reply → delta"): `delta` names the cart line
// whose change (new, or more units, against the draft of the previous reply) moved Ready by (the latest group promise)
// later by ≥ 60 s, and by how much; any other reply (no cart change, Ready by not later) clears it.

export const PREVIEW_DEBOUNCE_MS = 250;
/** ⚠️ 02b v1.0.26 CT-2 (owner 2026-11-28, QA BUG-6): re-ask every 30 s while the cart has a line. */
export const PREVIEW_EVERY_MS = 30_000;

/** 02b-TK A2 item 5a: the line that moved Ready by later, and by how much (ms, ≥ MOVED_MS). */
export interface PreviewDelta {
  key: string;
  ms: number;
}
export const MOVED_MS = 60_000;

export type PreviewState =
  | { kind: 'none' }
  | { kind: 'ok'; body: EtaPreviewBody; moved: ReadonlySet<string>; delta: PreviewDelta | null }
  | { kind: 'failed' }
  /** the hub answered 409 BUSINESS_DAY_NOT_OPEN: no day is open, nothing can be sent or timed */
  | { kind: 'day_not_open' }
  /** ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §6.14, §3.2 step 2b): 422 PICKUP_TIME_INVALID — the draft's pickup, why and its bounds */
  | { kind: 'pickup_invalid'; problem: PickupProblem };

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

const readyOf = (body: EtaPreviewBody): number | null => (body.groups.length === 0 ? null : Math.max(...body.groups.map((g) => g.promise_ms)));

/** The last line of `now` that is new against `before`, or holds more units. */
function changedLine(before: EtaDraft, now: EtaDraft): string | null {
  const was = new Map(before.lines.map((l) => [l.key, l.quantity ?? 0]));
  const changed = now.lines.filter((l) => !was.has(l.key) || (l.quantity ?? 0) > was.get(l.key)!);
  return changed.at(-1)?.key ?? null;
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
  /** the draft the last reply answered */
  let lastDraft: EtaDraft | null = null;
  let timer: unknown = null;
  /** CT-2: the 30 s re-ask, re-armed at every run while the cart has a line */
  let every: unknown = null;
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (next: PreviewState) => {
    state = next;
    for (const l of [...listeners]) l();
  };

  const run = async () => {
    timer = null;
    if (every !== null) cancel(every);
    every = draft === null || disposed ? null : later(() => schedule(), PREVIEW_EVERY_MS);
    const gen = ++generation;
    if (draft === null) return publish({ kind: 'none' });
    if (!o.online()) return publish({ kind: 'failed' });
    const sent = draft;
    const answer = await o.etaPreview(sent);
    if (disposed || gen !== generation) return;
    if (!answer.ok) {
      const problem = answer.error.kind === 'api' && answer.error.code === 'PICKUP_TIME_INVALID' ? pickupError(answer.error.details) : null;
      if (problem !== null) return publish({ kind: 'pickup_invalid', problem });
      return publish(answer.error.kind === 'api' && answer.error.code === 'BUSINESS_DAY_NOT_OPEN' ? { kind: 'day_not_open' } : { kind: 'failed' });
    }
    const before = last === null ? null : promiseByKey(last);
    const now = promiseByKey(answer.data);
    const moved = new Set<string>();
    if (before !== null) {
      for (const [k, p] of now) {
        const was = before.get(k);
        if (was !== undefined && Math.abs(p - was) >= MOVED_MS) moved.add(k);
      }
    }
    // 02b-TK A2 item 5a: Ready by later by ≥ 1 min after a cart change → that line
    const wasReady = last === null ? null : readyOf(last);
    const isReady = readyOf(answer.data);
    const key = lastDraft === null ? null : changedLine(lastDraft, sent);
    const delta = wasReady !== null && isReady !== null && key !== null && isReady - wasReady >= MOVED_MS ? { key, ms: isReady - wasReady } : null;
    last = answer.data;
    lastDraft = sent;
    publish({ kind: 'ok', body: answer.data, moved, delta });
  };
  const schedule = () => {
    if (disposed) return;
    if (timer !== null) cancel(timer);
    timer = later(() => void run(), PREVIEW_DEBOUNCE_MS);
  };

  const off = o.live.subscribe((m: LiveMessage) => {
    if (draft === null) return;
    // ⚠️ 02b v1.0.26 CT-2: and every station-load frame the menu tiles refetch on (03a v1.2.7 §4.3 To 02 item 9)
    if ((m.kind === 'event' && (REFETCH.has(m.event.event_type) || STATION_LOAD_EVENTS.has(m.event.event_type))) || (m.kind === 'catch_up' && (m.state['stations_live'] !== undefined || m.state['stock'] !== undefined)) || m.kind === 'reconnect') schedule();
  });

  return {
    set(next) {
      draft = next;
      if (next === null) {
        last = null;
        lastDraft = null;
        if (timer !== null) cancel(timer);
        timer = null;
        if (every !== null) cancel(every);
        every = null;
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
      if (every !== null) cancel(every);
    },
  };
}
