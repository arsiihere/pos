// 02b shared test fixtures (plan "Parallel waves" rule 2): every lane seeds orders through these. Everything goes
// through the hub's real writer as real events (never a direct row insert), so the projections, the engine and
// 02a's folds see what a real submit writes (02b §3.2 step 10, without the lock drafts: no table lock is taken).
import { allocateDealMinor, childQuantity, lineTotalMinor } from '@pos/domain';
import { checkOrderable, dayDraws, openDayStartMs, planOrder, reserveStock, type EngineState, type ProposedLine, type ProposedOrder } from '@pos/engine';
import { isStockTracked, type BranchConfig, type ConfigItem, type EventDraft, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import type { WriterTx } from '../../src/engine-host/writer';
import { branchConfig, runBranchConfigHooks, swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { TestHub } from '../helpers/test-hub';

/** The ids of fixtureMenu(). */
export const FX = {
  station: 'S1',
  zoneStation: 'S2',
  stock: 'K1',
  /** piece item on S1 drawing 500 g of K1 per piece (stock-tracked, cook_fresh); has the option group */
  piece: 'I_KARAHI',
  /** g item, requires weighing (quantity null until SetLineWeight) */
  gram: 'I_FISH',
  /** plain piece item on S1; the zone routes it to S2 */
  naan: 'I_NAAN',
  /** the item linked to option O_RAITA (its option_child line) */
  optionItem: 'I_RAITA',
  option: 'O_RAITA',
  optionGroup: 'M_SIDES',
  /** deal: part DP_MAIN (1 × I_KARAHI), part DP_BREAD (2 × I_NAAN) */
  deal: 'D_COMBO',
  dealParts: ['DP_MAIN', 'DP_BREAD'] as const,
  /** is_ready_item: an engine line that is never food (§3.3) */
  ready: 'I_WATER',
  /** zone stock item of Z1 (piece, not weighed) */
  zoneItem: 'I_COLA',
  floor: 'F1',
  zone: 'Z1',
  /** table in zone Z1 */
  zoneTable: 'T1',
  /** table without a zone */
  table: 'T2',
} as const;

/** A V4 branch config: aBranchConfig's S1 / K1 / engine settings plus the 02b shapes of FX. */
export function fixtureMenu(): BranchConfig {
  const base = aBranchConfig();
  const s1 = base.stations[0]!;
  const plain = base.items.find((i) => i.item_id === 'I2')!; // Mutton Karahi: piece, S1, sync, 20 min, no stock
  const item = (item_id: string, name: string, sort_order: number, o: Partial<ConfigItem> = {}): ConfigItem => ({
    ...plain,
    item_id,
    name,
    sort_order,
    ...o,
  });
  return {
    ...base,
    stations: [s1, { ...s1, station_id: FX.zoneStation, name: 'Counter' }],
    variant_groups: [],
    floors: [
      {
        floor_id: FX.floor,
        name: 'Ground',
        sort_order: 0,
        zones: [
          {
            zone_id: FX.zone,
            name: 'Front',
            sort_order: 0,
            is_archived: false,
            routes: [{ item_id: FX.naan, station_id: FX.zoneStation }],
            stock_items: [{ item_id: FX.zoneItem, threshold: 2 }],
          },
        ],
        tables: [
          { table_id: FX.zoneTable, name: 'T1', seats: 4, sort_order: 0, zone_id: FX.zone },
          { table_id: FX.table, name: 'T2', seats: 4, sort_order: 1, zone_id: null },
        ],
      },
    ],
    modifier_groups: [
      {
        modifier_group_id: FX.optionGroup,
        name: 'Sides',
        min_choices: 0,
        max_choices: 1,
        sort_order: 0,
        has_plain_options: false,
        options: [{ option_id: FX.option, name: 'Raita', price_minor: 10_000, max_quantity: 5, is_default: false, linked_item_id: FX.optionItem, sort_order: 0 }],
      },
    ],
    items: [
      item(FX.piece, 'Chicken Karahi', 1, {
        stock_time_ms: 300_000,
        stock_draws: [{ stock_item_id: FX.stock, quantity_per_sale_unit: 500 }],
        modifier_group_ids: [FX.optionGroup],
      }),
      item(FX.gram, 'Fish', 2, { sale_unit: 'g', requires_weighing: true, price_minor: 400_000 }),
      item(FX.naan, 'Naan', 3, { price_minor: 3_000, cook_time_ms: 300_000 }),
      item(FX.optionItem, 'Raita', 4, { price_minor: 10_000, cook_time_ms: 60_000 }),
      item(FX.ready, 'Water', 5, { price_minor: 8_000, cook_time_ms: 60_000, is_ready_item: true }),
      item(FX.zoneItem, 'Cola', 6, { price_minor: 15_000, cook_time_ms: 60_000 }),
    ],
    deals: [
      {
        deal_id: FX.deal,
        category_id: 'C1',
        name: 'Karahi combo',
        description: null,
        sort_order: 1,
        price_minor: 120_000,
        tax_class_id: null,
        availability_windows: [],
        parts: [
          { deal_part_id: FX.dealParts[0], quantity: 1, sort_order: 0, choices: [{ item_id: FX.piece, extra_price_minor: 0, sort_order: 0 }] },
          { deal_part_id: FX.dealParts[1], quantity: 2, sort_order: 1, choices: [{ item_id: FX.naan, extra_price_minor: 0, sort_order: 0 }] },
        ],
      },
    ],
  };
}

type DraftOpts = { schema_version?: number; actor_id?: string | null; device_id?: string };
const draft = (stream_type: EventDraft['stream_type'], stream_id: string, event_type: string, payload: object, at: number, o: DraftOpts = {}): EventDraft => ({
  stream_type,
  stream_id,
  event_type,
  schema_version: o.schema_version ?? 1,
  payload: payload as Record<string, unknown>,
  occurred_at: at,
  actor_id: o.actor_id ?? null,
  device_id: o.device_id ?? 'hub',
});

/**
 * Applies `menu` (default fixtureMenu()) as a config apply does (hooks in the writer, then the swap: EngineConfigApplied),
 * sets each `stock` entry with StockSet, and opens the business day with OpenBusinessDay's BusinessDayOpened.
 */
export function openDay(hub: TestHub, o: { menu?: BranchConfig; stock?: Record<string, number> } = {}): { business_date: string; opened_at: number } {
  const menu = o.menu ?? fixtureMenu();
  hub.deps.writer.run((tx) => runBranchConfigHooks(branchConfig(), menu, tx));
  swapBranchConfig({ config: menu, snapshotHash: 'f'.repeat(64), configVersion: menu.config_version, snapshotSchemaVersion: 4, appliedAt: hub.clock.branchNow() });
  const now = hub.clock.branchNow();
  const d = new Date(now);
  const business_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const stock_units = Object.fromEntries(menu.stock_items.map((s) => [s.stock_item_id, s.stock_unit]));
  const draws = Object.fromEntries(menu.items.filter(isStockTracked).map((i) => [i.item_id, { sale_unit: i.sale_unit, stock_draws: i.stock_draws }]));
  const opened = hub.deps.writer.run((tx) =>
    tx.append([
      draft('hub', tx.branchId, 'BusinessDayOpened', { business_date, stock_units, draws }, now, { schema_version: 2 }),
      ...Object.entries(o.stock ?? {}).map(([id, on_hand]) =>
        draft('stock', id, 'StockSet', { stock_item_id: id, on_hand, unit: stock_units[id] ?? 'piece' }, now, { schema_version: 2 }),
      ),
    ]),
  ).appended[0]!;
  return { business_date, opened_at: opened.recorded_at };
}

/** Opens a seating with 02a's TableOpened (table stream); its holder defaults to S_WAIT. */
export function openSeating(hub: TestHub, o: { table_id: string; seating_id: string; holder_staff_id?: string }): void {
  const now = hub.clock.branchNow();
  const payload = { table_id: o.table_id, seating_id: o.seating_id, holder_staff_id: o.holder_staff_id ?? 'S_WAIT', party_size: null };
  hub.deps.writer.run((tx) => tx.append([draft('table', o.table_id, 'TableOpened', payload, now, { actor_id: payload.holder_staff_id })]));
}

/** Sets a zone count with ZoneStockSet (stream table / 'zone:' + zone_id); `previous` defaults to 0. */
export function setZoneStock(hub: TestHub, zone_id: string, item_id: string, on_hand: number, previous = 0): void {
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) => tx.append([draft('table', `zone:${zone_id}`, 'ZoneStockSet', { zone_id, item_id, on_hand, previous }, now)]));
}

