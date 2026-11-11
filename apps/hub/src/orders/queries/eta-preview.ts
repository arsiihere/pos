import { DomainError } from '@pos/domain';
import { calculateETA, checkOrderable, openDayStartMs, reserveStock, type EngineState, type ProposedLine } from '@pos/engine';
import type { ItemAddedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Writer } from '../../engine-host/writer.js';
import type { Clock } from '../../lib/clock.js';
import { hubTime } from '../../lib/hub-time.js';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { buildSubmit } from '../build-submit.js';
import {
  checkOrderFields,
  Line,
  Option,
  PayloadObject,
  seatingHasServedFood,
  soldOutDetails,
  stockUnitsOf,
  submitBuildCtx,
  zoneServe,
} from '../commands/submit-order.js';
import type { SubmitInput } from '../contracts.js';

// 02b v1.0.3 §6.14 GET /queries/eta-preview: §3.2 steps 4–8 read-only on a SubmitOrder draft without ids (temp keys),
// follow_up read as §3.3, reserveStock (pure, nothing appended) then calculateETA. Staff session; polled while a cart
// is edited, so countsAsActivity false (00 M59). Statements: item_availability 1 + zone counts 1 (only with a zone
// candidate) + follow_up 1 (dine-in only); as_of_seq is writer.lastSeq(), read with the state in one synchronous step.
//
// Readings (task 13 report): the draft keeps table_id / seating_id (they are not line ids); the routing and zone table is
// the draft's table_id (the preview reads no seating, so no primary-table lookup, no TABLE_SEATING_CHANGED); a step 4–8
// refusal names its line (`refused`) and the other lines are still previewed as if it were left out; a malformed draft
// (VALIDATION_FAILED) and no open day (BUSINESS_DAY_NOT_OPEN, step 1) refuse the whole request. Ids are minted here and
// never leave this function.

export const DRAFT_MAX_BYTES = 8_192;
const PREVIEW_ORDER_ID = 'eta-preview';
const LINE_REFUSALS = new Set(['MENU_ITEM_NOT_FOUND', 'DEAL_NOT_FOUND', 'ITEM_UNAVAILABLE', 'ITEM_OUT_OF_HOURS', 'OPTION_CHOICE_INVALID', 'STATION_PAUSED', 'ITEM_SOLD_OUT']);

const Key = z.string().min(1);
const OptionDraft = Option.omit({ order_item_id: true }).extend({ key: Key.optional() });
const LineDraft = Line.omit({ order_item_id: true, options: true, deal_choices: true }).extend({
  key: Key,
  options: z.array(OptionDraft).optional(),
  deal_choices: z
    .array(z.object({ deal_part_id: z.string().min(1), item_id: z.string().min(1), key: Key, options: z.array(OptionDraft).optional() }).strict())
    .optional(),
});
const DraftObject = PayloadObject.omit({ order_id: true, lines: true }).extend({ lines: z.array(LineDraft).min(1).max(40) });
type Draft = z.infer<typeof DraftObject>;
type DraftLine = Draft['lines'][number];

const Draft = DraftObject.superRefine((d, rc) => {
  checkOrderFields(d, rc);
  // A key names one line of the result: a repeated key → 400 at its path (as §3.2 step 3 does for ids).
  const seen = new Set<string>();
  for (const { key, path } of draftKeys(d.lines)) {
    if (seen.has(key)) rc.addIssue({ code: 'custom', path, message: 'key repeated in the draft' });
    seen.add(key);
  }
});

const Query = z.object({
  draft: z
    .string()
    .refine((s) => Buffer.byteLength(s, 'utf8') <= DRAFT_MAX_BYTES, { message: 'draft over 8 KB', abort: true })
    .transform((s, rc) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        rc.issues.push({ code: 'custom', message: 'draft is not JSON', input: s });
        return z.NEVER;
      }
    })
    .pipe(Draft),
});

/** Every key of the draft (lines, linked options, deal parts and their options), in draft order. */
function draftKeys(lines: readonly DraftLine[]): Array<{ key: string; line: number; path: Array<string | number> }> {
  const out: Array<{ key: string; line: number; path: Array<string | number> }> = [];
  lines.forEach((l, n) => {
    const add = (key: string | undefined, path: Array<string | number>): void => {
      if (key !== undefined) out.push({ key, line: n, path: [...path, 'key'] });
    };
    add(l.key, ['lines', n]);
    l.options?.forEach((o, k) => add(o.key, ['lines', n, 'options', k]));
    l.deal_choices?.forEach((c, k) => {
      add(c.key, ['lines', n, 'deal_choices', k]);
      c.options?.forEach((o, j) => add(o.key, ['lines', n, 'deal_choices', k, 'options', j]));
    });
  });
  return out;
}

