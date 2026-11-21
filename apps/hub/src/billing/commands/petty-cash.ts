// 05 §6.20 `RecordPettyCash` (approvable) and `SettlePettyAdvance`, B24, §3.12, §3.14 kind `petty_cash` (task 22).
// Petty cash is cash only, on the caller's money shift (B11: the device's open drawer shift, else the caller's own open
// shift). An advance stays open until it is settled (spent + returned = amount); the settle may run on another shift,
// and the returned cash lands there (the `shifts` fold moves that shift's expected cash).
// Order (00 §3.7 pipeline, then the handler): Zod `.strict()` (400) → the grant on `record-petty-cash` (403;
// `requires_approval` passes Record only, which is approvable) → state: the money shift (`409 SHIFT_NOT_OPEN
// { reason: 'no_shift' }`), the category active (`422 CONFIG_REFERENCE_INVALID { field: 'category_id' }`), an advance's
// `advance_staff_id` in the directory (`422 … 'advance_staff_id'`) → scope (C8: the last refusal; the permission
// takes `branch` only, 01b) → grant `allowed` and amount ≤ `petty_cash_limit_minor`: the event + the drawer kick;
// else the `petty_cash` request (dedupe `petty:<command_id>`), answered by holders of `close-shift-for-others`.
// H6-15: never a check against the shift's expected cash (an overdraw shows as variance at the count).
// Settle: Zod → grant `allowed` (Settle is not approvable) → the advance (`404 PETTY_CASH_NOT_FOUND`, `409
// PETTY_ADVANCE_SETTLED`) → spent + returned = amount (`422 PETTY_SETTLE_MISMATCH { amount_minor }`) → the money
// shift (`409 SHIFT_NOT_OPEN`) → scope → `PettyCashSettled` with its own `note_id` (H4-4).
// Statements (00 envelope and 01d's raise excluded), fixed: Record — the read (1), the texts into `bill_texts` (1,
// with a paid_to or a note), the drawer kick printDocument (2, on a drawer with its own route printer) — ≤ 4;
// Settle — the read (1), the note (1, with a note) — ≤ 2. The kind's `apply`: the shift's state (1), read-only.
// Privacy: `paid_to` and `note` are free text → `hashOmit` (row H-4, H16-7); their text only in `bill_texts` under the
// `entry_id` (H3-5, R-48: the values and the events carry no `note_id`, only `has_paid_to` / `has_note`).
import { DomainError, PETTY_KINDS } from '@pos/domain';
import {
  draftOf,
  PettyCashAdvanced,
  PettyCashAdvancedPayload,
  PettyCashIn,
  PettyCashInPayload,
  PettyCashOut,
  PettyCashOutPayload,
  PettyCashSettled,
  PettyCashSettledPayload,
  type AlertDetails,
  type AlertDisplay,
  type EventDraft,
} from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AlertApplyCtx, AnswerFacts } from '../../alerts/kinds.js';
import { alerts } from '../../alerts/raise.js';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { printDocument } from '../../print/api.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { hubBilling } from '../defaults.js';
import { registerBillKindApply } from '../kinds/seam.js';
import type { BillRequestDetails, PettyCashValues } from '../kinds/values.js';

// ------------------------------------------------------------------------------------------------ payloads

/** §6.20 (H16-13 scale, as `AddPayment`): 1 … 10¹² minor units. */
export const MAX_PETTY_MINOR = 1_000_000_000_000;
const Amount = z.number().int().min(1).max(MAX_PETTY_MINOR);
/** §4.4: `note` ≤ 200; `paid_to` (free text, the same bound). */
const Text = z.string().max(200);

