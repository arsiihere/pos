// Lane T1, task t1 — 04 §10 "Money (K-6, raised bar)" tests 40–45, 47–49, with the §6.8 example end to end. Written
// by a session that did not write V1: real orders (fixtures.ts), the real VoidItems (direct: Manager `allowed`;
// approval: Cashier asks the Manager) and 01d's real AnswerRequest, 02b's real CompLine / RemoveItems; every number
// read back from the `orders` projection. Test 46 (the 500-sequence property test) is money.property.int.test.ts.
import { parseEvent, type PosEvent } from '@pos/events';
import type { EngineState } from '@pos/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { registerHubProjections } from '../../src/lib/boot';
import { createProjectionRegistry } from '../../src/projections/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { voidItemsCommand } from '../../src/voids/commands/void-items';
import { statementCounter } from '../helpers/statement-counter';
import type { TestHub } from '../helpers/test-hub';
import { answer, appendOrder, FX, openSeating, post, remakeLine, signIn, STAFF, strictRefold, toStage, voidLine, VX, waitingT4, type Reply } from './fixtures';
import { compLine, linesOf, MX, removeItems, startMoney, sumOf, voidItems } from './money.fixtures';

let hub: TestHub;

afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

const ok = (r: Reply): Reply => {
  expect(r.status, JSON.stringify(r.error)).toBe(200);
  return r;
};
const ofType = (r: Reply, t: string) => r.events.filter((e) => e.event_type === t).map((e) => e.payload);
const takeaway = (lines: Parameters<typeof appendOrder>[1]['lines']) => appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines }).order_id;
const family = (id: string) => [
  { order_item_id: id, deal_id: MX.family, quantity: 1 },
  { order_item_id: `${id}a`, deal_id: MX.family, deal_part_id: MX.familyParts[0], item_id: FX.naan, parent_order_item_id: id },
  { order_item_id: `${id}b`, deal_id: MX.family, deal_part_id: MX.familyParts[1], item_id: FX.naan, parent_order_item_id: id },
];
const odd = (id: string) => [
  { order_item_id: id, deal_id: MX.odd, quantity: 1 },
  { order_item_id: `${id}a`, deal_id: MX.odd, deal_part_id: MX.oddParts[0], item_id: FX.naan, parent_order_item_id: id },
  { order_item_id: `${id}b`, deal_id: MX.odd, deal_part_id: MX.oddParts[1], item_id: FX.naan, parent_order_item_id: id },
];

describe('[04 #40] deal money: part share, then the deal refunds the rest (01c :311)', () => {
  it('[04 #40] family deal ×1 (320 000): void 1 of 4 naan parts → that part share; deal billed = total − it; void the deal → refund = total − parts already refunded; Σ refund = 320 000', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway(family('F1'));
    let l = linesOf(hub, order_id);
    expect(l.get('F1')).toMatchObject({ line_kind: 'deal', units: 1, refundable_minor: 0, billed_minor: 320_000 });
    expect(l.get('F1a')).toMatchObject({ units: 1, refundable_minor: 64_000, billed_minor: 0 });
    expect(l.get('F1b')).toMatchObject({ units: 4, refundable_minor: 256_000, billed_minor: 0 });
    toStage(hub, order_id, ['F1b'], 'served');

    const one = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'F1b', units: 1, disposition: 'wastage' }]));
    expect(ofType(one, 'ItemVoided')).toEqual([expect.objectContaining({ order_item_id: 'F1b', units: 1, refund_minor: 64_000, comp_voided_minor: 0 })]);
    l = linesOf(hub, order_id);
    expect(l.get('F1b')).toMatchObject({ voided_units: 1, refund_minor: 64_000, billed_minor: 0 });
    expect(l.get('F1')!.billed_minor).toBe(320_000 - 64_000);

    const deal = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'F1', disposition: 'wastage' }]));
    // the cascade: the deal's 1 unit, its main part's 1, the 3 naan left (capped at live)
    expect(ofType(deal, 'ItemVoided').map((p) => [p.order_item_id, p.units, p.refund_minor])).toEqual([
      ['F1', 1, 0],
      ['F1a', 1, 64_000],
      ['F1b', 3, 192_000],
    ]);
    expect(sumOf(deal, 'ItemVoided', 'refund_minor')).toBe(320_000 - 64_000);
    expect((deal.result as { voided: Array<{ refund_minor: number }> }).voided.reduce((a, v) => a + v.refund_minor, 0)).toBe(256_000);
    l = linesOf(hub, order_id);
    expect([...l.values()].reduce((a, x) => a + x.refund_minor, 0)).toBe(320_000);
    for (const x of l.values()) expect(x.billed_minor).toBe(0);
    expect(l.get('F1b')).toMatchObject({ voided_units: 4, live_units: 0 });
  });
});

