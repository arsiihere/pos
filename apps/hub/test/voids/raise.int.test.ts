// 04 §3.5 / §6.1 step 7 (task v6), §10 tests 20, 20b, 28, 29, 29b: VoidItems with grant `requires_approval` (the
// Cashier of voidsDirectory) raises one `void_approval` request per entry through 01d's real raiseMany.
import type { EngineState } from '@pos/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import type { CommandCtx } from '../../src/commands/registry';
import { COMP_KIND } from '../../src/orders/line-change';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { VOID_APPROVAL, VoidDetails } from '../../src/voids/kind';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { voidItemsCommand } from '../../src/voids/commands/void-items';
import { statementCounter } from '../helpers/statement-counter';
import type { TestHub } from '../helpers/test-hub';
import {
  dealX2,
  longLabelSeating,
  mergedSeating,
  parkingOrder,
  post,
  signIn,
  STAFF,
  stagedOrder,
  startVoids,
  takeawayOrder,
  tieMerge,
  toStage,
  voidsDirectory,
  VX,
  type Reply,
  type Who,
} from './fixtures';

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const state = (): EngineState => hub.deps.state.get();
const events = (): number => hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
const ofType = (r: Reply, t: string) => r.events.filter((e) => e.event_type === t);
type Line = { order_item_id: string; units?: number; disposition: 'moved' | 'wastage' | 'staff_meal' | 'other' };
function voidItems(who: Who, order_id: string, lines: Line[], o: { reason_code?: string; note?: string | null } = {}): Promise<Reply> {
  return post(hub, who, 'void-items', 'VoidItems', { order_id, reason_code: o.reason_code ?? 'customer_changed_mind', note: o.note ?? null, disposition_note: null, lines });
}
const raisedOf = (r: Reply) => ofType(r, 'AlertRaised').map((e) => e.payload as { alert_id: string; kind: string; values: Record<string, unknown>; details: Record<string, unknown>; display: Record<string, unknown>; dedupe_key: string; silent?: boolean });
const stored = (alert_id: string) => hub.deps.db.prepare('SELECT details_json, values_json, state FROM alerts WHERE alert_id = ?').get(alert_id) as { details_json: string; values_json: string; state: string };