/** §6.20 `{ kind, amount_minor, category_id, paid_to?, advance_staff_id?, note? }`; `advance_staff_id` only on an advance. */
export const RecordPettyCashPayload = z
  .object({
    kind: z.enum(PETTY_KINDS),
    amount_minor: Amount,
    category_id: z.string().min(1).max(40),
    paid_to: Text.optional(),
    advance_staff_id: z.string().min(1).max(64).optional(),
    note: Text.optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.kind !== 'advance' && p.advance_staff_id !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['advance_staff_id'],
        message: 'only an advance names advance_staff_id',
      });
    }
  });
type RecordPayload = z.infer<typeof RecordPettyCashPayload>;

/** §6.20 `{ entry_id, spent_minor, returned_minor, note? }`. */
export const SettlePettyAdvancePayload = z
  .object({
    entry_id: z.string().min(1).max(64),
    spent_minor: z.number().int().min(0).max(MAX_PETTY_MINOR),
    returned_minor: z.number().int().min(0).max(MAX_PETTY_MINOR),
    note: Text.optional(),
  })
  .strict();
type SettlePayload = z.infer<typeof SettlePettyAdvancePayload>;

export interface RecordPettyCashResult {
  entry_id: string;
  /** set when the entry waits for a `petty_cash` request (no event yet) */
  pending?: { alert_id: string };
}

export interface SettlePettyAdvanceResult {
  entry_id: string;
  shift_id: string;
}

// ------------------------------------------------------------------------------------------------ shared steps

const LABELS = { lock: 'alert.petty_cash.lock' } as const;

// B11: the device's open drawer shift, else the caller's own open shift; the device's own route printer for the
// drawer kick (R-57 pattern, as OpenShift: no zone / floor / default fallback). 1 statement.
const MONEY_SHIFT = `
SELECT
  (SELECT shift_id FROM shifts WHERE drawer_device_id = @device_id AND state = 'open') AS drawer_shift_id,
  (SELECT shift_id FROM shifts WHERE staff_id = @staff_id AND state = 'open') AS own_shift_id,
  (SELECT r.printer_id FROM bill_routes r JOIN printers p ON p.printer_id = r.printer_id AND p.archived_at IS NULL
    WHERE r.scope = 'device' AND r.ref_id = @device_id) AS device_route_printer`;

interface MoneyShiftRow {
  drawer_shift_id: string | null;
  own_shift_id: string | null;
  device_route_printer: string | null;
}

// Settle: the advance and the caller's money shift in one read. 1 statement.
const SETTLE_READ = `
SELECT
  (SELECT kind FROM petty_cash WHERE entry_id = @entry_id) AS kind,
  (SELECT amount_minor FROM petty_cash WHERE entry_id = @entry_id) AS amount_minor,
  (SELECT settled_at FROM petty_cash WHERE entry_id = @entry_id) AS settled_at,
  (SELECT shift_id FROM shifts WHERE drawer_device_id = @device_id AND state = 'open') AS drawer_shift_id,
  (SELECT shift_id FROM shifts WHERE staff_id = @staff_id AND state = 'open') AS own_shift_id`;

interface SettleRow {
  kind: string | null;
  amount_minor: number | null;
  settled_at: number | null;
  drawer_shift_id: string | null;
  own_shift_id: string | null;
}

/** C8, last: `record-petty-cash` takes `branch` only (01b PERMISSION_SCOPES). 0 statements. */
function requireScope(ctx: CommandCtx): void {
  const scope =
    ctx.permission !== null && 'scope' in ctx.permission
      ? ctx.permission.scope
      : null;
  if (ctx.actor.staffId === null || scope !== 'branch')
    throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope' });
}

const present = (s: string | undefined): s is string =>
  s !== undefined && s.trim() !== '';

/**
 * 1 statement (hub state, never synced): the entry's texts under its `entry_id` (H3-5, R-48) — `paid_to` and / or
 * `note` in one INSERT; none when both are absent.
 */
