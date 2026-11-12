// 04 §3.1–§3.3 (task v3): the void planner, shared by VoidItems (direct and approval paths, v4 / v6) and the kind's
// read-only `apply` (v7). `planVoidEntries` is pure over readOrder's rows, the open requests the caller read and engine
// state (0 statements); `voidDrafts` builds the effect drafts with ONE withStockEffects and ONE lineChangeDrafts.
import { DomainError, type VoidDisposition, type VoidReasonCode } from '@pos/domain';
import { isOrderInEngine, openDayStartMs, type EngineState } from '@pos/engine';
import type { EventDraft, ItemMovedToStockPayload, ItemVoidedPayload } from '@pos/events';
import type { CommandCtx } from '../commands/registry.js';
import { openDayStockCtx, withStockEffects } from '../commands/set-precooked-stock.js';
import type { LineChangeDrafts } from '../orders/contracts.js';
import type { ReadOrderLine } from '../orders/exports.js';
import { gmlDealPartPartial, liveUnits, planVoid, type PlannedLine } from '../orders/ledger.js';
import { lineChangeDrafts } from '../orders/line-change.js';

/** §6.1 payload entry. */
export interface VoidEntry {
  order_item_id: string;
  /** absent = all live units of the line (working copy) */
  units?: number;
  disposition: VoidDisposition;
}

/** An open 01d request as `alerts.listOpen` returns it (only `alert_id` and `values` are read). */
export interface OpenRequest {
  alert_id: string;
  values: unknown;
}

/** §10 / §3.5 `lines[].state`: the stage only. */
export type VoidLineState = 'not_started' | 'cooking' | 'cooked' | 'served';

export interface PlanInput {
  order_id: string;
  /** readOrder's lines, as read (the working copy is built from them) */
  lines: readonly ReadOrderLine[];
  state: Readonly<EngineState>;
  now: number;
  /** branchConfig().engine_settings.zone_undo_ms (V1 f) */
  zone_undo_ms: number;
  entries: readonly VoidEntry[];
  /**
   * `direct`: rule 6 (b) only. `approval` (the raise): rule 6 (a)–(c). `apply` (§3.4, v7): no rule 6, no grant check;
   * the entry's `frozen` dispositions are used (OQ-D, OQ-F).
   */
  path: 'direct' | 'approval' | 'apply';
  /** rule 6 (b): open `void_approval` requests of the order (`values.touched_ids`) */
  open_voids: readonly OpenRequest[];
  /** rule 6 (c): open `comp` requests of the order (`values.order_item_id`, `values.units`) */
  open_comps: readonly OpenRequest[];
  /** rule 7: the caller's `resolve('move-item-to-stock').grant === 'allowed'` (B-2: a requires_approval grant is not) */
  move_granted: boolean;
  /** `apply` only: the request's stored `values.line_dispositions`, one map per entry */
  frozen?: ReadonlyArray<Readonly<Record<string, VoidDisposition | null>>>;
}

export interface PlannedEntry {
  order_item_id: string;
  units: number;
  disposition: VoidDisposition;
  /** 02b planVoid's lines: the named line first, then its cascade (0-unit lines dropped) */
  lines: PlannedLine<ItemVoidedPayload>[];
  refund_minor: number;
  comp_voided_minor: number;
  touched_ids: string[];
  /** V3 per-line dispositions (stored as `values.line_dispositions` on a request) */
  line_dispositions: Record<string, VoidDisposition | null>;
  /** §3.1 headers among the touched lines (the named line only, if any) */
  header_ids: string[];
  /** §3.5 details `lines[].state` per touched line, before the void */
  states: Record<string, VoidLineState>;
}

/**
 * V3 / §3.2 rule 7 / §3.4: a line `moved` can take — in engine state at cooking / done with a stock draw. One rule for
 * the planner (raise, direct, `apply`'s re-check) and `pendingVoids`' `blocked` (exports.ts), so they never disagree.
 */
