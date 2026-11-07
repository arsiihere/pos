import { stationsLive, type EngineState } from '@pos/engine';
import type { EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayOpened, anEngineConfigApplied, anOrderBatch } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { queryRegistry, type QueryCtx } from '../../src/queries/registry';
import type { SocketCtx } from '../../src/ws/catch-up';
import { stationsLivePart } from '../../src/ws/engine-audiences';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';

type Client = { device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

const cleanups: Array<() => Promise<void>> = [];

// 03a §6.5 (GET /queries/stations-live), §6.4 (station-config audiences, catch-up part stations_live), §10.2 #66.
describe('stations-live query, catch-up part and audiences (03a §6.4, §6.5)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[03a #66] 0 statements; the body is stationsLive + as_of_seq (writer.lastSeq()); unknown and archived ids are left out; a station session may read it; no activity touch', async () => {
    const hub = await open();
    const staff = staffOn(hub, 'S_MGR');
    const kds = stationOn(hub, 'S1');
    const touched = activity.get(staff.session.sessionId);

    const all = await query(hub, staff, '');
    expect(all.statusCode, all.body).toBe(200);
    expect(all.json()).toEqual({ data: expected(hub) });
    expect(all.json().data.stations.map((s: { station_id: string }) => s.station_id)).toEqual(['S1', 'S2', 'S4']);
    expect(all.json().data.as_of_seq).toBe(hub.deps.writer.lastSeq());
    // The fixture is not empty: S1 carries the open order's load.
    expect(all.json().data.stations[0].pressure_bp).toBeGreaterThan(0);

    // Repeated keys (Fastify's parser): station_ids=S2&station_ids=S9&station_ids=S3; one key is one id.
    const some = await query(hub, staff, '?station_ids=S2&station_ids=S9&station_ids=S3');
    expect(some.statusCode, some.body).toBe(200);
    expect(some.json()).toEqual({ data: expected(hub, ['S2', 'S9', 'S3']) });
    expect(some.json().data.stations.map((s: { station_id: string }) => s.station_id)).toEqual(['S2']);
    const one = await query(hub, kds, '?station_ids=S1');
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json()).toEqual({ data: expected(hub, ['S1']) });
    expect(activity.get(staff.session.sessionId)).toBe(touched);

    // 0 statements: none on the read handle the handler gets; on the main handle only the route's session check,
    // the same as branch-config's (a 0-statement query, 01a S47).
    const read = statementCounter(hub.deps.readDb);
    const main = statementCounter(hub.deps.db);
    expect((await hubGet(hub, staff, '/queries/branch-config')).statusCode).toBe(200);
    const sessionOnly = main.count;
    expect(read.count).toBe(0);
    main.reset();
    expect((await query(hub, staff, '?station_ids=S1&station_ids=S2')).statusCode).toBe(200);
    expect(read.count).toBe(0);
    expect(main.count).toBe(sessionOnly);
    main.reset();
    const def = queryRegistry(hub.app).byResource('stations-live')!;
    def.handle(ctxOf(hub), { station_ids: ['S1'] });
    expect(main.count + read.count).toBe(0);
  });

  it('[03a #66] station_ids with 51 ids or a non-string → 400 VALIDATION_FAILED; 50 ids is fine', async () => {
    const hub = await open();
    const staff = staffOn(hub, 'S_MGR');
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `station_ids=X${i}`).join('&');
    const tooMany = await query(hub, staff, `?${ids(51)}`);
    expect(tooMany.statusCode, tooMany.body).toBe(400);
    expect(tooMany.json().error.code).toBe('VALIDATION_FAILED');
    expect((await query(hub, staff, `?${ids(50)}&station_ids=S1`)).statusCode).toBe(400);
    const fifty = await query(hub, staff, `?${ids(49)}&station_ids=S1`);
    expect(fifty.statusCode, fifty.body).toBe(200);
    expect(fifty.json().data.stations.map((s: { station_id: string }) => s.station_id)).toEqual(['S1']);
    // A query string only carries strings; a non-string reaches the schema from a parsed value. The route maps
    // any schema failure to VALIDATION_FAILED (the 51-id case above).
    const schema = queryRegistry(hub.app).byResource('stations-live')!.querySchema;
    for (const bad of [[1], ['S1', 2], [null], [{}], 7, { a: 'S1' }]) {
      expect(schema.safeParse({ station_ids: bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(schema.safeParse({ station_ids: 'S1' }).data).toEqual({ station_ids: ['S1'] });
    expect(schema.safeParse({}).data).toEqual({});
  });

  it('[03a #66 hub] ≤ 5 ms sanity bound: the handler median over 50 calls on the test fixture (not the §7.1 measurement)', async () => {
    const hub = await open();
    const def = queryRegistry(hub.app).byResource('stations-live')!;
    const ctx = ctxOf(hub);
    const times: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const start = performance.now();
      def.handle(ctx, {});
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    const p99 = times[Math.ceil(times.length * 0.99) - 1]!;
    console.info(`stations-live handler: median ${median.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms over ${times.length} calls`);
    expect(median).toBeLessThanOrEqual(5);
  });

  it('[03a §6.4] EngineConfigApplied, StationCapacitySet, StationPauseSet reach every staff and station socket; order-stream events reach none', async () => {
    const hub = await open();
    const staff = await socketOf(hub, staffOn(hub, 'S_MGR'));
    const kds = await socketOf(hub, stationOn(hub, 'S2'));
    append(hub, anOrderBatch({ order_id: 'O2', lines: [{ order_item_id: 'L9' }], recorded_at: hub.clock.branchNow() }));
    append(hub, [
      anEngineConfigApplied({ payload: { ...configPayload(), config_version: 2 } }),
      stationEvent('StationCapacitySet', 'S1', { station_id: 'S1', capacity_override: 2, previous: null, reason: 'manager' }),
      stationEvent('StationPauseSet', 'S1', { station_id: 'S1', paused: true }),
    ]);
    await staff.untilCount(4);
    await kds.untilCount(4);
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const ws of [staff, kds]) {
      expect(eventTypes(ws)).toEqual(['EngineConfigApplied', 'StationCapacitySet', 'StationPauseSet']);
    }
  });

  it('[03a §6.4] catch-up part stations_live: staff and station sockets get the §6.5 body at the catch-up seq; its build runs 0 statements', async () => {
    const hub = await open();
    const staff = await socketOf(hub, staffOn(hub, 'S_MGR'));
    const kds = await socketOf(hub, stationOn(hub, 'S4'));
    for (const ws of [staff, kds]) {
      const frame = ws.messages[0] as { type: string; as_of_seq: number; state: Record<string, unknown> };
      expect(frame.type).toBe('catch_up');
      // Session events land after the first socket's catch-up; they do not move the engine's stations.
      expect(frame.state.stations_live).toEqual({ as_of_seq: frame.as_of_seq, ...stationsLive(hub.deps.state.get(), hub.clock.branchNow()) });
    }
    const part = stationsLivePart(hub.clock);
    const socket: SocketCtx = { deviceId: 'D1', deviceType: 'kds', sessionId: 'X', kind: 'station', staffId: null, stationId: 'S1', asOfSeq: 7 };
    expect(part.appliesTo(socket)).toBe(true);
    expect(part.appliesTo({ ...socket, kind: 'staff', stationId: null, staffId: 'S_MGR' })).toBe(true);
    const counter = statementCounter(hub.deps.db);
    const body = part.build(hub.deps.db, hub.deps.state.get(), socket);
    expect(counter.count).toBe(0);
    expect(body).toEqual({ as_of_seq: 7, ...stationsLive(hub.deps.state.get(), hub.clock.branchNow()) });
  });
});

