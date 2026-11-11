// 02b §6.4 MarkServed (queueable), §3.7, O16, §3.3, §3.14. No lock (D39; 02a P-1e, #62).
import { DomainError } from '@pos/domain';
import { isOrderInEngine, stockEffects } from '@pos/engine';
import type { EventDraft, ItemServedPayload } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Resolution } from '../../auth/staff-directory.js';
import type { CommandCtx } from '../../commands/registry.js';
import type { CurrentTableOf } from '../../engine-host/slip-readers.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { currentTableOf } from '../../tables/reads.js';
import type { OrderType } from '../contracts.js';
import { orderLines } from '../exports.js';
import { foodDrafts } from '../food.js';

// ------------------------------------------------------------------------------------------- §3.14 scope (shared)

/** What the §3.14 "as MarkServed" scope check needs of an order. */
export interface ScopedOrder {
  order_id: string;
  order_type: OrderType;
  /** envelope actor_id of OrderPlaced */
  placed_by: string;
  /** dine-in: the holder of the order's open seating (02a `seatings`); null when there is none */
  holder_staff_id: string | null;
}

/**
 * The named orders of `orders` with the holder of their open seating (02a `seating_orders` ⋈ `seatings`, read-only,
 * P-1c). 1 statement. An unknown id has no entry.
 */
export function scopedOrders(db: Database.Database, order_ids: readonly string[]): Map<string, ScopedOrder> {
  const rows = db
    .prepare(
      `SELECT o.order_id AS order_id, o.order_type AS order_type, o.placed_by AS placed_by, s.holder_staff_id AS holder_staff_id
         FROM (SELECT DISTINCT value FROM json_each(?)) j
         JOIN orders o ON o.order_id = j.value
         LEFT JOIN seating_orders so ON so.order_id = o.order_id
         LEFT JOIN seatings s ON s.seating_id = so.seating_id AND s.state <> 'CLOSED'`,
    )
    .all(JSON.stringify(order_ids)) as ScopedOrder[];
  return new Map(rows.map((r) => [r.order_id, r]));
}

/**
 * §3.14 "as MarkServed", pure (⚠️ Changed by 03b v1.0.1 G-3, owner 2026-11-11; 02b v1.0.6 note): is order `o` inside the
 * scope of `who.resolution` (the staff's resolved right, e.g. `mark-served`) for `who.staffId`? `branch` → yes. Dine-in:
 * the current table — `own_tables` = the staff holds the order's open seating; `my_floors` = a table of the seating
 * (`tables`, 02a `currentTableOf`, read once by the caller; null → none) is on one of `floorsOf(staffId)`. Takeaway /
 * parking: `own_tables` and `my_floors` = placed by the staff (01b B-4). No staff or no scope → no. 0 statements.
 * 03b's Handover receiver and `pass-receivers` call it for staff other than the caller with one shared `tables`.
 */
export function orderCovered(
  o: ScopedOrder,
  who: { staffId: string | null; resolution: Resolution | null },
  tables: ReturnType<CurrentTableOf> | null,
  floorsOf: (staffId: string) => string[],
): boolean {
  const { staffId, resolution } = who;
  if (staffId === null) return false;
  const scope = resolution !== null && 'scope' in resolution ? resolution.scope : null;
  if (scope === 'branch') return true;
  if (scope !== 'own_tables' && scope !== 'my_floors') return false;
  if (o.order_type !== 'dine_in') return o.placed_by === staffId;
  if (scope === 'own_tables') return o.holder_staff_id === staffId;
  const myFloors = new Set(floorsOf(staffId));
  const floors = branchConfig()?.floors ?? [];
  return (tables?.get(o.order_id)?.table_ids ?? []).some((table_id) => {
    const floor = floors.find((f) => f.tables.some((t) => t.table_id === table_id));
    return floor !== undefined && myFloors.has(floor.floor_id);
  });
}

