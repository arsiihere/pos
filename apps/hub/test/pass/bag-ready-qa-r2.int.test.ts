import type { EngineState } from '@pos/engine';
import type { AlertView, BranchConfig } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { wsHubFor } from '../../src/ws/server';
import { createTestHub, openSession, pairDevice, type DeviceProfileInput, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { COOK, FX, append, appendOrder, fireLines, fixtureMenu, openDay, signInCook } from '../kds/fixtures';

// 03b v1.0.20 (owner 2026-11-28 QA-R2; 01d v1.3.9 excludesStaff), tests 133–136: a pickup order's per-point Ready tells
// nobody; the counter alert fires once per WHOLE token bag (root + additions), one alert per bag; its people are
// order-taking staff and managers only.

let hub: TestHub;
const clients: WsClient[] = [];
const devices = new Map<string, string>();
const engine = (): EngineState => hub.deps.state.get() as EngineState;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  devices.clear();
  activity.drain();
  activity.drainDevices();
  swapBranchConfig(null);
  await hub.close();
});

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

async function start(): Promise<{ p1: Who; p2: Who }> {
  const a = await signInCook(hub, { pointId: 'P1' });
  const b = await signInCook(hub, { pointId: 'P2' });
  openDay(hub, { menu: menu() });
  hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  return {
    p1: { staffId: COOK.staff, deviceId: a.deviceId, token: a.token, sessionToken: a.sessionToken },
    p2: { staffId: COOK.staff, deviceId: b.deviceId, token: b.token, sessionToken: b.sessionToken },
  };
}