describe('[04 §3.5, §6.1 step 7] the raise path', () => {
  it('[04 #20] one AlertRaised per entry: values / details / display as §3.5, labels, not silent, no ItemVoided; result pending', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const s = stagedOrder(hub);
    const r = await voidItems(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'moved' }], { reason_code: 'quality' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(ofType(r, 'ItemVoided')).toEqual([]);
    expect(ofType(r, 'ItemMovedToStock')).toEqual([]);
    const [a] = raisedOf(r);
    expect(a).toMatchObject({ kind: 'void_approval', dedupe_key: `void:${s.cooking}` });
    expect(a!.values).toEqual({
      order_id: s.order_id,
      order_item_id: s.cooking,
      units: 1,
      reason_code: 'quality',
      note: null,
      disposition: 'moved',
      disposition_note: null,
      touched_ids: [s.cooking],
      line_dispositions: { [s.cooking]: 'moved' },
      refund_minor: 120_000,
      comp_voided_minor: 0,
    });
    expect(a!.details).toEqual({ item: 'Chicken Karahi', quantity: 1, amount: 120_000, reason: 'quality', identifier: expect.stringMatching(/^#\d+$/) as string, disposition: 'void.disposition.moved', lines: [{ name: 'Chicken Karahi', quantity: 1, state: 'cooking' }] });
    expect(a!.display).toEqual({ kind_label_key: 'alert.void_approval.lock', table_code: null, requester_name: expect.any(String) as string });
    expect(r.result).toEqual({ pending: [{ order_item_id: s.cooking, alert_id: a!.alert_id }] });
    // D-3: the stored details keep `disposition`
    expect(JSON.parse(stored(a!.alert_id).details_json)).toMatchObject({ disposition: 'void.disposition.moved' });
    expect(VOID_APPROVAL).toMatchObject({ silent: false, labels: { card: 'alert.void_approval.card', lock: 'alert.void_approval.lock' }, family: 'urgent' });
  });

  it('[04 #20] identifiers: takeaway #<token> + table_code null; parking; T4 + T5; tie merge; > 40 chars sliced to 40 and still raised', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const first = (r: Reply) => raisedOf(r)[0]!;
    const t = takeawayOrder(hub);
    toStage(hub, t.order_id, [t.line], 'cooking');
    const rt = first(await voidItems(cashier, t.order_id, [{ order_item_id: t.line, disposition: 'wastage' }]));
    expect([rt.details.identifier, rt.display.table_code]).toEqual([`#${t.token}`, null]);
    const p = parkingOrder(hub);
    toStage(hub, p.order_id, [p.line], 'cooking');
    expect(first(await voidItems(cashier, p.order_id, [{ order_item_id: p.line, disposition: 'wastage' }])).details.identifier).toBe('PARKING LEB 1234 SEDAN');
    const m = mergedSeating(hub);
    toStage(hub, m.order_ids[1]!, ['MG_T5_N'], 'cooking');
    const rm = first(await voidItems(cashier, m.order_ids[1]!, [{ order_item_id: 'MG_T5_N', disposition: 'wastage' }]));
    expect([rm.details.identifier, rm.display.table_code]).toEqual(['T4 + T5', 'T4']);
    const tm = tieMerge(hub);
    toStage(hub, tm.order_id, ['TM_T6_N'], 'cooking');
    expect(first(await voidItems(cashier, tm.order_id, [{ order_item_id: 'TM_T6_N', disposition: 'wastage' }])).details.identifier).toBe('T6 + T7 + T8');
    const ll = longLabelSeating(hub);
    toStage(hub, ll.order_id, ['LL_G1_N'], 'cooking');
    const rl = await voidItems(cashier, ll.order_id, [{ order_item_id: 'LL_G1_N', disposition: 'wastage' }]);
    expect(rl.status, JSON.stringify(rl.error)).toBe(200);
    expect(first(rl).details.identifier).toBe(ll.label.slice(0, 40));
  });

  it('[04 #20] deal wastage → void.disposition.wastage; OQ-C deal moved → moved_partly; lines with their states; a 200+ char note → reason sliced to 200', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const w = raisedOf(await voidItems(cashier, d.order_id, [{ order_item_id: d.deal, units: 1, disposition: 'wastage' }]))[0]!;
    expect(w.details).toMatchObject({ item: 'Karahi combo', quantity: 1, disposition: 'void.disposition.wastage' });
    expect(w.details.lines).toEqual([
      { name: 'Karahi combo', quantity: 1, state: 'not_started' },
      { name: 'Chicken Karahi', quantity: 1, state: 'cooking' },
      { name: 'Naan', quantity: 2, state: 'not_started' },
    ]);
    const e = dealX2(hub, { prefix: 'DM' });
    toStage(hub, e.order_id, [e.karahiPart], 'cooking');
    const long = 'x'.repeat(200);
    const m = await voidItems(cashier, e.order_id, [{ order_item_id: e.deal, units: 1, disposition: 'moved' }], { reason_code: 'other', note: long });
    expect(m.status, JSON.stringify(m.error)).toBe(200);
    const mr = raisedOf(m)[0]!;
    expect(mr.values.line_dispositions).toEqual({ [e.deal]: null, [e.karahiPart]: 'moved', [e.naanPart]: null });
    expect(mr.details.disposition).toBe('void.disposition.moved_partly');
    expect(mr.details.reason).toBe(`other: ${long}`.slice(0, 200));
    expect(mr.details.amount).toBe(mr.values.refund_minor);
  });

  it('[04 #20b] void-item requires_approval + move-item-to-stock allowed + moved → a request, nothing applied (V4)', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const s = stagedOrder(hub);
    const before = state().lines[s.cooking];
    const r = await voidItems(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'moved' }]);
    expect(r.status).toBe(200);
    // only 01d's request events (alert stream); nothing on the order or the stock
    expect(r.events.filter((e) => e.event_type.startsWith('Item') || e.event_type.startsWith('Stock') || e.event_type.startsWith('Order'))).toEqual([]);
    expect(raisedOf(r)).toHaveLength(1);
    expect(state().lines[s.cooking]).toEqual(before);
  });

  it('[04 #29] three entries → three requests in one transaction; one deduped → 409 VOID_PENDING and the whole command rolls back', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const s = stagedOrder(hub);
    const lines = [s.cooking, s.done, s.served].map((id) => ({ order_item_id: id, disposition: 'wastage' as const }));
    const r = await voidItems(cashier, s.order_id, lines);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(raisedOf(r).map((a) => a.dedupe_key)).toEqual([s.cooking, s.done, s.served].map((id) => `void:${id}`));
    expect((r.result as { pending: unknown[] }).pending).toHaveLength(3);

    // dedupe: an open request already holds the key `void:<line>` (its touched_ids elsewhere, so rule 6 (b) lets it pass)
    const t = stagedOrder(hub, { prefix: 'DD' });
    const held = hub.deps.writer.run((tx) => {
      const ctx = { tx, state: tx.state, clock: tx.clock, ids: tx.ids, actor: { kind: 'device', staffId: STAFF.cashier, stationId: null, sessionId: cashier.sessionId, deviceId: cashier.deviceId }, permission: null } as unknown as CommandCtx;
      const values = { order_id: t.order_id, order_item_id: t.done, units: 1, reason_code: 'quality', note: null, disposition: 'wastage', disposition_note: null, touched_ids: ['ELSEWHERE'], line_dispositions: { ELSEWHERE: 'wastage' }, refund_minor: 0, comp_voided_minor: 0 };
      const [res] = alerts.raiseMany(ctx, [{ kind: 'void_approval', subject: { stream_type: 'order', stream_id: t.order_id }, target: { kind: 'answerers' }, values, details: { item: 'Naan', quantity: 1, amount: 0, reason: 'quality', lines: [{ name: 'Naan', quantity: 1, state: 'cooked' }] }, display: { kind_label_key: 'alert.void_approval.lock', table_code: null, requester_name: null }, dedupe_key: `void:${t.done}`, requester_staff_id: STAFF.cashier, request: { approver_role_ids: [VX.managerRole] } }]);
      tx.append(res!.events);
      return res!;
    }).result;
    const n = events();
    const d = await voidItems(cashier, t.order_id, [t.cooking, t.done, t.served].map((id) => ({ order_item_id: id, disposition: 'wastage' as const })));
    expect(d.error).toEqual({ code: 'VOID_PENDING', details: { alert_id: held.alert_id, order_item_id: t.done } });
    expect(events()).toBe(n);
  });

  it('[04 #29b] overlapping entries on the approval path → 400 overlaps_entry', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const r = await voidItems(cashier, d.order_id, [
      { order_item_id: d.deal, units: 1, disposition: 'wastage' },
      { order_item_id: d.karahiPart, units: 1, disposition: 'wastage' },
    ]);
    expect(r.status).toBe(400);
    expect(r.error?.details).toEqual({ issues: [{ path: 'lines.1.order_item_id', message: 'overlaps_entry' }] });
  });

  it('[04 #28] void request on a line with an open comp → COMP_PENDING; on a deal part while a comp request is open on the deal → COMP_PENDING', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const comp = hub.deps.writer.run((tx) => {
      const ctx = { tx, state: tx.state, clock: tx.clock, ids: tx.ids, actor: { kind: 'device', staffId: STAFF.cashier, stationId: null, sessionId: cashier.sessionId, deviceId: cashier.deviceId }, permission: null } as unknown as CommandCtx;
      const [res] = alerts.raiseMany(ctx, [{ kind: COMP_KIND, subject: { stream_type: 'order', stream_id: d.order_id }, target: { kind: 'answerers' }, values: { order_id: d.order_id, order_item_id: d.deal, units: 1, reason_code: 'quality', note: null }, details: { item: 'Deal', quantity: 1, amount: 1, reason: 'quality' }, display: { kind_label_key: 'alert.comp.lock', table_code: null, requester_name: null }, dedupe_key: `comp:${d.deal}`, requester_staff_id: STAFF.cashier, request: { approver_role_ids: [VX.managerRole] } }]);
      tx.append(res!.events);
      return res!;
    }).result;
    expect((await voidItems(cashier, d.order_id, [{ order_item_id: d.karahiPart, units: 1, disposition: 'wastage' }])).error).toEqual({ code: 'COMP_PENDING', details: { alert_id: comp.alert_id } });
    expect((await voidItems(cashier, d.order_id, [{ order_item_id: d.deal, units: 1, disposition: 'wastage' }])).error).toEqual({ code: 'COMP_PENDING', details: { alert_id: comp.alert_id } });
  });

  it('[04 §3.5 G-10] details_schema: kind-local lines ≤ 10 with a state enum; the shared base is untouched', () => {
    const ok = { item: 'X', quantity: 1, amount: 0, reason: 'quality', disposition: 'void.disposition.wastage', lines: [{ name: 'X', quantity: 1, state: 'served' }] };
    expect(VoidDetails.safeParse(ok).success).toBe(true);
    expect(VoidDetails.safeParse({ ...ok, lines: [{ name: 'X', quantity: 1, state: 'eaten' }] }).success).toBe(false);
    expect(VoidDetails.safeParse({ ...ok, lines: Array.from({ length: 11 }, () => ok.lines[0]) }).success).toBe(false);
  });

  it('[04 #20] routing: the Manager (approve-void branch) and the requester\'s own lead (approve-void my_team) get the answerer route; another my_team lead and the requesting Cashier get nothing', async () => {
    const base = await voidsDirectory();
    const mgrHash = base.staff.find((p) => p.staff_id === STAFF.manager)!.pin_hash;
    const leads = { role_id: 'R_LEADS', name: 'Shift lead', session_idle_ttl_ms: 3_600_000, permissions: [{ permission: 'approve-void' as const, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'my_team' as const }] };
    const dir = {
      ...base,
      roles: [
        ...base.roles.map((r) =>
          r.role_id === 'R_CASH'
            ? { ...r, permissions: r.permissions.map((p) => (p.permission === 'void-item' ? { ...p, approver_role_ids: [VX.managerRole, 'R_LEADS'] } : p)) }
            : r,
        ),
        leads,
      ],
      staff: [
        ...base.staff.map((p) => (p.staff_id === STAFF.cashier ? { ...p, lead_staff_id: 'S_LEAD' } : p)),
        { staff_id: 'S_LEAD', display_name: 'Lead A', pin_hash: mgrHash, role_ids: ['R_LEADS'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
        { staff_id: 'S_LEAD2', display_name: 'Lead B', pin_hash: mgrHash, role_ids: ['R_LEADS'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
      ],
    };
    hub = await startVoids({ directory: dir });
    const cashier = signIn(hub, STAFF.cashier);
    for (const id of [STAFF.manager, 'S_LEAD', 'S_LEAD2']) signIn(hub, id);
    const s = stagedOrder(hub);
    const r = await voidItems(cashier, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const alert_id = raisedOf(r)[0]!.alert_id;
    // nobody is on shift in the fixture, so 01d skips the tier's first steps and routes at its escalation step; the
    // answerer set is the same rule there (range = approve-void scope)
    const rows = hub.deps.db.prepare('SELECT staff_id, recipient_set FROM alert_recipients WHERE alert_id = ? AND staff_id IS NOT NULL').all(alert_id) as Array<{ staff_id: string; recipient_set: string }>;
    const answerers = [...new Set(rows.filter((x) => x.recipient_set === 'answerer').map((x) => x.staff_id))].sort();
    expect(answerers).toEqual(['S_LEAD', STAFF.manager].sort());
    expect(rows.filter((x) => x.staff_id === 'S_LEAD2' && x.recipient_set === 'answerer')).toEqual([]); // not the requester's lead
    expect(rows.map((x) => x.staff_id)).not.toContain(STAFF.cashier);
  });

  it('[04 §6.1 Statements, no N+1] the approval path costs the same for 1 entry and 3 entries: 3 + raiseMany\'s fixed bound', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    signIn(hub, STAFF.manager);
    const counter = statementCounter(hub.deps.db);
    let handled = -1;
    commandRegistry(hub.app).register(
      defineCommand({
        ...voidItemsCommand,
        commandType: 'TestVoidItemsRaiseCounted',
        handle(ctx, p, cmd) {
          const before = counter.count;
          try {
            return voidItemsCommand.handle(ctx, p, cmd);
          } finally {
            handled = counter.count - before;
          }
        },
      }),
    );
    const counted = async (order_id: string, ids: string[]): Promise<number> => {
      const r = await post(hub, cashier, 'test-void-items-raise-counted', 'TestVoidItemsRaiseCounted', { order_id, reason_code: 'quality', note: null, disposition_note: null, lines: ids.map((order_item_id) => ({ order_item_id, disposition: 'wastage' })) });
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      expect(raisedOf(r)).toHaveLength(ids.length);
      return handled;
    };
    const one = stagedOrder(hub, { prefix: 'ONE' });
    const three = stagedOrder(hub, { prefix: 'THR' });
    const n1 = await counted(one.order_id, [one.cooking]);
    const n3 = await counted(three.order_id, [three.cooking, three.done, three.served]);
    expect(n3).toBe(n1);
    expect(n1).toBeGreaterThan(3);
  });
});
