import { DomainError } from '@pos/domain';
import {
  AnswerRequestPayload,
  type AlertDisplay,
  type EventDraft,
  type PosCommand,
  type PosEvent,
  type RequestAnsweredPayload,
  type RequestPinFailedPayload,
} from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import type { CommandCtx, PreReadCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { readOnlyTx } from '../../engine-host/read-only-tx.js';
import type { WriterTx } from '../../engine-host/writer.js';
import type { IdGen } from '../../lib/ids.js';
import type { SecretGen } from '../../lib/secrets.js';
import {
  type AlertKind,
  type AlertRecord,
  type AnsweredOnRequesterDeviceValues,
  type AnswerFacts,
  type ApprovalReceiptValues,
  type PinUseFailedValues,
} from '../kinds.js';
import { alerts, requestResultInput, type RaiseInput } from '../raise.js';
import { mayAnswer } from '../targets.js';
import { checkAlertIds, pendingRequest, readAlert, recordOf, requestKindOf, sessionStaff, type RequestRow } from './request-row.js';

// 01d §6.2 `AnswerRequest`, §3.3 answer rules 1–7, A4, A5, §3.5 read-only contract.
// `preRead` (read-only, before any PIN): 1 alert statement, directory and session in memory, then the kind's
// `apply` on a read-only view (drafts discarded). `handle` (inside the writer, or checkPin's `prepare` for a
// PIN method) re-runs every check authoritatively and returns the drafts; the pipeline appends them, so a
// second answer serialised behind the first sees the alert closed (first answer wins, test #6).
// The answered alert's `alert_closed` frames are sent after commit by ws-frames.ts (task 20), not here.
// PIN and in-person answers (task 23): `pinCheck` names the PIN owner (the session staff for `pin`, the
// named answerer for `in_person`); `pinHooks` record every counted failure as `RequestPinFailed` and, when
// a matched PIN's answer failed, raise `pin_use_failed` to its owner in the same transaction (§3.3 rule 4
// (d), BF-1). The PIN itself never leaves `pinCheck` → `checkPin` (§3.3 "PIN never stored", §7).
// Personal notices (task 24, §3.3 rule 7, §3.10): `handle` adds `approval_receipt` (money kinds, any method)
// and `answered_on_requester_device` (answer on the raising device) to the answerer, hidden from the answering
// seat, in one `raiseMany` with `request_result` (the fixed reads once; §3.5 "Several raises").

type Payload = AnswerRequestPayload;

interface Checked {
  row: RequestRow;
  kind: AlertKind;
  request: NonNullable<AlertKind['request']>;
  record: AlertRecord;
  answerer: string;
}

/**
 * 00 v1.6 §3.7 H-3: a staff session (the pipeline's `authorize` says the same inside the writer). The
 * answerer is the session's staff, or for `in_person` the named `answerer_staff_id` (§3.3 rule 2).
 */
function answererOf(actor: CommandCtx['actor'], payload: Payload): string {
  const staffId = sessionStaff(actor);
  // payload Zod: answerer_staff_id is present iff in_person
  if (payload.method === 'in_person') return payload.answerer_staff_id ?? '';
  return staffId;
}

/**
 * §3.3 rule 4 (b) order (= §6.2 Processing (1)–(5)): rule 1 (404 / 409), the decision in the kind's answers
 * (400), rule 3 (422), in person: the named answerer in the directory (404 STAFF_NOT_FOUND) and the raising
 * device (403 in_person_elsewhere), rule 5 (403 self), rule 6 (403 not_approver / out_of_range /
 * not_receiver). Directory in memory; no statement.
 */
function check(
  found: RequestRow | undefined,
  payload: Payload,
  answerer: string,
  directory: StaffDirectory,
  alertId: string,
  deviceId: string,
): Checked {
  // (1)–(2) rule 1: exists, has a request part (404); pending (409, §9 details)
  const { row, part } = pendingRequest(found, alertId, directory);
  // (3) the decision is one of the kind's answers (v0.5 #1)
  if (!(part.answers as readonly string[]).includes(payload.decision)) {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'decision', message: 'decision is not an answer of this request' }] });
  }
  // (4) rule 3: money kinds need a PIN (no PIN-free path)
  if (part.needs_pin === 'always' && payload.method === 'session') {
    throw new DomainError('REQUEST_PIN_REQUIRED', { alert_id: row.alert_id, kind: row.kind });
  }
  if (payload.method === 'in_person') {
    // (4′) rule 2: the named answerer is in the hub directory, i.e. has a PIN (v0.5 m2; not counted)
    if (directory.get(answerer) === undefined) throw new DomainError('STAFF_NOT_FOUND', { staff_id: answerer });
    // (4″) rule 2: in person only on the device the request was raised on (v1.0 #2, R2)
    if (deviceId !== row.raised_device_id) throw new DomainError('PERMISSION_DENIED', { reason: 'in_person_elsewhere' });
  }
  // (5) rules 5–6, read now (A5)
  const verdict = mayAnswer(directory, part, row.requester_staff_id, answerer);
  if (!verdict.ok) throw new DomainError('PERMISSION_DENIED', { reason: verdict.reason });

  const { kind, request } = requestKindOf(row, 'AnswerRequest');
  const record = recordOf(row, part);
  return { row, kind, request, record, answerer };
}

