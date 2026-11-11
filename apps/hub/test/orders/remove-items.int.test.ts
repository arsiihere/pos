import { stockEffects, type EngineState } from '@pos/engine';
import type { BranchConfig, DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { currentDirectory } from '../../src/auth/guards';
import { defineCommand, type CommandCtx } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import type { WriterTx } from '../../src/engine-host/writer';
import { removeItemsCommand } from '../../src/orders/commands/remove-items';
import { orderLines, seatingTotals } from '../../src/orders/exports';
import { registerOrdersProjection } from '../../src/orders/index';
import { lineShares, planComp, planVoid } from '../../src/orders/ledger';
import { lineChangeDrafts } from '../../src/orders/line-change';
import { zoneAlertDrafts } from '../../src/orders/zone-alerts';
import { createProjectionRegistry } from '../../src/projections/registry';
import { swapBranchConfig, branchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, fixtureMenu, openDay, openSeating, setZoneStock, type FixtureLine } from './fixtures';

// 02b §6.2 RemoveItems, §3.5, §3.4, §3.9 (stale requests), §3.3, §3.10, §3.14; §11 step 9. Orders are seeded with the
// shared fixtures and every other event (fires, starts, comps, voids, bills, locks) is a real event through the writer.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

function grant(permission: string, scope: 'branch' | 'my_floors' | 'own_tables' = 'branch') {
  return { permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope };
}

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, role_id: string, floor_ids: string[] = []) => ({
    staff_id,
    display_name: staff_id,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids,
  });
  const role = (role_id: string, permissions: ReturnType<typeof grant>[]) => ({ role_id, name: role_id, session_idle_ttl_ms: 36_000_000, permissions });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_TAKER', [grant('take-order')]),
      role('R_FLOOR', [grant('take-order', 'my_floors')]),
      role('R_OWN', [grant('take-order', 'own_tables')]),
    ],
    staff: [
      ...base.staff,
      person('S_ALI', 'R_TAKER'),
      person('S_SARA', 'R_TAKER'),
      person('S_OMAR', 'R_OWN'),
      person('S_ASIF', 'R_OWN'),
      person('S_ZAIN', 'R_FLOOR', [FX.floor]),
      person('S_NOOR', 'R_FLOOR', [FX.floor]),
      person('S_NOFLOOR', 'R_FLOOR'),
    ],
  };
}

/** A fresh hub: directory, the menu applied, the day open (K1 stock 10 000), the counted copy of RemoveItems. */
async function start(o: { menu?: BranchConfig } = {}): Promise<void> {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  openDay(hub, { stock: { [FX.stock]: 10_000 }, ...(o.menu === undefined ? {} : { menu: o.menu }) });
  // The real handler under a test-only name, so its own statements are counted (02a SG-3 pattern).
  commandRegistry(hub.app).register(
    defineCommand({
      ...removeItemsCommand,
      commandType: 'TestRemoveItemsCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        try {
          return removeItemsCommand.handle(ctx, payload, cmd);
        } finally {
          lastStatements = counter.count - before;
        }
      },
    }),
  );
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
}

// ------------------------------------------------------------------------------------------- seeding

const engine = (): EngineState => hub.deps.state.get() as EngineState;

/** Real events through the writer, clock +1 s first; stock effects (03a §3.7) drafted from folded state, as a command would. */
function append(drafts: Array<Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id' | 'schema_version'> & { schema_version?: number }>, actor = 'S_ALI'): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  const env = { occurred_at: now, actor_id: actor, device_id: 'D_SEED' };
  hub.deps.writer.run((tx) => {
    const full = drafts.map((d) => ({ schema_version: 1, ...d, ...env }) as EventDraft);
    tx.append(stockEffects(tx.state as EngineState, full).map((d) => ({ ...env, ...d }) as EventDraft));
  });
}

const on = (order_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
const fire = (station_id: string, ids: string[]) => ({
  stream_type: 'station' as const,
  stream_id: station_id,
  event_type: 'FireDispatched',
  payload: { station_id, order_item_ids: ids, load_id: null, due_at: hub.clock.branchNow(), reason: 'pulled' },
});
const started = (order_id: string, id: string) => on(order_id, 'ItemStarted', { order_item_id: id, started_at: hub.clock.branchNow() + 1_000, source: 'tap' });
const done = (order_id: string, id: string) => on(order_id, 'ItemDone', { order_item_id: id, done_at: hub.clock.branchNow() + 1_000, source: 'tap' });
const served = (order_id: string, ids: string[]) => on(order_id, 'ItemServed', { order_item_ids: ids, source: 'tap' });

function line(id: string) {
  return hub.deps.db.prepare('SELECT * FROM order_lines WHERE order_item_id = ?').get(id) as Record<string, number | string | null>;
}
function lineView(order_id: string, id: string) {
  return orderLines(hub.deps.db, [order_id]).get(order_id)!.find((l) => l.order_item_id === id)!;
}
function eventCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}
function zoneCount(): number {
  const r = hub.deps.db.prepare('SELECT on_hand FROM zone_stock WHERE zone_id = ? AND item_id = ?').get(FX.zone, FX.zoneItem) as { on_hand: number } | undefined;
  return r?.on_hand ?? -1;
}
function cancelledAt(order_id: string): number | null {
  return (hub.deps.db.prepare('SELECT cancelled_at FROM orders WHERE order_id = ?').get(order_id) as { cancelled_at: number | null }).cancelled_at;
}

