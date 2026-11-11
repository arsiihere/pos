import type { DirectoryInput, PosEvent } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineAlertKind, kindOf, TEST_ALERT, TEST_ALERT_AFTER_MS, unregisterAlertKind } from '../../src/alerts/kinds';
import { alerts } from '../../src/alerts/raise';
import { alertsTick, startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { activity } from '../../src/auth/session-store';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { fakePoint, registerFakes, resetFakes } from './fakes';

// 01d task 33: the `test_alert` kind (§3.10, §3.5 `closes_on.after_ms` 600 000) and `SendTestAlert` (§6.5):
// a manager (`manage-devices`) sends a test to a person, a team (default depth 'direct'), a device or a point
// (03b G-1 registers the point resolver; was 422 points_not_available while stubbed, §4.4). Tests #17, #52 and Review Focus 5. The receipt view
// (`alert-receipts`) is task 36, so delivery is asserted on the events and the DB only.

const OWNER = 'S_OWNER'; // a lead: S_WAIT reports to the owner, S_CASH to S_WAIT
const MGR = 'S_MGR'; // the sender (R_MGR holds manage-devices); a lead with no reports
const CASH = 'S_CASH'; // R_CASH: no manage-devices
const WAIT = 'S_WAIT';
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory({ directory_version: 1 });
  const lead: Record<string, string> = { [WAIT]: OWNER, [CASH]: WAIT };
  return { ...base, staff: base.staff.map((s) => (lead[s.staff_id] === undefined ? s : { ...s, lead_staff_id: lead[s.staff_id] ?? null })) };
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionToken: string;
}

function seat(hub: TestHub, staffId: string): Seat {
  const device = pairDevice(hub, { type: 'tablet', name: `Tablet of ${staffId}` });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, deviceToken: device.token, sessionToken: session.token };
}

let commandNo = 0;
const nextId = (): string => `auto-${(commandNo += 1)}`;

function send(hub: TestHub, s: Seat, target: Record<string, unknown>, commandId: string = nextId()) {
  return hub.app.inject({
    method: 'POST',
    url: '/commands/send-test-alert',
    headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
    payload: {
      command_id: commandId,
      tenant_id: TENANT,
      branch_id: BRANCH,
      command_type: 'SendTestAlert',
      payload: { target },
      occurred_at: hub.clock.branchNow(),
      actor_id: s.staffId,
      device_id: s.deviceId,
    },
  });
}