describe('[04 #41] g/ml lines', () => {
  const kgDeal = (id: string) => [
    { order_item_id: id, deal_id: MX.kgDeal, quantity: 2 },
    { order_item_id: `${id}a`, deal_id: MX.kgDeal, deal_part_id: MX.kgParts[0], item_id: MX.kg, parent_order_item_id: id },
    { order_item_id: `${id}b`, deal_id: MX.kgDeal, deal_part_id: MX.kgParts[1], item_id: FX.naan, parent_order_item_id: id },
  ];

  it('[04 #41] kg deal ×2, g part open (cooking): void 1 deal or 1 part unit → 400 gml_deal_part_partial, nothing appended; the g part served → partial allowed by portions', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway(kgDeal('G1'));
    expect(linesOf(hub, order_id).get('G1a')).toMatchObject({ sale_unit: 'g', units: 2 });
    toStage(hub, order_id, ['G1a', 'G1b'], 'cooking');
    const events = () => hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
    const before = events();
    const gml = { code: 'VALIDATION_FAILED', details: { issues: [{ path: 'lines.0.units', message: 'gml_deal_part_partial' }] } };
    const deal = await voidItems(hub, mgr, order_id, [{ order_item_id: 'G1', units: 1, disposition: 'wastage' }]);
    expect([deal.status, deal.error]).toEqual([400, gml]);
    const part = await voidItems(hub, mgr, order_id, [{ order_item_id: 'G1a', units: 1, disposition: 'wastage' }]);
    expect([part.status, part.error]).toEqual([400, gml]);
    expect(events()).toBe(before);

    toStage(hub, order_id, ['G1a'], 'served');
    const served = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'G1', units: 1, disposition: 'wastage' }]));
    const a = linesOf(hub, order_id).get('G1a')!;
    expect(ofType(served, 'ItemVoided').map((p) => [p.order_item_id, p.units])).toEqual([['G1', 1], ['G1a', 1], ['G1b', 2]]);
    expect(a).toMatchObject({ voided_units: 1, live_units: 1, refund_minor: Math.floor(a.refundable_minor / 2) });
    // the deal line total is 2 × 250 000
    expect(linesOf(hub, order_id).get('G1')!.billed_minor).toBe(500_000 - sumOf(served, 'ItemVoided', 'refund_minor'));
  });

  it('[04 #41] g item (1 kg): whole only — units 1 voids it all (refund = its total), units 2 → 400 lines.0.units', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway([{ order_item_id: 'KG', item_id: MX.kg, quantity: 1000 }]);
    toStage(hub, order_id, ['KG'], 'served');
    expect(linesOf(hub, order_id).get('KG')).toMatchObject({ units: 1, refundable_minor: 200_000 });
    const two = await voidItems(hub, mgr, order_id, [{ order_item_id: 'KG', units: 2, disposition: 'wastage' }]);
    expect(two.status).toBe(400);
    expect(two.error!.details).toMatchObject({ issues: [{ path: 'lines.0.units' }] });
    const whole = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'KG', units: 1, disposition: 'wastage' }]));
    expect(ofType(whole, 'ItemVoided')).toEqual([expect.objectContaining({ order_item_id: 'KG', units: 1, refund_minor: 200_000 })]);
    expect(linesOf(hub, order_id).get('KG')).toMatchObject({ live_units: 0, billed_minor: 0 });
  });
});

