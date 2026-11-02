import type { AlertFamily } from '@pos/domain';
import type { AlertCard, AlertDetails, AlertLock, RequestOutcome, WsAlertClosed } from '@pos/events';
import { t, type MessageKey } from '../../i18n';
import { en, fill } from '../../i18n/en';
import { shownRupees } from '../owner/money';
import { isSilent } from './sounds';

// 01d §3.12: alert texts from the client string tables. Each kind has `alert.<kind>.card` (signed in) and
// `alert.<kind>.lock` (session-less); the parameters come from `display` (lock-safe) and, on the card only,
// `details`. A kind key or a permission key is never shown: an unknown key falls back to a generic text.

/** §3.10: the kinds 01d ships (apps/hub/src/alerts/kinds.ts). */
export const ALERT_KINDS_01D = Object.freeze([
  'test_alert',
  'request_result',
  'pin_use_failed',
  'approval_receipt',
  'answered_on_requester_device',
  'no_approver',
] as const);

interface Labelled {
  kind: string;
  family: AlertFamily;
  lock: AlertLock;
  card?: AlertCard | undefined;
  outcome?: RequestOutcome | null | undefined;
  answers?: readonly string[] | null | undefined;
}

const isKey = (key: string): key is MessageKey => key in en;

function params(d: AlertLock): Record<string, string | null> {
  const code = d.table_code ?? null;
  return {
    table: code === null || code === '' ? null : fill(t('alerts.table'), { code }),
    point: d.point_code ?? null,
    requester: d.requester_name ?? null,
    device: d.device_name ?? null,
  };
}

/** Fills a ` · `-separated template; a part whose parameter is empty is dropped (no "T · …"). */
function fillLine(template: string, values: Record<string, string | null>): string {
  const has = (part: string) =>
    [...part.matchAll(/\{(\w+)\}/g)].every(([, name]) => {
      const v = values[name as string];
      return v !== null && v !== undefined && v !== '';
    });
  const parts = template.split(' · ');
  const kept = parts.filter(has);
  const filled = (kept.length > 0 ? kept : parts).map((part) =>
    part.replace(/\{(\w+)\}/g, (_whole, name: string) => values[name] ?? ''),
  );
  return filled.join(' · ').replace(/\s+/g, ' ').trim();
}

function textOf(a: Labelled, level: 'card' | 'lock'): string {
  const display: AlertLock = level === 'card' && a.card !== undefined ? a.card : a.lock;
  // AD-82: a request_result reads by its outcome (lock-safe, so on both levels)
  const outcomeKey = a.kind === 'request_result' && a.outcome != null ? `alert.request_result.${a.outcome}` : null;
  const key = outcomeKey ?? display.kind_label_key;
  const template = isKey(key)
    ? t(key)
    : t(a.family === 'urgent' || (a.answers?.length ?? 0) > 0 ? 'alerts.unknown.request' : 'alerts.unknown.alert');
  return fillLine(template, params(display));
}

/** The signed-in text when the row has a card, else the lock text (AD-162/163: lock-only rows). */
export function alertText(a: Labelled): string {
  return textOf(a, a.card !== undefined ? 'card' : 'lock');
}

/**
 * C01 / D01 title (task 41): the alert's text without the parts the card shows on their own (the table chip and
 * "from <name>"), e.g. "Void request", "Test alert". Card text when the row has a card, else lock text.
 */
export function titleText(a: Labelled): string {
  const level = a.card !== undefined ? 'card' : 'lock';
  const display: AlertLock = level === 'card' && a.card !== undefined ? a.card : a.lock;
  const outcomeKey = a.kind === 'request_result' && a.outcome != null ? `alert.request_result.${a.outcome}` : null;
  const key = outcomeKey ?? display.kind_label_key;
  const template = isKey(key)
    ? t(key)
    : t(a.family === 'urgent' || (a.answers?.length ?? 0) > 0 ? 'alerts.unknown.request' : 'alerts.unknown.alert');
  const kept = template.split(' · ').filter((part) => !/\{(table|requester|point)\}/.test(part));
  return fillLine(kept.length > 0 ? kept.join(' · ') : template, params(display));
}

/** F01 lock line: never an amount, item or reason. */
export function lockText(a: Labelled): string {
  return textOf(a, 'lock');
}

