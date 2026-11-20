// 05 §6.8 `RemoveServiceCharge` (approvable) and `ApplyServiceCharge`, B8, §3.14 kind `remove_service_charge` (its
// re-check on approve only, H6-2 / H7-5), §3.3 / §5 `sc_removed`, R-21, §6.29 (task 14; 05-plan §3 row 14).
// Real events through the hub's writer, the real `billing` fold, the commands over HTTP as the client posts them, the
// approval answered through 01d's `AnswerRequest` with the Manager's PIN. Totals are read back from `GET /queries/bill`.
// Commands that are not built yet (task 11 check bill, 12 splits, 17 close, 19 reopen) are stood in for by their
// folded events (the task-10 pattern), so the sticky rule is checked against the fold and the view.
import {
  BillClosedEmpty,
  BillReopened,
  ChargeApplied,
  ChargeRemoved,
  draftOf,
  SeatingSplit,
  TablesMerged,
  SnapshotBillingSchema,
  type BranchConfig,
  type EventDef,
  type PosEvent,
  type SnapshotBilling,
} from '@pos/events';
import { aBillReopened } from '@pos/events/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { kindOf, type AlertApplyCtx } from '../../src/alerts/kinds';
import { alerts } from '../../src/alerts/raise';
import { ApplyServiceCharge, RemoveServiceCharge } from '../../src/billing/commands/service-charge';
import { hubBilling } from '../../src/billing/defaults';
import { billingProjection } from '../../src/billing/projections/billing';
import type { BillView } from '../../src/billing/queries/bill';
import { readOnlyTx } from '../../src/engine-host/read-only-tx';
import { createProjectionRegistry } from '../../src/projections/registry';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { currentDirectory } from '../../src/auth/guards';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { seedDirectory, type TestHub } from '../helpers/test-hub';
import { openDay, voidsMenu } from '../voids/fixtures';
import { answer, appendOrder, billingDirectory, dineInTwoRounds, FX, post, signIn, STAFF, startBilling, takeawayOrder, VX, type Reply, type Who } from './fixtures';

let hub: TestHub;
let cashier: Who;
let manager: Who;
let waiter: Who;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;

// ------------------------------------------------------------------------------------------------ set-up

/** The built-in PK document with `service_charge_bp` for dine-in and takeaway (no taxes: the charge alone is checked). */
function billingDoc(sc_bp: { dine_in: number; takeaway?: number }): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  return SnapshotBillingSchema.parse({
    ...pk.settings,
    service_charge_bp: { ...pk.settings.service_charge_bp, dine_in: sc_bp.dine_in, takeaway: sc_bp.takeaway ?? 0 },
    jurisdiction: pk.jurisdiction,
    tax_profiles: [],
  });
}

function menuWith(sc_bp: { dine_in: number; takeaway?: number }): BranchConfig {
  return { ...voidsMenu(), billing: billingDoc(sc_bp) };
}

/** Swaps the branch config in place (same business day): a settings change after the bill opened. */
function setRate(sc_bp: { dine_in: number; takeaway?: number }): void {
  const config = menuWith(sc_bp);
  swapBranchConfig({ config, snapshotHash: 'e'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: hub.clock.branchNow() });
}

/** The real handlers under test-only names, so their own statements are counted (02a SG-3 / 02b comp pattern). */
function counted(def: typeof RemoveServiceCharge | typeof ApplyServiceCharge, commandType: string): typeof RemoveServiceCharge {
  const base = def as unknown as typeof RemoveServiceCharge;
  return defineCommand({
    ...base,
    commandType,
    handle(...args: Parameters<typeof base.handle>) {
      const before = counter.count;
      try {
        return base.handle(...args);
      } finally {
        lastStatements = counter.count - before;
      }
    },
  });
}

async function start(o: { sc_bp?: { dine_in: number; takeaway?: number } } = {}): Promise<void> {
  hub = await startBilling({ open: false });
  openDay(hub, { menu: menuWith(o.sc_bp ?? { dine_in: 1_000 }), stock: { [FX.stock]: 0, [VX.naanStock]: 0 } });
  commandRegistry(hub.app).register(counted(RemoveServiceCharge, 'TestRemoveServiceChargeCounted'));
  commandRegistry(hub.app).register(counted(ApplyServiceCharge, 'TestApplyServiceChargeCounted'));
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
});

// ------------------------------------------------------------------------------------------------ helpers

const remove = (who: Who, payload: Record<string, unknown>, commandId?: string): Promise<Reply> =>
  post(hub, who, 'remove-service-charge', 'RemoveServiceCharge', payload, commandId);
const reAdd = (who: Who, payload: Record<string, unknown>): Promise<Reply> => post(hub, who, 'apply-service-charge', 'ApplyServiceCharge', payload);
const removeCounted = (who: Who, payload: Record<string, unknown>): Promise<Reply> =>
  post(hub, who, 'test-remove-service-charge-counted', 'TestRemoveServiceChargeCounted', payload);
const reAddCounted = (who: Who, payload: Record<string, unknown>): Promise<Reply> =>
  post(hub, who, 'test-apply-service-charge-counted', 'TestApplyServiceChargeCounted', payload);

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

function billRow(bill_id: string): { sc_bp: number; sc_removed: number; state: string } {
  return hub.deps.db.prepare('SELECT sc_bp, sc_removed, state FROM bills WHERE bill_id = ?').get(bill_id) as { sc_bp: number; sc_removed: number; state: string };
}

