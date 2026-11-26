import { DomainError } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type { DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { hubTime } from '../../src/lib/hub-time';
import { orderLines, priceCartDraft } from '../../src/orders/exports';
import { EtaDraftSchema } from '../../src/orders/queries/eta-preview';
import { branchConfig, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, openDay } from './fixtures';

// 02b v1.0.25 §4.2 `priceCartDraft` (hostile run 2 R2-M-8; run 3 R3-M-6; row TK-15); test 95. L-ORDERS-1 CB-1.

let hub: TestHub;
afterEach(async () => {
  activity.drain();
  swapBranchConfig(null);
  await hub.close();
});

async function start(): Promise<void> {
  hub = await createTestHub();
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const grant = (permission: string) => ({ permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'branch' as const });
  const directory: DirectoryInput = {
    ...base,
    roles: [...base.roles, { role_id: 'R_TAKER', name: 'R_TAKER', session_idle_ttl_ms: 3_600_000, permissions: [grant('take-order')] }],
    staff: [...base.staff, { staff_id: 'S_ALI', display_name: 'Ali', pin_hash: pin, role_ids: ['R_TAKER'], denied_permissions: [], lead_staff_id: null, floor_ids: [] }],
  };
  await seedDirectory(hub, directory);
  openDay(hub);
}

const engine = (): EngineState => hub.deps.state.get() as EngineState;
const eventCount = (): number => (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
const price = (draft: unknown) => {
  const { now_ms, utc_offset_ms } = hubTime(hub.clock);
  return priceCartDraft(branchConfig()!, EtaDraftSchema.parse(draft), { db: hub.deps.db, state: engine(), now: now_ms, utc_offset_ms });
};

/** A karahi with a linked raita (option child) and a plain option, a combo deal of 2 parts, a weighed fish. */
const draftLines = () => [
  { key: 'K1', item_id: FX.piece, quantity: 2, options: [{ option_id: FX.option, quantity: 1, key: 'K1o' }] },
  {
    key: 'D1',
    deal_id: FX.deal,
    quantity: 1,
    deal_choices: [
      { deal_part_id: FX.dealParts[0], item_id: FX.piece, key: 'D1a' },
      { deal_part_id: FX.dealParts[1], item_id: FX.naan, key: 'D1b' },
    ],
  },
  { key: 'F1', item_id: FX.gram },
];

async function submitAsKeys(order_id: string, draft: Record<string, unknown>): Promise<void> {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_ALI', deviceId: device.deviceId });
  const payload = JSON.parse(JSON.stringify({ order_id, ...draft }).replace(/"key":/g, '"order_item_id":')) as Record<string, unknown>;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/submit-order',
    headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
    payload: { command_id: `c-${order_id}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: 'SubmitOrder', payload, occurred_at: hub.clock.branchNow(), actor_id: 'S_ALI', device_id: device.deviceId },
  });
  expect(res.statusCode, res.body).toBe(200);
}

describe('[02b #95] priceCartDraft (§4.2, R2-M-8)', () => {
  it('[02b #95] CartBillLines in step 11 order equal the LineViews a real SubmitOrder gives the same lines; the weighed line pending; no event, no row, ≤ 1 statement', async () => {
    await start();
    const draft = { order_type: 'takeaway', lines: draftLines() };
    const before = eventCount();
    const counter = statementCounter(hub.deps.db);
    const priced = price(draft);
    expect(counter.count).toBeLessThanOrEqual(1);
    expect(eventCount()).toBe(before);
    expect(priced.refusals).toEqual([]);

    await submitAsKeys('O1', draft);
    const views = orderLines(hub.deps.db, ['O1']).get('O1')!;
    // step 11 order; a split karahi's parts (K1, K1-p2 and their raitas) keep their draft key
    expect(priced.lines.map((l) => l.key)).toEqual(views.map((v) => v.order_item_id.replace(/-p\d+$/, '')));
    views.forEach((v, i) => {
      const l = priced.lines[i]!;
      expect({ units: l.units, unit_price_minor: l.unit_price_minor, base_minor: l.base_minor, tax_profile_id: l.tax_profile_id, line_kind: l.line_kind, name: l.name, options: l.options }, v.order_item_id).toEqual({
        units: v.units,
        unit_price_minor: v.unit_price_minor,
        base_minor: v.line_total_minor === null ? null : v.billed_minor,
        tax_profile_id: v.tax_profile_id,
        line_kind: v.line_kind,
        name: v.name,
        options: v.options,
      });
      expect(l.part_of === null, v.order_item_id).toBe(v.part_of === null);
    });
    const fish = priced.lines.find((l) => l.key === 'F1')!;
    expect(fish).toMatchObject({ weight_pending: true, base_minor: null, unit_price_minor: null });
    expect(priced.lines.find((l) => l.key === 'K1')).toMatchObject({ weight_pending: false, units: 1 });
    // the preview's ids are in-memory only: a parent link names the preview id of its parent
    const child = priced.lines.find((l) => l.key === 'K1o')!;
    expect(child.parent_order_item_id).toBe(priced.lines.find((l) => l.key === 'K1')!.order_item_id);
  });

  it('[02b #95] an Off item → one ITEM_UNAVAILABLE refusal keyed by its draft key, the other lines priced; no stock, station or pickup check', async () => {
    await start();
    const at = hub.clock.branchNow();
    hub.deps.writer.run((tx) =>
      tx.append([{ stream_type: 'stock', stream_id: FX.naan, event_type: 'ItemMadeUnavailable', schema_version: 1, payload: { item_id: FX.naan }, occurred_at: at, actor_id: 'S_MGR', device_id: 'hub' } as EventDraft]),
    );
    hub.deps.writer.run((tx) =>
      tx.append([{ stream_type: 'station', stream_id: FX.station, event_type: 'StationPauseSet', schema_version: 1, payload: { station_id: FX.station, paused: true }, occurred_at: at, actor_id: null, device_id: 'hub' } as EventDraft]),
    );
    const priced = price({ order_type: 'parking', parking: { car_number: 'LEB-1', car_type: 'sedan' }, lines: [{ key: 'N1', item_id: FX.naan, quantity: 1 }, { key: 'K1', item_id: FX.piece, quantity: 1 }] });
    expect(priced.refusals).toEqual([{ key: 'N1', code: 'ITEM_UNAVAILABLE', details: expect.anything() as unknown }]);
    expect(priced.lines.map((l) => l.key)).toEqual(['K1']); // the paused station refuses nothing here
    // a takeaway draft with a pickup far outside the day is priced (no pickup check)
    expect(price({ order_type: 'takeaway', pickup_at_ms: at - 86_400_000, lines: [{ key: 'K2', item_id: FX.piece, quantity: 1 }] }).lines).toHaveLength(1);
  });

  it('[02b #95] a dine-in draft → 400 at draft.order_type', async () => {
    await start();
    let caught: unknown;
    try {
      price({ order_type: 'dine_in', table_id: FX.table, seating_id: 'SEAT1', lines: [{ key: 'K1', item_id: FX.piece, quantity: 1 }] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect(caught).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'draft.order_type', message: 'takeaway_or_parking_only' }] } });
  });
});
