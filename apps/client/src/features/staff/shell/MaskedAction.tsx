import type { Permission } from '@pos/domain';
import type { ReactNode } from 'react';
import { t } from '../../../i18n';
import type { Permissions } from './permissions';

// 05a §3.3a, §8: an action of a permission the session view changed. `listed_only` (not granted here): nothing is
// drawn. `downgraded` (a money grant that needs a phone): the action is shown as "Confirm on your phone", no button
// to press here. Granted outright: the action. The decision never reads the device type or the width.

export function maskedActionState(p: Permissions, permission: Permission): 'action' | 'confirm_on_phone' | 'hidden' {
  const mask = p.masked(permission);
  if (mask === 'listed_only') return 'hidden';
  if (mask === 'downgraded') return 'confirm_on_phone';
  return p.allowed(permission) ? 'action' : 'hidden';
}

export function MaskedAction({ permissions, permission, children }: { permissions: Permissions; permission: Permission; children: ReactNode }) {
  const state = maskedActionState(permissions, permission);
  if (state === 'hidden') return null;
  if (state === 'confirm_on_phone') return <span className="hint masked-action">{t('answer.confirm_on_phone')}</span>;
  return <>{children}</>;
}