/**
 * One line of appendOrder. Kind: `option_id` → option_child, `deal_part_id` → deal_part, `deal_id` alone → deal,
 * else item. Parents come before their children; `item` overrides the built ItemAdded payload last.
 */
export interface FixtureLine {
  order_item_id: string;
  item_id?: string;
  deal_id?: string;
  deal_part_id?: string;
  option_id?: string;
  parent_order_item_id?: string;
  /** item / deal: default 1 (a weighed item: null, weight pending); option_child: the option quantity (default 1) */
  quantity?: number;
  /** dine-in on a zone table: served from the zone (§3.2 step 5); the zone count is not checked here */
  from_zone?: boolean;
  item?: Partial<ItemAddedPayload>;
}

export interface FixtureOrder {
  order_type: 'dine_in' | 'takeaway' | 'parking';
  /** dine_in: an open seating (openSeating); its primary table is the order's table */
  seating_id?: string;
  /** parking only; car_type defaults to sedan */
  car_number?: string;
  lines: FixtureLine[];
  order_id?: string;
  /** OrderPlaced actor_id (placed_by); default S_WAIT */
  placed_by?: string;
  device_id?: string;
  follow_up?: boolean;
}

/**
 * Appends a real submit batch in one writer.run (§3.2 step 10): OrderPlaced → ItemAdded × n (order_item_ids order) →
 * zone-served ItemAdded → StockReserved (reserveStock) → ItemServed { source: 'zone' }. Engine fields come from
 * checkOrderable / reserveStock / planOrder on the live state, so every engine line is held by the engine.
 * Needs openDay first. Takeaway gets the next token of the day (an int, as OrderPlaced's schema has it).
 */
