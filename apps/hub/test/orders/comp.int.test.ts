import { stockEffects, type EngineState } from '@pos/engine';
import type { BranchConfig, DirectoryInput, EventDraft } from '@pos/events';
import { aBusinessDayClosed } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { kindOf, type AlertApplyCtx } from '../../src/alerts/kinds';
import { alerts } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import { defineCommand, type CommandCtx } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { readOnlyTx } from '../../src/engine-host/read-only-tx';
import { compLineCommand } from '../../src/orders/commands/comp-line';
import { orderLines } from '../../src/orders/exports';
import { lineShares, planVoid } from '../../src/orders/ledger';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory, PIN } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, fixtureMenu, openDay, openSeating, type FixtureLine } from './fixtures';

// 02b §6.8 CompLine, §6.12 kind `comp`, §3.9, §3.4 (comp, deal actions, cascades), §3.14; §11 step 14. Orders are seeded
// with the shared fixtures; every other event (voids, remakes, bills) is a real event through the writer. The stale
// close after a remove (#27) runs the real RemoveItems; the approval path runs 01d's real AnswerRequest with a PIN.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

type Scope = 'branch' | 'my_floors' | 'own_tables';
function grant(permission: string, scope: Scope = 'branch') {
  return { permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [] as string[], scope };
}
function ask(permission: string, approver: string) {
  return { permission, grant_type: 'requires_approval' as const, approver_role_id: approver, approver_role_ids: [approver], scope: 'branch' as const };
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
  const role = (role_id: string, permissions: Array<ReturnType<typeof grant> | ReturnType<typeof ask>>) => ({ role_id, name: role_id, session_idle_ttl_ms: 36_000_000, permissions });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_COMP', [grant('apply-comp'), grant('take-order')]),
      role('R_ASK', [ask('apply-comp', 'R_MGR'), grant('take-order')]),
      // test-only: 01b PERMISSION_SCOPES offers `branch` for apply-comp; this grant proves the handler's C8 check.
      role('R_COMP_FLOOR', [grant('apply-comp', 'my_floors')]),
    ],
    staff: [...base.staff, person('S_ALI', 'R_COMP'), person('S_SARA', 'R_COMP'), person('S_OMAR', 'R_ASK'), person('S_ZAIN', 'R_COMP_FLOOR', [FX.floor])],
  };
}

