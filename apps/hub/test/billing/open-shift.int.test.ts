// 05 §6.15 `OpenShift`, §6.16 `GET /queries/shift`, B11, B23, §3.11 (task 15; 05-plan §3 row 15). Real commands over
// HTTP through the hub's writer and the real `shifts` / `billing` folds (task 8, task 7). Payments, petty cash, counts
// and closes are in-test events built by task 5's builders (AddPayment, RecordPettyCash, CountShift and CloseShift are
// tasks 16, 22, 21): #46 is the open half here; task 21 extends it with the real CountShift response.
import type { EventDraft, PosEvent } from '@pos/events';
import {
  aHandoverCounted,
  aPaymentAdded,
  aPaymentRemoved,
  aPettyCashAdvanced,
  aPettyCashOut,
  aPettyCashSettled,
  aShiftClosed,
  aShiftCounted,
  aShiftCountSkipped,
} from '@pos/events/testing';
import { SnapshotBillingSchema } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { hubBilling } from '../../src/billing/defaults';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { openShiftCommand } from '../../src/billing/commands/open-shift';
import type { CommandCtx } from '../../src/commands/registry';
import { statementCounter } from '../helpers/statement-counter';
import { pairDevice, type TestHub } from '../helpers/test-hub';
import { startVoids } from '../voids/fixtures';
import { billingDirectory, drawerDevice, post, signIn, signInOn, STAFF, startBilling, type Reply, type Who } from './fixtures';

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

const OWNER = 'S_OWNER';

// ------------------------------------------------------------------------------------------------ helpers

function openShift(who: Who, payload: Record<string, unknown>, commandId?: string): Promise<Reply> {
  return post(hub, who, 'open-shift', 'OpenShift', payload, commandId);
}

interface Got<T = ShiftView> {
  status: number;
  data: T;
  text: string;
  error: { code: string; details: Record<string, unknown> } | undefined;
  statements: number;
}

interface Taking {
  mode_id: string;
  mode_name: string;
  payment_class: 'cash' | 'digital';
  in_minor: number | null;
  out_minor: number | null;
  change_minor: number | null;
  payments_count: number;
  by: Array<{ taken_by_name: string | null; in_minor: number | null; payments_count: number }>;
}

interface ShiftView {
  shift_id: string;
  staff_name: string | null;
  state: 'open' | 'closed';
  is_drawer: boolean;
  opened_at: number;
  float_minor: number;
  takings: Taking[];
  petty: Array<{ entry_id: string; kind: string; amount_minor: number; category_name: string | null; paid_to: string | null; advance_staff_name: string | null; settled: boolean }>;
  open_advances_minor: number;
  handovers: Array<{ at: number; counted_minor: number; expected_minor: number; variance_minor: number; by_staff_name: string | null }>;
  counted_minor: number | null;
  expected_minor: number | null;
  variance_minor: number | null;
}

async function getShift(who: Who, qs: Record<string, string> = {}): Promise<Got> {
  const counter = statementCounter(hub.deps.readDb);
  const before = counter.count;
  const url = `/queries/shift${Object.keys(qs).length === 0 ? '' : `?${new URLSearchParams(qs).toString()}`}`;
  const res = await hub.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  const body = res.json() as { data?: ShiftView; error?: { code: string; details: Record<string, unknown> } };
  return { status: res.statusCode, data: body.data as ShiftView, text: res.body, error: body.error === undefined ? undefined : { code: body.error.code, details: body.error.details }, statements: counter.count - before };
}

/** The query handler's own statements: the request minus a probe refused at Zod (auth and session only). */
async function queryStatements(who: Who, qs: Record<string, string>): Promise<number> {
  const probe = await getShift(who, { __zod_fail: '1' });
  expect(probe.status).toBe(400);
  const real = await getShift(who, qs);
  expect(real.status, real.text).toBe(200);
  return real.statements - probe.statements;
}

/**
 * 05 v1.0.10 §6.16, B23, R-51: every number in a view before the count, by path, must be one the blind rule permits:
 * opened_at, float_minor, a digital row's numbers, any payments_count, petty amounts, open_advances_minor, handovers.
 * Returns the paths that are not permitted (a cash sum or expected would land here).
 */
function blindViolations(view: ShiftView): string[] {
  const bad: string[] = [];
  const walk = (value: unknown, path: string[]): void => {
    if (typeof value === 'number') {
      const p = path.join('.');
      const takingIndex = path[0] === 'takings' ? Number(path[1]) : -1;
      const digital = takingIndex >= 0 && view.takings[takingIndex]!.payment_class === 'digital';
      const permitted =
        p === 'opened_at' ||
        p === 'float_minor' ||
        p === 'open_advances_minor' ||
        digital ||
        path[path.length - 1] === 'payments_count' ||
        /^petty\.\d+\.amount_minor$/.test(p) ||
        path[0] === 'handovers';
      if (!permitted) bad.push(`${p}=${value}`);
      return;
    }
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, String(i)]));
    else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
  };
  walk(view, []);
  return bad;
}

type Draft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id'>;

