import { verify } from '@node-rs/argon2';
import type { AlertView, DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed, aBusinessDayOpened, anAlertRaised, anAttemptSent } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAlertSockets } from '../../src/alerts/alert-sockets';
import { createAlertsCatchUp } from '../../src/alerts/catch-up';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { receiptBufferFor } from '../../src/alerts/receipts';
import { currentDirectory } from '../../src/auth/guards';
import { activity } from '../../src/auth/session-store';
import type { CommandCtx } from '../../src/commands/registry';
import type { SocketCtx } from '../../src/ws/catch-up';
import { wsHubFor } from '../../src/ws/server';
import { aDirectory, PIN } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { fakePager, registerFakes, resetFakes } from './fakes';

// 01d task 34: `GET /queries/alerts-inbox` (§6.7) and the `alerts` catch-up part (§6 batch 3, H-7), with the
// hiding from the answering seat (§3.10), the may-answer rows (§6.9, N3), `seen_by_me` (§8.3) in catch-up and
// alerts_open, the signed-in view fields (AD-23) and the request_result outcome (AD-82); tests #39, #42, #43, #55.
// Real WS clients and HTTP injects against a test hub; a fence frame instead of timed waits.

vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...actual, verify: vi.fn((hash: string, pin: string) => actual.verify(hash, pin)) };
});
const verifySpy = vi.mocked(verify);

