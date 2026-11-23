import type { PosEvent } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { activity } from '../../src/auth/session-store';
import { wsHubFor } from '../../src/ws/server';
import { endSessionNow, openSession, pairDevice, type DeviceProfileInput, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { post, stagedOrder, startVoids, STAFF, type Who } from '../voids/fixtures';

// 05a §3.9 rule 3 (M-5), §3.10; 01d v1.3.5 §3.4.3 "Listed devices only, for money requests and device_waiting", §3.5
// G1-9d ("only the routes left after §3.4.3's listed-device drop"), §6.9. Plan task 25 (row D-2 routing, widened to
// `device_waiting`): tests #7, #7a, #21 (delivery half), G1-9d. Real VoidItems → void_approval (a money kind,
// `needs_pin: 'always'`), real POST /pair/requests → device_waiting, real WS clients, real requests-to-answer.

let hub: TestHub;
const clients: WsClient[] = [];
const tokens = new Map<string, string>();

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  tokens.clear();
  activity.drain();
  activity.drainDevices();
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

const EVERYONE: DeviceProfileInput = { access: 'everyone', screens: ['takeaway', 'manager'] };
const listed = (staff_ids: string[]): DeviceProfileInput => ({ access: 'listed', staff_ids, screens: ['manager'] });

/** A device with the given profile (null: a profile-less staff device, R-1). */
function device(type: 'tablet' | 'phone' | 'cashier_kiosk', profile: DeviceProfileInput | null, name: string): { deviceId: string; token: string } {
  const d = pairDevice(hub, profile === null ? { type, name } : { type, name, profile });
  tokens.set(d.deviceId, d.token);
  return d;
}

/** A staff session on the device (its profile left as it is). */
function on(d: { deviceId: string; token: string }, staffId: string): Who {
  const s = openSession(hub, { kind: 'staff', staffId, deviceId: d.deviceId, legacyProfile: false });
  return { staffId, deviceId: d.deviceId, token: d.token, sessionId: s.sessionId, sessionToken: s.token };
}

/** The seat's staff socket (its screen route). */
async function live(who: Who): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  ws.send({ type: 'auth', device_token: who.token, session_token: who.sessionToken });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
  clients.push(ws);
  return ws;
}

/** The device's alert-mode socket (route 2 for the person bound to it). */
async function alertMode(d: { deviceId: string; token: string }): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  ws.send({ type: 'auth', device_token: d.token });
  await ws.untilCount(1);
  expect(ws.messages[0]).toMatchObject({ type: 'alerts_open' });
  clients.push(ws);
  return ws;
}

let fenceNo = 0;
/** Every frame sent before this call has reached every client. */
async function fence(): Promise<void> {
  fenceNo += 1;
  const id = `FENCE_${fenceNo}`;
  wsHubFor(hub.app).sendToDevices([...tokens.keys()], { type: 'alert_seen', alert_id: id });
  for (const client of clients) {
    for (let i = 0; i < 50 && !client.messages.some((m) => (m as { alert_id?: string }).alert_id === id); i += 1) {
      await client.untilCount(client.messages.length + 1);
    }
  }
}

type Frame = { type: string; alert?: { alert_id: string } };
const alertIds = (c: WsClient): string[] => (c.messages as Frame[]).flatMap((m) => (m.type === 'alert' && m.alert !== undefined ? [m.alert.alert_id] : []));

/** VoidItems by `who` on a new staged order; the one request's alert_id. */
async function askVoid(who: Who, prefix: string): Promise<string> {
  const s = stagedOrder(hub, { prefix });
  const reply = await post(hub, who, 'void-items', 'VoidItems', {
    order_id: s.order_id,
    reason_code: 'customer_changed_mind',
    note: null,
    disposition_note: null,
    lines: [{ order_item_id: s.cooking, disposition: 'wastage' }],
  });
  expect(reply.status, JSON.stringify(reply.error)).toBe(200);
  return (reply.result as { pending: Array<{ alert_id: string }> }).pending[0]!.alert_id;
}

