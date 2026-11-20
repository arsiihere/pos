// 05 §6.8 `RemoveServiceCharge` (approvable) and `ApplyServiceCharge`, B8 (task 14). The rate is frozen at bill
// creation (`ChargeApplied { source: 'rule' }`, ensure bill); only these two commands and the `remove_service_charge`
// kind's `apply` move it afterwards (`bills.sc_removed`, §5), never a read, print, split, merge or reopen (M-3).
// Order (00 §3.7 pipeline, then the handler in task 10's style): Zod (400) → the grant on `remove-service-charge`
// (403; `requires_approval` passes for Remove only, which is approvable) → ensure bill inside the writer transaction
// (404 / 409 of §6) → OPEN / PARTLY_PAID (`409 BILL_NOT_OPEN`) → scope (C8: the last refusal; the permission takes
// `branch` only, 01b) → no charge to remove / already applied → `{ changed: false }` → grant `allowed`: the event;
// `requires_approval` (Remove only): the request, kind `remove_service_charge` (§3.14), dedupe `remove_sc:<bill_id>`.
// "Applied" = not removed and a rate above 0 (owner R-61): a bill opened at rate 0 has no charge, so Remove answers
// `changed: false` and writes nothing, and Apply answers `changed: false` too (B8: the rate fixed at open is 0). Apply
// re-adds only after a removal, at `service_charge_bp[order_type]` of today's branch config (§6.8); today's rate 0
// re-adds nothing (`changed: false`, R-61).
// Statements: ≤ 3 + 01d's raise (§6.8; the 00 envelope and 01d's raise excluded, as 02b CompLine counts them):
// openBillOf (1) + the note into `bill_texts` (1, only with a note). The kind's `apply`: openBillOf (1), read-only.
// Notes stay out of `payload_hash` (`hashOmit: ['note']`, 00 §3.7 row H-4, H16-7): a retransmit with only the note
// changed replays the stored reply.
// Owner R-60 (05 v1.0.12): §6.8's bound wins over §6's "money results carry the recomputed totals" — the results
// carry no totals; the screen re-reads `GET /queries/bill`.
import { CHARGE_REMOVE_REASONS, DomainError } from '@pos/domain';
import { ChargeApplied, ChargeAppliedPayload, ChargeRemoved, ChargeRemovedPayload, draftOf, type AlertDetails, type AlertDisplay, type EventDraft } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AlertApplyCtx, AnswerFacts } from '../../alerts/kinds.js';
import { alerts } from '../../alerts/raise.js';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { tableLabel } from '../../kds/details.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { registerBillKindApply } from '../kinds/seam.js';
import type { BillRequestDetails, RemoveServiceChargeValues } from '../kinds/values.js';
import { billingAt, BillRef, ensureBill, openBillOf, type BillHead } from './ensure-bill.js';

// ------------------------------------------------------------------------------------------------ payloads

/** §4.4: `note` ≤ 200, required whenever the reason code is `other`. */
const Note = z.string().max(200);

export const RemoveServiceChargePayload = z
  .object({ bill_ref: BillRef, reason_code: z.enum(CHARGE_REMOVE_REASONS), note: Note.optional() })
  .strict()
  .superRefine((p, rc) => {
    if (p.reason_code === 'other' && (p.note === undefined || p.note.trim() === '')) {
      rc.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: "note is required when reason_code is 'other'" });
    }
  });
type RemovePayload = z.infer<typeof RemoveServiceChargePayload>;

export const ApplyServiceChargePayload = z.object({ bill_ref: BillRef, note: Note.optional() }).strict();
type ApplyPayload = z.infer<typeof ApplyServiceChargePayload>;

// ------------------------------------------------------------------------------------------------ shared steps

const LABELS = { lock: 'alert.remove_service_charge.lock' } as const;

/** §3.2 / §9: the charge changes only on an OPEN / PARTLY_PAID bill that is not absorbed (0 statements). */
function requireOpen(head: BillHead): string {
  if (head.state === 'closed' || head.absorbed || head.bill_id === null) {
    throw new DomainError('BILL_NOT_OPEN', { bill_id: head.bill_id, state: head.absorbed ? 'absorbed' : head.state });
  }
  return head.bill_id;
}

/** Owner R-61: a charge is applied while it is not removed and its rate is above 0 (a bill opened at rate 0 has none). */
const chargeApplied = (head: BillHead): boolean => !head.sc_removed && head.sc_bp > 0;