describe('[04 #42] option children', () => {
  it('[04 #42] karahi ×3 with raita option_quantity 2 (child 6 units): void 2 karahi → 2 × 2 = 4 child units; the last karahi → the 2 left; each line its own shares', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway([
      { order_item_id: 'K', item_id: FX.piece, quantity: 3 },
      { order_item_id: 'R', option_id: FX.option, parent_order_item_id: 'K', quantity: 2 },
    ]);
    toStage(hub, order_id, ['K', 'R'], 'cooking');
    const before = linesOf(hub, order_id);
    expect(before.get('R')).toMatchObject({ units: 6, refundable_minor: 60_000 });
    const k = before.get('K')!.refundable_minor / 3;
    const two = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'K', units: 2, disposition: 'wastage' }]));
    expect(ofType(two, 'ItemVoided').map((p) => [p.order_item_id, p.units, p.refund_minor])).toEqual([['K', 2, 2 * k], ['R', 4, 40_000]]);
    const last = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'K', disposition: 'wastage' }]));
    expect(ofType(last, 'ItemVoided').map((p) => [p.order_item_id, p.units, p.refund_minor])).toEqual([['K', 1, k], ['R', 2, 20_000]]);
    const after = linesOf(hub, order_id);
    expect(after.get('R')).toMatchObject({ voided_units: 6, refund_minor: 60_000, billed_minor: 0 });
    expect(after.get('K')).toMatchObject({ voided_units: 3, billed_minor: 0 });
  });

  it('[04 #42] option child alone: void 3 of its 6 units → 3 shares, the karahi untouched', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway([
      { order_item_id: 'K', item_id: FX.piece, quantity: 3 },
      { order_item_id: 'R', option_id: FX.option, parent_order_item_id: 'K', quantity: 2 },
    ]);
    toStage(hub, order_id, ['K', 'R'], 'served');
    const r = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'R', units: 3, disposition: 'wastage' }]));
    expect(ofType(r, 'ItemVoided').map((p) => [p.order_item_id, p.units, p.refund_minor])).toEqual([['R', 3, 30_000]]);
    expect(linesOf(hub, order_id).get('K')).toMatchObject({ voided_units: 0, refund_minor: 0 });
  });

  // 01c §3.4.8 Q4 and 04 #42, fixed by 02b v1.0.13 (owner 2026-11-12, 04 Q-19 (b); u11; T1's STOP Q-1 in #138): a child
  // with `option_quantity: null` (added to a submitted line later, "one more raita") is untouched by a partial parent
  // void and voided alone, with the parent's last unit, or with the whole parent. Unreachable from 02b's SubmitOrder
  // today (build-submit.ts: option_quantity set), so this ItemAdded is synthetic (the fixture's `item` override, as
  // fixtures.ts does for Q-13's station-less lines). Was 3 × `it.fails` + a test pinning the 500 (deleted with the fix).
  const laterChild = (parentQty: number) => [
    { order_item_id: 'K', item_id: FX.piece, quantity: parentQty },
    { order_item_id: 'RN', option_id: FX.option, parent_order_item_id: 'K', quantity: 1, item: { option_quantity: null, quantity: 1, line_total_minor: 10_000 } },
  ];

  it('[02b #39] [04 #42] partial parent void with a null-option_quantity child → only the parent voided, refund = the parent share (was 500)', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway(laterChild(3));
    toStage(hub, order_id, ['K', 'RN'], 'cooking');
    expect(linesOf(hub, order_id).get('RN')).toMatchObject({ units: 1, refundable_minor: 10_000 });
    const k = linesOf(hub, order_id).get('K')!;
    const one = await voidItems(hub, mgr, order_id, [{ order_item_id: 'K', units: 1, disposition: 'wastage' }]);
    expect(one.status, JSON.stringify(one.error)).toBe(200);
    expect(ofType(one, 'ItemVoided').map((p) => p.order_item_id)).toEqual(['K']);
    expect(sumOf(one, 'ItemVoided', 'refund_minor')).toBe(k.refundable_minor / 3);
    expect(linesOf(hub, order_id).get('RN')).toMatchObject({ voided_units: 0, refund_minor: 0 });
  });

  it('[02b #39] [04 #42] whole parent void takes the null-option_quantity child with it (was 500)', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway(laterChild(2));
    toStage(hub, order_id, ['K', 'RN'], 'served');
    const whole = await voidItems(hub, mgr, order_id, [{ order_item_id: 'K', disposition: 'wastage' }]);
    expect(whole.status, JSON.stringify(whole.error)).toBe(200);
    expect(ofType(whole, 'ItemVoided').map((p) => [p.order_item_id, p.units, p.refund_minor])).toEqual([['K', 2, expect.any(Number)], ['RN', 1, 10_000]]);
  });

  it('[02b #39] [01c §3.4.8 Q4] the last parent unit takes the null child\'s units left (capped by its own earlier void); Σ refund = both totals', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway([
      { order_item_id: 'K', item_id: FX.piece, quantity: 2 },
      { order_item_id: 'RN', option_id: FX.option, parent_order_item_id: 'K', quantity: 1, item: { option_quantity: null, quantity: 3, line_total_minor: 30_000 } },
    ]);
    toStage(hub, order_id, ['K', 'RN'], 'served');
    const k = linesOf(hub, order_id).get('K')!.refundable_minor;
    const own = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'RN', units: 1, disposition: 'wastage' }]));
    const first = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'K', units: 1, disposition: 'wastage' }]));
    expect(ofType(first, 'ItemVoided').map((p) => [p.order_item_id, p.units])).toEqual([['K', 1]]);
    const last = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'K', units: 1, disposition: 'wastage' }]));
    expect(ofType(last, 'ItemVoided').map((p) => [p.order_item_id, p.units, p.refund_minor])).toEqual([['K', 1, expect.any(Number)], ['RN', 2, 20_000]]);
    expect([own, first, last].reduce((a, r) => a + sumOf(r, 'ItemVoided', 'refund_minor'), 0)).toBe(k + 30_000);
    expect(linesOf(hub, order_id).get('RN')).toMatchObject({ voided_units: 3, refund_minor: 30_000, billed_minor: 0 });
  });

  // The worse case of Q-1: a null-option_quantity child whose units happen to be a multiple of the parent's (3 units
  // under karahi ×3) passed cascadeUnits' modulo check, so a partial parent void silently cascaded into it.
  it('[02b #39] [04 #42] partial parent void must not cascade into a null-option_quantity child whose units are a multiple (3 under karahi ×3)', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway([
      { order_item_id: 'K', item_id: FX.piece, quantity: 3 },
      { order_item_id: 'RN', option_id: FX.option, parent_order_item_id: 'K', quantity: 1, item: { option_quantity: null, quantity: 3, line_total_minor: 30_000 } },
    ]);
    toStage(hub, order_id, ['K', 'RN'], 'cooking');
    expect(linesOf(hub, order_id).get('RN')).toMatchObject({ units: 3, refundable_minor: 30_000 });
    const one = await voidItems(hub, mgr, order_id, [{ order_item_id: 'K', units: 1, disposition: 'wastage' }]);
    expect(one.status, JSON.stringify(one.error)).toBe(200);
    expect(ofType(one, 'ItemVoided').map((p) => p.order_item_id)).toEqual(['K']);
    expect(linesOf(hub, order_id).get('RN')).toMatchObject({ voided_units: 0, refund_minor: 0 });
  });

  it('[02b #39] [01c N1] a partial deal void: the parts are folded with option_quantity null and still cascade per portion (the null rule is option_child-only)', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway([{ ...family('F1')[0]!, quantity: 2 }, ...family('F1').slice(1)]);
    toStage(hub, order_id, ['F1a', 'F1b'], 'served');
    const parts = hub.deps.db.prepare("SELECT order_item_id, units, option_quantity FROM order_lines WHERE parent_order_item_id = 'F1' ORDER BY order_item_id").all();
    expect(parts).toEqual([
      { order_item_id: 'F1a', units: 2, option_quantity: null },
      { order_item_id: 'F1b', units: 8, option_quantity: null },
    ]);
    const one = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'F1', units: 1, disposition: 'wastage' }]));
    expect(ofType(one, 'ItemVoided').map((p) => [p.order_item_id, p.units])).toEqual([['F1', 1], ['F1a', 1], ['F1b', 4]]);
    expect(linesOf(hub, order_id).get('F1')!.billed_minor).toBe(320_000);
  });

  it('[02b #39] statements: VoidItems direct with a null child = the same order without it (04 §6.1 3 + 2)', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const counter = statementCounter(hub.deps.db);
    let handled = -1;
    commandRegistry(hub.app).register(
      defineCommand({
        ...voidItemsCommand,
        commandType: 'TestVoidItemsCountedQ19',
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
    const counted = async (k: string, lines: Parameters<typeof takeaway>[0]): Promise<number> => {
      const order_id = takeaway(lines);
      toStage(hub, order_id, [k], 'cooking');
      const r = await post(hub, mgr, 'test-void-items-counted-q19', 'TestVoidItemsCountedQ19', {
        order_id,
        reason_code: 'quality',
        note: null,
        disposition_note: null,
        lines: [{ order_item_id: k, units: 1, disposition: 'wastage' }],
      });
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      expect(ofType(r, 'ItemVoided').map((p) => p.order_item_id)).toEqual([k]);
      return handled;
    };
    const plain = await counted('K0', [{ order_item_id: 'K0', item_id: FX.piece, quantity: 3 }]);
    const withNull = await counted('K', laterChild(3));
    expect(withNull).toBe(plain);
    expect(withNull).toBe(5);
    // the last unit, cascading into the null child: still 3 + 2 (one readOrder row read carries option_quantity)
    const order_id = takeaway([
      { order_item_id: 'KL', item_id: FX.piece, quantity: 1 },
      { order_item_id: 'RL', option_id: FX.option, parent_order_item_id: 'KL', quantity: 1, item: { option_quantity: null, quantity: 1, line_total_minor: 10_000 } },
    ]);
    toStage(hub, order_id, ['KL'], 'cooking');
    const last = await post(hub, mgr, 'test-void-items-counted-q19', 'TestVoidItemsCountedQ19', {
      order_id,
      reason_code: 'quality',
      note: null,
      disposition_note: null,
      lines: [{ order_item_id: 'KL', units: 1, disposition: 'wastage' }],
    });
    expect(last.status, JSON.stringify(last.error)).toBe(200);
    expect(ofType(last, 'ItemVoided').map((p) => [p.order_item_id, p.units])).toEqual([['KL', 1], ['RL', 1]]);
    expect(handled).toBe(5);
  });

  it('[02b #39] [04 K-1] approval path: the last parent unit with a null child, approved → the child\'s cascaded ItemVoided carries the alert_id', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const cashier = signIn(hub, STAFF.cashier);
    const order_id = takeaway(laterChild(2));
    toStage(hub, order_id, ['K', 'RN'], 'served');
    ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'K', units: 1, disposition: 'wastage' }]));
    const asked = ok(await voidItems(hub, cashier, order_id, [{ order_item_id: 'K', units: 1, disposition: 'wastage' }]));
    expect(ofType(asked, 'ItemVoided')).toEqual([]);
    const [p] = (asked.result as { pending: Array<{ order_item_id: string; alert_id: string }> }).pending;
    const r = ok(await answer(hub, mgr, p!.alert_id, 'approve'));
    expect(ofType(r, 'ItemVoided').map((v) => [v.order_item_id, v.units, v.refund_minor, v.alert_id])).toEqual([
      ['K', 1, expect.any(Number), p!.alert_id],
      ['RN', 1, 10_000, p!.alert_id],
    ]);
    expect(linesOf(hub, order_id).get('RN')).toMatchObject({ voided_units: 1, refund_minor: 10_000, billed_minor: 0 });
  });

  it('[04 #42] a null-option_quantity child voided alone → its own share, the parent untouched (passes today)', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway(laterChild(2));
    toStage(hub, order_id, ['K', 'RN'], 'served');
    const alone = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'RN', units: 1, disposition: 'wastage' }]));
    expect(ofType(alone, 'ItemVoided').map((p) => [p.order_item_id, p.units, p.refund_minor])).toEqual([['RN', 1, 10_000]]);
    expect(linesOf(hub, order_id).get('K')).toMatchObject({ voided_units: 0, live_units: 2 });
  });
});

