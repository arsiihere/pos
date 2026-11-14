import type { AlertCard, AlertLock, WsAlertClosed } from '@pos/events';
import type { HubResult } from '../../api/hub-admin';
import { newUlid } from '../../app/ulid';
import { t, type MessageKey } from '../../i18n';
import { en, fill } from '../../i18n/en';
import type { Resolution } from '../staff/api';

// 03b v1.0.8 §6.21, 03c v1.0.9 §6.10, §6.12 (task A5; frames AlertCards, AlertCardsUrdu, AlertLock, AlertLockDark,
// ManagerAlerts, PassEscalated, ReadyPhone, ServedPhone): the texts of the four 03b / 03c alert kinds, for 01d's
// cards, banners and lock lines. labels.ts consults this file through the W0.6 hook (Q-58, Q-66): for these kinds
// it takes `text03b` / `title03b` (or merges `params03b` into its own parameters), `closedText03b` before its default
// closed text, and the printer card's action from `printSkipAction` / `createPrintSkipDismiss`.
//
// Two levels (01d §3.12): the card reads the kind's `details` (identifier, station, printer, problem — card only);
// the lock line reads only the lock-safe display (table, point), so it never names a token, station or printer.
// This file imports nothing from labels.ts (labels.ts imports it: no import cycle).

/** §6.21 / 03c §6.10: the kinds 03b and 03c register (apps/hub/src/kds/kinds.ts, apps/hub/src/print/kinds.ts). */
export const ALERT_KINDS_03B = Object.freeze(['ready_to_serve', 'served_card', 'kds_offline', 'printer_problem'] as const);

export type Kind03b = (typeof ALERT_KINDS_03B)[number];

export function is03bKind(kind: string): kind is Kind03b {
  return (ALERT_KINDS_03B as readonly string[]).includes(kind);
}

interface Row03b {
  kind: string;
  lock: AlertLock;
  card?: AlertCard | undefined;
}

const isKey = (key: string): key is MessageKey => key in en;

/** As labels.ts tableLabel (01d P-1): "T12" for an all-digit table code, a table name as-is, empty → null. */
function tableLabel(code: string | null | undefined): string | null {
  if (code === null || code === undefined || code === '') return null;
  return /^[0-9]+$/.test(code) ? fill(t('alerts.table'), { code }) : code;
}

/** As labels.ts fillLine: a ` · ` part whose parameter is empty is dropped (Q-57: no "{waiting} waiting"). */
function fillLine(template: string, values: Record<string, string | null>): string {
  const has = (part: string) =>
    [...part.matchAll(/\{(\w+)\}/g)].every(([, name]) => {
      const v = values[name as string];
      return v !== null && v !== undefined && v !== '';
    });
  const parts = template.split(' · ');
  const kept = parts.filter(has);
  const filled = (kept.length > 0 ? kept : parts).map((part) => part.replace(/\{(\w+)\}/g, (_whole, name: string) => values[name] ?? ''));
  return filled.join(' · ').replace(/\s+/g, ' ').trim();
}

/** 03c §6.10: the problem word; an unknown problem is never shown raw (its part is dropped). */
function problemText(problem: string | undefined): string | null {
  if (problem === undefined) return null;
  const key = `alert.printer_problem.problem.${problem}`;
  return isKey(key) ? t(key) : null;
}

/**
 * The card-only parameters of the 03b / 03c kinds (D-2 details): `{identifier}`, `{station}`, `{printer}`,
 * `{problem}`. labels.ts merges them into its lock-safe ones on the card level only.
 */
export function params03b(card: AlertCard | undefined): Record<string, string | null> {
  const d = card?.details ?? null;
  return {
    identifier: d?.identifier ?? null,
    station: d?.station_name ?? null,
    printer: d?.printer_name ?? null,
    problem: problemText(d?.problem),
  };
}

function lockParams(display: AlertLock): Record<string, string | null> {
  return { table: tableLabel(display.table_code), point: display.point_code ?? null };
}

