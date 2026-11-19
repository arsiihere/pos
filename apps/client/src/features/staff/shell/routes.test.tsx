import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Held } from '../orders/order-screen/Held';
import { OrderScreen } from '../orders/order-screen/OrderScreen';
import { KioskHome } from '../orders/lists/KioskHome';
import { OpenOrders } from '../orders/lists/OpenOrders';
import { createEnqueue } from '../orders/queue/enqueue';
import { createShellHooks } from '../orders/queue/shell-hooks';
import { QueueLog } from '../orders/queue/QueueLog';
import { OrderView } from '../orders/view/OrderView';
import { ZoneStock } from '../orders/zones/ZoneStock';
import { TableMap } from '../tables/map/TableMap';
import { TableSheet } from '../tables/sheet/TableSheet';
import { PassScreen } from '../../pass/PassScreen';
import { createLiveBus } from './live';
import { phoneTabOf } from '../StaffApp';
import {
  consumeFocus,
  inboxHref,
  matchStaffRoute,
  orderHref,
  orderViewHref,
  passHref,
  routePath,
  withoutFocus,
  tableHref,
  zonesHref,
} from './routes';
import { isSlotRoute, slotContent } from './slots';

// 02a §8, 02b §8 (W0.6): the staff hash routes and the lane slot each one mounts.

function types(node: ReactNode): unknown[] {
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === 'symbol') return ([] as ReactNode[]).concat(el.props.children ?? []).flatMap(types); // a fragment
  return [el.type];
}

function slot(hash: string, deviceType: 'tablet' | 'cashier_kiosk' | 'phone' = 'tablet') {
  const route = matchStaffRoute(hash, deviceType);
  if (!isSlotRoute(route)) throw new Error(`${hash} is not a slot route`);
  return { route, mounts: types(slotContent(route)), element: slotContent(route) as ReactElement<Record<string, unknown>> };
}

describe('[02 W0.6] staff routes', () => {
  it('[02 W0.6] #/tables, #/tables/:id, #/order/:type/:id, #/orders, #/orders/:id, #/held, #/zones, #/queue, #/me each render their slot; kiosk #/ = KioskHome', () => {
    expect(slot('/tables').mounts).toEqual([TableMap]);
    const table = slot(tableHref('TB 4', 'S1'));
    expect(table.route).toEqual({ name: 'table', table_id: 'TB 4', seating_id: 'S1', focus: null });
    expect(table.mounts).toEqual([TableMap, TableSheet]);
    expect(slot('/tables/TB4').route).toEqual({ name: 'table', table_id: 'TB4', seating_id: null, focus: null });
    const order = slot(orderHref('dine_in', 'S1'));
    expect(order.route).toEqual({ name: 'order', order_type: 'dine_in', id: 'S1' });
    expect(order.mounts).toEqual([OrderScreen]);
    expect(order.element.props).toEqual({ order_type: 'dine_in', id: 'S1' });
    expect(slot('/order/takeaway/D1').route).toEqual({ name: 'order', order_type: 'takeaway', id: 'D1' });
    expect(slot('/order/parking/D2').mounts).toEqual([OrderScreen]);
    expect(slot('/orders').mounts).toEqual([OpenOrders]);
    const view = slot('/orders/O1');
    expect(view.mounts).toEqual([OrderView]);
    expect(view.element.props).toEqual({ order_id: 'O1' });
    expect(slot('/held').mounts).toEqual([Held]);
    expect(slot('/zones').mounts).toEqual([ZoneStock]);
    expect(slot('/queue').mounts).toEqual([QueueLog]);
    expect(slot('/me').route).toEqual({ name: 'me' });
    expect(slot('/', 'cashier_kiosk').mounts).toEqual([KioskHome]);
    // the 01d views keep their routes; anything unknown is the inbox (a tablet's #/ too)
    expect(matchStaffRoute('/', 'tablet')).toEqual({ name: 'inbox', focus: null });
    expect(matchStaffRoute('/requests', 'tablet')).toEqual({ name: 'requests' });
    expect(matchStaffRoute('/receipts/A%201', 'tablet')).toEqual({ name: 'receipts', alert_id: 'A 1' });
    expect(matchStaffRoute('/order/delivery/X', 'tablet')).toEqual({ name: 'inbox', focus: null });
    expect(matchStaffRoute('/nope', 'phone')).toEqual({ name: 'inbox', focus: null });
  });

  // lane note #150-3: the Enqueue stub left with 25b (the real queue) and the useTableLock stub with 02a 22a; the shell hooks stay
  it('[02 W0.6] shell hooks with an empty queue wait for nothing', async () => {
    const enqueue = createEnqueue({ api: {} as never, device: { token: 'T', id: 'D1', type: 'tablet' }, clock: () => ({}) as never, live: createLiveBus() });
    const hooks = createShellHooks(enqueue);
    await expect(hooks.beforeSignIn()).resolves.toBeUndefined();
    expect(hooks.queueLine()).toBeNull();
  });
});