/** C8, last: `remove-service-charge` takes `branch` only (01b PERMISSION_SCOPES); anything else is outside scope. 0 statements. */
function requireScope(ctx: CommandCtx, head: BillHead): void {
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : null;
  if (ctx.actor.staffId === null || scope !== 'branch') {
    throw new DomainError('PERMISSION_DENIED', { reason: 'outside_scope', ...(head.seating === null ? {} : { table_ids: [head.seating.primary_table_id] }) });
  }
}

/** H3-5: the note's id (minted here) and its text, written to `bill_texts` by `writeNote`; the event carries the id only. */
function noteOf(ctx: CommandCtx, note: string | undefined): { note_id: string | null; has_note: boolean; text: string | null } {
  if (note === undefined || note.trim() === '') return { note_id: null, has_note: false, text: null };
  return { note_id: ctx.ids.next(), has_note: true, text: note };
}

/** 1 statement (hub state, never synced): `bill_texts (subject_id = note_id, field 'note')`. */
function writeNote(ctx: CommandCtx, n: { note_id: string | null; text: string | null }): void {
  if (n.note_id === null || n.text === null) return;
  ctx.tx.db.prepare(`INSERT INTO bill_texts (subject_id, field, text) VALUES (?, 'note', ?)`).run(n.note_id, n.text);
}

const envelopeOf = (ctx: CommandCtx) => ({ occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId });

function removedDraft(ctx: CommandCtx, p: ChargeRemovedPayload): EventDraft {
  return draftOf(ChargeRemoved, { stream_type: 'bill', stream_id: p.bill_id, payload: ChargeRemovedPayload.parse(p), ...envelopeOf(ctx) });
}

/** §3.12 lock-safe label: the seating's primary table by its config name (02b comp precedent); a key bill has none. */
function tableCodeOf(head: BillHead): string | null {
  const table = head.seating?.primary_table_id;
  if (table === undefined || head.scope !== 'seating') return null;
  const name = branchConfig()?.floors.flatMap((f) => f.tables).find((t) => t.table_id === table)?.name ?? table;
  return tableLabel(name).slice(0, 40);
}

// ------------------------------------------------------------------------------------------------ RemoveServiceCharge

function removeServiceCharge(ctx: CommandCtx, p: RemovePayload): { events: EventDraft[]; result: unknown } {
  const { head, events } = ensureBill(ctx, p.bill_ref); // 1
  const bill_id = requireOpen(head);
  requireScope(ctx, head); // the last refusal (C8); "nothing to remove" below is an answer, not a refusal
  // already removed, or opened at rate 0 (owner R-61): nothing to remove, no event, no request
  if (!chargeApplied(head)) return { events, result: { bill_id, changed: false } };
  const requester = ctx.actor.staffId as string; // requireScope refused a session with no staff
  const note = noteOf(ctx, p.note);

  if (ctx.permission !== null && ctx.permission.grant === 'requires_approval') {
    // §3.14: values ids / codes only (H3-5, H4-4); details in AlertDetailsBase keys (H2-6). No `amount`: the charge's
    // value needs the bill's compute (≥ 4 reads), past §6.8's ≤ 3 (Readings).
    const values: RemoveServiceChargeValues = { bill_id, reason_code: p.reason_code, note_id: note.note_id, has_note: note.has_note };
    const table_code = tableCodeOf(head);
    const details: BillRequestDetails = { reason: p.reason_code, ...(table_code === null ? {} : { identifier: table_code }) };
    const display: AlertDisplay = { kind_label_key: LABELS.lock, table_code, point_code: null, requester_name: ctx.directory.get(requester)?.display_name ?? null, device_name: null };
    const raised = alerts.raise(ctx, {
      kind: 'remove_service_charge',
      subject: { stream_type: 'bill', stream_id: bill_id },
      target: { kind: 'answerers' },
      values,
      details: details as AlertDetails,
      display,
      dedupe_key: `remove_sc:${bill_id}`,
      requester_staff_id: requester,
      request: { approver_role_ids: ctx.permission.approver_role_ids },
    });
    // owner R-59 (05 v1.0.12): a second ask answers 200 with the request already open (no pending code)
    if (!raised.deduped) writeNote(ctx, note); // the text is written at raise (H3-5); a dedupe hit writes none
    return { events: [...events, ...raised.events], result: { bill_id, pending: { alert_id: raised.alert_id } } };
  }

  writeNote(ctx, note);
  const removed = removedDraft(ctx, {
    bill_id,
    charge: 'service',
    reason_code: p.reason_code,
    has_note: note.has_note,
    note_id: note.note_id,
    requester_staff_id: requester,
    approver_staff_id: null,
    alert_id: null,
  });
  return { events: [...events, removed], result: { bill_id, changed: true } };
}