/** The card text when the row has a card (else the lock text), or the lock line. */
export function text03b(row: Row03b, level: 'card' | 'lock'): string {
  if (level === 'card' && row.card !== undefined) {
    const key = row.card.kind_label_key;
    return fillLine(isKey(key) ? t(key) : t('alerts.unknown.alert'), { ...lockParams(row.card), ...params03b(row.card) });
  }
  const key = row.lock.kind_label_key;
  return fillLine(isKey(key) ? t(key) : t('alerts.unknown.alert'), lockParams(row.lock));
}

/**
 * C01 / banner title: the text without the parts the card shows on their own (the table chip, the point, the
 * identifier): "Ready to serve", "Food handed to you", "Tandoor screen offline", "Tandoor printer · Out of paper".
 */
export function title03b(row: Row03b): string {
  const display = row.card ?? row.lock;
  const key = display.kind_label_key;
  const template = isKey(key) ? t(key) : t('alerts.unknown.alert');
  const kept = template.split(' · ').filter((part) => !/\{(table|point|identifier)\}/.test(part));
  const values = row.card !== undefined ? { ...lockParams(row.card), ...params03b(row.card) } : lockParams(row.lock);
  return fillLine(kept.length > 0 ? kept.join(' · ') : template, values);
}

/** The card's help line (card only): kds_offline, and printer_problem per problem. */
export function helpText03b(row: Row03b): string | null {
  if (row.card === undefined) return null;
  if (row.kind === 'kds_offline') return t('alert.kds_offline.help');
  // frames AlertCards / ServedPhone
  if (row.kind === 'served_card') return t('alert.served_card.help');
  if (row.kind === 'printer_problem') {
    const key = `alert.printer_problem.help.${row.card.details?.problem ?? ''}`;
    return isKey(key) ? t(key) : null;
  }
  return null;
}

/**
 * IR-22, frame PassEscalated: the who line of an escalated Ready on the Pass tablet / a manager's device,
 * "Pass · nobody came for 2 min" (whole minutes since it was raised, hub clock). Null on other steps and kinds.
 */
export function escalatedWho03b(row: { kind: string; escalation: boolean; lock: AlertLock; raised_at: number }, nowMs: number): string | null {
  if (row.kind !== 'ready_to_serve' || !row.escalation) return null;
  const n = String(Math.max(0, Math.floor((nowMs - row.raised_at) / 60_000)));
  return fillLine(t('alert.ready_to_serve.escalated'), { point: row.lock.point_code ?? null, n });
}

/**
 * A closed row's line for the 03b / 03c kinds (§3.5, §3.6; 03c §6.12, Q-53); null = not one of ours, or a reason the
 * kind does not name (labels.ts keeps its own text). `moved_to` is the table a re-targeted Ready moved to, when the
 * caller knows it (HK3); without it "Moved". `problem` is the printer card's `details.problem`.
 */
export function closedText03b(
  kind: string,
  c: { close_reason: WsAlertClosed['reason'] | null; moved_to?: string | null | undefined; problem?: string | null | undefined },
): string | null {
  switch (kind) {
    case 'ready_to_serve':
      if (c.close_reason === 'undone') return t('alerts.closed.undone');
      if (c.close_reason === 'done') return t('alerts.closed.served');
      if (c.close_reason === 'obsolete') {
        const table = tableLabel(c.moved_to);
        return table === null ? t('alerts.closed.moved_plain') : fill(t('alerts.closed.moved'), { table });
      }
      return null;
    case 'kds_offline':
      if (c.close_reason === 'done') return t('alerts.closed.screen_back');
      if (c.close_reason === 'obsolete') return t('alerts.closed.screen_removed');
      return null;
    case 'served_card':
      // frames AlertCards / AlertCardsUrdu: closed done (Served tapped, or the served estimate) reads "Served"
      return c.close_reason === 'done' ? t('alerts.closed.served') : null;
    case 'printer_problem':
      // Q-53: DismissPrintSkip closes `done` with no name on other devices ("Dismissed", never "· {name}")
      if (c.close_reason === 'done') return c.problem === 'ticket_not_built' ? t('alerts.closed.dismissed') : t('alerts.closed.printing_again');
      return null;
    default:
      return null;
  }
}

