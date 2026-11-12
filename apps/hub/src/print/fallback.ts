import { stationView, type EngineState } from '@pos/engine';
import type Database from 'better-sqlite3';
import type { StateHolder } from '../engine-host/state-holder.js';
import { stationPresence, type StationPresence } from '../kds/contracts.js';

// 03c §3.4, P4 (task c17): paper fallback for a dark screen, run from the print worker's loop (`pass` hook, every
// 1 s, started after listen). Outside every writer transaction: its inserts are plain statements between transactions.
// 1. The stations 03b's stationPresence() marks `dark` (memory; a screen station with no screen for kds_offline_ms
//    and lines in Now / Next; screenless stations are never dark). Their output must be `screen` with an active
//    printer — checked inside the one statement, so a dark station without one inserts nothing.
// 2. While dark, each pass, 1 statement per dark station: every ticket of the station holding a line in
//    stationView(...).now with no live kitchen job (an uncancelled `kitchen` job) → a kitchen job, INSERT OR IGNORE,
//    id `ticket_id:kitchen` or, after a cancelled one, `ticket_id:kitchen:n` (§3.3 re-create rule, n = max suffix + 1;
//    after an `empty` / `render_failed` cancel only once the order changed again; the unique index on
//    live kitchen jobs keeps at-fire and fallback from ever doubling); and in the same statement the outage's one
//    `coming_up` job, `station_id:coming_up:offline_since` (OR IGNORE: only the first pass of an outage adds it),
//    rendered at send from stationPlan; owner ruling C4-1: none when that station printed one in the last 5 minutes.
// 3. Screen back (dark false): nothing more is inserted; nothing printed is cancelled.
// 4. `both` / `printer` stations print at fire (c7); a `screen` station without a printer relies on 03b's takeover.
// Idle (no dark station): 0 statements. Logs `print.fallback.start` / `.jobs` / `.end`, ids and counts only.