/**
 * §3.14 "as MarkServed" (C8, call it last), on the scope of the command's own registered permission (`ctx.permission`:
 * `mark-served`, `boost-order`, `mark-item-returned`, …), for the caller. `branch` → any order (0 statements); `my_floors`
 * with a dine-in order reads 02a `currentTableOf` once (1 statement). The rule is `orderCovered` (G-3). Else
 * 403 PERMISSION_DENIED { reason: 'outside_scope', order_ids }.
 */
export function checkOrderScope(ctx: CommandCtx, orders: readonly ScopedOrder[]): void {
  const who = { staffId: ctx.actor.staffId, resolution: ctx.permission };
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : null;
  if (scope === 'branch' && who.staffId !== null) return;
  const dineIn = orders.filter((o) => o.order_type === 'dine_in');
  const tables = scope === 'my_floors' && dineIn.length > 0 ? currentTableOf(ctx.tx.db, dineIn.map((o) => o.order_id)) : null;
  const floorsOf = (staffId: string): string[] => ctx.directory.floorsOf(staffId);
  const outside = orders.filter((o) => !orderCovered(o, who, tables, floorsOf)).map((o) => o.order_id);
  if (outside.length > 0) throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', order_ids: outside });
}

// ------------------------------------------------------------------------------------------- §6.4 MarkServed

// C6: a repeated order_id, or an order_item_id repeated anywhere in the payload → 400 at its path.
export const MarkServedPayload = z.object({
  lines: z
    .array(z.object({ order_id: z.string().min(1), order_item_ids: z.array(z.string().min(1)).min(1) }))
    .min(1)
    .max(20)
    .superRefine((lines, rc) => {
      const orders = new Set<string>();
      const items = new Set<string>();
      lines.forEach((l, i) => {
        if (orders.has(l.order_id)) rc.addIssue({ code: 'custom', path: [i, 'order_id'], message: 'duplicate order_id' });
        orders.add(l.order_id);
        l.order_item_ids.forEach((id, k) => {
          if (items.has(id)) rc.addIssue({ code: 'custom', path: [i, 'order_item_ids', k], message: 'duplicate order_item_id' });
          items.add(id);
        });
      });
    }),
});
type Payload = z.infer<typeof MarkServedPayload>;

/**
 * §3.7 / §6.4. Statements: 1 orders (+ holder), 1 lines (`orderLines`), + `currentTableOf` for a `my_floors` dine-in
 * (2–3). Per order in payload order: unknown → 404 ORDER_NOT_FOUND (also for a line id the order does not have);
 * a deal header → 400 VALIDATION_FAILED (owner S-1 H-b); a served line → skipped; a line the engine does not hold
 * (no station) → no fired check (owner S-1 N-a); removed / voided → 409 ITEM_WRONG_STAGE; an order in the engine whose engine line is
 * unfired (`added`, no fire) → ITEM_WRONG_STAGE { stage: 'added' }. An order that has left the engine (O16) serves
 * any live line, with no stockEffects. Scope last (C8). Batch: per order ItemServed { source: 'tap' } →
 * OrderFoodServed (when it serves a food line, §3.3) → its stockEffects (array form across the command, AD-29 Q7).
 * Queued (§3.12): `served_at` = `ctx.queuedAt` on each ItemServed.
 */
