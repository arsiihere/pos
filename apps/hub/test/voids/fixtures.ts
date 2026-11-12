// 04 shared test fixtures (phase 0 P0.8, 04 §10): every 04 lane (V1, V2, A1, T1) seeds through these. Built on 02b's
// test/orders/fixtures.ts and 03b's test/kds/fixtures.ts (re-used, not copied): every row comes from real events
// through the hub's real writer. Words as 04 §3.1: engine line, header, not started.
import type { VoidDisposition, VoidReasonCode } from '@pos/domain';
import { applyEvents, initialEngineState, isEngineLine, type EngineState } from '@pos/engine';
import { parseEvent, type AlertDisplay, type BranchConfig, type ConfigItem, type DirectoryInput, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { alerts } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import type { CommandCtx } from '../../src/commands/registry';
import type { LineView } from '../../src/orders/contracts';
import { orderLines } from '../../src/orders/exports';
import { planVoid } from '../../src/orders/ledger';
import { branchConfig } from '../../src/sync/branch-config-holder';
import { currentTableOf } from '../../src/tables/reads';
import { VOID_KIND } from '../../src/voids/contracts';
import type { VoidValues } from '../../src/voids/kind';
import { aDirectory, PIN } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { append, appendOrder, FX, fixtureMenu, fireLines, openDay, openSeating, serveLines } from '../kds/fixtures';
import type { FixtureLine } from '../orders/fixtures';

export { append, appendOrder, FX, fireLines, openDay, openSeating, PIN, serveLines };
export { removeLine, voidLine } from '../kds/fixtures';
export { setZoneStock, type FixtureLine } from '../orders/fixtures';

/** The ids voidsMenu() adds to FX. */
export const VX = {
  /** piece item on S1, cook 60 min: a `hold` line, so the order's other sync lines fire late (hidden) */
  slow: 'I_SLOW',
  /** stock-tracked naan on S1: 1 piece of K_NAAN per piece (spike 0, test 10: "2 of 4 naan") */
  stockNaan: 'I_TNAAN',
  naanStock: 'K_NAAN',
  /** cold drink; its ItemAdded has no station (§3.1: not an engine line) */
  drink: 'I_LASSI',
  drinkOptionGroup: 'M_DRINK',
  /** option of I_LASSI linked to I_SUGARFREE; its option_child line has no station either */
  drinkOption: 'O_SUGARFREE',
  drinkOptionItem: 'I_SUGARFREE',
  tables: { T4: 'T4', T5: 'T5', T6: 'T6', T7: 'T7', T8: 'T8', T12: 'T12' },
  /** three tables named so that their " + " label is over 40 chars (§3.5) */
  longTables: ['G1', 'G2', 'G3'],
  managerRole: 'R_MGR',
} as const;

/** aDirectory()'s people (PIN.b = Manager, PIN.c = Cashier, PIN.a = Order taker). */
export const STAFF = { manager: 'S_MGR', cashier: 'S_CASH', orderTaker: 'S_WAIT' } as const;

/** fixtureMenu() plus VX: the slow item, the stock-tracked naan, the station-less drink and its option, more tables. */
export function voidsMenu(): BranchConfig {
  const menu = fixtureMenu();
  const plain = menu.items.find((i) => i.item_id === FX.naan)!;
  const item = (item_id: string, name: string, sort_order: number, o: Partial<ConfigItem>): ConfigItem => ({ ...plain, item_id, name, sort_order, ...o });
  const table = (table_id: string, name: string, sort_order: number) => ({ table_id, name, seats: 4, sort_order, zone_id: null });
  const floor = menu.floors[0]!;
  return {
    ...menu,
    stock_items: [...menu.stock_items, { stock_item_id: VX.naanStock, name: 'Naan dough', stock_unit: 'piece', carries_over: false, station_id: FX.station, low_stock_threshold: null }],
    floors: [
      {
        ...floor,
        tables: [
          ...floor.tables,
          ...Object.values(VX.tables).map((id, i) => table(id, id, 10 + i)),
          ...VX.longTables.map((id, i) => table(id, `Garden East ${i + 1}`, 20 + i)),
        ],
      },
    ],
    modifier_groups: [
      ...menu.modifier_groups,
      {
        modifier_group_id: VX.drinkOptionGroup,
        name: 'Sugar',
        min_choices: 0,
        max_choices: 1,
        sort_order: 1,
        has_plain_options: false,
        options: [{ option_id: VX.drinkOption, name: 'Sugar-free', price_minor: 0, max_quantity: 1, is_default: false, linked_item_id: VX.drinkOptionItem, sort_order: 0 }],
      },
    ],
    items: [
      ...menu.items,
      item(VX.slow, 'Sajji', 10, { price_minor: 200_000, cook_time_ms: 3_600_000 }),
      item(VX.stockNaan, 'Tandoori naan', 11, { stock_time_ms: 60_000, stock_draws: [{ stock_item_id: VX.naanStock, quantity_per_sale_unit: 1 }] }),
      // Config rows keep their home station S1 (ConfigItem.station_id is a required string; appendOrder resolves the item
      // here). Only servedColdDrink's ItemAdded is station-less: synthetic, see there.
      item(VX.drink, 'Lassi', 12, { price_minor: 25_000, cook_time_ms: 0, modifier_group_ids: [VX.drinkOptionGroup] }),
      item(VX.drinkOptionItem, 'Sugar-free', 13, { price_minor: 0, cook_time_ms: 0 }),
    ],
  };
}

/** aDirectory() with 04 §10 test 32's defaults: Cashier and Order taker `void-item` requires approval by Manager, `move-item-to-stock` allowed. */
export async function voidsDirectory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const askManager = { permission: 'void-item' as const, grant_type: 'requires_approval' as const, approver_role_id: VX.managerRole, approver_role_ids: [VX.managerRole], scope: 'branch' as const };
  const move = { permission: 'move-item-to-stock' as const, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'branch' as const };
  return {
    ...base,
    roles: base.roles.map((r) => (r.role_id === 'R_CASH' || r.role_id === 'R_WAIT' ? { ...r, permissions: [...r.permissions, askManager, move] } : r)),
  };
}

