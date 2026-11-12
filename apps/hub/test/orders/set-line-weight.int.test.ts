import { lineTotalMinor } from '@pos/domain';
import { stockEffects, type EngineState } from '@pos/engine';
import type { DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { setLineWeightCommand } from '../../src/orders/commands/set-line-weight';
import { orderLines } from '../../src/orders/exports';
import { planComp } from '../../src/orders/ledger';
import { registerLineGuard, resetLineGuard } from '../../src/orders/line-guard';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, openDay, type FixtureLine } from './fixtures';
import { withOptionQuantity } from '../helpers/ledger-refs';

// 02b §6.3 SetLineWeight, §3.6, §3.4 (Weights), §3.14; §11 step 10. Orders are seeded with the shared fixtures and
// every other event (comps, bills) is a real event through the writer.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;

afterEach(async () => {
  resetLineGuard();
  swapBranchConfig(null);
  await hub.close();
});

function grant(permission: string, scope: 'branch' | 'my_floors' | 'own_tables' = 'branch') {
  return { permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope };
}

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, role_id: string, floor_ids: string[] = []) => ({
    staff_id,
    display_name: staff_id,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids,
  });
  const role = (role_id: string, permissions: ReturnType<typeof grant>[]) => ({ role_id, name: role_id, session_idle_ttl_ms: 36_000_000, permissions });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_WEIGH', [grant('set-line-weight')]),
      // test-only: 01b PERMISSION_SCOPES offers `branch` alone for set-line-weight; this grant proves the handler's C8 check.
      role('R_WEIGH_FLOOR', [grant('set-line-weight', 'my_floors')]),
      role('R_TAKER', [grant('take-order')]),
    ],
    staff: [...base.staff, person('S_ALI', 'R_WEIGH'), person('S_ZAIN', 'R_WEIGH_FLOOR', [FX.floor]), person('S_TAKER', 'R_TAKER')],
  };
}

/** A fresh hub: directory, the fixture menu, the day open, the counted copy of SetLineWeight. */
async function start(): Promise<void> {
  hub = await createTestHub();
  // counts below mean "no line guard registered": clear any guard boot registered (v8 registers 04's through registerVoids)
  resetLineGuard();
  await seedDirectory(hub, await directory());
  openDay(hub, { stock: { [FX.stock]: 10_000 } });
  // The real handler under a test-only name, so its own statements are counted (02a SG-3 pattern).
  commandRegistry(hub.app).register(
    defineCommand({
      ...setLineWeightCommand,
      commandType: 'TestSetLineWeightCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        try {
          return setLineWeightCommand.handle(ctx, payload, cmd);
        } finally {
          lastStatements = counter.count - before;
        }
      },
    }),
  );
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
}

// ------------------------------------------------------------------------------------------- seeding

/** Real events through the writer, clock +1 s first; stock effects drafted from folded state, as a command would. */
function append(drafts: Array<Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id' | 'schema_version'>>, actor = 'S_ALI'): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  const env = { occurred_at: now, actor_id: actor, device_id: 'D_SEED' };
  hub.deps.writer.run((tx) => {
    const full = drafts.map((d) => ({ schema_version: 1, ...d, ...env }) as EventDraft);
    tx.append(stockEffects(tx.state as EngineState, full).map((d) => ({ ...env, ...d }) as EventDraft));
  });
}

const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });

function line(id: string) {
  return hub.deps.db.prepare('SELECT * FROM order_lines WHERE order_item_id = ?').get(id) as Record<string, number | string | null>;
}
function lineView(order_id: string, id: string) {
  return orderLines(hub.deps.db, [order_id]).get(order_id)!.find((l) => l.order_item_id === id)!;
}
function eventCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}

/** Seeds a comp as real LineComped events (CompLine is task 16): the ledger's planComp over the live row. */
function comp(order_id: string, id: string, units: number): void {
  const lines = orderLines(hub.deps.db, [order_id]).get(order_id)!;
  const parent = lines.find((l) => l.order_item_id === id)!;
  const kids = lines.filter((l) => l.parent_order_item_id === id);
  const plan = planComp(parent, withOptionQuantity(hub.deps.db, kids), units, { reason_code: 'quality', note: null, requester_staff_id: 'S_ALI', alert_id: null, approver_staff_id: null });
  append(plan.lines.map((p) => on(order_id, 'LineComped', p.payload)));
}

const takeaway = (lines: FixtureLine[]) => appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_ALI', lines }).order_id;

