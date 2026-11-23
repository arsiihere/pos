import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { anAttemptSent } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAlertSockets } from '../../src/alerts/alert-sockets';
import { createAlertsCatchUp } from '../../src/alerts/catch-up';
import { defineAlertKind, kindOf, unregisterAlertKind, type AlertKindDef } from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import { activity } from '../../src/auth/session-store';
import type { CommandCtx } from '../../src/commands/registry';
import type { SocketCtx } from '../../src/ws/catch-up';
import { wsHubFor } from '../../src/ws/server';
import { aDirectory, PIN } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { fakePager, fakeTableOwner, registerFakes, resetFakes } from './fakes';

// dl h5 — 01d v1.3.2 §3.13.1 "Statement counts", test 71 (the part #252 left to the existing fake-kind pins): absolute
// statement counts with a LINKED kind (a real `link`) on step frames, `alerts_open`, the `alerts` catch-up part and
// AnswerRequest reject with and without `result_also_to`. Each number is pinned to the value measured with this same
// file on module-deeplinks @ 4d596bed (before h1: 01d v1.2.5 alerts code, where `link` did not exist and is ignored).
//
// The linked kinds are 01d's fakes `t_approval` / `t_approval_also` (fakes.ts) with one change: a real pure `link`
// (`order { values.order_id }`). Same steps, request part, apply and result_also_to as the pinned fake-kind tests.

const MGR = 'S_MGR'; // approver, PIN.b
const WAIT = 'S_WAIT'; // requester; void-item requires approval by R_MGR or R_OWNER
const HOLDER = 'S_CASH'; // the table holder (fakeTableOwner) for result_also_to
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const TABLE = 'T12';
const DETAILS = { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' };
const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };

const LINKED = 't_link_approval';
const LINKED_ALSO = 't_link_approval_also';
const TARGET = { type: 'order', order_id: 'O1' };

/** v1.2.5 measurements: this file's flows run on 4d596bed (01d v1.2.5 alerts code); identical on module-deeplinks today. */
const V125 = {
  /** every after-commit hook of the raise transaction (its AttemptSent step 0): the step-frame alert read + 1 */
  stepFramesRaise: 2,
  /** every after-commit hook after an AttemptSent step 1 appended alone: the one step-frame alert read (§3.13.1: 1 → 1) */
  stepFramesStep: 1,
  /** alertsOpen for a tablet bound to the approver, one linked request open (§3.13.1: ≤ 3 → ≤ 3) */
  alertsOpen: 3,
  /** the `alerts` catch-up part build for the approver's staff socket (§3.13.1: 2 → 2) */
  catchUp: 2,
  /** whole AnswerRequest reject command, writer db (inject), linked kind without result_also_to
   *  (+1 since 05 task 7: the `billing` projection checkpoint UPDATE per append; +1 since 05 task 8: the `shifts` one;
   *  +1 since 05 task 11: the `billing_prints` one; +1 since 05a task 6: the `device_profiles` one) */
  rejectWithout: 66,
  /** … linked kind with result_also_to, the :also raised (holder ≠ requester) */
  rejectWithAlso: 76,
  /** … linked kind with result_also_to, the :also dropped (holder = requester): +2 over without, as 01d #67 */
  rejectWithAlsoDropped: 68,
};

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory({ directory_version: 1 });
  const roles = base.roles.map((role) =>
    role.role_id === 'R_WAIT'
      ? {
          ...role,
          permissions: [
            { permission: 'void-item' as const, grant_type: 'requires_approval' as const, approver_role_id: 'R_MGR', approver_role_ids: ['R_MGR', 'R_OWNER'], scope: 'branch' as const },
          ],
        }
      : role,
  );
  return { ...base, roles };
}

function defineLinkedKinds(): void {
  const twin = (from: string, kind: string) =>
    defineAlertKind({
      ...(kindOf(from) as unknown as AlertKindDef),
      kind,
      labels: { card: `alert.${kind}.card`, lock: `alert.${kind}.lock` },
      link: (v: Record<string, unknown>) => ({ type: 'order', order_id: String(v.order_id) }),
    } as AlertKindDef);
  twin('t_approval', LINKED);
  twin('t_approval_also', LINKED_ALSO);
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionId: string;
  sessionToken: string;
}

