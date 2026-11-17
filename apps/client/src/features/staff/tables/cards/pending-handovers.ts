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

/** An accepted result hides this long after it was first shown (02a-C04 HandoverAccepted). */
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
  /** hub ms the device learnt it (the read), for the banner stack's newest-first order */
  at: number;
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
   * only a handover result of the same table_code that the device learnt at or after the result was raised
   * (`raised_at`, hub ms), the first such one: a comp of another table, or a later void on the same table, is
   * never taken for it
   */
  resultSeen(result_alert_id: string, table_code: string | null, raised_at: number | null): Promise<void>;
  /** the banner stack showed this result: an accepted one hides 4 s later (never before it was seen) */
  shown(id: string): void;
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
  /** results a request_result has been matched to (each takes one) */
  let claimed = new Set<string>();
  /** request_result alerts not mapped yet: id, its table_code, reads left */
  let waitingResults: Array<{ id: string; table_code: string | null; raised_at: number | null; left: number }> = [];
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

  /**
   * Maps request_result `id` to the first unclaimed result of `table_code` the device learnt at or after `raised_at`
   * (the answer's hub time); false when there is none.
   */
  const claim = (id: string, table_code: string | null, raised_at: number | null): boolean => {
    if (table_code === null) return false;
    const same = results
      .filter((r) => r.table_code === table_code && !claimed.has(r.id) && (raised_at === null || r.at >= raised_at))
      .sort((a, b) => a.at - b.at);
    const first = same[0];
    if (first === undefined) return false;
    claimed = new Set(claimed).add(first.id);
    handoverResults = new Set(handoverResults).add(id);
    return true;
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
        at: d.now(),
      });
    }
    const ids = new Set(rows.map((r) => r.alert_id));
    for (const id of [...next.keys()]) if (!ids.has(id) && listed.has(id)) next.delete(id);
    for (const id of ids) listed.add(id);
    pending = next;
    results = [...results, ...closed];
    // a waiting request_result is the result of the one unclaimed handover result of its table_code (this read's
    // closes, or one an earlier read already showed while the request_result travelled)
    const tried = new Set(candidates.map((c) => c.id));
    // oldest raised_at first (null last): each request_result takes the earliest result learnt at or after it, so a
    // later request's result (a void on the same table) never takes an earlier handover's
    const byRaised = [...candidates].sort((a, b) => (a.raised_at ?? Number.POSITIVE_INFINITY) - (b.raised_at ?? Number.POSITIVE_INFINITY));
    for (const c of byRaised) claim(c.id, c.table_code, c.raised_at);
    waitingResults = waitingResults
      .map((c) => (tried.has(c.id) ? { ...c, left: c.left - 1 } : c))
      .filter((c) => !handoverResults.has(c.id) && !(tried.has(c.id) && c.left <= 0));
    changed();
  };

  const reset = () => {
    for (const timer of hideTimers.values()) clearTimeout(timer);
    hideTimers.clear();
    pending = new Map();
    listed = new Set();
    results = [];
    handoverResults = new Set();
    claimed = new Set();
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
    async resultSeen(id, table_code, raised_at) {
      if (handoverResults.has(id) || waitingResults.some((c) => c.id === id)) return;
      // its result is already on screen (the read in flight had the close): matched now, no read
      if (claim(id, table_code, raised_at)) {
        changed();
        return;
      }
      waitingResults = [...waitingResults, { id, table_code, raised_at, left: CANDIDATE_READS }];
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
    shown(id) {
      const r = results.find((x) => x.id === id);
      if (r === undefined || r.outcome !== 'accepted' || hideTimers.has(id)) return;
      hideTimers.set(id, setTimeout(() => dismiss(id), RESULT_HIDE_MS));
    },
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
