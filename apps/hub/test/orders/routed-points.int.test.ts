import type { EngineState } from '@pos/engine';
import type { BranchConfig, PosEvent } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, fixtureMenu, openDay, openSeating } from './fixtures';

// 03b v1.0.16 §3.1 Routed point, §4.5 PT-R1 (owner clarification); tests 126 (submit and return part) and 128 (hub
// half), through the real SubmitOrder and ReturnToKitchen routes. L-CLOSE-2.

let hub: TestHub;
afterEach(async () => {
  activity.drain();
  swapBranchConfig(null);
  await hub.close();
});

/** Main ['dine_in'] (S1's default), TA ['takeaway', 'parking'], P ['parking']; S1 carries 30 s to TA, 0 to Main. */
function menu(o: { allDineIn?: boolean } = {}): BranchConfig {
  const base = fixtureMenu();
  const main = base.points.find((p) => p.point_id === base.stations[0]!.point_id)!;
  return {
    ...base,
    points: o.allDineIn
      ? [{ ...main, order_types: ['dine_in'] }, { point_id: 'TA', name: 'Takeaway', sort_order: 5, is_archived: false, order_types: ['dine_in'] }]
      : [
          { ...main, order_types: ['dine_in'] },
          { point_id: 'TA', name: 'Takeaway', sort_order: 5, is_archived: false, order_types: ['takeaway', 'parking'] },
          { point_id: 'P', name: 'Parking', sort_order: 6, is_archived: false, order_types: ['parking'] },
        ],
    stations: base.stations.map((s) => ({ ...s, carry_times: [{ point_id: main.point_id, carry_ms: 0 }, { point_id: 'TA', carry_ms: 30_000 }, { point_id: 'P', carry_ms: 10_000 }] })),
  };
}

