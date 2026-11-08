import type { EngineState } from '@pos/engine';
import type { DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayOpened, anEngineConfigApplied } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

type Client = { actorId: string | null; device: { deviceId: string; token: string }; session: { sessionId: string; token: string } };

const cleanups: Array<() => Promise<void>> = [];

// 03a §6.7, §10.2 #69: SetStationPause from a staff session only (manage-stations); 409 STATION_PAUSE_DISABLED
// before the scope check (C8); unpausing is always allowed.
describe('POST /commands/set-station-pause (03a §6.7)', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[03a #69] happy: a manager pauses S1 → one StationPauseSet { paused true }, the live state is paused, the body is { station_id, paused, changed: true }', async () => {
    const hub = await open();
    const manager = staffOn(hub, 'S_MGR');
    const before = engine(hub);
    const response = await send(hub, manager, { station_id: 'S1', paused: true }, 'cmd-happy');
    expect(response.statusCode, response.body).toBe(200);
    const events = pauseEvents(hub);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stream_type: 'station',
      stream_id: 'S1',
      schema_version: 1,
      actor_id: 'S_MGR',
      device_id: manager.device.deviceId,
      payload: { station_id: 'S1', paused: true },
    });
    const after = engine(hub);
    expect(after).not.toBe(before);
    expect(after.stations.S1!.paused).toBe(true);
    expect(response.json().data.result).toEqual({ station_id: 'S1', paused: true, changed: true });
    expect(response.json().data.event_ids).toEqual([events[0]!.event_id]);
  });

  it('[03a #69] 400: a missing or non-boolean paused, a missing station_id → VALIDATION_FAILED, nothing written', async () => {
    const hub = await open();
    const manager = staffOn(hub, 'S_MGR');
    const before = counts(hub);
    for (const [i, payload] of [{ station_id: 'S1' }, { station_id: 'S1', paused: 'yes' }, { station_id: 'S1', paused: 1 }, { paused: true }].entries()) {
      const response = await send(hub, manager, payload, `cmd-bad-${i}`);
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
    expect(counts(hub)).toEqual(before);
  });

  it('[03a #69] 404 STATION_NOT_FOUND: an unknown station and an archived one; nothing written', async () => {
    const hub = await open();
    const manager = staffOn(hub, 'S_MGR');
    const before = counts(hub);
    for (const stationId of ['S9', 'S3']) {
      const response = await send(hub, manager, { station_id: stationId, paused: true }, `cmd-404-${stationId}`);
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error).toMatchObject({ code: 'STATION_NOT_FOUND', details: { station_id: stationId } });
    }
    expect(counts(hub)).toEqual(before);
  });

  it('[03a #69] 409 STATION_PAUSE_DISABLED before 403 outside_scope (C8): pausing S4 (pause_enabled false) is 409 for the manager and for a lead outside its scope', async () => {
    const hub = await open();
    const manager = staffOn(hub, 'S_MGR');
    const lead = staffOn(hub, 'S_LEAD');
    const before = counts(hub);
    for (const [id, client] of [
      ['cmd-409-mgr', manager],
      ['cmd-409-lead', lead],
    ] as const) {
      const response = await send(hub, client, { station_id: 'S4', paused: true }, id);
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toMatchObject({ code: 'STATION_PAUSE_DISABLED', details: { station_id: 'S4' } });
    }
    expect(counts(hub)).toEqual(before);
    expect(engine(hub).stations.S4!.paused).toBe(false);
  });

  it('[03a #69] 403 outside_scope: manage-stations my_stations allows only the run_station stations, checked after the 404 and the 409; scope branch allows every station', async () => {
    const hub = await open();
    const lead = staffOn(hub, 'S_LEAD');
    const before = counts(hub);
    const outside = await send(hub, lead, { station_id: 'S2', paused: true }, 'cmd-out');
    expect(outside.statusCode, outside.body).toBe(403);
    expect(outside.json().error).toMatchObject({
      code: 'PERMISSION_DENIED',
      details: { permission: 'manage-stations', reason: 'outside_scope', station_id: 'S2' },
    });
    // An unpause outside the scope is 403 too (unpausing skips only the 409).
    const unpause = await send(hub, lead, { station_id: 'S4', paused: false }, 'cmd-out-unpause');
    expect(unpause.statusCode, unpause.body).toBe(403);
    expect(unpause.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', station_id: 'S4' } });
    expect((await send(hub, lead, { station_id: 'S9', paused: true }, 'cmd-out-404')).statusCode).toBe(404);
    expect(counts(hub)).toEqual(before);
    const inside = await send(hub, lead, { station_id: 'S1', paused: true }, 'cmd-in');
    expect(inside.statusCode, inside.body).toBe(200);
    expect(inside.json().data.result).toEqual({ station_id: 'S1', paused: true, changed: true });
    const manager = staffOn(hub, 'S_MGR');
    expect((await send(hub, manager, { station_id: 'S2', paused: true }, 'cmd-branch')).statusCode).toBe(200);
  });

  it('[03a #69] 403: a staff session whose roles lack manage-stations (the cashier) → PERMISSION_DENIED { permission: manage-stations }; nothing written', async () => {
    const hub = await open();
    const cashier = staffOn(hub, 'S_CASH');
    const before = counts(hub);
    const response = await send(hub, cashier, { station_id: 'S1', paused: true }, 'cmd-cashier');
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'manage-stations' } });
    expect(response.json().error.details.reason).not.toBe('outside_scope');
    expect(counts(hub)).toEqual(before);
    expect(engine(hub).stations.S1!.paused).toBe(false);
  });

  it('[03a #69] a station session (KDS) → 403 PERMISSION_DENIED from the framework (stationScoped false), even for its own station; nothing written', async () => {
    const hub = await open();
    const kds = stationOn(hub, 'S1');
    const before = counts(hub);
    const response = await send(hub, kds, { station_id: 'S1', paused: true }, 'cmd-kds');
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json().error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'manage-stations', session_kind: 'station' } });
    expect(counts(hub)).toEqual(before);
    expect(engine(hub).stations.S1!.paused).toBe(false);
  });

  it('[03a #69] unpause always: S4 paused with pause_enabled false → paused false is 200 changed true; again is the no-op', async () => {
    const hub = await open();
    // S4 got paused while pausing was allowed; its config now says pause_enabled false.
    append(hub, [pauseEvent('S4', true)]);
    expect(engine(hub).stations.S4!.paused).toBe(true);
    const manager = staffOn(hub, 'S_MGR');
    const response = await send(hub, manager, { station_id: 'S4', paused: false }, 'cmd-unpause');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.result).toEqual({ station_id: 'S4', paused: false, changed: true });
    expect(engine(hub).stations.S4!.paused).toBe(false);
    expect(pauseEvents(hub).at(-1)).toMatchObject({ actor_id: 'S_MGR', payload: { station_id: 'S4', paused: false } });
    const again = await send(hub, manager, { station_id: 'S4', paused: false }, 'cmd-unpause-again');
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().data.result).toEqual({ station_id: 'S4', paused: false, changed: false });
  });

  it('[03a #69] no-op: the same value again → no event, 200 with the same shape and changed false', async () => {
    const hub = await open();
    const manager = staffOn(hub, 'S_MGR');
    expect((await send(hub, manager, { station_id: 'S1', paused: true }, 'cmd-first')).statusCode).toBe(200);
    const before = pauseEvents(hub).length;
    const state = engine(hub);
    const again = await send(hub, manager, { station_id: 'S1', paused: true }, 'cmd-same');
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().data.result).toEqual({ station_id: 'S1', paused: true, changed: false });
    expect(again.json().data.event_ids).toEqual([]);
    expect(pauseEvents(hub)).toHaveLength(before);
    expect(engine(hub)).toBe(state);
    // Unpausing a station that is not paused is a no-op too.
    const unset = await send(hub, manager, { station_id: 'S2', paused: false }, 'cmd-unpaused');
    expect(unset.json().data.result).toEqual({ station_id: 'S2', paused: false, changed: false });
    expect(pauseEvents(hub)).toHaveLength(before);
  });

  it('[03a #69] retransmit (D32): the same command_id → the stored response, Idempotent-Replay, one event', async () => {
    const hub = await open();
    const manager = staffOn(hub, 'S_MGR');
    const first = await send(hub, manager, { station_id: 'S1', paused: true }, 'cmd-retx');
    expect(first.statusCode).toBe(200);
    hub.clock.set(hub.clock.branchNow() + 60_000);
    const second = await send(hub, manager, { station_id: 'S1', paused: true }, 'cmd-retx');
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(pauseEvents(hub)).toHaveLength(1);
  });

  it('[03a #69] COMMIT failure (D45): a throw before COMMIT leaves the live state, the log and the published frames untouched', async () => {
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
    const response = await send(hub, manager, { station_id: 'S1', paused: true }, 'cmd-fail');
    expect(response.statusCode).toBe(500);
    expect(engine(hub)).toBe(state);
    expect(engine(hub).stations.S1!.paused).toBe(false);
    expect(hub.published.length).toBe(published);
    expect(counts(hub)).toEqual(before);
  });

  it('[03a §10.5] statements: a pause costs exactly the pipeline of a staff command with one event (TestNoop); the handler reads nothing', async () => {
    const hub = await open();
    const manager = staffOn(hub, 'S_MGR');
    const counter = statementCounter(hub.deps.db);
    expect((await send(hub, manager, { station_id: 'S1', paused: true }, 'cmd-count')).statusCode).toBe(200);
    const ours = counter.count;
    counter.reset();
    // S_MGR holds reprint-ticket (fixture R_MGR); TestNoop returns one draft through events, as this command does.
    const baseline = await hub.app.inject({
      method: 'POST',
      url: '/commands/test-noop',
      headers: { authorization: `Bearer ${manager.device.token}`, 'x-session-token': manager.session.token },
      payload: { command_id: 'cmd-base', tenant_id: 'tenant-a', branch_id: 'branch-1', command_type: 'TestNoop', payload: {}, occurred_at: hub.clock.branchNow(), actor_id: 'S_MGR', device_id: manager.device.deviceId },
    });
    expect(baseline.statusCode, baseline.body).toBe(200);
    expect(ours).toBe(counter.count);
  });
});