describe('[04 #43, #44] comped units and the remainder share', () => {
  it('[04 #43] naan ×4, 2 comped: void 3 → 2 uncomped to refund_minor, 1 comped to comp_voided_minor (O21); the bill drops by the refund only', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway([{ order_item_id: 'N', item_id: FX.naan, quantity: 4 }]);
    toStage(hub, order_id, ['N'], 'served');
    ok(await compLine(hub, mgr, 'N', 2));
    expect(linesOf(hub, order_id).get('N')).toMatchObject({ comped_units: 2, comp_minor: 6_000, billed_minor: 6_000 });
    const r = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'N', units: 3, disposition: 'wastage' }]));
    expect(ofType(r, 'ItemVoided')).toEqual([expect.objectContaining({ order_item_id: 'N', units: 3, refund_minor: 6_000, comp_voided_minor: 3_000 })]);
    expect(linesOf(hub, order_id).get('N')).toMatchObject({ voided_units: 3, comped_units: 1, comp_minor: 3_000, comp_voided_minor: 3_000, refund_minor: 6_000, billed_minor: 0 });
  });

  it('[04 #44] odd deal part B (75 001 over 3 units): the three voids refund 25 000, 25 000, 25 001 — the remainder to the last unit', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway(odd('O1'));
    expect(linesOf(hub, order_id).get('O1b')).toMatchObject({ units: 3, refundable_minor: 75_001 });
    toStage(hub, order_id, ['O1b'], 'served');
    const refunds: number[] = [];
    for (let i = 0; i < 3; i++) refunds.push(sumOf(ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'O1b', units: 1, disposition: 'wastage' }])), 'ItemVoided', 'refund_minor'));
    expect(refunds).toEqual([25_000, 25_000, 25_001]);
    expect(linesOf(hub, order_id).get('O1')!.billed_minor).toBe(100_001 - 75_001);
  });

  it('[04 #43, #44] comp the odd deal, then void 2 of part B\'s comped units → comp_voided 25 001 + 25 000 (the comp\'s remainder share comes back first), refund 0', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const order_id = takeaway(odd('O2'));
    toStage(hub, order_id, ['O2b'], 'served');
    ok(await compLine(hub, mgr, 'O2', 1));
    expect(linesOf(hub, order_id).get('O2b')).toMatchObject({ comped_units: 3, comp_minor: 75_001 });
    expect(linesOf(hub, order_id).get('O2')!.billed_minor).toBe(0);
    const r = ok(await voidItems(hub, mgr, order_id, [{ order_item_id: 'O2b', units: 2, disposition: 'wastage' }]));
    expect(ofType(r, 'ItemVoided')).toEqual([expect.objectContaining({ order_item_id: 'O2b', units: 2, refund_minor: 0, comp_voided_minor: 50_001 })]);
    expect(linesOf(hub, order_id).get('O2b')).toMatchObject({ comped_units: 1, comp_minor: 25_000, comp_voided_minor: 50_001, refund_minor: 0 });
    expect(linesOf(hub, order_id).get('O2')!.billed_minor).toBe(0);
  });
});

