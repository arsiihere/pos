import { useEffect, useState } from 'react';
import { t } from '../../../../i18n';
import { useShell } from '../../shell/hooks';
import type { OrderContact } from '../contracts';
import { showOrderError, Sheet } from '../view/LineActions';

// 02b v1.0.11 §8 Table view, §6.18 (frame 02b-D35 Contact): "Call" reads `order-contact` (a deliberate tap; the hub
// logs the look) and shows the name and phone big. The caller shows the button only with view-customer-contact.
// Nothing of the contact is logged or kept here (02b §7 privacy).

export interface ContactSheetProps {
  order_id: string;
  /** "Parking · LEB 1234" */
  what: string;
  onClose(): void;
}

export function ContactSheet({ order_id, what, onClose }: ContactSheetProps) {
  const shell = useShell();
  const [contact, setContact] = useState<OrderContact | null>(null);
  useEffect(() => {
    let live = true;
    void shell.orders.orderContact(order_id).then((answer) => {
      if (!live) return;
      if (answer.ok) setContact(answer.data);
      else {
        showOrderError(shell, answer.error, () => {});
        onClose();
      }
    });
    return () => {
      live = false;
    };
    // one read per open
  }, [order_id]);
  return (
    <Sheet
      title={t('contact.title')}
      sub={`${what} · ${t('contact.logged')}`}
      onClose={onClose}
      actions={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      {contact !== null && (
        <div className="facts">
          <div className="fact fact--wide">
            <span>{t('contact.name')}</span>
            <b dir="auto">{contact.customer_name ?? '—'}</b>
          </div>
          <div className="fact fact--wide fact--amt">
            <span>{t('contact.phone')}</span>
            <b className="num" dir="ltr">
              {contact.phone ?? '—'}
            </b>
          </div>
        </div>
      )}
    </Sheet>
  );
}
