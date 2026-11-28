// 05 task 24 (05-plan §3 row 24): 05's merge guard (§3.9, row T-1: `BILL_HAS_PAYMENTS` on a merge and a seating
// split) and line guard (B15, row Q-3: `LINE_IN_CLOSED_SPLIT`, 1 statement; ⚠️ G-32 / R-33: every entry of `touched`
// is judged, ids may repeat, the parent deal entry of a part removed / voided alone); R-64 (an amount / equal close
// freezes the whole line). Tests #32 (extended), #56, #57, #10e, #10f (command halves), races.
// Real commands over HTTP through the hub's writer, the real `orders`, `tables` and `billing` folds; real `OpenShift`,
// `SetSplits`, `AddPayment`, `CloseSplit`. In-test pieces (their tasks are not built): a `DiscountApplied` event
// (task 13's event, appended raw), a `BillReopened` + `OrdersUnbilled` pair (task 19's command). Every PKR amount pinned.
import {
  BillReopened,
  DiscountApplied,
  draftOf,
  OrdersUnbilled,
  type EventDef,
} from "@pos/events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { noneAdapter } from "../../src/billing/fiscal/none";
import {
  registerFiscalAdapter,
  resetFiscalAdapters,
} from "../../src/billing/fiscal/port";
import { billLineGuard, billMergeGuard } from "../../src/billing/lanes/guards";
import {
  checkLineGuard,
  resetLineGuard,
  type LineGuardEntry,
} from "../../src/orders/line-guard";
import { checkMergeGuard } from "../../src/tables/merge-guard";
import { swapBranchConfig } from "../../src/sync/branch-config-holder";
import { statementCounter } from "../helpers/statement-counter";
import type { TestHub } from "../helpers/test-hub";
import { toStage } from "../voids/fixtures";
import {
  appendOrder,
  dealX2,
  drawerDevice,
  FX,
  openSeating,
  post,
  signIn,
  signInOn,
  STAFF,
  startBilling,
  VX,
  type Reply,
  type Who,
} from "./fixtures";

let hub: TestHub;
let cashier: Who;
let manager: Who;

beforeEach(() => {
  registerFiscalAdapter(noneAdapter); // CloseSplit resolves the branch adapter (none: the PK built-in)
});

afterEach(async () => {
  swapBranchConfig(null);
  resetFiscalAdapters();
  await hub?.close();
  hub = undefined as unknown as TestHub;
  resetLineGuard(); // the next hub registers 04's and 05's again (registerVoids, registerBilling)
});

async function start(): Promise<void> {
  hub = await startBilling({
    stock: { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000 },
  });
  cashier = signInOn(hub, STAFF.cashier, drawerDevice(hub));
  const shift = await post(hub, cashier, "open-shift", "OpenShift", {
    float_minor: 0,
    as_drawer: true,
  });
  expect(shift.status, JSON.stringify(shift.error)).toBe(200);
  manager = signIn(hub, STAFF.manager);
}

const db = () => hub.deps.db;
const billIdOf = (seating_id: string) =>
  db()
    .prepare(
      "SELECT bill_id FROM bills WHERE seating_id = ? AND absorbed_into IS NULL",
    )
    .pluck()
    .get(seating_id) as string;

let seatNo = 0;
/** An open seating at `table_id` (held by the Manager) with one dine-in round of `lines`. */
function seated(
  table_id: string,
  lines: Array<{ order_item_id: string; item_id: string; quantity?: number }>,
): { seating_id: string; order_id: string } {
  seatNo += 1;
  const seating_id = `SEAT_G${seatNo}`;
  openSeating(hub, { table_id, seating_id, holder_staff_id: STAFF.manager });
  const { order_id } = appendOrder(hub, {
    order_type: "dine_in",
    seating_id,
    placed_by: STAFF.orderTaker,
    lines,
  });
  return { seating_id, order_id };
}

async function splits(
  seating_id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const r = await post(hub, cashier, "set-splits", "SetSplits", {
    bill_ref: { seating_id },
    ...payload,
  });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
}

async function splitTotal(
  seating_id: string,
  split_no: number,
): Promise<number> {
  const res = await hub.app.inject({
    method: "GET",
    url: `/queries/bill?seating_id=${seating_id}`,
    headers: {
      authorization: `Bearer ${cashier.token}`,
      "x-session-token": cashier.sessionToken,
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  const v = (
    res.json() as {
      data: {
        splits: Array<{
          split_no: number;
          totals: { as_paid: { total_minor: number } };
        }>;
      };
    }
  ).data;
  return v.splits.find((s) => s.split_no === split_no)!.totals.as_paid
    .total_minor;
}

function pay(
  seating_id: string,
  split_no: number,
  amount_minor: number,
  expected_due_minor?: number,
): Promise<Reply> {
  return post(hub, cashier, "add-payment", "AddPayment", {
    bill_ref: { seating_id },
    split_no,
    mode_id: "cash",
    direction: "in",
    amount_minor,
    // 05 v1.0.37 §6.9 (R2-1): a race reads the due before it starts (the fixture would read it inside the race)
    ...(expected_due_minor === undefined ? {} : { expected_due_minor }),
  });
}

/** Pays `split_no` its pinned total in cash and closes it. */
async function payAndClose(
  seating_id: string,
  split_no: number,
  total_minor: number,
): Promise<void> {
  expect(await splitTotal(seating_id, split_no)).toBe(total_minor);
  const p = await pay(seating_id, split_no, total_minor);
  expect(p.status, JSON.stringify(p.error)).toBe(200);
  const c = await post(hub, cashier, "close-split", "CloseSplit", {
    bill_ref: { seating_id },
    split_no,
    expected_total_minor: total_minor,
  });
  expect(c.status, JSON.stringify(c.error)).toBe(200);
}

function appendRaw(
  def: EventDef<z.ZodType>,
  stream_type: "bill" | "order",
  stream_id: string,
  payload: unknown,
): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) =>
    tx.append([
      draftOf(def, {
        stream_type,
        stream_id,
        payload: def.payload.parse(payload),
        occurred_at: now,
        actor_id: STAFF.manager,
        device_id: "D_FIXTURE",
      }),
    ]),
  );
}

