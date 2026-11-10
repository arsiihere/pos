import type { BranchConfig, DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentDirectory } from '../../src/auth/guards';
import { activity } from '../../src/auth/session-store';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { audienceAllows } from '../../src/ws/audience';
import type { SocketCtx } from '../../src/ws/catch-up';
import { tableMapBody } from '../../src/tables/queries';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';

// 02a v1.1.3 §6.17 table-map, §6.18 handover-candidates, catch-up part `tables`, §6.19 audiences, 00 M59, SG-4.
// Seatings, locks and orders are seeded with real events appended through the hub writer (the `tables` projection).

const ALI = 'S_ALI'; // take-order branch; assignee of T1
const BILAL = 'S_BILAL'; // take-order branch
const SARA = 'S_SARA'; // take-order branch; assignee of zone Z1
const ZAIN = 'S_ZAIN'; // take-order my_floors F1
const FAIZ = 'S_FAIZ'; // take-order my_floors F2 (does not cover F1)
const OWEN = 'S_OWEN'; // take-order own_tables (covers no floor)
const KAMI = 'S_KAMI'; // take-order requires_approval only
const NOOR = 'S_NOOR'; // take-order branch, never signed in
const CASH = 'S_CASH'; // no take-order

type Scope = 'branch' | 'my_floors' | 'own_tables';
function grant(permission: string, grant_type: 'allowed' | 'requires_approval', scope: Scope = 'branch') {
  return {
    permission,
    grant_type,
    approver_role_id: grant_type === 'requires_approval' ? 'R_MGR' : null,
    approver_role_ids: grant_type === 'requires_approval' ? ['R_MGR'] : [],
    scope,
  };
}

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const role = (role_id: string, permissions: ReturnType<typeof grant>[]) => ({ role_id, name: role_id, session_idle_ttl_ms: 3_600_000, permissions });
  const person = (staff_id: string, display_name: string, role_id: string, o: { floors?: string[]; tables?: string[]; zones?: string[] } = {}) => ({
    staff_id,
    display_name,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids: o.floors ?? [],
    assigned_table_ids: o.tables ?? [],
    assigned_zone_ids: o.zones ?? [],
  });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_TAKER', [grant('take-order', 'allowed')]),
      role('R_FLOOR', [grant('take-order', 'allowed', 'my_floors')]),
      role('R_OWN', [grant('take-order', 'allowed', 'own_tables')]),
      role('R_APPROVAL', [grant('take-order', 'requires_approval')]),
    ],
    // only these people: the base Owner / Manager would be candidates too
    staff: [
      person(ALI, 'Ali', 'R_TAKER', { tables: ['T1'] }),
      person(BILAL, 'Bilal', 'R_TAKER'),
      person(SARA, 'Sara', 'R_TAKER', { zones: ['Z1'] }),
      person(ZAIN, 'Zain', 'R_FLOOR', { floors: ['F1'] }),
      person(FAIZ, 'Faiz', 'R_FLOOR', { floors: ['F2'] }),
      person(OWEN, 'Owen', 'R_OWN'),
      person(KAMI, 'Kami', 'R_APPROVAL'),
      person(NOOR, 'Noor', 'R_TAKER'),
      { ...base.staff.find((s) => s.staff_id === CASH)! },
    ],
  } as DirectoryInput;
}

const zone = (zone_id: string, name: string, sort_order: number) => ({ zone_id, name, sort_order, is_archived: false, routes: [], stock_items: [] });
const table = (n: number, zone_id: string | null) => ({ table_id: `T${n}`, name: `Table ${n}`, seats: 4, sort_order: n, zone_id });

/** 80 tables: F1 T1–T40 (Z1 T1–T20, Z2 T21–T30, no zone T31–T40), F2 T41–T80 (Z3 T41–T60, no zone T61–T80). */
function config(): BranchConfig {
  const range = (from: number, to: number, zone_id: string | null) => Array.from({ length: to - from + 1 }, (_, i) => table(from + i, zone_id));
  return aBranchConfig({
    floors: [
      { floor_id: 'F2', name: 'Roof', sort_order: 1, zones: [zone('Z3', 'Terrace', 0)], tables: [...range(41, 60, 'Z3'), ...range(61, 80, null)] },
      {
        floor_id: 'F1',
        name: 'Ground',
        sort_order: 0,
        zones: [zone('Z2', 'Back', 1), zone('Z1', 'Front', 0)],
        tables: [...range(1, 20, 'Z1'), ...range(21, 30, 'Z2'), ...range(31, 40, null)],
      },
    ],
  } as unknown as Partial<BranchConfig>);
}