function writeTexts(
  ctx: CommandCtx,
  entry_id: string,
  texts: { paid_to: string | null; note: string | null },
): void {
  const rows: Array<[string, string]> = [];
  if (texts.paid_to !== null) rows.push(['paid_to', texts.paid_to]);
  if (texts.note !== null) rows.push(['note', texts.note]);
  if (rows.length === 0) return;
  ctx.tx.db
    .prepare(
      `INSERT INTO bill_texts (subject_id, field, text) VALUES ${rows.map(() => '(?, ?, ?)').join(', ')}`,
    )
    .run(...rows.flatMap(([field, text]) => [entry_id, field, text]));
}

interface PettyEntry {
  entry_id: string;
  kind: (typeof PETTY_KINDS)[number];
  shift_id: string;
  amount_minor: number;
  category_id: string;
  has_paid_to: boolean;
  advance_staff_id: string | null;
  has_note: boolean;
}

/** The petty-cash event of `kind` on the shift's stream. */
function pettyDraft(
  ctx: CommandCtx,
  e: PettyEntry,
  who: { requester: string; approver: string | null; alert_id: string | null },
): EventDraft {
  const payload = {
    entry_id: e.entry_id,
    shift_id: e.shift_id,
    amount_minor: e.amount_minor,
    category_id: e.category_id,
    has_paid_to: e.has_paid_to,
    advance_staff_id: e.advance_staff_id,
    has_note: e.has_note,
    requester_staff_id: who.requester,
    approver_staff_id: who.approver,
    alert_id: who.alert_id,
  };
  const envelope = {
    stream_type: 'shift' as const,
    stream_id: e.shift_id,
    occurred_at: ctx.clock.branchNow(),
    actor_id: ctx.actor.staffId,
    device_id: ctx.actor.deviceId,
  };
  switch (e.kind) {
    case 'advance':
      return draftOf(PettyCashAdvanced, {
        ...envelope,
        payload: PettyCashAdvancedPayload.parse(payload),
      });
    case 'out':
      return draftOf(PettyCashOut, {
        ...envelope,
        payload: PettyCashOutPayload.parse(payload),
      });
    case 'in':
      return draftOf(PettyCashIn, {
        ...envelope,
        payload: PettyCashInPayload.parse(payload),
      });
  }
}

// ------------------------------------------------------------------------------------------------ RecordPettyCash