const closedSplit = (order_item_id: string, bill_id: string, split_no = 1) => ({
  code: "LINE_IN_CLOSED_SPLIT",
  details: { order_item_id, bill_id, split_no },
});
const remove = (
  order_id: string,
  seating_id: string,
  lines: Array<{ order_item_id: string; units?: number }>,
) =>
  post(hub, manager, "remove-items", "RemoveItems", {
    order_id,
    seating_id,
    lines,
  });
const comp = (order_item_id: string, units: number) =>
  post(hub, manager, "comp-line", "CompLine", {
    order_item_id,
    units,
    reason_code: "quality",
  });
const voidItems = (
  order_id: string,
  lines: Array<{ order_item_id: string; units?: number }>,
) =>
  post(hub, manager, "void-items", "VoidItems", {
    order_id,
    reason_code: "customer_changed_mind",
    note: null,
    disposition_note: null,
    lines: lines.map((l) => ({ ...l, disposition: "wastage" })),
  });
const units = (order_item_id: string) =>
  db()
    .prepare(
      "SELECT units - removed_units - voided_units FROM order_lines WHERE order_item_id = ?",
    )
    .pluck()
    .get(order_item_id) as number;

function counted<T>(fn: () => T): { value: T; statements: number } {
  const counter = statementCounter(db());
  counter.reset();
  const value = fn();
  return { value, statements: counter.count };
}

// ================================================================================================= line guard

