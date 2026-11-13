import type { MyRequestRow } from '@pos/events';
import type { HubResult } from '../../../../api/hub-admin';

// 02a §8 Handover waiting card (01d AD-1, owner Q-14): the sender's pending handovers. On send the device remembers
// { alert_id → table_id, seating_id, receiver } (memory only: lost on reload, like the session). After a reload
// it knows what `GET /queries/my-requests` says: no receiver, the request's `table_code` (= the tile's joined
// names), so the card reads "Waiting for an answer" and is attached by table_code. A `request_result` alert → one
// my-requests read, diffed by alert_id: a pending handover that closed becomes a result banner (accepted /
// declined / closed); my own withdraw is none. Contract for lane C (integrator ruling IR-4): `pendingHandovers`
// and `remember({ alert_id, table_id, seating_id, receiver_name })`.

export type MyRequest = ReturnType<(typeof MyRequestRow)['parse']>;

export const HANDOVER_KIND = 'table_handover';

/** An accepted result hides after this long (02a-C04 HandoverAccepted), whether or not it is on screen. */
export const RESULT_HIDE_MS = 4_000;

/** A request_result not matched yet is tried on this many reads (a read already in flight may not show the close). */
const CANDIDATE_READS = 2;

export interface PendingHandover {
  alert_id: string;
  /** remembered on send; null after a reload */
  table_id: string | null;
  seating_id: string | null;
  /** the request's table_code (joined names, "F4 + F5"); null until the hub row is read */
  table_code: string | null;
  /** remembered on send; null after a reload (Q-14) */
  receiver_name: string | null;
  /** hub ms: the request's raised_at, or this device's hub-clock time of the send until the row is read */
  raised_at: number | null;
  /** 01d §6.8: the receiver did not answer in time → "ask her in person", the lead was told */
  ask_in_person: boolean;
}

export interface HandoverResult {
  /** the handover request's alert_id */
  id: string;
  outcome: 'accepted' | 'declined' | 'closed';
  /** who answered (my-requests answerer_name), else the remembered receiver */
  name: string | null;
  table_code: string | null;
  table_id: string | null;
  seating_id: string | null;
}

export interface HandoverDeps {
  /** the signed-in person: another person starts with nothing */
  staff_id: string;
  load(): Promise<HubResult<{ requests: MyRequest[] }>>;
  /** hub clock ms */
  now(): number;
}

export interface PendingHandovers {
  remember(sent: { alert_id: string; table_id: string; seating_id: string; receiver_name: string | null }): void;
  connect(deps: HandoverDeps): void;
  /** sign-out (the layer unmounts): everything of that person is dropped before anyone else signs in */
  disconnect(): void;
  /** one my-requests read (several calls at once share it) */
  refresh(): Promise<void>;
  /**
   * a `request_result` alert arrived (the 01d banner rows): read my-requests and map it to the handover it closed —
   * only a handover of the same table_code (a comp result of another table is never taken for it)
   */
  resultSeen(result_alert_id: string, table_code: string | null): Promise<void>;
  /** the waiting handover of a tile: by table_id (remembered), else by table_code */
  forTable(table_id: string, table_code: string | null): PendingHandover | null;
  results(): readonly HandoverResult[];
  dismiss(id: string): void;
  /** WithdrawRequest succeeded */
  withdrawn(alert_id: string): void;
  /** a request_result alert this store shows as a handover result (its 01d banner is not shown) */
  isHandoverResult(result_alert_id: string): boolean;
  /** bumped on every change (useSyncExternalStore snapshot) */
  version(): number;
  subscribe(listener: () => void): () => void;
}

