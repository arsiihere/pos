// 04 §3.1–§3.3 (task v3), plan half of §10 tests 4, 4b–4f, 5, 6, 11, 11b, 13, 14b: voids/plan.ts run inside the hub's
// real writer on real orders (fixtures), its drafts appended and folded as VoidItems / apply will (v4, v7). The command
// half (HTTP, D32, scope, statements of the command) is v4's.
import { DomainError, type VoidDisposition } from '@pos/domain';
import { isOrderInEngine, type EngineState } from '@pos/engine';
import type { EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import type { CommandCtx } from '../../src/commands/registry';
import type { LineChangeDrafts } from '../../src/orders/contracts';
import { readOrder } from '../../src/orders/exports';
import { COMP_KIND } from '../../src/orders/line-change';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { VOID_KIND } from '../../src/voids/contracts';
import { planVoidEntries, voidDrafts, type PlanInput, type PlannedEntry, type VoidEntry } from '../../src/voids/plan';
import { statementCounter } from '../helpers/statement-counter';
import type { TestHub } from '../helpers/test-hub';
import {
  append,
  appendOrder,
  dealX2,
  fireLines,
  FX,
  openDay,
  openSeating,
  optionChildOrder,
  pendingWeight,
  post,
  raiseVoid,
  remakeLine,
  servedColdDrink,
  serveLines,
  setZoneStock,
  signIn,
  STAFF,
  stagedOrder,
  startVoids,
  strictRefold,
  toStage,
  voidsMenu,
  VX,
  waitingT4,
} from './fixtures';

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const state = (): EngineState => hub.deps.state.get();

interface Run {
  entries: VoidEntry[];
  path?: PlanInput['path'];
  move_granted?: boolean;
  frozen?: PlanInput['frozen'];
  alert_id?: string | null;
  stale_comps?: 'close' | 'keep';
  lineChangeDrafts?: LineChangeDrafts;
  /** run only the planner (no drafts, nothing appended) */
  planOnly?: boolean;
}

interface Ran {
  planned: PlannedEntry[];
  drafts: EventDraft[];
  voided: Array<{ order_item_id: string; units: number; refund_minor: number; comp_voided_minor: number; disposition: VoidDisposition | null }>;
  cancelled: boolean;
  /** statements of planVoidEntries / voidDrafts alone (readOrder and listOpen excluded) */
  planStatements: number;
  draftStatements: number;
}

/** readOrder + the two listOpen reads (as VoidItems step 2–3), then the planner and voidDrafts; drafts appended. */
function run(order_id: string, r: Run): Ran {
  return hub.deps.writer.run((tx) => {
    const ctx = {
      tx,
      state: tx.state,
      clock: tx.clock,
      ids: tx.ids,
      actor: { kind: 'device', staffId: STAFF.manager, stationId: null, sessionId: 'SESS_PLAN', deviceId: 'D_PLAN' },
      branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
      permission: null,
      queuedAt: null,
    } as unknown as CommandCtx;
    const { lines } = readOrder(ctx, order_id);
    const subject = { stream_type: 'order', stream_id: order_id };
    const open_voids = alerts.listOpen(tx.db, { kind: VOID_KIND, subject });
    const open_comps = alerts.listOpen(tx.db, { kind: COMP_KIND, subject });
    const counter = statementCounter(tx.db);
    const planned = planVoidEntries({
      order_id,
      lines,
      state: tx.state as EngineState,
      now: tx.clock.branchNow(),
      zone_undo_ms: voidsMenu().engine_settings.zone_undo_ms,
      entries: r.entries,
      path: r.path ?? 'direct',
      open_voids,
      open_comps,
      move_granted: r.move_granted ?? true,
      ...(r.frozen === undefined ? {} : { frozen: r.frozen }),
    });
    const planStatements = counter.count;
    if (r.planOnly === true) return { planned, drafts: [], voided: [], cancelled: false, planStatements, draftStatements: 0 };
    counter.reset();
    const meta = { reason_code: 'quality' as const, note: null, disposition_note: null, requester_staff_id: STAFF.cashier, approver_staff_id: r.alert_id == null ? null : STAFF.manager, alert_id: r.alert_id ?? null };
    const res = voidDrafts(ctx, order_id, planned, meta, { stale_comps: r.stale_comps ?? 'close', ...(r.lineChangeDrafts === undefined ? {} : { lineChangeDrafts: r.lineChangeDrafts }) });
    const draftStatements = counter.count;
    tx.append(res.drafts);
    return { planned, ...res, planStatements, draftStatements };
  }).result;
}

/** The DomainError a run throws (code + details). */
function refusal(order_id: string, r: Run): { code: string; details: Record<string, unknown> } {
  try {
    run(order_id, r);
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, details: e.details };
    throw e;
  }
  throw new Error('expected a refusal');
}