export function movableLine(state: Readonly<EngineState>, id: string): boolean {
  const line = state.lines[id];
  return line !== undefined && (line.stage === 'cooking' || line.stage === 'done') && line.draws.length > 0;
}

/** 02b §3.4: an engine stage open before served (the g/ml part rule's "open in the engine"). */
const OPEN = new Set(['added', 'cooking', 'done']);

const invalid = (path: string, message: string): DomainError => new DomainError('VALIDATION_FAILED', { issues: [{ path, message }] });

/** The cascade children of a line (§3.1 touched lines): a deal's parts, an item's option children. */
function childrenOf(work: ReadonlyMap<string, ReadOrderLine>, line: ReadOrderLine): ReadOrderLine[] {
  const kind = line.line_kind === 'deal' ? 'deal_part' : line.line_kind === 'item' ? 'option_child' : null;
  return kind === null ? [] : [...work.values()].filter((c) => c.parent_order_item_id === line.order_item_id && c.line_kind === kind);
}

/**
 * §3.2 rules 1, 4–7 per entry in payload order against a working copy of the order's lines (each earlier entry's
 * plan applied to it), §3.3 step 1 (planVoid + per-line dispositions, V3). Pure: 0 statements. Throws the first
 * refusal as a DomainError.
 */
export function planVoidEntries(input: PlanInput): PlannedEntry[] {
  const { state, now } = input;
  const inEngine = isOrderInEngine(state, input.order_id, now);
  const read = new Map(input.lines.map((l) => [l.order_item_id, l]));
  const work = new Map(input.lines.map((l) => [l.order_item_id, { ...l }]));

  // §3.1 engine line (⚠️ 04 v1.0.3 Q-14, task u10): read exactly from readOrder's station_id (02b v1.0.12) —
  // station_id IS NOT NULL and not a deal (03a isEngineLine), whether or not the order is still in the engine. The stage
  // still comes from engine state: a station line absent from it (its order left the engine) counts as started.
  // A station line dropped from engine state on a non-strict boot (03a dropListed of a writer-bug line) is likewise
  // "absent → started", per §3.1.
  // `line_kind !== 'deal'` is defensive per §3.1: the fold always writes NULL for a deal header today.
  const engine = (id: string): boolean => {
    const l = read.get(id);
    return l !== undefined && l.station_id !== null && l.line_kind !== 'deal';
  };
  const stageOf = (id: string): string | undefined => state.lines[id]?.stage;
  const zoneInUndo = (l: ReadOrderLine): boolean => l.zone_served && now - l.added_at <= input.zone_undo_ms;

  /** §3.1 not started. */
  const notStarted = (l: ReadOrderLine): boolean => {
    if (engine(l.order_item_id)) return stageOf(l.order_item_id) === 'added'; // an engine line at added; absent from state → started
    const parent = l.parent_order_item_id === null ? undefined : read.get(l.parent_order_item_id);
    if (l.line_kind === 'option_child' && parent !== undefined && engine(parent.order_item_id)) return notStarted(parent);
    return l.served_at === null;
  };

  /** V1 for one line on its own: (a), (b), (c), (d), (f). */
  const pastLine = (l: ReadOrderLine): boolean => {
    if (l.zone_served) return !zoneInUndo(l); // (f), before any engine-stage check (02b's zone rule)
    if (!inEngine) return true; // (b)
    if (engine(l.order_item_id)) return stageOf(l.order_item_id) !== 'added'; // (a), (d) own engine line
    const parent = l.parent_order_item_id === null ? undefined : read.get(l.parent_order_item_id);
    if (l.line_kind === 'option_child' && parent !== undefined && engine(parent.order_item_id)) return stageOf(parent.order_item_id) !== 'added'; // (d)
    return l.served_at !== null; // (c), (d) with a non-engine parent
  };

  /** V1 for a named line: (e) a deal by its parts, (d′) an item by itself or any of its option children. */
  const past = (l: ReadOrderLine): boolean => {
    const live = childrenOf(work, l).filter((c) => c.live_units > 0);
    if (l.line_kind === 'deal') return live.some(pastLine);
    if (l.line_kind === 'item') return pastLine(l) || live.some(pastLine);
    return pastLine(l);
  };

  /** §3.1 touched line state for the card (§3.5 details.lines). */
  const lineState = (l: ReadOrderLine): VoidLineState => {
    if (notStarted(l)) return 'not_started';
    const stage = stageOf(l.order_item_id);
    if (stage === 'cooking') return 'cooking';
    if (stage === 'done') return 'cooked';
    if (stage === 'served' || stage === 'returned' || l.served_at !== null) return 'served';
    return 'cooked';
  };

  /** V3 moved: an open engine stage cooking / done (the line in state) with a stock draw; `inEngine` gates V1 (b) only. */
  const atCookingOrDone = (id: string): boolean => stageOf(id) === 'cooking' || stageOf(id) === 'done';
  const movable = (id: string): boolean => movableLine(state, id);

  // rule 6 (b): every line some open void request locks
  const locks = new Map<string, string>();
  for (const r of input.open_voids) {
    const touched = (r.values as { touched_ids?: unknown }).touched_ids;
    if (Array.isArray(touched)) for (const id of touched) if (typeof id === 'string' && !locks.has(id)) locks.set(id, r.alert_id);
  }
  // rule 6 (c): comp lines of every open comp request that still fits (from the lines as read; 0 statements, H3-7)
  const compLines = new Map<string, string>();
  for (const r of input.open_comps) {
    const v = r.values as { order_item_id?: unknown; units?: unknown };
    if (typeof v.order_item_id !== 'string' || typeof v.units !== 'number') continue;
    const named = read.get(v.order_item_id);
    if (named === undefined || named.live_units - named.comped_units < v.units) continue; // already stale: no block
    for (const l of [named, ...childrenOf(read, named)]) if (!compLines.has(l.order_item_id)) compLines.set(l.order_item_id, r.alert_id);
  }

  const earlier = new Set<string>();
  return input.entries.map((entry, i) => {
    const at = `lines.${i}`;
    // rule 1
    const line = work.get(entry.order_item_id);
    if (line === undefined) throw invalid(`${at}.order_item_id`, 'not a line of this order');
    // rule 4 (V1). The `zone_undo` stage value is judged on the named line only (accepted: a cascade child is never a
    // zone line on its own; the refusal names the line the caller asked for).
    if (!past(line)) {
      throw new DomainError('ITEM_WRONG_STAGE', { order_item_id: line.order_item_id, stage: line.zone_served && zoneInUndo(line) ? 'zone_undo' : 'added' });
    }
    // rule 5
    const n = entry.units ?? line.live_units;
    if (n < 1 || n > line.live_units) throw invalid(`${at}.units`, 'units > live_units');
    if ((line.line_kind === 'item' || line.line_kind === 'option_child') && line.sale_unit !== 'piece' && n !== line.live_units) {
      throw invalid(`${at}.units`, 'gml_whole_only');
    }
    const children = childrenOf(work, line);
    if (line.line_kind === 'deal' || line.line_kind === 'deal_part') {
      const parts = (line.line_kind === 'deal' ? children : [line]).map((p) => ({ sale_unit: p.sale_unit, open_in_engine: OPEN.has(stageOf(p.order_item_id) ?? '') }));
      if (gmlDealPartPartial({ line_kind: line.line_kind, live_units: line.live_units, units: n, parts })) throw invalid(`${at}.units`, 'gml_deal_part_partial');
    }
    // §3.3 step 1: 02b's plan
    const plan = planVoid(line, children, n);
    const touched = plan.lines.map((p) => p.order_item_id);
    const touchedLines = touched.map((id) => work.get(id)!);

    // rule 6
    if (input.path === 'approval') {
      const overlap = touched.find((id) => earlier.has(id));
      if (overlap !== undefined) throw invalid(`${at}.order_item_id`, 'overlaps_entry');
    }
    if (input.path !== 'apply') {
      const locked = touched.find((id) => locks.has(id));
      if (locked !== undefined) throw new DomainError('VOID_PENDING', { alert_id: locks.get(locked)!, order_item_id: locked });
    }
    if (input.path === 'approval') {
      const comped = touched.find((id) => compLines.has(id));
      if (comped !== undefined) throw new DomainError('COMP_PENDING', { alert_id: compLines.get(comped)! });
    }

    // §3.1 header: a deal, or an item with no engine line of its own whose touched option children include an engine line
    const header = (l: ReadOrderLine): boolean =>
      l.order_item_id === line.order_item_id &&
      (l.line_kind === 'deal' || (l.line_kind === 'item' && !engine(l.order_item_id) && touched.some((t) => t !== l.order_item_id && engine(t))));

    // V3 per-line dispositions
    const frozen = input.path === 'apply' ? input.frozen?.[i] : undefined;
    if (input.path === 'apply' && frozen === undefined) throw new Error('04 planVoidEntries: apply needs the stored line_dispositions');
    const line_dispositions: Record<string, VoidDisposition | null> = {};
    for (const l of touchedLines) {
      let d: VoidDisposition | null;
      if (header(l)) d = null;
      else if (frozen !== undefined) {
        const stored = frozen[l.order_item_id] ?? null;
        d = stored === null ? (notStarted(l) ? null : 'wastage') : stored; // OQ-F; moved stays frozen (OQ-D)
      } else if (notStarted(l)) d = null;
      else if (entry.disposition === 'moved') d = movable(l.order_item_id) ? 'moved' : 'wastage';
      else d = entry.disposition;
      line_dispositions[l.order_item_id] = d;
    }

    // rule 7
    if (frozen !== undefined) {
      // §3.4: the stage part on the frozen dispositions; a stored `moved` line served meanwhile cannot be approved (OQ-D)
      const stale = touched.find((id) => line_dispositions[id] === 'moved' && !movable(id));
      if (stale !== undefined) throw new DomainError('VOID_NOT_ALLOWED', { order_item_id: stale, reason: 'not_movable_stage', hint: 'withdraw_and_reask' });
    } else if (entry.disposition === 'moved') {
      if (!touched.some((id) => line_dispositions[id] === 'moved')) {
        const reason = touched.some(atCookingOrDone) ? 'stock_not_tracked' : 'not_movable_stage';
        throw new DomainError('VOID_NOT_ALLOWED', { order_item_id: line.order_item_id, reason });
      }
      if (openDayStartMs(state) === null) throw new DomainError('VOID_NOT_ALLOWED', { order_item_id: line.order_item_id, reason: 'day_closed' });
      if (input.path !== 'apply' && !input.move_granted) throw new DomainError('PERMISSION_DENIED', { reason: 'move_not_granted' });
    }

    const states = Object.fromEntries(touchedLines.map((l) => [l.order_item_id, lineState(l)]));
    // apply the plan to the working copy (02b RemoveItems' pattern: a cascade is counted once)
    for (const p of plan.lines) {
      const w = work.get(p.order_item_id)!;
      Object.assign(w, p.after);
      w.live_units = liveUnits(w);
    }
    for (const id of touched) earlier.add(id);
    return {
      order_item_id: line.order_item_id,
      units: n,
      disposition: entry.disposition,
      lines: plan.lines,
      refund_minor: plan.refund_minor,
      comp_voided_minor: plan.comp_voided_minor,
      touched_ids: touched,
      line_dispositions,
      header_ids: touchedLines.filter(header).map((l) => l.order_item_id),
      states,
    };
  });
}