/**
 * A hub with voidsDirectory() seeded and voidsMenu()'s day open. `stock` = the day's StockSet counts; default K1 and K_NAAN
 * counted at 0: every tracked line cooks fresh, and an add or a move (valid count, 01a S41) reaches the waiting lines.
 */
export async function startVoids(o: { stock?: Record<string, number>; directory?: DirectoryInput; open?: boolean } = {}): Promise<TestHub> {
  const hub = await createTestHub();
  await seedDirectory(hub, o.directory ?? (await voidsDirectory()));
  if (o.open !== false) openVoidsDay(hub, o);
  return hub;
}

/** voidsMenu()'s day open at the clock's date (startVoids does it unless `open: false`, e.g. after earlierDayTakeaway). */
export function openVoidsDay(hub: TestHub, o: { stock?: Record<string, number> } = {}): { business_date: string } {
  return openDay(hub, { menu: voidsMenu(), stock: o.stock ?? { [FX.stock]: 0, [VX.naanStock]: 0 } });
}

// ------------------------------------------------------------------------------------------- sign-in

export interface Who {
  staffId: string;
  deviceId: string;
  token: string;
  sessionId: string;
  sessionToken: string;
}

/** A new tablet and a staff session on it. */
export function signIn(hub: TestHub, staffId: string): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionId: session.sessionId, sessionToken: session.token };
}

// ------------------------------------------------------------------------------------------- orders

/** Where a fixture order goes: takeaway unless `seating_id` (an open seating); `hold` adds a VX.slow line so the other sync lines are hidden. */
export interface Where {
  seating_id?: string;
  hold?: boolean;
  /** prefix of the fixture's order_item_ids (default per fixture), to place one fixture twice in a hub */
  prefix?: string;
  placed_by?: string;
}

function place(hub: TestHub, lines: FixtureLine[], w: Where, prefix: string): string {
  const all = w.hold === true ? [...lines, { order_item_id: `${prefix}_HOLD`, item_id: VX.slow }] : lines;
  const placed_by = w.placed_by ?? STAFF.orderTaker;
  const o = w.seating_id === undefined ? { order_type: 'takeaway' as const } : { order_type: 'dine_in' as const, seating_id: w.seating_id };
  return appendOrder(hub, { ...o, placed_by, lines: all }).order_id;
}

