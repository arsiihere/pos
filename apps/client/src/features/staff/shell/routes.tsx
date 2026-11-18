import type { DeviceType } from '@pos/domain';
import type { OrderType } from '../orders/contracts';

// 02a §8, 02b §8 (W0.6): the staff entry's hash routes (S35 b, app/router.ts). The 01d views keep theirs
// (#/inbox, #/requests, #/test-alert, #/receipts/<id>); anything unknown falls back to the inbox. The cashier
// kiosk's home `#/` is KioskHome (02b §8 Open orders).

// 01d v1.3 §3.13.5: the element a deep link glows, from the one optional `focus` parameter. Valid only on the
// table, order view, zones, pass and inbox routes (m11), and only in the forms of that place; anything else is
// ignored (null). Consumed once (`consumeFocus`).
export type StaffFocus =
  | { kind: 'table' }
  | { kind: 'order'; order_id: string }
  | { kind: 'line'; order_item_id: string }
  | { kind: 'late'; alert_id: string }
  | { kind: 'item'; zone_id: string; item_id: string }
  | { kind: 'alert'; alert_id: string };
type FocusKind = StaffFocus['kind'];

export type StaffRoute =
  | { name: 'tables' }
  | { name: 'table'; table_id: string; seating_id: string | null; focus: StaffFocus | null }
  | { name: 'order'; order_type: OrderType; id: string }
  | { name: 'orders' }
  | { name: 'order_view'; order_id: string; focus: StaffFocus | null }
  | { name: 'held' }
  | { name: 'zones'; focus: StaffFocus | null }
  | { name: 'queue' }
  | { name: 'me' }
  | { name: 'kiosk_home' }
  | { name: 'pass'; focus: StaffFocus | null } // 03b W0.6: the Pass screen (a device with a point)
  | { name: 'inbox'; focus: StaffFocus | null }
  | { name: 'requests' }
  | { name: 'test_alert' }
  | { name: 'receipts'; alert_id: string };

const FIXED: Record<string, StaffRoute> = {
  '/tables': { name: 'tables' },
  '/orders': { name: 'orders' },
  '/held': { name: 'held' },
  '/queue': { name: 'queue' },
  '/me': { name: 'me' },
  '/requests': { name: 'requests' },
  '/test-alert': { name: 'test_alert' },
};

/** §3.13.5: the focus forms each place takes. */
const FOCUS_ON = {
  table: ['table', 'order', 'line', 'late'],
  order_view: ['order', 'line'],
  zones: ['item'],
  pass: ['order'],
  inbox: ['alert'],
} as const satisfies Record<string, readonly FocusKind[]>;

function parseFocus(search: string, allowed: readonly FocusKind[]): StaffFocus | null {
  const raw = new URLSearchParams(search).get('focus');
  if (raw === null) return null;
  const [kind = '', ...rest] = raw.split(':');
  if (!(allowed as readonly string[]).includes(kind)) return null;
  const ok = (parts: readonly string[], n: number) => parts.length === n && parts.every((p) => p !== '');
  switch (kind as FocusKind) {
    case 'table':
      return rest.length === 0 ? { kind: 'table' } : null;
    case 'order':
      return ok(rest, 1) ? { kind: 'order', order_id: rest[0]! } : null;
    case 'line':
      return ok(rest, 1) ? { kind: 'line', order_item_id: rest[0]! } : null;
    case 'late':
      return ok(rest, 1) ? { kind: 'late', alert_id: rest[0]! } : null;
    case 'alert':
      return ok(rest, 1) ? { kind: 'alert', alert_id: rest[0]! } : null;
    case 'item':
      return ok(rest, 2) ? { kind: 'item', zone_id: rest[0]!, item_id: rest[1]! } : null;
  }
}

function focusValue(focus: StaffFocus): string {
  switch (focus.kind) {
    case 'table':
      return 'table';
    case 'order':
      return `order:${focus.order_id}`;
    case 'line':
      return `line:${focus.order_item_id}`;
    case 'late':
    case 'alert':
      return `${focus.kind}:${focus.alert_id}`;
    case 'item':
      return `item:${focus.zone_id}:${focus.item_id}`;
  }
}