function applyConfig(c: BranchConfig): void {
  swapBranchConfig({ config: c, snapshotHash: 'h'.repeat(64), configVersion: c.config_version, snapshotSchemaVersion: 4, appliedAt: 0 });
}

let hub: TestHub;

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  applyConfig(config());
});

afterEach(async () => {
  activity.drain();
  swapBranchConfig(null);
  await hub.close();
});

// ---------------------------------------------------------------------------------------------- seeding

interface Who {
  staffId: string;
  deviceId: string;
  token: string;
  sessionId: string;
  sessionToken: string;
}

function signIn(staffId: string, type: 'tablet' | 'phone' | 'cashier_kiosk' | 'kds' = 'tablet'): Who {
  const device = pairDevice(hub, {
    type,
    ...(type === 'kds' ? { stationId: 'S1' } : {}),
    ...(type === 'phone' ? { ownerStaffId: staffId } : {}),
  });
  return onDevice(staffId, device);
}

function onDevice(staffId: string, device: { deviceId: string; token: string }): Who {
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionId: session.sessionId, sessionToken: session.token };
}

function ev(stream_type: 'table' | 'order', stream_id: string, event_type: string, payload: Record<string, unknown>, by: Who): EventDraft {
  return {
    stream_type,
    stream_id,
    event_type,
    schema_version: 1,
    payload,
    occurred_at: hub.clock.branchNow(),
    actor_id: by.staffId,
    device_id: by.deviceId,
  } as EventDraft;
}

function append(...drafts: EventDraft[]): void {
  for (const d of drafts) {
    hub.clock.advance(1_000);
    hub.deps.writer.run((tx) => tx.append([d]));
  }
}

function open(table_id: string, seating_id: string, holder: Who, o: { party?: number | null; locked?: boolean; joined?: string[] } = {}): void {
  append(ev('table', table_id, 'TableOpened', { table_id, seating_id, holder_staff_id: holder.staffId, party_size: o.party ?? 2 }, holder));
  if (o.locked !== false) append(ev('table', table_id, 'TableLocked', { table_id, seating_id, staff_id: holder.staffId }, holder));
  if (o.joined !== undefined && o.joined.length > 0) {
    append(
      ev(
        'table',
        table_id,
        'TablesMerged',
        { into_seating_id: seating_id, into_table_id: table_id, table_ids: o.joined, absorbed_seating_id: null, order_ids: [], by_staff_id: holder.staffId },
        holder,
      ),
    );
  }
}

function placed(order_id: string, seating_id: string, by: Who): EventDraft {
  const T = hub.clock.branchNow();
  return ev(
    'order',
    order_id,
    'OrderPlaced',
    {
      order_id,
      order_type: 'dine_in',
      table_id: null,
      table_key: `dine_in:${seating_id}`,
      follow_up: false,
      pickup_at_ms: null,
      order_item_ids: [`${order_id}-L1`],
      groups: [{ group_id: `${order_id}:0`, target_land_ms: T + 600_000, promise_ms: T + 900_000, order_item_ids: [`${order_id}-L1`] }],
      lines: [],
    },
    by,
  );
}

// ---------------------------------------------------------------------------------------------- calls

interface Tile {
  table_id: string;
  name: string;
  seats: number | null;
  archived: boolean;
  state: string;
  seating_id: string | null;
  party_size: number | null;
  primary_table_id: string | null;
  joined_table_names: string[];
  holder: { staff_id: string; name: string | null } | null;
  assignee: { staff_id: string; name: string | null } | null;
  lock: { staff_id: string; name: string | null; mine: boolean } | null;
  opened_at: number | null;
  bill_requested_at: number | null;
  live_order_count: number;
}
interface MapBody {
  as_of_seq: number;
  floors: Array<{ floor_id: string; name: string | null; archived: boolean; zones: Array<{ zone_id: string | null; name: string | null; tables: Tile[] }> }>;
}

