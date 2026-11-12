import { stationView, type EngineState } from '@pos/engine';
import type { BranchConfig, WsStationNotice } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import type { WriterTx } from '../engine-host/writer.js';
import { onBranchConfigApplied } from '../sync/branch-config-holder.js';
import { wsHubFor } from '../ws/server.js';
import { devicePoint } from './contracts.js';

// 03b §3.10 (task b23): the archived-station config reaction. An onBranchConfigApplied hook lists the stations archived
// in `next` that still have lines in Now / Next (engine, the transaction's state); after the commit
// `station_notice { station_id, kind: 'archived', open_lines }` goes to that station's sockets and the Pass tablets of
// its point. Total: any unexpected shape is logged and skipped, never thrown (a throw would fail the config apply).
// 0 statements (engine memory, config, socket list).

const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).lines === 'object';

/** §3.10: the stations archived in `config` with lines in Now / Next, and their open line counts (memory). */
export function archivedOpen(state: unknown, config: BranchConfig | null, now: number): Array<{ station_id: string; point_id: string | null; open_lines: number }> {
  if (!isEngineState(state) || config === null || !Array.isArray(config.stations)) return [];
  const out: Array<{ station_id: string; point_id: string | null; open_lines: number }> = [];
  for (const s of config.stations) {
    if (s?.is_archived !== true || typeof s.station_id !== 'string') continue;
    const view = stationView(state, s.station_id, now);
    const open_lines = view.now.length + view.next.length;
    if (open_lines > 0) out.push({ station_id: s.station_id, point_id: typeof s.point_id === 'string' ? s.point_id : null, open_lines });
  }
  return out.sort((a, b) => (a.station_id < b.station_id ? -1 : a.station_id > b.station_id ? 1 : 0));
}

/** The hook (exported for its own tests: the other modules' hooks need a real config). */
export function kdsConfigHook(app: FastifyInstance): (prev: BranchConfig | null, next: BranchConfig, tx: WriterTx) => void {
  return (_prev, next, tx) => {
    try {
      const notices = archivedOpen(tx.state, next, tx.clock.branchNow());
      if (notices.length === 0) return;
      tx.onCommit(() => {
        try {
          const ws = wsHubFor(app);
          const sessions = ws.connectedSessions();
          for (const n of notices) {
            const to = sessions
              .filter((s) => (s.kind === 'station' && s.stationId === n.station_id) || (s.kind === 'staff' && n.point_id !== null && devicePoint(s.deviceId) === n.point_id))
              .map((s) => s.sessionId);
            if (to.length === 0) continue;
            const frame: WsStationNotice = { type: 'station_notice', station_id: n.station_id, kind: 'archived', open_lines: n.open_lines };
            ws.sendToSessions(to, frame);
          }
        } catch (err) {
          app.log.error({ err }, 'kds.config_hook: notice skipped');
        }
      });
    } catch (err) {
      app.log.error({ err }, 'kds.config_hook: skipped');
    }
  };
}

/** Called once per server from lane B6's register(); removed on close. */
export function registerKdsConfigHook(app: FastifyInstance): void {
  const stop = onBranchConfigApplied(kdsConfigHook(app));
  app.addHook('onClose', async () => stop());
}
