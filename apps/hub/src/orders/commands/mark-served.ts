// 02b §6.4 MarkServed (queueable), §3.7, O16, §3.3, §3.14. No lock (D39; 02a P-1e, #62).
import { DomainError } from '@pos/domain';
import { isOrderInEngine, stockEffects, type EngineState } from '@pos/engine';
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
import { alerts } from '../../alerts/raise.js';
import { keyBalances } from '../../billing/queries/key-balances.js';
import { currentTableOf } from '../../tables/reads.js';
import type { LineView, OrderType } from '../contracts.js';
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
 * ⚠️ 02b v1.0.25 §6.4 (run 3 R3-M-3, R3-M-4): the hand-over facts the same orders read carries (bill key, liveness and
 * the D2 approval columns), so `customer_handover` adds no order read (`servingOrders`).
 */
export interface HandoverFacts {
  bill_key: string;
  cancelled_at: number | null;
  billed_at: number | null;
  day_closed_at: number | null;
  unpaid_handover_approved_at: number | null;
  unpaid_handover_approved_due_minor: number | null;
}

/**
 * MarkServed's orders read (§6.4 base read 1): the named orders with the holder of their open seating (02a
 * `seating_orders` ⋈ `seatings`, read-only, P-1c) and their hand-over facts. 1 statement. An unknown id has no entry.
 */
export function servingOrders(db: Database.Database, order_ids: readonly string[]): Map<string, ScopedOrder & HandoverFacts> {
  const rows = db
    .prepare(
      `SELECT o.order_id AS order_id, o.order_type AS order_type, o.placed_by AS placed_by, s.holder_staff_id AS holder_staff_id,
              o.bill_key AS bill_key, o.cancelled_at AS cancelled_at, o.billed_at AS billed_at, o.day_closed_at AS day_closed_at,
              o.unpaid_handover_approved_at AS unpaid_handover_approved_at,
              o.unpaid_handover_approved_due_minor AS unpaid_handover_approved_due_minor
         FROM (SELECT DISTINCT value FROM json_each(?)) j
         JOIN orders o ON o.order_id = j.value
         LEFT JOIN seating_orders so ON so.order_id = o.order_id
         LEFT JOIN seatings s ON s.seating_id = so.seating_id AND s.state <> 'CLOSED'`,
    )
    .all(JSON.stringify(order_ids)) as Array<ScopedOrder & HandoverFacts>;
  return new Map(rows.map((r) => [r.order_id, r]));
}

/** The §3.14 scope fields of the named orders (`servingOrders` narrowed). 1 statement. An unknown id has no entry. */
export function scopedOrders(db: Database.Database, order_ids: readonly string[]): Map<string, ScopedOrder> {
  const out = new Map<string, ScopedOrder>();
  for (const [id, o] of servingOrders(db, order_ids)) out.set(id, { order_id: o.order_id, order_type: o.order_type, placed_by: o.placed_by, holder_staff_id: o.holder_staff_id });
  return out;
}

/**
 * §3.14 "as MarkServed", pure (⚠️ Changed by 03b v1.0.1 G-3, owner 2026-11-11; 02b v1.0.6 note): is order `o` inside the
 * scope of `who.resolution` (the staff's resolved right, e.g. `mark-served`) for `who.staffId`? `branch` → yes. Dine-in:
 * the current table — `own_tables` = the staff holds the order's open seating; `my_floors` = a table of the seating
 * (`tables`, 02a `currentTableOf`, read once by the caller; null → none) is on one of `floorsOf(staffId)`. Takeaway /
 * parking: `own_tables` and `my_floors` = placed by the staff (01b B-4). No staff or no scope → no. 0 statements.
 * 03b's Handover receiver and `pass-receivers` call it for staff other than the caller with one shared `tables`.
 *
 * It checks the SCOPE only, never the grant: a `requires_approval` resolution with a scope is covered like an
 * `allowed` one. Callers must check `who.resolution.grant === 'allowed'` first (03b §3.5 step 2, #25). For the
 * caller's own command that check is already done by `commands/route.ts` `authorize` (requires_approval passes only
 * for an approvable command), so `checkOrderScope` needs none; a receiver or candidate who is not the caller has no
 * such gate.
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
  // ⚠️ 02b v1.0.25 §6.4 (run 3 R3-M-4): staff takeaway / parking customer actions (§8); omitted → ordinary §3.7 serving.
  customer_handover: z.literal(true).optional(),
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
 * Queued (§3.12): `served_at` = `ctx.queuedAt` on each ItemServed. ⚠️ 02b v1.0.25 §6.4 (run 3 R3-M-4):
 * `customer_handover: true` takes takeaway / parking only (dine-in → 400 at `lines.i.order_id`) and runs
 * `checkHandover` after scope (+ at most 1 `keyBalances` read).
 */