/** A builder's event as a draft, its payload merged with `payload`; stream id = the bill or the shift. */
function d(built: PosEvent, payload: Record<string, unknown> = {}): Draft {
  const merged = { ...(built.payload as Record<string, unknown>), ...payload };
  const stream_id = built.stream_type === 'bill' ? (merged['bill_id'] as string) : ((merged['shift_id'] as string | undefined) ?? built.stream_id);
  return { stream_type: built.stream_type, stream_id, event_type: built.event_type, schema_version: built.schema_version, payload: merged };
}

/** One writer transaction of in-test events (clock +1 s first). */
function append(...drafts: Draft[]): PosEvent[] {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  return hub.deps.writer.run((tx) => tx.append(drafts.map((x) => ({ ...x, occurred_at: now, actor_id: STAFF.cashier, device_id: 'D_FIXTURE' })))).appended;
}

let paymentSeq = 0;
/** A PaymentAdded on `shift_id` (bill stream); returns its draft so a PaymentRemoved can copy it. */
function pay(shift_id: string, o: { mode_id?: string; payment_class?: 'cash' | 'digital'; amount_minor: number; tendered_minor?: number | null; direction?: 'in' | 'out'; taker?: string }): Record<string, unknown> {
  paymentSeq += 1;
  const cash = (o.payment_class ?? 'cash') === 'cash';
  const tendered = o.tendered_minor === undefined ? null : o.tendered_minor;
  const payload = {
    payment_id: `PAY_${paymentSeq}`,
    bill_id: `BILL_${paymentSeq}`,
    split_no: 1,
    mode_id: o.mode_id ?? (cash ? 'cash' : 'card'),
    payment_class: o.payment_class ?? 'cash',
    direction: o.direction ?? 'in',
    amount_minor: o.amount_minor,
    tendered_minor: tendered,
    change_minor: tendered === null ? null : tendered - o.amount_minor,
    has_reference: false,
    taken_by_staff_id: o.taker ?? STAFF.cashier,
    shift_id,
  };
  append(d(aPaymentAdded(), payload));
  return payload;
}

function unpay(p: Record<string, unknown>): void {
  const { payment_id, bill_id, split_no, shift_id, mode_id, payment_class, direction, amount_minor, change_minor, taken_by_staff_id } = p;
  append(d(aPaymentRemoved(), { payment_id, bill_id, split_no, reason_code: 'wrong_mode', has_note: false, shift_id, mode_id, payment_class, direction, amount_minor, change_minor: change_minor ?? 0, taken_by_staff_id }));
}

const shiftRow = (shift_id: string) => hub.deps.db.prepare('SELECT * FROM shifts WHERE shift_id = ?').get(shift_id) as Record<string, unknown> | undefined;
const openShifts = () => hub.deps.db.prepare(`SELECT shift_id, staff_id, drawer_device_id FROM shifts WHERE state = 'open' ORDER BY shift_id`).all() as Array<{ shift_id: string; staff_id: string; drawer_device_id: string | null }>;
const drawerJobs = () =>
  (hub.deps.db.prepare(`SELECT printer_id, payload FROM print_jobs WHERE kind = 'document' ORDER BY created_at, job_id`).all() as Array<{ printer_id: string; payload: string }>).map((j) => ({
    printer_id: j.printer_id,
    doc: (JSON.parse(j.payload) as { doc: unknown }).doc,
  }));

function printer(printer_id: string, o: { archived?: boolean } = {}): void {
  hub.deps.db
    .prepare(`INSERT INTO printers (printer_id, name, connection, address, paper_width_mm, archived_at, updated_at) VALUES (?, ?, 'lan', '192.168.1.50:9100', 80, ?, 1)`)
    .run(printer_id, printer_id, o.archived === true ? 5 : null);
}
function route(scope: 'device' | 'default', ref_id: string, printer_id: string): void {
  hub.deps.db.prepare('INSERT INTO bill_routes (scope, ref_id, printer_id) VALUES (?, ?, ?)').run(scope, ref_id, printer_id);
}

/** The branch config with a Card and an Online mode beside the built-in Cash (same business day). */
function withCardModes(): void {
  const config = branchConfig()!;
  const pk = hubBilling(config);
  const mode = (mode_id: string, name: string, sort_order: number) => ({ mode_id, name, kind: 'card', payment_class: 'digital', reference_required: false, is_active: true, sort_order, authority_codes: [] });
  const billing = SnapshotBillingSchema.parse({ ...pk.settings, payment_modes: [...pk.settings.payment_modes, mode('card', 'Card', 1), mode('online', 'Online', 2)], jurisdiction: pk.jurisdiction, tax_profiles: [] });
  const next = { ...config, billing };
  swapBranchConfig({ config: next, snapshotHash: 'e'.repeat(64), configVersion: next.config_version, snapshotSchemaVersion: 4, appliedAt: hub.clock.branchNow() });
}

/** A takeover on a device (§3.11, README :183): `prev`'s session ends, `staffId` signs in on the same device. */
function takeover(prev: Who, staffId: string): Who {
  hub.deps.db.prepare(`UPDATE staff_sessions SET ended_at = ?, end_reason = 'logout' WHERE session_id = ?`).run(hub.clock.branchNow(), prev.sessionId);
  return signInOn(hub, staffId, { deviceId: prev.deviceId, token: prev.token });
}

