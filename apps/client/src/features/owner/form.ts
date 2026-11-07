import { useCallback, useState } from 'react';
import type { CloudError } from '../../api/cloud-admin';
import { supportText } from '../../app/support';
import { newUlid } from '../../app/ulid';
import { en, errorKey, fill } from '../../i18n/en';
import { formatMinutes } from './minutes';
import { t, type MessageKey } from '../../i18n';

// §8.1, S35 j: a creating POST's Idempotency-Key is made when the form opens and kept across its
// retries; renew() after a success starts the form again with a new key.
export function useIdempotencyKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState(() => newUlid());
  const renew = useCallback(() => setKey(newUlid()), []);
  return { key, renew };
}

// S7, §8.1: a retry whose body changed after a lost response is not the same submission; the
// form takes a new key and the list is reloaded so a create that did commit is shown.
export function isKeyMismatch(error: CloudError): boolean {
  return error.kind === 'api' && error.code === 'IDEMPOTENCY_KEY_MISMATCH';
}

// §8.1: the banner text for a failed call; a logged-out result shows nothing (the app goes to login).
export function errorText(error: CloudError): string | null {
  switch (error.kind) {
    case 'logged_out':
      return null;
    case 'network':
      return t('errors.network');
    case 'permission_denied':
      return t('errors.PERMISSION_DENIED');
    case 'api':
      return supportText(apiErrorKey(error.code, error.details));
  }
}

// 01b §8: OWN_ADMIN_ACCESS on the roles field or a blocked dialog; `owner_not_linked` has its own text. The
// support number is added only when VITE_SUPPORT_PHONE is set (Q3).
export function ownAdminText(details: Record<string, unknown>): string {
  return supportText(details['reason'] === 'owner_not_linked' ? 'errors.OWN_ADMIN_ACCESS_owner_not_linked' : 'errors.OWN_ADMIN_ACCESS');
}

// S50 e, 01c P1: CONFIG_REFERENCE_INVALID has one text per details.reason, keyed errors.reference.<reason>
// for every module (01a, 01b, 01c); unit_mismatch on a stock item's own unit (field stock_unit) has its own
// text. An unknown reason → the generic text. A removed row (any *_NOT_FOUND) says the page is refreshed.
export function referenceKey(details: Record<string, unknown>): MessageKey {
  const reason = details['reason'];
  if (reason === 'unit_mismatch' && details['field'] === 'stock_unit') return 'errors.reference.unit_mismatch_stock';
  const key = `errors.reference.${String(reason)}`;
  return typeof reason === 'string' && Object.hasOwn(en, key) ? (key as MessageKey) : 'errors.CONFIG_REFERENCE_INVALID';
}

function apiErrorKey(code: string, details: Record<string, unknown>): MessageKey {
  if (code === 'CONFIG_REFERENCE_INVALID') return referenceKey(details);
  if (code.endsWith('_NOT_FOUND') && code !== 'ROUTE_NOT_FOUND') return 'errors.NOT_FOUND_stale';
  return errorKey(code);
}

// The limits stay the cloud's; the words are the owner's. A box typed in minutes or percent says its limit in
// that unit (the cloud's message names ms or basis points, in English), and an internal name is never shown.
const NUMBER_LIMIT_RE = /^Too (?:big|small): expected number to be (<=?|>=?)\s*(-?[0-9]+)$/;
const LENGTH_LIMIT_RE = /^Too big: expected string to have <=?\s*([0-9]+) characters$/;
function plainIssue(path: string, message: string): string {
  const number = NUMBER_LIMIT_RE.exec(message);
  if (number !== null) {
    const upper = number[1]!.startsWith('<');
    const limit = Number(number[2]);
    const hole = (text: string) => (upper ? { max: text } : { min: text });
    if (path.endsWith('_ms')) return fill(t(upper ? 'form.range.max_minutes' : 'form.range.min_minutes'), hole(formatMinutes(limit)));
    if (path.endsWith('_bp')) return fill(t(upper ? 'form.range.max_percent' : 'form.range.min_percent'), hole(String(limit / 100)));
    return fill(t(upper ? 'form.range.max' : 'form.range.min'), hole(String(limit)));
  }
  const length = LENGTH_LIMIT_RE.exec(message);
  if (length !== null) return fill(t('form.length_max'), { max: length[1]! });
  if (message.endsWith(' is above capacity')) return t('form.above_capacity');
  if (message === 'pressure_amber_bp must be below pressure_red_bp') return t('form.amber_below_red');
  return message;
}

// 03a A-2–A-10: a 422 CONFIG_REFERENCE_INVALID names its `field`; a 400 VALIDATION_FAILED carries `issues: [{ path, message }]`; the field it names shows the
// cloud's refusal under it (the ranges are the cloud's, not the client's).
export function issueMessages(error: CloudError): Record<string, string> {
  if (error.kind === 'api' && error.code === 'CONFIG_REFERENCE_INVALID' && typeof error.details['field'] === 'string') {
    return { [error.details['field']]: errorText(error) ?? '' };
  }
  if (error.kind !== 'api' || error.code !== 'VALIDATION_FAILED') return {};
  const issues = error.details['issues'];
  if (!Array.isArray(issues)) return {};
  const out: Record<string, string> = {};
  for (const issue of issues as { path?: unknown; message?: unknown }[]) {
    if (typeof issue.path === 'string' && typeof issue.message === 'string' && !(issue.path in out)) out[issue.path] = plainIssue(issue.path, issue.message);
  }
  return out;
}