describe('[04 #45] remade line (O20)', () => {
  it('[04 #45] a served karahi sent back as remake: the returned line stays billable and its void refunds its share; the remake line refunds 0', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const rm = await remakeLine(hub, { by: mgr });
    const before = linesOf(hub, rm.order_id);
    const total = before.get(rm.served)!.refundable_minor;
    expect(total).toBeGreaterThan(0);
    expect(before.get(rm.served)).toMatchObject({ returned_units: 1, live_units: 1, billed_minor: total });
    const r = ok(await voidItems(hub, mgr, rm.order_id, [{ order_item_id: rm.served, disposition: 'wastage' }]));
    expect(ofType(r, 'ItemVoided')).toEqual([expect.objectContaining({ order_item_id: rm.served, units: 1, refund_minor: total })]);
    toStage(hub, rm.order_id, [rm.remake], 'cooking');
    const remake = ok(await voidItems(hub, mgr, rm.order_id, [{ order_item_id: rm.remake, disposition: 'wastage' }]));
    expect(sumOf(remake, 'ItemVoided', 'refund_minor')).toBe(0);
    for (const l of linesOf(hub, rm.order_id).values()) expect(l.billed_minor).toBe(0);
  });
});

/** The request's stored values / details (alerts row). */
const stored = (alert_id: string) => {
  const row = hub.deps.db.prepare('SELECT values_json, details_json FROM alerts WHERE alert_id = ?').get(alert_id) as { values_json: string; details_json: string };
  return { values: JSON.parse(row.values_json) as { refund_minor: number; comp_voided_minor: number; touched_ids: string[] }, details: JSON.parse(row.details_json) as { amount: number } };
};