/** ItemStarted / ItemDone / ItemServed (source tap) after a FireDispatched at each line's station; lines not yet at `stage`. */
export function toStage(hub: TestHub, order_id: string, ids: string[], stage: 'cooking' | 'done' | 'served'): void {
  const lines = () => (hub.deps.state.get() as EngineState).lines;
  const unfired = ids.filter((id) => lines()[id]?.fired_at === null);
  for (const station of new Set(unfired.map((id) => lines()[id]!.station_id))) fireLines(hub, station, unfired.filter((id) => lines()[id]!.station_id === station));
  const on = (event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
  const at = () => hub.clock.branchNow() + 1_000; // append advances 1 s first
  const want = ['added', 'cooking', 'done', 'served'].indexOf(stage);
  const ofStage = (s: number) => ids.filter((id) => ['added', 'cooking', 'done', 'served'].indexOf(lines()[id]?.stage ?? 'served') < s);
  for (const id of want >= 1 ? ofStage(1) : []) append(hub, [on('ItemStarted', { order_item_id: id, started_at: at(), source: 'tap' })]);
  for (const id of want >= 2 ? ofStage(2) : []) append(hub, [on('ItemDone', { order_item_id: id, done_at: at(), source: 'tap' })]);
  const toServe = want >= 3 ? ofStage(3) : [];
  if (toServe.length > 0) serveLines(hub, order_id, toServe);
}

/** An order with a cooking stock-tracked karahi (500 g of K1), a done naan and a served naan (tests 1, 2, 4, 12, 21). */
export function stagedOrder(hub: TestHub, w: Where = {}): { order_id: string; cooking: string; done: string; served: string } {
  const p = w.prefix ?? 'SO';
  const ids = { cooking: `${p}_K`, done: `${p}_ND`, served: `${p}_NS` };
  const order_id = place(hub, [
    { order_item_id: ids.cooking, item_id: FX.piece },
    { order_item_id: ids.done, item_id: FX.naan },
    { order_item_id: ids.served, item_id: FX.naan },
  ], w, p);
  toStage(hub, order_id, [ids.cooking], 'cooking');
  toStage(hub, order_id, [ids.done], 'done');
  toStage(hub, order_id, [ids.served], 'served');
  return { order_id, ...ids };
}

/**
 * The "T4 line" of 04 §6.8 / tests 10c–10h: a karahi on a dine-in order at T4 that is hidden (not fired, fire beyond
 * the freeze), not from stock and unreserved — the waiting line a moved portion reserves. Needs K1 unavailable at
 * placement (startVoids' default). `seating_id` given → that open seating, else a new one on T4.
 * Why `hold` is the real hidden case: 03a's hidden test (isHiddenUnfired) only asks that the line be placed, unfired, at
 * `added`, with fire_ms > now + freeze_ms. In service that comes from a later pickup or a long sync sibling; here the
 * 60-min VX.slow line in the same sync group pushes the karahi's fire ~40 min out (appendOrder has no pickup_at_ms).
 * Every StockAdded candidate check (isCandidate: from_stock false, a draw, a stock cook time, order in the engine)
 * reads the same fields either way.
 */
export function waitingT4(hub: TestHub, w: Where = {}): { order_id: string; seating_id: string; line: string } {
  const p = w.prefix ?? 'T4';
  const seating_id = w.seating_id ?? `SEAT_${p}`;
  if (w.seating_id === undefined) openSeating(hub, { table_id: VX.tables.T4, seating_id });
  const line = `${p}_K`;
  const order_id = place(hub, [{ order_item_id: line, item_id: FX.piece }], { ...w, seating_id, hold: true }, p);
  if ((hub.deps.state.get() as EngineState).lines[line]?.from_stock !== false) throw new Error('waitingT4: K1 must be unavailable when the T4 line is placed');
  return { order_id, seating_id, line };
}

/** A deal ×2 (FX.deal): header (not an engine line), karahi part ×2 (1 000 g of K1), naan part ×4; all at added (tests 10c, 10f, 10h, 11b, 14b, 20, 26c, 40). */
export function dealX2(hub: TestHub, w: Where = {}): { order_id: string; deal: string; karahiPart: string; naanPart: string } {
  const p = w.prefix ?? 'DL';
  const ids = { deal: p, karahiPart: `${p}_P1`, naanPart: `${p}_P2` };
  const order_id = place(hub, [
    { order_item_id: ids.deal, deal_id: FX.deal, quantity: 2 },
    { order_item_id: ids.karahiPart, deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: ids.deal },
    { order_item_id: ids.naanPart, deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: ids.deal },
  ], w, p);
  return { order_id, ...ids };
}

/** A karahi with its Raita option child, the child an engine line on its own station; both at added (tests 4c, 4d, 42). */
export function optionChildOrder(hub: TestHub, w: Where = {}): { order_id: string; item: string; child: string } {
  const p = w.prefix ?? 'OC';
  const ids = { item: `${p}_K`, child: `${p}_R` };
  const order_id = place(hub, [
    { order_item_id: ids.item, item_id: FX.piece },
    { order_item_id: ids.child, option_id: FX.option, parent_order_item_id: ids.item },
  ], w, p);
  return { order_id, ...ids };
}

/**
 * A cold drink with its Sugar-free option child, neither an engine line (no station on their ItemAdded); both served
 * (`served: false` → neither served) (tests 4b, 4e, 4f).
 * Synthetic: SubmitOrder never emits a non-deal null-station line today; 04 V1 (c)/(d) and T-3 cover it defensively,
 * so the ItemAdded override sets `station_id: null` (nullable, 01c §4.3) while the config rows keep S1.
 */
export function servedColdDrink(hub: TestHub, w: Where & { served?: boolean } = {}): { order_id: string; drink: string; option: string } {
  const p = w.prefix ?? 'DR';
  const ids = { drink: `${p}_L`, option: `${p}_SF` };
  const order_id = place(hub, [
    { order_item_id: ids.drink, item_id: VX.drink, item: { station_id: null } },
    { order_item_id: ids.option, option_id: VX.drinkOption, parent_order_item_id: ids.drink, item: { station_id: null } },
  ], w, p);
  if (w.served !== false) serveLines(hub, order_id, [ids.drink, ids.option]);
  return { order_id, ...ids };
}

/** A served karahi sent back with the real ReturnToKitchen `remake` by the Manager: the return line is at added (tests 5, 45). */
export async function remakeLine(hub: TestHub, w: Where & { by?: Who } = {}): Promise<{ order_id: string; served: string; remake: string }> {
  const p = w.prefix ?? 'RM';
  const ids = { served: `${p}_K`, remake: `${p}_KR` };
  const order_id = place(hub, [{ order_item_id: ids.served, item_id: FX.piece }], w, p);
  toStage(hub, order_id, [ids.served], 'served');
  const r = await post(hub, w.by ?? signIn(hub, STAFF.manager), 'return-to-kitchen', 'ReturnToKitchen', { order_item_id: ids.served, return_order_item_id: ids.remake, mode: 'remake' });
  if (r.status !== 200) throw new Error(`remakeLine: ReturnToKitchen ${r.status} ${JSON.stringify(r.error)}`);
  return { order_id, ...ids };
}

/** A weighed fish line, weight pending (`quantity` NULL), at cooking (test 6). */
export function pendingWeight(hub: TestHub, w: Where = {}): { order_id: string; line: string } {
  const line = `${w.prefix ?? 'PW'}_F`;
  const order_id = place(hub, [{ order_item_id: line, item_id: FX.gram }], w, w.prefix ?? 'PW');
  toStage(hub, order_id, [line], 'cooking');
  return { order_id, line };
}

/**
 * A takeaway with one naan at added (test 20 `#<token>`). `token` given → empty takeaways (real OrderPlaced, no lines)
 * take the tokens before it, so this order gets exactly `token` (e.g. 12 for 20c's `#12`).
 */
export function takeawayOrder(hub: TestHub, w: Omit<Where, 'seating_id'> & { token?: number } = {}): { order_id: string; token: number; line: string } {
  const line = `${w.prefix ?? 'TW'}_N`;
  if (w.token !== undefined) {
    const next = () => (hub.deps.db.prepare(`SELECT COALESCE(MAX(token), 0) + 1 AS n FROM orders WHERE order_type = 'takeaway' AND business_date = (SELECT business_date FROM orders ORDER BY placed_at DESC LIMIT 1)`).get() as { n: number }).n;
    for (let n = next(); n < w.token; n += 1) appendOrder(hub, { order_type: 'takeaway', placed_by: w.placed_by ?? STAFF.orderTaker, lines: [] });
  }
  const order_id = place(hub, [{ order_item_id: line, item_id: FX.naan }], w, w.prefix ?? 'TW');
  if (w.token !== undefined && (hub.deps.db.prepare('SELECT token FROM orders WHERE order_id = ?').get(order_id) as { token: number }).token !== w.token) {
    throw new Error(`takeawayOrder: token ${w.token} already passed today`);
  }
  const { token } = hub.deps.db.prepare('SELECT token FROM orders WHERE order_id = ?').get(order_id) as { token: number };
  return { order_id, token, line };
}

/** A parking order (car `LEB 1234`, sedan) with one naan at added (test 20 `PARKING LEB 1234 SEDAN`). */
export function parkingOrder(hub: TestHub, o: { car_number?: string; prefix?: string; placed_by?: string } = {}): { order_id: string; line: string } {
  const line = `${o.prefix ?? 'PK'}_N`;
  const { order_id } = appendOrder(hub, { order_type: 'parking', car_number: o.car_number ?? 'LEB 1234', placed_by: o.placed_by ?? STAFF.orderTaker, lines: [{ order_item_id: line, item_id: FX.naan }] });
  return { order_id, line };
}

/**
 * Test 20c `#12 10 Nov`: a takeaway of an earlier business day. On a hub started with `open: false`: the clock moves to
 * `date` (local noon, not before now), a real BusinessDayOpened, the takeaway with `token`, a real BusinessDayClosed,
 * then the clock moves to the next day's noon. The caller then opens today with openVoidsDay.
 */
export function earlierDayTakeaway(hub: TestHub, o: { date?: string; token?: number; prefix?: string } = {}): { order_id: string; token: number; business_date: string } {
  if ((hub.deps.state.get() as EngineState).business_day !== null) throw new Error('earlierDayTakeaway: start with startVoids({ open: false })');
  if (o.date !== undefined) {
    const at = new Date(`${o.date}T12:00:00`).getTime();
    if (at < hub.clock.branchNow()) throw new Error(`earlierDayTakeaway: ${o.date} is before the clock`);
    hub.clock.set(at);
  }
  const { business_date } = openVoidsDay(hub);
  const t = takeawayOrder(hub, { prefix: o.prefix ?? 'ED', token: o.token ?? 12 });
  append(hub, [{ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: 'BusinessDayClosed', payload: {} }], { actor: STAFF.manager });
  const noon = new Date(`${business_date}T12:00:00`);
  noon.setDate(noon.getDate() + 1);
  hub.clock.set(noon.getTime());
  return { order_id: t.order_id, token: t.token, business_date };
}

// ------------------------------------------------------------------------------------------- seatings (§3.5, test 20c)

const onTable = (table_id: string, event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'table' as const, stream_id: table_id, event_type, payload });

