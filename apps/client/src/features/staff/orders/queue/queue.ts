import type { HubError, HubResult } from '../../../../api/hub-admin';
import type { HubClock } from '../../../../app/hub-clock';
import { newUlid } from '../../../../app/ulid';
import type { CommandOptions, Device } from '../../api';
import type { LiveBus } from '../../shell/live';
import type { EnqueueMeta, EnqueueResult, QueueableCommand } from '../../tables/contracts';
import { definitiveRefusal } from '../../tables/errors';
import type { QueueEntry, QueueStore } from '../contracts';
import { entryRecord } from './idb-store';
import { createMemoryQueueStore } from './memory-store';

// 02b v1.0.11 §3.12, §8 Queue, §10 #35; 02a §8 Offline; 00 v1.9.1 §8.1, H-1; owner Q-2, Q-3 (25b): the device's one
// command queue.
//
// - Only SubmitOrder, MarkServed, RequestBill, CleanTable are queued; anything else answers `needs_hub` unsent.
// - An entry is written to the store before its first send, with its command_id (= entry_id, the same on every
//   send), queued_at (hub clock) and staff_id. The session token is kept in this page's memory only (Q-2).
// - Sends go in queued_at order (then entry_id), one at a time; a new command waits behind older queued ones. Only the
//   send its own enqueue() call waits on (online, nothing older in the way) is a plain command; every other send is a
//   replay with `X-Queued-At` (the hub reads it as "queued": no lock taken, sent_after_reconnect).
// - 2xx → removed, "sent" (never before it). A definitive 4xx → removed and `refused` to a caller still waiting on
//   its first send, else into the queue log with the hub's code; the next entry is sent. `ORDER_ITEM_ID_IN_USE` for
//   the device's own pending SubmitOrder = it was already accepted → sent (result undefined: refetch to show it).
// - Not an answer (network, lost 2xx, 5xx, 426, 403 DEVICE_REVOKED) → the entry stays queued and the drain stops.
//   403 DEVICE_REVOKED also runs the device wipe (pos-device keys; pos-queue is kept) and stops every later drain.
// - 401 SESSION_* (or the page's own session ending) → that entry, and every entry with the same session, into the
//   log ("Send again" after the next login); the drain stops.
// - An entry older than queue_auto_send_max_ms goes into the log unsent.
// - After a reload no token is known: at load every queued entry goes into the log (`reloaded`) as "Send again as
//   {current person}" — the same command_id, so a command already committed gets the hub's stored 2xx (M19).
//   Another page of this origin that is still open (a second tab, `presence`) owns its queued entries: then they are
//   left alone (not logged, not sent here). A page sends only the entries it queued in its own life (review #156).
// - The store rejects (blocked site data, quota): the queue goes on in memory for this page's life (review #156).
// - The queue drains on enqueue, on a socket reconnect / catch-up (it subscribes to the live bus first, and its first
//   send leaves synchronously, so it goes before any other screen's refetch) and on `drain()` (sign-in, 25c).

export const QUEUEABLE: ReadonlySet<string> = new Set<QueueableCommand>(['SubmitOrder', 'MarkServed', 'RequestBill', 'CleanTable']);

/** 01a default of `queue_auto_send_max_ms` (the hub's own fallback, auth/session-sweeper.ts) until a config is known. */
export const DEFAULT_QUEUE_AUTO_SEND_MAX_MS = 14_400_000;

/** log_reason values the queue itself sets (others are the hub's error codes). */
export const LOG_REASON = { reloaded: 'reloaded', tooOld: 'too_old', noSession: 'no_session' } as const;

const SESSION_CODES = new Set(['SESSION_EXPIRED', 'SESSION_INVALID']);

/** What the queue needs of the staff api (createStaffApi). */
export interface QueueApi {
  command<T>(commandType: string, payload: unknown, opts?: CommandOptions): Promise<HubResult<T>>;
  sessionToken(): string | null;
  staffId(): string | null;
}

export interface CommandQueueDeps {
  api: QueueApi;
  device: Device;
  clock: () => HubClock;
  live: LiveBus;
  store: QueueStore;
  /** branch `queue_auto_send_max_ms`; null = not known yet → the 01a default */
  maxAgeMs?: () => number | null;
  /** 403 DEVICE_REVOKED: the device wipe (pos-device keys); pos-queue entries are kept */
  onDeviceRevoked: () => void;
  newId?: () => string;
  /** other open pages of this origin (one tab sends its own entries); `mine` = this page's queued ids. Default: none */
  presence?: (mine: () => string[]) => Presence;
}

