import { ORDER_EXIT_AFTER_SERVED_MS, type EngineState } from '@pos/engine';
import type { DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { returnToKitchenCommand } from '../../src/orders/commands/return-to-kitchen';
import { orderLines } from '../../src/orders/exports';
import { voidUnits } from '../../src/orders/ledger';
import { branchConfig, runBranchConfigHooks, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { appendOrder, fixtureMenu, FX, openDay, openSeating } from './fixtures';

// 02b §6.7, §3.8 (E-4, E-7), §3.3 (non-food return), §3.4 (return lines), §3.14 ReturnToKitchen. Orders are seeded
// through the shared fixtures (real submit batches); engine progress (fire / start / done / served), removals, voids
// and the 02a move are real events through the writer; the return batch is folded by the real engine and projections.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;

/** The naan's 01a A-11 adjust_time_ms in the test menu (distinct from every cook time). */
const ADJUST_MS = 123_000;

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
      // 02b §3.14 default order taker: mark-item-returned at branch.
      role('R_TAKER', [grant('mark-served'), grant('mark-item-returned')]),
      // 01b §6.15 default waiter: mark-served only, no mark-item-returned.
      role('R_WAITER', [grant('mark-served')]),
      role('R_OWN', [grant('mark-item-returned', 'own_tables')]),
      role('R_FLOOR', [grant('mark-item-returned', 'my_floors')]),
    ],
    staff: [
      ...base.staff,
      person('S_TAKER', 'R_TAKER'),
      person('S_TAKER2', 'R_TAKER'),
      person('S_WAITER', 'R_WAITER'),
      person('S_OWN1', 'R_OWN'),
      person('S_OWN2', 'R_OWN'),
      person('S_FLOOR', 'R_FLOOR', [FX.floor]),
      person('S_FAR', 'R_FLOOR', ['F_OTHER']),
    ],
  };
}

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  // The real handler under a test-only name, so its own statements are counted (02a R-2D-6 pattern).
  commandRegistry(hub.app).register(
    defineCommand({
      ...returnToKitchenCommand,
      commandType: 'TestReturnToKitchenCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        try {
          return returnToKitchenCommand.handle(ctx, payload, cmd);
        } finally {
          lastStatements = counter.count - before;
        }
      },
    }),
  );
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
});

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

// ------------------------------------------------------------------------------------------- seeding

const engine = (): EngineState => hub.deps.state.get() as EngineState;

/** fixtureMenu() with the naan's adjust_time_ms set to ADJUST_MS. */
function menu() {
  const m = fixtureMenu();
  return { ...m, items: m.items.map((i) => (i.item_id === FX.naan ? { ...i, adjust_time_ms: ADJUST_MS } : i)) };
}
const open = () => openDay(hub, { menu: menu() });

function draft(stream_type: EventDraft['stream_type'], stream_id: string, event_type: string, payload: Record<string, unknown>): EventDraft {
  return { stream_type, stream_id, event_type, schema_version: 1, payload, occurred_at: hub.clock.branchNow(), actor_id: 'S_WAIT', device_id: 'D_SEED' };
}
function append(...drafts: EventDraft[]): void {
  hub.clock.advance(1_000);
  hub.deps.writer.run((tx) => tx.append(drafts));
}
const fire = (...order_item_ids: string[]) => {
  const station_id = engine().lines[order_item_ids[0]!]!.station_id;
  append(draft('station', station_id, 'FireDispatched', { station_id, order_item_ids, load_id: null, due_at: hub.clock.branchNow(), reason: 'pulled' }));
};
const start = (order_id: string, order_item_id: string) =>
  append(draft('order', order_id, 'ItemStarted', { order_item_id, started_at: hub.clock.branchNow(), source: 'tap' }));
const done = (order_id: string, order_item_id: string) =>
  append(draft('order', order_id, 'ItemDone', { order_item_id, done_at: hub.clock.branchNow(), source: 'tap' }));
