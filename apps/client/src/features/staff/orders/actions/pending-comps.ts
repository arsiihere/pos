import { MyRequestRow } from '@pos/events';
import type { HubResult } from '../../../../api/hub-admin';
import type { LiveBus } from '../../shell/live';
import type { LineView } from '../contracts';

// 02b v1.0.11 §8 Table view (01d AD-1 waiting card; Q-11, E-7 "Comp it?"): two small in-memory stores of this page.
// 1. Open comp requests. The hub's `line.pending_comp` (H6) is the anchor whenever the field is there (null = none);
//    on a hub without H6 (field absent) the card comes from this device's memory of its own `CompLine` pending
//    results, lost on reload and invisible on other devices (fallback). The memory is cleared when the request is
//    answered or closed: a `LineComped` frame naming the alert, a my-requests read (01d §6.9) that no longer lists it
//    pending — read on a `request_result` alert (`resultSeen`, the shell's alert rows), a reconnect, the page turning
//    visible — and a Withdraw (or its 409 REQUEST_NOT_PENDING). "Mine" (Withdraw offered) = sent from this device or
//    listed pending in my-requests; never an amount the hub did not send.
// 2. Comp-it lines (E-7): a "Send it as a new item" line, announced by the order screen (26d `onCompItSent`) once its
//    round got its 2xx; one announced as queued waits for its own `ItemAdded` frame. The store (not the prompt) holds
//    them and watches the frames, so nothing is lost while no table view is on screen; a line is asked about once.

export interface WaitingComp {
  alert_id: string;
  order_item_id: string;
  /** the request's units; null = not known (an open request found through COMP_PENDING on a hub without H6) */
  units: number | null;
  /** the hub's requested amount (pending result / pending_comp); null = the hub sent none → no amount shown */
  value_minor: number | null;
  /** the chip's label, when this device sent it */
  reason: string | null;
}

/** 26d `CompItSent` (send/send.ts), plus `queued` for a round that went to the queue. */
export interface CompItSent {
  order_id: string;
  order_item_id: string;
  item_id: string;
  seating_id: string | null;
  queued?: boolean;
}

/** Where comp-it lines come from (27a3 binds 26d's `onCompItSent`). */
export interface CompItSource {
  subscribe(listener: (sent: CompItSent) => void): () => void;
}

export const NO_COMP_IT_SOURCE: CompItSource = { subscribe: () => () => {} };

export type MyRequestsLoader = () => Promise<HubResult<{ requests?: unknown }>>;

export interface PendingComps {
  /** a CompLine pending answer; `mine` false for an open request of someone else (COMP_PENDING) */
  remember(comp: WaitingComp, mine: boolean): void;
  forget(alert_id: string): void;
  /** the waiting card of a line, or null */
  forLine(line: LineView): WaitingComp | null;
  /** Withdraw is offered: this device sent it, or my-requests lists it as mine and pending */
  isMine(alert_id: string): boolean;
  /** the my-requests read (the staff api's `/queries/my-requests`); set by the waiting card */
  setLoader(load: MyRequestsLoader): void;
  /** one my-requests read (calls at once share it) */
  sync(): Promise<void>;
  /** a `request_result` alert reached the page (the shell's alert rows): read my-requests */
  resultSeen(): Promise<void>;
  bindSource(source: CompItSource): void;
  compItSent(sent: CompItSent): void;
  /** comp-it lines of the seating whose round was sent, oldest first */
  compItsFor(seating_id: string): CompItSent[];
  /** the prompt was answered (Yes or No): never asked again */
  compItDone(order_item_id: string): void;
  version(): number;
  subscribe(listener: () => void): () => void;
}