/** One open seating per table with one naan order each; returns the orders in table order. */
function seatEach(hub: TestHub, tables: readonly string[], p: string): Array<{ seating_id: string; order_id: string }> {
  return tables.map((table_id) => {
    const seating_id = `SEAT_${p}_${table_id}`;
    openSeating(hub, { table_id, seating_id });
    return { seating_id, order_id: place(hub, [{ order_item_id: `${p}_${table_id}_N`, item_id: FX.naan }], { seating_id }, p) };
  });
}

/** T4 and T5 each seated with an order; T5's seating absorbed into T4's by 02a's TablesMerged: label `T4 + T5`. */
export function mergedSeating(hub: TestHub, o: { prefix?: string } = {}): { seating_id: string; order_ids: string[]; table_ids: string[] } {
  const [t4, t5] = seatEach(hub, [VX.tables.T4, VX.tables.T5], o.prefix ?? 'MG');
  append(hub, [onTable(VX.tables.T4, 'TablesMerged', { into_seating_id: t4!.seating_id, into_table_id: VX.tables.T4, table_ids: [VX.tables.T5], absorbed_seating_id: t5!.seating_id, order_ids: [t5!.order_id], by_staff_id: STAFF.manager })]);
  return { seating_id: t4!.seating_id, order_ids: [t4!.order_id, t5!.order_id], table_ids: [VX.tables.T4, VX.tables.T5] };
}

