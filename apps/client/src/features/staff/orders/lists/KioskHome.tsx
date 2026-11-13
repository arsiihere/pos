import { useContext, useEffect, useState } from 'react';
import { navigate } from '../../../../app/router';
import { newUlid } from '../../../../app/ulid';
import { t } from '../../../../i18n';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { orderHref } from '../../shell/routes';
import type { DraftStore } from '../contracts';
import { createIdbDraftStore } from '../drafts/idb-drafts';
import { DraftStoreContext } from '../order-screen/OrderScreen';
import { OpenOrdersCard, useLiveRefetch } from './OpenOrders';

// 02b v1.0.11 §8 Open orders (frame 02-S07 OpenOrdersKiosk): the cashier kiosk's home (#/) = the open orders list
// with Takeaway / Parking (two big new-order buttons), Tables and Held (with its count). The new-order buttons open
// the order screen on a fresh draft id; its contact step (26d) asks for the name / plate.

let deviceDrafts: DraftStore | null = null;
function idbDrafts(): DraftStore {
  deviceDrafts ??= createIdbDraftStore();
  return deviceDrafts;
}

const NO_FRAMES: ReadonlySet<string> = new Set();

export function KioskHome() {
  const shell = useShell();
  const drafts = useContext(DraftStoreContext) ?? idbDrafts();
  const [held, setHeld] = useState(0);
  const staffId = shell.me?.staff_id ?? null;
  const deviceId = shell.device.id;
  const [tick, setTick] = useState(0);
  // the count follows this person's held drafts on this screen; re-read on a reconnect / the page returning
  useLiveRefetch(shell.live, () => setTick((n) => n + 1), NO_FRAMES);
  useEffect(() => {
    if (staffId === null) return;
    let live = true;
    void drafts
      .list(deviceId, staffId)
      .then((all) => live && setHeld(all.filter((d) => d.held).length))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [drafts, deviceId, staffId, tick]);

  return (
    <main className="map">
      <OpenOrdersCard />
      <aside className="side2">
        {shell.permissions.allowed('take-order') && (
          <div className="card col">
            <b>{t('order.new')}</b>
            <div className="bchips">
              <button type="button" className="bchip" onClick={() => navigate(orderHref('takeaway', newUlid()))}>
                <Ico name="tray" />
                {t('order.takeaway')}
              </button>
              <button type="button" className="bchip" onClick={() => navigate(orderHref('parking', newUlid()))}>
                <Ico name="pin" />
                {t('order.parking')}
              </button>
            </div>
          </div>
        )}
        <button type="button" className="btn btn--lg" onClick={() => navigate('/tables')}>
          <Ico name="team" />
          {t('kiosk.tables')}
        </button>
        <button type="button" className="btn btn--lg" onClick={() => navigate('/held')}>
          <Ico name="clock" />
          {t('kiosk.held')}
          {held > 0 && <span className="cnt num">{held}</span>}
        </button>
      </aside>
    </main>
  );
}
