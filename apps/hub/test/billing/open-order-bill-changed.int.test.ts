// ⚠️ 02b v1.0.25 §6.19 OpenOrderBillChanged (run 3 R3-M-2, R3-M-5, R3-M-8; D2, D3), §3.7a, L-BILL-2: the batched append
// in billing's money-changing commands, the decided approval clears and the due_changed close; test 92 (lifetime cases).
// Real commands over HTTP (SubmitOrder, OpenShift, AddPayment, RemovePayment, CloseSplit, ReopenBill, MarkServed).
import type { DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { seenDue } from '../voids/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { COMP_REMOVE_REASONS } from '@pos/domain';
import { FX, openDay, openSeating } from '../orders/fixtures';

const REMOVE_REASON = COMP_REMOVE_REASONS[0];

let hub: TestHub;
afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

const grant = (permission: string) => ({ permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [] as string[], scope: 'branch' as const });
async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, role_id: string) => ({ staff_id, display_name: staff_id, pin_hash: pin, role_ids: [role_id], denied_permissions: [], lead_staff_id: null, floor_ids: [] });
  const perms = ['take-payment', 'take-order', 'manage-own-shift', 'mark-served', 'reopen-bill'].map((p) => grant(p));
  return { ...base, roles: [...base.roles, { role_id: 'R_ALL', name: 'R_ALL', session_idle_ttl_ms: 36_000_000, permissions: perms }], staff: [...base.staff, person('S_ALI', 'R_ALL')] };
}

interface Who { staffId: string; deviceId: string; token: string; sessionToken: string }
let ali: Who;
async function start(): Promise<void> {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  openDay(hub);
  const d = pairDevice(hub, { type: 'tablet' });
  const s = openSession(hub, { kind: 'staff', staffId: 'S_ALI', deviceId: d.deviceId });
  ali = { staffId: 'S_ALI', deviceId: d.deviceId, token: d.token, sessionToken: s.token };
  const shift = await post('open-shift', 'OpenShift', { float_minor: 0, as_drawer: false });
  expect(shift.status, JSON.stringify(shift.error)).toBe(200);
}

let seq = 0;
async function post(path: string, command_type: string, payload: Record<string, unknown>) {
  // ⚠️ 05 v1.0.37 §6.9 (R2-1): a payment carries the due the bill shows, as a client sends it
  if (command_type === 'AddPayment' && !('expected_due_minor' in payload)) payload = { ...payload, expected_due_minor: await seenDue(hub, ali as Parameters<typeof seenDue>[1], payload) };
  seq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: { authorization: `Bearer ${ali.token}`, 'x-session-token': ali.sessionToken },
    payload: { command_id: `ob-${seq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type, payload, occurred_at: hub.clock.branchNow(), actor_id: ali.staffId, device_id: ali.deviceId },
  });
  const body = res.json() as { data?: { result: Record<string, unknown> }; error?: { code: string; details: Record<string, unknown> } };
  return { status: res.statusCode, result: body.data?.result, error: body.error };
}
async function ok(path: string, command_type: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await post(path, command_type, payload);
  expect(r.status, `${command_type} ${JSON.stringify(r.error)}`).toBe(200);
  return r.result!;
}
const send = (order_id: string, n = 1, o: { adds_to_order_id?: string; seating_id?: string } = {}) =>
  ok('submit-order', 'SubmitOrder', {
    order_id,
    ...(o.seating_id === undefined ? { order_type: 'takeaway' } : { order_type: 'dine_in', table_id: FX.table, seating_id: o.seating_id }),
    lines: [{ order_item_id: `${order_id}_N`, item_id: FX.naan, quantity: n }],
    ...(o.adds_to_order_id === undefined ? {} : { adds_to_order_id: o.adds_to_order_id }),
  });
const pay = async (order_id: string, amount_minor: number): Promise<string> =>
  (await ok('add-payment', 'AddPayment', { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor, tendered_minor: amount_minor })).payment_id as string;
const unpay = (payment_id: string) => ok('remove-payment', 'RemovePayment', { payment_id, reason_code: 'wrong_mode' });

function append(...drafts: Array<Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id' | 'schema_version'>>): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) => tx.append(drafts.map((d) => ({ ...d, schema_version: 1, occurred_at: now, actor_id: 'S_MGR', device_id: 'D_SEED' }))));
}
const approve = (order_id: string, due_minor: number) =>
  append({ stream_type: 'order', stream_id: order_id, event_type: 'UnpaidHandoverApproved', payload: { order_id, alert_id: `AL-${order_id}-${due_minor}`, approved_by_staff_id: 'S_MGR', due_minor } });

const db = () => hub.deps.db;
const changed = () =>
  (db().prepare(`SELECT stream_id, payload FROM events WHERE event_type = 'OpenOrderBillChanged' ORDER BY seq`).all() as Array<{ stream_id: string; payload: string }>).map((r) => ({ stream_id: r.stream_id, ...(JSON.parse(r.payload) as { order_ids: string[]; approval_cleared_order_ids: string[] }) }));
const approval = (order_id: string) => db().prepare('SELECT unpaid_handover_approved_at AS at, unpaid_handover_approved_due_minor AS due FROM orders WHERE order_id = ?').get(order_id) as { at: number | null; due: number | null };
const due = async (order_id: string): Promise<number> => {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/bill?order_id=${order_id}`, headers: { authorization: `Bearer ${ali.token}`, 'x-session-token': ali.sessionToken } });
  const v = (res.json() as { data: { splits: Array<{ state: string; balance_minor: number }> } }).data;
  return v.splits.filter((s) => s.state === 'open').reduce((a, s) => a + s.balance_minor, 0);
};