describe('[03b W0.6] the Pass route', () => {
  it('[03b §8 Pass screen; Q-58] #/pass mounts the Pass screen on every staff device', () => {
    for (const d of ['tablet', 'cashier_kiosk', 'phone'] as const) {
      const s = slot('/pass', d);
      expect(s.route).toEqual({ name: 'pass', focus: null });
      expect(s.mounts).toEqual([PassScreen]);
    }
  });
});

describe('[01d v1.3 §3.13.5] the `focus` parameter', () => {
  afterEach(() => window.history.replaceState(null, '', '#/'));

  it('[01d §3.13.5] parse table: each place takes its own focus forms; others, unknown and malformed are ignored', () => {
    const tab = (hash: string) => matchStaffRoute(hash, 'tablet');
    expect(tab('/tables/T5?seating_id=S5&focus=table')).toEqual({ name: 'table', table_id: 'T5', seating_id: 'S5', focus: { kind: 'table' } });
    expect(tab('/tables/T5?seating_id=S5&focus=order:O1')).toMatchObject({ focus: { kind: 'order', order_id: 'O1' } });
    expect(tab('/tables/T5?seating_id=S5&focus=line:L1')).toMatchObject({ focus: { kind: 'line', order_item_id: 'L1' } });
    expect(tab('/tables/T5?seating_id=S5&focus=late:A1')).toMatchObject({ focus: { kind: 'late', alert_id: 'A1' } });
    expect(tab('/orders/O1?focus=order:O1')).toEqual({ name: 'order_view', order_id: 'O1', focus: { kind: 'order', order_id: 'O1' } });
    expect(tab('/orders/O1?focus=line:L1')).toMatchObject({ focus: { kind: 'line', order_item_id: 'L1' } });
    expect(tab('/zones?focus=item:Z1:I1')).toEqual({ name: 'zones', focus: { kind: 'item', zone_id: 'Z1', item_id: 'I1' } });
    expect(tab('/pass?focus=order:O1')).toEqual({ name: 'pass', focus: { kind: 'order', order_id: 'O1' } });
    expect(tab('/inbox?focus=alert:A1')).toEqual({ name: 'inbox', focus: { kind: 'alert', alert_id: 'A1' } });
    // a form that is not valid on that place, an unknown kind, an empty id, a missing part
    for (const bad of [
      '/zones?focus=order:O1',
      '/pass?focus=table',
      '/inbox?focus=order:O1',
      '/orders/O1?focus=late:A1',
      '/orders/O1?focus=table',
      '/tables/T5?focus=item:Z1:I1',
      '/tables/T5?focus=station:K1',
      '/tables/T5?focus=order:',
      '/zones?focus=item:Z1',
      '/zones?focus=item::I1',
      '/inbox?focus=',
      '/inbox?focus=alert',
    ]) {
      expect(tab(bad), bad).toMatchObject({ focus: null });
    }
    // the route itself still matches with a bad focus
    expect(tab('/tables/T5?seating_id=S5&focus=nope')).toEqual({ name: 'table', table_id: 'T5', seating_id: 'S5', focus: null });
  });

  it('[01d §3.13.5] href helpers build the §3.13.5 hashes, and they parse back', () => {
    expect(tableHref('T5', 'S5', { kind: 'table' })).toBe('/tables/T5?seating_id=S5&focus=table');
    expect(tableHref('T5', 'S5', { kind: 'line', order_item_id: 'L1' })).toBe('/tables/T5?seating_id=S5&focus=line%3AL1');
    expect(tableHref('T5', 'S5')).toBe('/tables/T5?seating_id=S5'); // today's tableHref, unchanged
    expect(tableHref('T5', null)).toBe('/tables/T5');
    expect(orderViewHref('O1')).toBe('/orders/O1');
    expect(zonesHref()).toBe('/zones');
    expect(passHref()).toBe('/pass');
    expect(inboxHref()).toBe('/inbox');
    const cases = [
      [tableHref('T 5', 'S5', { kind: 'late', alert_id: 'A1' }), { name: 'table', table_id: 'T 5', seating_id: 'S5', focus: { kind: 'late', alert_id: 'A1' } }],
      [orderViewHref('O1', { kind: 'line', order_item_id: 'L1' }), { name: 'order_view', order_id: 'O1', focus: { kind: 'line', order_item_id: 'L1' } }],
      [zonesHref({ kind: 'item', zone_id: 'Z1', item_id: 'I1' }), { name: 'zones', focus: { kind: 'item', zone_id: 'Z1', item_id: 'I1' } }],
      [passHref({ kind: 'order', order_id: 'O1' }), { name: 'pass', focus: { kind: 'order', order_id: 'O1' } }],
      [inboxHref({ kind: 'alert', alert_id: 'A1' }), { name: 'inbox', focus: { kind: 'alert', alert_id: 'A1' } }],
    ] as const;
    for (const [href, route] of cases) expect(matchStaffRoute(href, 'tablet'), href).toEqual(route);
  });

  it('[01d #94] focus on #/audit, #/requests, #/test-alert, #/receipts/<id> is ignored and those routes still match', () => {
    expect(matchStaffRoute('/requests?focus=alert:A1', 'tablet')).toEqual({ name: 'requests' });
    expect(matchStaffRoute('/test-alert?focus=table', 'tablet')).toEqual({ name: 'test_alert' });
    expect(matchStaffRoute('/receipts/A1?focus=alert:A1', 'tablet')).toEqual({ name: 'receipts', alert_id: 'A1' });
    // the shell's raw route checks compare the path only (StaffApp: #/audit, #/requests, #/test-alert, #/receipts/<id>)
    expect(routePath('/audit?focus=table')).toBe('/audit');
    expect(routePath('/requests?focus=alert:A1')).toBe('/requests');
    expect(routePath('/test-alert?focus=x')).toBe('/test-alert');
    expect(routePath('/receipts/A1?focus=alert:A1')).toBe('/receipts/A1');
    expect(routePath('/audit')).toBe('/audit');
  });

  it('[01d §3.13.2 rule 6] withoutFocus: the hash as consumeFocus leaves it', () => {
    expect(withoutFocus('/tables/T5?seating_id=S5&focus=line%3AL1')).toBe('/tables/T5?seating_id=S5');
    expect(withoutFocus('/zones?focus=item%3AZ1%3AI1')).toBe('/zones');
    expect(withoutFocus('/inbox')).toBe('/inbox');
  });

  it('[01d §3.13.5] consumeFocus drops focus with replaceState: no new history entry, other parameters kept', () => {
    window.history.replaceState(null, '', '#/tables/T5?seating_id=S5&focus=line%3AL1');
    const length = window.history.length;
    let hashChanges = 0;
    const onHash = () => (hashChanges += 1);
    window.addEventListener('hashchange', onHash);
    consumeFocus();
    window.removeEventListener('hashchange', onHash);
    expect(window.location.hash).toBe('#/tables/T5?seating_id=S5');
    expect(window.history.length).toBe(length);
    expect(hashChanges).toBe(0);
    window.history.replaceState(null, '', '#/zones?focus=item%3AZ1%3AI1');
    consumeFocus();
    expect(window.location.hash).toBe('#/zones');
    // nothing to consume: the hash is left as it is
    window.history.replaceState(null, '', '#/inbox');
    consumeFocus();
    expect(window.location.hash).toBe('#/inbox');
  });

  it('[01d #92] phone tabs: #/zones?focus=… and #/orders/<id>?focus=… mark Orders; a dine-in line or slip marks Tables; #/inbox Inbox', () => {
    const tab = (hash: string) => phoneTabOf(matchStaffRoute(hash, 'phone'));
    expect(tab(zonesHref({ kind: 'item', zone_id: 'Z1', item_id: 'I1' }))).toBe('orders');
    expect(tab(orderViewHref('O1', { kind: 'order', order_id: 'O1' }))).toBe('orders');
    expect(tab(orderViewHref('O1', { kind: 'line', order_item_id: 'L1' }))).toBe('orders');
    expect(tab(tableHref('T5', 'S5', { kind: 'line', order_item_id: 'L1' }))).toBe('tables');
    expect(tab(tableHref('T5', 'S5', { kind: 'late', alert_id: 'A1' }))).toBe('tables');
    expect(tab(tableHref('T5', 'S5', { kind: 'order', order_id: 'O1' }))).toBe('tables');
    expect(tab(tableHref('T5', 'S5', { kind: 'table' }))).toBe('tables');
    expect(tab(inboxHref({ kind: 'alert', alert_id: 'A1' }))).toBe('inbox');
  });
});