async function query(who: Who, path: string): Promise<{ status: number; body: { data?: unknown; error?: { code: string; details: unknown } } }> {
  const res = await hub.app.inject({
    method: 'GET',
    url: `/queries/${path}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
  });
  return { status: res.statusCode, body: res.json() };
}

async function tableMap(who: Who, floor_id?: string): Promise<MapBody> {
  const r = await query(who, floor_id === undefined ? 'table-map' : `table-map?floor_id=${floor_id}`);
  expect(r.status).toBe(200);
  return r.body.data as MapBody;
}

function tiles(body: MapBody): Map<string, Tile> {
  return new Map(body.floors.flatMap((f) => f.zones.flatMap((z) => z.tables.map((t) => [t.table_id, t] as const))));
}

function lastSeq(): number {
  return (hub.deps.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM events').get() as { s: number }).s;
}

// ---------------------------------------------------------------------------------------------- §6.17

describe('table-map (§6.17)', () => {
  it('[02a #36] table-map: 3 + 1 statements at 80 tables / 40 seatings (open seatings with tables; locks; live order counts; last_seq)', async () => {
    const ali = signIn(ALI);
    // 36 single-table seatings T1–T36 and 4 seatings T41–T44, each joined with T45–T48: 40 seatings, 44 tables seated
    for (let n = 1; n <= 36; n += 1) open(`T${n}`, `SEAT-${n}`, ali, { locked: n % 2 === 0 });
    for (let n = 41; n <= 44; n += 1) open(`T${n}`, `SEAT-${n}`, ali, { joined: [`T${n + 4}`] });
    for (let n = 1; n <= 20; n += 1) append(placed(`O${n}`, `SEAT-${n}`, ali));
    const counter = statementCounter(hub.deps.readDb);
    const body = await tableMap(ali);
    expect(counter.count).toBe(4);
    const all = tiles(body);
    expect(all.size).toBe(80);
    expect([...all.values()].filter((t) => t.seating_id !== null)).toHaveLength(44);
    expect(new Set([...all.values()].map((t) => t.seating_id).filter((s) => s !== null)).size).toBe(40);
    expect(all.get('T5')!.live_order_count).toBe(1);
    expect(all.get('T45')).toMatchObject({ seating_id: 'SEAT-41', primary_table_id: 'T41', joined_table_names: ['Table 41', 'Table 45'] });
    expect(body.as_of_seq).toBe(lastSeq());
  });

  it('[02a #36] table-map: `mine` per (staff, device) — the locking device only, never the same staff on another device', async () => {
    const tabletA = pairDevice(hub, { type: 'tablet' });
    const tabletB = pairDevice(hub, { type: 'tablet' });
    const aliA = onDevice(ALI, tabletA);
    open('T1', 'SEAT-1', aliA);
    const bilal = signIn(BILAL);
    const lockOf = async (who: Who) => tiles(await tableMap(who)).get('T1')!.lock;
    expect(await lockOf(aliA)).toEqual({ staff_id: ALI, name: 'Ali', mine: true });
    expect(await lockOf(bilal)).toEqual({ staff_id: ALI, name: 'Ali', mine: false });
    // the same staff signed in on another device (his first session on A is still live)
    const aliB = onDevice(ALI, tabletB);
    expect(await lockOf(aliB)).toEqual({ staff_id: ALI, name: 'Ali', mine: false });
  });

  it('[02a #36] table-map: archived seated table in an "Archived tables" group (zone_id null, name = table_id, seats null, archived true) until cleaned (SG-4)', async () => {
    const ali = signIn(ALI);
    open('T80', 'SEAT-80', ali, { locked: false });
    // T80 is archived: the next config no longer lists it (AD-2)
    const c = config();
    c.floors = c.floors.map((f) => ({ ...f, tables: f.tables.filter((t) => t.table_id !== 'T80') }));
    applyConfig(c);
    const body = await tableMap(ali);
    const archived = body.floors.at(-1)!;
    expect(body.floors.slice(0, -1).map((f) => f.archived)).toEqual([false, false]);
    expect(archived).toEqual({
      floor_id: '',
      name: null,
      archived: true,
      zones: [
        {
          zone_id: null,
          name: null,
          tables: [
            expect.objectContaining({ table_id: 'T80', name: 'T80', seats: null, archived: true, state: 'SEATED', seating_id: 'SEAT-80', primary_table_id: 'T80', joined_table_names: ['T80'] }),
          ],
        },
      ],
    });
    expect(tiles(body).size).toBe(80);
    // a FREE archived table is not shown
    expect([...tiles(body).values()].filter((t) => t.archived)).toHaveLength(1);
    // cleaned → gone
    append(ev('table', 'T80', 'TableCleaned', { seating_id: 'SEAT-80', table_ids: ['T80'], reason: 'left_without_order', by_staff_id: ALI }, ali));
    const after = await tableMap(ali);
    expect(after.floors.map((f) => f.floor_id)).toEqual(['F1', 'F2']);
    expect(tiles(after).has('T80')).toBe(false);
  });

  it('[02a §6.17] tiles: floors by sort order, zones by sort order then the no-zone group; FREE and seated tile fields; holder, assignee, bill request; floor_id filter', async () => {
    const ali = signIn(ALI);
    const bilal = signIn(BILAL);
    open('T2', 'SEAT-2', bilal, { party: 5, joined: ['T3'] });
    const openedAt = hub.clock.branchNow() - 2_000; // TableOpened was appended two events before the merge
    append(placed('O1', 'SEAT-2', bilal));
    append(ev('table', 'T2', 'BillRequested', { seating_id: 'SEAT-2', table_id: 'T2', by_staff_id: BILAL }, bilal));
    const billAt = hub.clock.branchNow();
    const body = await tableMap(ali);
    expect(body.floors.map((f) => [f.floor_id, f.name, f.zones.map((z) => z.zone_id)])).toEqual([
      ['F1', 'Ground', ['Z1', 'Z2', null]],
      ['F2', 'Roof', ['Z3', null]],
    ]);
    expect(body.floors[0]!.zones.map((z) => z.name)).toEqual(['Front', 'Back', null]);
    expect(body.floors[0]!.zones[0]!.tables.map((t) => t.table_id).slice(0, 4)).toEqual(['T1', 'T2', 'T3', 'T4']);
    const all = tiles(body);
    expect(all.get('T1')).toEqual({
      table_id: 'T1',
      name: 'Table 1',
      seats: 4,
      archived: false,
      state: 'FREE',
      seating_id: null,
      party_size: null,
      primary_table_id: null,
      joined_table_names: [],
      holder: null,
      assignee: { staff_id: ALI, name: 'Ali' }, // table assignment wins over the zone's (§3.6)
      lock: null,
      opened_at: null,
      bill_requested_at: null,
      live_order_count: 0,
    });
    const seated = {
      seats: 4,
      archived: false,
      state: 'BILL_REQUESTED',
      seating_id: 'SEAT-2',
      party_size: 5,
      primary_table_id: 'T2',
      joined_table_names: ['Table 2', 'Table 3'],
      holder: { staff_id: BILAL, name: 'Bilal' },
      assignee: { staff_id: SARA, name: 'Sara' }, // the seating's assignee = its primary table's (zone Z1)
      lock: { staff_id: BILAL, name: 'Bilal', mine: false },
      opened_at: openedAt,
      bill_requested_at: billAt,
      live_order_count: 1,
    };
    expect(all.get('T2')).toEqual({ table_id: 'T2', name: 'Table 2', ...seated });
    expect(all.get('T3')).toEqual({ table_id: 'T3', name: 'Table 3', ...seated });
    expect(all.get('T31')!.assignee).toBeNull();

    const roof = await tableMap(ali, 'F2');
    expect(roof.floors.map((f) => f.floor_id)).toEqual(['F2']);
    expect((await tableMap(ali, 'NOPE')).floors).toEqual([]);
  });

  it('[02a §6.17] no branch config yet → no floors; a KDS device → 403 DEVICE_TYPE_NOT_ALLOWED', async () => {
    const ali = signIn(ALI);
    swapBranchConfig(null);
    expect((await tableMap(ali)).floors).toEqual([]);
    applyConfig(config());
    const onKds = signIn(ALI, 'kds');
    const r = await query(onKds, 'table-map');
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('DEVICE_TYPE_NOT_ALLOWED');
    for (const type of ['phone', 'cashier_kiosk'] as const) expect((await query(signIn(ALI, type), 'table-map')).status).toBe(200);
  });

  it('[02a §6.17] countsAsActivity: false (session last_activity_at unchanged)', async () => {
    const ali = signIn(ALI);
    const before = hub.deps.db.prepare('SELECT last_activity_at FROM staff_sessions WHERE session_id = ?').get(ali.sessionId);
    hub.clock.advance(60_000);
    await tableMap(ali);
    const r = await query(ali, `handover-candidates?table_id=T1`);
    expect(r.status).toBe(200);
    expect(activity.get(ali.sessionId)).toBeUndefined();
    expect(hub.deps.db.prepare('SELECT last_activity_at FROM staff_sessions WHERE session_id = ?').get(ali.sessionId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------- §6.18

interface Candidate {
  staff_id: string;
  name: string;
  is_assignee: boolean;
  working: boolean;
  tables_held: number;
}

describe('handover-candidates (§6.18)', () => {
  it('[02a #37] handover-candidates: working first; holder and caller excluded; take-order holders covering the floor; 2 statements', async () => {
    const ali = signIn(ALI); // holder of T5 (zone Z1, floor F1)
    const bilal = signIn(BILAL); // caller
    signIn(ZAIN);
    signIn(FAIZ);
    signIn(OWEN);
    signIn(KAMI);
    signIn(CASH);
    open('T5', 'SEAT-5', ali);
    open('T6', 'SEAT-6', bilal);
    open('T7', 'SEAT-7', bilal, { joined: ['T8'] });
    // Sara is the assignee of T5 (zone Z1), signed out; Noor never signed in
    const counter = statementCounter(hub.deps.readDb);
    const r = await query(bilal, 'handover-candidates?table_id=T5');
    expect(counter.count).toBe(2);
    expect(r.status).toBe(200);
    const staff = (r.body.data as { staff: Candidate[] }).staff;
    expect(staff).toEqual([
      { staff_id: ZAIN, name: 'Zain', is_assignee: false, working: true, tables_held: 0 },
      { staff_id: NOOR, name: 'Noor', is_assignee: false, working: false, tables_held: 0 },
      { staff_id: SARA, name: 'Sara', is_assignee: true, working: false, tables_held: 0 },
    ]);

    // tables_held counts the open seatings a candidate holds; the holder may also ask (he is excluded as holder)
    const fromAli = (await query(ali, 'handover-candidates?table_id=T5')).body.data as { staff: Candidate[] };
    expect(fromAli.staff.map((c) => [c.staff_id, c.working, c.tables_held])).toEqual([
      [BILAL, true, 2],
      [ZAIN, true, 0],
      [NOOR, false, 0],
      [SARA, false, 0],
    ]);
  });

  it('[02a §6.18] unknown table → 404 TABLE_NOT_FOUND', async () => {
    const ali = signIn(ALI);
    const r = await query(ali, 'handover-candidates?table_id=T999');
    expect(r.status).toBe(404);
    expect(r.body.error?.code).toBe('TABLE_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------------------------- §6.19

const TABLE_EVENTS = [
  'TableOpened',
  'TableLocked',
  'TableLockTouched',
  'TableLockReleased',
  'TableHolderChanged',
  'TableMoved',
  'TablesMerged',
  'SeatingSplit',
  'BillRequested',
  'TableCleaned',
];
const KDS_TOO = ['TableMoved', 'TablesMerged', 'SeatingSplit'];

function socketCtx(o: Partial<SocketCtx>): SocketCtx {
  return { deviceId: 'D1', deviceType: 'tablet', sessionId: 'X1', kind: 'staff', staffId: ALI, stationId: null, asOfSeq: 1, ...o };
}

describe('audiences and catch-up (§6.19, catch-up part `tables`)', () => {
  it('[02a §6.19 audiences] every table event to staff sockets and cashier kiosks of the branch; TableMoved / TablesMerged / SeatingSplit also to KDS stations', async () => {
    const staff = socketCtx({});
    const phone = socketCtx({ deviceType: 'phone' });
    const kiosk = socketCtx({ deviceType: 'cashier_kiosk', staffId: CASH });
    const station = socketCtx({ deviceType: 'kds', kind: 'station', staffId: null, stationId: 'S1' });
    for (const event_type of TABLE_EVENTS) {
      const event = { event_type, payload: {} } as unknown as PosEvent;
      expect(audienceAllows(event, staff), event_type).toBe(true);
      expect(audienceAllows(event, phone), event_type).toBe(true);
      expect(audienceAllows(event, kiosk), event_type).toBe(true);
      expect(audienceAllows(event, station), event_type).toBe(KDS_TOO.includes(event_type));
    }

    // through the hub's sockets: a staff socket gets the open and the move, a KDS station socket only the move
    const ali = signIn(ALI);
    const kds = pairDevice(hub, { type: 'kds', stationId: 'S1' });
    const stationSession = openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: 'S1' });
    const staffWs = await authed(ali.token, ali.sessionToken);
    const stationWs = await authed(kds.token, stationSession.token);
    open('T1', 'SEAT-1', ali, { locked: false });
    append(ev('table', 'T1', 'TableMoved', { seating_id: 'SEAT-1', from_table_id: 'T1', to_table_id: 'T2', by_staff_id: ALI }, ali));
    await staffWs.untilCount(3);
    await stationWs.untilCount(2);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(eventTypes(staffWs).filter((t) => t.startsWith('Table'))).toEqual(['TableOpened', 'TableMoved']);
    expect(eventTypes(stationWs)).toEqual(['TableMoved']);
  });

  it('[02a §6.19 catch-up] catch-up `tables` = the map builder for the socket\'s (staff, device); staff sockets of map devices only; 3 statements at the catch-up seq', async () => {
    const ali = signIn(ALI);
    open('T1', 'SEAT-1', ali);
    open('T2', 'SEAT-2', ali, { joined: ['T3'] });
    append(placed('O1', 'SEAT-2', ali));
    const ws = await authed(ali.token, ali.sessionToken);
    const frame = ws.messages[0] as { type: string; as_of_seq: number; state: Record<string, unknown> };
    expect(frame.type).toBe('catch_up');
    const part = frame.state.tables as MapBody;
    expect(part.as_of_seq).toBe(frame.as_of_seq);
    expect(tiles(part).get('T1')!.lock).toEqual({ staff_id: ALI, name: 'Ali', mine: true });
    // the same body the query gives this (staff, device)
    const queried = await tableMap(ali);
    expect({ ...part, as_of_seq: queried.as_of_seq }).toEqual(queried);

    // another device of the same staff: not mine
    const other = signIn(ALI);
    const otherWs = await authed(other.token, other.sessionToken);
    const otherPart = (otherWs.messages[0] as { state: Record<string, unknown> }).state.tables as MapBody;
    expect(tiles(otherPart).get('T1')!.lock).toEqual({ staff_id: ALI, name: 'Ali', mine: false });

    // a KDS station socket gets no `tables` part
    const kds = pairDevice(hub, { type: 'kds', stationId: 'S1' });
    const stationSession = openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: 'S1' });
    const stationWs = await authed(kds.token, stationSession.token);
    expect((stationWs.messages[0] as { state: Record<string, unknown> }).state).not.toHaveProperty('tables');

    // the builder: 3 statements, as_of_seq from the socket
    const counter = statementCounter(hub.deps.db);
    const built = tableMapBody(hub.deps.db, { staffId: ALI, deviceId: ali.deviceId }, { asOfSeq: 42, directory: currentDirectory(hub.app) });
    expect(counter.count).toBe(3);
    expect(built.as_of_seq).toBe(42);
  });
});

// ---------------------------------------------------------------------------------------------- ws

const sockets: WsClient[] = [];
afterEach(() => {
  for (const ws of sockets.splice(0)) ws.close();
});

async function authed(deviceToken: string, sessionToken: string): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  sockets.push(ws);
  ws.send({ type: 'auth', device_token: deviceToken, session_token: sessionToken });
  await ws.untilCount(1);
  return ws;
}

function eventTypes(ws: WsClient): string[] {
  return ws.messages
    .filter((m) => (m as { type?: string }).type === 'event')
    .map((m) => (m as { event: { event_type: string } }).event.event_type);
}