describe('[02b §6.19] OpenOrderBillChanged after a billing money change (R3-M-8)', () => {
  it('a payment on a token appends one batched event naming every live order of the key, after the money event; a dine-in payment appends none', async () => {
    await start();
    await send('O1');
    await send('O2', 1, { adds_to_order_id: 'O1' });
    await pay('O1', 100);
    // the addition appends its own (orders/open-order-bill.ts, L-UNPAID-3); the payment's is the last one
    expect(changed()).toHaveLength(2);
    expect(changed().at(-1)).toEqual({ stream_id: 'O1', order_ids: ['O1', 'O2'], approval_cleared_order_ids: [] });
    const types = (db().prepare(`SELECT event_type FROM events WHERE seq > (SELECT MAX(seq) FROM events WHERE event_type = 'PaymentAdded') - 1 ORDER BY seq`).pluck().all() as string[]);
    expect(types.indexOf('PaymentAdded')).toBeLessThan(types.indexOf('OpenOrderBillChanged'));

    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    await send('D1', 1, { seating_id: 'SEAT1' });
    await pay('D1', 100);
    expect(changed()).toHaveLength(2);
  });
});

describe('[02b #92] approval lifetime (D2, D3)', () => {
  it('a due raised above the approved amount (payment removed) clears it in the event; lowering it again → still not approved; a same-or-lower due keeps it', async () => {
    await start();
    await send('O1', 2);
    const p = await pay('O1', 100);
    const lowered = await due('O1');
    approve('O1', lowered);
    const p2 = await pay('O1', 50); // lower: kept
    expect(changed().at(-1)).toMatchObject({ approval_cleared_order_ids: [] });
    expect(approval('O1').at).not.toBeNull();
    await unpay(p2); // back to the approved amount: kept
    expect(approval('O1').at).not.toBeNull();
    await unpay(p); // above it, with live unserved lines: cleared
    expect(changed().at(-1)).toMatchObject({ order_ids: ['O1'], approval_cleared_order_ids: ['O1'] });
    expect(approval('O1')).toEqual({ at: null, due: null });
    await pay('O1', 100); // lowered again
    expect(approval('O1')).toEqual({ at: null, due: null });
  });

  it('a raised due on an order with no live unserved line keeps the record (nothing left to hand over)', async () => {
    await start();
    await send('O1');
    const p = await pay('O1', 100);
    approve('O1', await due('O1'));
    append({ stream_type: 'station', stream_id: FX.station, event_type: 'FireDispatched', payload: { station_id: FX.station, order_item_ids: ['O1_N'], load_id: null, due_at: hub.clock.branchNow(), reason: 'pulled' } });
    await ok('mark-served', 'MarkServed', { lines: [{ order_id: 'O1', order_item_ids: ['O1_N'] }] });
    await unpay(p);
    expect(changed().at(-1)).toMatchObject({ approval_cleared_order_ids: [] });
    expect(approval('O1').at).not.toBeNull();
  });

  it('approve, pay in full without collecting, close, reopen with a positive due → not approved', async () => {
    await start();
    await send('O1');
    const total = await due('O1');
    approve('O1', total);
    await pay('O1', total);
    await ok('close-split', 'CloseSplit', { bill_ref: { order_id: 'O1' }, split_no: 1, expected_total_minor: total });
    const bill_id = db().prepare(`SELECT bill_id FROM bills WHERE state = 'closed'`).pluck().get() as string;
    expect(approval('O1')).toEqual({ at: null, due: null }); // OrdersBilled cleared it
    approve('O1', total); // a stale approval row cannot survive the reopen either
    await ok('reopen-bill', 'ReopenBill', { bill_id, reason_code: 'wrong_item_billed' });
    expect(approval('O1')).toEqual({ at: null, due: null });
  });

  it('each sibling needs its own approval: approving one order of the token leaves the other unapproved through the change', async () => {
    await start();
    await send('O1');
    await send('O2', 1, { adds_to_order_id: 'O1' });
    approve('O1', await due('O1'));
    await pay('O1', 100);
    expect(approval('O1').at).not.toBeNull();
    expect(approval('O2')).toEqual({ at: null, due: null });
  });
});

