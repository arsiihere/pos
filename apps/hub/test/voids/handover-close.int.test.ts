// ⚠️ 04 v1.0.9 §6.2 (02b run 3 R3-M-3, R3-M-5), L-UNPAID-3 task 2: an approved void that cancels a takeaway / parking
// order closes its pending hand_over_unpaid request obsolete, note order_cancelled, after the void drafts fold and
// outside apply; one result to the requester; a later answer → 409 REQUEST_NOT_PENDING; test 66 (and 67's partial void).
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { TestHub } from '../helpers/test-hub';
import { answer, appendOrder, FX, post, signIn, STAFF, startVoids, takeawayOrder, toStage, type Reply, type Who } from './fixtures';

let hub: TestHub;
afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

async function voidAsk(who: Who, order_id: string, order_item_id: string, units?: number): Promise<string> {
  const reply = await post(hub, who, 'void-items', 'VoidItems', { order_id, reason_code: 'customer_changed_mind', note: null, disposition_note: null, lines: [{ order_item_id, ...(units === undefined ? {} : { units }), disposition: 'wastage' }] });
  expect(reply.status, JSON.stringify(reply.error)).toBe(200);
  return (reply.result as { pending: Array<{ alert_id: string }> }).pending[0]!.alert_id;
}
const db = () => hub.deps.db;
const closesOf = (alert_id: string) =>
  (db().prepare(`SELECT payload FROM events WHERE event_type = 'AlertClosed' AND json_extract(payload, '$.alert_id') = ?`).pluck().all(alert_id) as string[]).map((p) => JSON.parse(p) as { reason: string; note: string | null });
const results = (alert_id: string) =>
  (db().prepare(`SELECT payload FROM events WHERE event_type = 'AlertRaised' AND json_extract(payload, '$.kind') = 'request_result' AND json_extract(payload, '$.values.request_alert_id') = ?`).pluck().all(alert_id) as string[]).length;
const typesOf = (r: Reply): string[] => r.events.map((e) => e.event_type);

describe('[04 #66] an approved void cancelling a takeaway closes its hand_over_unpaid request (order_cancelled)', () => {
  it('one obsolete close after OrderCancelled, one result to the requester, one request_closed audit row; a later answer → 409; nothing duplicated', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const t = takeawayOrder(hub);
    toStage(hub, t.order_id, [t.line], 'cooking');
    const asked = await post(hub, manager, 'request-unpaid-handover', 'RequestUnpaidHandover', { order_id: t.order_id });
    expect(asked.status, JSON.stringify(asked.error)).toBe(200);
    const request = (asked.result as { alert_id: string }).alert_id;

    const voidId = await voidAsk(cashier, t.order_id, t.line);
    const approved = await answer(hub, manager, voidId, 'approve');
    expect(approved.status, JSON.stringify(approved.error)).toBe(200);
    const seqOf = (sql: string, ...args: string[]) => db().prepare(sql).pluck().get(...args) as number;
    const cancelledAt = seqOf(`SELECT seq FROM events WHERE event_type = 'OrderCancelled' AND stream_id = ?`, t.order_id);
    const closedAt = seqOf(`SELECT seq FROM events WHERE event_type = 'AlertClosed' AND json_extract(payload, '$.alert_id') = ?`, request);
    expect(closedAt).toBeGreaterThan(cancelledAt);
    // outside apply: the handler's own drafts (apply's void effects and 01d's answer events) carry no close of it
    expect(approved.events.some((e) => e.event_type === 'AlertClosed' && (e.payload as { alert_id: string }).alert_id === request)).toBe(false);
    expect(closesOf(request)).toEqual([expect.objectContaining({ reason: 'obsolete', note: 'order_cancelled' })]);
    expect(results(request)).toBe(1);
    const audit = db().prepare(`SELECT COUNT(*) FROM audit_entries WHERE action = 'request_closed' AND json_extract(detail_json, '$.alert_id') = ?`).pluck().get(request);
    expect(audit).toBe(1);

    const late = await answer(hub, manager, request, 'approve');
    expect([late.status, late.error?.code]).toEqual([409, 'REQUEST_NOT_PENDING']);
    const again = await answer(hub, manager, voidId, 'approve');
    expect(again.status).toBe(409);
    expect(closesOf(request)).toHaveLength(1);
    expect(results(request)).toBe(1);
  });

  it('[04 #67] a partial approved void (the order stays) does not cancel: the request closes due_changed through §6.19, once', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const manager = signIn(hub, STAFF.manager);
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'P1', item_id: FX.naan }, { order_item_id: 'P2', item_id: FX.naan }] });
    toStage(hub, order_id, ['P1', 'P2'], 'cooking');
    const request = ((await post(hub, manager, 'request-unpaid-handover', 'RequestUnpaidHandover', { order_id })).result as { alert_id: string }).alert_id;
    const voidId = await voidAsk(cashier, order_id, 'P1');
    const approved = await answer(hub, manager, voidId, 'approve');
    expect(approved.status, JSON.stringify(approved.error)).toBe(200);
    expect(typesOf(approved)).not.toContain('OrderCancelled');
    expect(db().prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'OpenOrderBillChanged'`).pluck().get()).toBe(1);
    expect(closesOf(request)).toEqual([expect.objectContaining({ reason: 'obsolete', note: 'due_changed' })]);
    expect(results(request)).toBe(1);
  });
});