const served = (order_id: string, ...order_item_ids: string[]) => append(draft('order', order_id, 'ItemServed', { order_item_ids, source: 'tap' }));
/** fire → start → done → served, one line at a time (real engine events). */
function cookAndServe(order_id: string, ...ids: string[]): void {
  for (const id of ids) {
    fire(id);
    start(order_id, id);
    done(order_id, id);
    served(order_id, id);
  }
}
const remove = (order_id: string, order_item_id: string) => append(draft('order', order_id, 'ItemRemoved', { order_item_id }));
function voidAll(order_id: string, order_item_id: string): void {
  const line = orderLines(hub.deps.db, [order_id]).get(order_id)!.find((l) => l.order_item_id === order_item_id)!;
  const { refund_minor, comp_voided_minor } = voidUnits(line, line.live_units);
  append(draft('order', order_id, 'ItemVoided', { order_item_id, units: line.live_units, refund_minor, comp_voided_minor }));
}

function eventCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}
function alertCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM alerts').get() as { n: number }).n;
}
function lineOf(order_id: string, order_item_id: string) {
  return orderLines(hub.deps.db, [order_id]).get(order_id)!.find((l) => l.order_item_id === order_item_id)!;
}
function itemAddedOf(order_item_id: string): Record<string, unknown> {
  const row = hub.deps.db
    .prepare(`SELECT payload FROM events WHERE event_type = 'ItemAdded' AND json_extract(payload, '$.order_item_id') = ? ORDER BY seq LIMIT 1`)
    .get(order_item_id) as { payload: string };
  return JSON.parse(row.payload) as Record<string, unknown>;
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

type Payload = { order_item_id: string; return_order_item_id: string; mode: 'fix' | 'remake' };
let commandSeq = 0;

async function send(who: Who, payload: unknown, o: { commandId?: string; counted?: boolean } = {}): Promise<Reply> {
  commandSeq += 1;
  const type = o.counted === true ? 'TestReturnToKitchenCounted' : 'ReturnToKitchen';
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${o.counted === true ? 'test-return-to-kitchen-counted' : 'return-to-kitchen'}`,
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
  const body = res.json() as {
    data?: { event_ids: string[]; result: Record<string, unknown> };
    error?: { code: string; details: Record<string, unknown> };
  };
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
const ret = (who: Who, p: Payload, o: { commandId?: string; counted?: boolean } = {}) => send(who, p, o);

/** A takeaway of one naan N1 (and `more` lines), N1 cooked and served. */
function servedNaan(more: Array<{ order_item_id: string; item_id: string }> = [], placed_by?: string): string {
  const order_id = appendOrder(hub, {
    order_type: 'takeaway',
    ...(placed_by === undefined ? {} : { placed_by }),
    lines: [{ order_item_id: 'N1', item_id: FX.naan }, ...more],
  }).order_id;
  cookAndServe(order_id, 'N1');
  return order_id;
}

/** The ItemAdded money of a return line (03a #103, 02b §3.4): 0, never billed. */
const RETURN_MONEY = { price_minor: 0, line_total_minor: 0, tax_class_id: null, extra_price_minor: null, allocated_price_minor: null, options: [] };
/** 03a #114: a plain line. */
const RETURN_LINKS = { line_kind: 'item', parent_order_item_id: null, deal_id: null, deal_part_id: null, option_id: null, option_quantity: null };

// ------------------------------------------------------------------------------------------- §3.8 / §6.7

describe('ReturnToKitchen (02b §6.7, §3.8)', () => {
  it('[02b #25] fix: planOrder groups present, OrderLinesAdded + ItemAdded (money 0, return_of), cook_ms_override = adjust_time_ms; no ItemReturned', async () => {
    open();
    const o1 = servedNaan();
    const original = itemAddedOf('N1');
    const order = engine().orders[o1]!;
    const nextGroup = order.next_group_index;
    const taker = signIn('S_TAKER');

    const reply = await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'fix' });
    expect(reply.status).toBe(200);
    const envelope = { stream_type: 'order', stream_id: o1, actor_id: 'S_TAKER', device_id: taker.deviceId };
    expect(reply.events.map((e) => e.event_type)).toEqual(['OrderLinesAdded', 'ItemAdded']);
    for (const e of reply.events) expect(e).toMatchObject(envelope);

    const added = reply.events[0]!.payload as {
      order_id: string;
      order_item_ids: string[];
      groups: Array<{ group_id: string; target_land_ms: number; promise_ms: number; order_item_ids: string[] }>;
      lines: Array<Record<string, unknown>>;
    };
    expect(added.order_id).toBe(o1);
    expect(added.order_item_ids).toEqual(['R1']);
    expect(added.groups).toHaveLength(1);
    expect(added.groups[0]).toMatchObject({ group_id: `${o1}:${nextGroup}`, order_item_ids: ['R1'] });
    expect(added.lines).toHaveLength(1);
    expect(added.lines[0]).toMatchObject({
      order_item_id: 'R1',
      station_id: FX.station,
      from_stock: false,
      return_of: { order_item_id: 'N1', mode: 'fix' },
      cook_ms_override: ADJUST_MS,
    });
    expect(reply.result).toEqual({ eta_ms: expect.any(Number), promise_ms: added.groups[0]!.promise_ms });

    // The ItemAdded: the served line's copy except money and links, return_of = the returned line (AD-15).
    expect(reply.events[1]!.payload).toEqual({
      ...original,
      ...RETURN_MONEY,
      ...RETURN_LINKS,
      order_item_id: 'R1',
      stock_draws: [],
      served_from_zone_id: null,
      return_of: 'N1',
    });

    // The engine holds it as a return line; the projection has it at money 0, the served line untouched (fix).
    expect(engine().lines.R1).toMatchObject({ order_id: o1, mark: 'return', serve_mode: 'immediate', cook_ms: ADJUST_MS, return_of: { order_item_id: 'N1', mode: 'fix' } });
    expect(engine().lines.N1!.stage).toBe('served');
    expect(reply.result!.eta_ms).toBe(added.groups[0]!.target_land_ms);
    expect(lineOf(o1, 'R1')).toMatchObject({ return_of: 'N1', refundable_minor: 0, billed_minor: 0, line_total_minor: 0, served_at: null, is_food: true });
    expect(lineOf(o1, 'N1')).toMatchObject({ returned_units: 0, billed_minor: 3_000 });
  });

  it('[02b #25] remake: OrderLinesAdded + ItemAdded + ItemReturned; normal cook, cook_ms_override null; the remade line stays billable (O20)', async () => {
    open();
    const o1 = servedNaan();
    const reply = await ret(signIn('S_TAKER'), { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'remake' });
    expect(reply.status).toBe(200);
    expect(reply.events.map((e) => e.event_type)).toEqual(['OrderLinesAdded', 'ItemAdded', 'ItemReturned']);
    expect((reply.events[0]!.payload.lines as unknown[])[0]).toMatchObject({ return_of: { order_item_id: 'N1', mode: 'remake' }, cook_ms_override: null });
    expect(reply.events[1]!.payload).toMatchObject({ ...RETURN_MONEY, ...RETURN_LINKS, order_item_id: 'R1', return_of: 'N1' });
    expect(reply.events[2]!.payload).toEqual({ order_item_id: 'N1', mode: 'remake', replacement_order_item_id: 'R1' });

    expect(engine().lines.N1!.stage).toBe('returned');
    expect(engine().lines.R1).toMatchObject({ mark: 'return', cook_ms: 300_000, return_of: { order_item_id: 'N1', mode: 'remake' } });
    expect(lineOf(o1, 'N1')).toMatchObject({ returned_units: 1, live_units: 1, billed_minor: 3_000 });
    expect(lineOf(o1, 'R1')).toMatchObject({ return_of: 'N1', billed_minor: 0 });
  });

  it('[02b #25] a second return while the first is open → 409 RETURN_ALREADY_OPEN, nothing appended; after the replacement is served a fix is accepted again', async () => {
    open();
    const o1 = servedNaan();
    const taker = signIn('S_TAKER');
    expect((await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'fix' })).status).toBe(200);
    const before = eventCount();

    const second = await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R2', mode: 'fix' });
    expect(second.status).toBe(409);
    expect(second.error).toEqual({ code: 'RETURN_ALREADY_OPEN', details: { order_item_id: 'N1', return_order_item_id: 'R1' } });
    expect(eventCount()).toBe(before);

    cookAndServe(o1, 'R1');
    const third = await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R2', mode: 'fix' });
    expect(third.status).toBe(200);
    expect(engine().lines.R2).toMatchObject({ return_of: { order_item_id: 'N1', mode: 'fix' } });
  });

  it('[02b #25] remake, serve the replacement, Return the original → ITEM_WRONG_STAGE { stage: returned }; Return the replacement → accepted', async () => {
    open();
    const o1 = servedNaan();
    const taker = signIn('S_TAKER');
    expect((await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'remake' })).status).toBe(200);
    // While the replacement is open, the remade original is refused by the remade rule (spec order: remade first).
    const open1 = await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R2', mode: 'fix' });
    expect(open1.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'N1', stage: 'returned' } });
    cookAndServe(o1, 'R1');
    const before = eventCount();

    const original = await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R2', mode: 'remake' });
    expect(original.status).toBe(409);
    expect(original.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'N1', stage: 'returned' } });
    expect(eventCount()).toBe(before);

    const replacement = await ret(taker, { order_item_id: 'R1', return_order_item_id: 'R2', mode: 'remake' });
    expect(replacement.status).toBe(200);
    expect(replacement.events.map((e) => e.event_type)).toEqual(['OrderLinesAdded', 'ItemAdded', 'ItemReturned']);
    expect(replacement.events[1]!.payload).toMatchObject({ order_item_id: 'R2', return_of: 'R1', item_id: FX.naan, ...RETURN_MONEY });
    expect(engine().lines.R1!.stage).toBe('returned');
    expect(engine().lines.R2).toMatchObject({ return_of: { order_item_id: 'R1', mode: 'remake' } });
  });

  it('[02b #25] E-7: inside the 30-min window after the last serve → accepted; after it → 409 ORDER_NOT_IN_ENGINE, nothing appended, no alert', async () => {
    open();
    const o1 = servedNaan();
    const taker = signIn('S_TAKER');
    hub.clock.advance(ORDER_EXIT_AFTER_SERVED_MS - 60_000);
    expect((await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'fix' })).status).toBe(200);

    const o2 = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'M1', item_id: FX.naan }] }).order_id;
    cookAndServe(o2, 'M1');
    hub.clock.advance(ORDER_EXIT_AFTER_SERVED_MS);
    const events = eventCount();
    const alerts = alertCount();
    const late = await ret(taker, { order_item_id: 'M1', return_order_item_id: 'R2', mode: 'remake' });
    expect(late.status).toBe(409);
    expect(late.error).toEqual({ code: 'ORDER_NOT_IN_ENGINE', details: { order_id: o2 } });
    expect(eventCount()).toBe(events);
    expect(alertCount()).toBe(alerts);
    expect(lineOf(o1, 'R1').return_of).toBe('N1');
  });

  it('[02b #25] 03a #114: a return of a deal_part and of an option_child → line_kind item, every link null, options [], quantity copied, money 0', async () => {
    open();
    const o1 = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'D1', deal_id: FX.deal, quantity: 2 },
        { order_item_id: 'DP1', deal_part_id: FX.dealParts[0], parent_order_item_id: 'D1' },
        { order_item_id: 'DP2', deal_part_id: FX.dealParts[1], parent_order_item_id: 'D1' },
        { order_item_id: 'K1', item_id: FX.piece },
        { order_item_id: 'K1R', option_id: FX.option, parent_order_item_id: 'K1', quantity: 2 },
      ],
    }).order_id;
    cookAndServe(o1, 'DP2', 'K1R');
    const taker = signIn('S_TAKER');

    const part = await ret(taker, { order_item_id: 'DP2', return_order_item_id: 'R1', mode: 'remake' });
    expect(part.status).toBe(200);
    expect(part.events[1]!.payload).toMatchObject({ ...RETURN_MONEY, ...RETURN_LINKS, item_id: FX.naan, quantity: 4, return_of: 'DP2' });
    expect(itemAddedOf('DP2')).toMatchObject({ line_kind: 'deal_part', quantity: 4 });

    const child = await ret(taker, { order_item_id: 'K1R', return_order_item_id: 'R2', mode: 'fix' });
    expect(child.status).toBe(200);
    expect(child.events[1]!.payload).toMatchObject({ ...RETURN_MONEY, ...RETURN_LINKS, item_id: FX.optionItem, quantity: 2, return_of: 'K1R' });
    expect(lineOf(o1, 'R2')).toMatchObject({ line_kind: 'item', units: 2, billed_minor: 0, refundable_minor: 0 });
  });

  it('[02b #25] stage errors: unfired / cooking / done → ITEM_WRONG_STAGE { stage }; removed / voided; zone-served; scope is checked last (C8)', async () => {
    open();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEAT1' });
    const o1 = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      lines: [
        { order_item_id: 'A1', item_id: FX.ready },
        { order_item_id: 'C1', item_id: FX.ready },
        { order_item_id: 'F1', item_id: FX.ready },
        { order_item_id: 'X1', item_id: FX.ready },
        { order_item_id: 'V1', item_id: FX.ready },
        { order_item_id: 'Z1', item_id: FX.zoneItem, from_zone: true },
      ],
    }).order_id;
    fire('C1');
    start(o1, 'C1');
    fire('F1');
    start(o1, 'F1');
    done(o1, 'F1');
    remove(o1, 'X1');
    fire('V1');
    start(o1, 'V1');
    voidAll(o1, 'V1');
    expect(lineOf(o1, 'Z1').served_source).toBe('zone');
    // S_FAR is outside the order's scope: every stage error still wins (scope last).
    const far = signIn('S_FAR');
    const before = eventCount();
    const cases: Array<[string, string]> = [
      ['A1', 'added'],
      ['C1', 'cooking'],
      ['F1', 'done'],
      ['X1', 'removed'],
      ['V1', 'voided'],
      ['Z1', 'zone_served'],
    ];
    for (const [id, stage] of cases) {
      const reply = await ret(far, { order_item_id: id, return_order_item_id: `R_${id}`, mode: 'fix' });
      expect(reply.status, id).toBe(409);
      expect(reply.error, id).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: id, stage } });
    }
    expect(eventCount()).toBe(before);
  });

  it('[02b §6.7] return_order_item_id already in order_lines or held by the engine → 409 ORDER_ITEM_ID_IN_USE; an unknown line → 404 ORDER_NOT_FOUND', async () => {
    open();
    const o1 = servedNaan([{ order_item_id: 'N2', item_id: FX.naan }]);
    const taker = signIn('S_TAKER');
    const before = eventCount();
    for (const id of ['N2', 'N1']) {
      const reply = await ret(taker, { order_item_id: 'N1', return_order_item_id: id, mode: 'fix' });
      expect(reply.status).toBe(409);
      expect(reply.error).toEqual({ code: 'ORDER_ITEM_ID_IN_USE', details: { order_item_id: id } });
    }
    const unknown = await ret(taker, { order_item_id: 'X9', return_order_item_id: 'R1', mode: 'fix' });
    expect(unknown.status).toBe(404);
    expect(unknown.error).toEqual({ code: 'ORDER_NOT_FOUND', details: { order_item_id: 'X9' } });
    expect(eventCount()).toBe(before);
    expect(lineOf(o1, 'N1').served_at).not.toBeNull();
  });

  it('[02b §3.3] non-food return (water) with no live unserved food line → OrderFoodCleared { food_served } right after the batch; with a karahi cooking → none; a food return → none', async () => {
    open();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    const o1 = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      lines: [
        { order_item_id: 'W1', item_id: FX.ready },
        { order_item_id: 'N1', item_id: FX.naan },
      ],
    }).order_id;
    cookAndServe(o1, 'W1', 'N1');
    const taker = signIn('S_TAKER');

    const water = await ret(taker, { order_item_id: 'W1', return_order_item_id: 'R1', mode: 'remake' });
    expect(water.events.map((e) => e.event_type)).toEqual(['OrderLinesAdded', 'ItemAdded', 'ItemReturned', 'OrderFoodCleared']);
    expect(water.events[3]).toMatchObject({ stream_id: o1, actor_id: 'S_TAKER', payload: { order_id: o1, food_served: true } });
    expect(lineOf(o1, 'R1').is_food).toBe(false);

    const food = await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R2', mode: 'fix' });
    expect(food.events.map((e) => e.event_type)).toEqual(['OrderLinesAdded', 'ItemAdded']);

    const o2 = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      lines: [
        { order_item_id: 'W2', item_id: FX.ready },
        { order_item_id: 'K2', item_id: FX.naan },
      ],
    }).order_id;
    cookAndServe(o2, 'W2');
    fire('K2');
    start(o2, 'K2');
    const cooking = await ret(taker, { order_item_id: 'W2', return_order_item_id: 'R3', mode: 'fix' });
    expect(cooking.events.map((e) => e.event_type)).toEqual(['OrderLinesAdded', 'ItemAdded']);
  });

  it('[02b §6 D32] same command_id → same response, no new event', async () => {
    open();
    servedNaan();
    const taker = signIn('S_TAKER');
    const first = await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'fix' }, { commandId: 'cmd-same' });
    expect(first.status).toBe(200);
    const before = eventCount();
    const again = await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'fix' }, { commandId: 'cmd-same' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(before);
  });

  it('[02b §6.7] payload: order_item_id, return_order_item_id and mode fix | remake required → else 400; not queueable (§3.12); permission mark-item-returned', async () => {
    open();
    servedNaan();
    const taker = signIn('S_TAKER');
    for (const p of [
      { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'redo' },
      { order_item_id: 'N1', mode: 'fix' },
      { return_order_item_id: 'R1', mode: 'fix' },
      { order_item_id: 'N1', return_order_item_id: '', mode: 'fix' },
    ]) {
      const reply = await send(taker, p);
      expect(reply.status).toBe(400);
      expect(reply.error?.code).toBe('VALIDATION_FAILED');
    }
    expect(returnToKitchenCommand.queueable ?? false).toBe(false);
    expect(returnToKitchenCommand.permission).toBe('mark-item-returned');
    const waiter = await ret(signIn('S_WAITER'), { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'fix' });
    expect(waiter.status).toBe(403);
    expect(waiter.error).toEqual({ code: 'PERMISSION_DENIED', details: { permission: 'mark-item-returned', grant: 'not_granted' } });
  });

  it('[02b §6.7] statements: 2 (line, return_order_item_id id check + the line copy) at branch; 3 with the holder (own_tables dine-in) or currentTableOf (my_floors dine-in)', async () => {
    open();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_OWN1' });
    const o1 = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      lines: [
        { order_item_id: 'N1', item_id: FX.naan },
        { order_item_id: 'N2', item_id: FX.naan },
        { order_item_id: 'N3', item_id: FX.naan },
      ],
    }).order_id;
    cookAndServe(o1, 'N1', 'N2', 'N3');
    const t1 = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_OWN1', lines: [{ order_item_id: 'T1', item_id: FX.naan }] }).order_id;
    cookAndServe(t1, 'T1');

    expect((await ret(signIn('S_TAKER'), { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'fix' }, { counted: true })).status).toBe(200);
    expect(lastStatements).toBe(2);
    expect((await ret(signIn('S_OWN1'), { order_item_id: 'N2', return_order_item_id: 'R2', mode: 'remake' }, { counted: true })).status).toBe(200);
    expect(lastStatements).toBe(3);
    expect((await ret(signIn('S_FLOOR'), { order_item_id: 'N3', return_order_item_id: 'R3', mode: 'fix' }, { counted: true })).status).toBe(200);
    expect(lastStatements).toBe(3);
    // takeaway own_tables: placed_by from the engine's order, no holder read
    expect((await ret(signIn('S_OWN1'), { order_item_id: 'T1', return_order_item_id: 'R4', mode: 'fix' }, { counted: true })).status).toBe(200);
    expect(lastStatements).toBe(2);
  });
});

describe('ReturnToKitchen owner rulings S-2 (02b §6.7, §3.8; owner 2026-11-11)', () => {
  it('[02b §6.7, owner S-2a AD-31] a return to a paused station with no alternate → 409 STATION_PAUSED { station_id }, nothing appended', async () => {
    open();
    servedNaan();
    expect(engine().lines.N1!.alternates).toEqual([]);
    append(draft('station', FX.station, 'StationPauseSet', { station_id: FX.station, paused: true }));
    expect(engine().stations[FX.station]!.paused).toBe(true);
    const taker = signIn('S_TAKER');
    const before = eventCount();
    const reply = await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'fix' });
    expect(reply.status).toBe(409);
    expect(reply.error).toEqual({ code: 'STATION_PAUSED', details: { station_id: FX.station } });
    expect(eventCount()).toBe(before);
  });

  it('[02b §6.7, owner S-2b AD-32] fix when the item has left the config since submit → 404 MENU_ITEM_NOT_FOUND { item_id }, nothing appended; remake still accepted', async () => {
    open();
    const o1 = servedNaan([{ order_item_id: 'N2', item_id: FX.naan }]);
    cookAndServe(o1, 'N2');
    const old = branchConfig()!;
    const next = { ...old, config_version: old.config_version + 1, items: old.items.filter((i) => i.item_id !== FX.naan) };
    hub.deps.writer.run((tx) => runBranchConfigHooks(old, next, tx));
    swapBranchConfig({ config: next, snapshotHash: 'e'.repeat(64), configVersion: next.config_version, snapshotSchemaVersion: 4, appliedAt: hub.clock.branchNow() });
    const taker = signIn('S_TAKER');
    const before = eventCount();
    const fix = await ret(taker, { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'fix' });
    expect(fix.status).toBe(404);
    expect(fix.error).toEqual({ code: 'MENU_ITEM_NOT_FOUND', details: { item_id: FX.naan } });
    expect(eventCount()).toBe(before);
    expect((await ret(taker, { order_item_id: 'N2', return_order_item_id: 'R2', mode: 'remake' })).status).toBe(200);
  });

  it('[02b §3.8, owner S-2e AD-35] a deal header of an order in the engine → ITEM_WRONG_STAGE { stage: not_engine_line }, nothing appended', async () => {
    open();
    const o1 = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'D1', deal_id: FX.deal },
        { order_item_id: 'DP1', deal_part_id: FX.dealParts[0], parent_order_item_id: 'D1' },
        { order_item_id: 'DP2', deal_part_id: FX.dealParts[1], parent_order_item_id: 'D1' },
      ],
    }).order_id;
    cookAndServe(o1, 'DP1');
    expect(engine().lines.D1).toBeUndefined();
    const taker = signIn('S_TAKER');
    const before = eventCount();
    const reply = await ret(taker, { order_item_id: 'D1', return_order_item_id: 'R1', mode: 'fix' });
    expect(reply.status).toBe(409);
    expect(reply.error).toEqual({ code: 'ITEM_WRONG_STAGE', details: { order_item_id: 'D1', stage: 'not_engine_line' } });
    expect(eventCount()).toBe(before);
  });
});

// ------------------------------------------------------------------------------------------- E-4 header

describe('ReturnToKitchen order_header (02b #40, E-4)', () => {
  it('[02b #40] fix and remake: order_header = the EngineOrder fields (table_id as the engine holds it after a 02a move), placed_by = EngineOrder.placed_by for another staff member; statements unchanged', async () => {
    open();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    const o1 = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      placed_by: 'S_TAKER2',
      follow_up: true,
      lines: [
        { order_item_id: 'N1', item_id: FX.naan },
        { order_item_id: 'N2', item_id: FX.naan },
      ],
    }).order_id;
    cookAndServe(o1, 'N1', 'N2');
    // 02a moves the seating to T1; the engine keeps the order's table_id (it folds no TableMoved).
    append(draft('table', FX.table, 'TableMoved', { seating_id: 'SEAT1', from_table_id: FX.table, to_table_id: FX.zoneTable, by_staff_id: 'S_WAIT' }));
    const held = engine().orders[o1]!;
    expect(held.table_id).toBe(FX.table);
    const header = {
      order_type: held.order_type,
      table_key: held.table_key,
      table_id: held.table_id,
      follow_up: held.follow_up,
      pickup_at_ms: held.pickup_at_ms,
      placed_by: held.placed_by,
    };
    expect(header).toEqual({ order_type: 'dine_in', table_key: 'dine_in:SEAT1', table_id: FX.table, follow_up: true, pickup_at_ms: null, placed_by: 'S_TAKER2' });

    const fix = await ret(signIn('S_TAKER'), { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'fix' }, { counted: true });
    expect(fix.status).toBe(200);
    expect(fix.events[0]!.actor_id).toBe('S_TAKER');
    expect(fix.events[0]!.payload.order_header).toEqual(header);
    expect(lastStatements).toBe(2);

    const remake = await ret(signIn('S_TAKER'), { order_item_id: 'N2', return_order_item_id: 'R2', mode: 'remake' }, { counted: true });
    expect(remake.status).toBe(200);
    expect(remake.events[0]!.payload.order_header).toEqual(header);
    expect(lastStatements).toBe(2);
  });

  it('[02b #40] takeaway: order_header from the EngineOrder (table_id null, takeaway key)', async () => {
    open();
    const o1 = servedNaan([], 'S_TAKER2');
    const reply = await ret(signIn('S_TAKER'), { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'fix' });
    expect(reply.events[0]!.payload.order_header).toEqual({
      order_type: 'takeaway',
      table_key: `takeaway:${o1}`,
      table_id: null,
      follow_up: false,
      pickup_at_ms: null,
      placed_by: 'S_TAKER2',
    });
  });
});

// ------------------------------------------------------------------------------------------- §3.14 scope

describe('ReturnToKitchen scope (02b §3.14 "as MarkServed", C8)', () => {
  it('[02b §3.14] takeaway: own_tables / my_floors = placed by the person; dine-in: own_tables = the holder, my_floors = the current table\'s floor; branch any', async () => {
    open();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_OWN1' });
    const take = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_OWN1', lines: [{ order_item_id: 'T1', item_id: FX.naan }] }).order_id;
    const dine = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      placed_by: 'S_OWN2',
      lines: [
        { order_item_id: 'D1', item_id: FX.naan },
        { order_item_id: 'D2', item_id: FX.naan },
      ],
    }).order_id;
    cookAndServe(take, 'T1');
    cookAndServe(dine, 'D1', 'D2');
    const own2 = signIn('S_OWN2');
    const farAway = signIn('S_FAR');
    const before = eventCount();

    const other = await ret(own2, { order_item_id: 'T1', return_order_item_id: 'R1', mode: 'fix' });
    expect(other.status).toBe(403);
    expect(other.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', order_ids: [take] } });
    const placer = await ret(own2, { order_item_id: 'D1', return_order_item_id: 'R1', mode: 'fix' });
    expect(placer.status).toBe(403);
    expect(placer.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', order_ids: [dine] } });
    const far = await ret(farAway, { order_item_id: 'D1', return_order_item_id: 'R1', mode: 'fix' });
    expect(far.status).toBe(403);
    expect(eventCount()).toBe(before);

    expect((await ret(signIn('S_OWN1'), { order_item_id: 'T1', return_order_item_id: 'R1', mode: 'fix' })).status).toBe(200);
    expect((await ret(signIn('S_OWN1'), { order_item_id: 'D1', return_order_item_id: 'R2', mode: 'fix' })).status).toBe(200);
    expect((await ret(signIn('S_FLOOR'), { order_item_id: 'D2', return_order_item_id: 'R3', mode: 'fix' })).status).toBe(200);
    const anyone = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_MGR', lines: [{ order_item_id: 'M1', item_id: FX.naan }] }).order_id;
    cookAndServe(anyone, 'M1');
    expect((await ret(signIn('S_TAKER'), { order_item_id: 'M1', return_order_item_id: 'R4', mode: 'fix' })).status).toBe(200);
  });
});
