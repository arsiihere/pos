import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed, aDevicePaired } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineAlertKind, kindOf, unregisterAlertKind, type AlertKind } from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { alertsTick, startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { activity } from '../../src/auth/session-store';
import { aDirectory, PIN } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FAKE_STEP_1_MS, fakePager, registerFakes, resetFakes } from './fakes';

// 01d task 29: the `alerts` tick's expiry (§3.5): `expire_due` (day close, set by the projection on
// BusinessDayClosed) and `closes_on.after_ms` close an alert `AlertClosed { reason: 'expired' }` in the next
// tick, never in the day-close transaction, and an expiring alert is never stepped. Requests never expire and
// 01d never auto-closes them (§3.3 "No expiry for requests", "Requests no one can answer"). Expiry reads
// nothing beyond the due select and does not depend on the alert's stored values (a poisoned alert still
// expires). Tests #24, #36, #51 and Review Focus 1. Fake setInterval; the fixed hub clock is moved by hand.

const OWNER = 'S_OWNER';
const MGR = 'S_MGR'; // approver (R_MGR), PIN.b
const CASH = 'S_CASH';
const WAIT = 'S_WAIT'; // requester
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
              approver_role_ids: ['R_MGR'],
              scope: 'branch' as const,
            },
          ],
        }
      : role,
  );
  return { ...base, roles };
}

const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };
const voidInput = (n: number): RaiseInput => ({
  kind: 't_approval',
  subject: { stream_type: 'order', stream_id: `O${n}` },
  target: { kind: 'answerers' },
  values: { order_id: `O${n}` },
  display,
  details: { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' },
  dedupe_key: `void:O${n}:L1`,
  requester_staff_id: WAIT,
  request: { approver_role_ids: ['R_MGR'] },
});
const acceptInput = (n: number): RaiseInput => ({
  kind: 't_accept',
  subject: { stream_type: 'table', stream_id: `T${n}` },
  target: { kind: 'person', staff_id: CASH },
  display,
  dedupe_key: `accept:T${n}`,
  requester_staff_id: WAIT,
  request: { receiver_staff_id: CASH },
});
const infoInput = (n: number, staffId = CASH): RaiseInput => ({
  kind: 't_info',
  subject: { stream_type: 'hub', stream_id: BRANCH },
  target: { kind: 'person', staff_id: staffId },
  display,
  dedupe_key: `info:${n}`,
});
const noticeInput = (n: number): RaiseInput => ({
  kind: 'pin_use_failed',
  subject: { stream_type: 'order', stream_id: `O${n}` },
  target: { kind: 'person', staff_id: MGR },
  values: { request_alert_id: `01J00000000000000000000R${n}`, request_kind: 't_approval', error_code: 'ITEM_WRONG_STAGE', device_id: 'dev-x' },
  display,
  dedupe_key: `pin_use_failed:${n}`,
});

/** §3.5: a kind with `closes_on.after_ms` 10 s and a step at 20 s, after the expiry time. */
const EXPIRING = 't_expiring';
const EXPIRY_MS = 10_000;
/**
 * A request kind with a step long after raise, so the tick selects it again: requests never expire (§3.3).
 * It cannot declare `closes_on.after_ms`: that is a startup error (AD-124).
 */
const REQ_EXPIRING = 't_req_expiring';
/** An `after_ms` kind whose step 1 time comes from the values: poisoned when the values are bad. */
const POISON_EXPIRING = 't_poison_expiring';

function defineLocalKinds(): void {
  defineAlertKind({
    kind: EXPIRING,
    family: 'info',
    subject: 'hub',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      { at: { ms: 2 * EXPIRY_MS }, to: [{ target: 'raised_target', set: 'recipient' }] },
    ],
    closes_on: { after_ms: EXPIRY_MS },
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: { card: 'c', lock: 'l' },
    request: null,
  });
  defineAlertKind({
    kind: REQ_EXPIRING,
    family: 'action',
    subject: 'table',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'answerer' }] },
      { at: { ms: 2 * EXPIRY_MS }, to: [{ target: 'raised_target', set: 'answerer' }] },
    ],
    closes_on: 'owner',
    values_schema: z.object({}),
    details_schema: null,
    lead_fallback: false,
    expires_at_day_close: true,
    silent: false,
    labels: { card: 'c', lock: 'l' },
    request: { answers: ['accept', 'decline'], right: { mode: 'named' }, needs_pin: 'never', apply: () => [] },
  });
  defineAlertKind({
    kind: POISON_EXPIRING,
    family: 'info',
    subject: 'hub',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
      { at: { value: 'window_ms', times: 1 }, to: [{ target: 'raised_target', set: 'recipient' }] },
    ],
    closes_on: { after_ms: EXPIRY_MS },
    values_schema: z.object({ window_ms: z.number() }),
    details_schema: null,
    lead_fallback: true,
    expires_at_day_close: true,
    silent: false,
    labels: { card: 'c', lock: 'l' },
    request: null,
  });
}

