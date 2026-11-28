import { MyRequestRow } from '@pos/events';
import type { HubError, HubResult } from '../../../../api/hub-admin';
import type { LiveBus } from '../../shell/live';
import type { BillRow } from './candidate';

// 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a Ask / Approve / Reject / Close, §6.4a RequestUnpaidHandover, §6.19
// UnpaidHandoverApproved + OpenOrderBillChanged; 01d v1.3.7 To 02b (R3-M-3, R3-M-4); 03b v1.0.16 §3.4; D2): one
// in-memory store per staff page (keyed by its live bus) of the unpaid hand-over requests and approvals it knows.
// - Ask: `RequestUnpaidHandover { order_id }` through the hub's command API (not queueable: a manager answers now).
//   `{ needed: false }` → no card; `{ approved: true }` → approved at the due asked about; `{ alert_id, is_requester }`
//   → the waiting card ("Waiting for a manager…", Withdraw for the requester; another person's request: "Already
//   waiting for a manager", no Withdraw). One ask in flight per order.
// - Approvals (D2: one named order, one amount): an `UnpaidHandoverApproved` frame (its `due_minor`), an `approved`
//   result, or an open-orders row's `unpaid_handover_approved` (seed). `OpenOrderBillChanged.approval_cleared_order_ids`
//   and a bill close / reopen (`OrdersBilled` / `OrdersUnbilled`) end them; a hand-over refused by the hub too.
// - The requester's result (01d `request_result` → StaffApp → resultSeen) reads my-requests: rejected → "Manager said
//   no"; approved / withdrawn / closed → the card goes. A reconnect or the page turning visible reads it too.
// Only ids, states and the amount are kept (02b §7).

/**
 * `ask_in_person` (01d §6.8, To 02b R3-M-3): my-requests says nobody else can be reached (the sole holder asked, or the
 * other holders absent) — the requester's card then reads "Waiting — find a manager" instead of "Waiting for a manager…".
 */
export type AskState =
  /**
   * `from_hub` (⚠️ 02b v1.0.28 §6.16, §8; owner 2026-11-28 QA-R2, BUG-27): this page never asked; an open-orders read says
   * a request holds the order's bill (another counter's) — "Waiting for a manager…", nothing to tap. `alert_id` ''.
   */
  | { kind: 'waiting'; alert_id: string; mine: boolean; ask_in_person: boolean; from_hub?: true }
  | { kind: 'rejected'; alert_id: string };

export type AskOutcome =
  | { kind: 'waiting'; mine: boolean }
  | { kind: 'not_needed' }
  | { kind: 'approved' }
  | { kind: 'offline' }
  | { kind: 'error'; error: Extract<HubError, { kind: 'api' }> };

interface Api {
  command<T>(commandType: string, payload: unknown): Promise<HubResult<T>>;
  query<T>(path: string): Promise<HubResult<T>>;
}

export interface UnpaidRequests {
  stateOf(order_id: string): AskState | null;
  /** D2: the amount approved for this order, while it is effective */
  approvedDue(order_id: string): number | undefined;
  /** RequestUnpaidHandover for the named order; `due_minor` = the due this page shows (for an `approved` result) */
  ask(order_id: string, due_minor: number | null): Promise<AskOutcome>;
  withdraw(order_id: string): Promise<void>;
  /** the rows of an open-orders read carry the hub's approval flag */
  seed(rows: ReadonlyArray<BillRow & { order_id: string }>): void;
  /** the hub refused a hand-over of this order (unpaid_handover_approval_required): its approval is no longer known */
  refused(order_id: string): void;
  /** a request_result reached the page (or a reconnect): read my-requests */
  resultSeen(): Promise<void>;
  version(): number;
  subscribe(listener: () => void): () => void;
}