function textOf(subject_id: string): string | undefined {
  return (hub.deps.db.prepare(`SELECT text FROM bill_texts WHERE subject_id = ? AND field = 'note'`).get(subject_id) as { text: string } | undefined)?.text;
}

/** In-test events on any stream (the real folds), clock +1 s; each payload parsed by its schema. */
function appendOn(stream_type: 'bill' | 'table', stream_id: string, def: EventDef<z.ZodType>, payload: unknown): void {
  hub.clock.advance(1_000);
  const draft = draftOf(def, { stream_type, stream_id, payload: def.payload.parse(payload), occurred_at: hub.clock.branchNow(), actor_id: STAFF.manager, device_id: 'D_FIXTURE' });
  hub.deps.writer.run((tx) => tx.append([draft]));
}

/** In-test bill-stream events (task 7's fold). */
function appendBill(bill_id: string, def: EventDef<z.ZodType>, payload: unknown): void {
  appendOn('bill', bill_id, def, payload);
}

/** Every table of the hub database except `bill_texts`, and the hub log, that contains `needle` (privacy, H3-5 / H-4). */
function leaksOf(needle: string): string[] {
  const tables = (hub.deps.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'bill_texts'`).all() as Array<{ name: string }>).map((t) => t.name);
  const hits = tables.filter((name) => JSON.stringify(hub.deps.db.prepare(`SELECT * FROM "${name}"`).all()).includes(needle));
  if (hub.logs().includes(needle)) hits.push('hub.logs()');
  return hits;
}

/** The `billing` projection replayed alone from seq 0 (reset first), as projection.int.test.ts does. */
function rebuildBilling(): void {
  hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'billing'`).run();
  const registry = createProjectionRegistry();
  registry.register(billingProjection());
  registry.catchUp(hub.deps.db, hub.deps.config.provisioned!.branch_id);
}

/** A dine-in seating at T4 with two rounds; its bill opened by ApplyServiceCharge's ensure bill (already applied → no change). */
async function openedBill(): Promise<{ seating_id: string; bill_id: string; order_ids: string[] }> {
  const { seating_id, rounds } = dineInTwoRounds(hub);
  // ApplyServiceCharge on a fresh bill: ensure bill opens it (BillOpened + rule ChargeApplied); already applied → no change
  const r = await reAdd(manager, { bill_ref: { seating_id } });
  expect(r.status).toBe(200);
  expect(r.result).toMatchObject({ changed: false });
  return { seating_id, bill_id: r.result!.bill_id as string, order_ids: rounds.map((x) => x.order_id) };
}

const halfUp = (n: number, bp: number): number => Math.floor((n * bp + 5_000) / 10_000);

// ------------------------------------------------------------------------------------------------ tests

