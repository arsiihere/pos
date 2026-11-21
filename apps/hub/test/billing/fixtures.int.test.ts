// 05 plan §2B.5 row P0.F: the self-test of apps/hub/test/billing/fixtures.ts. Each fixture is built on a fresh hub
// database (every merged migration) and its key facts are read back from the real tables the fixture wrote through
// the writer. No timing asserts. The `billing` projection (task 7) is not used here.
import { computeSplit, PERMISSIONS } from '@pos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { TestHub } from '../helpers/test-hub';
import {
  addedTakeaway,
  answer,
  BX,
  billingDirectory,
  compedLine,
  dealX2,
  dineInTwoRounds,
  drawerDevice,
  FX,
  JURISDICTIONS,
  mergedSeating,
  optionChildOrder,
  parkingTwoDays,
  pendingWeight,
  raiseVoid,
  remakeLine,
  signIn,
  signInOn,
  startBilling,
  STAFF,
} from './fixtures';

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

type Row = Record<string, unknown>;
const rows = (sql: string, ...args: unknown[]): Row[] => hub.deps.db.prepare(sql).all(...args) as Row[];
const lineRows = (order_id: string): Row[] => rows('SELECT * FROM order_lines WHERE order_id = ? ORDER BY order_item_id', order_id);
const lineOf = (order_item_id: string): Row => rows('SELECT * FROM order_lines WHERE order_item_id = ?', order_item_id)[0]!;
const orderOf = (order_id: string): Row => rows('SELECT * FROM orders WHERE order_id = ?', order_id)[0]!;