describe('[04 #47] approve amount = raise amount (H1-27)', () => {
  it('[04 #47] Cashier asks on a partial deal with comped units, a karahi ×3 with its raita and a naan whose kitchen state moves meanwhile; each approve writes Σ refund = details.amount = values.refund_minor, Σ comp_voided = values.comp_voided_minor', async () => {
    hub = await startMoney();
    const mgr = signIn(hub, STAFF.manager);
    const cashier = signIn(hub, STAFF.cashier);
    const order_id = takeaway([
      ...odd('O3'),
      { order_item_id: 'K', item_id: FX.piece, quantity: 3 },
      { order_item_id: 'R', option_id: FX.option, parent_order_item_id: 'K', quantity: 2 },
      { order_item_id: 'N', item_id: FX.naan, quantity: 4 },
    ]);
    toStage(hub, order_id, ['O3b', 'K', 'R'], 'done');
    toStage(hub, order_id, ['N'], 'served');
    ok(await compLine(hub, mgr, 'O3', 1));
    ok(await compLine(hub, mgr, 'N', 1));
    const asked = ok(
      await voidItems(hub, cashier, order_id, [
        { order_item_id: 'O3b', units: 2, disposition: 'wastage' },
        { order_item_id: 'K', units: 2, disposition: 'staff_meal' },
        { order_item_id: 'N', units: 4, disposition: 'wastage' },
      ]),
    );
    expect(asked.events.filter((e) => e.event_type === 'ItemVoided')).toEqual([]);
    const pending = (asked.result as { pending: Array<{ order_item_id: string; alert_id: string }> }).pending;
    expect(pending).toHaveLength(3);
    // the kitchen serves the karahi while the request waits: money is the same plan (only dispositions follow the stage)
    toStage(hub, order_id, ['K', 'R'], 'served');
    let refunded = 0;
    for (const p of pending) {
      const { values, details } = stored(p.alert_id);
      expect(details.amount).toBe(values.refund_minor);
      const r = ok(await answer(hub, mgr, p.alert_id, 'approve'));
      expect(r.events.filter((e) => e.event_type === 'ItemVoided').map((e) => e.payload.order_item_id)).toEqual(values.touched_ids);
      expect(sumOf(r, 'ItemVoided', 'refund_minor')).toBe(details.amount);
      expect(sumOf(r, 'ItemVoided', 'comp_voided_minor')).toBe(values.comp_voided_minor);
      refunded += details.amount;
    }
    // the plans were not trivial: comped units → comp_voided, the remainder share, a cascade
    expect(stored(pending[0]!.alert_id).values.comp_voided_minor).toBe(50_001);
    expect(stored(pending[1]!.alert_id).values.touched_ids).toEqual(['K', 'R']);
    // all 4 with 1 comped: the 3 uncomped units refund, the comped one (last, 02b §3.4) → comp_voided
    expect(stored(pending[2]!.alert_id).values).toMatchObject({ refund_minor: 9_000, comp_voided_minor: 3_000 });
    expect([...linesOf(hub, order_id).values()].reduce((a, l) => a + l.refund_minor, 0)).toBe(refunded);
  });
});

// ------------------------------------------------------------------------------------------- #48, #49, §6.8