export interface EtaPreview {
  as_of_seq: number;
  groups: Array<{ promise_ms: number; keys: string[] }>;
  lines: Array<{ key: string; eta_ms: number | null; from_stock: boolean; zone_served: boolean; refused?: { code: string; details: Record<string, unknown> } }>;
}

type Refusal = { code: string; details: Record<string, unknown> };

function handle(ctx: QueryCtx, draft: Draft, clock: Clock, asOfSeq: number): EtaPreview {
  const state = ctx.state as EngineState;
  const config = ctx.branchConfig;
  // Step 1's day: reserveStock needs the open day (no line can be previewed without it).
  const dayStart = openDayStartMs(state);
  if (dayStart === null || config === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');

  // Mint an id per key (never written anywhere); map each id back to its key and its draft line. The ids sort in draft
  // order (zero-padded): the engine breaks placement ties by order_item_id (03a), so the preview plans as a submit whose
  // ids the device minted in line order (ULIDs) does.
  const keys = draftKeys(draft.lines);
  const idOf = new Map(keys.map((k, i) => [k.key, `${PREVIEW_ORDER_ID}:${String(i).padStart(4, '0')}`]));
  const keyOf = new Map(keys.map((k) => [idOf.get(k.key)!, k.key]));
  const lineOf = new Map(keys.map((k) => [idOf.get(k.key)!, k.line]));
  const id = (key: string | undefined): { order_item_id?: string } => (key === undefined ? {} : { order_item_id: idOf.get(key)! });
  const { lines: draftLines, ...order } = draft;
  const lines: SubmitInput['lines'] = draftLines.map(({ key, options, deal_choices, ...rest }) => ({
    ...rest,
    order_item_id: idOf.get(key)!,
    ...(options === undefined ? {} : { options: options.map(({ key: k, ...o }) => ({ ...o, ...id(k) })) }),
    ...(deal_choices === undefined
      ? {}
      : {
          deal_choices: deal_choices.map(({ key: k, options: o, ...c }) => ({
            ...c,
            order_item_id: idOf.get(k)!,
            ...(o === undefined ? {} : { options: o.map(({ key: ok, ...x }) => ({ ...x, ...id(ok) })) }),
          })),
        }),
  }));
  const input: SubmitInput = { ...order, order_id: PREVIEW_ORDER_ID, lines };

  // §3.3 follow_up (dine-in): 1 statement. The draft's table routes the lines (§3.10; no seating read).
  const dineIn = draft.order_type === 'dine_in';
  const follow_up = dineIn && seatingHasServedFood(ctx.db, draft.seating_id!);
  const primary_table_id = dineIn ? draft.table_id! : null;
  const { now_ms: now, utc_offset_ms } = hubTime(clock);
  const buildCtx = submitBuildCtx(ctx.db, state, config, input, { now, utc_offset_ms }, primary_table_id, follow_up);

  const refused = new Map<number, Refusal>();
  const refuse = (n: number, e: DomainError): void => {
    const details = { ...(e.details as Record<string, unknown> | undefined) };
    if (typeof details.order_item_id === 'string') details.order_item_id = keyOf.get(details.order_item_id) ?? details.order_item_id;
    refused.set(n, { code: e.code, details });
  };

  // Step 4 per line: a line-level refusal names its line; a malformed line refuses the draft (400 at its draft path).
  lines.forEach((l, n) => {
    try {
      buildSubmit(config, { ...input, lines: [l] }, buildCtx);
    } catch (e) {
      if (e instanceof DomainError && LINE_REFUSALS.has(e.code)) return refuse(n, e);
      if (e instanceof DomainError && e.code === 'VALIDATION_FAILED') throw atDraftLine(e, n);
      throw e;
    }
  });

  const accepted = lines.filter((_, n) => !refused.has(n));
  const eta = new Map<string, number>();
  let groups: EtaPreview['groups'] = [];
  let itemAdded: ItemAddedPayload[] = [];
  let zoneServed = new Set<string>();
  let fromStock: Record<string, boolean> = {};
  if (accepted.length > 0) {
    // Steps 4–7 on the accepted lines, step 5's zone counts (1 statement with a candidate), as SubmitOrder does.
    const built = buildSubmit(config, { ...input, lines: accepted }, buildCtx);
    itemAdded = built.itemAdded;
    zoneServed = zoneServe(ctx.db, primary_table_id, built.itemAdded, built.zoneCandidates).served;
    const proposed = { ...built.proposed, lines: built.proposed.lines.filter((l) => !zoneServed.has(l.order_item_id)) };
    const ofLine = (n: number): ProposedLine[] => proposed.lines.filter((l) => lineOf.get(l.order_item_id) === n);

    // Step 8: STATION_PAUSED per line (checkOrderable reads each line on its own).
    for (const n of new Set(proposed.lines.map((l) => lineOf.get(l.order_item_id)!))) {
      try {
        checkOrderable(state, { ...proposed, lines: ofLine(n) });
      } catch (e) {
        if (e instanceof DomainError && e.code === 'STATION_PAUSED') refuse(n, e);
        else throw e;
      }
    }
    // Step 8: reserveStock in line order; a sold-out line is refused (its available counted as SubmitOrder does) and the
    // draft is re-reserved without it (a refused deal's other parts free their claims; leaving lines out only frees).
    const configStockUnits = stockUnitsOf(config);
    let live = proposed.lines.filter((l) => !refused.has(lineOf.get(l.order_item_id)!));
    let reserved = reserveStock(state, { ...proposed, lines: live }, dayStart, config.stock_items, configStockUnits);
    while (reserved.refused.length > 0) {
      for (const refusedId of reserved.refused) {
        const n = lineOf.get(refusedId)!;
        if (!refused.has(n)) refused.set(n, { code: 'ITEM_SOLD_OUT', details: soldOutDetails(state, config, live, reserved, dayStart, configStockUnits, refusedId) });
      }
      live = live.filter((l) => !refused.has(lineOf.get(l.order_item_id)!));
      reserved = reserveStock(state, { ...proposed, lines: live }, dayStart, config.stock_items, configStockUnits);
    }
    fromStock = reserved.from_stock;
    const plan = calculateETA(state, { ...proposed, lines: live }, now, reserved.from_stock);
    for (const l of plan.lines) eta.set(l.order_item_id, l.eta_ms);
    // promise_ms only, never target_land_ms (03a #9).
    groups = plan.groups.map((g) => ({ promise_ms: g.promise_ms, keys: g.order_item_ids.map((i) => keyOf.get(i)!) }));
  }

  // Lines in draft order: a refused line lists every key it has with its refusal; the others are SubmitOrder's §3.2
  // step 11 lines (ItemAdded order) under their keys.
  const out: EtaPreview['lines'] = [];
  draft.lines.forEach((_, n) => {
    const refusal = refused.get(n);
    if (refusal !== undefined) {
      for (const k of keys) if (k.line === n) out.push({ key: k.key, eta_ms: null, from_stock: false, zone_served: false, refused: refusal });
      return;
    }
    for (const a of itemAdded) {
      if (lineOf.get(a.order_item_id) !== n) continue;
      out.push({
        key: keyOf.get(a.order_item_id)!,
        eta_ms: eta.get(a.order_item_id) ?? null,
        from_stock: fromStock[a.order_item_id] === true,
        zone_served: zoneServed.has(a.order_item_id),
      });
    }
  });
  return { as_of_seq: asOfSeq, groups, lines: out };
}

// buildSubmit's 400 paths name the one-line input (`lines.0…order_item_id`): restate them at the draft line, by key.
function atDraftLine(e: DomainError, n: number): DomainError {
  const issues = ((e.details as { issues?: Array<{ path: string; message: string }> } | undefined)?.issues ?? []).map((i) => ({
    ...i,
    path: `draft.${i.path.replace(/^lines\.0(?=\.|$)/, `lines.${n}`).replace(/(^|\.)order_item_id$/, '$1key')}`,
  }));
  return new DomainError('VALIDATION_FAILED', { issues });
}

export function registerEtaPreviewQuery(app: FastifyInstance, writer: Pick<Writer, 'lastSeq'>, clock: Clock): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'eta-preview',
      sessionKind: 'device',
      session: 'required',
      countsAsActivity: false,
      querySchema: Query,
      // The state (ctx.state) and lastSeq are read in one synchronous step: no commit runs between them.
      handle: (ctx, q) => ({ data: handle(ctx, q.draft, clock, writer.lastSeq()) }),
    }),
  );
}