export function appendOrder(hub: TestHub, o: FixtureOrder): { order_id: string; events: PosEvent[] } {
  const config = branchConfig();
  if (config === null) throw new Error('appendOrder: call openDay first');
  const order_id = o.order_id ?? hub.deps.ids.next();
  const actor = { actor_id: o.placed_by ?? 'S_WAIT', device_id: o.device_id ?? 'D_FIXTURE' };
  const { appended } = hub.deps.writer.run((tx) => {
    const state = tx.state as EngineState;
    const now = tx.clock.branchNow();
    const dayStart = openDayStartMs(state);
    if (dayStart === null || state.business_day === null) throw new Error('appendOrder: no open business day');
    const order = orderFields(tx, config, o, order_id, state.business_day.business_date);
    const added = buildLines(state, config, o, order_id, order.zone_id);
    const proposedLines = added.filter((a) => a.served_from_zone_id === null).map((a) => engineFields(config, a));
    const zoneLines = added.filter((a) => a.served_from_zone_id !== null);
    const proposed: ProposedOrder = { order_id, order: order.proposed, lines: proposedLines };
    checkOrderable(state, proposed);
    const reserved = reserveStock(state, proposed, dayStart, config.stock_items, {});
    if (reserved.refused.length > 0) throw new Error(`appendOrder: sold out ${reserved.refused.join(', ')}`);
    const plan = planOrder(state, proposed, now, reserved.from_stock);
    const byId = new Map(proposedLines.map((l) => [l.order_item_id, l]));
    const has_food = proposedLines.some((l) => l.station_id !== null && l.line_kind !== 'deal' && !l.is_ready_item);
    const placed = {
      order_id,
      ...order.proposed,
      order_item_ids: proposedLines.map((l) => l.order_item_id),
      groups: plan.groups,
      lines: plan.lines.map((p) => {
        const l = byId.get(p.order_item_id)!;
        const { station_id, alternates, point_id, carry_ms, from_stock } = p;
        const { weight_pct, max_early_ms, max_late_ms, max_carry_ms } = l;
        return { order_item_id: p.order_item_id, station_id, alternates, point_id, carry_ms, from_stock, weight_pct, max_early_ms, max_late_ms, max_carry_ms };
      }),
      ...order.extra,
      has_phone: false,
      has_food,
      sent_after_reconnect: false,
    };
    const on = (event_type: string, payload: object): EventDraft => draft('order', order_id, event_type, payload, now, actor);
    const zoneIds = zoneLines.map((z) => z.order_item_id);
    return tx.append([
      on('OrderPlaced', placed),
      ...proposedLines.map((l) => on('ItemAdded', added.find((a) => a.order_item_id === l.order_item_id)!)),
      ...zoneLines.map((z) => on('ItemAdded', z)),
      ...reserved.drafts.map((r) => draft(r.stream_type, r.stream_id, r.event_type, r.payload, now, actor)),
      ...(zoneIds.length === 0 ? [] : [on('ItemServed', { order_item_ids: zoneIds, source: 'zone' })]),
    ]);
  });
  return { order_id, events: appended };
}