describe("[05 B15, row Q-3] line guard: LINE_IN_CLOSED_SPLIT on units a closed split invoiced", () => {
  it("[05 #32, #10e] item split {N: 1} closed: CompLine 3 / RemoveItems 3 refused; the open-remainder karahi and 1 naan removed", async () => {
    await start();
    // naan × 3 (Rs 30 each) + karahi; split 1 = 1 naan, split 2 = 2 naans + the karahi
    const s = seated(VX.tables.T4, [
      { order_item_id: "I_N", item_id: FX.naan, quantity: 3 },
      { order_item_id: "I_K", item_id: FX.piece },
    ]);
    await splits(s.seating_id, {
      mode: "items",
      splits: [
        { split_no: 1, lines: [{ order_item_id: "I_N", units: 1 }] },
        {
          split_no: 2,
          lines: [
            { order_item_id: "I_N", units: 2 },
            { order_item_id: "I_K", units: 1 },
          ],
        },
      ],
    });
    await payAndClose(s.seating_id, 1, 3_000);
    const bill_id = billIdOf(s.seating_id);

    const c = await comp("I_N", 3); // comped_after 3 > units_after 3 − closed 1
    expect(c.status).toBe(409);
    expect(c.error).toEqual(closedSplit("I_N", bill_id));
    const r = await remove(s.order_id, s.seating_id, [
      { order_item_id: "I_N", units: 3 },
    ]); // units_after 0 < closed 1
    expect(r.status).toBe(409);
    expect(r.error).toEqual(closedSplit("I_N", bill_id));
    expect(units("I_N")).toBe(3);

    // the open remainder stays editable (B15)
    const k = await remove(s.order_id, s.seating_id, [
      { order_item_id: "I_K" },
    ]);
    expect(k.status, JSON.stringify(k.error)).toBe(200);
    const n = await remove(s.order_id, s.seating_id, [
      { order_item_id: "I_N", units: 1 },
    ]); // units_after 2 ≥ 1
    expect(n.status, JSON.stringify(n.error)).toBe(200);
    expect(units("I_N")).toBe(2);
    expect(await splitTotal(s.seating_id, 2)).toBe(3_000);
  });

  it("[05 #10e, #32 VoidItems / void-preview] {N: 1} closed, {N: 2} open: a 2-unit void → LINE_IN_CLOSED_SPLIT (preview too); a 1-unit void accepted", async () => {
    await start();
    const s = seated(VX.tables.T4, [
      { order_item_id: "V_N", item_id: FX.naan, quantity: 3 },
    ]);
    toStage(hub, s.order_id, ["V_N"], "cooking");
    await splits(s.seating_id, {
      mode: "items",
      splits: [
        { split_no: 1, lines: [{ order_item_id: "V_N", units: 1 }] },
        { split_no: 2, lines: [{ order_item_id: "V_N", units: 2 }] },
      ],
    });
    await payAndClose(s.seating_id, 1, 3_000);
    const bill_id = billIdOf(s.seating_id);

    const preview = await hub.app.inject({
      method: "GET",
      url: `/queries/void-preview?order_id=${s.order_id}&order_item_ids=V_N&units=3`,
      headers: {
        authorization: `Bearer ${manager.token}`,
        "x-session-token": manager.sessionToken,
      },
    });
    expect(preview.statusCode, preview.body).toBe(409);
    expect((preview.json() as { error: unknown }).error).toMatchObject(
      closedSplit("V_N", bill_id),
    );
    const two = await voidItems(s.order_id, [
      { order_item_id: "V_N", units: 3 },
    ]);
    expect(two.status).toBe(409);
    expect(two.error).toEqual(closedSplit("V_N", bill_id));
    const one = await voidItems(s.order_id, [
      { order_item_id: "V_N", units: 1 },
    ]);
    expect(one.status, JSON.stringify(one.error)).toBe(200);
    expect(units("V_N")).toBe(2);
    const again = await voidItems(s.order_id, [
      { order_item_id: "V_N", units: 2 },
    ]); // units_after 0 < closed 1
    expect(again.status).toBe(409);
    expect(again.error).toEqual(closedSplit("V_N", bill_id));
  });

  it("[05 #32 SetLineWeight, #10f] a weight change on a line with closed units → refused (money_changes); on an open-only line → accepted", async () => {
    await start();
    const s = seated(VX.tables.T4, [
      { order_item_id: "W_F", item_id: FX.gram, quantity: 500 },
      { order_item_id: "W_G", item_id: FX.gram, quantity: 500 },
    ]);
    // fish Rs 4,000 per kg: 500 g = Rs 2,000 each
    await splits(s.seating_id, {
      mode: "items",
      splits: [
        { split_no: 1, lines: [{ order_item_id: "W_F", units: 1 }] },
        { split_no: 2, lines: [{ order_item_id: "W_G", units: 1 }] },
      ],
    });
    await payAndClose(s.seating_id, 1, 200_000);
    const w = await post(hub, manager, "set-line-weight", "SetLineWeight", {
      order_item_id: "W_F",
      quantity: 1_000,
    });
    expect(w.status).toBe(409);
    expect(w.error).toEqual(closedSplit("W_F", billIdOf(s.seating_id)));
    const open = await post(hub, manager, "set-line-weight", "SetLineWeight", {
      order_item_id: "W_G",
      quantity: 1_000,
    });
    expect(open.status, JSON.stringify(open.error)).toBe(200);
    expect(await splitTotal(s.seating_id, 2)).toBe(400_000);
  });

  it("[05 #32 RemoveComp, #10f] 3 naans, 1 comped, all 3 closed in split 1: RemoveComp → refused (a residual on 0 open units)", async () => {
    await start();
    const s = seated(VX.tables.T4, [
      { order_item_id: "RC_N", item_id: FX.naan, quantity: 3 },
      { order_item_id: "RC_K", item_id: FX.piece },
    ]);
    expect((await comp("RC_N", 1)).status).toBe(200);
    await splits(s.seating_id, {
      mode: "items",
      splits: [
        { split_no: 1, lines: [{ order_item_id: "RC_N", units: 3 }] },
        { split_no: 2, lines: [{ order_item_id: "RC_K", units: 1 }] },
      ],
    });
    await payAndClose(s.seating_id, 1, 6_000);
    const r = await post(hub, manager, "remove-comp", "RemoveComp", {
      order_item_id: "RC_N",
      reason_code: "wrong_line",
    });
    expect(r.status).toBe(409);
    expect(r.error).toEqual(closedSplit("RC_N", billIdOf(s.seating_id)));
  });

  it("[05 R-64, H1-27] an amount close freezes every line it covers whole: remove 1 naan and comp the karahi both refused", async () => {
    await start();
    const s = seated(VX.tables.T4, [
      { order_item_id: "A_N", item_id: FX.naan, quantity: 2 },
      { order_item_id: "A_K", item_id: FX.piece },
    ]);
    // Rs 60 + Rs 1,200 = Rs 1,260: split 1 Rs 500, split 2 the rest
    await splits(s.seating_id, {
      mode: "amount",
      splits: [
        { split_no: 1, share_minor: 50_000 },
        { split_no: 2, share_minor: 76_000 },
      ],
    });
    await payAndClose(s.seating_id, 1, 50_000);
    const bill_id = billIdOf(s.seating_id);
    const r = await remove(s.order_id, s.seating_id, [
      { order_item_id: "A_N", units: 1 },
    ]);
    expect(r.status).toBe(409);
    expect(r.error).toEqual(closedSplit("A_N", bill_id));
    const c = await comp("A_K", 1);
    expect(c.status).toBe(409);
    expect(c.error).toEqual(closedSplit("A_K", bill_id));
    expect(await splitTotal(s.seating_id, 2)).toBe(76_000);
  });

  it("[05 G-32, R-33] a deal part removed alone moves the deal’s money: the parent deal entry (money_changes) → LINE_IN_CLOSED_SPLIT on the deal", async () => {
    await start();
    openSeating(hub, {
      table_id: VX.tables.T4,
      seating_id: "SEAT_DL",
      holder_staff_id: STAFF.manager,
    });
    const d = dealX2(hub, { seating_id: "SEAT_DL" }); // deal × 2 (Rs 1,200 each): karahi part × 2, naan part × 4
    const n = appendOrder(hub, {
      order_type: "dine_in",
      seating_id: "SEAT_DL",
      placed_by: STAFF.orderTaker,
      follow_up: true,
      lines: [{ order_item_id: "DL_X", item_id: FX.naan }],
    });
    await splits("SEAT_DL", {
      mode: "items",
      splits: [
        {
          split_no: 1,
          lines: [
            { order_item_id: d.deal, units: 1 },
            { order_item_id: d.karahiPart, units: 1 },
            { order_item_id: d.naanPart, units: 2 },
          ],
        },
        {
          split_no: 2,
          lines: [
            { order_item_id: d.deal, units: 1 },
            { order_item_id: d.karahiPart, units: 1 },
            { order_item_id: d.naanPart, units: 2 },
            { order_item_id: "DL_X", units: 1 },
          ],
        },
      ],
    });
    await payAndClose("SEAT_DL", 1, 120_000);
    // the part's own entry passes (4 → 3 units, 2 closed; billed 0); the deal's entry carries money_changes
    const r = await remove(d.order_id, "SEAT_DL", [
      { order_item_id: d.naanPart, units: 1 },
    ]);
    expect(r.status).toBe(409);
    expect(r.error).toEqual(closedSplit(d.deal, billIdOf("SEAT_DL")));
    expect(units(d.naanPart)).toBe(4);
    const other = await remove(n.order_id, "SEAT_DL", [
      { order_item_id: "DL_X" },
    ]);
    expect(other.status, JSON.stringify(other.error)).toBe(200);
  });

  it("[05 #32 after a reopen] BillReopened clears the closed units: the same remove is accepted", async () => {
    await start();
    const s = seated(VX.tables.T4, [
      { order_item_id: "RO_N", item_id: FX.naan, quantity: 3 },
    ]);
    await splits(s.seating_id, {
      mode: "items",
      splits: [
        { split_no: 1, lines: [{ order_item_id: "RO_N", units: 1 }] },
        { split_no: 2, lines: [{ order_item_id: "RO_N", units: 2 }] },
      ],
    });
    await payAndClose(s.seating_id, 1, 3_000);
    const bill_id = billIdOf(s.seating_id);
    expect(
      (
        await remove(s.order_id, s.seating_id, [
          { order_item_id: "RO_N", units: 3 },
        ])
      ).error,
    ).toEqual(closedSplit("RO_N", bill_id));
    appendRaw(BillReopened as unknown as EventDef<z.ZodType>, "bill", bill_id, {
      bill_id,
      order_ids: [s.order_id],
      mode: "full",
      reason_code: "wrong_item_billed",
      has_note: false,
      note_id: null,
      requester_staff_id: STAFF.manager,
      approver_staff_id: null,
      alert_id: null,
    });
    appendRaw(
      OrdersUnbilled as unknown as EventDef<z.ZodType>,
      "order",
      s.order_id,
      { order_ids: [s.order_id], bill_id },
    );
    expect(
      counted(() =>
        billLineGuard(db(), s.order_id, [
          {
            order_item_id: "RO_N",
            units_after: 0,
            comped_after: 0,
            base_after_minor: 0,
            money_changes: false,
          },
        ]),
      ),
    ).toEqual({ value: null, statements: 1 });
    const r = await remove(s.order_id, s.seating_id, [
      { order_item_id: "RO_N", units: 1 },
    ]);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
  });
});

