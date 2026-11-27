import type { HubResult } from '../../../api/hub-admin';
import { newUlid } from '../../../app/ulid';
import { t } from '../../../i18n';
import { errorKey, fill } from '../../../i18n/en';
import { timeText } from '../../alerts/labels';
import type { MarkServedPayload, OrderViewAnswer, OrderViewBody, SeatingLine } from '../../staff/orders/contracts';
import type { Handover, Handovers } from '../../staff/orders/takeaway/handover';
import { isServed } from '../../staff/orders/view/stage';
import type { LiveBus, LiveMessage } from '../../staff/shell/live';
import type { EnqueueResult } from '../../staff/tables/contracts';
import { checkHandover, gateOf, parseBillRows, type BillRead as UnpaidBillRead, type BillRow } from '../../staff/orders/unpaid/candidate';
import type { PointOrder } from '../contracts';

// 02b-TK L-CLIENT-1 item 1 (03b v1.0.16 §3.4 "Handed to customer" (R3-B-2, OR-2, OR-7), "Bill freshness" (R3-M-4),
// "Tap and send" (R3-M-10); 02b v1.0.25 §6.16 open-orders `bill`): the Pass's customer hand-over.
// - Shown on takeaway / parking cards to a signed-in person holding `run-pass` and `mark-served` (both `allowed`).
// - Billing eligibility comes from ONE `open-orders?order_type=all` read while such a card is visible: a row's
//   `bill { state: 'due' | 'paid', due_minor }` (paid, or due 0 → eligible; due → greyed "Due — customer pays at
//   counter"); a row without `bill` (a hub before 02b B2-1) → unknown, greyed; an absent row is paid only for parking
//   and only when the read was issued at or after the card's placement (a billed parking order leaves the list).
//   Before a successful read: unknown. Billing / bill-changing frames, catch-up and reconnect invalidate (unknown) and
//   read again after ≥ 1 s; an answer older than a later read is dropped.
// - The tap reads `order-view` and the bill afresh, checks every live unserved non-deal line of the order (any point:
//   done counts; added / cooking refuses; a station-less line is held until the pickup time unless boosted), and
//   only then starts the 5 s Undo (staff/orders/takeaway/handover.ts) before one queued `MarkServed`. A billing change
//   during the Undo re-checks before the send. A live `409 ITEM_WRONG_STAGE { stage: removed | voided }` re-reads and
//   retries once with the original ids still live; an empty remainder sends nothing.
// - ⚠️ 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a, §6.4, §8 OR-7; D2): the eligibility is the shared candidate check
//   (staff/orders/unpaid/candidate.ts). A Due card without an effective approval stays greyed and offers "Ask a manager"
//   (`RequestUnpaidHandover { order_id: <card order> }`); an approval of this order at this due (UnpaidHandoverApproved,
//   the open-orders flag) enables it. The send carries `customer_handover: true` (§6.4); the hub's
//   `403 PERMISSION_DENIED { reason: 'unpaid_handover_approval_required' }` says "Not paid — … ask a manager".

// ------------------------------------------------------------------------------------------------ the check

export type CustomerCheck = { ok: true; ids: string[] } | { ok: false; reason: 'not_ready' } | { ok: false; reason: 'pickup'; pickup_at_ms: number };

/** §3.4 Tap and send: the lines a customer hand-over serves, or why not now. */
export function checkCustomer(view: Pick<OrderViewBody, 'lines'>, pickup: { pickup_at_ms: number | null; boosted: boolean }, nowMs: number): CustomerCheck {
  const live = view.lines.filter(liveUnserved);
  if (live.some((l) => l.stage === 'added' || l.stage === 'cooking')) return { ok: false, reason: 'not_ready' };
  const held = pickup.pickup_at_ms !== null && !pickup.boosted && nowMs < pickup.pickup_at_ms;
  if (held && live.some((l) => l.stage === null)) return { ok: false, reason: 'pickup', pickup_at_ms: pickup.pickup_at_ms! };
  return { ok: true, ids: live.map((l) => l.order_item_id) };
}

/** a live unserved non-deal line: option children and deal parts included, station-less lines too */
function liveUnserved(l: SeatingLine): boolean {
  return l.line_kind !== 'deal' && l.live_units > 0 && !isServed(l) && l.stage !== 'removed' && l.stage !== 'voided' && l.stage !== 'returned';
}