function stepEvents(alertId: string): PosEvent[] {
  return (hub.deps.db.prepare('SELECT * FROM events ORDER BY seq').all() as Array<Record<string, unknown>>)
    .map((row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent)
    .filter((e) => (e.payload as { alert_id?: unknown }).alert_id === alertId && ['AttemptSent', 'StepSkipped', 'EscalationStepped'].includes(e.event_type));
}

type Route = { staff_id: string | null; route: string; ref: string };
const routesOf = (e: PosEvent | undefined): Route[] => ((e?.payload as { routes?: Route[] } | undefined)?.routes ?? []);
const shape = (alertId: string): string[] => stepEvents(alertId).map((e) => `${e.event_type}:${String((e.payload as { step: number }).step)}`);

async function requestsToAnswer(who: Who): Promise<string[]> {
  const res = await hub.app.inject({
    method: 'GET',
    url: '/queries/requests-to-answer',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: { requests: Array<{ alert_id: string }> } }).data.requests.map((r) => r.alert_id);
}

describe('[05a §3.9 rule 3, M-5; 01d §3.4.3] money requests and device_waiting reach listed devices only', () => {
  it('[05a #7] a cashier on an `everyone` counter raises a void: it rings the manager’s listed phone, not his `everyone` tablet session; requests-to-answer there omits it', async () => {
    hub = await startVoids();
    const cashier = on(device('cashier_kiosk', EVERYONE, 'Counter'), STAFF.cashier);
    const phone = on(device('phone', listed([STAFF.manager]), 'Manager phone'), STAFF.manager);
    const tablet = on(device('tablet', EVERYONE, 'Shared tablet'), STAFF.manager);
    const bare = on(device('tablet', null, 'No profile'), 'S_OWNER');
    const phoneWs = await live(phone);
    const tabletWs = await live(tablet);
    const bareWs = await live(bare);

    const id = await askVoid(cashier, 'R7');
    await fence();
    // step 0 is sent (the manager has a route: his phone), so no G1-9d shortcut
    expect(shape(id)).toEqual(['AttemptSent:0']);
    const routes = routesOf(stepEvents(id)[0]);
    expect(routes.filter((r) => r.staff_id === STAFF.manager)).toEqual([
      { staff_id: STAFF.manager, route: 'screen', ref: phone.deviceId },
      { staff_id: STAFF.manager, route: 'alert_connection', ref: phone.deviceId }, // his permanent binding (one-person listed)
    ]);
    expect(routes.some((r) => r.ref === tablet.deviceId || r.ref === bare.deviceId)).toBe(false);
    expect(alertIds(phoneWs)).toEqual([id]);
    expect(alertIds(tabletWs)).toEqual([]);
    expect(alertIds(bareWs)).toEqual([]);

    // §6.9: omitted on the `everyone` tablet (and on a device with no profile, R-1), listed on the phone
    expect(await requestsToAnswer(phone)).toEqual([id]);
    expect(await requestsToAnswer(tablet)).toEqual([]);
  });

  it('[05a #7] the drop is for money kinds only: a non-money alert to the manager still reaches his `everyone` tablet', async () => {
    hub = await startVoids();
    const tablet = on(device('tablet', EVERYONE, 'Shared tablet'), STAFF.manager);
    const tabletWs = await live(tablet);
    const id = hub.deps.writer.run((tx) => {
      const r = alerts.raise(alerts.tickCtx(tx, hub.clock.branchNow()), {
        kind: 'no_approver',
        subject: { stream_type: 'hub', stream_id: 'branch-1' },
        target: { kind: 'person', staff_id: STAFF.manager },
        values: { permission: 'void-item' },
        display: { kind_label_key: 'alert.no_approver.lock' },
        dedupe_key: 'no_approver:test',
      });
      tx.append(r.events);
      return r.alert_id;
    }).result;
    await fence();
    expect([...new Set(routesOf(stepEvents(id)[0]).map((r) => r.ref))]).toEqual([tablet.deviceId]);
    expect(alertIds(tabletWs)).toEqual([id]);
  });

  it('[05a #7a, 01d §3.5 G1-9d] the only approver reachable only on `everyone` devices (screen and alert connection) → no route: the raise takes the shortcut to the escalation step', async () => {
    hub = await startVoids();
    const cashier = on(device('cashier_kiosk', EVERYONE, 'Counter'), STAFF.cashier);
    const shared = device('tablet', EVERYONE, 'Shared tablet');
    const mgr = on(shared, STAFF.manager);
    await live(mgr); // route 1 on an `everyone` device
    const id = await askVoid(cashier, 'S1');
    expect(shape(id)).toEqual(['StepSkipped:0', 'StepSkipped:1', 'EscalationStepped:2']);
    expect(routesOf(stepEvents(id)[2]).some((r) => r.ref === shared.deviceId)).toBe(false);

    // route 2: his session binding on the `everyone` tablet, its alert-mode socket open
    for (const c of clients.splice(0)) c.close();
    endSessionNow(hub, mgr.sessionId, 'idle_timeout');
    await alertMode(shared);
    const id2 = await askVoid(cashier, 'S2');
    expect(shape(id2)).toEqual(['StepSkipped:0', 'StepSkipped:1', 'EscalationStepped:2']);
  });

  it('[05a #7a, 01d §3.5 G1-9d] control: the same seats on a `listed` tablet (two people, a session binding) are a route — step 0 is sent', async () => {
    hub = await startVoids();
    const cashier = on(device('cashier_kiosk', EVERYONE, 'Counter'), STAFF.cashier);
    const floor = device('tablet', listed([STAFF.manager, STAFF.orderTaker]), 'Floor tablet');
    const mgr = on(floor, STAFF.manager);
    await live(mgr);
    const id = await askVoid(cashier, 'L1');
    expect(shape(id)).toEqual(['AttemptSent:0']);
    for (const c of clients.splice(0)) c.close();
    endSessionNow(hub, mgr.sessionId, 'idle_timeout');
    await alertMode(floor);
    const id2 = await askVoid(cashier, 'L2');
    expect(shape(id2)).toEqual(['AttemptSent:0']);
    expect(routesOf(stepEvents(id2)[0])).toEqual([{ staff_id: STAFF.manager, route: 'alert_connection', ref: floor.deviceId }]);
  });

  it('[05a #21 delivery, §3.10] device_waiting reaches a manage-devices holder on a listed phone only, never his `everyone` tablet session', async () => {
    hub = await startVoids();
    const phone = on(device('phone', listed([STAFF.manager]), 'Manager phone'), STAFF.manager);
    const tablet = on(device('tablet', EVERYONE, 'Shared tablet'), STAFF.manager);
    const ownerShared = on(device('tablet', EVERYONE, 'Owner shared'), 'S_OWNER');
    const phoneWs = await live(phone);
    const tabletWs = await live(tablet);
    const ownerWs = await live(ownerShared);
    const res = await hub.app.inject({ method: 'POST', url: '/pair/requests', remoteAddress: '10.25.0.1', payload: { device_name: 'Counter 2' } });
    expect(res.statusCode, res.body).toBe(200);
    await fence();
    const id = hub.deps.db.prepare(`SELECT alert_id FROM alerts WHERE kind = 'device_waiting'`).pluck().get() as string;
    expect(shape(id)).toEqual(['AttemptSent:0']);
    expect(routesOf(stepEvents(id)[0])).toEqual([{ staff_id: STAFF.manager, route: 'screen', ref: phone.deviceId }, { staff_id: STAFF.manager, route: 'alert_connection', ref: phone.deviceId }]);
    expect(alertIds(phoneWs)).toEqual([id]);
    expect(alertIds(tabletWs)).toEqual([]);
    expect(alertIds(ownerWs)).toEqual([]);
  });
});