describe("[05 row Q-3, R-16, R-33] line guard: one statement for the whole list; every entry judged", () => {
  /** 3 naans with 1 closed in split 1 (share Rs 30): the guard's rows */
  async function oneClosed(): Promise<{ order_id: string; bill_id: string }> {
    await start();
    const s = seated(VX.tables.T4, [
      { order_item_id: "Q_N", item_id: FX.naan, quantity: 3 },
      { order_item_id: "Q_K", item_id: FX.piece },
    ]);
    await splits(s.seating_id, {
      mode: "items",
      splits: [
        { split_no: 1, lines: [{ order_item_id: "Q_N", units: 1 }] },
        {
          split_no: 2,
          lines: [
            { order_item_id: "Q_N", units: 2 },
            { order_item_id: "Q_K", units: 1 },
          ],
        },
      ],
    });
    await payAndClose(s.seating_id, 1, 3_000);
    return { order_id: s.order_id, bill_id: billIdOf(s.seating_id) };
  }
  const e = (
    order_item_id: string,
    units_after: number,
    base_after_minor: number,
    o: Partial<LineGuardEntry> = {},
  ): LineGuardEntry => ({
    order_item_id,
    units_after,
    comped_after: 0,
    base_after_minor,
    money_changes: false,
    ...o,
  });

  it("[05 row Q-3] each rule: units below closed, comped above the open units, money_changes, residual < 0, residual on 0 open units; else null", async () => {
    const { order_id, bill_id } = await oneClosed();
    const judge = (entry: LineGuardEntry) =>
      billLineGuard(db(), order_id, [entry]);
    expect(judge(e("Q_N", 1, 3_000))).toBeNull(); // units_after 1 = closed 1, residual 0
    expect(judge(e("Q_N", 2, 6_000))).toBeNull();
    expect(judge(e("Q_N", 0, 0))).toEqual(closedSplit("Q_N", bill_id)); // units_after < closed
    expect(judge(e("Q_N", 3, 9_000, { comped_after: 3 }))).toEqual(
      closedSplit("Q_N", bill_id),
    ); // comped > 3 − 1
    expect(judge(e("Q_N", 3, 3_000, { comped_after: 2 }))).toBeNull(); // comped 2 = 3 − 1, residual 0 on 2 open units
    expect(judge(e("Q_N", 3, 9_000, { money_changes: true }))).toEqual(
      closedSplit("Q_N", bill_id),
    );
    expect(judge(e("Q_N", 3, 2_999, { comped_after: 2 }))).toEqual(
      closedSplit("Q_N", bill_id),
    ); // base − closed share < 0
    expect(judge(e("Q_N", 1, 3_001))).toEqual(closedSplit("Q_N", bill_id)); // residual 1 on 0 open units
    expect(judge(e("Q_K", 0, 0, { money_changes: true }))).toBeNull(); // no closed units: never refused
  });

  it("[05 row Q-3] a line held by closed splits 2 and 3 (3 closed first) reports the lowest, split_no 2", async () => {
    await start();
    const s = seated(VX.tables.T4, [
      { order_item_id: "LS_N", item_id: FX.naan, quantity: 3 },
      { order_item_id: "LS_K", item_id: FX.piece },
    ]);
    await splits(s.seating_id, {
      mode: "items",
      splits: [
        { split_no: 1, lines: [{ order_item_id: "LS_N", units: 1 }, { order_item_id: "LS_K", units: 1 }] },
        { split_no: 2, lines: [{ order_item_id: "LS_N", units: 1 }] },
        { split_no: 3, lines: [{ order_item_id: "LS_N", units: 1 }] },
      ],
    });
    await payAndClose(s.seating_id, 3, 3_000);
    await payAndClose(s.seating_id, 2, 3_000);
    const bill_id = billIdOf(s.seating_id);
    expect(billLineGuard(db(), s.order_id, [e("LS_N", 1, 3_000)])).toEqual(closedSplit("LS_N", bill_id, 2)); // 1 < 2 closed
    const r = await remove(s.order_id, s.seating_id, [{ order_item_id: "LS_N", units: 3 }]);
    expect(r.status).toBe(409);
    expect(r.error).toEqual(closedSplit("LS_N", bill_id, 2));
  });

  it("[05 G-32, R-33] ids may repeat: the second entry of an id is judged too (one read of the distinct ids); first refusal wins", async () => {
    const { order_id, bill_id } = await oneClosed();
    const ok = e("Q_N", 2, 6_000);
    const deal = e("Q_N", 3, 9_000, { money_changes: true }); // a parent-deal style entry for the same id
    expect(counted(() => billLineGuard(db(), order_id, [ok, deal]))).toEqual({
      value: closedSplit("Q_N", bill_id),
      statements: 1,
    });
    expect(counted(() => billLineGuard(db(), order_id, [deal, ok]))).toEqual({
      value: closedSplit("Q_N", bill_id),
      statements: 1,
    });
    expect(
      counted(() => billLineGuard(db(), order_id, [e("Q_K", 0, 0), ok, ok])),
    ).toEqual({ value: null, statements: 1 });
    // the first refused entry answers (list order, not id order)
    expect(
      billLineGuard(db(), order_id, [e("Q_K", 1, 120_000), e("Q_N", 0, 0)]),
    ).toEqual(closedSplit("Q_N", bill_id));
  });

  it("[05 R-16] 1 statement at 1 entry and at 40; an empty list reads nothing; behind 04’s guard the list costs 2", async () => {
    const { order_id } = await oneClosed();
    const many = Array.from({ length: 40 }, (_, i) =>
      e(
        i % 2 === 0 ? "Q_N" : "Q_K",
        i % 2 === 0 ? 2 : 1,
        i % 2 === 0 ? 6_000 : 120_000,
      ),
    );
    expect(
      counted(() => billLineGuard(db(), order_id, [many[0]!])).statements,
    ).toBe(1);
    expect(counted(() => billLineGuard(db(), order_id, many))).toEqual({
      value: null,
      statements: 1,
    });
    expect(counted(() => billLineGuard(db(), order_id, []))).toEqual({
      value: null,
      statements: 0,
    });
    expect(counted(() => checkLineGuard(db(), order_id, many))).toEqual({
      value: null,
      statements: 2,
    }); // 04's, then 05's
  });

  it("[05 row Q-3] a CLOSED bill’s closed units are not judged (its order is billed; ORDER_BILLED answers first)", async () => {
    await start();
    const s = seated(VX.tables.T4, [
      { order_item_id: "CL_N", item_id: FX.naan, quantity: 2 },
    ]);
    await splits(s.seating_id, {
      mode: "items",
      splits: [
        { split_no: 1, lines: [{ order_item_id: "CL_N", units: 1 }] },
        { split_no: 2, lines: [{ order_item_id: "CL_N", units: 1 }] },
      ],
    });
    await payAndClose(s.seating_id, 1, 3_000);
    await payAndClose(s.seating_id, 2, 3_000);
    expect(billLineGuard(db(), s.order_id, [e("CL_N", 0, 0)])).toBeNull();
  });
});

