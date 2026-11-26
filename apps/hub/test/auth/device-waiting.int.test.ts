import { afterEach, describe, expect, it } from 'vitest';
import { kindOf, safeLink } from '../../src/alerts/kinds';
import { sweepOnce } from '../../src/auth/session-sweeper';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 05a §3.10 (row D-3; 01d v1.3.5 §3.10 `device_waiting`, §3.13.1 row 20), §6.1, §6.3 step 4; plan task 26, test #21 (hub
// half). One open `device_waiting` while any pairing request is pending: raised by POST /pair/requests when none is
// open, closed `done` by ApprovePairingRequest when no other request is pending, `obsolete` by the session sweeper when
// the last one expired. Never the display code (05a A-5).

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub);
  return hub;
}

let nextIp = 1;
async function request(hub: TestHub, name = 'Counter 2'): Promise<{ request_id: string; display_code: string; poll_secret: string }> {
  const res = await hub.app.inject({ method: 'POST', url: '/pair/requests', remoteAddress: `10.26.0.${nextIp++}`, payload: { device_name: name } });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

interface Approver {
  headers: Record<string, string>;
  deviceId: string;
}

function adminApprover(hub: TestHub): Approver {
  const device = pairDevice(hub, { type: 'tablet', profile: { access: 'listed', staff_ids: ['S_OWNER'], screens: ['manager'] } });
  const session = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: device.deviceId });
  return { headers: { authorization: `Bearer ${device.token}`, 'x-admin-session': session.token }, deviceId: device.deviceId };
}

