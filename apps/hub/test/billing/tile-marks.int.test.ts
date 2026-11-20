import type { EventDraft, PosEvent } from '@pos/events';
import { aBillOpened, aBillReopened, aCheckBillPrinted, anInvoiceIssued } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { billingProjection } from '../../src/billing/projections/billing';
import { billTileMarks } from '../../src/billing/tile-marks';
import { createProjectionRegistry } from '../../src/projections/registry';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { statementCounter } from '../helpers/statement-counter';

// 05 §6.4a (R-30, row T-4), #6b reader half: billTileMarks(db, seating_ids) → per seating { reopened, check_printed_at }
// in 1 statement (seatings ⋈ json_each LEFT JOIN bills, open and not absorbed). Real events: 02a TableOpened /
// BillRequested / TablesMerged and the 05 events, folded by the hub's projections.

let hub: TestHub;

beforeEach(async () => {
  hub = await createTestHub();
});

afterEach(async () => {
  await hub.close();
});

type Draft = Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id'>;

function append(...drafts: Draft[]): number {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) => tx.append(drafts.map((x) => ({ ...x, occurred_at: now, actor_id: 'S_CASH', device_id: 'D_FIXTURE' }))));
  return now;
}

const d = (built: PosEvent, payload: Record<string, unknown>): Draft => ({
  stream_type: built.stream_type,
  stream_id: (payload['bill_id'] as string | undefined) ?? built.stream_id,
  event_type: built.event_type,
  schema_version: built.schema_version,
  payload: { ...(built.payload as Record<string, unknown>), ...payload },
});
const table = (table_id: string, event_type: string, payload: Record<string, unknown>): Draft => ({
  stream_type: 'table',
  stream_id: table_id,
  event_type,
  schema_version: 1,
  payload,
});

const seat = (n: number) => `SEAT${n}`;
const openSeat = (n: number): Draft => table(`T${n}`, 'TableOpened', { table_id: `T${n}`, seating_id: seat(n), holder_staff_id: 'S_WAIT', party_size: null });
const opened = (bill_id: string, seating_id: string) => d(aBillOpened(), { bill_id, seating_id });
let invoiceNo = 0;
const close = (bill_id: string) => {
  invoiceNo += 1;
  return d(anInvoiceIssued(), {
    invoice_id: `I${invoiceNo}`,
    number: invoiceNo,
    invoice_ref: `AC1-S${invoiceNo}`,
    bill_id,
    split_no: 1,
    payment_ids: [],
    discount_line_ids: null,
  });
};

const marks = (ids: string[]) => Object.fromEntries(billTileMarks(hub.deps.db, ids));

describe('[05 #6b reader half] billTileMarks', () => {
  it('[05 #6b] reopened while the reopened bill is open; check_printed_at = max(CheckBillPrinted, bill_requested_at); absorbed / closed bills give no mark', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) append(openSeat(n));
    // 1: printed check bill
    append(opened('B1', seat(1)));
    const printedAt = append(d(aCheckBillPrinted(), { bill_id: 'B1' }));
    // 2: RequestBill alone (02a's bill_requested_at)
    const requestedAt = append(table('T2', 'BillRequested', { seating_id: seat(2), table_id: 'T2', by_staff_id: 'S_WAIT' }));
    // 3: reopened (PARTLY_PAID-like: closed then reopened corrections on an open seating), open again
    append(opened('B3', seat(3)));
    append(close('B3'));
    append(d(aBillReopened(), { bill_id: 'B3', mode: 'corrections' }));
    // 4: reopened, then closed again → cleared
    append(opened('B4', seat(4)));
    append(close('B4'));
    append(d(aBillReopened(), { bill_id: 'B4', mode: 'full' }));
    append(close('B4'));
    // 5: printed, then absorbed into 6 → no mark on 5 from the absorbed bill
    append(opened('B5', seat(5)));
    append(d(aCheckBillPrinted(), { bill_id: 'B5' }));
    append(opened('B6', seat(6)));
    append(table('T6', 'TablesMerged', { into_seating_id: seat(6), into_table_id: 'T6', table_ids: ['T5'], absorbed_seating_id: seat(5), order_ids: [], by_staff_id: 'S_MGR' }));
    // the later of the two times wins on seating 1
    const laterRequest = append(table('T1', 'BillRequested', { seating_id: seat(1), table_id: 'T1', by_staff_id: 'S_WAIT' }));

    const ids = [1, 2, 3, 4, 5, 6].map(seat);
    const got = marks(ids);
    const at = (id: string) => got[id] ?? { reopened: false, check_printed_at: null };
    expect(at(seat(1))).toEqual({ reopened: false, check_printed_at: Math.max(printedAt, laterRequest) });
    expect(at(seat(2))).toEqual({ reopened: false, check_printed_at: requestedAt });
    expect(at(seat(3))).toEqual({ reopened: true, check_printed_at: null });
    expect(at(seat(4))).toEqual({ reopened: false, check_printed_at: null });
    expect(at(seat(5))).toEqual({ reopened: false, check_printed_at: null });
    expect(at(seat(6))).toEqual({ reopened: false, check_printed_at: null });
    expect(printedAt).toBeLessThan(laterRequest);
    // a seating with neither mark may be left out, never answered with other keys
    for (const v of Object.values(got)) expect(Object.keys(v).sort()).toEqual(['check_printed_at', 'reopened']);
    expect(marks([])).toEqual({});

    // a rebuild of billing gives the same marks
    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'billing'`).run();
    const registry = createProjectionRegistry();
    registry.register(billingProjection());
    registry.catchUp(hub.deps.db, hub.deps.config.provisioned!.branch_id);
    expect(marks(ids)).toEqual(got);
  });

  it('[05 #6b, #91] 1 statement for 1 and for 40 open seatings', () => {
    const drafts: Draft[] = [];
    for (let n = 1; n <= 40; n += 1) drafts.push(openSeat(n), opened(`B${n}`, seat(n)), d(aCheckBillPrinted(), { bill_id: `B${n}` }));
    append(...drafts);
    const counter = statementCounter(hub.deps.db);
    counter.reset();
    expect(billTileMarks(hub.deps.db, [seat(1)]).size).toBe(1);
    expect(counter.count).toBe(1);
    counter.reset();
    const all = billTileMarks(hub.deps.db, Array.from({ length: 40 }, (_, i) => seat(i + 1)));
    expect(counter.count).toBe(1);
    expect(all.size).toBe(40);
    for (const m of all.values()) expect(m.check_printed_at).toEqual(expect.any(Number));
  });
});