function markServed(ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: { served: number; skipped: string[] } } {
  const db = ctx.tx.db;
  const now = ctx.clock.branchNow();
  const orderIds = payload.lines.map((l) => l.order_id);
  const orders = scopedOrders(db, orderIds);
  const lines = orderLines(db, orderIds);

  const skipped: string[] = [];
  const serves: Array<{ order_id: string; ids: string[]; inEngine: boolean }> = [];
  payload.lines.forEach((entry, i) => {
    if (!orders.has(entry.order_id)) throw new DomainError('ORDER_NOT_FOUND', { order_id: entry.order_id });
    const byId = new Map(lines.get(entry.order_id)!.map((l) => [l.order_item_id, l]));
    const inEngine = isOrderInEngine(ctx.state, entry.order_id, now);
    const ids: string[] = [];
    entry.order_item_ids.forEach((id, k) => {
      const line = byId.get(id);
      if (line === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_id: entry.order_id });
      // §3.4 (owner 2026-11-11 S-1 H-b): a deal header is never served (its parts are); 400 at the id's path, as C6.
      if (line.line_kind === 'deal') {
        throw new DomainError('VALIDATION_FAILED', { issues: [{ path: `lines.${i}.order_item_ids.${k}`, message: 'deal header line' }] });
      }
      if (line.served_at !== null) {
        skipped.push(id);
        return;
      }
      if (line.live_units === 0) {
        throw new DomainError('ITEM_WRONG_STAGE', { order_item_id: id, stage: line.voided_units > 0 ? 'voided' : 'removed' });
      }
      const engineLine = inEngine ? ctx.state.lines[id] : undefined;
      if (engineLine !== undefined && engineLine.stage === 'added' && engineLine.fired_at === null) {
        throw new DomainError('ITEM_WRONG_STAGE', { order_item_id: id, stage: 'added' });
      }
      ids.push(id);
    });
    if (ids.length > 0) serves.push({ order_id: entry.order_id, ids, inEngine });
  });

  checkOrderScope(ctx, orderIds.map((id) => orders.get(id)!));

  const envelope = { occurred_at: now, actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  // §3.7 / §3.12 (Q-6): a queued serve keeps the accepted (clamped) queued_at as served_at; absent on a live call.
  const servedTime = ctx.queuedAt ?? now;
  const servedDrafts = serves.map((s): EventDraft => {
    const p: ItemServedPayload = { order_item_ids: s.ids, source: 'tap', ...(ctx.queuedAt === null ? {} : { served_at: ctx.queuedAt }) };
    return { stream_type: 'order', stream_id: s.order_id, event_type: 'ItemServed', schema_version: 1, payload: p, ...envelope };
  });
  // AD-29 Q7: one stockEffects call over the in-engine serves, split back per ItemServed. The split relies on engine
  // stock.ts effectsOf never giving an ItemServed `before` effects (its case returns `before: []`), so every effect
  // follows its own ItemServed up to the next one; an effect ahead of the first ItemServed is a broken assumption.
  const effects = new Map<EventDraft, EventDraft[]>();
  let current: EventDraft[] | null = null;
  const inEngineDrafts = servedDrafts.filter((_, i) => serves[i]!.inEngine);
  const inEngineSet = new Set(inEngineDrafts);
  for (const d of stockEffects(ctx.state, inEngineDrafts)) {
    if (inEngineSet.has(d as EventDraft)) effects.set(d as EventDraft, (current = []));
    else if (current === null) throw new Error('MarkServed: stockEffects drafted an effect before an ItemServed');
    else current.push({ ...d, ...envelope });
  }

  const events: EventDraft[] = [];
  serves.forEach((s, i) => {
    const itemServed = servedDrafts[i]!;
    const after = lines.get(s.order_id)!.map((l) => (s.ids.includes(l.order_item_id) ? { ...l, served_at: servedTime, served_source: 'tap' as const } : l));
    const food = foodDrafts(s.order_id, after, { kind: 'served', order_item_ids: s.ids }).map((d): EventDraft => ({ ...d, ...envelope }));
    events.push(itemServed, ...food, ...(effects.get(itemServed) ?? []));
  });
  return { events, result: { served: serves.reduce((n, s) => n + s.ids.length, 0), skipped } };
}

export const markServedCommand = defineCommand({
  commandType: 'MarkServed',
  payloadSchema: MarkServedPayload,
  sessionKind: 'device',
  permission: 'mark-served',
  queueable: true,
  handle: (ctx, payload) => markServed(ctx, payload),
});

export function registerMarkServed(app: FastifyInstance): void {
  commandRegistry(app).register(markServedCommand);
}
