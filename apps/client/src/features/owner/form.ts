import { useCallback, useState } from 'react';
import type { CloudError } from '../../api/cloud-admin';
import { newUlid } from '../../app/ulid';
import { errorKey } from '../../i18n/en';
import { t } from '../../i18n';

// §8.1, S35 j: a creating POST's Idempotency-Key is made when the form opens and kept across its
// retries; renew() after a success starts the form again with a new key.
export function useIdempotencyKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState(() => newUlid());
  const renew = useCallback(() => setKey(newUlid()), []);
  return { key, renew };
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
      return t(errorKey(error.code));
  }
}