/** Seeds a comp as real LineComped events (CompLine is task 16): the ledger's planComp over the live row. */
function comp(order_id: string, id: string, units: number): void {
  const lines = orderLines(hub.deps.db, [order_id]).get(order_id)!;
  const parent = lines.find((l) => l.order_item_id === id)!;
  const kids = lines.filter((l) => l.parent_order_item_id === id);
  const plan = planComp(parent, kids, units, { reason_code: 'quality', note: null, requester_staff_id: 'S_ALI', alert_id: null, approver_staff_id: null });
  append(plan.lines.map((p) => on(order_id, 'LineComped', p.payload)));
}

/** Seeds an 04 void as real ItemVoided events (fixture ItemVoided from the ledger's planVoid / lineShares). */
function voidUnits(order_id: string, id: string, units: number): void {
  const lines = orderLines(hub.deps.db, [order_id]).get(order_id)!;
  const parent = lines.find((l) => l.order_item_id === id)!;
  const kids = lines.filter((l) => l.parent_order_item_id === id);
  const plan = planVoid(parent, kids, units);
  append(plan.lines.map((p) => on(order_id, 'ItemVoided', p.payload)));
}

const takeaway = (lines: FixtureLine[], placed_by = 'S_ALI') => appendOrder(hub, { order_type: 'takeaway', placed_by, lines }).order_id;
function dineIn(lines: FixtureLine[], o: { table_id?: string; seating_id?: string; holder?: string } = {}): { order_id: string; seating_id: string } {
  const seating_id = o.seating_id ?? 'SEAT1';
  if (hub.deps.db.prepare('SELECT 1 FROM seatings WHERE seating_id = ?').get(seating_id) === undefined) {
    openSeating(hub, { table_id: o.table_id ?? FX.table, seating_id, holder_staff_id: o.holder ?? 'S_ALI' });
  }
  return { order_id: appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: o.holder ?? 'S_ALI', lines }).order_id, seating_id };
}

// ------------------------------------------------------------------------------------------- calls

interface Who {
  staffId: string;
  deviceId: string;
  token: string;
  sessionToken: string;
}

function signIn(staffId: string): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}

interface Stored {
  event_type: string;
  stream_type: string;
  stream_id: string;
  actor_id: string | null;
  device_id: string;
  payload: Record<string, unknown>;
}

interface Reply {
  status: number;
  body: unknown;
  result: Record<string, unknown> | undefined;
  events: Stored[];
  error?: { code: string; details: Record<string, unknown> };
}

let commandSeq = 0;

type Entry = { order_item_id: string; units?: number };

