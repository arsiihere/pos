// 05 v1.0.35 §6.12, §6.25 (task U-3, 05 parts; ⚠️ run 3 R3-M-4, D2; 02b TK-15 (2)): 05 closes an open 02b
// `hand_over_unpaid` request `obsolete` in the transaction of the bill's LAST `CloseSplit` (note `bill_closed`; the
// named order belongs to the bill's orders), including the empty close, and at day close (note `day_closed`). A partial
// close leaves it open; another token's request stays open. Both reuse the open list they already read (zero extra
// list reads) and pass every selected kind to one `alerts.closeMany` (its request_result raises are 01d's own cost).
// Tests #60j, #60k. The kind is 02b's (02b §6.12a, task U-2): until it lands, this file defines the same shape
// (request kind, subject order, holders of `hand-over-unpaid`) when it is not registered yet.
import { AlertDetailsBase } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineAlertKind, kindOf, unregisterAlertKind } from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import { billingDayCloseAppender } from '../../src/billing/lanes/day-close';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import type { CommandCtx, CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import type { TestHub } from '../helpers/test-hub';
import { append } from '../voids/fixtures';
import { appendOrder, drawerDevice, FX, post, signIn, signInOn, STAFF, startBilling, VX, type Reply, type Who } from './fixtures';

const KIND = 'hand_over_unpaid';
let definedHere = false;

let hub: TestHub;
let cashier: Who;
let manager: Who;

beforeEach(async () => {
  if (kindOf(KIND) === undefined) {
    // 02b §6.12a's shape (no apply effect here: 05 only closes the request)
    defineAlertKind({
      kind: KIND,
      family: 'urgent',
      subject: 'order',
      steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'answerers' }, set: 'answerer' }] }],
      closes_on: 'owner',
      values_schema: z.object({ order_id: z.string().min(1), token: z.number().int().positive().nullable(), due_minor: z.number().int().positive() }),
      details_schema: AlertDetailsBase.pick({ identifier: true, amount: true }),
      lead_fallback: false,
      expires_at_day_close: true,
      silent: false,
      labels: { card: `alert.${KIND}.card`, lock: `alert.${KIND}.lock` },
      request: { answers: ['approve', 'reject'], right: { mode: 'holders', permission: 'hand-over-unpaid' }, needs_pin: 'always', apply: () => [] },
    });
    definedHere = true;
  }
  registerFiscalAdapter(noneAdapter);
  hub = await startBilling({ stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 } });
  const config = branchConfig()!;
  swapBranchConfig({ config: { ...config, day_min_gap_hours: 0 }, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
  countHandle('close-split');
  cashier = signInOn(hub, STAFF.cashier, drawerDevice(hub, 'Counter kiosk'));
  ok(await post(hub, cashier, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true }));
  manager = signIn(hub, STAFF.manager);
});

