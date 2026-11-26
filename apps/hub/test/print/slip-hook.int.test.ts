import { TAKEAWAY_SLIP_REPLAY_MS } from '@pos/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clock12 } from '../../src/print/render/jobs';
import { queueTakeawaySlipOnSubmit, slipHookTestHooks, type SubmitSlipInput } from '../../src/print/slip-hook';
import { hubTime } from '../../src/lib/hub-time';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { append as kdsAppend } from '../kds/fixtures';
import { FX, appendOrder, openDay } from '../orders/fixtures';

// 03c v1.0.16 §3.11 trigger 1, §4.2 `queueTakeawaySlipOnSubmit` + `TAKEAWAY_SLIP_REPLAY_MS` (task 32; 02b-TK R6); test 65
// (hook part: replay window, setting, addition rule, printer, SAVEPOINT, statements). The SubmitOrder call site is
// 02b's (S-5). L-ORDERS-1 S-4.

let hub: TestHub;
const logs: Array<{ msg: string; obj: Record<string, unknown> }> = [];
const log = {
  info: (obj: Record<string, unknown>, msg: string) => logs.push({ obj, msg }),
  warn: (obj: Record<string, unknown>, msg: string) => logs.push({ obj, msg }),
} as unknown as Parameters<typeof queueTakeawaySlipOnSubmit>[2]['log'];

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  openDay(hub);
  logs.length = 0;
});
afterEach(async () => {
  delete slipHookTestHooks.beforeBuild;
  swapBranchConfig(null);
  await hub.close();
});

const branch = (): string => hub.deps.config.provisioned!.branch_id;
const routeDefault = () =>
  kdsAppend(
    hub,
    [
      { stream_type: 'hub', stream_id: branch(), event_type: 'PrinterSaved', payload: { printer_id: 'PR_DEF', name: 'Counter', connection: 'lan', address: '192.168.1.60:9100', paper_width_mm: 80, archived: false } },
      { stream_type: 'hub', stream_id: branch(), event_type: 'BillRouteSet', payload: { scope: 'default', ref_id: '', printer_id: 'PR_DEF' } },
    ],
    { actor: null },
  );
const slips = () =>
  hub.deps.db.prepare("SELECT order_id, payload FROM print_jobs WHERE kind = 'document' AND json_extract(payload, '$.kind_label') = 'Token slip' ORDER BY rowid").all() as Array<{ order_id: string; payload: string }>;
const row = (order_id: string) => hub.deps.db.prepare('SELECT token, business_date, placed_at, pickup_at_ms FROM orders WHERE order_id = ?').get(order_id) as { token: number; business_date: string; placed_at: number; pickup_at_ms: number | null };

/** The hook input of an order already appended (as SubmitOrder calls it after its own append). */
function inputOf(order_id: string, o: Partial<SubmitSlipInput> = {}): SubmitSlipInput {
  const r = row(order_id);
  const now = hub.clock.branchNow();
  return { order_id, adds_to_order_id: null, token: r.token, business_date: r.business_date, placed_at: r.placed_at, pickup_at_ms: r.pickup_at_ms, groups: [{ target_land_ms: now + 600_000, promise_ms: now + 660_000 }], device_id: 'D_NONE', queued_at: null, now, ...o };
}
function run(input: SubmitSlipInput): { result: ReturnType<typeof queueTakeawaySlipOnSubmit>; statements: number } {
  const counter = statementCounter(hub.deps.db);
  return hub.deps.writer.run((tx) => {
    counter.reset();
    const result = queueTakeawaySlipOnSubmit(tx, input, { config: hub.deps.config, log });
    return { result, statements: counter.count };
  }).result;
}

