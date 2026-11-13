import { useEffect, useRef, useSyncExternalStore } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';

// 02a §8 Offline, 02b §8 Queue (02-B02 TableMapOffline, OrderOffline; 02a-T01 Toasts): while the hub socket is
// down, the map keeps its last known tables under "Reconnecting… n waiting to send" (n = Enqueue.pendingCount(),
// the one queue, Q-3); the order screens show the same bar as "n orders waiting to send" with "Send still works
// — it waits here". The map's bar says "Back online" once when the socket is up again.

export interface OfflineBarProps {
  variant: 'tables' | 'order';
}

export const OfflineBar = ({ variant }: OfflineBarProps) => {
  const shell = useShell();
  const n = useSyncExternalStore(shell.enqueue.subscribe, () => shell.enqueue.pendingCount());
  const wasOffline = useRef(!shell.online);
  const online = shell.online;
  const toasts = shell.toasts;
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current && variant === 'tables') toasts.show({ text: t('tables.toast.back_online'), tone: 'ok' });
    wasOffline.current = false;
  }, [online, variant, toasts]);

  if (online) return null;
  const text =
    variant === 'tables'
      ? n > 0
        ? fill(t('offline.bar_queue'), { n: String(n) })
        : t('offline.bar')
      : n > 1
        ? fill(t('offline.bar_orders'), { n: String(n) })
        : n === 1
          ? t('offline.bar_orders_one')
          : t('offline.bar_reconnecting');
  return (
    <div className="warnbar" role="status">
      <Ico name="wifioff" />
      {text}
      <small>{t(variant === 'tables' ? 'offline.bar_hint' : 'offline.bar_order_hint')}</small>
    </div>
  );
};