const branch = () => hub.deps.config.provisioned?.branch_id ?? 'branch-unset';
const TABLES = ['orders', 'order_lines', 'audit_entries', 'audit_requests', 'audit_orders'] as const;
const dump = () => Object.fromEntries(TABLES.map((t) => [t, hub.deps.db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]));
function rebuild(names: string[]): void {
  hub.deps.db.prepare('DELETE FROM projection_checkpoints WHERE projection IN (SELECT value FROM json_each(?))').run(JSON.stringify(names));
  const registry = createProjectionRegistry();
  registerHubProjections(registry);
  registry.catchUp(hub.deps.db, branch());
}

/**
 * 04 §6.8 at Table 12 (karahi done, Order taker asks `moved`, Manager approves on his own tablet; the T4 karahi waits),
 * then a direct partial deal void, a comp, a remove, an approved cascade void with a comped unit and a rejected one.
 */
async function mixedDay(): Promise<{ o7: string; k1: string; t4: string; a9: string; deal_order: string }> {
  hub = await startMoney();
  const hamza = signIn(hub, STAFF.orderTaker);
  const imran = signIn(hub, STAFF.manager);
  const t4 = waitingT4(hub);
  openSeating(hub, { table_id: VX.tables.T12, seating_id: 'SEAT_12' });
  const o7 = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT_12', placed_by: STAFF.orderTaker, lines: [{ order_item_id: 'K1', item_id: FX.piece }, { order_item_id: 'N7', item_id: FX.naan }] }).order_id;
  toStage(hub, o7, ['K1'], 'done');
  toStage(hub, o7, ['N7'], 'served');
  // §6.8 says "details.amount 240000" for a Mutton Karahi; the fixture's karahi (FX.piece, priced from aBranchConfig's
  // I2) is 120 000, so the literal here is the fixture's price; the example's shape, not its menu price, is what #48 pins.
  const karahi = linesOf(hub, o7).get('K1')!.refundable_minor;
  expect(karahi).toBe(120_000);

  const asked = ok(await voidItems(hub, hamza, o7, [{ order_item_id: 'K1', disposition: 'moved' }]));
  const a9 = (asked.result as { pending: Array<{ order_item_id: string; alert_id: string }> }).pending[0]!;
  expect(a9.order_item_id).toBe('K1');
  expect(stored(a9.alert_id).values).toMatchObject({ touched_ids: ['K1'], line_dispositions: { K1: 'moved' }, refund_minor: karahi });
  expect(stored(a9.alert_id).details.amount).toBe(karahi);
  const ap = ok(await answer(hub, imran, a9.alert_id, 'approve'));
  const seq = ap.events.map((e) => e.event_type).filter((t) => ['RequestAnswered', 'ItemMovedToStock', 'StockAdded', 'StockReserved', 'ItemVoided'].includes(t));
  expect(seq).toEqual(['RequestAnswered', 'ItemMovedToStock', 'StockAdded', 'StockReserved', 'ItemVoided']);
  expect(ofType(ap, 'ItemMovedToStock')).toEqual([{ order_item_id: 'K1', units: 1, alert_id: a9.alert_id }]);
  expect(ofType(ap, 'StockAdded')).toEqual([expect.objectContaining({ stock_item_id: FX.stock, reason: 'moved', alert_id: a9.alert_id })]);
  expect(ofType(ap, 'StockReserved')).toEqual([expect.objectContaining({ order_item_id: t4.line, alert_id: a9.alert_id })]);
  expect(ofType(ap, 'ItemVoided')).toEqual([
    expect.objectContaining({ order_item_id: 'K1', units: 1, refund_minor: karahi, disposition: 'moved', requester_staff_id: STAFF.orderTaker, approver_staff_id: STAFF.manager, alert_id: a9.alert_id }),
  ]);
  expect(linesOf(hub, o7).get('K1')!.billed_minor).toBe(0);

  // a takeaway with the family deal and a naan ×4: direct partial void, comp, approved cascade over a comped unit, a reject
  const cashier = signIn(hub, STAFF.cashier);
  const deal_order = takeaway([...family('F2'), { order_item_id: 'N8', item_id: FX.naan, quantity: 4 }, { order_item_id: 'N9', item_id: FX.naan, quantity: 2 }]);
  toStage(hub, deal_order, ['F2b', 'N8'], 'served');
  ok(await voidItems(hub, imran, deal_order, [{ order_item_id: 'F2b', units: 1, disposition: 'staff_meal' }]));
  ok(await removeItems(hub, imran, deal_order, [{ order_item_id: 'N9', units: 1 }]));
  ok(await compLine(hub, imran, 'N8', 1));
  const asked2 = ok(await voidItems(hub, cashier, deal_order, [{ order_item_id: 'F2', disposition: 'wastage' }, { order_item_id: 'N8', disposition: 'wastage' }]));
  const [deal, naan] = (asked2.result as { pending: Array<{ alert_id: string }> }).pending;
  ok(await answer(hub, imran, deal!.alert_id, 'approve'));
  ok(await answer(hub, imran, naan!.alert_id, 'reject'));
  return { o7, k1: 'K1', t4: t4.line, a9: a9.alert_id, deal_order };
}

