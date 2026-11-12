import { StationOutputSet, draftOf, type BranchConfig, type WsStationNotice } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import type { WriterTx } from '../engine-host/writer.js';
import type { HubDeps } from '../server.js';
import { onBranchConfigApplied } from '../sync/branch-config-holder.js';
import { wsHubFor } from '../ws/server.js';
import { stationsWithPrinter } from './api.js';

// 03c config reactions (task P0.22; owner 2026-11-12, "teeno Rec").
//
// ⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-18) 03c §3.2: a config apply that archives a station, or removes it from
// the snapshot, releases its printer in the same apply. The onBranchConfigApplied hook (inside the applying writer.run,
// before COMMIT; total: an odd shape is logged and skipped, never thrown, since a throw fails the whole apply) appends
// one StationOutputSet { mode: 'screen', printer_id: null, show_taker, show_order_id, source: 'config' } per such
// station whose station_outputs row holds a printer. Its pending station jobs then have no printer and stay unsent and
// listed (a station job is sent only to its station's current printer) until a manager cancels them or the station
// is restored with a printer; SavePrinter { archived: true } no longer meets CONFIG_IN_USE for it.
// Statements: 1 (the station_outputs rows holding a printer) + the appends.
//
// ⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-20) 03c §3.8, 03b v1.0.6 §3.10: when a commit's StationOutputSet /
// PrinterSaved changes a station's has_printer, `station_notice { station_id, kind: 'output', has_printer }` goes after
// commit to that station's sockets, so the KDS shows or hides its Reprint action without a refetch. The set of
// printing stations is host memory, read once at server build (after boot's replay) and re-read (1 statement) only
// after a commit that holds one of those two events; every other commit costs 0 statements.

interface OutputRow {
  station_id: string;
  show_taker: number;
  show_order_id: number;
}

/** §3.2 Q-18: the stations of station_outputs rows holding a printer that `next` archives or no longer lists. */
export function releasedOutputs(rows: readonly OutputRow[], next: BranchConfig): OutputRow[] {
  // an odd shape releases nothing (a missing list must not read as "every station removed")
  if (!Array.isArray(next.stations)) return [];
  const stations = new Map<string, boolean>();
  for (const s of next.stations) {
    if (typeof s?.station_id === 'string') stations.set(s.station_id, s.is_archived === true);
  }
  return rows.filter((r) => stations.get(r.station_id) !== false);
}

/** The Q-18 hook body (exported for its own tests). */
export function printConfigHook(app: FastifyInstance, deps: Pick<HubDeps, 'db'>): (prev: BranchConfig | null, next: BranchConfig, tx: WriterTx) => void {
  return (_prev, next, tx) => {
    // The hook list is process-wide: with two hubs in one process (tests only) each acts on its own connection.
    if (tx.db !== deps.db) return;
    try {
      if (!Array.isArray(next.stations)) {
        app.log.error('print.config_hook: stations is not a list, skipped');
        return;
      }
      const rows = tx.db
        .prepare('SELECT station_id, show_taker, show_order_id FROM station_outputs WHERE printer_id IS NOT NULL ORDER BY station_id')
        .all() as OutputRow[];
      const released = releasedOutputs(rows, next);
      if (released.length === 0) return;
      tx.append(
        released.map((r) =>
          draftOf(StationOutputSet, {
            stream_type: 'hub',
            stream_id: tx.branchId,
            payload: { station_id: r.station_id, mode: 'screen', printer_id: null, show_taker: r.show_taker === 1, show_order_id: r.show_order_id === 1, source: 'config' },
            occurred_at: tx.clock.branchNow(),
            actor_id: null,
            device_id: 'hub',
          }),
        ),
      );
    } catch (err) {
      app.log.error({ err }, 'print.config_hook: skipped');
    }
  };
}

const OUTPUT_EVENTS: ReadonlySet<string> = new Set(['StationOutputSet', 'PrinterSaved']);

/** Called once per server from lane C3's register(): the Q-18 hook and the Q-20 output notices; removed on close. */
export function registerPrintConfigHook(app: FastifyInstance, deps: Pick<HubDeps, 'db' | 'writer'>): void {
  const stop = onBranchConfigApplied(printConfigHook(app, deps));
  app.addHook('onClose', async () => stop());

  let printing = stationsWithPrinter(deps.db);
  deps.writer.addAfterCommit((appended) => {
    if (!appended.some((e) => OUTPUT_EVENTS.has(e.event_type))) return;
    try {
      const after = stationsWithPrinter(deps.db);
      const changed = [...new Set([...printing, ...after])].filter((id) => printing.has(id) !== after.has(id)).sort();
      printing = after;
      if (changed.length === 0) return;
      const ws = wsHubFor(app);
      const sessions = ws.connectedSessions();
      for (const station_id of changed) {
        const to = sessions.filter((s) => s.kind === 'station' && s.stationId === station_id).map((s) => s.sessionId);
        if (to.length === 0) continue;
        const frame: WsStationNotice = { type: 'station_notice', station_id, kind: 'output', has_printer: after.has(station_id) };
        ws.sendToSessions(to, frame);
      }
    } catch (err) {
      app.log.error({ err }, 'print.output_notice: skipped');
    }
  });
}
