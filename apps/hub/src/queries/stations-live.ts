import { stationsLive, type EngineState, type StationLive } from '@pos/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Writer } from '../engine-host/writer.js';
import { defineQuery, queryRegistry } from './registry.js';

export const STATION_IDS_MAX = 50;

export interface StationsLiveResponse {
  as_of_seq: number;
  now_ms: number;
  stations: StationLive[];
}

// 03a §6.5 body: the engine's stationsLive stamped with the seq the state is at. Shared with the stations_live
// catch-up part (§6.4). In memory: 0 statements.
export function stationsLiveBody(
  state: Readonly<EngineState>,
  now: number,
  asOfSeq: number,
  stationIds?: string[],
): StationsLiveResponse {
  const body = stationsLive(state as EngineState, now, stationIds);
  return { as_of_seq: asOfSeq, now_ms: body.now_ms, stations: body.stations };
}

// Repeated keys (`station_ids=A&station_ids=B`, Fastify's query parser); one key arrives as a string.
const StationIds = z.union([z.string().transform((id) => [id]), z.array(z.string()).max(STATION_IDS_MAX)]);

// §6.5: staff and station sessions; not activity; unknown ids are left out (a read).
export function registerStationsLiveQuery(app: FastifyInstance, writer: Pick<Writer, 'lastSeq'>): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'stations-live',
      sessionKind: 'device',
      session: 'required',
      allowStation: true,
      countsAsActivity: false,
      querySchema: z.object({ station_ids: StationIds.optional() }),
      handle(ctx, q) {
        // The state and lastSeq are read in one synchronous step: no commit runs between them.
        return { data: stationsLiveBody(ctx.state, ctx.now, writer.lastSeq(), q.station_ids) };
      },
    }),
  );
}