describe('[05 §6.8, B8] RemoveServiceCharge — direct (grant allowed)', () => {
  it('[05 #18] the Manager removes: ChargeRemoved { requester, approver null, alert null }; the view drops the charge; again → changed: false, no event', async () => {
    await start();
    const { seating_id, bill_id } = await openedBill();
    const before = await view({ seating_id });
    expect(before.service_charge).toEqual({ rate_bp: 1_000, removed: false });
    expect(before.totals_default.service_charge_minor).toBe(halfUp(before.totals_default.subtotal_minor, 1_000));
    // literal PKR (exponent 2): Karahi 1,200.00 + two naans 30.00 each = 1,260.00; 10 % = 126.00; no tax; step Rs 1
    expect(before.totals_default).toMatchObject({ subtotal_minor: 126_000, service_charge_minor: 12_600, total_minor: 138_600 });

    const r = await remove(manager, { bill_ref: { bill_id }, reason_code: 'customer_request' });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ bill_id, changed: true });
    expect(r.events.map((e) => e.event_type)).toEqual(['ChargeRemoved']);
    expect(r.events[0]).toMatchObject({ stream_type: 'bill', stream_id: bill_id, actor_id: STAFF.manager });
    expect(r.events[0]!.payload).toEqual({
      bill_id,
      charge: 'service',
      reason_code: 'customer_request',
      has_note: false,
      note_id: null,
      requester_staff_id: STAFF.manager,
      approver_staff_id: null,
      alert_id: null,
    });
    expect(billRow(bill_id)).toMatchObject({ sc_removed: 1, sc_bp: 0 });
    const after = await view({ seating_id });
    expect(after.service_charge).toEqual({ rate_bp: 0, removed: true });
    expect(after.totals_default.service_charge_minor).toBe(0);
    expect(after.totals_default.subtotal_minor).toBe(before.totals_default.subtotal_minor);
    expect(after.totals_default.total_minor).toBe(126_000);

    const again = await remove(manager, { bill_ref: { seating_id }, reason_code: 'customer_request' });
    expect(again.status).toBe(200);
    expect(again.result).toEqual({ bill_id, changed: false });
    expect(again.events).toEqual([]);
    expect(eventsOf('ChargeRemoved')).toHaveLength(1);
  });

  it('[05 §6.8, H3-5] a note goes to bill_texts under a minted note_id; the event carries has_note / note_id only, never the text', async () => {
    await start();
    const { bill_id } = await openedBill();
    const r = await remove(manager, { bill_ref: { bill_id }, reason_code: 'other', note: 'Regular guest, owner said so' });
    expect(r.status).toBe(200);
    const p = r.events[0]!.payload as { has_note: boolean; note_id: string };
    expect(p).toMatchObject({ reason_code: 'other', has_note: true });
    expect(p.note_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(textOf(p.note_id)).toBe('Regular guest, owner said so');
    expect(JSON.stringify(r.events)).not.toContain('Regular guest');
  });

  it("[05 §4.4] Zod: 'other' needs a note; a note above 200 characters, an unknown reason or a second ref → 400, nothing written", async () => {
    await start();
    const { seating_id, bill_id } = await openedBill();
    const bad = [
      { bill_ref: { bill_id }, reason_code: 'other' },
      { bill_ref: { bill_id }, reason_code: 'other', note: '   ' },
      { bill_ref: { bill_id }, reason_code: 'customer_request', note: 'x'.repeat(201) },
      { bill_ref: { bill_id }, reason_code: 'too_expensive' },
      { bill_ref: { bill_id, seating_id }, reason_code: 'customer_request' },
    ];
    for (const payload of bad) {
      const r = await remove(manager, payload);
      expect(r.status, JSON.stringify(payload)).toBe(400);
      expect(r.error?.code).toBe('VALIDATION_FAILED');
    }
    expect((await remove(manager, { bill_ref: { bill_id }, reason_code: 'staff_meal', note: 'x'.repeat(200) })).status).toBe(200);
    const apply = await reAdd(manager, { bill_ref: { bill_id }, note: 'x'.repeat(201) });
    expect(apply.status).toBe(400);
    expect(eventsOf('ChargeRemoved')).toHaveLength(1);
  });

  it('[05 §6, B1] on a projected bill: BillOpened + ChargeApplied { rule } + ChargeRemoved in one command; the charge never shows', async () => {
    await start();
    const { seating_id } = dineInTwoRounds(hub);
    const r = await remove(manager, { bill_ref: { seating_id }, reason_code: 'service_complaint' });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['BillOpened', 'ChargeApplied', 'ChargeRemoved']);
    const bill_id = r.events[0]!.stream_id;
    expect(r.result).toEqual({ bill_id, changed: true });
    expect(r.events[1]!.payload).toMatchObject({ source: 'rule', rate_bp: 1_000 });
    expect((await view({ seating_id })).totals_default.service_charge_minor).toBe(0);
  });

  it('[05 §6.8, R-61] a bill opened at rate 0 has no charge applied: remove → changed: false, no ChargeRemoved, no request', async () => {
    await start({ sc_bp: { dine_in: 0 } });
    const { seating_id } = dineInTwoRounds(hub);
    // on the projected bill: ensure bill opens it (BillOpened, no ChargeApplied at rate 0) and nothing else
    const first = await remove(manager, { bill_ref: { seating_id }, reason_code: 'customer_request' });
    expect(first.status).toBe(200);
    expect(first.events.map((e) => e.event_type)).toEqual(['BillOpened']);
    const bill_id = first.events[0]!.stream_id;
    expect(first.result).toEqual({ bill_id, changed: false });
    // on the open bill: nothing at all is written
    const seqBefore = (hub.deps.db.prepare('SELECT MAX(seq) AS s FROM events').get() as { s: number }).s;
    const again = await remove(manager, { bill_ref: { bill_id }, reason_code: 'other', note: 'nothing to remove' });
    expect(again.result).toEqual({ bill_id, changed: false });
    expect(again.events).toEqual([]);
    // the Cashier's ask raises no request either (the no-op answer comes before the grant split)
    const asked = await remove(cashier, { bill_ref: { bill_id }, reason_code: 'customer_request' });
    expect(asked.result).toEqual({ bill_id, changed: false });
    expect((hub.deps.db.prepare('SELECT MAX(seq) AS s FROM events').get() as { s: number }).s).toBe(seqBefore);
    expect(eventsOf('ChargeRemoved')).toEqual([]);
    expect(alerts.listOpen(hub.deps.db, { kind: 'remove_service_charge' })).toEqual([]);
    expect(hub.deps.db.prepare('SELECT COUNT(*) AS n FROM bill_texts').get()).toEqual({ n: 0 });
    expect(billRow(bill_id)).toMatchObject({ sc_bp: 0, sc_removed: 0 });
  });

  it('[05 §6.8, R-61, B8] re-add on a bill opened at rate 0 → changed: false (the rate fixed at open is 0), even after the settings rate rose', async () => {
    await start({ sc_bp: { dine_in: 0 } });
    const { seating_id } = dineInTwoRounds(hub);
    const opened = await reAdd(manager, { bill_ref: { seating_id } });
    expect(opened.events.map((e) => e.event_type)).toEqual(['BillOpened']);
    const bill_id = opened.result!.bill_id as string;
    expect(opened.result).toEqual({ bill_id, changed: false });
    setRate({ dine_in: 800 });
    const a = await reAdd(manager, { bill_ref: { bill_id }, note: 'add it please' });
    expect(a.result).toEqual({ bill_id, changed: false });
    expect(a.events).toEqual([]);
    expect(eventsOf('ChargeApplied')).toEqual([]);
    expect((await view({ bill_id })).totals_default.service_charge_minor).toBe(0);
  });

  it('[05 §3.2, §9] a closed or absorbed bill → 409 BILL_NOT_OPEN { bill_id, state }, for remove and for re-add', async () => {
    await start();
    const { bill_id } = await openedBill();
    appendBill(bill_id, BillClosedEmpty as unknown as EventDef<z.ZodType>, { bill_id, seating_id: null, credit_invoice_ids: [] });
    const r = await remove(manager, { bill_ref: { bill_id }, reason_code: 'customer_request' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
    const a = await reAdd(manager, { bill_ref: { bill_id } });
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
    expect(eventsOf('ChargeRemoved')).toEqual([]);
  });

  it('[05 §6.8, C8] grant first: the Order taker (no remove-service-charge) → 403 before any bill is opened; unknown bill → 404', async () => {
    await start();
    const { seating_id } = dineInTwoRounds(hub);
    const r = await remove(waiter, { bill_ref: { seating_id }, reason_code: 'customer_request' });
    expect(r.status).toBe(403);
    expect(r.error?.code).toBe('PERMISSION_DENIED');
    expect((await reAdd(waiter, { bill_ref: { seating_id } })).status).toBe(403);
    expect(eventsOf('BillOpened')).toEqual([]);
    const missing = await remove(manager, { bill_ref: { bill_id: 'B_NOPE' }, reason_code: 'customer_request' });
    expect(missing.status).toBe(404);
    expect(missing.error).toEqual({ code: 'BILL_NOT_FOUND', details: { bill_id: 'B_NOPE' } });
  });

  it('[05 §6.8, C8] scope last: a test-only my_floors grant (01b offers branch only) is refused outside_scope after the bill checks; nothing written', async () => {
    await start();
    const { seating_id } = dineInTwoRounds(hub);
    const dir = await billingDirectory({ directory_version: 2 });
    await seedDirectory(hub, {
      ...dir,
      roles: dir.roles.map((role) =>
        role.role_id !== 'R_MGR' ? role : { ...role, permissions: role.permissions.map((g) => (g.permission === 'remove-service-charge' ? { ...g, scope: 'my_floors' } : g)) },
      ),
    });
    const r = await remove(manager, { bill_ref: { seating_id }, reason_code: 'customer_request' });
    expect(r.status).toBe(403);
    expect(r.error?.details).toMatchObject({ reason: 'outside_scope' });
    expect(eventsOf('BillOpened')).toEqual([]);
    // the bill checks still come first: an unknown bill is 404, not 403
    expect((await remove(manager, { bill_ref: { bill_id: 'B_NOPE' }, reason_code: 'customer_request' })).status).toBe(404);
  });
});

