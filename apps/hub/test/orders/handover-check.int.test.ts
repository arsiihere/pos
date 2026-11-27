// ⚠️ 02b v1.0.25 §6.4 MarkServed `customer_handover: true` (run 3 R3-M-4, R3-M-3), §3.7a, §8 (OR-7; D2, D3), U-5:
// tests 90 (hub part) and the R3-M-4 cases. Real commands through the hub; engine progress through the writer.
import type { DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, openDay, openSeating } from './fixtures';

let hub: TestHub;
afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const grant = (permission: string) => ({ permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [] as string[], scope: 'branch' as const });

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff.find((s) => s.staff_id === 'S_CASH')!.pin_hash;
  const person = (staff_id: string, role_id: string) => ({ staff_id, display_name: staff_id, pin_hash: pin, role_ids: [role_id], denied_permissions: [], lead_staff_id: null, floor_ids: [] });
  return {
    ...base,
    roles: [...base.roles, { role_id: 'R_COUNTER', name: 'Counter', session_idle_ttl_ms: 36_000_000, permissions: [grant('mark-served'), grant('take-order')] }],
    staff: [...base.staff, person('S_ALI', 'R_COUNTER')],
  };
}

interface Who { staffId: string; deviceId: string; token: string; sessionToken: string }
function signIn(staffId: string): Who {
  const d = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: d.deviceId });
  return { staffId, deviceId: d.deviceId, token: d.token, sessionToken: session.token };
}

async function start(): Promise<{ ali: Who; mgr: Who }> {
  hub = await createTestHub();
  const dir = await directory();
  for (const role of dir.roles) role.session_idle_ttl_ms = 36_000_000;
  await seedDirectory(hub, dir);
  openDay(hub);
  return { ali: signIn('S_ALI'), mgr: signIn('S_MGR') };
}

const draft = (stream_type: EventDraft['stream_type'], stream_id: string, event_type: string, payload: Record<string, unknown>): EventDraft => ({
  stream_type,
  stream_id,
  event_type,
  schema_version: 1,
  payload,
  occurred_at: hub.clock.branchNow(),
  actor_id: 'S_MGR',
  device_id: 'D_SEED',
});
function append(...drafts: EventDraft[]): void {
  hub.clock.advance(1_000);
  hub.deps.writer.run((tx) => tx.append(drafts));
}
const fire = (...order_item_ids: string[]) => append(draft('station', FX.station, 'FireDispatched', { station_id: FX.station, order_item_ids, load_id: null, due_at: hub.clock.branchNow(), reason: 'pulled' }));