/** A pending fish line whose ItemAdded copy differs from the config (price 300 000 / kg, a 5 000 option charge). */
const MASALA = { option_id: 'O_MASALA', modifier_group_id: 'M_SAUCE', name: 'Masala', price_minor: 5_000, quantity: 1, charge_minor: 5_000 };
const fish = (id = 'W1'): FixtureLine => ({ order_item_id: id, item_id: FX.gram, item: { price_minor: 300_000, options: [MASALA] } });
const copyTotal = (grams: number): number => lineTotalMinor(300_000, grams, 'g') + MASALA.charge_minor;

// ------------------------------------------------------------------------------------------- calls

interface Who {
  staffId: string;
  deviceId: string;
  token: string;
  sessionToken: string;
}

function signIn(staffId: string): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}

interface Stored {
  event_type: string;
  stream_type: string;
  stream_id: string;
  actor_id: string | null;
  device_id: string;
  payload: Record<string, unknown>;
}

interface Reply {
  status: number;
  body: unknown;
  result: Record<string, unknown> | undefined;
  events: Stored[];
  error?: { code: string; details: Record<string, unknown> };
}

let commandSeq = 0;

async function weigh(who: Who, payload: { order_item_id: string; quantity: number }, o: { counted?: boolean; commandId?: string } = {}): Promise<Reply> {
  commandSeq += 1;
  const type = o.counted === true ? 'TestSetLineWeightCounted' : 'SetLineWeight';
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${o.counted === true ? 'test-set-line-weight-counted' : 'set-line-weight'}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: o.commandId ?? `cmd-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: type,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as { data?: { event_ids: string[]; result: Record<string, unknown> }; error?: { code: string; details: Record<string, unknown> } };
  const events =
    body.data === undefined
      ? []
      : (
          hub.deps.db
            .prepare(
              `SELECT event_type, stream_type, stream_id, actor_id, device_id, payload AS payload_json FROM events
                WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`,
            )
            .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Stored, 'payload'> & { payload_json: string }>
        ).map(({ payload_json, ...rest }) => ({ ...rest, payload: JSON.parse(payload_json) as Record<string, unknown> }));
  const error = body.error === undefined ? undefined : { code: body.error.code, details: body.error.details };
  return { status: res.statusCode, body, result: body.data?.result, events, error };
}

// ------------------------------------------------------------------------------------------- #21

describe('SetLineWeight (02b §6.3, §3.6)', () => {
  it('[02b #21] pending → LineWeightSet from the ItemAdded copy (price and options as copied, not the config); billed_minor = the weighed total', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([fish()]);
    expect(line('W1')).toMatchObject({ quantity: null, line_total_minor: null, refundable_minor: 0, units: 1 });

    const r = await weigh(ali, { order_item_id: 'W1', quantity: 1_500 });
    expect(r.status).toBe(200);
    const total = copyTotal(1_500);
    expect(total).not.toBe(lineTotalMinor(400_000, 1_500, 'g') + MASALA.charge_minor); // the config price would differ
    expect(r.result).toEqual({ line_total_minor: total });
    expect(r.events).toEqual([
      { event_type: 'LineWeightSet', stream_type: 'order', stream_id: order_id, actor_id: 'S_ALI', device_id: ali.deviceId, payload: { order_item_id: 'W1', quantity: 1_500, line_total_minor: total } },
    ]);
    expect(line('W1')).toMatchObject({ quantity: 1_500, line_total_minor: total, refundable_minor: total, units: 1 });
    expect(lineView(order_id, 'W1').billed_minor).toBe(total);
  });

  it('[02b #21] a correction is allowed until the bill closes: a second weight replaces the first', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([fish()]);
    expect((await weigh(ali, { order_item_id: 'W1', quantity: 1_500 })).status).toBe(200);
    const r = await weigh(ali, { order_item_id: 'W1', quantity: 2_000 });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ line_total_minor: copyTotal(2_000) });
    expect(r.events.map((e) => e.payload)).toEqual([{ order_item_id: 'W1', quantity: 2_000, line_total_minor: copyTotal(2_000) }]);
    expect(line('W1')).toMatchObject({ quantity: 2_000, line_total_minor: copyTotal(2_000), refundable_minor: copyTotal(2_000) });
    expect(lineView(order_id, 'W1').billed_minor).toBe(copyTotal(2_000));
  });

  it('[02b #21] a non-weighed line → 409 LINE_NOT_WEIGHED, nothing appended', async () => {
    await start();
    const ali = signIn('S_ALI');
    takeaway([{ order_item_id: 'L1', item_id: FX.naan, quantity: 2 }]);
    const before = eventCount();
    const r = await weigh(ali, { order_item_id: 'L1', quantity: 500 });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'LINE_NOT_WEIGHED', details: { order_item_id: 'L1' } });
    expect(eventCount()).toBe(before);
  });

  it('[02b #21] a g line without requires_weighing (quantity fixed at order) → 409 LINE_NOT_WEIGHED, nothing appended', async () => {
    await start();
    const ali = signIn('S_ALI');
    takeaway([{ order_item_id: 'G1', item_id: FX.gram, quantity: 1_000, item: { requires_weighing: false } }]);
    expect(line('G1')).toMatchObject({ sale_unit: 'g', quantity: 1_000 });
    const before = eventCount();
    const r = await weigh(ali, { order_item_id: 'G1', quantity: 1_500 });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'LINE_NOT_WEIGHED', details: { order_item_id: 'G1' } });
    expect(eventCount()).toBe(before);
  });

  it('[02b §3.6] a return line → LINE_NOT_WEIGHED (owner S-1); nothing appended, statements still 1', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([fish()]);
    expect((await weigh(ali, { order_item_id: 'W1', quantity: 1_500 })).status).toBe(200);
    // The return line as a real ItemAdded with return_of (AD-15): the weighed line's copy, weight included.
    const copy = JSON.parse(
      (hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'ItemAdded' AND json_extract(payload, '$.order_item_id') = 'W1'`).get() as { payload: string }).payload,
    ) as Record<string, unknown>;
    append([on(order_id, 'ItemAdded', { ...copy, order_item_id: 'R1', quantity: 1_500, line_total_minor: copyTotal(1_500), return_of: 'W1' })]);
    expect(line('R1')).toMatchObject({ return_of: 'W1', refundable_minor: 0 });
    const before = eventCount();
    const r = await weigh(ali, { order_item_id: 'R1', quantity: 2_000 }, { counted: true });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'LINE_NOT_WEIGHED', details: { order_item_id: 'R1' } });
    expect(lastStatements).toBe(1);
    expect(eventCount()).toBe(before);
    expect(line('R1')).toMatchObject({ refundable_minor: 0 });
  });

  it('[02b #21] ORDER_BILLED on a weight (m-10), nothing appended', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([fish()]);
    expect((await weigh(ali, { order_item_id: 'W1', quantity: 1_000 })).status).toBe(200);
    append([on(order_id, 'OrdersBilled', { order_ids: [order_id], bill_id: 'B1' })]);
    const before = eventCount();
    const r = await weigh(ali, { order_item_id: 'W1', quantity: 1_500 });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'ORDER_BILLED', details: { order_id } });
    expect(eventCount()).toBe(before);
  });

  // ----------------------------------------------------------------------------------------- #19

  it('[02b #19 weight] weigh, comp, then a correction → 409 LINE_ALREADY_SETTLED, nothing appended', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([fish()]);
    expect((await weigh(ali, { order_item_id: 'W1', quantity: 1_500 })).status).toBe(200);
    comp(order_id, 'W1', 1);
    expect(line('W1')).toMatchObject({ comped_units: 1, comp_minor: copyTotal(1_500) });
    const before = eventCount();
    const r = await weigh(ali, { order_item_id: 'W1', quantity: 1_000 });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'LINE_ALREADY_SETTLED', details: { order_item_id: 'W1' } });
    expect(eventCount()).toBe(before);
    expect(line('W1')).toMatchObject({ quantity: 1_500, line_total_minor: copyTotal(1_500), refundable_minor: copyTotal(1_500) });
  });

  // ----------------------------------------------------------------------------------------- §6.3 support

  it('[02b §6.3] statements: 1', async () => {
    await start();
    const ali = signIn('S_ALI');
    takeaway([fish()]);
    expect((await weigh(ali, { order_item_id: 'W1', quantity: 1_500 }, { counted: true })).status).toBe(200);
    expect(lastStatements).toBe(1);
  });

  it('[02b §6.3] D32: the same command_id → the same response, no new event', async () => {
    await start();
    const ali = signIn('S_ALI');
    takeaway([fish()]);
    const first = await weigh(ali, { order_item_id: 'W1', quantity: 1_500 }, { commandId: 'cmd-same' });
    expect(first.status).toBe(200);
    const before = eventCount();
    const again = await weigh(ali, { order_item_id: 'W1', quantity: 1_500 }, { commandId: 'cmd-same' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(before);
  });

  it('[02b §6.3] an unknown line → 404 ORDER_NOT_FOUND, nothing appended', async () => {
    await start();
    const ali = signIn('S_ALI');
    takeaway([fish()]);
    const before = eventCount();
    const r = await weigh(ali, { order_item_id: 'NOPE', quantity: 1_500 });
    expect(r.status).toBe(404);
    expect(r.error).toEqual({ code: 'ORDER_NOT_FOUND', details: { order_item_id: 'NOPE' } });
    expect(eventCount()).toBe(before);
  });

  it('[02b §3.6] quantity in S59 steps of 50, 50–50 000: off-step, below, above → 400 VALIDATION_FAILED; 50 and 50 000 accepted', async () => {
    await start();
    const ali = signIn('S_ALI');
    takeaway([fish('W1'), fish('W2')]);
    const before = eventCount();
    for (const quantity of [0, 25, 75, 1_501, 50_050]) {
      const r = await weigh(ali, { order_item_id: 'W1', quantity });
      expect(r.status).toBe(400);
      expect(r.error?.code).toBe('VALIDATION_FAILED');
      const issues = (r.error?.details as { issues: Array<{ path: string }> }).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((i) => i.path === 'quantity')).toBe(true);
    }
    expect(eventCount()).toBe(before);
    expect((await weigh(ali, { order_item_id: 'W1', quantity: 50 })).result).toEqual({ line_total_minor: copyTotal(50) });
    expect((await weigh(ali, { order_item_id: 'W2', quantity: 50_000 })).result).toEqual({ line_total_minor: copyTotal(50_000) });
  });

  it('[02b §3.14] without set-line-weight → 403 PERMISSION_DENIED', async () => {
    await start();
    takeaway([fish()]);
    const r = await weigh(signIn('S_TAKER'), { order_item_id: 'W1', quantity: 1_500 });
    expect(r.status).toBe(403);
    expect(r.error?.code).toBe('PERMISSION_DENIED');
  });

  it('[02b §3.14] scope branch, checked last (C8): a non-branch grant → 403 outside_scope; on a non-weighed line → LINE_NOT_WEIGHED, not 403', async () => {
    await start();
    const order_id = takeaway([fish(), { order_item_id: 'L1', item_id: FX.naan, quantity: 1 }]);
    const zain = signIn('S_ZAIN');
    const before = eventCount();
    const r = await weigh(zain, { order_item_id: 'W1', quantity: 1_500 });
    expect(r.status).toBe(403);
    expect(r.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', order_id } });
    const first = await weigh(zain, { order_item_id: 'L1', quantity: 1_500 });
    expect(first.status).toBe(409);
    expect(first.error?.code).toBe('LINE_NOT_WEIGHED');
    expect(eventCount()).toBe(before);
  });
});