function markServed(ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: { served: number; skipped: string[] } } {
  const db = ctx.tx.db;
  const now = ctx.clock.branchNow();
  const orderIds = payload.lines.map((l) => l.order_id);
  const orders = servingOrders(db, orderIds);
  const lines = orderLines(db, orderIds);

  const skipped: string[] = [];
  const serves: ServeEntry[] = [];
  payload.lines.forEach((entry, i) => {
    if (!orders.has(entry.order_id)) throw new DomainError('ORDER_NOT_FOUND', { order_id: entry.order_id });
    if (payload.customer_handover === true && orders.get(entry.order_id)!.order_type === 'dine_in') {
      throw new DomainError('VALIDATION_FAILED', { issues: [{ path: `lines.${i}.order_id`, message: 'takeaway_or_parking_only' }] });
    }
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
  if (payload.customer_handover === true) checkHandover(db, orders, lines, serves);

  const envelope: ServedEnvelope = {
    occurred_at: now,
    actor_id: ctx.actor.staffId,
    device_id: ctx.actor.deviceId,
    // §3.7 / §3.12 (Q-6): a queued serve keeps the accepted (clamped) queued_at as served_at; absent on a live call.
    ...(ctx.queuedAt === null ? {} : { served_at: ctx.queuedAt }),
  };
  const events = [...servedDrafts(ctx.state, lines, serves, envelope, 'tap'), ...handedOverCloses(ctx, orders, lines, serves)];
  return { events, result: { served: serves.reduce((n, s) => n + s.ids.length, 0), skipped } };
}

/** §6.4: the live unserved non-deal lines of an order (deal parts and option children included; headers never). */
export const unservedLive = (lines: readonly LineView[]): LineView[] => lines.filter((l) => l.line_kind !== 'deal' && l.live_units > 0 && l.served_at === null);

/**
 * ⚠️ 02b v1.0.25 §6.4 (run 3 R3-M-4; §3.7a, D2, D3): the explicit customer hand-over check, in the serving writer
 * transaction (a queued send is rechecked here as a live one). An order whose last live unserved non-deal line this send
 * would serve, still live (not cancelled, billed or day-closed), with a positive fresh due of its key needs its own
 * effective approval (approved and due ≤ the approved amount). One batched `keyBalances` read for those keys, none
 * when no order serves its last line. Refuses the whole send, before anything is appended, with
 * 403 PERMISSION_DENIED { reason: 'unpaid_handover_approval_required', order_id } (the first such order in payload order).
 */
function checkHandover(
  db: Database.Database,
  orders: ReadonlyMap<string, ScopedOrder & HandoverFacts>,
  lines: ReadonlyMap<string, readonly LineView[]>,
  serves: readonly ServeEntry[],
): void {
  const last = servesLast(lines, serves)
    .map((s) => orders.get(s.order_id)!)
    .filter((o) => o.cancelled_at === null && o.billed_at === null && o.day_closed_at === null);
  if (last.length === 0) return;
  const dues = keyBalances(db, [...new Set(last.map((o) => o.bill_key))]);
  for (const o of last) {
    const due = dues.get(o.bill_key)?.due_minor ?? 0;
    if (due <= 0) continue;
    const approved = o.unpaid_handover_approved_at !== null && o.unpaid_handover_approved_due_minor !== null && due <= o.unpaid_handover_approved_due_minor;
    if (!approved) throw new DomainError('PERMISSION_DENIED', { reason: 'unpaid_handover_approval_required', order_id: o.order_id });
  }
}

/** §6.12a the unpaid hand-over request kind (orders/hand-over-unpaid-kind.ts); a string here, as line-change's COMP_KIND. */
const HAND_OVER_UNPAID = 'hand_over_unpaid';

/** The orders of `serves` whose last live unserved non-deal line this send serves (payload order). */
function servesLast(lines: ReadonlyMap<string, readonly LineView[]>, serves: readonly ServeEntry[]): ServeEntry[] {
  return serves.filter((s) => unservedLive(lines.get(s.order_id) ?? []).every((l) => s.ids.includes(l.order_item_id)));
}

/**
 * ⚠️ 02b v1.0.25 §3.7a Close (a), §6.4 (run 3 R3-M-3): a takeaway / parking order this send leaves with no live
 * unserved non-deal line closes its open `hand_over_unpaid` request `obsolete`, note `handed_over` (01d sends the
 * requester `request_result`). Only then 1 batched `alerts.listOpen` (kind) for all such orders, plus one closeMany for
 * the hits; a dine-in serve or a partial one adds no read.
 */
function handedOverCloses(
  ctx: CommandCtx,
  orders: ReadonlyMap<string, ScopedOrder>,
  lines: ReadonlyMap<string, readonly LineView[]>,
  serves: readonly ServeEntry[],
): EventDraft[] {
  const handedIds = servesLast(lines, serves).filter((s) => orders.get(s.order_id)!.order_type !== 'dine_in').map((s) => s.order_id);
  const handed = new Set(handedIds.map((id) => `${HAND_OVER_UNPAID}:${id}`));
  if (handed.size === 0) return [];
  // ⚠️ 02b v1.0.26 (owner 2026-11-28 Q9): a bill's request (values.order_ids) closes when this send hands over any order it
  // covers (the rest of that bill asks again, as a new request)
  const ids = new Set(handedIds);
  const covers = (v: unknown): boolean => {
    const o = (v ?? {}) as { order_id?: unknown; order_ids?: unknown };
    const list = Array.isArray(o.order_ids) ? o.order_ids : [o.order_id];
    return list.some((id) => typeof id === 'string' && ids.has(id));
  };
  const hits = alerts.listOpen(ctx.tx.db, { kind: HAND_OVER_UNPAID }).filter((a) => handed.has(a.dedupe_key) || (a.dedupe_key?.startsWith(`${HAND_OVER_UNPAID}:bill:`) === true && covers(a.values)));
  return hits.length === 0 ? [] : alerts.closeMany(ctx, hits.map((a) => ({ alert_id: a.alert_id, reason: 'obsolete' as const, note: 'handed_over' })));
}

/** One order's lines to serve (validated by the caller); `inEngine` = `isOrderInEngine` at the envelope time (O16). */
export interface ServeEntry {
  order_id: string;
  ids: string[];
  inEngine: boolean;
}

/** The serve envelope; `served_at` (a queued MarkServed's accepted queued_at, §3.12) goes on each ItemServed when set. */
export interface ServedEnvelope {
  occurred_at: number;
  actor_id: string | null;
  device_id: string;
  served_at?: number;
}

/**
 * §3.7 the serve drafts (⚠️ Changed by 03b v1.0.1 G-2; 02b v1.0.6 note): per entry, in order, `ItemServed
 * { order_item_ids, source, served_at? }` → `OrderFoodServed` when it serves a food line (§3.3, AD-13) → its
 * `stockEffects` (one call over the in-engine serves, array form, AD-29 Q7). `lines` = `orderLines` of the entries'
 * orders (read by the caller). MarkServed calls it with `source: 'tap'`; 03b's `served_estimate` tick (task 0e,
 * §6.11) with `'estimated'`. 0 statements.
 */
export function servedDrafts(
  state: EngineState,
  lines: ReadonlyMap<string, readonly LineView[]>,
  serves: readonly ServeEntry[],
  envelope: ServedEnvelope,
  source: 'tap' | 'estimated',
): EventDraft[] {
  const { served_at, ...env } = envelope;
  const servedTime = served_at ?? env.occurred_at;
  const itemServed = serves.map((s): EventDraft => {
    const p: ItemServedPayload = { order_item_ids: s.ids, source, ...(served_at === undefined ? {} : { served_at }) };
    return { stream_type: 'order', stream_id: s.order_id, event_type: 'ItemServed', schema_version: 1, payload: p, ...env };
  });
  // AD-29 Q7: one stockEffects call over the in-engine serves, split back per ItemServed. The split relies on engine
  // stock.ts effectsOf never giving an ItemServed `before` effects (its case returns `before: []`), so every effect
  // follows its own ItemServed up to the next one; an effect ahead of the first ItemServed is a broken assumption.
  const effects = new Map<EventDraft, EventDraft[]>();
  let current: EventDraft[] | null = null;
  const inEngineDrafts = itemServed.filter((_, i) => serves[i]!.inEngine);
  const inEngineSet = new Set(inEngineDrafts);
  for (const d of stockEffects(state, inEngineDrafts)) {
    if (inEngineSet.has(d as EventDraft)) effects.set(d as EventDraft, (current = []));
    else if (current === null) throw new Error('MarkServed: stockEffects drafted an effect before an ItemServed');
    else current.push({ ...d, ...env });
  }

  const events: EventDraft[] = [];
  serves.forEach((s, i) => {
    const draft = itemServed[i]!;
    const after = (lines.get(s.order_id) ?? []).map((l) => (s.ids.includes(l.order_item_id) ? { ...l, served_at: servedTime, served_source: source } : l));
    const food = foodDrafts(s.order_id, after, { kind: 'served', order_item_ids: s.ids }).map((d): EventDraft => ({ ...d, ...env }));
    events.push(draft, ...food, ...(effects.get(draft) ?? []));
  });
  return events;
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