function withQuery(base: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) q.set(k, v);
  const s = q.toString();
  return s === '' ? base : `${base}?${s}`;
}

const focusOf = (focus: StaffFocus | undefined) => (focus === undefined ? null : focusValue(focus));

const ORDER_TYPES: readonly OrderType[] = ['dine_in', 'takeaway', 'parking'];

const id = (s: string) => decodeURIComponent(s);

/** `#/tables/<table_id>?seating_id=<id>`: the tile's seating travels with the tap (every action sends it).
 *  01d v1.3 §3.13.5: `&focus=…` names the element a deep link glows. */
export function tableHref(table_id: string, seating_id: string | null, focus?: StaffFocus): string {
  return withQuery(`/tables/${encodeURIComponent(table_id)}`, { seating_id, focus: focusOf(focus) });
}

/** 01d v1.3 §3.13.5: `#/orders/<order_id>` (02b OrderView) with an optional focus. */
export function orderViewHref(order_id: string, focus?: StaffFocus): string {
  return withQuery(`/orders/${encodeURIComponent(order_id)}`, { focus: focusOf(focus) });
}

export function zonesHref(focus?: StaffFocus): string {
  return withQuery('/zones', { focus: focusOf(focus) });
}

export function passHref(focus?: StaffFocus): string {
  return withQuery('/pass', { focus: focusOf(focus) });
}

export function inboxHref(focus?: StaffFocus): string {
  return withQuery('/inbox', { focus: focusOf(focus) });
}

/** The route without its query: the shell's raw checks (#/audit, #/requests, #/test-alert, #/receipts/<id>) never
 *  take a `focus`, and a stray one must not stop them matching (§3.13.5, m11). */
export function routePath(hash: string): string {
  return hash.split('?')[0] ?? hash;
}

/** §3.13.5: `focus` is consumed once: the hash is replaced without it (no history entry, no hashchange). */
export function consumeFocus(): void {
  const hash = window.location.hash.replace(/^#/, '');
  const [path = '/', search = ''] = hash.split('?');
  const params = new URLSearchParams(search);
  if (!params.has('focus')) return;
  params.delete('focus');
  const rest = params.toString();
  window.history.replaceState(window.history.state, '', `#${path}${rest === '' ? '' : `?${rest}`}`);
}

export function orderHref(order_type: OrderType, id: string): string {
  return `/order/${order_type}/${encodeURIComponent(id)}`;
}

export function matchStaffRoute(hash: string, deviceType: DeviceType): StaffRoute {
  const [path = '/', search = ''] = hash.split('?');
  if (path === '/' || path === '') return deviceType === 'cashier_kiosk' ? { name: 'kiosk_home' } : { name: 'inbox', focus: null };
  const fixed = FIXED[path];
  if (fixed !== undefined) return fixed;
  if (path === '/zones') return { name: 'zones', focus: parseFocus(search, FOCUS_ON.zones) };
  if (path === '/pass') return { name: 'pass', focus: parseFocus(search, FOCUS_ON.pass) };
  if (path === '/inbox') return { name: 'inbox', focus: parseFocus(search, FOCUS_ON.inbox) };
  const table = /^\/tables\/([^/]+)$/.exec(path);
  if (table !== null) {
    return { name: 'table', table_id: id(table[1]!), seating_id: new URLSearchParams(search).get('seating_id'), focus: parseFocus(search, FOCUS_ON.table) };
  }
  const order = /^\/order\/([a-z_]+)\/([^/]+)$/.exec(path);
  if (order !== null && (ORDER_TYPES as readonly string[]).includes(order[1]!)) return { name: 'order', order_type: order[1] as OrderType, id: id(order[2]!) };
  const view = /^\/orders\/([^/]+)$/.exec(path);
  if (view !== null) return { name: 'order_view', order_id: id(view[1]!), focus: parseFocus(search, FOCUS_ON.order_view) };
  const receipts = /^\/receipts\/([^/]+)$/.exec(path);
  if (receipts !== null) return { name: 'receipts', alert_id: id(receipts[1]!) };
  return { name: 'inbox', focus: null };
}