// §3.1 order identity: table_key, the engine's order fields, the E-1 OrderPlaced fields and the table's zone.
function orderFields(tx: WriterTx, config: BranchConfig, o: FixtureOrder, order_id: string, business_date: string) {
  const base = { order_type: o.order_type, follow_up: o.follow_up ?? false, pickup_at_ms: null };
  if (o.order_type === 'dine_in') {
    if (o.seating_id === undefined) throw new Error('appendOrder: dine_in needs seating_id');
    const row = tx.db.prepare(`SELECT primary_table_id FROM seatings WHERE seating_id = ? AND state <> 'CLOSED'`).get(o.seating_id) as { primary_table_id: string } | undefined;
    if (row === undefined) throw new Error(`appendOrder: no open seating ${o.seating_id} (openSeating first)`);
    const table = config.floors.flatMap((f) => f.tables).find((t) => t.table_id === row.primary_table_id);
    return { proposed: { ...base, table_id: row.primary_table_id, table_key: `dine_in:${o.seating_id}` }, extra: { business_date }, zone_id: table?.zone_id ?? null };
  }
  if (o.order_type === 'parking') {
    const car_number = o.car_number ?? 'LEB 1234';
    const norm = car_number.toUpperCase().replace(/[\s-]/g, '');
    return { proposed: { ...base, table_id: null, table_key: `parking:${norm}` }, extra: { business_date, car_number, car_type: 'sedan' }, zone_id: null };
  }
  const max = tx.db
    .prepare(
      `SELECT MAX(CAST(json_extract(payload, '$.token') AS INTEGER)) AS max FROM events
       WHERE event_type = 'OrderPlaced' AND json_extract(payload, '$.business_date') = ?`,
    )
    .get(business_date) as { max: number | null };
  return { proposed: { ...base, table_id: null, table_key: `takeaway:${order_id}` }, extra: { business_date, token: (max.max ?? 0) + 1 }, zone_id: null };
}

const NONE = {
  parent_order_item_id: null,
  item_id: null,
  deal_id: null,
  deal_part_id: null,
  option_id: null,
  option_quantity: null,
  variant_group_id: null,
  variant_group_name: null,
  variant_name: null,
  extra_price_minor: null,
  allocated_price_minor: null,
  tax_class_id: null,
  program_id: null,
  stock_program_id: null,
  program_cook_time_ms: null,
  stock_program_cook_time_ms: null,
  options: [],
  kitchen_note: null,
  served_from_zone_id: null,
  is_ready_item: false,
};