/** T6 seated, then free T7 and T8 joined by one TablesMerged: T7 and T8 share `joined_at` (03b's order breaks the tie by table_id). */
export function tieMerge(hub: TestHub, o: { prefix?: string } = {}): { seating_id: string; order_id: string; table_ids: string[] } {
  const [t6] = seatEach(hub, [VX.tables.T6], o.prefix ?? 'TM');
  const joined = [VX.tables.T7, VX.tables.T8];
  append(hub, [onTable(VX.tables.T6, 'TablesMerged', { into_seating_id: t6!.seating_id, into_table_id: VX.tables.T6, table_ids: joined, absorbed_seating_id: null, order_ids: [], by_staff_id: STAFF.manager })]);
  return { seating_id: t6!.seating_id, order_id: t6!.order_id, table_ids: [VX.tables.T6, ...joined] };
}

/** G1 seated, G2 and G3 joined one at a time: `Garden East 1 + Garden East 2 + Garden East 3` (> 40 chars). */
export function longLabelSeating(hub: TestHub, o: { prefix?: string } = {}): { seating_id: string; order_id: string; label: string } {
  const [g1, ...rest] = VX.longTables;
  const [seat] = seatEach(hub, [g1], o.prefix ?? 'LL');
  for (const t of rest) append(hub, [onTable(g1, 'TablesMerged', { into_seating_id: seat!.seating_id, into_table_id: g1, table_ids: [t], absorbed_seating_id: null, order_ids: [], by_staff_id: STAFF.manager })]);
  const names = branchConfig()!.floors.flatMap((f) => f.tables);
  const label = VX.longTables.map((id) => names.find((t) => t.table_id === id)!.name).join(' + ');
  return { seating_id: seat!.seating_id, order_id: seat!.order_id, label };
}

