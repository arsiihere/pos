import { useEffect, useState } from 'react';
import { t } from '../../../../i18n';
import { useShell } from '../../shell/hooks';
import { OrderScreen, useDrafts } from '../order-screen/OrderScreen';
import { currentTakeawayDraft } from './current-draft';

// 02b v1.0.24 §8; 02b-TK C2-1; CHANGES §1 (frames HomeKiosk, HomeTablet, PhoneMenu / PhoneCart / PhoneQueue): the
// Takeaway tab (`#/takeaway`) IS the order screen in takeaway mode — queue rail + menu + cart on the kiosk, the ready
// strip with the queue as a drawer on a tablet, Menu / Cart / Queue tabs on a phone (OrderScreen lays them out). It
// opens on the device's current unsent takeaway draft (current-draft.ts); the open-orders list is the rail's
// "All orders" (#/orders).

export function TakeawayHome() {
  const shell = useShell();
  const drafts = useDrafts();
  const deviceId = shell.device.id;
  const staffId = shell.me?.staff_id ?? null;
  const [found, setFound] = useState<{ who: string; id: string } | null>(null);
  const who = `${deviceId}:${staffId ?? ''}`;
  useEffect(() => {
    let live = true;
    void currentTakeawayDraft(drafts, deviceId, staffId).then((id) => live && setFound({ who, id }));
    return () => {
      live = false;
    };
  }, [drafts, deviceId, staffId, who]);
  if (found === null || found.who !== who) return (
      <div className="osc">
        <div className="empty">{t('common.loading')}</div>
      </div>
    );
  return <OrderScreen key={found.id} order_type="takeaway" id={found.id} home />;
}