function recordPettyCash(
  ctx: CommandCtx,
  p: RecordPayload,
  command_id: string,
): { events: EventDraft[]; result: RecordPettyCashResult } {
  const staff_id = ctx.actor.staffId;
  if (staff_id === null)
    throw new DomainError('PERMISSION_DENIED', {
      permission: 'record-petty-cash',
      grant: 'not_granted',
    });

  // the money shift (B11), state open
  const r = ctx.tx.db
    .prepare(MONEY_SHIFT)
    .get({ device_id: ctx.actor.deviceId, staff_id }) as MoneyShiftRow; // 1
  const shift_id = r.drawer_shift_id ?? r.own_shift_id;
  if (shift_id === null)
    throw new DomainError('SHIFT_NOT_OPEN', { reason: 'no_shift' });

  // the category: active in the branch's billing settings (owner-edited, built-in defaults otherwise)
  const config = branchConfig();
  const settings = config === null ? null : hubBilling(config).settings;
  const category = settings?.petty_categories.find(
    (c) => c.category_id === p.category_id,
  );
  if (category === undefined || !category.is_active)
    throw new DomainError('CONFIG_REFERENCE_INVALID', {
      field: 'category_id',
      reason: 'not_found',
    });

  // an advance names a person of the directory
  if (
    p.kind === 'advance' &&
    (p.advance_staff_id === undefined ||
      ctx.directory.get(p.advance_staff_id) === undefined)
  ) {
    throw new DomainError('CONFIG_REFERENCE_INVALID', {
      field: 'advance_staff_id',
      reason: 'not_found',
    });
  }

  requireScope(ctx); // the last refusal (C8)

  const paid_to = present(p.paid_to) ? p.paid_to : null;
  const note = present(p.note) ? p.note : null;
  const entry: PettyEntry = {
    entry_id: ctx.ids.next(),
    kind: p.kind,
    shift_id,
    amount_minor: p.amount_minor,
    category_id: p.category_id,
    has_paid_to: paid_to !== null,
    advance_staff_id:
      p.kind === 'advance' ? (p.advance_staff_id as string) : null,
    has_note: note !== null,
  };

  const limit = settings?.petty_cash_limit_minor ?? 0;
  const needsRequest =
    ctx.permission === null ||
    ctx.permission.grant !== 'allowed' ||
    p.amount_minor > limit;
  if (needsRequest) {
    // §3.14, H3-5, R-48: values carry the entry without text; details in AlertDetailsBase keys (H2-6)
    const values: PettyCashValues = { ...entry };
    const details: BillRequestDetails = {
      amount: p.amount_minor,
      reason: p.category_id,
    };
    const display: AlertDisplay = {
      kind_label_key: LABELS.lock,
      table_code: null,
      point_code: null,
      requester_name: ctx.directory.get(staff_id)?.display_name ?? null,
      device_name: null,
    };
    const raised = alerts.raise(ctx, {
      kind: 'petty_cash',
      subject: { stream_type: 'shift', stream_id: shift_id },
      target: { kind: 'answerers' },
      values,
      details: details as AlertDetails,
      display,
      dedupe_key: `petty:${command_id}`,
      requester_staff_id: staff_id,
      request: {},
    });
    // The dedupe key is per command_id, and a retransmit is replayed by the pipeline before the handler runs, so a
    // dedupe hit cannot happen here; were it ever to, no second text is written for the open request.
    if (!raised.deduped) writeTexts(ctx, entry.entry_id, { paid_to, note }); // 1
    return {
      events: raised.events,
      result: {
        entry_id: entry.entry_id,
        pending: { alert_id: raised.alert_id },
      },
    };
  }

  writeTexts(ctx, entry.entry_id, { paid_to, note }); // 1
  const event = pettyDraft(ctx, entry, {
    requester: staff_id,
    approver: null,
    alert_id: null,
  });
  // §6.20: the drawer kick, on a drawer with its own route printer (R8: print never blocks the caller); a shift that
  // is not this device's drawer has no drawer to open here
  if (r.drawer_shift_id !== null && r.device_route_printer !== null) {
    printDocument(ctx.tx, r.device_route_printer, {
      blocks: [{ drawer: true }],
    }); // 2
  }
  return { events: [event], result: { entry_id: entry.entry_id } };
}

/**
 * §3.14 `apply` (approve only, H6-2 / H7-5): re-checks, read-only, that the entry's shift is still `open` (1 statement),
 * else throws `409 SHIFT_NOT_OPEN { reason: 'not_open' }` and the answer is refused; then the petty-cash event from
 * the values, its requester, this alert's id and the answerer as approver (01d: never `actor_id`). No drawer kick
 * (§6.20: the requester's next `OpenCashDrawer`). H6-15: no check against expected cash; the limit and the category
 * are not re-read. Reject → [] (0 statements).
 */
export function applyPettyCash(
  ctx: AlertApplyCtx<PettyCashValues, BillRequestDetails>,
  answer: AnswerFacts,
): EventDraft[] {
  if (answer.decision !== 'approve') return [];
  const v = ctx.alert.values;
  const requester = ctx.alert.requester_staff_id;
  if (requester === null)
    throw new Error(
      `petty_cash ${ctx.alert.alert_id}: a request always has a requester`,
    );
  const state = ctx.tx.db
    .prepare('SELECT state FROM shifts WHERE shift_id = ?')
    .pluck()
    .get(v.shift_id) as string | undefined; // 1
  if (state !== 'open')
    throw new DomainError('SHIFT_NOT_OPEN', { reason: 'not_open' });
  return [
    pettyDraft(ctx, v, {
      requester,
      approver: answer.answerer_staff_id,
      alert_id: ctx.alert.alert_id,
    }),
  ];
}