const voidedOf = (x: Ran) => x.drafts.filter((d) => d.event_type === 'ItemVoided').map((d) => [d.payload.order_item_id, d.payload.disposition]);
const types = (x: Ran) => x.drafts.map((d) => d.event_type);
const lineRow = (id: string) =>
  hub.deps.db.prepare('SELECT units, voided_units, refund_minor, comp_voided_minor, refundable_minor FROM order_lines WHERE order_item_id = ?').get(id) as {
    units: number;
    voided_units: number;
    refund_minor: number;
    comp_voided_minor: number;
    refundable_minor: number;
  };

describe('[04 §3.2 rule 4, V1] past stage 1 (plan half)', () => {
  it('[04 #4] engine line at added → 409 ITEM_WRONG_STAGE { added }', async () => {
    hub = await startVoids();
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'A1', item_id: FX.naan }] });
    expect(refusal(order_id, { entries: [{ order_item_id: 'A1', disposition: 'wastage' }] })).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'A1', stage: 'added' } });
  });

  it('[04 #4b] non-engine served drink: voidable, money only, moved refused not_movable_stage, wastage → ItemVoided{drink, wastage}; unserved → added', async () => {
    hub = await startVoids();
    const d = servedColdDrink(hub);
    expect(state().lines[d.drink]).toBeUndefined(); // the engine never held it
    expect(refusal(d.order_id, { entries: [{ order_item_id: d.drink, disposition: 'moved' }] })).toMatchObject({ code: 'VOID_NOT_ALLOWED', details: { reason: 'not_movable_stage' } });
    const x = run(d.order_id, { entries: [{ order_item_id: d.drink, disposition: 'wastage' }] });
    expect(voidedOf(x)[0]).toEqual([d.drink, 'wastage']);
    expect(x.planned[0]!.header_ids).toEqual([]); // not a header (H4-3)
    expect(types(x).filter((t) => t.startsWith('Stock'))).toEqual([]);
    expect(lineRow(d.drink)).toMatchObject({ voided_units: 1, refund_minor: 25_000 });
    const u = servedColdDrink(hub, { prefix: 'DU', served: false });
    expect(refusal(u.order_id, { entries: [{ order_item_id: u.drink, disposition: 'wastage' }] })).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: u.drink, stage: 'added' } });
  });

  it('[04 #4c] option child alone: (i) own engine line cooking under an item at added → voidable by its own stage; (ii) no engine line → judged by its parent', async () => {
    hub = await startVoids();
    const o = optionChildOrder(hub);
    expect(refusal(o.order_id, { entries: [{ order_item_id: o.child, disposition: 'wastage' }] })).toMatchObject({ code: 'ITEM_WRONG_STAGE' });
    toStage(hub, o.order_id, [o.child], 'cooking');
    expect(state().lines[o.item]!.stage).toBe('added');
    expect(voidedOf(run(o.order_id, { entries: [{ order_item_id: o.child, disposition: 'wastage' }] }))).toEqual([[o.child, 'wastage']]);

    // (ii) a station-less option child (synthetic, Q-13) under an engine karahi: the parent's stage decides
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      placed_by: STAFF.orderTaker,
      lines: [
        { order_item_id: 'NC_K', item_id: FX.piece },
        { order_item_id: 'NC_R', option_id: FX.option, parent_order_item_id: 'NC_K', item: { station_id: null } },
      ],
    });
    expect(state().lines.NC_R).toBeUndefined();
    expect(refusal(order_id, { entries: [{ order_item_id: 'NC_R', disposition: 'wastage' }] })).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'NC_R', stage: 'added' } });
    toStage(hub, order_id, ['NC_K'], 'cooking');
    expect(voidedOf(run(order_id, { entries: [{ order_item_id: 'NC_R', disposition: 'wastage' }] }))).toEqual([['NC_R', 'wastage']]);
  });

  it('[04 #4d] item at added with its option child cooking (d′) → voidable; item and child ItemVoided, child as chosen, item null', async () => {
    hub = await startVoids();
    const o = optionChildOrder(hub);
    toStage(hub, o.order_id, [o.child], 'cooking');
    const x = run(o.order_id, { entries: [{ order_item_id: o.item, disposition: 'staff_meal' }] });
    expect(voidedOf(x)).toEqual([
      [o.item, null],
      [o.child, 'staff_meal'],
    ]);
    expect(x.planned[0]!.states).toEqual({ [o.item]: 'not_started', [o.child]: 'cooking' });
  });

  it('[04 #4e] no-engine option child of a served item voided alone with staff_meal → ItemVoided{child, staff_meal}', async () => {
    hub = await startVoids();
    const d = servedColdDrink(hub);
    expect(voidedOf(run(d.order_id, { entries: [{ order_item_id: d.option, disposition: 'staff_meal' }] }))).toEqual([[d.option, 'staff_meal']]);
  });

  it('[04 #4f] served non-engine drink + its non-engine option child, wastage → both wastage (not a header, H5-2)', async () => {
    hub = await startVoids();
    const d = servedColdDrink(hub);
    const x = run(d.order_id, { entries: [{ order_item_id: d.drink, disposition: 'wastage' }] });
    expect(voidedOf(x)).toEqual([
      [d.drink, 'wastage'],
      [d.option, 'wastage'],
    ]);
    expect(x.planned[0]!.line_dispositions).toEqual({ [d.drink]: 'wastage', [d.option]: 'wastage' });
  });

  it('[04 #5] return line (remake): past stage 1 → voided, refund 0, engine line ended; at stage 1 → ITEM_WRONG_STAGE added', async () => {
    hub = await startVoids();
    const m = await remakeLine(hub);
    expect(refusal(m.order_id, { entries: [{ order_item_id: m.remake, disposition: 'wastage' }] })).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: m.remake, stage: 'added' } });
    toStage(hub, m.order_id, [m.remake], 'cooking');
    const x = run(m.order_id, { entries: [{ order_item_id: m.remake, disposition: 'wastage' }] });
    expect(x.voided).toEqual([{ order_item_id: m.remake, units: 1, refund_minor: 0, comp_voided_minor: 0, disposition: 'wastage' }]);
    expect(state().lines[m.remake]?.stage ?? 'voided').toBe('voided');
  });

  it('[04 #6] pending-weight line at cooking → voided, refund 0 (V18)', async () => {
    hub = await startVoids();
    const w = pendingWeight(hub);
    expect(lineRow(w.line).refundable_minor).toBe(0);
    const x = run(w.order_id, { entries: [{ order_item_id: w.line, disposition: 'wastage' }] });
    expect(x.voided).toEqual([{ order_item_id: w.line, units: 1, refund_minor: 0, comp_voided_minor: 0, disposition: 'wastage' }]);
    expect(lineRow(w.line)).toMatchObject({ voided_units: 1, refund_minor: 0 });
  });

  it('[04 #3 plan half, V1 (b)] an abandoned order still in state (fired line never started): voidable (b); the line at added is not started → null; moved refused not_movable_stage', async () => {
    hub = await startVoids();
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'AB_K', item_id: FX.piece }] });
    fireLines(hub, FX.station, ['AB_K']);
    hub.clock.advance(5 * 3_600_000); // past order_abandon_ms (4 h) and the planned land (02b #22)
    expect(isOrderInEngine(state(), order_id, hub.clock.branchNow())).toBe(false);
    expect(state().lines.AB_K).toMatchObject({ stage: 'added' });
    expect(refusal(order_id, { entries: [{ order_item_id: 'AB_K', disposition: 'moved' }] })).toEqual({ code: 'VOID_NOT_ALLOWED', details: { order_item_id: 'AB_K', reason: 'not_movable_stage' } });
    const x = run(order_id, { entries: [{ order_item_id: 'AB_K', disposition: 'wastage' }] });
    expect(voidedOf(x)).toEqual([['AB_K', null]]); // §3.1: an engine line at added (review #130)
    expect(lineRow('AB_K')).toMatchObject({ voided_units: 1 });
  });

  it('[04 V3, §3.1 review #130] a held-but-exited order (abandoned by the clock, still in state): a cooking line with a draw is moved; 03a folds it; strict refold', async () => {
    hub = await startVoids();
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'HX_K', item_id: FX.piece }] });
    toStage(hub, order_id, ['HX_K'], 'cooking');
    hub.clock.advance(5 * 3_600_000);
    expect(isOrderInEngine(state(), order_id, hub.clock.branchNow())).toBe(false);
    expect(state().orders[order_id]).toBeDefined();
    const x = run(order_id, { entries: [{ order_item_id: 'HX_K', disposition: 'moved' }] });
    expect(x.planned[0]!.line_dispositions).toEqual({ HX_K: 'moved' });
    expect(types(x)).toEqual(['ItemMovedToStock', 'StockAdded', 'ItemVoided', 'OrderCancelled']);
    expect(state().stock[FX.stock]).toMatchObject({ on_hand: 500, reserved: 0 });
    expect(strictRefold(hub)).toEqual(state());
  });

  // Reading (u10, 04 v1.0.3 Q-14): was v3's "[04 Q-1 (a)] every non-deal line counts as started"; engine line is now
  // read from order_lines.station_id (§3.1), so the synthetic station-less lines GO_L / GO_H change result.
  it('[04 #4g, Q-14] an order the engine dropped from state: a real station line → started (chosen disposition), moved refused not_movable_stage; a synthetic station-less line → non-engine, not started by served_at (null); a station-less item over an engine option child → header; a served station-less line → started; a deal header is never an engine line', async () => {
    hub = await startVoids();
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      placed_by: STAFF.orderTaker,
      lines: [
        { order_item_id: 'GO_K', item_id: FX.piece },
        // synthetic station on the deal header (the fold copies it): only §3.1's "not a deal" keeps it a non-engine line
        { order_item_id: 'GO_D', deal_id: FX.deal, quantity: 1, item: { station_id: FX.station } },
        { order_item_id: 'GO_P1', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'GO_D' },
        { order_item_id: 'GO_P2', deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: 'GO_D' },
        { order_item_id: 'GO_L', item_id: FX.naan, item: { station_id: null } }, // synthetic (Q-13), unserved
        { order_item_id: 'GO_S', item_id: FX.naan, item: { station_id: null } }, // synthetic (Q-13), served below
        { order_item_id: 'GO_H', item_id: FX.piece, item: { station_id: null } }, // synthetic station-less item …
        { order_item_id: 'GO_HR', option_id: FX.option, parent_order_item_id: 'GO_H' }, // … over an engine option child
      ],
    });
    toStage(hub, order_id, ['GO_K', 'GO_P1', 'GO_HR'], 'cooking');
    serveLines(hub, order_id, ['GO_S']);
    fireLines(hub, FX.station, ['GO_P2']); // no unfired line: the clock can abandon the order
    hub.clock.advance(5 * 3_600_000);
    appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [] }); // the next fold drops the exited order
    expect(state().orders[order_id]).toBeUndefined();
    expect(state().lines.GO_K).toBeUndefined();
    expect(refusal(order_id, { entries: [{ order_item_id: 'GO_K', disposition: 'moved' }] })).toEqual({ code: 'VOID_NOT_ALLOWED', details: { order_item_id: 'GO_K', reason: 'not_movable_stage' } });
    const x = run(order_id, {
      entries: [
        { order_item_id: 'GO_K', disposition: 'staff_meal' },
        { order_item_id: 'GO_D', disposition: 'wastage' },
        { order_item_id: 'GO_L', disposition: 'staff_meal' },
        { order_item_id: 'GO_H', disposition: 'wastage' },
        { order_item_id: 'GO_S', disposition: 'staff_meal' },
      ],
    });
    expect(hub.deps.db.prepare("SELECT station_id FROM order_lines WHERE order_item_id = 'GO_D'").pluck().get()).toBe(FX.station);
    // v3 proxy gave [[], ['GO_D'], [], []] and GO_L 'staff_meal', GO_H 'wastage' (both counted started station lines)
    expect(x.planned.map((e) => e.header_ids)).toEqual([[], ['GO_D'], [], ['GO_H'], []]);
    // the deal header with a station is still not an engine line: not started by its own served_at (null), not "absent → started"
    expect(x.planned[1]!.states.GO_D).toBe('not_started');
    expect(x.planned.map((e) => e.line_dispositions)).toEqual([
      { GO_K: 'staff_meal' },
      { GO_D: null, GO_P1: 'wastage', GO_P2: 'wastage' },
      { GO_L: null },
      { GO_H: null, GO_HR: 'wastage' },
      { GO_S: 'staff_meal' }, // station-less and served → started by served_at
    ]);
  });

  it('[04 V2, review #130] a comped unit is voided last: comp 1 of 2, void both → the uncomped unit to refund_minor, the comped one to comp_voided_minor', async () => {
    hub = await startVoids();
    const mgr = signIn(hub, STAFF.manager);
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'CU', item_id: FX.naan, quantity: 2 }] });
    toStage(hub, order_id, ['CU'], 'cooking');
    const comp = await post(hub, mgr, 'comp-line', 'CompLine', { order_item_id: 'CU', units: 1, reason_code: 'quality' });
    expect(comp.status, JSON.stringify(comp.error)).toBe(200);
    expect(lineRow('CU')).toMatchObject({ refundable_minor: 6_000 });
    const x = run(order_id, { entries: [{ order_item_id: 'CU', disposition: 'wastage' }] });
    expect(x.voided).toEqual([{ order_item_id: 'CU', units: 2, refund_minor: 3_000, comp_voided_minor: 3_000, disposition: 'wastage' }]);
    expect(lineRow('CU')).toMatchObject({ voided_units: 2, refund_minor: 3_000, comp_voided_minor: 3_000 });
  });

  it('[04 #13] zone line within its undo window → ITEM_WRONG_STAGE zone_undo; after it → money only, zone count unchanged', async () => {
    hub = await startVoids();
    setZoneStock(hub, FX.zone, FX.zoneItem, 5);
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEAT_Z' });
    const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_Z', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'Z_C', item_id: FX.zoneItem, from_zone: true }] });
    const zone = () => hub.deps.db.prepare('SELECT on_hand FROM zone_stock WHERE zone_id = ? AND item_id = ?').pluck().get(FX.zone, FX.zoneItem);
    const count = zone();
    expect(refusal(order_id, { entries: [{ order_item_id: 'Z_C', disposition: 'wastage' }] })).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'Z_C', stage: 'zone_undo' } });
    hub.clock.set(hub.clock.branchNow() + voidsMenu().engine_settings.zone_undo_ms + 1);
    const x = run(order_id, { entries: [{ order_item_id: 'Z_C', disposition: 'wastage' }] });
    expect(voidedOf(x)).toEqual([['Z_C', 'wastage']]);
    expect(types(x).filter((t) => t.startsWith('Stock') || t.startsWith('Zone'))).toEqual([]);
    expect(zone()).toBe(count);
  });
});

