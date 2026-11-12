import type { LineDetail } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type { EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import type { CommandCtx } from '../commands/registry.js';

// 03b §4.2 (phase 0 P0.11): every export other modules and lanes code against. Each is a typed function that throws
// "not built" until its task provides it with provideKds() from the lane's register file (kds/lanes/<L>.ts); only
// undoReadyForLines (called by b9a's UndoDone before b9b exists) is a no-op until then. Callers import from here,
// never from the lane's own file.

/** §3.6 step 6 (b20): per screen / screenless station, memory only. */
export interface StationPresence {
  screenless: boolean;
  connected: boolean;
  offline_since: number | null;
  dark: boolean;
}

/** §4.2 (b17): a hand-over with unsettled lines, for 02b's `served_estimate` tick (0e). */
export interface HandoverDue {
  handover_id: string;
  order_id: string;
  order_item_ids: string[];
}

/** §3.2 step 5 (b9b): the Ready part of UndoDone, inside the command's transaction. */
export interface UndoReadyResult {
  events: EventDraft[];
  ready_undone: Array<{ order_id: string; point_id: string }>;
}

export interface KdsContracts {
  /** §3.6 (b20); 0 statements. */
  stationPresence(): Map<string, StationPresence>;
  /** §3.1, §4.2 (b11); 2 statements. */
  buildLineDetails(db: Database.Database, state: EngineState, order_item_ids: readonly string[]): Map<string, LineDetail>;
  /** §3.1 (b11); 0 statements. */
  pointOfLine(state: EngineState, order_item_id: string): string | null;
  /** §3.8 (b6); memory map, 0 statements. */
  devicePoint(device_id: string): string | null;
  /** §4.2 (b17); 2 statements, LIMIT 200. */
  handoversDue(db: Database.Database, now: number, older_than_ms: number): HandoverDue[];
  /** §3.2 step 5 (b9b); 1 statement + 01d's close. */
  undoReadyForLines(ctx: CommandCtx, order_item_ids: readonly string[]): UndoReadyResult;
}

const TASK: Record<keyof KdsContracts, string> = {
  stationPresence: 'b20',
  buildLineDetails: 'b11',
  pointOfLine: 'b11',
  devicePoint: 'b6',
  handoversDue: 'b17',
  undoReadyForLines: 'b9b',
};

let built: Partial<KdsContracts> = {};

/** Called by a lane's register file when its task lands (e.g. `provideKds({ buildLineDetails })`). */
export function provideKds(part: Partial<KdsContracts>): void {
  built = { ...built, ...part };
}

function impl<K extends keyof KdsContracts>(name: K): KdsContracts[K] {
  const fn = built[name];
  if (fn === undefined) throw new Error(`03b ${name}: not built (task ${TASK[name]})`);
  return fn;
}

export function stationPresence(): Map<string, StationPresence> {
  return impl('stationPresence')();
}

export function buildLineDetails(db: Database.Database, state: EngineState, order_item_ids: readonly string[]): Map<string, LineDetail> {
  return impl('buildLineDetails')(db, state, order_item_ids);
}

export function pointOfLine(state: EngineState, order_item_id: string): string | null {
  return impl('pointOfLine')(state, order_item_id);
}

export function devicePoint(device_id: string): string | null {
  return impl('devicePoint')(device_id);
}

export function handoversDue(db: Database.Database, now: number, older_than_ms: number): HandoverDue[] {
  return impl('handoversDue')(db, now, older_than_ms);
}

export function undoReadyForLines(ctx: CommandCtx, order_item_ids: readonly string[]): UndoReadyResult {
  const fn = built.undoReadyForLines;
  // No-op until b9b provides the real function. This is NOT "no Ready row can exist yet": lane B4 runs
  // b13 → b14 → b15 → b9b, so MarkReadyToServe (b14) can be merged while b9a's UndoDone still lands here, and
  // until b9b an UndoDone leaves a Ready card standing (03b §3.2 step 5; plan rows b14 / b9b, AD-14).
  if (fn === undefined) return { events: [], ready_undone: [] };
  return fn(ctx, order_item_ids);
}
