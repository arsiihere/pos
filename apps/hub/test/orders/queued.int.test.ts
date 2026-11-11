import type { DirectoryInput } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { activity, idlePause } from '../../src/auth/session-store';
import { sweepOnce } from '../../src/auth/session-sweeper';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { markServedCommand } from '../../src/orders/commands/mark-served';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { appendOrder, FX, openDay, openSeating, setZoneStock } from './fixtures';

// 02b v1.0.3 §3.12 (hub part), §3.2 step 2 and step 5, §3.7, O11, AD-1, AD-2: 02b's own use of a queued replay
// (`X-Queued-At` on a queueable command, `ctx.queuedAt`). The 00 clauses of #31 (paused idle clock, cap, clamp, CORS,
// ended sessions) are 02p's tests (AD-2); here only `sent_after_reconnect`, `ItemServed.served_at`, no lock taken or
// moved, the header ignored on a non-queueable 02b command, and #13's replay with an emptied zone.

const MIN = 60_000;
const TTL = 5 * MIN; // the tablet role of #13: a 5 min idle TTL
const SWEEP = 15_000;

let hub: TestHub;
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  activity.drain();
  activity.drainDevices();
  swapBranchConfig(null);
  await hub.close();
});

function grant(permission: string) {
  return { permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'branch' as const };
}

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, role_id: string) => ({
    staff_id,
    display_name: staff_id,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids: [],
  });
  const role = (role_id: string, permissions: ReturnType<typeof grant>[], session_idle_ttl_ms = 36_000_000) => ({
    role_id,
    name: role_id,
    session_idle_ttl_ms,
    permissions,
  });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_TAKER', [grant('take-order'), grant('mark-served')]),
      role('R_ANYWHERE', [grant('take-order'), grant('take-order-anywhere')]),
      role('R_TABLET', [grant('take-order')], TTL),
      role('R_ZONE', [grant('manage-zone-stock')]),
    ],
    staff: [...base.staff, person('S_ALI', 'R_TAKER'), person('S_BILAL', 'R_ANYWHERE'), person('S_TAB', 'R_TABLET'), person('S_NOOR', 'R_ZONE')],
  };
}

async function setUp(o: { stock?: Record<string, number>; zone?: number } = {}): Promise<void> {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  openDay(hub, { stock: o.stock });
  if (o.zone !== undefined) setZoneStock(hub, FX.zone, FX.zoneItem, o.zone);
}

interface Device {
  deviceId: string;
  token: string;
}

interface Who extends Device {
  staffId: string;
  sessionToken: string;
  sessionId: string;
}

function signIn(staffId: string, device: Device = pairDevice(hub, { type: 'tablet' })): Who {
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionToken: session.token, sessionId: session.sessionId };
}

interface Logged {
  event_type: string;
  stream_id: string;
  device_id: string;
  payload: Record<string, unknown>;
}

interface Reply {
  status: number;
  result?: Record<string, unknown>;
  events: Logged[];
  error?: { code: string; details: Record<string, unknown> };
}

let commandSeq = 0;

