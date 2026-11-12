import { stationView, type EngineState } from '@pos/engine';
import type { WsPrintedLines } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { devicePoint } from '../kds/contracts.js';
import type { SentJob } from '../print/worker.js';
import type { HubDeps } from '../server.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { registerCatchUp, type CatchUpPart, type SocketCtx } from './catch-up.js';
import { wsHubFor, type WsHub } from './server.js';

// 03c §3.8, §6.9 (task c21): the `printed` tag data for 03b's screens.
// - Catch-up part `kds_printed` `{ order_item_ids }`: station sockets → their station; Pass sockets (staff sockets on a
//   device with a point, devicePoint) → their point's stations (branchConfig().stations[].point_id). The ids are every
//   line of each printed ticket (§3.1: an uncancelled kitchen / reprint job with sent_at set) that still has a line in
//   Now (stationView, memory) — done lines included, so a reconnecting Pass keeps their tag. 1 statement.
// - Frame `printed_lines { station_id, order_item_ids }` after each ack of a `kitchen` / `reprint` job: the ticket's
//   lines (1 statement), to the station's sockets and the Pass sockets of the station's point. Sent from the print
//   worker's `acked` hook (printedLinesAcked(db)), outside every transaction; a failed send is logged, never thrown.

const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).lines === 'object';

const PRINTED_NOW_SQL = `
SELECT all_l.order_item_id FROM ticket_lines all_l
 WHERE all_l.ticket_id IN (
   SELECT tl.ticket_id FROM json_each(?) j JOIN ticket_lines tl ON tl.order_item_id = j.value
    WHERE EXISTS (SELECT 1 FROM print_jobs p WHERE p.ticket_id = tl.ticket_id AND p.kind IN ('kitchen', 'reprint')
                     AND p.cancelled_at IS NULL AND p.sent_at IS NOT NULL))
 ORDER BY all_l.ticket_id, all_l.order_item_id`;

const TICKET_LINES_SQL = 'SELECT station_id, order_item_id FROM ticket_lines WHERE ticket_id = ? ORDER BY order_item_id';

const pointOfStation = (station_id: string): string | null => branchConfig()?.stations.find((s) => s.station_id === station_id)?.point_id ?? null;

const passPoint = (socket: Pick<SocketCtx, 'kind' | 'deviceId'>): string | null => {
  if (socket.kind !== 'staff') return null;
  try {
    return devicePoint(socket.deviceId);
  } catch {
    return null; // 03b's device map not built: not a Pass socket for us
  }
};

/** The stations a socket's `printed` tags cover (memory). */
function stationsOf(socket: SocketCtx): string[] {
  if (socket.kind === 'station') return socket.stationId === null ? [] : [socket.stationId];
  const point_id = passPoint(socket);
  if (point_id === null) return [];
  return (branchConfig()?.stations ?? []).filter((s) => s.point_id === point_id).map((s) => s.station_id).sort();
}

/** §3.8 `kds_printed` body: every line of the printed tickets with a Now line at `station_ids`; 1 statement (0 when nothing is in Now). */
export function printedNowIds(db: Database.Database, state: EngineState, station_ids: readonly string[], now: number): string[] {
  const ids = station_ids.flatMap((id) => stationView(state, id, now).now.map((l) => l.order_item_id));
  if (ids.length === 0) return [];
  return db.prepare(PRINTED_NOW_SQL).pluck().all(JSON.stringify(ids)) as string[];
}

export function printedPart(deps: Pick<HubDeps, 'clock'>): CatchUpPart {
  return {
    part: 'kds_printed',
    appliesTo: (socket) => (socket.kind === 'station' && socket.stationId !== null) || passPoint(socket) !== null,
    build: (db, raw, socket) => {
      if (!isEngineState(raw)) return null;
      return { order_item_ids: printedNowIds(db, raw, stationsOf(socket), deps.clock.branchNow()) };
    },
  };
}

interface PrintedHost {
  db: Database.Database;
  ws: () => WsHub;
  log: { error(obj: Record<string, unknown>, msg: string): void } | null;
}

const hosts = new WeakMap<Database.Database, PrintedHost>();

/** §3.8 frame: after an ack of a kitchen / reprint job, `printed_lines` to the station's and its point's sockets. */
function sendPrinted(host: PrintedHost, job: Pick<SentJob, 'kind' | 'ticket_id'>): void {
  if ((job.kind !== 'kitchen' && job.kind !== 'reprint') || job.ticket_id === null) return;
  const rows = host.db.prepare(TICKET_LINES_SQL).all(job.ticket_id) as Array<{ station_id: string; order_item_id: string }>;
  if (rows.length === 0) return;
  const station_id = rows[0]!.station_id;
  const point_id = pointOfStation(station_id);
  const ws = host.ws();
  const sessions = ws
    .connectedSessions()
    .filter((s) => (s.kind === 'station' && s.stationId === station_id) || (point_id !== null && passPoint(s) === point_id))
    .map((s) => s.sessionId);
  if (sessions.length === 0) return;
  const frame: WsPrintedLines = { type: 'printed_lines', station_id, order_item_ids: rows.map((r) => r.order_item_id) };
  ws.sendToSessions(sessions, frame);
}

/** The print worker's `acked` hook for this hub db (no-op when the server did not register c21). */
export function printedLinesAcked(db: Database.Database): (job: SentJob, at: number) => void {
  return (job) => {
    const host = hosts.get(db);
    if (host === undefined) return;
    try {
      sendPrinted(host, job);
    } catch (err) {
      host.log?.error({ job_id: (job as Partial<SentJob>).job_id ?? null, err: (err as Error).message }, 'print.printed_lines_failed');
    }
  };
}

/** Called once per server from lane C4's register(): the catch-up part (removed on close) and the frame host. */
export function registerPrintCatchUp(app: FastifyInstance, deps: Pick<HubDeps, 'db' | 'clock'>): void {
  const stop = registerCatchUp(printedPart(deps));
  app.addHook('onClose', async () => stop());
  hosts.set(deps.db, { db: deps.db, ws: () => wsHubFor(app), log: app.log });
}
