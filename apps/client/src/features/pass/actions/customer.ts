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
// - The unpaid hand-over request (OR-7 `RequestUnpaidHandover`, "Ask a manager") is not built: its backend has not
//   shipped, so a Due card stays greyed.

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

export interface BillFact {
  order_type: string;
  /** absent: the hub does not send the field yet */
  bill?: { state: 'due' | 'paid'; due_minor: number };
}

export interface BillRead {
  /** hub-clock ms when the read was issued */
  at: number;
  rows: ReadonlyMap<string, BillFact>;
}

export type Eligibility = { state: 'unknown' } | { state: 'paid' } | { state: 'due'; due_minor: number };

export function parseBills(data: unknown, at: number): BillRead | null {
  const orders = (data as { orders?: unknown } | null)?.orders;
  if (!Array.isArray(orders)) return null;
  const rows = new Map<string, BillFact>();
  for (const o of orders as Array<Record<string, unknown>>) {
    if (typeof o['order_id'] !== 'string') continue;
    const b = o['bill'] as { state?: unknown; due_minor?: unknown } | null | undefined;
    const state: 'due' | 'paid' | null = b?.state === 'due' ? 'due' : b?.state === 'paid' ? 'paid' : null;
    const bill = state !== null && typeof b?.due_minor === 'number' ? { state, due_minor: b.due_minor } : undefined;
    rows.set(o['order_id'], { order_type: typeof o['order_type'] === 'string' ? o['order_type'] : '', ...(bill === undefined ? {} : { bill }) });
  }
  return { at, rows };
}

export function eligibilityOf(read: BillRead | null, order: { order_id: string; order_type: 'takeaway' | 'parking' | 'dine_in'; placed_at: number }): Eligibility {
  if (read === null) return { state: 'unknown' };
  const row = read.rows.get(order.order_id);
  if (row === undefined) return order.order_type === 'parking' && read.at >= order.placed_at ? { state: 'paid' } : { state: 'unknown' };
  if (row.bill === undefined) return { state: 'unknown' };
  if (row.bill.state === 'paid' || row.bill.due_minor <= 0) return { state: 'paid' };
  return { state: 'due', due_minor: row.bill.due_minor };
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
    const e = eligibilityOf(bill, { order_id: job.order.order_id, order_type: job.order_type, placed_at: job.order.placed_at });
    if (e.state === 'due') return { ok: false, outcome: { kind: 'refused', text: t('pass.take_payment_first') } };
    if (e.state === 'unknown') return { ok: false, outcome: { kind: 'refused', text: t('pass.waiting_bill') } };
    const c = checkCustomer(v.data.order, { pickup_at_ms: job.order.pickup_at_ms ?? null, boosted: job.order.boosted ?? false }, d.now());
    if (!c.ok) {
      const text = c.reason === 'pickup' ? fill(t('pass.pickup_at'), { time: timeText(c.pickup_at_ms, d.utcOffsetMs) }) : t('pass.other_items_not_ready');
      return { ok: false, outcome: { kind: 'refused', text } };
    }
    return { ok: true, ids: c.ids };
  }

  const say = (outcome: TapOutcome) => {
    if (outcome.kind === 'refused') d.toast(outcome.text, 'warn');
    else if (outcome.kind === 'offline') d.toast(t('pass.offline_counter'), 'warn');
    else if (outcome.kind === 'gone') d.toast(t('pass.gone'), 'warn');
  };
  const payload = (order_id: string, ids: string[]): MarkServedPayload => ({ lines: [{ order_id, order_item_ids: ids }] });

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
}

/**
 * §3.4 Handed to customer: enabled while connected when every line here is done or handed over, a pickup card's
 * whole-order readiness passes, and billing eligibility is known paid. A Due card is greyed (OR-7's request is not
 * built); unknown billing greys it ("Waiting for the bill").
 */
export function customerButton(o: { up: boolean; localDone: boolean; pickupOk: boolean; eligibility: Eligibility; pending: boolean }): CustomerButton {
  const due = o.eligibility.state === 'due';
  const hint = !o.up ? 'pass.offline_counter' : due ? 'pass.take_payment_first' : o.eligibility.state === 'unknown' ? 'pass.waiting_bill' : null;
  return { enabled: o.up && o.localDone && o.pickupOk && o.eligibility.state === 'paid' && !o.pending, hint, due };
}

/** §8 `pass.handed_undo`: the token ("#48") or "PARKING" */
export function customerIdent(order: Pick<PointOrder, 'identifier'>): string {
  const id = order.identifier;
  return id.kind === 'token' ? `#${id.token}` : id.kind === 'parking' ? 'PARKING' : id.label;
}