async function post(who: Who, command_type: string, path: string, payload: object, o: { queuedAt?: number } = {}): Promise<Reply> {
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: {
      authorization: `Bearer ${who.token}`,
      'x-session-token': who.sessionToken,
      ...(o.queuedAt === undefined ? {} : { 'x-queued-at': String(o.queuedAt) }),
    },
    payload: {
      command_id: `cmd-${(commandSeq += 1)}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as { data?: { event_ids: string[]; result: Record<string, unknown> }; error?: Reply['error'] };
  const events =
    body.data === undefined
      ? []
      : (
          hub.deps.db
            .prepare('SELECT event_type, stream_id, device_id, payload FROM events WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq')
            .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Logged, 'payload'> & { payload: string }>
        ).map((r) => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> }));
  return { status: res.statusCode, result: body.data?.result, events, error: body.error };
}

const item = (order_item_id: string, item_id: string, quantity = 1, o: Record<string, unknown> = {}) => ({ order_item_id, item_id, quantity, ...o });
const dineIn = (order_id: string, lines: unknown[], table_id: string = FX.table, seating_id = 'SEAT1') => ({ order_id, order_type: 'dine_in', table_id, seating_id, lines });
const submit = (who: Who, payload: object, o: { queuedAt?: number } = {}) => post(who, 'SubmitOrder', 'submit-order', payload, o);
const serve = (who: Who, order_id: string, order_item_ids: string[], o: { queuedAt?: number; counted?: boolean } = {}) =>
  o.counted === true
    ? post(who, 'TestMarkServedCounted', 'test-mark-served-counted', { lines: [{ order_id, order_item_ids }] }, o)
    : post(who, 'MarkServed', 'mark-served', { lines: [{ order_id, order_item_ids }] }, o);

const types = (r: Reply): string[] => r.events.map((e) => e.event_type);
const lockRows = (): unknown[] => hub.deps.db.prepare('SELECT table_id, seating_id, staff_id, device_id FROM table_locks ORDER BY table_id').all();
const sentAfterReconnect = (order_id: string): number =>
  (hub.deps.db.prepare('SELECT sent_after_reconnect FROM orders WHERE order_id = ?').get(order_id) as { sent_after_reconnect: number }).sent_after_reconnect;
const servedAt = (order_item_id: string): number | null =>
  (hub.deps.db.prepare('SELECT served_at FROM order_lines WHERE order_item_id = ?').get(order_item_id) as { served_at: number | null }).served_at;
const sessionStartedAt = (who: Who): number =>
  (hub.deps.db.prepare('SELECT started_at FROM staff_sessions WHERE session_id = ?').get(who.sessionId) as { started_at: number }).started_at;
const endReason = (who: Who): string | null =>
  (hub.deps.db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').get(who.sessionId) as { end_reason: string | null }).end_reason;

/** The lock as 02a's TableLocked writes it, from `device_id` (a lock held on another device). */
function lockOn(table_id: string, seating_id: string, staff_id: string, device_id: string): void {
  const at = hub.clock.branchNow();
  hub.deps.writer.run((tx) =>
    tx.append([
      { stream_type: 'table', stream_id: table_id, event_type: 'TableLocked', schema_version: 1, payload: { table_id, seating_id, staff_id }, occurred_at: at, actor_id: staff_id, device_id },
    ]),
  );
}
function fire(station_id: string, ...order_item_ids: string[]): void {
  hub.clock.advance(1_000);
  const at = hub.clock.branchNow();
  const payload = { station_id, order_item_ids, load_id: null, due_at: at, reason: 'pulled' };
  hub.deps.writer.run((tx) =>
    tx.append([{ stream_type: 'station', stream_id: station_id, event_type: 'FireDispatched', schema_version: 1, payload, occurred_at: at, actor_id: 'S_ALI', device_id: 'D_SEED' }]),
  );
}

// ------------------------------------------------------------------------------------------- sockets (00 M95 flow)

async function sessionSocket(who: Who): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  cleanups.push(() => ws.close());
  ws.send({ type: 'auth', device_token: who.token, session_token: who.sessionToken });
  await ws.untilCount(1);
  return ws;
}

async function drop(ws: WsClient, who: Who): Promise<void> {
  ws.close();
  for (let waited = 0; waited < 1_000 && idlePause.state(hub.deps.db, who.deviceId)?.open_sockets !== 0; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(idlePause.state(hub.deps.db, who.deviceId)?.open_sockets).toBe(0);
}

function sweepFor(ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += SWEEP) {
    hub.clock.advance(Math.min(SWEEP, ms - elapsed));
    sweepOnce(hub.deps);
  }
}

// ------------------------------------------------------------------------------------------- #31 (02b's clauses)

describe('[02b #31 02b] queued replays: 02b’s use of X-Queued-At (§3.12, AD-1, AD-2)', () => {
  it('[02b #31 02b sent_after_reconnect] a queued SubmitOrder → OrderPlaced.sent_after_reconnect true (orders row 1); the live call → false', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const queued = await submit(ali, { order_id: 'O1', order_type: 'takeaway', lines: [item('L1', FX.naan)] }, { queuedAt: hub.clock.branchNow() });
    expect(queued.status).toBe(200);
    expect(queued.events.find((e) => e.event_type === 'OrderPlaced')!.payload.sent_after_reconnect).toBe(true);
    expect(sentAfterReconnect('O1')).toBe(1);
    expect(hub.logs()).toMatch(/"order_id":"O1","command_type":"SubmitOrder","order_type":"takeaway","line_count":1,"queued":true/);

    const live = await submit(ali, { order_id: 'O2', order_type: 'takeaway', lines: [item('L2', FX.naan)] });
    expect(live.status).toBe(200);
    expect(live.events.find((e) => e.event_type === 'OrderPlaced')!.payload.sent_after_reconnect).toBe(false);
    expect(sentAfterReconnect('O2')).toBe(0);
  });

  it('[02b #31 02b free lock] a queued submit takes no free lock — holder and take-order-anywhere actor (P-1b, AD-1); the live holder call takes it', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const ali = signIn('S_ALI');
    const holder = await submit(ali, dineIn('O1', [item('L1', FX.naan)]), { queuedAt: hub.clock.branchNow() });
    expect(holder.status).toBe(200);
    expect(types(holder)).toEqual(['OrderPlaced', 'ItemAdded']);
    expect(lockRows()).toEqual([]);

    const anywhere = await submit(signIn('S_BILAL'), dineIn('O2', [item('L2', FX.naan)]), { queuedAt: hub.clock.branchNow() });
    expect(anywhere.status).toBe(200);
    expect(types(anywhere)).toEqual(['OrderPlaced', 'ItemAdded']);
    expect(lockRows()).toEqual([]);

    const live = await submit(ali, dineIn('O3', [item('L3', FX.naan)]));
    expect(types(live)).toEqual(['TableLocked', 'OrderPlaced', 'ItemAdded']);
    expect(lockRows()).toEqual([{ table_id: FX.table, seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: ali.deviceId }]);
  });

  it('[02b #31 02b moved lock] a queued submit moves no lock held on another device of the same staff (holder, and take-order-anywhere R1); the live call moves it (T15)', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const first = signIn('S_ALI');
    expect(types(await submit(first, dineIn('O1', [item('L1', FX.naan)])))).toEqual(['TableLocked', 'OrderPlaced', 'ItemAdded']);

    const second = signIn('S_ALI');
    const queued = await submit(second, dineIn('O2', [item('L2', FX.naan)]), { queuedAt: hub.clock.branchNow() });
    expect(queued.status).toBe(200);
    expect(types(queued)).toEqual(['OrderPlaced', 'ItemAdded']);
    expect(lockRows()).toEqual([{ table_id: FX.table, seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: first.deviceId }]);

    const live = await submit(second, dineIn('O3', [item('L3', FX.naan)]));
    expect(live.events[0]).toMatchObject({ event_type: 'TableLocked', payload: { staff_id: 'S_ALI', replaced_device_id: first.deviceId } });
    expect(lockRows()).toEqual([{ table_id: FX.table, seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: second.deviceId }]);

    // take-order-anywhere: Bilal's own lock on another of his devices (02a R1) is not moved by a queued replay.
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEAT2', holder_staff_id: 'S_ALI' });
    lockOn(FX.zoneTable, 'SEAT2', 'S_BILAL', 'D_BILAL_OLD');
    const bilal = signIn('S_BILAL');
    const anywhere = await submit(bilal, dineIn('O4', [item('L4', FX.naan)], FX.zoneTable, 'SEAT2'), { queuedAt: hub.clock.branchNow() });
    expect(anywhere.status).toBe(200);
    expect(types(anywhere)).toEqual(['OrderPlaced', 'ItemAdded']);
    expect(lockRows()).toContainEqual({ table_id: FX.zoneTable, seating_id: 'SEAT2', staff_id: 'S_BILAL', device_id: 'D_BILAL_OLD' });
    const anywhereLive = await submit(bilal, dineIn('O5', [item('L5', FX.naan)], FX.zoneTable, 'SEAT2'));
    expect(anywhereLive.events[0]).toMatchObject({ event_type: 'TableLocked', payload: { staff_id: 'S_BILAL', replaced_device_id: 'D_BILAL_OLD' } });
  });

  it('[02b #31 02b not queueable] of 02b’s registered commands only SubmitOrder and MarkServed are queueable (§3.12)', async () => {
    await setUp();
    const registry = commandRegistry(hub.app);
    const commands = ['SubmitOrder', 'RemoveItems', 'SetLineWeight', 'MarkServed', 'ReleaseItems', 'BoostOrder', 'ReturnToKitchen', 'CompLine', 'AddZoneStock', 'SetZoneStock'];
    const paths = ['submit-order', 'remove-items', 'set-line-weight', 'mark-served', 'release-items', 'boost-order', 'return-to-kitchen', 'comp-line', 'add-zone-stock', 'set-zone-stock'];
    const defs = paths.map((p) => registry.byPath(p));
    expect(defs.map((d) => d?.commandType)).toEqual(commands);
    expect(defs.filter((d) => d!.queueable === true).map((d) => d!.commandType)).toEqual(['SubmitOrder', 'MarkServed']);
  });

  it('[02b #31 02b not queueable] X-Queued-At is ignored on RemoveItems: the holder on a free lock still takes it (TableLocked), as a live call', async () => {
    await setUp();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_ALI' });
    const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'L1', item_id: FX.naan, quantity: 2 }] });
    expect(lockRows()).toEqual([]);
    const ali = signIn('S_ALI');
    const r = await post(ali, 'RemoveItems', 'remove-items', { order_id, seating_id: 'SEAT1', lines: [{ order_item_id: 'L1', units: 1 }] }, { queuedAt: hub.clock.branchNow() });
    expect(r.status).toBe(200);
    expect(types(r)).toEqual(['TableLocked', 'ItemRemoved']);
    expect(lockRows()).toEqual([{ table_id: FX.table, seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: ali.deviceId }]);
  });
});

// ------------------------------------------------------------------------------------------- #13 queued

describe('[02b #13 queued] a queued replay after the zone emptied (§3.2 step 5, M-4)', () => {
  it('[02b #13 queued] the tablet drops past its idle TTL, another device empties the zone, the tablet reconnects and replays → 200, a kitchen line sent to its station, sent_after_reconnect', async () => {
    await setUp({ zone: 3 });
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SEAT1', holder_staff_id: 'S_TAB' });
    const tablet = signIn('S_TAB');
    const ws = await sessionSocket(tablet);
    hub.clock.advance(MIN);
    await drop(ws, tablet);
    hub.clock.advance(MIN);
    const queuedAt = hub.clock.branchNow(); // the cola is tapped while the Wi-Fi is down: queued on the tablet

    sweepFor(2 * MIN);
    const noor = signIn('S_NOOR');
    const counted = await post(noor, 'SetZoneStock', 'set-zone-stock', { zone_id: FX.zone, item_id: FX.zoneItem, on_hand: 0 });
    expect(counted.status).toBe(200);
    sweepFor(10 * MIN); // well past the 5 min TTL since the tap
    expect(endReason(tablet)).toBeNull();

    await sessionSocket(tablet);
    const r = await submit(tablet, dineIn('O1', [item('L1', FX.zoneItem, 1, { from_zone: true })], FX.zoneTable), { queuedAt });
    expect(r.status).toBe(200);
    expect(r.result!.lines).toEqual([{ order_item_id: 'L1', eta_ms: expect.any(Number), from_stock: false, zone_served: false }]);
    expect(types(r)).toEqual(['OrderPlaced', 'ItemAdded']);
    expect(r.events[0]!.payload).toMatchObject({ order_item_ids: ['L1'], sent_after_reconnect: true });
    expect(r.events[1]!.payload).toMatchObject({ order_item_id: 'L1', station_id: FX.station, served_from_zone_id: null });
  });
});

// ------------------------------------------------------------------------------------------- #22 queued

describe('[02b #22 queued] a queued MarkServed keeps served_at = queued_at (§3.7, §3.12, Q-6)', () => {
  let counter: ReturnType<typeof statementCounter>;
  let lastStatements = -1;

  async function setUpServe(): Promise<void> {
    await setUp({ stock: { [FX.stock]: 10_000 } });
    // The real MarkServed handler under a test-only name, so its own statements are counted (as mark-served.int.test.ts).
    commandRegistry(hub.app).register(
      defineCommand({
        ...markServedCommand,
        commandType: 'TestMarkServedCounted',
        handle(ctx, payload, cmd) {
          const before = counter.count;
          try {
            return markServedCommand.handle(ctx, payload, cmd);
          } finally {
            lastStatements = counter.count - before;
          }
        },
      }),
    );
    counter = statementCounter(hub.deps.db);
    lastStatements = -1;
  }

  it('[02b #22 queued] ItemServed.served_at = the accepted queued_at; order_lines.served_at the same; OrderFoodServed and stockEffects still follow; 2 statements', async () => {
    await setUpServe();
    const ali = signIn('S_ALI');
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_ALI', lines: [{ order_item_id: 'K1', item_id: FX.piece }] });
    fire(FX.station, 'K1');
    const queuedAt = hub.clock.branchNow();
    hub.clock.advance(3 * MIN);

    const r = await serve(ali, order_id, ['K1'], { queuedAt, counted: true });
    expect(r.status).toBe(200);
    expect(types(r)).toEqual(['ItemServed', 'OrderFoodServed', 'StockConsumed']);
    expect(r.events[0]!.payload).toEqual({ order_item_ids: ['K1'], source: 'tap', served_at: queuedAt });
    expect(servedAt('K1')).toBe(queuedAt);
    expect(lastStatements).toBe(2);
  });

  it('[02b #22 queued] served_at is the clamped queued_at: below started_at − 2 min → started_at − 120 000; ahead of now → now', async () => {
    await setUpServe();
    const ali = signIn('S_ALI');
    const startedAt = sessionStartedAt(ali);
    const o1 = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_ALI', lines: [{ order_item_id: 'N1', item_id: FX.naan }] }).order_id;
    const o2 = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_ALI', lines: [{ order_item_id: 'N2', item_id: FX.naan }] }).order_id;
    fire(FX.station, 'N1', 'N2');
    hub.clock.advance(5 * MIN);

    const early = await serve(ali, o1, ['N1'], { queuedAt: startedAt - 10 * MIN });
    expect(early.status).toBe(200);
    expect(early.events[0]!.payload.served_at).toBe(startedAt - 120_000);
    expect(servedAt('N1')).toBe(startedAt - 120_000);

    const now = hub.clock.branchNow();
    const ahead = await serve(ali, o2, ['N2'], { queuedAt: now + 10 * MIN });
    expect(ahead.events[0]!.payload.served_at).toBe(now);
    expect(servedAt('N2')).toBe(now);
  });

  it('[02b #22 queued] a live MarkServed has no served_at key; order_lines.served_at = recorded_at; same 2 statements', async () => {
    await setUpServe();
    const ali = signIn('S_ALI');
    const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: 'S_ALI', lines: [{ order_item_id: 'N1', item_id: FX.naan }] });
    fire(FX.station, 'N1');
    hub.clock.advance(MIN);
    const now = hub.clock.branchNow();
    const r = await serve(ali, order_id, ['N1'], { counted: true });
    expect(r.status).toBe(200);
    expect(types(r)).toEqual(['ItemServed', 'OrderFoodServed']);
    expect(r.events[0]!.payload).toEqual({ order_item_ids: ['N1'], source: 'tap' });
    expect('served_at' in r.events[0]!.payload).toBe(false);
    expect(servedAt('N1')).toBe(now);
    expect(lastStatements).toBe(2);
  });
});
