import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aPresenceSet } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts, requestResultInput, type RaiseInput, type RaiseResult } from '../../src/alerts/raise';
import { activity } from '../../src/auth/session-store';
import { currentDirectory } from '../../src/auth/guards';
import type { CommandCtx } from '../../src/commands/registry';
import { aDirectory, PIN } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { fakeAlsoTo, fakeApply, fakePager, fakeTableOwner, registerFakes, resetFakes } from './fakes';

// 01d v1.2.5 D-2 (04 §4.5 D-2; gap rows G-7, G-8, G-9), 01d test 67; 04 #23 (01d half) and 04 #31 cite it.
// `request.result_also_to(ctx)` runs in AnswerRequest's `handle` on a reject only, on a read-only view, never
// in `preRead`; a non-null target → one more `request_result` (dedupe `request_result:<alert_id>:also`) in the
// answer's one `raiseMany`, outside `checkAlertIds`; dropped by `drop_if_only` when the routed recipients are
// only the requester. Bound on a reject +2 (the hook's read, one `table_team` resolver call); approve / withdraw
// +0. `t_approval_also` (fakes.ts) is `t_approval` plus the hook; the table team comes from 01d's own
// fakeTableOwner resolver (owner depth → [holder]).

const MGR = 'S_MGR'; // approver, PIN.b
const WAIT = 'S_WAIT'; // requester; void-item requires approval by R_MGR or R_OWNER
const HOLDER = 'S_CASH'; // the table holder in these tests
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const TABLE = 'T12';
const DETAILS = { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' };
const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory({ directory_version: 1 });
  const roles = base.roles.map((role) =>
    role.role_id === 'R_WAIT'
      ? {
          ...role,
          permissions: [
            {
              permission: 'void-item' as const,
              grant_type: 'requires_approval' as const,
              approver_role_id: 'R_MGR',
              approver_role_ids: ['R_MGR', 'R_OWNER'],
              scope: 'branch' as const,
            },
          ],
        }
      : role,
  );
  return { ...base, roles };
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionId: string;
  sessionToken: string;
}

async function world(cleanups: Array<() => Promise<void>>): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, await directory());
  return hub;
}

function seat(hub: TestHub, staffId: string): Seat {
  const device = pairDevice(hub, { type: 'tablet', name: `${staffId} tablet` });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, deviceToken: device.token, sessionId: session.sessionId, sessionToken: session.token };
}

function ctxOf(hub: TestHub, tx: Parameters<Parameters<TestHub['deps']['writer']['run']>[0]>[0], s: Seat): CommandCtx {
  return {
    tx,
    state: tx.state,
    clock: tx.clock,
    ids: tx.ids,
    secrets: hub.deps.secrets,
    actor: { kind: 'staff', staffId: s.staffId, stationId: null, sessionId: s.sessionId, deviceId: s.deviceId },
    permission: null,
    branch: { tenantId: TENANT, branchId: BRANCH },
    directory: currentDirectory(hub.app),
    config: hub.deps.config,
  } as unknown as CommandCtx;
}

const voidInput = (kind: 't_approval' | 't_approval_also'): RaiseInput => ({
  kind,
  subject: { stream_type: 'order', stream_id: 'O1' },
  target: { kind: 'answerers' },
  values: { order_id: 'O1' },
  display,
  details: DETAILS,
  dedupe_key: 'void:O1:L1',
  requester_staff_id: WAIT,
  request: { approver_role_ids: ['R_MGR', 'R_OWNER'] },
});

function raiseAs(hub: TestHub, s: Seat, input: RaiseInput): string {
  return hub.deps.writer.run((tx) => {
    const result = alerts.raise(ctxOf(hub, tx, s), input);
    tx.append(result.events);
    return result.alert_id;
  }).result;
}

let commandNo = 0;
function post(hub: TestHub, s: Seat, url: string, commandType: string, payload: Record<string, unknown>) {
  return hub.app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
    payload: {
      command_id: `ra-${(commandNo += 1)}`,
      tenant_id: TENANT,
      branch_id: BRANCH,
      command_type: commandType,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: s.staffId,
      device_id: s.deviceId,
    },
  });
}