export function createPendingHandovers(): PendingHandovers {
  let deps: HandoverDeps | null = null;
  let pending = new Map<string, PendingHandover>();
  /** alert ids a my-requests read has listed (a pending one missing from a later read is gone) */
  let listed = new Set<string>();
  let results: HandoverResult[] = [];
  let handoverResults = new Set<string>();
  /** request_result alerts not mapped yet: id, its table_code, reads left */
  let waitingResults: Array<{ id: string; table_code: string | null; left: number }> = [];
  const hideTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version += 1;
    for (const l of [...listeners]) l();
  };

  const dismiss = (id: string) => {
    const timer = hideTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    hideTimers.delete(id);
    if (!results.some((r) => r.id === id)) return;
    results = results.filter((r) => r.id !== id);
    changed();
  };

  const read = async (): Promise<void> => {
    const d = deps;
    if (d === null) return;
    // the request_results seen before this read started; one that arrives while it travels waits for the next read
    const candidates = waitingResults;
    const answer = await d.load();
    if (deps !== d || !answer.ok) return;
    const rows = answer.data.requests.filter((r) => r.kind === HANDOVER_KIND);
    const next = new Map(pending);
    const closed: HandoverResult[] = [];
    for (const r of rows) {
      const known = pending.get(r.alert_id);
      if (r.state === 'pending') {
        next.set(r.alert_id, {
          alert_id: r.alert_id,
          table_id: known?.table_id ?? null,
          seating_id: known?.seating_id ?? null,
          table_code: r.lock.table_code ?? null,
          receiver_name: known?.receiver_name ?? null,
          raised_at: r.raised_at,
          ask_in_person: r.ask_in_person,
        });
        continue;
      }
      // closed since a read (or a send) told us it was pending; a closed row first seen now is old news
      if (known === undefined) continue;
      next.delete(r.alert_id);
      const outcome = r.state === 'approved' ? 'accepted' : r.state === 'rejected' ? 'declined' : r.state === 'closed' ? 'closed' : null;
      if (outcome === null) continue; // withdrawn: by me
      closed.push({
        id: r.alert_id,
        outcome,
        name: outcome === 'closed' ? null : (r.answerer_name ?? known.receiver_name),
        table_code: r.lock.table_code ?? known.table_code,
        table_id: known.table_id,
        seating_id: known.seating_id,
      });
    }
    const ids = new Set(rows.map((r) => r.alert_id));
    for (const id of [...next.keys()]) if (!ids.has(id) && listed.has(id)) next.delete(id);
    for (const id of ids) listed.add(id);
    // a waiting request_result is the result of the one closed handover of its table_code
    const mapped = new Set(handoverResults);
    for (const c of candidates) {
      const same = c.table_code === null ? [] : closed.filter((r) => r.table_code === c.table_code);
      if (same.length === 1) mapped.add(c.id);
    }
    handoverResults = mapped;
    const tried = new Set(candidates.map((c) => c.id));
    waitingResults = waitingResults
      .map((c) => (tried.has(c.id) ? { ...c, left: c.left - 1 } : c))
      .filter((c) => !mapped.has(c.id) && !(tried.has(c.id) && (closed.length > 0 || c.left <= 0)));
    pending = next;
    results = [...results, ...closed];
    for (const r of closed) if (r.outcome === 'accepted') hideTimers.set(r.id, setTimeout(() => dismiss(r.id), RESULT_HIDE_MS));
    changed();
  };

  const reset = () => {
    for (const timer of hideTimers.values()) clearTimeout(timer);
    hideTimers.clear();
    pending = new Map();
    listed = new Set();
    results = [];
    handoverResults = new Set();
    waitingResults = [];
    changed();
  };

  return {
    remember(sent) {
      // a my-requests read may have listed it first (it answered while the send's reply travelled)
      const read = pending.get(sent.alert_id);
      pending = new Map(pending).set(sent.alert_id, {
        alert_id: sent.alert_id,
        table_id: sent.table_id,
        seating_id: sent.seating_id,
        table_code: read?.table_code ?? null,
        receiver_name: sent.receiver_name,
        raised_at: read?.raised_at ?? deps?.now() ?? null,
        ask_in_person: read?.ask_in_person ?? false,
      });
      changed();
    },
    connect(next) {
      if (deps?.staff_id !== next.staff_id) reset();
      deps = next;
    },
    disconnect() {
      deps = null;
      reset();
    },
    refresh() {
      inFlight ??= read().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    async resultSeen(id, table_code) {
      if (handoverResults.has(id) || waitingResults.some((c) => c.id === id)) return;
      waitingResults = [...waitingResults, { id, table_code, left: CANDIDATE_READS }];
      await inFlight;
      await this.refresh();
    },
    forTable(table_id, table_code) {
      for (const p of pending.values()) if (p.table_id === table_id) return p;
      if (table_code === null) return null;
      for (const p of pending.values()) if (p.table_id === null && p.table_code === table_code) return p;
      return null;
    },
    results: () => results,
    dismiss,
    withdrawn(alert_id) {
      const next = new Map(pending);
      if (!next.delete(alert_id)) return;
      pending = next;
      changed();
    },
    isHandoverResult: (id) => handoverResults.has(id),
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** The one store of the staff page (memory only). */
export const pendingHandovers: PendingHandovers = createPendingHandovers();
