// 05 §6.17 `CountShift`, §6.18 `CloseShift { skip_count }`, §6.19 `HandoverCount` and the §3.14 kind `shift_variance`
// (task 21), §3.11, B23, H8-1, R-42, R-44. A count closes the shift in the same transaction (owner Q-2): the drawer
// is free at once and no payment can land on it again (B11: a money shift is an `open` one).
// Order (00 §3.7 pipeline, then the handler): Zod `.strict()` (400) → the grant `manage-own-shift` (403, the
// pipeline) → the shift (404 SHIFT_NOT_FOUND) → OPEN (409 SHIFT_NOT_OPEN not_open) → [HandoverCount: a drawer shift,
// 409 no_drawer_shift] → [CloseShift: `skip-blind-count`, 403 skip_not_granted, after the state as §6.18 orders it]
// → another person's shift needs `close-shift-for-others` (403, the scope-like check last, C8).
// Blind count (B23): no refusal carries an amount; `expected_minor` / `variance_minor` appear only in the count's own
// response (CountShift, HandoverCount — a handover reveals its own expected only).
// R-42: the command compares |variance| with the branch's `variance_threshold_minor` (strictly greater → the
// `shift_variance` request, raised here, dedupe `variance:<shift_id>`); `ShiftCounted.variance_alert_id` = its
// alert_id, null within the threshold. The fold never reads the threshold. H7-6: the shift's open `petty_cash`
// requests are closed `obsolete` (note `shift_closed`) in the same transaction and listed (`closed_requests`).
// Statements (handler; the append and its folds are 00's; 01d's raise / closeMany their own bound), fixed whatever
// the payments or petty rows: CountShift — the shift (1), its open petty requests (1), the note (1, with a note):
// 2 / 3 (≤ 4); CloseShift — the shift with its open advances (1), the petty requests (1), the note (1): 2 / 3 (≤ 5);
// HandoverCount — the shift (1) (≤ 2). The kind's `apply`: the shift (1) on approve, 0 on reject; read-only.
// Privacy: the note is free text → `hashOmit: ['note']` (H-4, H16-7), its text only in `bill_texts` (H3-5); events,
// values and details carry ids and amounts only.
import { DomainError } from "@pos/domain";
import {
  draftOf,
  HandoverCounted,
  HandoverCountedPayload,
  ShiftClosed,
  ShiftClosedPayload,
  ShiftCounted,
  ShiftCountedPayload,
  ShiftCountSkipped,
  ShiftCountSkippedPayload,
  ShiftVarianceSignedOff,
  ShiftVarianceSignedOffPayload,
  type AlertDetails,
  type AlertDisplay,
  type EventDraft,
} from "@pos/events";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AlertApplyCtx, AnswerFacts } from "../../alerts/kinds.js";
import { alerts, type CloseItem } from "../../alerts/raise.js";
import { defineCommand, type CommandCtx } from "../../commands/registry.js";
import { commandRegistry } from "../../commands/route.js";
import { branchConfig } from "../../sync/branch-config-holder.js";
import { hubBilling } from "../defaults.js";
import { registerBillKindApply } from "../kinds/seam.js";
import type {
  ShiftVarianceDetails,
  ShiftVarianceValues,
} from "../kinds/values.js";
import { MAX_FLOAT_MINOR } from "./open-shift.js";

// ------------------------------------------------------------------------------------------------ payloads

/** A counted amount: 0 … 10¹² minor units (the float's bound, §6.15 H16-13). */
const Counted = z.number().int().min(0).max(MAX_FLOAT_MINOR);
/** §4.4: `note` ≤ 200. */
const Note = z.string().max(200).optional();

export const CountShiftPayload = z
  .object({ shift_id: z.string().min(1), counted_minor: Counted, note: Note })
  .strict();
export const CloseShiftPayload = z
  .object({
    shift_id: z.string().min(1),
    skip_count: z.literal(true),
    note: Note,
  })
  .strict();
export const HandoverCountPayload = z
  .object({ shift_id: z.string().min(1), counted_minor: Counted })
  .strict();

// ------------------------------------------------------------------------------------------------ shared steps

interface ShiftRow {
  shift_id: string;
  staff_id: string;
  drawer_device_id: string | null;
  state: "open" | "closed";
  expected_cash_minor: number;
  variance_state: string | null;
}

const SHIFT = `SELECT shift_id, staff_id, drawer_device_id, state, expected_cash_minor, variance_state FROM shifts WHERE shift_id = ?`;

