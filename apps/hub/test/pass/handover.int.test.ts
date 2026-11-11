import type { EngineState } from '@pos/engine';
import type { DirectoryInput } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import { defineCommand } from '../../src/commands/registry';
import type { CommandCtx } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { handoverCommand, passScopedOrders } from '../../src/kds/commands/handover';
import { checkOrderScope, scopedOrders } from '../../src/orders/commands/mark-served';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { COOK, FX, append, appendOrder, cookDirectory, fireLines, openDay, openSeating, pairKds, pairPassTablet, serveLines } from '../kds/fixtures';

// 03b §3.5 Handover (steps 1–8), §6.8 (Statements 4), §6.11 GET /queries/pass-receivers (Statements 3); tests #24,
// #25, #28; P0.F rule: the receiver's mark-served must be `allowed` (requires_approval is not a receiver).
// Orders, seatings and engine progress are real events; the commands and the query go through the real routes.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;
let alertStatements = 0;

const POINT = 'P1';
const engine = (): EngineState => hub.deps.state.get() as EngineState;

function grant(permission: string, scope: 'branch' | 'my_floors' | 'own_tables', grant_type: 'allowed' | 'requires_approval' = 'allowed') {
  return { permission, grant_type, approver_role_id: grant_type === 'allowed' ? null : 'R_MGR', approver_role_ids: grant_type === 'allowed' ? [] : ['R_MGR'], scope };
}

/** cookDirectory() plus one receiver per mark-served scope (and a requires_approval one, P0.F). */
async function directory(): Promise<DirectoryInput> {
  const base = await cookDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, role_id: string, floor_ids: string[] = []) => ({
    staff_id,
    display_name: `Name ${staff_id}`,
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
      role('R_BRANCH', [grant('mark-served', 'branch')]),
      role('R_OWN', [grant('mark-served', 'own_tables')]),
      role('R_FLOOR', [grant('mark-served', 'my_floors')]),
      role('R_APPROVAL', [grant('mark-served', 'branch', 'requires_approval')]),
    ],
    staff: [
      ...base.staff,
      person('S_BRANCH', 'R_BRANCH'),
      person('S_OWN', 'R_OWN'),
      person('S_OWN2', 'R_OWN'),
      person('S_FLOOR', 'R_FLOOR', [FX.floor]),
      person('S_FAR', 'R_FLOOR', ['F_OTHER']),
      person('S_APPROVAL', 'R_APPROVAL'),
    ],
  };
}

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  commandRegistry(hub.app).register(
    defineCommand({
      ...handoverCommand,
      commandType: 'TestHandoverCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        alertStatements = 0;
        try {
          return handoverCommand.handle(ctx, payload, cmd);
        } finally {
          lastStatements = counter.count - before - alertStatements;
        }
      },
    }),
  );
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
  for (const name of ['raise', 'close'] as const) {
    const original = alerts[name] as (...args: unknown[]) => unknown;
    vi.spyOn(alerts, name).mockImplementation(((...args: unknown[]) => {
      const before = counter.count;
      try {
        return original(...args);
      } finally {
        alertStatements += counter.count - before;
      }
    }) as never);
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await hub.close();
});

// ------------------------------------------------------------------------------------------- seeding

const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });

function cook(order_id: string, ids: string[]): void {
  fireLines(hub, engine().lines[ids[0]!]!.station_id, ids);
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
}
const naans = (ids: string[]) => ids.map((order_item_id) => ({ order_item_id, item_id: FX.naan }));

/** A dine-in on T2 (floor F1, no zone), seating held by `holder`. */
function dineIn(ids: string[], holder = 'S_WAIT', seating_id = 'SEAT1'): string {
  openSeating(hub, { table_id: FX.table, seating_id, holder_staff_id: holder });
  return appendOrder(hub, { order_type: 'dine_in', seating_id, lines: naans(ids) }).order_id;
}
const takeaway = (ids: string[], placed_by = 'S_WAIT') => appendOrder(hub, { order_type: 'takeaway', placed_by, lines: naans(ids) }).order_id;
const parking = (ids: string[], placed_by = 'S_WAIT') =>
  appendOrder(hub, { order_type: 'parking', placed_by, car_number: 'LEB 1234', lines: naans(ids) }).order_id;

