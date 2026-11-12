// 04 §6.3 `GET /queries/void-preview`, §6.4 `GET /queries/pending-voids` (task v9). Real tables and events through
// the hub's writer; requests through VoidItems / 02b CompLine; the queries over HTTP as the client calls them.
import type { DirectoryInput } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import type { TestHub } from '../helpers/test-hub';
import { auditDirectory } from '../audit/fixtures';
import {
  answer,
  append,
  appendOrder,
  dealX2,
  FX,
  openSeating,
  post,
  signIn,
  STAFF,
  stagedOrder,
  startVoids,
  toStage,
  voidsDirectory,
  VX,
  type Who,
} from './fixtures';

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

interface Got {
  status: number;
  data: Record<string, unknown> | undefined;
  error: { code: string; details: Record<string, unknown> } | undefined;
  statements: number;
}

async function get(who: Who, resource: string, qs: Record<string, string>): Promise<Got> {
  // queries run on the read-only handle (queries/registry.ts)
  const counter = statementCounter(hub.deps.readDb);
  const url = `/queries/${resource}?${new URLSearchParams(qs).toString()}`;
  const before = counter.count;
  const res = await hub.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  const statements = counter.count - before;
  const body = res.json() as { data?: Record<string, unknown>; error?: { code: string; details: Record<string, unknown> } };
  return { status: res.statusCode, data: body.data, error: body.error === undefined ? undefined : { code: body.error.code, details: body.error.details }, statements };
}

/** Statements of a query's own handler on readDb: the request's total minus a probe that fails at Zod (auth / session only). */
async function handlerStatements(who: Who, resource: string, qs: Record<string, string>): Promise<number> {
  const probe = await get(who, resource, { __zod_fail: '1' });
  const real = await get(who, resource, qs);
  return real.statements - probe.statements;
}

type Line = { order_item_id: string; units?: number; disposition: 'moved' | 'wastage' | 'staff_meal' | 'other' };
async function ask(who: Who, order_id: string, lines: Line[]): Promise<string[]> {
  const reply = await post(hub, who, 'void-items', 'VoidItems', { order_id, reason_code: 'customer_changed_mind', note: null, disposition_note: null, lines });
  if (reply.status !== 200) throw new Error(`ask: ${reply.status} ${JSON.stringify(reply.error)}`);
  return (reply.result as { pending: Array<{ alert_id: string }> }).pending.map((p) => p.alert_id);
}

interface Preview {
  order_item_id: string;
  group: 'remove' | 'void';
  refund_minor: number;
  comp_voided_minor: number;
  touched: Array<{ order_item_id: string; name: string; units: number; stage: string; refund_minor: number; comp_voided_minor: number }>;
  stage: string;
  dispositions: Array<{ disposition: string; enabled: boolean; block: string | null; line_dispositions: Record<string, string | null> }>;
  needs_approval: boolean;
  pending: { alert_id: string } | null;
  comp_pending: { alert_id: string } | null;
}
const previews = (g: Got): Preview[] => (g.data as { previews: Preview[] }).previews;
const disp = (p: Preview, d: string) => p.dispositions.find((x) => x.disposition === d)!;
const preview = (who: Who, order_id: string, ids: string[], units?: number) =>
  get(who, 'void-preview', { order_id, order_item_ids: ids.join(','), ...(units === undefined ? {} : { units: String(units) }) });

/** stagedOrder: a cooking karahi, a done naan, a served naan. */
const order = (o: { seating_id?: string; prefix?: string } = {}) => stagedOrder(hub, o);

