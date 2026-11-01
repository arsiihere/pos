import type { DirectoryInput, PosEvent } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineAlertKind, unregisterAlertKind } from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { registerRoute, unregisterRoute } from '../../src/alerts/routes';
import { alertsTick, registerTick, startTickLoop, TICK_MS, unregisterTick } from '../../src/alerts/tick';
import { activity } from '../../src/auth/session-store';
import { aDirectory, PIN, pinHash } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FAKE_STEP_1_MS, fakePager, fakePoint, fakeTableOwner, registerFakes, resetFakes } from './fakes';

// 01d task 28: the `alerts` tick's `intents` (§3.5): the select inside writer.run (race rule, LIMIT 200), the
// latest due step sent and every earlier due step `StepSkipped 'superseded'` (restart / tick lag), step
// targets (§3.4), raises from a registered tick through `raiseMany(tickCtx)` (§4.3 To 03a), and the after-commit
// frames and registered route sends (ws-frames, task 20) once per step event. Tests #4, #19, #21, #25, #34, #50.
// The loop runs on fake setInterval; the hub clock is the fixed test clock, moved by hand (no Date.now()).

const OWNER = 'S_OWNER'; // WAIT's lead; branch-scope force-release-table-lock (a manager)
const MGR = 'S_MGR'; // approver (R_MGR), approve-void branch scope; also a manager
const LEAD = 'S_LEAD'; // R_LEAD approver role, approve-void my_team with nobody below → informed holder
const CASH = 'S_CASH'; // no lead
const WAIT = 'S_WAIT'; // requester; lead OWNER
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const roles = base.roles.map((role) =>
    role.role_id === 'R_WAIT'
      ? {
          ...role,
          permissions: [
            {
              permission: 'void-item' as const,
              grant_type: 'requires_approval' as const,
              approver_role_id: 'R_MGR',
              approver_role_ids: ['R_MGR', 'R_LEAD'],
              scope: 'branch' as const,
            },
          ],
        }
      : role,
  );
  roles.push({
    role_id: 'R_LEAD',
    name: 'Lead',
    session_idle_ttl_ms: 3_600_000,
    permissions: [{ permission: 'approve-void', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_team' }],
  });
  const staff = base.staff.map((s) => (s.staff_id === WAIT ? { ...s, lead_staff_id: OWNER } : s));
  staff.push({ staff_id: LEAD, display_name: 'Lead', pin_hash: await pinHash(PIN.c), role_ids: ['R_LEAD'], denied_permissions: [], lead_staff_id: null, floor_ids: [] });
  return { ...base, roles, staff };
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionId: string;
  sessionToken: string;
}

interface StepPayload {
  alert_id: string;
  step: number;
  recipients: Array<{ staff_id: string | null; device_id: string | null; for_staff_id: string | null; set: string }>;
  routes: Array<{ staff_id: string | null; route: string; ref: string }>;
}

const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };
const voidInput = (n = 1): RaiseInput => ({
  kind: 't_approval',
  subject: { stream_type: 'order', stream_id: `O${n}` },
  target: { kind: 'answerers' },
  values: { order_id: `O${n}` },
  display,
  details: { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' },
  dedupe_key: `void:O${n}:L1`,
  requester_staff_id: WAIT,
  request: { approver_role_ids: ['R_MGR', 'R_LEAD'] },
});
const twoStep = (n: number, target: RaiseInput['target'] = { kind: 'person', staff_id: WAIT }): RaiseInput => ({
  kind: 't_two_step',
  subject: { stream_type: 'hub', stream_id: BRANCH },
  target,
  display,
  dedupe_key: `two:${n}`,
});

/** #4: a kind whose steps are at 1 × and 2 × the raiser's `window_ms` (§3.5 `{ value, times }`). */
const WINDOW_KIND = 't_window';
function defineWindowKind(): void {
  defineAlertKind({
    kind: WINDOW_KIND,
    family: 'info',
    subject: 'hub',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      { at: { value: 'window_ms', times: 1 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      { at: { value: 'window_ms', times: 2 }, to: [{ target: 'raised_target', set: 'recipient' }] },
    ],
    closes_on: 'owner',
    values_schema: z.object({ window_ms: z.number() }),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: { card: 'alert.t_window.card', lock: 'alert.t_window.lock' },
    request: null,
  });
}

describe('01d alerts tick: steps, superseded skips, restart, answer race (task 28)', () => {
  let hub: TestHub;
  let stop: () => void = () => undefined;
  const clients: WsClient[] = [];
  const log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    hub = await createTestHub();
    registerFakes();
    await seedDirectory(hub, await directory());
    // 0006 seeds the no_approver flag dirty (the flag pass is task 31): start clean
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
    for (const id of [OWNER, MGR, LEAD, CASH, WAIT]) fakePager.refs.set(id, [`P-${id}`]);
    log.error.mockClear();
  });

  afterEach(async () => {
    stop();
    stop = () => undefined;
    for (const c of clients.splice(0)) c.close();
    vi.restoreAllMocks();
    unregisterTick('fires_raise');
    unregisterRoute('text_pager');
    unregisterAlertKind(WINDOW_KIND);
    unregisterAlertKind('t_bad_window');
    resetFakes();
    activity.drain();
    activity.drainDevices();
    vi.useRealTimers();
    await hub.close();
  });

  function start(): void {
    stop = startTickLoop(hub.deps, log);
  }

  /** A SessionStarted / SessionEnded marks no_approver dirty; its flag pass is task 31, so tests clear it. */
  function cleanFlags(): void {
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  }

  async function pass(): Promise<void> {
    await vi.advanceTimersByTimeAsync(TICK_MS);
  }

  function raiseHub(input: RaiseInput | RaiseInput[]): string[] {
    const inputs = Array.isArray(input) ? input : [input];
    return hub.deps.writer.run((tx) => {
      const results = alerts.raiseMany(alerts.tickCtx(tx, hub.clock.branchNow()), inputs);
      tx.append(results.flatMap((r) => r.events));
      return results.map((r) => r.alert_id);
    }).result;
  }

  function seat(staffId: string, type: 'tablet' | 'cashier_kiosk' = 'tablet'): Seat {
    const device = pairDevice(hub, { type, name: staffId });
    const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
    return { staffId, deviceId: device.deviceId, deviceToken: device.token, sessionId: session.sessionId, sessionToken: session.token };
  }

  async function socketOf(s: Seat): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: s.deviceToken, session_token: s.sessionToken });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
    clients.push(ws);
    return ws;
  }

  function events(alertId?: string): PosEvent[] {
    const rows = hub.deps.db.prepare('SELECT * FROM events ORDER BY seq').all() as Array<Record<string, unknown>>;
    const all = rows.map((row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent);
    return alertId === undefined ? all : all.filter((e) => (e.payload as { alert_id?: unknown }).alert_id === alertId);
  }

  /** The 01d step facts of an alert, in log order: `type:step[:reason]`. */
  function steps(alertId: string): string[] {
    return events(alertId)
      .filter((e) => ['AttemptSent', 'EscalationStepped', 'StepSkipped'].includes(e.event_type))
      .map((e) => {
        const p = e.payload as { step: number; reason?: string };
        return p.reason === undefined ? `${e.event_type}:${p.step}` : `${e.event_type}:${p.step}:${p.reason}`;
      });
  }

  function stepEvent(alertId: string, step: number): PosEvent & { payload: StepPayload } {
    const found = events(alertId).find(
      (e) => (e.event_type === 'AttemptSent' || e.event_type === 'EscalationStepped') && (e.payload as unknown as StepPayload).step === step,
    );
    if (found === undefined) throw new Error(`no step ${step} event for ${alertId}`);
    return found as PosEvent & { payload: StepPayload };
  }

  const people = (p: StepPayload): Array<[string | null, string | null, string]> =>
    p.recipients.map((r) => [r.staff_id ?? r.device_id, r.for_staff_id, r.set] as [string | null, string | null, string]).sort();

  function inbox(alertId: string): Array<{ staff_id: string; moved_to: string | null }> {
    return hub.deps.db.prepare('SELECT staff_id, moved_to FROM alert_inbox WHERE alert_id = ? ORDER BY staff_id').all(alertId) as Array<{
      staff_id: string;
      moved_to: string | null;
    }>;
  }

  function alertRow(alertId: string): { state: string; step: number; next_due_at: number | null } {
    return hub.deps.db.prepare('SELECT state, step, next_due_at FROM alerts WHERE alert_id = ?').get(alertId) as {
      state: string;
      step: number;
      next_due_at: number | null;
    };
  }

  /** Statement counts of every alerts.due and alerts.intents call (the tick's own reads, §3.5 "Reads per tick"). */
  function countTick(): { due: number[]; intents: number[] } {
    const counter = statementCounter(hub.deps.db);
    const out = { due: [] as number[], intents: [] as number[] };
    const due = alertsTick.due.bind(alertsTick);
    const intents = alertsTick.intents.bind(alertsTick);
    vi.spyOn(alertsTick, 'due').mockImplementation((db, state, now) => {
      counter.reset();
      const r = due(db, state, now);
      out.due.push(counter.count);
      return r;
    });
    vi.spyOn(alertsTick, 'intents').mockImplementation((tx, state, now) => {
      counter.reset();
      const r = intents(tx, state, now);
      out.intents.push(counter.count);
      return r;
    });
    return out;
  }

  let commandNo = 0;
  function answer(s: Seat, payload: Record<string, unknown>) {
    return hub.app.inject({
      method: 'POST',
      url: '/commands/answer-request',
      headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
      payload: {
        command_id: `tick-cmd-${(commandNo += 1)}`,
        tenant_id: TENANT,
        branch_id: BRANCH,
        command_type: 'AnswerRequest',
        payload,
        occurred_at: hub.clock.branchNow(),
        actor_id: s.staffId,
        device_id: s.deviceId,
      },
    });
  }

  /** Sets testHooks.betweenDueAndRun for the `alerts` tick; `settled()` waits for the hook (timers advanced by 0 only). */
  function hookAlerts(fn: () => Promise<void> | void): { settled(): Promise<void>; calls: number } {
    const state = { calls: 0, last: Promise.resolve() };
    hub.deps.testHooks = {
      ...hub.deps.testHooks,
      betweenDueAndRun: (name: string) => {
        if (name !== 'alerts') return Promise.resolve();
        state.calls += 1;
        state.last = Promise.resolve(fn());
        return state.last;
      },
    };
    return {
      get calls() {
        return state.calls;
      },
      async settled() {
        await state.last;
        await vi.advanceTimersByTimeAsync(0);
      },
    };
  }

  // ------------------------------------------------------------------------------------------------ #4

  it("[01d #4] step selection through the tick: steps 1 and 2 both due → step 2 sent, StepSkipped { step: 1, reason: 'superseded' }; { value: 'window_ms', times: 2 }", async () => {
    defineWindowKind();
    const input = (n: number): RaiseInput => ({
      kind: WINDOW_KIND,
      subject: { stream_type: 'hub', stream_id: BRANCH },
      target: { kind: 'person', staff_id: CASH },
      values: { window_ms: 10_000 },
      display,
      dedupe_key: `window:${n}`,
    });
    const [lagged] = raiseHub(input(1)) as [string];
    start();
    // both steps due at once (raise + 2 × window_ms): the latest is sent, the earlier one skipped
    hub.clock.advance(20_000);
    await pass();
    expect(steps(lagged)).toEqual(['AttemptSent:0', 'StepSkipped:1:superseded', 'AttemptSent:2']);
    expect(stepEvent(lagged, 2).payload.recipients).toEqual([{ staff_id: CASH, device_id: null, for_staff_id: null, set: 'recipient' }]);
    const skipped = events(lagged).find((e) => e.event_type === 'StepSkipped') as PosEvent;
    expect(skipped.payload).toEqual({ alert_id: lagged, step: 1, reason: 'superseded' });
    expect(skipped).toMatchObject({ actor_id: null, device_id: 'hub', stream_type: 'hub', stream_id: BRANCH });
    expect(alertRow(lagged)).toEqual({ state: 'open', step: 2, next_due_at: null });

    // on time: step 1 at 1 × window_ms, step 2 at exactly 2 × window_ms, nothing skipped
    const [onTime] = raiseHub(input(2)) as [string];
    hub.clock.advance(9_999);
    await pass();
    expect(steps(onTime)).toEqual(['AttemptSent:0']);
    hub.clock.advance(1);
    await pass();
    expect(steps(onTime)).toEqual(['AttemptSent:0', 'AttemptSent:1']);
    hub.clock.advance(9_999);
    await pass();
    expect(steps(onTime)).toEqual(['AttemptSent:0', 'AttemptSent:1']);
    hub.clock.advance(1);
    await pass();
    expect(steps(onTime)).toEqual(['AttemptSent:0', 'AttemptSent:1', 'AttemptSent:2']);
    await pass();
    expect(steps(onTime)).toHaveLength(3);
    expect(log.error).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------- #19

  it('[01d #19] approval tier timing: step 0 at raise (answerers), step 1 at 45 s (+ always-on), escalation at 120 s with answerers, informed holders and always-on (widens)', async () => {
    const kiosk = pairDevice(hub, { type: 'cashier_kiosk', name: 'Kiosk' });
    const [id] = raiseHub(voidInput()) as [string];
    expect(steps(id)).toEqual(['AttemptSent:0']);
    expect(people(stepEvent(id, 0).payload)).toEqual([[MGR, null, 'answerer']]);
    start();
    hub.clock.advance(44_999);
    await pass();
    expect(steps(id)).toEqual(['AttemptSent:0']);
    hub.clock.advance(1); // 45 000
    await pass();
    expect(steps(id)).toEqual(['AttemptSent:0', 'AttemptSent:1']);
    const step1 = people(stepEvent(id, 1).payload);
    expect(step1).toEqual([[MGR, null, 'answerer'], [kiosk.deviceId, null, 'recipient']].sort());
    hub.clock.advance(120_000 - 45_000 - 1);
    await pass();
    expect(steps(id)).toHaveLength(2);
    hub.clock.advance(1); // 120 000
    await pass();
    expect(steps(id)).toEqual(['AttemptSent:0', 'AttemptSent:1', 'EscalationStepped:2']);
    const step2 = people(stepEvent(id, 2).payload);
    expect(step2).toEqual([[MGR, null, 'answerer'], [LEAD, null, 'informed'], [kiosk.deviceId, null, 'recipient']].sort());
    for (const r of step1) expect(step2).toContainEqual(r); // widens: every step-1 recipient is still in step 2
    expect(stepEvent(id, 2)).toMatchObject({ actor_id: null, device_id: 'hub', stream_type: 'order', stream_id: 'O1' });
    // the request stays pending; no step after the escalation
    expect(alertRow(id)).toEqual({ state: 'open', step: 2, next_due_at: null });
    await pass();
    expect(steps(id)).toHaveLength(3);
  });

  // ----------------------------------------------------------------------------------------------- #21

  it('[01d #21] restart with the hub down 4 min after a raise → one EscalationStepped, StepSkipped for step 1, no step 0 resend', async () => {
    const [id] = raiseHub(voidInput()) as [string];
    start();
    await pass();
    stop(); // the hub goes down
    hub.clock.advance(240_000);
    start(); // back up: the first pass after boot step 7
    const run = vi.spyOn(hub.deps.writer, 'run');
    await pass();
    expect(steps(id)).toEqual(['AttemptSent:0', 'StepSkipped:1:superseded', 'EscalationStepped:2']);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.results[0]?.value.appended.map((e: PosEvent) => e.event_type)).toEqual(['StepSkipped', 'EscalationStepped']);
    await pass();
    await pass();
    expect(steps(id)).toHaveLength(3);
    expect(run).toHaveBeenCalledTimes(1); // nothing due afterwards: no transaction
  });

  // ----------------------------------------------------------------------------------------------- #25

  it("[01d #25] table's team via the registered fake tableOwner: the owner changes between steps → the next step goes to the new team; the old team's inbox shows moved_to", async () => {
    fakeTableOwner.owners.set('T1', OWNER);
    const [id] = raiseHub(twoStep(1, { kind: 'table_team', table_id: 'T1' })) as [string];
    // step 0: OWNER and the direct report WAIT (depth 'direct' by default)
    expect(people(stepEvent(id, 0).payload)).toEqual([[OWNER, null, 'recipient'], [WAIT, null, 'recipient']]);
    fakeTableOwner.owners.set('T1', MGR); // the table moves to MGR (no reports)
    fakeTableOwner.calls.length = 0;
    start();
    const counts = countTick();
    hub.clock.advance(FAKE_STEP_1_MS);
    await pass();
    expect(steps(id)).toEqual(['AttemptSent:0', 'AttemptSent:1']);
    expect(people(stepEvent(id, 1).payload)).toEqual([[MGR, null, 'recipient']]);
    expect(fakeTableOwner.calls).toEqual([[{ kind: 'table_team', table_id: 'T1' }]]); // one batched call (R = 1)
    expect(inbox(id)).toEqual([
      { staff_id: MGR, moved_to: null },
      { staff_id: OWNER, moved_to: MGR },
      { staff_id: WAIT, moved_to: MGR },
    ]);
    // §3.5 reads per tick: 1 pre-check, then ≤ 8 + R + T inside (R = 2: tableOwner and the §3.4.2 zone read of
    // a lead_fallback kind; T = 1 pager). Measured: 1 + 10 (select, 5 fixed, previous step, 2 resolvers, pager).
    expect(counts.due).toEqual([1]);
    expect(counts.intents).toEqual([10]);
    expect(counts.intents[0]).toBeLessThanOrEqual(8 + 2 + 1);
  });

  // ----------------------------------------------------------------------------------------------- #34

  it('[01d #34] answer vs. tick: (a) AnswerRequest commits in betweenDueAndRun → the tick writes no step for A and appends nothing; (b) the tick steps, then the answer, then no writer.run; no step event after RequestAnswered', async () => {
    const cash = seat(CASH);
    cleanFlags();
    const handover = (n: number): RaiseInput => ({
      kind: 't_handover_like',
      subject: { stream_type: 'table', stream_id: `T${n}` },
      target: { kind: 'person', staff_id: CASH },
      values: { table_id: `T${n}` },
      display,
      dedupe_key: `handover:T${n}`,
      requester_staff_id: WAIT,
      request: { receiver_staff_id: CASH },
    });
    const [a] = raiseHub(handover(1)) as [string];
    start();
    const run = vi.spyOn(hub.deps.writer, 'run');
    // (a) the pre-check says A is due; the answer commits in the hook; the tick's select inside finds it closed
    hub.clock.advance(FAKE_STEP_1_MS);
    const hook = hookAlerts(async () => {
      expect((await answer(cash, { alert_id: a, decision: 'accept', method: 'session' })).statusCode).toBe(200);
    });
    await pass();
    await hook.settled();
    expect(hook.calls).toBe(1);
    expect(run.mock.results.at(-1)?.value.appended).toEqual([]); // the tick's transaction (the last run) appended nothing
    expect(steps(a)).toEqual(['AttemptSent:0']);
    hub.deps.testHooks = { ...hub.deps.testHooks, betweenDueAndRun: undefined };

    // (b) reverse: the tick steps B first, then the answer commits, then the next pre-check is false
    const [b] = raiseHub(handover(2)) as [string];
    hub.clock.advance(FAKE_STEP_1_MS);
    await pass();
    expect(steps(b)).toEqual(['AttemptSent:0', 'AttemptSent:1']);
    expect((await answer(cash, { alert_id: b, decision: 'accept', method: 'session' })).statusCode).toBe(200);
    run.mockClear();
    hub.clock.advance(FAKE_STEP_1_MS);
    await pass();
    expect(run).not.toHaveBeenCalled();

    for (const id of [a, b]) {
      const answered = events(id).find((e) => e.event_type === 'RequestAnswered') as PosEvent;
      expect(answered).toBeDefined();
      const later = events(id).filter((e) => ['AttemptSent', 'EscalationStepped', 'StepSkipped'].includes(e.event_type) && e.seq > answered.seq);
      expect(later).toEqual([]);
    }
  });

  // ----------------------------------------------------------------------------------------------- #50

  it('[01d #50] step targets from the alert: point from_value + managers; requester_lead; raised from a registered tick through raiseMany(tickCtx): raised_device_id hub, actor_id null', async () => {
    const tablet = pairDevice(hub, { type: 'tablet', name: 'Point tablet' });
    fakePoint.devices.set('PT1', [tablet.deviceId]);
    const fires: { inputs: RaiseInput[] } = { inputs: [] };
    registerTick({
      name: 'fires_raise',
      due: () => fires.inputs.length > 0,
      intents: (tx, _state, now) => {
        const results = alerts.raiseMany(alerts.tickCtx(tx, now), fires.inputs.splice(0));
        return results.flatMap((r) => r.events);
      },
    });
    fires.inputs.push(
      {
        kind: 't_point_like',
        subject: { stream_type: 'order', stream_id: 'O7' },
        target: { kind: 'person', staff_id: WAIT },
        values: { point_id: 'PT1', table_id: 'T7' },
        display,
        dedupe_key: 'ready:O7:L1',
      },
      {
        kind: 't_handover_like',
        subject: { stream_type: 'table', stream_id: 'T8' },
        target: { kind: 'person', staff_id: CASH },
        values: { table_id: 'T8' },
        display,
        dedupe_key: 'handover:T8',
        requester_staff_id: WAIT, // lead OWNER
        request: { receiver_staff_id: CASH },
      },
      {
        kind: 't_handover_like',
        subject: { stream_type: 'table', stream_id: 'T9' },
        target: { kind: 'person', staff_id: WAIT },
        values: { table_id: 'T9' },
        display,
        dedupe_key: 'handover:T9',
        requester_staff_id: CASH, // no lead
        request: { receiver_staff_id: WAIT },
      },
    );
    start();
    await pass();
    const raised = events().filter((e) => e.event_type === 'AlertRaised');
    expect(raised).toHaveLength(3);
    for (const e of raised) expect(e).toMatchObject({ actor_id: null, device_id: 'hub' });
    const [point, handover, noLead] = raised.map((e) => (e.payload as { alert_id: string }).alert_id) as [string, string, string];
    const rows = hub.deps.db.prepare('SELECT DISTINCT raised_device_id FROM alerts').all();
    expect(rows).toEqual([{ raised_device_id: 'hub' }]);

    hub.clock.advance(FAKE_STEP_1_MS);
    await pass();
    // the point's tablets and the managers (branch-scope force-release-table-lock: OWNER, MGR)
    expect(people(stepEvent(point, 1).payload)).toEqual([[MGR, null, 'recipient'], [OWNER, null, 'recipient'], [tablet.deviceId, null, 'recipient']].sort());
    expect(fakePoint.calls.at(-1)).toEqual([{ kind: 'point', point_id: 'PT1' }]);
    // requester_lead: WAIT's lead OWNER is informed; CASH has no lead → the step's other entries still go
    expect(people(stepEvent(handover, 1).payload)).toEqual([[CASH, null, 'answerer'], [OWNER, null, 'informed']]);
    expect(people(stepEvent(noLead, 1).payload)).toEqual([[WAIT, null, 'answerer']]);
    expect(stepEvent(point, 1)).toMatchObject({ actor_id: null, device_id: 'hub' });
    // from_value naming an undeclared key → startup error
    expect(() =>
      defineAlertKind({
        kind: 't_bad_from_value',
        family: 'action',
        subject: 'order',
        steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'point', from_value: 'nope' }, set: 'recipient' }] }],
        closes_on: 'owner',
        values_schema: z.object({ point_id: z.string() }),
        details_schema: null,
        lead_fallback: true,
        expires_at_day_close: true,
        silent: false,
        labels: { card: 'c', lock: 'l' },
        request: null,
      }),
    ).toThrow(/from_value 'nope' is not in values_schema/);
  });

  // ------------------------------------------------------------------------------------------- §3.5 rules

  it('[01d §3.5] the select runs inside writer.run: due reads outside BEGIN IMMEDIATE, intents reads inside', async () => {
    const [id] = raiseHub(twoStep(1)) as [string];
    start();
    const prepared: Array<{ sql: string; inTx: boolean; inIntents: boolean }> = [];
    const db = hub.deps.db;
    const prepare = db.prepare.bind(db);
    let inIntents = false;
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      prepared.push({ sql, inTx: db.inTransaction, inIntents });
      return prepare(sql);
    });
    const intents = alertsTick.intents.bind(alertsTick);
    vi.spyOn(alertsTick, 'intents').mockImplementation((tx, state, now) => {
      inIntents = true;
      try {
        return intents(tx, state, now);
      } finally {
        inIntents = false;
      }
    });
    hub.clock.advance(FAKE_STEP_1_MS);
    await pass();
    expect(steps(id)).toEqual(['AttemptSent:0', 'AttemptSent:1']);
    const dueAt = prepared.findIndex((p) => p.sql.includes('SELECT EXISTS'));
    const selectAt = prepared.findIndex((p) => /FROM alerts\s+WHERE state = 'open' AND next_due_at <= \?\s+ORDER BY next_due_at LIMIT 200/.test(p.sql));
    expect(dueAt).toBeGreaterThanOrEqual(0);
    expect(selectAt).toBeGreaterThan(dueAt);
    expect(prepared[dueAt]?.inTx).toBe(false);
    expect(prepared[selectAt]?.inTx).toBe(true);
    expect(prepared[dueAt]?.inIntents).toBe(false);
    // every read of intents (select, batch reads, routesFor) is inside the transaction
    const inside = prepared.filter((p) => p.inIntents);
    expect(inside.length).toBeGreaterThan(1);
    for (const p of inside) expect(p.inTx).toBe(true);
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN SELECT alert_id FROM alerts WHERE state = 'open' AND next_due_at <= ? ORDER BY next_due_at LIMIT 200`)
      .all(0) as Array<{ detail: string }>;
    expect(plan.map((r) => r.detail).join('\n')).toMatch(/INDEX alerts_due/);
  });

  it('[01d §3.5] a stale hint: the alert closes between due and run → the tick transaction appends nothing', async () => {
    const [id] = raiseHub(twoStep(1)) as [string];
    start();
    hub.clock.advance(FAKE_STEP_1_MS);
    const hook = hookAlerts(() => {
      hub.deps.writer.run((tx) => tx.append(alerts.close(alerts.tickCtx(tx, hub.clock.branchNow()), id, 'done')));
    });
    const run = vi.spyOn(hub.deps.writer, 'run');
    await pass();
    await hook.settled();
    expect(run).toHaveBeenCalledTimes(2); // the close, then the tick
    expect(run.mock.results[1]?.value.appended).toEqual([]);
    expect(steps(id)).toEqual(['AttemptSent:0']);
    expect(alertRow(id).state).toBe('closed');
    expect(log.error).not.toHaveBeenCalled();
  });

  it('[01d §3.5] after commit, alert frames (sendStepFrames) and registered route sends run once per step event; a skipped step sends nothing', async () => {
    // a text-format route (the fake pager is short_code, which these kinds have no `short` label for)
    const sent: Array<{ alert_id: string; step: number; route_ref: string }> = [];
    registerRoute({
      route: 'text_pager',
      format: 'text',
      ack: false,
      receipts: [],
      routesFor: (tx, staffIds) => {
        const rows = tx.db.prepare('SELECT value AS staff_id FROM json_each(?)').all(JSON.stringify(staffIds)) as Array<{ staff_id: string }>;
        return new Map(rows.filter((r) => r.staff_id === MGR).map((r) => [r.staff_id, [{ route_ref: `TXT-${r.staff_id}` }]]));
      },
      send: (alert, step, route_ref) => {
        sent.push({ alert_id: alert.alert_id, step, route_ref });
      },
    });
    const mgr = seat(MGR);
    const ws = await socketOf(mgr);
    const [id] = raiseHub(voidInput()) as [string];
    const frames = (): Array<{ step: number }> =>
      (ws.messages as Array<{ type: string; alert?: { alert_id: string; step: number } }>)
        .filter((m) => m.type === 'alert' && m.alert?.alert_id === id)
        .map((m) => ({ step: (m.alert as { step: number }).step }));
    await ws.untilCount(2);
    expect(frames()).toEqual([{ step: 0 }]);
    expect(sent).toEqual([{ alert_id: id, step: 0, route_ref: `TXT-${MGR}` }]);
    cleanFlags();
    start();
    hub.clock.advance(45_000);
    await pass();
    await ws.untilCount(3);
    expect(frames()).toEqual([{ step: 0 }, { step: 1 }]);
    expect(sent).toEqual([
      { alert_id: id, step: 0, route_ref: `TXT-${MGR}` },
      { alert_id: id, step: 1, route_ref: `TXT-${MGR}` },
    ]);
    // an idle pass sends nothing more
    await pass();
    await expect(ws.untilCount(4, 100)).rejects.toThrow();
    expect(frames()).toHaveLength(2);
    expect(sent).toHaveLength(2);

    // a lagged pass: step 2 sent once; the superseded step sends no frame and no route send
    const [lagged] = raiseHub(voidInput(2)) as [string];
    sent.length = 0;
    hub.clock.advance(120_000);
    await pass();
    expect(steps(lagged)).toEqual(['AttemptSent:0', 'StepSkipped:1:superseded', 'EscalationStepped:2']);
    const lagFrames = (): number[] =>
      (ws.messages as Array<{ type: string; alert?: { alert_id: string; step: number } }>)
        .filter((m) => m.type === 'alert' && m.alert?.alert_id === lagged)
        .map((m) => (m.alert as { step: number }).step);
    for (let i = 0; i < 20 && lagFrames().length < 2; i += 1) await ws.untilCount(ws.messages.length + 1, 200).catch(() => undefined);
    expect(lagFrames()).toEqual([0, 2]);
    // (the first alert reaches its own step 2 in the same pass; one send each)
    expect(sent.filter((x) => x.alert_id === lagged)).toEqual([{ alert_id: lagged, step: 2, route_ref: `TXT-${MGR}` }]);
    expect(sent.filter((x) => x.alert_id === id)).toEqual([{ alert_id: id, step: 2, route_ref: `TXT-${MGR}` }]);
  });

  it('[01d §3.5] LIMIT 200: 201 due alerts → 200 stepped in the first pass, 1 in the next, then no transaction', async () => {
    const ids = raiseHub(Array.from({ length: 201 }, (_, n) => twoStep(n)));
    start();
    hub.clock.advance(FAKE_STEP_1_MS);
    const counts = countTick();
    const run = vi.spyOn(hub.deps.writer, 'run');
    const stepped = (): number => (hub.deps.db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type = 'AttemptSent' AND json_extract(payload, '$.step') = 1").get() as { n: number }).n;
    await pass();
    expect(stepped()).toBe(200);
    await pass();
    expect(stepped()).toBe(201);
    await pass();
    expect(run).toHaveBeenCalledTimes(2);
    for (const id of ids) expect(steps(id)).toEqual(['AttemptSent:0', 'AttemptSent:1']);
    // the statement count does not grow with the number of due alerts (R = 0, T = 1 pager)
    expect(counts.due).toEqual([1, 1, 1]);
    expect(counts.intents).toHaveLength(2);
    expect(counts.intents[0]).toBe(counts.intents[1]);
    expect(counts.intents).toEqual([8, 8]); // select, 5 fixed, previous step, pager: the same for 200 alerts and for 1
    expect(counts.intents[0]).toBeLessThanOrEqual(8 + 0 + 1);
  });

  it('[01d §3.5] failed send: a recipient with no live socket is not retried within the step; the next step follows on schedule', async () => {
    const mgr = seat(MGR);
    fakePager.refs.clear(); // MGR's only route would be a screen socket; it is closed
    const ws = await socketOf(mgr);
    const [id] = raiseHub(voidInput()) as [string];
    await ws.untilCount(2);
    ws.close();
    start();
    hub.clock.advance(45_000);
    await pass();
    expect(steps(id)).toEqual(['AttemptSent:0', 'AttemptSent:1']);
    await pass();
    await pass();
    expect(steps(id)).toHaveLength(2); // no resend of step 1
    hub.clock.advance(75_000);
    await pass();
    expect(steps(id)).toEqual(['AttemptSent:0', 'AttemptSent:1', 'EscalationStepped:2']);
  });

  // ------------------------------------------------------------------------- "for" rows through the tick

  it('[01d §3.4.3] a person reached directly in step 0 and covered by a "for" row in step 1: moved_to becomes the lead (literal §5.2)', async () => {
    const [id] = raiseHub(twoStep(1)) as [string];
    expect(people(stepEvent(id, 0).payload)).toEqual([[WAIT, null, 'recipient']]);
    fakePager.refs.delete(WAIT); // WAIT has no route any more → the lead OWNER takes a "for WAIT" row
    start();
    hub.clock.advance(FAKE_STEP_1_MS);
    await pass();
    expect(stepEvent(id, 1).payload.recipients).toEqual([{ staff_id: OWNER, device_id: null, for_staff_id: WAIT, set: 'recipient' }]);
    expect(inbox(id)).toEqual([
      { staff_id: OWNER, moved_to: null },
      { staff_id: WAIT, moved_to: OWNER },
    ]);
  });

  it('[01d §3.4.3] a person covered by a "for" row in step 0 and reached directly in step 1 gets their own inbox row then', async () => {
    fakePager.refs.delete(WAIT);
    const [id] = raiseHub(twoStep(1)) as [string];
    expect(stepEvent(id, 0).payload.recipients).toEqual([{ staff_id: OWNER, device_id: null, for_staff_id: WAIT, set: 'recipient' }]);
    expect(inbox(id)).toEqual([{ staff_id: OWNER, moved_to: null }]); // WAIT has no row yet
    fakePager.refs.set(WAIT, [`P-${WAIT}`]);
    start();
    hub.clock.advance(FAKE_STEP_1_MS);
    await pass();
    expect(stepEvent(id, 1).payload.recipients).toEqual([{ staff_id: WAIT, device_id: null, for_staff_id: null, set: 'recipient' }]);
    expect(inbox(id)).toEqual([
      { staff_id: OWNER, moved_to: WAIT },
      { staff_id: WAIT, moved_to: null },
    ]);
  });

  /** An alert whose stored values bypass the kind's schema (a raw event, as from an older build): AlertRaised (+ step 0). */
  function rawAlert(o: { alert_id: string; kind: string; values: Record<string, unknown>; target: RaiseInput['target']; step0: boolean }): void {
    const now = hub.clock.branchNow();
    const draft = (event_type: string, payload: Record<string, unknown>) => ({
      stream_type: 'hub' as const,
      stream_id: BRANCH,
      event_type,
      schema_version: 1,
      payload,
      occurred_at: now,
      actor_id: null,
      device_id: 'hub',
    });
    hub.deps.writer.run((tx) => {
      const drafts = [
        draft('AlertRaised', {
          alert_id: o.alert_id,
          kind: o.kind,
          family: kindFamily(o.kind),
          subject_stream_type: 'hub',
          subject_stream_id: BRANCH,
          dedupe_key: `raw:${o.alert_id}`,
          requester_staff_id: null,
          target: o.target,
          values: o.values,
          display,
          details: null,
          hidden_from: null,
          request: null,
        }),
      ];
      if (o.step0) drafts.push(draft('AttemptSent', { alert_id: o.alert_id, step: 0, recipients: [], routes: [] }));
      tx.append(drafts);
    });
  }
  const kindFamily = (kind: string): string => (kind === 't_point_like' ? 'action' : 'info');

  const skippedLines = (): Array<Record<string, unknown>> =>
    log.error.mock.calls.map((c) => c[0]).filter((line) => line.alert_id !== undefined);

  it('[01d §3.5 G1-16] per-alert guard: a poisoned alert next to a healthy due one → the healthy one steps, the poisoned one is skipped with one safe log line per pass, nothing rolls back', async () => {
    const poisoned = '01J0000000000000000000POIS';
    rawAlert({ alert_id: poisoned, kind: 't_point_like', values: { point_id: '', table_id: 'T-SECRET' }, target: { kind: 'person', staff_id: WAIT }, step0: true });
    const [healthy] = raiseHub(twoStep(1)) as [string];
    const dueBefore = alertRow(poisoned).next_due_at;
    start();
    const run = vi.spyOn(hub.deps.writer, 'run');
    hub.clock.advance(FAKE_STEP_1_MS);
    await pass();
    expect(steps(healthy)).toEqual(['AttemptSent:0', 'AttemptSent:1']); // committed in the same pass
    expect(steps(poisoned)).toEqual(['AttemptSent:0']);
    expect(run.mock.results[0]?.value.appended.map((e: PosEvent) => e.event_type)).toEqual(['AttemptSent']);
    expect(skippedLines()).toEqual([{ tick: 'alerts', alert_id: poisoned, kind: 't_point_like', err: { name: 'Error', code: null } }]);
    expect(log.error.mock.calls.some((c) => c[1] === 'tick failed')).toBe(false); // no rollback
    expect(JSON.stringify(log.error.mock.calls)).not.toMatch(/T-SECRET|point_id|from_value/);
    // not closed and next_due_at unchanged: selected and logged again on the next pass
    expect(alertRow(poisoned)).toEqual({ state: 'open', step: 0, next_due_at: dueBefore });
    await pass();
    expect(skippedLines()).toHaveLength(2);
    expect(steps(poisoned)).toEqual(['AttemptSent:0']);
    expect(steps(healthy)).toHaveLength(2);
  });

  it('[01d §3.5 G1-16] a bad step 2 does not stop step 1: the scan stops at the first step not yet due; step 1 is sent, step 2 is logged and never due', async () => {
    defineAlertKind({
      kind: 't_bad_window',
      family: 'info',
      subject: 'hub',
      steps: [
        { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
        { at: { ms: 10_000 }, to: [{ target: 'raised_target', set: 'recipient' }] },
        { at: { value: 'window_ms', times: 2 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      ],
      closes_on: 'owner',
      values_schema: z.object({ window_ms: z.number() }),
      details_schema: null,
      lead_fallback: true,
      expires_at_day_close: true,
      silent: false,
      labels: { card: 'c', lock: 'l' },
      request: null,
    });
    const id = '01J0000000000000000000BADW';
    rawAlert({ alert_id: id, kind: 't_bad_window', values: { window_ms: 'soon' }, target: { kind: 'person', staff_id: CASH }, step0: false });
    start();
    await pass(); // step 0 due, step 1 not yet: the scan stops there and never evaluates step 2
    expect(steps(id)).toEqual(['AttemptSent:0']);
    expect(skippedLines()).toEqual([]);
    hub.clock.advance(10_000);
    await pass(); // step 1 due; step 2's time cannot be computed → not due, logged once; step 1 still goes
    expect(steps(id)).toEqual(['AttemptSent:0', 'AttemptSent:1']);
    expect(skippedLines()).toEqual([{ tick: 'alerts', alert_id: id, kind: 't_bad_window', err: { name: 'Error', code: null } }]);
    expect(alertRow(id)).toEqual({ state: 'open', step: 1, next_due_at: null });
    const run = vi.spyOn(hub.deps.writer, 'run');
    hub.clock.advance(60_000);
    await pass();
    expect(run).not.toHaveBeenCalled();
    expect(log.error.mock.calls.some((c) => c[1] === 'tick failed')).toBe(false);
  });

  it('[01d §3.5] an alert of a kind this build does not register is never selected (next_due_at NULL)', async () => {
    const [id] = raiseHub(twoStep(1)) as [string];
    hub.deps.db.prepare("UPDATE alerts SET kind = 't_gone', next_due_at = NULL WHERE alert_id = ?").run(id);
    start();
    const run = vi.spyOn(hub.deps.writer, 'run');
    hub.clock.advance(FAKE_STEP_1_MS * 10);
    await pass();
    expect(run).not.toHaveBeenCalled();
    expect(steps(id)).toEqual(['AttemptSent:0']);
  });
});