describe('[05 §6.8, B8] ApplyServiceCharge (re-add)', () => {
  it('[05 #18] remove → re-add: ChargeApplied { source: manual, rate_bp: the order type’s rate }; the view’s charge equals the original', async () => {
    await start();
    const { seating_id, bill_id } = await openedBill();
    const original = (await view({ seating_id })).totals_default;
    await remove(manager, { bill_ref: { bill_id }, reason_code: 'customer_request' });
    const r = await reAdd(manager, { bill_ref: { seating_id }, note: 'Customer changed mind' });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ bill_id, changed: true });
    expect(r.events.map((e) => e.event_type)).toEqual(['ChargeApplied']);
    const p = r.events[0]!.payload as { note_id: string };
    expect(r.events[0]!.payload).toMatchObject({ bill_id, charge: 'service', rate_bp: 1_000, source: 'manual', has_note: true });
    expect(textOf(p.note_id)).toBe('Customer changed mind');
    expect(billRow(bill_id)).toMatchObject({ sc_removed: 0, sc_bp: 1_000 });
    const back = await view({ seating_id });
    expect(back.service_charge).toEqual({ rate_bp: 1_000, removed: false });
    expect(back.totals_default).toEqual(original);
    // already applied → changed: false, no event
    const again = await reAdd(manager, { bill_ref: { bill_id } });
    expect(again.result).toEqual({ bill_id, changed: false });
    expect(again.events).toEqual([]);
  });

  it('[05 §6.8, R-61] re-add while today\'s rate is 0 → changed: false, no ChargeApplied (rate 0 = not applied); the removal stays', async () => {
    await start();
    const { seating_id, bill_id } = await openedBill();
    await remove(manager, { bill_ref: { bill_id }, reason_code: 'customer_request' });
    setRate({ dine_in: 0 });
    const r = await reAdd(manager, { bill_ref: { bill_id }, note: 'add it back' });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ bill_id, changed: false });
    expect(r.events).toEqual([]);
    expect(eventsOf('ChargeApplied').filter((e) => (e.payload as { source: string }).source === 'manual')).toEqual([]);
    expect(hub.deps.db.prepare('SELECT COUNT(*) AS n FROM bill_texts').get()).toEqual({ n: 0 });
    expect(billRow(bill_id)).toMatchObject({ sc_removed: 1, sc_bp: 0 });
    expect((await view({ seating_id })).service_charge).toEqual({ rate_bp: 0, removed: true });
  });

  it('[05 §6.8] "the same right decides both ways", allowed only: the Cashier (requires_approval) → 403, no request, no event', async () => {
    await start();
    const { bill_id } = await openedBill();
    await remove(manager, { bill_ref: { bill_id }, reason_code: 'customer_request' });
    const r = await reAdd(cashier, { bill_ref: { bill_id } });
    expect(r.status).toBe(403);
    expect(r.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'remove-service-charge', grant: 'requires_approval' } });
    expect(alerts.listOpen(hub.deps.db, { kind: 'remove_service_charge' })).toEqual([]);
    expect(eventsOf('ChargeApplied').filter((e) => (e.payload as { source: string }).source === 'manual')).toEqual([]);
  });
});

