import type { Unit } from '@pos/domain';
import type {
  ConfigItem,
  ConfigStockItem,
  EventDraft,
  StockAddedPayloadV2,
  StockConsumedPayload,
  StockReleasedPayload,
  StockReservedPayload,
} from '@pos/events';
import { InvalidEvent } from './invalid-event.js';
import { closedOrderIds, isOpen, orderInEngine } from './lifecycle.js';
import { isEngineLine, type ProposedLine, type ProposedOrder } from './plan.js';
import { placedUnderOldType } from './batch.js';
import { stationPolicy } from './replan.js';
import type { DayDraws, EngineLine, EngineState, StockEntry } from './state.js';

const NO_ENTRY: StockEntry = { on_hand: 0, reserved: 0, set_at: null, unit: 'piece' };

// 01a S14 (01c V5): a stock item with no entry reads as { 0, 0, null, 'piece' } (E1 stock AC6).
export function stockOf(state: EngineState, stockItemId: string): StockEntry {
  return state.stock[stockItemId] ?? { ...NO_ENTRY };
}

// 01a S33: the open day's start, the businessDayStartMs every caller passes.
export function openDayStartMs(state: EngineState): number | null {
  const day = state.business_day;
  return day !== null && day.closed_at === null ? day.opened_at : null;
}

// 01a S44 (01c §3.5.3): the stock unit frozen for the open day; else the stock item's own.
export function dayStockUnit(state: EngineState, stockItem: Pick<ConfigStockItem, 'stock_item_id' | 'stock_unit'>): Unit {
  const frozen = openDayStartMs(state) !== null ? state.business_day?.stock_units[stockItem.stock_item_id] : undefined;
  return frozen ?? stockItem.stock_unit;
}

// 01c V20: the sale unit and draws frozen for the open day. Fallback (m14, plan P-6): an item with no
// frozen entry uses the config's draws, except a draw whose stock item's frozen unit differs from its
// config unit (configStockUnits); that draw is not used until the next day open.
export function dayDraws(
  state: EngineState,
  item: Pick<ConfigItem, 'item_id' | 'sale_unit' | 'stock_draws'>,
  configStockUnits: Readonly<Record<string, Unit>>,
): DayDraws {
  const day = openDayStartMs(state) !== null ? state.business_day : null;
  const frozen = day?.draws[item.item_id];
  if (frozen !== undefined) {
    return { sale_unit: frozen.sale_unit, stock_draws: frozen.stock_draws.map((draw) => ({ ...draw })) };
  }
  const stockDraws = item.stock_draws.filter((draw) => {
    const frozenUnit = day?.stock_units[draw.stock_item_id];
    return frozenUnit === undefined || frozenUnit === configStockUnits[draw.stock_item_id];
  });
  return { sale_unit: item.sale_unit, stock_draws: stockDraws.map((draw) => ({ ...draw })) };
}

// 01a S41 (01c §3.5.1): the only place the validity rule lives; carries_over and the day's unit of the stock item.
export function countIsValid(
  entry: StockEntry,
  businessDayStartMs: number | null,
  stockItem: { carries_over: boolean; stock_unit: Unit },
): boolean {
  if (entry.set_at === null) return false;
  if (entry.unit !== stockItem.stock_unit) return false;
  if (!stockItem.carries_over && (businessDayStartMs === null || entry.set_at < businessDayStartMs)) return false;
  return true;
}

// 01a S41 (01c V5, §3.5.1): 0 when the count is not valid, else max(0, on_hand − reserved).
export function availableStock(
  state: EngineState,
  stockItemId: string,
  businessDayStartMs: number | null,
  stockItem: ConfigStockItem,
): number {
  const entry = stockOf(state, stockItemId);
  const valid = countIsValid(entry, businessDayStartMs, {
    carries_over: stockItem.carries_over,
    stock_unit: dayStockUnit(state, { stock_item_id: stockItemId, stock_unit: stockItem.stock_unit }),
  });
  return valid ? Math.max(0, entry.on_hand - entry.reserved) : 0;
}