const STATION = anEngineConfigApplied().payload.stations as Array<Record<string, unknown>>;

// S1, S2 (pause_enabled true), S3 archived, S4 (pause_enabled false). S_LEAD runs S1 under manage-stations my_stations.
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
        { ...STATION[0]!, pause_enabled: true },
        { ...STATION[0]!, station_id: 'S2', name: 'Grill', pause_enabled: true },
        { ...STATION[0]!, station_id: 'S3', name: 'Old', pause_enabled: true, is_archived: true },
        { ...STATION[0]!, station_id: 'S4', name: 'Fryer', pause_enabled: false },
      ],
    },
  });
  append(hub, [config, aBusinessDayOpened()]);
  return hub;
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

function pauseEvent(stationId: string, paused: boolean): EventDraft {
  return {
    stream_type: 'station',
    stream_id: stationId,
    event_type: 'StationPauseSet',
    schema_version: 1,
    payload: { station_id: stationId, paused },
    occurred_at: 0,
    actor_id: 'S_MGR',
    device_id: 'D_SEED',
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
    url: '/commands/set-station-pause',
    headers: { authorization: `Bearer ${client.device.token}`, 'x-session-token': client.session.token },
    payload: {
      command_id: commandId,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'SetStationPause',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: client.actorId,
      device_id: client.device.deviceId,
    },
  });
}

function pauseEvents(hub: TestHub): Array<{ event_id: string; stream_type: string; stream_id: string; schema_version: number; actor_id: string | null; device_id: string; payload: unknown }> {
  return (
    hub.deps.db
      .prepare("SELECT event_id, stream_type, stream_id, schema_version, actor_id, device_id, payload FROM events WHERE event_type = 'StationPauseSet' ORDER BY seq")
      .all() as Array<{ event_id: string; stream_type: string; stream_id: string; schema_version: number; actor_id: string | null; device_id: string; payload: string }>
  ).map((row) => ({ ...row, payload: JSON.parse(row.payload) as unknown }));
}

function counts(hub: TestHub): { events: number; commands: number } {
  return {
    events: hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number,
    commands: hub.deps.db.prepare('SELECT COUNT(*) FROM processed_commands').pluck().get() as number,
  };
}