describe('[04 #48, §6.8] rebuild from seq 0 = live after mixed direct and approved voids', () => {
  it('[04 §6.8] Table 12 example end to end (asserted inside the day), then orders + audit rebuilt from seq 0 equal live row for row', async () => {
    const day = await mixedDay();
    const l = linesOf(hub, day.deal_order);
    expect([...['F2', 'F2a', 'F2b']].map((id) => l.get(id)!.billed_minor)).toEqual([0, 0, 0]);
    expect(l.get('N8')).toMatchObject({ comped_units: 1, voided_units: 0 }); // rejected: still billed
    const live = dump();
    expect((live.audit_entries as unknown[]).length).toBeGreaterThan(5);
    rebuild(['orders', 'audit']);
    expect(dump()).toEqual(live);
  });

  it('[04 #48] the engine state the hub holds = a strict refold of the whole log (lines, orders, stock) after the same day', async () => {
    await mixedDay();
    const live = hub.deps.state.get() as EngineState;
    const refold = strictRefold(hub);
    expect(refold.lines).toEqual(live.lines);
    expect(refold.orders).toEqual(live.orders);
    expect(refold.stock).toEqual(live.stock);
  });
});

describe('[04 #49] events with and without the new optional fields parse (T-1, Q-1)', () => {
  const NEW = ['ItemVoided', 'ItemMovedToStock', 'StockReleased', 'StockAdded', 'StockReserved', 'OrderCancelled', 'OrderFoodCleared'];

  it('[04 #49] every T-1 / Q-1 event 04 wrote today re-parses to its stored payload (nothing stripped); approval-born ones carry alert_id, direct ones do not', async () => {
    const day = await mixedDay();
    const rows = hub.deps.db.prepare(`SELECT * FROM events WHERE event_type IN (SELECT value FROM json_each(?)) ORDER BY seq`).all(JSON.stringify(NEW)) as Array<Record<string, unknown> & { payload: string; event_type: string }>;
    const seen = new Set<string>();
    let withAlert = 0;
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      const parsed = parseEvent({ ...row, payload: payload as PosEvent['payload'] });
      expect(parsed.payload, row.event_type).toEqual(payload);
      seen.add(row.event_type);
      if (typeof payload.alert_id === 'string') withAlert += 1;
    }
    expect([...seen].sort()).toEqual(expect.arrayContaining(['ItemMovedToStock', 'ItemVoided', 'StockAdded', 'StockReserved']));
    expect(withAlert).toBeGreaterThanOrEqual(5);
    const direct = rows.find((r) => r.event_type === 'ItemVoided' && (JSON.parse(r.payload) as { order_item_id: string }).order_item_id === 'F2b')!;
    expect(JSON.parse(direct.payload)).toMatchObject({ alert_id: null, approver_staff_id: null, requester_staff_id: STAFF.manager, disposition: 'staff_meal' });
    expect(day.a9).toBeTruthy();
  });

  it('[04 #49] bare legacy shapes (ItemVoided { order_item_id, units }, OrderCancelled { order_id }) still parse and fold; an unknown field on a strict schema is refused', async () => {
    hub = await startMoney();
    const order_id = takeaway([{ order_item_id: 'B1', item_id: FX.naan, quantity: 2 }]);
    toStage(hub, order_id, ['B1'], 'served');
    voidLine(hub, order_id, 'B1', 2);
    expect(linesOf(hub, order_id).get('B1')).toMatchObject({ voided_units: 2, live_units: 0 });
    const env = { event_id: 'E1', seq: 1, stream_type: 'order', stream_id: order_id, schema_version: 1, occurred_at: 1, recorded_at: 1, actor_id: null, device_id: 'hub', tenant_id: 'tenant-a', branch_id: 'branch-1' };
    const parse = (event_type: string, payload: Record<string, unknown>) => parseEvent({ ...env, event_type, payload } as never);
    expect(parse('ItemVoided', { order_item_id: 'B1', units: 1 }).payload).toEqual({ order_item_id: 'B1', units: 1 });
    expect(parse('ItemMovedToStock', { order_item_id: 'B1', units: 1 }).payload).toEqual({ order_item_id: 'B1', units: 1 });
    expect(parse('OrderCancelled', { order_id }).payload).toEqual({ order_id });
    expect(parse('OrderCancelled', { order_id, alert_id: 'A1' }).payload).toEqual({ order_id, alert_id: 'A1' });
    expect(parse('OrderFoodCleared', { order_id, food_served: true, alert_id: 'A1' }).payload).toEqual({ order_id, food_served: true, alert_id: 'A1' });
    expect(() => parse('OrderCancelled', { order_id, approver_staff_id: 'S_MGR' })).toThrow();
  });
});