/** 03c §3.10 / §6.12: DismissPrintSkip needs `force-release-table-lock` allowed at `branch` scope (my_floors is not enough). */
export function canDismissPrintSkip(grant: Resolution | undefined): boolean {
  return grant?.grant === 'allowed' && grant.scope === 'branch';
}

/**
 * 03c §6.12 (Q-14, Q-53): only an open `printer_problem` card of problem `ticket_not_built` has an action: Dismiss for
 * a person whose `force-release-table-lock` Resolution (`grant`, from the session) is allowed at branch scope, else the
 * note "Stays until day close" — also after the hub refused this session a Dismiss (`denied`, 403). Every other kind
 * and problem: nothing.
 */
export function printSkipAction(
  row: Row03b,
  o: { open: boolean; grant: Resolution | undefined; denied?: boolean | undefined },
): { kind: 'dismiss'; label: string } | { kind: 'stays'; label: string } | null {
  if (!o.open || row.kind !== 'printer_problem' || row.card?.details?.problem !== 'ticket_not_built') return null;
  return canDismissPrintSkip(o.grant) && o.denied !== true
    ? { kind: 'dismiss', label: t('alert.printer_problem.dismiss') }
    : { kind: 'stays', label: t('alert.printer_problem.stays') };
}

export type DismissOutcome = { ok: true } | { ok: false; refreshed: boolean; text?: string };

export interface PrintSkipDismiss {
  dismiss(alert_id: string): Promise<DismissOutcome>;
  /** the hub refused this session a Dismiss (403): pass to printSkipAction as `denied` */
  denied(): boolean;
}

/**
 * 03c §6.12 `DismissPrintSkip { alert_id }` (staff session; not queueable). 404 ALERT_NOT_FOUND / 409
 * ALERT_ALREADY_CLOSED → `refresh(alert_id)` (the card shows its current state, e.g. closed). 403 PERMISSION_DENIED
 * (including outside_scope) → `denied()` turns true and `refresh(alert_id)` re-renders the card with "Stays until day
 * close" (as Reprint hides its action, A4); no words of its own. W0.6 makes one per signed-in session. 00 M47: a send that got no
 * answer keeps its command_id for the next tap; a tap while one runs for the same alert gets that run's promise.
 */
export function createPrintSkipDismiss(
  send: (commandType: string, payload: Record<string, unknown>, commandId: string) => Promise<HubResult<{ dismissed: boolean }>>,
  refresh: (alert_id: string) => void,
): PrintSkipDismiss {
  let denied = false;
  const ids = new Map<string, string>();
  const running = new Map<string, Promise<DismissOutcome>>();

  const run = async (alert_id: string): Promise<DismissOutcome> => {
    const id = ids.get(alert_id) ?? newUlid();
    ids.set(alert_id, id);
    const answer = await send('DismissPrintSkip', { alert_id }, id);
    if (answer.ok) {
      ids.delete(alert_id);
      return { ok: true };
    }
    if (answer.error.kind !== 'api') {
      return { ok: false, refreshed: false, text: t(answer.error.kind === 'network' ? 'answer.error.offline' : 'errors.ADMIN_SESSION_REQUIRED') };
    }
    ids.delete(alert_id);
    if (answer.error.code === 'PERMISSION_DENIED') denied = true;
    if (answer.error.code === 'ALERT_NOT_FOUND' || answer.error.code === 'ALERT_ALREADY_CLOSED' || answer.error.code === 'PERMISSION_DENIED') {
      refresh(alert_id);
      return { ok: false, refreshed: true };
    }
    const key = `errors.${answer.error.code}`;
    return { ok: false, refreshed: false, text: t(isKey(key) ? key : 'errors.UNKNOWN') };
  };

  return {
    dismiss(alert_id) {
      const inFlight = running.get(alert_id);
      if (inFlight !== undefined) return inFlight;
      const started = run(alert_id).finally(() => running.delete(alert_id));
      running.set(alert_id, started);
      return started;
    },
    denied: () => denied,
  };
}
