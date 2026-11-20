// 05 §6.14 `RemoveComp` (approvable), B27, §3.14 kind `remove_comp` (its re-check on approve only, H6-2 / H7-5: order
// not billed, `comped_units ≥ units`, the line guard list), §4.5 row Q-4 (02b `LineCompRemoved`, `planCompRemoval`),
// §9 (task 20; 05-plan §3 row 20; test #41).
// Real events through the hub's writer, the real `orders` and `billing` folds, the command over HTTP as the client posts
// it, the approval answered through 01d's `AnswerRequest` with the Manager's PIN. Money is read back from
// `GET /queries/bill` (the shared bill view); the comps are real `LineComped` events (fixture or 02b's CompLine).
import { draftOf, OrdersBilled, OrdersBilledPayload, type PosEvent } from '@pos/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kindOf, type AlertApplyCtx } from '../../src/alerts/kinds';
import { alerts } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import { RemoveComp } from '../../src/billing/commands/remove-comp';
import type { BillView } from '../../src/billing/queries/bill';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { readOnlyTx } from '../../src/engine-host/read-only-tx';
import { registerLineGuard, resetLineGuard, type LineGuardEntry } from '../../src/orders/line-guard';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { seedDirectory, type TestHub } from '../helpers/test-hub';
import {
  answer,
  appendOrder,
  billingDirectory,
  compedLine,
  dealX2,
  FX,
  openSeating,
  post,
  raiseVoid,
  signIn,
  STAFF,
  startBilling,
  VX,
  type Reply,
  type Who,
} from './fixtures';

let hub: TestHub;
let cashier: Who;
let manager: Who;
let waiter: Who;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;

// ------------------------------------------------------------------------------------------------ set-up

/** The real handler under a test-only name, so its own statements are counted (02a SG-3 / 02b comp pattern). */
const RemoveCompCounted = defineCommand({
  ...RemoveComp,
  commandType: 'TestRemoveCompCounted',
  handle(...args: Parameters<typeof RemoveComp.handle>) {
    const before = counter.count;
    try {
      return RemoveComp.handle(...args);
    } finally {
      lastStatements = counter.count - before;
    }
  },
});

async function start(): Promise<void> {
  hub = await startBilling();
  commandRegistry(hub.app).register(RemoveCompCounted);
  cashier = signIn(hub, STAFF.cashier);
  manager = signIn(hub, STAFF.manager);
  waiter = signIn(hub, STAFF.orderTaker);
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
}

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
  // a test-only guard is cleared; the next hub's registerVoids registers 04's again (guard-list rule)
  resetLineGuard();
});

// ------------------------------------------------------------------------------------------------ helpers

const removeComp = (who: Who, payload: Record<string, unknown>, commandId?: string): Promise<Reply> => post(hub, who, 'remove-comp', 'RemoveComp', payload, commandId);
const removeCounted = (who: Who, payload: Record<string, unknown>): Promise<Reply> => post(hub, who, 'test-remove-comp-counted', 'TestRemoveCompCounted', payload);

async function view(qs: Record<string, string>, who: Who = cashier): Promise<BillView> {
  const res = await hub.app.inject({
    method: 'GET',
    url: `/queries/bill?${new URLSearchParams(qs).toString()}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: BillView }).data;
}

/** Every stored event of `type`, payload parsed, in seq order. */
function eventsOf(type: string): PosEvent[] {
  return (hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type) as Array<Record<string, unknown>>).map(
    (row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent,
  );
}

const maxSeq = (): number => (hub.deps.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM events').get() as { s: number }).s;

function lineRow(order_item_id: string): { comped_units: number; comp_minor: number } {
  return hub.deps.db.prepare('SELECT comped_units, comp_minor FROM order_lines WHERE order_item_id = ?').get(order_item_id) as { comped_units: number; comp_minor: number };
}

function textOf(subject_id: string): string | undefined {
  return (hub.deps.db.prepare(`SELECT text FROM bill_texts WHERE subject_id = ? AND field = 'note'`).get(subject_id) as { text: string } | undefined)?.text;
}

/** Every table of the hub database except `bill_texts`, and the hub log, that contains `needle` (privacy, H3-5 / H-4). */
function leaksOf(needle: string): string[] {
  const tables = (hub.deps.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'bill_texts'`).all() as Array<{ name: string }>).map((t) => t.name);
  const hits = tables.filter((name) => JSON.stringify(hub.deps.db.prepare(`SELECT * FROM "${name}"`).all()).includes(needle));
  if (hub.logs().includes(needle)) hits.push('hub.logs()');
  return hits;
}

