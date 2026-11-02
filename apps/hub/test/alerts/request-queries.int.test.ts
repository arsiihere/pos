import { verify } from '@node-rs/argon2';
import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed, aBusinessDayOpened, anAttemptSent } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAlertsCatchUp } from '../../src/alerts/catch-up';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { receiptBufferFor } from '../../src/alerts/receipts';
import { alertsTick } from '../../src/alerts/tick';
import { currentDirectory } from '../../src/auth/guards';
import { activity } from '../../src/auth/session-store';
import type { CommandCtx } from '../../src/commands/registry';
import type { SocketCtx } from '../../src/ws/catch-up';
import { wsHubFor } from '../../src/ws/server';
import { aDirectory, PIN, pinHash } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { registerFakes, resetFakes } from './fakes';

// 01d task 35: `GET /queries/my-requests` (§6.8) and `GET /queries/requests-to-answer` (§6.9), BF-4 /
// AD-5 `from_business_day` on catch-up and requests-to-answer rows, and `alert_closed` to may-answer sockets
// (§6 batch 3); tests #10, #41, #53, #61 (hub parts). Real WS clients and HTTP injects against a test hub.

vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...actual, verify: vi.fn((hash: string, pin: string) => actual.verify(hash, pin)) };
});
const verifySpy = vi.mocked(verify);

