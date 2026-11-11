import { DomainError } from '@pos/domain';
import { availableStock, checkOrderable, dayDraws, openDayStartMs, planOrder, reserveStock, saleUnitsAvailable, type EngineState } from '@pos/engine';
import type { BranchConfig, EventDraft, ItemAddedPayload, OrderPlacedPayload } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { hubTime } from '../../lib/hub-time.js';
import { itemAvailability } from '../../projections/item-availability.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { requireLock } from '../../tables/lock.js';
import { seatingOf, zoneOf } from '../../tables/reads.js';
import { buildSubmit } from '../build-submit.js';
import type { BuildSubmitCtx, SubmitInput } from '../contracts.js';
import { isFoodLine } from '../food.js';
import { zoneAlertDrafts } from '../zone-alerts.js';

// 02b v1.0.3 §6.1 SubmitOrder (queueable), §3.2 script, §3.1 identity, §3.3 follow_up, §3.11 token, §3.14 scope.
// Statements (§3.2): seatingOf 1 + requireLock 1 (dine-in) + ids 1 + follow_up 1 (dine-in) + token 1 (takeaway) +
// item_availability 1 + zone counts 1 (only with a zone candidate, step 5) + 01d's alert bound (zone alert drafts, only
// with a zone-served line). Engine checks run in memory on ctx.state.

export const Option = z.object({ option_id: z.string().min(1), quantity: z.number().int().min(1), order_item_id: z.string().min(1).optional() }).strict();
// §3.1: phone 10–13 digits, stored digits only (spaces, dashes and a leading + are dropped).
const Phone = z
  .string()
  .regex(/^\+?[\d\s-]+$/)
  .transform((p) => p.replace(/\D/g, ''))
  .refine((p) => p.length >= 10 && p.length <= 13, 'phone must have 10–13 digits');
export const Line = z
  .object({
    order_item_id: z.string().min(1),
    item_id: z.string().min(1).optional(),
    deal_id: z.string().min(1).optional(),
    variant_id: z.string().optional(), // AD-18: accepted and ignored (a variant is its own item, 01c V2)
    quantity: z.number().int().min(1).optional(),
    options: z.array(Option).optional(),
    deal_choices: z
      .array(
        z
          .object({ deal_part_id: z.string().min(1), item_id: z.string().min(1), order_item_id: z.string().min(1), options: z.array(Option).optional() })
          .strict(),
      )
      .optional(),
    kitchen_note: z.string().max(80).optional(),
    from_zone: z.boolean().optional(),
  })
  .strict();

export const PayloadObject = z
  .object({
    order_id: z.string().min(1),
    order_type: z.enum(['dine_in', 'takeaway', 'parking']),
    table_id: z.string().min(1).optional(),
    seating_id: z.string().min(1).optional(),
    takeaway: z.object({ customer_name: z.string().min(1).max(40).optional(), phone: Phone.optional() }).strict().optional(),
    parking: z
      .object({ car_number: z.string().regex(/^[A-Za-z0-9 -]{2,12}$/), car_type: z.enum(['sedan', 'mini', 'large']), phone: Phone.optional() })
      .strict()
      .optional(),
    order_note: z.string().max(200).optional(),
    lines: z.array(Line).min(1).max(40),
  })
  .strict();
const Payload = PayloadObject.superRefine(checkShape);
type Payload = z.infer<typeof PayloadObject>;

function checkShape(p: Payload, rc: z.RefinementCtx): void {
  checkOrderFields(p, rc);
  // §3.2 step 3 (O3, C6): an id repeated inside the payload → 400 at its path, before any read (step order).
  const seen = new Set<string>([p.order_id]);
  for (const { id, path } of payloadIds(p.lines)) {
    if (seen.has(id)) rc.addIssue({ code: 'custom', path, message: 'id repeated in the payload' });
    seen.add(id);
  }
}

