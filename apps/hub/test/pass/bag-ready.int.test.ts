import type { EngineState } from '@pos/engine';
import type { AlertView, BranchConfig } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { activity } from '../../src/auth/session-store';
import { passClosuresTick } from '../../src/kds/ticks';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { wsHubFor } from '../../src/ws/server';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, type DeviceProfileInput, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { COOK, FX, append, appendOrder, fireLines, fixtureMenu, openDay, openSeating, serveLines, signInCook } from '../kds/fixtures';

// 03b v1.0.16 §3.5 order-level counter alert (R8, D8; run 3 R3-B-3, R3-M-9), the writer reconciliation: one counter
// alert and one R8 epoch per complete takeaway / parking bag, across every point. Tests 99, 100, 102, 103, 106, 123,
// 124 (hub parts) and 01d v1.3.7 test 113's multi-point half.

let hub: TestHub;
const clients: WsClient[] = [];
const devices = new Map<string, string>();
const engine = (): EngineState => hub.deps.state.get() as EngineState;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of clients.splice(0)) c.close();
  devices.clear();
  activity.drain();
  activity.drainDevices();
  swapBranchConfig(null);
  await hub.close();
});

/** P1 'Pass' (Karahi S1) and P2 'Grill pass' (Grill S3). */
function menu(): BranchConfig {
  const base = fixtureMenu();
  const s1 = base.stations[0]!;
  return {
    ...base,
    points: [...base.points, { point_id: 'P2', name: 'Grill pass', sort_order: 1, is_archived: false }],
    stations: [...base.stations, { ...s1, station_id: 'S3', name: 'Grill', point_id: 'P2' }],
    items: [...base.items, { ...base.items.find((i) => i.item_id === FX.naan)!, item_id: 'I_GRILL', name: 'Tikka', station_id: 'S3', sort_order: 9 }],
  };
}

interface Who { staffId: string; deviceId: string; token: string; sessionToken: string }
const TAKEAWAY: DeviceProfileInput = { access: 'everyone', screens: ['takeaway', 'cashier'] };

/** A signed-in receiver holding mark-served (the Manager), for Handover (§3.5 step 2). */
const RECEIVER = 'S_MGR';

async function start(): Promise<{ p1: Who; p2: Who }> {
  const a = await signInCook(hub, { pointId: 'P1' });
  const b = await signInCook(hub, { pointId: 'P2' });
  openDay(hub, { menu: menu() });
  openSession(hub, { kind: 'staff', staffId: RECEIVER, deviceId: pairDevice(hub, { type: 'phone', name: 'Manager phone', ownerStaffId: RECEIVER }).deviceId });
  hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  return {
    p1: { staffId: COOK.staff, deviceId: a.deviceId, token: a.token, sessionToken: a.sessionToken },
    p2: { staffId: COOK.staff, deviceId: b.deviceId, token: b.token, sessionToken: b.sessionToken },
  };
}

function device(name: string, type: 'cashier_kiosk' | 'tablet' | 'phone', profile: DeviceProfileInput): string {
  const d = pairDevice(hub, { type, name, profile });
  devices.set(d.deviceId, d.token);
  return d.deviceId;
}
const signIn = (staffId: string, deviceId: string) => openSession(hub, { kind: 'staff', staffId, deviceId, legacyProfile: false });
async function socket(deviceId: string, sessionToken?: string): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  ws.send(sessionToken === undefined ? { type: 'auth', device_token: devices.get(deviceId) } : { type: 'auth', device_token: devices.get(deviceId), session_token: sessionToken });
  await ws.untilCount(1);
  clients.push(ws);
  return ws;
}
async function fence(): Promise<void> {
  const id = `FENCE_${Math.random()}`;
  wsHubFor(hub.app).sendToDevices([...devices.keys()], { type: 'alert_seen', alert_id: id });
  for (const c of clients) for (let i = 0; i < 50 && !c.messages.some((m) => (m as { alert_id?: string }).alert_id === id); i += 1) await c.untilCount(c.messages.length + 1);
}
const alertFrames = (c: WsClient, id: string): AlertView[] =>
  (c.messages as Array<{ type: string; alert?: AlertView }>).flatMap((m) => (m.type === 'alert' && m.alert?.alert_id === id ? [m.alert] : []));