/** A fresh hub: directory, the menu applied, the day open (K1 stock 10 000), the counted copy of CompLine. */
async function start(o: { menu?: BranchConfig } = {}): Promise<void> {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  openDay(hub, { stock: { [FX.stock]: 10_000 }, ...(o.menu === undefined ? {} : { menu: o.menu }) });
  // The real handler under a test-only name, so its own statements are counted (02a SG-3 pattern).
  commandRegistry(hub.app).register(
    defineCommand({
      ...compLineCommand,
      commandType: 'TestCompLineCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        try {
          return compLineCommand.handle(ctx, payload, cmd);
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
const served = (order_id: string, ids: string[]) => on(order_id, 'ItemServed', { order_item_ids: ids, source: 'tap' });

function line(id: string) {
  return hub.deps.db.prepare('SELECT * FROM order_lines WHERE order_item_id = ?').get(id) as Record<string, number | string | null>;
}
function lineView(order_id: string, id: string) {
  return orderLines(hub.deps.db, [order_id]).get(order_id)!.find((l) => l.order_item_id === id)!;
}
function eventCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}
function alertRow(id: string) {
  return hub.deps.db.prepare('SELECT kind, state, close_reason, requester_staff_id FROM alerts WHERE alert_id = ?').get(id) as Record<string, string | null>;
}
function compEvents(): Array<Record<string, unknown>> {
  return (hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'LineComped' ORDER BY seq`).all() as Array<{ payload: string }>).map(
    (r) => JSON.parse(r.payload) as Record<string, unknown>,
  );
}

/** 01d closeMany's own statements for closing `alert_id` obsolete, counted in a writer transaction that is rolled back. */
function closeManyStatements(alert_id: string): number {
  let n = -1;
  try {
    hub.deps.writer.run((tx) => {
      counter.reset();
      alerts.closeMany(ctxOf(tx), [{ alert_id, reason: 'obsolete', note: 'measure' }]);
      n = counter.count;
      throw new Error('rollback');
    });
  } catch (e) {
    if ((e as Error).message !== 'rollback') throw e;
  }
  return n;
}

/** Seeds an 04 void as real ItemVoided events (fixture ItemVoided from the ledger's planVoid / lineShares). */
function voidUnits(order_id: string, id: string, units: number): void {
  const lines = orderLines(hub.deps.db, [order_id]).get(order_id)!;
  const parent = lines.find((l) => l.order_item_id === id)!;
  const kids = lines.filter((l) => l.parent_order_item_id === id);
  const plan = planVoid(parent, kids, units);
  append(plan.lines.map((p) => on(order_id, 'ItemVoided', p.payload)));
}

const takeaway = (lines: FixtureLine[], placed_by = 'S_ALI') => appendOrder(hub, { order_type: 'takeaway', placed_by, lines }).order_id;
function dineIn(lines: FixtureLine[], o: { table_id?: string; seating_id?: string } = {}): { order_id: string; seating_id: string } {
  const seating_id = o.seating_id ?? 'SEAT1';
  openSeating(hub, { table_id: o.table_id ?? FX.table, seating_id, holder_staff_id: 'S_ALI' });
  return { order_id: appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: 'S_ALI', lines }).order_id, seating_id };
}

/** Three naans worth 10 001: shares 3 333, 3 333, 3 335 (§3.4). */
const NAANS: FixtureLine = { order_item_id: 'N1', item_id: FX.naan, quantity: 3, item: { price_minor: 3_334, line_total_minor: 10_001 } };

/** fixtureMenu plus a family deal (naan × 1, naan × 4, Rs 3 200). */
function familyMenu(): BranchConfig {
  const menu = fixtureMenu();
  return {
    ...menu,
    deals: [
      ...menu.deals,
      {
        ...menu.deals[0]!,
        deal_id: 'D_FAMILY',
        name: 'Family',
        price_minor: 320_000,
        parts: [
          { deal_part_id: 'FP_MAIN', quantity: 1, sort_order: 0, choices: [{ item_id: FX.naan, extra_price_minor: 0, sort_order: 0 }] },
          { deal_part_id: 'FP_NAAN', quantity: 4, sort_order: 1, choices: [{ item_id: FX.naan, extra_price_minor: 0, sort_order: 0 }] },
        ],
      },
    ],
  };
}
const family = (id: string): FixtureLine[] => [
  { order_item_id: id, deal_id: 'D_FAMILY', quantity: 1 },
  { order_item_id: `${id}a`, deal_id: 'D_FAMILY', deal_part_id: 'FP_MAIN', item_id: FX.naan, parent_order_item_id: id },
  { order_item_id: `${id}b`, deal_id: 'D_FAMILY', deal_part_id: 'FP_NAAN', item_id: FX.naan, parent_order_item_id: id },
];
const deal = (id: string): FixtureLine[] => [
  { order_item_id: id, deal_id: FX.deal, quantity: 1 },
  { order_item_id: `${id}a`, deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: id },
  { order_item_id: `${id}b`, deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: id },
];
const karahiWithRaita = (id = 'K1', quantity = 2): FixtureLine[] => [
  { order_item_id: id, item_id: FX.piece, quantity },
  { order_item_id: `${id}r`, option_id: FX.option, parent_order_item_id: id, quantity: 1 },
];

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

async function post(who: Who, path: string, command_type: string, payload: Record<string, unknown>, commandId?: string): Promise<Reply> {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: commandId ?? `cmd-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type,
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

type CompPayload = { order_item_id: string; units: number; reason_code: string; note?: string };
const compLine = (who: Who, payload: CompPayload, o: { counted?: boolean; commandId?: string } = {}) =>
  o.counted === true ? post(who, 'test-comp-line-counted', 'TestCompLineCounted', payload, o.commandId) : post(who, 'comp-line', 'CompLine', payload, o.commandId);
const answer = (who: Who, alert_id: string, decision: 'approve' | 'reject', pin = PIN.b) => post(who, 'answer-request', 'AnswerRequest', { alert_id, decision, method: 'pin', pin });
const remove = (who: Who, payload: { order_id: string; lines: Array<{ order_item_id: string; units?: number }> }) => post(who, 'remove-items', 'RemoveItems', payload);

const types = (r: Reply) => r.events.map((e) => e.event_type);
const ofType = (r: Reply, t: string) => r.events.filter((e) => e.event_type === t).map((e) => e.payload);
const quality = (order_item_id: string, units: number): CompPayload => ({ order_item_id, units, reason_code: 'quality' });

// ------------------------------------------------------------------------------------------- #26

describe('CompLine (02b §6.8, §3.9)', () => {
  it('[02b #26] allowed → LineComped with the next free shares (3 333, then 3 333 + 3 335); result { comped, value_minor }; 2 statements', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([NAANS]);
    const r = await compLine(ali, quality('N1', 1), { counted: true });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ comped: true, value_minor: 3_333 });
    expect(types(r)).toEqual(['LineComped']);
    expect(r.events[0]).toMatchObject({ stream_type: 'order', stream_id: order_id, actor_id: 'S_ALI', device_id: ali.deviceId });
    expect(r.events[0]!.payload).toEqual({
      order_item_id: 'N1',
      units: 1,
      value_minor: 3_333,
      reason_code: 'quality',
      note: null,
      requester_staff_id: 'S_ALI',
      alert_id: null,
      approver_staff_id: null,
    });
    expect(lastStatements).toBe(2); // §6.8: line + children, open comp requests of the order

    const r2 = await compLine(ali, { order_item_id: 'N1', units: 2, reason_code: 'quality', note: 'cold' });
    expect(r2.result).toEqual({ comped: true, value_minor: 6_668 });
    expect(ofType(r2, 'LineComped')[0]).toMatchObject({ units: 2, value_minor: 6_668, note: 'cold' });
    expect(lineView(order_id, 'N1')).toMatchObject({ comped_units: 3, comp_minor: 10_001, billed_minor: 0 });
  });

  it('[02b #26] allowed → the option child cascades as its own LineComped; each carries its own share, the result sums them', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway(karahiWithRaita('K1', 2));
    const before = orderLines(hub.deps.db, [order_id]).get(order_id)!;
    const k = lineShares(before.find((l) => l.order_item_id === 'K1')!).next_share_minor(1);
    const kr = lineShares(before.find((l) => l.order_item_id === 'K1r')!).next_share_minor(1);
    expect(line('K1r').units).toBe(2);
    const r = await compLine(ali, quality('K1', 1));
    expect(r.status).toBe(200);
    expect(ofType(r, 'LineComped').map((p) => [p.order_item_id, p.units, p.value_minor])).toEqual([
      ['K1', 1, k],
      ['K1r', 1, kr],
    ]);
    expect(r.result).toEqual({ comped: true, value_minor: k + kr });
  });

  it('[02b #26] D32: the same command_id → the same response, no new event', async () => {
    await start();
    const ali = signIn('S_ALI');
    takeaway([NAANS]);
    const first = await compLine(ali, quality('N1', 1), { commandId: 'comp-1' });
    const n = eventCount();
    const again = await compLine(ali, quality('N1', 1), { commandId: 'comp-1' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(n);
  });

  it('[02b #26] approval: requires_approval passes the registry (approvable) → kind comp raised with approver_role_ids; result { alert_id, pending }; no LineComped', async () => {
    await start();
    const omar = signIn('S_OMAR');
    const order_id = takeaway([NAANS]);
    const r = await compLine(omar, { order_item_id: 'N1', units: 2, reason_code: 'other', note: 'birthday' });
    expect(r.status).toBe(200);
    const alert_id = r.result!.alert_id as string;
    expect(r.result).toEqual({ alert_id, pending: true });
    expect(types(r)).not.toContain('LineComped');
    const raised = ofType(r, 'AlertRaised')[0]!;
    expect(raised).toMatchObject({
      alert_id,
      kind: 'comp',
      family: 'action',
      subject_stream_type: 'order',
      subject_stream_id: order_id,
      dedupe_key: 'comp:N1',
      requester_staff_id: 'S_OMAR',
      target: { kind: 'answerers' },
      values: { order_id, order_item_id: 'N1', units: 2, reason_code: 'other', note: 'birthday' }, // N-3: values.note
      details: { item: 'Naan', quantity: 2, amount: 6_666 },
      request: { right_mode: 'approval', base_permission: 'apply-comp', approver_role_ids: ['R_MGR'], needs_pin: 'always' },
    });
    expect((raised.details as { reason?: unknown }).reason).toBe('other: birthday'); // R-2: reason_code, then the note
    expect(alertRow(alert_id)).toMatchObject({ kind: 'comp', state: 'open', requester_staff_id: 'S_OMAR' });
    expect(compEvents()).toEqual([]);
    expect(line('N1')).toMatchObject({ comped_units: 0, comp_minor: 0 });
  });

  it('[02b #26] a second request on the line → 409 COMP_PENDING { alert_id }, nothing appended', async () => {
    await start();
    const omar = signIn('S_OMAR');
    takeaway([NAANS]);
    const first = await compLine(omar, quality('N1', 1));
    const n = eventCount();
    const second = await compLine(omar, quality('N1', 1));
    expect(second.status).toBe(409);
    expect(second.error).toEqual({ code: 'COMP_PENDING', details: { alert_id: first.result!.alert_id } });
    expect(eventCount()).toBe(n);
  });

  it('[02b #26] D32 on the approval path: the same command_id → the same { alert_id, pending }, no second raise, not 409', async () => {
    await start();
    const omar = signIn('S_OMAR');
    takeaway([NAANS]);
    const first = await compLine(omar, quality('N1', 1), { commandId: 'ask-1' });
    expect(first.result).toMatchObject({ pending: true });
    const n = eventCount();
    const again = await compLine(omar, quality('N1', 1), { commandId: 'ask-1' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(n);
    expect(alerts.listOpen(hub.deps.db, { kind: 'comp' })).toHaveLength(1);
  });

  it('[02b §6.12] a comp request does not expire at day close (C-1: expires_at_day_close has no effect on a request kind)', async () => {
    await start();
    const omar = signIn('S_OMAR');
    takeaway([NAANS]);
    const alert_id = (await compLine(omar, quality('N1', 1))).result!.alert_id as string;
    const day = aBusinessDayClosed();
    hub.deps.writer.run((tx) =>
      tx.append([{ stream_type: day.stream_type, stream_id: day.stream_id, event_type: day.event_type, schema_version: day.schema_version, payload: day.payload, occurred_at: hub.clock.branchNow(), actor_id: null, device_id: 'hub' }]),
    );
    expect(hub.deps.db.prepare('SELECT state, expire_due FROM alerts WHERE alert_id = ?').get(alert_id)).toEqual({ state: 'open', expire_due: 0 });
  });

  it('[02b #26] approve → LineComped { alert_id, approver_staff_id, requester_staff_id } with value_minor recomputed from the current ledger', async () => {
    await start();
    const omar = signIn('S_OMAR');
    const ali = signIn('S_ALI');
    const mgr = signIn('S_MGR');
    const order_id = takeaway([NAANS]);
    const req = await compLine(omar, quality('N1', 1));
    const alert_id = req.result!.alert_id as string;
    expect((ofType(req, 'AlertRaised')[0]!.details as { amount: number }).amount).toBe(3_333);
    // a direct comp of 2 meanwhile leaves 1 free ≥ 1 requested: the request stays open; the next free share is now 3 335
    expect((await compLine(ali, quality('N1', 2))).status).toBe(200);
    expect(alertRow(alert_id)).toMatchObject({ state: 'open' });

    const a = await answer(mgr, alert_id, 'approve');
    expect(a.status).toBe(200);
    const comped = ofType(a, 'LineComped');
    expect(comped).toEqual([
      { order_item_id: 'N1', units: 1, value_minor: 3_335, reason_code: 'quality', note: null, requester_staff_id: 'S_OMAR', alert_id, approver_staff_id: 'S_MGR' },
    ]);
    expect(a.events.find((e) => e.event_type === 'LineComped')).toMatchObject({ stream_type: 'order', stream_id: order_id });
    expect(alertRow(alert_id)).toMatchObject({ state: 'closed', close_reason: 'answered' });
    expect(lineView(order_id, 'N1')).toMatchObject({ comped_units: 3, comp_minor: 10_001 });
  });

  it('[02b #26] reject → nothing comped', async () => {
    await start();
    const omar = signIn('S_OMAR');
    const mgr = signIn('S_MGR');
    takeaway([NAANS]);
    const req = await compLine(omar, quality('N1', 1));
    const a = await answer(mgr, req.result!.alert_id as string, 'reject');
    expect(a.status).toBe(200);
    expect(types(a)).not.toContain('LineComped');
    expect(compEvents()).toEqual([]);
    expect(line('N1')).toMatchObject({ comped_units: 0, comp_minor: 0 });
  });

  it('[02b #26] apply is read-only: on a read-only view it reads and returns drafts, appends nothing; reject → []', async () => {
    await start();
    const omar = signIn('S_OMAR');
    takeaway([NAANS]);
    const req = await compLine(omar, quality('N1', 1));
    const alert_id = req.result!.alert_id as string;
    const kind = kindOf('comp')!;
    expect(kind).toMatchObject({ family: 'action', subject: 'order', closes_on: 'owner', request: { needs_pin: 'always', right: { mode: 'approval', base_permission: 'apply-comp' } } });
    const record = alerts.listOpen(hub.deps.db, { kind: 'comp' }).find((x) => x.alert_id === alert_id)!;
    const n = eventCount();
    const out = hub.deps.writer.run((tx) => {
      const ctx = { ...ctxOf(tx), tx: readOnlyTx(tx), alert: record } as unknown as AlertApplyCtx<Record<string, unknown>, never>;
      const facts = (decision: 'approve' | 'reject') => ({ decision, answerer_staff_id: 'S_MGR', method: 'pin' as const, device_id: 'D_MGR', answered_at: hub.clock.branchNow() });
      return { approve: kind.request!.apply(ctx, facts('approve')), reject: kind.request!.apply(ctx, facts('reject')) };
    }).result;
    expect(out.approve.map((d) => [d.event_type, d.payload.alert_id])).toEqual([['LineComped', alert_id]]);
    expect(out.reject).toEqual([]);
    expect(eventCount()).toBe(n);
  });

  it('[02b #26] COMP_NOT_ALLOWED: return_line, deal_part, zone_line (pending undo; allowed after the window), not_live', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([...deal('D1'), { order_item_id: 'R1', item_id: FX.naan, quantity: 1, item: { return_of: 'X1' } }, { order_item_id: 'V1', item_id: FX.naan, quantity: 1 }, { order_item_id: 'V2', item_id: FX.naan, quantity: 1 }]);
    const notAllowed = async (id: string, reason: string) => {
      const n = eventCount();
      const r = await compLine(ali, quality(id, 1));
      expect(r.status).toBe(409);
      expect(r.error).toEqual({ code: 'COMP_NOT_ALLOWED', details: { reason } });
      expect(eventCount()).toBe(n);
    };
    await notAllowed('R1', 'return_line');
    await notAllowed('D1a', 'deal_part');
    voidUnits(order_id, 'V1', 1);
    await notAllowed('V1', 'not_live');

    dineIn([{ order_item_id: 'Z1', item_id: FX.zoneItem, quantity: 1, from_zone: true }], { table_id: FX.zoneTable, seating_id: 'SEATZ' });
    await notAllowed('Z1', 'zone_line');
    hub.clock.advance(300_001); // zone_undo_ms (default 300 000) has passed: no undo is pending
    expect((await compLine(ali, quality('Z1', 1))).status).toBe(200);
  });

  it('[02b #26] LINE_WEIGHT_PENDING on a pending weight; ORDER_BILLED (m-10); ORDER_NOT_FOUND { order_item_id }', async () => {
    await start();
    const ali = signIn('S_ALI');
    takeaway([{ order_item_id: 'W1', item_id: FX.gram }]);
    const w = await compLine(ali, quality('W1', 1));
    expect(w.status).toBe(409);
    expect(w.error).toEqual({ code: 'LINE_WEIGHT_PENDING', details: { order_item_id: 'W1' } });

    const order_id = takeaway([NAANS]);
    append([on(order_id, 'OrdersBilled', { order_ids: [order_id], bill_id: 'B1' })]);
    const b = await compLine(ali, quality('N1', 1));
    expect(b.status).toBe(409);
    expect(b.error).toEqual({ code: 'ORDER_BILLED', details: { order_id } });

    const x = await compLine(ali, quality('NOPE', 1));
    expect(x.status).toBe(404);
    expect(x.error).toEqual({ code: 'ORDER_NOT_FOUND', details: { order_item_id: 'NOPE' } });
  });

  it('[02b #26] units > live − comped → 400 VALIDATION_FAILED (AD-17); note over 120 → 400; nothing appended', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([NAANS]);
    voidUnits(order_id, 'N1', 1);
    expect((await compLine(ali, quality('N1', 1))).status).toBe(200);
    const n = eventCount();
    const over = await compLine(ali, quality('N1', 2));
    expect(over.status).toBe(400);
    expect(over.error?.code).toBe('VALIDATION_FAILED');
    const long = await compLine(ali, { order_item_id: 'N1', units: 1, reason_code: 'quality', note: 'x'.repeat(121) });
    expect(long.status).toBe(400);
    expect(eventCount()).toBe(n);
  });

  it('[02b §3.14] scope last (C8): my_floors → 403 outside_scope, nothing appended; an outside-scope caller on a pending weight gets LINE_WEIGHT_PENDING', async () => {
    await start();
    const zain = signIn('S_ZAIN');
    takeaway([NAANS, { order_item_id: 'W1', item_id: FX.gram }]);
    const n = eventCount();
    const r = await compLine(zain, quality('N1', 1));
    expect(r.status).toBe(403);
    expect(r.error?.code).toBe('PERMISSION_DENIED');
    expect(r.error?.details).toMatchObject({ reason: 'outside_scope' });
    expect(eventCount()).toBe(n);
    const w = await compLine(zain, quality('W1', 1));
    expect(w.error?.code).toBe('LINE_WEIGHT_PENDING');
  });

  it('[02b §3.14] a caller without apply-comp → 403 PERMISSION_DENIED', async () => {
    await start();
    const wait = signIn('S_WAIT');
    takeaway([NAANS]);
    const r = await compLine(wait, quality('N1', 1));
    expect(r.status).toBe(403);
    expect(r.error?.code).toBe('PERMISSION_DENIED');
  });
});

// ------------------------------------------------------------------------------------------- #27

describe('CompLine stale requests and notes (02b §3.9)', () => {
  it('[02b #27] pending comp on 2 of 3, then remove 2 → request closed obsolete, requester told, new comp allowed', async () => {
    await start();
    const omar = signIn('S_OMAR');
    const ali = signIn('S_ALI');
    const order_id = takeaway([NAANS]);
    const req = await compLine(omar, quality('N1', 2));
    const alert_id = req.result!.alert_id as string;

    const r = await remove(ali, { order_id, lines: [{ order_item_id: 'N1', units: 2 }] });
    expect(r.status).toBe(200);
    expect(r.result).toMatchObject({ comp_requests_closed: [alert_id] });
    expect(ofType(r, 'AlertClosed')).toEqual([expect.objectContaining({ alert_id, reason: 'obsolete' })]);
    expect(alertRow(alert_id)).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
    // 01d tells the requester: a request_result to S_OMAR
    const told = ofType(r, 'AlertRaised').find((p) => p.kind === 'request_result')!;
    expect(told).toMatchObject({ target: { kind: 'person', staff_id: 'S_OMAR' }, values: { request_alert_id: alert_id, close_reason: 'obsolete' } });

    const again = await compLine(omar, quality('N1', 1));
    expect(again.status).toBe(200);
    expect(again.result).toMatchObject({ pending: true });
  });

  it('[02b #27] a direct allowed comp by someone else also closes it (free < requested); with enough left it stays open', async () => {
    await start();
    const omar = signIn('S_OMAR');
    const ali = signIn('S_ALI');
    takeaway([NAANS, { order_item_id: 'N2', item_id: FX.naan, quantity: 3 }]);
    const stale = (await compLine(omar, quality('N1', 2))).result!.alert_id as string;
    const kept = (await compLine(omar, quality('N2', 1))).result!.alert_id as string;

    // closeMany's own statements (01d bounds) for this one close, measured in a transaction that is rolled back
    const closeCost = closeManyStatements(stale);
    expect(closeCost).toBeGreaterThan(0);
    const r = await compLine(ali, quality('N1', 2), { counted: true });
    expect(r.status).toBe(200);
    expect(types(r)).toEqual(expect.arrayContaining(['LineComped', 'AlertClosed']));
    expect(ofType(r, 'AlertClosed')).toEqual([expect.objectContaining({ alert_id: stale, reason: 'obsolete' })]);
    expect(lastStatements).toBe(2 + closeCost); // §6.8: 2 + 01d's closeMany
    expect(alertRow(stale)).toMatchObject({ state: 'closed', close_reason: 'obsolete' });

    const k = await compLine(ali, quality('N2', 2));
    expect(types(k)).toEqual(['LineComped']); // 1 free ≥ 1 requested
    expect(alertRow(kept)).toMatchObject({ state: 'open' });
  });

  it('[02b #27] statements: one listOpen per order whatever the number of open requests (no per-line reads)', async () => {
    await start();
    const omar = signIn('S_OMAR');
    const ali = signIn('S_ALI');
    takeaway([NAANS, { order_item_id: 'N2', item_id: FX.naan, quantity: 3 }, { order_item_id: 'N3', item_id: FX.naan, quantity: 3 }]);
    await compLine(omar, quality('N2', 1));
    await compLine(omar, quality('N3', 1));
    const r = await compLine(ali, quality('N1', 1), { counted: true });
    expect(types(r)).toEqual(['LineComped']);
    expect(lastStatements).toBe(2);
  });

  it("[02b #27] reason_code 'other' without a note → 400 VALIDATION_FAILED, nothing appended", async () => {
    await start();
    const ali = signIn('S_ALI');
    takeaway([NAANS]);
    const n = eventCount();
    const r = await compLine(ali, { order_item_id: 'N1', units: 1, reason_code: 'other' });
    expect(r.status).toBe(400);
    expect(r.error?.code).toBe('VALIDATION_FAILED');
    expect(eventCount()).toBe(n);
  });

  it("[02b #27] an approved 'other' comp keeps its note (values.note) and sets requester_staff_id", async () => {
    await start();
    const omar = signIn('S_OMAR');
    const mgr = signIn('S_MGR');
    takeaway([NAANS]);
    const req = await compLine(omar, { order_item_id: 'N1', units: 1, reason_code: 'other', note: 'regular guest' });
    expect(ofType(req, 'AlertRaised')[0]!.values).toMatchObject({ note: 'regular guest' });
    const a = await answer(mgr, req.result!.alert_id as string, 'approve');
    expect(ofType(a, 'LineComped')[0]).toMatchObject({ reason_code: 'other', note: 'regular guest', requester_staff_id: 'S_OMAR', approver_staff_id: 'S_MGR' });
  });

  it("[02b #27] a deal comp's details.amount = the deal value (N-4), never Rs 0", async () => {
    await start();
    const omar = signIn('S_OMAR');
    const order_id = takeaway(deal('D1'));
    const lines = orderLines(hub.deps.db, [order_id]).get(order_id)!;
    const value = ['D1a', 'D1b'].reduce((a, id) => a + lineShares(lines.find((l) => l.order_item_id === id)!).next_share_minor(id === 'D1a' ? 1 : 2), 0);
    expect(value).toBe(120_000);
    const req = await compLine(omar, quality('D1', 1));
    expect(ofType(req, 'AlertRaised')[0]!.details).toMatchObject({ item: 'Karahi combo', quantity: 1, amount: 120_000 });
  });
});

// ------------------------------------------------------------------------------------------- #37 #38 #39

describe('CompLine with deals, remakes and children (02b §3.4)', () => {
  it('[02b #37 comp] void 1 naan of the family deal, then comp the deal → 3 naan comped (cascade capped), value = the deal value left', async () => {
    await start({ menu: familyMenu() });
    const ali = signIn('S_ALI');
    const order_id = takeaway(family('F1'));
    voidUnits(order_id, 'F1b', 1);
    expect(lineView(order_id, 'F1b')).toMatchObject({ live_units: 3, voided_units: 1 });
    const r = await compLine(ali, quality('F1', 1));
    expect(r.status).toBe(200);
    expect(ofType(r, 'LineComped').map((p) => [p.order_item_id, p.units])).toEqual([
      ['F1', 1],
      ['F1a', 1],
      ['F1b', 3],
    ]);
    expect(lineView(order_id, 'F1b')).toMatchObject({ comped_units: 3 });
    const parts = ofType(r, 'LineComped').reduce((a, p) => a + (p.value_minor as number), 0);
    expect(r.result).toEqual({ comped: true, value_minor: parts });
    expect(lineView(order_id, 'F1').billed_minor).toBe(0);
  });

  it('[02b #38 comp] remake a karahi → still billed; comp it → LineComped allowed (O20); a pending comp request survives the remake', async () => {
    await start();
    const ali = signIn('S_ALI');
    const omar = signIn('S_OMAR');
    const mgr = signIn('S_MGR');
    const order_id = takeaway([{ order_item_id: 'K1', item_id: FX.piece, quantity: 2 }]);
    append([served(order_id, ['K1'])]);
    const req = await compLine(omar, quality('K1', 1));
    const alert_id = req.result!.alert_id as string;
    append([on(order_id, 'ItemReturned', { order_item_id: 'K1', mode: 'remake', replacement_order_item_id: 'K1x' })]);
    expect(line('K1').returned_units).toBe(2);
    expect(lineView(order_id, 'K1').billed_minor).toBe(line('K1').refundable_minor as number);
    expect(alertRow(alert_id)).toMatchObject({ state: 'open' });

    expect(ofType(await compLine(ali, quality('K1', 1)), 'LineComped')).toHaveLength(1);
    const a = await answer(mgr, alert_id, 'approve');
    expect(a.status).toBe(200);
    expect(ofType(a, 'LineComped')).toEqual([expect.objectContaining({ order_item_id: 'K1', units: 1, alert_id })]);
    expect(lineView(order_id, 'K1')).toMatchObject({ comped_units: 2, billed_minor: 0 });
  });

  it("[02b #39 approved] an approved comp's child LineComped events carry the alert id", async () => {
    await start();
    const omar = signIn('S_OMAR');
    const mgr = signIn('S_MGR');
    takeaway(karahiWithRaita('K1', 2));
    const req = await compLine(omar, quality('K1', 2));
    const alert_id = req.result!.alert_id as string;
    const a = await answer(mgr, alert_id, 'approve');
    expect(a.status).toBe(200);
    expect(ofType(a, 'LineComped').map((p) => [p.order_item_id, p.units, p.alert_id, p.approver_staff_id])).toEqual([
      ['K1', 2, alert_id, 'S_MGR'],
      ['K1r', 2, alert_id, 'S_MGR'],
    ]);
  });

  it('[02b §3.9] approve after the line was billed → the re-check refuses (ORDER_BILLED), nothing comped', async () => {
    await start();
    const omar = signIn('S_OMAR');
    const mgr = signIn('S_MGR');
    const order_id = takeaway([NAANS]);
    const req = await compLine(omar, quality('N1', 1));
    append([on(order_id, 'OrdersBilled', { order_ids: [order_id], bill_id: 'B1' })]);
    const a = await answer(mgr, req.result!.alert_id as string, 'approve');
    expect(a.status).toBe(409);
    expect(a.error?.code).toBe('ORDER_BILLED');
    expect(compEvents()).toEqual([]);
  });
});

function ctxOf(tx: Parameters<Parameters<TestHub['deps']['writer']['run']>[0]>[0]): CommandCtx {
  return {
    tx,
    state: tx.state,
    clock: tx.clock,
    ids: tx.ids,
    actor: { kind: 'device', staffId: 'S_MGR', stationId: null, sessionId: 'SESS', deviceId: 'D_MGR' },
    branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
    directory: currentDirectory(hub.app),
    permission: null,
    queuedAt: null,
  } as unknown as CommandCtx;
}