/** Other live pages of this origin that keep a queue (a second tab). */
export interface Presence {
  /** the queued entry ids other open pages hold (they send them, this page leaves them alone) */
  ownedElsewhere(): Promise<ReadonlySet<string>>;
  /** tell the other pages these entries left the store (sent, refused to their caller, discarded) */
  announceRemoved(ids: string[]): void;
  /** another page removed these entries */
  onRemoved(listener: (ids: string[]) => void): () => void;
  dispose(): void;
}

export type SendAgainResult<R = unknown> =
  | { status: 'sent'; result: R }
  | { status: 'log'; reason: string }
  | { status: 'queued'; entry_id: string }
  /** nobody is signed in: "Send again" needs a person */
  | { status: 'needs_person' };

export interface SentNotice {
  entry: QueueEntry;
  /** the hub's result; undefined when the hub said ORDER_ITEM_ID_IN_USE for this device's own order (refetch) */
  result: unknown;
  /** sent later, not to the enqueue() call that queued it (that caller already got `queued`): the sticky card (25c) */
  later: boolean;
}

export interface CommandQueue {
  enqueue<R = unknown>(type: QueueableCommand, payload: unknown, meta: EnqueueMeta): Promise<EnqueueResult<R>>;
  /** queued entries for this table (not the log) */
  pendingFor(table_id: string): number;
  /** every queued entry (not the log) */
  pendingCount(): number;
  /** queued entries, in send order */
  queued(): QueueEntry[];
  /** the queue log, in queued_at order */
  log(): QueueEntry[];
  /** send everything queued now; resolves when the drain stopped or ran dry */
  drain(): Promise<void>;
  /** a log entry sent again as the person signed in now, with the same command_id */
  sendAgain<R = unknown>(entry_id: string): Promise<SendAgainResult<R>>;
  discard(entry_id: string): Promise<void>;
  /** the store was read (entries of an earlier page life moved to the log) */
  ready: Promise<void>;
  subscribe(listener: () => void): () => void;
  /** every entry the hub accepted (a replay included) */
  onSent(listener: (notice: SentNotice) => void): () => void;
  dispose(): void;
}

type Outcome = { kind: 'sent'; result: unknown } | { kind: 'refused'; error: Extract<HubError, { kind: 'api' }> } | { kind: 'log'; reason: string };

type Step = 'next' | 'stop';