const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
function cook(order_id: string, ids: string[], o: { done?: boolean } = {}): void {
  fireLines(hub, engine().lines[ids[0]!]!.station_id, ids);
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
  if (o.done !== false) append(hub, ids.map((order_item_id) => on(order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
}

let seq = 0;
const PATHS = { MarkReadyToServe: 'mark-ready-to-serve', UndoReadyToServe: 'undo-ready-to-serve', Handover: 'handover' } as const;
async function send(who: Who, type: keyof typeof PATHS, payload: Record<string, unknown>): Promise<{ status: number; result?: Record<string, unknown>; error?: unknown }> {
  seq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${PATHS[type]}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: { command_id: `bag-${seq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: type, payload, occurred_at: hub.clock.branchNow(), actor_id: who.staffId, device_id: who.deviceId },
  });
  const body = res.json() as { data?: { result: Record<string, unknown> }; error?: unknown };
  return { status: res.statusCode, result: body.data?.result, error: body.error };
}

type Counter = { alert_id: string; state: string; close_reason: string | null; values: Record<string, unknown>; display: Record<string, unknown>; details: Record<string, unknown>; target: unknown; dedupe_key: string };
function counterAlerts(order_id: string): Counter[] {
  return (
    hub.deps.db
      .prepare(
        `SELECT alert_id, state, close_reason, values_json, display_json, details_json, target_json, dedupe_key FROM alerts
          WHERE kind = 'ready_to_serve' AND subject_stream_id = ? AND json_extract(values_json, '$.counter_screen') IS NOT NULL ORDER BY raised_seq`,
      )
      .all(order_id) as Array<{ alert_id: string; state: string; close_reason: string | null; values_json: string; display_json: string; details_json: string; target_json: string; dedupe_key: string }>
  ).map((r) => ({ alert_id: r.alert_id, state: r.state, close_reason: r.close_reason, values: JSON.parse(r.values_json), display: JSON.parse(r.display_json), details: JSON.parse(r.details_json), target: JSON.parse(r.target_json), dedupe_key: r.dedupe_key }));
}
const epoch = (order_id: string) => hub.deps.db.prepare('SELECT bag_ready_since, bag_ready_window_ms, alert_id, point_id FROM pass_bag_ready WHERE order_id = ?').get(order_id);
const bagEvents = (order_id: string) =>
  (hub.deps.db.prepare("SELECT payload, recorded_at FROM events WHERE event_type = 'PassBagReadyChanged' AND stream_id = ? ORDER BY seq").all(order_id) as Array<{ payload: string }>).map(
    (r) => (JSON.parse(r.payload) as { ready: unknown }).ready,
  );
const recordedAt = (alert_id: string) =>
  (hub.deps.db.prepare("SELECT recorded_at FROM events WHERE event_type = 'AlertRaised' AND json_extract(payload, '$.alert_id') = ?").get(alert_id) as { recorded_at: number }).recorded_at;
const stepRecipients = (alert_id: string) =>
  (JSON.parse((hub.deps.db.prepare("SELECT payload FROM events WHERE event_type IN ('AttemptSent', 'EscalationStepped') AND json_extract(payload, '$.alert_id') = ? ORDER BY seq").get(alert_id) as { payload: string }).payload) as {
    recipients: Array<{ staff_id: string | null; device_id: string | null }>;
  }).recipients;

describe('[03b v1.0.16 §3.5, R8 / D8] order-level counter alert', () => {
  it('#99: a one-point takeaway with every live line done → a point Ready and one counter alert (counter_screen takeaway, "#1", the placer and every counter device), with its epoch', async () => {
    const { p1 } = await start();
    const k = device('Kiosk K', 'cashier_kiosk', TAKEAWAY);
    const t = device('Tablet T', 'tablet', { access: 'everyone', screens: ['takeaway'] });
    device('Dine-in kiosk', 'cashier_kiosk', { access: 'everyone', screens: ['dine_in', 'cashier'] });
    const order_id = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_CASH', lines: [{ order_item_id: 'A1', item_id: FX.naan }, { order_item_id: 'A2', item_id: FX.naan }] }).order_id;
    cook(order_id, ['A1', 'A2']);
    const r = await send(p1, 'MarkReadyToServe', { order_id, point_id: 'P1' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const [c] = counterAlerts(order_id);
    expect(counterAlerts(order_id)).toHaveLength(1);
    expect(c).toMatchObject({
      state: 'open',
      dedupe_key: `counter-ready:${order_id}`,
      target: { kind: 'person', staff_id: 'S_CASH' },
      values: { order_id, point_id: 'P1', table_id: '', window_ms: 60_000, counter_screen: 'takeaway' },
      display: { table_code: '#1', point_code: 'Pass', kind_label_key: 'alert.ready_to_serve' },
      details: { identifier: '#1', lines: [{ name: 'Naan', quantity: 1, state: 'ready' }, { name: 'Naan', quantity: 1, state: 'ready' }] }, // grouped by part_of only, as the point card
    });
    expect(c!.alert_id).not.toBe(r.result!.alert_id); // the point Ready keeps its own alert
    const rows = stepRecipients(c!.alert_id);
    expect(rows.filter((x) => x.staff_id !== null).map((x) => x.staff_id)).toEqual(['S_CASH']);
    // every unrevoked device whose current profile shows `takeaway` (the Cooks' Pass tablets' legacy profiles do too)
    const shown = rows.flatMap((x) => (x.device_id === null ? [] : [x.device_id]));
    const takeawayScreens = (hub.deps.db.prepare("SELECT p.device_id FROM device_profiles p JOIN devices d USING (device_id) WHERE d.revoked_at IS NULL AND EXISTS (SELECT 1 FROM json_each(p.screens) WHERE value = 'takeaway')").all() as Array<{ device_id: string }>).map((r) => r.device_id);
    expect(shown.sort()).toEqual(takeawayScreens.sort());
    expect(shown).toEqual(expect.arrayContaining([k, t]));
    expect(epoch(order_id)).toEqual({ bag_ready_since: recordedAt(c!.alert_id), bag_ready_window_ms: 60_000, alert_id: c!.alert_id, point_id: 'P1' });
    // a dine-in order never enters this path
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    const dine = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'D1', item_id: FX.naan }] }).order_id;
    cook(dine, ['D1']);
    expect((await send(p1, 'MarkReadyToServe', { order_id: dine, point_id: 'P1' })).status).toBe(200);
    expect(counterAlerts(dine)).toEqual([]);
    expect(epoch(dine)).toBeUndefined();
  });

  it('#99 statements: the Ready command plus at most two batched reads for R8, outside 01d\'s raise / close', async () => {
    const { p1 } = await start();
    const order_id = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    cook(order_id, ['A1']);
    const counter = statementCounter(hub.deps.db);
    let inAlerts = 0;
    for (const name of ['raise', 'raiseMany', 'close', 'closeMany'] as const) {
      const original = alerts[name] as (...args: unknown[]) => unknown;
      vi.spyOn(alerts, name).mockImplementation(((...args: unknown[]) => {
        const before = counter.count;
        try {
          return original(...args);
        } finally {
          inAlerts += counter.count - before;
        }
      }) as never);
    }
    const { registerBagReadyProbe } = await import('../../src/kds/bag-ready');
    let reconcile = -1;
    registerBagReadyProbe((n) => (reconcile = n));
    expect((await send(p1, 'MarkReadyToServe', { order_id, point_id: 'P1' })).status).toBe(200);
    expect(counterAlerts(order_id)).toHaveLength(1);
    expect(reconcile, 'reconciliation reads (01d raise excluded)').toBeLessThanOrEqual(2);
    expect(inAlerts).toBeGreaterThan(0);
    registerBagReadyProbe(null);
  });

  it('#100: the placer on counter kiosk K and cashier Q on L get one card of the counter alert ("#1", details.lines) and nothing of the point Ready; a signed-out kiosk M gets the lock', async () => {
    const { p1 } = await start();
    const k = device('Kiosk K', 'cashier_kiosk', TAKEAWAY);
    const l = device('Kiosk L', 'cashier_kiosk', TAKEAWAY);
    const m = device('Kiosk M', 'cashier_kiosk', TAKEAWAY);
    const kWs = await socket(k, signIn('S_CASH', k).token);
    const lWs = await socket(l, signIn('S_MGR', l).token);
    const mWs = await socket(m);
    const order_id = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_CASH', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    cook(order_id, ['A1']);
    const r = await send(p1, 'MarkReadyToServe', { order_id, point_id: 'P1' });
    await fence();
    const [c] = counterAlerts(order_id);
    for (const ws of [kWs, lWs]) {
      const views = alertFrames(ws, c!.alert_id);
      expect(views).toHaveLength(1);
      expect(views[0]!.card).toMatchObject({ table_code: '#1', details: { identifier: '#1', lines: [{ name: 'Naan', quantity: 1, state: 'ready' }] } });
      expect(alertFrames(ws, r.result!.alert_id as string)).toEqual([]);
    }
    const lock = alertFrames(mWs, c!.alert_id);
    expect(lock).toHaveLength(1);
    expect(lock[0]).not.toHaveProperty('card');
    expect(lock[0]!.lock).toMatchObject({ kind_label_key: 'alert.ready_to_serve.lock', table_code: '#1', point_code: 'Pass' });
  });

  it('#102 / 01d #113: B Ready before A finishes → silent; A Ready → one counter alert; Undo B → it closes and the epoch goes, A keeps its Ready; B Ready again → a new step 0 and epoch', async () => {
    const { p1, p2 } = await start();
    const order_id = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }, { order_item_id: 'G1', item_id: 'I_GRILL' }] }).order_id;
    cook(order_id, ['G1']);
    cook(order_id, ['A1'], { done: false });
    expect((await send(p2, 'MarkReadyToServe', { order_id, point_id: 'P2' })).status).toBe(200);
    expect(counterAlerts(order_id)).toEqual([]);
    append(hub, [on(order_id, 'ItemDone', { order_item_id: 'A1', done_at: hub.clock.branchNow(), source: 'tap' })]);
    expect(counterAlerts(order_id), 'A done but not Ready: still silent').toEqual([]);
    expect((await send(p1, 'MarkReadyToServe', { order_id, point_id: 'P1' })).status).toBe(200);
    const [first] = counterAlerts(order_id);
    expect(counterAlerts(order_id)).toHaveLength(1);
    expect(first!.values.point_id, 'escalation at the completing Ready').toBe('P1');
    expect(epoch(order_id)).toMatchObject({ alert_id: first!.alert_id });

    expect((await send(p2, 'UndoReadyToServe', { order_id, point_id: 'P2' })).status).toBe(200);
    expect(counterAlerts(order_id)[0]).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
    expect(epoch(order_id)).toBeUndefined();
    expect(hub.deps.db.prepare("SELECT ready_at IS NOT NULL AS r FROM pass_orders WHERE order_id = ? AND point_id = 'P1'").get(order_id)).toEqual({ r: 1 });

    hub.clock.advance(5_000);
    expect((await send(p2, 'MarkReadyToServe', { order_id, point_id: 'P2' })).status).toBe(200);
    const all = counterAlerts(order_id);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ state: 'open', values: { point_id: 'P2' } });
    expect(epoch(order_id)).toMatchObject({ alert_id: all[1]!.alert_id, bag_ready_since: recordedAt(all[1]!.alert_id) });
    expect(bagEvents(order_id).map((x) => x === null)).toEqual([false, true, false]);
  });

  it('#103: a line made un-done closes the counter alert and the epoch in that commit; done again → one fresh epoch; a repeated check of a complete epoch writes nothing, also after the alert expired', async () => {
    const { p1 } = await start();
    const order_id = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }, { order_item_id: 'A2', item_id: FX.naan }] }).order_id;
    cook(order_id, ['A1', 'A2']);
    await send(p1, 'MarkReadyToServe', { order_id, point_id: 'P1' });
    append(hub, [on(order_id, 'ItemDoneUndone', { order_item_id: 'A2' })]);
    expect(counterAlerts(order_id)[0]).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
    expect(epoch(order_id)).toBeUndefined();
    append(hub, [on(order_id, 'ItemDone', { order_item_id: 'A2', done_at: hub.clock.branchNow(), source: 'tap' })]);
    expect(counterAlerts(order_id)).toHaveLength(2);
    const fresh = counterAlerts(order_id)[1]!;
    // repeated checks (another event on the order) write nothing
    const before = bagEvents(order_id).length;
    append(hub, [on(order_id, 'ItemStarted', { order_item_id: 'A1', started_at: hub.clock.branchNow(), source: 'tap' })]);
    expect(bagEvents(order_id)).toHaveLength(before);
    // day-close expiry keeps the pair and never re-alerts
    append(hub, [{ stream_type: 'hub', stream_id: 'branch-1', event_type: 'AlertClosed', payload: { alert_id: fresh.alert_id, reason: 'expired', by_staff_id: null, note: null } }]);
    expect(epoch(order_id)).toMatchObject({ alert_id: null });
    append(hub, [on(order_id, 'ItemStarted', { order_item_id: 'A2', started_at: hub.clock.branchNow(), source: 'tap' })]);
    expect(counterAlerts(order_id)).toHaveLength(2);
    // a new incompleteness clears the pair even after expiry
    append(hub, [on(order_id, 'ItemDoneUndone', { order_item_id: 'A1' })]);
    expect(epoch(order_id)).toBeUndefined();
  });

  it('#106 / #123: a Handover-only Ready (alert_id null) or a direct serve without any Ready starts no counter alert', async () => {
    const { p1 } = await start();
    const order_id = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    cook(order_id, ['A1']);
    const h = await send(p1, 'Handover', { order_id, point_id: 'P1', receiver_staff_id: RECEIVER });
    expect(h.status, JSON.stringify(h.error)).toBe(200);
    expect(counterAlerts(order_id)).toEqual([]);
    const other = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: FX.naan }] }).order_id;
    cook(other, ['B1']);
    serveLines(hub, other, ['B1']);
    expect(counterAlerts(other)).toEqual([]);
    expect(bagEvents(other)).toEqual([]);
  });

  it('#124: parking — Handover keeps the Ready; the estimate serves the lines → pass_closures closes the point Ready and the reconciliation closes R8 done and clears the clock', async () => {
    const { p1 } = await start();
    const order_id = appendOrder(hub, { order_type: 'parking', car_number: 'LEB 1', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    cook(order_id, ['A1']);
    const r = await send(p1, 'MarkReadyToServe', { order_id, point_id: 'P1' });
    const [c] = counterAlerts(order_id);
    expect(c).toMatchObject({ values: { counter_screen: 'parking' }, display: { table_code: 'PARKING' } });
    expect((await send(p1, 'Handover', { order_id, point_id: 'P1', receiver_staff_id: RECEIVER })).status).toBe(200);
    expect(hub.deps.db.prepare('SELECT state FROM alerts WHERE alert_id = ?').get(r.result!.alert_id)).toEqual({ state: 'open' });
    serveLines(hub, order_id, ['A1'], 'estimated');
    expect(counterAlerts(order_id)[0]).toMatchObject({ state: 'closed', close_reason: 'done' });
    expect(epoch(order_id)).toBeUndefined();
    const now = hub.clock.branchNow();
    hub.deps.writer.run((tx) => tx.append(passClosuresTick.intents(tx, tx.state as EngineState, now)));
    expect(hub.deps.db.prepare('SELECT state, close_reason FROM alerts WHERE alert_id = ?').get(r.result!.alert_id)).toEqual({ state: 'closed', close_reason: 'done' });
  });
});
