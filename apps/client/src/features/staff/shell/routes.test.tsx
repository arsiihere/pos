import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
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
import { createLiveBus } from './live';
import { matchStaffRoute, orderHref, tableHref } from './routes';
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
    expect(table.route).toEqual({ name: 'table', table_id: 'TB 4', seating_id: 'S1' });
    expect(table.mounts).toEqual([TableMap, TableSheet]);
    expect(slot('/tables/TB4').route).toEqual({ name: 'table', table_id: 'TB4', seating_id: null });
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
    expect(matchStaffRoute('/', 'tablet')).toEqual({ name: 'inbox' });
    expect(matchStaffRoute('/requests', 'tablet')).toEqual({ name: 'requests' });
    expect(matchStaffRoute('/receipts/A%201', 'tablet')).toEqual({ name: 'receipts', alert_id: 'A 1' });
    expect(matchStaffRoute('/order/delivery/X', 'tablet')).toEqual({ name: 'inbox' });
    expect(matchStaffRoute('/nope', 'phone')).toEqual({ name: 'inbox' });
  });

  // lane note #150-3: the Enqueue stub left with 25b (the real queue) and the useTableLock stub with 02a 22a; the shell hooks stay
  it('[02 W0.6] shell hooks with an empty queue wait for nothing', async () => {
    const enqueue = createEnqueue({ api: {} as never, device: { token: 'T', id: 'D1', type: 'tablet' }, clock: () => ({}) as never, live: createLiveBus() });
    const hooks = createShellHooks(enqueue);
    await expect(hooks.beforeSignIn()).resolves.toBeUndefined();
    expect(hooks.queueLine()).toBeNull();
  });
});