// ------------------------------------------------------------------------------------------- #43 (04 Q-3)

/** 04 row Q-3 stub line guard: 1 statement per ask; locks `locked` under alert A_VOID; records every ask. */
function lockLines(locked: string[]): Array<{ order_id: string; touched: string[] }> {
  const asks: Array<{ order_id: string; touched: string[] }> = [];
  registerLineGuard((db, order_id, touched_ids) => {
    db.prepare('SELECT 1 AS one').get();
    asks.push({ order_id, touched: [...touched_ids] });
    const hit = touched_ids.find((id) => locked.includes(id));
    return hit === undefined ? null : { alert_id: 'A_VOID', order_item_id: hit };
  });
  return asks;
}

describe('[02b #43] SetLineWeight asks the line guard with the line itself (04 §4.5 Q-3)', () => {
  it('[02b #43] unregistered → 1 statement; registered, not hit → asked with [line], exactly +1 (2)', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([fish('W1'), fish('W2')]);
    expect((await weigh(ali, { order_item_id: 'W1', quantity: 500 }, { counted: true })).status).toBe(200);
    expect(lastStatements).toBe(1);
    const asks = lockLines(['W9']);
    expect((await weigh(ali, { order_item_id: 'W2', quantity: 500 }, { counted: true })).status).toBe(200);
    expect(lastStatements).toBe(2);
    expect(asks).toEqual([{ order_id, touched: ['W2'] }]);
  });

  it('[02b #43] a locked line → 409 VOID_PENDING, nothing written; after LINE_ALREADY_SETTLED, before scope', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([fish('W1')]);
    lockLines(['W1']);
    const n = eventCount();
    const r = await weigh(ali, { order_item_id: 'W1', quantity: 500 }, { counted: true });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'VOID_PENDING', details: { alert_id: 'A_VOID', order_item_id: 'W1' } });
    expect(lastStatements).toBe(2);
    expect(eventCount()).toBe(n);
    expect((await weigh(signIn('S_ZAIN'), { order_item_id: 'W1', quantity: 500 })).error?.code).toBe('VOID_PENDING');

    // settled first: LINE_ALREADY_SETTLED wins over the guard (its own 409 runs before the ask)
    resetLineGuard();
    expect((await weigh(ali, { order_item_id: 'W1', quantity: 500 })).status).toBe(200);
    comp(order_id, 'W1', 1);
    lockLines(['W1']);
    expect((await weigh(ali, { order_item_id: 'W1', quantity: 550 })).error?.code).toBe('LINE_ALREADY_SETTLED');
  });
});
