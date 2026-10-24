import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, pairDevice, type TestHub } from '../helpers/test-hub';

const cleanups: Array<() => Promise<void>> = [];

describe('station session', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #39] happy path; second call replaces; tablet → 403', async () => {
    const hub = await open();
    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const first = await station(hub, kds.token);
    expect(first.statusCode).toBe(200);
    const firstBody = first.json().data;
    expect(firstBody.station_id).toBe('station-1');
    expect(typeof firstBody.session_token).toBe('string');
    expect(sessionRow(hub, firstBody.session_id)).toEqual({
      device_id: kds.deviceId,
      kind: 'station',
      staff_id: null,
      station_id: 'station-1',
      idle_ttl_ms: null,
      ended_at: null,
    });
    expect(sessionStarted(hub, firstBody.session_id)).toMatchObject({
      kind: 'station',
      staff_id: null,
      station_id: 'station-1',
      device_id: kds.deviceId,
      idle_ttl_ms: null,
    });

    const second = await station(hub, kds.token);
    expect(second.statusCode).toBe(200);
    const secondBody = second.json().data;
    expect(secondBody.session_id).not.toBe(firstBody.session_id);
    expect(secondBody.station_id).toBe('station-1');
    expect(secondBody.session_token).not.toBe(firstBody.session_token);
    expect(sessionEnded(hub, firstBody.session_id)).toMatchObject({
      reason: 'replaced',
      kind: 'station',
      station_id: 'station-1',
      ended_by: null,
    });
    expect(endReason(hub, firstBody.session_id)).toBe('replaced');
    expect(activeStations(hub, kds.deviceId)).toEqual([secondBody.session_id]);

    const tablet = pairDevice(hub, { type: 'tablet' });
    const denied = await station(hub, tablet.token);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('DEVICE_TYPE_NOT_ALLOWED');
    expect(activeStations(hub, kds.deviceId)).toEqual([secondBody.session_id]);
  });
});

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  return hub;
}

function station(hub: TestHub, token: string) {
  return hub.app.inject({
    method: 'POST',
    url: '/auth/station',
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
}

function sessionRow(hub: TestHub, sessionId: string) {
  return hub.deps.db
    .prepare('SELECT device_id, kind, staff_id, station_id, idle_ttl_ms, ended_at FROM staff_sessions WHERE session_id = ?')
    .get(sessionId);
}

function endReason(hub: TestHub, sessionId: string): string | null {
  return hub.deps.db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck().get(sessionId) as string | null;
}

function activeStations(hub: TestHub, deviceId: string): string[] {
  return hub.deps.db
    .prepare(`SELECT session_id FROM staff_sessions WHERE device_id = ? AND kind = 'station' AND ended_at IS NULL`)
    .pluck()
    .all(deviceId) as string[];
}

function payloads(hub: TestHub, eventType: string): Array<Record<string, unknown>> {
  const rows = hub.deps.db.prepare('SELECT payload FROM events WHERE event_type = ?').all(eventType) as Array<{ payload: string }>;
  return rows.map((row) => JSON.parse(row.payload) as Record<string, unknown>);
}

function sessionStarted(hub: TestHub, sessionId: string): Record<string, unknown> | undefined {
  return payloads(hub, 'SessionStarted').find((payload) => payload.session_id === sessionId);
}

function sessionEnded(hub: TestHub, sessionId: string): Record<string, unknown> | undefined {
  return payloads(hub, 'SessionEnded').find((payload) => payload.session_id === sessionId);
}
