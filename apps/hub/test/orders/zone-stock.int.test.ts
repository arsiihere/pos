import type { EngineState } from '@pos/engine';
import type { BranchConfig, DirectoryInput } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { defineCommand, type CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { addZoneStockCommand, setZoneStockCommand } from '../../src/orders/commands/zone-stock';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FX, fixtureMenu, openDay, setZoneStock } from './fixtures';

// 02b §6.9 AddZoneStock / §6.10 SetZoneStock, §3.10 (Refill, Count, Alerts), §6.19 (stream table, 'zone:' + zone_id),
// §12.2 rows 9–10, §10 #14 and #33, §11 step 15. State is seeded with real events (fixtures.ts); the commands are posted.

const BOTTLE = 'K_BOTTLE';
const Z2 = 'Z2';
const ZONE_STREAM = `zone:${FX.zone}`;

/** fixtureMenu plus: a piece stock item K_BOTTLE; I_COLA draws 1 K_BOTTLE and 50 g of K1 per piece; zone Z2 stocks I_COLA. */
function drawMenu(): BranchConfig {
  const menu = fixtureMenu();
  const floor = menu.floors[0]!;
  const z1 = floor.zones[0]!;
  return {
    ...menu,
    stock_items: [
      ...menu.stock_items,
      { stock_item_id: BOTTLE, name: 'Cola bottle', stock_unit: 'piece', carries_over: false, station_id: FX.station, low_stock_threshold: null },
    ],
    items: menu.items.map((i) =>
      i.item_id === FX.zoneItem
        ? {
            ...i,
            stock_draws: [
              { stock_item_id: BOTTLE, quantity_per_sale_unit: 1 },
              { stock_item_id: FX.stock, quantity_per_sale_unit: 50 },
            ],
          }
        : i,
    ),
    floors: [{ ...floor, zones: [z1, { ...z1, zone_id: Z2, name: 'Back', sort_order: 1, routes: [], stock_items: [{ item_id: FX.zoneItem, threshold: 0 }] }] }],
  };
}

function grant(permission: string, scope: 'branch' | 'my_zones') {
  return { permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope };
}

// S_REFILL refills Z1 (my_zones); S_BACK refills Z2 only (my_zones); S_FLOOR refills everywhere (branch);
// S_WAIT (aDirectory's order taker) has no manage-zone-stock.
async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, role_id: string, zones: string[]) => ({
    staff_id,
    display_name: staff_id,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids: [],
    assigned_zone_ids: zones,
  });
  const role = (role_id: string, scope: 'branch' | 'my_zones') => ({
    role_id,
    name: role_id,
    session_idle_ttl_ms: 3_600_000,
    permissions: [grant('manage-zone-stock', scope)],
  });
  return {
    ...base,
    roles: [...base.roles, role('R_ZONES', 'my_zones'), role('R_ZBRANCH', 'branch')],
    staff: [...base.staff, person('S_REFILL', 'R_ZONES', [FX.zone]), person('S_BACK', 'R_ZONES', [Z2]), person('S_FLOOR', 'R_ZBRANCH', [])],
  };
}

function counted<P extends z.ZodType>(def: CommandDef<P>): CommandDef {
  return defineCommand({
    ...def,
    commandType: `TestCounted${def.commandType}`,
    handle(ctx, payload, cmd) {
      const before = counter.count;
      try {
        return def.handle(ctx, payload, cmd);
      } finally {
        lastStatements = counter.count - before;
      }
    },
  });
}

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;
const clients: WsClient[] = [];

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  const registry = commandRegistry(hub.app);
  // The real handlers under test-only names, so their own statements are counted (02a call-waiter pattern). The
  // count excludes the append and 01d's raise / close statements (§6 common rules): the tests measure where none run.
  registry.register(counted(addZoneStockCommand));
  registry.register(counted(setZoneStockCommand));
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await hub.close();
});

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
  schema_version: number;
  payload: Record<string, unknown>;
}

interface Reply {
  status: number;
  body: unknown;
  result: Record<string, unknown> | undefined;
  events: Stored[];
  error?: { code: string; details: Record<string, unknown> };
}

type Command = 'AddZoneStock' | 'SetZoneStock' | 'TestCountedAddZoneStock' | 'TestCountedSetZoneStock';
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
let commandSeq = 0;