/** §3.12 card only: "Chicken Karahi — Full ×1 · Rs 2,200 · “Customer changed mind”". */
export function detailsText(details: AlertDetails | null | undefined): string | null {
  if (details === null || details === undefined) return null;
  const parts: string[] = [];
  if (details.item !== undefined) parts.push(details.quantity !== undefined ? `${details.item} ×${details.quantity}` : details.item);
  if (details.amount !== undefined) parts.push(fill(t('alerts.amount'), { amount: shownRupees(details.amount) }));
  if (details.reason !== undefined && details.reason !== '') parts.push(`“${details.reason}”`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** DQ4: the family word (icon + word + colour); the silent kind reads "Receipt" (by flag, or by kind on lock views). */
export function familyText(family: AlertFamily, silent: boolean | { kind: string; silent?: boolean | undefined } = false): string {
  const quiet = typeof silent === 'boolean' ? silent : isSilent(silent);
  return t(quiet ? 'alerts.family.silent' : `alerts.family.${family}`);
}

/**
 * §3.10 D04 `answered_on_requester_device` title. `{kind}` is filled only from the label `alert.<kind>.name` when
 * the owning module defines one, else the neutral word: a kind key is never shown (§3.12).
 */
export function inPersonTitle(a: { kind: string; lock: AlertLock }): string {
  const nameKey = `alert.${a.kind}.name`;
  const kind = isKey(nameKey) ? t(nameKey) : t('alerts.kind_fallback');
  const p = params(a.lock);
  return fill(t('notice.in_person_title'), { kind, table: p.table ?? '', requester: p.requester ?? '' });
}

/** C01 step marker: "Reminder" on a later step, "Escalated" on the escalation step. */
export function stepTag(a: { step: number; escalation: boolean }): string | null {
  if (a.escalation) return t('alerts.tag.escalated');
  return a.step > 0 ? t('alerts.tag.reminder') : null;
}

/** BF-4: "from 1 Nov" for a row from an earlier business day (YYYY-MM-DD, the hub's date). */
export function fromDayText(day: string | null | undefined): string | null {
  if (day === null || day === undefined) return null;
  const [, month, date] = day.split('-').map(Number);
  const name = t('alerts.months').split(',')[(month ?? 1) - 1] ?? '';
  return fill(t('alerts.tag.earlier'), { date: `${date ?? ''} ${name}` });
}

/** AD-167: 12-hour times in the hub zone, "2:02 PM" (Latin digits, LTR). */
export function timeText(ms: number, utcOffsetMs: number): string {
  const d = new Date(ms + utcOffsetMs);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** C01: "waiting 2 min" on an open request (whole minutes). */
export function waitingText(raisedAt: number, nowMs: number): string {
  return fill(t('alerts.waiting'), { n: String(Math.max(0, Math.floor((nowMs - raisedAt) / 60_000))) });
}

/** C02: hidden at 0, "99+" above 99. */
export function badgeText(n: number): string | null {
  if (n <= 0) return null;
  return n > 99 ? '99+' : String(n);
}

/** §8.1 tablet header (B05): bound and active, paused after the route deadline, or no binding. */
export function bindText(binding: { name: string; until: number } | null, nowMs: number, utcOffsetMs: number): string {
  if (binding === null) return t('bind.none');
  if (nowMs >= binding.until) return t('bind.paused');
  return fill(t('bind.active'), { name: binding.name, time: timeText(binding.until, utcOffsetMs) });
}

/** C01 closed row: "Approved by Imran 2:02 PM" · "Withdrawn" · "Expired" · "Closed". */
export function closedText(
  c: {
    close_reason: WsAlertClosed['reason'] | null;
    decision?: WsAlertClosed['decision'] | undefined;
    by_name?: string | null | undefined;
    at?: number | undefined;
  },
  utcOffsetMs: number,
): string {
  switch (c.close_reason) {
    case 'answered': {
      const approved = c.decision === 'approve' || c.decision === 'accept';
      const rejected = c.decision === 'reject' || c.decision === 'decline';
      if (!approved && !rejected) return t('alerts.closed.closed');
      const name = c.by_name ?? null;
      if (name === null) return t(approved ? 'answer.done_approved' : 'answer.done_rejected');
      const time = c.at === undefined ? '' : timeText(c.at, utcOffsetMs);
      return fill(t(approved ? 'alerts.closed.approved' : 'alerts.closed.rejected'), { name, time }).trim();
    }
    case 'withdrawn':
      return t('alerts.closed.withdrawn');
    case 'expired':
      return t('alerts.closed.expired');
    default:
      // done / obsolete / overridden / undone: the owning module may name the reason (e.g. "bill closed")
      return t('alerts.closed.closed');
  }
}

/** §8.1 / brief §6: the answer sheet's error text for a code and its details. 'NETWORK' = socket down. */
export function answerErrorText(
  code: string,
  details: Record<string, unknown>,
  request: { requester_name?: string | null | undefined } = {},
): string {
  const name = typeof details.answered_by_name === 'string' ? details.answered_by_name : null;
  switch (code) {
    case 'REQUEST_NOT_PENDING': {
      if (details.close_reason === 'withdrawn' && request.requester_name != null) {
        return fill(t('answer.error.withdrawn_by'), { requester: request.requester_name });
      }
      if (details.close_reason === 'answered' && name !== null) {
        const approved = details.decision === 'approve' || details.decision === 'accept';
        return fill(t(approved ? 'answer.error.already_approved' : 'answer.error.already_rejected'), { name });
      }
      return t('answer.error.closed');
    }
    case 'PERMISSION_DENIED':
      switch (details.reason) {
        case 'out_of_range':
          return t('answer.error.out_of_range');
        case 'in_person_elsewhere':
          return t('answer.error.in_person_elsewhere');
        case 'self':
          return t('answer.error.self');
        default:
          return t('answer.error.not_approver');
      }
    case 'PIN_INVALID':
      return t('answer.error.pin_invalid');
    case 'PIN_LOCKED_OUT':
    case 'DEVICE_LOCKED_OUT': {
      const ms = typeof details.retry_after_ms === 'number' ? details.retry_after_ms : 60_000;
      return fill(t('answer.error.locked_out'), { n: String(Math.max(1, Math.ceil(ms / 60_000))) });
    }
    case 'ALERT_NOT_FOUND':
      return t('answer.error.not_found');
    case 'STAFF_NOT_FOUND':
      return t('answer.error.staff_not_found');
    case 'SERVICE_UNAVAILABLE':
      return t('answer.error.busy');
    case 'NETWORK':
      return t('answer.error.offline');
    default:
      return t('answer.error.failed');
  }
}