// ================================================================================================= merge guard

describe("[05 §3.9, row T-1] merge guard: BILL_HAS_PAYMENTS on a merge and a seating split", () => {
  const mergeT5IntoT4 = (into: string, from: string) =>
    post(hub, manager, "merge-tables", "MergeTables", {
      into_table_id: VX.tables.T4,
      into_seating_id: into,
      table_id: VX.tables.T5,
      table_seating_id: from,
    });

  it("[05 #56] merge with no payments: 200; the absorbed bill folds into the survivor", async () => {
    await start();
    const a = seated(VX.tables.T4, [
      { order_item_id: "M56_K", item_id: FX.piece },
    ]);
    const b = seated(VX.tables.T5, [
      { order_item_id: "M56_N", item_id: FX.naan },
    ]);
    expect(await splitTotal(a.seating_id, 1)).toBe(120_000);
    expect(await splitTotal(b.seating_id, 1)).toBe(3_000);
    const [ba, bb] = [billIdOf(a.seating_id), billIdOf(b.seating_id)];
    const r = await mergeT5IntoT4(a.seating_id, b.seating_id);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(
      db()
        .prepare("SELECT absorbed_into FROM bills WHERE bill_id = ?")
        .pluck()
        .get(bb),
    ).toBe(ba);
  });

  it("[05 #57] merge: a payment on either bill → BILL_HAS_PAYMENTS { bill_id }; a void pending too → 04’s MERGE_BLOCKED_BY_VOID first", async () => {
    for (const side of ["into", "from"] as const) {
      await start();
      const a = seated(VX.tables.T4, [
        { order_item_id: `P${side}_K`, item_id: FX.piece },
      ]);
      const b = seated(VX.tables.T5, [
        { order_item_id: `P${side}_N`, item_id: FX.naan },
      ]);
      const paid = side === "into" ? a.seating_id : b.seating_id;
      expect((await pay(paid, 1, 1_000)).status).toBe(200);
      const r = await mergeT5IntoT4(a.seating_id, b.seating_id);
      expect(r.status, side).toBe(409);
      expect(r.error).toEqual({
        code: "BILL_HAS_PAYMENTS",
        details: { bill_id: billIdOf(paid) },
      });
      expect(
        db()
          .prepare("SELECT COUNT(*) FROM bills WHERE absorbed_into IS NOT NULL")
          .pluck()
          .get(),
      ).toBe(0);
      if (side === "from") {
        toStage(hub, b.order_id, [`P${side}_N`], "cooking");
        const ask = await post(hub, cashier, "void-items", "VoidItems", {
          order_id: b.order_id,
          reason_code: "customer_changed_mind",
          note: null,
          disposition_note: null,
          lines: [{ order_item_id: `P${side}_N`, disposition: "wastage" }],
        });
        expect(ask.status, JSON.stringify(ask.error)).toBe(200);
        const blocked = await mergeT5IntoT4(a.seating_id, b.seating_id);
        expect(blocked.error?.code).toBe("MERGE_BLOCKED_BY_VOID");
      }
      await hub.close();
      hub = undefined as unknown as TestHub;
      resetLineGuard();
    }
  });

  it("[05 §3.9] merge: a discount, a closed split or reopen_count ≥ 1 → BILL_HAS_PAYMENTS", async () => {
    for (const kind of ["discount", "closed_split", "reopened"] as const) {
      await start();
      const a = seated(VX.tables.T4, [
        { order_item_id: `X${kind}_K`, item_id: FX.piece },
      ]);
      const b = seated(VX.tables.T5, [
        { order_item_id: `X${kind}_N`, item_id: FX.naan, quantity: 2 },
      ]);
      await splits(b.seating_id, { mode: "equal", n: 2 }); // a bill command: the bill row exists (ensure bill), no payment
      const bill_id = billIdOf(b.seating_id);
      if (kind === "discount") {
        appendRaw(
          DiscountApplied as unknown as EventDef<z.ZodType>,
          "bill",
          bill_id,
          {
            bill_id,
            kind: "percent",
            value: 1_000,
            amount_minor: 600,
            reason_code: "regular",
            has_note: false,
            note_id: null,
            replaces: false,
            requester_staff_id: STAFF.manager,
            approver_staff_id: null,
            alert_id: null,
          },
        );
      } else if (kind === "closed_split") {
        await payAndClose(b.seating_id, 1, 3_000);
        // the paid split's payment carries its invoice; the split is closed (partly_paid)
      } else {
        appendRaw(
          BillReopened as unknown as EventDef<z.ZodType>,
          "bill",
          bill_id,
          {
            bill_id,
            order_ids: [b.order_id],
            mode: "full",
            reason_code: "wrong_item_billed",
            has_note: false,
            note_id: null,
            requester_staff_id: STAFF.manager,
            approver_staff_id: null,
            alert_id: null,
          },
        );
      }
      const r = await mergeT5IntoT4(a.seating_id, b.seating_id);
      expect(r.status, kind).toBe(409);
      expect(r.error).toEqual({
        code: "BILL_HAS_PAYMENTS",
        details: { bill_id },
      });
      await hub.close();
      hub = undefined as unknown as TestHub;
      resetLineGuard();
    }
  });

  it("[05 #57, H4-3] seating split: payments → BILL_HAS_PAYMENTS; a reopened bill with no payment left → BILL_HAS_PAYMENTS; a clean bill → 200", async () => {
    for (const kind of ["paid", "reopened", "clean"] as const) {
      await start();
      openSeating(hub, {
        table_id: VX.tables.T4,
        seating_id: "SEAT_SP",
        holder_staff_id: STAFF.manager,
      });
      const stay = appendOrder(hub, {
        order_type: "dine_in",
        seating_id: "SEAT_SP",
        placed_by: STAFF.orderTaker,
        lines: [{ order_item_id: `S${kind}_K`, item_id: FX.piece }],
      });
      const move = appendOrder(hub, {
        order_type: "dine_in",
        seating_id: "SEAT_SP",
        placed_by: STAFF.orderTaker,
        follow_up: true,
        lines: [{ order_item_id: `S${kind}_N`, item_id: FX.naan }],
      });
      expect(await splitTotal("SEAT_SP", 1)).toBe(123_000);
      await splits("SEAT_SP", { mode: "equal", n: 2 }); // the bill row exists (ensure bill), no payment
      const bill_id = billIdOf("SEAT_SP");
      if (kind === "paid")
        expect((await pay("SEAT_SP", 1, 1_000)).status).toBe(200);
      if (kind === "reopened") {
        appendRaw(
          BillReopened as unknown as EventDef<z.ZodType>,
          "bill",
          bill_id,
          {
            bill_id,
            order_ids: [stay.order_id, move.order_id],
            mode: "full",
            reason_code: "wrong_item_billed",
            has_note: false,
            note_id: null,
            requester_staff_id: STAFF.manager,
            approver_staff_id: null,
            alert_id: null,
          },
        );
      }
      const r = await post(hub, manager, "split-seating", "SplitSeating", {
        from_table_id: VX.tables.T4,
        seating_id: "SEAT_SP",
        to_table_id: VX.tables.T6,
        order_ids: [move.order_id],
      });
      if (kind === "clean") {
        expect(r.status, JSON.stringify(r.error)).toBe(200);
      } else {
        expect(r.status, kind).toBe(409);
        expect(r.error).toEqual({
          code: "BILL_HAS_PAYMENTS",
          details: { bill_id },
        });
      }
      await hub.close();
      hub = undefined as unknown as TestHub;
      resetLineGuard();
    }
  });

  it("[05 row T-1] 1 statement blocked or not; a seating with no bill → null; the list behind 04’s costs 2", async () => {
    await start();
    const a = seated(VX.tables.T4, [
      { order_item_id: "MS_K", item_id: FX.piece },
    ]);
    const b = seated(VX.tables.T5, [
      { order_item_id: "MS_N", item_id: FX.naan },
    ]);
    expect(await splitTotal(a.seating_id, 1)).toBe(120_000);
    expect(await splitTotal(b.seating_id, 1)).toBe(3_000);
    expect(
      counted(() =>
        billMergeGuard(db(), { seating_ids: [a.seating_id, b.seating_id] }),
      ),
    ).toEqual({ value: null, statements: 1 });
    expect(
      counted(() => billMergeGuard(db(), { seating_ids: ["SEAT_NONE"] })),
    ).toEqual({ value: null, statements: 1 });
    expect((await pay(b.seating_id, 1, 1_000)).status).toBe(200);
    const hit = {
      code: "BILL_HAS_PAYMENTS",
      details: { bill_id: billIdOf(b.seating_id) },
    };
    expect(
      counted(() =>
        billMergeGuard(db(), { seating_ids: [a.seating_id, b.seating_id] }),
      ),
    ).toEqual({ value: hit, statements: 1 });
    expect(
      counted(() =>
        billMergeGuard(db(), {
          seating_ids: [b.seating_id],
          order_ids: [b.order_id],
        }),
      ),
    ).toEqual({ value: hit, statements: 1 });
    expect(
      counted(() =>
        checkMergeGuard(db(), { seating_ids: [a.seating_id, b.seating_id] }),
      ),
    ).toEqual({ value: hit, statements: 2 });
  });

  it("[05 row T-1] both bills block: the first bill in seating_ids order answers (merge: the survivor S first)", async () => {
    await start();
    const a = seated(VX.tables.T4, [{ order_item_id: "MB_K", item_id: FX.piece }]);
    const b = seated(VX.tables.T5, [{ order_item_id: "MB_N", item_id: FX.naan }]);
    expect((await pay(b.seating_id, 1, 1_000)).status).toBe(200);
    expect((await pay(a.seating_id, 1, 1_000)).status).toBe(200);
    const [ba, bb] = [billIdOf(a.seating_id), billIdOf(b.seating_id)];
    expect(billMergeGuard(db(), { seating_ids: [a.seating_id, b.seating_id] })).toEqual({ code: "BILL_HAS_PAYMENTS", details: { bill_id: ba } });
    expect(billMergeGuard(db(), { seating_ids: [b.seating_id, a.seating_id] })).toEqual({ code: "BILL_HAS_PAYMENTS", details: { bill_id: bb } });
    // MergeTables asks [into, other]: T4's bill answers, though T5's was paid first
    const r = await post(hub, manager, "merge-tables", "MergeTables", { into_table_id: VX.tables.T4, into_seating_id: a.seating_id, table_id: VX.tables.T5, table_seating_id: b.seating_id });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: "BILL_HAS_PAYMENTS", details: { bill_id: ba } });
  });
});

