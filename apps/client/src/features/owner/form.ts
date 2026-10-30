import { useCallback, useState } from 'react';
import type { CloudError } from '../../api/cloud-admin';
import { supportText } from '../../app/support';
import { newUlid } from '../../app/ulid';
import { en, errorKey } from '../../i18n/en';
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