const KIND = 'hand_over_unpaid';
const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function createUnpaidRequests(o: { live: LiveBus; api: Api }): UnpaidRequests {
  const states = new Map<string, AskState>();
  const approvals = new Map<string, number>();
  // ⚠️ 02b v1.0.28 (QA-R2, BUG-27): orders whose bill a request holds, from the last open-orders rows (another counter's)
  const pendingHub = new Set<string>();
  const asking = new Map<string, Promise<AskOutcome>>();
  const listeners = new Set<() => void>();
  let version = 0;
  let syncing: Promise<void> | null = null;
  const changed = () => {
    version += 1;
    for (const l of [...listeners]) l();
  };
  const unapprove = (ids: readonly string[]) => {
    let hit = false;
    for (const id of ids) hit = approvals.delete(id) || hit;
    if (hit) changed();
  };

  // `flagsOnly`: the read right after my own ask only learns ask_in_person; it never closes a card (a result does)
  const read = async (flagsOnly: boolean): Promise<void> => {
    const answer = await o.api.query<{ requests?: unknown }>('/queries/my-requests');
    if (!answer.ok) return;
    const rows = new Map<string, { state: string; ask_in_person: boolean }>();
    for (const r of Array.isArray(answer.data.requests) ? answer.data.requests : []) {
      const row = MyRequestRow.safeParse(r);
      if (row.success && row.data.kind === KIND) rows.set(row.data.alert_id, row.data);
    }
    for (const [order_id, s] of [...states]) {
      if (s.kind !== 'waiting' || !s.mine) continue;
      const row = rows.get(s.alert_id);
      if (row?.state === 'pending') {
        // 01d R3-M-3: the card follows my-requests' ask_in_person while the request waits
        if (row.ask_in_person !== s.ask_in_person) states.set(order_id, { ...s, ask_in_person: row.ask_in_person });
        continue;
      }
      if (flagsOnly) continue;
      if (row?.state === 'rejected') states.set(order_id, { kind: 'rejected', alert_id: s.alert_id });
      else states.delete(order_id);
    }
    changed();
  };

  const sync = (): Promise<void> => {
    if (![...states.values()].some((s) => s.kind === 'waiting' && s.mine)) return Promise.resolve();
    syncing ??= (async () => {
      try {
        await read(false);
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  };

  o.live.subscribe((m) => {
    if (m.kind === 'reconnect' || m.kind === 'visible') return void sync();
    if (m.kind !== 'event') return;
    const p = m.event.payload;
    switch (m.event.event_type) {
      case 'UnpaidHandoverApproved': {
        const order_id = p['order_id'];
        const due = p['due_minor'];
        if (typeof order_id !== 'string' || typeof due !== 'number') return;
        approvals.set(order_id, due);
        states.delete(order_id);
        pendingHub.delete(order_id);
        changed();
        return;
      }
      case 'OpenOrderBillChanged':
        return unapprove(idsOf(p['approval_cleared_order_ids']));
      case 'OrdersBilled':
      case 'OrdersUnbilled':
        return unapprove(idsOf(p['order_ids']));
    }
  });

  const send = async (order_id: string, due_minor: number | null): Promise<AskOutcome> => {
    let answer: HubResult<Record<string, unknown>>;
    try {
      answer = await o.api.command<Record<string, unknown>>('RequestUnpaidHandover', { order_id });
    } catch {
      return { kind: 'offline' };
    }
    if (!answer.ok) return answer.error.kind === 'api' ? { kind: 'error', error: answer.error } : { kind: 'offline' };
    const r = answer.data ?? {};
    if (r['needed'] === false) {
      if (states.delete(order_id)) changed();
      return { kind: 'not_needed' };
    }
    if (r['approved'] === true) {
      states.delete(order_id);
      if (due_minor !== null) approvals.set(order_id, due_minor);
      changed();
      return { kind: 'approved' };
    }
    if (typeof r['alert_id'] === 'string') {
      const mine = r['is_requester'] === true;
      states.set(order_id, { kind: 'waiting', alert_id: r['alert_id'], mine, ask_in_person: false });
      changed();
      // 01d R3-M-3: from the first own-pending response, my-requests says whether to find a manager in person
      if (mine) void read(true);
      return { kind: 'waiting', mine };
    }
    return { kind: 'offline' };
  };

  return {
    stateOf: (order_id) => states.get(order_id) ?? (pendingHub.has(order_id) ? { kind: 'waiting', alert_id: '', mine: false, ask_in_person: false, from_hub: true } : null),
    approvedDue: (order_id) => approvals.get(order_id),
    ask(order_id, due_minor) {
      const running = asking.get(order_id);
      if (running !== undefined) return running;
      const p = send(order_id, due_minor).finally(() => asking.delete(order_id));
      asking.set(order_id, p);
      return p;
    },
    async withdraw(order_id) {
      const s = states.get(order_id);
      if (s?.kind !== 'waiting' || !s.mine) return;
      const answer = await o.api.command('WithdrawRequest', { alert_id: s.alert_id });
      // answered or closed meanwhile (409 REQUEST_NOT_PENDING) goes too; any other refusal keeps the card
      if (answer.ok || (answer.error.kind === 'api' && answer.error.code === 'REQUEST_NOT_PENDING')) {
        states.delete(order_id);
        changed();
      }
    },
    seed(rows) {
      let hit = false;
      for (const r of rows) {
        if (r.unpaid_handover_approved === true && r.bill?.state === 'due' && approvals.get(r.order_id) !== r.bill.due_minor) {
          approvals.set(r.order_id, r.bill.due_minor);
          hit = true;
        } else if (r.unpaid_handover_approved === false) hit = approvals.delete(r.order_id) || hit;
        if (r.unpaid_handover_pending === true && !pendingHub.has(r.order_id)) {
          pendingHub.add(r.order_id);
          hit = true;
        } else if (r.unpaid_handover_pending === false) hit = pendingHub.delete(r.order_id) || hit;
      }
      if (hit) changed();
    },
    refused: (order_id) => unapprove([order_id]),
    resultSeen: sync,
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const perPage = new WeakMap<object, UnpaidRequests>();

/** One store per staff page (keyed by its live bus), for the page's life; it watches that bus. */
export function unpaidRequestsOf(shell: { live: LiveBus; api: Api }): UnpaidRequests {
  let store = perPage.get(shell.live);
  if (store === undefined) {
    store = createUnpaidRequests({ live: shell.live, api: shell.api });
    perPage.set(shell.live, store);
  }
  return store;
}
