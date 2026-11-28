// ⚠️ 02b v1.0.25 §3.7a Close (a), (b), §6.4, §4.2 (run 3 R3-M-3; OR-7), U-3 (02b parts): tests 91 (MarkServed
// handed_over, RemoveItems order_cancelled) and 88 (an answer after cancellation → 409 REQUEST_NOT_PENDING obsolete).
import type { DirectoryInput, PosEvent } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory, PIN } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
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
const approval = (order_id: string) => hub.deps.db.prepare('SELECT unpaid_handover_approved_at AS at, unpaid_handover_approved_due_minor AS due FROM orders WHERE order_id = ?').get(order_id) as { at: number | null; due: number | null };
const eventsOf = (type: string): PosEvent[] =>
  (hub.deps.db.prepare('SELECT event_type, schema_version, stream_id, payload FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<{ event_type: string; schema_version: number; stream_id: string; payload: string }>).map(
    (r) => ({ ...r, payload: JSON.parse(r.payload) }) as unknown as PosEvent,
  );
const alertRow = (alert_id: string) => hub.deps.db.prepare('SELECT state, close_reason FROM alerts WHERE alert_id = ?').get(alert_id) as { state: string; close_reason: string | null };
const closes = () => eventsOf('AlertClosed').map((e) => e.payload as { alert_id: string; reason: string; note: string | null });
const fire = (...order_item_ids: string[]) =>
  append(hub, [{ stream_type: 'station', stream_id: FX.station, event_type: 'FireDispatched', payload: { station_id: FX.station, order_item_ids, load_id: null, due_at: hub.clock.branchNow(), reason: 'pulled' } }]);
const serve = (who: Who, lines: Array<{ order_id: string; order_item_ids: string[] }>) => post(who, 'mark-served', 'MarkServed', { lines });
const remove = (who: Who, order_id: string, ids: string[]) => post(who, 'remove-items', 'RemoveItems', { order_id, lines: ids.map((order_item_id) => ({ order_item_id })) });

describe('[02b #91] the open request closes when the order is handed over or cancelled', () => {
  it('an ordinary MarkServed of the last live line → one obsolete close, note handed_over, and request_result to the requester; a partial serve leaves it open', async () => {
    const { ali, sara } = await start();
    const order_id = takeaway([{ order_item_id: 'H1', item_id: FX.naan }, { order_item_id: 'H2', item_id: FX.naan }]);
    fire('H1', 'H2');
    const alert_id = (await ask(ali, order_id)).result!.alert_id as string;
    expect((await serve(sara, [{ order_id, order_item_ids: ['H1'] }])).status).toBe(200);
    expect(alertRow(alert_id).state).toBe('open');
    const r = await serve(sara, [{ order_id, order_item_ids: ['H2'] }]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(alertRow(alert_id)).toEqual({ state: 'closed', close_reason: 'obsolete' });
    expect(closes().filter((c) => c.alert_id === alert_id)).toEqual([expect.objectContaining({ reason: 'obsolete', note: 'handed_over' })]);
    const result = eventsOf('AlertRaised').filter((e) => (e.payload as { kind: string }).kind === 'request_result').at(-1)!;
    expect(result.payload).toMatchObject({ values: { request_alert_id: alert_id, request_kind: 'hand_over_unpaid', close_reason: 'obsolete' } });
  });

  it('⚠️ 02b v1.0.27 (owner 2026-11-28 Q9): the bill\'s one request covers the sibling too — serving the sibling closes it (handed_over); the root asks again and gets a new request for what is left', async () => {
    const { ali } = await start();
    const order_id = takeaway([{ order_item_id: 'H1', item_id: FX.naan }]);
    const sibling = takeaway([{ order_item_id: 'S1', item_id: FX.naan }], { adds_to_order_id: order_id });
    fire('H1', 'S1');
    const alert_id = (await ask(ali, order_id)).result!.alert_id as string;
    expect((await serve(ali, [{ order_id: sibling, order_item_ids: ['S1'] }])).status).toBe(200);
    expect(alertRow(alert_id)).toEqual({ state: 'closed', close_reason: 'obsolete' });
    expect(closes().filter((c) => c.alert_id === alert_id)).toEqual([expect.objectContaining({ note: 'handed_over' })]);
    const again = (await ask(ali, order_id)).result!.alert_id as string;
    expect(again).not.toBe(alert_id);
  });

  it('RemoveItems cancelling the order → one obsolete close, note order_cancelled; a later answer → 409 REQUEST_NOT_PENDING close_reason obsolete, no approval [#88]', async () => {
    const { ali, managerPhone } = await start();
    const order_id = takeaway([{ order_item_id: 'R1', item_id: FX.naan }]);
    const alert_id = (await ask(ali, order_id)).result!.alert_id as string;
    const r = await remove(ali, order_id, ['R1']);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(eventsOf('OrderCancelled').map((e) => e.stream_id)).toEqual([order_id]);
    expect(closes().filter((c) => c.alert_id === alert_id)).toEqual([expect.objectContaining({ reason: 'obsolete', note: 'order_cancelled' })]);
    const late = await answer(managerPhone, alert_id, 'approve');
    expect(late).toMatchObject({ status: 409, error: { code: 'REQUEST_NOT_PENDING', details: { close_reason: 'obsolete' } } });
    expect(eventsOf('UnpaidHandoverApproved')).toEqual([]);
    expect(approval(order_id)).toEqual({ at: null, due: null });
  });

  it('a RemoveItems that leaves a live line does not cancel: the request closes due_changed (its amount changed, §6.19), not order_cancelled', async () => {
    const { ali } = await start();
    const order_id = takeaway([{ order_item_id: 'R1', item_id: FX.naan }, { order_item_id: 'R2', item_id: FX.naan }]);
    const alert_id = (await ask(ali, order_id)).result!.alert_id as string;
    expect((await remove(ali, order_id, ['R1'])).status).toBe(200);
    expect(closes().filter((c) => c.alert_id === alert_id)).toEqual([expect.objectContaining({ reason: 'obsolete', note: 'due_changed' })]);
  });
});
