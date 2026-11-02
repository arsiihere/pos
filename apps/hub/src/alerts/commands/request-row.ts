import { DomainError } from '@pos/domain';
import type { AlertDetails, AlertDisplay, EventDraft, PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import type { CommandCtx } from '../../commands/registry.js';
import { kindOf, type AlertKind, type AlertRecord } from '../kinds.js';
import type { AlertRequestPart } from '../targets.js';

// 01d §6.2 / §6.3 shared by AnswerRequest and WithdrawRequest (the session guard also by MarkAlertsSeen): the one alert statement, §3.3 rule 1
// (404 / 409 with the §9 details), the typed `AlertRecord` and the §3.5 `alert_id` check on a kind's drafts.

export interface RequestRow {
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
  /** §3.12: the name of the device given to readAlert (the answering device), in the same statement; else null */
  device_name: string | null;
}

const READ_ALERT = `SELECT alert_id, kind, family, subject_stream_type, subject_stream_id, dedupe_key, requester_staff_id,
       raised_device_id, values_json, display_json, details_json, request_json, step, raised_at,
       state, close_reason, decision, closed_by_staff_id,
       (SELECT d.device_name FROM devices d WHERE d.device_id = @device_id) AS device_name
  FROM alerts WHERE alert_id = @alert_id`;

/**
 * 00 v1.6 §3.7 H-3: a handler-checked command runs for a staff session only (the pipeline's `authorize`
 * refuses a station session first; this repeats it where the handler reads the staff). The session's staff id.
 */
export function sessionStaff(actor: CommandCtx['actor']): string {
  if (actor.kind === 'station') throw new DomainError('PERMISSION_DENIED', { session_kind: 'station' });
  if (actor.staffId === null) throw new DomainError('PERMISSION_DENIED', { grant: 'not_granted' });
  return actor.staffId;
}

/**
 * The one alert statement (§6.2 / §6.3 Queries). `deviceId` (the acting device) also reads that device's name
 * in the same statement, for the personal notices' lock-safe `display.device_name` (§3.12, #55).
 */
export function readAlert(db: Database.Database, alertId: string, deviceId: string | null = null): RequestRow | undefined {
  return db.prepare(READ_ALERT).get({ alert_id: alertId, device_id: deviceId }) as RequestRow | undefined;
}

/** §3.3 rule 1: the alert exists with a request part (404) and is pending (409, §9 details). No statement. */
export function pendingRequest(
  row: RequestRow | undefined,
  alertId: string,
  directory: StaffDirectory,
): { row: RequestRow; part: AlertRequestPart } {
  if (row === undefined || row.request_json === null) throw new DomainError('ALERT_NOT_FOUND', { alert_id: alertId });
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
  return { row, part: JSON.parse(row.request_json) as AlertRequestPart };
}

/** P-8: an open request of a kind this build does not register cannot run its effect (a bug / rollback → 500). */
export function requestKindOf(row: RequestRow, command: string): { kind: AlertKind; request: NonNullable<AlertKind['request']> } {
  const kind = kindOf(row.kind);
  if (kind === undefined || kind.request === null) throw new Error(`${command}: kind '${row.kind}' has no registered request part`);
  return { kind, request: kind.request };
}

/** The typed record a kind's `apply` / `onWithdraw` reads (§3.5). */
export function recordOf(row: RequestRow, part: AlertRequestPart): AlertRecord {
  return {
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
}

/** §3.5: every draft a kind's `apply` / `onWithdraw` returns carries this alert's id (else a bug → 500). */
export function checkAlertIds(command: string, hook: 'apply' | 'onWithdraw', record: AlertRecord, drafts: EventDraft[]): EventDraft[] {
  for (const draft of drafts) {
    if (draft.payload.alert_id !== record.alert_id) {
      // kind and event type only: never the payload (§7)
      throw new Error(`${command}: kind '${record.kind}' ${hook} returned ${draft.event_type} without this alert's alert_id`);
    }
  }
  return drafts;
}