export interface PaperFallbackLog {
  info?(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface PaperFallbackOptions {
  db: Database.Database;
  state: StateHolder<EngineState> | { get(): unknown };
  /** 03b's view; defaults to the stationPresence() contract (b20) */
  presence?: () => ReadonlyMap<string, StationPresence>;
  log?: PaperFallbackLog;
}

export interface PaperFallback {
  /** one fallback pass at `now` (the worker's `pass` hook) */
  pass(now: number): void;
  /** stations this fallback printed for in the current outage (memory; for logs and tests) */
  active(): ReadonlySet<string>;
}

const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).lines === 'object';

// The one statement per dark station. The outer WHERE is step 1's output check (`screen` + an active printer).
// Kitchen rows: the station's tickets holding a Now line, with no uncancelled kitchen job. The new id takes
// n = MAX(existing kitchen suffix) + 1 (`ticket_id:kitchen` is 1), so a deleted or out-of-order row never makes it
// collide. A ticket whose latest kitchen job was cancelled `empty` / `render_failed` is re-created only when its order
// changed since (an event on the order stream at or after that cancel, e.g. UndoDone): one retry per change, never a
// row per loop. COMING UP (C4-1): none when the station had one in the last 5 minutes (a PK range scan on its
// `station:coming_up:` ids). The coming_up id casts offline_since (a JS number binds as REAL: '…000.0'). It sorts after the
// tickets of the same pass (created_at + 1) so COMING UP prints last.
/** Owner ruling C4-1: at most one COMING UP per station per 5 minutes (a KDS that keeps dropping prints one). */
export const COMING_UP_GAP_MS = 300_000;
const SUFFIX = `CASE WHEN e.job_id = t.ticket_id || ':kitchen' THEN 1 ELSE CAST(substr(e.job_id, length(t.ticket_id) + 10) AS INTEGER) END`;
const FALLBACK_SQL = `
INSERT OR IGNORE INTO print_jobs (job_id, kind, printer_id, station_id, ticket_id, order_id, payload, created_at)
SELECT job_id, kind, NULL, @station_id, ticket_id, order_id, payload, created_at FROM (
  SELECT CASE WHEN x.n = 0 THEN x.ticket_id || ':kitchen' ELSE x.ticket_id || ':kitchen:' || (x.n + 1) END AS job_id,
         'kitchen' AS kind, x.ticket_id AS ticket_id, x.order_id AS order_id,
         json_object('ticket_id', x.ticket_id) AS payload, @now AS created_at
    FROM (SELECT t.ticket_id, t.order_id,
                 (SELECT COALESCE(MAX(${SUFFIX}), 0) FROM print_jobs e WHERE e.ticket_id = t.ticket_id AND e.kind = 'kitchen') AS n,
                 (SELECT CASE WHEN e.last_error IN ('empty', 'render_failed') THEN e.cancelled_at END
                    FROM print_jobs e WHERE e.ticket_id = t.ticket_id AND e.kind = 'kitchen'
                   ORDER BY ${SUFFIX} DESC LIMIT 1) AS held_at
            FROM tickets t
           WHERE t.ticket_id IN (SELECT tl.ticket_id FROM json_each(@now_ids) j
                                   JOIN ticket_lines tl ON tl.order_item_id = j.value AND tl.station_id = @station_id)
             AND NOT EXISTS (SELECT 1 FROM print_jobs k
                              WHERE k.ticket_id = t.ticket_id AND k.kind = 'kitchen' AND k.cancelled_at IS NULL)) x
   WHERE x.held_at IS NULL
      OR x.held_at <= (SELECT ev.recorded_at FROM events ev WHERE ev.stream_type = 'order' AND ev.stream_id = x.order_id
                        ORDER BY ev.seq DESC LIMIT 1)
  UNION ALL
  SELECT @station_id || ':coming_up:' || CAST(@offline_since AS INTEGER), 'coming_up', NULL, NULL,
         json_object('station_id', @station_id), @now + 1
   WHERE @offline_since IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM print_jobs c
                      WHERE c.job_id >= @station_id || ':coming_up:' AND c.job_id < @station_id || ':coming_up;'
                        AND c.kind = 'coming_up' AND c.created_at > @now + 1 - ${COMING_UP_GAP_MS})
)
WHERE EXISTS (SELECT 1 FROM station_outputs so JOIN printers p ON p.printer_id = so.printer_id AND p.archived_at IS NULL
               WHERE so.station_id = @station_id AND so.mode = 'screen')
RETURNING job_id, kind`;

export function createPaperFallback(o: PaperFallbackOptions): PaperFallback {
  const presence = o.presence ?? stationPresence;
  /** stations dark at the last pass that got paper (start logged) */
  const active = new Set<string>();

  const info = (obj: Record<string, unknown>, msg: string): void => {
    try {
      o.log?.info?.(obj, msg);
    } catch {
      // a broken logger never stops the fallback
    }
  };
  const error = (obj: Record<string, unknown>, msg: string): void => {
    try {
      o.log?.error(obj, msg);
    } catch {
      // as above
    }
  };

  const pass = (now: number): void => {
    let view: ReadonlyMap<string, StationPresence>;
    try {
      view = presence();
    } catch (err) {
      // 03b's presence not built / not bound: no station is dark for us
      error({ err: (err as Error).message }, 'print.fallback.presence_failed');
      return;
    }
    const dark = new Map<string, number | null>();
    for (const [station_id, p] of view) if (p.dark && !p.screenless) dark.set(station_id, p.offline_since);
    // step 3: screen back → stop (nothing cancelled)
    for (const station_id of [...active]) {
      if (!dark.has(station_id)) {
        active.delete(station_id);
        info({ station_id }, 'print.fallback.end');
      }
    }
    if (dark.size === 0) return;
    const state = o.state.get();
    if (!isEngineState(state)) return;
    for (const [station_id, offline_since] of [...dark].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      try {
        const now_ids = stationView(state, station_id, now).now.map((l) => l.order_item_id);
        const rows = o.db
          .prepare(FALLBACK_SQL)
          .all({ station_id, now, now_ids: JSON.stringify(now_ids), offline_since }) as Array<{ job_id: string; kind: string }>;
        const kitchen = rows.filter((r) => r.kind === 'kitchen');
        // a re-created job (`:kitchen:n`) is logged once, when it is made (one per line change, see FALLBACK_SQL)
        for (const r of kitchen) if (r.job_id.includes(':kitchen:')) info({ station_id, job_id: r.job_id }, 'print.fallback.recreated');
        if (rows.some((r) => r.kind === 'coming_up') && !active.has(station_id)) {
          active.add(station_id);
          info({ station_id, offline_since }, 'print.fallback.start');
        }
        if (kitchen.length > 0) {
          active.add(station_id);
          info({ station_id, jobs: kitchen.length }, 'print.fallback.jobs');
        }
      } catch (err) {
        // one station's failure never stops the others or the worker
        error({ station_id, err: (err as Error).message }, 'print.fallback.failed');
      }
    }
  };

  return { pass, active: () => active };
}