/** The cashier signed in on a new cashier kiosk. */
function kioskCashier(staffId: string = STAFF.cashier, name?: string): Who {
  return signInOn(hub, staffId, drawerDevice(hub, name ?? `Drawer ${staffId}`));
}

/** OpenShift's handler statements, the in-handler append (event insert and folds, 00's) left out. */
async function commandStatements(run: () => Promise<Reply>): Promise<{ reply: Reply; statements: number; ran: boolean }> {
  const counter = statementCounter(hub.deps.db);
  const original = openShiftCommand.handle;
  let statements = -1;
  openShiftCommand.handle = (ctx: CommandCtx, payload, cmd) => {
    let inAppend = 0;
    const tx = {
      ...ctx.tx,
      append: (drafts: EventDraft[]) => {
        const at = counter.count;
        try {
          return ctx.tx.append(drafts);
        } finally {
          inAppend += counter.count - at;
        }
      },
    };
    const before = counter.count;
    try {
      return original({ ...ctx, tx }, payload, cmd);
    } finally {
      statements = counter.count - before - inAppend;
    }
  };
  try {
    const reply = await run();
    return { reply, statements, ran: statements >= 0 };
  } finally {
    openShiftCommand.handle = original;
  }
}

// ------------------------------------------------------------------------------------------------ #45 OpenShift