// The ItemAdded payloads (01c §4.3 + C-1), money per 01c §3.4 (deal allocation pro rata by part totals, V11 c).
function buildLines(state: EngineState, config: BranchConfig, o: FixtureOrder, order_id: string, zone_id: string | null): ItemAddedPayload[] {
  const out: ItemAddedPayload[] = [];
  const itemOf = (id: string | undefined): ConfigItem => {
    const found = config.items.find((i) => i.item_id === id);
    if (found === undefined) throw new Error(`appendOrder: no item ${String(id)}`);
    return found;
  };
  const zone = config.floors.flatMap((f) => f.zones).find((z) => z.zone_id === zone_id);
  const fromItem = (ci: ConfigItem, units: number) => ({
    item_id: ci.item_id,
    name: ci.name,
    category_id: ci.category_id,
    requires_weighing: ci.requires_weighing,
    sale_unit: ci.sale_unit,
    price_minor: ci.price_minor,
    tax_class_id: ci.tax_class_id,
    // §3.10: the zone route of the primary table's zone, else the branch route (dine-in only).
    station_id: zone?.routes.find((r) => r.item_id === ci.item_id)?.station_id ?? ci.station_id,
    program_id: ci.program_id,
    stock_program_id: ci.stock_program_id,
    serve_mode: ci.serve_mode,
    prep_buffer_ms: ci.prep_buffer_ms,
    cook_time_ms: ci.cook_time_ms,
    stock_time_ms: ci.stock_time_ms,
    out_of_stock_behaviour: ci.out_of_stock_behaviour,
    stock_draws: dayDraws(state, ci, {}).stock_draws.map((d) => ({ stock_item_id: d.stock_item_id, quantity: d.quantity_per_sale_unit * units })),
    variant_group_id: ci.variant_group_id,
    variant_name: ci.variant_name,
    is_ready_item: ci.is_ready_item,
  });
  for (const l of o.lines) {
    const ids = { order_id, order_item_id: l.order_item_id, parent_order_item_id: l.parent_order_item_id ?? null };
    const parent = out.find((p) => p.order_item_id === l.parent_order_item_id);
    let line: ItemAddedPayload;
    if (l.option_id !== undefined) {
      if (parent === undefined) throw new Error(`appendOrder: option ${l.order_item_id} needs its parent first`);
      const option = config.modifier_groups.flatMap((g) => g.options).find((x) => x.option_id === l.option_id)!;
      const quantity = childQuantity(l.quantity ?? 1, parent.quantity ?? 1, parent.sale_unit);
      line = {
        ...NONE,
        ...fromItem(itemOf(option.linked_item_id ?? undefined), quantity),
        ...ids,
        line_kind: 'option_child',
        option_id: option.option_id,
        option_quantity: l.quantity ?? 1,
        quantity,
        sale_unit: 'piece',
        requires_weighing: false,
        price_minor: option.price_minor,
        line_total_minor: lineTotalMinor(option.price_minor, quantity, 'piece'),
      };
    } else if (l.deal_part_id !== undefined) {
      if (parent === undefined || parent.deal_id === null) throw new Error(`appendOrder: part ${l.order_item_id} needs its deal line first`);
      const deal = config.deals.find((d) => d.deal_id === parent.deal_id)!;
      const dealQty = parent.quantity ?? 1;
      const chosen = (partId: string): ConfigItem => {
        const given = o.lines.find((x) => x.parent_order_item_id === parent.order_item_id && x.deal_part_id === partId)?.item_id;
        return itemOf(given ?? deal.parts.find((p) => p.deal_part_id === partId)!.choices[0]!.item_id);
      };
      const weights = deal.parts.map((p) => lineTotalMinor(chosen(p.deal_part_id).price_minor, p.quantity * dealQty, 'piece'));
      const index = deal.parts.findIndex((p) => p.deal_part_id === l.deal_part_id);
      const part = deal.parts[index]!;
      const ci = itemOf(l.item_id ?? part.choices[0]!.item_id);
      // 01c §3.4.2: part quantity × deal count, piece and g/ml alike (a g/ml part's units are still per deal, §3.4.8).
      const quantity = part.quantity * dealQty;
      const allocated = allocateDealMinor(parent.line_total_minor ?? 0, weights)[index]!;
      line = {
        ...NONE,
        ...fromItem(ci, quantity),
        ...ids,
        line_kind: 'deal_part',
        deal_id: deal.deal_id,
        deal_part_id: part.deal_part_id,
        quantity,
        extra_price_minor: 0,
        allocated_price_minor: allocated,
        line_total_minor: 0,
      };
    } else if (l.deal_id !== undefined) {
      const deal = config.deals.find((d) => d.deal_id === l.deal_id)!;
      const quantity = l.quantity ?? 1;
      line = {
        ...NONE,
        ...ids,
        line_kind: 'deal',
        deal_id: deal.deal_id,
        name: deal.name,
        category_id: deal.category_id,
        requires_weighing: false,
        quantity,
        sale_unit: 'piece',
        price_minor: deal.price_minor,
        tax_class_id: deal.tax_class_id,
        station_id: null, // never an engine line (03a :245)
        serve_mode: null,
        prep_buffer_ms: null,
        cook_time_ms: null,
        stock_time_ms: null,
        out_of_stock_behaviour: null,
        stock_draws: [],
        line_total_minor: deal.price_minor * quantity, // the fixture deal has no extras
      };
    } else {
      const ci = itemOf(l.item_id);
      const quantity = l.quantity ?? (ci.requires_weighing ? null : 1);
      const zoneServed = l.from_zone === true;
      if (zoneServed && !zone?.stock_items.some((s) => s.item_id === ci.item_id)) {
        throw new Error(`appendOrder: ${ci.item_id} is not a zone item of this table`);
      }
      line = {
        ...NONE,
        ...fromItem(ci, ci.sale_unit === 'piece' ? (quantity ?? 1) : 1),
        ...ids,
        line_kind: 'item',
        quantity,
        line_total_minor: quantity === null ? null : lineTotalMinor(ci.price_minor, quantity, ci.sale_unit),
        served_from_zone_id: zoneServed ? zone!.zone_id : null,
      };
    }
    out.push({ ...line, ...l.item });
  }
  return out;
}

// The 03a §4.2 engine fields of a proposed line, from the item's 01a knobs and its station's point (no alternates).
function engineFields(config: BranchConfig, a: ItemAddedPayload): ProposedLine {
  const ci = config.items.find((i) => i.item_id === a.item_id);
  const station = config.stations.find((s) => s.station_id === a.station_id);
  return {
    ...a,
    alternates: [],
    point_id: station?.point_id ?? null,
    carry_ms: 0,
    weight_pct: ci?.weight_pct ?? 100,
    max_early_ms: ci?.max_early_ms ?? 60_000,
    max_late_ms: ci?.max_late_ms ?? null,
    max_carry_ms: ci?.max_carry_ms ?? null,
    cook_ms_override: null,
    return_of: null,
  };
}
