import { DomainError } from '@pos/domain';
import {
  AnswerRequestPayload,
  type AlertDetails,
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
import { kindOf, type AlertKind, type AlertRecord, type AnswerFacts, type PinUseFailedValues } from '../kinds.js';
import { alerts, requestResultInput, type RaiseInput } from '../raise.js';
import { mayAnswer, type AlertRequestPart } from '../targets.js';

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

type Payload = AnswerRequestPayload;

interface AnswerRow {
  alert_id: string;
  kind: string;
  family: AlertRecord['family'];
  subject_stream_type: PosEvent['stream_type'];
  subject_stream_id: string;
  dedupe_key: string;
  requester_staff_id: string | null;
  raised_device_id: string;
  values_json: string;
  display_json: string;
  details_json: string | null;
  request_json: string | null;
  step: number;
  raised_at: number;
  state: 'open' | 'closed';
  close_reason: string | null;
  decision: string | null;
  closed_by_staff_id: string | null;
}

const READ_ALERT = `SELECT alert_id, kind, family, subject_stream_type, subject_stream_id, dedupe_key, requester_staff_id,
       raised_device_id, values_json, display_json, details_json, request_json, step, raised_at,
       state, close_reason, decision, closed_by_staff_id
  FROM alerts WHERE alert_id = ?`;

/** The one alert statement (§6.2 Queries). */
function readAlert(db: Database.Database, alertId: string): AnswerRow | undefined {
  return db.prepare(READ_ALERT).get(alertId) as AnswerRow | undefined;
}

interface Checked {
  row: AnswerRow;
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
  if (actor.kind === 'station') throw new DomainError('PERMISSION_DENIED', { session_kind: 'station' });
  if (actor.staffId === null) throw new DomainError('PERMISSION_DENIED', { grant: 'not_granted' });
  // payload Zod: answerer_staff_id is present iff in_person
  if (payload.method === 'in_person') return payload.answerer_staff_id ?? '';
  return actor.staffId;
}

/**
 * §3.3 rule 4 (b) order (= §6.2 Processing (1)–(5)): rule 1 (404 / 409), the decision in the kind's answers
 * (400), rule 3 (422), in person: the named answerer in the directory (404 STAFF_NOT_FOUND) and the raising
 * device (403 in_person_elsewhere), rule 5 (403 self), rule 6 (403 not_approver / out_of_range /
 * not_receiver). Directory in memory; no statement.
 */
function check(
  row: AnswerRow | undefined,
  payload: Payload,
  answerer: string,
  directory: StaffDirectory,
  alertId: string,
  deviceId: string,
): Checked {
  // (1) rule 1: exists, has a request part
  if (row === undefined || row.request_json === null) throw new DomainError('ALERT_NOT_FOUND', { alert_id: alertId });
  // (2) rule 1: pending (§9 details)
  if (row.state !== 'open') {
    const answeredBy = row.close_reason === 'answered' ? row.closed_by_staff_id : null;
    throw new DomainError('REQUEST_NOT_PENDING', {
      alert_id: row.alert_id,
      state: 'closed',
      close_reason: row.close_reason,
      decision: row.decision,
      answered_by_staff_id: answeredBy,
      answered_by_name: answeredBy === null ? null : (directory.get(answeredBy)?.display_name ?? null),
    });
  }
  const part = JSON.parse(row.request_json) as AlertRequestPart;
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

  const kind = kindOf(row.kind);
  // P-8: an open request of a kind this build does not register cannot run its effect (a bug / rollback)
  if (kind === undefined || kind.request === null) throw new Error(`AnswerRequest: kind '${row.kind}' has no registered request part`);
  const record: AlertRecord = {
    alert_id: row.alert_id,
    kind: row.kind,
    family: row.family,
    subject: { stream_type: row.subject_stream_type, stream_id: row.subject_stream_id },
    dedupe_key: row.dedupe_key,
    requester_staff_id: row.requester_staff_id,
    receiver_staff_id: part.receiver_staff_id,
    raised_device_id: row.raised_device_id,
    values: JSON.parse(row.values_json) as Record<string, unknown>,
    display: JSON.parse(row.display_json) as AlertDisplay,
    details: row.details_json === null ? null : (JSON.parse(row.details_json) as AlertDetails),
    step: row.step,
    raised_at: row.raised_at,
  };
  return { row, kind, request: kind.request, record, answerer };
}

/** §3.5: `apply` on a read-only view; every draft must carry this alert's id (else a bug → 500). */
function runApply(ctx: CommandCtx, c: Checked, answer: AnswerFacts): EventDraft[] {
  const drafts = c.request.apply({ ...ctx, tx: readOnlyTx(ctx.tx), alert: c.record }, answer);
  for (const draft of drafts) {
    if (draft.payload.alert_id !== c.record.alert_id) {
      // kind and event type only: never the payload (§7)
      throw new Error(`AnswerRequest: kind '${c.record.kind}' apply returned ${draft.event_type} without this alert's alert_id`);
    }
  }
  return drafts;
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
  };
  runApply(applyCtx, c, factsOf(payload, c, ctx.actor.deviceId, ctx.clock.branchNow()));
}

