import type { ReactNode } from 'react';
import type { AlertRow } from '../../alerts/store';
import { Held } from '../orders/order-screen/Held';
import { OrderScreen } from '../orders/order-screen/OrderScreen';
import { KioskHome } from '../orders/lists/KioskHome';
import { OpenOrders } from '../orders/lists/OpenOrders';
import { QueueLog } from '../orders/queue/QueueLog';
import { OrderView } from '../orders/view/OrderView';
import { ZoneStock } from '../orders/zones/ZoneStock';
import { TableMap } from '../tables/map/TableMap';
import { TableSheet } from '../tables/sheet/TableSheet';
import type { StaffRoute } from './routes';

// 02a §8, 02b §8 (W0.6): which lane's screen a 02 route mounts, as a direct child of the .pu root (the frames'
// .map / .order layouts are flex children of it, so no wrapper). The lane replaces the component body (W0.6 stubs
// render nothing), never this table.

export type SlotRoute = Exclude<StaffRoute, { name: 'inbox' } | { name: 'requests' } | { name: 'test_alert' } | { name: 'receipts' }>;

export function isSlotRoute(route: StaffRoute): route is SlotRoute {
  return !['inbox', 'requests', 'test_alert', 'receipts'].includes(route.name);
}

/** What the shell hands the slots beyond the route (02a IR-5): the 01d alert store's rows, for the map's flags. */
export interface SlotProps {
  alertRows?: readonly AlertRow[];
}

export function slotContent(route: SlotRoute, props: SlotProps = {}): ReactNode {
  switch (route.name) {
    case 'tables':
      return <TableMap {...(props.alertRows === undefined ? {} : { alertRows: props.alertRows })} />;
    case 'table':
      // the sheet opens over the map
      return (
        <>
          <TableMap {...(props.alertRows === undefined ? {} : { alertRows: props.alertRows })} />
          <TableSheet table_id={route.table_id} seating_id={route.seating_id} />
        </>
      );
    case 'order':
      return <OrderScreen order_type={route.order_type} id={route.id} />;
    case 'orders':
      return <OpenOrders />;
    case 'order_view':
      return <OrderView order_id={route.order_id} />;
    case 'held':
      return <Held />;
    case 'zones':
      return <ZoneStock />;
    case 'queue':
      return <QueueLog />;
    case 'me':
      // 20b (lane A): the phone's Me tab (person, sign out); the shell draws nothing here yet
      return null;
    case 'kiosk_home':
      return <KioskHome />;
  }
}

export function RouteSlot({ route, ...props }: { route: SlotRoute } & SlotProps) {
  return <>{slotContent(route, props)}</>;
}
