// ⚠️ 02b v1.0.25 §6.19 OpenOrderBillChanged (run 3 R3-M-8; D2, D3), L-UNPAID-3 task 1: the money changes outside
// billing — line weight, removal, void, an addition (SubmitOrder adds_to_order_id), comp — append one batched
// OpenOrderBillChanged with the same clear rule as billing's hook; a stale open request closes due_changed. Test 92.
import type { DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, openDay, openSeating } from './fixtures';

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
  const perms = ['take-order', 'mark-served'].map((p) => grant(p));
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
}

let seq = 0;
async function ok(path: string, command_type: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  seq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: { authorization: `Bearer ${ali.token}`, 'x-session-token': ali.sessionToken },
    payload: { command_id: `oo-${seq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type, payload, occurred_at: hub.clock.branchNow(), actor_id: ali.staffId, device_id: ali.deviceId },
  });
  expect(res.statusCode, `${command_type} ${res.body}`).toBe(200);
  return (res.json() as { data: { result: Record<string, unknown> } }).data.result;
}
const send = (order_id: string, lines: Array<{ id: string; item_id: string; quantity?: number }>, o: { adds_to_order_id?: string; seating_id?: string } = {}) =>
  ok('submit-order', 'SubmitOrder', {
    order_id,
    ...(o.seating_id === undefined ? { order_type: 'takeaway' } : { order_type: 'dine_in', table_id: FX.table, seating_id: o.seating_id }),
    lines: lines.map((l) => ({ order_item_id: l.id, item_id: l.item_id, ...(l.item_id === FX.gram ? {} : { quantity: l.quantity ?? 1 }) })),
    ...(o.adds_to_order_id === undefined ? {} : { adds_to_order_id: o.adds_to_order_id }),
  });

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
  const { keyBalances } = await import('../../src/billing/queries/key-balances');
  const key = db().prepare('SELECT bill_key FROM orders WHERE order_id = ?').pluck().get(order_id) as string;
  return keyBalances(db(), [key]).get(key)?.due_minor ?? 0;
};
const naanPrice = (): number => (JSON.parse(db().prepare(`SELECT payload FROM events WHERE event_type = 'ItemAdded' AND json_extract(payload, '$.item_id') = ? LIMIT 1`).pluck().get(FX.naan) as string) as { price_minor: number }).price_minor;

describe('[02b §6.19, #92] OpenOrderBillChanged for money changes outside billing (R3-M-8)', () => {
  it('a plain takeaway Send appends none; an addition (adds_to_order_id) appends one naming the key’s orders and clears the root’s approval its due now exceeds', async () => {
    await start();
    await send('O1', [{ id: 'A', item_id: FX.naan }]);
    expect(changed()).toEqual([]);
    approve('O1', await due('O1'));
    await send('O2', [{ id: 'B', item_id: FX.naan }], { adds_to_order_id: 'O1' });
    expect(changed()).toEqual([{ stream_id: 'O1', order_ids: ['O1', 'O2'], approval_cleared_order_ids: ['O1'] }]);
    expect(approval('O1')).toEqual({ at: null, due: null });
  });

  it('a removal lowers the due: one event, the approval kept; a dine-in removal appends none', async () => {
    await start();
    await send('O1', [{ id: 'A', item_id: FX.naan }, { id: 'B', item_id: FX.naan }]);
    approve('O1', await due('O1'));
    await ok('remove-items', 'RemoveItems', { order_id: 'O1', lines: [{ order_item_id: 'B' }] });
    expect(changed()).toEqual([{ stream_id: 'O1', order_ids: ['O1'], approval_cleared_order_ids: [] }]);
    expect(approval('O1').at).not.toBeNull();

    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    await send('D1', [{ id: 'D_A', item_id: FX.naan }, { id: 'D_B', item_id: FX.naan }], { seating_id: 'SEAT1' });
    await ok('remove-items', 'RemoveItems', { order_id: 'D1', seating_id: 'SEAT1', lines: [{ order_item_id: 'D_B' }] });
    expect(changed()).toHaveLength(1);
  });

  it('a weight set raises the due above the approval → cleared; a void and a comp lower it → kept; one event per transaction', async () => {
    await start();
    await send('O1', [{ id: 'A', item_id: FX.naan }, { id: 'F', item_id: FX.gram }, { id: 'C', item_id: FX.naan }]);
    approve('O1', await due('O1'));
    append({ stream_type: 'order', stream_id: 'O1', event_type: 'LineWeightSet', payload: { order_item_id: 'F', quantity: 500, line_total_minor: 90_000 } });
    expect(changed().at(-1)).toEqual({ stream_id: 'O1', order_ids: ['O1'], approval_cleared_order_ids: ['O1'] });

    approve('O1', await due('O1'));
    const price = naanPrice();
    append(
      { stream_type: 'order', stream_id: 'O1', event_type: 'ItemVoided', payload: { order_item_id: 'A', units: 1, refund_minor: 0, comp_voided_minor: 0 } },
      { stream_type: 'order', stream_id: 'O1', event_type: 'LineComped', payload: { order_item_id: 'C', units: 1, value_minor: price, reason_code: 'quality', note: null, requester_staff_id: 'S_MGR', alert_id: null, approver_staff_id: null } },
    );
    expect(changed()).toHaveLength(2);
    expect(changed().at(-1)).toMatchObject({ approval_cleared_order_ids: [] });
    expect(approval('O1').at).not.toBeNull();
  });

  it('an open request whose amount changed closes obsolete, note due_changed; an unchanged one stays open', async () => {
    await start();
    await send('O1', [{ id: 'A', item_id: FX.naan }, { id: 'B', item_id: FX.naan }]);
    await send('O9', [{ id: 'Z', item_id: FX.naan }]);
    const asked = await ok('request-unpaid-handover', 'RequestUnpaidHandover', { order_id: 'O1' });
    const other = await ok('request-unpaid-handover', 'RequestUnpaidHandover', { order_id: 'O9' });
    await ok('remove-items', 'RemoveItems', { order_id: 'O1', lines: [{ order_item_id: 'B' }] });
    const state = (id: unknown) => db().prepare('SELECT state, close_reason FROM alerts WHERE alert_id = ?').get(id as string);
    expect(state(asked.alert_id)).toEqual({ state: 'closed', close_reason: 'obsolete' });
    expect(state(other.alert_id)).toEqual({ state: 'open', close_reason: null });
    const note = db().prepare(`SELECT json_extract(payload, '$.note') FROM events WHERE event_type = 'AlertClosed' AND json_extract(payload, '$.alert_id') = ?`).pluck().get(asked.alert_id as string);
    expect(note).toBe('due_changed');
  });

  it('a cancellation closes the request order_cancelled (that close wins; no due_changed close)', async () => {
    await start();
    await send('O1', [{ id: 'A', item_id: FX.naan }]);
    const asked = await ok('request-unpaid-handover', 'RequestUnpaidHandover', { order_id: 'O1' });
    await ok('remove-items', 'RemoveItems', { order_id: 'O1', lines: [{ order_item_id: 'A' }] });
    const notes = db().prepare(`SELECT json_extract(payload, '$.note') FROM events WHERE event_type = 'AlertClosed' AND json_extract(payload, '$.alert_id') = ?`).pluck().all(asked.alert_id as string);
    expect(notes).toEqual(['order_cancelled']);
  });
});
