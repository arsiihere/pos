import { UNDO_DONE_MS } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type { BranchConfig } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { markReadyToServeCommand, undoReadyToServeCommand } from '../../src/kds/commands/ready';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { COOK, FX, append, appendOrder, fireLines, openDay, openSeating, pairKds, serveLines, signInCook } from '../kds/fixtures';

// 03b §3.5 MarkReadyToServe / UndoReadyToServe, §6.6 (Statements 4), §6.7 (Statements 2); tests #20, #21, #23, #28.
// Orders, seatings and engine progress are real events through the writer; the commands go through the real route.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;
/** statements spent inside 01d's raise / close during the counted call (01d's own bounds, not 03b's count) */
let alertStatements = 0;
const clients: WsClient[] = [];

const POINT = 'P1';
const engine = (): EngineState => hub.deps.state.get() as EngineState;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  // The real handlers under test-only names, so their own statements are counted (02a R-2D-6 pattern).
  for (const [def, type] of [
    [markReadyToServeCommand, 'TestMarkReadyCounted'],
    [undoReadyToServeCommand, 'TestUndoReadyCounted'],
  ] as const) {
    commandRegistry(hub.app).register(
      defineCommand({
        ...(def as typeof markReadyToServeCommand),
        commandType: type,
        handle(ctx, payload, cmd) {
          const before = counter.count;
          alertStatements = 0;
          try {
            return (def as typeof markReadyToServeCommand).handle(ctx, payload, cmd);
          } finally {
            lastStatements = counter.count - before - alertStatements;
          }
        },
      }),
    );
  }
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
  for (const c of clients.splice(0)) c.close();
  swapBranchConfig(null);
  await hub.close();
});

// ------------------------------------------------------------------------------------------- seeding

const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });

function cook(order_id: string, ids: string[], o: { done?: boolean } = {}): void {
  const station_id = engine().lines[ids[0]!]!.station_id;
  fireLines(hub, station_id, ids);
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
  if (o.done !== false) append(hub, ids.map((order_item_id) => on(order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
}

/** A dine-in on table T2 (no zone: lines on S1, point P1), held by S_WAIT. */
function dineIn(ids: string[]): string {
  openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
  return appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: ids.map((order_item_id) => ({ order_item_id, item_id: FX.naan })) }).order_id;
}
function takeaway(ids: string[], placed_by = 'S_WAIT'): string {
  return appendOrder(hub, { order_type: 'takeaway', placed_by, lines: ids.map((order_item_id) => ({ order_item_id, item_id: FX.naan })) }).order_id;
}

function withConfig(change: (c: BranchConfig) => BranchConfig): void {
  const next = change(branchConfig()!);
  swapBranchConfig({ config: next, snapshotHash: 'a'.repeat(64), configVersion: next.config_version, snapshotSchemaVersion: 4, appliedAt: hub.clock.branchNow() });
}

interface AlertRow {
  kind: string;
  state: string;
  close_reason: string | null;
  target_json: string;
  values_json: string;
  display_json: string;
  details_json: string | null;
  dedupe_key: string;
  subject_stream_type: string;
  subject_stream_id: string;
}
const alertRow = (alert_id: string) =>
  hub.deps.db
    .prepare('SELECT kind, state, close_reason, target_json, values_json, display_json, details_json, dedupe_key, subject_stream_type, subject_stream_id FROM alerts WHERE alert_id = ?')
    .get(alert_id) as AlertRow;
const passOrder = (order_id: string) => hub.deps.db.prepare('SELECT ready_at, ready_by, ready_alert_id, ready_table_id FROM pass_orders WHERE order_id = ? AND point_id = ?').get(order_id, POINT);
const eventCount = (): number => (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;

// ------------------------------------------------------------------------------------------- calls

interface Who {
  staffId: string | null;
  deviceId: string;
  token: string;
  sessionToken: string;
}

async function cookSignedIn(): Promise<Who> {
  const c = await signInCook(hub, { pointId: POINT });
  return { staffId: COOK.staff, deviceId: c.deviceId, token: c.token, sessionToken: c.sessionToken };
}
function staffOn(staffId: string): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}
async function stationOn(stationId: string): Promise<Who> {
  const device = pairKds(hub, { stationId });
  const res = await hub.app.inject({ method: 'POST', url: '/auth/station', headers: { authorization: `Bearer ${device.token}` } });
  const body = res.json() as { data: { session_token: string } };
  return { staffId: null, deviceId: device.deviceId, token: device.token, sessionToken: body.data.session_token };
}
async function online(who: Who): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  clients.push(ws);
  ws.send({ type: 'auth', device_token: who.token, session_token: who.sessionToken });
  await ws.untilCount(1);
  return ws;
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
  result: Record<string, unknown> | undefined;
  events: Stored[];
  error?: { code: string; details: Record<string, unknown> };
}