const OWNER = 'S_OWNER'; // "Owner": Imran's lead; an approver (R_OWNER)
const MGR = 'S_MGR'; // "Imran" (and the approver "Ali" of #39): approver (R_MGR), Cashier's lead
const MGR2 = 'S_MGR2'; // a second manager who starts the shift after the request was raised (N3)
const CASH = 'S_CASH'; // "Cashier": reports to MGR (the "for" rows)
const WAIT = 'S_WAIT'; // "Hamza": requester; void-item requires approval by R_MGR or R_OWNER
const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const DETAILS = { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' };
const SECRET_TEXT = ['Mutton platter', 'customer changed mind', '480000'];
const SIGNED_IN_KEYS = ['"card"', '"details"', '"answers"', '"needs_pin"', '"silent"'];

async function directory(o: { withMgr2?: boolean; version?: number } = {}): Promise<DirectoryInput> {
  const base = await aDirectory({ directory_version: o.version ?? 1 });
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
  const staff = base.staff.map((s) => (s.staff_id === MGR ? { ...s, lead_staff_id: OWNER } : s.staff_id === CASH ? { ...s, lead_staff_id: MGR } : s));
  const mgr = staff.find((s) => s.staff_id === MGR);
  if (mgr === undefined) throw new Error('fixture has no S_MGR');
  return { ...base, roles, staff: o.withMgr2 === true ? [...staff, { ...mgr, staff_id: MGR2, display_name: 'Manager two', lead_staff_id: null }] : staff };
}

interface Seat {
  staffId: string;
  deviceId: string;
  deviceToken: string;
  sessionId: string;
  sessionToken: string;
}

type Frame = { type: string; alert_id?: string; alert?: AlertView & Record<string, unknown> } & Record<string, unknown>;
type Row = AlertView & Record<string, unknown>;

describe('01d alerts-inbox and the alerts catch-up part (task 34)', () => {
  let hub: TestHub;
  const clients: WsClient[] = [];
  const tokens = new Map<string, string>(); // device id → device token

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

  function device(type: 'tablet' | 'cashier_kiosk' | 'kds' | 'phone', name: string): string {
    const d = pairDevice(hub, { type, name, stationId: type === 'kds' ? 'station-1' : undefined });
    tokens.set(d.deviceId, d.token);
    return d.deviceId;
  }

  function tokenOf(deviceId: string): string {
    const t = tokens.get(deviceId);
    if (t === undefined) throw new Error(`unknown device ${deviceId}`);
    return t;
  }

  function signIn(staffId: string, deviceId: string): Seat {
    const s = openSession(hub, { kind: 'staff', staffId, deviceId });
    return { staffId, deviceId, deviceToken: tokenOf(deviceId), sessionId: s.sessionId, sessionToken: s.token };
  }

  function seat(staffId: string, name: string, type: 'tablet' | 'cashier_kiosk' = 'tablet'): Seat {
    return signIn(staffId, device(type, name));
  }

  /** `staffId` signs in on `on`'s device; one open session per device, so that session ends first. */
  function signInOn(on: Seat, staffId: string): Seat {
    endSessionNow(hub, on.sessionId);
    return signIn(staffId, on.deviceId);
  }

  async function socketOf(s: Seat): Promise<WsClient> {
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: s.deviceToken, session_token: s.sessionToken });
    await ws.untilCount(1);
    expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
    clients.push(ws);
    return ws;
  }

  async function stationSocket(deviceId: string): Promise<WsClient> {
    const response = await hub.app.inject({ method: 'POST', url: '/auth/station', headers: { authorization: `Bearer ${tokenOf(deviceId)}` } });
    const body = response.json() as { data: { session_token: string } };
    const ws = await connectWs(hub.app);
    ws.send({ type: 'auth', device_token: tokenOf(deviceId), session_token: body.data.session_token });
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

  /** The `alerts` catch-up part of a session socket's first frame. */
  function catchUpOf(ws: WsClient): Row[] {
    const first = ws.messages[0] as { type: string; state: { alerts?: { alerts: Row[] } } };
    expect(first.type).toBe('catch_up');
    if (first.state.alerts === undefined) throw new Error('no alerts catch-up part');
    return first.state.alerts.alerts;
  }

  const openRows = (ws: WsClient): Row[] => (ws.messages[0] as { alerts: Row[] }).alerts;

  let fenceNo = 0;
  /** Every frame sent before this call has reached every open client (per-socket order). */
  async function fence(): Promise<void> {
    fenceNo += 1;
    const id = `FENCE_${fenceNo}`;
    wsHubFor(hub.app).sendToDevices([...tokens.keys()], { type: 'alert_seen', alert_id: id });
    for (const client of clients) {
      const closed = await client.untilClose(1).then(
        () => true,
        () => false,
      );
      if (closed) continue;
      for (let i = 0; i < 50 && !client.messages.some((m) => (m as Frame).alert_id === id); i += 1) {
        await client.untilCount(client.messages.length + 1);
      }
    }
  }

  const framesOf = (client: WsClient, type: string): Frame[] =>
    (client.messages as Frame[]).filter((m) => m.type === type && !(m.alert_id ?? '').startsWith('FENCE_'));
  const alertFrames = (client: WsClient): Row[] => framesOf(client, 'alert').flatMap((f) => (f.alert === undefined ? [] : [f.alert]));

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

  function closeAlert(id: string): void {
    hub.deps.writer.run((tx) => tx.append(alerts.close(alerts.tickCtx(tx, hub.clock.branchNow()), id, 'done')));
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

  const dayOpened = (): void => append([aBusinessDayOpened()]);
  const dayClosed = (): void => append([aBusinessDayClosed()]);

  const display = { kind_label_key: 'alert.t.lock', table_code: '12', requester_name: 'Order taker' };
  const toPerson = (kind: string, staffId: string, key: string): RaiseInput => ({
    kind,
    subject: { stream_type: kind === 't_action' ? 'table' : 'hub', stream_id: kind === 't_action' ? 'T12' : BRANCH },
    target: { kind: 'person', staff_id: staffId },
    display,
    dedupe_key: key,
  });
  const toDevice = (deviceId: string, key: string): RaiseInput => ({
    kind: 't_info',
    subject: { stream_type: 'hub', stream_id: BRANCH },
    target: { kind: 'device', device_id: deviceId },
    display,
    dedupe_key: key,
  });
  const voidInput = (n = 1): RaiseInput => ({
    kind: 't_approval',
    subject: { stream_type: 'order', stream_id: `O${n}` },
    target: { kind: 'answerers' },
    values: { order_id: `O${n}` },
    display,
    details: DETAILS,
    dedupe_key: `void:O${n}:L1`,
    requester_staff_id: WAIT,
    request: { approver_role_ids: ['R_MGR', 'R_OWNER'] },
  });

  /** A builder-seeded alert of `kind` to one person, optionally hidden from a seat. */
  function seedTo(o: { id: string; kind: string; staffId: string; family?: string; hidden?: { session_id: string; device_id: string } }): void {
    append([
      anAlertRaised({
        payload: {
          alert_id: o.id,
          kind: o.kind,
          family: o.family ?? 'info',
          dedupe_key: `seed:${o.id}`,
          display,
          target: { kind: 'person', staff_id: o.staffId },
          hidden_from: o.hidden ?? null,
        },
      }),
      anAttemptSent({
        payload: { alert_id: o.id, step: 0, recipients: [{ staff_id: o.staffId, device_id: null, for_staff_id: null, set: 'recipient' }], routes: [] },
      }),
    ]);
  }

  let commandNo = 0;
  function post(s: Seat, name: string, commandType: string, payload: Record<string, unknown>) {
    return hub.app.inject({
      method: 'POST',
      url: `/commands/${name}`,
      headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
      payload: {
        command_id: `ic-${(commandNo += 1)}`,
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
  const inPerson = (alertId: string, answerer: string, pin: string) => ({ alert_id: alertId, decision: 'approve', method: 'in_person', answerer_staff_id: answerer, pin });
  const byPin = (alertId: string, pin: string) => ({ alert_id: alertId, decision: 'approve', method: 'pin', pin });
  async function markSeen(s: Seat, ids: string[]): Promise<string[]> {
    const response = await post(s, 'mark-alerts-seen', 'MarkAlertsSeen', { alert_ids: ids });
    expect(response.statusCode).toBe(200);
    return (response.json() as { data: { result: { seen: string[] } } }).data.result.seen;
  }

  function inbox(s: Seat, query = '') {
    return hub.app.inject({
      method: 'GET',
      url: `/queries/alerts-inbox${query}`,
      headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
    });
  }
  async function inboxRows(s: Seat, query = ''): Promise<{ rows: Row[]; next: string | null }> {
    const response = await inbox(s, query);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { alerts: Row[] }; meta: { next_cursor: string | null } };
    return { rows: body.data.alerts, next: body.meta.next_cursor };
  }
  const idsOf = (rows: Array<{ alert_id: unknown }>): string[] => rows.map((r) => String(r.alert_id));

  function eventsOf(type: string): PosEvent[] {
    return (hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>).map(
      (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent,
    );
  }
  const raisedOf = (kind: string): string[] =>
    eventsOf('AlertRaised')
      .filter((e) => e.payload.kind === kind)
      .map((e) => String(e.payload.alert_id));
  const stateOf = (id: string): unknown => hub.deps.db.prepare('SELECT state FROM alerts WHERE alert_id = ?').pluck().get(id);
  const seenReceipts = (id: string): unknown[] =>
    hub.deps.db.prepare("SELECT staff_id, device_id FROM alert_receipts WHERE alert_id = ? AND kind = 'seen' ORDER BY rowid").all(id);

  /** A catch-up part instance on the hub's db (the one registerAlerts made is equivalent), for direct builds. */
  function part(sent: Array<[string, string]> = []) {
    return createAlertsCatchUp({ directory: () => currentDirectory(hub.app), recordSent: (d, a) => sent.push([d, a]), branchId: BRANCH });
  }
  function ctxFor(s: { deviceId: string; sessionId: string; staffId: string | null }, kind: 'staff' | 'station' = 'staff'): SocketCtx {
    return { deviceId: s.deviceId, deviceType: 'tablet', sessionId: s.sessionId, kind, staffId: s.staffId, stationId: kind === 'station' ? 'station-1' : null, asOfSeq: 0 };
  }
  const built = (s: { deviceId: string; sessionId: string; staffId: string | null }, kind: 'staff' | 'station' = 'staff'): Row[] =>
    (part().build(hub.deps.db, hub.deps.state.get(), ctxFor(s, kind)) as { alerts: Row[] }).alerts;

  function expectLockOnly(rows: Row[]): void {
    const text = JSON.stringify(rows);
    for (const key of SIGNED_IN_KEYS) expect(text).not.toContain(key);
    for (const secret of SECRET_TEXT) expect(text).not.toContain(secret);
  }

  // -------------------------------------------------------------------------------------------- #42

  it('[01d #42] alerts-inbox: open action alerts first, then raised_at desc; "for Cashier" rows on the lead; moved_to_name on the old recipient; cursor paging at limit 2 over 5; 2 statements whatever the count', async () => {
    const mgr = seat(MGR, 'mgr tablet');
    await socketOf(mgr); // MGR has a route (screen), so a Cashier alert with no route falls back to MGR
    const action = raise(toPerson('t_action', MGR, 'a1'));
    hub.clock.advance(1_000);
    const forCash = raise(toPerson('t_info', CASH, 'c1')); // Cashier has no route → "for Cashier" on MGR
    hub.clock.advance(1_000);
    const info = raise(toPerson('t_info', MGR, 'i1'));
    hub.clock.advance(1_000);
    // moved: step 0 to MGR, step 1 to OWNER → MGR's row says "Moved to Owner"
    append([
      anAlertRaised({ payload: { alert_id: 'A_MOVED', kind: 't_two_step', dedupe_key: 'seed:moved', display, target: { kind: 'person', staff_id: MGR } } }),
      anAttemptSent({ payload: { alert_id: 'A_MOVED', step: 0, recipients: [{ staff_id: MGR, device_id: null, for_staff_id: null, set: 'recipient' }], routes: [] } }),
    ]);
    append([anAttemptSent({ payload: { alert_id: 'A_MOVED', step: 1, recipients: [{ staff_id: OWNER, device_id: null, for_staff_id: null, set: 'recipient' }], routes: [] } })]);
    hub.clock.advance(1_000);
    const closedAction = raise(toPerson('t_action', MGR, 'a2'));
    closeAlert(closedAction);

    const all = await inboxRows(mgr);
    expect(idsOf(all.rows)).toEqual([action, closedAction, 'A_MOVED', info, forCash]);
    expect(all.next).toBeNull();
    const byId = new Map(all.rows.map((r) => [r.alert_id, r]));
    expect(byId.get(action)).toMatchObject({ family: 'action', state: 'open', close_reason: null, seen_by_me: false, for_staff_id: null, for_staff_name: null, moved_to_name: null, set: 'recipient' });
    expect(byId.get(closedAction)).toMatchObject({ state: 'closed', close_reason: 'done' });
    expect(byId.get(forCash)).toMatchObject({ for_staff_id: CASH, for_staff_name: 'Cashier', moved_to_name: null });
    expect(byId.get('A_MOVED')).toMatchObject({ moved_to_name: 'Owner', step: 1 });
    // the person's own signed-in view: card (display + details), the AD-23 fields
    expect(byId.get(info)).toMatchObject({
      card: { kind_label_key: 'alert.t_info.card', table_code: '12', details: null },
      lock: { kind_label_key: 'alert.t_info.lock', table_code: '12' },
      answers: null,
      needs_pin: null,
      silent: false,
    });
    expect(byId.get(info)).not.toHaveProperty('outcome');

    const pages: string[][] = [];
    let cursor: string | null = null;
    do {
      const page: { rows: Row[]; next: string | null } = await inboxRows(mgr, `?limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
      pages.push(idsOf(page.rows));
      cursor = page.next;
    } while (cursor !== null && pages.length < 10);
    expect(pages).toEqual([
      [action, closedAction],
      ['A_MOVED', info],
      [forCash],
    ]);

    const counter = statementCounter(hub.deps.readDb);
    for (const query of ['?limit=1', '?limit=2', '?limit=200', '']) {
      counter.reset();
      expect((await inbox(mgr, query)).statusCode).toBe(200);
      expect(counter.count).toBe(2);
    }
    // the owner sees only its own row (the moved alert), not MGR's
    expect(idsOf((await inboxRows(seat(OWNER, 'owner tablet'))).rows)).toEqual(['A_MOVED']);
  });

  it('[01d §6.7] alerts-inbox input: limit default 50, max 200; a bad cursor or limit 201 → 400; a station session cannot read it', async () => {
    const mgr = seat(MGR, 'mgr tablet');
    for (let i = 0; i < 52; i += 1) raise(toPerson('t_info', MGR, `many:${i}`));
    const first = await inboxRows(mgr);
    expect(first.rows).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const rest = await inboxRows(mgr, `?cursor=${encodeURIComponent(first.next as string)}`);
    expect(rest.rows).toHaveLength(2);
    expect(rest.next).toBeNull();
    expect((await inboxRows(mgr, '?limit=200')).rows).toHaveLength(52);
    expect((await inbox(mgr, '?limit=201')).statusCode).toBe(400);
    expect((await inbox(mgr, '?cursor=not-a-cursor')).json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    const kds = device('kds', 'kds');
    const station = await hub.app.inject({ method: 'POST', url: '/auth/station', headers: { authorization: `Bearer ${tokenOf(kds)}` } });
    const token = (station.json() as { data: { session_token: string } }).data.session_token;
    const denied = await hub.app.inject({ method: 'GET', url: '/queries/alerts-inbox', headers: { authorization: `Bearer ${tokenOf(kds)}`, 'x-session-token': token } });
    expect(denied.statusCode).toBe(401);
  });

  // ------------------------------------------------------------------------------------------- §6.7

  it('[01d §6.7] today only, plus the open personal notices of earlier days; closed earlier notices and earlier alerts are gone; hidden rows absent for that session and that device; 2 statements', async () => {
    dayOpened();
    seedTo({ id: 'Y_INFO', kind: 't_info', staffId: MGR });
    seedTo({ id: 'Y_NOTICE_OPEN', kind: 'approval_receipt', staffId: MGR });
    seedTo({ id: 'Y_NOTICE_CLOSED', kind: 'pin_use_failed', staffId: MGR });
    closeAlert('Y_NOTICE_CLOSED');
    hub.clock.advance(60_000);
    dayClosed();
    hub.clock.advance(8 * 3_600_000);
    dayOpened();
    const mgr = seat(MGR, 'mgr tablet'); // signed in on the new day (an 8 h old session would have idled out)
    hub.clock.advance(1_000);
    seedTo({ id: 'T_INFO', kind: 't_info', staffId: MGR });
    hub.clock.advance(1_000);
    seedTo({ id: 'T_HID_SESSION', kind: 'approval_receipt', staffId: MGR, hidden: { session_id: mgr.sessionId, device_id: 'DEV_ELSEWHERE' } });
    hub.clock.advance(1_000);
    seedTo({ id: 'T_HID_DEVICE', kind: 'approval_receipt', staffId: MGR, hidden: { session_id: 'SESSION_ELSEWHERE', device_id: mgr.deviceId } });

    const counter = statementCounter(hub.deps.readDb);
    const rows = (await inboxRows(mgr)).rows;
    expect(counter.count).toBe(2);
    expect(idsOf(rows)).toEqual(['T_INFO', 'Y_NOTICE_OPEN']);
    expect(rows[1]).toMatchObject({ kind: 'approval_receipt', state: 'open', silent: true });
    // the same person on another tablet: both hidden ones are listed (neither this session nor this device)
    const other = seat(MGR, 'mgr other tablet');
    expect(idsOf((await inboxRows(other)).rows)).toEqual(['T_HID_DEVICE', 'T_HID_SESSION', 'T_INFO', 'Y_NOTICE_OPEN']);
  });

  it('[01d §7] a corrupt details_json fails the inbox (500) and the catch-up (socket closed) with a log of the error name and code only, never the details text', async () => {
    const mgr = seat(MGR, 'mgr tablet');
    const hamza = seat(WAIT, 'hamza tablet');
    const id = raiseAs(hamza, voidInput());
    hub.deps.db.prepare('UPDATE alerts SET details_json = ? WHERE alert_id = ?').run('{"item":"Mutton platter","reason":"customer changed mind" broken', id);
    const response = await inbox(mgr);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    const ws = await connectWs(hub.app);
    clients.push(ws);
    ws.send({ type: 'auth', device_token: mgr.deviceToken, session_token: mgr.sessionToken });
    await ws.untilClose();
    const logs = hub.logs();
    expect(logs).toContain('AlertViewError');
    expect(logs).toContain('SyntaxError');
    for (const text of SECRET_TEXT) expect(logs).not.toContain(text);
  });

  // -------------------------------------------------------------------------------------------- #43

  it('[01d #43] the alerts catch-up part: a staff socket and a KDS station socket get their open alerts (person and device targets) through build(db, state, socket); the staff socket also gets an open request its person may answer with no inbox row (N3); 2 statements; an alert-mode socket gets alerts_open, not catch-up', async () => {
    const kds = device('kds', 'kds');
    const hamza = seat(WAIT, 'hamza tablet');
    const request = raiseAs(hamza, voidInput()); // answerers today: MGR, OWNER (inbox rows)
    // a second manager starts the shift after the request was sent: no inbox row, may answer now (N3)
    await seedDirectory(hub, await directory({ withMgr2: true, version: 2 }));
    const mgr2 = seat(MGR2, 'mgr2 tablet');
    const own = raise(toPerson('t_info', MGR2, 'own'));
    const toKds = raise(toDevice(kds, 'kds'));
    const closedOwn = raise(toPerson('t_info', MGR2, 'closed'));
    closeAlert(closedOwn);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM alert_inbox WHERE staff_id = ? AND alert_id = ?').pluck().get(MGR2, request)).toBe(0);

    const staffWs = await socketOf(mgr2);
    const staffRows = catchUpOf(staffWs);
    expect(idsOf(staffRows).sort()).toEqual([request, own].sort());
    const req = staffRows.find((r) => r.alert_id === request);
    expect(req).toMatchObject({
      kind: 't_approval',
      family: 'urgent',
      set: 'answerer',
      for_staff_id: null,
      seen_by_me: false,
      answers: ['approve', 'reject'],
      needs_pin: 'always',
      silent: false,
      card: { kind_label_key: 'alert.t_approval.card', details: DETAILS },
      lock: { kind_label_key: 'alert.t_approval.lock', table_code: '12' },
    });
    expect(staffRows.find((r) => r.alert_id === own)).toMatchObject({ set: 'recipient', card: { details: null }, seen_by_me: false });

    const stationWs = await stationSocket(kds);
    const stationRows = catchUpOf(stationWs);
    // the request's escalation step (sent at once: no answerer had a route, G1-9d) includes always_on → the KDS
    expect(idsOf(stationRows).sort()).toEqual([request, toKds].sort());
    expect(stationRows.find((r) => r.alert_id === toKds)).toMatchObject({ kind: 't_info', set: 'recipient', seen_by_me: false, lock: { kind_label_key: 'alert.t_info.lock' } });
    expect(stationRows.find((r) => r.alert_id === request)).toMatchObject({ kind: 't_approval', escalation: true, lock: { kind_label_key: 'alert.t_approval.lock' } });
    expectLockOnly(stationRows);

    // a receipt for the may-answer row (sent only through the catch-up) is accepted
    staffWs.send({ type: 'receipt', alert_id: request, kind: 'delivered', step: 0 });
    await fence();
    receiptBufferFor(hub.app).flush();
    expect(hub.deps.db.prepare("SELECT staff_id, device_id FROM alert_receipts WHERE alert_id = ? AND kind = 'delivered'").all(request)).toEqual([
      { staff_id: MGR2, device_id: mgr2.deviceId },
    ]);

    // statements: 2 for a staff socket (inbox / device rows; open requests), the same for 1 and 20 more alerts
    const counter = statementCounter(hub.deps.db);
    const sent: Array<[string, string]> = [];
    counter.reset();
    const p = part(sent);
    const first = p.build(hub.deps.db, hub.deps.state.get(), ctxFor(mgr2)) as { alerts: Row[] };
    expect(counter.count).toBe(2);
    expect(sent.map(([d, a]) => `${d}:${a}`).sort()).toEqual(idsOf(first.alerts).map((a) => `${mgr2.deviceId}:${a}`).sort());
    for (let i = 0; i < 20; i += 1) raise(toPerson('t_info', MGR2, `more:${i}`));
    counter.reset();
    expect((p.build(hub.deps.db, hub.deps.state.get(), ctxFor(mgr2)) as { alerts: Row[] }).alerts).toHaveLength(22);
    expect(counter.count).toBe(2);
    counter.reset();
    p.build(hub.deps.db, hub.deps.state.get(), { ...ctxFor({ deviceId: kds, sessionId: 'x', staffId: null }, 'station'), deviceType: 'kds' });
    expect(counter.count).toBeLessThanOrEqual(2);

    // an alert-mode socket is not in the catch-up path
    const kdsAlert = await alertSocket(kds);
    expect(kdsAlert.messages.some((m) => (m as Frame).type === 'catch_up')).toBe(false);
    expect(idsOf(openRows(kdsAlert)).sort()).toEqual([request, toKds].sort());
  });

  it('[01d AD-23] alert-mode frames (alerts_open, and alert to alert-mode sockets) never carry card, details, answers, needs_pin or silent; the signed-in card frame does carry the AD-23 fields', async () => {
    const tab = device('tablet', 'mgr tablet');
    const mgr = signIn(MGR, tab); // binds the tablet to MGR
    const hamza = seat(WAIT, 'hamza tablet');
    const before = raiseAs(hamza, voidInput(1));
    const alertWs = await alertSocket(tab);
    expect(idsOf(openRows(alertWs))).toEqual([before]);
    const staffWs = await socketOf(mgr);
    raiseAs(hamza, voidInput(2));
    raise(toDevice(tab, 'dev'));
    await fence();
    const modeFrames = alertFrames(alertWs);
    expect(modeFrames.length).toBeGreaterThanOrEqual(2);
    expectLockOnly(openRows(alertWs));
    expectLockOnly(modeFrames);
    const cards = alertFrames(staffWs).filter((f) => f.kind === 't_approval');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ answers: ['approve', 'reject'], needs_pin: 'always', silent: false, card: { details: DETAILS } });
  });

  it('[01d AD-82] request_result carries outcome on every view (alert-mode lock frame, alerts_open, catch-up, inbox) and never an amount, item or reason; other kinds have none', async () => {
    const hamzaTab = device('tablet', 'hamza tablet');
    const hamza = signIn(WAIT, hamzaTab);
    const imran = seat(MGR, 'imran tablet');
    const id = raiseAs(hamza, voidInput());
    const hamzaAlert = await alertSocket(hamzaTab);
    expect((await answer(imran, byPin(id, PIN.b))).statusCode).toBe(200);
    await fence();
    const [result] = raisedOf('request_result');
    const lockFrame = alertFrames(hamzaAlert).find((f) => f.alert_id === result);
    expect(lockFrame).toMatchObject({ kind: 'request_result', outcome: 'approved' });
    expectLockOnly([lockFrame as Row]);
    const reopened = await alertSocket(hamzaTab);
    expect(openRows(reopened).find((r) => r.alert_id === result)).toMatchObject({ outcome: 'approved', seen_by_me: false });
    expect(catchUpOf(await socketOf(hamza)).find((r) => r.alert_id === result)).toMatchObject({ outcome: 'approved' });
    const rows = (await inboxRows(hamza)).rows;
    expect(rows.find((r) => r.alert_id === result)).toMatchObject({ outcome: 'approved', state: 'open' });
    // other kinds: no outcome
    for (const r of [...rows, ...catchUpOf(await socketOf(imran))].filter((r) => r.kind !== 'request_result')) expect(r).not.toHaveProperty('outcome');

    // a rejection and an owner close (obsolete) of a request
    const rejected = raiseAs(hamza, voidInput(2));
    expect((await answer(imran, { alert_id: rejected, decision: 'reject', method: 'pin', pin: PIN.b })).statusCode).toBe(200);
    const obsolete = raiseAs(hamza, voidInput(3));
    hub.deps.writer.run((tx) => tx.append(alerts.close(alerts.tickCtx(tx, hub.clock.branchNow()), obsolete, 'obsolete', 'customer changed mind')));
    const outcomes = new Map((await inboxRows(hamza)).rows.filter((r) => r.kind === 'request_result').map((r) => [r.alert_id, r.outcome]));
    const results = raisedOf('request_result');
    expect([...results].map((r) => outcomes.get(r))).toEqual(['approved', 'rejected', 'obsolete']);
  });

  // -------------------------------------------------------------------------------------------- #39

  it('[01d #39] alert_seen: Imran bound to tablets A and B (A signed in with its alert-mode socket, B alert mode only) with an urgent request; MarkAlertsSeen on A → B and A\'s other sockets get alert_seen; a second sends none; after reconnect alerts_open and catch-up show seen_by_me: true', async () => {
    const a = device('tablet', 'tablet A');
    const b = device('tablet', 'tablet B');
    const onB = signIn(MGR, b);
    endSessionNow(hub, onB.sessionId, 'idle_timeout'); // B stays bound to Imran (idle_timeout keeps the binding)
    const onA = signIn(MGR, a);
    const hamza = seat(WAIT, 'hamza tablet');
    const aStaff = await socketOf(onA);
    const aAlert = await alertSocket(a);
    const id = raiseAs(hamza, voidInput());
    const bAlert = await alertSocket(b); // B reconnects after the raise: alerts_open lists it, not yet seen
    expect(openRows(bAlert).find((r) => r.alert_id === id)).toMatchObject({ seen_by_me: false });
    await fence();
    for (const ws of [aStaff, aAlert]) expect(alertFrames(ws).map((f) => f.alert_id)).toContain(id);
    expect(catchUpOf(await socketOf(onA)).find((r) => r.alert_id === id)).toMatchObject({ seen_by_me: false });

    const mark = new Map(clients.map((c) => [c, framesOf(c, 'alert_seen').length]));
    expect(await markSeen(onA, [id])).toEqual([id]);
    await fence();
    const seenNow = (c: WsClient): Frame[] => framesOf(c, 'alert_seen').slice(mark.get(c));
    expect(seenNow(bAlert)).toEqual([{ type: 'alert_seen', alert_id: id }]);
    expect(seenNow(aStaff)).toEqual([{ type: 'alert_seen', alert_id: id }]);
    expect(seenNow(aAlert)).toEqual([{ type: 'alert_seen', alert_id: id }]);

    const again = new Map(clients.map((c) => [c, framesOf(c, 'alert_seen').length]));
    expect(await markSeen(onA, [id])).toEqual([id]);
    await fence();
    for (const c of clients) expect(framesOf(c, 'alert_seen').slice(again.get(c))).toEqual([]);

    expect(openRows(await alertSocket(b)).find((r) => r.alert_id === id)).toMatchObject({ seen_by_me: true });
    expect(catchUpOf(await socketOf(onA)).find((r) => r.alert_id === id)).toMatchObject({ seen_by_me: true });
    // Hamza (not the seer) still sees it unseen in nothing of his: the request is not in his inbox or catch-up
    expect(catchUpOf(await socketOf(hamza)).map((r) => r.alert_id)).not.toContain(id);
  });

  it('[01d §8.3] alerts_open: seen_by_me is false for a device-target row with no person; ≤ 3 statements with seen_by_me read in the same alert statement', async () => {
    const tab = device('tablet', 'tablet');
    const mgr = signIn(MGR, tab);
    const toTab = raise(toDevice(tab, 'dev'));
    const own = raise(toPerson('t_info', MGR, 'own'));
    expect(await markSeen(mgr, [toTab, own])).toEqual([own]);
    receiptBufferFor(hub.app).flush();
    const ws = await alertSocket(tab);
    const rows = new Map(openRows(ws).map((r) => [r.alert_id, r]));
    expect(rows.get(toTab)).toMatchObject({ seen_by_me: false });
    expect(rows.get(own)).toMatchObject({ seen_by_me: true });
    // the builder alone: ≤ 3 statements (alerts with seen_by_me, presence, activity)
    const sockets = createAlertSockets({
      db: hub.deps.db,
      branchId: BRANCH,
      clock: hub.clock,
      ws: () => wsHubFor(hub.app),
      recordSent: () => undefined,
      log: { error: () => undefined },
    });
    const counter = statementCounter(hub.deps.db);
    counter.reset();
    expect(sockets.alertsOpen(tab).alerts).toHaveLength(2);
    expect(counter.count).toBeLessThanOrEqual(3);
  });

  // -------------------------------------------------------------------------------------------- #55

  it('[01d #55] in person on the raising tablet: answered_on_requester_device and a silent approval_receipt reach Imran on every own route (screen, bound tablet, pager); in person from tablet B → 403 in_person_elsewhere, no PIN verified, nothing counted', async () => {
    const hamza = seat(WAIT, 'Hamza tablet');
    const imranTab = device('tablet', 'Imran tablet');
    const imran = signIn(MGR, imranTab);
    fakePager.refs.set(MGR, ['pager:5']);
    const screen = await socketOf(imran);
    const bound = await alertSocket(imranTab);
    const id = raiseAs(hamza, voidInput());
    await fence();
    const before = new Map(clients.map((c) => [c, alertFrames(c).length]));

    // tablet B: Hamza signed in as himself on another tablet → 403 before any PIN check
    const tabletB = seat(WAIT, 'tablet B');
    const elsewhere = await answer(tabletB, inPerson(id, MGR, PIN.b));
    expect(elsewhere.statusCode).toBe(403);
    expect(elsewhere.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED', details: { reason: 'in_person_elsewhere' } } });
    expect(verifySpy).not.toHaveBeenCalled();
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM auth_lockouts').pluck().get()).toBe(0);
    expect(eventsOf('RequestPinFailed')).toHaveLength(0);

    expect((await answer(hamza, inPerson(id, MGR, PIN.b))).statusCode).toBe(200);
    expect(eventsOf('RequestAnswered')[0]?.payload).toMatchObject({ method: 'in_person', device_id: hamza.deviceId, on_requester_device: true });
    const [notice] = raisedOf('answered_on_requester_device');
    const [receipt] = raisedOf('approval_receipt');
    await fence();
    const cards = alertFrames(screen).slice(before.get(screen));
    // §3.12 "You approved … at Hamza's tablet": the answering device's name is a lock-safe display parameter
    expect(cards.find((f) => f.alert_id === notice)).toMatchObject({
      silent: false,
      card: { kind_label_key: 'alert.answered_on_requester_device.card', device_name: 'Hamza tablet' },
      lock: { device_name: 'Hamza tablet' },
    });
    expect(cards.find((f) => f.alert_id === receipt)).toMatchObject({ silent: true, card: { details: DETAILS, device_name: 'Hamza tablet' } });
    for (const n of [notice, receipt]) {
      expect(eventsOf('AlertRaised').find((e) => e.payload.alert_id === n)?.payload.display).toMatchObject({ device_name: 'Hamza tablet' });
    }
    const locks = alertFrames(bound).slice(before.get(bound));
    expect(idsOf(locks).sort()).toEqual([notice, receipt].sort());
    expectLockOnly(locks);
    // the pager route is resolved for both (AttemptSent.routes); its `send` needs a `short` label (§3.8, §3.12),
    // which these kinds do not register, so nothing is sent to the fake pager itself
    for (const n of [notice, receipt]) {
      const step = eventsOf('AttemptSent').find((e) => e.payload.alert_id === n);
      expect(step?.payload.routes).toEqual(
        expect.arrayContaining([
          { staff_id: MGR, route: 'screen', ref: imranTab },
          { staff_id: MGR, route: 'alert_connection', ref: imranTab },
          { staff_id: MGR, route: 'pager', ref: 'pager:5' },
        ]),
      );
    }
    expect(fakePager.sent.map((s) => s.alert_id)).not.toContain(receipt);
    // both in Imran's inbox and catch-up on his own tablet, signed-in fields included
    const rows = (await inboxRows(imran)).rows;
    expect(rows.find((r) => r.alert_id === receipt)).toMatchObject({ silent: true, card: { details: DETAILS }, state: 'open' });
    expect(idsOf(catchUpOf(await socketOf(imran)))).toEqual(expect.arrayContaining([notice, receipt]));
  });

  it('[01d #55] signed in as Imran on the kiosk, a pin answer → approval_receipt only, on_requester_device false; no frame to the kiosk session or any kiosk socket; not in that session\'s catch-up or inbox', async () => {
    const hamza = seat(WAIT, 'Hamza tablet');
    const imranTab = device('tablet', 'Imran tablet');
    const imran = signIn(MGR, imranTab);
    const own = await socketOf(imran);
    const kioskDev = device('cashier_kiosk', 'Kiosk');
    const kioskAlert = await alertSocket(kioskDev); // before the sign-in (the page with no session)
    const kiosk = signIn(MGR, kioskDev);
    const kioskWs = await socketOf(kiosk);
    const id = raiseAs(hamza, voidInput());
    expect((await answer(kiosk, byPin(id, PIN.b))).statusCode).toBe(200);
    expect(eventsOf('RequestAnswered')[0]?.payload).toMatchObject({ method: 'pin', device_id: kioskDev, on_requester_device: false });
    expect(raisedOf('answered_on_requester_device')).toHaveLength(0);
    const [receipt] = raisedOf('approval_receipt');
    await fence();
    expect(idsOf(alertFrames(kioskWs))).not.toContain(receipt);
    expect(idsOf(alertFrames(kioskAlert))).not.toContain(receipt);
    expect(alertFrames(own).find((f) => f.alert_id === receipt)).toMatchObject({ silent: true });
    expect(idsOf(catchUpOf(await socketOf(kiosk)))).not.toContain(receipt);
    expect(idsOf((await inboxRows(kiosk)).rows)).not.toContain(receipt);
    expect(idsOf((await inboxRows(imran)).rows)).toContain(receipt);
  });

  it('[01d #55] signed in as Imran on Hamza\'s tablet, a pin answer → nothing reaches that session or tablet; its seen (and a new session\'s there) closes nothing; day close ends the tablet\'s hiding, not the session\'s; Imran\'s own tablet sees both and closes them done', async () => {
    const hamza = seat(WAIT, 'Hamza tablet');
    const imranOwn = seat(MGR, 'Imran tablet');
    endSessionNow(hub, imranOwn.sessionId);
    const id = raiseAs(hamza, voidInput());
    const there = signInOn(hamza, MGR);
    const thereWs = await socketOf(there);
    const tabletAlert = await alertSocket(hamza.deviceId);
    expect((await answer(there, byPin(id, PIN.b))).statusCode).toBe(200);
    const [notice] = raisedOf('answered_on_requester_device');
    const [receipt] = raisedOf('approval_receipt');
    const both = [notice as string, receipt as string];
    await fence();
    const hiddenOnly = (ids: string[]): string[] => ids.filter((n) => both.includes(n));
    expect(hiddenOnly(idsOf(alertFrames(thereWs)))).toEqual([]);
    expect(hiddenOnly(idsOf(alertFrames(tabletAlert)))).toEqual([]);
    expect(hiddenOnly(idsOf(catchUpOf(await socketOf(there))))).toEqual([]);
    expect(hiddenOnly(idsOf(openRows(await alertSocket(hamza.deviceId))))).toEqual([]);
    expect(hiddenOnly(idsOf((await inboxRows(there)).rows))).toEqual([]);
    // a seen from that session: recorded (AlertSeen), closes neither
    expect((await markSeen(there, both)).sort()).toEqual([...both].sort());
    receiptBufferFor(hub.app).flush();
    for (const n of both) {
      expect(stateOf(n)).toBe('open');
      expect(seenReceipts(n)).toEqual([{ staff_id: MGR, device_id: hamza.deviceId }]);
    }
    // §3.10 / §8.3 (task 34 fix): that seen does not mark the open notices seen on Imran's own device —
    // inbox, catch-up and alerts_open there all show them unseen
    const ownNow = signIn(MGR, imranOwn.deviceId);
    const ownInbox = (await inboxRows(ownNow)).rows.filter((r) => both.includes(String(r.alert_id)));
    const ownCatchUp = catchUpOf(await socketOf(ownNow)).filter((r) => both.includes(String(r.alert_id)));
    const ownOpen = openRows(await alertSocket(imranOwn.deviceId)).filter((r) => both.includes(String(r.alert_id)));
    for (const rows of [ownInbox, ownCatchUp, ownOpen]) {
      expect(idsOf(rows).sort()).toEqual([...both].sort());
      for (const r of rows) expect(r.seen_by_me).toBe(false);
    }
    endSessionNow(hub, ownNow.sessionId);
    // a new session on that tablet the same day: still hidden (the device part), its seen closes nothing
    const again = signInOn(there, MGR);
    expect(hiddenOnly(idsOf((await inboxRows(again)).rows))).toEqual([]);
    expect(hiddenOnly(idsOf(built(again)))).toEqual([]);
    await markSeen(again, both);
    for (const n of both) expect(stateOf(n)).toBe('open');

    dayClosed();
    // the tablet's hiding ended: the new session there sees them; the answering session's hiding stays
    expect(idsOf((await inboxRows(again)).rows)).toEqual(expect.arrayContaining(both));
    expect(idsOf(built(again))).toEqual(expect.arrayContaining(both));
    expect(hiddenOnly(idsOf(built({ deviceId: 'ANOTHER_DEVICE', sessionId: there.sessionId, staffId: MGR })))).toEqual([]);

    // Imran's next sign-in on his own tablet shows both; his seen there closes them done
    const own = signIn(MGR, imranOwn.deviceId);
    expect(idsOf((await inboxRows(own)).rows)).toEqual(expect.arrayContaining(both));
    expect(idsOf(catchUpOf(await socketOf(own)))).toEqual(expect.arrayContaining(both));
    await markSeen(own, both);
    for (const n of both) expect(hub.deps.db.prepare('SELECT state, close_reason FROM alerts WHERE alert_id = ?').get(n)).toEqual({ state: 'closed', close_reason: 'done' });
  });

  it('[01d #55] Imran answering a money kind from his own tablet → no notice, on_requester_device false, an approval_receipt not shown on his tablet until day close', async () => {
    const hamza = seat(WAIT, 'Hamza tablet');
    const imran = seat(MGR, 'Imran tablet');
    const ws = await socketOf(imran);
    const id = raiseAs(hamza, voidInput());
    expect((await answer(imran, byPin(id, PIN.b))).statusCode).toBe(200);
    expect(raisedOf('answered_on_requester_device')).toHaveLength(0);
    expect(eventsOf('RequestAnswered')[0]?.payload).toMatchObject({ on_requester_device: false });
    const [receipt] = raisedOf('approval_receipt');
    await fence();
    expect(idsOf(alertFrames(ws))).not.toContain(receipt);
    expect(idsOf((await inboxRows(imran)).rows)).not.toContain(receipt);
    expect(idsOf(catchUpOf(await socketOf(imran)))).not.toContain(receipt);
    dayClosed();
    // the answering session stays hidden; the next sign-in on the same tablet shows it
    expect(idsOf((await inboxRows(imran)).rows)).not.toContain(receipt);
    const next = signInOn(imran, MGR);
    expect(idsOf((await inboxRows(next)).rows)).toContain(receipt);
    expect(idsOf(catchUpOf(await socketOf(next)))).toContain(receipt);
  });

  it('[01d #55] Imran off today with no route → no "for Imran" copy on any other device; the notices survive BusinessDayClosed and wait in his inbox', async () => {
    const hamza = seat(WAIT, 'Hamza tablet');
    const owner = seat(OWNER, 'Owner tablet'); // Imran's lead, connected: a route
    const ownerWs = await socketOf(owner);
    const id = raiseAs(hamza, voidInput());
    await fence();
    const before = alertFrames(ownerWs).length;
    expect((await answer(hamza, inPerson(id, MGR, PIN.b))).statusCode).toBe(200);
    const notices = [...raisedOf('answered_on_requester_device'), ...raisedOf('approval_receipt')];
    expect(notices).toHaveLength(2);
    await fence();
    expect(idsOf(alertFrames(ownerWs).slice(before)).filter((n) => notices.includes(n))).toEqual([]);
    expect(idsOf((await inboxRows(owner)).rows).filter((n) => notices.includes(n))).toEqual([]);
    expect(idsOf(catchUpOf(await socketOf(owner))).filter((n) => notices.includes(n))).toEqual([]);
    expect(hub.deps.db.prepare("SELECT COUNT(*) FROM alert_recipients WHERE alert_id IN (SELECT value FROM json_each(?)) AND staff_id <> 'S_MGR'").pluck().get(JSON.stringify(notices))).toBe(0);
    dayClosed();
    for (const n of notices) expect(stateOf(n)).toBe('open');
    const imran = seat(MGR, 'Imran tablet');
    const rows = (await inboxRows(imran)).rows;
    expect(idsOf(rows)).toEqual(expect.arrayContaining(notices));
    for (const n of notices) expect(rows.find((r) => r.alert_id === n)).toMatchObject({ for_staff_id: null, for_staff_name: null });
  });
  // ------------------------------------------------------------------------------- AD-162 / AD-163 card rule

  describe('[01d §3.12; AD-162, AD-163] one card rule for inbox, catch-up, requests-to-answer and frames', () => {
    type Recipient = { staff_id: string | null; device_id: string | null; for_staff_id: string | null; set: 'answerer' | 'informed' | 'recipient' };
    const person = (staffId: string, set: Recipient['set'], forStaffId: string | null = null): Recipient => ({
      staff_id: staffId,
      device_id: null,
      for_staff_id: forStaffId,
      set,
    });
    const deviceTo = (deviceId: string, set: Recipient['set']): Recipient => ({ staff_id: null, device_id: deviceId, for_staff_id: null, set });

    /** A later step of `alertId` with exactly these recipients (frames go out after commit). */
    function step(alertId: string, n: number, recipients: Recipient[]): void {
      append([anAttemptSent({ payload: { alert_id: alertId, step: n, recipients, routes: [] } })]);
    }

    async function toAnswerRows(s: Seat): Promise<Row[]> {
      const response = await hub.app.inject({
        method: 'GET',
        url: '/queries/requests-to-answer',
        headers: { authorization: `Bearer ${s.deviceToken}`, 'x-session-token': s.sessionToken },
      });
      expect(response.statusCode).toBe(200);
      return (response.json() as { data: { requests: Row[] } }).data.requests;
    }

    const rowOf = (rows: Row[], id: string): Row => {
      const row = rows.find((r) => r.alert_id === id);
      if (row === undefined) throw new Error(`no row for ${id}`);
      return row;
    };
    const expectCard = (row: Row): void => {
      expect(row).toMatchObject({ card: { kind_label_key: `alert.${row.kind}.card` } });
    };

    it('a manager signed in on the kiosk that is a device target of the request gets lock in the inbox, the catch-up and the frames', async () => {
      const hamza = seat(WAIT, 'hamza tablet');
      const kiosk = seat(MGR, 'kiosk', 'cashier_kiosk');
      const ws = await socketOf(kiosk); // MGR has a route (screen on the kiosk): step 0 goes to the answerers only
      const id = raiseAs(hamza, voidInput());
      await fence();
      const before = alertFrames(ws).length;
      // step 1 (always_on): the kiosk becomes a device target of the request
      step(id, 1, [person(MGR, 'answerer'), deviceTo(kiosk.deviceId, 'answerer')]);
      await fence();
      const frames = alertFrames(ws).slice(before).filter((f) => f.alert_id === id);
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({ step: 1 });
      expectLockOnly(frames);
      expectLockOnly([rowOf((await inboxRows(kiosk)).rows, id)]);
      expectLockOnly([rowOf(catchUpOf(await socketOf(kiosk)), id)]);
      expectLockOnly([rowOf(built(kiosk), id)]);
      // requests-to-answer follows the same rule: may answer, but on a device-target kiosk → lock
      const read = rowOf(await toAnswerRows(kiosk), id);
      expect(read).toMatchObject({ can_answer: true });
      expectLockOnly([read]);
    });

    it('a person recipient on their own tablet gets the card in the inbox, the catch-up, requests-to-answer and the frames', async () => {
      const hamza = seat(WAIT, 'hamza tablet');
      const mgr = seat(MGR, 'mgr tablet');
      const ws = await socketOf(mgr);
      const id = raiseAs(hamza, voidInput());
      const info = raise(toPerson('t_info', MGR, 'own'));
      await fence();
      for (const a of [id, info]) {
        const frame = alertFrames(ws).find((f) => f.alert_id === a);
        expect(frame).toBeDefined();
        expectCard(frame as Row);
        expectCard(rowOf((await inboxRows(mgr)).rows, a));
        expectCard(rowOf(built(mgr), a));
      }
      expect(rowOf(alertFrames(ws), id)).toMatchObject({ card: { details: DETAILS } });
      expect(rowOf(await toAnswerRows(mgr), id)).toMatchObject({ can_answer: true, card: { details: DETAILS } });
    });

    it('an informed viewer (a read-only row) gets lock in the inbox, the catch-up, requests-to-answer and the frames', async () => {
      const hamza = seat(WAIT, 'hamza tablet');
      const cash = seat(CASH, 'cash tablet'); // no approver role: may not answer
      const ws = await socketOf(cash);
      const id = raiseAs(hamza, voidInput());
      step(id, 1, [person(MGR, 'answerer'), person(CASH, 'informed')]);
      await fence();
      const frames = alertFrames(ws).filter((f) => f.alert_id === id);
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({ set: 'informed' });
      expectLockOnly(frames);
      expectLockOnly([rowOf((await inboxRows(cash)).rows, id)]);
      expectLockOnly([rowOf(built(cash), id)]);
      const read = rowOf(await toAnswerRows(cash), id);
      expect(read).toMatchObject({ can_answer: false, set: 'informed' });
      expectLockOnly([read]);
    });

    it('a viewer who may answer now with no inbox row gets the card in the catch-up and requests-to-answer', async () => {
      const hamza = seat(WAIT, 'hamza tablet');
      const id = raiseAs(hamza, voidInput());
      await seedDirectory(hub, await directory({ withMgr2: true, version: 2 }));
      const mgr2 = seat(MGR2, 'mgr2 tablet');
      expect(hub.deps.db.prepare('SELECT COUNT(*) FROM alert_inbox WHERE staff_id = ? AND alert_id = ?').pluck().get(MGR2, id)).toBe(0);
      expect(rowOf(catchUpOf(await socketOf(mgr2)), id)).toMatchObject({ set: 'answerer', card: { details: DETAILS } });
      expect(rowOf(await toAnswerRows(mgr2), id)).toMatchObject({ can_answer: true, card: { details: DETAILS } });
    });

    it('the lead\'s "for Cashier" row is read-only: lock in the inbox, the catch-up and the frames', async () => {
      const mgr = seat(MGR, 'mgr tablet');
      const ws = await socketOf(mgr); // MGR has a route; Cashier has none → "for Cashier" on MGR
      const forCash = raise(toPerson('t_info', CASH, 'c1'));
      await fence();
      const frames = alertFrames(ws).filter((f) => f.alert_id === forCash);
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({ for_staff_id: CASH });
      expectLockOnly(frames);
      const row = rowOf((await inboxRows(mgr)).rows, forCash);
      expect(row).toMatchObject({ for_staff_id: CASH, for_staff_name: 'Cashier' });
      expectLockOnly([row]);
      expectLockOnly([rowOf(built(mgr), forCash)]);
    });
  });
});