describe('01d alerts tick: expiry and day close (task 29)', () => {
  let hub: TestHub;
  let stop: () => void = () => undefined;
  const clients: WsClient[] = [];
  const log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    hub = await createTestHub();
    registerFakes();
    defineLocalKinds();
    await seedDirectory(hub, await directory());
    cleanFlags();
    for (const id of [OWNER, MGR, CASH, WAIT]) fakePager.refs.set(id, [`P-${id}`]);
    log.error.mockClear();
  });

  afterEach(async () => {
    stop();
    stop = () => undefined;
    for (const c of clients.splice(0)) c.close();
    vi.restoreAllMocks();
    for (const k of [EXPIRING, REQ_EXPIRING, POISON_EXPIRING]) unregisterAlertKind(k);
    resetFakes();
    activity.drain();
    activity.drainDevices();
    vi.useRealTimers();
    await hub.close();
  });

  function start(): void {
    stop = startTickLoop(hub.deps, log);
  }

  /** SessionStarted / BusinessDayClosed mark no_approver dirty; its flag pass is task 31, so tests clear it. */
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

  const draftOf = (e: PosEvent): EventDraft => ({
    stream_type: e.stream_type,
    stream_id: e.stream_id,
    event_type: e.event_type,
    schema_version: e.schema_version,
    payload: e.payload,
    occurred_at: hub.clock.branchNow(),
    actor_id: e.actor_id,
    device_id: e.device_id,
  });

  /** Appends BusinessDayClosed in its own transaction; returns its seq. Clears the task-31 flag after. */
  function closeDay(): number {
    const [closed] = hub.deps.writer.run((tx) => tx.append([draftOf(aBusinessDayClosed())])).appended as PosEvent[];
    cleanFlags();
    return (closed as PosEvent).seq;
  }

  function events(alertId?: string): PosEvent[] {
    const rows = hub.deps.db.prepare('SELECT * FROM events ORDER BY seq').all() as Array<Record<string, unknown>>;
    const all = rows.map((row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent);
    return alertId === undefined ? all : all.filter((e) => (e.payload as { alert_id?: unknown }).alert_id === alertId);
  }

  /** The 01d facts of an alert after its raise, in log order: `type:step` / `AlertClosed:reason`. */
  function facts(alertId: string): string[] {
    return events(alertId)
      .filter((e) => ['AttemptSent', 'EscalationStepped', 'StepSkipped', 'AlertClosed'].includes(e.event_type))
      .map((e) => {
        const p = e.payload as { step?: number; reason?: string };
        return e.event_type === 'AlertClosed' ? `AlertClosed:${p.reason}` : `${e.event_type}:${p.step}`;
      });
  }

  function closedEvents(): PosEvent[] {
    return events().filter((e) => e.event_type === 'AlertClosed');
  }

  function alertRow(alertId: string): { state: string; close_reason: string | null; expire_due: number; next_due_at: number | null; step: number } {
    return hub.deps.db
      .prepare('SELECT state, close_reason, expire_due, next_due_at, step FROM alerts WHERE alert_id = ?')
      .get(alertId) as { state: string; close_reason: string | null; expire_due: number; next_due_at: number | null; step: number };
  }

  const preCheck = (): boolean => alertsTick.due(hub.deps.db, hub.deps.state.get(), hub.clock.branchNow());

  /** Statement counts of every alerts.due and alerts.intents call (the tick's own reads, §3.5). */
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

  /** An alert written as raw events (values that bypass the kind's schema, as from an older build). */
  function rawAlert(o: { alert_id: string; kind: string; family: string; values: Record<string, unknown> }): void {
    const now = hub.clock.branchNow();
    const draft = (event_type: string, payload: Record<string, unknown>): EventDraft => ({
      stream_type: 'hub',
      stream_id: BRANCH,
      event_type,
      schema_version: 1,
      payload,
      occurred_at: now,
      actor_id: null,
      device_id: 'hub',
    });
    hub.deps.writer.run((tx) =>
      tx.append([
        draft('AlertRaised', {
          alert_id: o.alert_id,
          kind: o.kind,
          family: o.family,
          subject_stream_type: 'hub',
          subject_stream_id: BRANCH,
          dedupe_key: `raw:${o.alert_id}`,
          requester_staff_id: null,
          target: { kind: 'person', staff_id: CASH },
          values: o.values,
          display,
          details: null,
          hidden_from: null,
          request: null,
        }),
        draft('AttemptSent', { alert_id: o.alert_id, step: 0, recipients: [], routes: [] }),
      ]),
    );
  }

  const skippedLines = (): Array<Record<string, unknown>> =>
    log.error.mock.calls.map((c) => c[0]).filter((line) => line.alert_id !== undefined);

  // ----------------------------------------------------------------------------------------------- #24

  it('[01d #24] day close: requests stay open; tablet (and kiosk) binding rows cleared; phone bindings kept; open personal notices stay open', async () => {
    const tablet = pairDevice(hub, { type: 'tablet', name: 'Cash tablet' });
    openSession(hub, { kind: 'staff', staffId: CASH, deviceId: tablet.deviceId });
    const kiosk = pairDevice(hub, { type: 'cashier_kiosk', name: 'Kiosk' });
    openSession(hub, { kind: 'staff', staffId: OWNER, deviceId: kiosk.deviceId });
    const phone = pairDevice(hub, { type: 'phone', ownerStaffId: MGR, name: 'MGR phone' });
    hub.deps.writer.run((tx) =>
      tx.append([
        draftOf(
          aDevicePaired({
            stream_id: phone.deviceId,
            payload: { device_id: phone.deviceId, device_type: 'phone', station_id: null, owner_staff_id: MGR },
          }),
        ),
      ]),
    );
    const bindings = () =>
      hub.deps.db.prepare('SELECT device_id, staff_id, session_id IS NULL AS phone FROM device_bindings ORDER BY staff_id').all();
    // BF-3 (AD-46): a kiosk binds no one, so its "cleared" row never exists
    expect(bindings()).toEqual([
      { device_id: tablet.deviceId, staff_id: CASH, phone: 0 },
      { device_id: phone.deviceId, staff_id: MGR, phone: 1 },
    ]);
    const [voidId, acceptId, noticeId] = [...raiseHub([voidInput(1), acceptInput(1)]), ...raiseHub(noticeInput(1))] as [string, string, string];
    cleanFlags();
    start();
    closeDay();
    for (let i = 0; i < 3; i += 1) await pass();

    expect(bindings()).toEqual([{ device_id: phone.deviceId, staff_id: MGR, phone: 1 }]);
    for (const id of [voidId, acceptId, noticeId]) {
      expect(alertRow(id)).toMatchObject({ state: 'open', close_reason: null, expire_due: 0 });
      expect(facts(id)).toEqual(['AttemptSent:0']);
    }
    expect(alerts.listOpen(hub.deps.db, {}).map((a) => a.alert_id)).toEqual([voidId, acceptId, noticeId]);
    expect(closedEvents()).toEqual([]);
  });

  // ----------------------------------------------------------------------------------------------- #36

  it('[01d #36] day close → open info alerts closed expired by the next tick, not in the day-close transaction; personal notices stay open', async () => {
    const tablet = pairDevice(hub, { type: 'tablet', name: 'Cash tablet' });
    const session = openSession(hub, { kind: 'staff', staffId: CASH, deviceId: tablet.deviceId });
    const ws = await connectWs(hub.app);
    clients.push(ws);
    ws.send({ type: 'auth', device_token: tablet.token, session_token: session.token });
    await ws.untilCount(1);
    const [info] = raiseHub(infoInput(1)) as [string];
    const [notice] = raiseHub(noticeInput(1)) as [string];
    await ws.untilCount(2); // the info alert's step-0 frame
    cleanFlags();
    start();
    const run = vi.spyOn(hub.deps.writer, 'run');

    const daySeq = closeDay();
    // the day-close transaction only marks it (a projection write, no event)
    expect(alertRow(info)).toMatchObject({ state: 'open', expire_due: 1, next_due_at: hub.clock.branchNow() });
    expect(alertRow(notice)).toMatchObject({ state: 'open', expire_due: 0 });
    expect(closedEvents()).toEqual([]);
    expect(run.mock.results[0]?.value.appended.map((e: PosEvent) => e.event_type)).toEqual(['BusinessDayClosed']);

    await pass();
    const closed = closedEvents();
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      event_type: 'AlertClosed',
      payload: { alert_id: info, reason: 'expired', by_staff_id: null, note: null },
      actor_id: null,
      device_id: 'hub',
      stream_type: 'hub',
      stream_id: BRANCH,
    });
    expect((closed[0] as PosEvent).seq).toBeGreaterThan(daySeq);
    expect(run).toHaveBeenCalledTimes(2); // day close, then the tick's own transaction
    expect(run.mock.results[1]?.value.appended.map((e: PosEvent) => e.event_type)).toEqual(['AlertClosed']);
    expect(alertRow(info)).toMatchObject({ state: 'closed', close_reason: 'expired', next_due_at: null });
    expect(alertRow(notice)).toMatchObject({ state: 'open', expire_due: 0 });
    // the recipient's socket gets the close frame (ws-frames' after-commit hook)
    const closedFrame = async () => {
      for (;;) {
        const frame = ws.messages.find((m) => (m as { type?: string }).type === 'alert_closed');
        if (frame !== undefined) return frame;
        await ws.untilCount(ws.messages.length + 1);
      }
    };
    expect(await closedFrame()).toEqual({ type: 'alert_closed', alert_id: info, reason: 'expired', decision: null, by_name: null });

    await pass();
    expect(run).toHaveBeenCalledTimes(2); // nothing more due
    expect(facts(info)).toEqual(['AttemptSent:0', 'AlertClosed:expired']);
    expect(facts(notice)).toEqual(['AttemptSent:0']);
  });

  // ----------------------------------------------------------------------------------------------- #51

  it('[01d #51] listOpen: requests of kind K across two subjects, oldest first, 1 statement; still open and listed after day close; the tick never closes them; the owner closes them obsolete → request_result', async () => {
    const [first] = raiseHub(voidInput(1)) as [string];
    hub.clock.advance(1_000);
    const [second] = raiseHub(voidInput(2)) as [string];
    const counter = statementCounter(hub.deps.db);
    const list = (o: Parameters<typeof alerts.listOpen>[1]) => {
      counter.reset();
      const ids = alerts.listOpen(hub.deps.db, o).map((a) => a.alert_id);
      expect(counter.count).toBe(1);
      return ids;
    };
    expect(list({ kind: 't_approval' })).toEqual([first, second]);
    expect(list({ kind: 't_approval', subject: { stream_type: 'order', stream_id: 'O2' } })).toEqual([second]);

    start();
    closeDay();
    hub.clock.advance(3_600_000); // every approval step long past
    for (let i = 0; i < 3; i += 1) await pass();
    expect(list({ kind: 't_approval' })).toEqual([first, second]);
    for (const id of [first, second]) expect(alertRow(id)).toMatchObject({ state: 'open', expire_due: 0 });

    // the requester leaves the directory: 01d still does not close them; an answer is refused
    const dir = await directory();
    await seedDirectory(hub, { ...dir, directory_version: dir.directory_version + 1, staff: dir.staff.filter((s) => s.staff_id !== WAIT) });
    cleanFlags();
    for (let i = 0; i < 3; i += 1) await pass();
    expect(list({ kind: 't_approval' })).toEqual([first, second]);
    const mgrTablet = pairDevice(hub, { type: 'tablet', name: 'MGR tablet' });
    const mgr = openSession(hub, { kind: 'staff', staffId: MGR, deviceId: mgrTablet.deviceId });
    cleanFlags();
    const response = await hub.app.inject({
      method: 'POST',
      url: '/commands/answer-request',
      headers: { authorization: `Bearer ${mgrTablet.token}`, 'x-session-token': mgr.token },
      payload: {
        command_id: 'expiry-answer-1',
        tenant_id: TENANT,
        branch_id: BRANCH,
        command_type: 'AnswerRequest',
        payload: { alert_id: first, decision: 'approve', method: 'pin', pin: PIN.b },
        occurred_at: hub.clock.branchNow(),
        actor_id: MGR,
        device_id: mgrTablet.deviceId,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'not_approver' } });
    expect(closedEvents()).toEqual([]);

    // the owning module decides: it closes them obsolete; each requester gets a request_result
    hub.deps.writer.run((tx) => {
      const ctx = alerts.tickCtx(tx, hub.clock.branchNow());
      tx.append(alerts.closeMany(ctx, [first, second].map((alert_id) => ({ alert_id, reason: 'obsolete' as const, note: 'requester left' }))));
    });
    for (const id of [first, second]) expect(alertRow(id)).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
    const results = events().filter((e) => e.event_type === 'AlertRaised' && (e.payload as { kind: string }).kind === 'request_result');
    expect(results.map((e) => (e.payload as { values: { request_alert_id: string } }).values.request_alert_id)).toEqual([first, second]);
    expect(results.map((e) => (e.payload as { target: unknown }).target)).toEqual([
      { kind: 'person', staff_id: WAIT },
      { kind: 'person', staff_id: WAIT },
    ]);
    expect(list({ kind: 't_approval' })).toEqual([]);
  });

  // ------------------------------------------------------------------------------------- Review Focus 1

  it('[01d RF-1] day close with 250 open t_info alerts: pass 1 closes 200 expired, pass 2 the other 50, each exactly once; the next pre-check is false; the statement count is the same for 250 as for 1', async () => {
    const ids = raiseHub(Array.from({ length: 250 }, (_, n) => infoInput(n)));
    cleanFlags();
    start();
    closeDay();
    expect(preCheck()).toBe(true);
    const counts = countTick();
    const run = vi.spyOn(hub.deps.writer, 'run');
    await pass();
    expect(closedEvents()).toHaveLength(200);
    await pass();
    expect(closedEvents()).toHaveLength(250);
    await pass();
    expect(run).toHaveBeenCalledTimes(2);
    expect(preCheck()).toBe(false);

    const closedIds = closedEvents().map((e) => (e.payload as { alert_id: string }).alert_id);
    expect(new Set(closedIds).size).toBe(250); // no AlertClosed twice for one id
    expect([...closedIds].sort()).toEqual([...ids].sort());
    for (const e of closedEvents()) expect(e.payload).toMatchObject({ reason: 'expired', by_staff_id: null, note: null });
    for (const id of ids) expect(alertRow(id)).toMatchObject({ state: 'closed', close_reason: 'expired', next_due_at: null });
    expect(run.mock.results.map((r) => (r.value as { appended: PosEvent[] }).appended.length)).toEqual([200, 50]);

    // expiry reads nothing beyond the due select (R = 0, T = 0 for these drafts): 1 statement, ≤ 1 + 8 + R + T
    expect(counts.due).toEqual([1, 1, 1, 1]); // three passes and the preCheck() above
    expect(counts.intents).toEqual([1, 1]);

    // the same count for 1 alert
    const [one] = raiseHub(infoInput(999)) as [string];
    closeDay();
    await pass();
    expect(alertRow(one)).toMatchObject({ state: 'closed', close_reason: 'expired' });
    expect(counts.intents).toEqual([1, 1, 1]);
  });

  // ---------------------------------------------------------------------------------------- §3.5 after_ms

  it('[01d §3.5] after_ms: next_due_at = raised_at + after_ms; 1 ms before the pre-check is false; at the expiry time the tick writes AlertClosed expired, no step event; a step after the expiry time is never sent', async () => {
    const raisedAt = hub.clock.branchNow();
    const [id] = raiseHub({ kind: EXPIRING, subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'person', staff_id: CASH }, display, dedupe_key: 'exp:1' }) as [string];
    expect(alertRow(id)).toMatchObject({ state: 'open', step: 0, next_due_at: raisedAt + EXPIRY_MS });
    cleanFlags();
    start();
    const run = vi.spyOn(hub.deps.writer, 'run');
    hub.clock.advance(EXPIRY_MS - 1);
    expect(preCheck()).toBe(false);
    await pass();
    expect(run).not.toHaveBeenCalled();
    hub.clock.advance(1);
    expect(preCheck()).toBe(true);
    await pass();
    expect(facts(id)).toEqual(['AttemptSent:0', 'AlertClosed:expired']);
    expect(run.mock.results[0]?.value.appended.map((e: PosEvent) => e.event_type)).toEqual(['AlertClosed']);
    hub.clock.advance(2 * EXPIRY_MS);
    await pass();
    expect(facts(id)).toEqual(['AttemptSent:0', 'AlertClosed:expired']);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('[01d §3.5] a kind with after_ms and a step after the expiry time, both past at one tick (lag / restart) → closed expired, never stepped, nothing skipped', async () => {
    const [id] = raiseHub({ kind: EXPIRING, subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'person', staff_id: CASH }, display, dedupe_key: 'exp:2' }) as [string];
    cleanFlags();
    start();
    hub.clock.advance(3 * EXPIRY_MS); // step 1 (20 s) and the expiry (10 s) both past
    await pass();
    expect(facts(id)).toEqual(['AttemptSent:0', 'AlertClosed:expired']);
    expect(fakePager.sent.filter((s) => s.alert_id === id && s.step > 0)).toEqual([]);
  });

  it('[01d §3.5] expire_due wins over a due step: an alert whose step 1 is due at day close is closed expired, not stepped; healthy steps in the same pass still go', async () => {
    const [expiring] = raiseHub(infoInput(1)) as [string];
    const [twoStep] = raiseHub({ kind: 't_two_step', subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'person', staff_id: CASH }, display, dedupe_key: 'two:1' }) as [string];
    cleanFlags();
    start();
    hub.clock.advance(FAKE_STEP_1_MS); // t_two_step's step 1 due
    closeDay(); // t_two_step is expires_at_day_close too: both expire
    const [later] = raiseHub({ kind: 't_two_step', subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'person', staff_id: CASH }, display, dedupe_key: 'two:2' }) as [string];
    hub.clock.advance(FAKE_STEP_1_MS); // the alert raised after day close steps normally
    cleanFlags();
    const run = vi.spyOn(hub.deps.writer, 'run');
    await pass();
    expect(facts(expiring)).toEqual(['AttemptSent:0', 'AlertClosed:expired']);
    expect(facts(twoStep)).toEqual(['AttemptSent:0', 'AlertClosed:expired']);
    expect(facts(later)).toEqual(['AttemptSent:0', 'AttemptSent:1']);
    expect(run).toHaveBeenCalledTimes(1); // one transaction for the closes and the step
  });

  it('[01d §3.3] no expiry for requests: a request kind cannot declare after_ms (AD-124); a request selected again by the tick and through day close is never closed expired', async () => {
    expect(() =>
      defineAlertKind({ ...(kindOf(REQ_EXPIRING) as AlertKind), kind: 't_req_after_ms', closes_on: { after_ms: EXPIRY_MS } }),
    ).toThrow(/closes_on.after_ms on a request kind/);
    expect(kindOf('t_req_after_ms')).toBeUndefined();
    const [id] = raiseHub({
      kind: REQ_EXPIRING,
      subject: { stream_type: 'table', stream_id: 'T1' },
      target: { kind: 'person', staff_id: CASH },
      display,
      dedupe_key: 'req-exp:1',
      requester_staff_id: WAIT,
      request: { receiver_staff_id: CASH },
    }) as [string];
    cleanFlags();
    start();
    hub.clock.advance(10 * EXPIRY_MS);
    for (let i = 0; i < 3; i += 1) await pass();
    closeDay();
    for (let i = 0; i < 3; i += 1) await pass();
    expect(alertRow(id)).toMatchObject({ state: 'open', close_reason: null, expire_due: 0 });
    expect(facts(id)).toEqual(['AttemptSent:0', 'AttemptSent:1']); // stepped by the tick, never closed
    expect(log.error.mock.calls.some((c) => c[1] === 'tick failed')).toBe(false);
  });

  // ------------------------------------------------------------------------- poisoned alerts still expire

  /** AD-123: the `alerts` projection's one line for an alert retired because a step cannot be computed. */
  const stuckLines = (): string[] => hub.logs().split('\n').filter((line) => line.includes('alert_stuck'));

  it('[01d §3.5 G1-16 AD-123] expiry does not depend on the step plan: a poisoned alert with after_ms keeps its expiry time and is closed expired; one stuck line, no tick line', async () => {
    const id = '01J0000000000000000000PEXP';
    rawAlert({ alert_id: id, kind: POISON_EXPIRING, family: 'info', values: { window_ms: 'soon' } });
    // the projection retires the uncomputable step (one line); next_due_at is the expiry time (AD-121)
    expect(alertRow(id)).toMatchObject({ state: 'open', step: 0, next_due_at: hub.clock.branchNow() + EXPIRY_MS });
    expect(stuckLines()).toHaveLength(1);
    // and with the bad step forced due as well, the tick finds nothing to send and logs nothing
    hub.deps.db.prepare('UPDATE alerts SET next_due_at = ? WHERE alert_id = ?').run(hub.clock.branchNow(), id);
    cleanFlags();
    start();
    const run = vi.spyOn(hub.deps.writer, 'run');
    await pass();
    expect(facts(id)).toEqual(['AttemptSent:0']);
    hub.clock.advance(EXPIRY_MS);
    await pass();
    expect(facts(id)).toEqual(['AttemptSent:0', 'AlertClosed:expired']);
    await pass();
    expect(run).toHaveBeenCalledTimes(2);
    expect(skippedLines()).toHaveLength(0);
    expect(stuckLines()).toHaveLength(1);
  });

  it('[01d §3.5 G1-16 AD-123] expiry does not depend on the step plan: a poisoned alert at day close (expire_due) is closed expired', async () => {
    const id = '01J0000000000000000000PDAY';
    rawAlert({ alert_id: id, kind: 't_point_like', family: 'action', values: { point_id: '', table_id: 'T1' } });
    // step 1 (from_value '') cannot be routed: retired at once, never due
    expect(alertRow(id)).toMatchObject({ state: 'open', step: 0, next_due_at: null });
    expect(stuckLines()).toHaveLength(1);
    cleanFlags();
    start();
    hub.clock.advance(FAKE_STEP_1_MS);
    const before = vi.spyOn(hub.deps.writer, 'run');
    await pass();
    expect(before).not.toHaveBeenCalled();
    before.mockRestore();
    closeDay();
    await pass();
    expect(facts(id)).toEqual(['AttemptSent:0', 'AlertClosed:expired']);
    expect(skippedLines()).toHaveLength(0);
    expect(stuckLines()).toHaveLength(1);
    const run = vi.spyOn(hub.deps.writer, 'run');
    await pass();
    expect(run).not.toHaveBeenCalled();
  });
});