/** 02b's OrdersBilled on the order's stream (task 17's last close, stood in for by its folded event). */
function billOrders(order_ids: string[], bill_id = 'B_FIXTURE'): void {
  hub.clock.advance(1_000);
  hub.deps.writer.run((tx) =>
    tx.append([
      draftOf(OrdersBilled, {
        stream_type: 'order',
        stream_id: order_ids[0]!,
        payload: OrdersBilledPayload.parse({ order_ids, bill_id }),
        occurred_at: hub.clock.branchNow(),
        actor_id: STAFF.cashier,
        device_id: 'D_FIXTURE',
      }),
    ]),
  );
}

/** A dine-in seating at T4: one order of three naans (3 000 each), not yet comped. */
function dineInComped(): { seating_id: string; order_id: string; line: string } {
  const seating_id = 'SEAT_RC';
  const line = 'RC1_N';
  openSeating(hub, { table_id: VX.tables.T4, seating_id });
  const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, lines: [{ order_item_id: line, item_id: FX.naan, quantity: 3 }] });
  return { seating_id, order_id, line };
}

/** The Cashier asks (grant requires_approval); returns the open request's id. */
async function asked(payload: Record<string, unknown>): Promise<{ alert_id: string; reply: Reply }> {
  const reply = await removeComp(cashier, payload);
  expect(reply.status).toBe(200);
  const alert_id = (reply.result!.pending as { alert_id: string }).alert_id;
  return { alert_id, reply };
}

const openRemoveComp = (): string[] => alerts.listOpen(hub.deps.db, { kind: 'remove_comp' }).map((a) => a.alert_id);

// ------------------------------------------------------------------------------------------------ direct (allowed)

