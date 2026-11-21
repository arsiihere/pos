// 05 §6.17 `CountShift`, §6.18 `CloseShift { skip_count }`, §6.19 `HandoverCount`, §3.11, §3.14 kind
// `shift_variance`, B23, H8-1 (task 21; 05-plan §3 row 21, G-39, R-42, R-44). Tests #46 (extended: the real CountShift
// response), #50, #50b, #50c, #50d (the command half), #51, #52, #53b (extended with the real kind), #47b (the sign-off
// date half). Real commands over HTTP through the hub's writer and the real `shifts` / `billing` / `alerts` folds;
// payments are in-test events built by task 5's builders (the `shifts` fold reads only their payloads). Every PKR
// amount is literal: float Rs 5,000, a cash sale of Rs 2,500 → expected Rs 7,500; the branch's variance threshold is
// the built-in Rs 100 (A-1 (3), 10,000 minor). The permanent afterEach scan keeps every note in `bill_texts` only and
// every PIN / token out of the logs and the tables; the shift tables and the shift events carry no staff name.
import type { EventDraft, PosEvent } from '@pos/events';
import { aPaymentAdded } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { kindOf, type AlertApplyCtx } from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import { shiftsProjection } from '../../src/billing/projections/shifts';
import type { CommandCtx, CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { readOnlyTx } from '../../src/engine-host/read-only-tx';
import { createProjectionRegistry } from '../../src/projections/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { PIN } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import type { TestHub } from '../helpers/test-hub';
import { append as appendRaw, openVoidsDay } from '../voids/fixtures';
import {
  answer,
  drawerDevice,
  post,
  signIn,
  signInOn,
  STAFF,
  startBilling,
  takeawayOrder,
  type Reply,
  type Who,
} from './fixtures';

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
const seats: Who[] = [];

const OWNER = 'S_OWNER';
/** Rs 5,000 float, Rs 2,500 cash sale → Rs 7,500 expected (PKR, exponent 2) */
const FLOAT = 500_000;
const SALE = 250_000;
const EXPECTED = 750_000;
/** the built-in variance threshold: Rs 100 */
const THRESHOLD = 10_000;
const NAMES = ['Owner', 'Manager', 'Cashier', 'Order taker'];

// ------------------------------------------------------------------------------------------------ the privacy scan

/** A note a test sent: allowed only in `bill_texts`. */
const NOTES = new Set<string>();
const noteSecret = (s: string): string => (NOTES.add(s), s);

function tablesWith(s: string, allowed: string | null): string[] {
  const tables = hub.deps.db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    )
    .pluck()
    .all() as string[];
  return tables
    .filter(
      (t) =>
        t !== allowed &&
        JSON.stringify(
          hub.deps.db.prepare(`SELECT * FROM "${t}"`).all(),
        ).includes(s),
    )
    .map((t) => `table ${t}`);
}

function leaks(): string[] {
  const logs = hub.logs();
  const found: string[] = [];
  for (const note of NOTES) {
    if (logs.includes(note)) found.push(`note in logs`);
    found.push(...tablesWith(note, 'bill_texts').map((p) => `note in ${p}`));
  }
  for (const pin of Object.values(PIN))
    if (logs.includes(`"pin":"${pin}"`)) found.push(`pin ${pin} in logs`);
  for (const who of seats) {
    for (const secret of [who.token, who.sessionToken]) {
      if (logs.includes(secret)) found.push(`token of ${who.staffId} in logs`);
      found.push(
        ...tablesWith(secret, null)
          .filter((p) => p !== 'table devices' && p !== 'table staff_sessions')
          .map((p) => `token of ${who.staffId} in ${p}`),
      );
    }
  }
  // the shift tables and every shift-stream event carry ids and amounts only
  const shiftRows = JSON.stringify(
    ['shifts', 'shift_signoffs', 'shift_handovers'].map((t) =>
      hub.deps.db.prepare(`SELECT * FROM ${t}`).all(),
    ),
  );
  const shiftEvents = JSON.stringify(
    hub.deps.db
      .prepare(`SELECT payload FROM events WHERE stream_type = 'shift'`)
      .pluck()
      .all(),
  );
  for (const name of NAMES) {
    if (shiftRows.includes(`"${name}"`))
      found.push(`name ${name} in a shift table`);
    if (shiftEvents.includes(`"${name}"`))
      found.push(`name ${name} in a shift event`);
  }
  return found;
}

