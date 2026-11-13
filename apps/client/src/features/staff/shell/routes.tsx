import type { DeviceType } from '@pos/domain';
import type { OrderType } from '../orders/contracts';

// 02a §8, 02b §8 (W0.6): the staff entry's hash routes (S35 b, app/router.ts). The 01d views keep theirs
// (#/inbox, #/requests, #/test-alert, #/receipts/<id>); anything unknown falls back to the inbox. The cashier
// kiosk's home `#/` is KioskHome (02b §8 Open orders).

export type StaffRoute =
  | { name: 'tables' }
  | { name: 'table'; table_id: string; seating_id: string | null }
  | { name: 'order'; order_type: OrderType; id: string }
  | { name: 'orders' }
  | { name: 'order_view'; order_id: string }
  | { name: 'held' }
  | { name: 'zones' }
  | { name: 'queue' }
  | { name: 'me' }
  | { name: 'kiosk_home' }
  | { name: 'pass' } // 03b W0.6: the Pass screen (a device with a point)
  | { name: 'inbox' }
  | { name: 'requests' }
  | { name: 'test_alert' }
  | { name: 'receipts'; alert_id: string };

const FIXED: Record<string, StaffRoute> = {
  '/tables': { name: 'tables' },
  '/orders': { name: 'orders' },
  '/held': { name: 'held' },
  '/zones': { name: 'zones' },
  '/queue': { name: 'queue' },
  '/me': { name: 'me' },
  '/pass': { name: 'pass' },
  '/inbox': { name: 'inbox' },
  '/requests': { name: 'requests' },
  '/test-alert': { name: 'test_alert' },
};

const ORDER_TYPES: readonly OrderType[] = ['dine_in', 'takeaway', 'parking'];

const id = (s: string) => decodeURIComponent(s);

/** `#/tables/<table_id>?seating_id=<id>`: the tile's seating travels with the tap (every action sends it). */
export function tableHref(table_id: string, seating_id: string | null): string {
  const base = `/tables/${encodeURIComponent(table_id)}`;
  return seating_id === null ? base : `${base}?seating_id=${encodeURIComponent(seating_id)}`;
}

export function orderHref(order_type: OrderType, id: string): string {
  return `/order/${order_type}/${encodeURIComponent(id)}`;
}

export function matchStaffRoute(hash: string, deviceType: DeviceType): StaffRoute {
  const [path = '/', search = ''] = hash.split('?');
  if (path === '/' || path === '') return deviceType === 'cashier_kiosk' ? { name: 'kiosk_home' } : { name: 'inbox' };
  const fixed = FIXED[path];
  if (fixed !== undefined) return fixed;
  const table = /^\/tables\/([^/]+)$/.exec(path);
  if (table !== null) return { name: 'table', table_id: id(table[1]!), seating_id: new URLSearchParams(search).get('seating_id') };
  const order = /^\/order\/([a-z_]+)\/([^/]+)$/.exec(path);
  if (order !== null && (ORDER_TYPES as readonly string[]).includes(order[1]!)) return { name: 'order', order_type: order[1] as OrderType, id: id(order[2]!) };
  const view = /^\/orders\/([^/]+)$/.exec(path);
  if (view !== null) return { name: 'order_view', order_id: id(view[1]!) };
  const receipts = /^\/receipts\/([^/]+)$/.exec(path);
  if (receipts !== null) return { name: 'receipts', alert_id: id(receipts[1]!) };
  return { name: 'inbox' };
}