describe('[05 §6.14, B27] RemoveComp — direct (grant allowed)', () => {
  it('[05 #41] the Manager removes the comp of an unbilled line: LineCompRemoved { requester, approver null, alert null }; the bill rises (literal PKR)', async () => {
    await start();
    const { order_id, line } = compedLine(hub);
    const before = await view({ order_id });
    // literal PKR (exponent 2): three naans 30.00 each = 90.00, one comped (30.00) → 60.00
    expect(before.totals_default).toMatchObject({ subtotal_minor: 6_000, total_minor: 6_000 });

    const r = await removeComp(manager, { order_item_id: line, reason_code: 'comped_by_mistake' });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ removed: { units: 1, comp_minor: 3_000 } });
    expect(r.events.map((e) => e.event_type)).toEqual(['LineCompRemoved']);
    expect(r.events[0]).toMatchObject({ stream_type: 'order', stream_id: order_id, actor_id: STAFF.manager });
    expect(r.events[0]!.payload).toEqual({
      order_item_id: line,
      units: 1,
      comp_minor: 3_000,
      reason_code: 'comped_by_mistake',
      has_note: false,
      note_id: null,
      requester_staff_id: STAFF.manager,
      approver_staff_id: null,
      alert_id: null,
    });
    expect(lineRow(line)).toEqual({ comped_units: 0, comp_minor: 0 });
    // the bill rises by the comp: 90.00
    expect((await view({ order_id })).totals_default).toMatchObject({ subtotal_minor: 9_000, total_minor: 9_000 });
  });

  it('[05 §6.14] units omitted → every comped unit; a part (units 1 of 2) leaves the rest comped; the bill rises by each step', async () => {
    await start();
    const partial = compedLine(hub, { prefix: 'P2', units: 2, value_minor: 6_000 });
    const one = await removeComp(manager, { order_item_id: partial.line, units: 1, reason_code: 'wrong_line' });
    expect(one.result).toEqual({ removed: { units: 1, comp_minor: 3_000 } });
    expect(lineRow(partial.line)).toEqual({ comped_units: 1, comp_minor: 3_000 });
    expect((await view({ order_id: partial.order_id })).totals_default).toMatchObject({ subtotal_minor: 6_000, total_minor: 6_000 });

    const all = compedLine(hub, { prefix: 'A2', units: 2, value_minor: 6_000 });
    const r = await removeComp(manager, { order_item_id: all.line, reason_code: 'wrong_line' });
    expect(r.result).toEqual({ removed: { units: 2, comp_minor: 6_000 } });
    expect(r.events.map((e) => e.payload.units)).toEqual([2]);
    expect(lineRow(all.line)).toEqual({ comped_units: 0, comp_minor: 0 });
    expect((await view({ order_id: all.order_id })).totals_default).toMatchObject({ subtotal_minor: 9_000, total_minor: 9_000 });
  });

  it('[05 §6.14, row Q-4] a comped deal: one LineCompRemoved per line the comp touched (deal + parts), comp_minor = Σ; the ledger is back to 0', async () => {
    await start();
    const { order_id, deal, karahiPart, naanPart } = dealX2(hub, { placed_by: STAFF.orderTaker });
    const comp = await post(hub, manager, 'comp-line', 'CompLine', { order_item_id: deal, units: 2, reason_code: 'quality' });
    expect(comp.status).toBe(200);
    const comped = comp.events.filter((e) => e.event_type === 'LineComped');
    const value = comped.reduce((a, e) => a + (e.payload.value_minor as number), 0);
    const beforeTotal = (await view({ order_id })).totals_default.total_minor;

    const r = await removeComp(manager, { order_item_id: deal, reason_code: 'comped_by_mistake' });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(comped.map(() => 'LineCompRemoved'));
    expect(r.events.map((e) => [e.payload.order_item_id, e.payload.units, e.payload.comp_minor])).toEqual(
      comped.map((e) => [e.payload.order_item_id, e.payload.units, e.payload.value_minor]),
    );
    expect(r.result).toEqual({ removed: { units: 2, comp_minor: value } });
    for (const id of [deal, karahiPart, naanPart]) expect(lineRow(id), id).toEqual({ comped_units: 0, comp_minor: 0 });
    expect((await view({ order_id })).totals_default.total_minor).toBe(beforeTotal + value);
  });

  it('[05 §6.14, owner R-62] a deal_part named on its own → 400 VALIDATION_FAILED { path: order_item_id }, nothing written; the whole deal is the way', async () => {
    await start();
    const { order_id, deal, karahiPart } = dealX2(hub, { placed_by: STAFF.orderTaker });
    expect((await post(hub, manager, 'comp-line', 'CompLine', { order_item_id: deal, units: 2, reason_code: 'quality' })).status).toBe(200);
    const part = lineRow(karahiPart);
    expect(part.comped_units).toBeGreaterThan(0);
    const seq = maxSeq();
    for (const who of [manager, cashier]) {
      const r = await removeComp(who, { order_item_id: karahiPart, reason_code: 'wrong_line' });
      expect(r.status).toBe(400);
      expect(r.error?.code).toBe('VALIDATION_FAILED');
      expect((r.error?.details as { issues: Array<{ path: string }> }).issues.map((i) => i.path)).toEqual(['order_item_id']);
    }
    expect(maxSeq()).toBe(seq);
    expect(lineRow(karahiPart)).toEqual(part);
    expect(openRemoveComp()).toEqual([]);
    // the whole deal is still removable
    expect((await removeComp(manager, { order_item_id: deal, reason_code: 'wrong_line' })).status).toBe(200);
    void order_id;
  });

  it('[05 §6.14, H3-5] a note goes to bill_texts under a minted note_id; the event carries has_note / note_id only, never the text', async () => {
    await start();
    const { line } = compedLine(hub);
    const r = await removeComp(manager, { order_item_id: line, reason_code: 'other', note: 'Comped the wrong table' });
    expect(r.status).toBe(200);
    const p = r.events[0]!.payload as { has_note: boolean; note_id: string };
    expect(p).toMatchObject({ reason_code: 'other', has_note: true });
    expect(p.note_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(textOf(p.note_id)).toBe('Comped the wrong table');
    expect(JSON.stringify(r.events)).not.toContain('wrong table');
  });

  it("[05 §4.4, §6.14] Zod: 'other' needs a note; a note above 200, an unknown reason, units 0 or a fraction → 400, nothing written", async () => {
    await start();
    const { line } = compedLine(hub);
    const seq = maxSeq();
    const bad = [
      { order_item_id: line, reason_code: 'other' },
      { order_item_id: line, reason_code: 'other', note: '  ' },
      { order_item_id: line, reason_code: 'wrong_line', note: 'x'.repeat(201) },
      { order_item_id: line, reason_code: 'quality' },
      { order_item_id: line, reason_code: 'wrong_line', units: 0 },
      { order_item_id: line, reason_code: 'wrong_line', units: 1.5 },
      { order_item_id: '', reason_code: 'wrong_line' },
    ];
    for (const payload of bad) {
      const r = await removeComp(manager, payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
      expect(r.error?.code).toBe('VALIDATION_FAILED');
    }
    expect(maxSeq()).toBe(seq);
    expect((await removeComp(manager, { order_item_id: line, reason_code: 'wrong_line', note: 'x'.repeat(200) })).status).toBe(200);
  });

  it('[05 #41, §9] not comped → 409 LINE_NOT_COMPED { order_item_id }; units above the comped units → 400; unknown line → 404; nothing written', async () => {
    await start();
    const { line } = compedLine(hub);
    const { line: plain } = compedLine(hub, { prefix: 'NC' });
    await removeComp(manager, { order_item_id: plain, reason_code: 'wrong_line' }); // now not comped
    const seq = maxSeq();
    const notComped = await removeComp(manager, { order_item_id: plain, reason_code: 'wrong_line' });
    expect(notComped.status).toBe(409);
    expect(notComped.error).toEqual({ code: 'LINE_NOT_COMPED', details: { order_item_id: plain } });
    const tooMany = await removeComp(manager, { order_item_id: line, units: 2, reason_code: 'wrong_line' });
    expect(tooMany.status).toBe(400);
    expect(tooMany.error?.code).toBe('VALIDATION_FAILED');
    const missing = await removeComp(manager, { order_item_id: 'L_NOPE', reason_code: 'wrong_line' });
    expect(missing.status).toBe(404);
    expect(missing.error).toEqual({ code: 'ORDER_NOT_FOUND', details: { order_item_id: 'L_NOPE' } });
    expect(maxSeq()).toBe(seq);
  });

  it('[05 #41, B27] a billed line → 409 ORDER_BILLED { order_id } (a billed comp changes only through a reopen); nothing written', async () => {
    await start();
    const { order_id, line } = compedLine(hub);
    billOrders([order_id]);
    const seq = maxSeq();
    const r = await removeComp(manager, { order_item_id: line, reason_code: 'wrong_line' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'ORDER_BILLED', details: { order_id } });
    expect(maxSeq()).toBe(seq);
    expect(lineRow(line)).toEqual({ comped_units: 1, comp_minor: 3_000 });
  });

  it('[05 #41, §6.14] the line guard: a void pending on the line (04’s guard) → 409 VOID_PENDING; nothing written', async () => {
    await start();
    const { order_id, line } = compedLine(hub);
    const v = raiseVoid(hub, { requester: cashier, order_id, order_item_id: line, units: 1 });
    const seq = maxSeq();
    const r = await removeComp(manager, { order_item_id: line, reason_code: 'wrong_line' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'VOID_PENDING', details: { alert_id: v.alert_id, order_item_id: line } });
    expect(maxSeq()).toBe(seq);
  });

  it('[05 §6.14, row Q-3] the line guard is asked once with the planned entries (comped_after from planCompRemoval); its LINE_IN_CLOSED_SPLIT refuses', async () => {
    await start();
    const { order_id, line } = compedLine(hub, { units: 2, value_minor: 6_000 });
    const asks: Array<{ order_id: string; touched: LineGuardEntry[] }> = [];
    registerLineGuard((_db, oid, touched) => {
      asks.push({ order_id: oid, touched: [...touched] });
      return { code: 'LINE_IN_CLOSED_SPLIT', details: { order_item_id: touched[0]!.order_item_id, bill_id: 'B1', split_no: 1 } };
    });
    const seq = maxSeq();
    const r = await removeComp(manager, { order_item_id: line, units: 1, reason_code: 'wrong_line' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'LINE_IN_CLOSED_SPLIT', details: { order_item_id: line, bill_id: 'B1', split_no: 1 } });
    // 3 naans 3 000 each, 2 comped → 1 removed: units_after 3, comped_after 1, base_after 9 000 − 3 000 = 6 000
    expect(asks).toEqual([{ order_id, touched: [{ order_item_id: line, units_after: 3, comped_after: 1, base_after_minor: 6_000, money_changes: false }] }]);
    expect(maxSeq()).toBe(seq);
  });

  it('[05 §6.14, C8] grant first: the Order taker (no remove-comp) → 403 before any read; scope last: a test-only my_floors grant → 403 outside_scope after the state checks', async () => {
    await start();
    const { line } = compedLine(hub);
    const r = await removeComp(waiter, { order_item_id: 'L_NOPE', reason_code: 'wrong_line' });
    expect(r.status).toBe(403);
    expect(r.error?.code).toBe('PERMISSION_DENIED');

    const dir = await billingDirectory({ directory_version: 2 });
    await seedDirectory(hub, {
      ...dir,
      roles: dir.roles.map((role) =>
        role.role_id !== 'R_MGR' ? role : { ...role, permissions: role.permissions.map((g) => (g.permission === 'remove-comp' ? { ...g, scope: 'my_floors' } : g)) },
      ),
    });
    const seq = maxSeq();
    const scoped = await removeComp(manager, { order_item_id: line, reason_code: 'wrong_line' });
    expect(scoped.status).toBe(403);
    expect(scoped.error?.details).toMatchObject({ reason: 'outside_scope' });
    // the state checks still come first: an unknown line is 404, not 403
    expect((await removeComp(manager, { order_item_id: 'L_NOPE', reason_code: 'wrong_line' })).status).toBe(404);
    expect(maxSeq()).toBe(seq);
  });
});

