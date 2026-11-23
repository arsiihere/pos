import type { Permission } from '@pos/domain';
import type { ReactNode } from 'react';
import { t } from '../../../i18n';
import type { Permissions } from './permissions';

// 05a §3.3a, §3.9 rule 1, §8: an action of a permission the session view changed.
// `listed_only` (not granted on this device): nothing is drawn. `downgraded` (a money grant that now needs a
// phone): the action stays and is pressed as before (the hub raises the request to the requester's phone), with the
// hint "Confirm on your phone" beside it. Otherwise the action as the caller draws it (the caller still decides on
// allowed / requires_approval). Never reads the device type or the width.

export function maskedActionState(p: Permissions, permission: Permission): 'action' | 'confirm_on_phone' | 'hidden' {
  const mask = p.masked(permission);
  if (mask === 'listed_only') return 'hidden';
  if (mask === 'downgraded') return 'confirm_on_phone';
  return p.allowed(permission) || p.requiresApproval(permission) ? 'action' : 'hidden';
}

export function MaskedAction({ permissions, permission, children }: { permissions: Permissions; permission: Permission; children: ReactNode }) {
  const state = maskedActionState(permissions, permission);
  if (state === 'hidden') return null;
  return (
    <>
      {children}
      {state === 'confirm_on_phone' && <small className="hint masked-action">{t('answer.confirm_on_phone')}</small>}
    </>
  );
}