function approve(hub: TestHub, who: Approver, req: { request_id: string; display_code: string }) {
  return hub.app.inject({
    method: 'POST',
    url: '/admin/commands/approve-pairing-request',
    headers: who.headers,
    payload: {
      command_id: `cmd-dw-${nextIp++}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'ApprovePairingRequest',
      payload: {
        request_id: req.request_id,
        display_code: req.display_code,
        device_type: 'cashier_kiosk',
        device_name: 'Counter 2',
        access: 'everyone',
        screens: ['takeaway', 'cashier', 'manager'],
      },
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_OWNER',
      device_id: who.deviceId,
    },
  });
}

type AlertRow = { alert_id: string; state: string; close_reason: string | null; dedupe_key: string; family: string };
function waiting(hub: TestHub): AlertRow[] {
  return hub.deps.db
    .prepare(`SELECT alert_id, state, close_reason, dedupe_key, family FROM alerts WHERE kind = 'device_waiting' ORDER BY raised_seq`)
    .all() as AlertRow[];
}

type EventRow = { event_type: string; payload: string; actor_id: string | null; device_id: string; stream_type: string; stream_id: string };
function alertEvents(hub: TestHub, alertId: string): EventRow[] {
  return hub.deps.db
    .prepare(
      `SELECT event_type, payload, actor_id, device_id, stream_type, stream_id FROM events
       WHERE json_extract(payload, '$.alert_id') = ? ORDER BY seq`,
    )
    .all(alertId) as EventRow[];
}

describe('[05a #21] device_waiting (hub half)', () => {
  it('[05a §3.10] the kind: info, subject hub, lead_fallback false, no request part, closes on owner, link { type: devices }', () => {
    const kind = kindOf('device_waiting');
    expect(kind).toBeDefined();
    expect(kind).toMatchObject({ family: 'info', subject: 'hub', lead_fallback: false, request: null, closes_on: 'owner' });
    expect(kind!.steps).toEqual([{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }]);
    // 01d §3.13.1 row 20 / #69: the fixture gives { type: 'devices' }
    expect(safeLink(kind!, {})).toEqual({ type: 'devices' });
    // values carry nothing (no count, no code): any key is refused
    expect(kind!.values_schema.safeParse({ display_code: 'ABC123' }).success).toBe(false);
  });

  it('[05a §3.10] raised on the first request (hub / branch, actor null, device hub, target manage-devices); a second request while it is open writes nothing', async () => {
    const hub = await open();
    await request(hub);
    const rows = waiting(hub);
    expect(rows).toEqual([expect.objectContaining({ state: 'open', dedupe_key: 'device_waiting', family: 'info' })]);
    const raised = alertEvents(hub, rows[0]!.alert_id);
    expect(raised[0]).toMatchObject({ event_type: 'AlertRaised', actor_id: null, device_id: 'hub', stream_type: 'hub', stream_id: 'branch-1' });
    const payload = JSON.parse(raised[0]!.payload);
    expect(payload.target).toEqual({ kind: 'permission', permission: 'manage-devices' });
    expect(payload.values).toEqual({});
    expect(payload.request).toBeNull();
    const eventsBefore = hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get();
    await request(hub, 'Kitchen 1');
    expect(waiting(hub)).toHaveLength(1);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(eventsBefore);
  });

  it('[05a §3.10] approve closes it done when no other request is pending; it stays open while another is pending', async () => {
    const hub = await open();
    const approver = adminApprover(hub);
    const first = await request(hub);
    const second = await request(hub, 'Phone');
    const [alert] = waiting(hub);
    expect((await approve(hub, approver, first)).statusCode).toBe(200);
    expect(waiting(hub)).toEqual([expect.objectContaining({ state: 'open' })]);
    expect((await approve(hub, approver, second)).statusCode).toBe(200);
    expect(waiting(hub)).toEqual([expect.objectContaining({ alert_id: alert!.alert_id, state: 'closed', close_reason: 'done' })]);
    const closed = alertEvents(hub, alert!.alert_id).filter((e) => e.event_type === 'AlertClosed');
    expect(closed).toHaveLength(1);
    expect(JSON.parse(closed[0]!.payload)).toMatchObject({ reason: 'done', by_staff_id: 'S_OWNER' });
    // a new request afterwards raises a new one
    await request(hub);
    expect(waiting(hub).map((r) => r.state)).toEqual(['closed', 'open']);
  });

  it('[05a §3.10] the sweeper closes it obsolete once no request is pending any more (expiry), in its own write; not before', async () => {
    const hub = await open();
    await request(hub);
    hub.clock.advance(300_000);
    await request(hub);
    const [alert] = waiting(hub);
    hub.clock.advance(300_000); // the first has expired, the second has not
    sweepOnce(hub.deps);
    expect(waiting(hub)[0]).toMatchObject({ state: 'open' });
    hub.clock.advance(300_000); // both expired
    sweepOnce(hub.deps);
    expect(waiting(hub)).toEqual([expect.objectContaining({ alert_id: alert!.alert_id, state: 'closed', close_reason: 'obsolete' })]);
    const closed = alertEvents(hub, alert!.alert_id).filter((e) => e.event_type === 'AlertClosed');
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ actor_id: null, device_id: 'hub' });
    expect(JSON.parse(closed[0]!.payload)).toMatchObject({ reason: 'obsolete', by_staff_id: null });
    // a later sweep with nothing open writes nothing more
    const events = hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get();
    sweepOnce(hub.deps);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(events);
  });

  it('[05a §6.1] statements: the open device_waiting read (+1) on every request, plus the raise only when none is open', async () => {
    const hub = await open();
    const counter = statementCounter(hub.deps.db);
    counter.reset();
    await request(hub);
    const first = counter.count;
    counter.reset();
    await request(hub);
    const whileOpen = counter.count;
    // today's POST /pair/requests (IP read, pending read, INSERT) + 1 (the open device_waiting read)
    expect(whileOpen).toBe(TODAY_POST + 1);
    // + the raise: its dedupe read, the fixed resolver reads and the appends of AlertRaised + AttemptSent
    expect(first).toBeGreaterThan(whileOpen);
  });

  it('[05a §6.3] statements: approve adds one pending read, plus the close only when none is pending', async () => {
    const hub = await open();
    const approver = adminApprover(hub);
    const a = await request(hub);
    const b = await request(hub);
    const c = await request(hub);
    const counter = statementCounter(hub.deps.db);
    // first approve warms the command path (its cached statements are prepared through the wrapper too)
    expect((await approve(hub, approver, a)).statusCode).toBe(200);
    counter.reset();
    expect((await approve(hub, approver, b)).statusCode).toBe(200);
    const stillPending = counter.count;
    counter.reset();
    expect((await approve(hub, approver, c)).statusCode).toBe(200);
    const last = counter.count;
    expect(waiting(hub)[0]).toMatchObject({ state: 'closed', close_reason: 'done' });
    // the close: the alert row read (closeMany) + the AlertClosed append and its projection
    expect(last).toBeGreaterThan(stillPending);
    expect(last - stillPending).toBe(CLOSE_COST);
    expect(stillPending).toBe(TODAY_APPROVE + 1);
  });

  it('[05a §3.10 privacy] neither the display code nor the device name is in any device_waiting event', async () => {
    const hub = await open();
    const approver = adminApprover(hub);
    const req = await request(hub, 'Ali secret phone');
    await approve(hub, approver, req);
    const [alert] = waiting(hub);
    const events = alertEvents(hub, alert!.alert_id);
    expect(events.map((e) => e.event_type)).toEqual(['AlertRaised', 'AttemptSent', 'AlertClosed']);
    for (const e of events) {
      expect(e.payload).not.toContain(req.display_code);
      expect(e.payload).not.toContain('Ali secret phone');
    }
    const row = hub.deps.db.prepare('SELECT values_json, display_json FROM alerts WHERE alert_id = ?').get(alert!.alert_id) as Record<string, string>;
    expect(row.values_json).toBe('{}');
    expect(JSON.parse(row.display_json)).toEqual({ kind_label_key: 'alert.device_waiting.lock' });
  });
});

// Pinned from the code (05a §6.1 / §6.3 statement rows; the counter counts every get / all / run).
const TODAY_POST = 3; // IP read, pending read, INSERT (00 §6.30; no event today)
const CLOSE_COST = 8; // closeMany's row read + the AlertClosed append and its alerts projection; ⚠️ + 1, 03b v1.0.16 §5 (R3-M-9): the pass fold clears a counter alert's pass_bag_ready link
// the whole /admin/commands round trip before 05a task 26 (guards, session, idempotency, request read, INSERT, UPDATE,
// the DevicePaired + DeviceProfileSet appends and their projections); task 26 adds the one pending read
const TODAY_APPROVE = 42;