describe('[05 #18, #19, B8] the charge is sticky', () => {
  it('[05 #18 view / fold half] after a removal: a new round, a settings change, a reopen, a projection rebuild → still removed', async () => {
    await start();
    const { seating_id, bill_id, order_ids } = await openedBill();
    await remove(manager, { bill_ref: { bill_id }, reason_code: 'customer_request' });
    // a new round on the seating
    appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, follow_up: true, lines: [{ order_item_id: 'DI3_N', item_id: FX.naan }] });
    expect((await view({ seating_id })).service_charge).toEqual({ rate_bp: 0, removed: true });
    // a settings change (the rate goes up)
    setRate({ dine_in: 1_500 });
    expect((await view({ seating_id })).totals_default.service_charge_minor).toBe(0);
    // a reopen (task 19's event, folded)
    appendBill(bill_id, BillReopened as unknown as EventDef<z.ZodType>, { ...(aBillReopened().payload as object), bill_id, order_ids, mode: 'full' });
    expect((await view({ bill_id })).service_charge).toEqual({ rate_bp: 0, removed: true });
    expect(billRow(bill_id)).toMatchObject({ sc_removed: 1 });
    // a rebuild from events gives the same row (only ChargeApplied / ChargeRemoved move sc_removed)
    hub.deps.db.prepare('UPDATE bills SET sc_removed = 0, sc_bp = 1000 WHERE bill_id = ?').run(bill_id);
    expect(billRow(bill_id)).toMatchObject({ sc_removed: 0 });
    rebuildBilling();
    expect(billRow(bill_id)).toMatchObject({ sc_removed: 1, sc_bp: 0 });
    expect(eventsOf('ChargeApplied')).toHaveLength(1); // the rule charge at open; nothing re-applied it
  });

  it('[05 #18 merge / seating-split half, §3.9] a merge absorbing a charged seating, then a seating split: the surviving bill stays removed', async () => {
    await start();
    const { seating_id, bill_id } = await openedBill();
    await remove(manager, { bill_ref: { bill_id }, reason_code: 'customer_request' });
    // T5 seated with its own bill, charge applied by rule
    const t5 = dineInTwoRounds(hub, { prefix: 'T5', table_id: VX.tables.T5 });
    const t5bill = (await reAdd(manager, { bill_ref: { seating_id: t5.seating_id } })).result!.bill_id as string;
    expect(billRow(t5bill)).toMatchObject({ sc_bp: 1_000, sc_removed: 0 });
    // 02a TablesMerged: T5's seating into T4's (§3.9: the absorbed bill folds into the surviving one)
    const moved = t5.rounds.map((r) => r.order_id);
    appendOn('table', VX.tables.T4, TablesMerged as unknown as EventDef<z.ZodType>, {
      into_seating_id: seating_id,
      into_table_id: VX.tables.T4,
      table_ids: [VX.tables.T5],
      absorbed_seating_id: t5.seating_id,
      order_ids: moved,
      by_staff_id: STAFF.manager,
    });
    const merged = await view({ seating_id });
    expect(merged.bill_id).toBe(bill_id);
    expect(merged.orders).toEqual(expect.arrayContaining(moved));
    expect(merged.service_charge).toEqual({ rate_bp: 0, removed: true });
    expect(merged.totals_default.service_charge_minor).toBe(0);
    expect(billRow(bill_id)).toMatchObject({ sc_removed: 1, sc_bp: 0 });
    // 02a SeatingSplit: the moved orders go to T6 under a new seating; the surviving bill keeps its removal
    appendOn('table', VX.tables.T4, SeatingSplit as unknown as EventDef<z.ZodType>, {
      from_seating_id: seating_id,
      new_seating_id: 'SEAT_SPLIT',
      to_table_id: VX.tables.T6,
      order_ids: moved,
      by_staff_id: STAFF.manager,
    });
    const after = await view({ bill_id });
    expect(after.service_charge).toEqual({ rate_bp: 0, removed: true });
    expect(after.totals_default.service_charge_minor).toBe(0);
    expect(eventsOf('ChargeRemoved')).toHaveLength(1);
    expect(eventsOf('ChargeApplied')).toHaveLength(2); // the two rule charges at open; none re-applied
  });

  it('[05 #19] the rate is the order type’s at bill creation; a later settings change leaves the open bill’s charge unchanged', async () => {
    await start();
    const { seating_id, bill_id } = await openedBill();
    const at1000 = (await view({ seating_id })).totals_default;
    setRate({ dine_in: 2_000 });
    const later = await view({ seating_id });
    expect(later.service_charge).toEqual({ rate_bp: 1_000, removed: false });
    expect(later.totals_default.service_charge_minor).toBe(at1000.service_charge_minor);
    expect(billRow(bill_id).sc_bp).toBe(1_000);
    // a new bill (another seating) takes the rate in force now
    const t2 = dineInTwoRounds(hub, { prefix: 'T2', table_id: VX.tables.T5 });
    expect((await view({ seating_id: t2.seating_id })).service_charge).toEqual({ rate_bp: 2_000, removed: false });
  });

  it('[05 §6.8] a takeaway bill: ensure bill by order_id; its own order type’s rate', async () => {
    await start({ sc_bp: { dine_in: 1_000, takeaway: 500 } });
    const { order_id } = takeawayOrder(hub, { placed_by: STAFF.orderTaker });
    const r = await remove(manager, { bill_ref: { order_id }, reason_code: 'customer_request' });
    expect(r.events.map((e) => [e.event_type, e.payload.rate_bp ?? null])).toEqual([
      ['BillOpened', null],
      ['ChargeApplied', 500],
      ['ChargeRemoved', null],
    ]);
    const a = await reAdd(manager, { bill_ref: { order_id } });
    expect(a.events.map((e) => e.payload.rate_bp)).toEqual([500]);
  });
});