const OWNER = 'S_OWNER'; // "Owner": approver (R_OWNER), PIN.a
const MGR = 'S_MGR'; // "Manager": approver (R_MGR), approve-void branch scope, PIN.b
const MGR2 = 'S_MGR2'; // "Manager two": starts the shift after the request was raised (N3), PIN.b
const LEAD = 'S_LEAD'; // "Imran": approver (R_LEAD), approve-void my_team, Hamza's lead, PIN.c; his own voids need R_LEAD
const CASH = 'S_CASH'; // "Cashier": may answer no void
const WAIT = 'S_WAIT'; // "Order taker" (Hamza): requester
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const DETAILS = { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' };

async function directory(o: { withMgr2?: boolean; version?: number; waitApprovers?: string[] } = {}): Promise<DirectoryInput> {
  const base = await aDirectory({ directory_version: o.version ?? 1 });
  const voidNeeds = (approvers: string[]) => ({
    permission: 'void-item' as const,
    grant_type: 'requires_approval' as const,
    approver_role_id: approvers[0] ?? null,
    approver_role_ids: approvers,
    scope: 'branch' as const,
  });
  const roles = base.roles.map((role) => (role.role_id === 'R_WAIT' ? { ...role, permissions: [voidNeeds(o.waitApprovers ?? ['R_MGR', 'R_OWNER', 'R_LEAD'])] } : role));
  roles.push({
    role_id: 'R_LEAD',
    name: 'Lead',
    session_idle_ttl_ms: 3_600_000,
    permissions: [
      { permission: 'approve-void', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_team' },
      // #10: Imran's own void needs R_LEAD, which only Imran holds → no answerer once he is left out
      voidNeeds(['R_LEAD']),
    ],
  });
  const staff = base.staff.map((s) => (s.staff_id === WAIT ? { ...s, lead_staff_id: LEAD } : s));
  staff.push({ staff_id: LEAD, display_name: 'Imran', pin_hash: await pinHash(PIN.c), role_ids: ['R_LEAD'], denied_permissions: [], lead_staff_id: null, floor_ids: [] });
  const mgr = staff.find((s) => s.staff_id === MGR);
  if (mgr === undefined) throw new Error('fixture has no S_MGR');
  if (o.withMgr2 === true) staff.push({ ...mgr, staff_id: MGR2, display_name: 'Manager two', lead_staff_id: null });
  return { ...base, roles, staff };
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionId: string;
  sessionToken: string;
}

type Row = Record<string, unknown> & { alert_id: string };
type Frame = Record<string, unknown> & { type: string };

describe('01d my-requests and requests-to-answer (task 35)', () => {
  let hub: TestHub;
  const clients: WsClient[] = [];
  const tokens = new Map<string, string>();

  beforeEach(async () => {
    hub = await createTestHub();
    registerFakes();
    await seedDirectory(hub, await directory());
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    tokens.clear();
    resetFakes();
    activity.drain();
    activity.drainDevices();
    verifySpy.mockClear();
    await hub.close();
  });

  // --------------------------------------------------------------------------------------------- helpers

  function device(type: 'tablet' | 'cashier_kiosk' | 'kds', name: string): string {
    const d = pairDevice(hub, { type, name, stationId: type === 'kds' ? 'station-1' : undefined });
    tokens.set(d.deviceId, d.token);
    return d.deviceId;
  }

  function tokenOf(deviceId: string): string {
    const t = tokens.get(deviceId);
    if (t === undefined) throw new Error(`unknown device ${deviceId}`);
    return t;
  }

  function seat(staffId: string, name: string): Seat {
    const deviceId = device('tablet', name);
    const s = openSession(hub, { kind: 'staff', staffId, deviceId });
    return { staffId, deviceId, deviceToken: tokenOf(deviceId), sessionId: s.sessionId, sessionToken: s.token };
  }

  async function socketOf(s: Seat): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: s.deviceToken, session_token: s.sessionToken });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
    clients.push(ws);
    return ws;
  }

  async function alertSocket(deviceId: string): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: tokenOf(deviceId) });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'alerts_open' });
    clients.push(ws);
    return ws;
  }

  function catchUpOf(ws: WsClient): Row[] {
    const first = ws.messages[0] as { type: string; state: { alerts?: { alerts: Row[] } } };
    expect(first.type).toBe('catch_up');
    if (first.state.alerts === undefined) throw new Error('no alerts catch-up part');
    return first.state.alerts.alerts;
  }

  let fenceNo = 0;
  /** Every frame sent before this call has reached every open client (per-socket order). */
  async function fence(): Promise<void> {
    fenceNo += 1;
    const id = `FENCE_${fenceNo}`;
    wsHubFor(hub.app).sendToDevices([...tokens.keys()], { type: 'alert_seen', alert_id: id });
    for (const client of clients) {
      for (let i = 0; i < 50 && !client.messages.some((m) => (m as Frame).alert_id === id); i += 1) {
        await client.untilCount(client.messages.length + 1);
      }
    }
  }
  const closedFrames = (client: WsClient): Frame[] => (client.messages as Frame[]).filter((m) => m.type === 'alert_closed');

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

  /** A raise by the hub (tick ctx). */
  function raise(input: RaiseInput): string {
    return hub.deps.writer.run((tx) => {
      const result = alerts.raise(alerts.tickCtx(tx, hub.clock.branchNow()), input);
      tx.append(result.events);
      return result.alert_id;
    }).result;
  }

  /** A request raised by a command handler on the requester's seat (raised_device_id = that device). */
  function raiseAs(s: Seat, input: RaiseInput): string {
    return hub.deps.writer.run((tx) => {
      const result = alerts.raise(ctxOf(tx, s), input);
      tx.append(result.events);
      return result.alert_id;
    }).result;
  }

  function closeAlert(id: string, reason: 'done' | 'obsolete' = 'obsolete'): void {
    hub.deps.writer.run((tx) => tx.append(alerts.close(alerts.tickCtx(tx, hub.clock.branchNow()), id, reason, 'order billed')));
  }

  /** The `alerts` tick, run until nothing is due (the no_approver flag pass is cleared: task 31's, not ours). */
  function tick(): void {
    for (let i = 0; i < 5; i += 1) {
      hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
      if (!alertsTick.due(hub.deps.db, hub.deps.state.get(), hub.clock.branchNow())) return;
      hub.deps.writer.run((tx) => tx.append(alertsTick.intents(tx, hub.deps.state.get(), hub.clock.branchNow())));
    }
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
  // on this hub's own `hub` stream, as OpenBusinessDay / CloseBusinessDay append them
  const dayOpened = (date: string): void => append([aBusinessDayOpened({ stream_id: BRANCH, payload: { business_date: date } })]);
  const dayClosed = (): void => append([aBusinessDayClosed({ stream_id: BRANCH })]);

  const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };
  const voidInput = (n: number, requester = WAIT, approvers = ['R_MGR', 'R_OWNER', 'R_LEAD']): RaiseInput => ({
    kind: 't_approval',
    subject: { stream_type: 'order', stream_id: `O${n}` },
    target: { kind: 'answerers' },
    values: { order_id: `O${n}` },
    display,
    details: DETAILS,
    dedupe_key: `void:O${n}:L1`,
    requester_staff_id: requester,
    request: { approver_role_ids: approvers },
  });
  const acceptInput = (n: number, requester: string, receiver: string): RaiseInput => ({
    kind: 't_accept',
    subject: { stream_type: 'table', stream_id: `T${n}` },
    target: { kind: 'person', staff_id: receiver },
    display,
    dedupe_key: `accept:T${n}`,
    requester_staff_id: requester,
    request: { receiver_staff_id: receiver },
  });

  let commandNo = 0;
  function post(s: Seat, name: string, commandType: string, payload: Record<string, unknown>) {
    return hub.app.inject({
      method: 'POST',
      url: `/commands/${name}`,
      headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
      payload: {
        command_id: `auto-${(commandNo += 1)}`,
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
  const answer = (s: Seat, payload: Record<string, unknown>) => post(s, 'answer-request', 'AnswerRequest', payload);
  const byPin = (alertId: string, pin: string, decision = 'approve') => ({ alert_id: alertId, decision, method: 'pin', pin });

  function query(s: { deviceToken: string; sessionToken: string }, resource: string) {
    return hub.app.inject({
      method: 'GET',
      url: `/queries/${resource}`,
      headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
    });
  }
  async function rowsOf(s: Seat, resource: 'my-requests' | 'requests-to-answer'): Promise<Row[]> {
    const response = await query(s, resource);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: { requests: Row[] } }).data.requests;
  }
  const myRequests = (s: Seat) => rowsOf(s, 'my-requests');
  const toAnswer = (s: Seat) => rowsOf(s, 'requests-to-answer');
  const idsOf = (rows: Row[]): string[] => rows.map((r) => r.alert_id);

  function eventsOf(type: string): PosEvent[] {
    return (hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>).map(
      (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent,
    );
  }
  const alertOf = (id: string) => hub.deps.db.prepare('SELECT state, step, raised_at FROM alerts WHERE alert_id = ?').get(id) as { state: string; step: number; raised_at: number };
  const recipientsOf = (id: string) =>
    hub.deps.db.prepare('SELECT step, staff_id, device_id FROM alert_recipients WHERE alert_id = ? ORDER BY step, staff_id, device_id').all(id) as Array<{
      step: number;
      staff_id: string | null;
      device_id: string | null;
    }>;

  function ctxFor(s: Seat): SocketCtx {
    return { deviceId: s.deviceId, deviceType: 'tablet', sessionId: s.sessionId, kind: 'staff', staffId: s.staffId, stationId: null, asOfSeq: 0 };
  }
  /** A direct build of the `alerts` catch-up part (the one registerAlerts made is equivalent). */
  const built = (s: Seat): Row[] =>
    (createAlertsCatchUp({ directory: () => currentDirectory(hub.app), recordSent: () => undefined, branchId: BRANCH }).build(hub.deps.db, hub.deps.state.get(), ctxFor(s)) as {
      alerts: Row[];
    }).alerts;

  /** The hub's local date of `ms` (as OpenBusinessDay labels a day). */
  function localDate(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // -------------------------------------------------------------------------------------------- #10

  it('[01d #10] self answer → 403 self (session, pin, in person naming the requester), no PIN verified; the requester who is the only in-range approver → no answerer, the shortcut writes the escalation step at the raise, pending, my-requests ask_in_person true at once; no per-request warning', async () => {
    const imran = seat(LEAD, 'imran tablet');
    await socketOf(imran); // Imran has a route, but he is the requester: left out of the answerers
    const before = eventsOf('AlertRaised').length;
    const req = raiseAs(imran, voidInput(1, LEAD, ['R_LEAD']));
    expect(alertOf(req)).toMatchObject({ state: 'open', step: 2 });
    expect(eventsOf('EscalationStepped').map((e) => e.payload.alert_id)).toEqual([req]);
    // no per-request "no one can answer" warning (§12.4): the raise is the only new alert
    expect(eventsOf('AlertRaised').slice(before).map((e) => e.payload.alert_id)).toEqual([req]);

    const mine = await myRequests(imran);
    expect(mine).toEqual([
      expect.objectContaining({ alert_id: req, kind: 't_approval', state: 'pending', close_reason: null, decision: null, answerer_name: null, ask_in_person: true, waiting_ms: 0 }),
    ]);

    const accept = raiseAs(imran, acceptInput(1, LEAD, LEAD));
    const cases: Array<Record<string, unknown>> = [
      byPin(req, PIN.c),
      { alert_id: req, decision: 'approve', method: 'in_person', answerer_staff_id: LEAD, pin: PIN.c },
      { alert_id: accept, decision: 'accept', method: 'session' },
    ];
    for (const payload of cases) {
      const response = await answer(imran, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(403);
      expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'self' } });
    }
    expect(verifySpy).not.toHaveBeenCalled();
    expect(alertOf(req).state).toBe('open');
    expect(eventsOf('RequestAnswered')).toEqual([]);
  });

  // -------------------------------------------------------------------------------------------- #41

  it("[01d #41] my-requests: pending first with ask_in_person false before and true after approval_branch_ms; today's answered one with decision and answerer name; yesterday's closed one absent; 1 statement", async () => {
    dayOpened('2025-10-19');
    const yesterday = raise(voidInput(1));
    hub.clock.advance(60_000);
    closeAlert(yesterday);
    dayClosed();
    hub.clock.advance(8 * 3_600_000);
    dayOpened('2025-10-20');
    const hamza = seat(WAIT, 'hamza tablet');
    const mgr = seat(MGR, 'mgr tablet');
    await socketOf(mgr); // a route: no shortcut, the tier runs in time

    const answered = raiseAs(hamza, voidInput(2));
    hub.clock.advance(5_000);
    expect((await answer(mgr, byPin(answered, PIN.b))).statusCode).toBe(200);
    hub.clock.advance(1_000);
    const obsolete = raiseAs(hamza, voidInput(3));
    hub.clock.advance(2_000);
    closeAlert(obsolete);
    hub.clock.advance(1_000);
    const pending = raiseAs(hamza, voidInput(4));
    const raisedAt = alertOf(pending).raised_at;
    hub.clock.advance(10_000);
    tick();

    const counter = statementCounter(hub.deps.readDb);
    const rows = await myRequests(hamza);
    expect(counter.count).toBe(1);
    expect(idsOf(rows)).toEqual([pending, obsolete, answered]);
    expect(rows[0]).toEqual({
      alert_id: pending,
      kind: 't_approval',
      state: 'pending',
      close_reason: null,
      decision: null,
      answerer_name: null,
      raised_at: raisedAt,
      waiting_ms: 10_000,
      ask_in_person: false,
      lock: { kind_label_key: 'alert.t_approval.lock', table_code: '12', point_code: null, requester_name: 'Order taker' },
    });
    expect(rows[1]).toMatchObject({ state: 'closed', close_reason: 'obsolete', decision: null, answerer_name: null, waiting_ms: 2_000 });
    expect(rows[2]).toMatchObject({ state: 'approved', close_reason: 'answered', decision: 'approve', answerer_name: 'Manager', waiting_ms: 5_000, ask_in_person: false });
    // the approver context never leaves through my-requests (lock only)
    expect(JSON.stringify(rows)).not.toContain('Mutton platter');

    hub.clock.advance(120_000 - 10_000 - 1);
    tick();
    expect((await myRequests(hamza))[0]).toMatchObject({ alert_id: pending, ask_in_person: false, waiting_ms: 119_999 });
    hub.clock.advance(1); // approval_branch_ms: the escalation step
    tick();
    expect(alertOf(pending).step).toBe(2);
    counter.reset();
    expect((await myRequests(hamza))[0]).toMatchObject({ alert_id: pending, state: 'pending', ask_in_person: true, waiting_ms: 120_000 });
    expect(counter.count).toBe(1);
  });

  // ------------------------------------------------------------------------------------------- §6.8

  it('[01d §6.8] my-requests: only my requests (not my notices, not others\' requests); ask_in_person false at step 1, true at step >= 2; 1 statement for 1 or 21 rows; a station session is refused', async () => {
    const hamza = seat(WAIT, 'hamza tablet');
    const imran = seat(LEAD, 'imran tablet');
    await socketOf(imran); // a route: no shortcut
    const mine = raiseAs(hamza, voidInput(1));
    raiseAs(imran, voidInput(2, LEAD, ['R_LEAD'])); // Imran's own request: not Hamza's
    raise({ kind: 't_info', subject: { stream_type: 'hub', stream_id: BRANCH }, target: { kind: 'person', staff_id: WAIT }, display, dedupe_key: 'info:1' });

    const counter = statementCounter(hub.deps.readDb);
    expect(idsOf(await myRequests(hamza))).toEqual([mine]);
    expect(counter.count).toBe(1);

    hub.clock.advance(45_000);
    tick();
    expect(alertOf(mine).step).toBe(1);
    expect((await myRequests(hamza))[0]).toMatchObject({ ask_in_person: false });

    for (let i = 10; i < 30; i += 1) raiseAs(hamza, voidInput(i));
    counter.reset();
    expect(await myRequests(hamza)).toHaveLength(21);
    expect(counter.count).toBe(1);

    const kds = device('kds', 'kds');
    const station = await hub.app.inject({ method: 'POST', url: '/auth/station', headers: { authorization: `Bearer ${tokenOf(kds)}` } });
    const token = (station.json() as { data: { session_token: string } }).data.session_token;
    for (const resource of ['my-requests', 'requests-to-answer']) {
      expect((await query({ deviceToken: tokenOf(kds), sessionToken: token }, resource)).statusCode).toBe(401);
    }
  });

  // ------------------------------------------------------------------------------------------- §6.9

  it('[01d §6.9] requests-to-answer: every open request I may answer (can_answer true, signed-in view), plus my inbox rows I may no longer answer (read-only, my latest set); closed ones and ones I have no part in are absent; 2 statements for 1 or 21 requests', async () => {
    const hamza = seat(WAIT, 'hamza tablet');
    const mgr = seat(MGR, 'mgr tablet');
    const owner = seat(OWNER, 'owner tablet');
    const cash = seat(CASH, 'cash tablet');
    await socketOf(mgr);
    const first = raiseAs(hamza, voidInput(1));
    hub.clock.advance(1_000);
    const closed = raiseAs(hamza, voidInput(2));
    closeAlert(closed);

    const counter = statementCounter(hub.deps.readDb);
    const rows = await toAnswer(mgr);
    expect(counter.count).toBe(2);
    expect(idsOf(rows)).toEqual([first]);
    expect(rows[0]).toMatchObject({
      kind: 't_approval',
      family: 'urgent',
      step: 0,
      set: 'answerer',
      for_staff_id: null,
      can_answer: true,
      seen_by_me: false,
      from_business_day: null,
      answers: ['approve', 'reject'],
      needs_pin: 'always',
      card: { kind_label_key: 'alert.t_approval.card', details: DETAILS },
      lock: { kind_label_key: 'alert.t_approval.lock', table_code: '12' },
    });
    expect(await toAnswer(cash)).toEqual([]);

    // the right removed after the step: Manager keeps a read-only row with the latest set; Owner still answers
    await seedDirectory(hub, await directory({ version: 2, waitApprovers: ['R_OWNER'] }));
    expect(await toAnswer(mgr)).toEqual([expect.objectContaining({ alert_id: first, can_answer: false, set: 'answerer' })]);
    expect(await toAnswer(owner)).toEqual([expect.objectContaining({ alert_id: first, can_answer: true })]);

    await seedDirectory(hub, await directory({ version: 3 }));
    for (let i = 10; i < 30; i += 1) raiseAs(hamza, voidInput(i));
    counter.reset();
    const many = await toAnswer(mgr);
    expect(counter.count).toBe(2);
    expect(many).toHaveLength(21);
    expect(many[0]?.alert_id).toBe(first); // oldest first
  });

  // -------------------------------------------------------------------------------------------- #53

  it("[01d #53] cumulative recipients (M2, m3): lead Imran (my_team) in steps 0 and 1, the kiosk in step 1; after a step 2 without Imran his requests-to-answer still lists it with can_answer true; a step-1 receipt from the kiosk after step 2 is recorded; the manager approves → Imran's sockets, his bound tablet and the kiosk get alert_closed", async () => {
    const kiosk = device('cashier_kiosk', 'Kiosk');
    const kioskWs = await alertSocket(kiosk);
    const imran = seat(LEAD, 'imran tablet'); // the session binds the tablet to Imran
    const imranWs = await socketOf(imran);
    const imranBound = await alertSocket(imran.deviceId);
    const hamza = seat(WAIT, 'hamza tablet');
    const req = raiseAs(hamza, voidInput(1));
    hub.clock.advance(45_000);
    tick();
    const steps = recipientsOf(req);
    expect(steps.filter((r) => r.staff_id === LEAD).map((r) => r.step)).toEqual([0, 1]);
    expect(steps.filter((r) => r.device_id === kiosk).map((r) => r.step)).toEqual([1]);

    // step 2 leaves Imran out (the step's list is resolved anew; here written as such a step would be)
    hub.clock.advance(75_000);
    append([
      {
        ...anAttemptSent({
          payload: {
            alert_id: req,
            step: 2,
            recipients: [
              { staff_id: MGR, device_id: null, for_staff_id: null, set: 'answerer' },
              { staff_id: OWNER, device_id: null, for_staff_id: null, set: 'answerer' },
              { staff_id: null, device_id: kiosk, for_staff_id: null, set: 'recipient' },
            ],
            routes: [],
          },
        }),
        event_type: 'EscalationStepped',
        stream_type: 'order',
        stream_id: 'O1',
      },
    ]);
    expect(alertOf(req).step).toBe(2);
    expect(recipientsOf(req).filter((r) => r.step === 2 && r.staff_id === LEAD)).toEqual([]);

    const counter = statementCounter(hub.deps.readDb);
    expect(await toAnswer(imran)).toEqual([expect.objectContaining({ alert_id: req, can_answer: true, set: 'answerer', step: 2 })]);
    expect(counter.count).toBe(2);

    kioskWs.send({ type: 'receipt', alert_id: req, kind: 'delivered', step: 1 });
    await fence();
    receiptBufferFor(hub.app).flush();
    expect(hub.deps.db.prepare("SELECT staff_id, device_id, step FROM alert_receipts WHERE alert_id = ? AND kind = 'delivered'").all(req)).toEqual([
      { staff_id: '', device_id: kiosk, step: 1 },
    ]);

    const mgr = seat(MGR, 'mgr tablet');
    expect((await answer(mgr, byPin(req, PIN.b))).statusCode).toBe(200);
    await fence();
    for (const client of [imranWs, imranBound, kioskWs]) {
      expect(closedFrames(client)).toEqual([{ type: 'alert_closed', alert_id: req, reason: 'answered', decision: 'approve', by_name: 'Manager' }]);
    }
  });

  // -------------------------------------------------------------------------------------------- #61

  it('[01d #61 hub] late approver (N3): a void raised while no approver has a route (shortcut); a manager who signs in after step 2 gets it in requests-to-answer (can_answer true, 2 statements) and in the alerts catch-up; his MarkAlertsSeen writes RequestSeen and an inbox row; another answer sends alert_closed to his socket; a person who may not answer and has no inbox row sees nothing', async () => {
    const hamza = seat(WAIT, 'hamza tablet');
    const req = raiseAs(hamza, voidInput(1));
    expect(alertOf(req).step).toBe(2); // G1-9d: no step-0 answerer had a route
    await seedDirectory(hub, await directory({ withMgr2: true, version: 2 }));
    const mgr2 = seat(MGR2, 'mgr2 tablet');
    const cash = seat(CASH, 'cash tablet');
    const inboxOf = (staffId: string): number =>
      hub.deps.db.prepare('SELECT COUNT(*) FROM alert_inbox WHERE staff_id = ? AND alert_id = ?').pluck().get(staffId, req) as number;
    expect(inboxOf(MGR2)).toBe(0);

    const counter = statementCounter(hub.deps.readDb);
    const rows = await toAnswer(mgr2);
    expect(counter.count).toBe(2);
    expect(rows).toEqual([
      expect.objectContaining({ alert_id: req, can_answer: true, set: 'answerer', escalation: true, seen_by_me: false, from_business_day: null, raised_at: alertOf(req).raised_at }),
    ]);

    const mgr2Ws = await socketOf(mgr2);
    expect(catchUpOf(mgr2Ws)).toEqual([expect.objectContaining({ alert_id: req, set: 'answerer', seen_by_me: false, from_business_day: null })]);

    const seen = await post(mgr2, 'mark-alerts-seen', 'MarkAlertsSeen', { alert_ids: [req] });
    expect(seen.statusCode).toBe(200);
    expect(eventsOf('RequestSeen').map((e) => [e.payload.alert_id, e.payload.staff_id])).toEqual([[req, MGR2]]);
    expect(inboxOf(MGR2)).toBe(1);
    expect(await toAnswer(mgr2)).toEqual([expect.objectContaining({ alert_id: req, can_answer: true, seen_by_me: true })]);

    // a person who may not answer it and has no inbox row
    expect(await toAnswer(cash)).toEqual([]);
    expect(built(cash).map((r) => r.alert_id)).not.toContain(req);

    const mgr = seat(MGR, 'mgr tablet');
    expect((await answer(mgr, byPin(req, PIN.b))).statusCode).toBe(200);
    await fence();
    expect(closedFrames(mgr2Ws)).toEqual([{ type: 'alert_closed', alert_id: req, reason: 'answered', decision: 'approve', by_name: 'Manager' }]);
    expect(await toAnswer(mgr2)).toEqual([]);
  });

  // ------------------------------------------------------------------------------------------- BF-4

  it('[01d BF-4] each catch-up and requests-to-answer row carries raised_at and from_business_day: the business date when raised before the current day opened, else null (also null when no day was ever opened); catch-up stays 2 statements', async () => {
    const before = raise(voidInput(1)); // before any business day
    const mgr0 = seat(MGR, 'mgr tablet 0');
    expect(await toAnswer(mgr0)).toEqual([expect.objectContaining({ alert_id: before, from_business_day: null })]);

    hub.clock.advance(60_000);
    dayOpened('2025-10-19');
    hub.clock.advance(60_000);
    const yesterday = raise(voidInput(2));
    hub.clock.advance(60_000);
    dayClosed();
    hub.clock.advance(8 * 3_600_000);
    dayOpened('2025-10-20');
    hub.clock.advance(1_000);
    const today = raise(voidInput(3));
    const mgr = seat(MGR, 'mgr tablet');
    const expected = [
      { alert_id: before, raised_at: alertOf(before).raised_at, from_business_day: localDate(alertOf(before).raised_at) },
      { alert_id: yesterday, raised_at: alertOf(yesterday).raised_at, from_business_day: '2025-10-19' },
      { alert_id: today, raised_at: alertOf(today).raised_at, from_business_day: null },
    ];

    const rows = await toAnswer(mgr);
    expect(rows.map((r) => ({ alert_id: r.alert_id, raised_at: r.raised_at, from_business_day: r.from_business_day }))).toEqual(expected);

    const ws = await socketOf(mgr);
    const caught = catchUpOf(ws);
    expect(caught.map((r) => ({ alert_id: r.alert_id, raised_at: r.raised_at, from_business_day: r.from_business_day }))).toEqual(expected);

    const counter = statementCounter(hub.deps.db);
    built(mgr);
    expect(counter.count).toBe(2);
  });
});