afterEach(async () => {
  if (definedHere) unregisterAlertKind(KIND);
  definedHere = false;
  swapBranchConfig(null);
  resetFiscalAdapters();
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

const db = () => hub.deps.db;

function ok(r: Reply): Reply {
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r;
}

/** The handler statements of the last CloseSplit, without the append and its folds (00's envelope). */
const handled: { count?: number } = {};
function countHandle(path: string): void {
  const def = commandRegistry(hub.app).byPath(path) as CommandDef;
  const counter = statementCounter(hub.deps.db);
  const original = def.handle;
  def.handle = (ctx, payload, cmd) => {
    counter.reset();
    let appendCost = 0;
    const tx = ctx.tx;
    const realAppend = tx.append.bind(tx);
    const counted = (drafts: Parameters<typeof tx.append>[0]) => {
      const before = counter.count;
      try {
        return realAppend(drafts);
      } finally {
        appendCost += counter.count - before;
      }
    };
    const wrapped = new Proxy(tx, { get: (t, k) => (k === 'append' ? counted : Reflect.get(t, k)) });
    try {
      return original.call(def, { ...ctx, tx: wrapped } as CommandCtx, payload, cmd);
    } finally {
      handled.count = counter.count - appendCost;
    }
  };
}

function ctxOf(tx: Parameters<Parameters<TestHub['deps']['writer']['run']>[0]>[0], who: Who): CommandCtx {
  return {
    tx,
    state: tx.state,
    clock: tx.clock,
    ids: tx.ids,
    secrets: hub.deps.secrets,
    actor: { kind: 'staff', staffId: who.staffId, stationId: null, sessionId: who.sessionId, deviceId: who.deviceId },
    permission: null,
    branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
    directory: currentDirectory(hub.app),
    config: hub.deps.config,
  } as unknown as CommandCtx;
}

/** A request raised through 01d's real raise (its command is not under test) by `who`. */
function raiseAs(who: Who, input: RaiseInput): string {
  return hub.deps.writer.run((tx) => {
    const r = alerts.raise(ctxOf(tx, who), input);
    tx.append(r.events);
    return r.alert_id;
  }).result;
}

/** 02b's `hand_over_unpaid` request on `order_id` (dedupe `hand_over_unpaid:<order_id>`, D2: one named order). */
const askHandover = (order_id: string, token: number, due_minor: number): string =>
  raiseAs(manager, {
    kind: KIND,
    subject: { stream_type: 'order', stream_id: order_id },
    target: { kind: 'answerers' },
    values: { order_id, token, due_minor },
    details: { identifier: `#${token}`, amount: due_minor },
    display: { kind_label_key: `alert.${KIND}.lock` },
    dedupe_key: `${KIND}:${order_id}`,
    requester_staff_id: manager.staffId,
    request: {},
  });

/** 02b's `comp` request on a line of `order_id` (the other order-subject kind 05 closes). */
const askComp = (order_id: string, order_item_id: string): string =>
  raiseAs(cashier, {
    kind: 'comp',
    subject: { stream_type: 'order', stream_id: order_id },
    target: { kind: 'answerers' },
    values: { order_id, order_item_id, units: 1, reason_code: 'regular_customer', note: null },
    details: { amount: 25_000 },
    display: { kind_label_key: 'alert.comp.lock' },
    dedupe_key: `comp:${order_item_id}`,
    requester_staff_id: cashier.staffId,
    request: { approver_role_ids: ['R_MGR'] },
  });

const stateOf = (alert_id: string) => db().prepare('SELECT state FROM alerts WHERE alert_id = ?').pluck().get(alert_id);
const closedOf = (r: Reply) => r.events.filter((e) => e.event_type === 'AlertClosed').map((e) => e.payload);

let seq = 0;
/** A takeaway of `n` lassis (Rs 250.00 each, untaxed): its order, line and token. */
function lassis(n: number): { order_id: string; line: string; token: number } {
  seq += 1;
  const line = `HU${seq}_L`;
  const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: line, item_id: VX.drink, quantity: n }] });
  return { order_id, line, token: db().prepare('SELECT token FROM orders WHERE order_id = ?').pluck().get(order_id) as number };
}

const pay = (order_id: string, split_no: number, amount_minor: number) =>
  post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { order_id }, split_no, mode_id: 'cash', direction: 'in', amount_minor }).then(ok);
const close = (order_id: string, split_no: number, expected_total_minor: number) =>
  post(hub, cashier, 'close-split', 'CloseSplit', { bill_ref: { order_id }, split_no, expected_total_minor }).then(ok);

/** Pay and close a one-split takeaway of 2 lassis; the handler's statement count. */
async function payAndClose(order_id: string): Promise<{ reply: Reply; statements: number }> {
  await pay(order_id, 1, 50_000);
  const reply = await close(order_id, 1, 50_000);
  return { reply, statements: handled.count! };
}