describe('billing fixtures (05 row P0.F)', () => {
  it('[05 P0.F] directories: the four B-2 default roles from the cloud defaults, 01d sign-in and answer helpers', async () => {
    hub = await startBilling();
    const dir = await billingDirectory();
    expect(dir.roles.map((r) => r.name)).toEqual(['Owner', 'Manager', 'Cashier', 'Order taker']);
    const grants = (name: string) => new Map(dir.roles.find((r) => r.name === name)!.permissions.map((p) => [p.permission, p]));
    // B-2: Owner holds every permission; Manager all but manage-roles, skip-blind-count, manage-fiscal-settings
    expect(grants('Owner').size).toBe(PERMISSIONS.length);
    for (const p of ['manage-roles', 'skip-blind-count', 'manage-fiscal-settings'] as const) expect(grants('Manager').has(p)).toBe(false);
    expect(grants('Manager').get('close-business-day')).toMatchObject({ grant_type: 'allowed' });
    // Cashier: take-payment allowed (branch); apply-discount and reopen-bill need the Manager; Order taker: own_tables
    expect(grants('Cashier').get('take-payment')).toMatchObject({ grant_type: 'allowed', scope: 'branch' });
    expect(grants('Cashier').get('reopen-bill')).toMatchObject({ grant_type: 'requires_approval', approver_role_ids: [BX.managerRole] });
    expect(grants('Order taker').get('take-payment')).toMatchObject({ grant_type: 'allowed', scope: 'own_tables' });
    expect(grants('Order taker').has('close-business-day')).toBe(false);

    // sign-in + answer over 01d: the Order taker asks for a void, the Manager approves with the PIN (apply is "not built" until v7)
    const o = pendingWeight(hub, { prefix: 'DIR' });
    const taker = signIn(hub, STAFF.orderTaker);
    const raised = raiseVoid(hub, { requester: taker, order_id: o.order_id, order_item_id: o.line });
    expect(raised.deduped).toBe(false);
    const rejected = await answer(hub, signIn(hub, STAFF.manager), raised.alert_id, 'reject');
    expect(rejected.status).toBe(200);
    expect(rejected.events.map((e) => e.event_type)).toContain('RequestAnswered');
  });

  it('[05 P0.F] drawer device: a cashier_kiosk with the Cashier signed in on it', async () => {
    hub = await startBilling();
    const device = drawerDevice(hub);
    const kind = rows('SELECT device_type FROM devices WHERE device_id = ?', device.deviceId)[0]!;
    expect(kind.device_type).toBe('cashier_kiosk');
    const cashier = signInOn(hub, STAFF.cashier, device);
    expect(cashier.deviceId).toBe(device.deviceId);
    expect(rows('SELECT staff_id, device_id, ended_at FROM staff_sessions WHERE session_id = ?', cashier.sessionId)).toEqual([
      { staff_id: STAFF.cashier, device_id: device.deviceId, ended_at: null },
    ]);
  });

  it('[05 P0.F] dine-in seating with two rounds: one seating, two orders (the second a follow-up), one table_key', async () => {
    hub = await startBilling();
    const s = dineInTwoRounds(hub);
    const orders = rows('SELECT order_id, order_type, table_key, follow_up FROM orders ORDER BY placed_at, order_id');
    expect(orders).toHaveLength(2);
    expect(orders.map((o) => o.table_key)).toEqual([`dine_in:${s.seating_id}`, `dine_in:${s.seating_id}`]);
    expect(orders.map((o) => o.follow_up)).toEqual([0, 1]);
    expect(orders.map((o) => o.order_id)).toEqual([s.rounds[0].order_id, s.rounds[1].order_id]);
    expect(lineRows(s.rounds[0].order_id).map((l) => l.item_id).sort()).toEqual([FX.naan, FX.piece].sort());
    expect(lineRows(s.rounds[1].order_id).map((l) => l.item_id)).toEqual([FX.naan]);
    expect(rows('SELECT state, primary_table_id FROM seatings WHERE seating_id = ?', s.seating_id)).toEqual([{ state: 'ORDERED', primary_table_id: s.table_id }]);
  });

  it('[05 P0.F] deal x2: header with two parts, units and prices the billing lines read', async () => {
    hub = await startBilling();
    const d = dealX2(hub);
    const header = lineOf(d.deal);
    expect(header).toMatchObject({ line_kind: 'deal', quantity: 2, units: 2, line_total_minor: 240_000, unit_price_minor: 120_000 });
    expect(lineOf(d.karahiPart)).toMatchObject({ line_kind: 'deal_part', parent_order_item_id: d.deal, units: 2, unit_price_minor: 0 });
    expect(lineOf(d.naanPart)).toMatchObject({ line_kind: 'deal_part', parent_order_item_id: d.deal, units: 4, unit_price_minor: 0 });
  });

  it('[05 P0.F] option child: a karahi and its Raita child priced 10 000', async () => {
    hub = await startBilling();
    const o = optionChildOrder(hub);
    expect(lineOf(o.child)).toMatchObject({ line_kind: 'option_child', parent_order_item_id: o.item, line_total_minor: 10_000, unit_price_minor: 10_000 });
    expect(lineOf(o.item)).toMatchObject({ line_kind: 'item', parent_order_item_id: null });
  });

  it('[05 P0.F] comped line: 1 of 3 naans comped through a real LineComped, comp_minor 3 000', async () => {
    hub = await startBilling();
    const c = compedLine(hub);
    expect(lineOf(c.line)).toMatchObject({ units: 3, line_total_minor: 9_000, comped_units: 1, comp_minor: 3_000 });
    expect(rows(`SELECT event_type FROM events WHERE event_type = 'LineComped'`)).toHaveLength(1);
  });

  it('[05 P0.F] pending-weight kg line: quantity, total and unit price are NULL until the weight is set', async () => {
    hub = await startBilling();
    const p = pendingWeight(hub);
    expect(lineOf(p.line)).toMatchObject({ sale_unit: 'g', quantity: null, line_total_minor: null, unit_price_minor: null, units: 1 });
  });

  it('[05 P0.F] return line: a served karahi remade by the Manager; the return line carries return_of and money 0', async () => {
    hub = await startBilling();
    const r = await remakeLine(hub);
    expect(lineOf(r.remake)).toMatchObject({ return_of: r.served, line_total_minor: 0 });
    expect(lineOf(r.served).returned_units).toBeGreaterThan(0);
  });

  it('[05 P0.F] takeaway root + addition: the addition keeps the root token and bill key and says adds_to_order_id', async () => {
    hub = await startBilling();
    const t = addedTakeaway(hub);
    const root = orderOf(t.root.order_id);
    const add = orderOf(t.addition.order_id);
    expect(root.token).toEqual(expect.any(Number));
    expect(add.token).toBe(root.token);
    expect(add.bill_key).toBe(root.bill_key);
    expect(add.bill_key).not.toBeNull();
    const placed = rows(`SELECT json_extract(payload, '$.adds_to_order_id') AS a FROM events WHERE event_type = 'OrderPlaced' AND stream_id = ?`, t.addition.order_id);
    expect(placed).toEqual([{ a: t.root.order_id }]);
  });

  it('[05 P0.F] parking plate on two days: one table_key, two business dates, day 2 open', async () => {
    hub = await startBilling();
    const p = parkingTwoDays(hub);
    const [a, b] = [orderOf(p.day1.order_id), orderOf(p.day2.order_id)];
    expect(a.business_date).toBe(p.day1.business_date);
    expect(b.business_date).toBe(p.day2.business_date);
    expect(p.day2.business_date > p.day1.business_date).toBe(true);
    expect(a.car_number).toBe(b.car_number);
    expect(a.table_key).toBe(b.table_key);
    // the day close leaves the day-1 parking order open (its line is unserved, so the applyDayClosed guard skips it); no OrdersCarriedOver is written here
    expect(a.day_closed_at).toBeNull();
    expect(b.day_closed_at).toBeNull();
    expect(rows(`SELECT COUNT(*) AS n FROM events WHERE event_type = 'BusinessDayClosed'`)).toEqual([{ n: 1 }]);
  });

  it('[05 P0.F] merged seating: T4 + T5, two orders on one seating', async () => {
    hub = await startBilling();
    const m = mergedSeating(hub);
    expect(m.table_ids).toEqual(['T4', 'T5']);
    expect(rows('SELECT table_id FROM seating_tables WHERE seating_id = ? ORDER BY table_id', m.seating_id)).toEqual([{ table_id: 'T4' }, { table_id: 'T5' }]);
    expect(m.order_ids).toHaveLength(2);
  });
});

