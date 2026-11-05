// 03a §3.5.5 routing (D8, D9, D10, D23, P-3). Pure: no clock, no ids, no I/O; inputs are never mutated.
//
// A line may go to its routed station or an alternate (station_alternates, slot stations only, P-3) that allows
// the order type (02 lists only those: ProposedOrder.lines[].alternates, D8), whose carry ≤ max_carry_ms(L) (the
// line's D25 copy) and that is not paused. The home station for the order type is the alternate marked `home`,
// else the routed station (D9). Reserve (D8): a station's reserve_units are usable only by the lines it is home
// for; every other line sees effective capacity − reserve_units. proposed (implementer, overnight) R6: "its home
// order types" is read per line — the station is home for the line when it is the line's home (homeOf), so a
// line's capacity there is the full effective capacity, and effective − reserve_units on any other station.
//
// How a line carries its route (proposed (implementer, overnight), task 11 report "Proposed readings" R1): the
// line's `station_id` is the station it is on (OrderPlaced.lines[].station_id, "the engine's starting station",
// §4.2), `carry_ms` that station's carry to the point, and `alternates` every *other* station of its allowed set.
// When a line moves (planOrder's choice, the fold's choice, a re-route), the station it leaves joins `alternates`
// with its carry and its `home` flag (true when no alternate was marked home: it was the routed home), and the
// station it takes leaves them (rerouted). The allowed set and the home are therefore the same before and after a
// move, so the fold at awaiting = 0 re-runs exactly planOrder's routing (§3.5.1 "one sequence").
//
// Filters (the same for planOrder and the fold, so both see one set):
//   - the home station is never filtered by max_carry_ms (proposed (implementer, overnight) R2: "its routed
//     (home) station" is always allowed; every other station, the routed one included when an alternate is home,
//     must pass the carry test — so the set is the same whichever station the line currently names);
//   - paused stations are not offered to a new line; a placed (hidden) line keeps its own station while it is
//     paused (§3.10 "open lines continue") and is not moved onto a paused one (proposed (implementer,
//     overnight) R7);
//   - alternates only between slot stations (P-3): a line on a batch station has no alternates;
//   - a station whose capacity for the line (after the reserve) is < 1 is not offered;
//   - FIFO (§3.5.3, AD-14; proposed (implementer, overnight) R5): a sync line whose home station is FIFO is a FIFO line and is offered
//     only FIFO stations; any other sync line only non-FIFO ones (it is held to T, and a FIFO station never
//     holds); an immediate line any. A re-plan never moves a line onto or off a FIFO station.
// When every station is filtered out (unreachable after checkOrderable except for a carry-filtered set), the line
// stays on its own station (proposed (implementer, overnight) R8).
import { effectiveCapacity } from './capacity.js';
import type { EngineLine, EngineState } from './state.js';

export type Alternate = { station_id: string; carry_ms: number; home: boolean };

// What routing reads of a line (an EngineLine, or a line of a ProposedOrder).
export type RouteLine = Pick<EngineLine, 'order_item_id' | 'station_id' | 'carry_ms' | 'max_carry_ms' | 'serve_mode'> & {
  alternates: ReadonlyArray<Alternate>;
};

// One allowed station of a line: its carry to the point, whether it is the line's home, and the capacity the line
// may use there (effective capacity, minus reserve_units when it is not the line's home).
export type RouteOption = { station_id: string; carry_ms: number; home: boolean; cap: number };

// Per-pass lookups from state.config (built once per placement / re-plan, O(stations)).
export type RouteCtx = {
  state: EngineState;
  reserve: ReadonlyMap<string, number>;
  fifo: ReadonlySet<string>;
  min_gain_ms: number;
};

export function routeCtx(state: EngineState): RouteCtx {
  const reserve = new Map<string, number>();
  const fifo = new Set<string>();
  for (const s of state.config?.stations ?? []) {
    reserve.set(s.station_id, s.reserve_units);
    if (s.policy === 'fifo') fifo.add(s.station_id);
  }
  // 01a v2.1 §5.2a default min_gain_ms 60 000 when no config is applied.
  return { state, reserve, fifo, min_gain_ms: state.config?.settings.min_gain_ms ?? 60_000 };
}

// D9: the alternate marked home for the order type, else the line's own (routed) station.
export function homeOf(line: Pick<RouteLine, 'station_id' | 'alternates'>): string {
  for (const a of line.alternates) if (a.home && a.station_id !== line.station_id) return a.station_id;
  return line.station_id;
}

// The line's stations: its own first, then each alternate once (an entry naming its own station is ignored).
function entriesOf(line: RouteLine): Array<{ station_id: string; carry_ms: number }> {
  const out = [{ station_id: line.station_id, carry_ms: line.carry_ms }];
  const seen = new Set([line.station_id]);
  for (const a of line.alternates) {
    if (seen.has(a.station_id)) continue;
    seen.add(a.station_id);
    out.push({ station_id: a.station_id, carry_ms: a.carry_ms });
  }
  return out;
}