// 01a S46 (01c §3.5.1): derived, no event. The threshold (stock_item_branches) is in the stock item's own
// stock_unit, so it applies only while the open day's frozen unit is that unit; otherwise no low until the next open.
export function stockLevel(
  state: EngineState,
  stockItemId: string,
  businessDayStartMs: number | null,
  stockItem: ConfigStockItem,
): 'not_counted' | 'out' | 'low' | 'ok' {
  const dayUnit = dayStockUnit(state, { stock_item_id: stockItemId, stock_unit: stockItem.stock_unit });
  const valid = countIsValid(stockOf(state, stockItemId), businessDayStartMs, {
    carries_over: stockItem.carries_over,
    stock_unit: dayUnit,
  });
  if (!valid) return 'not_counted';
  const available = availableStock(state, stockItemId, businessDayStartMs, stockItem);
  if (available === 0) return 'out';
  const threshold = dayUnit === stockItem.stock_unit ? stockItem.low_stock_threshold : null;
  if (threshold !== null && available <= threshold) return 'low';
  return 'ok';
}

// 01a S44: whole sale units the available stock covers.
export function saleUnitsAvailable(available: number, quantityPerSaleUnit: number): number {
  return Math.floor(available / quantityPerSaleUnit);
}

// 01a S14 (review 2 S-1; 01c §3.5.2 per draw): served from stock only when the whole line fits.
export function canServeFromStock(available: number, quantity: number, quantityPerSaleUnit: number): boolean {
  return available >= quantity * quantityPerSaleUnit;
}

// ---- 03a §3.7 reserve at submit (§6.1e) ------------------------------------------------------------------------

// 03a §6.1e / interfaces.md `EventDraft<'StockReserved'>`. Proposed (implementer, overnight): @pos/events'
// EventDraft is not generic and carries envelope fields the engine does not know (occurred_at, actor_id,
// device_id); the engine drafts the event-specific part and the host stamps the envelope, as it does for the
// command's own drafts.
export type StockReservedDraft = {
  stream_type: 'stock';
  stream_id: string;
  event_type: 'StockReserved';
  schema_version: 1;
  payload: StockReservedPayload;
};

// 03a §6.1f: the context a StockAdded / ItemMovedToStock / StockSet draft needs (task 12b), as reserveStock takes it.
export type StockCtx = {
  dayStartMs: number;
  stockItems: ReadonlyArray<ConfigStockItem>;
  configStockUnits: Readonly<Record<string, Unit>>;
};

// 01c V12: a line is stock-tracked when it has a draw and a stock cook time on its station (slot: stock_time_ms;
// batch: the copied stock_program_cook_time_ms). A return line never draws (§3.8a, [03a #75]); a line that is not an
// engine line (a deal, no station, §3.2) is never reserved.
function isTracked(state: EngineState, line: ProposedLine): boolean {
  if (!isEngineLine(line) || line.return_of !== null || line.stock_draws.length === 0) return false;
  // A station the state does not know reads as slot (stock_time_ms); planOrder refuses such a line anyway.
  const batch = state.stations[line.station_id!]?.type === 'batch';
  return (batch ? line.stock_program_cook_time_ms : line.stock_time_ms) !== null;
}

// 03a §3.7 reserve at submit (F §5.9 step 5, F-9; 01c §3.5.2), pure. Lines in listing order; a line is served from
// stock only when every draw fits the available stock after the units already claimed by earlier lines of this
// command; then one StockReserved per draw (quantity = the draw on the line) and its draws are claimed. Otherwise
// it is not from stock (cook_fresh, the 01a S32 default when null) or refused (sold_out).
// The draws are the line's own `stock_draws` (ItemAdded.stock_draws, 01c §4.3: the whole line's quantity, i.e.
// units × quantity_per_sale_unit, built by 02 with dayDraws), so a StockReserved always equals the EngineLine.draws
// entry the fold copies (G4-1 #9); canServeFromStock(available, 1, draw) is therefore the S14 rule for the whole
// line. configStockUnits (§6.1e) is what dayDraws needs; proposed (implementer, overnight): the submit path reads
// the line's draws, not dayDraws, so it is accepted and not read here.
// Proposed (implementer, overnight): a sold_out line that does not fit is refused also when 0 < available < needed
// (§3.7 states the available-0 case; a sold_out item cannot be cooked fresh in time, 01a S32). A draw on a stock
// item that stockItems does not list reads as available 0. from_stock lists every proposed line (false unless
// reserved); refused lists the refused lines' order_item_ids in listing order.
export function reserveStock(
  state: EngineState,
  proposed: ProposedOrder,
  dayStartMs: number,
  stockItems: StockCtx['stockItems'],
  configStockUnits: StockCtx['configStockUnits'],
): { drafts: StockReservedDraft[]; from_stock: Record<string, boolean>; refused: string[] } {
  void configStockUnits;
  const items = new Map(stockItems.map((s) => [s.stock_item_id, s]));
  const claimed = new Map<string, number>();
  const drafts: StockReservedDraft[] = [];
  const from_stock: Record<string, boolean> = {};
  const refused: string[] = [];
  for (const line of proposed.lines) {
    from_stock[line.order_item_id] = false;
    if (!isTracked(state, line)) continue;
    const taken = claimLine(state, line.order_item_id, line.stock_draws, dayStartMs, items, claimed);
    if (taken === null) {
      if (line.out_of_stock_behaviour === 'sold_out') refused.push(line.order_item_id);
      continue;
    }
    from_stock[line.order_item_id] = true;
    drafts.push(...taken);
  }
  return { drafts, from_stock, refused };
}