/** §3.3 step 2 fields every ItemVoided carries (V6). */
export interface VoidMeta {
  reason_code: VoidReasonCode;
  note: string | null;
  disposition_note: string | null;
  requester_staff_id: string;
  /** null on a direct void */
  approver_staff_id: string | null;
  /** the request's alert_id on the approval path (stamped on every draft, V5); null on a direct void */
  alert_id: string | null;
}

export interface VoidDraftsOptions {
  /** 02b row Q-4: `close` on the direct path; `keep` in the kind's `apply` (K-1) */
  stale_comps: 'close' | 'keep';
  /** test 30: an injected stub; default 02b's lineChangeDrafts */
  lineChangeDrafts?: LineChangeDrafts;
}

export interface VoidDraftsResult {
  drafts: EventDraft[];
  /** one row per touched line, in draft order */
  voided: Array<{ order_item_id: string; units: number; refund_minor: number; comp_voided_minor: number; disposition: VoidDisposition | null }>;
  cancelled: boolean;
}

/**
 * §3.3 steps 2–5. Statements: those of lineChangeDrafts only (2 in `close`, 1 in `keep`); withStockEffects is in
 * memory. Read-only safe (builds drafts, appends nothing).
 */
export function voidDrafts(ctx: CommandCtx, order_id: string, entries: readonly PlannedEntry[], meta: VoidMeta, opts: VoidDraftsOptions): VoidDraftsResult {
  const envelope = { occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  const order = { stream_type: 'order' as const, stream_id: order_id, schema_version: 1 };
  // step 2: per entry, first an ItemMovedToStock per `moved` line, then the entry's ItemVoided drafts
  const causes: EventDraft[] = [];
  const voided: VoidDraftsResult['voided'] = [];
  for (const e of entries) {
    for (const l of e.lines) {
      if (e.line_dispositions[l.order_item_id] !== 'moved') continue;
      const payload: ItemMovedToStockPayload = { order_item_id: l.order_item_id, units: l.units };
      causes.push({ ...order, ...envelope, event_type: 'ItemMovedToStock', payload });
    }
    for (const l of e.lines) {
      const disposition = e.line_dispositions[l.order_item_id] ?? null;
      const payload: ItemVoidedPayload = {
        ...l.payload,
        disposition,
        reason_code: meta.reason_code,
        note: meta.note,
        disposition_note: meta.disposition_note,
        requester_staff_id: meta.requester_staff_id,
        approver_staff_id: meta.approver_staff_id,
        alert_id: meta.alert_id,
      };
      causes.push({ ...order, ...envelope, event_type: 'ItemVoided', payload });
      voided.push({ order_item_id: l.order_item_id, units: l.units, refund_minor: l.payload.refund_minor ?? 0, comp_voided_minor: l.payload.comp_voided_minor ?? 0, disposition });
    }
  }
  // step 3: ONE stock pass. Risk row: day_closed before openDayStockCtx (a plain Error, 500, with no open day).
  const firstMoved = causes.find((d) => d.event_type === 'ItemMovedToStock');
  if (firstMoved !== undefined && openDayStartMs(ctx.state) === null) {
    throw new DomainError('VOID_NOT_ALLOWED', { order_item_id: (firstMoved.payload as ItemMovedToStockPayload).order_item_id, reason: 'day_closed' });
  }
  const withStock = causes.length === 0 ? [] : withStockEffects(ctx, causes, firstMoved === undefined ? undefined : openDayStockCtx(ctx.state));
  // step 4: ONE line-change pass over every touched line's total units out
  const out = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) out.set(l.order_item_id, (out.get(l.order_item_id) ?? 0) + l.units);
  const changes = [...out].map(([order_item_id, units_out]) => ({ order_item_id, units_out }));
  const lineChange = (opts.lineChangeDrafts ?? lineChangeDrafts)(ctx, order_id, changes, { stale_comps: opts.stale_comps });
  if (opts.stale_comps === 'keep' && lineChange.some((d) => d.event_type === 'AlertClosed')) {
    throw new Error('04 voidDrafts: lineChangeDrafts closed a comp request in keep mode (K-1)');
  }
  // step 5: approval path — the request's alert_id on every PAYLOAD, after withStockEffects (it restamps envelopes)
  const all = [...withStock, ...lineChange];
  const drafts = meta.alert_id === null ? all : all.map((d) => ({ ...d, payload: { ...d.payload, alert_id: meta.alert_id } }));
  return { drafts, voided, cancelled: drafts.some((d) => d.event_type === 'OrderCancelled') };
}