// ------------------------------------------------------------------------------------------------ approval path

describe('[05 §3.14, §6.14] RemoveComp — approval path (grant requires_approval)', () => {
  it('[05 §3.14] the Cashier asks: one remove_comp request (subject the order, values ids / codes, dedupe remove_comp:<line>); nothing changes yet', async () => {
    await start();
    const { order_id, line } = compedLine(hub);
    const { alert_id, reply } = await asked({ order_item_id: line, reason_code: 'other', note: 'Guest paid in the end' });
    expect(reply.result).toEqual({ pending: { alert_id } });
    expect(reply.events.map((e) => e.event_type)).toContain('AlertRaised');
    expect(reply.events.map((e) => e.event_type)).not.toContain('LineCompRemoved');
    const raised = eventsOf('AlertRaised').find((e) => (e.payload as { alert_id: string }).alert_id === alert_id)!;
    const p = raised.payload as { kind: string; values: { note_id: string }; details: unknown; dedupe_key: string; requester_staff_id: string };
    expect(p).toMatchObject({ kind: 'remove_comp', subject_stream_type: 'order', subject_stream_id: order_id, dedupe_key: `remove_comp:${line}`, requester_staff_id: STAFF.cashier });
    expect(p.values).toEqual({ order_id, order_item_id: line, units: 1, reason_code: 'other', note_id: p.values.note_id, has_note: true });
    // a takeaway has no table: amount (what the removal adds back) and reason only
    expect(p.details).toEqual({ amount: 3_000, reason: 'other' });
    expect(textOf(p.values.note_id)).toBe('Guest paid in the end');
    expect(JSON.stringify(raised)).not.toContain('Guest paid');
    expect(lineRow(line)).toEqual({ comped_units: 1, comp_minor: 3_000 });
    expect(eventsOf('LineCompRemoved')).toEqual([]);
  });

  it('[05 §3.12] a dine-in request names the table (identifier = the primary table’s config name)', async () => {
    await start();
    const { order_id, line } = dineInComped();
    hub.clock.advance(1_000);
    expect((await post(hub, manager, 'comp-line', 'CompLine', { order_item_id: line, units: 2, reason_code: 'quality' })).status).toBe(200);
    const { alert_id } = await asked({ order_item_id: line, units: 1, reason_code: 'wrong_line' });
    const raised = eventsOf('AlertRaised').find((e) => (e.payload as { alert_id: string }).alert_id === alert_id)!;
    expect((raised.payload as { details: unknown }).details).toEqual({ amount: 3_000, reason: 'wrong_line', identifier: 'T4' });
    expect((raised.payload as { subject_stream_id: string }).subject_stream_id).toBe(order_id);
  });

  it('[05 #41, §3.14] approve end to end (Manager PIN): LineCompRemoved { alert_id, requester = Cashier, approver = answerer, the note_id }; the bill rises (literal PKR)', async () => {
    await start();
    const { order_id, line } = compedLine(hub);
    const { alert_id } = await asked({ order_item_id: line, reason_code: 'other', note: 'Mistake' });
    const note_id = (eventsOf('AlertRaised').find((e) => (e.payload as { alert_id: string }).alert_id === alert_id)!.payload as { values: { note_id: string } }).values.note_id;
    expect((await view({ order_id })).totals_default).toMatchObject({ subtotal_minor: 6_000, total_minor: 6_000 });
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(200);
    const removed = a.events.filter((e) => e.event_type === 'LineCompRemoved');
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ stream_type: 'order', stream_id: order_id });
    expect(removed[0]!.payload).toEqual({
      order_item_id: line,
      units: 1,
      comp_minor: 3_000,
      reason_code: 'other',
      has_note: true,
      note_id,
      requester_staff_id: STAFF.cashier,
      approver_staff_id: STAFF.manager,
      alert_id,
    });
    expect(lineRow(line)).toEqual({ comped_units: 0, comp_minor: 0 });
    expect((await view({ order_id })).totals_default).toMatchObject({ subtotal_minor: 9_000, total_minor: 9_000 });
    expect(openRemoveComp()).toEqual([]);
  });

  it('[05 §3.14, H7-5] reject → no event, the request closes, the comp stays', async () => {
    await start();
    const { order_id, line } = compedLine(hub);
    const { alert_id } = await asked({ order_item_id: line, reason_code: 'wrong_line' });
    const a = await answer(hub, manager, alert_id, 'reject');
    expect(a.status).toBe(200);
    expect(a.events.map((e) => e.event_type)).not.toContain('LineCompRemoved');
    expect(eventsOf('LineCompRemoved')).toEqual([]);
    expect(lineRow(line)).toEqual({ comped_units: 1, comp_minor: 3_000 });
    expect((await view({ order_id })).totals_default.total_minor).toBe(6_000);
    expect(openRemoveComp()).toEqual([]);
  });

  it('[05 #41, H6-2] re-check on approve: the line billed meanwhile → the answer is refused 409 ORDER_BILLED, nothing written, the request stays open', async () => {
    await start();
    const { order_id, line } = compedLine(hub);
    const { alert_id } = await asked({ order_item_id: line, reason_code: 'wrong_line' });
    billOrders([order_id]);
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'ORDER_BILLED', details: { order_id } });
    expect(eventsOf('LineCompRemoved')).toEqual([]);
    expect(lineRow(line)).toEqual({ comped_units: 1, comp_minor: 3_000 });
    expect(openRemoveComp()).toEqual([alert_id]);
    // reject never re-checks: it closes the request
    expect((await answer(hub, manager, alert_id, 'reject')).status).toBe(200);
    expect(openRemoveComp()).toEqual([]);
  });

  it('[05 H6-2] re-check on approve: the comp already removed (the Manager’s direct remove) → 409 LINE_NOT_COMPED, no second LineCompRemoved', async () => {
    await start();
    const { line } = compedLine(hub);
    const { alert_id } = await asked({ order_item_id: line, reason_code: 'wrong_line' });
    expect((await removeComp(manager, { order_item_id: line, reason_code: 'comped_by_mistake' })).status).toBe(200);
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'LINE_NOT_COMPED', details: { order_item_id: line } });
    expect(eventsOf('LineCompRemoved')).toHaveLength(1);
    expect(lineRow(line)).toEqual({ comped_units: 0, comp_minor: 0 });
    expect(openRemoveComp()).toEqual([alert_id]);
  });

  it('[05 H6-2] re-check on approve: fewer comped units than asked now → 400 VALIDATION_FAILED, nothing written', async () => {
    await start();
    const { line } = compedLine(hub, { units: 2, value_minor: 6_000 });
    const { alert_id } = await asked({ order_item_id: line, reason_code: 'wrong_line' }); // units resolved at raise: 2
    expect((await removeComp(manager, { order_item_id: line, units: 1, reason_code: 'comped_by_mistake' })).status).toBe(200);
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(400);
    expect(a.error?.code).toBe('VALIDATION_FAILED');
    expect(lineRow(line)).toEqual({ comped_units: 1, comp_minor: 3_000 });
  });

  it('[05 #41, H6-2] re-check on approve: a void raised on the line meanwhile → the line guard refuses 409 VOID_PENDING', async () => {
    await start();
    const { order_id, line } = compedLine(hub);
    const { alert_id } = await asked({ order_item_id: line, reason_code: 'wrong_line' });
    const v = raiseVoid(hub, { requester: cashier, order_id, order_item_id: line, units: 1 });
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'VOID_PENDING', details: { alert_id: v.alert_id, order_item_id: line } });
    expect(eventsOf('LineCompRemoved')).toEqual([]);
  });

  it('[05 §3.14] dedupe: a second ask while one is open → 200 with the same request, no second AlertRaised, no note written', async () => {
    await start();
    const { line } = compedLine(hub);
    const { alert_id } = await asked({ order_item_id: line, reason_code: 'wrong_line' });
    const raisedBefore = eventsOf('AlertRaised').length;
    const texts = (): number => (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM bill_texts').get() as { n: number }).n;
    const textsBefore = texts();
    const again = await removeComp(cashier, { order_item_id: line, reason_code: 'other', note: 'second try' });
    expect(again.status).toBe(200);
    expect(again.result).toEqual({ pending: { alert_id } });
    expect(eventsOf('AlertRaised')).toHaveLength(raisedBefore);
    expect(texts()).toBe(textsBefore);
  });

  it('[05 §6.14, D32] a retransmit with the same command_id returns the stored reply: one request', async () => {
    await start();
    const { line } = compedLine(hub);
    const first = await removeComp(cashier, { order_item_id: line, reason_code: 'wrong_line' }, 'rc-retransmit');
    const second = await removeComp(cashier, { order_item_id: line, reason_code: 'wrong_line' }, 'rc-retransmit');
    expect(second.status).toBe(200);
    expect(second.result).toEqual(first.result);
    expect(openRemoveComp()).toHaveLength(1);
  });

  it('[05 §3.14] the kind’s apply with actor ≠ answerer: approver = answerer_staff_id, requester = the request’s; reject → [] with 0 statements', async () => {
    await start();
    const { line } = compedLine(hub);
    const { alert_id } = await asked({ order_item_id: line, reason_code: 'wrong_line' });
    const record = alerts.listOpen(hub.deps.db, { kind: 'remove_comp' }).find((x) => x.alert_id === alert_id)!;
    const request = kindOf('remove_comp')!.request!;
    const run = (decision: 'approve' | 'reject') =>
      hub.deps.writer.run((tx) => {
        const ctx = {
          tx: readOnlyTx(tx),
          state: tx.state,
          clock: tx.clock,
          ids: tx.ids,
          // an in-person answer on the requester's device: actor = the requester; the answerer is named in the facts (01d)
          actor: { kind: 'staff', staffId: STAFF.cashier, stationId: null, sessionId: cashier.sessionId, deviceId: cashier.deviceId },
          permission: null,
          directory: currentDirectory(hub.app),
          alert: record,
        } as unknown as AlertApplyCtx<never, never>;
        counter.reset();
        const out = request.apply(ctx, { decision, answerer_staff_id: STAFF.manager, method: 'pin', device_id: manager.deviceId, answered_at: hub.clock.branchNow() });
        return { out, statements: counter.count };
      }).result;
    const approved = run('approve');
    // the line read (1) + 04's line guard (1); read-only
    expect(approved.statements).toBe(2);
    expect(approved.out.map((d) => d.event_type)).toEqual(['LineCompRemoved']);
    expect(approved.out[0]!.payload).toMatchObject({ alert_id, requester_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager });
    expect(run('reject')).toEqual({ out: [], statements: 0 });
  });

  it('[05 §3.14, owner R-62] the apply re-check uses the same rule: a request naming a deal_part is refused 400 VALIDATION_FAILED { path: order_item_id }', async () => {
    await start();
    const { deal, karahiPart } = dealX2(hub, { placed_by: STAFF.orderTaker });
    expect((await post(hub, manager, 'comp-line', 'CompLine', { order_item_id: deal, units: 2, reason_code: 'quality' })).status).toBe(200);
    const { alert_id } = await asked({ order_item_id: deal, units: 1, reason_code: 'wrong_line' });
    const record = alerts.listOpen(hub.deps.db, { kind: 'remove_comp' }).find((x) => x.alert_id === alert_id)!;
    // the command never raises one on a part; the record is pointed at the part to exercise apply's own check
    const onPart = { ...record, values: { ...(record.values as object), order_item_id: karahiPart } };
    const request = kindOf('remove_comp')!.request!;
    const thrown = (() => {
      try {
        hub.deps.writer.run((tx) => {
          const ctx = {
            tx: readOnlyTx(tx),
            state: tx.state,
            clock: tx.clock,
            ids: tx.ids,
            actor: { kind: 'staff', staffId: STAFF.cashier, stationId: null, sessionId: cashier.sessionId, deviceId: cashier.deviceId },
            permission: null,
            directory: currentDirectory(hub.app),
            alert: onPart,
          } as unknown as AlertApplyCtx<never, never>;
          return request.apply(ctx, { decision: 'approve', answerer_staff_id: STAFF.manager, method: 'pin', device_id: manager.deviceId, answered_at: hub.clock.branchNow() });
        });
        return null;
      } catch (e) {
        return e as { code?: string; details?: { issues: Array<{ path: string }> } };
      }
    })();
    expect(thrown?.code).toBe('VALIDATION_FAILED');
    expect(thrown?.details?.issues.map((i) => i.path)).toEqual(['order_item_id']);
    expect(eventsOf('LineCompRemoved')).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ statement counts

describe('[05 §6.14] statement counts (≤ 4; the 00 envelope and 01d’s raise excluded)', () => {
  it('[05 §6.14] direct: the line read + the line guard list (04’s guard registered) = 2; + 1 with a note (bill_texts) = 3', async () => {
    await start();
    const a = compedLine(hub, { prefix: 'S1' });
    const b = compedLine(hub, { prefix: 'S2' });
    expect((await removeCounted(manager, { order_item_id: a.line, reason_code: 'wrong_line' })).status).toBe(200);
    expect(lastStatements).toBe(2);
    expect((await removeCounted(manager, { order_item_id: b.line, reason_code: 'other', note: 'n' })).status).toBe(200);
    expect(lastStatements).toBe(3);
    // a refusal before the guard: the line read only
    expect((await removeCounted(manager, { order_item_id: a.line, reason_code: 'wrong_line' })).status).toBe(409);
    expect(lastStatements).toBe(1);
  });

  it('[05 §6.14] the request path: line read + guard + bill_texts = 3 besides 01d’s raise; a dedupe hit: 2', async () => {
    await start();
    const { line } = compedLine(hub);
    let inRaise = 0;
    const real = alerts.raise.bind(alerts);
    const spy = vi.spyOn(alerts, 'raise').mockImplementation((ctx, input) => {
      const before = counter.count;
      try {
        return real(ctx, input);
      } finally {
        inRaise = counter.count - before;
      }
    });
    try {
      const r = await removeCounted(cashier, { order_item_id: line, reason_code: 'other', note: 'please' });
      expect(r.result).toMatchObject({ pending: { alert_id: expect.any(String) } });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(lastStatements - inRaise).toBe(3);
      await removeCounted(cashier, { order_item_id: line, reason_code: 'other', note: 'again' });
      expect(lastStatements - inRaise).toBe(2); // the dedupe hit writes no note
    } finally {
      spy.mockRestore();
    }
  });
});

// ------------------------------------------------------------------------------------------------ privacy

describe('[05 row H-4, H16-7, H3-5] the note stays out of payload_hash and out of every store but bill_texts', () => {
  it('[05 row H-4] the same command_id with only the note changed replays the stored reply (not a mismatch)', async () => {
    await start();
    const { line } = compedLine(hub);
    const first = await removeComp(manager, { order_item_id: line, reason_code: 'other', note: 'first note' }, 'rc-hash');
    expect(first.status).toBe(200);
    const second = await removeComp(manager, { order_item_id: line, reason_code: 'other', note: 'second note' }, 'rc-hash');
    expect(second.status).toBe(200);
    expect(second.result).toEqual(first.result);
    expect(second.events.map((e) => e.event_type)).toEqual(first.events.map((e) => e.event_type));
    expect(eventsOf('LineCompRemoved')).toHaveLength(1);
    expect((hub.deps.db.prepare('SELECT text FROM bill_texts').all() as Array<{ text: string }>).map((r) => r.text)).toEqual(['first note']);
  });

  it('[05 H3-5, H-4] privacy scan: after a direct remove, a raise, a dedupe hit and an approve with notes, no note text is in any table but bill_texts, nor in the log', async () => {
    await start();
    const a = compedLine(hub, { prefix: 'PV1' });
    const b = compedLine(hub, { prefix: 'PV2' });
    const NOTES = ['PRIVNOTE-direct-1A', 'PRIVNOTE-raise-2B', 'PRIVNOTE-dedupe-3C'];
    expect((await removeComp(manager, { order_item_id: a.line, reason_code: 'other', note: NOTES[0] })).status).toBe(200);
    const { alert_id } = await asked({ order_item_id: b.line, reason_code: 'other', note: NOTES[1] });
    expect((await removeComp(cashier, { order_item_id: b.line, reason_code: 'other', note: NOTES[2] })).result).toEqual({ pending: { alert_id } });
    expect((await answer(hub, manager, alert_id, 'approve')).status).toBe(200);
    expect((hub.deps.db.prepare('SELECT text FROM bill_texts ORDER BY text').all() as Array<{ text: string }>).map((r) => r.text)).toEqual([NOTES[0], NOTES[1]]);
    for (const note of NOTES) expect(leaksOf(note), note).toEqual([]);
    // the scan itself sees a table: the shared marker is in bill_texts only
    expect(JSON.stringify(hub.deps.db.prepare('SELECT * FROM bill_texts').all())).toContain('PRIVNOTE');
  });
});