describe('[04 §3.2 rule 7, V3] dispositions (plan half)', () => {
  it('[04 #11] moved: no draw → stock_not_tracked; served → not_movable_stage; no move-item-to-stock → 403 move_not_granted; day closed → day_closed', async () => {
    hub = await startVoids();
    const s = stagedOrder(hub);
    expect(state().lines[s.cooking]!.draws.length).toBeGreaterThan(0);
    expect(state().lines[s.done]!.draws).toEqual([]);
    expect(refusal(s.order_id, { entries: [{ order_item_id: s.done, disposition: 'moved' }] })).toEqual({ code: 'VOID_NOT_ALLOWED', details: { order_item_id: s.done, reason: 'stock_not_tracked' } });
    expect(refusal(s.order_id, { entries: [{ order_item_id: s.served, disposition: 'moved' }] })).toEqual({ code: 'VOID_NOT_ALLOWED', details: { order_item_id: s.served, reason: 'not_movable_stage' } });
    expect(refusal(s.order_id, { entries: [{ order_item_id: s.cooking, disposition: 'moved' }], move_granted: false })).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'move_not_granted' } });
    append(hub, [{ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: 'BusinessDayClosed', payload: {} }], { actor: STAFF.manager });
    expect(refusal(s.order_id, { entries: [{ order_item_id: s.cooking, disposition: 'moved' }] })).toEqual({ code: 'VOID_NOT_ALLOWED', details: { order_item_id: s.cooking, reason: 'day_closed' } });
    // a non-moved void still goes on a closed day
    expect(voidedOf(run(s.order_id, { entries: [{ order_item_id: s.cooking, disposition: 'wastage' }] }))).toEqual([[s.cooking, 'wastage']]);
  });

  it('[04 #11b] deal partly cooked, moved (OQ-C): cooked part moved, unstarted part null + StockReleased { voided }, header null', async () => {
    // the deal's naan part takes the stock-tracked naan, so the unstarted part holds a reserve (K_NAAN counted 4)
    hub = await startVoids({ open: false });
    openDay(hub, { menu: voidsMenu(), stock: { [FX.stock]: 0, [VX.naanStock]: 4 } });
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      placed_by: STAFF.orderTaker,
      lines: [
        { order_item_id: 'D', deal_id: FX.deal, quantity: 2 },
        { order_item_id: 'D_P1', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'D' },
        { order_item_id: 'D_P2', deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: VX.stockNaan, parent_order_item_id: 'D' },
      ],
    });
    expect(state().lines.D_P2).toMatchObject({ stage: 'added', draws: [{ stock_item_id: VX.naanStock, reserved: 4 }] });
    toStage(hub, order_id, ['D_P1'], 'cooking');
    const x = run(order_id, { entries: [{ order_item_id: 'D', units: 1, disposition: 'moved' }] });
    expect(x.planned[0]!.line_dispositions).toEqual({ D: null, D_P1: 'moved', D_P2: null });
    expect(x.planned[0]!.header_ids).toEqual(['D']);
    expect(x.voided.map((v) => v.refund_minor)).toEqual([0, 114_285, 5_714]); // the spike's §6.8 numbers (01c V11 c)
    expect(voidedOf(x)).toEqual([
      ['D', null],
      ['D_P1', 'moved'],
      ['D_P2', null],
    ]);
    const released = x.drafts.filter((d) => d.event_type === 'StockReleased').map((d) => d.payload);
    expect(released).toEqual([expect.objectContaining({ order_item_id: 'D_P2', stock_item_id: VX.naanStock, quantity: 2, reason: 'voided' })]);
    expect(strictRefold(hub)).toEqual(state());
  });

  it('[04 V3, §3.1 header] a served deal voided as wastage: the header stays null, the parts get wastage (no double wastage)', async () => {
    hub = await startVoids();
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart, d.naanPart], 'served');
    expect(lineRow(d.deal)).toBeDefined();
    const x = run(d.order_id, { entries: [{ order_item_id: d.deal, disposition: 'wastage' }] });
    expect(x.planned[0]!.line_dispositions).toEqual({ [d.deal]: null, [d.karahiPart]: 'wastage', [d.naanPart]: 'wastage' });
  });

  it('[04 V3, §3.1 header] a served station-less item (synthetic, Q-13) with a cooking engine option child: the item is a header (null), the child gets the disposition', async () => {
    hub = await startVoids();
    const { order_id } = appendOrder(hub, {
      order_type: 'takeaway',
      placed_by: STAFF.orderTaker,
      lines: [
        { order_item_id: 'HI_K', item_id: FX.piece, item: { station_id: null } },
        { order_item_id: 'HI_R', option_id: FX.option, parent_order_item_id: 'HI_K' },
      ],
    });
    expect(state().lines.HI_K).toBeUndefined();
    toStage(hub, order_id, ['HI_R'], 'cooking');
    serveLines(hub, order_id, ['HI_K']);
    const x = run(order_id, { entries: [{ order_item_id: 'HI_K', disposition: 'wastage' }] });
    expect(x.planned[0]!.header_ids).toEqual(['HI_K']);
    expect(x.planned[0]!.line_dispositions).toEqual({ HI_K: null, HI_R: 'wastage' });
  });

  it('[04 V3] a touched line not started gets null; moved on a cooking karahi with a draw → moved', async () => {
    hub = await startVoids();
    const s = stagedOrder(hub);
    const x = run(s.order_id, { entries: [{ order_item_id: s.cooking, disposition: 'moved' }], planOnly: true });
    expect(x.planned[0]!.line_dispositions).toEqual({ [s.cooking]: 'moved' });
    expect(x.planned[0]!.states).toEqual({ [s.cooking]: 'cooking' });
  });
});

