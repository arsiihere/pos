import { applyEvent, applyEvents, ENGINE_REPLAY_EVENTS, type Diagnostic, type EngineState } from '@pos/engine';
import type { PosEvent } from '@pos/events';
import { hostFlags } from './host-flags.js';
import type { StateHolder } from './state-holder.js';

// §7.1, P-7: a re-plan slower than this is logged.
const SLOW_REPLAN_MS = 50;

export interface WarnLog {
  warn(obj: Record<string, unknown>, msg: string): void;
}

// AD-6: the hub folds non-strict, always. The per-event form of Reducer<S>; the writer folds through foldEngineBatch.
export function engineReducer(state: EngineState, event: PosEvent): EngineState {
  return applyEvent(state, event, { strict: false });
}

// P-7: applyEvent copies only the stations it touches, so reference inequality names them.
export function touchedStations(prev: EngineState, next: EngineState): string[] {
  if (prev === next) return [];
  return Object.keys(next.stations).filter((id) => prev.stations[id] !== next.stations[id]);
}

interface FoldNote {
  prev: EngineState;
  next: EngineState;
  ms: number;
}

// Keyed by the writer's `appended` array: a rolled-back transaction's note is never read, and a nested writer.run in
// another after-commit hook cannot take this transaction's.
const notes = new WeakMap<readonly PosEvent[], FoldNote>();

// AD-28: one transaction's events, one applyEvents call. The writer runs this inside the transaction, so the plain
// OrderLinesAdded throw on an absent order (§3.3) rolls it back; everything logged waits for afterEngineCommit.
// `now`: the hub's clock (F §6.7's lint forbids performance.now here), whole ms, enough for the 50 ms line of §7.1.
export function foldEngineBatch(state: EngineState, events: readonly PosEvent[], now: () => number): EngineState {
  const start = now();
  const next = applyEvents(state, events, { strict: false });
  notes.set(events, { prev: state, next, ms: now() - start });
  return next;
}

// AD-6, §7.2: after commit, log what the fold noted and clear the diagnostics. 0 statements.
export function afterEngineCommit(state: StateHolder<EngineState>, log: WarnLog, appended: readonly PosEvent[]): void {
  const note = notes.get(appended);
  if (note !== undefined) {
    logAbsentIds(note, appended, log);
    logSlowFold(note, appended, log);
  }
  // 01a §2: a hub with no engine steps holds {} and a test's identity reducer holds no list.
  const current = state.get() as EngineState;
  const held = (current as Partial<EngineState>).diagnostics;
  if (held === undefined || held.length === 0) return;
  logDiagnostics(held, log, false);
  state.swap({ ...current, diagnostics: [] });
}

// §7.2 and AD-6. No order contents: the detail holds ids, quantities and reasons only. `replay` marks a boot's line.
export function logDiagnostics(diagnostics: readonly Diagnostic[], log: WarnLog, replay: boolean): void {
  for (const d of diagnostics) {
    if (d.kind === 'reserve_fallback') {
      const key = d.order_item_id ?? d.event_id ?? '';
      if (hostFlags.reserve_fallback_logged.has(key)) continue;
      hostFlags.reserve_fallback_logged.add(key);
    }
    const { detail, ...named } = d;
    log.warn({ ...named, ...detail, ...(replay ? { replay: true } : {}) }, 'engine diagnostic');
  }
}

const HANDLED: ReadonlySet<string> = new Set(Object.values(ENGINE_REPLAY_EVENTS).flat());

function logSlowFold(note: FoldNote, events: readonly PosEvent[], log: WarnLog): void {
  if (note.ms <= SLOW_REPLAN_MS) return;
  // proposed (implementer): one applyEvents folds the whole transaction, so `ms` is the transaction's fold and
  // `event_type` the first event it handled (the head of a submit batch, OrderPlaced).
  const event_type = events.find((e) => HANDLED.has(e.event_type))?.event_type;
  for (const station_id of touchedStations(note.prev, note.next)) {
    log.warn({ event_type, station_id, lines: note.next.stations[station_id]!.unfired.length, ms: Math.round(note.ms) }, 'engine fold: slow re-plan');
  }
}

const LINE_EVENTS: ReadonlySet<string> = new Set(['ItemStarted', 'ItemDone', 'ItemDoneUndone', 'ItemRemoved', 'ItemVoided', 'ItemMovedToStock', 'ItemReturned']);
const ORDER_EVENTS: ReadonlySet<string> = new Set(['OrderBoosted', 'ItemsReleased']);

// §3.3 Absent ids: one line per id per event. proposed (implementer): "logged once" is read as live only: a replay
// repeats the fold, not the line (§7.2 names the breach alone as logged again). One fold covers the transaction, so this
// reads the fold's two ends: an id is present when the fold's result holds it, or the batch itself added it. A
// BusinessDayClosed in the batch can remove a line an earlier event of the batch really folded, so with one the state
// before counts too (a late event on such a line then goes unlogged, in that one transaction only).
function logAbsentIds(note: FoldNote, events: readonly PosEvent[], log: WarnLog): void {
  const addedLines = new Set<string>();
  const addedOrders = new Set<string>();
  const closing = events.some((e) => e.event_type === 'BusinessDayClosed');
  const has = (key: 'lines' | 'orders', id: string): boolean =>
    note.next[key][id] !== undefined || (key === 'lines' ? addedLines : addedOrders).has(id) || (closing && note.prev[key][id] !== undefined);
  const report = (event: PosEvent, order_id: string, order_item_id: string | null): void => {
    log.warn({ event_type: event.event_type, order_id, order_item_id }, 'engine fold: absent id');
  };
  for (const event of events) {
    if (event.stream_type !== 'order') continue;
    const type = event.event_type;
    const p = event.payload as { order_id?: string; order_item_id?: string; order_item_ids?: string[]; lines?: Array<{ order_item_id: string }> };
    if (type === 'OrderPlaced' || type === 'OrderLinesAdded' || type === 'ItemAdded') {
      addedOrders.add(p.order_id ?? event.stream_id);
      for (const id of p.order_item_ids ?? []) addedLines.add(id);
      for (const line of p.lines ?? []) addedLines.add(line.order_item_id);
      if (p.order_item_id !== undefined) addedLines.add(p.order_item_id);
    } else if (LINE_EVENTS.has(type)) {
      if (p.order_item_id !== undefined && !has('lines', p.order_item_id)) report(event, event.stream_id, p.order_item_id);
    } else if (type === 'ItemServed') {
      for (const id of p.order_item_ids ?? []) if (!has('lines', id)) report(event, event.stream_id, id);
    } else if (ORDER_EVENTS.has(type)) {
      const order_id = p.order_id ?? event.stream_id;
      if (!has('orders', order_id)) report(event, order_id, null);
    }
  }
}