describe('[04 §6.3] void-preview', () => {
  it('[04 §6.3] one preview per id against the order as read: group void with touched lines, stage and per-disposition blocks (moved: cooking karahi enabled, done naan stock_not_tracked, served naan not_movable_stage); needs_approval by grant', async () => {
    hub = await startVoids();
    const manager = signIn(hub, STAFF.manager);
    const cashier = signIn(hub, STAFF.cashier);
    const s = order();
    const r = await preview(manager, s.order_id, [s.cooking, s.done, s.served]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const [k, d, sv] = previews(r);
    expect(k).toMatchObject({ order_item_id: s.cooking, group: 'void', stage: 'cooking', needs_approval: false, pending: null, comp_pending: null, comp_voided_minor: 0 });
    expect(k!.refund_minor).toBeGreaterThan(0);
    expect(k!.touched).toEqual([{ order_item_id: s.cooking, name: 'Chicken Karahi', units: 1, stage: 'cooking', refund_minor: k!.refund_minor, comp_voided_minor: 0 }]);
    expect(k!.dispositions).toEqual([
      { disposition: 'moved', enabled: true, block: null, line_dispositions: { [s.cooking]: 'moved' } },
      { disposition: 'wastage', enabled: true, block: null, line_dispositions: { [s.cooking]: 'wastage' } },
      { disposition: 'staff_meal', enabled: true, block: null, line_dispositions: { [s.cooking]: 'staff_meal' } },
      { disposition: 'other', enabled: true, block: null, line_dispositions: { [s.cooking]: 'other' } },
    ]);
    expect(d).toMatchObject({ group: 'void', stage: 'cooked' });
    expect(disp(d!, 'moved')).toEqual({ disposition: 'moved', enabled: false, block: 'stock_not_tracked', line_dispositions: {} });
    expect(sv).toMatchObject({ group: 'void', stage: 'served' });
    expect(disp(sv!, 'moved')).toMatchObject({ enabled: false, block: 'not_movable_stage' });
    expect(disp(sv!, 'wastage')).toMatchObject({ enabled: true, block: null });
    const asked = await preview(cashier, s.order_id, [s.cooking]);
    expect(previews(asked)[0]!.needs_approval).toBe(true);
  });

  it('[04 §6.3] rule 4 is `group`: a line still at stage 1 → group remove with the other fields empty; an OQ-C deal moved → { D: null, P1: moved, P2: null }', async () => {
    hub = await startVoids({ stock: { [FX.stock]: 0, [VX.naanStock]: 4 } });
    const manager = signIn(hub, STAFF.manager);
    const dl = dealX2(hub);
    const fresh = await preview(manager, dl.order_id, [dl.deal, dl.karahiPart]);
    expect(previews(fresh)).toEqual([dl.deal, dl.karahiPart].map((id) => ({
      order_item_id: id, group: 'remove', refund_minor: 0, comp_voided_minor: 0, touched: [], stage: 'not_started', dispositions: [], needs_approval: false, pending: null, comp_pending: null,
    })));
    toStage(hub, dl.order_id, [dl.karahiPart], 'cooking');
    const [deal] = previews(await preview(manager, dl.order_id, [dl.deal]));
    expect(deal!.group).toBe('void');
    expect(deal!.touched.map((t) => [t.order_item_id, t.stage])).toEqual([[dl.deal, 'not_started'], [dl.karahiPart, 'cooking'], [dl.naanPart, 'not_started']]);
    expect(disp(deal!, 'moved')).toEqual({ disposition: 'moved', enabled: true, block: null, line_dispositions: { [dl.deal]: null, [dl.karahiPart]: 'moved', [dl.naanPart]: null } });
    expect(deal!.refund_minor).toBe(deal!.touched.reduce((sum, t) => sum + t.refund_minor, 0));
  });

  it('[04 §6.3] rule 6 → pending; comp_pending on the approval path only (an allowed caller gets null); rule 7 → day_closed and move_not_granted blocks', async () => {
    const noMove: DirectoryInput = await auditDirectory();
    noMove.roles = noMove.roles.map((r) => (r.role_id === 'R_CASH' ? { ...r, permissions: r.permissions.filter((p) => p.permission !== 'move-item-to-stock') } : r));
    hub = await startVoids({ directory: noMove });
    const manager = signIn(hub, STAFF.manager);
    const cashier = signIn(hub, STAFF.cashier);
    const orderTaker = signIn(hub, STAFF.orderTaker);
    const s = order();
    const [locked] = await ask(orderTaker, s.order_id, [{ order_item_id: s.cooking, disposition: 'wastage' }]);
    const comp = await post(hub, cashier, 'comp-line', 'CompLine', { order_item_id: s.done, units: 1, reason_code: 'guest' });
    expect(comp.status, JSON.stringify(comp.error)).toBe(200);
    const [k, d] = previews(await preview(cashier, s.order_id, [s.cooking, s.done]));
    expect(k!.pending).toEqual({ alert_id: locked });
    expect(d!.comp_pending).toEqual({ alert_id: comp.result!.alert_id });
    expect(k!.comp_pending).toBeNull();
    expect(d!.pending).toBeNull();
    // rule 6 (c) is approval path only: the Manager (void-item allowed) gets no comp_pending on the same line
    const [, dm] = previews(await preview(manager, s.order_id, [s.cooking, s.done]));
    expect(dm!.needs_approval).toBe(false);
    expect(dm!.comp_pending).toBeNull();
    // the cashier holds no move-item-to-stock: moved blocked on the movable karahi
    const other = order({ prefix: 'O2' });
    expect(disp(previews(await preview(cashier, other.order_id, [other.cooking]))[0]!, 'moved')).toMatchObject({ enabled: false, block: 'move_not_granted' });
    expect(disp(previews(await preview(manager, other.order_id, [other.cooking]))[0]!, 'moved')).toMatchObject({ enabled: true, block: null });
    append(hub, [{ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: 'BusinessDayClosed', payload: {} }], { actor: STAFF.manager });
    expect(disp(previews(await preview(manager, other.order_id, [other.cooking]))[0]!, 'moved')).toMatchObject({ enabled: false, block: 'day_closed' });
  });

  it('[04 §6.3] 3 statements (readOrder + the two listOpen) for 1 and for 40 ids; ids de-duplicated', async () => {
    hub = await startVoids();
    const manager = signIn(hub, STAFF.manager);
    const lines = Array.from({ length: 40 }, (_, i) => ({ order_item_id: `M${String(i).padStart(2, '0')}`, item_id: FX.naan }));
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines });
    toStage(hub, order_id, lines.map((l) => l.order_item_id), 'cooking');
    const ids = lines.map((l) => l.order_item_id);
    expect(await handlerStatements(manager, 'void-preview', { order_id, order_item_ids: ids[0]! })).toBe(3);
    expect(await handlerStatements(manager, 'void-preview', { order_id, order_item_ids: ids.join(',') })).toBe(3);
    const dup = await preview(manager, order_id, [ids[0]!, ids[1]!, ids[0]!]);
    expect(previews(dup).map((p) => p.order_item_id)).toEqual([ids[0], ids[1]]);
  });

  it('[04 §6.3] units: only with a single id (a partial deal portion); refusals: 403 without void-item, 404, 409 billed, 400 foreign id / units / malformed', async () => {
    hub = await startVoids();
    const manager = signIn(hub, STAFF.manager);
    const dl = dealX2(hub);
    toStage(hub, dl.order_id, [dl.karahiPart], 'cooking');
    const whole = previews(await preview(manager, dl.order_id, [dl.deal]))[0]!;
    const half = previews(await preview(manager, dl.order_id, [dl.deal], 1))[0]!;
    expect(half.touched[0]!.units).toBe(1);
    expect(whole.touched[0]!.units).toBe(2);
    expect(half.refund_minor).toBeLessThan(whole.refund_minor);
    const bad = async (q: Record<string, string>) => (await get(manager, 'void-preview', q)).error;
    expect((await bad({ order_id: dl.order_id, order_item_ids: `${dl.deal},${dl.karahiPart}`, units: '1' }))?.code).toBe('VALIDATION_FAILED');
    expect(await bad({ order_id: dl.order_id, order_item_ids: dl.deal, units: '3' })).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'units' }] } });
    expect(await bad({ order_id: dl.order_id, order_item_ids: 'NOPE' })).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'order_item_ids' }] } });
    expect((await bad({ order_id: dl.order_id, order_item_ids: '' }))?.code).toBe('VALIDATION_FAILED');
    expect((await bad({ order_id: dl.order_id, order_item_ids: Array.from({ length: 41 }, (_, i) => `X${i}`).join(',') }))?.code).toBe('VALIDATION_FAILED');
    expect((await get(manager, 'void-preview', { order_id: 'O_NONE', order_item_ids: 'X' })).error?.code).toBe('ORDER_NOT_FOUND');
    hub.deps.db.prepare('UPDATE orders SET billed_at = ? WHERE order_id = ?').run(hub.clock.branchNow(), dl.order_id); // 05's bill: fixture
    const billed = await get(manager, 'void-preview', { order_id: dl.order_id, order_item_ids: dl.deal });
    expect([billed.status, billed.error?.code]).toEqual([409, 'ORDER_BILLED']);
    await hub.close();
    hub = await startVoids({ directory: await aDirectory() }); // the Cashier holds no void-item there
    const cashier = signIn(hub, STAFF.cashier);
    const s = order();
    const denied = await preview(cashier, s.order_id, [s.cooking]);
    expect([denied.status, denied.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
  });
});