/** CloseShift's one read: the shift and its open advances (G1-8: listed, never blocking). */
const SHIFT_WITH_ADVANCES = `SELECT s.shift_id, s.staff_id, s.drawer_device_id, s.state, s.expected_cash_minor, s.variance_state,
    (SELECT json_group_array(json_object('entry_id', p.entry_id, 'amount_minor', p.amount_minor, 'advance_staff_id', p.advance_staff_id))
       FROM (SELECT entry_id, amount_minor, advance_staff_id FROM petty_cash
              WHERE shift_id = s.shift_id AND kind = 'advance' AND settled_at IS NULL ORDER BY at, entry_id) p) AS advances_json
  FROM shifts s WHERE s.shift_id = ?`;

type Db = CommandCtx["tx"]["db"];

/** 404 / 409 not_open. */
function requireOpen(row: ShiftRow | undefined, shift_id: string): ShiftRow {
  if (row === undefined) throw new DomainError("SHIFT_NOT_FOUND", { shift_id });
  if (row.state !== "open")
    throw new DomainError("SHIFT_NOT_OPEN", { reason: "not_open" });
  return row;
}

/** §6.17–§6.19 (H6-7): another person's shift also needs `close-shift-for-others` (branch only, 01b). Last (C8). */
function requireOwnOrOthers(ctx: CommandCtx, row: ShiftRow): string {
  const staff_id = ctx.actor.staffId;
  if (staff_id === null)
    throw new DomainError("PERMISSION_DENIED", {
      permission: "manage-own-shift",
      grant: "not_granted",
    });
  if (
    row.staff_id !== staff_id &&
    ctx.directory.resolve(staff_id, "close-shift-for-others").grant !==
      "allowed"
  ) {
    throw new DomainError("PERMISSION_DENIED", {
      permission: "close-shift-for-others",
    });
  }
  return staff_id;
}

function noteOf(
  ctx: CommandCtx,
  note: string | undefined,
): { note_id: string | null; has_note: boolean; text: string | null } {
  if (note === undefined || note.trim() === "")
    return { note_id: null, has_note: false, text: null };
  return { note_id: ctx.ids.next(), has_note: true, text: note };
}

/** 1 statement (hub state, never synced): `bill_texts (subject_id = note_id, field 'note')`. */
function writeNote(
  db: Db,
  n: { note_id: string | null; text: string | null },
): void {
  if (n.note_id === null || n.text === null) return;
  db.prepare(
    `INSERT INTO bill_texts (subject_id, field, text) VALUES (?, 'note', ?)`,
  ).run(n.note_id, n.text);
}

function envelopeOf(ctx: CommandCtx): {
  occurred_at: number;
  actor_id: string | null;
  device_id: string;
} {
  return {
    occurred_at: ctx.clock.branchNow(),
    actor_id: ctx.actor.staffId,
    device_id: ctx.actor.deviceId,
  };
}

/**
 * H7-6: the shift's open `petty_cash` requests (1 statement, 01d listOpen by kind; `values.shift_id` is the shift
 * the entry would land on), closed `obsolete` with note `shift_closed` (01d closeMany, its own bound).
 */
function closePettyRequests(
  ctx: CommandCtx,
  shift_id: string,
): { events: EventDraft[]; closed: string[] } {
  const open = alerts
    .listOpen(ctx.tx.db, { kind: "petty_cash" })
    .filter((a) => (a.values as { shift_id?: unknown }).shift_id === shift_id); // 1
  if (open.length === 0) return { events: [], closed: [] };
  const items: CloseItem[] = open.map((a) => ({
    alert_id: a.alert_id,
    reason: "obsolete",
    note: "shift_closed",
  }));
  return {
    events: alerts.closeMany(ctx, items),
    closed: open.map((a) => a.alert_id),
  };
}

function closedDraft(
  ctx: CommandCtx,
  shift_id: string,
  closed_by: string,
  note: { note_id: string | null; has_note: boolean },
): EventDraft {
  const payload = ShiftClosedPayload.parse({
    shift_id,
    closed_by,
    has_note: note.has_note,
    note_id: note.note_id,
    alert_id: null,
    approver_staff_id: null,
  });
  return draftOf(ShiftClosed, {
    stream_type: "shift",
    stream_id: shift_id,
    payload,
    ...envelopeOf(ctx),
  });
}

// ------------------------------------------------------------------------------------------------ CountShift

export interface CountShiftResult {
  shift_id: string;
  closed: true;
  expected_minor: number;
  variance_minor: number;
  sign_off: { alert_id: string } | null;
  /** H7-6: the petty_cash requests closed obsolete by this count */
  closed_requests: string[];
}

