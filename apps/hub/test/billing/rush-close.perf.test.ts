// 05 §7 Performance, §11 #45, plan 05 task 45 / M1; budgets from owner ruling R-88 of 2026-11-21 (05 v1.0.27 R-88):
// a 200-bill rush close on the pilot box, CloseSplit with its payment p99 ≤ 100 ms per close, all 200 closes ≤ 60 s.
// 03a AD-32: wall-clock bounds, so this file runs only in the clean measurement (`pnpm test:perf`, project perf-hub,
// real disk), never in the normal gate (apps/hub/vitest.config.ts excludes test/**/*.perf.test.ts). No agent runs it;
// the owner does, on the pilot hub (M1).
//
// Fixture (the billing int tests' own): billingDirectory() over voidsMenu() with one extra table per dine-in bill, the
// built-in PK billing rules (no `billing` key), stock counted high so no line waits on it. 200 open bills, half dine-in
// (a seating with two rounds, dineInTwoRounds: karahi + naan, then a follow-up naan) and half takeaway (two naans),
// alternating, all placed before the first close, as at the end of a rush. One cashier on a drawer kiosk with an open
// drawer shift takes every payment.
//
// One sample = one bill's AddPayment (cash, the cash total, tendered exact) + its CloseSplit (split 1, the
// expected total), each a POST through Fastify inject (schema, pipeline, BEGIN IMMEDIATE, the append, the folds,
// COMMIT with WAL + synchronous=FULL, the reply). The bill view that gives the totals is read untimed before each
// sample. The total is the sum of the 200 samples. Warm-up bills (untimed) absorb the once-per-boot JIT and first-lock cost.
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import type { BranchConfig } from '@pos/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { noneAdapter } from '../../src/billing/fiscal/none';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../src/billing/fiscal/port';
import type { BillView } from '../../src/billing/queries/bill';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';
import { openDay, voidsMenu } from '../voids/fixtures';
import { appendOrder, billingDirectory, dineInTwoRounds, drawerDevice, FX, post, signInOn, STAFF, VX, type Reply, type Who } from './fixtures';

const BILLS = 200; // §7 "200 bills / rush"
const CLOSE_P99_MS = 100; // R-88: CloseSplit with its payment, per close
const TOTAL_MS = 60_000; // R-88: all 200 closes
const WARM_UP = 3; // untimed bills before the 200
const HOOK_MS = 600_000; // a watchdog for the seeding, not a bound
const STOCK = { [FX.stock]: 1_000_000, [VX.naanStock]: 1_000_000 };

const pctl = (xs: readonly number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)]!;
};
const summary = (xs: readonly number[]): string =>
  `p50 ${pctl(xs, 0.5).toFixed(2)} / p99 ${pctl(xs, 0.99).toFixed(2)} / max ${Math.max(...xs).toFixed(2)} ms`;

type BillRef = { seating_id: string } | { order_id: string };

/** voidsMenu() with one table per dine-in bill (RT001 …) on its floor. */
function rushMenu(tables: readonly string[]): BranchConfig {
  const m = voidsMenu();
  const floor = m.floors[0]!;
  const extra = tables.map((table_id, i) => ({ table_id, name: table_id, seats: 4, sort_order: 100 + i, zone_id: null }));
  return { ...m, floors: [{ ...floor, tables: [...floor.tables, ...extra] }, ...m.floors.slice(1)] };
}

describe('[05 #45] 200-bill rush close through the hub (R-88)', () => {
  let hub: TestHub;
  let cashier: Who;
  const bills: BillRef[] = [];

  async function view(ref: BillRef): Promise<BillView> {
    const res = await hub.app.inject({
      method: 'GET',
      url: `/queries/bill?${new URLSearchParams(ref).toString()}`,
      headers: { authorization: `Bearer ${cashier.token}`, 'x-session-token': cashier.sessionToken },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: BillView }).data;
  }

  /** One bill: the untimed view, then the timed payment + close. */
  async function payAndClose(ref: BillRef): Promise<number> {
    const total = (await view(ref)).splits[0]!.totals.cash.total_minor;
    expect(total).toBeGreaterThan(0);
    const started = performance.now();
    const paid: Reply = await post(hub, cashier, 'add-payment', 'AddPayment', {
      bill_ref: ref,
      split_no: 1,
      mode_id: 'cash',
      direction: 'in',
      amount_minor: total,
      tendered_minor: total,
    });
    const closed: Reply = await post(hub, cashier, 'close-split', 'CloseSplit', { bill_ref: ref, split_no: 1, expected_total_minor: total });
    const ms = performance.now() - started;
    expect(paid.status, JSON.stringify(paid.error)).toBe(200);
    expect(closed.status, JSON.stringify(closed.error)).toBe(200);
    expect(closed.events.some((e) => e.event_type === 'InvoiceIssued')).toBe(true);
    return ms;
  }

  beforeAll(async () => {
    // CLAUDE.md: perf runs on the real disk, never tmpfs
    expect(tmpdir().startsWith('/dev/shm'), 'test:perf must not run with TMPDIR=/dev/shm').toBe(false);
    registerFiscalAdapter(noneAdapter);
    const n = WARM_UP + BILLS;
    const dineIn = Array.from({ length: Math.ceil(n / 2) }, (_, i) => `RT${String(i + 1).padStart(3, '0')}`);
    hub = await createTestHub();
    await seedDirectory(hub, await billingDirectory());
    openDay(hub, { menu: rushMenu(dineIn), stock: STOCK });
    cashier = signInOn(hub, STAFF.cashier, drawerDevice(hub, 'Counter kiosk'));
    const shift = await post(hub, cashier, 'open-shift', 'OpenShift', { float_minor: 0, as_drawer: true });
    expect(shift.status, JSON.stringify(shift.error)).toBe(200);
    for (let i = 0; i < n; i += 1) {
      hub.clock.advance(1_000);
      if (i % 2 === 0) {
        const { seating_id } = dineInTwoRounds(hub, { prefix: `R${i}`, table_id: dineIn[i / 2]! });
        bills.push({ seating_id });
      } else {
        const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: `R${i}_N`, item_id: FX.naan, quantity: 2 }] });
        bills.push({ order_id });
      }
    }
  }, HOOK_MS);

  afterAll(async () => {
    swapBranchConfig(null);
    resetFiscalAdapters();
    await hub?.close();
  });

  it(`[05 #45, R-88] ${BILLS} closes (pay + CloseSplit): p99 ≤ ${CLOSE_P99_MS} ms per close, total ≤ ${TOTAL_MS} ms`, async () => {
    for (const ref of bills.slice(0, WARM_UP)) await payAndClose(ref);
    const samples: number[] = [];
    for (const ref of bills.slice(WARM_UP)) samples.push(await payAndClose(ref));
    expect(samples).toHaveLength(BILLS);
    const total = samples.reduce((a, b) => a + b, 0);
    const invoices = hub.deps.db.prepare('SELECT COUNT(*) FROM invoices').pluck().get() as number;
    expect(invoices).toBe(WARM_UP + BILLS);
    process.stderr.write(`[05 #45] ${BILLS} closes (pay + CloseSplit): ${summary(samples)}; total ${total.toFixed(0)} ms\n`);
    expect(pctl(samples, 0.99)).toBeLessThanOrEqual(CLOSE_P99_MS);
    expect(total).toBeLessThanOrEqual(TOTAL_MS);
  }, HOOK_MS);
});