function device(name: string, type: 'cashier_kiosk' | 'tablet' | 'phone', profile: DeviceProfileInput, ownerStaffId?: string): string {
  const d = pairDevice(hub, { type, name, profile, ...(ownerStaffId === undefined ? {} : { ownerStaffId }) });
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
const readyFrames = (c: WsClient): AlertView[] =>
  (c.messages as Array<{ type: string; alert?: AlertView }>).flatMap((m) => (m.type === 'alert' && m.alert?.kind === 'ready_to_serve' ? [m.alert] : []));

const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
function cook(order_id: string, ids: string[], o: { done?: boolean } = {}): void {
  fireLines(hub, engine().lines[ids[0]!]!.station_id, ids);
  append(hub, ids.map((order_item_id) => on(order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
  if (o.done !== false) append(hub, ids.map((order_item_id) => on(order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow() + 1_000, source: 'tap' })));
}

let seq = 0;
async function send(who: Who, type: 'MarkReadyToServe', payload: Record<string, unknown>): Promise<{ status: number; result?: Record<string, unknown>; error?: unknown }> {
  seq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/mark-ready-to-serve',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: { command_id: `qa-r2-${seq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: type, payload, occurred_at: hub.clock.branchNow(), actor_id: who.staffId, device_id: who.deviceId },
  });
  const body = res.json() as { data?: { result: Record<string, unknown> }; error?: unknown };
  return { status: res.statusCode, result: body.data?.result, error: body.error };
}

const counterAlerts = (order_id?: string) =>
  hub.deps.db
    .prepare(
      `SELECT alert_id, state, close_reason, subject_stream_id AS subject, details_json FROM alerts
        WHERE kind = 'ready_to_serve' AND json_extract(values_json, '$.counter_screen') IS NOT NULL ${order_id === undefined ? '' : 'AND subject_stream_id = @o'} ORDER BY raised_seq`,
    )
    .all(order_id === undefined ? {} : { o: order_id }) as Array<{ alert_id: string; state: string; close_reason: string | null; subject: string; details_json: string }>;
const epoch = (order_id: string) => hub.deps.db.prepare('SELECT alert_id FROM pass_bag_ready WHERE order_id = ?').get(order_id) as { alert_id: string } | undefined;
const recipientsOf = (alert_id: string) =>
  (hub.deps.db.prepare("SELECT payload FROM events WHERE event_type IN ('AttemptSent', 'EscalationStepped') AND json_extract(payload, '$.alert_id') = ? ORDER BY seq").all(alert_id) as Array<{ payload: string }>).flatMap(
    (r) => (JSON.parse(r.payload) as { recipients: Array<{ staff_id: string | null; device_id: string | null }> }).recipients,
  );
const recordedAt = (alert_id: string) =>
  (hub.deps.db.prepare("SELECT recorded_at FROM events WHERE event_type = 'AlertRaised' AND json_extract(payload, '$.alert_id') = ?").get(alert_id) as { recorded_at: number }).recorded_at;
async function tickAt(t: number): Promise<void> {
  const { alertsTick } = await import('../../src/alerts/tick');
  hub.clock.set(t);
  hub.deps.writer.run((tx) => tx.append(alertsTick.intents(tx, tx.state as never, t)));
}

describe('[03b v1.0.20 QA-R2] pickup alerts: whole bag, one alert, counter and managers only', () => {
  it('#133 (BUG-4): Ready of the done line while another cooks → no counter alert, and the point Ready reaches nobody, also at 2× (no escalation)', async () => {
    const { p1 } = await start();
    const k = device('Kiosk K', 'cashier_kiosk', TAKEAWAY);
    const m = device('Kiosk M', 'cashier_kiosk', TAKEAWAY);
    const phone = device('Manager phone', 'phone', { access: 'everyone', screens: ['dine_in'] }, 'S_MGR');
    const kWs = await socket(k, signIn('S_CASH', k).token);
    const mWs = await socket(m);
    const phoneWs = await socket(phone, signIn('S_MGR', phone).token);
    const order_id = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_CASH', lines: [{ order_item_id: 'A1', item_id: FX.naan }, { order_item_id: 'A2', item_id: FX.naan }] }).order_id;
    cook(order_id, ['A1']);
    cook(order_id, ['A2'], { done: false });
    const r = await send(p1, 'MarkReadyToServe', { order_id, point_id: 'P1', order_item_ids: ['A1'] });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(counterAlerts(order_id)).toEqual([]);
    const point = r.result!.alert_id as string;
    expect(recipientsOf(point)).toEqual([]);
    const window = 60_000;
    await tickAt(recordedAt(point) + window);
    await tickAt(recordedAt(point) + 2 * window);
    expect(recipientsOf(point)).toEqual([]);
    await fence();
    for (const ws of [kWs, mWs, phoneWs]) expect(readyFrames(ws)).toEqual([]);
  });

  it('#134 (BUG-4, BUG-18): root Ready while its addition cooks → silent; addition Ready → ONE counter alert for the token (both orders\' lines), both epochs share it; another addition → closed obsolete, both epochs clear', async () => {
    const { p1, p2 } = await start();
    const root = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_CASH', lines: [{ order_item_id: 'R1', item_id: FX.naan }] }).order_id;
    const add = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_CASH', adds_to_order_id: root, lines: [{ order_item_id: 'N1', item_id: 'I_GRILL' }] }).order_id;
    cook(root, ['R1']);
    cook(add, ['N1'], { done: false });
    expect((await send(p1, 'MarkReadyToServe', { order_id: root, point_id: 'P1' })).status).toBe(200);
    expect(counterAlerts(), 'the token still cooks: no Bag ready').toEqual([]);
    expect(epoch(root)).toBeUndefined();
    append(hub, [on(add, 'ItemDone', { order_item_id: 'N1', done_at: hub.clock.branchNow(), source: 'tap' })]);
    expect((await send(p2, 'MarkReadyToServe', { order_id: add, point_id: 'P2' })).status).toBe(200);
    const all = counterAlerts();
    expect(all).toHaveLength(1);
    expect(all[0]!.subject).toBe(root);
    const lines = (JSON.parse(all[0]!.details_json) as { lines: Array<{ name: string }> }).lines.map((l) => l.name).sort();
    expect(lines).toEqual(['Naan', 'Tikka']);
    expect(epoch(root)?.alert_id).toBe(all[0]!.alert_id);
    expect(epoch(add)?.alert_id).toBe(all[0]!.alert_id);
    // a second addition drops the bag back to cooking
    appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_CASH', adds_to_order_id: root, lines: [{ order_item_id: 'N2', item_id: FX.naan }] });
    expect(counterAlerts()).toMatchObject([{ state: 'closed', close_reason: 'obsolete' }]);
    expect(epoch(root)).toBeUndefined();
    expect(epoch(add)).toBeUndefined();
  });

  it('#135 (BUG-18): a two-point token bag escalated at 2× → the manager is told about it once', async () => {
    const { p1, p2 } = await start();
    const phone = device('Manager phone', 'phone', { access: 'everyone', screens: ['dine_in'] }, 'S_MGR');
    const phoneWs = await socket(phone, signIn('S_MGR', phone).token);
    const order_id = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_CASH', lines: [{ order_item_id: 'A1', item_id: FX.naan }, { order_item_id: 'G1', item_id: 'I_GRILL' }] }).order_id;
    cook(order_id, ['A1']);
    cook(order_id, ['G1']);
    await send(p1, 'MarkReadyToServe', { order_id, point_id: 'P1' });
    await send(p2, 'MarkReadyToServe', { order_id, point_id: 'P2' });
    const [c] = counterAlerts(order_id);
    await tickAt(recordedAt(c!.alert_id) + 60_000);
    await tickAt(recordedAt(c!.alert_id) + 120_000);
    await fence();
    const ids = new Set(readyFrames(phoneWs).map((a) => a.alert_id));
    expect([...ids]).toEqual([c!.alert_id]);
  });

  it('#136 (BUG-14): the counter alert names the placer and managers, never the Cook at the point; the Cook\'s counter-screen Pass tablet socket gets nothing, a Cashier on a kiosk gets the card', async () => {
    const { p1 } = await start();
    const k = device('Kiosk K', 'cashier_kiosk', TAKEAWAY);
    const kSession = signIn('S_CASH', k).token;
    const kWs = await socket(k, kSession);
    const t = device('Cook tablet', 'tablet', { access: 'everyone', screens: ['takeaway'] });
    const cookSession = signIn(COOK.staff, t).token;
    const tWs = await socket(t, cookSession);
    const order_id = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_CASH', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    cook(order_id, ['A1']);
    expect((await send(p1, 'MarkReadyToServe', { order_id, point_id: 'P1' })).status).toBe(200);
    const [c] = counterAlerts(order_id);
    await tickAt(recordedAt(c!.alert_id) + 120_000);
    const people = recipientsOf(c!.alert_id).flatMap((r) => (r.staff_id === null ? [] : [r.staff_id]));
    expect(people).toContain('S_CASH');
    expect(people).toContain('S_MGR');
    expect(people).not.toContain(COOK.staff);
    await fence();
    expect(alertFrames(tWs, c!.alert_id)).toEqual([]);
    expect(alertFrames(kWs, c!.alert_id)[0]?.card).toBeDefined();
    // 01d v1.3.9 test 125: a reconnect's catch-up carries nothing of it for the Cook, the Cashier's does
    const again = await socket(t, cookSession);
    const kAgain = await socket(k, kSession);
    await fence();
    expect(JSON.stringify(again.messages)).not.toContain(c!.alert_id);
    expect(JSON.stringify(kAgain.messages)).toContain(c!.alert_id);
    // the Cook's inbox on that tablet lists nothing of it
    const inbox = await hub.app.inject({ method: 'GET', url: '/queries/alerts-inbox', headers: { authorization: `Bearer ${devices.get(t)}`, 'x-session-token': cookSession } });
    expect(inbox.statusCode).toBe(200);
    expect((inbox.json() as { data: { alerts: Array<{ alert_id: string }> } }).data.alerts.map((a) => a.alert_id)).not.toContain(c!.alert_id);
  });
});