function countShift(
  ctx: CommandCtx,
  p: z.infer<typeof CountShiftPayload>,
): { events: EventDraft[]; result: CountShiftResult } {
  const db = ctx.tx.db;
  const row = requireOpen(
    db.prepare(SHIFT).get(p.shift_id) as ShiftRow | undefined,
    p.shift_id,
  ); // 1
  const by = requireOwnOrOthers(ctx, row);
  const config = branchConfig();
  if (config === null) throw new DomainError("BUSINESS_DAY_NOT_OPEN");
  const threshold = hubBilling(config).settings.variance_threshold_minor;

  const expected_minor = row.expected_cash_minor; // §3.7, the running fold
  const variance_minor = p.counted_minor - expected_minor;
  const note = noteOf(ctx, p.note);
  writeNote(db, note); // 1 with a note

  // R-42: the command compares (strictly greater); the request is raised in this transaction
  let raised: { alert_id: string; events: EventDraft[] } | null = null;
  if (Math.abs(variance_minor) > threshold) {
    const values: ShiftVarianceValues = {
      shift_id: row.shift_id,
      note_id: note.note_id,
      has_note: note.has_note,
    };
    const details: ShiftVarianceDetails = { amount: variance_minor };
    const display: AlertDisplay = {
      kind_label_key: "alert.shift_variance.lock",
      table_code: null,
      point_code: null,
      requester_name: ctx.directory.get(by)?.display_name ?? null,
      device_name: null,
    };
    const r = alerts.raise(ctx, {
      kind: "shift_variance",
      subject: { stream_type: "shift", stream_id: row.shift_id },
      target: { kind: "answerers" },
      values,
      details: details as AlertDetails,
      display,
      dedupe_key: `variance:${row.shift_id}`,
      requester_staff_id: by,
      request: {}, // §3.14, H1-1: holders of close-shift-for-others, whatever the requester's grant
    });
    raised = { alert_id: r.alert_id, events: r.events };
  }

  const counted = ShiftCountedPayload.parse({
    shift_id: row.shift_id,
    counted_minor: p.counted_minor,
    expected_minor,
    variance_minor,
    by_staff_id: by,
    variance_alert_id: raised?.alert_id ?? null,
  });
  const petty = closePettyRequests(ctx, row.shift_id); // 1
  const events: EventDraft[] = [
    draftOf(ShiftCounted, {
      stream_type: "shift",
      stream_id: row.shift_id,
      payload: counted,
      ...envelopeOf(ctx),
    }),
    closedDraft(ctx, row.shift_id, by, note),
    ...(raised?.events ?? []),
    ...petty.events,
  ];
  return {
    events,
    result: {
      shift_id: row.shift_id,
      closed: true,
      expected_minor,
      variance_minor,
      sign_off: raised === null ? null : { alert_id: raised.alert_id },
      closed_requests: petty.closed,
    },
  };
}

// ------------------------------------------------------------------------------------------------ CloseShift

export interface CloseShiftResult {
  closed: { shift_id: string };
  /** G1-8: open advances of the shift, listed, never blocking */
  open_advances: Array<{
    entry_id: string;
    amount_minor: number;
    advance_staff_id: string | null;
  }>;
  closed_requests: string[];
}

function closeShift(
  ctx: CommandCtx,
  p: z.infer<typeof CloseShiftPayload>,
): { events: EventDraft[]; result: CloseShiftResult } {
  const db = ctx.tx.db;
  const got = db.prepare(SHIFT_WITH_ADVANCES).get(p.shift_id) as
    (ShiftRow & { advances_json: string }) | undefined; // 1
  const row = requireOpen(got, p.shift_id);
  const staff_id = ctx.actor.staffId;
  if (
    staff_id === null ||
    ctx.directory.resolve(staff_id, "skip-blind-count").grant !== "allowed"
  ) {
    throw new DomainError("PERMISSION_DENIED", { reason: "skip_not_granted" });
  }
  const by = requireOwnOrOthers(ctx, row);
  const note = noteOf(ctx, p.note);
  writeNote(db, note); // 1 with a note
  const petty = closePettyRequests(ctx, row.shift_id); // 1
  const skipped = ShiftCountSkippedPayload.parse({ shift_id: row.shift_id });
  const events: EventDraft[] = [
    draftOf(ShiftCountSkipped, {
      stream_type: "shift",
      stream_id: row.shift_id,
      payload: skipped,
      ...envelopeOf(ctx),
    }),
    closedDraft(ctx, row.shift_id, by, note),
    ...petty.events,
  ];
  const open_advances = JSON.parse(
    (got as { advances_json: string }).advances_json,
  ) as CloseShiftResult["open_advances"];
  return {
    events,
    result: {
      closed: { shift_id: row.shift_id },
      open_advances,
      closed_requests: petty.closed,
    },
  };
}

// ------------------------------------------------------------------------------------------------ HandoverCount

export interface HandoverCountResult {
  shift_id: string;
  counted_minor: number;
  expected_minor: number;
  variance_minor: number;
}

