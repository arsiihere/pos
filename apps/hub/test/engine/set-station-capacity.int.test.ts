import { stationsLive, type EngineState } from '@pos/engine';
import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayOpened, anEngineConfigApplied, anOrderBatch } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

type Client = { actorId: string | null; device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

const cleanups: Array<() => Promise<void>> = [];

// 03a §6.6, §10.2 #68: SetStationCapacity from a staff session (manage-stations, scope last) and a KDS station session.
describe('POST /commands/set-station-capacity (03a §6.6)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[03a #68] happy: a manager sets S1 to 1 → one StationCapacitySet { previous null, reason manager }, the station re-plans, the body is the live station after COMMIT', async () => {
    const hub = await open();
    const manager = staffOn(hub, 'S_MGR');
    const before = engine(hub);
    const response = await send(hub, manager, { station_id: 'S1', capacity_override: 1, reason: 'manager' }, 'cmd-happy');
    expect(response.statusCode, response.body).toBe(200);
    const events = capacityEvents(hub);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stream_type: 'station',
      stream_id: 'S1',
      schema_version: 1,
      actor_id: 'S_MGR',
      device_id: manager.device.deviceId,
      payload: { station_id: 'S1', capacity_override: 1, previous: null, reason: 'manager' },
    });
    const after = engine(hub);
    expect(after).not.toBe(before);
    expect(after.stations.S1!.capacity_override).toBe(1);
    const live = stationsLive(after, hub.clock.branchNow(), ['S1']).stations[0]!;
    expect(live.pressure_bp).toBeGreaterThan(stationsLive(before, hub.clock.branchNow(), ['S1']).stations[0]!.pressure_bp);
    expect(response.json().data.result).toEqual({
      station_id: 'S1',
      effective_capacity: 1,
      pressure_bp: live.pressure_bp,
      band: live.band,
      changed: true,
    });
    expect(response.json().data.event_ids).toEqual([events[0]!.event_id]);
  });

  it('[03a #68] 400: capacity_override out of 1–100, a non-integer, an unknown reason → VALIDATION_FAILED, nothing written', async () => {
    const hub = await open();
    const manager = staffOn(hub, 'S_MGR');
    const before = counts(hub);
    for (const [i, payload] of [
      { station_id: 'S1', capacity_override: 0, reason: 'manager' },
      { station_id: 'S1', capacity_override: 101, reason: 'manager' },
      { station_id: 'S1', capacity_override: 2.5, reason: 'manager' },
      { station_id: 'S1', capacity_override: 2, reason: 'extra_cook' },
      { station_id: 'S1', reason: 'manager' },
    ].entries()) {
      const response = await send(hub, manager, payload, `cmd-bad-${i}`);
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
    expect(counts(hub)).toEqual(before);
  });

  it('[03a #68] 404 STATION_NOT_FOUND: an unknown station and an archived one; nothing written', async () => {
    const hub = await open();
    const manager = staffOn(hub, 'S_MGR');
    const before = counts(hub);
    for (const stationId of ['S9', 'S3']) {
      const response = await send(hub, manager, { station_id: stationId, capacity_override: 2, reason: 'manager' }, `cmd-404-${stationId}`);
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error).toMatchObject({ code: 'STATION_NOT_FOUND', details: { station_id: stationId } });
    }
    expect(counts(hub)).toEqual(before);
  });

  it('[03a #68] 403 outside_scope: manage-stations my_stations allows only the run_station stations, checked after the 404 (C8); scope branch allows every station', async () => {
    const hub = await open();
    const lead = staffOn(hub, 'S_LEAD');
    const before = counts(hub);
    const outside = await send(hub, lead, { station_id: 'S2', capacity_override: 2, reason: 'manager' }, 'cmd-out');
    expect(outside.statusCode, outside.body).toBe(403);
    expect(outside.json().error).toMatchObject({
      code: 'PERMISSION_DENIED',
      details: { permission: 'manage-stations', reason: 'outside_scope', station_id: 'S2' },
    });
    // Step 3 before step 4: an unknown station is 404 for the scoped lead too.
    expect((await send(hub, lead, { station_id: 'S9', capacity_override: 2, reason: 'manager' }, 'cmd-out-404')).statusCode).toBe(404);
    expect(counts(hub)).toEqual(before);
    const inside = await send(hub, lead, { station_id: 'S1', capacity_override: 2, reason: 'manager' }, 'cmd-in');
    expect(inside.statusCode, inside.body).toBe(200);
    expect(inside.json().data.result).toMatchObject({ station_id: 'S1', effective_capacity: 2, changed: true });
    const manager = staffOn(hub, 'S_MGR');
    expect((await send(hub, manager, { station_id: 'S2', capacity_override: 2, reason: 'manager' }, 'cmd-branch')).statusCode).toBe(200);
  });

  it('[03a #68] no-op: the same value again → no event, 200 with the same shape and changed false', async () => {
    const hub = await open();
    const manager = staffOn(hub, 'S_MGR');
    expect((await send(hub, manager, { station_id: 'S1', capacity_override: 2, reason: 'manager' }, 'cmd-first')).statusCode).toBe(200);
    const before = capacityEvents(hub).length;
    const state = engine(hub);
    const again = await send(hub, manager, { station_id: 'S1', capacity_override: 2, reason: 'manager' }, 'cmd-same');
    expect(again.statusCode, again.body).toBe(200);
    const live = stationsLive(state, hub.clock.branchNow(), ['S1']).stations[0]!;
    expect(again.json().data.result).toEqual({ station_id: 'S1', effective_capacity: 2, pressure_bp: live.pressure_bp, band: live.band, changed: false });
    expect(again.json().data.event_ids).toEqual([]);
    expect(capacityEvents(hub)).toHaveLength(before);
    expect(engine(hub)).toBe(state);
    // null on a station without an override is a no-op too.
    const unset = await send(hub, manager, { station_id: 'S2', capacity_override: null, reason: 'manager' }, 'cmd-null');
    expect(unset.json().data.result).toMatchObject({ station_id: 'S2', effective_capacity: 4, changed: false });
    expect(capacityEvents(hub)).toHaveLength(before);
  });

  it('[03a #68] retransmit (D32): the same command_id → the stored response, Idempotent-Replay, one event', async () => {
    const hub = await open();
    const manager = staffOn(hub, 'S_MGR');
    const first = await send(hub, manager, { station_id: 'S1', capacity_override: 3, reason: 'manager' }, 'cmd-retx');
    expect(first.statusCode).toBe(200);
    hub.clock.set(hub.clock.branchNow() + 60_000);
    const second = await send(hub, manager, { station_id: 'S1', capacity_override: 3, reason: 'manager' }, 'cmd-retx');
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(capacityEvents(hub)).toHaveLength(1);
  });

  it('[03a #68] COMMIT failure (D45): a throw before COMMIT leaves the live state, the log and the published frames untouched', async () => {
    const failing = { on: false };
    const hub = await open({
      beforeCommit: () => {
        if (failing.on) throw new Error('commit failed');
      },
    });
    const manager = staffOn(hub, 'S_MGR');
    const state = engine(hub);
    const published = hub.published.length;
    const before = counts(hub);
    failing.on = true;
    const response = await send(hub, manager, { station_id: 'S1', capacity_override: 1, reason: 'manager' }, 'cmd-fail');
    expect(response.statusCode).toBe(500);
    expect(engine(hub)).toBe(state);
    expect(engine(hub).stations.S1!.capacity_override).toBeNull();
    expect(hub.published.length).toBe(published);
    expect(counts(hub)).toEqual(before);
  });

  it('[03a #68] station session for its own station with lane_off → 200, actor_id null, the KDS device_id; lane_on back to null', async () => {
    const hub = await open();
    const kds = stationOn(hub, 'S1');
    const off = await send(hub, kds, { station_id: 'S1', capacity_override: 2, reason: 'lane_off' }, 'cmd-lane-off');
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().data.result).toMatchObject({ station_id: 'S1', effective_capacity: 2, changed: true });
    const on = await send(hub, kds, { station_id: 'S1', capacity_override: null, reason: 'lane_on' }, 'cmd-lane-on');
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json().data.result).toMatchObject({ station_id: 'S1', effective_capacity: 4, changed: true });
    const events = capacityEvents(hub);
    expect(events.map((event) => [event.actor_id, event.device_id, event.payload])).toEqual([
      [null, kds.device.deviceId, { station_id: 'S1', capacity_override: 2, previous: null, reason: 'lane_off' }],
      [null, kds.device.deviceId, { station_id: 'S1', capacity_override: null, previous: 2, reason: 'lane_on' }],
    ]);
  });

  it('[03a §10.5] statements: exactly 16 for a lane_off, the 00 pipeline with one appended event (the TestStation command) and 0 handler reads', async () => {
    const hub = await open();
    const kds = stationOn(hub, 'S1');
    const counter = statementCounter(hub.deps.db);
    expect((await send(hub, kds, { station_id: 'S1', capacity_override: 2, reason: 'lane_off' }, 'cmd-count')).statusCode).toBe(200);
    const ours = counter.count;
    counter.reset();
    const baseline = await hub.app.inject({
      method: 'POST',
      url: '/commands/test-station',
      headers: { authorization: `Bearer ${kds.device.token}`, 'x-session-token': kds.session.token },
      payload: { command_id: 'cmd-base', tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: 'TestStation', payload: {}, occurred_at: hub.clock.branchNow(), actor_id: null, device_id: kds.device.deviceId },
    });
    expect(baseline.statusCode, baseline.body).toBe(200);
    // 03a §10.5 "commands = 00 pipeline + 0 reads (state in memory)"; AD-34 made this exact. The 16 statements:
    //   4  00 pipeline reads: device token, idempotency fast path, session, idempotency re-check in the tx (D32);
    //   1  the route's beforeSeq MAX(seq) read;
    //   2  the one append in handle: MAX(seq) + INSERT events;
    //   7  projection checkpoint upserts, one per registered projection;
    //   2  the route's event_ids read + INSERT processed_commands.
    // The handler reads nothing (station data from the engine state), and since AD-34 the route's own
    // tx.append([]) after a handler that appended in handle runs no statement, so it equals TestStation.
    expect(ours).toBe(16);
    expect(counter.count).toBe(ours);
  });

  it('[03a #68] station session for another station or with reason manager → 403 outside_scope; nothing written', async () => {
    const hub = await open();
    const kds = stationOn(hub, 'S1');
    const before = counts(hub);
    for (const [id, payload] of [
      ['cmd-other', { station_id: 'S2', capacity_override: 2, reason: 'lane_off' }],
      ['cmd-manager', { station_id: 'S1', capacity_override: 2, reason: 'manager' }],
    ] as const) {
      const response = await send(hub, kds, payload, id);
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', station_id: payload.station_id } });
    }
    expect(counts(hub)).toEqual(before);
  });

  it('[03a #68] station session with capacity_override above the configured capacity → 400 VALIDATION_FAILED { field: capacity_override }; staff may set up to 100', async () => {
    const hub = await open();
    const kds = stationOn(hub, 'S1');
    const before = counts(hub);
    const above = await send(hub, kds, { station_id: 'S1', capacity_override: 5, reason: 'lane_on' }, 'cmd-above');
    expect(above.statusCode, above.body).toBe(400);
    expect(above.json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'capacity_override' } });
    expect(counts(hub)).toEqual(before);
    // Exactly the configured capacity is allowed.
    expect((await send(hub, kds, { station_id: 'S1', capacity_override: 4, reason: 'lane_on' }, 'cmd-at')).statusCode).toBe(200);
    const manager = staffOn(hub, 'S_MGR');
    const hundred = await send(hub, manager, { station_id: 'S1', capacity_override: 100, reason: 'manager' }, 'cmd-100');
    expect(hundred.statusCode, hundred.body).toBe(200);
    expect(hundred.json().data.result).toMatchObject({ station_id: 'S1', effective_capacity: 100, changed: true });
  });
});