/**
 * §3.14 `apply` (approve only, H6-2 / H7-5): re-checks, read-only, the bill is OPEN / PARTLY_PAID and the charge
 * still applied (1 statement, openBillOf), else throws and the answer is refused; then `ChargeRemoved` with the
 * request's reason and note, its requester, this alert's id and the answerer as approver (01d: never `actor_id`).
 * Reject → [] (0 statements).
 */
export function applyRemoveServiceCharge(ctx: AlertApplyCtx<RemoveServiceChargeValues, BillRequestDetails>, answer: AnswerFacts): EventDraft[] {
  if (answer.decision !== 'approve') return [];
  const v = ctx.alert.values;
  const requester = ctx.alert.requester_staff_id;
  if (requester === null) throw new Error(`remove_service_charge ${ctx.alert.alert_id}: a request always has a requester`);
  const { head, missing } = openBillOf(ctx.tx.db, { bill_id: v.bill_id }, ctx.state.business_day?.business_date ?? null); // 1
  if (missing) throw new DomainError('BILL_NOT_FOUND', { bill_id: v.bill_id });
  requireOpen(head);
  // owner R-58 (05 v1.0.12 §9): the charge was removed meanwhile (e.g. a direct remove while this request was open)
  if (!chargeApplied(head)) throw new DomainError('SERVICE_CHARGE_NOT_APPLIED', { bill_id: v.bill_id });
  return [
    removedDraft(ctx, {
      bill_id: v.bill_id,
      charge: 'service',
      reason_code: v.reason_code,
      has_note: v.has_note,
      note_id: v.note_id,
      requester_staff_id: requester,
      approver_staff_id: answer.answerer_staff_id,
      alert_id: ctx.alert.alert_id,
    }),
  ];
}

// 05 §3.14, PL-5 seam (task 9 reviewers' rule): module top level, a module-level function, never a closure.
registerBillKindApply('remove_service_charge', { apply: applyRemoveServiceCharge });

export const RemoveServiceCharge = defineCommand({
  commandType: 'RemoveServiceCharge',
  payloadSchema: RemoveServiceChargePayload,
  sessionKind: 'device',
  permission: 'remove-service-charge',
  approvable: true,
  hashOmit: ['note'], // row H-4, H16-7: the note never reaches payload_hash
  handle: (ctx, p) => removeServiceCharge(ctx, p),
});

// ------------------------------------------------------------------------------------------------ ApplyServiceCharge

/**
 * §6.8 re-add: `remove-service-charge` `allowed` only (not approvable: the pipeline refuses `requires_approval`, 403)
 * → `ChargeApplied { source: 'manual', rate_bp: service_charge_bp[order_type] }` in force now (0 statements, config
 * in memory); already applied → `{ changed: false }`.
 */
function applyServiceCharge(ctx: CommandCtx, p: ApplyPayload): { events: EventDraft[]; result: unknown } {
  const { head, events } = ensureBill(ctx, p.bill_ref); // 1
  const bill_id = requireOpen(head);
  requireScope(ctx, head);
  // already applied, or opened at rate 0 and never removed (owner R-61, B8: the rate fixed at open is 0)
  if (!head.sc_removed) return { events, result: { bill_id, changed: false } };
  const config = branchConfig();
  if (config === null || head.business_date === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const { billing } = billingAt(config, head.business_date);
  const rate_bp = billing.settings.service_charge_bp[head.order_type];
  // owner R-61 (integrator reading): today's rate 0 re-adds nothing — rate 0 = not applied; no ChargeApplied, no note
  if (rate_bp === 0) return { events, result: { bill_id, changed: false } };
  const note = noteOf(ctx, p.note);
  writeNote(ctx, note);
  const payload = ChargeAppliedPayload.parse({
    bill_id,
    charge: 'service',
    rate_bp,
    source: 'manual',
    has_note: note.has_note,
    note_id: note.note_id,
  });
  events.push(draftOf(ChargeApplied, { stream_type: 'bill', stream_id: bill_id, payload, ...envelopeOf(ctx) }));
  return { events, result: { bill_id, changed: true } };
}

export const ApplyServiceCharge = defineCommand({
  commandType: 'ApplyServiceCharge',
  payloadSchema: ApplyServiceChargePayload,
  sessionKind: 'device',
  permission: 'remove-service-charge',
  hashOmit: ['note'], // row H-4, H16-7
  handle: (ctx, p) => applyServiceCharge(ctx, p),
});

export function registerServiceCharge(app: FastifyInstance): void {
  commandRegistry(app).register(RemoveServiceCharge);
  commandRegistry(app).register(ApplyServiceCharge);
}