describe('[05 §3.14, §6.8] RemoveServiceCharge — approval path (grant requires_approval)', () => {
  async function asked(o: { note?: string } = {}): Promise<{ seating_id: string; bill_id: string; alert_id: string; reply: Reply }> {
    const { seating_id, bill_id } = await openedBill();
    const reply = await remove(cashier, { bill_ref: { bill_id }, reason_code: o.note === undefined ? 'service_complaint' : 'other', ...(o.note === undefined ? {} : { note: o.note }) });
    expect(reply.status).toBe(200);
    const alert_id = (reply.result!.pending as { alert_id: string }).alert_id;
    return { seating_id, bill_id, alert_id, reply };
  }

  it('[05 §3.14] the Cashier asks: one remove_service_charge request (values ids / codes only, dedupe remove_sc:<bill>), no ChargeRemoved yet', async () => {
    await start();
    const { bill_id, alert_id, reply } = await asked({ note: 'Waiter was rude' });
    expect(reply.result).toEqual({ bill_id, pending: { alert_id } });
    expect(reply.events.map((e) => e.event_type)).toContain('AlertRaised');
    expect(reply.events.map((e) => e.event_type)).not.toContain('ChargeRemoved');
    const raised = eventsOf('AlertRaised').find((e) => (e.payload as { alert_id: string }).alert_id === alert_id)!;
    const p = raised.payload as { kind: string; values: { note_id: string }; details: unknown; dedupe_key: string; requester_staff_id: string };
    expect(p).toMatchObject({ kind: 'remove_service_charge', subject_stream_type: 'bill', subject_stream_id: bill_id, dedupe_key: `remove_sc:${bill_id}`, requester_staff_id: STAFF.cashier });
    expect(p.values).toEqual({ bill_id, reason_code: 'other', note_id: p.values.note_id, has_note: true });
    expect(p.details).toEqual({ reason: 'other', identifier: 'T4' });
    // the note is written at raise (H3-5) and is never in the request
    expect(textOf(p.values.note_id)).toBe('Waiter was rude');
    expect(JSON.stringify(raised)).not.toContain('rude');
    expect(billRow(bill_id)).toMatchObject({ sc_removed: 0 });
    expect((await view({ bill_id })).open_requests).toEqual([{ kind: 'remove_service_charge', alert_id }]);
  });

  it('[05 §3.14, H6-2] approve through AnswerRequest (Manager PIN): ChargeRemoved { alert_id, requester = Cashier, approver = answerer, the request’s note_id }', async () => {
    await start();
    const { seating_id, bill_id, alert_id, reply } = await asked({ note: 'Waiter was rude' });
    const note_id = (eventsOf('AlertRaised').find((e) => (e.payload as { alert_id: string }).alert_id === alert_id)!.payload as { values: { note_id: string } }).values.note_id;
    void reply;
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(200);
    const removed = a.events.filter((e) => e.event_type === 'ChargeRemoved');
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ stream_type: 'bill', stream_id: bill_id });
    expect(removed[0]!.payload).toEqual({
      bill_id,
      charge: 'service',
      reason_code: 'other',
      has_note: true,
      note_id,
      requester_staff_id: STAFF.cashier,
      approver_staff_id: STAFF.manager,
      alert_id,
    });
    expect(billRow(bill_id)).toMatchObject({ sc_removed: 1 });
    const v = await view({ seating_id });
    expect(v.totals_default.service_charge_minor).toBe(0);
    expect(v.open_requests).toEqual([]);
  });

  it('[05 §3.14, H7-5] reject → no event, the request closes, the charge stays', async () => {
    await start();
    const { seating_id, bill_id, alert_id } = await asked();
    const before = (await view({ seating_id })).totals_default.service_charge_minor;
    const a = await answer(hub, manager, alert_id, 'reject');
    expect(a.status).toBe(200);
    expect(a.events.map((e) => e.event_type)).not.toContain('ChargeRemoved');
    expect(eventsOf('ChargeRemoved')).toEqual([]);
    expect(billRow(bill_id)).toMatchObject({ sc_removed: 0, sc_bp: 1_000 });
    expect((await view({ seating_id })).totals_default.service_charge_minor).toBe(before);
    expect(alerts.listOpen(hub.deps.db, { kind: 'remove_service_charge' })).toEqual([]);
  });

  it('[05 §3.14, H6-2] re-check on approve: the bill closed meanwhile → the answer is refused 409 BILL_NOT_OPEN, nothing written, the request stays open', async () => {
    await start();
    const { bill_id, alert_id } = await asked();
    appendBill(bill_id, BillClosedEmpty as unknown as EventDef<z.ZodType>, { bill_id, seating_id: null, credit_invoice_ids: [] });
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'BILL_NOT_OPEN', details: { bill_id, state: 'closed' } });
    expect(eventsOf('ChargeRemoved')).toEqual([]);
    expect(alerts.listOpen(hub.deps.db, { kind: 'remove_service_charge' }).map((x) => x.alert_id)).toEqual([alert_id]);
    // reject never re-checks: it closes the request
    expect((await answer(hub, manager, alert_id, 'reject')).status).toBe(200);
  });

  it('[05 §3.14, H6-2] re-check on approve: the charge removed meanwhile (the Manager’s direct remove) → the answer is refused, no second ChargeRemoved', async () => {
    await start();
    const { bill_id, alert_id } = await asked();
    expect((await remove(manager, { bill_ref: { bill_id }, reason_code: 'customer_request' })).result).toEqual({ bill_id, changed: true });
    const a = await answer(hub, manager, alert_id, 'approve');
    // owner R-58 (05 v1.0.12 §9): the re-check's own code
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'SERVICE_CHARGE_NOT_APPLIED', details: { bill_id } });
    expect(eventsOf('ChargeRemoved')).toHaveLength(1);
    expect(alerts.listOpen(hub.deps.db, { kind: 'remove_service_charge' }).map((x) => x.alert_id)).toEqual([alert_id]);
  });

  it('[05 §3.14, R-61] re-check on approve: the bill ends at sc_removed = 0, sc_bp = 0 (removed, then a manual rate-0 charge) → 409 SERVICE_CHARGE_NOT_APPLIED', async () => {
    await start();
    const { bill_id, alert_id } = await asked();
    // built from events (R-61 makes a rate-0 re-add unreachable through ApplyServiceCharge): a direct removal, then a
    // manual ChargeApplied at rate 0 — not removed, but no rate, so no charge is applied
    appendBill(bill_id, ChargeRemoved as unknown as EventDef<z.ZodType>, {
      bill_id, charge: 'service', reason_code: 'customer_request', has_note: false, note_id: null,
      requester_staff_id: STAFF.manager, approver_staff_id: null, alert_id: null,
    });
    appendBill(bill_id, ChargeApplied as unknown as EventDef<z.ZodType>, { bill_id, charge: 'service', rate_bp: 0, source: 'manual', has_note: false, note_id: null });
    expect(billRow(bill_id)).toMatchObject({ sc_removed: 0, sc_bp: 0 });
    const a = await answer(hub, manager, alert_id, 'approve');
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'SERVICE_CHARGE_NOT_APPLIED', details: { bill_id } });
    expect(eventsOf('ChargeRemoved')).toHaveLength(1); // the appended one only
    expect(alerts.listOpen(hub.deps.db, { kind: 'remove_service_charge' }).map((x) => x.alert_id)).toEqual([alert_id]);
  });

  it('[05 §3.14] a second ask while one is open: the same request (01d dedupe), no second AlertRaised, no note written', async () => {
    await start();
    const { bill_id, alert_id } = await asked();
    const raisedBefore = eventsOf('AlertRaised').length;
    const textsBefore = (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM bill_texts').get() as { n: number }).n;
    const again = await remove(cashier, { bill_ref: { bill_id }, reason_code: 'other', note: 'second try' });
    // owner R-59 (05 v1.0.12): 200 with the request that is already open, no pending code
    expect(again.status).toBe(200);
    expect(again.result).toEqual({ bill_id, pending: { alert_id } });
    expect(eventsOf('AlertRaised')).toHaveLength(raisedBefore);
    expect((hub.deps.db.prepare('SELECT COUNT(*) AS n FROM bill_texts').get() as { n: number }).n).toBe(textsBefore);
  });

  it('[05 §6.8, D32] a retransmit with the same command_id returns the stored reply: one request, one bill', async () => {
    await start();
    const { seating_id } = dineInTwoRounds(hub);
    const first = await remove(cashier, { bill_ref: { seating_id }, reason_code: 'customer_request' }, 'sc-retransmit');
    const second = await remove(cashier, { bill_ref: { seating_id }, reason_code: 'customer_request' }, 'sc-retransmit');
    expect(second.result).toEqual(first.result);
    expect(eventsOf('BillOpened')).toHaveLength(1);
    expect(alerts.listOpen(hub.deps.db, { kind: 'remove_service_charge' })).toHaveLength(1);
  });
});