describe('[05 §6.15] OpenShift', () => {
  it('[05 #45] a drawer shift with a float: ShiftOpened on the shift stream, the shifts row open, the drawer kicked on the device route', async () => {
    hub = await startBilling();
    printer('PR_COUNTER');
    const cashier = kioskCashier();
    route('device', cashier.deviceId, 'PR_COUNTER');
    const r = await openShift(cashier, { float_minor: 500_000, as_drawer: true });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const shift_id = r.result!['shift_id'] as string;
    expect(r.events.map((e) => e.event_type)).toEqual(['ShiftOpened']);
    const [opened] = r.events;
    expect(opened!.stream_type).toBe('shift');
    expect(opened!.stream_id).toBe(shift_id);
    expect(opened!.payload).toEqual({
      shift_id,
      staff_id: STAFF.cashier,
      drawer_device_id: cashier.deviceId,
      float_minor: 500_000,
      business_date: hub.deps.state.get().business_day!.business_date,
    });
    const row = shiftRow(shift_id)!;
    expect(r.result).toEqual({ shift_id, opened_at: row['opened_at'] });
    expect(row).toMatchObject({ staff_id: STAFF.cashier, drawer_device_id: cashier.deviceId, state: 'open', float_minor: 500_000, expected_cash_minor: 500_000 });
    expect(drawerJobs()).toEqual([{ printer_id: 'PR_COUNTER', doc: { blocks: [{ drawer: true }] } }]);
  });

  it('[05 #45] float 0 opens with no kick; a shift that is not a drawer has no drawer device and never kicks', async () => {
    hub = await startBilling();
    printer('PR_DEFAULT');
    route('default', '', 'PR_DEFAULT');
    const cashier = kioskCashier();
    const zero = await openShift(cashier, { float_minor: 0, as_drawer: true });
    expect(zero.status, JSON.stringify(zero.error)).toBe(200);
    expect(zero.events[0]!.payload['float_minor']).toBe(0);
    const taker = signIn(hub, STAFF.orderTaker);
    const own = await openShift(taker, { float_minor: 20_000, as_drawer: false });
    expect(own.status, JSON.stringify(own.error)).toBe(200);
    expect(own.events[0]!.payload['drawer_device_id']).toBeNull();
    expect(shiftRow(own.result!['shift_id'] as string)).toMatchObject({ drawer_device_id: null, float_minor: 20_000, expected_cash_minor: 20_000 });
    expect(drawerJobs()).toEqual([]);
  });

  it('[05 #45; R-57] the kick goes only on the device\'s own route: a kiosk with no own route gets no kick (a default printer exists), and the shift still opens', async () => {
    hub = await startBilling();
    printer('PR_DEFAULT');
    route('default', '', 'PR_DEFAULT');
    printer('PR_OLD', { archived: true });
    const first = kioskCashier();
    const none = await openShift(first, { float_minor: 1_000, as_drawer: true });
    expect(none.status, JSON.stringify(none.error)).toBe(200);
    // an own route whose printer is archived: no kick either
    const stale = kioskCashier(STAFF.manager);
    route('device', stale.deviceId, 'PR_OLD');
    const archived = await openShift(stale, { float_minor: 1_000, as_drawer: true });
    expect(archived.status, JSON.stringify(archived.error)).toBe(200);
    expect(drawerJobs()).toEqual([]);
    printer('PR_OWN');
    const owner = kioskCashier(OWNER);
    route('device', owner.deviceId, 'PR_OWN');
    const kicked = await openShift(owner, { float_minor: 1_000, as_drawer: true });
    expect(kicked.status, JSON.stringify(kicked.error)).toBe(200);
    expect(drawerJobs()).toEqual([{ printer_id: 'PR_OWN', doc: { blocks: [{ drawer: true }] } }]);
  });

  it('[05 #45] a second open shift for one person → 409 SHIFT_ALREADY_OPEN { shift_id }; nothing written', async () => {
    hub = await startBilling();
    const cashier = kioskCashier();
    const first = await openShift(cashier, { float_minor: 0, as_drawer: true });
    expect(first.status).toBe(200);
    const elsewhere = signIn(hub, STAFF.cashier);
    for (const [who, as_drawer] of [[cashier, true], [elsewhere, false], [elsewhere, true]] as const) {
      const again = await openShift(who, { float_minor: 0, as_drawer });
      expect(again.status).toBe(409);
      expect(again.error).toEqual({ code: 'SHIFT_ALREADY_OPEN', details: { shift_id: first.result!['shift_id'] } });
    }
    expect(openShifts()).toHaveLength(1);
  });

  it('[05 #45] a drawer held by another open shift → 409 DRAWER_IN_USE { shift_id, staff_name }; the person may still open a shift that is not a drawer', async () => {
    hub = await startBilling();
    const device = drawerDevice(hub);
    const cashier = signInOn(hub, STAFF.cashier, device);
    const held = await openShift(cashier, { float_minor: 0, as_drawer: true });
    expect(held.status).toBe(200);
    const manager = takeover(cashier, STAFF.manager);
    const taken = await openShift(manager, { float_minor: 0, as_drawer: true });
    expect(taken.status).toBe(409);
    expect(taken.error).toEqual({ code: 'DRAWER_IN_USE', details: { shift_id: held.result!['shift_id'], staff_name: 'Cashier' } });
    // a takeover on the kiosk (§3.11): the manager's own shift, no drawer
    const own = await openShift(manager, { float_minor: 0, as_drawer: false });
    expect(own.status, JSON.stringify(own.error)).toBe(200);
    const rows = new Map(openShifts().map((s) => [s.staff_id, s.drawer_device_id]));
    expect(Object.fromEntries(rows)).toEqual({ [STAFF.cashier]: device.deviceId, [STAFF.manager]: null });
  });

  it('[05 #45] as_drawer on a device that cannot hold a drawer → 422 DRAWER_DEVICE_INVALID { device_id }: a phone, a tablet without a printer route, a tablet whose route printer is archived', async () => {
    hub = await startBilling();
    printer('PR_DEFAULT');
    route('default', '', 'PR_DEFAULT'); // the default route is not the tablet's own
    printer('PR_OLD', { archived: true });
    const phone = signInOn(hub, STAFF.cashier, pairDevice(hub, { type: 'phone', ownerStaffId: STAFF.cashier }));
    const tablet = signIn(hub, STAFF.manager);
    const stale = signIn(hub, OWNER);
    route('device', stale.deviceId, 'PR_OLD');
    for (const who of [phone, tablet, stale]) {
      const r = await openShift(who, { float_minor: 0, as_drawer: true });
      expect(r.status).toBe(422);
      expect(r.error).toEqual({ code: 'DRAWER_DEVICE_INVALID', details: { device_id: who.deviceId } });
    }
    expect(openShifts()).toEqual([]);
  });

  it('[05 #45] a tablet with an active printer route holds a drawer; the kick goes to its route', async () => {
    hub = await startBilling();
    printer('PR_TAB');
    const tablet = signIn(hub, STAFF.manager);
    route('device', tablet.deviceId, 'PR_TAB');
    const r = await openShift(tablet, { float_minor: 10_000, as_drawer: true });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.events[0]!.payload['drawer_device_id']).toBe(tablet.deviceId);
    expect(drawerJobs()).toEqual([{ printer_id: 'PR_TAB', doc: { blocks: [{ drawer: true }] } }]);
  });

  it('[05 #45] no business day open → 409 BUSINESS_DAY_NOT_OPEN, before the shift and drawer checks', async () => {
    hub = await startBilling({ open: false });
    const phone = signInOn(hub, STAFF.cashier, pairDevice(hub, { type: 'phone', ownerStaffId: STAFF.cashier }));
    const r = await openShift(phone, { float_minor: 0, as_drawer: true });
    expect(r.status).toBe(409);
    expect(r.error?.code).toBe('BUSINESS_DAY_NOT_OPEN');
    expect(openShifts()).toEqual([]);
  });

  it('[05 #45] Zod: float_minor an integer 0 … 10¹², as_drawer a boolean, no other key → 400 VALIDATION_FAILED', async () => {
    hub = await startBilling();
    const cashier = kioskCashier();
    for (const payload of [
      { float_minor: -1, as_drawer: true },
      { float_minor: 1_000_000_000_001, as_drawer: true },
      { float_minor: 1.5, as_drawer: true },
      { float_minor: '100', as_drawer: true },
      { float_minor: 100 },
      { as_drawer: true },
      { float_minor: 100, as_drawer: 'yes' },
      { float_minor: 100, as_drawer: true, staff_id: STAFF.manager },
    ]) {
      const r = await openShift(cashier, payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
      expect(r.error?.code).toBe('VALIDATION_FAILED');
    }
    const max = await openShift(cashier, { float_minor: 1_000_000_000_000, as_drawer: true });
    expect(max.status, JSON.stringify(max.error)).toBe(200);
  });

  it('[05 #45] without manage-own-shift → 403 PERMISSION_DENIED before any check', async () => {
    const directory = await billingDirectory();
    hub = await startVoids({
      open: false,
      directory: { ...directory, staff: directory.staff.map((s) => (s.staff_id === STAFF.orderTaker ? { ...s, denied_permissions: ['manage-own-shift'] } : s)) },
    });
    const taker = signIn(hub, STAFF.orderTaker);
    // day not open, tablet without route: the grant wins, and the handler never runs (0 statements of its own)
    const { reply: r, ran } = await commandStatements(() => openShift(taker, { float_minor: 0, as_drawer: true }));
    expect(r.status).toBe(403);
    expect(r.error?.code).toBe('PERMISSION_DENIED');
    expect(ran).toBe(false);
  });

  it('[05 #45 race] two OpenShift by one person at once → one shift, the other 409 SHIFT_ALREADY_OPEN; a second open drawer row is refused by shifts_open_drawer', async () => {
    hub = await startBilling();
    const cashier = kioskCashier();
    const [a, b] = await Promise.all([
      openShift(cashier, { float_minor: 1_000, as_drawer: true }, 'race-own-a'),
      openShift(cashier, { float_minor: 2_000, as_drawer: false }, 'race-own-b'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const won = a.status === 200 ? a : b;
    const lost = a.status === 200 ? b : a;
    expect(lost.error).toEqual({ code: 'SHIFT_ALREADY_OPEN', details: { shift_id: won.result!['shift_id'] } });
    expect(openShifts()).toHaveLength(1);

    // one drawer, two open shifts: the writer's checks refuse it above; the 0023 index refuses it even if they did not
    const device = drawerDevice(hub, 'Shared drawer');
    const manager = signInOn(hub, STAFF.manager, device);
    const m = await openShift(manager, { float_minor: 0, as_drawer: true });
    expect(m.status, JSON.stringify(m.error)).toBe(200);
    const second = { stream_type: 'shift' as const, stream_id: 'SH_DUP', event_type: 'ShiftOpened', schema_version: 1, payload: { shift_id: 'SH_DUP', staff_id: OWNER, drawer_device_id: device.deviceId, float_minor: 0, business_date: hub.deps.state.get().business_day!.business_date } };
    expect(() => append(second)).toThrow(/UNIQUE constraint failed: shifts.drawer_device_id/);
    expect(openShifts().filter((s) => s.drawer_device_id === device.deviceId).map((s) => s.staff_id)).toEqual([STAFF.manager]);
  });

  it('[05 #45 race] a retransmit with the same command_id replays the first answer; one shift, one ShiftOpened, one kick', async () => {
    hub = await startBilling();
    printer('PR_COUNTER');
    const cashier = kioskCashier();
    route('device', cashier.deviceId, 'PR_COUNTER');
    const [a, b] = await Promise.all([
      openShift(cashier, { float_minor: 3_000, as_drawer: true }, 'retry-1'),
      openShift(cashier, { float_minor: 3_000, as_drawer: true }, 'retry-1'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.result).toEqual(a.result);
    const again = await openShift(cashier, { float_minor: 3_000, as_drawer: true }, 'retry-1');
    expect(again.result).toEqual(a.result);
    expect(openShifts()).toHaveLength(1);
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'ShiftOpened'`).pluck().get()).toBe(1);
    expect(drawerJobs()).toHaveLength(1);
  });

  it('[05 §6.15 Statements] ≤ 5, the same with 1 and with 40 shifts and payments in the store: 1 read (the device\'s own route included, R-57), then printDocument (2) for a kick', async () => {
    hub = await startBilling();
    printer('PR_COUNTER');
    const counts: number[] = [];
    for (const n of [1, 40]) {
      // n closed shifts of other people's past, each with a payment, a petty row and a handover
      for (let i = 0; i < n; i += 1) {
        const shift_id = `PAST_${n}_${i}`;
        append({ stream_type: 'shift', stream_id: shift_id, event_type: 'ShiftOpened', schema_version: 1, payload: { shift_id, staff_id: `S_PAST_${n}_${i}`, drawer_device_id: null, float_minor: 0, business_date: hub.deps.state.get().business_day!.business_date } });
        pay(shift_id, { amount_minor: 1_000 });
        append(d(aShiftClosed(), { shift_id }));
      }
      const staff = n === 1 ? STAFF.cashier : STAFF.manager;
      const who = kioskCashier(staff, `Kiosk ${n}`);
      route('device', who.deviceId, 'PR_COUNTER');
      const { reply, statements } = await commandStatements(() => openShift(who, { float_minor: 5_000, as_drawer: true }));
      expect(reply.status, JSON.stringify(reply.error)).toBe(200);
      counts.push(statements);
    }
    expect(counts[0]).toBeLessThanOrEqual(5);
    expect(counts).toEqual([3, 3]);
    // no kick: the read only
    const taker = signIn(hub, STAFF.orderTaker);
    const { reply, statements } = await commandStatements(() => openShift(taker, { float_minor: 5_000, as_drawer: false }));
    expect(reply.status).toBe(200);
    expect(statements).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------ #46 shift query (open half)

describe('[05 §6.16] GET /queries/shift (blind rule, B23)', () => {
  /** A cashier's drawer shift with cash (tendered with change, an out), card from two takers, a removed card payment. */
  async function busyDrawer(): Promise<{ cashier: Who; shift_id: string; deviceId: string }> {
    hub = await startBilling();
    withCardModes();
    const device = drawerDevice(hub);
    const cashier = signInOn(hub, STAFF.cashier, device);
    const r = await openShift(cashier, { float_minor: 500_000, as_drawer: true });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const shift_id = r.result!['shift_id'] as string;
    pay(shift_id, { amount_minor: 123_450, tendered_minor: 130_000 });
    pay(shift_id, { amount_minor: 77_700, taker: STAFF.manager });
    pay(shift_id, { amount_minor: 1_111, direction: 'out' });
    pay(shift_id, { payment_class: 'digital', amount_minor: 40_000 });
    pay(shift_id, { payment_class: 'digital', amount_minor: 25_000, taker: STAFF.manager });
    const removed = pay(shift_id, { payment_class: 'digital', mode_id: 'online', amount_minor: 9_999 });
    unpay(removed);
    unpay(pay(shift_id, { amount_minor: 5_000 })); // a removed cash payment: not in payments_count (R-51)
    return { cashier, shift_id, deviceId: device.deviceId };
  }

  it('[05 #46 open half] before ShiftCounted: no expected, no variance, no cash sum anywhere in the response; card takings shown by taker; modes in settings order; an all-zero row is skipped', async () => {
    const { cashier, shift_id } = await busyDrawer();
    const expectedCash = shiftRow(shift_id)!['expected_cash_minor'] as number;
    expect(expectedCash).toBe(500_000 + 123_450 + 77_700 - 1_111);
    const r = await getShift(cashier);
    expect(r.status, r.text).toBe(200);
    const v = r.data;
    expect(v).toMatchObject({ shift_id, staff_name: 'Cashier', state: 'open', is_drawer: true, float_minor: 500_000, counted_minor: null, expected_minor: null, variance_minor: null });
    expect(v.opened_at).toBe(shiftRow(shift_id)!['opened_at']);
    expect(v.takings).toEqual([
      // R-51: the cash row before the count: the number of live payments, never a sum (the removed cash payment not counted)
      { mode_id: 'cash', mode_name: 'Cash', payment_class: 'cash', in_minor: null, out_minor: null, change_minor: null, payments_count: 3, by: [{ taken_by_name: 'Cashier', in_minor: null, payments_count: 2 }, { taken_by_name: 'Manager', in_minor: null, payments_count: 1 }] },
      { mode_id: 'card', mode_name: 'Card', payment_class: 'digital', in_minor: 65_000, out_minor: 0, change_minor: 0, payments_count: 2, by: [{ taken_by_name: 'Cashier', in_minor: 40_000, payments_count: 1 }, { taken_by_name: 'Manager', in_minor: 25_000, payments_count: 1 }] },
    ]);
    // 05 v1.0.10 §6.16, R-51: every number in the view is on a permitted path
    expect(blindViolations(v)).toEqual([]);
    // and no number of the cash side appears anywhere in the body: expected, the cash in / out / change sums, a taker's cash sum
    for (const hidden of [expectedCash, 123_450 + 77_700, 123_450, 77_700, 1_111, 130_000 - 123_450, expectedCash - 500_000]) {
      expect(r.text.includes(String(hidden)), String(hidden)).toBe(false);
    }
    // by shift_id: the same view
    expect((await getShift(cashier, { shift_id })).data).toEqual(v);
  });

  it('[05 #46 open half] after ShiftCounted + ShiftClosed (CountShift, task 21): expected, variance, count and the cash sums are shown; the drawer is free and the next OpenShift { as_drawer } on that kiosk succeeds at once', async () => {
    const { cashier, shift_id, deviceId } = await busyDrawer();
    const expectedCash = shiftRow(shift_id)!['expected_cash_minor'] as number;
    append(
      // the count's own expected (counted − variance) differs from the running fold by 7: the view must show the count's
      d(aShiftCounted(), { shift_id, counted_minor: expectedCash + 7 - 500, expected_minor: expectedCash + 7, variance_minor: -500, by_staff_id: STAFF.cashier, variance_alert_id: null }),
      d(aShiftClosed(), { shift_id, closed_by: STAFF.cashier }),
    );
    expect(shiftRow(shift_id)!['expected_cash_minor']).toBe(expectedCash);
    const r = await getShift(cashier, { shift_id });
    expect(r.status, r.text).toBe(200);
    // 05 v1.0.10 §6.16: expected after the count = counted − variance (the ShiftCounted figures), never expected_cash_minor
    expect(r.data).toMatchObject({ state: 'closed', counted_minor: expectedCash + 7 - 500, expected_minor: expectedCash + 7, variance_minor: -500 });
    expect(r.data.takings.find((t) => t.mode_id === 'cash')).toEqual({
      mode_id: 'cash',
      mode_name: 'Cash',
      payment_class: 'cash',
      in_minor: 123_450 + 77_700,
      out_minor: 1_111,
      change_minor: 130_000 - 123_450,
      payments_count: 3,
      by: [{ taken_by_name: 'Cashier', in_minor: 123_450, payments_count: 2 }, { taken_by_name: 'Manager', in_minor: 77_700, payments_count: 1 }],
    });
    // the drawer is free at once (B23, Q-2)
    const next = takeover(cashier, STAFF.manager);
    const reopened = await openShift(next, { float_minor: 0, as_drawer: true });
    expect(reopened.status, JSON.stringify(reopened.error)).toBe(200);
    expect(reopened.events[0]!.payload['drawer_device_id']).toBe(deviceId);
    expect(deviceId).toBe(next.deviceId);
    // the cashier opens a new shift elsewhere, and no shift_id now means the new open one
    const again = signIn(hub, STAFF.cashier);
    const own = await openShift(again, { float_minor: 0, as_drawer: false });
    expect(own.status, JSON.stringify(own.error)).toBe(200);
    expect((await getShift(again)).data.shift_id).toBe(own.result!['shift_id']);
  });

  it('[05 #46 open half] a closed shift whose count was skipped keeps expected and the cash sums hidden (no counted_at)', async () => {
    const { cashier, shift_id } = await busyDrawer();
    append(d(aShiftCountSkipped(), { shift_id }), d(aShiftClosed(), { shift_id, closed_by: OWNER }));
    const r = await getShift(cashier, { shift_id });
    expect(r.status, r.text).toBe(200);
    expect(r.data).toMatchObject({ state: 'closed', counted_minor: null, expected_minor: null, variance_minor: null });
    expect(r.data.takings.find((t) => t.mode_id === 'cash')!.in_minor).toBeNull();
    expect(blindViolations(r.data)).toEqual([]);
  });

  it('[05 v1.0.10 §6.16; R-51; B23] a mode whose class changed mid-shift (a digital payment, then a cash one) is hidden as cash before the count', async () => {
    hub = await startBilling();
    withCardModes();
    const cashier = kioskCashier();
    const opened = await openShift(cashier, { float_minor: 0, as_drawer: true });
    const shift_id = opened.result!['shift_id'] as string;
    // the first payment of the mode is digital (LIMIT 1 would pick it), the second is cash
    pay(shift_id, { mode_id: 'wallet', payment_class: 'digital', amount_minor: 4_321 });
    pay(shift_id, { mode_id: 'wallet', payment_class: 'cash', amount_minor: 8_765 });
    const r = await getShift(cashier, { shift_id });
    expect(r.status, r.text).toBe(200);
    expect(r.data.takings).toEqual([
      { mode_id: 'wallet', mode_name: 'wallet', payment_class: 'cash', in_minor: null, out_minor: null, change_minor: null, payments_count: 2, by: [{ taken_by_name: 'Cashier', in_minor: null, payments_count: 2 }] },
    ]);
    expect(blindViolations(r.data)).toEqual([]);
    for (const hidden of [4_321, 8_765, 4_321 + 8_765]) expect(r.text.includes(String(hidden)), String(hidden)).toBe(false);
  });

  it('[05 §6.16] petty rows (paid_to from bill_texts only, category and advance names, settled), open advances, handovers with their own expected', async () => {
    const { cashier, shift_id } = await busyDrawer();
    append(
      d(aPettyCashOut(), { entry_id: 'PC_OUT', shift_id, amount_minor: 3_000, category_id: 'supplies', has_paid_to: true, advance_staff_id: null }),
      d(aPettyCashAdvanced(), { entry_id: 'PC_ADV1', shift_id, amount_minor: 20_000, category_id: 'staff_advance', has_paid_to: false, advance_staff_id: STAFF.manager }),
      d(aPettyCashAdvanced(), { entry_id: 'PC_ADV2', shift_id, amount_minor: 7_000, category_id: 'staff_advance', has_paid_to: false, advance_staff_id: STAFF.orderTaker }),
    );
    hub.deps.db.prepare(`INSERT INTO bill_texts (subject_id, field, text) VALUES ('PC_OUT', 'paid_to', 'Sabzi wala')`).run();
    append(d(aPettyCashSettled(), { entry_id: 'PC_ADV1', shift_id, spent_minor: 15_000, returned_minor: 5_000 }));
    append(d(aHandoverCounted(), { shift_id, counted_minor: 600_000, expected_minor: 601_000, variance_minor: -1_000, by_staff_id: STAFF.manager }));
    const r = await getShift(cashier);
    expect(r.status, r.text).toBe(200);
    expect(r.data.petty).toEqual([
      { entry_id: 'PC_ADV1', kind: 'advance', amount_minor: 20_000, category_name: 'Staff advance', paid_to: null, advance_staff_name: 'Manager', settled: true },
      { entry_id: 'PC_ADV2', kind: 'advance', amount_minor: 7_000, category_name: 'Staff advance', paid_to: null, advance_staff_name: 'Order taker', settled: false },
      { entry_id: 'PC_OUT', kind: 'out', amount_minor: 3_000, category_name: 'Supplies', paid_to: 'Sabzi wala', advance_staff_name: null, settled: false },
    ]);
    expect(r.data.open_advances_minor).toBe(7_000);
    expect(r.data.handovers).toEqual([{ at: expect.any(Number), counted_minor: 600_000, expected_minor: 601_000, variance_minor: -1_000, by_staff_name: 'Manager' }]);
    expect(r.data.expected_minor).toBeNull();
    expect(blindViolations(r.data)).toEqual([]);
  });

  it('[05 §6.16 permission] manage-own-shift first (403 before any lookup); another person\'s shift needs close-shift-for-others; unknown → 404 SHIFT_NOT_FOUND; none open → 404', async () => {
    const directory = await billingDirectory();
    hub = await startVoids({ directory: { ...directory, staff: directory.staff.map((s) => (s.staff_id === STAFF.orderTaker ? { ...s, denied_permissions: ['manage-own-shift'] } : s)) } });
    const cashierKiosk = kioskCashier();
    const opened = await openShift(cashierKiosk, { float_minor: 0, as_drawer: true });
    const shift_id = opened.result!['shift_id'] as string;
    const taker = signIn(hub, STAFF.orderTaker);
    for (const qs of [{}, { shift_id }, { shift_id: 'NO_SUCH' }] as Array<Record<string, string>>) {
      const probe = await getShift(taker, { __zod_fail: '1' });
      const r = await getShift(taker, qs);
      expect(r.status, JSON.stringify(qs)).toBe(403);
      expect(r.error).toEqual({ code: 'PERMISSION_DENIED', details: { permission: 'manage-own-shift', grant: 'denied' } });
      expect(r.statements - probe.statements, 'grant before any read').toBe(0);
    }
    const manager = signIn(hub, STAFF.manager);
    expect((await getShift(manager, { shift_id })).status).toBe(200);
    const none = await getShift(manager);
    expect(none.status).toBe(404);
    expect(none.error).toEqual({ code: 'SHIFT_NOT_FOUND', details: { shift_id: null } });
    const unknown = await getShift(manager, { shift_id: 'NO_SUCH' });
    expect(unknown.status).toBe(404);
    expect(unknown.error).toEqual({ code: 'SHIFT_NOT_FOUND', details: { shift_id: 'NO_SUCH' } });
    // a cashier (no close-shift-for-others) reading the manager's shift
    const mine = await openShift(manager, { float_minor: 0, as_drawer: false });
    const probe = await getShift(cashierKiosk, { __zod_fail: '1' });
    const other = await getShift(cashierKiosk, { shift_id: mine.result!['shift_id'] as string });
    expect(other.status).toBe(403);
    expect(other.error).toEqual({ code: 'PERMISSION_DENIED', details: { permission: 'close-shift-for-others' } });
    // the owner of the shift is known only from its row: the shift read (1), nothing after it
    expect(other.statements - probe.statements).toBe(1);
  });

  it('[05 §6.16 Statements] 4, the same at 1 and at 40 payments, petty rows and handovers', async () => {
    hub = await startBilling();
    const counts: number[] = [];
    for (const n of [1, 40]) {
      const who = kioskCashier(n === 1 ? STAFF.cashier : STAFF.manager, `Kiosk ${n}`);
      const opened = await openShift(who, { float_minor: 1_000, as_drawer: true });
      const shift_id = opened.result!['shift_id'] as string;
      for (let i = 0; i < n; i += 1) {
        pay(shift_id, { amount_minor: 100 + i, tendered_minor: 200 + i, taker: i % 2 === 0 ? STAFF.cashier : STAFF.manager });
        pay(shift_id, { payment_class: 'digital', mode_id: i % 3 === 0 ? 'online' : 'card', amount_minor: 50 + i, taker: i % 2 === 0 ? STAFF.cashier : OWNER });
        append(d(aPettyCashOut(), { entry_id: `PC_${n}_${i}`, shift_id, amount_minor: 10 + i, category_id: 'supplies', has_paid_to: true, advance_staff_id: null }));
        hub.deps.db.prepare(`INSERT INTO bill_texts (subject_id, field, text) VALUES (?, 'paid_to', 'vendor')`).run(`PC_${n}_${i}`);
        append(d(aHandoverCounted(), { shift_id, counted_minor: 1, expected_minor: 1, variance_minor: 0, by_staff_id: STAFF.manager }));
      }
      counts.push(await queryStatements(who, { shift_id }));
      const all = await getShift(who, { shift_id });
      expect(all.data.petty).toHaveLength(n);
      expect(all.data.handovers).toHaveLength(n);
    }
    expect(counts).toEqual([4, 4]);
  });
});