describe('[04 §3.2 rules 5, 6; working copy] entries', () => {
  it('[04 #14b] overlapping entries on the direct path [deal D ×1, its part P ×1] → P judged on what is left; refunds sum ≤ billed', async () => {
    hub = await startVoids();
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const before = lineRow(d.karahiPart);
    const x = run(d.order_id, {
      entries: [
        { order_item_id: d.deal, units: 1, disposition: 'wastage' },
        { order_item_id: d.karahiPart, units: 1, disposition: 'wastage' },
      ],
    });
    // entry 2 voids the part's last live unit: its remainder share, so the part is refunded exactly its refundable
    const partVoids = x.voided.filter((v) => v.order_item_id === d.karahiPart);
    expect(partVoids.map((v) => v.units)).toEqual([1, 1]);
    expect(partVoids.reduce((s, v) => s + v.refund_minor, 0)).toBe(before.refundable_minor);
    expect(lineRow(d.karahiPart)).toMatchObject({ voided_units: 2, refund_minor: before.refundable_minor });
    const total = x.voided.reduce((s, v) => s + v.refund_minor, 0);
    const refundable = [d.deal, d.karahiPart, d.naanPart].reduce((s, id) => s + lineRow(id).refundable_minor, 0);
    expect(total).toBeLessThanOrEqual(refundable);
    for (const id of [d.deal, d.karahiPart, d.naanPart]) expect(lineRow(id).refund_minor).toBeLessThanOrEqual(lineRow(id).refundable_minor);
    // a third entry on the same part finds no live unit left
    const y = dealX2(hub, { prefix: 'D2' });
    toStage(hub, y.order_id, [y.karahiPart], 'cooking');
    expect(
      refusal(y.order_id, {
        entries: [
          { order_item_id: y.deal, disposition: 'wastage' },
          { order_item_id: y.karahiPart, disposition: 'wastage' },
        ],
      }),
    ).toEqual({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'lines.1.units', message: 'units > live_units' }] } });
  });

  it('[04 #29b] approval path: overlapping entries → 400 overlaps_entry', async () => {
    hub = await startVoids();
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    expect(
      refusal(d.order_id, {
        path: 'approval',
        planOnly: true,
        entries: [
          { order_item_id: d.deal, units: 1, disposition: 'wastage' },
          { order_item_id: d.karahiPart, units: 1, disposition: 'wastage' },
        ],
      }),
    ).toEqual({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'lines.1.order_item_id', message: 'overlaps_entry' }] } });
  });

  it('[04 §3.2 rules 1, 5] foreign line → 400 lines.N.order_item_id; units 0 / above live → 400 lines.N.units', async () => {
    hub = await startVoids();
    const s = stagedOrder(hub);
    expect(refusal(s.order_id, { entries: [{ order_item_id: s.cooking, disposition: 'wastage' }, { order_item_id: 'NOPE', disposition: 'wastage' }] })).toEqual({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: 'lines.1.order_item_id', message: 'not a line of this order' }] },
    });
    expect(refusal(s.order_id, { entries: [{ order_item_id: s.cooking, units: 2, disposition: 'wastage' }] })).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'lines.0.units' }] } });
  });

  it('[04 #19b, #27 plan half] rule 6 (b) on both paths: a touched line in an open void request → VOID_PENDING { alert_id, order_item_id }; apply skips it (own lock)', async () => {
    hub = await startVoids();
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const req = raiseVoid(hub, { requester: signIn(hub, STAFF.cashier), order_id: d.order_id, order_item_id: d.karahiPart, units: 1 });
    for (const path of ['direct', 'approval'] as const) {
      expect(refusal(d.order_id, { path, planOnly: true, entries: [{ order_item_id: d.deal, units: 1, disposition: 'wastage' }] })).toEqual({
        code: 'VOID_PENDING',
        details: { alert_id: req.alert_id, order_item_id: d.karahiPart },
      });
    }
    const x = run(d.order_id, { path: 'apply', planOnly: true, frozen: [req.values.line_dispositions], entries: [{ order_item_id: d.karahiPart, units: 1, disposition: 'wastage' }] });
    expect(x.planned[0]!.touched_ids).toEqual([d.karahiPart]);
  });

  it('[04 #28 plan half] rule 6 (c), approval only: a touched line of a fitting open comp request → COMP_PENDING; a stale one does not block; direct ignores it', async () => {
    hub = await startVoids();
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const cashier = signIn(hub, STAFF.cashier);
    const comp = hub.deps.writer.run((tx) => {
      const ctx = { tx, state: tx.state, clock: tx.clock, ids: tx.ids, actor: { kind: 'device', staffId: STAFF.cashier, stationId: null, sessionId: cashier.sessionId, deviceId: cashier.deviceId }, directory: undefined, permission: null } as unknown as CommandCtx;
      const [r] = alerts.raiseMany(ctx, [
        { kind: COMP_KIND, subject: { stream_type: 'order', stream_id: d.order_id }, target: { kind: 'answerers' }, values: { order_id: d.order_id, order_item_id: d.deal, units: 1, reason_code: 'quality', note: null }, details: { item: 'Deal', quantity: 1, amount: 1, reason: 'quality' }, display: { kind_label_key: 'alert.comp.lock', table_code: null, requester_name: null }, dedupe_key: `comp:${d.deal}`, requester_staff_id: STAFF.cashier, request: { approver_role_ids: [VX.managerRole] } },
      ]);
      tx.append(r!.events);
      return r!;
    }).result;
    // a void request on a deal part while a comp request is open on the deal → COMP_PENDING (H1-7)
    expect(refusal(d.order_id, { path: 'approval', planOnly: true, entries: [{ order_item_id: d.karahiPart, units: 1, disposition: 'wastage' }] })).toEqual({ code: 'COMP_PENDING', details: { alert_id: comp.alert_id } });
    // the direct path does not judge it (lineChangeDrafts closes it, G1-1b)
    expect(run(d.order_id, { planOnly: true, entries: [{ order_item_id: d.karahiPart, units: 1, disposition: 'wastage' }] }).planned).toHaveLength(1);
  });
});