describe('[03c #65] queueTakeawaySlipOnSubmit (hook part)', () => {
  it('[03c #65] a root prints in the caller\'s transaction: 3 statements; the Ready line from the submit\'s groups; the job\'s order_id = the order', () => {
    routeDefault();
    const order_id = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    const input = inputOf(order_id);
    const { result, statements } = run(input);
    expect(result).toMatchObject({ printed: true, skipped: null });
    expect(statements).toBe(3);
    const [job] = slips();
    expect(job!.order_id).toBe(order_id);
    const texts = (JSON.parse(job!.payload) as { doc: { blocks: Array<{ text?: string }> } }).doc.blocks.map((b) => b.text);
    expect(texts).toContain(`Ready around ${clock12(input.groups[0]!.promise_ms, hubTime(hub.clock).utc_offset_ms)}`);
    expect(texts[0]).not.toBe('REPRINT');
  });

  it('[03c #65] a pickup with no land after it → the pickup time itself', () => {
    routeDefault();
    const order_id = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    const now = hub.clock.branchNow();
    const pickup = now + 3_600_000;
    run(inputOf(order_id, { pickup_at_ms: pickup, groups: [{ target_land_ms: pickup, promise_ms: pickup + 60_000 }] }));
    const texts = (JSON.parse(slips()[0]!.payload) as { doc: { blocks: Array<{ text?: string }> } }).doc.blocks.map((b) => b.text);
    expect(texts).toContain(`Ready around ${clock12(pickup, hubTime(hub.clock).utc_offset_ms)}`);
  });

  it('[03c #65] queued 60 s before acceptance → prints; 180 s → replay_late (the window is TAKEAWAY_SLIP_REPLAY_MS = 120 000)', () => {
    expect(TAKEAWAY_SLIP_REPLAY_MS).toBe(120_000);
    routeDefault();
    const a = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    const b = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: FX.naan }] }).order_id;
    const now = hub.clock.branchNow();
    expect(run(inputOf(a, { queued_at: now - 60_000 })).result).toMatchObject({ printed: true });
    expect(run(inputOf(b, { queued_at: now - 180_000 })).result).toEqual({ printed: false, job_id: null, skipped: 'replay_late' });
    expect(run(inputOf(b, { queued_at: now - TAKEAWAY_SLIP_REPLAY_MS })).result).toMatchObject({ printed: true }); // bound inclusive
  });

  it('[03c #65] setting off → setting_off (0 statements); no route → no_printer, logged with ids', () => {
    const order_id = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    expect(run(inputOf(order_id))).toEqual({ result: { printed: false, job_id: null, skipped: 'no_printer' }, statements: 1 });
    expect(logs.find((l) => l.msg === 'print.slip.no_printer')!.obj).toMatchObject({ order_id, device_id: 'D_NONE' });
    const config = branchConfig()!;
    swapBranchConfig({ config: { ...config, engine_settings: { ...config.engine_settings, takeaway_slip_on_send: false } }, snapshotHash: 'o'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
    expect(run(inputOf(order_id))).toEqual({ result: { printed: false, job_id: null, skipped: 'setting_off' }, statements: 0 });
  });

  it('[03c #65] an addition with an unbilled root → slip_held; with the root billed → prints on the root\'s order_id, 4 statements', () => {
    routeDefault();
    const root = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'R1', item_id: FX.naan }] }).order_id;
    hub.clock.advance(1_000);
    const add = appendOrder(hub, { order_type: 'takeaway', adds_to_order_id: root, lines: [{ order_item_id: 'R2', item_id: FX.naan }] }).order_id;
    expect(run(inputOf(add, { adds_to_order_id: root })).result).toMatchObject({ printed: false, skipped: 'slip_held' });
    kdsAppend(hub, [{ stream_type: 'order', stream_id: root, event_type: 'OrdersBilled', payload: { order_ids: [root], bill_id: 'BL1' } }]);
    const { result, statements } = run(inputOf(add, { adds_to_order_id: root }));
    expect(result).toMatchObject({ printed: true });
    expect(statements).toBe(4);
    expect(slips().at(-1)!.order_id).toBe(root);
  });

  it('[03c #65] a builder that throws → no job, skipped failed, print.slip.failed logged with ids; the caller\'s transaction commits', () => {
    routeDefault();
    const order_id = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    slipHookTestHooks.beforeBuild = () => {
      throw new Error('injected');
    };
    const before = (hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number);
    const { result } = hub.deps.writer.run((tx) => {
      const r = queueTakeawaySlipOnSubmit(tx, inputOf(order_id), { config: hub.deps.config, log });
      tx.append([{ stream_type: 'order', stream_id: order_id, event_type: 'OrderContactSet', schema_version: 1, payload: { order_id, customer_name: 'A', phone: null }, occurred_at: hub.clock.branchNow(), actor_id: null, device_id: 'hub' }]);
      return r;
    });
    expect(result).toEqual({ printed: false, job_id: null, skipped: 'failed' });
    expect(slips()).toEqual([]);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(before + 1);
    expect(logs.find((l) => l.msg === 'print.slip.failed')!.obj).toMatchObject({ order_id });
  });

  it('[03c #65] the caller\'s transaction rolls back (a later error) → no slip job', () => {
    routeDefault();
    const order_id = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] }).order_id;
    expect(() =>
      hub.deps.writer.run((tx) => {
        expect(queueTakeawaySlipOnSubmit(tx, inputOf(order_id), { config: hub.deps.config, log })).toMatchObject({ printed: true });
        throw new Error('later validation error');
      }),
    ).toThrow('later validation error');
    expect(slips()).toEqual([]);
  });
});