// 05 §3.14, PL-5 seam (task 9 reviewers' rule): module top level, a module-level function, never a closure.
registerBillKindApply('petty_cash', { apply: applyPettyCash });

// ------------------------------------------------------------------------------------------------ SettlePettyAdvance

function settlePettyAdvance(
  ctx: CommandCtx,
  p: SettlePayload,
): { events: EventDraft[]; result: SettlePettyAdvanceResult } {
  const staff_id = ctx.actor.staffId;
  if (staff_id === null)
    throw new DomainError('PERMISSION_DENIED', {
      permission: 'record-petty-cash',
      grant: 'not_granted',
    });
  const r = ctx.tx.db
    .prepare(SETTLE_READ)
    .get({
      entry_id: p.entry_id,
      device_id: ctx.actor.deviceId,
      staff_id,
    }) as SettleRow; // 1
  // an entry that is not an advance (an out / in, or one still waiting for its request) is not an advance to settle
  if (r.kind !== 'advance' || r.amount_minor === null)
    throw new DomainError('PETTY_CASH_NOT_FOUND', { entry_id: p.entry_id });
  if (r.settled_at !== null)
    throw new DomainError('PETTY_ADVANCE_SETTLED', { entry_id: p.entry_id });
  if (p.spent_minor + p.returned_minor !== r.amount_minor)
    throw new DomainError('PETTY_SETTLE_MISMATCH', {
      amount_minor: r.amount_minor,
    });
  const shift_id = r.drawer_shift_id ?? r.own_shift_id;
  if (shift_id === null)
    throw new DomainError('SHIFT_NOT_OPEN', { reason: 'no_shift' });
  requireScope(ctx); // the last refusal (C8)

  // H4-4: the settle's own note_id, never the advance's (entry_id, 'note') row
  const note = present(p.note) ? p.note : null;
  const note_id = note === null ? null : ctx.ids.next();
  if (note_id !== null && note !== null) {
    ctx.tx.db
      .prepare(
        `INSERT INTO bill_texts (subject_id, field, text) VALUES (?, 'note', ?)`,
      )
      .run(note_id, note); // 1
  }
  const payload = PettyCashSettledPayload.parse({
    entry_id: p.entry_id,
    shift_id,
    spent_minor: p.spent_minor,
    returned_minor: p.returned_minor,
    has_note: note_id !== null,
    note_id,
  });
  const event = draftOf(PettyCashSettled, {
    stream_type: 'shift',
    stream_id: shift_id,
    payload,
    occurred_at: ctx.clock.branchNow(),
    actor_id: staff_id,
    device_id: ctx.actor.deviceId,
  });
  return { events: [event], result: { entry_id: p.entry_id, shift_id } };
}

// ------------------------------------------------------------------------------------------------ registration

export const RecordPettyCash = defineCommand({
  commandType: 'RecordPettyCash',
  payloadSchema: RecordPettyCashPayload,
  sessionKind: 'device',
  permission: 'record-petty-cash',
  approvable: true,
  hashOmit: ['paid_to', 'note'], // row H-4, H16-7: free text never reaches payload_hash
  handle: (ctx, p, cmd) => recordPettyCash(ctx, p, cmd.command_id),
});

export const SettlePettyAdvance = defineCommand({
  commandType: 'SettlePettyAdvance',
  payloadSchema: SettlePettyAdvancePayload,
  sessionKind: 'device',
  permission: 'record-petty-cash',
  hashOmit: ['note'],
  handle: (ctx, p) => settlePettyAdvance(ctx, p),
});

export function registerPettyCash(app: FastifyInstance): void {
  const registry = commandRegistry(app);
  registry.register(RecordPettyCash);
  registry.register(SettlePettyAdvance);
}