describe('[04 §3.3] voidDrafts', () => {
  it('[04 #10b plan half, §3.3 steps 2–3] two moved entries on one stock item, one waiting T4 line → [move, void] per entry, exactly one StockReserved (one stock pass)', async () => {
    hub = await startVoids();
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'KA', item_id: FX.piece }, { order_item_id: 'KB', item_id: FX.piece }] });
    toStage(hub, order_id, ['KA'], 'cooking');
    toStage(hub, order_id, ['KB'], 'done');
    const t4 = waitingT4(hub);
    const x = run(order_id, { entries: [{ order_item_id: 'KA', disposition: 'moved' }, { order_item_id: 'KB', disposition: 'moved' }] });
    const causes = x.drafts.filter((d) => d.event_type === 'ItemMovedToStock' || d.event_type === 'ItemVoided').map((d) => `${d.event_type} ${String(d.payload.order_item_id)}`);
    expect(causes).toEqual(['ItemMovedToStock KA', 'ItemVoided KA', 'ItemMovedToStock KB', 'ItemVoided KB']);
    const reserved = x.drafts.filter((d) => d.event_type === 'StockReserved').map((d) => d.payload.order_item_id);
    expect(reserved).toEqual([t4.line]);
    expect(x.drafts.filter((d) => d.event_type === 'StockAdded')).toHaveLength(2);
    expect(strictRefold(hub)).toEqual(state());
  });

  it('[04 §3.3 step 2–3] two entries, one moved: [move A, void A, void B] in payload order, one withStockEffects (envelope of drafts[0])', async () => {
    hub = await startVoids();
    const s = stagedOrder(hub);
    const x = run(s.order_id, {
      entries: [
        { order_item_id: s.cooking, disposition: 'moved' },
        { order_item_id: s.served, disposition: 'wastage' },
      ],
    });
    expect(types(x).filter((t) => t === 'ItemMovedToStock' || t === 'ItemVoided')).toEqual(['ItemMovedToStock', 'ItemVoided', 'ItemVoided']);
    expect(voidedOf(x)).toEqual([
      [s.cooking, 'moved'],
      [s.served, 'wastage'],
    ]);
    for (const d of x.drafts) expect([d.actor_id, d.device_id]).toEqual([STAFF.manager, 'D_PLAN']);
    expect(x.drafts.find((d) => d.event_type === 'ItemVoided')!.payload).toMatchObject({ reason_code: 'quality', note: null, disposition_note: null, requester_staff_id: STAFF.cashier, approver_staff_id: null, alert_id: null });
    expect(x.drafts.find((d) => d.event_type === 'ItemMovedToStock')!.payload).not.toHaveProperty('alert_id'); // direct: absent (T-1)
  });

  it('[04 #14 plan half, §3.3 step 4] one lineChangeDrafts: the last live lines → exactly one OrderCancelled; planner 0 statements, voidDrafts 2 (close) / 1 (keep)', async () => {
    hub = await startVoids();
    const s = stagedOrder(hub);
    const all = [s.cooking, s.done, s.served].map((id) => ({ order_item_id: id, disposition: 'wastage' as const }));
    const x = run(s.order_id, { entries: all });
    expect(types(x).filter((t) => t === 'OrderCancelled' || t === 'OrderFoodCleared')).toEqual(['OrderCancelled']);
    expect(x.cancelled).toBe(true);
    expect(x.planStatements).toBe(0);
    expect(x.draftStatements).toBe(2);
    const k = stagedOrder(hub, { prefix: 'K' });
    const y = run(k.order_id, { entries: [{ order_item_id: k.cooking, disposition: 'wastage' }], stale_comps: 'keep', alert_id: 'A_TEST' });
    expect(y.draftStatements).toBe(1);
    expect(y.cancelled).toBe(false);
  });

  it('[04 §3.3 step 5, V5] approval path: alert_id on every draft payload (stock and line-change drafts included)', async () => {
    hub = await startVoids();
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    waitingT4(hub);
    const x = run(d.order_id, { entries: [{ order_item_id: d.deal, disposition: 'moved' }], stale_comps: 'keep', alert_id: 'A_K1' });
    expect(types(x)).toContain('StockReserved');
    expect(types(x)).toContain('OrderCancelled');
    for (const dr of x.drafts) expect(dr.payload.alert_id, dr.event_type).toBe('A_K1');
    expect(x.drafts.find((dr) => dr.event_type === 'ItemVoided')!.payload).toMatchObject({ approver_staff_id: STAFF.manager });
  });

  it('[04 #30 plan half, K-1] keep mode: a stray AlertClosed from an injected lineChangeDrafts → throws, nothing appended', async () => {
    hub = await startVoids();
    const s = stagedOrder(hub);
    const events = () => hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
    const before = events();
    const stray: LineChangeDrafts = (ctx, order_id) => [
      { stream_type: 'order', stream_id: order_id, event_type: 'AlertClosed', schema_version: 1, payload: { alert_id: 'A_COMP', reason: 'obsolete', by_staff_id: null, note: null }, occurred_at: ctx.clock.branchNow(), actor_id: null, device_id: 'D_PLAN' },
    ];
    expect(() => run(s.order_id, { entries: [{ order_item_id: s.cooking, disposition: 'wastage' }], stale_comps: 'keep', alert_id: 'A_X', lineChangeDrafts: stray })).toThrow('K-1');
    expect(events()).toBe(before);
  });

  it('[04 risk row] voidDrafts with a moved line on a closed day → VOID_NOT_ALLOWED day_closed, never openDayStockCtx\'s plain Error', async () => {
    hub = await startVoids();
    const s = stagedOrder(hub);
    const frozen = [{ [s.cooking]: 'moved' as const }];
    append(hub, [{ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: 'BusinessDayClosed', payload: {} }], { actor: STAFF.manager });
    expect(refusal(s.order_id, { path: 'apply', frozen, entries: [{ order_item_id: s.cooking, disposition: 'moved' }], stale_comps: 'keep', alert_id: 'A_D' })).toEqual({
      code: 'VOID_NOT_ALLOWED',
      details: { order_item_id: s.cooking, reason: 'day_closed' },
    });
  });
});