const PATHS = {
  MarkReadyToServe: 'mark-ready-to-serve',
  UndoReadyToServe: 'undo-ready-to-serve',
  TestMarkReadyCounted: 'test-mark-ready-counted',
  TestUndoReadyCounted: 'test-undo-ready-counted',
  ReturnToKitchen: 'return-to-kitchen',
} as const;
let commandSeq = 0;

async function send(who: Who, type: keyof typeof PATHS, payload: Record<string, unknown>): Promise<Reply> {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${PATHS[type]}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: `cmd-${commandSeq}`,
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
            .prepare(`SELECT event_type, stream_type, stream_id, actor_id, device_id, payload AS p FROM events WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`)
            .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Stored, 'payload'> & { p: string }>
        ).map(({ p, ...rest }) => ({ ...rest, payload: JSON.parse(p) as Record<string, unknown> }));
  return { status: res.statusCode, result: body.data?.result, events, ...(body.error === undefined ? {} : { error: { code: body.error.code, details: body.error.details } }) };
}
const ready = (who: Who, order_id: string, o: { counted?: boolean; point_id?: string } = {}) =>
  send(who, o.counted === true ? 'TestMarkReadyCounted' : 'MarkReadyToServe', { order_id, point_id: o.point_id ?? POINT });
const undo = (who: Who, order_id: string, o: { counted?: boolean; point_id?: string } = {}) =>
  send(who, o.counted === true ? 'TestUndoReadyCounted' : 'UndoReadyToServe', { order_id, point_id: o.point_id ?? POINT });

/** The first `alert` frame for `alert_id` on `ws` (frames go out after the commit). */
async function cardFrame(ws: WsClient, alert_id: string): Promise<Record<string, unknown>> {
  const find = () =>
    (ws.messages as Array<{ type: string; alert?: { alert_id: string } & Record<string, unknown> }>).find((m) => m.type === 'alert' && m.alert?.alert_id === alert_id)?.alert;
  for (let i = 0; i < 50 && find() === undefined; i += 1) await ws.untilCount(ws.messages.length + 1);
  return find()!;
}

// ------------------------------------------------------------------------------------------- MarkReadyToServe