/**
 * G-14: an order whose seating is closed (02a TableCleaned): no currentTableOf entry (seating_tables rows deleted),
 * while the seatings row keeps its primary_table_id; the engine still has the order's table (T12).
 */
export function closedSeating(hub: TestHub, o: { prefix?: string } = {}): { seating_id: string; order_id: string } {
  const [seat] = seatEach(hub, [VX.tables.T12], o.prefix ?? 'CS');
  append(hub, [onTable(VX.tables.T12, 'TableCleaned', { seating_id: seat!.seating_id, table_ids: [VX.tables.T12], reason: 'cleaned', by_staff_id: STAFF.manager })]);
  return seat!;
}

/**
 * Test 20c "no current table" (other than the closed seating): an open seating whose only table was detached by 02a's
 * SeatingSplit fold (`new_seating_id: null`): seating_tables row deleted, seating still SEATED → no currentTableOf entry,
 * `primary_table_id` T2; the engine keeps the order's table at submit. Fold-level: 02a's SplitSeating command refuses to
 * detach a primary (TABLE_NOT_FREE), and SubmitOrder refuses a closed seating, so no command reaches this today.
 */
export function noCurrentTable(hub: TestHub, o: { prefix?: string } = {}): { seating_id: string; order_id: string } {
  const [seat] = seatEach(hub, [FX.table], o.prefix ?? 'NT');
  append(hub, [onTable(FX.table, 'SeatingSplit', { from_seating_id: seat!.seating_id, new_seating_id: null, to_table_id: FX.table, order_ids: [], by_staff_id: STAFF.manager })]);
  return seat!;
}

/** 10f–10h: the whole event log re-folded from nothing in strict mode (03a applyEvents); throws on a writer bug or breach. */
export function strictRefold(hub: TestHub): EngineState {
  const rows = hub.deps.db.prepare('SELECT * FROM events ORDER BY seq').all() as Array<Record<string, unknown> & { payload: string }>;
  const log = rows.map((row) => parseEvent({ ...row, payload: JSON.parse(row.payload) as PosEvent['payload'] }));
  return applyEvents(initialEngineState(), log, { strict: true });
}

// ------------------------------------------------------------------------------------------- 01d requests

export interface RaiseVoid {
  requester: Who;
  order_id: string;
  order_item_id: string;
  /** default: all live units of the named line */
  units?: number;
  reason_code?: VoidReasonCode;
  note?: string | null;
  disposition?: VoidDisposition;
  disposition_note?: string | null;
  /** default: each touched line gets `disposition`, a header (§3.1, engine lines = lines in engine state) null */
  line_dispositions?: Record<string, VoidDisposition | null>;
  /** details.identifier (§3.5); v6 builds the real one */
  identifier?: string;
}