let seq = 0;
type Lines = Array<{ order_id: string; order_item_ids: string[] }>;
async function serve(who: Who, lines: Lines, o: { handover?: boolean; queuedAt?: number } = {}) {
  seq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/mark-served',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken, ...(o.queuedAt === undefined ? {} : { 'x-queued-at': String(o.queuedAt) }) },
    payload: {
      command_id: `hc-${seq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'MarkServed',
      payload: { lines, ...(o.handover === false ? {} : { customer_handover: true }) },
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as { data?: { result: Record<string, unknown> }; error?: { code: string; details: Record<string, unknown> } };
  return { status: res.statusCode, result: body.data?.result, error: body.error };
}

const eventCount = (): number => (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
const servedEvents = (): number => (hub.deps.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type = 'ItemServed'`).get() as { n: number }).n;
const tokenOf = (order_id: string): number => (hub.deps.db.prepare('SELECT token FROM orders WHERE order_id = ?').get(order_id) as { token: number }).token;
const priceOf = (order_item_id: string): number =>
  (JSON.parse((hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'ItemAdded' AND json_extract(payload, '$.order_item_id') = ?`).get(order_item_id) as { payload: string }).payload) as { price_minor: number }).price_minor;
const approve = (order_id: string, due_minor: number) =>
  append(draft('order', order_id, 'UnpaidHandoverApproved', { order_id, alert_id: `AL-${order_id}`, approved_by_staff_id: 'S_MGR', due_minor }));
const takeaway = (ids: string[], o: { adds_to_order_id?: string; order_type?: 'takeaway' | 'parking' } = {}): string => {
  const order_id = appendOrder(hub, { order_type: o.order_type ?? 'takeaway', placed_by: 'S_ALI', lines: ids.map((order_item_id) => ({ order_item_id, item_id: FX.naan })), ...(o.adds_to_order_id === undefined ? {} : { adds_to_order_id: o.adds_to_order_id }) }).order_id;
  fire(...ids);
  return order_id;
};

const REFUSED = (order_id: string) => ({ code: 'PERMISSION_DENIED', details: { reason: 'unpaid_handover_approval_required', order_id } });

describe('[02b #90] MarkServed customer_handover: the hub hand-over check (R3-M-4, D2, D3)', () => {
  it('a Due order without approval → 403 unpaid_handover_approval_required, nothing appended; a Manager has no override', async () => {
    const { ali, mgr } = await start();
    const order_id = takeaway(['A1']);
    const before = eventCount();
    expect(await serve(ali, [{ order_id, order_item_ids: ['A1'] }])).toMatchObject({ status: 403, error: REFUSED(order_id) });
    expect(await serve(mgr, [{ order_id, order_item_ids: ['A1'] }])).toMatchObject({ status: 403, error: REFUSED(order_id) });
    expect(eventCount()).toBe(before);
  });

  it('an effective approval passes while due ≤ the approved amount; a due raised above it is refused again', async () => {
    const { ali } = await start();
    const order_id = takeaway(['A1', 'A2']);
    approve(order_id, priceOf('A1') + priceOf('A2'));
    expect(await serve(ali, [{ order_id, order_item_ids: ['A1', 'A2'] }])).toMatchObject({ status: 200, result: { served: 2, skipped: [] } });

    const second = takeaway(['B1']);
    approve(second, priceOf('B1') - 1);
    expect(await serve(ali, [{ order_id: second, order_item_ids: ['B1'] }])).toMatchObject({ status: 403, error: REFUSED(second) });
  });

  it('mixed Due token: approve one order only → that order alone goes; the whole-token send stays blocked', async () => {
    const { ali } = await start();
    const first = takeaway(['A1']);
    const added = takeaway(['B1'], { adds_to_order_id: first });
    expect(tokenOf(added)).toBe(tokenOf(first));
    approve(first, priceOf('A1') + priceOf('B1')); // D3: the due is the token key's (both orders)
    const before = servedEvents();
    expect(await serve(ali, [{ order_id: first, order_item_ids: ['A1'] }, { order_id: added, order_item_ids: ['B1'] }])).toMatchObject({ status: 403, error: REFUSED(added) });
    expect(servedEvents()).toBe(before);
    expect(await serve(ali, [{ order_id: first, order_item_ids: ['A1'] }])).toMatchObject({ status: 200, result: { served: 1 } });
    expect(await serve(ali, [{ order_id: added, order_item_ids: ['B1'] }])).toMatchObject({ status: 403, error: REFUSED(added) });
  });

  it('a partial serve that leaves a live unserved line passes; the last line then needs the approval', async () => {
    const { ali } = await start();
    const order_id = takeaway(['A1', 'A2']);
    expect(await serve(ali, [{ order_id, order_item_ids: ['A1'] }])).toMatchObject({ status: 200, result: { served: 1 } });
    expect(await serve(ali, [{ order_id, order_item_ids: ['A2'] }])).toMatchObject({ status: 403, error: REFUSED(order_id) });
    // an already-served line in the selection counts as served (skipped), so A2 is still the last one
    expect(await serve(ali, [{ order_id, order_item_ids: ['A1', 'A2'] }])).toMatchObject({ status: 403, error: REFUSED(order_id) });
  });

  it('a nonpositive due needs none (fully comped); a billed or cancelled order is not checked; parking is checked too', async () => {
    const { ali } = await start();
    const comped = takeaway(['C1']);
    append(draft('order', comped, 'LineComped', { order_item_id: 'C1', units: 1, value_minor: priceOf('C1'), reason_code: 'quality', note: null, requester_staff_id: 'S_MGR', alert_id: null, approver_staff_id: null }));
    expect(await serve(ali, [{ order_id: comped, order_item_ids: ['C1'] }])).toMatchObject({ status: 200, result: { served: 1 } });

    const billed = takeaway(['D1']);
    append(draft('order', billed, 'OrdersBilled', { order_ids: [billed], bill_id: 'BL1' }));
    expect(await serve(ali, [{ order_id: billed, order_item_ids: ['D1'] }])).toMatchObject({ status: 200, result: { served: 1 } });

    const parking = takeaway(['P1'], { order_type: 'parking' });
    expect(await serve(ali, [{ order_id: parking, order_item_ids: ['P1'] }])).toMatchObject({ status: 403, error: REFUSED(parking) });
  });

  it('the omitted flag keeps ordinary §3.7 serving (no due check)', async () => {
    const { ali } = await start();
    const order_id = takeaway(['A1']);
    expect(await serve(ali, [{ order_id, order_item_ids: ['A1'] }], { handover: false })).toMatchObject({ status: 200, result: { served: 1 } });
  });

  it('dine-in with the flag → 400 VALIDATION_FAILED at lines[i].order_id', async () => {
    const { ali } = await start();
    const takeawayId = takeaway(['A1']);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const dineIn = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', placed_by: 'S_ALI', lines: [{ order_item_id: 'T1', item_id: FX.naan }] }).order_id;
    const r = await serve(ali, [{ order_id: takeawayId, order_item_ids: ['A1'] }, { order_id: dineIn, order_item_ids: ['T1'] }]);
    expect(r).toMatchObject({ status: 400, error: { code: 'VALIDATION_FAILED', details: { issues: [{ path: 'lines.1.order_id' }] } } });
  });

  it('a queued send is rechecked at execution: an addition after the approval raised the key due → refused atomically', async () => {
    const { ali } = await start();
    const order_id = takeaway(['A1']);
    approve(order_id, priceOf('A1'));
    const queuedAt = hub.clock.branchNow();
    takeaway(['A2'], { adds_to_order_id: order_id });
    const before = eventCount();
    expect(await serve(ali, [{ order_id, order_item_ids: ['A1'] }], { queuedAt })).toMatchObject({ status: 403, error: REFUSED(order_id) });
    expect(eventCount()).toBe(before);

    const other = takeaway(['B1']);
    approve(other, priceOf('B1'));
    expect(await serve(ali, [{ order_id: other, order_item_ids: ['B1'] }], { queuedAt: hub.clock.branchNow() })).toMatchObject({ status: 200, result: { served: 1 } });
  });
});