describe('[05 §6.8] statement counts (≤ 3 each; 00 envelope excluded)', () => {
  it('[05 §6.8] remove: existing bill 1 (openBillOf); + 1 with a note (bill_texts); already removed 1; projected bill 1', async () => {
    await start();
    const { bill_id } = await openedBill();
    await removeCounted(manager, { bill_ref: { bill_id }, reason_code: 'customer_request' });
    expect(lastStatements).toBe(1);
    await removeCounted(manager, { bill_ref: { bill_id }, reason_code: 'customer_request' });
    expect(lastStatements).toBe(1); // already removed
    await reAddCounted(manager, { bill_ref: { bill_id }, note: 'back on' });
    expect(lastStatements).toBe(2); // openBillOf + bill_texts
    await reAddCounted(manager, { bill_ref: { bill_id } });
    expect(lastStatements).toBe(1); // already applied
    await removeCounted(manager, { bill_ref: { bill_id }, reason_code: 'other', note: 'again' });
    expect(lastStatements).toBe(2);
    const { seating_id } = dineInTwoRounds(hub, { prefix: 'T5', table_id: VX.tables.T5 });
    const fresh = await removeCounted(manager, { bill_ref: { seating_id }, reason_code: 'customer_request' });
    expect(fresh.events.map((e) => e.event_type)).toEqual(['BillOpened', 'ChargeApplied', 'ChargeRemoved']);
    expect(lastStatements).toBe(1);
  });

  it("[05 §6.8] the request path: openBillOf + bill_texts = 2 besides 01d's raise (its own bound, excluded as 02b counts it); a dedupe hit: 1", async () => {
    await start();
    const { bill_id } = await openedBill();
    // 01d's raise statements, measured around the call the handler makes
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
      const r = await removeCounted(cashier, { bill_ref: { bill_id }, reason_code: 'other', note: 'please' });
      expect(r.result).toMatchObject({ pending: { alert_id: expect.any(String) } });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(lastStatements - inRaise).toBe(2); // openBillOf + bill_texts
      await removeCounted(cashier, { bill_ref: { bill_id }, reason_code: 'other', note: 'again' });
      expect(lastStatements - inRaise).toBe(1); // the dedupe hit: openBillOf only, no bill_texts insert
    } finally {
      spy.mockRestore();
    }
  });

  it('[05 §3.14] the kind’s apply on approve: 1 statement (openBillOf), read-only; reject: 0', async () => {
    await start();
    const { bill_id } = await openedBill();
    const r = await remove(cashier, { bill_ref: { bill_id }, reason_code: 'customer_request' });
    const alert_id = (r.result!.pending as { alert_id: string }).alert_id;
    const record = alerts.listOpen(hub.deps.db, { kind: 'remove_service_charge' }).find((x) => x.alert_id === alert_id)!;
    const request = kindOf('remove_service_charge')!.request!;
    const run = (decision: 'approve' | 'reject') =>
      hub.deps.writer.run((tx) => {
        const ctx = {
          tx: readOnlyTx(tx),
          state: tx.state,
          clock: tx.clock,
          ids: tx.ids,
          // an in-person answer on the requester's device: actor = the requester, the answerer named in the facts (01d)
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
    expect(approved.statements).toBe(1);
    expect(approved.out.map((d) => d.event_type)).toEqual(['ChargeRemoved']);
    expect(approved.out.every((d) => (d.payload as { alert_id: string }).alert_id === alert_id)).toBe(true);
    // approver = AnswerFacts.answerer_staff_id, never actor_id (§6.29, 01d)
    expect(approved.out[0]!.payload).toMatchObject({ requester_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager });
    const rejected = run('reject');
    expect(rejected).toEqual({ out: [], statements: 0 });
  });
});

describe('[05 row H-4, H16-7, #43] the note stays out of payload_hash and out of every store but bill_texts', () => {
  it('[05 row H-4] RemoveServiceCharge: the same command_id with only the note changed replays the stored reply (not a mismatch)', async () => {
    await start();
    const { bill_id } = await openedBill();
    const first = await remove(manager, { bill_ref: { bill_id }, reason_code: 'other', note: 'first note' }, 'sc-hash-remove');
    expect(first.status).toBe(200);
    const second = await remove(manager, { bill_ref: { bill_id }, reason_code: 'other', note: 'second note' }, 'sc-hash-remove');
    expect(second.status).toBe(200);
    expect(second.result).toEqual(first.result);
    expect(second.events.map((e) => e.event_type)).toEqual(first.events.map((e) => e.event_type));
    expect(eventsOf('ChargeRemoved')).toHaveLength(1);
    expect((hub.deps.db.prepare('SELECT text FROM bill_texts').all() as Array<{ text: string }>).map((r) => r.text)).toEqual(['first note']);
  });

  it('[05 row H-4] ApplyServiceCharge: the same command_id with only the note changed replays the stored reply', async () => {
    await start();
    const { bill_id } = await openedBill();
    await remove(manager, { bill_ref: { bill_id }, reason_code: 'customer_request' });
    const first = await post(hub, manager, 'apply-service-charge', 'ApplyServiceCharge', { bill_ref: { bill_id }, note: 'first note' }, 'sc-hash-apply');
    const second = await post(hub, manager, 'apply-service-charge', 'ApplyServiceCharge', { bill_ref: { bill_id }, note: 'second note' }, 'sc-hash-apply');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.result).toEqual(first.result);
    expect(eventsOf('ChargeApplied').filter((e) => (e.payload as { source: string }).source === 'manual')).toHaveLength(1);
  });

  it('[05 H3-5, H-4, B30] privacy scan: after raise, a dedupe hit, approve and a re-add with a note, no note text is in any table but bill_texts, nor in the log', async () => {
    await start();
    const { bill_id } = await openedBill();
    const NOTES = ['PRIVNOTE-raise-7Q', 'PRIVNOTE-dedupe-8R', 'PRIVNOTE-readd-9S'];
    const asked = await remove(cashier, { bill_ref: { bill_id }, reason_code: 'other', note: NOTES[0] });
    const alert_id = (asked.result!.pending as { alert_id: string }).alert_id;
    expect((await remove(cashier, { bill_ref: { bill_id }, reason_code: 'other', note: NOTES[1] })).result).toEqual({ bill_id, pending: { alert_id } });
    expect((await answer(hub, manager, alert_id, 'approve')).status).toBe(200);
    expect((await reAdd(manager, { bill_ref: { bill_id }, note: NOTES[2] })).result).toEqual({ bill_id, changed: true });
    // the raise and the re-add wrote their notes; the dedupe hit wrote none
    expect((hub.deps.db.prepare('SELECT text FROM bill_texts ORDER BY text').all() as Array<{ text: string }>).map((r) => r.text)).toEqual([NOTES[0], NOTES[2]]);
    for (const note of NOTES) expect(leaksOf(note), note).toEqual([]);
    // the scan itself sees a table: the shared marker is in bill_texts only
    expect(JSON.stringify(hub.deps.db.prepare('SELECT * FROM bill_texts').all())).toContain('PRIVNOTE');
  });
});
