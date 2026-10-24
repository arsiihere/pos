/// <reference types="node" />
import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import type { HubDeps } from '../server.js';
import { activeSessionsOf, activity, createSession, endSession } from './session-store.js';

export function registerStationSessionRoutes(app: FastifyInstance, deps: HubDeps): void {
  app.post('/auth/station', { config: { group: 'device' } }, async (request) => {
    const device = request.device;
    if (device === undefined) throw new DomainError('DEVICE_TOKEN_INVALID');
    if (device.device_type !== 'kds' || device.station_id === null) throw new DomainError('DEVICE_TYPE_NOT_ALLOWED');
    const stationId = device.station_id;
    const outcome = deps.writer.run((tx) => {
      for (const session of activeSessionsOf(tx.db, { deviceId: device.device_id, kind: 'station' })) {
        endSession(tx, session, 'replaced', null, null, device.device_id);
      }
      const created = createSession(tx, {
        kind: 'station',
        staffId: null,
        stationId,
        deviceId: device.device_id,
        idleTtlMs: null,
        eventDeviceId: device.device_id,
      });
      return { session_token: created.token, session_id: created.sessionId, station_id: stationId };
    }).result;
    activity.touch(outcome.session_id, deps.clock.branchNow());
    return { data: outcome };
  });
}