describe('[02b §6.19, #92] an open request whose amount changed closes due_changed', () => {
  it('a non-payment change (a comp removed: the due rises) → the open request closes obsolete, note due_changed; a later ask gets a fresh amount and id', async () => {
    await start();
    await send('O1', 2);
    const unit = (await due('O1')) / 2;
    append({ stream_type: 'order', stream_id: 'O1', event_type: 'LineComped', payload: { order_item_id: 'O1_N', units: 1, value_minor: unit, reason_code: 'quality', note: null, requester_staff_id: 'S_MGR', alert_id: null, approver_staff_id: null } });
    const first = await ok('request-unpaid-handover', 'RequestUnpaidHandover', { order_id: 'O1' });
    append({ stream_type: 'order', stream_id: 'O1', event_type: 'LineCompRemoved', payload: { order_item_id: 'O1_N', units: 1, comp_minor: unit, reason_code: REMOVE_REASON, has_note: false, note_id: null, requester_staff_id: 'S_MGR', approver_staff_id: null, alert_id: null } });
    expect(changed().at(-1)).toMatchObject({ order_ids: ['O1'] });
    expect(db().prepare('SELECT state, close_reason FROM alerts WHERE alert_id = ?').get(first.alert_id as string)).toEqual({ state: 'closed', close_reason: 'obsolete' });
    const close = db().prepare(`SELECT payload FROM events WHERE event_type = 'AlertClosed' ORDER BY seq DESC LIMIT 1`).pluck().get() as string;
    expect(JSON.parse(close)).toMatchObject({ alert_id: first.alert_id, reason: 'obsolete', note: 'due_changed' });
    const again = await ok('request-unpaid-handover', 'RequestUnpaidHandover', { order_id: 'O1' });
    expect(again.alert_id).not.toBe(first.alert_id);
    const values = JSON.parse(db().prepare('SELECT values_json FROM alerts WHERE alert_id = ?').pluck().get(again.alert_id as string) as string) as { due_minor: number };
    expect(values.due_minor).toBe(await due('O1'));
  });

  it('⚠️ owner ruling 2026-11-27: a payment alone leaves the open request open (tests 91, #60j: the last close closes it bill_closed)', async () => {
    await start();
    await send('O1', 2);
    const first = await ok('request-unpaid-handover', 'RequestUnpaidHandover', { order_id: 'O1' });
    await pay('O1', 100);
    expect(changed()).toHaveLength(1);
    expect(db().prepare('SELECT state FROM alerts WHERE alert_id = ?').pluck().get(first.alert_id as string)).toBe('open');
  });
});