async function remove(who: Who, payload: { order_id: string; seating_id?: string; lines: Entry[] }, o: { counted?: boolean; commandId?: string } = {}): Promise<Reply> {
  commandSeq += 1;
  const type = o.counted === true ? 'TestRemoveItemsCounted' : 'RemoveItems';
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${o.counted === true ? 'test-remove-items-counted' : 'remove-items'}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: o.commandId ?? `cmd-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: type,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as { data?: { event_ids: string[]; result: Record<string, unknown> }; error?: { code: string; details: Record<string, unknown> } };
  const events =
    body.data === undefined
      ? []
      : (
          hub.deps.db
            .prepare(
              `SELECT event_type, stream_type, stream_id, actor_id, device_id, payload AS payload_json FROM events
                WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`,
            )
            .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Stored, 'payload'> & { payload_json: string }>
        ).map(({ payload_json, ...rest }) => ({ ...rest, payload: JSON.parse(payload_json) as Record<string, unknown> }));
  const error = body.error === undefined ? undefined : { code: body.error.code, details: body.error.details };
  return { status: res.statusCode, body, result: body.data?.result, events, error };
}

const types = (r: Reply) => r.events.map((e) => e.event_type);
const ofType = (r: Reply, t: string) => r.events.filter((e) => e.event_type === t).map((e) => e.payload);

/** fixtureMenu plus a family deal (karahi × 1, naan × 4, Rs 3 200) and a g deal (1 kg karahi part, naan × 2). */
function bigMenu(): BranchConfig {
  const menu = fixtureMenu();
  const karahi = menu.items.find((i) => i.item_id === FX.piece)!;
  return {
    ...menu,
    items: [...menu.items, { ...karahi, item_id: 'I_KG', name: 'Karahi kg', sort_order: 7, sale_unit: 'g', requires_weighing: false, price_minor: 200_000, stock_draws: [], modifier_group_ids: [] }],
    deals: [
      ...menu.deals,
      {
        ...menu.deals[0]!,
        deal_id: 'D_FAMILY',
        name: 'Family',
        price_minor: 320_000,
        parts: [
          { deal_part_id: 'FP_MAIN', quantity: 1, sort_order: 0, choices: [{ item_id: FX.naan, extra_price_minor: 0, sort_order: 0 }] },
          { deal_part_id: 'FP_NAAN', quantity: 4, sort_order: 1, choices: [{ item_id: FX.naan, extra_price_minor: 0, sort_order: 0 }] },
        ],
      },
      {
        ...menu.deals[0]!,
        deal_id: 'D_KG',
        name: 'Kg deal',
        price_minor: 250_000,
        parts: [
          { deal_part_id: 'KP_MAIN', quantity: 1000, sort_order: 0, choices: [{ item_id: 'I_KG', extra_price_minor: 0, sort_order: 0 }] },
          { deal_part_id: 'KP_NAAN', quantity: 2, sort_order: 1, choices: [{ item_id: FX.naan, extra_price_minor: 0, sort_order: 0 }] },
        ],
      },
    ],
  };
}

const deal = (id: string, quantity = 1): FixtureLine[] => [
  { order_item_id: id, deal_id: FX.deal, quantity },
  { order_item_id: `${id}a`, deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: id },
  { order_item_id: `${id}b`, deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: id },
];

// ------------------------------------------------------------------------------------------- #17

describe('RemoveItems (02b §6.2, §3.5)', () => {
  it('[02b #17] 1 of 4 from-stock karahi: ItemRemoved { units: 1 }, StockReleased of one share (Q-4); the 3 left consume at Start', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([{ order_item_id: 'L1', item_id: FX.piece, quantity: 4 }]);
    expect(engine().lines.L1?.draws).toEqual([{ stock_item_id: FX.stock, quantity: 2_000, reserved: 2_000 }]);

    const r = await remove(ali, { order_id, lines: [{ order_item_id: 'L1', units: 1 }] });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ removed: [{ order_item_id: 'L1', units: 1 }], cancelled: false, comp_requests_closed: [] });
    expect(r.events).toEqual([
      { event_type: 'ItemRemoved', stream_type: 'order', stream_id: order_id, actor_id: 'S_ALI', device_id: ali.deviceId, payload: { order_item_id: 'L1', units: 1 } },
      {
        event_type: 'StockReleased',
        stream_type: 'stock',
        stream_id: FX.stock,
        actor_id: 'S_ALI',
        device_id: ali.deviceId,
        payload: { stock_item_id: FX.stock, order_item_id: 'L1', quantity: 500, reason: 'removed' },
      },
    ]);
    const total = line('L1').line_total_minor as number;
    expect(line('L1')).toMatchObject({ removed_units: 1, removed_minor: lineShares({ refundable_minor: total, units: 4, comped_units: 0, removed_units: 0, voided_units: 0, comp_minor: 0 }).next_share_minor(1) });
    expect(engine().lines.L1).toMatchObject({ units: 3, stage: 'added' });

    append([fire(FX.station, ['L1']), started(order_id, 'L1')]);
    const consumed = hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'StockConsumed' ORDER BY seq`).all() as Array<{ payload: string }>;
    expect(consumed.map((c) => JSON.parse(c.payload) as unknown)).toEqual([{ stock_item_id: FX.stock, order_item_id: 'L1', quantity: 1_500 }]);
  });

  it('[02b §6.2] takeaway statements: 1 order + lines, 1 open comp requests (2); dine-in adds the seating / lock (3)', async () => {
    await start();
    const ali = signIn('S_ALI');
    const t = takeaway([{ order_item_id: 'L1', item_id: FX.naan, quantity: 2 }]);
    expect((await remove(ali, { order_id: t, lines: [{ order_item_id: 'L1', units: 1 }] }, { counted: true })).status).toBe(200);
    expect(lastStatements).toBe(2);
    const d = dineIn([{ order_item_id: 'M1', item_id: FX.naan, quantity: 2 }]);
    const r = await remove(ali, { order_id: d.order_id, seating_id: d.seating_id, lines: [{ order_item_id: 'M1', units: 1 }] }, { counted: true });
    expect(r.status).toBe(200);
    expect(types(r)).toEqual(['TableLocked', 'ItemRemoved']);
    expect(lastStatements).toBe(3);
  });

  it('[02b §6.2] D32: the same command_id → the same response, no new event', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([{ order_item_id: 'L1', item_id: FX.naan, quantity: 2 }]);
    const first = await remove(ali, { order_id, lines: [{ order_item_id: 'L1', units: 1 }] }, { commandId: 'cmd-same' });
    expect(first.status).toBe(200);
    const before = eventCount();
    const again = await remove(ali, { order_id, lines: [{ order_item_id: 'L1', units: 1 }] }, { commandId: 'cmd-same' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(before);
    expect(line('L1').removed_units).toBe(1);
  });

  it('[02b §6.2] ORDER_NOT_FOUND; a line not of the order → 400; units > live_units → 400 (AD-17); nothing appended', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([{ order_item_id: 'L1', item_id: FX.naan, quantity: 2 }]);
    const before = eventCount();
    const missing = await remove(ali, { order_id: 'NOPE', lines: [{ order_item_id: 'L1' }] });
    expect(missing.status).toBe(404);
    expect(missing.error).toEqual({ code: 'ORDER_NOT_FOUND', details: { order_id: 'NOPE' } });
    const stranger = await remove(ali, { order_id, lines: [{ order_item_id: 'X9' }] });
    expect(stranger.status).toBe(400);
    expect(stranger.error?.code).toBe('VALIDATION_FAILED');
    expect(stranger.error?.details).toMatchObject({ issues: [{ path: 'lines.0.order_item_id' }] });
    const tooMany = await remove(ali, { order_id, lines: [{ order_item_id: 'L1', units: 3 }] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.error?.details).toMatchObject({ issues: [{ path: 'lines.0.units' }] });
    expect(eventCount()).toBe(before);
  });

  // ----------------------------------------------------------------------------------------- #18

  it('[02b #18] remove every line → OrderCancelled in the batch', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([
      { order_item_id: 'L1', item_id: FX.naan, quantity: 2 },
      { order_item_id: 'L2', item_id: FX.ready, quantity: 1 },
    ]);
    const r = await remove(ali, { order_id, lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2' }] });
    expect(r.status).toBe(200);
    expect(types(r)).toEqual(['ItemRemoved', 'ItemRemoved', 'OrderCancelled']);
    expect(ofType(r, 'ItemRemoved')).toEqual([
      { order_item_id: 'L1', units: 2 },
      { order_item_id: 'L2', units: 1 },
    ]);
    expect(ofType(r, 'OrderCancelled')).toEqual([{ order_id }]);
    expect(r.result).toEqual({ removed: [{ order_item_id: 'L1', units: 2 }, { order_item_id: 'L2', units: 1 }], cancelled: true, comp_requests_closed: [] });
    expect(cancelledAt(order_id)).not.toBeNull();
  });

  it('[02b #18] a fired-not-started line is removable (O16); started → ITEM_WRONG_STAGE, nothing appended', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([
      { order_item_id: 'L1', item_id: FX.naan, quantity: 1 },
      { order_item_id: 'L2', item_id: FX.naan, quantity: 1 },
      { order_item_id: 'L3', item_id: FX.ready, quantity: 1 },
    ]);
    append([fire(FX.station, ['L1', 'L2'])]);
    expect(engine().lines.L1?.fired_at).not.toBeNull();
    const fired = await remove(ali, { order_id, lines: [{ order_item_id: 'L1' }] });
    expect(fired.status).toBe(200);
    expect(types(fired)).toEqual(['ItemRemoved']);

    append([started(order_id, 'L2')]);
    const before = eventCount();
    const cooking = await remove(ali, { order_id, lines: [{ order_item_id: 'L2' }] });
    expect(cooking.status).toBe(409);
    expect(cooking.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'L2', stage: 'cooking' } });
    expect(eventCount()).toBe(before);
  });

  it('[02b #18] Done from added → refused; served with no Start → refused (stage `added` only)', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([
      { order_item_id: 'L1', item_id: FX.naan, quantity: 1 },
      { order_item_id: 'L2', item_id: FX.naan, quantity: 1 },
      { order_item_id: 'L3', item_id: FX.ready, quantity: 1 },
    ]);
    append([done(order_id, 'L1')]);
    append([fire(FX.station, ['L2']), served(order_id, ['L2'])]);
    expect(engine().lines.L1).toMatchObject({ stage: 'done', started_at: null });
    expect(engine().lines.L2).toMatchObject({ stage: 'served', started_at: null });
    const d = await remove(ali, { order_id, lines: [{ order_item_id: 'L1' }] });
    expect(d.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'L1', stage: 'done' } });
    const s = await remove(ali, { order_id, lines: [{ order_item_id: 'L2' }] });
    expect(s.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'L2', stage: 'served' } });
  });

  it('[02b #18] a line of an order out of the engine (abandoned) → ITEM_WRONG_STAGE { stage: out_of_engine }', async () => {
    await start();
    const order_id = takeaway([{ order_item_id: 'L1', item_id: FX.naan, quantity: 1 }]);
    append([fire(FX.station, ['L1'])]);
    hub.clock.advance(14_400_000 + 3_600_000); // order_abandon_ms (aBranchConfig) + the planned land
    const ali = signIn('S_ALI');
    const r = await remove(ali, { order_id, lines: [{ order_item_id: 'L1' }] });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'L1', stage: 'out_of_engine' } });
  });

  it('[02b #18] one deal part\'s units → its allocated share removed; the deal is billed the rest', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway(deal('D1'));
    const part = lineView(order_id, 'D1b');
    const share = lineShares(part).next_share_minor(1);
    const r = await remove(ali, { order_id, lines: [{ order_item_id: 'D1b', units: 1 }] });
    expect(r.status).toBe(200);
    expect(ofType(r, 'ItemRemoved')).toEqual([{ order_item_id: 'D1b', units: 1 }]);
    expect(lineView(order_id, 'D1b')).toMatchObject({ removed_units: 1, removed_minor: share, billed_minor: 0 });
    expect(lineView(order_id, 'D1').billed_minor).toBe(120_000 - share);
  });

  it('[02b #18] deal remove with one part cooking → refused; every part removed → OrderCancelled', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway(deal('D1'));
    append([fire(FX.station, ['D1a']), started(order_id, 'D1a')]);
    const before = eventCount();
    const r = await remove(ali, { order_id, lines: [{ order_item_id: 'D1' }] });
    expect(r.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'D1a', stage: 'cooking' } });
    expect(eventCount()).toBe(before);

    const other = takeaway(deal('E1'));
    const parts = await remove(ali, { order_id: other, lines: [{ order_item_id: 'E1a' }, { order_item_id: 'E1b' }] });
    expect(parts.status).toBe(200);
    expect(types(parts)).toEqual(['ItemRemoved', 'StockReleased', 'ItemRemoved', 'OrderCancelled']); // the karahi part held K1
    expect(parts.result).toMatchObject({ cancelled: true });
  });

  it('[02b #18] ORDER_BILLED on remove (m-10)', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([{ order_item_id: 'L1', item_id: FX.naan, quantity: 1 }]);
    append([on(order_id, 'OrdersBilled', { order_ids: [order_id], bill_id: 'B1' })]);
    const r = await remove(ali, { order_id, lines: [{ order_item_id: 'L1' }] });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'ORDER_BILLED', details: { order_id } });
  });

  it('[02b #18] dine-in without seating_id → 400; repeated entry → 400 (C6)', async () => {
    await start();
    const ali = signIn('S_ALI');
    const d = dineIn([{ order_item_id: 'L1', item_id: FX.naan, quantity: 2 }]);
    const noSeat = await remove(ali, { order_id: d.order_id, lines: [{ order_item_id: 'L1' }] });
    expect(noSeat.status).toBe(400);
    expect(noSeat.error?.details).toMatchObject({ issues: [{ path: 'seating_id' }] });
    const repeated = await remove(ali, { order_id: d.order_id, seating_id: d.seating_id, lines: [{ order_item_id: 'L1', units: 1 }, { order_item_id: 'L1', units: 1 }] });
    expect(repeated.status).toBe(400);
    expect(repeated.error?.details).toMatchObject({ issues: [{ path: 'lines.1.order_item_id' }] });
  });

  it('[02b #18] lock held by another → TABLE_ALREADY_LOCKED; stale seating_id → TABLE_SEATING_CHANGED', async () => {
    await start();
    const ali = signIn('S_ALI');
    const d = dineIn([{ order_item_id: 'L1', item_id: FX.naan, quantity: 2 }]);
    const stale = await remove(ali, { order_id: d.order_id, seating_id: 'SEAT_OLD', lines: [{ order_item_id: 'L1' }] });
    expect(stale.status).toBe(409);
    expect(stale.error?.code).toBe('TABLE_SEATING_CHANGED');
    append([{ stream_type: 'table', stream_id: FX.table, event_type: 'TableLocked', payload: { table_id: FX.table, seating_id: d.seating_id, staff_id: 'S_SARA' } }], 'S_SARA');
    const before = eventCount();
    const locked = await remove(ali, { order_id: d.order_id, seating_id: d.seating_id, lines: [{ order_item_id: 'L1' }] });
    expect(locked.status).toBe(409);
    expect(locked.error).toMatchObject({ code: 'TABLE_ALREADY_LOCKED', details: { table_id: FX.table, locked_by_staff_id: 'S_SARA' } });
    expect(eventCount()).toBe(before);
  });

  it('[02b §3.14] dine-in scope last: my_floors without the table\'s floor → 403 outside_scope, nothing appended', async () => {
    await start();
    const d = dineIn([{ order_item_id: 'L1', item_id: FX.naan, quantity: 2 }], { holder: 'S_NOFLOOR' });
    const noFloor = signIn('S_NOFLOOR');
    const before = eventCount();
    const r = await remove(noFloor, { order_id: d.order_id, seating_id: d.seating_id, lines: [{ order_item_id: 'L1' }] });
    expect(r.status).toBe(403);
    expect(r.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope' } });
    expect(eventCount()).toBe(before);
    const zain = dineIn([{ order_item_id: 'M1', item_id: FX.naan, quantity: 2 }], { holder: 'S_ZAIN', seating_id: 'SEAT2', table_id: FX.zoneTable });
    const ok = await remove(signIn('S_ZAIN'), { order_id: zain.order_id, seating_id: zain.seating_id, lines: [{ order_item_id: 'M1' }] });
    expect(ok.status).toBe(200);
  });

  // ----------------------------------------------------------------------------------------- #23

  it('[02b #23 remove] takeaway removed by its placer with own_tables / my_floors → allowed; by another → outside_scope; branch any', async () => {
    await start();
    const omars = takeaway([{ order_item_id: 'L1', item_id: FX.naan, quantity: 3 }], 'S_OMAR');
    expect((await remove(signIn('S_OMAR'), { order_id: omars, lines: [{ order_item_id: 'L1', units: 1 }] })).status).toBe(200);
    const asif = await remove(signIn('S_ASIF'), { order_id: omars, lines: [{ order_item_id: 'L1', units: 1 }] });
    expect(asif.status).toBe(403);
    expect(asif.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope' } });
    const noor = await remove(signIn('S_NOOR'), { order_id: omars, lines: [{ order_item_id: 'L1', units: 1 }] });
    expect(noor.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope' } });
    expect((await remove(signIn('S_SARA'), { order_id: omars, lines: [{ order_item_id: 'L1', units: 1 }] })).status).toBe(200);

    const zains = appendOrder(hub, { order_type: 'parking', placed_by: 'S_ZAIN', lines: [{ order_item_id: 'P1', item_id: FX.naan, quantity: 2 }] }).order_id;
    expect((await remove(signIn('S_ZAIN'), { order_id: zains, lines: [{ order_item_id: 'P1', units: 1 }] })).status).toBe(200);
    expect((await remove(signIn('S_NOOR'), { order_id: zains, lines: [{ order_item_id: 'P1', units: 1 }] })).status).toBe(403);
    expect(line('L1').removed_units).toBe(2);
    expect(line('P1').removed_units).toBe(1);
  });

  // ----------------------------------------------------------------------------------------- #15

  it('[02b #15] undo a zone line within zone_undo_ms → count + 1, no absent-id log (Q-3); after → ITEM_WRONG_STAGE', async () => {
    await start();
    setZoneStock(hub, FX.zone, FX.zoneItem, 5);
    const ali = signIn('S_ALI');
    const d = dineIn(
      [
        { order_item_id: 'K1', item_id: FX.piece, quantity: 1 },
        { order_item_id: 'Z1', item_id: FX.zoneItem, quantity: 1, from_zone: true },
        { order_item_id: 'Z2', item_id: FX.zoneItem, quantity: 1, from_zone: true },
      ],
      { table_id: FX.zoneTable },
    );
    expect(zoneCount()).toBe(3);
    const r = await remove(ali, { order_id: d.order_id, seating_id: d.seating_id, lines: [{ order_item_id: 'Z1' }] }, { counted: true });
    expect(r.status).toBe(200);
    expect(types(r)).toEqual(['TableLocked', 'ItemRemoved']); // the karahi is still cooking: no OrderFoodCleared
    expect(zoneCount()).toBe(4);
    expect(lastStatements).toBe(4); // §6.2: + 1 zone alerts (listOpen for zone:Z1) with a zone line in the payload
    expect(hub.logs()).not.toMatch(/absent id/);

    hub.clock.advance(300_001);
    const late = await remove(ali, { order_id: d.order_id, seating_id: d.seating_id, lines: [{ order_item_id: 'Z2' }] });
    expect(late.status).toBe(409);
    expect(late.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'Z2', stage: 'served' } });
    expect(zoneCount()).toBe(4);
  });

  it('[02b #15] the fold adds back regardless of the setting: replay with a changed zone_undo_ms → same count', async () => {
    await start();
    setZoneStock(hub, FX.zone, FX.zoneItem, 5);
    const ali = signIn('S_ALI');
    const d = dineIn([{ order_item_id: 'Z1', item_id: FX.zoneItem, quantity: 2, from_zone: true }], { table_id: FX.zoneTable });
    expect((await remove(ali, { order_id: d.order_id, seating_id: d.seating_id, lines: [{ order_item_id: 'Z1', units: 1 }] })).status).toBe(200);
    expect(zoneCount()).toBe(4);
    const menu = branchConfig()!;
    swapBranchConfig({ config: { ...menu, engine_settings: { ...menu.engine_settings, zone_undo_ms: 0 } }, snapshotHash: 'e'.repeat(64), configVersion: menu.config_version + 1, snapshotSchemaVersion: 4, appliedAt: hub.clock.branchNow() });
    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'orders'`).run();
    const registry = createProjectionRegistry();
    registerOrdersProjection(registry);
    registry.catchUp(hub.deps.db, hub.deps.config.provisioned!.branch_id);
    expect(zoneCount()).toBe(4);
  });

  it('[02b #15] undo on a zone-only round works (zone rule before the engine stage) → OrderCancelled', async () => {
    await start();
    setZoneStock(hub, FX.zone, FX.zoneItem, 5);
    const ali = signIn('S_ALI');
    const d = dineIn([{ order_item_id: 'Z1', item_id: FX.zoneItem, quantity: 1, from_zone: true }], { table_id: FX.zoneTable });
    expect(engine().orders[d.order_id]).toBeUndefined();
    const r = await remove(ali, { order_id: d.order_id, seating_id: d.seating_id, lines: [{ order_item_id: 'Z1' }] });
    expect(r.status).toBe(200);
    expect(types(r)).toEqual(['TableLocked', 'ItemRemoved', 'OrderCancelled']);
    expect(zoneCount()).toBe(5);
    expect(hub.logs()).not.toMatch(/absent id/);
  });

  it('[02b #15] an undo lifting the count above the threshold closes the low and out alerts done (m-6)', async () => {
    await start();
    setZoneStock(hub, FX.zone, FX.zoneItem, 3);
    const ali = signIn('S_ALI');
    const d = dineIn([{ order_item_id: 'Z1', item_id: FX.zoneItem, quantity: 3, from_zone: true }], { table_id: FX.zoneTable });
    expect(zoneCount()).toBe(0);
    // The submit's alert drafts for 3 → 0 (task 12's path) through the real zoneAlertDrafts: low (threshold 2) and out.
    hub.deps.writer.run((tx) => {
      tx.append(zoneAlertDrafts(ctxOf(tx), [{ zone_id: FX.zone, item_id: FX.zoneItem, before: 3, after: 0 }]));
    });
    const open = () => (hub.deps.db.prepare(`SELECT kind FROM alerts WHERE state = 'open' ORDER BY kind`).all() as Array<{ kind: string }>).map((a) => a.kind);
    expect(open()).toEqual(['zone_stock_low', 'zone_stock_out']);
    const r = await remove(ali, { order_id: d.order_id, seating_id: d.seating_id, lines: [{ order_item_id: 'Z1' }] });
    expect(r.status).toBe(200);
    expect(zoneCount()).toBe(3);
    expect(open()).toEqual([]);
    expect(ofType(r, 'AlertClosed')).toMatchObject([{ reason: 'done' }, { reason: 'done' }]);
    expect(types(r)).toEqual(['TableLocked', 'ItemRemoved', 'OrderCancelled', 'AlertClosed', 'AlertClosed']);
  });

  // ----------------------------------------------------------------------------------------- #19

  it('[02b #19 command] comp 2 then remove 2 of 2 naan → comp_minor 0, removed_minor 20 000, total ≥ 0; the units leave comped_units', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([{ order_item_id: 'N1', item_id: FX.naan, quantity: 2, item: { price_minor: 10_000, line_total_minor: 20_000 } }]);
    comp(order_id, 'N1', 2);
    expect(line('N1')).toMatchObject({ comped_units: 2, comp_minor: 20_000 });
    const r = await remove(ali, { order_id, lines: [{ order_item_id: 'N1', units: 2 }] });
    expect(r.status).toBe(200);
    expect(lineView(order_id, 'N1')).toMatchObject({ comped_units: 0, comp_minor: 0, removed_units: 2, removed_minor: 20_000, billed_minor: 0 });
  });

  it('[02b #19 command] remove 1 then void 2 (fixture ItemVoided from lineShares) → refunds = remaining shares, total 0', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([{ order_item_id: 'N1', item_id: FX.naan, quantity: 3, item: { price_minor: 10_001, line_total_minor: 30_003 } }]);
    expect((await remove(ali, { order_id, lines: [{ order_item_id: 'N1', units: 1 }] })).status).toBe(200);
    expect(line('N1')).toMatchObject({ removed_units: 1, removed_minor: 10_001 });
    const remaining = lineShares(lineView(order_id, 'N1')).next_share_minor(2);
    voidUnits(order_id, 'N1', 2);
    expect(lineView(order_id, 'N1')).toMatchObject({ voided_units: 2, refund_minor: remaining, billed_minor: 0 });
    expect(remaining).toBe(20_002);
  });

  it('[02b #19 command] comp then void → comp_voided_minor, refund_minor 0 (O21)', async () => {
    await start();
    const order_id = takeaway([{ order_item_id: 'N1', item_id: FX.naan, quantity: 2, item: { price_minor: 10_000, line_total_minor: 20_000 } }]);
    comp(order_id, 'N1', 2);
    voidUnits(order_id, 'N1', 1);
    expect(lineView(order_id, 'N1')).toMatchObject({ comped_units: 1, comp_minor: 10_000, voided_units: 1, comp_voided_minor: 10_000, refund_minor: 0, billed_minor: 0 });
  });

  it('[02b #19 command] the remainder share comped then taken back (3 units of 10 001: 3 333, 3 333, 3 335) → take-back 3 335 first', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([{ order_item_id: 'N1', item_id: FX.naan, quantity: 3, item: { price_minor: 3_333, line_total_minor: 10_001 } }]);
    comp(order_id, 'N1', 3);
    expect(line('N1')).toMatchObject({ comped_units: 3, comp_minor: 10_001 });
    expect((await remove(ali, { order_id, lines: [{ order_item_id: 'N1', units: 1 }] })).status).toBe(200);
    expect(lineView(order_id, 'N1')).toMatchObject({ comped_units: 2, comp_minor: 6_666, removed_units: 1, removed_minor: 3_335, billed_minor: 0 });
  });

  // ----------------------------------------------------------------------------------------- #37 / #39

  it('[02b #37 remove] remove 1 of 2 deals at stage 1 → each part\'s per-portion units removed, one event per line', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway(deal('D1', 2));
    expect([line('D1a').units, line('D1b').units]).toEqual([2, 4]);
    const r = await remove(ali, { order_id, lines: [{ order_item_id: 'D1', units: 1 }] });
    expect(r.status).toBe(200);
    expect(ofType(r, 'ItemRemoved')).toEqual([
      { order_item_id: 'D1', units: 1 },
      { order_item_id: 'D1a', units: 1 },
      { order_item_id: 'D1b', units: 2 },
    ]);
    expect(r.result).toMatchObject({ removed: [{ order_item_id: 'D1', units: 1 }, { order_item_id: 'D1a', units: 1 }, { order_item_id: 'D1b', units: 2 }], cancelled: false });
    expect(engine().lines.D1b?.units).toBe(2);
    const billed = lineView(order_id, 'D1').billed_minor;
    expect(billed).toBe(240_000 - (lineView(order_id, 'D1a').removed_minor + lineView(order_id, 'D1b').removed_minor));
  });

  it('[02b #37 remove] cascade capped: remove 1 naan part unit of the family deal, then the whole deal → 3 naan units removed, no 500', async () => {
    await start({ menu: bigMenu() });
    const ali = signIn('S_ALI');
    const order_id = takeaway([
      { order_item_id: 'F1', deal_id: 'D_FAMILY', quantity: 1 },
      { order_item_id: 'F1a', deal_id: 'D_FAMILY', deal_part_id: 'FP_MAIN', item_id: FX.naan, parent_order_item_id: 'F1' },
      { order_item_id: 'F1b', deal_id: 'D_FAMILY', deal_part_id: 'FP_NAAN', item_id: FX.naan, parent_order_item_id: 'F1' },
    ]);
    expect((await remove(ali, { order_id, lines: [{ order_item_id: 'F1b', units: 1 }] })).status).toBe(200);
    const r = await remove(ali, { order_id, lines: [{ order_item_id: 'F1' }] });
    expect(r.status).toBe(200);
    expect(ofType(r, 'ItemRemoved')).toEqual([
      { order_item_id: 'F1', units: 1 },
      { order_item_id: 'F1a', units: 1 },
      { order_item_id: 'F1b', units: 3 },
    ]);
    expect(types(r).at(-1)).toBe('OrderCancelled');
    expect(lineView(order_id, 'F1b')).toMatchObject({ removed_units: 4, live_units: 0 });
    expect(lineView(order_id, 'F1').billed_minor).toBe(0);
  });

  it('[02b #37 remove] deal × 2 with a 1 kg (g) part at stage 1: remove 1 deal → 400 gml_deal_part_partial, nothing appended; remove both → allowed (M-1)', async () => {
    await start({ menu: bigMenu() });
    const ali = signIn('S_ALI');
    const order_id = takeaway([
      { order_item_id: 'G1', deal_id: 'D_KG', quantity: 2 },
      { order_item_id: 'G1a', deal_id: 'D_KG', deal_part_id: 'KP_MAIN', item_id: 'I_KG', parent_order_item_id: 'G1' },
      { order_item_id: 'G1b', deal_id: 'D_KG', deal_part_id: 'KP_NAAN', item_id: FX.naan, parent_order_item_id: 'G1' },
    ]);
    expect(line('G1a')).toMatchObject({ sale_unit: 'g', units: 2 });
    const before = eventCount();
    const one = await remove(ali, { order_id, lines: [{ order_item_id: 'G1', units: 1 }] });
    expect(one.status).toBe(400);
    expect(one.error).toEqual({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'lines.0.units', message: 'gml_deal_part_partial' }] } });
    const part = await remove(ali, { order_id, lines: [{ order_item_id: 'G1a', units: 1 }] });
    expect(part.error).toEqual({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'lines.0.units', message: 'gml_deal_part_partial' }] } });
    expect(eventCount()).toBe(before);

    const both = await remove(ali, { order_id, lines: [{ order_item_id: 'G1', units: 2 }] });
    expect(both.status).toBe(200);
    expect(ofType(both, 'ItemRemoved')).toEqual([
      { order_item_id: 'G1', units: 2 },
      { order_item_id: 'G1a', units: 2 },
      { order_item_id: 'G1b', units: 4 },
    ]);
    expect(engine().lines.G1a?.stage).toBe('removed');
    expect(both.result).toMatchObject({ cancelled: true });
  });

  it('[02b #39 remove] option child capped: remove 1 of 3 child raitas, then the karahi → 2 child units removed; each cascaded line has its own event', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([
      { order_item_id: 'K1', item_id: FX.piece, quantity: 1 },
      { order_item_id: 'K1o', item_id: FX.optionItem, option_id: FX.option, parent_order_item_id: 'K1', quantity: 3 },
    ]);
    expect(line('K1o').units).toBe(3);
    expect(ofType(await remove(ali, { order_id, lines: [{ order_item_id: 'K1o', units: 1 }] }), 'ItemRemoved')).toEqual([{ order_item_id: 'K1o', units: 1 }]);
    const r = await remove(ali, { order_id, lines: [{ order_item_id: 'K1' }] });
    expect(r.status).toBe(200);
    expect(ofType(r, 'ItemRemoved')).toEqual([
      { order_item_id: 'K1', units: 1 },
      { order_item_id: 'K1o', units: 2 },
    ]);
    expect(lineView(order_id, 'K1o')).toMatchObject({ removed_units: 3, live_units: 0 });
    expect(r.result).toMatchObject({ cancelled: true });
  });

  it('[02b §3.5] a parent and its child in one payload: the cascade is counted once, units > live → 400, nothing appended', async () => {
    await start();
    const ali = signIn('S_ALI');
    const order_id = takeaway([
      { order_item_id: 'K1', item_id: FX.piece, quantity: 2 },
      { order_item_id: 'K1o', item_id: FX.optionItem, option_id: FX.option, parent_order_item_id: 'K1', quantity: 1 },
    ]);
    const before = eventCount();
    const r = await remove(ali, { order_id, lines: [{ order_item_id: 'K1' }, { order_item_id: 'K1o', units: 1 }] });
    expect(r.status).toBe(400);
    expect(r.error?.details).toMatchObject({ issues: [{ path: 'lines.1.units' }] });
    expect(eventCount()).toBe(before);
    const ok = await remove(ali, { order_id, lines: [{ order_item_id: 'K1o', units: 1 }, { order_item_id: 'K1', units: 1 }] });
    expect(ok.status).toBe(200);
    // the child's own unit, then the parent's 1 of 2 with its cascade (capped at the child's 1 live unit): one event per line
    expect(ofType(ok, 'ItemRemoved')).toEqual([
      { order_item_id: 'K1o', units: 2 },
      { order_item_id: 'K1', units: 1 },
    ]);
  });

  // ----------------------------------------------------------------------------------------- §3.3 food

  it('[02b §3.3] removing the last unserved food line of a live order → OrderFoodCleared { food_served }', async () => {
    await start();
    const ali = signIn('S_ALI');
    const d = dineIn([
      { order_item_id: 'K1', item_id: FX.piece, quantity: 1 },
      { order_item_id: 'W1', item_id: FX.ready, quantity: 1 },
    ]);
    const r = await remove(ali, { order_id: d.order_id, seating_id: d.seating_id, lines: [{ order_item_id: 'K1' }] });
    expect(r.status).toBe(200);
    expect(types(r)).toEqual(['TableLocked', 'ItemRemoved', 'StockReleased', 'OrderFoodCleared']);
    expect(ofType(r, 'OrderFoodCleared')).toEqual([{ order_id: d.order_id, food_served: false }]);
    expect(r.events.find((e) => e.event_type === 'OrderFoodCleared')).toMatchObject({ actor_id: 'S_ALI', device_id: ali.deviceId });
  });
});

// ------------------------------------------------------------------------------------------- lineChangeDrafts

function ctxOf(tx: WriterTx): CommandCtx {
  return {
    tx,
    state: tx.state,
    clock: tx.clock,
    ids: tx.ids,
    actor: { kind: 'device', staffId: 'S_MGR', stationId: null, sessionId: 'SESS', deviceId: 'D_VOID' },
    branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
    directory: currentDirectory(hub.app),
    permission: null,
    queuedAt: null,
  } as unknown as CommandCtx;
}

describe('lineChangeDrafts (02b §3.5 Export, To 04)', () => {
  it('[02b §3.5] 2 statements (lines, comp listOpen); OrderFoodCleared after a void of the last food line; no close when none is open', async () => {
    await start();
    const order_id = takeaway([
      { order_item_id: 'K1', item_id: FX.piece, quantity: 2 },
      { order_item_id: 'W1', item_id: FX.ready, quantity: 1 },
    ]);
    const drafts = hub.deps.writer.run((tx) => {
      counter.reset();
      const out = lineChangeDrafts(ctxOf(tx), order_id, [{ order_item_id: 'K1', units_out: 2 }]);
      expect(counter.count).toBe(2);
      return out;
    }).result;
    expect(drafts.map((d) => [d.event_type, d.payload, d.actor_id, d.device_id])).toEqual([['OrderFoodCleared', { order_id, food_served: false }, 'S_MGR', 'D_VOID']]);

    const partial = hub.deps.writer.run((tx) => lineChangeDrafts(ctxOf(tx), order_id, [{ order_item_id: 'K1', units_out: 1 }])).result;
    expect(partial).toEqual([]);
  });

  it('[02b §3.5] the order emptied → OrderCancelled; cascaded entries of one line add up', async () => {
    await start();
    const order_id = takeaway([{ order_item_id: 'N1', item_id: FX.naan, quantity: 3 }]);
    const drafts = hub.deps.writer.run((tx) =>
      lineChangeDrafts(ctxOf(tx), order_id, [
        { order_item_id: 'N1', units_out: 1 },
        { order_item_id: 'N1', units_out: 2 },
      ]),
    ).result;
    expect(drafts.map((d) => [d.event_type, d.payload])).toEqual([['OrderCancelled', { order_id }]]);
  });

  it('[02b §3.13] seatingTotals after a remove counts only billed money', async () => {
    await start();
    const ali = signIn('S_ALI');
    const d = dineIn([{ order_item_id: 'N1', item_id: FX.naan, quantity: 2, item: { price_minor: 10_000, line_total_minor: 20_000 } }]);
    expect(seatingTotals(hub.deps.db, d.seating_id).total_minor).toBe(20_000);
    expect((await remove(ali, { order_id: d.order_id, seating_id: d.seating_id, lines: [{ order_item_id: 'N1', units: 1 }] })).status).toBe(200);
    expect(seatingTotals(hub.deps.db, d.seating_id).total_minor).toBe(10_000);
  });
});