describe('MarkReadyToServe (03b §3.5, §6.6)', () => {
  it('[03b #20] dine-in → table_team direct on the current primary table, window_ms from settings; the alert row and the card frame carry details.identifier; second tap { already: true }; 4 statements', async () => {
    openDay(hub);
    withConfig((c) => ({ ...c, engine_settings: { ...c.engine_settings, ready_window_ms: 90_000 } }));
    const waiter = staffOn('S_WAIT');
    const ws = await online(waiter);
    const cookWho = await cookSignedIn();
    const order_id = dineIn(['L1', 'L2', 'L3']);
    cook(order_id, ['L1', 'L2']);
    cook(order_id, ['L3'], { done: false }); // cooking: a live line at the point, still part of the Ready

    const reply = await ready(cookWho, order_id, { counted: true });
    expect(reply.status, JSON.stringify(reply.error)).toBe(200);
    expect(lastStatements).toBe(4);
    const alert_id = reply.result!.alert_id as string;
    expect(reply.result).toEqual({ alert_id });

    const types = reply.events.map((e) => e.event_type);
    expect(types).toContain('AlertRaised');
    expect(types[types.length - 1]).toBe('ReadyToServe');
    const readyEvent = reply.events.find((e) => e.event_type === 'ReadyToServe')!;
    expect(readyEvent).toMatchObject({ stream_type: 'order', stream_id: order_id, actor_id: COOK.staff, device_id: cookWho.deviceId });
    expect(readyEvent.payload).toEqual({ order_id, point_id: POINT, order_item_ids: ['L1', 'L2', 'L3'], table_id: FX.table, alert_id });

    const row = alertRow(alert_id);
    expect(row).toMatchObject({ kind: 'ready_to_serve', state: 'open', subject_stream_type: 'order', subject_stream_id: order_id, dedupe_key: `${order_id}:${POINT}:${FX.table}` });
    expect(JSON.parse(row.target_json)).toEqual({ kind: 'table_team', table_id: FX.table, depth: 'direct' });
    expect(JSON.parse(row.values_json)).toEqual({ order_id, point_id: POINT, table_id: FX.table, window_ms: 90_000 });
    expect(JSON.parse(row.display_json)).toMatchObject({ table_code: null, point_code: 'Pass', kind_label_key: 'alert.ready_to_serve' });
    expect(JSON.parse(row.details_json!)).toEqual({ identifier: 'T2' });
    expect(passOrder(order_id)).toMatchObject({ ready_by: COOK.staff, ready_alert_id: alert_id, ready_table_id: FX.table });

    const card = await cardFrame(ws, alert_id);
    expect((card.card as { details: unknown }).details).toEqual({ identifier: 'T2' });

    const before = eventCount();
    const again = await ready(cookWho, order_id);
    expect(again.status).toBe(200);
    expect(again.result).toEqual({ alert_id, already: true });
    expect(eventCount()).toBe(before);
  });

  it('[03b #20] all-digit table name → table_code and identifier "T4"; default window_ms 60 000', async () => {
    openDay(hub);
    withConfig((c) => ({ ...c, floors: c.floors.map((f) => ({ ...f, tables: f.tables.map((t) => (t.table_id === FX.table ? { ...t, name: '4' } : t)) })) }));
    const cookWho = await cookSignedIn();
    const order_id = dineIn(['L1']);
    cook(order_id, ['L1']);
    const reply = await ready(cookWho, order_id);
    const row = alertRow(reply.result!.alert_id as string);
    expect(JSON.parse(row.display_json)).toMatchObject({ table_code: '4' });
    expect(JSON.parse(row.details_json!)).toEqual({ identifier: 'T4' });
    expect(JSON.parse(row.values_json)).toMatchObject({ window_ms: 60_000 });
  });

  it('[03b #21] takeaway → person placed_by; the card shows the token "#1"; 3 statements (no currentTableOf)', async () => {
    openDay(hub);
    const taker = staffOn('S_CASH');
    const ws = await online(taker);
    const cookWho = await cookSignedIn();
    const order_id = takeaway(['L1'], 'S_CASH');
    cook(order_id, ['L1']);

    const reply = await ready(cookWho, order_id, { counted: true });
    expect(reply.status, JSON.stringify(reply.error)).toBe(200);
    expect(lastStatements).toBe(3);
    const alert_id = reply.result!.alert_id as string;
    const row = alertRow(alert_id);
    expect(JSON.parse(row.target_json)).toEqual({ kind: 'person', staff_id: 'S_CASH' });
    expect(JSON.parse(row.values_json)).toEqual({ order_id, point_id: POINT, table_id: '', window_ms: 60_000 });
    expect(row.dedupe_key).toBe(`${order_id}:${POINT}:-`);
    expect(JSON.parse(row.details_json!)).toEqual({ identifier: '#1' });
    expect(JSON.parse(row.display_json)).toMatchObject({ table_code: null, point_code: 'Pass' });
    expect(reply.events.find((e) => e.event_type === 'ReadyToServe')!.payload).toMatchObject({ table_id: null, alert_id });
    const card = await cardFrame(ws, alert_id);
    expect((card.card as { details: unknown }).details).toEqual({ identifier: '#1' });
  });

  it('[03b §3.5 step 2] ready lines leave out served and handed-over lines; none left → ITEM_WRONG_STAGE { stage: served }', async () => {
    openDay(hub);
    const cookWho = await cookSignedIn();
    const order_id = takeaway(['L1', 'L2', 'L3']);
    cook(order_id, ['L1', 'L2', 'L3']);
    serveLines(hub, order_id, ['L1']);
    append(hub, [on(order_id, 'Handover', { handover_id: 'H1', order_id, point_id: POINT, receiver_staff_id: 'S_WAIT', order_item_ids: ['L2'], alert_id: 'A_CARD', ready_alert_closed: null })]);

    const reply = await ready(cookWho, order_id);
    expect(reply.status).toBe(200);
    expect(reply.events.find((e) => e.event_type === 'ReadyToServe')!.payload).toMatchObject({ order_item_ids: ['L3'] });

    const other = takeaway(['M1']);
    cook(other, ['M1']);
    serveLines(hub, other, ['M1']);
    const before = eventCount();
    const none = await ready(cookWho, other);
    expect(none.status).toBe(409);
    expect(none.error).toMatchObject({ code: 'ITEM_WRONG_STAGE', details: { stage: 'served' } });
    expect(eventCount()).toBe(before);
  });

  it('[03b §3.5 step 1] unknown or archived point → POINT_NOT_FOUND; order not in the engine → ORDER_NOT_IN_ENGINE', async () => {
    openDay(hub);
    const cookWho = await cookSignedIn();
    const order_id = takeaway(['L1']);
    cook(order_id, ['L1']);
    expect((await ready(cookWho, order_id, { point_id: 'P_NONE' })).error).toMatchObject({ code: 'POINT_NOT_FOUND', details: { point_id: 'P_NONE' } });
    expect((await ready(cookWho, 'O_NONE')).error).toMatchObject({ code: 'ORDER_NOT_IN_ENGINE', details: { order_id: 'O_NONE' } });
    withConfig((c) => ({ ...c, points: c.points.map((p) => ({ ...p, is_archived: true })) }));
    expect((await ready(cookWho, order_id)).error).toMatchObject({ code: 'POINT_NOT_FOUND', details: { point_id: POINT } });
  });

  it('[03b #28] a station session calling MarkReadyToServe / UndoReadyToServe → PERMISSION_DENIED { session_kind: station }; staff without run-pass → PERMISSION_DENIED', async () => {
    openDay(hub);
    await cookSignedIn(); // seeds the directory
    const order_id = takeaway(['L1']);
    cook(order_id, ['L1']);
    const station = await stationOn(FX.station);
    for (const call of [ready, undo]) {
      const reply = await call(station, order_id);
      expect(reply.status).toBe(403);
      expect(reply.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'run-pass', session_kind: 'station' } });
    }
    const cashier = staffOn('S_CASH');
    expect((await ready(cashier, order_id)).error).toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

// ------------------------------------------------------------------------------------------- UndoReadyToServe

describe('UndoReadyToServe (03b §3.5, §6.7)', () => {
  it('[03b #23] a Handover since the Ready of a line added after it (not one of its own lines) → PASS_UNDO_WINDOW_CLOSED', async () => {
    openDay(hub);
    const cookWho = await cookSignedIn();
    const owner = staffOn('S_OWNER');
    const order_id = takeaway(['L1', 'L2']);
    cook(order_id, ['L1', 'L2']);
    serveLines(hub, order_id, ['L1']);
    const alert_id = (await ready(cookWho, order_id)).result!.alert_id as string; // own lines: L2
    // 02b's real ReturnToKitchen (fix) adds R1 to the order after the Ready
    const ret = await send(owner, 'ReturnToKitchen', { order_item_id: 'L1', return_order_item_id: 'R1', mode: 'fix' });
    expect(ret.status, JSON.stringify(ret.error)).toBe(200);
    cook(order_id, ['R1']);
    append(hub, [on(order_id, 'Handover', { handover_id: 'H1', order_id, point_id: POINT, receiver_staff_id: 'S_WAIT', order_item_ids: ['R1'], alert_id: 'A_CARD', ready_alert_closed: null })]);
    expect(hub.clock.branchNow() - (passOrder(order_id) as { ready_at: number }).ready_at).toBeLessThanOrEqual(UNDO_DONE_MS);

    const before = eventCount();
    const reply = await undo(cookWho, order_id, { counted: true });
    expect(reply.error).toEqual({ code: 'PASS_UNDO_WINDOW_CLOSED', details: { order_id, point_id: POINT } });
    expect(lastStatements).toBe(2);
    expect(eventCount()).toBe(before);
    expect(alertRow(alert_id).state).toBe('open');
  });

  it('[03b #23] ≤ 30 s → ReadyToServeUndone + alert closed undone; 2 statements; the Ready is gone', async () => {
    openDay(hub);
    const cookWho = await cookSignedIn();
    const order_id = takeaway(['L1']);
    cook(order_id, ['L1']);
    const alert_id = (await ready(cookWho, order_id)).result!.alert_id as string;
    hub.clock.advance(UNDO_DONE_MS);

    const reply = await undo(cookWho, order_id, { counted: true });
    expect(reply.status, JSON.stringify(reply.error)).toBe(200);
    expect(lastStatements).toBe(2);
    expect(reply.result).toEqual({ alert_id });
    expect(reply.events.map((e) => e.event_type)).toEqual(['ReadyToServeUndone', 'AlertClosed']);
    expect(reply.events[0]!.payload).toEqual({ order_id, point_id: POINT, alert_id });
    expect(reply.events[1]!.payload).toMatchObject({ alert_id, reason: 'undone' });
    expect(alertRow(alert_id)).toMatchObject({ state: 'closed', close_reason: 'undone' });
    expect(passOrder(order_id)).toEqual({ ready_at: null, ready_by: null, ready_alert_id: null, ready_table_id: null });

    // a fresh Ready after the undo raises a new alert
    const again = await ready(cookWho, order_id);
    expect(again.result!.alert_id).not.toBe(alert_id);
  });

  it('[03b #23] later than 30 s, no open Ready, or a Handover since → PASS_UNDO_WINDOW_CLOSED, nothing written', async () => {
    openDay(hub);
    const cookWho = await cookSignedIn();
    const late = takeaway(['L1']);
    cook(late, ['L1']);
    await ready(cookWho, late);
    hub.clock.advance(UNDO_DONE_MS + 1);
    const before = eventCount();
    const reply = await undo(cookWho, late);
    expect(reply.status).toBe(409);
    expect(reply.error).toEqual({ code: 'PASS_UNDO_WINDOW_CLOSED', details: { order_id: late, point_id: POINT } });
    expect(eventCount()).toBe(before);

    const none = takeaway(['M1']);
    expect((await undo(cookWho, none)).error).toMatchObject({ code: 'PASS_UNDO_WINDOW_CLOSED' });

    const handed = takeaway(['N1', 'N2']);
    cook(handed, ['N1', 'N2']);
    const alert_id = (await ready(cookWho, handed)).result!.alert_id as string;
    append(hub, [on(handed, 'Handover', { handover_id: 'H1', order_id: handed, point_id: POINT, receiver_staff_id: 'S_WAIT', order_item_ids: ['N1'], alert_id: 'A_CARD', ready_alert_closed: null })], {
      advanceMs: 1,
    });
    expect((await undo(cookWho, handed)).error).toMatchObject({ code: 'PASS_UNDO_WINDOW_CLOSED' });
    expect(alertRow(alert_id).state).toBe('open');

    expect((await undo(cookWho, handed, { point_id: 'P_NONE' })).error).toMatchObject({ code: 'POINT_NOT_FOUND' });
  });
});
