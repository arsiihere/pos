// 05a plan task 30 (B7): the counter check on an `everyone` cashier kiosk — 05a v1.0.4 §3.3 "Counter check (OQ-3)",
// §3.3a (the mask), §3.6 (`cashier` screen), §3.9 rule 1 (the downgraded raise, G-h route-level), §10 #7c, #17–#19.
// Written by a fresh implementer from the spec, not from the code of tasks 9–11 / 23–25.
//
// Real devices (paired by request, real profiles, no fixture "legacy" profile), real sign-in through `POST /auth/pin`
// (the §3.5 check + argon2), real commands over HTTP through the hub's writer and the real folds. Directory: 05's
// billingDirectory() (the cloud's DEFAULT_ROLES: Owner = every permission; Manager = every permission but
// manage-roles, skip-blind-count, manage-fiscal-settings; Cashier = take-payment, drawer, petty cash, …).
import { LISTED_ONLY_PERMISSIONS, MONEY_PERMISSIONS, type Permission } from '@pos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { PIN } from '../helpers/fixtures';
import { pairByRequest } from '../helpers/pair-by-request';
import type { DeviceProfileInput, TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { appendOrder, FX, post, STAFF, startBilling, type Reply, type Who } from '../billing/fixtures';
import { stagedOrder } from '../voids/fixtures';

const OWNER = 'S_OWNER';
const PIN_OF: Record<string, string> = { [STAFF.manager]: PIN.b, [STAFF.cashier]: PIN.c, [OWNER]: PIN.a };

const KIOSK: DeviceProfileInput = { access: 'everyone', screens: ['takeaway', 'cashier', 'manager'] };
const listed = (staff_ids: string[]): DeviceProfileInput => ({ access: 'listed', staff_ids, screens: ['dine_in', 'manager'] });

/** Rs 5,000 float; a takeaway of 2 naans (Rs 30 each, voidsMenu) = Rs 60 (6,000 minor). */
const FLOAT = 500_000;
const BILL = 6_000;
/** Rs 500 petty cash out (below the built-in Rs 5,000 limit, so direct). */
const PETTY = 50_000;

let hub: TestHub;
const sockets: WsClient[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

// ------------------------------------------------------------------------------------------------ set-up

async function start(): Promise<void> {
  hub = await startBilling();
  // 01a `opened_recently` is not under test: the day may close right after it opened.
  const config = branchConfig()!;
  swapBranchConfig({ config: { ...config, day_min_gap_hours: 0 }, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
}

type Device = { deviceId: string; token: string };

async function kiosk(name: string): Promise<Device> {
  const d = await pairByRequest(hub, { device_type: 'cashier_kiosk', hardware_hint: 'cashier_kiosk', device_name: name, profile: KIOSK });
  expect(d.poll).toMatchObject({ device_type: 'cashier_kiosk' });
  return d;
}

async function phone(name: string, staff_ids: string[]): Promise<Device> {
  return pairByRequest(hub, { device_type: 'phone', hardware_hint: 'phone', device_name: name, profile: listed(staff_ids) });
}

async function tablet(name: string, profile: DeviceProfileInput): Promise<Device> {
  return pairByRequest(hub, { device_type: 'tablet', hardware_hint: 'tablet', device_name: name, profile });
}

/** The REAL `POST /auth/pin` (§3.5, §6.5): the §3.5 check, argon2, the session the device's view is bound to. */
async function signInPin(d: Device, staffId: string, o: { takeover?: boolean } = {}): Promise<Who> {
  const res = await hub.app.inject({
    method: 'POST',
    url: '/auth/pin',
    headers: { authorization: `Bearer ${d.token}` },
    payload: { staff_id: staffId, pin: PIN_OF[staffId], ...(o.takeover === true ? { takeover: true } : {}) },
  });
  expect(res.statusCode, res.body).toBe(200);
  const data = res.json().data as { session_id: string; session_token: string };
  return { staffId, deviceId: d.deviceId, token: d.token, sessionId: data.session_id, sessionToken: data.session_token };
}

/** The session's live socket (00 §6 WS auth): the device is then "connected now" for §3.9 rule 1 (a). */
async function connect(who: Who): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token: who.token, session_token: who.sessionToken });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
  return ws;
}

const ok = (r: Reply): Reply => {
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r;
};
const db = () => hub.deps.db;
const one = (sql: string, ...args: unknown[]): unknown => db().prepare(sql).pluck().get(...args);
const count = (event_type: string): number => one('SELECT COUNT(*) FROM events WHERE event_type = ?', event_type) as number;
const typesOf = (r: Reply): string[] => r.events.map((e) => e.event_type);

async function openDrawerShift(cashier: Who): Promise<string> {
  return ok(await post(hub, cashier, 'open-shift', 'OpenShift', { float_minor: FLOAT, as_drawer: true })).result!.shift_id as string;
}

let orderNo = 0;
/** A takeaway of `n` naans placed by the order taker (02b fixture, real events). */
function takeaway(n: number): { order_id: string; line: string } {
  orderNo += 1;
  const line = `CT${orderNo}_N`;
  const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: line, item_id: FX.naan, quantity: n }] });
  return { order_id, line };
}