// §3.1 / §3.2 step 2: each order type carries only its own fields; dine-in needs both table_id and seating_id.
// Shared with eta-preview's draft (§6.14).
export function checkOrderFields(p: Pick<Payload, 'order_type' | 'table_id' | 'seating_id' | 'takeaway' | 'parking'>, rc: z.RefinementCtx): void {
  const issue = (path: string, message: string): void => rc.addIssue({ code: 'custom', path: [path], message });
  const dineIn = p.order_type === 'dine_in';
  for (const key of ['table_id', 'seating_id'] as const) {
    if (dineIn && p[key] === undefined) issue(key, 'dine_in needs table_id and seating_id');
    if (!dineIn && p[key] !== undefined) issue(key, 'only on dine_in');
  }
  if (p.order_type !== 'takeaway' && p.takeaway !== undefined) issue('takeaway', 'only on takeaway');
  if (p.order_type === 'parking' && p.parking === undefined) issue('parking', 'parking needs car_number and car_type');
  if (p.order_type !== 'parking' && p.parking !== undefined) issue('parking', 'only on parking');
}

// Every line id of the payload (lines, linked option children, deal parts and their children), in payload order.
function payloadIds(lines: Payload['lines']): Array<{ id: string; path: Array<string | number> }> {
  const out: Array<{ id: string; path: Array<string | number> }> = [];
  const add = (id: string | undefined, path: Array<string | number>): void => {
    if (id !== undefined) out.push({ id, path: [...path, 'order_item_id'] });
  };
  lines.forEach((line, n) => {
    add(line.order_item_id, ['lines', n]);
    line.options?.forEach((o, k) => add(o.order_item_id, ['lines', n, 'options', k]));
    line.deal_choices?.forEach((c, k) => {
      add(c.order_item_id, ['lines', n, 'deal_choices', k]);
      c.options?.forEach((o, j) => add(o.order_item_id, ['lines', n, 'deal_choices', k, 'options', j]));
    });
  });
  return out;
}

interface SubmitResult {
  order_id: string;
  token: number | null;
  groups: Array<{ group_id: string; promise_ms: number; order_item_ids: string[] }>;
  lines: Array<{ order_item_id: string; eta_ms: number | null; from_stock: boolean; zone_served: boolean }>;
}