export function createCommandQueue(d: CommandQueueDeps): CommandQueue {
  const newId = d.newId ?? (() => newUlid());
  let entries: QueueEntry[] = [];
  /** entry_id → the session that queued it (memory only, Q-2) */
  const sessions = new Map<string, { token: string; staff_id: string }>();
  /** entries sent at least once (a later send is a replay with X-Queued-At) */
  const attempted = new Set<string>();
  /** entries whose enqueue() / sendAgain() call waits for its send */
  const waiting = new Set<string>();
  const outcomes = new Map<string, Outcome>();
  const listeners = new Set<() => void>();
  const sentListeners = new Set<(n: SentNotice) => void>();
  let loaded = false;
  const presence = d.presence?.(() => entries.filter((e) => e.state === 'queued').map((e) => e.entry_id));
  let store: QueueStore = d.store;
  /** the store rejected: keep going in memory (this page's entries only) */
  const fallBack = () => {
    if (store === d.store) store = createMemoryQueueStore(new Map(entries.map((e) => [e.entry_id, entryRecord(e)])));
  };
  let revoked = false;
  let running: Promise<void> | null = null;
  /** "Send again" taps (manual: the auto-send age window does not apply, Q-2), and the one call in flight per entry */
  const manual = new Set<string>();
  const againInFlight = new Map<string, Promise<SendAgainResult>>();
  /** ids another page removed (sent, discarded): never written back here */
  const removedElsewhere = new Set<string>();

  const changed = () => {
    for (const l of [...listeners]) l();
  };
  const order = () => entries.sort((a, b) => (a.queued_at !== b.queued_at ? a.queued_at - b.queued_at : a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0));
  const write = async (e: QueueEntry) => {
    try {
      await store.put(e);
    } catch {
      fallBack();
      await store.put(e);
    }
  };
  const drop = async (id: string) => {
    entries = entries.filter((e) => e.entry_id !== id);
    sessions.delete(id);
    attempted.delete(id);
    manual.delete(id);
    changed();
    try {
      await store.remove(id);
    } catch {
      fallBack();
      await store.remove(id);
    }
    presence?.announceRemoved([id]);
  };
  const toLog = async (e: QueueEntry, reason: string) => {
    const logged: QueueEntry = { ...e, state: 'log', log_reason: reason };
    entries = entries.map((x) => (x.entry_id === e.entry_id ? logged : x));
    sessions.delete(e.entry_id);
    manual.delete(e.entry_id);
    outcomes.set(e.entry_id, { kind: 'log', reason });
    changed();
    await write(logged);
  };

  const ready = (async () => {
    let stored: QueueEntry[] = [];
    try {
      stored = await d.store.list();
    } catch {
      fallBack();
    }
    // another open page owns the queued entries it holds; else an earlier page life's sessions are gone and its
    // queued entries wait in the log for "Send again" (Q-2)
    if (presence !== undefined) {
      const elsewhere = await presence.ownedElsewhere().catch(() => new Set<string>());
      // review #162: while the other pages answered, one of them may have sent (and removed) an entry read above —
      // read again, keep only what is still stored, and never what another page said it removed
      try {
        const now = new Set((await d.store.list()).map((e) => e.entry_id));
        stored = stored.filter((e) => now.has(e.entry_id));
      } catch {
        fallBack();
      }
      stored = stored.filter((e) => !(e.state === 'queued' && elsewhere.has(e.entry_id)));
    }
    const kept = stored.filter((e) => !removedElsewhere.has(e.entry_id));
    const moved = kept.map((e) => (e.state === 'queued' ? { ...e, state: 'log' as const, log_reason: LOG_REASON.reloaded } : e));
    entries = [...moved, ...entries];
    order();
    for (const e of moved) {
      if (e.log_reason !== LOG_REASON.reloaded || stored.find((x) => x.entry_id === e.entry_id)?.state !== 'queued') continue;
      if (!removedElsewhere.has(e.entry_id) && entries.some((x) => x.entry_id === e.entry_id)) await write(e);
    }
    loaded = true;
    changed();
  })();

  const maxAge = () => {
    const v = d.maxAgeMs?.() ?? null;
    return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_QUEUE_AUTO_SEND_MAX_MS;
  };

  const sent = async (e: QueueEntry, result: unknown) => {
    outcomes.set(e.entry_id, { kind: 'sent', result });
    await drop(e.entry_id);
    const later = !waiting.has(e.entry_id);
    for (const l of [...sentListeners]) l({ entry: e, result, later });
  };

  /** one entry; 'stop' ends the drain (no answer, a session ended, the device revoked) */
  async function sendOne(e: QueueEntry): Promise<Step> {
    // the window is for the automatic send only; a "Send again" tap always sends (Q-2: same command_id)
    if (!manual.has(e.entry_id) && d.clock().nowMs() - e.queued_at > maxAge()) {
      await toLog(e, LOG_REASON.tooOld);
      return 'next';
    }
    const session = sessions.get(e.entry_id);
    if (session === undefined) {
      await toLog(e, LOG_REASON.noSession);
      return 'next';
    }
    // plain only for the send its own enqueue() waits on; anything sent later is a replay (X-Queued-At: queued, no
    // lock taken, sent_after_reconnect — 00 H-1)
    const replay = attempted.has(e.entry_id) || !waiting.has(e.entry_id);
    attempted.add(e.entry_id);
    const opts: CommandOptions = { commandId: e.entry_id, sessionToken: session.token, actorId: session.staff_id, ...(replay ? { queuedAt: e.queued_at } : {}) };
    const answer = await d.api.command<unknown>(e.command_type, e.payload, opts);
    if (answer.ok) {
      await sent(e, answer.data);
      return 'next';
    }
    const error = answer.error;
    // the page's own session ended (api signed it out), or another person's session is gone (Q-2)
    if (error.kind === 'signed_out' || (error.kind === 'api' && error.status === 401 && SESSION_CODES.has(error.code))) {
      const reason = error.kind === 'api' ? error.code : 'SESSION_EXPIRED';
      for (const other of entries.filter((x) => x.state === 'queued' && sessions.get(x.entry_id)?.token === session.token)) await toLog(other, reason);
      return 'stop';
    }
    if (error.kind === 'api' && error.status === 403 && error.code === 'DEVICE_REVOKED') {
      revoked = true;
      d.onDeviceRevoked();
      return 'stop';
    }
    if (error.kind === 'api' && error.code === 'ORDER_ITEM_ID_IN_USE' && e.command_type === 'SubmitOrder') {
      const own = (e.payload as { order_id?: unknown } | null)?.order_id;
      if (typeof own === 'string' && error.details['order_id'] === own) {
        await sent(e, undefined);
        return 'next';
      }
    }
    // a local refusal (a token without its person, status 0) is as definitive as a 4xx: never retried
    const refusal = definitiveRefusal(error) ?? (error.kind === 'api' && error.code === 'CLIENT_SESSION_WITHOUT_ACTOR' ? error : null);
    if (refusal !== null) {
      if (!replay) {
        outcomes.set(e.entry_id, { kind: 'refused', error: refusal });
        await drop(e.entry_id);
      } else await toLog(e, refusal.code);
      return 'next';
    }
    // not an answer: stays queued, sent again later with the same id
    return 'stop';
  }

  async function loop(): Promise<void> {
    for (;;) {
      if (revoked) return;
      const next = entries.find((e) => e.state === 'queued');
      if (next === undefined) return;
      if ((await sendOne(next)) === 'stop') return;
    }
  }

  function drain(): Promise<void> {
    if (running !== null) return running;
    // loaded: the first send leaves synchronously (before any later subscriber's refetch on reconnect)
    const run = loaded ? loop() : ready.then(loop);
    running = run.finally(() => {
      running = null;
    });
    return running;
  }

  /** drain until this entry was tried: a drain already running may have passed it, then one more */
  async function settle(id: string): Promise<Outcome | null> {
    const joined = running !== null;
    await drain();
    const o = outcomes.get(id);
    if (o !== undefined || !joined || attempted.has(id) || revoked) return o ?? null;
    await drain();
    return outcomes.get(id) ?? null;
  }

  const off = d.live.subscribe((m) => {
    if (m.kind === 'reconnect' || m.kind === 'catch_up') void drain();
  });
  // another page sent or discarded these: gone here too (a copy written back by a race is removed again)
  const offRemoved =
    presence?.onRemoved((ids) => {
      let hit = false;
      for (const id of ids) {
        removedElsewhere.add(id);
        if (!entries.some((e) => e.entry_id === id)) continue;
        hit = true;
        entries = entries.filter((e) => e.entry_id !== id);
        sessions.delete(id);
        void store.remove(id).catch(() => {});
      }
      if (hit) changed();
    }) ?? (() => {});

  /** hub-clock now, but always after the page's previous entry (two commands in one ms keep their order; ULIDs of
   *  one ms are not ordered) */
  let lastQueuedAt = -Infinity;
  const nextQueuedAt = () => {
    lastQueuedAt = Math.max(d.clock().nowMs(), lastQueuedAt + 1);
    return lastQueuedAt;
  };

  async function enqueue<R>(type: QueueableCommand, payload: unknown, meta: EnqueueMeta): Promise<EnqueueResult<R>> {
    if (!QUEUEABLE.has(type)) return { status: 'needs_hub' };
    const token = d.api.sessionToken();
    const staff_id = d.api.staffId();
    if (token === null || staff_id === null) return { status: 'needs_hub' };
    await ready;
    const entry = entryRecord({
      entry_id: newId(),
      command_type: type,
      payload, // copied here: the frozen cart (#35)
      queued_at: nextQueuedAt(),
      staff_id,
      device_id: d.device.id,
      ...(meta.table_id === undefined ? {} : { table_id: meta.table_id }),
      ...(meta.seating_id === undefined ? {} : { seating_id: meta.seating_id }),
      label: meta.label,
      state: 'queued',
    });
    await write(entry);
    entries.push(entry);
    order();
    sessions.set(entry.entry_id, { token, staff_id });
    waiting.add(entry.entry_id);
    changed();
    try {
      const o = await settle(entry.entry_id);
      if (o?.kind === 'sent') return { status: 'sent', result: o.result as R };
      if (o?.kind === 'refused') return { status: 'refused', error: o.error };
      // queued, or kept in the log for "Send again" (a session that ended)
      return { status: 'queued', entry_id: entry.entry_id };
    } finally {
      waiting.delete(entry.entry_id);
      outcomes.delete(entry.entry_id);
    }
  }

  function sendAgain<R>(entry_id: string): Promise<SendAgainResult<R>> {
    // a second tap while one is in flight is the same call (never a "missing" failure)
    const inFlight = againInFlight.get(entry_id);
    if (inFlight !== undefined) return inFlight as Promise<SendAgainResult<R>>;
    const call = sendAgainOnce<R>(entry_id).finally(() => againInFlight.delete(entry_id));
    againInFlight.set(entry_id, call as Promise<SendAgainResult>);
    return call;
  }

  async function sendAgainOnce<R>(entry_id: string): Promise<SendAgainResult<R>> {
    await ready;
    const e = entries.find((x) => x.entry_id === entry_id && x.state === 'log');
    if (e === undefined) return { status: 'log', reason: 'missing' };
    const token = d.api.sessionToken();
    const staff_id = d.api.staffId();
    if (token === null || staff_id === null) return { status: 'needs_person' };
    // the same command_id and payload, as the person signed in now (named on the button); always a replay
    const again: QueueEntry = { ...e, state: 'queued', staff_id };
    delete again.log_reason;
    entries = entries.map((x) => (x.entry_id === entry_id ? again : x));
    sessions.set(entry_id, { token, staff_id });
    attempted.add(entry_id);
    manual.add(entry_id);
    outcomes.delete(entry_id);
    changed();
    await write(again);
    const o = await settle(entry_id);
    outcomes.delete(entry_id);
    if (o?.kind === 'sent') return { status: 'sent', result: o.result as R };
    if (o?.kind === 'log') return { status: 'log', reason: o.reason };
    return { status: 'queued', entry_id };
  }

  return {
    enqueue,
    pendingFor: (table_id) => entries.filter((e) => e.state === 'queued' && e.table_id === table_id).length,
    pendingCount: () => entries.filter((e) => e.state === 'queued').length,
    queued: () => entries.filter((e) => e.state === 'queued').map(entryRecord),
    log: () => entries.filter((e) => e.state === 'log').map(entryRecord),
    drain,
    sendAgain,
    async discard(entry_id) {
      await ready;
      if (entries.some((e) => e.entry_id === entry_id && e.state === 'log')) await drop(entry_id);
    },
    ready,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    onSent(listener) {
      sentListeners.add(listener);
      return () => void sentListeners.delete(listener);
    },
    dispose() {
      off();
      offRemoved();
      presence?.dispose();
    },
  };
}

