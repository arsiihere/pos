// ⚠️ 02b v1.0.25 §6.4a RequestUnpaidHandover, §6.12a kind hand_over_unpaid, §3.7a (OR-7; run 3; D2, D3), U-2: tests
// 85, 86, 87, 88, 89, 92 (request parts), 93; 01d 122; 05a 52 (answer part). Real commands through the hub: the request,
// 01d's AnswerRequest with a PIN on a listed phone, and an `everyone` kiosk.
import type { DirectoryInput, PosEvent } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { kindOf } from '../../src/alerts/kinds';
import { requestUnpaidHandoverCommand } from '../../src/orders/commands/request-unpaid-handover';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { audienceAllows } from '../../src/ws/audience';
import type { SocketCtx } from '../../src/ws/catch-up';
import { aDirectory, PIN } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs } from '../helpers/ws-client';
import { append } from '../kds/fixtures';
import { appendOrder, FX, openDay } from './fixtures';

let hub: TestHub;
afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const grant = (permission: string) => ({ permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [] as string[], scope: 'branch' as const });

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff.find((s) => s.staff_id === 'S_CASH')!.pin_hash;
  const person = (staff_id: string, role_id: string) => ({ staff_id, display_name: staff_id, pin_hash: pin, role_ids: [role_id], denied_permissions: [], lead_staff_id: null, floor_ids: [] });
  return {
    ...base,
    roles: [...base.roles, { role_id: 'R_COUNTER', name: 'Counter', session_idle_ttl_ms: 36_000_000, permissions: [grant('mark-served'), grant('take-order')] }],
    staff: [...base.staff, person('S_ALI', 'R_COUNTER'), person('S_SARA', 'R_COUNTER')],
  };
}

interface Who { staffId: string; deviceId: string; token: string; sessionToken: string }
function signIn(staffId: string, device: { type: 'tablet' | 'phone' | 'cashier_kiosk'; ownerStaffId?: string; profile?: Record<string, unknown> } = { type: 'tablet' }): Who {
  const d = pairDevice(hub, device as never);
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: d.deviceId });
  return { staffId, deviceId: d.deviceId, token: d.token, sessionToken: session.token };
}

async function start(): Promise<{ ali: Who; sara: Who; managerPhone: Who }> {
  hub = await createTestHub();
  const dir = await directory();
  for (const role of dir.roles) role.session_idle_ttl_ms = 36_000_000;
  await seedDirectory(hub, dir);
  openDay(hub);
  const ali = signIn('S_ALI');
  const sara = signIn('S_SARA');
  // The Manager's own listed phone (present: signed in) answers; the Owner is not signed in.
  const managerPhone = signIn('S_MGR', { type: 'phone', ownerStaffId: 'S_MGR' });
  return { ali, sara, managerPhone };
}