const byPreference = (a: RouteOption, b: RouteOption): number =>
  // §3.5.5 sync preference: home, then lowest carry, then station_id (also the tie order of the immediate rule, D9).
  (a.home === b.home ? 0 : a.home ? -1 : 1) || a.carry_ms - b.carry_ms || (a.station_id < b.station_id ? -1 : a.station_id > b.station_id ? 1 : 0);

// The capacity a line may use on a station (D8 reserve), before the < 1 filter.
function rawCap(ctx: RouteCtx, station_id: string, home: string): number {
  const s = ctx.state.stations[station_id]!;
  return effectiveCapacity(s) - (station_id === home ? 0 : (ctx.reserve.get(station_id) ?? 0));
}

// §3.5.5: the allowed stations of a line, in preference order (home, lowest carry, station_id).
// placed = false: a new line (planOrder, the fold at awaiting = 0); placed = true: a hidden line in a re-plan (its
// own station always allowed, D10; never onto a FIFO station).
export function routeOptions(ctx: RouteCtx, line: RouteLine, placed: boolean): RouteOption[] {
  const stations = ctx.state.stations;
  const home = homeOf(line);
  const own = stations[line.station_id];
  const multi = own !== undefined && own.type === 'slot';
  const fifoLine = line.serve_mode === 'sync' ? ctx.fifo.has(home) : null;
  const out: RouteOption[] = [];
  for (const e of entriesOf(line)) {
    const isOwn = e.station_id === line.station_id;
    const s = stations[e.station_id];
    if (s === undefined || (!isOwn && (!multi || s.type !== 'slot'))) continue;
    const isHome = e.station_id === home;
    const raw = rawCap(ctx, e.station_id, home);
    if (placed && isOwn) {
      // proposed (implementer, overnight) R4: a placed line whose capacity after the reserve is < 1 (the reserve or an override changed
      // since it was placed) keeps the station's effective capacity until it moves (no division by zero).
      out.push({ station_id: e.station_id, carry_ms: e.carry_ms, home: isHome, cap: raw >= 1 ? raw : effectiveCapacity(s) });
      continue;
    }
    if (s.paused || raw < 1) continue;
    if (!isHome && line.max_carry_ms !== null && e.carry_ms > line.max_carry_ms) continue;
    if (placed ? ctx.fifo.has(e.station_id) : fifoLine !== null && ctx.fifo.has(e.station_id) !== fifoLine) continue;
    out.push({ station_id: e.station_id, carry_ms: e.carry_ms, home: isHome, cap: raw });
  }
  if (out.length === 0 && own !== undefined) {
    const raw = rawCap(ctx, line.station_id, home);
    out.push({ station_id: line.station_id, carry_ms: line.carry_ms, home: line.station_id === home, cap: raw >= 1 ? raw : effectiveCapacity(own) });
  }
  return out.sort(byPreference);
}

// The option of `station_id` among a line's options (undefined when not allowed).
export function optionOn(options: readonly RouteOption[], station_id: string): RouteOption | undefined {
  return options.find((o) => o.station_id === station_id);
}

// §3.5.5 immediate line: the minimum arrival (land at the station + carry; ties in preference order, D9); if it
// beats the home station by less than min_gain_ms, the home station. `arrivals[i]` belongs to `options[i]`.
export function chooseImmediate(ctx: RouteCtx, options: readonly RouteOption[], arrivals: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < options.length; i++) if (arrivals[i]! < arrivals[best]!) best = i;
  const home = options.findIndex((o) => o.home);
  if (home >= 0 && home !== best && arrivals[home]! - arrivals[best]! < ctx.min_gain_ms) return home;
  return best;
}

// The route fields of a line placed on `to` (R1): `to` leaves alternates; the station left joins them with its
// carry and home flag; afterwards only the home (when it is not `to`) is flagged. Same station → the fields
// unchanged (copied).
export function rerouted(line: RouteLine, to: Pick<RouteOption, 'station_id' | 'carry_ms'>): Pick<EngineLine, 'station_id' | 'carry_ms' | 'alternates'> {
  if (to.station_id === line.station_id) {
    return { station_id: line.station_id, carry_ms: line.carry_ms, alternates: line.alternates.map((a) => ({ ...a })) };
  }
  // The home flag stays on the home only (several flagged alternates would otherwise change which one homeOf reads).
  const home = homeOf(line);
  return {
    station_id: to.station_id,
    carry_ms: to.carry_ms,
    alternates: [
      { station_id: line.station_id, carry_ms: line.carry_ms, home: home === line.station_id },
      ...line.alternates
        .filter((a) => a.station_id !== to.station_id && a.station_id !== line.station_id)
        .map((a) => ({ station_id: a.station_id, carry_ms: a.carry_ms, home: a.station_id === home })),
    ],
  };
}