// 03a §3.7 / 01c §3.5.2, the one rule of reserveStock and the StockAdded waiting-line reserve: a line is taken only
// when every draw passes canServeFromStock(available − the units already claimed in this command, 1, draw); then
// its draws are claimed and one StockReserved per draw is returned (quantity = the draw on the line). null = it
// does not fit (nothing claimed). A stock item stockItems does not list reads as available 0.
function claimLine(
  state: EngineState,
  order_item_id: string,
  draws: ReadonlyArray<{ stock_item_id: string; quantity: number }>,
  dayStartMs: number,
  items: ReadonlyMap<string, ConfigStockItem>,
  claimed: Map<string, number>,
): StockReservedDraft[] | null {
  const fits = draws.every((d) => {
    const stockItem = items.get(d.stock_item_id);
    const available = stockItem === undefined ? 0 : availableStock(state, d.stock_item_id, dayStartMs, stockItem);
    return canServeFromStock(available - (claimed.get(d.stock_item_id) ?? 0), 1, d.quantity);
  });
  if (!fits) return null;
  return draws.map((d) => {
    claimed.set(d.stock_item_id, (claimed.get(d.stock_item_id) ?? 0) + d.quantity);
    return reservedDraft(d.stock_item_id, order_item_id, d.quantity);
  });
}

// ---- 03a §3.7 / §6.1f stockEffects (task 12b) ---------------------------------------------------------------------

// Engine drafts (as StockReservedDraft): the event-specific part only, no ids or times; the host stamps the envelope.
export type StockReleasedDraft = { stream_type: 'stock'; stream_id: string; event_type: 'StockReleased'; schema_version: 1; payload: StockReleasedPayload };
export type StockConsumedDraft = { stream_type: 'stock'; stream_id: string; event_type: 'StockConsumed'; schema_version: 1; payload: StockConsumedPayload };
export type StockAddedDraft = { stream_type: 'stock'; stream_id: string; event_type: 'StockAdded'; schema_version: 2; payload: StockAddedPayloadV2 };
export type StockDraft = StockReservedDraft | StockReleasedDraft | StockConsumedDraft | StockAddedDraft;

// The triggering draft as stockEffects reads it: 00's EventDraft (its occurred_at is the handler's now).
export type StockCause = Pick<EventDraft, 'event_type' | 'payload' | 'occurred_at'>;

type ReleaseReason = StockReleasedPayload['reason'];

function reservedDraft(stock_item_id: string, order_item_id: string, quantity: number): StockReservedDraft {
  return { stream_type: 'stock', stream_id: stock_item_id, event_type: 'StockReserved', schema_version: 1, payload: { stock_item_id, order_item_id, quantity } };
}
function releasedDraft(stock_item_id: string, order_item_id: string, quantity: number, reason: ReleaseReason): StockReleasedDraft {
  return { stream_type: 'stock', stream_id: stock_item_id, event_type: 'StockReleased', schema_version: 1, payload: { stock_item_id, order_item_id, quantity, reason } };
}
function consumedDraft(stock_item_id: string, order_item_id: string, quantity: number): StockConsumedDraft {
  return { stream_type: 'stock', stream_id: stock_item_id, event_type: 'StockConsumed', schema_version: 1, payload: { stock_item_id, order_item_id, quantity } };
}

// §3.7 "a release always covers every draw of the line together": one StockReleased per draw that holds units, on
// every stock item, each for the draw's remaining reserved (the whole line). Exported for the fires tick's
// abandon release (§3.6.1 item 4a, task 14).
export function lineReleases(line: Pick<EngineLine, 'order_item_id' | 'draws'>, reason: ReleaseReason): StockReleasedDraft[] {
  return line.draws.filter((d) => d.reserved > 0).map((d) => releasedDraft(d.stock_item_id, line.order_item_id, d.reserved, reason));
}