describe('billing fixtures: jurisdictions (05 row P0.F, reuse of compute.fixtures)', () => {
  const day = '2026-11-19';
  const on = (id: keyof typeof JURISDICTIONS, base_minor: number, payment_class: 'cash' | 'digital' = 'cash') => {
    const j = JURISDICTIONS[id];
    const pay = [{ split_no: 1, payment_class, direction: 'in' as const, amount_minor: 1, tendered_minor: null }];
    const s = computeSplit({
      split_no: 1,
      business_date: day,
      rules: j.rules,
      tax_profiles: j.profiles,
      lines: [{ order_item_id: 'L1', line_kind: 'item', units: 1, unit_price_minor: base_minor, base_minor, discount_minor: 0, tax_profile_id: j.tax_profile_id }],
      service_charge: null,
      payments: pay,
    });
    const t = s.totals[payment_class];
    return { ...t, tax_minor: t.taxes.reduce((sum, x) => sum + x.tax_minor, 0) };
  };

  it('[05 P0.F] none, PK, PK-PB, test-only multi / exponent 0 / exponent 3 are all present', () => {
    expect(Object.keys(JURISDICTIONS)).toEqual(['none', 'PK', 'PK-PB', 'TEST-MULTI', 'TEST-E0', 'TEST-E3']);
    expect(JURISDICTIONS.none.rules.rounding.step_minor).toBeNull();
    expect(JURISDICTIONS.PK.rules.rounding.step_minor).toBe(100);
    expect(JURISDICTIONS['TEST-E0'].rules.currency_exponent).toBe(0);
    expect(JURISDICTIONS['TEST-E3'].rules.currency_exponent).toBe(3);
    expect(JURISDICTIONS['TEST-MULTI'].profiles[0]!.taxes).toHaveLength(2);
  });

  it('[05 P0.F] the none / PK seeds match 01a, PK-PB has no seed, and the PK-PB rows are the PRA 16 % / 5 %', () => {
    expect(JURISDICTIONS.none.seed).toMatchObject({ jurisdiction_id: 'none', rounding_step_minor: null });
    expect(JURISDICTIONS.PK.seed).toMatchObject({ jurisdiction_id: 'PK', rounding_step_minor: 100, currency_code: 'PKR' });
    expect(JURISDICTIONS['PK-PB'].seed).toBeNull();
    expect(on('PK-PB', 571_000, 'cash')).toMatchObject({ tax_minor: 91_360, total_minor: 662_400 });
    expect(on('PK-PB', 571_000, 'digital')).toMatchObject({ tax_minor: 28_550, total_minor: 599_600 });
    expect(on('PK', 571_000, 'digital')).toMatchObject({ tax_minor: 91_360, total_minor: 662_400 });
  });

  it('[05 P0.F] none: no rounding; multi: two taxes; exponent 0 and 3 keep whole minor units', () => {
    expect(on('none', 10_001)).toMatchObject({ tax_minor: 1_600, total_minor: 11_601, rounding_minor: 0 });
    expect(on('TEST-MULTI', 100_000).taxes).toHaveLength(2);
    expect(on('TEST-E0', 1_000)).toMatchObject({ tax_minor: 160, total_minor: 1_160 });
    expect(on('TEST-E3', 10_000)).toMatchObject({ tax_minor: 1_600, total_minor: 11_600 });
  });
});
