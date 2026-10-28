import { useCallback, useState } from 'react';
import type { CloudError } from '../../api/cloud-admin';
import { withSupport } from '../../app/support';
import { newUlid } from '../../app/ulid';
import { errorKey } from '../../i18n/en';
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
      return withSupport(t(apiErrorKey(error.code, error.details)));
  }
}

// 01b §8: OWN_ADMIN_ACCESS on the roles field or a blocked dialog; `owner_not_linked` has its own text. The
// support number is added only when VITE_SUPPORT_PHONE is set (Q3).
export function ownAdminText(details: Record<string, unknown>): string {
  return withSupport(t(details['reason'] === 'owner_not_linked' ? 'errors.OWN_ADMIN_ACCESS_owner_not_linked' : 'errors.OWN_ADMIN_ACCESS'));
}

// S50 e: CONFIG_REFERENCE_INVALID has one text per details.reason; a removed row (any *_NOT_FOUND) says
// the page is refreshed, and the view reloads.
const REASON_KEYS: Record<string, MessageKey> = {
  archived: 'errors.reference.archived',
  not_found: 'errors.reference.not_found',
  wrong_branch: 'errors.reference.wrong_branch',
  program_required: 'errors.reference.program_required',
  program_not_allowed: 'errors.reference.program_not_allowed',
  program_wrong_station: 'errors.reference.program_wrong_station',
  stock_time_exceeds_cook_time: 'errors.reference.stock_time_exceeds_cook_time',
};

function apiErrorKey(code: string, details: Record<string, unknown>): MessageKey {
  if (code === 'CONFIG_REFERENCE_INVALID') {
    const reason = details['reason'];
    return (typeof reason === 'string' ? REASON_KEYS[reason] : undefined) ?? errorKey(code);
  }
  if (code.endsWith('_NOT_FOUND') && code !== 'ROUTE_NOT_FOUND') return 'errors.NOT_FOUND_stale';
  return errorKey(code);
}