// §3.7 consume / Q14 / AD-29 Q7: one StockConsumed per draw with reserved > 0, quantity = that draw's reserved; only a
// live reservation (reserved_seq ≠ null, v0.5 G4-1 #6), so a later Start, Done or Served of the line drafts nothing.
function lineConsumes(line: EngineLine): StockConsumedDraft[] {
  if (line.reserved_seq === null) return [];
  return line.draws.filter((d) => d.reserved > 0).map((d) => consumedDraft(d.stock_item_id, line.order_item_id, d.reserved));
}

// §3.4 / §3.7: an unfired, placed line whose (planned) fire is after t + freeze_ms — a hidden slot line, or a member
// of a hidden batch load (its fire_ms is the load's fire). Frozen, fired, COOKING and ended lines are not hidden.
// §3.11: a line placed under the station's old type is fixed input and behaves as a frozen line here: a recount or a day
// close keeps its reservation (a release would shorten its cook under a booking that stays), a flip never picks it.
export function isHiddenUnfired(state: EngineState, line: EngineLine, t: number): boolean {
  if (line.stage !== 'added' || line.fired_at !== null || line.fire_ms === null || placedUnderOldType(state, line)) return false;
  const placed = line.booked !== null || (line.load_id !== null && state.stations[line.station_id]?.loads[line.load_id]?.order_item_ids.includes(line.order_item_id) === true);
  return placed && line.fire_ms > t + stationPolicy(state, line.station_id).freeze_ms;
}