/** A 2-naan takeaway paid Rs 60 cash by `who` and closed (CloseSplit); its bill_id. */
async function closedBill(who: Who): Promise<string> {
  const o = takeaway(2);
  const ref = { order_id: o.order_id };
  ok(await post(hub, who, 'add-payment', 'AddPayment', { bill_ref: ref, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: BILL }));
  ok(await post(hub, who, 'close-split', 'CloseSplit', { bill_ref: ref, split_no: 1, expected_total_minor: BILL }));
  return one('SELECT bill_id FROM bill_orders WHERE order_id = ?', o.order_id) as string;
}

const get = (who: Who, url: string) =>
  hub.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });

// ================================================================================================= #7c counter work

describe('[05a §3.3 counter check, #7c] counter work on an `everyone` kiosk never breaks', () => {
  it('[05a §3.3] none of the counter permissions is in MONEY_PERMISSIONS or LISTED_ONLY_PERMISSIONS (O-11)', () => {
    const counter: Permission[] = [
      'close-shift-for-others',
      'manage-own-shift',
      'close-business-day',
      'view-reports',
      'take-payment',
      'open-cash-drawer',
      'record-petty-cash',
      'remove-comp',
      'remove-service-charge',
      'close-without-buyer-id',
    ];
    for (const p of counter) {
      expect(LISTED_ONLY_PERMISSIONS, p).not.toContain(p);
      expect(MONEY_PERMISSIONS, p).not.toContain(p);
    }
    expect([...LISTED_ONLY_PERMISSIONS].sort()).toEqual(
      ['access-hub-admin', 'approve-void', 'manage-devices', 'manage-fiscal-settings', 'manage-roles', 'manage-staff', 'view-audit-log'].sort(),
    );
    expect([...MONEY_PERMISSIONS].sort()).toEqual(['apply-comp', 'apply-discount', 'apply-refund', 'reopen-bill', 'void-item'].sort());
  });

  it("[05a #7c] the Manager takes over the Cashier's `everyone` kiosk: opens the drawer, records petty cash, removes the Cashier's payment, counts and closes the Cashier's shift, closes the day, prints the Z report — all succeed", async () => {
    await start();
    const counter = await kiosk('Counter 1');
    // The Cashier's drawer shift on the kiosk, a Rs 70 sale closed, and a second bill with a Rs 70 payment still open.
    const cashier = await signInPin(counter, STAFF.cashier);
    const drawer = await openDrawerShift(cashier);
    await closedBill(cashier);
    const open = takeaway(2);
    const taken = ok(
      await post(hub, cashier, 'add-payment', 'AddPayment', { bill_ref: { order_id: open.order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: BILL }),
    );
    const cashierPayment = taken.result!.payment_id as string;
    expect(one('SELECT taken_by_staff_id FROM bill_payments WHERE payment_id = ?', cashierPayment)).toBe(STAFF.cashier);

    // The Manager walks up to the counter and takes the kiosk over (m-10: allowed on `everyone` devices).
    const manager = await signInPin(counter, STAFF.manager, { takeover: true });
    expect(one('SELECT end_reason FROM staff_sessions WHERE session_id = ?', cashier.sessionId)).toBe('taken_over');

    // GET /queries/session: none of the counter permissions is masked for the Manager on this kiosk (§6.7).
    const session = await get(manager, '/queries/session');
    expect(session.statusCode).toBe(200);
    const perms = session.json().data.permissions as Record<string, { grant: string; masked?: string }>;
    for (const p of ['close-shift-for-others', 'manage-own-shift', 'close-business-day', 'view-reports', 'take-payment', 'open-cash-drawer', 'record-petty-cash']) {
      expect(perms[p], p).toMatchObject({ grant: 'allowed' });
      expect(perms[p]!.masked, p).toBeUndefined();
    }

    // the drawer (05 §6.21)
    const opened = ok(await post(hub, manager, 'open-cash-drawer', 'OpenCashDrawer', { reason_code: 'change_for_customer' }));
    expect(opened.result).toMatchObject({ shift_id: drawer });
    expect(typesOf(opened)).toEqual(['DrawerOpened']);

    // petty cash (05 §6.20): direct, on the kiosk's drawer shift
    const petty = ok(await post(hub, manager, 'record-petty-cash', 'RecordPettyCash', { kind: 'out', amount_minor: PETTY, category_id: 'supplies', paid_to: 'Corner shop', note: 'ice' }));
    expect(typesOf(petty)).toContain('PettyCashOut');
    expect(petty.events.find((e) => e.event_type === 'PettyCashOut')).toMatchObject({ stream_type: 'shift', stream_id: drawer, actor_id: STAFF.manager });

    // removing another cashier's payment (05 §6.10: close-shift-for-others), then settling the bill again
    const removed = ok(await post(hub, manager, 'remove-payment', 'RemovePayment', { payment_id: cashierPayment, reason_code: 'wrong_mode' }));
    expect(typesOf(removed)).toEqual(['PaymentRemoved']);
    expect(removed.events[0]!.payload).toMatchObject({ payment_id: cashierPayment, taken_by_staff_id: STAFF.cashier });
    ok(await post(hub, manager, 'add-payment', 'AddPayment', { bill_ref: { order_id: open.order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: BILL }));
    ok(await post(hub, manager, 'close-split', 'CloseSplit', { bill_ref: { order_id: open.order_id }, split_no: 1, expected_total_minor: BILL }));

    // counting and closing another cashier's shift (05 §6.17–§6.18): float + 2 sales − petty cash, no variance
    const expected = FLOAT + 2 * BILL - PETTY;
    const counted = ok(await post(hub, manager, 'count-shift', 'CountShift', { shift_id: drawer, counted_minor: expected }));
    expect(counted.events.map((e) => e.event_type)).toContain('ShiftClosed');
    expect(db().prepare('SELECT state, staff_id FROM shifts WHERE shift_id = ?').get(drawer)).toEqual({ state: 'closed', staff_id: STAFF.cashier });
    expect(db().prepare("SELECT COUNT(*) FROM alerts WHERE kind = 'shift_variance'").pluck().get()).toBe(0);

    // day close (01a §6.18b + 05 §6.25), then the Z report (05 §6.22)
    const closed = ok(await post(hub, manager, 'close-business-day', 'CloseBusinessDay', {}));
    expect(typesOf(closed)).toContain('BusinessDayClosed');
    const z = ok(await post(hub, manager, 'print-report', 'PrintReport', { doc: 'z_report' }));
    expect(z.result).toMatchObject({ printed: expect.any(Boolean) });
    expect(one('SELECT COUNT(*) FROM z_reports')).toBe(1);
  });
});

// ================================================================================================= money: the request path

type MoneyKind = 'void_approval' | 'discount' | 'comp' | 'reopen_bill';
interface MoneyCase {
  kind: MoneyKind;
  /** the permission the §3.9 rule 1 (b) holders right names: range_permission, else base_permission */
  holders: Permission;
  /** the event a direct (unmasked) action writes */
  applied: string;
  send(who: Who): Promise<Reply>;
}

/**
 * The four money commands (MONEY_PERMISSIONS: void-item, apply-discount, apply-comp, reopen-bill; apply-refund has no
 * command, refunds go through ReopenBill, 05 S-8), each on its own fresh subject. `bills` = closed bills for ReopenBill.
 */
function moneyCases(bills: string[]): MoneyCase[] {
  return [
    {
      kind: 'void_approval',
      holders: 'approve-void',
      applied: 'ItemVoided',
      send: (who) => {
        orderNo += 1;
        const s = stagedOrder(hub, { prefix: `MV${orderNo}` });
        return post(hub, who, 'void-items', 'VoidItems', {
          order_id: s.order_id,
          reason_code: 'customer_changed_mind',
          note: null,
          disposition_note: null,
          lines: [{ order_item_id: s.cooking, disposition: 'wastage' }],
        });
      },
    },
    {
      kind: 'discount',
      holders: 'apply-discount',
      applied: 'DiscountApplied',
      send: (who) => post(hub, who, 'apply-discount', 'ApplyDiscount', { bill_ref: { order_id: takeaway(2).order_id }, kind: 'percent', value: 1_000, reason_code: 'regular_customer' }),
    },
    {
      kind: 'comp',
      holders: 'apply-comp',
      applied: 'LineComped',
      send: (who) => post(hub, who, 'comp-line', 'CompLine', { order_item_id: takeaway(2).line, units: 1, reason_code: 'quality' }),
    },
    {
      kind: 'reopen_bill',
      holders: 'reopen-bill',
      applied: 'BillReopened',
      send: (who) => {
        const bill_id = bills.shift();
        if (bill_id === undefined) throw new Error('moneyCases: no closed bill left');
        return post(hub, who, 'reopen-bill', 'ReopenBill', { bill_id, reason_code: 'wrong_payment_mode' });
      },
    },
  ];
}

interface Raised {
  kind: string;
  state: string;
  requester_staff_id: string;
  request: { right_mode: string; base_permission: string | null; receiver_staff_id: string | null; approver_role_ids: string[] };
}

/** The open request(s) `who` raised since `afterSeq` (alerts with a request part). */
function raisedSince(afterSeq: number, staffId: string): Raised[] {
  const rows = db()
    .prepare('SELECT kind, state, requester_staff_id, request_json FROM alerts WHERE raised_seq > ? AND requester_staff_id = ? AND request_json IS NOT NULL ORDER BY raised_seq')
    .all(afterSeq, staffId) as Array<Omit<Raised, 'request'> & { request_json: string }>;
  return rows.map(({ request_json, ...r }) => ({ ...r, request: JSON.parse(request_json) as Raised['request'] }));
}
const lastSeq = (): number => (one('SELECT COALESCE(MAX(seq), 0) FROM events') as number);

/** The money world: a Cashier's drawer shift on kiosk 2 with `n` closed bills (for ReopenBill), the Manager on kiosk 1. */
async function moneyWorld(n = 1): Promise<{ manager: Who; cashier: Who; bills: string[]; counter: Device }> {
  await start();
  const counter = await kiosk('Counter 1');
  const till = await kiosk('Counter 2');
  const cashier = await signInPin(till, STAFF.cashier);
  await openDrawerShift(cashier);
  const bills: string[] = [];
  for (let i = 0; i < n; i += 1) bills.push(await closedBill(cashier));
  const manager = await signInPin(counter, STAFF.manager);
  return { manager, cashier, bills, counter };
}

/** Each money command by `who`: 200, a request raised as the kind's own, nothing applied; the stored rights. */
async function expectRequestPath(who: Who, bills: string[]): Promise<Array<{ kind: MoneyKind; holders: Permission; raised: Raised }>> {
  const out: Array<{ kind: MoneyKind; holders: Permission; raised: Raised }> = [];
  for (const c of moneyCases(bills)) {
    const before = lastSeq();
    const appliedBefore = count(c.applied);
    const r = await c.send(who);
    expect(r.status, `${c.kind}: ${JSON.stringify(r.error)}`).toBe(200);
    expect(count(c.applied), `${c.kind}: applied directly`).toBe(appliedBefore);
    const raised = raisedSince(before, who.staffId);
    expect(raised.map((x) => [x.kind, x.state]), c.kind).toEqual([[c.kind, 'open']]);
    out.push({ kind: c.kind, holders: c.holders, raised: raised[0]! });
  }
  return out;
}

describe('[05a §3.3a, §3.9 rule 1] a Manager on an `everyone` kiosk: every MONEY_PERMISSIONS command takes the request path', () => {
  it('[05a #17, #19, G-h (a)] the Manager\'s listed phone is connected now (their own session on it, live socket) → each request is `named` to the Manager ("Confirm on your phone")', async () => {
    const { manager, bills } = await moneyWorld();
    const handset = await phone('Manager phone', [STAFF.manager]);
    await connect(await signInPin(handset, STAFF.manager));
    for (const { kind, raised } of await expectRequestPath(manager, bills)) {
      expect.soft(raised.request, kind).toMatchObject({ right_mode: 'named', receiver_staff_id: STAFF.manager });
    }
  });

  it('[05a #17a, #18, #19, N-3] the Manager\'s listed phone is not connected (signed in, no socket) → each request is `holders` of the kind\'s range, else base permission', async () => {
    const { manager, bills } = await moneyWorld();
    const handset = await phone('Manager phone', [STAFF.manager]);
    await signInPin(handset, STAFF.manager); // a session in the table, but no live socket: not "connected now"
    for (const { kind, holders, raised } of await expectRequestPath(manager, bills)) {
      expect.soft(raised.request, kind).toMatchObject({ right_mode: 'holders', base_permission: holders, receiver_staff_id: null });
    }
  });

  it('[05a #18, #19] the Manager has no listed device → each request is `holders`', async () => {
    const { manager, bills } = await moneyWorld();
    for (const { kind, holders, raised } of await expectRequestPath(manager, bills)) {
      expect.soft(raised.request, kind).toMatchObject({ right_mode: 'holders', base_permission: holders, receiver_staff_id: null });
    }
  });

  it('[05a §3.9 rule 1 (a), G-h route-level] a connected listed tablet that lists the Manager but has only the Owner signed in does not count → `holders`', async () => {
    const { manager, bills } = await moneyWorld();
    const office = await tablet('Office tablet', listed([STAFF.manager, OWNER]));
    await connect(await signInPin(office, OWNER));
    for (const { kind, holders, raised } of await expectRequestPath(manager, bills)) {
      expect.soft(raised.request, kind).toMatchObject({ right_mode: 'holders', base_permission: holders, receiver_staff_id: null });
    }
  });

  it('[05a §3.3a table, §3.9] the same Manager on their LISTED phone does each money action directly (nothing masked, no request)', async () => {
    const { bills } = await moneyWorld();
    const handset = await phone('Manager phone', [STAFF.manager]);
    const manager = await signInPin(handset, STAFF.manager);
    for (const c of moneyCases(bills)) {
      const before = lastSeq();
      const r = await c.send(manager);
      expect(r.status, `${c.kind}: ${JSON.stringify(r.error)}`).toBe(200);
      expect(typesOf(r), c.kind).toContain(c.applied);
      expect(raisedSince(before, STAFF.manager), c.kind).toEqual([]);
    }
  });

  it('[05a §3.3 counter check] a Cashier\'s void and discount requests on the `everyone` kiosk are raised as today (approval, the Manager role)', async () => {
    const { cashier, bills } = await moneyWorld(0);
    for (const c of moneyCases(bills).filter((x) => x.kind === 'void_approval' || x.kind === 'discount')) {
      const before = lastSeq();
      const r = await c.send(cashier);
      expect(r.status, `${c.kind}: ${JSON.stringify(r.error)}`).toBe(200);
      const raised = raisedSince(before, STAFF.cashier);
      expect(raised.map((x) => x.kind), c.kind).toEqual([c.kind]);
      expect(raised[0]!.request, c.kind).toMatchObject({ right_mode: 'approval', approver_role_ids: ['R_MGR'] });
    }
  });
});

// ================================================================================================= listed-only: 403

describe('[05a §3.3a, §9, N-6] every LISTED_ONLY_PERMISSIONS command / route from the `everyone` kiosk → 403', () => {
  const cmd = (who: Who, path: string, command_type: string, payload: Record<string, unknown>) => post(hub, who, path, command_type, payload);

  /** The staff-route sites, one per listed-only permission that a staff session reaches. */
  async function sites(who: Who, o: { otherDevice: string; voidAlert: string }) {
    return {
      // pipeline (`authorize`, route.ts): reason listed_device_only
      'manage-devices': await cmd(who, 'revoke-device', 'RevokeDevice', { device_id: o.otherDevice }),
      'manage-staff': await cmd(who, 'set-presence', 'SetPresence', { staff_ids: [STAFF.cashier], present: true }),
      'manage-roles': await cmd(who, 'test-both', 'TestBoth', {}),
      // AnswerRequest preRead (§3.9 rule 2): a money answer → reason listed_device_only
      'approve-void': await cmd(who, 'answer-request', 'AnswerRequest', { alert_id: o.voidAlert, decision: 'approve', method: 'pin', pin: PIN_OF[who.staffId] }),
      // handler-owned sites (N-6): their own details, no reason
      'view-audit-log': await get(who, `/queries/audit-log?from=${hub.clock.branchNow() - 60_000}&to=${hub.clock.branchNow()}`),
      'manage-devices (alert-receipts)': await get(who, '/queries/alert-receipts?alert_id=NO_SUCH_ALERT'),
    };
  }

  const adminAuth = (d: Device, staffId: string) =>
    hub.app.inject({ method: 'POST', url: '/admin/auth', headers: { authorization: `Bearer ${d.token}` }, payload: { staff_id: staffId, pin: PIN_OF[staffId] } });

  async function listedOnlyWorld(): Promise<{ counter: Device; owner: Who; other: Device; voidAlert: string }> {
    await start();
    const counter = await kiosk('Counter 1');
    const other = await kiosk('Counter 2');
    // a Cashier's void request (approval: approve-void range), for the approve-void site
    const cashier = await signInPin(other, STAFF.cashier);
    const s = stagedOrder(hub, { prefix: 'LO' });
    const v = ok(
      await post(hub, cashier, 'void-items', 'VoidItems', {
        order_id: s.order_id,
        reason_code: 'customer_changed_mind',
        note: null,
        disposition_note: null,
        lines: [{ order_item_id: s.cooking, disposition: 'wastage' }],
      }),
    );
    const voidAlert = (v.result as { pending: Array<{ alert_id: string }> }).pending[0]!.alert_id;
    // the Owner holds every permission `allowed`: on the kiosk only the mask can refuse them
    const owner = await signInPin(counter, OWNER);
    return { counter, owner, other, voidAlert };
  }

  it('[05a #4, #4a, #4c, #4f, N-6] the Owner (every permission allowed) on the `everyone` kiosk: pipeline and AnswerRequest sites → 403 listed_device_only; handler-owned sites → 403 with their own details', async () => {
    const { counter, owner, other, voidAlert } = await listedOnlyWorld();
    const events = lastSeq();
    const r = await sites(owner, { otherDevice: other.deviceId, voidAlert });

    for (const [permission, reply] of [
      ['manage-devices', r['manage-devices']],
      ['manage-staff', r['manage-staff']],
      ['manage-roles', r['manage-roles']],
    ] as const) {
      expect(reply.status, permission).toBe(403);
      expect(reply.error, permission).toEqual({ code: 'PERMISSION_DENIED', details: { permission, grant: 'not_granted', reason: 'listed_device_only' } });
    }
    expect(r['approve-void'].status).toBe(403);
    expect(r['approve-void'].error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'listed_device_only' } });

    const audit = r['view-audit-log'];
    expect(audit.statusCode).toBe(403);
    expect(audit.json().error).toEqual(expect.objectContaining({ code: 'PERMISSION_DENIED', details: { permission: 'view-audit-log', grant: 'not_granted' } }));
    const receipts = r['manage-devices (alert-receipts)'];
    expect(receipts.statusCode).toBe(403);
    expect(receipts.json().error).toEqual(expect.objectContaining({ code: 'PERMISSION_DENIED', details: { permission: 'manage-devices', grant: 'not_granted' } }));

    // access-hub-admin (and so the admin-only manage-fiscal-settings / manage-roles routes): /admin/auth refused (§3.5)
    const admin = await adminAuth(counter, OWNER);
    expect(admin.statusCode).toBe(403);
    expect(admin.json().error).toEqual(expect.objectContaining({ code: 'PERMISSION_DENIED', details: { permission: 'access-hub-admin', reason: 'listed_device_only' } }));
    expect(one("SELECT COUNT(*) FROM staff_sessions WHERE kind = 'admin' AND device_id = ?", counter.deviceId)).toBe(0);

    // nothing was written by any refusal; the device was not revoked, the void still open
    expect(lastSeq()).toBe(events);
    expect(one('SELECT revoked_at FROM devices WHERE device_id = ?', other.deviceId)).toBeNull();
    expect(one('SELECT state FROM alerts WHERE alert_id = ?', voidAlert)).toBe('open');

    // the void's real approver (the Manager role) taking the counter over is refused the same, before any PIN
    const managerAtCounter = await signInPin(other, STAFF.manager, { takeover: true });
    const byManager = await cmd(managerAtCounter, 'answer-request', 'AnswerRequest', { alert_id: voidAlert, decision: 'approve', method: 'pin', pin: PIN_OF[STAFF.manager] });
    expect(byManager.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'listed_device_only' } });
    expect(one('SELECT COUNT(*) FROM auth_lockouts')).toBe(0);

    // the session view (§6.7) reports all seven as listed_only on the kiosk
    const perms = (await get(owner, '/queries/session')).json().data.permissions as Record<string, { grant: string; masked?: string }>;
    for (const p of LISTED_ONLY_PERMISSIONS) expect(perms[p], p).toEqual({ grant: 'not_granted', masked: 'listed_only' });
  });

  it('[05a §3.3a table, #5] the same Owner on their LISTED tablet passes every one of those sites; the Manager answers the void on their listed phone', async () => {
    const { other, voidAlert } = await listedOnlyWorld();
    const office = await tablet('Office tablet', listed([OWNER]));
    const owner = await signInPin(office, OWNER);
    const r = await sites(owner, { otherDevice: other.deviceId, voidAlert });
    for (const k of ['manage-devices', 'manage-staff', 'manage-roles'] as const) {
      expect(r[k].status, `${k}: ${JSON.stringify(r[k].error)}`).toBe(200);
    }
    // the void_approval's approvers are the Manager role (approval right): the Owner gets 01d's own not_approver,
    // not the mask; the Manager answers it from their listed phone
    expect(r['approve-void'].error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'not_approver' } });
    const handset = await phone('Manager phone', [STAFF.manager]);
    const manager = await signInPin(handset, STAFF.manager);
    const answered = ok(await cmd(manager, 'answer-request', 'AnswerRequest', { alert_id: voidAlert, decision: 'approve', method: 'pin', pin: PIN_OF[STAFF.manager] }));
    expect(typesOf(answered)).toContain('ItemVoided');
    expect(r['view-audit-log'].statusCode).toBe(200);
    expect(r['manage-devices (alert-receipts)'].json().error?.code).toBe('ALERT_NOT_FOUND');
    expect((await adminAuth(office, OWNER)).statusCode).toBe(200);
  });
});