afterEach(async () => {
  const found = hub === undefined ? [] : leaks();
  NOTES.clear();
  seats.length = 0;
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
  expect(found).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ set-up

/** Each named command's handler statements of its last call (the envelope and the returned events' append excluded). */
const handled: Record<string, number | undefined> = {};

function countHandler(path: string): void {
  const def = commandRegistry(hub.app).byPath(path) as CommandDef | undefined;
  if (def === undefined) return; // not registered: every call answers 404 (the failing-first state)
  const original = def.handle;
  def.handle = (ctx, payload, cmd) => {
    counter.reset();
    try {
      return original.call(def, ctx, payload, cmd);
    } finally {
      handled[path] = counter.count;
    }
  };
}

/** 01d's own statements inside a handler (raise and closeMany: their own bound), summed per call. */
function counting01d(): {
  readonly raise: number;
  readonly close: number;
  restore(): void;
} {
  const real = {
    raise: alerts.raise.bind(alerts),
    closeMany: alerts.closeMany.bind(alerts),
  };
  const original = { raise: alerts.raise, closeMany: alerts.closeMany };
  const n = { raise: 0, close: 0 };
  alerts.raise = ((ctx, input) => {
    const before = counter.count;
    try {
      return real.raise(ctx, input);
    } finally {
      n.raise += counter.count - before;
    }
  }) as typeof alerts.raise;
  alerts.closeMany = ((ctx, items) => {
    const before = counter.count;
    try {
      return real.closeMany(ctx, items);
    } finally {
      n.close += counter.count - before;
    }
  }) as typeof alerts.closeMany;
  return {
    get raise() {
      return n.raise;
    },
    get close() {
      return n.close;
    },
    restore() {
      alerts.raise = original.raise;
      alerts.closeMany = original.closeMany;
    },
  };
}

interface Started {
  kiosk: { deviceId: string; token: string };
  cashier: Who;
  manager: Who;
  owner: Who;
  waiter: Who;
  /** the cashier's drawer shift, Rs 5,000 float and a Rs 2,500 cash sale (expected Rs 7,500) */
  drawer: string;
}

async function start(): Promise<Started> {
  hub = await startBilling();
  const kiosk = drawerDevice(hub, 'Counter kiosk');
  const cashier = signInOn(hub, STAFF.cashier, kiosk);
  const manager = signIn(hub, STAFF.manager);
  const owner = signIn(hub, OWNER);
  const waiter = signIn(hub, STAFF.orderTaker);
  seats.push(cashier, manager, owner, waiter);
  const drawer = await openShift(cashier, {
    float_minor: FLOAT,
    as_drawer: true,
  });
  pay(drawer, SALE);
  counter = statementCounter(hub.deps.db);
  for (const k of Object.keys(handled)) delete handled[k];
  for (const path of ['count-shift', 'close-shift', 'handover-count'])
    countHandler(path);
  return { kiosk, cashier, manager, owner, waiter, drawer };
}

async function openShift(
  who: Who,
  payload: Record<string, unknown>,
): Promise<string> {
  const r = await post(hub, who, 'open-shift', 'OpenShift', payload);
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r.result!.shift_id as string;
}

/** B23 (reviewer fix 1): every refusal of the three commands is blind — no expected, variance or cash sum. */
async function refusalsBlind(r: Promise<Reply>): Promise<Reply> {
  const reply = await r;
  if (reply.status >= 400) blind(JSON.stringify(reply));
  return reply;
}
const count = (
  who: Who,
  payload: Record<string, unknown>,
  commandId?: string,
): Promise<Reply> =>
  refusalsBlind(post(hub, who, 'count-shift', 'CountShift', payload, commandId));
const closeShift = (
  who: Who,
  payload: Record<string, unknown>,
  commandId?: string,
): Promise<Reply> =>
  refusalsBlind(post(hub, who, 'close-shift', 'CloseShift', payload, commandId));
const handover = (
  who: Who,
  payload: Record<string, unknown>,
  commandId?: string,
): Promise<Reply> =>
  refusalsBlind(post(hub, who, 'handover-count', 'HandoverCount', payload, commandId));

let paymentSeq = 0;
/** A cash `in` PaymentAdded on `shift_id` (an in-test event; the `shifts` fold reads its payload only). */
function pay(shift_id: string, amount_minor: number): void {
  paymentSeq += 1;
  const built = aPaymentAdded();
  const payload = {
    ...(built.payload as Record<string, unknown>),
    payment_id: `PAY_${paymentSeq}`,
    bill_id: `BILL_${paymentSeq}`,
    split_no: 1,
    mode_id: 'cash',
    payment_class: 'cash',
    direction: 'in',
    amount_minor,
    tendered_minor: null,
    change_minor: null,
    has_reference: false,
    taken_by_staff_id: STAFF.cashier,
    shift_id,
  };
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  const draft: EventDraft = {
    stream_type: 'bill',
    stream_id: payload.bill_id,
    event_type: built.event_type,
    schema_version: built.schema_version,
    payload: payload as PosEvent['payload'],
    occurred_at: now,
    actor_id: STAFF.cashier,
    device_id: 'D_FIXTURE',
  };
  hub.deps.writer.run((tx) => tx.append([draft]));
}

/** A takeover on a device (open-shift test pattern): `prev`'s session ends, `staffId` signs in on the same device. */
function takeover(prev: Who, staffId: string): Who {
  hub.deps.db
    .prepare(
      `UPDATE staff_sessions SET ended_at = ?, end_reason = 'logout' WHERE session_id = ?`,
    )
    .run(hub.clock.branchNow(), prev.sessionId);
  const next = signInOn(hub, staffId, {
    deviceId: prev.deviceId,
    token: prev.token,
  });
  seats.push(next);
  return next;
}

const db = () => hub.deps.db;
const branch = () => hub.deps.config.provisioned!.branch_id;
const shiftRow = (shift_id: string) =>
  db()
    .prepare('SELECT * FROM shifts WHERE shift_id = ?')
    .get(shift_id) as Record<string, unknown>;
const textOf = (subject_id: string) =>
  db()
    .prepare(
      `SELECT text FROM bill_texts WHERE subject_id = ? AND field = 'note'`,
    )
    .pluck()
    .get(subject_id);

function eventsOf(type: string): PosEvent[] {
  return (
    db()
      .prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq')
      .all(type) as Array<Record<string, unknown>>
  ).map(
    (row) =>
      ({
        ...row,
        payload: JSON.parse(row.payload as string),
      }) as unknown as PosEvent,
  );
}
const varianceRequests = () =>
  eventsOf('AlertRaised').filter(
    (e) => (e.payload as { kind: string }).kind === 'shift_variance',
  );

async function shiftView(
  who: Who,
  shift_id: string,
): Promise<{ status: number; body: string; data: Record<string, unknown> }> {
  const res = await hub.app.inject({
    method: 'GET',
    url: `/queries/shift?shift_id=${shift_id}`,
    headers: {
      authorization: `Bearer ${who.token}`,
      'x-session-token': who.sessionToken,
    },
  });
  return {
    status: res.statusCode,
    body: res.body,
    data: (res.json() as { data: Record<string, unknown> }).data,
  };
}

/** B23: a response before the count carries no expected / variance and no cash sum (the Rs 2,500 sale, the Rs 7,500). */
function blind(text: string): void {
  expect(text).not.toMatch(/"expected_minor":\d/);
  expect(text).not.toMatch(/"variance_minor":-?\d/);
  expect(text).not.toContain(String(EXPECTED));
  expect(text).not.toContain(String(SALE));
}

/** The business day closed (in-test 01a event) and the next one opened at noon. */
function nextDay(): string {
  const before = hub.deps.state.get().business_day!.business_date;
  appendRaw(
    hub,
    [
      {
        stream_type: 'hub',
        stream_id: branch(),
        event_type: 'BusinessDayClosed',
        payload: {},
      },
    ],
    { actor: STAFF.manager },
  );
  const noon = new Date(`${before}T12:00:00`);
  noon.setDate(noon.getDate() + 1);
  hub.clock.set(noon.getTime());
  return openVoidsDay(hub).business_date;
}

/** A petty_cash request on `shift_id`, raised as 22's RecordPettyCash will (values per kinds/values.ts). */
function pettyRequest(who: Who, shift_id: string, n: number): string {
  return hub.deps.writer.run((tx) => {
    const ctx = {
      tx,
      state: tx.state,
      clock: tx.clock,
      ids: tx.ids,
      secrets: hub.deps.secrets,
      actor: {
        kind: 'staff',
        staffId: who.staffId,
        stationId: null,
        sessionId: who.sessionId,
        deviceId: who.deviceId,
      },
      permission: null,
      branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
      directory: currentDirectory(hub.app),
      config: hub.deps.config,
    } as unknown as CommandCtx;
    const input: RaiseInput = {
      kind: 'petty_cash',
      subject: { stream_type: 'shift', stream_id: shift_id },
      target: { kind: 'answerers' },
      values: {
        entry_id: `PE_${n}`,
        kind: 'out',
        shift_id,
        amount_minor: 600_000,
        category_id: 'cat-misc',
        has_paid_to: false,
        advance_staff_id: null,
        has_note: false,
      },
      details: { amount: 600_000 },
      display: { kind_label_key: 'alert.petty_cash.lock' },
      dedupe_key: `petty:CMD_${n}`,
      requester_staff_id: who.staffId,
      request: {},
    };
    const r = alerts.raise(ctx, input);
    tx.append(r.events);
    return r.alert_id;
  }).result;
}

// ================================================================================================= CountShift

describe('[05 §6.17, #46, #50, #50d] CountShift — counts and closes in one transaction', () => {
  it('[05 #46, #50] within the threshold: ShiftCounted { variance_alert_id: null } + ShiftClosed, no request, the drawer free at once; the response is the first to reveal expected', async () => {
    const { cashier, drawer } = await start();
    // #46: every read before the count is blind
    const before = await shiftView(cashier, drawer);
    expect(before.status, before.body).toBe(200);
    blind(before.body);
    expect(before.data).toMatchObject({
      expected_minor: null,
      variance_minor: null,
      counted_minor: null,
    });

    const r = await count(cashier, {
      shift_id: drawer,
      counted_minor: 745_000,
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({
      shift_id: drawer,
      closed: true,
      expected_minor: EXPECTED,
      variance_minor: -5_000,
      sign_off: null,
      closed_requests: [],
    });
    expect(r.events.map((e) => e.event_type)).toEqual([
      'ShiftCounted',
      'ShiftClosed',
    ]);
    expect(r.events[0]).toMatchObject({
      stream_type: 'shift',
      stream_id: drawer,
      actor_id: STAFF.cashier,
    });
    expect(r.events[0]!.payload).toEqual({
      shift_id: drawer,
      counted_minor: 745_000,
      expected_minor: EXPECTED,
      variance_minor: -5_000,
      by_staff_id: STAFF.cashier,
      variance_alert_id: null,
    });
    expect(r.events[1]!.payload).toEqual({
      shift_id: drawer,
      closed_by: STAFF.cashier,
      has_note: false,
      note_id: null,
      alert_id: null,
      approver_staff_id: null,
    });
    expect(shiftRow(drawer)).toMatchObject({
      state: 'closed',
      counted_minor: 745_000,
      variance_minor: -5_000,
      variance_state: null,
      variance_alert_id: null,
      closed_by: STAFF.cashier,
    });
    expect(varianceRequests()).toHaveLength(0);

    // after the count the view carries expected (the count's), the cash sum too
    const after = await shiftView(cashier, drawer);
    expect(after.data).toMatchObject({
      state: 'closed',
      counted_minor: 745_000,
      expected_minor: EXPECTED,
      variance_minor: -5_000,
    });

    // the drawer is free at once: the next drawer shift on this kiosk opens (the Owner signs in on it)
    const owner = takeover(cashier, OWNER);
    const next = await post(hub, owner, 'open-shift', 'OpenShift', {
      float_minor: 0,
      as_drawer: true,
    });
    expect(next.status, JSON.stringify(next.error)).toBe(200);
  });

  it('[05 §6.17, R-42] the compare is strict: |variance| = Rs 100 → no request; Rs 100.01 over → a request (both signs)', async () => {
    const { cashier, manager, waiter, drawer } = await start();
    const exact = await count(cashier, {
      shift_id: drawer,
      counted_minor: EXPECTED - THRESHOLD,
    });
    expect(exact.result).toMatchObject({
      variance_minor: -THRESHOLD,
      sign_off: null,
    });
    expect(varianceRequests()).toHaveLength(0);

    const m = await openShift(manager, {
      float_minor: FLOAT,
      as_drawer: false,
    });
    const over = await count(manager, {
      shift_id: m,
      counted_minor: FLOAT + THRESHOLD + 1,
    });
    expect(over.result).toMatchObject({
      expected_minor: FLOAT,
      variance_minor: THRESHOLD + 1,
      sign_off: { alert_id: expect.any(String) },
    });
    const w = await openShift(waiter, { float_minor: FLOAT, as_drawer: false });
    const under = await count(waiter, {
      shift_id: w,
      counted_minor: FLOAT - THRESHOLD - 1,
    });
    expect(under.result).toMatchObject({
      variance_minor: -(THRESHOLD + 1),
      sign_off: { alert_id: expect.any(String) },
    });
    expect(varianceRequests()).toHaveLength(2);
  });

  it('[05 #50, #50d command half] above the threshold: the shift_variance request in the same transaction; ShiftCounted.variance_alert_id = its alert_id; the fold pending; the note only in bill_texts', async () => {
    const { cashier, drawer } = await start();
    const note = noteSecret('short by fifteen hundred 7c1d');
    const r = await count(cashier, {
      shift_id: drawer,
      counted_minor: 600_000,
      note,
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const alert_id = (r.result!.sign_off as { alert_id: string }).alert_id;
    expect(r.result).toEqual({
      shift_id: drawer,
      closed: true,
      expected_minor: EXPECTED,
      variance_minor: -150_000,
      sign_off: { alert_id },
      closed_requests: [],
    });
    expect(r.events.slice(0, 2).map((e) => e.event_type)).toEqual([
      'ShiftCounted',
      'ShiftClosed',
    ]);
    expect(r.events.map((e) => e.event_type)).toContain('AlertRaised');
    const counted = r.events[0]!.payload as { variance_alert_id: string };
    expect(counted.variance_alert_id).toBe(alert_id);
    const closed = r.events[1]!.payload as {
      note_id: string;
      has_note: boolean;
    };
    expect(closed.has_note).toBe(true);
    expect(textOf(closed.note_id)).toBe(note);

    const raised = varianceRequests();
    expect(raised).toHaveLength(1);
    const p = raised[0]!.payload as {
      alert_id: string;
      dedupe_key: string;
      values: unknown;
      details: unknown;
      requester_staff_id: string;
      subject: unknown;
    };
    expect(p.alert_id).toBe(alert_id);
    expect(p.dedupe_key).toBe(`variance:${drawer}`);
    expect(p.values).toEqual({
      shift_id: drawer,
      note_id: closed.note_id,
      has_note: true,
    });
    expect(p.details).toEqual({ amount: -150_000 });
    expect(p.requester_staff_id).toBe(STAFF.cashier);
    expect(shiftRow(drawer)).toMatchObject({
      state: 'closed',
      variance_state: 'pending',
      variance_alert_id: alert_id,
    });
  });

  it("[05 §6.17] refusals: unknown shift 404; another person's shift without close-shift-for-others 403; a closed shift 409 not_open; nothing written; no refusal reveals expected", async () => {
    const { cashier, manager, waiter, drawer } = await start();
    const missing = await count(cashier, {
      shift_id: 'SH_NOPE',
      counted_minor: 1,
    });
    expect(missing).toMatchObject({
      status: 404,
      error: { code: 'SHIFT_NOT_FOUND', details: { shift_id: 'SH_NOPE' } },
    });
    const theirs = await count(waiter, { shift_id: drawer, counted_minor: 1 });
    expect(theirs).toMatchObject({
      status: 403,
      error: {
        code: 'PERMISSION_DENIED',
        details: { permission: 'close-shift-for-others' },
      },
    });
    blind(JSON.stringify(theirs));
    const bad = await count(cashier, { shift_id: drawer, counted_minor: -1 });
    expect(bad.status).toBe(400);
    const extra = await count(cashier, {
      shift_id: drawer,
      counted_minor: 1,
      expected_minor: 1,
    });
    expect(extra.status).toBe(400);
    expect(eventsOf('ShiftCounted')).toHaveLength(0);

    // the Manager (close-shift-for-others) counts the Cashier's shift; the blind count applies to him too
    const view = await shiftView(manager, drawer);
    blind(view.body);
    const ok = await count(manager, {
      shift_id: drawer,
      counted_minor: EXPECTED,
    });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(ok.events[0]!.payload).toMatchObject({
      by_staff_id: STAFF.manager,
      variance_minor: 0,
      variance_alert_id: null,
    });
    expect(ok.events[1]!.payload).toMatchObject({ closed_by: STAFF.manager });

    const again = await count(cashier, {
      shift_id: drawer,
      counted_minor: EXPECTED,
    });
    expect(again.error).toEqual({ code: 'SHIFT_NOT_OPEN', details: { reason: 'not_open' } }); // exact: no extra key
    expect(again).toMatchObject({
      status: 409,
      error: { code: 'SHIFT_NOT_OPEN', details: { reason: 'not_open' } },
    });
    expect(eventsOf('ShiftCounted')).toHaveLength(1);
  });

  it('[05 §6.17, 00 §3.7] a retransmit with the same command_id replays the stored answer: one ShiftCounted, one request', async () => {
    const { cashier, drawer } = await start();
    const first = await count(
      cashier,
      { shift_id: drawer, counted_minor: 700_000 },
      'cmd-count-1',
    );
    const second = await count(
      cashier,
      { shift_id: drawer, counted_minor: 700_000 },
      'cmd-count-1',
    );
    expect(second.status).toBe(200);
    expect(second.result).toEqual(first.result);
    expect(eventsOf('ShiftCounted')).toHaveLength(1);
    expect(varianceRequests()).toHaveLength(1);
  });

  it("[05 #53, H7-6] the shift's open petty_cash requests are closed obsolete (shift_closed) in the count transaction and listed; another shift's stays open", async () => {
    const { cashier, manager, drawer } = await start();
    const m = await openShift(manager, { float_minor: 0, as_drawer: false });
    const mine = pettyRequest(cashier, drawer, 1);
    const other = pettyRequest(manager, m, 2);
    const r = await count(cashier, {
      shift_id: drawer,
      counted_minor: EXPECTED,
    });
    expect(r.result).toMatchObject({ closed_requests: [mine], sign_off: null });
    const closed = r.events
      .filter((e) => e.event_type === 'AlertClosed')
      .map((e) => e.payload);
    expect(closed).toEqual([
      {
        alert_id: mine,
        reason: 'obsolete',
        by_staff_id: STAFF.cashier,
        note: 'shift_closed',
      },
    ]);
    expect(
      alerts.listOpen(db(), { kind: 'petty_cash' }).map((a) => a.alert_id),
    ).toEqual([other]);
  });
});

// ================================================================================================= the sign-off

describe('[05 §3.14 shift_variance, #50, #50b, #50c, #47b] the sign-off apply', () => {
  it("[05 #50] a Manager approves in person on the Cashier's kiosk (actor Cashier ≠ answerer Manager) → ShiftVarianceSignedOff { approved, approver = answerer, business_date = today }; never reopens", async () => {
    const { cashier, drawer } = await start();
    const today = hub.deps.state.get().business_day!.business_date;
    const alert_id = (
      (await count(cashier, { shift_id: drawer, counted_minor: 700_000 }))
        .result!.sign_off as { alert_id: string }
    ).alert_id;
    const a = await post(hub, cashier, 'answer-request', 'AnswerRequest', {
      alert_id,
      decision: 'approve',
      method: 'in_person',
      answerer_staff_id: STAFF.manager,
      pin: PIN.b,
    });
    expect(a.status, JSON.stringify(a.error)).toBe(200);
    const signed = a.events.filter(
      (e) => e.event_type === 'ShiftVarianceSignedOff',
    );
    expect(signed).toHaveLength(1);
    expect(signed[0]).toMatchObject({
      stream_type: 'shift',
      stream_id: drawer,
      actor_id: STAFF.cashier,
    });
    expect(signed[0]!.payload).toEqual({
      shift_id: drawer,
      outcome: 'approved',
      alert_id,
      approver_staff_id: STAFF.manager,
      business_date: today,
    });
    expect(shiftRow(drawer)).toMatchObject({
      state: 'closed',
      variance_state: 'approved',
    });
    expect(db().prepare('SELECT * FROM shift_signoffs').all()).toEqual([
      expect.objectContaining({
        shift_id: drawer,
        outcome: 'approved',
        approver_staff_id: STAFF.manager,
        business_date: today,
      }),
    ]);
  });

  it('[05 #50, Q-4] reject → ShiftVarianceSignedOff { disputed }: a record only — the shift stays closed, no recount (a second CountShift is refused)', async () => {
    const { cashier, manager, drawer } = await start();
    const alert_id = (
      (await count(cashier, { shift_id: drawer, counted_minor: 800_000 }))
        .result!.sign_off as { alert_id: string }
    ).alert_id;
    const a = await answer(hub, manager, alert_id, 'reject');
    expect(a.status, JSON.stringify(a.error)).toBe(200);
    expect(
      a.events
        .filter((e) => e.event_type === 'ShiftVarianceSignedOff')
        .map((e) => e.payload),
    ).toEqual([
      {
        shift_id: drawer,
        outcome: 'disputed',
        alert_id,
        approver_staff_id: STAFF.manager,
        business_date: hub.deps.state.get().business_day!.business_date,
      },
    ]);
    expect(shiftRow(drawer)).toMatchObject({
      state: 'closed',
      variance_state: 'disputed',
    });
    expect(
      (await count(cashier, { shift_id: drawer, counted_minor: EXPECTED }))
        .status,
    ).toBe(409);
  });

  it('[05 §3.14] re-check on approve: the variance no longer pending → the answer is refused, nothing written', async () => {
    const { cashier, manager, drawer } = await start();
    const alert_id = (
      (await count(cashier, { shift_id: drawer, counted_minor: 700_000 }))
        .result!.sign_off as { alert_id: string }
    ).alert_id;
    db()
      .prepare(
        `UPDATE shifts SET variance_state = 'approved' WHERE shift_id = ?`,
      )
      .run(drawer); // as if signed off already
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBeGreaterThanOrEqual(400);
    expect(eventsOf('ShiftVarianceSignedOff')).toHaveLength(0);
  });

  it("[05 #50b, #50c, #47b sign-off half] day-1 variances answered on day 2 (approve) and day 3 (reject): business_date = the answer's open day; rebuild of shifts alone keeps day 2 / day 3; no payment lands on a counted shift", async () => {
    const { cashier, waiter, drawer } = await start();
    const day1 = hub.deps.state.get().business_day!.business_date;
    const w = await openShift(waiter, { float_minor: FLOAT, as_drawer: false });
    const a1 = (
      (await count(cashier, { shift_id: drawer, counted_minor: 700_000 }))
        .result!.sign_off as { alert_id: string }
    ).alert_id;
    const a2 = (
      (await count(waiter, { shift_id: w, counted_minor: 300_000 })).result!
        .sign_off as { alert_id: string }
    ).alert_id;

    // #50b: no payment ever lands on the counted drawer shift — the kiosk has no money shift now
    const order = takeawayOrder(hub, { prefix: 'SC' });
    const paid = await post(hub, cashier, 'add-payment', 'AddPayment', {
      bill_ref: { order_id: order.order_id },
      split_no: 1,
      mode_id: 'cash',
      direction: 'in',
      amount_minor: 1_000,
    });
    expect(paid).toMatchObject({
      status: 409,
      error: { code: 'SHIFT_NOT_OPEN' },
    });

    // the day closes with both requests open (request kinds never expire; 05's appender leaves shift_variance open)
    const day2 = nextDay();
    expect(
      alerts
        .listOpen(db(), { kind: 'shift_variance' })
        .map((a) => a.alert_id)
        .sort(),
    ).toEqual([a1, a2].sort());
    const manager2 = signIn(hub, STAFF.manager); // a new day's sign-in (the day-1 session idled out)
    seats.push(manager2);
    const ok1 = await answer(hub, manager2, a1, 'approve');
    expect(ok1.status, JSON.stringify(ok1.error)).toBe(200);
    const day3 = nextDay();
    const manager3 = signIn(hub, STAFF.manager);
    seats.push(manager3);
    const ok2 = await answer(hub, manager3, a2, 'reject');
    expect(ok2.status, JSON.stringify(ok2.error)).toBe(200);

    const signed = eventsOf('ShiftVarianceSignedOff').map(
      (e) =>
        e.payload as {
          shift_id: string;
          outcome: string;
          business_date: string;
        },
    );
    expect(signed.map((p) => [p.shift_id, p.outcome, p.business_date])).toEqual(
      [
        [drawer, 'approved', day2],
        [w, 'disputed', day3],
      ],
    );
    expect(new Set([day1, day2, day3]).size).toBe(3);
    const dates = () =>
      db()
        .prepare(
          'SELECT shift_id, outcome, business_date FROM shift_signoffs ORDER BY business_date',
        )
        .all();
    const live = dates();
    expect(live).toEqual([
      { shift_id: drawer, outcome: 'approved', business_date: day2 },
      { shift_id: w, outcome: 'disputed', business_date: day3 },
    ]);
    const liveShifts = db()
      .prepare('SELECT * FROM shifts ORDER BY shift_id')
      .all();
    db()
      .prepare(`DELETE FROM projection_checkpoints WHERE projection = 'shifts'`)
      .run();
    const registry = createProjectionRegistry();
    registry.register(shiftsProjection());
    registry.catchUp(db(), branch());
    expect(dates()).toEqual(live);
    expect(
      db().prepare('SELECT * FROM shifts ORDER BY shift_id').all(),
    ).toEqual(liveShifts);
    expect(shiftRow(drawer)['business_date']).toBe(day1);
  });

  it('[05 #53b extended, H1-1] the real kind: Owner and Manager answer; the Order taker (no close-shift-for-others) → not_approver; the requester himself → self', async () => {
    const { manager, owner, waiter, cashier, drawer } = await start();
    const m = await openShift(manager, {
      float_minor: FLOAT,
      as_drawer: false,
    });
    const own = (
      (await count(manager, { shift_id: m, counted_minor: 0 })).result!
        .sign_off as { alert_id: string }
    ).alert_id;
    const self = await answer(hub, manager, own, 'approve');
    expect(self).toMatchObject({
      status: 403,
      error: { code: 'PERMISSION_DENIED', details: { reason: 'self' } },
    });
    const notApprover = await answer(hub, waiter, own, 'approve');
    expect(notApprover).toMatchObject({
      status: 403,
      error: { code: 'PERMISSION_DENIED', details: { reason: 'not_approver' } },
    });
    expect(eventsOf('ShiftVarianceSignedOff')).toHaveLength(0);
    expect((await answer(hub, owner, own, 'approve')).status).toBe(200);

    const theirs = (
      (await count(cashier, { shift_id: drawer, counted_minor: 0 })).result!
        .sign_off as { alert_id: string }
    ).alert_id;
    expect((await answer(hub, cashier, theirs, 'approve')).status).toBe(403);
    expect((await answer(hub, manager, theirs, 'approve')).status).toBe(200);
    expect(
      eventsOf('ShiftVarianceSignedOff').map(
        (e) => (e.payload as { approver_staff_id: string }).approver_staff_id,
      ),
    ).toEqual([OWNER, STAFF.manager]);
  });
});

// ================================================================================================= CloseShift

describe('[05 §6.18, #51] CloseShift { skip_count } — skip-blind-count, audited', () => {
  it('[05 #51] the Cashier and the Manager (no skip-blind-count) are refused 403 skip_not_granted; the Owner skips: ShiftCountSkipped + ShiftClosed, no variance, no request, the drawer free; the response blind', async () => {
    const { cashier, manager, owner, drawer } = await start();
    for (const who of [cashier, manager]) {
      const r = await closeShift(who, { shift_id: drawer, skip_count: true });
      expect(r, who.staffId).toMatchObject({
        status: 403,
        error: {
          code: 'PERMISSION_DENIED',
          details: { reason: 'skip_not_granted' },
        },
      });
    }
    expect(
      (await closeShift(owner, { shift_id: drawer, skip_count: false })).status,
    ).toBe(400);
    expect((await closeShift(owner, { shift_id: drawer })).status).toBe(400);
    expect(eventsOf('ShiftClosed')).toHaveLength(0);

    const note = noteSecret('cashier left early 3b9e');
    const r = await closeShift(owner, {
      shift_id: drawer,
      skip_count: true,
      note,
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    blind(JSON.stringify(r.result));
    expect(r.result).toEqual({
      closed: { shift_id: drawer },
      open_advances: [],
      closed_requests: [],
    });
    expect(r.events.map((e) => [e.event_type, e.actor_id])).toEqual([
      ['ShiftCountSkipped', OWNER],
      ['ShiftClosed', OWNER],
    ]);
    expect(r.events[0]!.payload).toEqual({ shift_id: drawer });
    const closed = r.events[1]!.payload as { note_id: string };
    expect(r.events[1]!.payload).toEqual({
      shift_id: drawer,
      closed_by: OWNER,
      has_note: true,
      note_id: closed.note_id,
      alert_id: null,
      approver_staff_id: null,
    });
    expect(textOf(closed.note_id)).toBe(note);
    expect(shiftRow(drawer)).toMatchObject({
      state: 'closed',
      count_skipped: 1,
      counted_minor: null,
      variance_minor: null,
      variance_state: null,
      closed_by: OWNER,
    });
    expect(varianceRequests()).toHaveLength(0);
    // after a skipped count the view stays blind (no ShiftCounted)
    blind((await shiftView(owner, drawer)).body);
    expect(await shiftView(owner, drawer)).toMatchObject({
      data: { expected_minor: null, variance_minor: null },
    });

    const again = await closeShift(owner, {
      shift_id: drawer,
      skip_count: true,
    });
    expect(again.error).toEqual({ code: 'SHIFT_NOT_OPEN', details: { reason: 'not_open' } }); // exact: no extra key
    expect(again).toMatchObject({
      status: 409,
      error: { code: 'SHIFT_NOT_OPEN', details: { reason: 'not_open' } },
    });
    const missing = await closeShift(owner, {
      shift_id: 'SH_NOPE',
      skip_count: true,
    });
    expect(missing).toMatchObject({
      status: 404,
      error: { code: 'SHIFT_NOT_FOUND' },
    });

    const next = takeover(cashier, STAFF.manager);
    expect(
      (
        await post(hub, next, 'open-shift', 'OpenShift', {
          float_minor: 0,
          as_drawer: true,
        })
      ).status,
    ).toBe(200);
  });

  it("[05 §6.18, H7-6, G1-8] open advances are listed, never blocking; the shift's open petty_cash requests closed obsolete and listed", async () => {
    const { cashier, owner, drawer } = await start();
    hub.clock.advance(1_000);
    hub.deps.writer.run((tx) =>
      tx.append([
        {
          stream_type: 'shift',
          stream_id: drawer,
          event_type: 'PettyCashAdvanced',
          schema_version: 1,
          payload: {
            entry_id: 'PE_ADV',
            shift_id: drawer,
            amount_minor: 100_000,
            category_id: 'cat-misc',
            has_paid_to: false,
            advance_staff_id: STAFF.orderTaker,
            has_note: false,
            alert_id: null,
            requester_staff_id: STAFF.cashier,
            approver_staff_id: null,
          } as unknown as PosEvent['payload'],
          occurred_at: hub.clock.branchNow(),
          actor_id: STAFF.cashier,
          device_id: 'D_FIXTURE',
        },
      ]),
    );
    const petty = pettyRequest(cashier, drawer, 7);
    const r = await closeShift(owner, { shift_id: drawer, skip_count: true });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({
      closed: { shift_id: drawer },
      open_advances: [
        {
          entry_id: 'PE_ADV',
          amount_minor: 100_000,
          advance_staff_id: STAFF.orderTaker,
        },
      ],
      closed_requests: [petty],
    });
    expect(
      r.events
        .filter((e) => e.event_type === 'AlertClosed')
        .map((e) => e.payload),
    ).toEqual([
      {
        alert_id: petty,
        reason: 'obsolete',
        by_staff_id: OWNER,
        note: 'shift_closed',
      },
    ]);
  });

  it('[05 §6.18] the skip grant is checked after the state and before the other-person check; the Owner closes his own shift', async () => {
    const { owner, waiter } = await start();
    const o = await openShift(owner, { float_minor: 0, as_drawer: false });
    // the Order taker holds neither skip-blind-count nor close-shift-for-others: the skip grant is refused first (§6.18 order)
    expect(
      await closeShift(waiter, { shift_id: o, skip_count: true }),
    ).toMatchObject({
      status: 403,
      error: { details: { reason: 'skip_not_granted' } },
    });
    // the Owner closes his own shift
    expect(
      (await closeShift(owner, { shift_id: o, skip_count: true })).status,
    ).toBe(200);
  });
});

// ================================================================================================= HandoverCount

describe('[05 §6.19, #52] HandoverCount — a drawer count, the shift stays open', () => {
  it('[05 #52] HandoverCounted records the variance (no variance_alert_id, no request even far over the threshold); the shift stays open; the response reveals its own expected; the shift view stays blind at the top', async () => {
    const { cashier, drawer } = await start();
    const r = await handover(cashier, {
      shift_id: drawer,
      counted_minor: 700_000,
    });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.result).toEqual({
      shift_id: drawer,
      counted_minor: 700_000,
      expected_minor: EXPECTED,
      variance_minor: -50_000,
    });
    expect(r.events.map((e) => e.event_type)).toEqual(['HandoverCounted']);
    expect(r.events[0]!.payload).toEqual({
      shift_id: drawer,
      counted_minor: 700_000,
      expected_minor: EXPECTED,
      variance_minor: -50_000,
      by_staff_id: STAFF.cashier,
    });
    expect(varianceRequests()).toHaveLength(0);
    expect(shiftRow(drawer)).toMatchObject({
      state: 'open',
      counted_minor: null,
      variance_state: null,
      variance_alert_id: null,
    });

    const view = await shiftView(cashier, drawer);
    expect(view.data).toMatchObject({
      state: 'open',
      expected_minor: null,
      variance_minor: null,
      counted_minor: null,
    });
    expect(view.data['handovers']).toEqual([
      expect.objectContaining({
        counted_minor: 700_000,
        expected_minor: EXPECTED,
        variance_minor: -50_000,
      }),
    ]);
    // money still lands on it after the handover (B11): a second handover sees the new sale
    pay(drawer, 10_000);
    expect(
      (await handover(cashier, { shift_id: drawer, counted_minor: 760_000 }))
        .result,
    ).toMatchObject({ expected_minor: 760_000, variance_minor: 0 });
  });

  it("[05 §6.19] refusals: not a drawer shift 409 no_drawer_shift; closed 409 not_open; unknown 404; another person's drawer without close-shift-for-others 403", async () => {
    const { cashier, manager, waiter, drawer } = await start();
    const m = await openShift(manager, { float_minor: 0, as_drawer: false });
    expect(
      await handover(manager, { shift_id: m, counted_minor: 0 }),
    ).toMatchObject({
      status: 409,
      error: { code: 'SHIFT_NOT_OPEN', details: { reason: 'no_drawer_shift' } },
    });
    expect(
      await handover(cashier, { shift_id: 'SH_NOPE', counted_minor: 0 }),
    ).toMatchObject({ status: 404, error: { code: 'SHIFT_NOT_FOUND' } });
    const theirs = await handover(waiter, {
      shift_id: drawer,
      counted_minor: 0,
    });
    expect(theirs).toMatchObject({
      status: 403,
      error: {
        code: 'PERMISSION_DENIED',
        details: { permission: 'close-shift-for-others' },
      },
    });
    blind(JSON.stringify(theirs));
    expect(
      (
        await handover(cashier, {
          shift_id: drawer,
          counted_minor: 0,
          note: 'x',
        })
      ).status,
    ).toBe(400);
    expect(
      (await handover(manager, { shift_id: drawer, counted_minor: EXPECTED }))
        .status,
    ).toBe(200);
    await count(cashier, { shift_id: drawer, counted_minor: EXPECTED });
    const closedHandover = await handover(cashier, { shift_id: drawer, counted_minor: 0 });
    expect(closedHandover.error).toEqual({ code: 'SHIFT_NOT_OPEN', details: { reason: 'not_open' } }); // exact: no extra key
    expect(closedHandover).toMatchObject({
      status: 409,
      error: { code: 'SHIFT_NOT_OPEN', details: { reason: 'not_open' } },
    });
    expect(eventsOf('HandoverCounted')).toHaveLength(1);
  });
});

// ================================================================================================= statement counts

describe('[05 §6.17–§6.19 Statements] fixed, whatever the payments (00 envelope excluded; 01d raise / closeMany their own bound)', () => {
  for (const n of [1, 40]) {
    it(`[05 §6.17] CountShift at ${n} payment(s): the shift (1) + the open petty requests (1) = 2; + the note (1) = 3; the raise and the obsolete close are 01d's`, async () => {
      const { cashier, manager, waiter, drawer } = await start();
      for (let i = 1; i < n; i += 1) pay(drawer, 1_000);
      const expected = EXPECTED + (n - 1) * 1_000;
      const in01d = counting01d();
      try {
        await count(cashier, { shift_id: drawer, counted_minor: expected });
        expect(handled['count-shift']).toBe(2);
        expect(in01d.raise + in01d.close).toBe(0);

        const m = await openShift(manager, {
          float_minor: 0,
          as_drawer: false,
        });
        pettyRequest(manager, m, 9);
        const before01d = in01d.raise + in01d.close;
        await count(manager, {
          shift_id: m,
          counted_minor: 900_000,
          note: noteSecret(`over by nine thousand ${n} 41aa`),
        });
        expect(in01d.close).toBeGreaterThan(0);
        expect(in01d.raise + in01d.close - before01d).toBeGreaterThan(
          in01d.close,
        );
        expect(
          handled['count-shift']! - (in01d.raise + in01d.close - before01d),
        ).toBe(3);

        await count(waiter, { shift_id: drawer, counted_minor: 1 });
        expect(handled['count-shift']).toBe(1); // a refusal stops after the read
      } finally {
        in01d.restore();
      }
    });
  }

  it('[05 §6.18] CloseShift: the shift with its open advances (1) + the open petty requests (1) = 2; + the note = 3 (≤ 5)', async () => {
    const { owner, drawer } = await start();
    await closeShift(owner, {
      shift_id: drawer,
      skip_count: true,
      note: noteSecret('skip note 99f1'),
    });
    expect(handled['close-shift']).toBe(3);
    const o = await openShift(owner, { float_minor: 0, as_drawer: false });
    await closeShift(owner, { shift_id: o, skip_count: true });
    expect(handled['close-shift']).toBe(2);
  });

  it('[05 §6.19, R-81] HandoverCount: the shift (1) (≤ 2), with and without an earlier handover', async () => {
    const { cashier, drawer } = await start();
    await handover(cashier, { shift_id: drawer, counted_minor: 1 });
    // exactly 1 (the shift read); the spec bound is "2" in v1.0.16 and becomes ≤ 2 in v1.0.18
    expect(handled['handover-count']).toBe(1);
    // v1.0.21 (R-81): the `at` bump is the fold's, not the command's — a second handover in the same millisecond
    // answers 200 and still costs 1
    const second = await handover(cashier, { shift_id: drawer, counted_minor: 2 });
    expect(second.status, JSON.stringify(second.error)).toBe(200);
    expect(handled['handover-count']).toBe(1);
  });

  it("[05 §3.14] the kind's apply: approve 1 statement (the shift), read-only; reject 0; the approver is the answerer, never the actor; business_date from ctx.state", async () => {
    const { cashier, manager, drawer } = await start();
    const alert_id = (
      (await count(cashier, { shift_id: drawer, counted_minor: 0 })).result!
        .sign_off as { alert_id: string }
    ).alert_id;
    const record = alerts
      .listOpen(db(), { kind: 'shift_variance' })
      .find((x) => x.alert_id === alert_id)!;
    const request = kindOf('shift_variance')!.request!;
    const today = hub.deps.state.get().business_day!.business_date;
    const run = (decision: 'approve' | 'reject') =>
      hub.deps.writer.run((tx) => {
        const ctx = {
          tx: readOnlyTx(tx),
          state: tx.state,
          clock: tx.clock,
          ids: tx.ids,
          actor: {
            kind: 'staff',
            staffId: STAFF.cashier,
            stationId: null,
            sessionId: cashier.sessionId,
            deviceId: cashier.deviceId,
          },
          permission: null,
          directory: currentDirectory(hub.app),
          alert: record,
        } as unknown as AlertApplyCtx<never, never>;
        counter.reset();
        const out = request.apply(ctx, {
          decision,
          answerer_staff_id: STAFF.manager,
          method: 'pin',
          device_id: manager.deviceId,
          answered_at: hub.clock.branchNow(),
        });
        return { out, statements: counter.count };
      }).result;
    const approved = run('approve');
    expect(approved.statements).toBe(1);
    expect(
      approved.out.map((d) => [d.event_type, d.stream_type, d.stream_id]),
    ).toEqual([['ShiftVarianceSignedOff', 'shift', drawer]]);
    expect(approved.out[0]!.payload).toEqual({
      shift_id: drawer,
      outcome: 'approved',
      alert_id,
      approver_staff_id: STAFF.manager,
      business_date: today,
    });
    const rejected = run('reject');
    expect(rejected.statements).toBe(0);
    expect(rejected.out[0]!.payload).toEqual({
      shift_id: drawer,
      outcome: 'disputed',
      alert_id,
      approver_staff_id: STAFF.manager,
      business_date: today,
    });
  });
});