/** §3.5: `apply` on a read-only view; every draft must carry this alert's id (else a bug → 500). */
function runApply(ctx: CommandCtx, c: Checked, answer: AnswerFacts): EventDraft[] {
  return checkAlertIds('AnswerRequest', 'apply', c.record, c.request.apply({ ...ctx, tx: readOnlyTx(ctx.tx), alert: c.record }, answer));
}

function factsOf(payload: Payload, c: Checked, deviceId: string, now: number): AnswerFacts {
  return { decision: payload.decision, answerer_staff_id: c.answerer, method: payload.method, device_id: deviceId, answered_at: now };
}

const refuse = (what: string) => (): never => {
  throw new Error(`AnswerRequest preRead: ${what} is not available (apply only reads and returns drafts)`);
};
const NO_IDS: IdGen = { next: refuse('ids') };
const NO_SECRETS: SecretGen = { token256: refuse('secrets'), bytes: refuse('secrets'), crockford: refuse('secrets') };

/** 00 §3.7 M39 re-check on the read-only view, only when the auth generation moved (as the pipeline's). */
function recheckSession(db: Database.Database, actor: CommandCtx['actor']): void {
  const device = db.prepare('SELECT revoked_at FROM devices WHERE device_id = ?').get(actor.deviceId) as { revoked_at: number | null } | undefined;
  if (device?.revoked_at != null) throw new DomainError('DEVICE_REVOKED');
  const session = db.prepare('SELECT ended_at FROM staff_sessions WHERE session_id = ?').get(actor.sessionId) as
    | { ended_at: number | null }
    | undefined;
  if (session?.ended_at != null) throw new DomainError('SESSION_EXPIRED');
}

function preRead(db: Database.Database, payload: Payload, ctx: PreReadCtx): void {
  const answerer = answererOf(ctx.actor, payload);
  const c = check(readAlert(db, payload.alert_id), payload, answerer, ctx.directory, payload.alert_id, ctx.actor.deviceId);
  if (ctx.authChanged) recheckSession(db, ctx.actor);
  // the read-only part of `prepare` (v1.0 #1, R1): apply on a read-only view, drafts discarded
  const tx: WriterTx = readOnlyTx({ db, state: ctx.state, clock: ctx.clock, ids: NO_IDS, branchId: ctx.branch.branchId, append: refuse('append'), onCommit: refuse('onCommit') });
  const applyCtx: CommandCtx = {
    tx,
    state: ctx.state,
    clock: ctx.clock,
    ids: NO_IDS,
    secrets: NO_SECRETS,
    actor: ctx.actor,
    permission: null,
    branch: ctx.branch,
    directory: ctx.directory,
    config: ctx.config,
    queuedAt: null,
  };
  runApply(applyCtx, c, factsOf(payload, c, ctx.actor.deviceId, ctx.clock.branchNow()));
}