const STATION = anEngineConfigApplied().payload.stations as Array<Record<string, unknown>>;

// S1, S2 (capacity 4) and S3 archived; three lines placed on S1 so a lower capacity raises its pressure.
async function open(hooks: { beforeCommit?: () => void } = {}): Promise<TestHub> {
  const hub = await createTestHub({ testHooks: hooks });
  cleanups.push(() => hub.close());
  const directory = await aDirectory();
  directory.roles.push({
    role_id: 'R_LEAD',
    name: 'Kitchen lead',
    session_idle_ttl_ms: 3_600_000,
    permissions: [{ permission: 'manage-stations', grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope: 'my_stations' }],
  });
  const cashier = directory.staff.find((staff) => staff.staff_id === 'S_CASH')!;
  directory.staff.push({ ...cashier, staff_id: 'S_LEAD', display_name: 'Lead', role_ids: ['R_LEAD'] });
  directory.responsibilities = [{ responsibility: 'run_station', station_id: 'S1', staff_ids: ['S_LEAD'], role_ids: [] }] as DirectoryInput['responsibilities'];
  await seedDirectory(hub, directory);
  const config = anEngineConfigApplied({
    payload: {
      stations: [
        STATION[0]!,
        { ...STATION[0]!, station_id: 'S2', name: 'Grill' },
        { ...STATION[0]!, station_id: 'S3', name: 'Old', is_archived: true },
      ],
    },
  });
  append(hub, [config, aBusinessDayOpened(), ...anOrderBatch({ lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2' }, { order_item_id: 'L3' }] })]);
  return hub;
}

function append(hub: TestHub, events: readonly PosEvent[]): void {
  hub.deps.writer.run((tx) => tx.append(events.map(draftOf)));
}

function draftOf(event: PosEvent): EventDraft {
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

function engine(hub: TestHub): EngineState {
  return hub.deps.state.get();
}

function staffOn(hub: TestHub, staffId: string): Client {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { actorId: staffId, device, session };
}

function stationOn(hub: TestHub, stationId: string): Client {
  const device = pairDevice(hub, { type: 'kds', stationId });
  const session = openSession(hub, { kind: 'station', deviceId: device.deviceId, stationId });
  return { actorId: null, device, session };
}

function send(hub: TestHub, client: Client, payload: Record<string, unknown>, commandId: string) {
  return hub.app.inject({
    method: 'POST',
    url: '/commands/set-station-capacity',
    headers: { authorization: `Bearer ${client.device.token}`, 'x-session-token': client.session.token },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'SetStationCapacity',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: client.actorId,
      device_id: client.device.deviceId,
    },
  });
}

function capacityEvents(hub: TestHub): Array<{ event_id: string; stream_type: string; stream_id: string; schema_version: number; actor_id: string | null; device_id: string; payload: unknown }> {
  return (
    hub.deps.db
      .prepare("SELECT event_id, stream_type, stream_id, schema_version, actor_id, device_id, payload FROM events WHERE event_type = 'StationCapacitySet' ORDER BY seq")
      .all() as Array<{ event_id: string; stream_type: string; stream_id: string; schema_version: number; actor_id: string | null; device_id: string; payload: string }>
  ).map((row) => ({ ...row, payload: JSON.parse(row.payload) as unknown }));
}

function counts(hub: TestHub): { events: number; commands: number } {
  return {
    events: hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
    commands: hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get() as number,
  };
}