// The line a cause names, or undefined (absent, or an AD-8 placeholder: units 0, never placed).
function namedLine(state: EngineState, payload: Record<string, unknown>): EngineLine | undefined {
  const id = payload.order_item_id;
  const line = typeof id === 'string' ? state.lines[id] : undefined;
  return line === undefined || line.units === 0 ? undefined : line;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// §3.7 StockAdded candidates (v0.6.2, G4-3 #4): hidden full-cook lines — from_stock false, a draw, a stock cook time
// (and on a batch station the copied stock program), a hidden slot line or a member of a hidden batch load — of an
// order in the engine. A frozen line, a fired / COOKING line and a return line (no draw, [03a #75]) never are.
// Hidden is judged at the draft's occurred_at; the fold sees recorded_at, which is a few ms later. Proposed
// (implementer, overnight): a line whose fire falls inside that gap is a candidate here and frozen at the fold, which
// then switches its cook but keeps its fire and booking (replaceFlipped). The gap is the §3.5.3 append gap.
function isCandidate(state: EngineState, line: EngineLine, t: number): boolean {
  if (line.from_stock || line.return_of !== null || line.draws.length === 0 || line.stock_cook_ms === null) return false;
  if (state.stations[line.station_id]?.type === 'batch' && line.stock_program_id === null) return false;
  const order = state.orders[line.order_id];
  if (order === undefined || order.awaiting > 0) return false;
  return orderInEngine(state, order, t) && isHiddenUnfired(state, line, t);
}

// §3.7 StockAdded "order and reach": the candidates drawing on any of `stock_item_ids`, in deadline order
// (deadline_ms, then order_item_id), each through claimLine (the submit rule) as far as the stock reaches; a line
// that does not fit is skipped and the next is tried. `except`: lines that are not candidates — the moved line and
// every line the stockEffects array ends (⚠️ Changed by 04 (row T-2; G-17), 03a v1.2.4 §3.7; an empty set otherwise).
function waitingReserve(state: EngineState, stock_item_ids: readonly string[], t: number, ctx: StockCtx, except: ReadonlySet<string>): StockReservedDraft[] {
  const ids = new Set(stock_item_ids);
  const cands: EngineLine[] = [];
  for (const id in state.lines) {
    const l = state.lines[id]!;
    if (!except.has(id) && l.draws.some((d) => ids.has(d.stock_item_id)) && isCandidate(state, l, t)) cands.push(l);
  }
  cands.sort((a, b) => a.deadline_ms - b.deadline_ms || byId(a.order_item_id, b.order_item_id));
  const items = new Map(ctx.stockItems.map((s) => [s.stock_item_id, s]));
  const claimed = new Map<string, number>();
  const out: StockReservedDraft[] = [];
  for (const l of cands) out.push(...(claimLine(state, l.order_item_id, l.draws, ctx.dayStartMs, items, claimed) ?? []));
  return out;
}

// The stock bookkeeping of a draft on a scratch state, so a later step of the same command sees it (move to stock
// folds its own drafts, §3.7; BF-8 threads earlier drafts of one command). It mirrors the §3.7 folds' stock part
// (apply-event.ts) without their re-plans and clamps silently: it only feeds availableStock and the candidate
// test, never a stored state. A cause that is not a stock event changes nothing here.
// Proposed (implementer, overnight): a scratch reservation takes reserved_seq = MAX_SAFE_INTEGER (newer than any
// stored one), so a later recount draft of the same command releases it first.
function book(state: EngineState, d: { event_type: string; payload: Record<string, unknown> }, t: number): EngineState {
  const p = d.payload;
  const sid = typeof p.stock_item_id === 'string' ? p.stock_item_id : null;
  if (sid === null) return state;
  const prev = stockOf(state, sid);
  const withStock = (e: StockEntry): EngineState => ({ ...state, stock: { ...state.stock, [sid]: e } });
  const q = typeof p.quantity === 'number' ? p.quantity : 0;
  const lineDraws = (s: EngineState, f: (r: number) => number, patch: (draws: EngineLine['draws']) => Partial<EngineLine>): EngineState => {
    const line = typeof p.order_item_id === 'string' ? s.lines[p.order_item_id] : undefined;
    if (line === undefined || !line.draws.some((x) => x.stock_item_id === sid)) return s;
    const draws = line.draws.map((x) => (x.stock_item_id === sid ? { ...x, reserved: f(x.reserved) } : x));
    return { ...s, lines: { ...s.lines, [line.order_item_id]: { ...line, draws, ...patch(draws) } } };
  };
  switch (d.event_type) {
    case 'StockSet':
      return withStock({ on_hand: p.on_hand as number, reserved: prev.reserved, set_at: t, unit: p.unit as Unit });
    case 'StockAdded':
      return p.unit === prev.unit ? withStock({ ...prev, on_hand: prev.on_hand + q }) : state;
    // 03a v1.2 Q-5: as foldStockTransferredOut — on_hand −= quantity, clamped at 0; an item with no entry stays absent.
    case 'StockTransferredOut':
      return state.stock[sid] === undefined ? state : withStock({ ...prev, on_hand: Math.max(0, prev.on_hand - q) });
    case 'StockReserved':
      return lineDraws(withStock({ ...prev, reserved: prev.reserved + q }), (r) => r + q, () => ({ from_stock: true, reserved_seq: Number.MAX_SAFE_INTEGER }));
    case 'StockReleased':
      return lineDraws(
        withStock({ ...prev, reserved: Math.max(0, prev.reserved - q) }),
        (r) => Math.max(0, r - q),
        (draws) => (draws.every((x) => x.reserved === 0) ? { from_stock: false, reserved_seq: null } : {}),
      );
    case 'StockConsumed':
      return lineDraws(
        withStock({ ...prev, on_hand: Math.max(0, prev.on_hand - q), reserved: Math.max(0, prev.reserved - q) }),
        () => 0,
        (draws) => (draws.every((x) => x.reserved === 0) ? { reserved_seq: null } : {}),
      );
    default:
      return state;
  }
}

function bookAll(state: EngineState, drafts: ReadonlyArray<{ event_type: string; payload: Record<string, unknown> }>, t: number): EngineState {
  let s = state;
  for (const d of drafts) s = book(s, d, t);
  return s;
}

function needCtx(ctx: StockCtx | undefined, event_type: string): StockCtx {
  if (ctx === undefined) throw new Error(`stockEffects(${event_type}) requires stock_ctx (03a §6.1f)`);
  return ctx;
}

// §3.7 recount (01a S14 v0.6): a StockSet below reserved releases hidden lines only, newest reserved_seq first
// (ties: the larger order_item_id first), each as a whole line (every draw, every stock item), until reserved ≤ the
// count or no hidden reserved line is left. A frozen or fired line is never released (its units may leave
// on_hand < reserved, §3.7).
function recountReleases(state: EngineState, stock_item_id: string, count: number, t: number): StockReleasedDraft[] {
  let left = stockOf(state, stock_item_id).reserved;
  if (count >= left) return [];
  const hidden: EngineLine[] = [];
  for (const id in state.lines) {
    const l = state.lines[id]!;
    if (l.reserved_seq !== null && l.draws.some((d) => d.stock_item_id === stock_item_id && d.reserved > 0) && isHiddenUnfired(state, l, t)) hidden.push(l);
  }
  hidden.sort((a, b) => b.reserved_seq! - a.reserved_seq! || byId(b.order_item_id, a.order_item_id));
  const out: StockReleasedDraft[] = [];
  for (const l of hidden) {
    if (left <= count) break;
    out.push(...lineReleases(l, 'recount'));
    left -= l.draws.find((d) => d.stock_item_id === stock_item_id)!.reserved;
  }
  return out;
}

// §3.7 Q14 (v0.6; v0.6.2 G4-3 #2 (ii)): a StockSet that changes the entry's unit while reserved > 0 consumes every
// draw, on every stock item, of each line that holds a reservation on the changing item (in reserved_seq order),
// so the entry enters the new unit with reserved 0 (test 42, 118).
function unitChangeConsumes(state: EngineState, stock_item_id: string): StockConsumedDraft[] {
  const holders: EngineLine[] = [];
  for (const id in state.lines) {
    const l = state.lines[id]!;
    if (l.reserved_seq !== null && l.draws.some((d) => d.stock_item_id === stock_item_id && d.reserved > 0)) holders.push(l);
  }
  holders.sort((a, b) => a.reserved_seq! - b.reserved_seq! || byId(a.order_item_id, b.order_item_id));
  return holders.flatMap(lineConsumes);
}

// §3.7 close (v0.6, G4-2 #5, #11): hidden lines of the orders kept over the close, plus every line of an order out of
// the engine (by the predicate at t, or closed by this close, §3.3 Q13) that still holds a reservation; whole lines,
// by order_item_id. Frozen and fired lines of kept orders keep theirs (they consume at Start, or at Done or Served
// with no Start, AD-29 Q7).
function closeReleases(state: EngineState, t: number): StockReleasedDraft[] {
  const closing = new Set(closedOrderIds(state));
  const out: StockReleasedDraft[] = [];
  for (const id of Object.keys(state.lines).sort(byId)) {
    const l = state.lines[id]!;
    if (l.reserved_seq === null) continue;
    const order = state.orders[l.order_id];
    const out_of_engine = order === undefined || closing.has(l.order_id) || !orderInEngine(state, order, t);
    if (out_of_engine || isHiddenUnfired(state, l, t)) out.push(...lineReleases(l, 'day_closed'));
  }
  return out;
}

// §3.7 move to stock: the line's reservation released 'moved' (if any), then one StockAdded { reason 'moved' } per
// draw, quantity = draw quantity × units ÷ line units (an exact integer, as a void share; else a writer bug, AD-8),
// in the day's unit of the stock item (01a S44; a unit that differs from the entry's is the fold's A-20 breach).
// Proposed (implementer, overnight): a stock item the context does not list uses its entry's unit.
function moveDrafts(state: EngineState, line: EngineLine, units: number, ctx: StockCtx): Array<StockReleasedDraft | StockAddedDraft> {
  const items = new Map(ctx.stockItems.map((s) => [s.stock_item_id, s]));
  const adds: StockAddedDraft[] = [];
  for (const d of line.draws) {
    const quantity = (d.quantity * Math.min(units, line.units)) / line.units;
    if (!Number.isInteger(quantity)) throw new InvalidEvent('move_share_not_integer', line.order_item_id, line.station_id);
    if (quantity === 0) continue;
    const stockItem = items.get(d.stock_item_id);
    const unit = stockItem === undefined ? stockOf(state, d.stock_item_id).unit : dayStockUnit(state, stockItem);
    adds.push({
      stream_type: 'stock',
      stream_id: d.stock_item_id,
      event_type: 'StockAdded',
      schema_version: 2,
      payload: { stock_item_id: d.stock_item_id, quantity, unit, reason: 'moved' },
    });
  }
  return [...lineReleases(line, 'moved'), ...adds];
}

// §3.7 (v0.6.2, G4-3 #2; 03a v1.2 Q-4): the releases of ending `units` of a line. `units` absent or ≥ the line's units
// → every draw's remaining reserved (lineReleases); fewer → each draw's share = quantity × units ÷ line units (exact,
// else AD-8), capped at the draw's reserved.
function shareReleases(line: EngineLine, units: number | undefined, reason: ReleaseReason): StockReleasedDraft[] {
  if (units === undefined || units >= line.units) return lineReleases(line, reason);
  const out: StockReleasedDraft[] = [];
  for (const d of line.draws) {
    const share = (d.quantity * units) / line.units;
    if (!Number.isInteger(share)) throw new InvalidEvent('void_share_not_integer', line.order_item_id, line.station_id);
    const q = Math.min(share, d.reserved);
    if (q > 0) out.push(releasedDraft(d.stock_item_id, line.order_item_id, q, reason));
  }
  return out;
}

// One cause's drafts, split by where they go in the §4.2 batch: `before` the cause (the releases of a recount or
// close, the Q14 consumes of a unit-changing StockSet), `after` it (everything else, in order). `ended`: the lines the
// stockEffects array ends (endedLines), never a waiting-line candidate (04 T-2; empty for one draft).
function effectsOf(state: EngineState, draft: StockCause, ctx: StockCtx | undefined, ended: ReadonlySet<string>): { before: StockDraft[]; after: StockDraft[] } {
  const t = draft.occurred_at;
  const p = draft.payload;
  const none = { before: [], after: [] };
  switch (draft.event_type) {
    // §3.7 consume (P-5): appended with the start (03b's StartItem, the tick's inferred start). AD-29 Q7 (developer): a
    // Done from `added` (AD-10) had no Start, so it consumes the same way. A Done from `cooking` follows a Start, or an
    // Undo of a Done, which consumed already. The tick's inferred Done is only ever from `cooking` (tick.ts doneDue).
    // Proposed (implementer): Undo does not reverse the consume. §3.7 has no event that puts a consumed plate back, a
    // Start's consume survives an Undo too, and the line's reserved_seq stays null, so its next Done drafts nothing.
    case 'ItemStarted':
    case 'ItemDone': {
      const line = namedLine(state, p);
      return line === undefined || line.stage !== 'added' ? none : { before: [], after: lineConsumes(line) };
    }
    // AD-29 Q7 (developer): a Served of a line with no Start consumes what it still holds. ItemServed lists its lines; a
    // closed line (the fold ignores it, AD-10) and a repeated id draft nothing.
    // Proposed (implementer): "no Start" is read as started_at null at any open stage, so a `done` line whose Done wrote
    // no consume still consumes here. Like the Start's, these drafts read the line only: a Done or Served naming a line
    // of an AD-20 kept order, whose fold is a no-op, still consumes (the plate was taken), before the tick's release.
    case 'ItemServed': {
      const after: StockConsumedDraft[] = [];
      for (const id of new Set(p.order_item_ids as string[])) {
        const line = namedLine(state, { order_item_id: id });
        if (line !== undefined && line.started_at === null && isOpen(line)) after.push(...lineConsumes(line));
      }
      return { before: [], after };
    }
    // §3.7 per-cause table: the line itself, at any stage before its Start (a started line's units were consumed).
    // 03a v1.2 Q-4: `units` absent or ≥ the line's units → the whole line; fewer → only those units' share, as a
    // partial ItemVoided (shareReleases), with reason `removed`.
    case 'ItemRemoved': {
      const line = namedLine(state, p);
      if (line === undefined) return none;
      return { before: [], after: shareReleases(line, p.units as number | undefined, 'removed') };
    }
    // §3.7 (v0.6.2, G4-3 #2): a void of the whole line releases every draw's remaining reserved; a partial void
    // only the voided units' share of every draw.
    case 'ItemVoided': {
      const line = namedLine(state, p);
      return line === undefined ? none : { before: [], after: shareReleases(line, p.units as number, 'voided') };
    }
    // §3.7 move to stock (v0.5, G4-1 #13): release + adds, folded in order, then the waiting-line reserve.
    // ⚠️ Changed by 04 (row T-2; G-17): the reserve skips the moved line and every line the array ends.
    case 'ItemMovedToStock': {
      const c = needCtx(ctx, draft.event_type);
      const line = namedLine(state, p);
      if (line === undefined) return none;
      const own = moveDrafts(state, line, p.units as number, c);
      const added = own.filter((d) => d.event_type === 'StockAdded').map((d) => d.payload.stock_item_id);
      if (added.length === 0) return { before: [], after: own };
      return { before: [], after: [...own, ...waitingReserve(bookAll(state, own, t), added, t, c, new Set([...ended, line.order_item_id]))] };
    }
    // §3.7 StockAdded: on_hand += quantity, then the waiting lines of that stock item are reserved.
    case 'StockAdded': {
      const c = needCtx(ctx, draft.event_type);
      return { before: [], after: waitingReserve(book(state, draft, t), [p.stock_item_id as string], t, c, ended) };
    }
    // §3.7 recount / Q14, then (BF-8) the waiting-line reserve on the count as folded.
    case 'StockSet': {
      const c = needCtx(ctx, draft.event_type);
      const sid = p.stock_item_id as string;
      const entry = stockOf(state, sid);
      const before: StockDraft[] =
        p.unit !== entry.unit && entry.reserved > 0 ? unitChangeConsumes(state, sid) : recountReleases(state, sid, p.on_hand as number, t);
      return { before, after: waitingReserve(book(bookAll(state, before, t), draft, t), [sid], t, c, ended) };
    }
    case 'BusinessDayClosed':
      return { before: closeReleases(state, t), after: [] };
    // 03a v1.2 Q-5 (§3.7): a transfer out to a zone drafts nothing (no release, no reserve; its fold only lowers on_hand).
    case 'StockTransferredOut':
      return none;
    // §3.7 Q14 / test 42: no unit_changed path at a day open; any other draft needs nothing.
    default:
      return none;
  }
}

const NONE_ENDED: ReadonlySet<string> = new Set();

// 04 T-2 (G-17): the order_item_ids of every ItemVoided / ItemRemoved in the array.
function endedLines(drafts: readonly StockCause[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const d of drafts) {
    if ((d.event_type === 'ItemVoided' || d.event_type === 'ItemRemoved') && typeof d.payload.order_item_id === 'string') ids.add(d.payload.order_item_id);
  }
  return ids.size === 0 ? NONE_ENDED : ids;
}

// 03a §6.1f (pure): the StockReleased / StockConsumed / StockAdded / StockReserved drafts a triggering draft needs
// (§3.7 per-cause table, Q14, move to stock, StockAdded), evaluated at the draft's occurred_at (the handler's now;
// hidden / frozen as §3.4 at that t). stock_ctx is required for StockAdded, ItemMovedToStock and StockSet (BF-8: a
// StockSet that raises `available` runs the waiting-line reserve); a missing one throws.
//   - One draft: its effects in §4.2 batch order. For StockSet / BusinessDayClosed every StockReleased and
//     StockConsumed is appended BEFORE the draft (its fold re-plans, §3.5.3) and every StockReserved after it; for
//     any other cause all of them follow the draft.
//   - BF-8, an array of the drafts of one command (e.g. several AddPrecookedStock entries), proposed (implementer,
//     overnight): the whole batch in append order — each draft in place with its effects around it — where each
//     draft's effects are computed after the stock bookkeeping of every earlier draft and effect of the command, so
//     a later entry's reserve sees the earlier entries' adds and claims.
// Proposed (implementer, overnight): a StockSet that changes the unit with reserved > 0 consumes (Q14) instead of the
// recount releases, and its reserve then runs on the new count; AD-2's re-reserve of the held lines in the new unit
// (BF-9) is not built (see the task 12b report).
// ⚠️ Changed by 04 (row T-2; G-17), 03a v1.2.4 §3.7: before its loop the array overload collects every line named by
// any ItemVoided / ItemRemoved cause anywhere in the array (earlier or later than a move, whole or partial; an
// ItemRemoved without units counts) and keeps them all out of every waiting-line reserve, so a moved portion never
// goes to a line the array ends (the scratch `book` folds stock events only, so an ended or partly voided line still
// looks like a candidate). The single-draft overload excludes only the moved line; an array without such causes
// passes an empty set (01a / BF-8 unchanged).
export function stockEffects(state: EngineState, draft: StockCause, stock_ctx?: StockCtx): StockDraft[];
export function stockEffects<D extends StockCause>(state: EngineState, drafts: readonly D[], stock_ctx?: StockCtx): Array<D | StockDraft>;
export function stockEffects<D extends StockCause>(state: EngineState, draft: D | readonly D[], stock_ctx?: StockCtx): Array<D | StockDraft> {
  if (!Array.isArray(draft)) {
    const one = effectsOf(state, draft as D, stock_ctx, NONE_ENDED);
    return [...one.before, ...one.after];
  }
  const ended = endedLines(draft as readonly D[]);
  let scratch = state;
  const out: Array<D | StockDraft> = [];
  for (const d of draft as readonly D[]) {
    const { before, after } = effectsOf(scratch, d, stock_ctx, ended);
    out.push(...before, d, ...after);
    scratch = bookAll(scratch, [...before, d, ...after], d.occurred_at);
  }
  return out;
}