describe('[05 §6.12, #60j] the bill\'s last CloseSplit closes the open hand_over_unpaid request obsolete (bill_closed)', () => {
  it('[05 #60j, D2] token 12\'s request closes in the close transaction; another token\'s request stays open', async () => {
    const t = lassis(2);
    const other = lassis(1);
    const mine = askHandover(t.order_id, t.token, 50_000);
    const theirs = askHandover(other.order_id, other.token, 25_000);
    const { reply } = await payAndClose(t.order_id);
    expect(closedOf(reply)).toEqual([expect.objectContaining({ alert_id: mine, reason: 'obsolete', note: 'bill_closed' })]);
    expect(reply.events.filter((e) => e.event_type === 'AlertRaised' && e.payload['kind'] === 'request_result')).toHaveLength(1);
    expect([stateOf(mine), stateOf(theirs)]).toEqual(['closed', 'open']);
  });

  it('[05 #60j] a partial CloseSplit (another split still open) leaves the request open; the last one closes it', async () => {
    const t = lassis(4);
    ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: { order_id: t.order_id }, mode: 'amount', splits: [{ split_no: 1, share_minor: 50_000 }, { split_no: 2, share_minor: 50_000 }] }));
    const req = askHandover(t.order_id, t.token, 100_000);
    await pay(t.order_id, 1, 50_000);
    expect(closedOf(await close(t.order_id, 1, 50_000))).toEqual([]);
    expect(stateOf(req)).toBe('open');
    await pay(t.order_id, 2, 50_000);
    expect(closedOf(await close(t.order_id, 2, 50_000))).toEqual([expect.objectContaining({ alert_id: req, reason: 'obsolete', note: 'bill_closed' })]);
    expect(stateOf(req)).toBe('closed');
  });

  it('[05 #60j] statements: no request + one batch close = sole hand_over_unpaid = one comp request = comp + hand_over_unpaid (zero extra list reads, one closeMany)', async () => {
    const none = await payAndClose(lassis(2).order_id);
    expect(closedOf(none.reply)).toEqual([]);

    const a = lassis(2);
    askHandover(a.order_id, a.token, 50_000);
    const sole = await payAndClose(a.order_id);

    const b = lassis(2);
    askComp(b.order_id, b.line);
    const comp = await payAndClose(b.order_id);

    const c = lassis(2);
    askComp(c.order_id, c.line);
    askHandover(c.order_id, c.token, 50_000);
    const mixed = await payAndClose(c.order_id);

    expect(closedOf(sole.reply)).toHaveLength(1);
    expect(closedOf(comp.reply)).toHaveLength(1);
    expect(closedOf(mixed.reply)).toHaveLength(2);
    expect(sole.statements).toBe(comp.statements);
    expect(mixed.statements).toBe(comp.statements);
    expect(sole.statements).toBeGreaterThan(none.statements); // the conditional closeMany (+ its request_result raise)
  });

  it('[05 §6.12 step 3, #60j] the empty close (every order cancelled) is a last close: it closes the request too', async () => {
    const t = lassis(2);
    ok(await post(hub, cashier, 'set-splits', 'SetSplits', { bill_ref: { order_id: t.order_id }, mode: 'none' }));
    const req = askHandover(t.order_id, t.token, 50_000);
    append(hub, [{ stream_type: 'order', stream_id: t.order_id, event_type: 'OrderCancelled', payload: { order_id: t.order_id } }]);
    const r = await close(t.order_id, 1, 0);
    expect(r.events.map((e) => e.event_type)).toContain('BillClosedEmpty');
    expect(closedOf(r)).toEqual([expect.objectContaining({ alert_id: req, reason: 'obsolete', note: 'bill_closed' })]);
  });
});

describe('[05 §6.25, #60k] day close closes open hand_over_unpaid requests obsolete (day_closed)', () => {
  /** The appender alone in a writer transaction (nothing appended), with its statement count. */
  function appenderRun(): { closes: Array<Record<string, unknown>>; statements: number } {
    const counter = statementCounter(hub.deps.db);
    const before = counter.count;
    const drafts = hub.deps.writer.run((tx) => billingDayCloseAppender(ctxOf(tx, manager))).result;
    return {
      closes: drafts.filter((d) => d.event_type === 'AlertClosed').map((d) => d.payload as Record<string, unknown>),
      statements: counter.count - before,
    };
  }

  it('[05 #60k] CloseBusinessDay with an open hand_over_unpaid request on a carried order → closed obsolete (day_closed) beside 02b\'s comp', async () => {
    const t = lassis(1);
    const u = lassis(1);
    ok(await post(hub, manager, 'carry-over-orders', 'CarryOverOrders', { order_ids: [t.order_id, u.order_id], reason_code: 'customer_will_pay_later' }));
    const req = askHandover(t.order_id, t.token, 25_000);
    const comp = askComp(u.order_id, u.line);
    ok(await post(hub, cashier, 'count-shift', 'CountShift', { shift_id: db().prepare(`SELECT shift_id FROM shifts WHERE state = 'open'`).pluck().get(), counted_minor: 0 }));
    const closed = await post(hub, manager, 'close-business-day', 'CloseBusinessDay', {});
    expect(closed.status, JSON.stringify(closed.error)).toBe(200);
    const closes = closedOf(closed);
    expect(closes.map((p) => p['alert_id']).sort()).toEqual([req, comp].sort());
    for (const p of closes) expect(p).toMatchObject({ reason: 'obsolete', note: 'day_closed' });
    expect([stateOf(req), stateOf(comp)]).toEqual(['closed', 'closed']);
  });

  it('[05 #60k] appender statements: no request + one batch close = sole hand_over_unpaid = one comp = mixed', async () => {
    const none = appenderRun();
    expect(none.closes).toEqual([]);
    const a = lassis(1);
    const req = askHandover(a.order_id, a.token, 25_000);
    const sole = appenderRun();
    expect(sole.closes.map((p) => p['alert_id'])).toEqual([req]);
    expect(sole.statements).toBeGreaterThan(none.statements);
    // the appender ran in a transaction that appended nothing: the request is still open
    expect(stateOf(req)).toBe('open');
    const b = lassis(1);
    askComp(b.order_id, b.line);
    const mixed = appenderRun();
    expect(mixed.closes).toHaveLength(2);
    expect(mixed.statements).toBe(sole.statements);
  });
});