/**
 * Raises one `void_approval` request through 01d's real `alerts.raiseMany`, as VoidItems' approval path will (v6):
 * §3.5 values from 02b's planVoid on the projection (touched_ids, refund_minor, comp_voided_minor), dedupe
 * `void:<order_item_id>`, approvers = the requester's `void-item` grant. Nothing applied (no ItemVoided).
 */
export function raiseVoid(hub: TestHub, r: RaiseVoid): { alert_id: string; deduped: boolean; values: VoidValues } {
  const lines = orderLines(hub.deps.db, [r.order_id]).get(r.order_id)!;
  const named = lines.find((l) => l.order_item_id === r.order_item_id);
  if (named === undefined) throw new Error(`raiseVoid: no line ${r.order_item_id} on ${r.order_id}`);
  const childKind = named.line_kind === 'deal' ? 'deal_part' : named.line_kind === 'item' ? 'option_child' : null;
  const children = lines.filter((l) => l.parent_order_item_id === named.order_item_id && l.line_kind === childKind);
  const plan = planVoid(named, children, r.units ?? named.units - named.removed_units - named.voided_units);
  const units = r.units ?? plan.lines[0]!.units;
  const disposition = r.disposition ?? 'wastage';
  const touched = plan.lines.map((l) => l.order_item_id);
  const line_dispositions = r.line_dispositions ?? perLine(hub, lines, named.order_item_id, touched, disposition);
  const note = r.note ?? null;
  const reason_code = r.reason_code ?? 'customer_changed_mind';
  const values: VoidValues = {
    order_id: r.order_id,
    order_item_id: r.order_item_id,
    units,
    reason_code,
    note,
    disposition,
    disposition_note: r.disposition_note ?? null,
    touched_ids: touched,
    line_dispositions,
    refund_minor: plan.refund_minor,
    comp_voided_minor: plan.comp_voided_minor,
  };
  const directory = currentDirectory(hub.app);
  const grant = directory.resolve(r.requester.staffId, 'void-item');
  const primary = currentTableOf(hub.deps.db, [r.order_id]).get(r.order_id)?.primary_table_id ?? null;
  const display: AlertDisplay = {
    kind_label_key: 'alert.void_approval.lock',
    table_code: primary === null ? null : (branchConfig()?.floors.flatMap((f) => f.tables).find((t) => t.table_id === primary)?.name ?? primary),
    requester_name: directory.get(r.requester.staffId)?.display_name ?? null,
  };
  const reason = (note === null ? reason_code : `${reason_code}: ${note}`).slice(0, 200);
  const details = { item: named.name, quantity: units, amount: plan.refund_minor, reason, ...(r.identifier === undefined ? {} : { identifier: r.identifier }) };
  const raised = hub.deps.writer.run((tx) => {
    const ctx = {
      tx,
      state: tx.state,
      clock: tx.clock,
      ids: tx.ids,
      actor: { kind: 'device', staffId: r.requester.staffId, stationId: null, sessionId: r.requester.sessionId, deviceId: r.requester.deviceId },
      branch: { tenantId: 'tenant-a', branchId: 'branch-1' },
      directory,
      permission: grant,
      queuedAt: null,
    } as unknown as CommandCtx;
    const [res] = alerts.raiseMany(ctx, [
      {
        kind: VOID_KIND,
        subject: { stream_type: 'order', stream_id: r.order_id },
        target: { kind: 'answerers' },
        values,
        details,
        display,
        dedupe_key: `void:${r.order_item_id}`,
        requester_staff_id: r.requester.staffId,
        request: { approver_role_ids: 'approver_role_ids' in grant ? grant.approver_role_ids : [] },
      },
    ]);
    if (!res!.deduped) tx.append(res!.events);
    return res!;
  }).result;
  return { alert_id: raised.alert_id, deduped: raised.deduped, values };
}

/**
 * V3 / §3.1 per-line dispositions, in this order: a header → null; a not-started line → null; `moved` → `moved` only on an
 * engine line open in the engine at cooking / done with a draw, else `wastage`; otherwise the chosen disposition.
 * Engine line = isEngineLine on each touched line's ItemAdded (one events statement).
 */