function events(hub: TestHub, alertId?: string): PosEvent[] {
  const rows = hub.deps.db.prepare('SELECT * FROM events ORDER BY seq').all() as Array<Record<string, unknown>>;
  const all = rows.map((row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent);
  return alertId === undefined ? all : all.filter((e) => (e.payload as { alert_id?: unknown }).alert_id === alertId);
}

function ofType(hub: TestHub, alertId: string, type: string): Array<Record<string, unknown>> {
  return events(hub, alertId)
    .filter((e) => e.event_type === type)
    .map((e) => e.payload as Record<string, unknown>);
}

function alertRow(hub: TestHub, id: string): Record<string, unknown> {
  return hub.deps.db
    .prepare(
      `SELECT kind, family, subject_stream_type, subject_stream_id, dedupe_key, requester_staff_id, step, raised_at,
              next_due_at, state, close_reason, display_json FROM alerts WHERE alert_id = ?`,
    )
    .get(id) as Record<string, unknown>;
}

function recipientRows(hub: TestHub, id: string): Array<Record<string, unknown>> {
  return hub.deps.db
    .prepare('SELECT staff_id, device_id, for_staff_id, recipient_set, step FROM alert_recipients WHERE alert_id = ? ORDER BY staff_id, device_id')
    .all(id) as Array<Record<string, unknown>>;
}

function counts(hub: TestHub): { events: number; alerts: number } {
  return {
    events: hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
    alerts: hub.deps.db.prepare('SELECT COUNT(*) FROM alerts').pluck().get() as number,
  };
}

/** Counts the statements of each `handle` call of SendTestAlert, and of the `raise` inside it (§6.5 Queries). */
function countHandle(hub: TestHub): { handle: number[]; raise: number[]; restore(): void } {
  const def = commandRegistry(hub.app).byPath('send-test-alert') as CommandDef;
  const counter = statementCounter(hub.deps.db);
  const original = def.handle;
  const out = { handle: [] as number[], raise: [] as number[] };
  const raise = alerts.raise.bind(alerts);
  const spy = vi.spyOn(alerts, 'raise').mockImplementation((ctx, input) => {
    const before = counter.count;
    try {
      return raise(ctx, input);
    } finally {
      out.raise.push(counter.count - before);
    }
  });
  def.handle = (ctx, payload, cmd) => {
    counter.reset();
    try {
      return original.call(def, ctx, payload, cmd);
    } finally {
      out.handle.push(counter.count);
    }
  };
  return {
    ...out,
    restore() {
      def.handle = original;
      spy.mockRestore();
    },
  };
}

describe('01d SendTestAlert and test_alert (task 33)', () => {
  let hub: TestHub;
  let stop: () => void = () => undefined;
  const log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    hub = await createTestHub();
    await seedDirectory(hub, await directory());
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run(); // the §3.9 flag pass is not under test here
  });

  afterEach(async () => {
    stop();
    stop = () => undefined;
    vi.restoreAllMocks();
    resetFakes();
    activity.drain();
    activity.drainDevices();
    vi.useRealTimers();
    await hub.close();
  });

  // ------------------------------------------------------------------------------------------------ §3.10

  it('[01d §3.10] test_alert: info, subject hub, step 0 to the raised target, closes after 600 000 ms, expires at day close, not silent, no request part', () => {
    expect(TEST_ALERT_AFTER_MS).toBe(600_000);
    expect(kindOf('test_alert')).toBe(TEST_ALERT);
    expect(TEST_ALERT).toMatchObject({
      kind: 'test_alert',
      family: 'info',
      subject: 'hub',
      steps: [{ at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
      closes_on: { after_ms: 600_000 },
      details_schema: null,
      lead_fallback: true,
      expires_at_day_close: true,
      silent: false,
      labels: { card: 'alert.test_alert.card', lock: 'alert.test_alert.lock' },
      request: null,
    });
    expect(TEST_ALERT.steps).toHaveLength(1);
  });

  // -------------------------------------------------------------------------------------------------- #17

  it('[01d #17] to a person, a team (default depth direct; all on request) and a device → 200 { alert_id }, test_alert on hub / branch_id with dedupe_key test:<command_id>, step 0 to that target', async () => {
    const mgr = seat(hub, MGR);
    const tablet = pairDevice(hub, { type: 'tablet', name: 'Tablet 3' });

    // person
    const personRes = await send(hub, mgr, { kind: 'person', staff_id: CASH }, 'auto-person');
    expect(personRes.statusCode).toBe(200);
    const personId = (personRes.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
    expect((personRes.json() as { data: { result: unknown } }).data.result).toEqual({ alert_id: personId });
    expect(alertRow(hub, personId)).toMatchObject({
      kind: 'test_alert',
      family: 'info',
      subject_stream_type: 'hub',
      subject_stream_id: BRANCH,
      dedupe_key: 'test:auto-person',
      requester_staff_id: null,
      step: 0,
      state: 'open',
    });
    const [raised] = ofType(hub, personId, 'AlertRaised');
    expect(raised).toMatchObject({ kind: 'test_alert', target: { kind: 'person', staff_id: CASH }, values: {}, details: null, request: null });
    expect(JSON.parse(alertRow(hub, personId).display_json as string)).toMatchObject({
      kind_label_key: 'alert.test_alert.lock',
      requester_name: 'Manager',
    });
    const raisedEvent = events(hub, personId).find((e) => e.event_type === 'AlertRaised') as PosEvent;
    expect(raisedEvent).toMatchObject({ stream_type: 'hub', stream_id: BRANCH, actor_id: MGR, device_id: mgr.deviceId });
    expect(ofType(hub, personId, 'AttemptSent')).toEqual([
      expect.objectContaining({ step: 0, recipients: [{ staff_id: CASH, device_id: null, for_staff_id: null, set: 'recipient' }] }),
    ]);

    // team, default depth 'direct': the lead's direct reports only (S_WAIT, not S_CASH under S_WAIT)
    const teamRes = await send(hub, mgr, { kind: 'team', lead_staff_id: OWNER });
    expect(teamRes.statusCode).toBe(200);
    const teamId = (teamRes.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
    expect(ofType(hub, teamId, 'AlertRaised')[0]).toMatchObject({ target: { kind: 'team', lead_staff_id: OWNER, depth: 'direct' } });
    expect(recipientRows(hub, teamId).map((r) => r.staff_id)).toEqual([WAIT]);
    // depth 'all': the whole subtree
    const allRes = await send(hub, mgr, { kind: 'team', lead_staff_id: OWNER, depth: 'all' });
    const allId = (allRes.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
    expect(recipientRows(hub, allId).map((r) => r.staff_id)).toEqual([CASH, WAIT]);

    // device
    const deviceRes = await send(hub, mgr, { kind: 'device', device_id: tablet.deviceId });
    expect(deviceRes.statusCode).toBe(200);
    const deviceId = (deviceRes.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
    expect(recipientRows(hub, deviceId)).toEqual([{ staff_id: null, device_id: tablet.deviceId, for_staff_id: null, recipient_set: 'recipient', step: 0 }]);
    expect(JSON.parse(alertRow(hub, deviceId).display_json as string)).toMatchObject({ device_name: 'Tablet 3' });
  });

  it('[01d #17, 03b G-1] to a point → raised to the point’s Pass tablets and the staff signed in on them (03b registers the point resolver)', async () => {
    const mgr = seat(hub, MGR);
    const pass = pairDevice(hub, { type: 'tablet', name: 'Pass tablet' });
    hub.deps.db.prepare("UPDATE devices SET point_id = 'P1' WHERE device_id = ?").run(pass.deviceId);
    openSession(hub, { kind: 'staff', staffId: WAIT, deviceId: pass.deviceId });
    const res = await send(hub, mgr, { kind: 'point', point_id: 'P1' });
    expect(res.statusCode, res.body).toBe(200);
    const id = (res.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
    const rows = recipientRows(hub, id);
    expect(rows.map((r) => r.device_id).filter((d) => d !== null)).toEqual([pass.deviceId]);
    expect(rows.map((r) => r.staff_id).filter((s) => s !== null)).toEqual([WAIT]);
  });

  it('[01d #17] without manage-devices → 403 PERMISSION_DENIED, nothing written', async () => {
    const cash = seat(hub, CASH);
    const before = counts(hub);
    const res = await send(hub, cash, { kind: 'person', staff_id: WAIT });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'manage-devices' } });
    expect(counts(hub)).toEqual(before);
  });

  it('[01d #17] the same command_id replayed → the stored 200, one alert (dedupe_key test:<command_id>)', async () => {
    const mgr = seat(hub, MGR);
    const first = await send(hub, mgr, { kind: 'person', staff_id: CASH }, 'auto-replay');
    const again = await send(hub, mgr, { kind: 'person', staff_id: CASH }, 'auto-replay');
    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(again.json().data.result).toEqual(first.json().data.result);
    const rows = hub.deps.db.prepare(`SELECT alert_id, dedupe_key FROM alerts WHERE kind = 'test_alert'`).all();
    expect(rows).toEqual([{ alert_id: first.json().data.result.alert_id, dedupe_key: 'test:auto-replay' }]);
    expect(events(hub).filter((e) => e.event_type === 'AlertRaised')).toHaveLength(1);
  });

  // ------------------------------------------------------------------------------------------------- §6.5

  it('[01d §6.5] unknown staff (person or team lead) → 404 STAFF_NOT_FOUND; unknown or revoked device → 404 DEVICE_NOT_FOUND; nothing written', async () => {
    const mgr = seat(hub, MGR);
    const revoked = pairDevice(hub, { type: 'tablet', name: 'Old tablet' });
    hub.deps.db.prepare('UPDATE devices SET revoked_at = ?, revoked_by = ? WHERE device_id = ?').run(hub.clock.branchNow(), MGR, revoked.deviceId);
    const before = counts(hub);
    const person = await send(hub, mgr, { kind: 'person', staff_id: 'S_NOBODY' });
    expect(person.statusCode).toBe(404);
    expect(person.json().error).toMatchObject({ code: 'STAFF_NOT_FOUND', details: { staff_id: 'S_NOBODY' } });
    const lead = await send(hub, mgr, { kind: 'team', lead_staff_id: 'S_NOBODY' });
    expect(lead.statusCode).toBe(404);
    expect(lead.json().error).toMatchObject({ code: 'STAFF_NOT_FOUND', details: { staff_id: 'S_NOBODY' } });
    for (const deviceId of ['D_NOBODY', revoked.deviceId]) {
      const res = await send(hub, mgr, { kind: 'device', device_id: deviceId });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatchObject({ code: 'DEVICE_NOT_FOUND', details: { device_id: deviceId } });
    }
    expect(counts(hub)).toEqual(before);
  });

  it('[01d §6.5] payload: an unknown target kind or a missing id → 400 VALIDATION_FAILED', async () => {
    const mgr = seat(hub, MGR);
    for (const target of [{ kind: 'managers' }, { kind: 'person' }, { kind: 'team', lead_staff_id: OWNER, depth: 'owner' }]) {
      const res = await send(hub, mgr, target);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('[01d §6.5] statements: device target = 1 existence read + raise; person / team = raise only (staff in memory)', async () => {
    const mgr = seat(hub, MGR);
    const tablet = pairDevice(hub, { type: 'tablet', name: 'Tablet 3' });
    const c = countHandle(hub);
    expect((await send(hub, mgr, { kind: 'device', device_id: tablet.deviceId })).statusCode).toBe(200);
    expect((await send(hub, mgr, { kind: 'person', staff_id: CASH })).statusCode).toBe(200);
    expect((await send(hub, mgr, { kind: 'team', lead_staff_id: OWNER })).statusCode).toBe(200);
    c.restore();
    expect(c.raise).toHaveLength(3);
    // raise ≤ 6 + R + T with no resolver and no route registered (§6.1)
    expect(c.raise).toEqual([6, 6, 6]); // dedupe 1 + the five fixed reads; R = T = 0
    expect(c.handle).toEqual([1 + (c.raise[0] as number), c.raise[1], c.raise[2]]);
  });

  it('[01d §6.5] a point with a registered resolver (once 01a lands; a test fake here) goes through raise to that point', async () => {
    registerFakes();
    const mgr = seat(hub, MGR);
    const pointTablet = pairDevice(hub, { type: 'tablet', name: 'Point tablet' });
    fakePoint.devices.set('P1', [pointTablet.deviceId]);
    const res = await send(hub, mgr, { kind: 'point', point_id: 'P1' });
    expect(res.statusCode).toBe(200);
    const id = (res.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
    expect(recipientRows(hub, id).map((r) => r.device_id)).toEqual([pointTablet.deviceId]);
  });

  // ------------------------------------------------------------------------------------------------- RF-5

  it('[01d RF-5] a team whose lead has no reports → 200, AttemptSent with empty recipients and routes, no alert_recipients row, no fallback, no error', async () => {
    const mgr = seat(hub, MGR);
    const res = await send(hub, mgr, { kind: 'team', lead_staff_id: MGR });
    expect(res.statusCode).toBe(200);
    const id = (res.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
    expect(ofType(hub, id, 'AttemptSent')).toEqual([{ alert_id: id, step: 0, recipients: [], routes: [] }]);
    expect(ofType(hub, id, 'EscalationStepped')).toEqual([]);
    expect(ofType(hub, id, 'StepSkipped')).toEqual([]);
    expect(recipientRows(hub, id)).toEqual([]);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM alert_inbox WHERE alert_id = ?').pluck().get(id)).toBe(0);
    expect(alertRow(hub, id)).toMatchObject({ state: 'open', step: 0 });
  });

  it('[01d RF-5] a paired device that is offline → 200, the device listed in AttemptSent recipients with no route, one alert_recipients row, no fallback', async () => {
    const mgr = seat(hub, MGR);
    const offline = pairDevice(hub, { type: 'tablet', name: 'Tablet 9' }); // paired, no socket
    const res = await send(hub, mgr, { kind: 'device', device_id: offline.deviceId });
    expect(res.statusCode).toBe(200);
    const id = (res.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
    expect(ofType(hub, id, 'AttemptSent')).toEqual([
      { alert_id: id, step: 0, recipients: [{ staff_id: null, device_id: offline.deviceId, for_staff_id: null, set: 'recipient' }], routes: [] },
    ]);
    expect(recipientRows(hub, id)).toEqual([{ staff_id: null, device_id: offline.deviceId, for_staff_id: null, recipient_set: 'recipient', step: 0 }]);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM alert_receipts WHERE alert_id = ?').pluck().get(id)).toBe(0);
  });

  // -------------------------------------------------------------------------------------------------- #52

  const preCheck = (): boolean => alertsTick.due(hub.deps.db, hub.deps.state.get(), hub.clock.branchNow());
  const pass = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(TICK_MS);
  };
  const facts = (id: string): string[] =>
    events(hub, id)
      .filter((e) => ['AttemptSent', 'EscalationStepped', 'StepSkipped', 'AlertClosed'].includes(e.event_type))
      .map((e) => {
        const p = e.payload as { step?: number; reason?: string };
        return e.event_type === 'AlertClosed' ? `AlertClosed:${p.reason}` : `${e.event_type}:${p.step}`;
      });

  it('[01d #52] SendTestAlert → next_due_at = raised_at + 600 000; at 599 s the pre-check is false; at 600 s it is true and the tick writes AlertClosed expired, no step event', async () => {
    const mgr = seat(hub, MGR);
    const raisedAt = hub.clock.branchNow();
    const res = await send(hub, mgr, { kind: 'person', staff_id: CASH });
    const id = (res.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
    expect(alertRow(hub, id)).toMatchObject({ raised_at: raisedAt, next_due_at: raisedAt + 600_000, state: 'open' });
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
    stop = startTickLoop(hub.deps, log);
    const run = vi.spyOn(hub.deps.writer, 'run');
    hub.clock.advance(599_000);
    expect(preCheck()).toBe(false);
    hub.clock.advance(999);
    expect(preCheck()).toBe(false);
    await pass();
    expect(run).not.toHaveBeenCalled();
    hub.clock.advance(1); // 600 s
    expect(preCheck()).toBe(true);
    await pass();
    expect(facts(id)).toEqual(['AttemptSent:0', 'AlertClosed:expired']);
    expect(run.mock.results[0]?.value.appended.map((e: PosEvent) => e.event_type)).toEqual(['AlertClosed']);
    expect(alertRow(hub, id)).toMatchObject({ state: 'closed', close_reason: 'expired', next_due_at: null });
    expect(preCheck()).toBe(false);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('[01d #52] a kind with one more step after the expiry time is closed, not stepped', async () => {
    const LATE = 't_test_alert_late_step';
    defineAlertKind({
      ...TEST_ALERT,
      kind: LATE,
      steps: [...TEST_ALERT.steps, { at: { ms: TEST_ALERT_AFTER_MS + 60_000 }, to: [{ target: 'raised_target', set: 'recipient' }] }],
      values_schema: z.object({}),
    });
    try {
      const id = hub.deps.writer.run((tx) => {
        const r = alerts.raise(alerts.tickCtx(tx, hub.clock.branchNow()), {
          kind: LATE,
          subject: { stream_type: 'hub', stream_id: BRANCH },
          target: { kind: 'person', staff_id: CASH },
          display: { kind_label_key: 'alert.test_alert.lock' },
          dedupe_key: 'late:1',
        });
        tx.append(r.events);
        return r.alert_id;
      }).result;
      hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
      stop = startTickLoop(hub.deps, log);
      hub.clock.advance(TEST_ALERT_AFTER_MS + 120_000); // the expiry and the late step both past
      await pass();
      expect(facts(id)).toEqual(['AttemptSent:0', 'AlertClosed:expired']);
      hub.clock.advance(TEST_ALERT_AFTER_MS);
      await pass();
      expect(facts(id)).toEqual(['AttemptSent:0', 'AlertClosed:expired']);
    } finally {
      unregisterAlertKind(LATE);
    }
  });
});
