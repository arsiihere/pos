import type Database from 'better-sqlite3';
import type { Writer } from '../engine-host/writer.js';
import { stationPresence, type StationPresence } from '../kds/contracts.js';

// 03c §5 (task c22; G-8): retention at 00's maintenance hour, called from the sweeper's purge() after 01d's
// purgeAlerts. Rows older than 7 days, in batches of 500 (one writer.run each, so the hub never waits on a long delete):
// 1. Tickets, ticket-wise: a ticket fired before the cutoff whose every job is done before the cutoff (acked with no
//    unresolved suspect, or cancelled) goes with all its jobs and its ticket_lines in one batch — never a ticket
//    without its jobs or jobs without their ticket, so the `:kitchen:n` re-create rule and the cancel slips' earlier
//    units stay right. A pending job or an unresolved suspect keeps the whole ticket.
// 2. Jobs with no ticket (document, coming_up, test) done before the cutoff.
// 3. print_fold_skips before the cutoff that were alerted (resolved), and unalerted ones older than 30 days.
// Stations in their current dark outage (03b's stationPresence(), memory) keep their tickets and station jobs, so the
// fallback never prints a second COMING UP or a ticket again mid-outage. Print tables are hub-local (no branch_id).
// Returns the rows deleted.

export const PRINT_RETENTION_MS = 7 * 86_400_000;
/** integrator reading (c22 review): an unalerted skip is dropped after 30 days */
export const UNALERTED_SKIP_RETENTION_MS = 30 * 86_400_000;
const BATCH = 500;

export interface PrintRetentionDeps {
  db: Database.Database;
  writer: Writer;
  /** 03b's view; defaults to the stationPresence() contract (b20) */
  presence?: () => ReadonlyMap<string, StationPresence>;
}

/** a job done before the cutoff (alias j) */
const DONE_JOB = `((j.acked_at IS NOT NULL AND j.acked_at < @cutoff AND (j.suspect_at IS NULL OR j.suspect_resolved_at IS NOT NULL))
   OR (j.cancelled_at IS NOT NULL AND j.cancelled_at < @cutoff))`;
const OLD_TICKETS = `SELECT t.ticket_id FROM tickets t
  WHERE t.fired_at < @cutoff AND t.station_id NOT IN (SELECT value FROM json_each(@dark))
    AND NOT EXISTS (SELECT 1 FROM print_jobs j WHERE j.ticket_id = t.ticket_id AND NOT ${DONE_JOB})`;
const OLD_LOOSE_JOBS = `SELECT j.job_id FROM print_jobs j
  WHERE j.ticket_id IS NULL AND ${DONE_JOB}
    AND (j.station_id IS NULL OR j.station_id NOT IN (SELECT value FROM json_each(@dark)))`;
const OLD_SKIPS = `SELECT event_id FROM print_fold_skips
  WHERE (alerted_at IS NOT NULL AND at < @cutoff) OR at < @skip_cutoff`;

function darkStations(presence: () => ReadonlyMap<string, StationPresence>): string[] {
  try {
    return [...presence()].filter(([, p]) => p.dark).map(([id]) => id);
  } catch {
    return []; // 03b's presence not built / not bound: no station is in an outage
  }
}

export function purgePrint(deps: PrintRetentionDeps, branchId: string, now: number): number {
  void branchId; // hub-local tables
  const args = {
    cutoff: now - PRINT_RETENTION_MS,
    skip_cutoff: now - UNALERTED_SKIP_RETENTION_MS,
    dark: JSON.stringify(darkStations(deps.presence ?? stationPresence)),
  };
  const ticketArgs = { cutoff: args.cutoff, dark: args.dark };
  const skipArgs = { cutoff: args.cutoff, skip_cutoff: args.skip_cutoff };
  let deleted = 0;
  const steps: Array<{ probe: string; probeArgs: Record<string, unknown>; run: (db: Database.Database) => number }> = [
    {
      probe: `${OLD_TICKETS} LIMIT 1`,
      probeArgs: ticketArgs,
      run: (db) => {
        const ids = JSON.stringify(db.prepare(`${OLD_TICKETS} LIMIT ${BATCH}`).pluck().all(ticketArgs));
        return (
          db.prepare('DELETE FROM print_jobs WHERE ticket_id IN (SELECT value FROM json_each(?))').run(ids).changes +
          db.prepare('DELETE FROM ticket_lines WHERE ticket_id IN (SELECT value FROM json_each(?))').run(ids).changes +
          db.prepare('DELETE FROM tickets WHERE ticket_id IN (SELECT value FROM json_each(?))').run(ids).changes
        );
      },
    },
    {
      probe: `${OLD_LOOSE_JOBS} LIMIT 1`,
      probeArgs: ticketArgs,
      run: (db) => db.prepare(`DELETE FROM print_jobs WHERE job_id IN (${OLD_LOOSE_JOBS} LIMIT ${BATCH})`).run(ticketArgs).changes,
    },
    {
      probe: `${OLD_SKIPS} LIMIT 1`,
      probeArgs: skipArgs,
      run: (db) => db.prepare(`DELETE FROM print_fold_skips WHERE event_id IN (${OLD_SKIPS} LIMIT ${BATCH})`).run(skipArgs).changes,
    },
  ];
  for (const step of steps) {
    while (deps.db.prepare(step.probe).get(step.probeArgs) !== undefined) {
      const n = deps.writer.run((tx) => step.run(tx.db)).result;
      deleted += n;
      if (n === 0) break; // never spin
    }
  }
  return deleted;
}