/**
 * 02a §8 Login / 02b §3.12 (20a's wipe path, run 4 m-7, W-4): a revoked device forgets its pairing — `token`,
 * `device_id`, `device_type` of IndexedDB `pos-device` / `device` — and keeps every `pos-queue` entry.
 */
export function wipePosDeviceKeys(factory: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB): Promise<void> {
  return new Promise((resolve) => {
    if (factory === undefined) {
      resolve();
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = factory.open('pos-device', 1);
    } catch {
      resolve();
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('device')) request.result.createObjectStore('device');
    };
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction('device', 'readwrite');
        const s = tx.objectStore('device');
        for (const key of ['token', 'device_id', 'device_type']) s.delete(key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        db.close();
        resolve();
      }
    };
    request.onerror = () => resolve();
  });
}

/**
 * Review #156 (one tab sends its own entries): a BroadcastChannel `pos-queue` — works without a secure context, unlike
 * Web Locks. A page that loads asks once ("who") and waits `waitMs` for the open pages to name the queued entries they
 * hold; every page answers for as long as it is open. No BroadcastChannel → nobody else (wait 0).
 */
export function createBroadcastPresence(mine: () => string[], o: { waitMs?: number; name?: string; create?: (name: string) => BroadcastChannel | null } = {}): Presence {
  const create =
    o.create ??
    ((name: string) => {
      try {
        return typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null;
      } catch {
        return null;
      }
    });
  const channel = create(o.name ?? 'pos-queue');
  const pageId = newUlid();
  const waitMs = o.waitMs ?? 200;
  const heard = new Set<string>();
  const removedListeners = new Set<(ids: string[]) => void>();
  if (channel !== null) {
    channel.onmessage = (m: MessageEvent) => {
      const data = m.data as { type?: unknown; from?: unknown; ids?: unknown } | null;
      if (data === null || typeof data !== 'object' || data.from === pageId) return;
      const ids = Array.isArray(data.ids) ? data.ids.filter((id): id is string => typeof id === 'string') : [];
      if (data.type === 'who') channel.postMessage({ type: 'here', from: pageId, ids: mine() });
      else if (data.type === 'here') for (const id of ids) heard.add(id);
      else if (data.type === 'removed') for (const l of [...removedListeners]) l(ids);
    };
  }
  return {
    ownedElsewhere() {
      if (channel === null) return Promise.resolve(new Set<string>());
      channel.postMessage({ type: 'who', from: pageId });
      return new Promise((resolve) => setTimeout(() => resolve(new Set(heard)), waitMs));
    },
    announceRemoved(ids) {
      channel?.postMessage({ type: 'removed', from: pageId, ids });
    },
    onRemoved(listener) {
      removedListeners.add(listener);
      return () => void removedListeners.delete(listener);
    },
    dispose() {
      channel?.close();
    },
  };
}
