// ⚠️ 02b v1.0.25 §6.16 (run 3 R3-M-8; plan U-1), L-UNPAID-3: open-orders rows carry `unpaid_handover_approved`: true
// only on an open, unbilled takeaway / parking row with an effective approval and a positive current due no higher than
// the approved amount; dine-in false; statements unchanged (the approval columns ride the orders read, the due is the
// existing batched keyBalances).
import type { DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, openDay } from './fixtures';

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
const due = async (order_id: string): Promise<number> => {
  const { keyBalances } = await import('../../src/billing/queries/key-balances');
  const key = db().prepare('SELECT bill_key FROM orders WHERE order_id = ?').pluck().get(order_id) as string;
  return keyBalances(db(), [key]).get(key)?.due_minor ?? 0;
};
const naanPrice = (): number => (JSON.parse(db().prepare(`SELECT payload FROM events WHERE event_type = 'ItemAdded' AND json_extract(payload, '$.item_id') = ? LIMIT 1`).pluck().get(FX.naan) as string) as { price_minor: number }).price_minor;

type Row = { order_id: string; unpaid_handover_approved: boolean };
async function rows(qs = 'order_type=all'): Promise<Map<string, boolean>> {
  const res = await hub.app.inject({ method: 'GET', url: `/queries/open-orders?${qs}`, headers: { authorization: `Bearer ${ali.token}`, 'x-session-token': ali.sessionToken } });
  expect(res.statusCode, res.body).toBe(200);
  return new Map((res.json() as { data: { orders: Row[] } }).data.orders.map((o) => [o.order_id, o.unpaid_handover_approved]));
}

describe('[02b §6.16, #87] open-orders unpaid_handover_approved', () => {
  it('false without approval; true with an effective one at the current due; false once the due exceeds it or is paid down to 0 by comp; statements unchanged', async () => {
    await start();
    await send('O1', [{ id: 'A', item_id: FX.naan }]);
    await send('O2', [{ id: 'B', item_id: FX.naan }]);
    const counter = statementCounter(db());
    const c0 = counter.count;
    await rows();
    const before = counter.count - c0;
    expect([...(await rows())]).toEqual([['O1', false], ['O2', false]]);
    approve('O1', await due('O1'));
    approve('O2', (await due('O2')) - 1);
    const n0 = counter.count;
    const now = await rows();
    expect(counter.count - n0).toBe(before);
    expect(now.get('O1')).toBe(true);
    expect(now.get('O2')).toBe(false); // the stored amount is below the current due: not effective
    append({ stream_type: 'order', stream_id: 'O1', event_type: 'LineComped', payload: { order_item_id: 'A', units: 1, value_minor: naanPrice(), reason_code: 'quality', note: null, requester_staff_id: 'S_MGR', alert_id: null, approver_staff_id: null } });
    expect((await rows()).get('O1')).toBe(false); // no positive due: nothing to approve
  });

  it('a billed (paid) takeaway row carries false, whatever its stored approval', async () => {
    await start();
    await send('O1', [{ id: 'A', item_id: FX.naan }]);
    approve('O1', await due('O1'));
    append({ stream_type: 'order', stream_id: 'O1', event_type: 'OrdersBilled', payload: { order_ids: ['O1'], bill_id: 'BL1' } });
    approve('O1', 1_000_000);
    expect((await rows()).get('O1')).toBe(false);
  });
});