let seq = 0;
async function post(who: Who, path: string, command_type: string, payload: Record<string, unknown>) {
  seq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: { command_id: `uh-${seq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type, payload, occurred_at: hub.clock.branchNow(), actor_id: who.staffId, device_id: who.deviceId },
  });
  const body = res.json() as { data?: { result: Record<string, unknown>; event_ids: string[] }; error?: { code: string; details: Record<string, unknown> } };
  return { status: res.statusCode, result: body.data?.result, error: body.error, eventIds: body.data?.event_ids ?? [] };
}
const ask = (who: Who, order_id: string) => post(who, 'request-unpaid-handover', 'RequestUnpaidHandover', { order_id });
const answer = (who: Who, alert_id: string, decision: 'approve' | 'reject') => post(who, 'answer-request', 'AnswerRequest', { alert_id, decision, method: 'pin', pin: PIN.b });

const takeaway = (lines = [{ order_item_id: `N${++seq}`, item_id: FX.naan }], o: { adds_to_order_id?: string } = {}) => appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_ALI', lines, ...o }).order_id;
const row = (alert_id: string) => hub.deps.db.prepare('SELECT state, close_reason, values_json, requester_staff_id FROM alerts WHERE alert_id = ?').get(alert_id) as { state: string; close_reason: string | null; values_json: string; requester_staff_id: string };
const approval = (order_id: string) => hub.deps.db.prepare('SELECT unpaid_handover_approved_at AS at, unpaid_handover_approved_due_minor AS due FROM orders WHERE order_id = ?').get(order_id) as { at: number | null; due: number | null };
const eventsOf = (type: string): PosEvent[] =>
  (hub.deps.db.prepare('SELECT event_type, schema_version, stream_id, payload FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<{ event_type: string; schema_version: number; stream_id: string; payload: string }>).map(
    (r) => ({ ...r, payload: JSON.parse(r.payload) }) as unknown as PosEvent,
  );
const naanPrice = (): number => (eventsOf('ItemAdded')[0]!.payload as { price_minor: number }).price_minor;

describe('[02b #85, 01d #122] RequestUnpaidHandover raises one urgent v6 request for the named order', () => {
  it('values { order_id, token, due_minor }, answerers the present holders (not the requester or a counter role); duplicate → same id; another requester → is_requester false', async () => {
    const { ali, sara } = await start();
    expect(kindOf('hand_over_unpaid')).toMatchObject({ family: 'urgent' });
    const order_id = takeaway();
    const r = await ask(ali, order_id);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const alert_id = r.result!.alert_id as string;
    expect(r.result).toEqual({ alert_id, is_requester: true });
    const raised = eventsOf('AlertRaised').at(-1)!;
    expect(raised.schema_version).toBe(6);
    expect(raised.payload).toMatchObject({
      kind: 'hand_over_unpaid',
      family: 'urgent',
      subject_stream_type: 'order',
      subject_stream_id: order_id,
      dedupe_key: `hand_over_unpaid:${order_id}`,
      requester_staff_id: 'S_ALI',
      values: { order_id, token: 1, due_minor: naanPrice() },
      details: { identifier: '#1', amount: naanPrice() },
      display: { kind_label_key: 'alert.hand_over_unpaid.lock' },
      request: { right_mode: 'holders', base_permission: 'hand-over-unpaid', needs_pin: 'always' },
    });
    const recipients = eventsOf('AttemptSent').concat(eventsOf('EscalationStepped')).flatMap((e) => (e.payload as { recipients?: Array<{ staff_id: string | null }> }).recipients ?? []).map((x) => x.staff_id);
    expect(recipients).toContain('S_MGR');
    expect(recipients).not.toContain('S_ALI');
    expect(recipients).not.toContain('S_SARA');

    expect((await ask(ali, order_id)).result).toEqual({ alert_id, is_requester: true });
    expect((await ask(sara, order_id)).result).toEqual({ alert_id, is_requester: false });
    expect(eventsOf('AlertRaised').filter((e) => (e.payload as { kind: string }).kind === 'hand_over_unpaid')).toHaveLength(1);
  });

  it('a parking order: token null and identifier PARKING', async () => {
    const { ali } = await start();
    const order_id = appendOrder(hub, { order_type: 'parking', placed_by: 'S_ALI', lines: [{ order_item_id: 'P1', item_id: FX.naan }] }).order_id;
    const r = await ask(ali, order_id);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(eventsOf('AlertRaised').at(-1)!.payload).toMatchObject({ values: { order_id, token: null }, details: { identifier: 'PARKING' } });
  });
});

describe('[02b #86] not needed / already approved / refused', () => {
  it('billed, fully comped and cancelled → { needed: false }; approved → { approved: true }; dine-in → 400; no mark-served → 403; not queueable', async () => {
    const { ali } = await start();
    const billed = takeaway();
    append(hub, [{ stream_type: 'order', stream_id: billed, event_type: 'OrdersBilled', payload: { order_ids: [billed], bill_id: 'BL1' } }]);
    expect((await ask(ali, billed)).result).toEqual({ needed: false });
    const cancelled = takeaway();
    append(hub, [{ stream_type: 'order', stream_id: cancelled, event_type: 'OrderCancelled', payload: { order_id: cancelled } }]);
    expect((await ask(ali, cancelled)).result).toEqual({ needed: false });
    const comped = takeaway([{ order_item_id: 'CZ', item_id: FX.naan }]);
    append(hub, [{ stream_type: 'order', stream_id: comped, event_type: 'LineComped', payload: { order_item_id: 'CZ', units: 1, value_minor: naanPrice(), reason_code: 'quality', note: null, requester_staff_id: 'S_MGR', alert_id: null, approver_staff_id: null } }]);
    expect((await ask(ali, comped)).result).toEqual({ needed: false });
    const approved = takeaway();
    append(hub, [{ stream_type: 'order', stream_id: approved, event_type: 'UnpaidHandoverApproved', payload: { order_id: approved, alert_id: 'AL0', approved_by_staff_id: 'S_MGR', due_minor: naanPrice() } }]);
    expect((await ask(ali, approved)).result).toEqual({ approved: true });
    expect(eventsOf('AlertRaised').filter((e) => (e.payload as { kind: string }).kind === 'hand_over_unpaid')).toEqual([]);

    const unknown = await ask(ali, 'NOPE');
    expect([unknown.status, unknown.error?.code]).toEqual([404, 'ORDER_NOT_FOUND']);
    openSeatingForDineIn();
    const dine = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SZ', lines: [{ order_item_id: 'DI', item_id: FX.naan }] }).order_id;
    const d = await ask(ali, dine);
    expect(d.status).toBe(400);
    expect(d.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'order_id', message: 'takeaway_or_parking_only' }] } });
    const cashier = signIn('S_CASH');
    expect((await ask(cashier, takeaway())).status).toBe(403);
    expect(requestUnpaidHandoverCommand.queueable ?? false).toBe(false);
  });
});

function openSeatingForDineIn(): void {
  append(hub, [{ stream_type: 'table', stream_id: FX.zoneTable, event_type: 'TableOpened', payload: { table_id: FX.zoneTable, seating_id: 'SZ', holder_staff_id: 'S_ALI', party_size: null } }]);
}

describe('[02b #87, #88, 05a #52] answer', () => {
  it('a Manager on a listed phone approves with PIN → UnpaidHandoverApproved for that order only; the requester gets request_result; open-orders shows it', async () => {
    const { ali, managerPhone } = await start();
    const order_id = takeaway();
    const sibling = takeaway(undefined, { adds_to_order_id: order_id });
    const alert_id = (await ask(ali, order_id)).result!.alert_id as string;
    // The sibling's own ask amount is the key's due (both lines): approving the root covers the root only.
    const a = await answer(managerPhone, alert_id, 'approve');
    expect(a.status, JSON.stringify(a.error)).toBe(200);
    const approved = eventsOf('UnpaidHandoverApproved');
    expect(approved.map((e) => e.payload)).toEqual([{ order_id, alert_id, approved_by_staff_id: 'S_MGR', due_minor: 2 * naanPrice() }]);
    expect(approval(order_id).due).toBe(2 * naanPrice());
    expect(approval(sibling)).toEqual({ at: null, due: null });
    expect(row(alert_id).state).toBe('closed');
    const results = eventsOf('AlertRaised').filter((e) => (e.payload as { kind: string }).kind === 'request_result');
    expect(results.map((e) => (e.payload as { target: unknown }).target)).toEqual([{ kind: 'person', staff_id: 'S_ALI' }]);
  });

  it('an everyone kiosk → 403 listed_device_only; reject on the listed phone writes no approval', async () => {
    const { ali, managerPhone } = await start();
    const order_id = takeaway();
    const alert_id = (await ask(ali, order_id)).result!.alert_id as string;
    const kiosk = signIn('S_MGR', { type: 'cashier_kiosk', profile: { access: 'everyone', screens: ['takeaway'] } });
    const refused = await answer(kiosk, alert_id, 'approve');
    expect([refused.status, refused.error?.code, refused.error?.details.reason]).toEqual([403, 'PERMISSION_DENIED', 'listed_device_only']);
    expect((await answer(managerPhone, alert_id, 'reject')).status).toBe(200);
    expect(eventsOf('UnpaidHandoverApproved')).toEqual([]);
    expect(approval(order_id)).toEqual({ at: null, due: null });
  });
});

describe('[02b #89, #92] the due moved: stale cards and additions', () => {
  it('an addition raises the key due: its transaction closes the stale card obsolete (due_changed, §6.19), so it cannot be approved; a new ask raises a fresh one; each order asks for itself', async () => {
    const { ali, managerPhone } = await start();
    const a = takeaway();
    const first = (await ask(ali, a)).result!.alert_id as string;
    const b = takeaway(undefined, { adds_to_order_id: a }); // the key's due rises
    const staleApprove = await answer(managerPhone, first, 'approve');
    // ⚠️ L-UNPAID-3 (02b §6.19 R3-M-8): the addition's own OpenOrderBillChanged transaction closed it due_changed
    expect(staleApprove.status).toBe(409);
    expect(staleApprove.error).toMatchObject({ code: 'REQUEST_NOT_PENDING', details: { close_reason: 'obsolete' } });
    expect(eventsOf('UnpaidHandoverApproved')).toEqual([]);
    const second = (await ask(ali, a)).result!.alert_id as string;
    expect(second).not.toBe(first);
    expect(row(first)).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
    expect(JSON.parse(row(second).values_json)).toMatchObject({ order_id: a, due_minor: 2 * naanPrice() });
    const forB = (await ask(ali, b)).result!.alert_id as string;
    expect(forB).not.toBe(second); // B's own request
    expect((await answer(managerPhone, forB, 'approve')).status).toBe(200);
    expect(approval(b).due).toBe(2 * naanPrice());
    expect(approval(a)).toEqual({ at: null, due: null }); // B's approval leaves A unapproved
    // An approval covers the due at approval time: a later rise makes it ineffective, so the order asks again.
    append(hub, [{ stream_type: 'order', stream_id: a, event_type: 'UnpaidHandoverApproved', payload: { order_id: a, alert_id: 'AL_X', approved_by_staff_id: 'S_MGR', due_minor: 2 * naanPrice() } }]);
    expect((await ask(ali, a)).result).toEqual({ approved: true });
    takeaway(undefined, { adds_to_order_id: a });
    expect((await ask(ali, a)).result).toMatchObject({ is_requester: true });
  });
});

describe('[02b #93] frame audience', () => {
  it('UnpaidHandoverApproved reaches staff sockets and the cashier kiosk, never a KDS station socket', async () => {
    await start();
    const e = { event_id: 'E1', tenant_id: 't', branch_id: 'branch-1', seq: 1, stream_type: 'order', stream_id: 'O1', event_type: 'UnpaidHandoverApproved', schema_version: 1, payload: { order_id: 'O1', alert_id: 'A', approved_by_staff_id: 'S_MGR', due_minor: 100 }, occurred_at: 0, recorded_at: 0, actor_id: null, device_id: 'hub' } as PosEvent;
    const socket = (o: Partial<SocketCtx>): SocketCtx => ({ deviceId: 'D', deviceType: 'tablet', sessionId: 'X', kind: 'staff', staffId: 'S_MGR', stationId: null, asOfSeq: 0, ...o });
    expect(audienceAllows(e, socket({}))).toBe(true);
    expect(audienceAllows(e, socket({ deviceType: 'cashier_kiosk' }))).toBe(true);
    expect(audienceAllows(e, socket({ kind: 'station', staffId: null, stationId: 'S1', deviceType: 'kds' as never }))).toBe(false);
  });
});

describe('[02b #94] audit', () => {
  it('the request, its answer and UnpaidHandoverApproved write unpaid_handover_requested / _answered / _approved (not the generic request_answered)', async () => {
    const { ali, managerPhone } = await start();
    const order_id = takeaway();
    const alert_id = (await ask(ali, order_id)).result!.alert_id as string;
    expect((await answer(managerPhone, alert_id, 'approve')).status).toBe(200);
    const rows = hub.deps.db
      .prepare("SELECT action, subject_type, subject_id, actor_staff_id, approver_staff_id, amount_minor FROM audit_entries WHERE action LIKE 'unpaid_handover_%' OR action = 'request_answered' ORDER BY seq")
      .all() as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.action)).toEqual(['unpaid_handover_requested', 'unpaid_handover_answered', 'unpaid_handover_approved']);
    expect(rows[2]).toMatchObject({ subject_type: 'order', subject_id: order_id, approver_staff_id: 'S_MGR', amount_minor: naanPrice() });
  });
});

// ---- 02b-tk L-CLOSE-4: 04 v1.0.9 §3.6, tests 62–64 (02b TK-16) through the real commands ----

describe('[04 #62, #63, #64] unpaid hand-over audit rows', () => {
  it('takeaway and parking requests; approve one, reject the other: requested / answered rows with the original requester, one approved row after its answer, no request_answered; the three action filters; rebuild after alert retention = live', async () => {
    const { createProjectionRegistry } = await import('../../src/projections/registry');
    const { registerHubProjections } = await import('../../src/lib/boot');
    const { ali, managerPhone } = await start();
    const t = takeaway();
    const p = appendOrder(hub, { order_type: 'parking', placed_by: 'S_ALI', lines: [{ order_item_id: `P${++seq}`, item_id: FX.naan }] }).order_id;
    const at = (await ask(ali, t)).result!.alert_id as string;
    const ap = (await ask(ali, p)).result!.alert_id as string;
    expect((await answer(managerPhone, at, 'approve')).status).toBe(200);
    expect((await answer(managerPhone, ap, 'reject')).status).toBe(200);

    type Row = { seq: number; action: string; subject_type: string; subject_id: string; order_id: string | null; actor_staff_id: string | null; approver_staff_id: string | null; method: string | null; outcome: string | null; amount_minor: number | null; detail_json: string };
    const rows = () => hub.deps.db.prepare("SELECT * FROM audit_entries WHERE action LIKE 'unpaid_handover_%' OR action = 'request_answered' ORDER BY seq").all() as Row[];
    const live = rows();
    const of = (action: string) => live.filter((r) => r.action === action);
    // #62: one requested row per named order, the original requester, the alert id, the requested amount
    expect(of('unpaid_handover_requested').map((r) => [r.subject_id, r.order_id, r.actor_staff_id, r.amount_minor, (JSON.parse(r.detail_json) as { alert_id: string }).alert_id])).toEqual([
      [t, t, 'S_ALI', naanPrice(), at],
      [p, p, 'S_ALI', naanPrice(), ap],
    ]);
    // #63: one answered row each, requester as actor, the answerer, method and outcome; never request_answered
    expect(of('unpaid_handover_answered').map((r) => [r.subject_id, r.actor_staff_id, r.approver_staff_id, r.method, r.outcome])).toEqual([
      [t, 'S_ALI', 'S_MGR', 'pin', 'approved'],
      [p, 'S_ALI', 'S_MGR', 'pin', 'rejected'],
    ]);
    expect(of('unpaid_handover_answered').map((r) => JSON.parse(r.detail_json) as Record<string, unknown>)).toEqual([
      expect.objectContaining({ alert_id: at, kind: 'hand_over_unpaid' }),
      expect.objectContaining({ alert_id: ap, kind: 'hand_over_unpaid' }),
    ]);
    expect(of('request_answered')).toEqual([]);
    // #64: exactly one approval row (the approved order), after its answered row; the rejected order has none
    const approved = of('unpaid_handover_approved');
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({ subject_type: 'order', subject_id: t, approver_staff_id: 'S_MGR', amount_minor: naanPrice() });
    expect(JSON.parse(approved[0]!.detail_json)).toMatchObject({ alert_id: at });
    expect(approved[0]!.seq).toBeGreaterThan(of('unpaid_handover_answered')[0]!.seq);
    // the three action filters of GET /queries/audit-log
    for (const [action, count] of [['unpaid_handover_requested', 2], ['unpaid_handover_answered', 2], ['unpaid_handover_approved', 1]] as const) {
      const res = await hub.app.inject({
        method: 'GET',
        url: `/queries/audit-log?from=${hub.clock.branchNow() - 86_400_000}&to=${hub.clock.branchNow() + 1}&action=${action}`,
        headers: { authorization: `Bearer ${managerPhone.token}`, 'x-session-token': managerPhone.sessionToken },
      });
      expect(res.statusCode, res.body).toBe(200);
      const entries = (res.json() as { data: { entries: Array<{ action: string }> } }).data.entries;
      expect(entries.map((e) => e.action)).toEqual(Array.from({ length: count }, () => action));
    }
    // alert retention deletes the source requests from the live alerts projection: a rebuild from seq 0 = live
    const db = hub.deps.db;
    db.pragma('foreign_keys = OFF');
    for (const table of ['alert_receipts', 'alert_seen', 'alert_attempts', 'alerts']) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined) db.prepare(`DELETE FROM ${table}`).run();
    }
    db.pragma('foreign_keys = ON');
    db.prepare("DELETE FROM projection_checkpoints WHERE projection = 'audit'").run();
    const registry = createProjectionRegistry();
    registerHubProjections(registry);
    registry.catchUp(db, 'branch-1');
    expect(rows()).toEqual(live);
  });
});

// BUG-10 (02b v1.0.25 / 01d v1.3.7 §4.3 To 02b R3-M-3, §6.8, test 122): the one-step holders kind never reaches step 2,
// so my-requests' `ask_in_person` is "no other holder can answer now": none of the request's answerers (the requester is
// never one, §3.3 rule 5) has a route — a staff screen socket or a connected bound device, listed devices only for this
// money kind (§3.4.3). Then the requester's card reads "Waiting — find a manager".
describe('[01d §6.8, To 02b R3-M-3; 01d #122] my-requests ask_in_person for hand_over_unpaid', () => {
  const sockets: Array<{ close(): void }> = [];
  afterEach(() => {
    for (const s of sockets.splice(0)) s.close();
  });
  const live = async (who: Who) => {
    const ws = await connectWs(hub.app);
    sockets.push(ws);
    ws.send({ type: 'auth', device_token: who.token, session_token: who.sessionToken });
    await ws.untilCount(1);
  };
  const mine = async (who: Who) => {
    const res = await hub.app.inject({ method: 'GET', url: '/queries/my-requests', headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { requests: Array<{ alert_id: string; state: string; ask_in_person: boolean }> } }).data.requests;
  };

  it('no other holder signed in → true; the Manager signs in on his listed phone → false; he leaves → true again', async () => {
    const { ali, managerPhone } = await start();
    const alert_id = (await ask(ali, takeaway())).result!.alert_id as string;
    expect((await mine(ali)).find((r) => r.alert_id === alert_id)).toMatchObject({ state: 'pending', ask_in_person: true });
    await live(managerPhone);
    expect((await mine(ali)).find((r) => r.alert_id === alert_id)!.ask_in_person).toBe(false);
    for (const s of sockets.splice(0)) s.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await mine(ali)).find((r) => r.alert_id === alert_id)!.ask_in_person).toBe(true);
  });

  it('the requester himself does not count: the Manager asks and is the only holder signed in → true', async () => {
    const { managerPhone } = await start();
    await live(managerPhone);
    const r = await ask(managerPhone, takeaway());
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect((await mine(managerPhone)).find((x) => x.alert_id === r.result!.alert_id)).toMatchObject({ state: 'pending', ask_in_person: true });
  });

  it('a holder signed in only on an everyone kiosk cannot answer a money request → true', async () => {
    const { ali } = await start();
    const kiosk = signIn('S_MGR', { type: 'cashier_kiosk', profile: { access: 'everyone', screens: ['takeaway'] } });
    await live(kiosk);
    const alert_id = (await ask(ali, takeaway())).result!.alert_id as string;
    expect((await mine(ali)).find((r) => r.alert_id === alert_id)!.ask_in_person).toBe(true);
  });
});