/** §6.2 Processing (1)–(9): authoritative, drafts only (the pipeline appends them: (10)). */
function handle(ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: { alert_id: string; decision: Payload['decision']; answered_at: number } } {
  const answerer = answererOf(ctx.actor, payload);
  const c = check(readAlert(ctx.tx.db, payload.alert_id), payload, answerer, ctx.directory, payload.alert_id, ctx.actor.deviceId);
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
  // (8) request_result to the requester (§3.10)
  if (c.record.requester_staff_id !== null) {
    const result = alerts.raise(
      ctx,
      requestResultInput(
        { alert_id: c.record.alert_id, kind: c.record.kind, subject, requester_staff_id: c.record.requester_staff_id, display: c.record.display },
        { close_reason: 'answered', decision: payload.decision, by_staff_id: c.answerer },
      ),
    );
    events.push(...result.events);
  }
  // (8a) approval_receipt and (9) answered_on_requester_device: task 24
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
): { row: AnswerRow; draft: EventDraft } | null {
  if (payload.method === 'session') return null; // no PIN, never reached (pinCheck returns null)
  const row = readAlert(tx.db, payload.alert_id);
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
function pinUseFailedInput(row: AnswerRow, pinOwner: string, errorCode: string, ctx: CommandCtx, cmd: PosCommand): RaiseInput {
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
    display: JSON.parse(row.display_json) as AlertDisplay,
    dedupe_key: `pin_use_failed:${row.alert_id}:${cmd.command_id}`,
    hidden_from: { session_id: ctx.actor.sessionId, device_id: ctx.actor.deviceId },
  };
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
 * own session) losing an honest race (`REQUEST_NOT_PENDING`). A throw here rolls the transaction back and
 * checkPin returns the original prepare error (BF-2).
 */
function onPrepareFailed(tx: WriterTx, error: unknown, matched: boolean, payload: Payload, ctx: CommandCtx, cmd: PosCommand): EventDraft[] {
  const code = codeOf(error);
  const failed = pinFailed(tx, payload, ctx, 'answer_failed', code);
  if (failed === null) return [];
  const events: EventDraft[] = [failed.draft];
  const honestRace = payload.method === 'pin' && code === 'REQUEST_NOT_PENDING';
  if (matched && !honestRace) {
    events.push(...alerts.raise(ctx, pinUseFailedInput(failed.row, pinOwnerOf(payload, ctx.actor), code, ctx, cmd)).events);
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
        onPrepareFailed: (tx, error, matched, payload, ctx, cmd) => onPrepareFailed(tx, error, matched, payload, ctx, cmd),
      },
      handle: (ctx, payload) => handle(ctx, payload),
    }),
  );
}