function perLine(hub: TestHub, lines: LineView[], named: string, touched: string[], disposition: VoidDisposition): Record<string, VoidDisposition | null> {
  const added = new Map(
    (hub.deps.db
      .prepare(`SELECT payload FROM events WHERE event_type = 'ItemAdded' AND json_extract(payload, '$.order_item_id') IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify([...touched, ...lines.filter((l) => touched.includes(l.order_item_id)).map((l) => l.parent_order_item_id ?? '')])) as Array<{ payload: string }>)
      .map((r) => JSON.parse(r.payload) as ItemAddedPayload)
      .map((p) => [p.order_item_id, p]),
  );
  const state = hub.deps.state.get() as EngineState;
  const view = (id: string) => lines.find((l) => l.order_item_id === id)!;
  const engine = (id: string) => added.get(id) !== undefined && isEngineLine(added.get(id)!);
  const notStarted = (id: string): boolean => {
    if (engine(id)) return state.lines[id]?.stage === 'added'; // absent from the engine counts as started (§3.1)
    const parent = view(id).parent_order_item_id;
    if (view(id).line_kind === 'option_child' && parent !== null && engine(parent)) return notStarted(parent);
    return view(id).served_at === null;
  };
  const header = (id: string) =>
    id === named && (view(id).line_kind === 'deal' || (view(id).line_kind === 'item' && !engine(id) && touched.some((t) => t !== id && engine(t))));
  const movable = (id: string) => {
    const l = state.lines[id];
    return engine(id) && l !== undefined && (l.stage === 'cooking' || l.stage === 'done') && l.draws.length > 0;
  };
  return Object.fromEntries(
    touched.map((id) => [id, header(id) || notStarted(id) ? null : disposition === 'moved' ? (movable(id) ? 'moved' : 'wastage') : disposition]),
  );
}

export interface Reply {
  status: number;
  result: Record<string, unknown> | undefined;
  events: Array<{ event_type: string; stream_type: string; stream_id: string; actor_id: string | null; device_id: string; payload: Record<string, unknown> }>;
  error?: { code: string; details: Record<string, unknown> };
}

let commandSeq = 0;

/** POST /commands/<path> as `who`; the reply's events read back from the store in seq order. */
export async function post(hub: TestHub, who: Who, path: string, command_type: string, payload: Record<string, unknown>, commandId?: string): Promise<Reply> {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: { command_id: commandId ?? `v-cmd-${commandSeq}`, tenant_id: 'tenant-a', branch_id: 'branch-1', command_type, payload, occurred_at: hub.clock.branchNow(), actor_id: who.staffId, device_id: who.deviceId },
  });
  const body = res.json() as { data?: { event_ids: string[]; result: Record<string, unknown> }; error?: { code: string; details: Record<string, unknown> } };
  const rows =
    body.data === undefined
      ? []
      : (hub.deps.db
          .prepare(
            `SELECT event_type, stream_type, stream_id, actor_id, device_id, payload FROM events
              WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`,
          )
          .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Reply['events'][number], 'payload'> & { payload: string }>);
  return {
    status: res.statusCode,
    result: body.data?.result,
    events: rows.map((e) => ({ ...e, payload: JSON.parse(e.payload) as Record<string, unknown> })),
    ...(body.error === undefined ? {} : { error: { code: body.error.code, details: body.error.details } }),
  };
}

const PIN_OF: Record<string, string> = { [STAFF.manager]: PIN.b, [STAFF.cashier]: PIN.c, [STAFF.orderTaker]: PIN.a, S_OWNER: PIN.a };

/**
 * 01d's real commands on a request: approve / reject = AnswerRequest (method pin, `who`'s PIN from aDirectory unless
 * given); withdraw = WithdrawRequest (`who` must be the requester). Approve runs the kind's `apply`, which throws
 * "not built" until v7.
 */
export function answer(hub: TestHub, who: Who, alert_id: string, decision: 'approve' | 'reject' | 'withdraw', pin?: string): Promise<Reply> {
  if (decision === 'withdraw') return post(hub, who, 'withdraw-request', 'WithdrawRequest', { alert_id });
  return post(hub, who, 'answer-request', 'AnswerRequest', { alert_id, decision, method: 'pin', pin: pin ?? PIN_OF[who.staffId] ?? PIN.a });
}