/**
 * §6.2 (8a) / (9), §3.3 rule 7, §3.10: `approval_receipt` for a money kind (`needs_pin: 'always'`, any
 * method, any device) and `answered_on_requester_device` when the answer came from the raising device (any
 * method). Both to the answerer (own routes only), on the request's subject, with its lock-safe `display`;
 * the receipt copies the request's `details` (signed-in card only, §3.12). `hidden_from` = the answering
 * session and device.
 */
function noticeInputs(c: Checked, payload: Payload, answered: RequestAnsweredPayload, actor: CommandCtx['actor']): RaiseInput[] {
  const subject = c.record.subject as RaiseInput['subject'];
  const hidden_from = { session_id: actor.sessionId, device_id: actor.deviceId };
  const target = { kind: 'person', staff_id: c.answerer } as const;
  // §3.12 / #55 "at Hamza's tablet": the answering device's name is a lock-safe display parameter
  const display = { ...c.record.display, device_name: c.row.device_name };
  const inputs: RaiseInput[] = [];
  if (c.request.needs_pin === 'always') {
    const values: ApprovalReceiptValues = {
      request_alert_id: c.record.alert_id,
      request_kind: c.record.kind,
      decision: payload.decision,
      device_id: answered.device_id,
      on_requester_device: answered.on_requester_device,
    };
    inputs.push({
      kind: 'approval_receipt',
      subject,
      target,
      values,
      display,
      details: c.record.details ?? {},
      dedupe_key: `approval_receipt:${c.record.alert_id}`,
      hidden_from,
    });
  }
  if (answered.on_requester_device) {
    const values: AnsweredOnRequesterDeviceValues = {
      request_alert_id: c.record.alert_id,
      request_kind: c.record.kind,
      decision: payload.decision,
      device_id: answered.device_id,
    };
    inputs.push({
      kind: 'answered_on_requester_device',
      subject,
      target,
      values,
      display,
      dedupe_key: `on_requester_device:${c.record.alert_id}`,
      hidden_from,
    });
  }
  return inputs;
}

/** §6.2 Processing (1)–(9): authoritative, drafts only (the pipeline appends them: (10)). */
function handle(ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: { alert_id: string; decision: Payload['decision']; answered_at: number } } {
  const answerer = answererOf(ctx.actor, payload);
  const c = check(readAlert(ctx.tx.db, payload.alert_id, ctx.actor.deviceId), payload, answerer, ctx.directory, payload.alert_id, ctx.actor.deviceId);
  const now = ctx.clock.branchNow();
  const subject = c.record.subject as { stream_type: PosEvent['stream_type']; stream_id: string };
  // (6)
  const answered: RequestAnsweredPayload = {
    alert_id: c.record.alert_id,
    decision: payload.decision,
    answerer_staff_id: c.answerer,
    method: payload.method,
    device_id: ctx.actor.deviceId,
    on_requester_device: ctx.actor.deviceId === c.record.raised_device_id,
  };
  const events: EventDraft[] = [
    {
      stream_type: subject.stream_type,
      stream_id: subject.stream_id,
      event_type: 'RequestAnswered',
      schema_version: 1,
      payload: answered,
      occurred_at: now,
      actor_id: ctx.actor.staffId,
      device_id: ctx.actor.deviceId,
    },
  ];
  // (7) A4: in the answer's transaction; a DomainError reaches the answerer, nothing is written
  events.push(...runApply(ctx, c, factsOf(payload, c, ctx.actor.deviceId, now)));
  // (8)–(9): one raiseMany (dedupe 1, the fixed reads once, one call per resolver / route over the three),
  // drafts in this order: request_result, approval_receipt, the notice, the reject's `:also` request_result (8b)
  const raises: RaiseInput[] = [];
  const requester = c.record.requester_staff_id;
  const about = { alert_id: c.record.alert_id, kind: c.record.kind, subject, requester_staff_id: requester ?? '', display: c.record.display };
  const outcome = { close_reason: 'answered' as const, decision: payload.decision, by_staff_id: c.answerer };
  // (8) request_result to the requester (§3.10)
  if (requester !== null) raises.push(requestResultInput(about, outcome));
  // (8a), (9): the personal notices to the answerer, hidden from this session and device (§3.10, v1.0 #2)
  raises.push(...noticeInputs(c, payload, answered, ctx.actor));
  // (8b) 01d v1.2.5 D-2 (G-7, G-8): on a reject, the kind's `result_also_to` on a read-only view (here, never in
  // preRead); a non-null target → one more request_result in this same raiseMany. 01d's own raise, so it is
  // not passed to checkAlertIds; dropped inside raiseMany when it routes only to the requester.
  if (payload.decision === 'reject' && c.request.result_also_to !== undefined) {
    const target = c.request.result_also_to({ ...ctx, tx: readOnlyTx(ctx.tx), alert: c.record });
    if (target !== null) {
      const also = requestResultInput(about, outcome, { target, dedupe_key: `request_result:${c.record.alert_id}:also` });
      raises.push(requester === null ? also : { ...also, drop_if_only: requester });
    }
  }
  if (raises.length > 0) {
    for (const raised of alerts.raiseMany(ctx, raises)) events.push(...raised.events);
  }
  return { events, result: { alert_id: c.record.alert_id, decision: payload.decision, answered_at: now } };
}

