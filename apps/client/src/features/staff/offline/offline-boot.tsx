import { useEffect, useState } from 'react';
import type { DeviceType } from '@pos/domain';
import { language, t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { Ico, initial } from '../../alerts/ui';
import type { QueueStore } from '../orders/contracts';
import { keptAtLoad } from '../orders/queue/queue';

// ⚠️ 02b v1.0.32 QO-2 (owner ruling R3-1 of 2026-11-28 QA-R3, BUG-3); 00 HPA v1.15 §8.2 SW-1.
// - The cashier kiosk's /staff/ service worker (staff/public/sw.js) answers a navigation the hub does not answer with
//   the cached index of its build, marked `<meta name="pos-offline-boot" content="1">`. That page shows its own
//   screen: "Can't reach the hub — N orders are safe on this device and will send when it's back", the Offline pill,
//   no sign-in (it waits for the hub). It asks `/health` every few seconds; when the hub answers it reloads, so the
//   app boots from the hub (fresh page meta, the queue keeps its orders queued, QO-1) and the sign-in opens.
// - Only a paired `cashier_kiosk` registers the worker (README R15: its Chrome / Edge is launched with
//   --unsafely-treat-insecure-origin-as-secure); any other device drops a /staff/ worker it had and registers none.

export const SW_URL = '/staff/sw.js';
export const SW_SCOPE = '/staff/';
const PROBE_MS = 3000;

export function isOfflineBoot(doc: Document = document): boolean {
  return doc.querySelector('meta[name="pos-offline-boot"]') !== null;
}

/** Register (kiosk) or drop (every other device, or unpaired) the /staff/ worker; never throws. */
export async function registerStaffWorker(type: DeviceType | string | null, nav: Navigator = navigator): Promise<void> {
  const sw = (nav as { serviceWorker?: ServiceWorkerContainer }).serviceWorker;
  if (sw === undefined) return; // not a secure context (a phone, a tablet WebView): no worker at all
  try {
    if (type === 'cashier_kiosk') {
      await sw.register(SW_URL, { scope: SW_SCOPE });
      return;
    }
    for (const r of await sw.getRegistrations()) if (new URL(r.scope).pathname === SW_SCOPE) await r.unregister();
  } catch {
    // a worker that cannot register leaves the page as it was: online it works, offline the browser's error page
  }
}

/** The hub answers (any HTTP answer; a network error or abort = not). */
export async function hubAnswers(): Promise<boolean> {
  try {
    const res = await fetch('/health', { cache: 'no-store' });
    return res.status > 0;
  } catch {
    return false;
  }
}

export interface OfflineBootProps {
  branchName: string;
  store: QueueStore;
  probe?: () => Promise<boolean>;
  reload?: () => void;
  everyMs?: number;
}

export function OfflineBoot({ branchName, store, probe = hubAnswers, reload = () => window.location.reload(), everyMs = PROBE_MS }: OfflineBootProps) {
  const [orders, setOrders] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    store
      .list()
      .then((all) => live && setOrders(all.filter(keptAtLoad).length))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [store]);
  useEffect(() => {
    let done = false;
    const timer = setInterval(() => {
      void probe().then((up) => {
        if (!up || done) return;
        done = true;
        clearInterval(timer);
        reload();
      });
    }, everyMs);
    return () => {
      done = true;
      clearInterval(timer);
    };
  }, [probe, reload, everyMs]);
  const lang = language();
  const line = orders === null ? null : orders === 0 ? t('offline_boot.none') : orders === 1 ? t('offline_boot.orders_one') : fill(t('offline_boot.orders'), { n: String(orders) });
  return (
    <div className="pu v-brand staff" lang={lang} dir={lang === 'ur' ? 'rtl' : 'ltr'} data-theme="light">
      <header className="top">
        {branchName !== '' && (
          <div className="brand">
            <div className="mark" aria-hidden="true">
              {initial(branchName)}
            </div>
            <div>
              <b>{branchName}</b>
            </div>
          </div>
        )}
        <span className="live live--off tk-live--off">
          <Ico name="wifioff" />
          {t('alerts.hub_offline')}
        </span>
      </header>
      <main className="body">
        <section className="card empty" aria-labelledby="offline-boot-title" role="status">
          <Ico name="wifioff" className="ico--36" />
          <b id="offline-boot-title">{t('offline_boot.title')}</b>
          {line !== null && <p>{line}</p>}
          <p className="muted">{t('offline_boot.signin')}</p>
        </section>
      </main>
    </div>
  );
}