async function call(who: Who, type: Command, payload: Record<string, unknown>, o: { commandId?: string } = {}): Promise<Reply> {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${kebab(type)}`,
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
              `SELECT event_type, stream_type, stream_id, schema_version, payload AS payload_json FROM events
                WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`,
            )
            .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Stored, 'payload'> & { payload_json: string }>
        ).map(({ payload_json, ...rest }) => ({ ...rest, payload: JSON.parse(payload_json) as Record<string, unknown> }));
  const error = body.error === undefined ? undefined : { code: body.error.code, details: body.error.details };
  return { status: res.statusCode, body, result: body.data?.result, events, error };
}

const refill = (who: Who, quantity: number, o: { zone_id?: string; item_id?: string; type?: Command; commandId?: string } = {}) =>
  call(who, o.type ?? 'AddZoneStock', { zone_id: o.zone_id ?? FX.zone, item_id: o.item_id ?? FX.zoneItem, quantity }, o);
const count = (who: Who, on_hand: number, o: { zone_id?: string; item_id?: string; type?: Command; commandId?: string } = {}) =>
  call(who, o.type ?? 'SetZoneStock', { zone_id: o.zone_id ?? FX.zone, item_id: o.item_id ?? FX.zoneItem, on_hand }, o);

function eventCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}
function zoneCount(zone_id: string = FX.zone, item_id: string = FX.zoneItem): number | undefined {
  return (hub.deps.db.prepare('SELECT on_hand FROM zone_stock WHERE zone_id = ? AND item_id = ?').get(zone_id, item_id) as { on_hand: number } | undefined)?.on_hand;
}
function branchOnHand(stock_item_id: string): number {
  return hub.deps.writer.run((tx) => (tx.state as EngineState).stock[stock_item_id]?.on_hand ?? 0).result;
}
function openAlerts(): Array<{ kind: string; dedupe_key: string }> {
  return hub.deps.db.prepare(`SELECT kind, dedupe_key FROM alerts WHERE state = 'open' ORDER BY kind`).all() as Array<{ kind: string; dedupe_key: string }>;
}
function closedAlerts(): Array<{ kind: string; close_reason: string | null }> {
  return hub.deps.db.prepare(`SELECT kind, close_reason FROM alerts WHERE state <> 'open' ORDER BY kind`).all() as Array<{ kind: string; close_reason: string | null }>;
}
/** 01a S33: a BusinessDayClosed through the writer (the day close command is 01a's, not this lane's). */
function closeDay(): void {
  hub.deps.writer.run((tx) =>
    tx.append([
      { stream_type: 'hub', stream_id: tx.branchId, event_type: 'BusinessDayClosed', schema_version: 1, payload: {}, occurred_at: hub.clock.branchNow(), actor_id: null, device_id: 'hub' },
    ]),
  );
}
const LOW_KEY = `zone_low:${FX.zone}:${FX.zoneItem}`;
const OUT_KEY = `zone_out:${FX.zone}:${FX.zoneItem}`;

// ------------------------------------------------------------------------------------------- refill

describe('[02b §6.9] AddZoneStock', () => {
  it('[02b #14 commands] a refill drafts one StockTransferredOut per day draw and ZoneStockAdded with the transfers; branch stock down, zone count up', async () => {
    openDay(hub, { menu: drawMenu(), stock: { [BOTTLE]: 40, [FX.stock]: 5_000 } });
    setZoneStock(hub, FX.zone, FX.zoneItem, 3);
    const r = await refill(signIn('S_MGR'), 10);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.result).toEqual({ on_hand: 13 });
    expect(r.events.map((e) => [e.event_type, e.stream_type, e.stream_id, e.schema_version])).toEqual([
      ['StockTransferredOut', 'stock', BOTTLE, 1],
      ['StockTransferredOut', 'stock', FX.stock, 1],
      ['ZoneStockAdded', 'table', ZONE_STREAM, 1],
    ]);
    expect(r.events[0]!.payload).toEqual({ stock_item_id: BOTTLE, quantity: 10, zone_id: FX.zone });
    expect(r.events[1]!.payload).toEqual({ stock_item_id: FX.stock, quantity: 500, zone_id: FX.zone });
    expect(r.events[2]!.payload).toEqual({
      zone_id: FX.zone,
      item_id: FX.zoneItem,
      quantity: 10,
      transfers: [
        { stock_item_id: BOTTLE, quantity: 10 },
        { stock_item_id: FX.stock, quantity: 500 },
      ],
    });
    expect(branchOnHand(BOTTLE)).toBe(30);
    expect(branchOnHand(FX.stock)).toBe(4_500);
    expect(zoneCount()).toBe(13);
  });

  it('[02b #14 commands] an item with no draws refills with transfers [] and no stock event; an absent zone row counts as 0', async () => {
    openDay(hub); // fixtureMenu: I_COLA has no stock_draws
    const r = await refill(signIn('S_MGR'), 4);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.result).toEqual({ on_hand: 4 });
    expect(r.events.map((e) => e.event_type)).toEqual(['ZoneStockAdded']);
    expect(r.events[0]!.payload).toEqual({ zone_id: FX.zone, item_id: FX.zoneItem, quantity: 4, transfers: [] });
    expect(zoneCount()).toBe(4);
  });

  it('[02b #14 commands] short on a draw → 409 STOCK_INSUFFICIENT { stock_item_id, available } and nothing appended', async () => {
    openDay(hub, { menu: drawMenu(), stock: { [BOTTLE]: 40, [FX.stock]: 400 } });
    setZoneStock(hub, FX.zone, FX.zoneItem, 3);
    const mgr = signIn('S_MGR');
    const before = eventCount();
    const r = await refill(mgr, 10); // K1 needs 500, has 400
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'STOCK_INSUFFICIENT', details: { stock_item_id: FX.stock, available: 400 } });
    expect(eventCount()).toBe(before);
    expect(branchOnHand(BOTTLE)).toBe(40);
    expect(zoneCount()).toBe(3);
  });

  it('[02b §6.9] needs an open day → BUSINESS_DAY_NOT_OPEN', async () => {
    openDay(hub, { menu: drawMenu(), stock: { [BOTTLE]: 40, [FX.stock]: 5_000 } });
    closeDay();
    const mgr = signIn('S_MGR');
    const before = eventCount();
    const r = await refill(mgr, 1);
    expect(r.status).toBe(409);
    expect(r.error?.code).toBe('BUSINESS_DAY_NOT_OPEN');
    expect(eventCount()).toBe(before);
  });

  it('[02b #33 refill tile] a refill sends the StockTransferredOut stock frame to a staff socket (no timing assert, AD-32)', async () => {
    openDay(hub, { menu: drawMenu(), stock: { [BOTTLE]: 40, [FX.stock]: 5_000 } });
    const cashier = signIn('S_CASH');
    const ws = await connectWs(hub.app);
    clients.push(ws);
    ws.send({ type: 'auth', device_token: cashier.token, session_token: cashier.sessionToken });
    await ws.untilCount(1);
    const r = await refill(signIn('S_MGR'), 2);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const frames = () =>
      ws.messages
        .filter((m) => (m as { type?: string }).type === 'event')
        .map((m) => (m as { event: { event_type: string; payload: { stock_item_id: string } } }).event)
        .filter((e) => e.event_type === 'StockTransferredOut')
        .map((e) => e.payload.stock_item_id);
    for (let i = 0; i < 50 && frames().length < 2; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frames().sort()).toEqual([BOTTLE, FX.stock].sort());
  });
});

// ------------------------------------------------------------------------------------------- count

describe('[02b §6.10] SetZoneStock', () => {
  it('[02b #14 commands] a count writes ZoneStockSet { on_hand, previous } and no stock event (Count leaves branch stock)', async () => {
    openDay(hub, { menu: drawMenu(), stock: { [BOTTLE]: 40, [FX.stock]: 5_000 } });
    setZoneStock(hub, FX.zone, FX.zoneItem, 7);
    const r = await count(signIn('S_MGR'), 5);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.result).toEqual({ on_hand: 5 });
    expect(r.events.map((e) => [e.event_type, e.stream_type, e.stream_id, e.schema_version])).toEqual([['ZoneStockSet', 'table', ZONE_STREAM, 1]]);
    expect(r.events[0]!.payload).toEqual({ zone_id: FX.zone, item_id: FX.zoneItem, on_hand: 5, previous: 7 });
    expect(zoneCount()).toBe(5);
    expect(branchOnHand(BOTTLE)).toBe(40);
    expect(branchOnHand(FX.stock)).toBe(5_000);
  });

  it('[02b §6.10] a count needs no open day; an absent zone row is previous 0', async () => {
    openDay(hub);
    closeDay();
    const r = await count(signIn('S_MGR'), 6);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.events[0]!.payload).toEqual({ zone_id: FX.zone, item_id: FX.zoneItem, on_hand: 6, previous: 0 });
  });
});

// ------------------------------------------------------------------------------------------- alerts

describe('[02b #14 alerts] the commands raise and close through zoneAlertDrafts (§3.10 Alerts)', () => {
  it('[02b #14 alerts] a count to ≤ threshold raises zone_stock_low; a count to 0 raises zone_stock_out while low is open', async () => {
    openDay(hub); // Z1 / I_COLA threshold 2
    setZoneStock(hub, FX.zone, FX.zoneItem, 5);
    const mgr = signIn('S_MGR');
    const low = await count(mgr, 2);
    expect(low.status, JSON.stringify(low.body)).toBe(200);
    expect(low.events.map((e) => e.event_type)).toContain('AlertRaised');
    expect(openAlerts()).toEqual([{ kind: 'zone_stock_low', dedupe_key: LOW_KEY }]);
    const out = await count(mgr, 0);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(openAlerts()).toEqual([
      { kind: 'zone_stock_low', dedupe_key: LOW_KEY },
      { kind: 'zone_stock_out', dedupe_key: OUT_KEY },
    ]);
  });

  it('[02b #14 alerts] a refill above the threshold closes low and out done', async () => {
    openDay(hub);
    setZoneStock(hub, FX.zone, FX.zoneItem, 5);
    const mgr = signIn('S_MGR');
    await count(mgr, 0);
    expect(openAlerts().map((a) => a.kind)).toEqual(['zone_stock_low', 'zone_stock_out']);
    const r = await refill(mgr, 3);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.result).toEqual({ on_hand: 3 });
    expect(openAlerts()).toEqual([]);
    expect(closedAlerts()).toEqual([
      { kind: 'zone_stock_low', close_reason: 'done' },
      { kind: 'zone_stock_out', close_reason: 'done' },
    ]);
  });
});

// ------------------------------------------------------------------------------------------- errors (§12.2 rows 9–10)

describe('[02b §6.9] errors of rows 9–10', () => {
  it('[02b §6.9] an unknown zone → 404 ZONE_NOT_FOUND for refill and count', async () => {
    openDay(hub);
    const mgr = signIn('S_MGR');
    for (const r of [await refill(mgr, 1, { zone_id: 'Z_NONE' }), await count(mgr, 1, { zone_id: 'Z_NONE' })]) {
      expect(r.status).toBe(404);
      expect(r.error).toEqual({ code: 'ZONE_NOT_FOUND', details: { zone_id: 'Z_NONE' } });
    }
  });

  it('[02b §6.9] an item that is not a stock item of the zone → 422 ZONE_ITEM_NOT_CONFIGURED { zone_id, item_id }', async () => {
    openDay(hub);
    const mgr = signIn('S_MGR');
    const before = eventCount();
    for (const r of [await refill(mgr, 1, { item_id: FX.naan }), await count(mgr, 1, { item_id: FX.naan })]) {
      expect(r.status).toBe(422);
      expect(r.error).toEqual({ code: 'ZONE_ITEM_NOT_CONFIGURED', details: { zone_id: FX.zone, item_id: FX.naan } });
    }
    expect(eventCount()).toBe(before);
  });

  it('[02b §6.9] payload bounds: refill quantity int 1–500, count on_hand int 0–5000 → 400', async () => {
    openDay(hub);
    const mgr = signIn('S_MGR');
    for (const q of [0, 501, 1.5, -1]) expect((await refill(mgr, q)).status, `quantity ${q}`).toBe(400);
    for (const n of [-1, 5_001, 2.5]) expect((await count(mgr, n)).status, `on_hand ${n}`).toBe(400);
    expect((await call(mgr, 'AddZoneStock', { zone_id: FX.zone, quantity: 1 })).status).toBe(400);
    expect((await call(mgr, 'SetZoneStock', { item_id: FX.zoneItem, on_hand: 1 })).status).toBe(400);
    expect((await refill(mgr, 500)).status).toBe(200);
    expect((await count(mgr, 5_000)).status).toBe(200);
    expect((await count(mgr, 0)).status).toBe(200);
  });

  it('[02b §6.9] check order: ZONE_ITEM_NOT_CONFIGURED before BUSINESS_DAY_NOT_OPEN; STOCK_INSUFFICIENT before scope', async () => {
    // §6.9 errors list, C8: zone → zone item → open day (refill) → each draw's stock → scope last
    openDay(hub, { menu: drawMenu(), stock: { [BOTTLE]: 0, [FX.stock]: 5_000 } });
    const back = signIn('S_BACK'); // my_zones Z2: Z1 is outside scope
    const short = await refill(back, 1);
    expect(short.status).toBe(409);
    expect(short.error).toEqual({ code: 'STOCK_INSUFFICIENT', details: { stock_item_id: BOTTLE, available: 0 } });
    closeDay();
    const mgr = signIn('S_MGR');
    expect((await refill(mgr, 1, { item_id: FX.naan })).error?.code).toBe('ZONE_ITEM_NOT_CONFIGURED');
    expect((await refill(mgr, 1)).error?.code).toBe('BUSINESS_DAY_NOT_OPEN');
  });
});

// ------------------------------------------------------------------------------------------- permission and scope

describe('[02b §3.14] manage-zone-stock and scope my_zones', () => {
  it('[02b #33 refill tile] an order taker without manage-zone-stock → 403 PERMISSION_DENIED on AddZoneStock and SetZoneStock', async () => {
    openDay(hub);
    const taker = signIn('S_WAIT');
    const before = eventCount();
    for (const r of [await refill(taker, 1), await count(taker, 1)]) {
      expect(r.status).toBe(403);
      expect(r.error?.code).toBe('PERMISSION_DENIED');
    }
    expect(eventCount()).toBe(before);
  });

  it('[02b §6.9] my_zones: inside the person\'s zones allowed; outside → 403 outside_scope (scope last); branch allowed anywhere', async () => {
    openDay(hub, { menu: drawMenu(), stock: { [BOTTLE]: 40, [FX.stock]: 5_000 } });
    const refiller = signIn('S_REFILL'); // Z1
    expect((await refill(refiller, 1)).status).toBe(200);
    expect((await count(refiller, 3)).status).toBe(200);
    const back = signIn('S_BACK'); // Z2 only
    const before = eventCount();
    for (const r of [await refill(back, 1), await count(back, 1)]) {
      expect(r.status).toBe(403);
      expect(r.error).toEqual({
        code: 'PERMISSION_DENIED',
        details: { permission: 'manage-zone-stock', reason: 'outside_scope', zone_ids: [FX.zone] },
      });
    }
    expect(eventCount()).toBe(before);
    expect((await refill(back, 1, { zone_id: Z2 })).status).toBe(200);
    const floor = signIn('S_FLOOR'); // branch
    expect((await refill(floor, 1, { zone_id: Z2 })).status).toBe(200);
    expect((await count(floor, 9)).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------- D32, statements

describe('[02b §6] common rules', () => {
  it('[02b §6.9] D32: the same command_id again → the same response, no new event', async () => {
    openDay(hub, { menu: drawMenu(), stock: { [BOTTLE]: 40, [FX.stock]: 5_000 } });
    const mgr = signIn('S_MGR');
    const first = await refill(mgr, 2, { commandId: 'cmd-retransmit' });
    expect(first.status).toBe(200);
    const after = eventCount();
    const again = await refill(mgr, 2, { commandId: 'cmd-retransmit' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(after);
    expect(zoneCount()).toBe(2);
    const set1 = await count(mgr, 8, { commandId: 'cmd-count-retransmit' });
    const set2 = await count(mgr, 8, { commandId: 'cmd-count-retransmit' });
    expect(set2.body).toEqual(set1.body);
    expect(zoneCount()).toBe(8);
  });

  it('[02b §6.9] statements: the handler runs exactly 2 (count, open zone alerts) for refill and for count; the branch stock read is ctx.state', async () => {
    openDay(hub, { menu: drawMenu(), stock: { [BOTTLE]: 40, [FX.stock]: 5_000 } });
    setZoneStock(hub, FX.zone, FX.zoneItem, 5); // threshold 2: 5 → 6 and 6 → 4 raise and close nothing
    const mgr = signIn('S_MGR');
    const r = await refill(mgr, 1, { type: 'TestCountedAddZoneStock' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['StockTransferredOut', 'StockTransferredOut', 'ZoneStockAdded']);
    expect(lastStatements).toBe(2);
    lastStatements = -1;
    const c = await count(mgr, 4, { type: 'TestCountedSetZoneStock' });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.events.map((e) => e.event_type)).toEqual(['ZoneStockSet']);
    expect(lastStatements).toBe(2);
  });
});