/** §6.2 pinCheck row: whose PIN is checked (and counted): the session staff (`pin`), the named answerer (`in_person`). */
function pinOwnerOf(payload: Payload, actor: CommandCtx['actor']): string {
  return payload.method === 'in_person' ? (payload.answerer_staff_id ?? '') : (actor.staffId ?? '');
}

/** The prepare error's catalogue code; anything else (a bug, 500) is INTERNAL_ERROR. Never the message (§7). */
function codeOf(error: unknown): string {
  return error instanceof DomainError ? error.code : 'INTERNAL_ERROR';
}

/**
 * §4.2 `RequestPinFailed` on `audit` / alert_id: never the PIN, never whether it matched (§3.3 rule 4).
 * 1 statement (the alert row). A row gone meanwhile (retention deletes closed alerts only, after 7 days)
 * leaves no record; the failure is still counted by checkPin.
 */
function pinFailed(
  tx: WriterTx,
  payload: Payload,
  ctx: CommandCtx,
  outcome: RequestPinFailedPayload['outcome'],
  errorCode: string,
): { row: RequestRow; draft: EventDraft } | null {
  if (payload.method === 'session') return null; // no PIN, never reached (pinCheck returns null)
  const row = readAlert(tx.db, payload.alert_id, ctx.actor.deviceId);
  if (row === undefined) return null;
  const failed: RequestPinFailedPayload = {
    alert_id: row.alert_id,
    subject_stream_type: row.subject_stream_type,
    subject_stream_id: row.subject_stream_id,
    answerer_staff_id: pinOwnerOf(payload, ctx.actor),
    method: payload.method,
    device_id: ctx.actor.deviceId,
    requester_staff_id: row.requester_staff_id ?? '',
    outcome,
    error_code: errorCode,
  };
  const draft: EventDraft = {
    stream_type: 'audit',
    stream_id: row.alert_id,
    event_type: 'RequestPinFailed',
    schema_version: 1,
    payload: failed,
    occurred_at: ctx.clock.branchNow(),
    actor_id: ctx.actor.staffId,
    device_id: ctx.actor.deviceId,
  };
  return { row, draft };
}

/** §3.10 `pin_use_failed` input: to the PIN owner, on the request's subject, hidden from the sending seat. */
function pinUseFailedInput(row: RequestRow, pinOwner: string, errorCode: string, ctx: CommandCtx, cmd: PosCommand): RaiseInput {
  const values: PinUseFailedValues = {
    request_alert_id: row.alert_id,
    request_kind: row.kind,
    error_code: errorCode,
    device_id: ctx.actor.deviceId,
  };
  return {
    kind: 'pin_use_failed',
    subject: { stream_type: row.subject_stream_type, stream_id: row.subject_stream_id },
    target: { kind: 'person', staff_id: pinOwner },
    values,
    display: { ...(JSON.parse(row.display_json) as AlertDisplay), device_name: row.device_name },
    dedupe_key: `pin_use_failed:${row.alert_id}:${cmd.command_id}`,
    hidden_from: { session_id: ctx.actor.sessionId, device_id: ctx.actor.deviceId },
  };
}