const STATION = anEngineConfigApplied().payload.stations as Array<Record<string, unknown>>;

function configPayload(): Record<string, unknown> {
  return {
    ...anEngineConfigApplied().payload,
    stations: [
      { ...STATION[0]! },
      { ...STATION[0]!, station_id: 'S2', name: 'Grill', pause_enabled: true },
      { ...STATION[0]!, station_id: 'S3', name: 'Old', is_archived: true },
      { ...STATION[0]!, station_id: 'S4', name: 'Fryer', capacity: 2 },
    ],
  };
}

// S1 Karahi with one open order line, S2, S3 archived, S4.
async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub);
  append(hub, [anEngineConfigApplied({ payload: configPayload() }), aBusinessDayOpened()]);
  append(hub, anOrderBatch({ lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2' }], recorded_at: hub.clock.branchNow() }));
  return hub;
}

function expected(hub: TestHub, ids?: string[]): unknown {
  return { as_of_seq: hub.deps.writer.lastSeq(), ...stationsLive(hub.deps.state.get() as EngineState, hub.clock.branchNow(), ids) };
}

function ctxOf(hub: TestHub): QueryCtx {
  return {
    db: hub.deps.readDb,
    page: { cursor: null, limit: 50 },
    directory: undefined as unknown as QueryCtx['directory'],
    device: undefined,
    session: undefined,
    state: hub.deps.state.get(),
    branchConfig: null,
    now: hub.clock.branchNow(),
  };
}

function append(hub: TestHub, events: ReadonlyArray<PosEvent | EventDraft>): void {
  hub.deps.writer.run((tx) => tx.append(events.map(draftOf)));
}

function draftOf(event: PosEvent | EventDraft): EventDraft {
  return {
    stream_type: event.stream_type,
    stream_id: event.stream_id,
    event_type: event.event_type,
    schema_version: event.schema_version,
    payload: event.payload,
    occurred_at: event.occurred_at,
    actor_id: event.actor_id,
    device_id: event.device_id,
  };
}

function stationEvent(eventType: string, stationId: string, payload: Record<string, unknown>): EventDraft {
  return { stream_type: 'station', stream_id: stationId, event_type: eventType, schema_version: 1, payload, occurred_at: 0, actor_id: 'S_MGR', device_id: 'D_SEED' };
}

function staffOn(hub: TestHub, staffId: string): Client {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { device, session };
}

function stationOn(hub: TestHub, stationId: string): Client {
  const device = pairDevice(hub, { type: 'kds', stationId });
  const session = openSession(hub, { kind: 'station', deviceId: device.deviceId, stationId });
  return { device, session };
}

async function socketOf(hub: TestHub, client: Client): Promise<WsClient> {
  const ws = await connectWs(hub.app);
  cleanups.push(async () => ws.close());
  ws.send({ type: 'auth', device_token: client.device.token, session_token: client.session.token });
  await ws.untilCount(1);
  return ws;
}

function eventTypes(ws: WsClient): string[] {
  return ws.messages
    .filter((m) => (m as { type?: string }).type === 'event')
    .map((m) => (m as { event: { event_type: string } }).event.event_type);
}

function hubGet(hub: TestHub, client: Client, url: string) {
  return hub.app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${client.device.token}`, 'x-session-token': client.session.token },
  });
}

function query(hub: TestHub, client: Client, search: string) {
  return hubGet(hub, client, `/queries/stations-live${search}`);
}