const alertRow = (alert_id: string) =>
  hub.deps.db.prepare('SELECT kind, state, close_reason, target_json, values_json, display_json, details_json, dedupe_key FROM alerts WHERE alert_id = ?').get(alert_id) as {
    kind: string;
    state: string;
    close_reason: string | null;
    target_json: string;
    values_json: string;
    display_json: string;
    details_json: string | null;
    dedupe_key: string;
  };
const eventCount = (): number => (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;

// ------------------------------------------------------------------------------------------- calls

interface Who {
  staffId: string | null;
  deviceId: string;
  token: string;
  sessionToken: string;
}
function staffOn(staffId: string, o: { pointId?: string } = {}): Who & { sessionId: string } {
  const device = o.pointId === undefined ? pairDevice(hub, { type: 'tablet' }) : pairPassTablet(hub, { pointId: o.pointId });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionToken: session.token, sessionId: session.sessionId };
}
async function seed(o: { receiver?: boolean } = {}): Promise<Who> {
  await seedDirectory(hub, await directory());
  const cook_ = staffOn(COOK.staff, { pointId: POINT });
  if (o.receiver === true) staffOn('S_BRANCH'); // owner ruling B4-3 (a): a receiver is signed in
  return cook_;
}

interface Stored {
  event_type: string;
  stream_type: string;
  stream_id: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
}
interface Reply {
  status: number;
  result: Record<string, unknown> | undefined;
  events: Stored[];
  error?: { code: string; details: Record<string, unknown> };
}
let commandSeq = 0;
async function handover(who: Who, payload: Record<string, unknown>, o: { counted?: boolean; commandId?: string } = {}): Promise<Reply> {
  commandSeq += 1;
  const type = o.counted === true ? 'TestHandoverCounted' : 'Handover';
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${o.counted === true ? 'test-handover-counted' : 'handover'}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: { command_id: o.commandId ?? `cmd-${commandSeq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: type, payload, occurred_at: hub.clock.branchNow(), actor_id: who.staffId, device_id: who.deviceId },
  });
  const body = res.json() as { data?: { event_ids: string[]; result: Record<string, unknown> }; error?: { code: string; details: Record<string, unknown> } };
  const events =
    body.data === undefined
      ? []
      : (
          hub.deps.db
            .prepare(`SELECT event_type, stream_type, stream_id, actor_id, payload AS p FROM events WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`)
            .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Stored, 'payload'> & { p: string }>
        ).map(({ p, ...rest }) => ({ ...rest, payload: JSON.parse(p) as Record<string, unknown> }));
  return { status: res.statusCode, result: body.data?.result, events, ...(body.error === undefined ? {} : { error: { code: body.error.code, details: body.error.details } }) };
}
async function markReady(who: Who, order_id: string): Promise<string> {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/mark-ready-to-serve',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: { command_id: `cmd-${commandSeq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: 'MarkReadyToServe', payload: { order_id, point_id: POINT }, occurred_at: hub.clock.branchNow(), actor_id: who.staffId, device_id: who.deviceId },
  });
  return (res.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
}
async function receivers(who: Who, order_id: string): Promise<{ status: number; data: { receivers: Array<{ staff_id: string; name: string; table_team: boolean }> }; error?: { code: string } }> {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/pass-receivers?order_id=${order_id}`, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  const body = res.json() as { data: { receivers: Array<{ staff_id: string; name: string; table_team: boolean }> }; error?: { code: string } };
  return { status: res.statusCode, data: body.data, ...(body.error === undefined ? {} : { error: body.error }) };
}

/** 02b's verdict for `staffId` on `order_id`: checkOrderScope with that staff's resolved mark-served (as MarkServed). */
function servedVerdict(staffId: string, order_id: string): boolean {
  const directory = currentDirectory(hub.app);
  const ctx = { actor: { staffId }, permission: directory.resolve(staffId, 'mark-served'), directory, tx: { db: hub.deps.db } } as unknown as CommandCtx;
  try {
    checkOrderScope(ctx, [scopedOrders(hub.deps.db, [order_id]).get(order_id)!]);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------------------- #24

describe('Handover (03b §3.5, §6.8)', () => {
  it('[03b #24] without a Ready → ReadyToServe { alert_id: null } + Handover (hub-minted id) + served_card to the receiver; 4 statements', async () => {
    openDay(hub);
    const cook_ = await seed();
    staffOn('S_BRANCH');
    const order_id = dineIn(['L1', 'L2']);
    cook(order_id, ['L1', 'L2']);

    const reply = await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH' }, { counted: true });
    expect(reply.status, JSON.stringify(reply.error)).toBe(200);
    expect(lastStatements).toBe(5); // dine-in, owner ruling B4-3 (a): + the receiver's open session
    const { handover_id, served_card_alert_id } = reply.result as { handover_id: string; served_card_alert_id: string };
    expect(handover_id).toMatch(/^[0-9A-Z]{26}$/);
    const types = reply.events.map((e) => e.event_type);
    expect(types[0]).toBe('ReadyToServe');
    expect(types[types.length - 1]).toBe('Handover');
    expect(reply.events[0]!.payload).toEqual({ order_id, point_id: POINT, order_item_ids: ['L1', 'L2'], table_id: FX.table, alert_id: null });
    expect(reply.events[types.length - 1]!.payload).toEqual({
      handover_id,
      order_id,
      point_id: POINT,
      receiver_staff_id: 'S_BRANCH',
      order_item_ids: ['L1', 'L2'],
      alert_id: served_card_alert_id,
      ready_alert_closed: null,
    });
    const card = alertRow(served_card_alert_id);
    expect(card).toMatchObject({ kind: 'served_card', state: 'open', dedupe_key: handover_id });
    expect(JSON.parse(card.target_json)).toEqual({ kind: 'person', staff_id: 'S_BRANCH' });
    expect(JSON.parse(card.values_json)).toEqual({ handover_id, order_id });
    expect(JSON.parse(card.display_json)).toMatchObject({ table_code: null, kind_label_key: 'alert.served_card' });
    expect(JSON.parse(card.details_json!)).toEqual({ identifier: 'T2' });
    expect(hub.deps.db.prepare('SELECT open_lines, served_card_alert_id FROM handovers WHERE handover_id = ?').get(handover_id)).toEqual({ open_lines: 2, served_card_alert_id });
  });

  it('[03b #24] a partial hand-over keeps the Ready open; the last one closes it done (ready_alert_closed); a served line counts as handed', async () => {
    openDay(hub);
    const cook_ = await seed({ receiver: true });
    const order_id = takeaway(['L1', 'L2', 'L3']);
    cook(order_id, ['L1', 'L2', 'L3']);
    const ready_id = await markReady(cook_, order_id);

    const first = await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH', order_item_ids: ['L1'] });
    expect(first.status, JSON.stringify(first.error)).toBe(200);
    expect(first.events.map((e) => e.event_type)).not.toContain('ReadyToServe');
    expect(first.events.find((e) => e.event_type === 'Handover')!.payload).toMatchObject({ order_item_ids: ['L1'], ready_alert_closed: null });
    expect(alertRow(ready_id).state).toBe('open');

    serveLines(hub, order_id, ['L2']); // the waiter's own MarkServed of a ready line
    const last = await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH' }); // every done line not handed: L3
    expect(last.status, JSON.stringify(last.error)).toBe(200);
    expect(last.events.find((e) => e.event_type === 'Handover')!.payload).toMatchObject({ order_item_ids: ['L3'], ready_alert_closed: ready_id });
    expect(last.events.filter((e) => e.event_type === 'AlertClosed').map((e) => e.payload)).toEqual([expect.objectContaining({ alert_id: ready_id, reason: 'done' })]);
    expect(alertRow(ready_id)).toMatchObject({ state: 'closed', close_reason: 'done' });
  });

  it('[03b §3.5 step 3] lines must be at this point, done, not handed over, not served; none done → ITEM_WRONG_STAGE; nothing written', async () => {
    openDay(hub);
    const cook_ = await seed({ receiver: true });
    const order_id = takeaway(['L1', 'L2', 'L3', 'L4']);
    cook(order_id, ['L1', 'L2']);
    fireLines(hub, FX.station, ['L3']); // fired, not done
    serveLines(hub, order_id, ['L2']);
    expect((await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH', order_item_ids: ['L1'] })).status).toBe(200);
    const before = eventCount();
    const cases: Array<[string, string]> = [
      ['L1', 'handed_over'],
      ['L2', 'served'],
      ['L3', 'added'],
      ['L_NONE', 'not_in_order'],
    ];
    for (const [id, stage] of cases) {
      const r = await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH', order_item_ids: [id] });
      expect(r.status, id).toBe(409);
      expect(r.error, id).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: id, stage } });
    }
    const none = await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH' });
    expect(none.error).toMatchObject({ code: 'ITEM_WRONG_STAGE', details: { order_id, stage: 'not_done' } });
    expect(eventCount()).toBe(before);
    expect((await handover(cook_, { order_id, point_id: 'P_NONE', receiver_staff_id: 'S_BRANCH' })).error).toMatchObject({ code: 'POINT_NOT_FOUND' });
    expect((await handover(cook_, { order_id: 'O_NONE', point_id: POINT, receiver_staff_id: 'S_BRANCH' })).error).toMatchObject({ code: 'ORDER_NOT_IN_ENGINE' });
  });

  it('[03b #28] a station session calling Handover → PERMISSION_DENIED { session_kind: station }', async () => {
    openDay(hub);
    await seed();
    const order_id = takeaway(['L1']);
    cook(order_id, ['L1']);
    const kds = pairKds(hub, { stationId: FX.station });
    const auth = await hub.app.inject({ method: 'POST', url: '/auth/station', headers: { authorization: `Bearer ${kds.token}` } });
    const station: Who = { staffId: null, deviceId: kds.deviceId, token: kds.token, sessionToken: (auth.json() as { data: { session_token: string } }).data.session_token };
    const r = await handover(station, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH' });
    expect(r.status).toBe(403);
    expect(r.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'run-pass', session_kind: 'station' } });
  });
});

// ------------------------------------------------------------------------------------------- #25 parity

describe('[03b #25] receiver scope = 02b MarkServed (orderCovered), plus P0.F (mark-served must be allowed)', () => {
  const CANDIDATES = ['S_BRANCH', 'S_OWN', 'S_OWN2', 'S_FLOOR', 'S_FAR', 'S_WAIT'] as const;

  it('[03b #25] per scope (branch, own_tables, my_floors) × order type (dine-in, takeaway, parking): Handover accepts iff checkOrderScope would; else PASS_RECEIVER_INVALID; pass-receivers lists the same staff', async () => {
    openDay(hub);
    const cook_ = await seed();
    for (const id of CANDIDATES) staffOn(id); // an open session each (pass-receivers lists signed-in staff)
    const lines = (prefix: string) => CANDIDATES.map((_, i) => `${prefix}${i}`);
    const orders = { dine_in: dineIn(lines('D'), 'S_OWN'), takeaway: takeaway(lines('T'), 'S_OWN'), parking: parking(lines('P'), 'S_OWN') };
    const prefix = { dine_in: 'D', takeaway: 'T', parking: 'P' } as const;
    for (const [type, order_id] of Object.entries(orders) as Array<[keyof typeof orders, string]>) cook(order_id, lines(prefix[type]));

    const expected = { dine_in: ['S_BRANCH', 'S_OWN', 'S_FLOOR'], takeaway: ['S_BRANCH', 'S_OWN'], parking: ['S_BRANCH', 'S_OWN'] };
    for (const [type, order_id] of Object.entries(orders) as Array<[keyof typeof orders, string]>) {
      const listed = (await receivers(cook_, order_id)).data.receivers.map((r) => r.staff_id);
      for (const [i, staffId] of CANDIDATES.entries()) {
        const verdict = servedVerdict(staffId, order_id);
        expect(verdict, `${type} ${staffId} fixture`).toBe((expected[type] as string[]).includes(staffId));
        const r = await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: staffId, order_item_ids: [`${prefix[type]}${i}`] });
        if (verdict) expect(r.status, `${type} ${staffId}`).toBe(200);
        else expect(r.error, `${type} ${staffId}`).toEqual({ code: 'PASS_RECEIVER_INVALID', details: { receiver_staff_id: staffId } });
        expect(listed.includes(staffId), `${type} ${staffId} listed`).toBe(verdict);
      }
    }
  });

  it('[03b §3.5 step 2, #25, P0.F] receiver with mark-served requires_approval → 422 PASS_RECEIVER_INVALID / not listed (02b checkOrderScope would cover it); unknown staff → 422', async () => {
    openDay(hub);
    const cook_ = await seed();
    staffOn('S_APPROVAL');
    const order_id = takeaway(['L1']);
    cook(order_id, ['L1']);
    expect(currentDirectory(hub.app).resolve('S_APPROVAL', 'mark-served')).toMatchObject({ grant: 'requires_approval', scope: 'branch' });
    expect(servedVerdict('S_APPROVAL', order_id)).toBe(true);
    const before = eventCount();
    expect((await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_APPROVAL' })).error).toEqual({ code: 'PASS_RECEIVER_INVALID', details: { receiver_staff_id: 'S_APPROVAL' } });
    expect((await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_NOBODY' })).error).toEqual({ code: 'PASS_RECEIVER_INVALID', details: { receiver_staff_id: 'S_NOBODY' } });
    expect(eventCount()).toBe(before);
    expect((await receivers(cook_, order_id)).data.receivers.map((r) => r.staff_id)).not.toContain('S_APPROVAL');
  });
});

describe('[03b §3.5 step 3, B4-2] no named lines: at most 40 in line order; result remaining', () => {
  it('[03b B4-2] 45 done lines, no list → 40 handed (line order) + remaining 5, the event validates; second call → 5, remaining 0; the Ready closes done only after the second; 4 statements each', async () => {
    openDay(hub);
    const cook_ = await seed({ receiver: true });
    // submitted in reverse id order in one batch (same added_at): line order = (added_at, order_item_id)
    const ids = Array.from({ length: 45 }, (_, i) => `N${String(i).padStart(2, '0')}`);
    const order_id = takeaway([...ids].reverse());
    cook(order_id, ids);
    const ready_id = await markReady(cook_, order_id);

    const first = await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH' }, { counted: true });
    expect(first.status, JSON.stringify(first.error)).toBe(200);
    expect(lastStatements).toBe(4);
    expect(first.result).toMatchObject({ remaining: 5 });
    const handed = first.events.find((e) => e.event_type === 'Handover')!.payload as { order_item_ids: string[]; ready_alert_closed: string | null };
    expect(handed.order_item_ids).toEqual(ids.slice(0, 40));
    expect(handed.ready_alert_closed).toBeNull();
    expect(alertRow(ready_id).state).toBe('open');

    const second = await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH' }, { counted: true });
    expect(second.status, JSON.stringify(second.error)).toBe(200);
    expect(lastStatements).toBe(4);
    expect(second.result).toMatchObject({ remaining: 0 });
    expect(second.events.find((e) => e.event_type === 'Handover')!.payload).toMatchObject({ order_item_ids: ids.slice(40), ready_alert_closed: ready_id });
    expect(alertRow(ready_id)).toMatchObject({ state: 'closed', close_reason: 'done' });

    const named = await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH', order_item_ids: ids.slice(0, 41) });
    expect(named.status).toBe(400); // named lists stay 1–40
  });
});

describe('[03b §3.5 step 2] receiver signed in (owner ruling B4-3 (a)); passScopedOrders = 02b scopedOrders', () => {
  it('[03b §3.5 step 2, B4-3] a receiver in the directory but signed out → 422 PASS_RECEIVER_INVALID, nothing written; signed in → 200; signed out again → 422', async () => {
    openDay(hub);
    const cook_ = await seed();
    const order_id = takeaway(['L1', 'L2']);
    cook(order_id, ['L1', 'L2']);
    const before = eventCount();
    expect((await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH', order_item_ids: ['L1'] })).error).toEqual({
      code: 'PASS_RECEIVER_INVALID',
      details: { receiver_staff_id: 'S_BRANCH' },
    });
    expect(eventCount()).toBe(before);
    const receiver = staffOn('S_BRANCH');
    const ok = await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH', order_item_ids: ['L1'] }, { counted: true });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(lastStatements).toBe(4); // takeaway: no currentTableOf
    endSessionNow(hub, receiver.sessionId);
    expect((await handover(cook_, { order_id, point_id: POINT, receiver_staff_id: 'S_BRANCH', order_item_ids: ['L2'] })).error).toMatchObject({ code: 'PASS_RECEIVER_INVALID' });
  });

  it('[03b R-11] passScopedOrders gives the same ScopedOrder fields as 02b scopedOrders: open seating, closed seating, none, unknown', async () => {
    openDay(hub);
    await seed();
    const open = dineIn(['D1'], 'S_OWN', 'SEAT_OPEN');
    const closedOrder = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_OPEN', lines: naans(['D2']) }).order_id;
    // close the seating of a second table's order: TableCleaned after BillClosed (02a events)
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEAT_CLOSED', holder_staff_id: 'S_OWN2' });
    const closed = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_CLOSED', lines: naans(['C1']) }).order_id;
    append(hub, [
      { stream_type: 'table', stream_id: FX.zoneTable, event_type: 'BillClosed', payload: { seating_id: 'SEAT_CLOSED' } },
    ]);
    append(hub, [{ stream_type: 'table', stream_id: FX.zoneTable, event_type: 'TableCleaned', payload: { seating_id: 'SEAT_CLOSED', table_ids: [FX.zoneTable], reason: 'cleaned', by_staff_id: 'S_OWN2' } }]);
    const none = takeaway(['T1'], 'S_OWN');
    const ids = [open, closedOrder, closed, none, 'O_NONE'];
    const ours = passScopedOrders(hub.deps.db, ids);
    const theirs = scopedOrders(hub.deps.db, ids);
    expect(hub.deps.db.prepare(`SELECT state FROM seatings WHERE seating_id = 'SEAT_CLOSED'`).get()).toEqual({ state: 'CLOSED' });
    expect(theirs.get(closed)!.holder_staff_id).toBeNull();
    expect(theirs.get(open)!.holder_staff_id).toBe('S_OWN');
    expect([...ours.keys()].sort()).toEqual([...theirs.keys()].sort());
    for (const [id, row] of theirs) {
      const mine = ours.get(id)!;
      expect({ order_id: mine.order_id, order_type: mine.order_type, placed_by: mine.placed_by, holder_staff_id: mine.holder_staff_id }, id).toEqual(row);
    }
    void closedOrder;
  });
});

// ------------------------------------------------------------------------------------------- §6.11

describe('GET /queries/pass-receivers (03b §6.11)', () => {
  it('[03b §6.11] signed-in staff whose mark-served covers the order, table team first, names; 3 statements; run-pass checked inside the handler', async () => {
    openDay(hub);
    const cook_ = await seed();
    staffOn('S_BRANCH');
    staffOn('S_OWN');
    staffOn('S_FAR');
    // S_OWN holds the seating (table team), S_BRANCH covers by branch; S_FLOOR covers but is not signed in
    const order_id = dineIn(['L1'], 'S_OWN');

    const read = statementCounter(hub.deps.readDb);
    const r = await receivers(cook_, order_id);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(read.count).toBe(3);
    expect(r.data.receivers).toEqual([
      { staff_id: 'S_OWN', name: 'Name S_OWN', table_team: true },
      { staff_id: 'S_BRANCH', name: 'Name S_BRANCH', table_team: false },
    ]);

    const cashier = staffOn('S_CASH');
    expect((await receivers(cashier, order_id)).error).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect((await receivers(cook_, 'O_NONE')).error).toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });
});