describe('[04 §6.4] pending-voids', () => {
  it('[04 §6.4] by order_ids and by seating_id: pendingVoids with the engine state, 1 statement each; blocked row when a stored moved line was served (26b)', async () => {
    hub = await startVoids();
    const cashier = signIn(hub, STAFF.cashier);
    const orderTaker = signIn(hub, STAFF.orderTaker);
    openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT_T4' });
    const a = order({ seating_id: 'SEAT_T4', prefix: 'PA' });
    const b = order({ seating_id: 'SEAT_T4', prefix: 'PB' });
    const free = order({ prefix: 'PF' });
    const [moved] = await ask(cashier, a.order_id, [{ order_item_id: a.cooking, disposition: 'moved' }]);
    const [waste] = await ask(cashier, b.order_id, [{ order_item_id: b.done, disposition: 'wastage' }]);
    toStage(hub, a.order_id, [a.cooking], 'served');
    const byIds = await get(orderTaker, 'pending-voids', { order_ids: [a.order_id, b.order_id, free.order_id].join(',') });
    expect(byIds.status, JSON.stringify(byIds.error)).toBe(200);
    const orders = (byIds.data as { orders: Array<{ order_id: string; voids: Array<Record<string, unknown>> }> }).orders;
    expect(orders.map((o) => o.order_id)).toEqual([a.order_id, b.order_id]);
    expect(orders[0]!.voids).toEqual([expect.objectContaining({ alert_id: moved, order_item_id: a.cooking, touched_ids: [a.cooking], requester_staff_id: STAFF.cashier, blocked: 'not_movable_stage' })]);
    expect(orders[1]!.voids).toEqual([expect.objectContaining({ alert_id: waste, order_item_id: b.done, blocked: null })]);
    const bySeat = await get(orderTaker, 'pending-voids', { seating_id: 'SEAT_T4' });
    expect(bySeat.data).toEqual(byIds.data);
    expect(await handlerStatements(orderTaker, 'pending-voids', { order_ids: a.order_id })).toBe(1);
    expect(await handlerStatements(orderTaker, 'pending-voids', { seating_id: 'SEAT_T4' })).toBe(1);
    expect((await answer(hub, cashier, waste!, 'withdraw')).status).toBe(200);
    expect(((await get(orderTaker, 'pending-voids', { seating_id: 'SEAT_T4' })).data as { orders: unknown[] }).orders).toHaveLength(1);
  });

  it('[04 §6.4] take-order or void-item or approve-void, each alone enough (any grant), else 403 { permissions }; exactly one of order_ids (1–40) / seating_id, else 400', async () => {
    const askManager = { grant_type: 'requires_approval' as const, approver_role_id: VX.managerRole, approver_role_ids: [VX.managerRole], scope: 'branch' as const };
    const allowed = { grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'branch' as const };
    const only = async (permissions: DirectoryInput['roles'][number]['permissions']): Promise<Got> => {
      const dir = await voidsDirectory();
      dir.roles = dir.roles.map((r) => (r.role_id === 'R_WAIT' ? { ...r, permissions } : r));
      hub = await startVoids({ directory: dir });
      const got = await get(signIn(hub, STAFF.orderTaker), 'pending-voids', { order_ids: 'O1' });
      await hub.close();
      return got;
    };
    const denied = await only([]);
    expect([denied.status, denied.error]).toEqual([403, { code: 'PERMISSION_DENIED', details: { permissions: ['take-order', 'void-item', 'approve-void'] } }]);
    expect((await only([{ permission: 'take-order', ...allowed }])).status).toBe(200);
    expect((await only([{ permission: 'void-item', ...askManager }])).status).toBe(200);
    expect((await only([{ permission: 'approve-void', ...allowed }])).status).toBe(200);
    hub = await startVoids();
    const manager = signIn(hub, STAFF.manager);
    for (const q of [{}, { order_ids: 'O1', seating_id: 'S1' }, { order_ids: '' }, { order_ids: Array.from({ length: 41 }, (_, i) => `O${i}`).join(',') }] as Array<Record<string, string>>) {
      expect((await get(manager, 'pending-voids', q)).error?.code, JSON.stringify(q)).toBe('VALIDATION_FAILED');
    }
  });
});