describe('[04 §3.3 step 1, §3.4] apply mode: frozen dispositions (v7 builds on it)', () => {
  it('[04 #26c plan half] OQ-F: a part stored null that started before the approve → wastage; the header stays null', async () => {
    hub = await startVoids();
    const d = dealX2(hub);
    toStage(hub, d.order_id, [d.karahiPart], 'cooking');
    const req = raiseVoid(hub, { requester: signIn(hub, STAFF.cashier), order_id: d.order_id, order_item_id: d.deal, units: 1, disposition: 'wastage' });
    expect(req.values.line_dispositions).toEqual({ [d.deal]: null, [d.karahiPart]: 'wastage', [d.naanPart]: null });
    toStage(hub, d.order_id, [d.naanPart], 'cooking');
    const x = run(d.order_id, { path: 'apply', frozen: [req.values.line_dispositions], entries: [{ order_item_id: d.deal, units: 1, disposition: 'wastage' }], planOnly: true });
    expect(x.planned[0]!.line_dispositions).toEqual({ [d.deal]: null, [d.karahiPart]: 'wastage', [d.naanPart]: 'wastage' });
  });

  it('[04 #26b plan half] OQ-D: a stored moved line served meanwhile → VOID_NOT_ALLOWED { not_movable_stage, hint: withdraw_and_reask }', async () => {
    hub = await startVoids();
    const s = stagedOrder(hub);
    const frozen = [{ [s.cooking]: 'moved' as const }];
    toStage(hub, s.order_id, [s.cooking], 'served');
    expect(refusal(s.order_id, { path: 'apply', frozen, planOnly: true, entries: [{ order_item_id: s.cooking, disposition: 'moved' }] })).toEqual({
      code: 'VOID_NOT_ALLOWED',
      details: { order_item_id: s.cooking, reason: 'not_movable_stage', hint: 'withdraw_and_reask' },
    });
  });
});