// ------------------------------------------------------------------------------------------------ the bill

/** absent `bill`: the hub does not send the field yet (the shared row shape, unpaid/candidate.ts) */
export type BillFact = BillRow;
export type BillRead = UnpaidBillRead;

/** `due.approved`: an effective approval of this order at this due (D2) */
export type Eligibility = { state: 'unknown' } | { state: 'paid' } | { state: 'due'; due_minor: number; approved: boolean };

export const parseBills = parseBillRows;

/** The shared gate (unpaid/candidate.ts gateOf); a billed parking order read after its placement is paid. */
export function eligibilityOf(read: BillRead | null, order: { order_id: string; order_type: 'takeaway' | 'parking' | 'dine_in'; placed_at: number }, approvedDue?: number): Eligibility {
  if (read === null) return { state: 'unknown' };
  const g = gateOf(read.rows.get(order.order_id), { absentFree: order.order_type === 'parking' && read.at >= order.placed_at, approvedDue });
  return g.kind === 'free' ? { state: 'paid' } : g.kind === 'unknown' ? { state: 'unknown' } : { state: 'due', due_minor: g.due_minor, approved: g.approved };
}

/** §3.4 Bill freshness: the frames that invalidate billing eligibility (ids only; the read follows). */
const BILL_EVENTS: ReadonlySet<string> = new Set([
  'OrdersBilled',
  'OrdersUnbilled',
  'OpenOrderBillChanged',
  'LineComped',
  'LineCompRemoved',
  'ItemRemoved',
  'ItemVoided',
  'OrderCancelled',
  'OrderPlaced',
  'OrderLinesAdded',
  'UnpaidHandoverApproved', // ⚠️ 02b v1.0.25 §6.19 (OR-7): an approval of one named order
]);
const DEBOUNCE_MS = 1_000;

export interface BillEligibility {
  start(): void;
  stop(): void;
  /** the last successful read, or null (unknown: never read, or invalidated since) */
  current(): BillRead | null;
  /** +1 on every invalidation (the Undo window re-checks when it moved) */
  epoch(): number;
  /** a read now (the tap); it supersedes any read before it; null on failure */
  fresh(): Promise<BillRead | null>;
  /** a background read after the debounce (a card placed after the last read) */
  schedule(): void;
  subscribe(listener: () => void): () => void;
}