export function createPendingComps(live: LiveBus): PendingComps {
  const comps = new Map<string, WaitingComp & { mine: boolean }>();
  /** alert ids my-requests listed pending at the last read */
  let listed = new Set<string>();
  let load: MyRequestsLoader | null = null;
  let inFlight: Promise<void> | null = null;
  const compIts = new Map<string, CompItSent & { due: boolean }>();
  const asked = new Set<string>();
  const sources = new WeakSet<CompItSource>();
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version += 1;
    for (const l of [...listeners]) l();
  };
  const forget = (alert_id: string) => {
    if (comps.delete(alert_id)) changed();
  };
  const sync = (): Promise<void> => {
    if (load === null) return Promise.resolve();
    inFlight ??= (async () => {
      const answer = await load!();
      inFlight = null;
      if (!answer.ok) return;
      const rows = Array.isArray(answer.data.requests) ? answer.data.requests : [];
      const pending = new Set<string>();
      for (const r of rows) {
        const row = MyRequestRow.safeParse(r);
        if (row.success && row.data.kind === 'comp' && row.data.state === 'pending') pending.add(row.data.alert_id);
      }
      listed = pending;
      // a request of mine that is no longer pending was answered, withdrawn or closed
      for (const [id, c] of comps) if (c.mine && !pending.has(id)) comps.delete(id);
      changed();
    })();
    return inFlight;
  };
  const compItSent = (sent: CompItSent) => {
    if (asked.has(sent.order_item_id)) return;
    const was = compIts.get(sent.order_item_id);
    compIts.set(sent.order_item_id, { ...sent, due: was?.due === true || sent.queued !== true });
    changed();
  };

  live.subscribe((m) => {
    if (m.kind === 'reconnect' || m.kind === 'visible') {
      if (comps.size > 0) void sync();
      return;
    }
    if (m.kind !== 'event') return;
    if (m.event.event_type === 'LineComped') {
      const alert = m.event.payload['alert_id'];
      if (typeof alert === 'string') forget(alert);
      return;
    }
    if (m.event.event_type === 'ItemAdded') {
      const id = m.event.payload['order_item_id'];
      const entry = typeof id === 'string' ? compIts.get(id) : undefined;
      if (entry !== undefined && !entry.due) {
        entry.due = true;
        changed();
      }
    }
  });

  return {
    remember(comp, mine) {
      comps.set(comp.alert_id, { ...comp, mine });
      changed();
    },
    forget,
    forLine(line) {
      const memory = [...comps.values()].find((c) => c.order_item_id === line.order_item_id) ?? null;
      const mine: WaitingComp | null = memory === null ? null : { alert_id: memory.alert_id, order_item_id: memory.order_item_id, units: memory.units, value_minor: memory.value_minor, reason: memory.reason };
      if (line.pending_comp === undefined) return mine;
      // H6 is on the hub: its answer wins (null = no open request; a remembered one was answered or closed)
      if (line.pending_comp === null) return null;
      const hub = line.pending_comp;
      return {
        alert_id: hub.alert_id,
        order_item_id: line.order_item_id,
        units: hub.units,
        value_minor: hub.value_minor,
        reason: mine !== null && mine.alert_id === hub.alert_id ? mine.reason : null,
      };
    },
    isMine: (alert_id) => comps.get(alert_id)?.mine === true || listed.has(alert_id),
    setLoader(l) {
      load = l;
    },
    sync,
    resultSeen: sync,
    bindSource(source) {
      if (sources.has(source)) return;
      sources.add(source);
      source.subscribe(compItSent);
    },
    compItSent,
    compItsFor: (seating_id) =>
      [...compIts.values()]
        .filter((c) => c.due && c.seating_id === seating_id)
        .map((c) => ({ order_id: c.order_id, order_item_id: c.order_item_id, item_id: c.item_id, seating_id: c.seating_id })),
    compItDone(order_item_id) {
      asked.add(order_item_id);
      if (compIts.delete(order_item_id)) changed();
    },
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const perPage = new WeakMap<object, PendingComps>();

/** One store per staff shell (keyed by its orders api), for the page's life; it watches the shell's live bus. */
export function pendingCompsOf(shell: { orders: object; live: LiveBus }): PendingComps {
  let store = perPage.get(shell.orders);
  if (store === undefined) {
    store = createPendingComps(shell.live);
    perPage.set(shell.orders, store);
  }
  return store;
}