// ================================================================================================= races

describe("[05 HIGH: races] guards inside the single writer: each pair serialises into one legal order", () => {
  const mergeT5IntoT4 = (into: string, from: string) =>
    post(hub, manager, "merge-tables", "MergeTables", {
      into_table_id: VX.tables.T4,
      into_seating_id: into,
      table_id: VX.tables.T5,
      table_seating_id: from,
    });

  /** Starts the two requests in the given order (each its own function, so the first really reaches the writer first). */
  async function race<A, B>(first: "a" | "b", a: () => Promise<A>, b: () => Promise<B>): Promise<[A, B]> {
    if (first === "a") {
      const pa = a();
      const pb = b();
      return [await pa, await pb];
    }
    const pb = b();
    const pa = a();
    return [await pa, await pb];
  }

  it("[05 B15 race] CloseSplit and a RemoveItems of its unit at once, both orders: exactly one wins; the loser's code pinned per order", async () => {
    const winners: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await start();
      const line = `R${i}_N`;
      const s = seated(VX.tables.T4, [{ order_item_id: line, item_id: FX.naan, quantity: 2 }]);
      await splits(s.seating_id, {
        mode: "items",
        splits: [
          { split_no: 1, lines: [{ order_item_id: line, units: 1 }] },
          { split_no: 2, lines: [{ order_item_id: line, units: 1 }] },
        ],
      });
      expect((await pay(s.seating_id, 1, 3_000)).status).toBe(200);
      const bill_id = billIdOf(s.seating_id);
      const closeFirst = i % 2 === 0;
      const [c, r] = await race(
        closeFirst ? "a" : "b",
        () => post(hub, cashier, "close-split", "CloseSplit", { bill_ref: { seating_id: s.seating_id }, split_no: 1, expected_total_minor: 3_000 }),
        () => remove(s.order_id, s.seating_id, [{ order_item_id: line, units: 2 }]),
      );
      if (closeFirst) {
        expect(c.status, JSON.stringify(c.error)).toBe(200);
        expect(r.status).toBe(409);
        expect(r.error).toEqual(closedSplit(line, bill_id));
        expect(units(line)).toBe(2);
      } else {
        expect(r.status, JSON.stringify(r.error)).toBe(200);
        // the removal took the paid unit away: split 1 now holds Rs 0 against Rs 30 paid (§3.3 rule 8)
        expect(c.status).toBe(409);
        expect(c.error).toEqual({ code: "BILL_BALANCE_DUE", details: { split_no: 1, balance_minor: -3_000 } });
        expect(units(line)).toBe(0);
      }
      winners.push(c.status === 200 ? "close" : "remove");
      const closed = db().prepare("SELECT COALESCE(SUM(units), 0) FROM closed_split_units").pluck().get() as number;
      expect(closed).toBeLessThanOrEqual(units(line));
      await hub.close();
      hub = undefined as unknown as TestHub;
      resetLineGuard();
    }
    expect(winners).toEqual(["close", "remove", "close", "remove", "close", "remove"]);
  });

  it("[05 §3.9 race] AddPayment and MergeTables at once, both orders: exactly one wins; never a live payment on an absorbed bill", async () => {
    const winners: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await start();
      const a = seated(VX.tables.T4, [{ order_item_id: `MR${i}_K`, item_id: FX.piece }]);
      const b = seated(VX.tables.T5, [{ order_item_id: `MR${i}_N`, item_id: FX.naan }]);
      expect(await splitTotal(b.seating_id, 1)).toBe(3_000);
      const payFirst = i % 2 === 0;
      const [p, m] = await race(
        payFirst ? "a" : "b",
        () => pay(b.seating_id, 1, 1_000, 3_000),
        () => mergeT5IntoT4(a.seating_id, b.seating_id),
      );
      expect([p.status, m.status].filter((x) => x === 200).length, JSON.stringify([p.error, m.error])).toBe(1);
      if (payFirst) {
        expect(p.status, JSON.stringify(p.error)).toBe(200);
        expect(m.status).toBe(409);
        expect(m.error).toEqual({ code: "BILL_HAS_PAYMENTS", details: { bill_id: billIdOf(b.seating_id) } });
      } else {
        expect(m.status, JSON.stringify(m.error)).toBe(200);
        // S2 was merged away: its table no longer holds an open seating
        expect(p.status).toBe(409);
        expect(p.error).toEqual({ code: "TABLE_NOT_OPEN", details: { table_id: VX.tables.T5 } });
      }
      winners.push(p.status === 200 ? "pay" : "merge");
      expect(
        db()
          .prepare("SELECT COUNT(*) FROM bill_payments p JOIN bills b ON b.bill_id = p.bill_id WHERE b.absorbed_into IS NOT NULL AND p.removed_at IS NULL")
          .pluck()
          .get(),
      ).toBe(0);
      await hub.close();
      hub = undefined as unknown as TestHub;
      resetLineGuard();
    }
    expect(winners).toEqual(["pay", "merge", "pay", "merge", "pay", "merge"]);
  });
});