function handle(ctx: CommandCtx, payload: Payload, log: FastifyInstance['log']): { events: EventDraft[]; result: SubmitResult } {
  const state = ctx.state as EngineState;
  const db = ctx.tx.db;
  const input: SubmitInput = payload;

  // Step 1: an open day (O8); business_date from it.
  const dayStart = openDayStartMs(state);
  const config = branchConfig();
  if (dayStart === null || state.business_day === null || config === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const business_date = state.business_day.business_date;

  // Step 2: dine-in seating (T18) and the lock (02a requireLock; AD-1: a queued call never takes or moves a lock).
  let lockDrafts: EventDraft[] = [];
  let primary_table_id: string | null = null;
  if (payload.order_type === 'dine_in') {
    const ref = { table_id: payload.table_id!, seating_id: payload.seating_id! };
    const seating = seatingOf(db, ref.table_id);
    if (seating === null || seating.seating_id !== ref.seating_id) throw new DomainError('TABLE_SEATING_CHANGED', ref);
    lockDrafts = requireLock(ctx.tx, ref, ctx);
    primary_table_id = seating.primary_table_id;
  }

  // Step 3: ids already used (orders ∪ order_lines, or live in EngineState).
  requireIdsFree(ctx, state, payload);

  // §3.3 follow_up (dine-in): an order of the current seating has a served food line.
  const follow_up = payload.order_type === 'dine_in' && seatingHasServedFood(db, payload.seating_id!);

  // Step 4 (and 6, 7): lines from config. AD-21: isAvailable is the manual Off only; sold out is step 8's.
  const configStockUnits = stockUnitsOf(config);
  const { now_ms: now, utc_offset_ms } = hubTime(ctx.clock);
  const built = buildSubmit(config, input, submitBuildCtx(db, state, config, input, { now, utc_offset_ms }, primary_table_id, follow_up));

  // Step 5 (O5, §3.10, AD-8): the candidates the zone count covers are zone-served, the rest stay kitchen lines.
  const zone = zoneServe(db, primary_table_id, built.itemAdded, built.zoneCandidates);
  const itemAdded = built.itemAdded.map((a) => (zone.served.has(a.order_item_id) ? { ...a, served_from_zone_id: zone.zone_id } : a));
  const proposed = { ...built.proposed, lines: built.proposed.lines.filter((l) => !zone.served.has(l.order_item_id)) };
  const kitchenAdded = itemAdded.filter((a) => !zone.served.has(a.order_item_id));
  const zoneAdded = itemAdded.filter((a) => zone.served.has(a.order_item_id));

  // Step 8: engine checks, in memory.
  checkOrderable(state, proposed);
  const reserved = reserveStock(state, proposed, dayStart, config.stock_items, configStockUnits);
  if (reserved.refused.length > 0) throw soldOut(state, config, proposed.lines, reserved, dayStart, configStockUnits);
  const plan = planOrder(state, proposed, now, reserved.from_stock);

  // Step 9: token (O12), takeaway only.
  const token = payload.order_type === 'takeaway' ? nextToken(ctx, business_date) : null;

  // §3.14 scope last (C8): dine-in `my_floors` must cover the table; holder / take-order-anywhere is requireLock's.
  if (payload.order_type === 'dine_in') requireFloorScope(ctx, payload.table_id!);

  // Step 10: the batch, in 03a :615 order.
  const envelope = { occurred_at: now, actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  const onOrder = (event_type: string, body: object): EventDraft => ({
    stream_type: 'order',
    stream_id: payload.order_id,
    event_type,
    schema_version: 1,
    payload: body as Record<string, unknown>,
    ...envelope,
  });
  // O17: contact only in OrderContactSet; OrderPlaced carries has_phone.
  const customer_name = payload.takeaway?.customer_name ?? null;
  const phone = payload.takeaway?.phone ?? payload.parking?.phone ?? null;
  const knobs = new Map(proposed.lines.map((l) => [l.order_item_id, l]));
  const placed: OrderPlacedPayload = {
    order_id: payload.order_id,
    ...proposed.order,
    order_item_ids: proposed.lines.map((l) => l.order_item_id),
    groups: plan.groups,
    // AD-17: planOrder's route fields verbatim, with the line's 01a A-11 knobs.
    lines: plan.lines.map((p) => {
      const { weight_pct, max_early_ms, max_late_ms, max_carry_ms } = knobs.get(p.order_item_id)!;
      const { order_item_id, station_id, alternates, point_id, carry_ms, from_stock } = p;
      return { order_item_id, station_id, alternates, point_id, carry_ms, from_stock, weight_pct, max_early_ms, max_late_ms, max_carry_ms };
    }),
    business_date,
    ...(token === null ? {} : { token }),
    ...(payload.parking === undefined ? {} : { car_number: payload.parking.car_number, car_type: payload.parking.car_type }),
    ...(payload.order_note === undefined ? {} : { order_note: payload.order_note }),
    sent_after_reconnect: ctx.queuedAt !== null,
    has_phone: phone !== null,
    has_food: itemAdded.some(isFoodLine),
  };
  const zoneIds = zoneAdded.map((a) => a.order_item_id);
  const events: EventDraft[] = [
    ...lockDrafts,
    onOrder('OrderPlaced', placed),
    ...kitchenAdded.map((a) => onOrder('ItemAdded', a)),
    ...zoneAdded.map((a) => onOrder('ItemAdded', a)),
    ...reserved.drafts.map((d) => ({ ...d, payload: d.payload as Record<string, unknown>, ...envelope })),
    // O5 / 03a Q-6: served in the submit batch; never printed, never food (no OrderFoodServed).
    ...(zoneIds.length === 0 ? [] : [onOrder('ItemServed', { order_item_ids: zoneIds, source: 'zone' })]),
    ...(customer_name === null && phone === null ? [] : [onOrder('OrderContactSet', { order_id: payload.order_id, customer_name, phone })]),
    // §3.10 Alerts: zone_stock_low / zone_stock_out for the counts this batch lowers, last.
    ...(zone.changes.length === 0 ? [] : zoneAlertDrafts(ctx, zone.changes)),
  ];

  // §7 logs: ids, type, counts and queued only; never names, phones or totals.
  ctx.tx.onCommit(() => {
    // line_count counts every ItemAdded (option children and deal parts included).
    log.info({ order_id: payload.order_id, command_type: 'SubmitOrder', order_type: payload.order_type, line_count: itemAdded.length, queued: ctx.queuedAt !== null }, 'order submitted');
  });

  // Step 11: promise_ms only, never target_land_ms (03a #9).
  const eta = new Map(plan.lines.map((l) => [l.order_item_id, l.eta_ms]));
  return {
    events,
    result: {
      order_id: payload.order_id,
      token,
      groups: plan.groups.map((g) => ({ group_id: g.group_id, promise_ms: g.promise_ms, order_item_ids: g.order_item_ids })),
      lines: itemAdded.map((a) => ({
        order_item_id: a.order_item_id,
        eta_ms: eta.get(a.order_item_id) ?? null,
        from_stock: reserved.from_stock[a.order_item_id] === true,
        zone_served: zone.served.has(a.order_item_id),
      })),
    },
  };
}

export type ConfigStockUnits = Record<string, BranchConfig['stock_items'][number]['stock_unit']>;

export function stockUnitsOf(config: BranchConfig): ConfigStockUnits {
  return Object.fromEntries(config.stock_items.map((s) => [s.stock_item_id, s.stock_unit]));
}

// §3.2 step 4 (AD-8, AD-12, AD-21): buildSubmit's ctx. 1 statement (item_availability over the items the lines reach);
// isAvailable is the manual Off only (sold out is step 8's); draws are the day-frozen ones. Shared with eta-preview.
export function submitBuildCtx(
  db: Database.Database,
  state: EngineState,
  config: BranchConfig,
  input: Pick<SubmitInput, 'lines'>,
  time: { now: number; utc_offset_ms: number },
  primary_table_id: string | null,
  follow_up: boolean,
): BuildSubmitCtx {
  const availability = itemAvailability(db, reachedItemIds(config, input));
  const configStockUnits = stockUnitsOf(config);
  const itemsById = new Map(config.items.map((i) => [i.item_id, i]));
  return {
    now: time.now,
    utc_offset_ms: time.utc_offset_ms,
    isAvailable: (item_id) => availability.get(item_id) !== false,
    draws: (item_id) => dayDraws(state, itemsById.get(item_id)!, configStockUnits),
    primary_table_id,
    follow_up,
  };
}

export interface ZoneServe {
  zone_id: string | null;
  served: Set<string>;
  changes: Array<{ zone_id: string; item_id: string; before: number; after: number }>;
}

// §3.2 step 5 (O5, §3.10): a candidate (from_zone, line_kind 'item', no options, dine-in, the primary table's zone lists
// the item: buildSubmit's zoneCandidates) is zone-served when on_hand − claimed ≥ quantity, claims counted across the
// payload in line order (as reserveStock counts draws); a failing line stays a kitchen line, never a refusal (run 4 M-4).
// 1 statement (the zone counts of the candidates' items), none without a candidate. A zone without a count row holds 0.
export function zoneServe(db: Database.Database, primary_table_id: string | null, itemAdded: readonly ItemAddedPayload[], candidates: readonly string[]): ZoneServe {
  const none: ZoneServe = { zone_id: null, served: new Set(), changes: [] };
  if (candidates.length === 0 || primary_table_id === null) return none;
  const zone_id = zoneOf(primary_table_id).zone_id;
  if (zone_id === null) return none;
  const ids = new Set(candidates);
  const lines = itemAdded.filter((a) => ids.has(a.order_item_id) && a.item_id !== null);
  const itemIds = [...new Set(lines.map((a) => a.item_id!))];
  const rows = db
    .prepare('SELECT item_id, on_hand FROM zone_stock WHERE zone_id = ? AND item_id IN (SELECT value FROM json_each(?))')
    .all(zone_id, JSON.stringify(itemIds)) as Array<{ item_id: string; on_hand: number }>;
  const before = new Map(itemIds.map((id) => [id, rows.find((r) => r.item_id === id)?.on_hand ?? 0]));
  const left = new Map(before);
  const served = new Set<string>();
  for (const a of lines) {
    const have = left.get(a.item_id!)!;
    // A weighed line (quantity null) has no count to take: it stays a kitchen line.
    if (a.quantity === null || have < a.quantity) continue;
    left.set(a.item_id!, have - a.quantity);
    served.add(a.order_item_id);
  }
  const changes = itemIds
    .filter((id) => left.get(id) !== before.get(id))
    .map((item_id) => ({ zone_id, item_id, before: before.get(item_id)!, after: left.get(item_id)! }));
  return { zone_id, served, changes };
}

// §3.2 step 3 (O3): 1 statement over orders ∪ order_lines; then EngineState. The order id is reported first, then the
// first line id in payload order.
function requireIdsFree(ctx: CommandCtx, state: EngineState, payload: Payload): void {
  const ids = payloadIds(payload.lines).map((x) => x.id);
  const rows = ctx.tx.db
    .prepare(
      `SELECT 'order' AS kind, order_id AS id FROM orders WHERE order_id = ?
       UNION ALL
       SELECT 'line' AS kind, order_item_id AS id FROM order_lines WHERE order_item_id IN (SELECT value FROM json_each(?))`,
    )
    .all(payload.order_id, JSON.stringify(ids)) as Array<{ kind: 'order' | 'line'; id: string }>;
  if (rows.some((r) => r.kind === 'order') || state.orders[payload.order_id] !== undefined) {
    throw new DomainError('ORDER_ITEM_ID_IN_USE', { order_id: payload.order_id });
  }
  const used = new Set(rows.map((r) => r.id));
  const taken = ids.find((id) => used.has(id) || state.lines[id] !== undefined);
  if (taken !== undefined) throw new DomainError('ORDER_ITEM_ID_IN_USE', { order_item_id: taken });
}

// §3.2 step 4: the item ids whose manual Off buildSubmit can read: the payload's items and deal choices, and the
// linked items of every option of their modifier groups (chosen options and required-group satisfiability).
function reachedItemIds(config: BranchConfig, payload: Pick<SubmitInput, 'lines'>): string[] {
  const ids = new Set<string>();
  for (const line of payload.lines) {
    if (line.item_id !== undefined) ids.add(line.item_id);
    for (const c of line.deal_choices ?? []) ids.add(c.item_id);
  }
  const groups = new Map(config.modifier_groups.map((g) => [g.modifier_group_id, g]));
  for (const item of config.items) {
    if (!ids.has(item.item_id)) continue;
    for (const id of item.modifier_group_ids) {
      for (const o of groups.get(id)?.options ?? []) if (o.linked_item_id !== null) ids.add(o.linked_item_id);
    }
  }
  return [...ids];
}

// §3.3: 02a's current seating_orders (P-1c) joined to 02b's own order_lines; 1 statement.
export function seatingHasServedFood(db: Database.Database, seating_id: string): boolean {
  const row = db
    .prepare(
      `SELECT EXISTS (
         SELECT 1 FROM seating_orders so JOIN order_lines ol ON ol.order_id = so.order_id
          WHERE so.seating_id = ? AND ol.is_food = 1 AND ol.served_at IS NOT NULL
       ) AS served`,
    )
    .get(seating_id) as { served: number };
  return row.served === 1;
}

// §3.2 step 9 (O12), §3.11: 1 + MAX(token) over the orders of the business date (a reopened date continues).
function nextToken(ctx: CommandCtx, business_date: string): number {
  const row = ctx.tx.db.prepare('SELECT COALESCE(MAX(token), 0) + 1 AS token FROM orders WHERE business_date = ?').get(business_date) as { token: number };
  return row.token;
}

// §3.2 step 8 (O15, N-7): the first refused line → ITEM_SOLD_OUT.
function soldOut(
  state: EngineState,
  config: BranchConfig,
  lines: ReturnType<typeof buildSubmit>['proposed']['lines'],
  reserved: ReturnType<typeof reserveStock>,
  dayStart: number,
  configStockUnits: ConfigStockUnits,
): DomainError {
  return new DomainError('ITEM_SOLD_OUT', soldOutDetails(state, config, lines, reserved, dayStart, configStockUnits, reserved.refused[0]!));
}

// §3.2 step 8 (O15, N-7): a refused line's available = min over its draws of the sale units left after the draws of
// earlier lines of this payload (as reserveStock counts them). Shared with eta-preview (a refusal per line).
export function soldOutDetails(
  state: EngineState,
  config: BranchConfig,
  lines: ReturnType<typeof buildSubmit>['proposed']['lines'],
  reserved: ReturnType<typeof reserveStock>,
  dayStart: number,
  configStockUnits: ConfigStockUnits,
  refusedId: string,
): { item_id: string | null; available: number } {
  const index = lines.findIndex((l) => l.order_item_id === refusedId);
  const line = lines[index]!;
  const earlier = new Set(lines.slice(0, index).map((l) => l.order_item_id));
  const item = config.items.find((i) => i.item_id === line.item_id)!;
  const perUnit = new Map(dayDraws(state, item, configStockUnits).stock_draws.map((d) => [d.stock_item_id, d.quantity_per_sale_unit]));
  const available = Math.min(
    ...line.stock_draws.map((d) => {
      const stockItem = config.stock_items.find((s) => s.stock_item_id === d.stock_item_id);
      const free = stockItem === undefined ? 0 : availableStock(state, d.stock_item_id, dayStart, stockItem);
      const claimed = reserved.drafts
        .filter((r) => r.payload.stock_item_id === d.stock_item_id && earlier.has(r.payload.order_item_id))
        .reduce((sum, r) => sum + r.payload.quantity, 0);
      return saleUnitsAvailable(Math.max(0, free - claimed), perUnit.get(d.stock_item_id) ?? d.quantity);
    }),
  );
  return { item_id: line.item_id, available };
}

// §3.14 (C8, last): take-order `my_floors` must cover the named table's floor; `branch` any; `own_tables` is the holder
// rule requireLock already applied. 0 statements (config and directory in memory).
function requireFloorScope(ctx: CommandCtx, table_id: string): void {
  const permission = ctx.permission;
  if (permission?.grant !== 'allowed' || permission.scope !== 'my_floors') return;
  const floor = branchConfig()?.floors.find((f) => f.tables.some((t) => t.table_id === table_id))?.floor_id;
  const staffId = ctx.actor.staffId;
  if (floor !== undefined && staffId !== null && ctx.directory.floorsOf(staffId).includes(floor)) return;
  throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', table_ids: [table_id] });
}

export function registerSubmitOrder(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SubmitOrder',
      payloadSchema: Payload,
      sessionKind: 'device',
      permission: 'take-order',
      queueable: true, // §3.12
      handle: (ctx, payload) => handle(ctx, payload, app.log),
    }),
  );
}