describe('[01d #71] statement counts with a linked kind = v1.2.5 (dl h5)', () => {
  let hub: TestHub;
  const clients: WsClient[] = [];
  const tokens = new Map<string, string>();
  /** statements from the last beforeCommit to the end of the after-commit hooks (frames.int.test.ts `world`) */
  const probe = { reset: () => undefined as void, count: () => 0, last: -1 };

  beforeEach(async () => {
    registerFakes();
    defineLinkedKinds();
    hub = await createTestHub({ testHooks: { beforeCommit: () => probe.reset() } });
    const counter = statementCounter(hub.deps.db);
    probe.reset = () => counter.reset();
    probe.count = () => counter.count;
    // registered after registerAlerts' hook, so it sees the frames hook's statements
    hub.deps.writer.addAfterCommit(() => {
      probe.last = probe.count();
    });
    await seedDirectory(hub, await directory());
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    tokens.clear();
    unregisterAlertKind(LINKED);
    unregisterAlertKind(LINKED_ALSO);
    resetFakes();
    activity.drain();
    activity.drainDevices();
    await hub.close();
  });

  function device(name: string): string {
    const d = pairDevice(hub, { type: 'tablet', name });
    tokens.set(d.deviceId, d.token);
    return d.deviceId;
  }
  function seat(staffId: string, deviceId = device(`${staffId} tablet`)): Seat {
    const s = openSession(hub, { kind: 'staff', staffId, deviceId });
    return { staffId, deviceId, deviceToken: tokens.get(deviceId)!, sessionId: s.sessionId, sessionToken: s.token };
  }
  async function staffSocket(s: Seat): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: s.deviceToken, session_token: s.sessionToken });
    await ws.untilCount(1);
    clients.push(ws);
    return ws;
  }
  async function alertSocket(deviceId: string): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: tokens.get(deviceId)! });
    await ws.untilCount(1);
    clients.push(ws);
    return ws;
  }
  let fenceNo = 0;
  async function fence(): Promise<void> {
    fenceNo += 1;
    const id = `FENCE_${fenceNo}`;
    wsHubFor(hub.app).sendToDevices([...tokens.keys()], { type: 'alert_seen', alert_id: id });
    for (const client of clients) {
      for (let i = 0; i < 50 && !client.messages.some((m) => (m as { alert_id?: string }).alert_id === id); i += 1) await client.untilCount(client.messages.length + 1);
    }
  }
  type Frame = { type: string; alert?: { alert_id: string; step: number; target?: unknown; card?: unknown } };
  const alertFrames = (ws: WsClient) => (ws.messages as Frame[]).filter((m) => m.type === 'alert').map((m) => m.alert!);

  function ctxOf(tx: Parameters<Parameters<TestHub['deps']['writer']['run']>[0]>[0], s: Seat): CommandCtx {
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
  const voidInput = (kind: string): RaiseInput => ({
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
  function raiseAs(s: Seat, input: RaiseInput): string {
    return hub.deps.writer.run((tx) => {
      const result = alerts.raise(ctxOf(tx, s), input);
      tx.append(result.events);
      return result.alert_id;
    }).result;
  }
  function append(events: PosEvent[]): void {
    hub.deps.writer.run((tx) => {
      tx.append(
        events.map(
          (e): EventDraft => ({
            stream_type: e.stream_type,
            stream_id: e.stream_id,
            event_type: e.event_type,
            schema_version: e.schema_version,
            payload: e.payload,
            occurred_at: hub.clock.branchNow(),
            actor_id: e.actor_id,
            device_id: e.device_id,
          }),
        ),
      );
    });
  }

  it('[01d #71] step frames (raise step 0 and an appended step 1) with a linked kind: the v1.2.5 counts (2 and 1); the frames carry the target', async () => {
    const tab = device('mgr bound tablet');
    const mgr = seat(MGR, tab); // binds the tablet to MGR: its alert-mode socket gets the lock frames
    const mode = await alertSocket(tab);
    const staff = await staffSocket(seat(MGR, device('mgr tablet')));
    const waiter = seat(WAIT);
    void mgr;
    const id = raiseAs(waiter, voidInput(LINKED));
    const raised = probe.last;
    await fence();
    append([anAttemptSent({ payload: { alert_id: id, step: 1, recipients: [{ staff_id: MGR, device_id: null, for_staff_id: null, set: 'answerer' }], routes: [] } })]);
    const stepped = probe.last;
    await fence();
    // the frames went out (card to the staff socket, lock to the alert-mode socket), with the linked target
    expect(alertFrames(staff).map((a) => [a.step, a.target])).toEqual([
      [0, TARGET],
      [1, TARGET],
    ]);
    // the alert-mode socket of the bound tablet: lock frames only, each with the target
    expect(alertFrames(mode).length).toBeGreaterThanOrEqual(1);
    expect(alertFrames(mode).every((a) => a.card === undefined)).toBe(true);
    expect(alertFrames(mode).every((a) => JSON.stringify(a.target) === JSON.stringify(TARGET))).toBe(true);
    expect({ raised, stepped }).toEqual({ raised: V125.stepFramesRaise, stepped: V125.stepFramesStep });
  });

  it('[01d #71] alerts_open for a tablet bound to the approver, a linked request open: the v1.2.5 count; the row carries the target', () => {
    const tab = device('mgr bound tablet');
    seat(MGR, tab);
    raiseAs(seat(WAIT), voidInput(LINKED));
    const sockets = createAlertSockets({ db: hub.deps.db, branchId: BRANCH, clock: hub.clock, state: () => hub.deps.state.get(), ws: () => wsHubFor(hub.app), recordSent: () => undefined, log: { error: () => undefined } });
    const counter = statementCounter(hub.deps.db);
    counter.reset();
    const open = sockets.alertsOpen(tab);
    const count = counter.count;
    expect(open.alerts.map((a) => (a as { target?: unknown }).target)).toEqual([TARGET]);
    expect(count).toBe(V125.alertsOpen);
  });

  it('[01d #71] the alerts catch-up part for the approver\'s staff socket, a linked request open: the v1.2.5 count; the row carries the target', () => {
    const mgr = seat(MGR);
    raiseAs(seat(WAIT), voidInput(LINKED));
    const part = createAlertsCatchUp({ directory: () => currentDirectory(hub.app), recordSent: () => undefined, branchId: BRANCH });
    const ctx: SocketCtx = { deviceId: mgr.deviceId, deviceType: 'tablet', sessionId: mgr.sessionId, kind: 'staff', staffId: MGR, stationId: null, asOfSeq: 0 };
    const counter = statementCounter(hub.deps.db);
    counter.reset();
    const built = part.build(hub.deps.db, hub.deps.state.get(), ctx) as { alerts: Array<{ target?: unknown }> };
    const count = counter.count;
    expect(built.alerts.map((a) => a.target)).toEqual([TARGET]);
    expect(count).toBe(V125.catchUp);
  });

  async function reject(kind: string, holder: string): Promise<{ status: number; statements: number; results: number }> {
    fakeTableOwner.owners.set(TABLE, holder);
    fakePager.refs.set(HOLDER, ['pager-cash']);
    fakePager.refs.set(WAIT, ['pager-wait']);
    const requester = seat(WAIT);
    const manager = seat(MGR);
    const alertId = raiseAs(requester, voidInput(kind));
    const counter = statementCounter(hub.deps.db);
    counter.reset();
    const res = await hub.app.inject({
      method: 'POST',
      url: '/commands/answer-request',
      headers: { authorization: `Bearer ${manager.deviceToken}`, 'x-session-token': manager.sessionToken },
      payload: {
        command_id: `h5-${kind}-${holder}`,
        tenant_id: TENANT,
        branch_id: BRANCH,
        command_type: 'AnswerRequest',
        payload: { alert_id: alertId, decision: 'reject', method: 'pin', pin: PIN.b },
        occurred_at: hub.clock.branchNow(),
        actor_id: MGR,
        device_id: manager.deviceId,
      },
    });
    const statements = counter.count;
    const results = (hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'AlertRaised'`).pluck().all() as string[])
      .map((p) => JSON.parse(p) as { kind: string; values: { request_alert_id?: string; link?: unknown } })
      .filter((p) => p.kind === 'request_result' && p.values.request_alert_id === alertId);
    for (const r of results) expect(r.values.link).toEqual(TARGET);
    return { status: res.statusCode, statements, results: results.length };
  }

  it('[01d #71] AnswerRequest reject, linked kind without result_also_to: the v1.2.5 count; the result carries values.link', async () => {
    const r = await reject(LINKED, HOLDER);
    expect(r.status).toBe(200);
    expect(r.results).toBe(1);
    expect(r.statements).toBe(V125.rejectWithout);
  });

  it('[01d #71] AnswerRequest reject, linked kind with result_also_to (the :also raised): the v1.2.5 count; both results carry values.link', async () => {
    const r = await reject(LINKED_ALSO, HOLDER);
    expect(r.status).toBe(200);
    expect(r.results).toBe(2);
    expect(r.statements).toBe(V125.rejectWithAlso);
  });

  it('[01d #71] AnswerRequest reject, linked kind with result_also_to (the :also dropped, holder = requester): the v1.2.5 count, +2 over without (01d #67)', async () => {
    const r = await reject(LINKED_ALSO, WAIT);
    expect(r.status).toBe(200);
    expect(r.results).toBe(1);
    expect(r.statements).toBe(V125.rejectWithAlsoDropped);
    expect(V125.rejectWithAlsoDropped).toBe(V125.rejectWithout + 2);
  });
});
