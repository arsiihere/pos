// 03a §3.2 (lines, units, cook time) and §3.5.1 (the fold plans at the ItemAdded that brings awaiting to 0).
// Pure: no clock, no ids; t is the triggering event's recorded_at.
import type { ItemAddedPayload } from '@pos/events';
import { addInterval, earliestFit, occupancy } from './profile.js';
import type { Diagnostic, EngineLine, EngineState, StationRuntime } from './state.js';

// §3.2: a line is an ItemAdded with station_id not null and line_kind ≠ 'deal' (01c §3.4.7).
export function isEngineLine(item: Pick<ItemAddedPayload, 'station_id' | 'line_kind'>): boolean {
  return item.station_id !== null && item.line_kind !== 'deal';
}

// §3.2 P-1: quantity for a piece line; 1 for a g / ml line and while a weight is pending (01c V18).
// A filled line therefore has units ≥ 1; units 0 marks a placeholder not yet seen (AD-8).
export function lineUnits(item: Pick<ItemAddedPayload, 'sale_unit' | 'quantity' | 'order_item_id'>): number {
  if (item.sale_unit !== 'piece' || item.quantity === null) return 1;
  if (item.quantity < 1) throw new InvalidEvent('quantity_invalid', item.order_item_id);
  return item.quantity;
}

// AD-6 (task 6 ruling): a writer bug found by an order fold. Strict folds throw it; non-strict folds leave the
// state unchanged and append an 'invalid_event' diagnostic (applyEvent catches it).
export class InvalidEvent extends Error {
  constructor(
    readonly reason: string,
    readonly order_item_id: string,
    readonly station_id?: string,
  ) {
    super(`invalid event (${reason}) for line ${order_item_id}${station_id === undefined ? '' : ` on station ${station_id}`}`);
    this.name = 'InvalidEvent';
  }
}

function required<T>(value: T | null, field: string, order_item_id: string): T {
  if (value === null) throw new InvalidEvent(`${field}_null`, order_item_id);
  return value;
}

// §3.2 (01c B1): slot → stock_time_ms when served from stock, else cook_time_ms; batch → the copied
// stock_program_cook_time_ms / program_cook_time_ms, never config. full_cook_ms is the fresh cook,
// stock_cook_ms the copied stock cook (null when none).
export function lineCookTimes(
  item: ItemAddedPayload,
  type: StationRuntime['type'],
  from_stock: boolean,
): Pick<EngineLine, 'cook_ms' | 'full_cook_ms' | 'stock_cook_ms'> {
  const full =
    type === 'slot'
      ? required(item.cook_time_ms, 'cook_time_ms', item.order_item_id)
      : required(item.program_cook_time_ms, 'program_cook_time_ms', item.order_item_id);
  const stock = type === 'slot' ? item.stock_time_ms : item.stock_program_cook_time_ms;
  // 01c V12: a from-stock line always has its stock cook time; a null one is a writer bug, never the full cook.
  if (from_stock && stock === null) {
    throw new InvalidEvent(type === 'slot' ? 'stock_time_ms_null' : 'stock_program_cook_time_ms_null', item.order_item_id);
  }
  return { cook_ms: from_stock ? stock! : full, full_cook_ms: full, stock_cook_ms: stock };
}

// §3.2: d(L) = T − carry − cook − prep, the latest fire that lands on target.
export function deadlineOf(line: Pick<EngineLine, 'carry_ms' | 'cook_ms' | 'prep_ms'>, target_land_ms: number): number {
  return target_land_ms - line.carry_ms - line.cook_ms - line.prep_ms;
}

// D37: effective capacity = override ?? capacity.
export function effectiveCapacity(station: Pick<StationRuntime, 'capacity' | 'capacity_override'>): number {
  return station.capacity_override ?? station.capacity;
}

// Sorted insert into StationRuntime.unfired, ordered by (fire, order_item_id) (§3.3).
function insertUnfired(unfired: readonly string[], id: string, fire: number, lines: Readonly<Record<string, EngineLine>>): string[] {
  const out = [...unfired];
  let i = out.length;
  while (i > 0) {
    const prev = lines[out[i - 1]!]!;
    const pf = prev.fire_ms ?? Number.POSITIVE_INFINITY;
    if (pf < fire || (pf === fire && out[i - 1]! < id)) break;
    i--;
  }
  out.splice(i, 0, id);
  return out;
}

// §3.5.1 "When the fold plans": places the order's lines that are not placed yet (this batch's lines), in
// line_ids order, at the ItemAdded that brought awaiting to 0. Task 6 places each line at its earliest fit
// from t on its engine station (the §3.5.1 step 3 placement); the sync hold-and-fire loop (step 4, task 7)
// and pass 1 over older lines (step 2, task 8) replace this for their lines. Each booking is the AD-4
// occupancy, stored on the line (AD-7); a line over effective capacity appends an 'over_capacity'
// diagnostic (AD-4) in both modes. Copy-on-write: only the touched stations and lines are copied.
export function planNewLines(state: EngineState, order_id: string, t: number, event_id: string): EngineState {
  const order = state.orders[order_id];
  if (order === undefined) return state;
  const pending = order.line_ids.filter((id) => {
    const l = state.lines[id];
    return l !== undefined && l.stage === 'added' && l.fire_ms === null && l.booked === null;
  });
  if (pending.length === 0) return state;

  const stations: Record<string, StationRuntime> = { ...state.stations };
  const lines: Record<string, EngineLine> = { ...state.lines };
  const diagnostics: Diagnostic[] = [];
  for (const id of pending) {
    const line = lines[id]!;
    const station = stations[line.station_id];
    // Unreachable through the folds (the ItemAdded fold checked the station, and no fold removes one).
    if (station === undefined) throw new InvalidEvent('station_missing', id, line.station_id);
    const cap = effectiveCapacity(station);
    const fire = earliestFit(station.profile, t, line.prep_ms, line.cook_ms, line.units, cap);
    const occ = occupancy(line.units, cap, line.cook_ms);
    const booked = { start: fire + line.prep_ms, end: fire + line.prep_ms + occ.cook_ms, units: occ.units };
    const placed: EngineLine = { ...line, fire_ms: fire, booked };
    lines[id] = placed;
    stations[line.station_id] = {
      ...station,
      profile: addInterval(station.profile, booked, booked.units),
      unfired: insertUnfired(station.unfired, id, fire, lines),
    };
    if (line.units > cap) {
      diagnostics.push({ kind: 'over_capacity', event_id, order_item_id: id, station_id: line.station_id, detail: { units: line.units, capacity: cap } });
    }
  }
  return {
    ...state,
    stations,
    lines,
    diagnostics: diagnostics.length === 0 ? state.diagnostics : [...state.diagnostics, ...diagnostics],
  };
}