interface SafeLog {
  error(obj: object, msg: string): void;
}

/** §7: the error's name and catalogue code only; never its message or details. */
function safeErr(error: unknown): { name: string; code: string | null } {
  return { name: error instanceof Error ? error.name : typeof error, code: error instanceof DomainError ? error.code : null };
}

/** §6.2 `onMismatch(tx)`: prepare succeeded, the PIN did not match (checkPin has counted it). */
function onMismatch(tx: WriterTx, payload: Payload, ctx: CommandCtx): EventDraft[] {
  const failed = pinFailed(tx, payload, ctx, 'pin_invalid', 'PIN_INVALID');
  return failed === null ? [] : [failed.draft];
}

/**
 * §6.2 `onPrepareFailed(tx, error, matched)`: prepare threw, whatever the PIN (checkPin has counted one
 * failure). `RequestPinFailed { answer_failed, <code> }`, and only when the PIN matched the `pin_use_failed`
 * raise to its owner, in this same transaction (v1.0 #1, R1). BF-1: not for `method: 'pin'` (the owner's
 * own session) losing an honest race (`REQUEST_NOT_PENDING`). A throw of the notice raise is caught and
 * logged (no message, no PIN, no details) and the record is still returned: otherwise BF-2 would roll back
 * the count on a matched PIN only, a skipped count and an oracle (§3.3 rule 4 (d); controller ruling).
 */
function onPrepareFailed(
  tx: WriterTx,
  error: unknown,
  matched: boolean,
  payload: Payload,
  ctx: CommandCtx,
  cmd: PosCommand,
  log: SafeLog,
): EventDraft[] {
  const code = codeOf(error);
  const failed = pinFailed(tx, payload, ctx, 'answer_failed', code);
  if (failed === null) return [];
  const events: EventDraft[] = [failed.draft];
  const honestRace = payload.method === 'pin' && code === 'REQUEST_NOT_PENDING';
  if (matched && !honestRace) {
    try {
      // raise only reads and returns drafts, so a throw leaves nothing to undo
      events.push(...alerts.raise(ctx, pinUseFailedInput(failed.row, pinOwnerOf(payload, ctx.actor), code, ctx, cmd)).events);
    } catch (raiseError) {
      log.error(
        { err: safeErr(raiseError), alert_id: failed.row.alert_id, command: 'AnswerRequest', phase: 'pin_use_failed' },
        'AnswerRequest pin_use_failed raise failed; the failure is still counted and recorded',
      );
    }
  }
  return events;
}

export function registerAnswerRequest(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'AnswerRequest',
      payloadSchema: AnswerRequestPayload,
      sessionKind: 'device',
      permission: 'checked-in-handler',
      preRead,
      // §6.2 pinCheck row: the PIN of the session staff (pin) or of the named answerer (in_person); `pin` is
      // left out of payload_hash (H-9). `session` → no PIN. The device lockout subject is this device (the
      // pipeline's), which for in_person is the raising device (preRead refuses any other).
      pinCheck(payload, ctx) {
        if (payload.method === 'session') return null;
        return { staff_id: pinOwnerOf(payload, ctx.actor), pin: payload.pin ?? '', field: 'pin' };
      },
      pinHooks: {
        onMismatch: (tx, payload, ctx) => onMismatch(tx, payload, ctx),
        onPrepareFailed: (tx, error, matched, payload, ctx, cmd) => onPrepareFailed(tx, error, matched, payload, ctx, cmd, app.log),
      },
      handle: (ctx, payload) => handle(ctx, payload),
    }),
  );
}
