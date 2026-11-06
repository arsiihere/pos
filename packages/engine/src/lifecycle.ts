// 03a §3.3 Exit: the pure exit predicate every reader uses (never the presence of the row), the fold-side
// clock (`last_line_fold_at`, `last_served_at`) and the list of orders the removal step takes out. Physical
// removal itself (unbooking exactly `booked`, AD-7 / AD-6) is in apply-event.ts, inside listed folds only.
import { effectiveCapacity } from './capacity.js';
import { occupancy } from './profile.js';
import type { EngineLine, EngineOrder, EngineState } from './state.js';

// §3.3: an order leaves the engine 30 min after its last line is served (an engine constant in the pilot).
export const ORDER_EXIT_AFTER_SERVED_MS = 1_800_000;

const OPEN_STAGES: ReadonlySet<EngineLine['stage']> = new Set(['added', 'cooking', 'done']);

export function isOpen(line: EngineLine | undefined): boolean {
  return line !== undefined && OPEN_STAGES.has(line.stage);
}

// AD-8: a listed line not yet filled by its ItemAdded is not a line.
export function isPlaceholder(line: EngineLine): boolean {
  return line.units === 0 && line.fire_ms === null && line.booked === null;
}

// A line not yet fired: hidden, frozen, or a placeholder (AD-8) still awaiting its ItemAdded.
function isUnfired(line: EngineLine): boolean {
  return line.stage === 'added' && line.fired_at === null;
}

// BF-6: an open line's planned land at its point — (started_at ?? fire_ms) + prep + the AD-4 occupancy cook at the
// station's effective capacity + carry. A COOKING line counts from its own Start, so a late Start keeps its cook.
// Fixed values only: a fired line's live interval slides with t and would never let the order go.
function plannedLand(state: EngineState, line: EngineLine): number | null {
  if (!isOpen(line)) return null;
  const base = line.started_at ?? line.fire_ms;
  if (base === null) return null;
  const station = state.stations[line.station_id];
  const cap = station === undefined ? 0 : effectiveCapacity(station);
  const cook = cap >= 1 ? occupancy(line.units, cap, line.cook_ms).cook_ms : line.cook_ms;
  return base + line.prep_ms + cook + line.carry_ms;
}

// §3.3 abandon, as built per AD-13 (controller ruling 2026-11-06 on BF-6 vs test 111):
//   abandoned ⇔ the order has no unfired line ∧ t ≥ max(last_line_fold_at + order_abandon_ms, latest planned land)
// Test 111: a never-tapped fired line goes at last_line_fold_at + order_abandon_ms; BF-6: a long legitimate cook is
// kept until its planned land (BF-6's literal "clock from max(…)" would add order_abandon_ms after the land).
// awaiting > 0 counts as an unfired line (listed lines not yet seen); no planned land → the fold clock only;
// no config → no abandon.
function isAbandoned(state: EngineState, order: EngineOrder, t: number): boolean {
  const ms = state.config?.settings.order_abandon_ms;
  if (ms === undefined) return false;
  const clock = order.last_line_fold_at + ms;
  if (t < clock || order.awaiting > 0) return false;
  let land = Number.NEGATIVE_INFINITY;
  for (const id of order.line_ids) {
    const line = state.lines[id];
    if (line === undefined) continue;
    if (isUnfired(line)) return false;
    const l = plannedLand(state, line);
    if (l !== null && l > land) land = l;
  }
  return t >= land;
}

// §3.3: inEngine(order, t) = served_ok ∧ ¬abandoned. O(1) unless t is past the abandon clock.
export function orderInEngine(state: EngineState, order: EngineOrder, t: number): boolean {
  if (order.last_served_at !== null && t >= order.last_served_at + ORDER_EXIT_AFTER_SERVED_MS) return false;
  return !isAbandoned(state, order, t);
}

// §3.3, §6.1a: false for an absent order.
export function isOrderInEngine(state: EngineState, order_id: string, t: number): boolean {
  const order = state.orders[order_id];
  return order !== undefined && orderInEngine(state, order, t);
}

// AD-20 (task 14b): one of the order's lines holds a live reservation (reserved_seq ≠ null, §3.7).
function holdsReservation(state: EngineState, order: EngineOrder): boolean {
  return order.line_ids.some((id) => {
    const line = state.lines[id];
    return line !== undefined && line.reserved_seq !== null;
  });
}

// §3.6.1 / §3.12 (v0.6, G4-2 #3): the checkpoint condition — no order of state.orders is in the engine by the
// predicate, and no line of an exited order holds a live reservation. The second clause is checkable because the
// removal step keeps such an order (AD-20); it keeps a held unit out of the checkpoint's stock.
export function noOrderInEngine(state: EngineState, t: number): boolean {
  for (const id in state.orders) {
    const order = state.orders[id]!;
    if (orderInEngine(state, order, t) || holdsReservation(state, order)) return false;
  }
  return true;
}

// The orders the removal step takes out at a listed fold's recorded_at (§3.3); `skip` is OrderLinesAdded's own order.
// AD-20, proposed (implementer, overnight): an exited order is kept while one of its lines holds a live reservation,
// so its release — the fires tick's StockReleased { abandoned } (§3.6.1 4a) or the close's (§3.7 close row, "a line
// of an order already out of the engine that still holds a reservation") — still finds the line and the draw. Every
// reader uses the predicate (§3.3), so the kept order occupies nothing and gives no intent but that release; it
// leaves at the first listed fold after the release. Removal stays inside listed folds only.
export function exitedOrderIds(state: EngineState, t: number, skip?: string): string[] {
  const out: string[] = [];
  for (const id in state.orders) {
    const order = state.orders[id]!;
    if (id !== skip && !orderInEngine(state, order, t) && !holdsReservation(state, order)) out.push(id);
  }
  return out;
}

// §3.3 BusinessDayClosed: the orders whose lines are all served / voided / removed / returned (none awaited). The
// close's releases (stock.ts closeReleases) read this set.
export function closedOrderIds(state: EngineState): string[] {
  const out: string[] = [];
  for (const id in state.orders) {
    const order = state.orders[id]!;
    if (order.awaiting === 0 && !order.line_ids.some((l) => isOpen(state.lines[l]))) out.push(id);
  }
  return out;
}

// The orders the BusinessDayClosed fold removes: closedOrderIds, AD-20 except an order whose line still holds a
// reservation. The close writer releases those first (§3.7), so this keeps only a reservation a writer left; a later
// close or the abandon pass releases it, and the order leaves at the next listed fold after that.
export function closeExitIds(state: EngineState): string[] {
  return closedOrderIds(state).filter((id) => !holdsReservation(state, state.orders[id]!));
}

// §3.3: a fold that acts on the order or one of its lines sets last_line_fold_at = recorded_at, and when it leaves no
// line open (and none awaited) sets last_served_at = recorded_at — an order with no plannable line (Review Focus 4)
// at the fold that brings awaiting to 0. An absent order is unchanged.
export function touchOrder(state: EngineState, order_id: string, t: number): EngineState {
  const order = state.orders[order_id];
  if (order === undefined) return state;
  const closes = order.last_served_at === null && order.awaiting === 0 && !order.line_ids.some((l) => isOpen(state.lines[l]));
  const updated: EngineOrder = { ...order, last_line_fold_at: t, last_served_at: closes ? t : order.last_served_at };
  return { ...state, orders: { ...state.orders, [order_id]: updated } };
}
