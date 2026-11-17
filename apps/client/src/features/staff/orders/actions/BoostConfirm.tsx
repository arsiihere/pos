import { useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { showOrderError } from '../view/LineActions';

// 02b v1.0.11 §3.8, §6.6 (frame 02b-D36 Boost): confirm in place under the order's actions, then BoostOrder. An order
// out of the engine answers ORDER_NOT_IN_ENGINE → "This order is closed". Online only.

export interface BoostConfirmProps {
  order_id: string;
  /** the token / plate the question names */
  ident: string;
  onClose(): void;
  onChanged(): void;
}

export function BoostConfirm({ order_id, ident, onClose, onChanged }: BoostConfirmProps) {
  const shell = useShell();
  const [busy, setBusy] = useState(false);
  const boost = async () => {
    if (busy) return;
    setBusy(true);
    const answer = await shell.orders.boostOrder({ order_id });
    setBusy(false);
    if (answer.ok) shell.toasts.show({ text: t('order.toast.boosted') });
    else showOrderError(shell, answer.error, onChanged);
    onClose();
  };
  return (
    <div className="confirm c-warn" role="group">
      <span>{fill(t('boost.confirm'), { id: ident })}</span>
      <button type="button" className="btn" onClick={onClose}>
        {t('common.cancel')}
      </button>
      <button type="button" className="btn btn--tone c-warn" disabled={busy} onClick={() => void boost()}>
        <Ico name="pulse" />
        {t('ov.boost')}
      </button>
    </div>
  );
}