async function start(config: BranchConfig) {
  hub = await createTestHub();
  await seedDirectory(hub, await aDirectory());
  openDay(hub, { menu: config });
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
  return { device, session };
}
let seq = 0;
async function command(w: Awaited<ReturnType<typeof start>>, path: string, command_type: string, payload: Record<string, unknown>) {
  seq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: { authorization: `Bearer ${w.device.token}`, 'x-session-token': w.session.token },
    payload: { command_id: `rp-${seq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type, payload, occurred_at: hub.clock.branchNow(), actor_id: 'S_MGR', device_id: w.device.deviceId },
  });
  expect(res.statusCode, res.body).toBe(200);
  const ids = (res.json() as { data: { event_ids: string[] } }).data.event_ids;
  return (hub.deps.db.prepare('SELECT event_type, payload FROM events WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq').all(JSON.stringify(ids)) as Array<{ event_type: string; payload: string }>).map(
    (r) => ({ event_type: r.event_type, payload: JSON.parse(r.payload) as Record<string, unknown> }) as Pick<PosEvent, 'event_type' | 'payload'>,
  );
}
const linesOf = (events: Array<Pick<PosEvent, 'event_type' | 'payload'>>, type: string) =>
  (events.find((e) => e.event_type === type)!.payload as { lines: Array<{ order_item_id: string; point_id: string | null; carry_ms: number }> }).lines;
const engine = (): EngineState => hub.deps.state.get() as EngineState;
const karahi = (order_item_id: string) => ({ order_item_id, item_id: FX.piece, quantity: 1 });

describe('[03b #126] a station\'s lines go to the Pass point routePoint picks for each order type', () => {
  it('takeaway → TA (carry 30 s), dine-in → Main (0), parking → P (the most specific); OrderPlaced and the engine agree; a return keeps its active point', async () => {
    const config = menu();
    const main = config.stations[0]!.point_id;
    const w = await start(config);
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_MGR' });
    const ta = await command(w, 'submit-order', 'SubmitOrder', { order_id: 'OT', order_type: 'takeaway', lines: [karahi('LT')] });
    const di = await command(w, 'submit-order', 'SubmitOrder', { order_id: 'OD', order_type: 'dine_in', table_id: FX.table, seating_id: 'SEAT1', lines: [karahi('LD')] });
    const pk = await command(w, 'submit-order', 'SubmitOrder', { order_id: 'OP', order_type: 'parking', parking: { car_number: 'LEB-1', car_type: 'sedan' }, lines: [karahi('LP')] });
    expect(linesOf(ta, 'OrderPlaced')[0]).toMatchObject({ point_id: 'TA', carry_ms: 30_000 });
    expect(linesOf(di, 'OrderPlaced')[0]).toMatchObject({ point_id: main, carry_ms: 0 });
    expect(linesOf(pk, 'OrderPlaced')[0]).toMatchObject({ point_id: 'P', carry_ms: 10_000 });
    expect(engine().lines.LT).toMatchObject({ point_id: 'TA', carry_ms: 30_000 });
    expect(engine().lines.LD).toMatchObject({ point_id: main, carry_ms: 0 });
    expect(engine().lines.LP).toMatchObject({ point_id: 'P' });
    // a return of the served takeaway line goes to its recorded, active point (TA)
    const { serveLines } = await import('../kds/fixtures');
    const fire = engine().lines.LT!.fire_ms!;
    hub.clock.set(Math.max(fire, hub.clock.branchNow()));
    hub.deps.writer.run((tx) =>
      tx.append([
        { stream_type: 'station', stream_id: engine().lines.LT!.station_id, event_type: 'FireDispatched', schema_version: 1, payload: { station_id: engine().lines.LT!.station_id, order_item_ids: ['LT'], load_id: null, due_at: hub.clock.branchNow(), reason: 'pulled' }, occurred_at: hub.clock.branchNow(), actor_id: null, device_id: 'hub' },
        { stream_type: 'order', stream_id: 'OT', event_type: 'ItemStarted', schema_version: 1, payload: { order_item_id: 'LT', started_at: hub.clock.branchNow(), source: 'tap' }, occurred_at: hub.clock.branchNow(), actor_id: null, device_id: 'hub' },
        { stream_type: 'order', stream_id: 'OT', event_type: 'ItemDone', schema_version: 1, payload: { order_item_id: 'LT', done_at: hub.clock.branchNow(), source: 'tap' }, occurred_at: hub.clock.branchNow(), actor_id: null, device_id: 'hub' },
      ]),
    );
    serveLines(hub, 'OT', ['LT']);
    const ret = await command(w, 'return-to-kitchen', 'ReturnToKitchen', { order_item_id: 'LT', return_order_item_id: 'LTR', mode: 'remake' });
    expect(linesOf(ret, 'OrderLinesAdded')[0]).toMatchObject({ point_id: 'TA', carry_ms: 30_000 });
    expect(engine().lines.LTR).toMatchObject({ point_id: 'TA' });
  });
});

describe('[03b #128 hub] fallback: every point dine-in only', () => {
  it('a parking SubmitOrder → 200, its line\'s point = Main (the station default), never dropped', async () => {
    const config = menu({ allDineIn: true });
    const main = config.stations[0]!.point_id;
    const w = await start(config);
    const pk = await command(w, 'submit-order', 'SubmitOrder', { order_id: 'OP', order_type: 'parking', parking: { car_number: 'LEB-1', car_type: 'sedan' }, lines: [karahi('LP')] });
    expect(linesOf(pk, 'OrderPlaced')[0]).toMatchObject({ point_id: main });
    expect(engine().lines.LP).toMatchObject({ point_id: main });
  });
});

describe('[03b #129] two dine-in-only points tie: each line to its own default; Readies and their keys per point', () => {
  it('Karahi → Main, naan (S2) → G; a Ready at each point with dedupe keys <order>:<point>:<table>; each Pass sees only its own point\'s Ready events', async () => {
    const { cookDirectory, pairPassTablet, COOK } = await import('../kds/fixtures');
    const { audienceAllows } = await import('../../src/ws/audience');
    const base = fixtureMenu();
    const main = base.stations[0]!.point_id;
    const config: BranchConfig = {
      ...base,
      points: [
        { ...base.points.find((p) => p.point_id === main)!, order_types: ['dine_in'] },
        { point_id: 'G', name: 'Grill', sort_order: 5, is_archived: false, order_types: ['dine_in'] },
      ],
      stations: base.stations.map((s) => (s.station_id === FX.zoneStation ? { ...s, point_id: 'G' } : s)),
      items: base.items.map((i) => (i.item_id === FX.naan ? { ...i, station_id: FX.zoneStation } : i)),
    };
    hub = await createTestHub();
    await seedDirectory(hub, await cookDirectory());
    openDay(hub, { menu: config });
    const device = pairDevice(hub, { type: 'tablet' });
    const w = { device, session: openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId }) };
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_MGR' });
    await command(w, 'submit-order', 'SubmitOrder', { order_id: 'OD', order_type: 'dine_in', table_id: FX.table, seating_id: 'SEAT1', lines: [karahi('K1'), { order_item_id: 'N1', item_id: FX.naan, quantity: 1 }] });
    expect(engine().lines.K1).toMatchObject({ point_id: main });
    expect(engine().lines.N1).toMatchObject({ point_id: 'G' });
    // cook both
    const now = () => hub.clock.branchNow();
    for (const id of ['K1', 'N1']) {
      const st = engine().lines[id]!.station_id;
      hub.deps.writer.run((tx) =>
        tx.append([
          { stream_type: 'station', stream_id: st, event_type: 'FireDispatched', schema_version: 1, payload: { station_id: st, order_item_ids: [id], load_id: null, due_at: now(), reason: 'pulled' }, occurred_at: now(), actor_id: null, device_id: 'hub' },
          { stream_type: 'order', stream_id: 'OD', event_type: 'ItemStarted', schema_version: 1, payload: { order_item_id: id, started_at: now(), source: 'tap' }, occurred_at: now(), actor_id: null, device_id: 'hub' },
          { stream_type: 'order', stream_id: 'OD', event_type: 'ItemDone', schema_version: 1, payload: { order_item_id: id, done_at: now(), source: 'tap' }, occurred_at: now(), actor_id: null, device_id: 'hub' },
        ]),
      );
    }
    const passOf = (point: string) => {
      const d = pairPassTablet(hub, { pointId: point });
      return { device: d, session: openSession(hub, { kind: 'staff', staffId: COOK.staff, deviceId: d.deviceId }) };
    };
    const atMain = passOf(main);
    const atG = passOf('G');
    const mark = async (p: ReturnType<typeof passOf>, point_id: string) => {
      seq += 1;
      const res = await hub.app.inject({
        method: 'POST',
        url: '/commands/mark-ready-to-serve',
        headers: { authorization: `Bearer ${p.device.token}`, 'x-session-token': p.session.token },
        payload: { command_id: `rp-${seq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: 'MarkReadyToServe', payload: { order_id: 'OD', point_id }, occurred_at: now(), actor_id: COOK.staff, device_id: p.device.deviceId },
      });
      expect(res.statusCode, res.body).toBe(200);
    };
    await mark(atMain, main);
    await mark(atG, 'G');
    const keys = (hub.deps.db.prepare("SELECT dedupe_key FROM alerts WHERE kind = 'ready_to_serve' AND subject_stream_id = 'OD' ORDER BY raised_seq").all() as Array<{ dedupe_key: string }>).map((r) => r.dedupe_key);
    expect(keys).toEqual([`OD:${main}:${FX.table}`, `OD:G:${FX.table}`]);
    // the point Ready events are each point's own: the G Pass is not in Main's audience and vice versa
    const readies = hub.deps.db.prepare("SELECT * FROM events WHERE event_type = 'ReadyToServe' AND stream_id = 'OD' ORDER BY seq").all() as Array<Record<string, unknown>>;
    const ev = (row: Record<string, unknown>) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as PosEvent;
    const ctx = (deviceId: string) => ({ deviceId, deviceType: 'tablet' as const, sessionId: 'x', kind: 'staff' as const, staffId: COOK.staff, stationId: null, asOfSeq: 0 });
    expect(audienceAllows(ev(readies[0]!), ctx(atMain.device.deviceId))).toBe(true);
    expect(audienceAllows(ev(readies[0]!), ctx(atG.device.deviceId))).toBe(false);
    expect(audienceAllows(ev(readies[1]!), ctx(atG.device.deviceId))).toBe(true);
    expect(audienceAllows(ev(readies[1]!), ctx(atMain.device.deviceId))).toBe(false);
  });
});
