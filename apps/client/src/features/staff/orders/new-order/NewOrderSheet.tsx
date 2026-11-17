import { useState } from 'react';
import { navigate } from '../../../../app/router';
import { newUlid } from '../../../../app/ulid';
import { t } from '../../../../i18n';
import { CloseX, Dialog } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { orderHref } from '../../shell/routes';
import type { DraftStore, OrderType } from '../contracts';
import type { Cart } from '../order-screen/cart';
import { useDrafts } from '../order-screen/OrderScreen';
import { ParkingSheet } from './ParkingSheet';
import { TakeawaySheet } from './TakeawaySheet';

// 02-S04 New order (02b §8 Types): Takeaway or Parking — dine-in starts from a table on the map (the sheet says so).
// After the details, a new device draft holds them (its id is the new order's) and the order screen opens on it.

/** Writes the new order's draft (empty cart with its details) and returns its route. */
export async function startOrder(o: { drafts: DraftStore; device_id: string; staff_id: string; order_type: Exclude<OrderType, 'dine_in'>; details: Pick<Cart, 'takeaway' | 'parking'>; nowMs: number; newId?: () => string }): Promise<string> {
  const draft_id = (o.newId ?? newUlid)();
  const cart: Cart = { lines: [], ...o.details };
  await o.drafts.put({ draft_id, device_id: o.device_id, staff_id: o.staff_id, order_type: o.order_type, cart, updated_at: o.nowMs, held: false }).catch(() => undefined);
  return orderHref(o.order_type, draft_id);
}

export function NewOrderSheet({ onClose, initial = null }: { onClose(): void; initial?: Exclude<OrderType, 'dine_in'> | null }) {
  const shell = useShell();
  const drafts = useDrafts();
  const [step, setStep] = useState<'choose' | 'takeaway' | 'parking'>(initial ?? 'choose');
  const sheet = shell.phone || shell.portrait;
  const go = async (order_type: Exclude<OrderType, 'dine_in'>, details: Pick<Cart, 'takeaway' | 'parking'>) => {
    if (shell.me === null) return;
    const href = await startOrder({ drafts, device_id: shell.device.id, staff_id: shell.me.staff_id, order_type, details, nowMs: Math.floor(shell.clock.nowMs()) });
    onClose();
    navigate(href);
  };
  if (step === 'takeaway') return <TakeawaySheet sheet={sheet} onClose={onClose} onNext={(takeaway) => void go('takeaway', Object.keys(takeaway).length === 0 ? {} : { takeaway })} />;
  if (step === 'parking') return <ParkingSheet sheet={sheet} onClose={onClose} onNext={(parking) => void go('parking', { parking })} />;
  return (
    <Dialog sheet={sheet} labelledBy="new-t" onClose={onClose}>
      <div className="dlg__h">
        <div className="dlg__t">
          <h2 id="new-t">{t('order.new')}</h2>
          <div className="ac__who">{t('order.dinein_hint')}</div>
        </div>
        <CloseX onClose={onClose} />
      </div>
      <div className="bchips">
        <button type="button" className="bchip" onClick={() => setStep('takeaway')}>
          {t('order.takeaway')}
        </button>
        <button type="button" className="bchip" onClick={() => setStep('parking')}>
          {t('order.parking')}
        </button>
      </div>
      <div className="acts acts--1">
        <button type="button" className="btn" onClick={onClose}>
          {t('note.cancel')}
        </button>
      </div>
    </Dialog>
  );
}