const answer = (hub: TestHub, s: Seat, alertId: string, decision: 'approve' | 'reject') =>
  post(hub, s, '/commands/answer-request', 'AnswerRequest', { alert_id: alertId, decision, method: 'pin', pin: PIN.b });
const withdraw = (hub: TestHub, s: Seat, alertId: string) =>
  post(hub, s, '/commands/withdraw-request', 'WithdrawRequest', { alert_id: alertId });

function eventsOf(hub: TestHub, type: string): PosEvent[] {
  return (hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>).map(
    (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent,
  );
}

const raisedOf = (hub: TestHub, kind: string): PosEvent[] => eventsOf(hub, 'AlertRaised').filter((e) => e.payload.kind === kind);

function recipientsOf(hub: TestHub, id: string): string[] {
  return hub.deps.db.prepare('SELECT staff_id FROM alert_recipients WHERE alert_id = ? ORDER BY rowid').pluck().all(id) as string[];
}

function alertState(hub: TestHub, id: string): unknown {
  return hub.deps.db.prepare('SELECT state FROM alerts WHERE alert_id = ?').pluck().get(id);
}

/** A real PresenceSet through the writer (presence_today folds it): these staff are absent today (BF-8). */
function markAbsent(hub: TestHub, staffIds: string[]): void {
  const e = aPresenceSet({ payload: { staff_ids: staffIds, present: false, set_by: MGR } });
  hub.deps.writer.run((tx) =>
    tx.append([
      {
        stream_type: e.stream_type,
        stream_id: e.stream_id,
        event_type: e.event_type,
        schema_version: e.schema_version,
        payload: e.payload,
        occurred_at: hub.clock.branchNow(),
        actor_id: MGR,
        device_id: 'hub',
      } as EventDraft,
    ]),
  );
}

interface Run {
  status: number;
  body: { error?: unknown };
  /** statements of the whole command (inject) */
  command: number;
  /** each raiseMany call: its input kinds / dedupe keys / drop_if_only, and its own statements */
  raises: Array<{ kinds: string[]; keys: string[]; drop: Array<string | undefined>; statements: number }>;
  alertId: string;
  hub: TestHub;
}

/** One fresh hub per run, so both kinds are measured from the same state. `holder` = the table's holder. */
async function run(
  cleanups: Array<() => Promise<void>>,
  kind: 't_approval' | 't_approval_also',
  act: 'approve' | 'reject' | 'withdraw',
  holder: string = HOLDER,
): Promise<Run> {
  const hub = await world(cleanups);
  fakeTableOwner.owners.set(TABLE, holder);
  fakePager.refs.set(HOLDER, ['pager-cash']);
  fakePager.refs.set(WAIT, ['pager-wait']);
  const requester = seat(hub, WAIT);
  const manager = seat(hub, MGR);
  const alertId = raiseAs(hub, requester, voidInput(kind));
  const counter = statementCounter(hub.deps.db);
  const original = alerts.raiseMany;
  const raises: Run['raises'] = [];
  vi.spyOn(alerts, 'raiseMany').mockImplementation((ctx, inputs) => {
    const before = counter.count;
    const out: RaiseResult[] = original(ctx, inputs);
    raises.push({
      kinds: inputs.map((i) => i.kind),
      keys: inputs.map((i) => i.dedupe_key),
      drop: inputs.map((i) => i.drop_if_only),
      statements: counter.count - before,
    });
    return out;
  });
  counter.reset();
  const response = act === 'withdraw' ? await withdraw(hub, requester, alertId) : await answer(hub, manager, alertId, act);
  const command = counter.count;
  vi.restoreAllMocks();
  return { status: response.statusCode, body: response.json() as { error?: unknown }, command, raises, alertId, hub };
}

describe('[01d v1.2.5 §3.5 / §6.2 (8b), D-2] request.result_also_to (01d #67)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => registerFakes());
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0)) await cleanup();
    resetFakes();
    activity.drain();
    activity.drainDevices();
  });

  it('[01d #67] [04 #23 01d half] a reject raises one more request_result to the table team (dedupe request_result:<id>:also, same outcome), outside checkAlertIds; the hook ran once, in handle, on the read-only view', async () => {
    const r = await run(cleanups, 't_approval_also', 'reject');
    expect(r.status).toBe(200);
    // once per answer: preRead never calls it (a preRead call would make 2), and its tx was the read-only view
    expect(fakeAlsoTo.calls).toEqual([{ alert_id: r.alertId, read_only: true }]);
    const results = raisedOf(r.hub, 'request_result');
    expect(results).toHaveLength(2);
    const [toRequester, also] = results;
    expect(toRequester?.payload).toMatchObject({ target: { kind: 'person', staff_id: WAIT }, dedupe_key: `request_result:${r.alertId}` });
    expect(also?.payload).toMatchObject({
      subject_stream_type: 'order',
      subject_stream_id: 'O1',
      target: { kind: 'table_team', table_id: TABLE, depth: 'owner' },
      dedupe_key: `request_result:${r.alertId}:also`,
      values: toRequester?.payload.values,
      display,
    });
    expect(also?.payload.values).toEqual({
      request_alert_id: r.alertId,
      request_kind: 't_approval_also',
      close_reason: 'answered',
      decision: 'reject',
      by_staff_id: MGR,
    });
    // a raise of 01d's own: its alert_id is not the request's, so checkAlertIds would have refused it (500)
    expect(also?.payload.alert_id).not.toBe(r.alertId);
    expect(recipientsOf(r.hub, also?.payload.alert_id as string)).toEqual([HOLDER]);
  });

  it('[01d #67] a raiseMany spy sees one call per answer, with the :also input last (drop_if_only = the requester)', async () => {
    const r = await run(cleanups, 't_approval_also', 'reject');
    expect(r.raises).toEqual([
      {
        kinds: ['request_result', 'approval_receipt', 'request_result'],
        keys: [`request_result:${r.alertId}`, `approval_receipt:${r.alertId}`, `request_result:${r.alertId}:also`],
        drop: [undefined, undefined, WAIT],
        statements: expect.any(Number) as number,
      },
    ]);
  });

  it('[01d #67] [04 #31] statement bound: a reject with the hook costs exactly +2 over the kind without it (the hook read + one table_team resolver call)', async () => {
    const without = await run(cleanups, 't_approval', 'reject');
    const withHook = await run(cleanups, 't_approval_also', 'reject');
    expect(without.status).toBe(200);
    expect(withHook.status).toBe(200);
    expect(raisedOf(without.hub, 'request_result')).toHaveLength(1);
    expect(raisedOf(withHook.hub, 'request_result')).toHaveLength(2);
    // the shared raiseMany: + the one table_team resolver call (dedupe, fixed reads and the pager route are shared)
    expect(withHook.raises).toHaveLength(1);
    expect(without.raises).toHaveLength(1);
    expect(withHook.raises[0]!.statements).toBe(without.raises[0]!.statements + 1);
    expect(fakeTableOwner.calls).toHaveLength(1);

    // whole command, with the :also raise dropped (holder = requester), so no extra write: exactly +2
    const withHookDropped = await run(cleanups, 't_approval_also', 'reject', WAIT);
    expect(withHookDropped.status).toBe(200);
    expect(raisedOf(withHookDropped.hub, 'request_result')).toHaveLength(1);
    expect(withHookDropped.command).toBe(without.command + 2);
  });

  it('[01d #67] [04 #31] approve and withdraw call no hook and cost the same with and without it', async () => {
    for (const act of ['approve', 'withdraw'] as const) {
      const without = await run(cleanups, 't_approval', act);
      const withHook = await run(cleanups, 't_approval_also', act);
      expect(without.status).toBe(200);
      expect(withHook.status).toBe(200);
      expect(withHook.command).toBe(without.command);
      expect(withHook.raises.map((x) => x.kinds)).toEqual(without.raises.map((x) => x.kinds));
      expect(raisedOf(withHook.hub, 'request_result').map((e) => e.payload.dedupe_key)).toEqual(
        raisedOf(without.hub, 'request_result').map((e) => e.payload.dedupe_key),
      );
    }
    expect(fakeAlsoTo.calls).toEqual([]);
    expect(fakeTableOwner.calls).toEqual([]);
  });

  it('[01d #67] [04 §3.5 G-8] a hook target whose routed recipients are only the requester → no extra alert (drop_if_only); a null target → no :also input', async () => {
    const dropped = await run(cleanups, 't_approval_also', 'reject', WAIT);
    expect(dropped.status).toBe(200);
    expect(dropped.raises[0]?.keys).toContain(`request_result:${dropped.alertId}:also`);
    expect(raisedOf(dropped.hub, 'request_result').map((e) => e.payload.dedupe_key)).toEqual([`request_result:${dropped.alertId}`]);

    fakeAlsoTo.table_id = null;
    const none = await run(cleanups, 't_approval_also', 'reject');
    expect(none.status).toBe(200);
    expect(none.raises[0]?.keys).toEqual([`request_result:${none.alertId}`, `approval_receipt:${none.alertId}`]);
    expect(raisedOf(none.hub, 'request_result')).toHaveLength(1);
  });

  it('[01d v1.2.5 §4.2 G-8] raiseMany drop_if_only: dropped only when every routed recipient is that person; requestResultInput target / dedupe_key overrides', async () => {
    const hub = await world(cleanups);
    const requester = seat(hub, WAIT);
    fakeTableOwner.owners.set('T_SELF', WAIT);
    fakeTableOwner.owners.set('T_OTHER', HOLDER);
    const about = { alert_id: 'A1', kind: 't_approval', subject: { stream_type: 'order' as const, stream_id: 'O1' }, requester_staff_id: WAIT, display };
    const outcome = { close_reason: 'answered' as const, decision: 'reject' as const, by_staff_id: MGR };
    const plain = requestResultInput(about, outcome);
    expect(plain).toMatchObject({ target: { kind: 'person', staff_id: WAIT }, dedupe_key: 'request_result:A1' });
    expect('drop_if_only' in plain).toBe(false);
    const also = (table: string, key: string): RaiseInput => ({
      ...requestResultInput(about, outcome, { target: { kind: 'table_team', table_id: table, depth: 'owner' }, dedupe_key: key }),
      drop_if_only: WAIT,
    });
    expect(also('T_SELF', 'k')).toMatchObject({ target: { kind: 'table_team', table_id: 'T_SELF', depth: 'owner' }, dedupe_key: 'k' });
    const results = hub.deps.writer.run((tx) =>
      alerts.raiseMany(ctxOf(hub, tx, requester), [
        also('T_SELF', 'self'), // routed to the requester only → dropped
        also('T_OTHER', 'other'), // the holder → raised
        also('T_NOBODY', 'nobody'), // no holder: no recipient at all (⊆ the requester) → dropped
        { ...requestResultInput(about, outcome, { target: { kind: 'person', staff_id: WAIT }, dedupe_key: 'kept' }) }, // no drop_if_only → raised
      ]),
    ).result;
    expect(results.map((x) => x.events.length > 0)).toEqual([false, true, false, true]);
    expect(results.map((x) => x.deduped)).toEqual([false, false, false, false]);
  });
  it('[01d #67] [01d §6.2 (7) A4, onPrepareFailed] a hook that throws a DomainError refuses the reject with the same error as an apply throw: no RequestAnswered, the request stays open; on the PIN path RequestPinFailed { answer_failed } is recorded (the hook runs in prepare, never in preRead)', async () => {
    fakeApply.mode = 'throw';
    const applyThrow = await run(cleanups, 't_approval', 'reject');
    fakeApply.mode = 'ok';
    fakeAlsoTo.mode = 'throw';
    const hookThrow = await run(cleanups, 't_approval_also', 'reject');
    expect(fakeAlsoTo.calls).toHaveLength(1);
    expect(hookThrow.status).toBe(applyThrow.status);
    expect(hookThrow.body.error).toMatchObject({ code: fakeApply.throwCode, details: { reason: 'fake_also_to' } });
    expect(applyThrow.body.error).toMatchObject({ code: fakeApply.throwCode, details: { reason: 'fake_apply' } });
    for (const r of [applyThrow, hookThrow]) {
      expect(eventsOf(r.hub, 'RequestAnswered')).toEqual([]);
      expect(raisedOf(r.hub, 'request_result')).toEqual([]);
      expect(alertState(r.hub, r.alertId)).toBe('open');
    }
    // the hook throws inside prepare (PIN path) → onPrepareFailed records it, as an apply throw that reaches prepare does;
    // an apply throw is already refused by preRead, before the PIN (01d v1.0 #1), so it leaves no record
    expect(eventsOf(hookThrow.hub, 'RequestPinFailed').map((e) => e.payload)).toEqual([
      expect.objectContaining({ alert_id: hookThrow.alertId, outcome: 'answer_failed', error_code: fakeApply.throwCode, answerer_staff_id: MGR }),
    ]);
    expect(eventsOf(applyThrow.hub, 'RequestPinFailed')).toEqual([]);
  });

  it('[01d #67] [01d §3.5 read-only contract] a hook that writes on its read-only view → 500, nothing answered, the request stays open', async () => {
    fakeAlsoTo.mode = 'write';
    const r = await run(cleanups, 't_approval_also', 'reject');
    expect(r.status).toBe(500);
    expect(fakeAlsoTo.calls).toHaveLength(1);
    expect(eventsOf(r.hub, 'RequestAnswered')).toEqual([]);
    expect(raisedOf(r.hub, 'request_result')).toEqual([]);
    expect(alertState(r.hub, r.alertId)).toBe('open');
    expect(r.hub.deps.db.prepare('SELECT step FROM alerts WHERE alert_id = ?').pluck().get(r.alertId)).toBeLessThan(100);
  });

  it('[01d v1.2.5 §4.2 G-8] drop_if_only routing: an absent table owner (T_ABSENT) → no recipient row → dropped; a holder device row (staff_id null) → kept', async () => {
    const hub = await world(cleanups);
    const requester = seat(hub, WAIT);
    const holderDevice = pairDevice(hub, { type: 'tablet', name: 'T_DEVICE tablet' });
    fakeTableOwner.owners.set('T_ABSENT', HOLDER);
    fakeTableOwner.owners.set('T_DEVICE', WAIT);
    fakeTableOwner.devices.set('T_DEVICE', [holderDevice.deviceId]);
    markAbsent(hub, [HOLDER]);
    const about = { alert_id: 'A1', kind: 't_approval', subject: { stream_type: 'order' as const, stream_id: 'O1' }, requester_staff_id: WAIT, display };
    const outcome = { close_reason: 'answered' as const, decision: 'reject' as const, by_staff_id: MGR };
    const also = (table: string): RaiseInput => ({
      ...requestResultInput(about, outcome, { target: { kind: 'table_team', table_id: table, depth: 'owner' }, dedupe_key: `also:${table}` }),
      drop_if_only: WAIT,
    });
    const [absent, device] = hub.deps.writer.run((tx) => {
      const out = alerts.raiseMany(ctxOf(hub, tx, requester), [also('T_ABSENT'), also('T_DEVICE')]);
      tx.append(out.flatMap((x) => x.events));
      return out;
    }).result;
    expect(absent?.events).toEqual([]);
    expect(device?.events.map((e) => e.event_type)).toEqual(['AlertRaised', 'AttemptSent']);
    const step = device?.events[1]?.payload as { recipients: Array<{ staff_id: string | null; device_id: string | null }> };
    expect(step.recipients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ staff_id: WAIT, device_id: null }),
        expect.objectContaining({ staff_id: null, device_id: holderDevice.deviceId }),
      ]),
    );
    expect(raisedOf(hub, 'request_result').map((e) => e.payload.dedupe_key)).toEqual(['also:T_DEVICE']);
  });
});