function handoverCount(
  ctx: CommandCtx,
  p: z.infer<typeof HandoverCountPayload>,
): { events: EventDraft[]; result: HandoverCountResult } {
  const row = requireOpen(
    ctx.tx.db.prepare(SHIFT).get(p.shift_id) as ShiftRow | undefined,
    p.shift_id,
  ); // 1
  if (row.drawer_device_id === null)
    throw new DomainError("SHIFT_NOT_OPEN", { reason: "no_drawer_shift" });
  const by = requireOwnOrOthers(ctx, row);
  const expected_minor = row.expected_cash_minor;
  const variance_minor = p.counted_minor - expected_minor;
  // §6.19, R-42: no variance_alert_id, no request — a handover raises no sign-off
  const payload = HandoverCountedPayload.parse({
    shift_id: row.shift_id,
    counted_minor: p.counted_minor,
    expected_minor,
    variance_minor,
    by_staff_id: by,
  });
  return {
    events: [
      draftOf(HandoverCounted, {
        stream_type: "shift",
        stream_id: row.shift_id,
        payload,
        ...envelopeOf(ctx),
      }),
    ],
    result: {
      shift_id: row.shift_id,
      counted_minor: p.counted_minor,
      expected_minor,
      variance_minor,
    },
  };
}

// ------------------------------------------------------------------------------------------------ the sign-off

/**
 * §3.14 `apply` of `shift_variance`, a sign-off: approve → `outcome: 'approved'`, reject → `'disputed'` (a record
 * only, Q-4); never reopens the shift. Approve re-checks, read-only, the shift's `variance_state` is still `pending`
 * (1 statement), else throws and the answer is refused; reject re-checks nothing (H7-5, 0 statements).
 * R-44: `business_date` = the open business day in this answer transaction (`ctx.state`), not the shift's day.
 * The approver is `answer.answerer_staff_id` (01d), never `actor_id`.
 */
export function applyShiftVariance(
  ctx: AlertApplyCtx<ShiftVarianceValues, ShiftVarianceDetails>,
  answer: AnswerFacts,
): EventDraft[] {
  const v = ctx.alert.values;
  const day = ctx.state.business_day;
  // Defence only: the event needs an open day. Unreachable under the owner ruling of 2026-11-20 (05 v1.0.18, built in
  // task 25): CloseBusinessDay is refused while any shift_variance request is pending, so an answer always has a day.
  if (day === null || day.closed_at !== null)
    throw new DomainError("BUSINESS_DAY_NOT_OPEN");
  if (answer.decision === "approve") {
    const row = ctx.tx.db.prepare(SHIFT).get(v.shift_id) as
      ShiftRow | undefined; // 1
    if (row === undefined || row.variance_state !== "pending") {
      throw new DomainError("SHIFT_NOT_OPEN", { reason: "not_open" }); // inferred: no pending variance to sign off
    }
  }
  const payload = ShiftVarianceSignedOffPayload.parse({
    shift_id: v.shift_id,
    outcome: answer.decision === "approve" ? "approved" : "disputed",
    alert_id: ctx.alert.alert_id,
    approver_staff_id: answer.answerer_staff_id,
    business_date: day.business_date,
  });
  return [
    draftOf(ShiftVarianceSignedOff, {
      stream_type: "shift",
      stream_id: v.shift_id,
      payload,
      ...envelopeOf(ctx),
    }),
  ];
}

// 05 §3.14, PL-5 seam (task 9 reviewers' rule): module top level, a module-level function, never a closure.
registerBillKindApply("shift_variance", { apply: applyShiftVariance });

// ------------------------------------------------------------------------------------------------ commands

export const CountShift = defineCommand({
  commandType: "CountShift",
  payloadSchema: CountShiftPayload,
  sessionKind: "device",
  permission: "manage-own-shift",
  hashOmit: ["note"], // row H-4, H16-7
  handle: (ctx, p) => countShift(ctx, p),
});

export const CloseShift = defineCommand({
  commandType: "CloseShift",
  payloadSchema: CloseShiftPayload,
  sessionKind: "device",
  permission: "manage-own-shift",
  hashOmit: ["note"],
  handle: (ctx, p) => closeShift(ctx, p),
});

export const HandoverCount = defineCommand({
  commandType: "HandoverCount",
  payloadSchema: HandoverCountPayload,
  sessionKind: "device",
  permission: "manage-own-shift",
  handle: (ctx, p) => handoverCount(ctx, p),
});

export function registerShiftClose(app: FastifyInstance): void {
  const registry = commandRegistry(app);
  registry.register(CountShift);
  registry.register(CloseShift);
  registry.register(HandoverCount);
}