export function createBillEligibility(o: { live: LiveBus; read: () => Promise<HubResult<unknown>>; now: () => number }): BillEligibility {
  let current: BillRead | null = null;
  let epoch = 0;
  let running = false;
  let asked = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };

  const read = async (): Promise<BillRead | null> => {
    const mine = (asked += 1);
    const at = o.now();
    const answer = await o.read();
    if (!answer.ok) return null;
    const next = parseBills(answer.data, at);
    if (next === null) return null;
    // a newer read was issued since: this answer is superseded
    if (mine !== asked) return null;
    current = next;
    changed();
    return next;
  };
  const schedule = () => {
    if (!running) return;
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      if (running) void read();
    }, DEBOUNCE_MS);
  };
  const invalidate = () => {
    epoch += 1;
    current = null;
    // an answer in flight was asked before the change
    asked += 1;
    changed();
    schedule();
  };
  const onMessage = (m: LiveMessage) => {
    if (m.kind === 'catch_up' || m.kind === 'reconnect' || (m.kind === 'event' && BILL_EVENTS.has(m.event.event_type))) invalidate();
  };

  return {
    start() {
      if (running) return;
      running = true;
      unsubscribe = o.live.subscribe(onMessage);
      void read();
    },
    stop() {
      running = false;
      if (pending !== null) clearTimeout(pending);
      unsubscribe?.();
      pending = unsubscribe = null;
    },
    current: () => current,
    epoch: () => epoch,
    fresh: read,
    schedule,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

// ------------------------------------------------------------------------------------------------ tap and send

export type TapOutcome = { kind: 'started'; id: string } | { kind: 'refused'; text: string } | { kind: 'offline' } | { kind: 'gone' } | { kind: 'nothing' };

export interface CustomerHandoverDeps {
  orderView(order_id: string): Promise<HubResult<OrderViewAnswer>>;
  bills: Pick<BillEligibility, 'fresh' | 'epoch'>;
  /** the page's 5 s Undo (createHandovers); its `send` calls `send` below */
  handovers: Pick<Handovers, 'start'>;
  enqueue(payload: MarkServedPayload, label: string): Promise<EnqueueResult>;
  now(): number;
  utcOffsetMs: number;
  /** a message after the Undo window (the send's refusals) */
  toast(text: string, tone: 'ok' | 'warn'): void;
  /** D2: the amount a manager approved for this order (unpaid/requests.ts) */
  approvedDue?(order_id: string): number | undefined;
  /** the hub refused the hand-over as unpaid (§6.4): the approval this page knew is gone */
  onUnpaidRefused?(order_id: string): void;
}

interface Job {
  order: Pick<PointOrder, 'order_id' | 'placed_at' | 'pickup_at_ms' | 'boosted'>;
  order_type: 'takeaway' | 'parking';
  ident: string;
  ids: string[];
  epoch: number;
}

export interface CustomerHandover {
  tap(order: PointOrder, order_type: 'takeaway' | 'parking', ident: string): Promise<TapOutcome>;
  /** the Undo window ended (or the page hid): send the checked hand-over */
  send(h: Handover): Promise<void>;
}

type Checked = { ok: true; ids: string[] } | { ok: false; outcome: TapOutcome };

export function createCustomerHandover(d: CustomerHandoverDeps): CustomerHandover {
  const jobs = new Map<string, Job>();

  /** fresh order-view + bill; every live line ready and the bill paid */
  async function check(job: Omit<Job, 'ids' | 'epoch'>): Promise<Checked> {
    const [v, bill] = await Promise.all([d.orderView(job.order.order_id), d.bills.fresh()]);
    if (!v.ok) {
      if (v.error.kind === 'api' && v.error.code === 'ORDER_NOT_FOUND') return { ok: false, outcome: { kind: 'gone' } };
      if (v.error.kind === 'api' && v.error.code === 'PERMISSION_DENIED') return { ok: false, outcome: { kind: 'refused', text: t('pass.outside_scope') } };
      return { ok: false, outcome: { kind: 'offline' } };
    }
    if (v.data.kind !== 'order') return { ok: false, outcome: { kind: 'offline' } };
    if (v.data.order.cancelled) return { ok: false, outcome: { kind: 'gone' } };
    if (bill === null) return { ok: false, outcome: { kind: 'offline' } };
    const order_id = job.order.order_id;
    const gate = gateOf(bill.rows.get(order_id), { absentFree: job.order_type === 'parking' && bill.at >= job.order.placed_at, approvedDue: d.approvedDue?.(order_id) });
    if (gate.kind === 'due' && !gate.approved) return { ok: false, outcome: { kind: 'refused', text: t('pass.take_payment_first') } };
    if (gate.kind === 'unknown') return { ok: false, outcome: { kind: 'refused', text: t('pass.waiting_bill') } };
    const c = checkCustomer(v.data.order, { pickup_at_ms: job.order.pickup_at_ms ?? null, boosted: job.order.boosted ?? false }, d.now());
    if (!c.ok) {
      const text = c.reason === 'pickup' ? fill(t('pass.pickup_at'), { time: timeText(c.pickup_at_ms, d.utcOffsetMs) }) : t('pass.other_items_not_ready');
      return { ok: false, outcome: { kind: 'refused', text } };
    }
    // §3.7a / §8: the shared candidate check over the ids this send serves
    if (!checkHandover([{ order_id, live_ids: c.ids, gate }], c.ids).ok) return { ok: false, outcome: { kind: 'refused', text: t('pass.take_payment_first') } };
    return { ok: true, ids: c.ids };
  }

  const say = (outcome: TapOutcome) => {
    if (outcome.kind === 'refused') d.toast(outcome.text, 'warn');
    else if (outcome.kind === 'offline') d.toast(t('pass.offline_counter'), 'warn');
    else if (outcome.kind === 'gone') d.toast(t('pass.gone'), 'warn');
  };
  // ⚠️ 02b v1.0.25 §6.4 (R3-M-4): every staff customer hand-over of a takeaway / parking order says so
  const payload = (order_id: string, ids: string[]): MarkServedPayload => ({ lines: [{ order_id, order_item_ids: ids }], customer_handover: true });

  async function sendOnce(job: Job, ids: string[]): Promise<EnqueueResult> {
    return d.enqueue(payload(job.order.order_id, ids), `${t('pass.handed_to_customer')} · ${job.ident}`);
  }

  return {
    async tap(order, order_type, ident) {
      const base = { order, order_type, ident };
      const c = await check(base);
      if (!c.ok) return c.outcome;
      if (c.ids.length === 0) return { kind: 'nothing' };
      const id = newUlid();
      jobs.set(id, { ...base, ids: c.ids, epoch: d.bills.epoch() });
      d.handovers.start({ id, token_key: order.order_id, ident, payload: payload(order.order_id, c.ids) });
      return { kind: 'started', id };
    },
    async send(h) {
      const job = jobs.get(h.id);
      jobs.delete(h.id);
      if (job === undefined) return;
      let ids = job.ids;
      // §3.4: eligibility was invalidated during the Undo → read and check again before the send
      if (d.bills.epoch() !== job.epoch) {
        const again = await check(job);
        if (!again.ok) return say(again.outcome);
        ids = job.ids.filter((x) => again.ids.includes(x));
        if (ids.length === 0) return;
      }
      const r = await sendOnce(job, ids);
      if (r.status !== 'refused') {
        if (r.status === 'needs_hub') d.toast(t('pass.offline_counter'), 'warn');
        return;
      }
      const e = r.error;
      if (e.status === 403 && e.code === 'PERMISSION_DENIED' && e.details['reason'] === 'unpaid_handover_approval_required') {
        // §6.4 (D2): the due rose or the approval ended before the send — the card asks a manager again
        d.onUnpaidRefused?.(job.order.order_id);
        return d.toast(t('unpaid.refused'), 'warn');
      }
      if (e.status === 403 && e.code === 'PERMISSION_DENIED') return d.toast(e.details['reason'] === 'outside_scope' ? t('pass.outside_scope') : t(errorKey(e.code)), 'warn');
      if (e.status === 409 && e.code === 'ITEM_WRONG_STAGE') {
        const stage = e.details['stage'];
        if (stage !== 'removed' && stage !== 'voided') return d.toast(t('pass.hand_at_counter'), 'warn');
        // a line was removed / voided meanwhile: read again and retry once with the original ids still live
        const again = await check(job);
        if (!again.ok) return say(again.outcome);
        const left = ids.filter((x) => again.ids.includes(x));
        if (left.length === 0) return;
        const second = await sendOnce(job, left);
        if (second.status === 'refused') d.toast(t('pass.hand_at_counter'), 'warn');
        return;
      }
      d.toast(t(errorKey(e.code)), 'warn');
    },
  };
}

// ------------------------------------------------------------------------------------------------ the button

export interface CustomerButton {
  enabled: boolean;
  /** the greyed button's reason, when one is known */
  hint: 'pass.offline_counter' | 'pass.take_payment_first' | 'pass.waiting_bill' | null;
  /** the card shows "Due — customer pays at counter" */
  due: boolean;
  /** ⚠️ OR-7: a Due card without an effective approval offers "Ask a manager" for its order (at its due) */
  ask: { due_minor: number } | null;
}

/**
 * §3.4 Handed to customer: enabled while connected when every line here is done or handed over, a pickup card's
 * whole-order readiness passes, and billing eligibility is known paid — or Due with an effective approval of this
 * order at this due (OR-7, D2). A Due, unapproved card is greyed and offers Ask a manager; unknown billing greys it
 * ("Waiting for the bill").
 */
export function customerButton(o: { up: boolean; localDone: boolean; pickupOk: boolean; eligibility: Eligibility; pending: boolean }): CustomerButton {
  const e = o.eligibility;
  const due = e.state === 'due';
  const free = e.state === 'paid' || (e.state === 'due' && e.approved);
  const hint = !o.up ? 'pass.offline_counter' : due && !free ? 'pass.take_payment_first' : e.state === 'unknown' ? 'pass.waiting_bill' : null;
  return { enabled: o.up && o.localDone && o.pickupOk && free && !o.pending, hint, due, ask: o.up && e.state === 'due' && !e.approved ? { due_minor: e.due_minor } : null };
}

/** §8 `pass.handed_undo`: the token ("#48") or "PARKING" */
export function customerIdent(order: Pick<PointOrder, 'identifier'>): string {
  const id = order.identifier;
  return id.kind === 'token' ? `#${id.token}` : id.kind === 'parking' ? 'PARKING' : id.label;
}
