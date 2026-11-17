import { alerts } from '../alerts/raise.js';
import { ENGINE_ALERT_KINDS, type SlipWarningValues } from '../engine-host/kinds.js';
import { registerCatchUp, type CatchUpPart, type SocketCtx } from '../ws/catch-up.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import type { OrderView } from './contracts.js';
import { orderLines } from './exports.js';
import { openOrderRows, openOrderView } from './queries/open-orders.js';
import { zoneStockBody, type ZoneStockBody } from './queries/zone-stock.js';

// 02b v1.0.3 §6.18 catch-up part `orders` (staff sockets, §12.2 row 19): every open order of the branch (`orders_open`,
// one statement) as OrderView with its lines (one statement), plus `zone_stock` (the §6.17 body, one statement).
// Built per socket (H-7): `customer_name` / `phone` only for cashier kiosks and the placer's sockets (O17); everyone
// else sees `has_phone`. ⚠️ v1.0.11 (Q-10): plus `open_slips`, the branch's open `slip_warning`s with their
// `values.order_ids` (one alerts.listOpen). Statements: 4.

export type CatchUpOrder = OrderView & { customer_name?: string | null; phone?: string | null };

export interface OrdersCatchUp {
  orders: CatchUpOrder[];
  zone_stock: ZoneStockBody[];
  open_slips: OpenSlip[];
}

/** 02b v1.0.11 catch-up `orders` (Q-10): one open slip_warning (03a §3.8 `SlipWarningValues.order_ids`). */
export interface OpenSlip {
  alert_id: string;
  order_ids: string[];
}

/** O17: the contact audience of OrderContactSet, for the catch-up too. */
export function seesContact(socket: Pick<SocketCtx, 'kind' | 'deviceType' | 'staffId'>, placed_by: string): boolean {
  return socket.deviceType === 'cashier_kiosk' || (socket.kind === 'staff' && socket.staffId !== null && socket.staffId === placed_by);
}

export function ordersCatchUpPart(): CatchUpPart {
  return {
    part: 'orders',
    appliesTo: (socket) => socket.kind === 'staff',
    build: (db, _state, socket): OrdersCatchUp => {
      const rows = openOrderRows(db, 'all');
      const lines = orderLines(db, rows.map((r) => r.order_id));
      return {
        orders: rows.map((r) => {
          const view = openOrderView(r, lines.get(r.order_id)!);
          return seesContact(socket, r.placed_by) ? { ...view, customer_name: r.customer_name, phone: r.phone } : view;
        }),
        zone_stock: zoneStockBody(db, branchConfig()),
        open_slips: alerts.listOpen(db, { kind: ENGINE_ALERT_KINDS.slip }).map((a) => ({
          alert_id: a.alert_id,
          order_ids: (a.values as SlipWarningValues).order_ids,
        })),
      };
    },
  };
}

export function registerOrdersCatchUp(): () => void {
  return registerCatchUp(ordersCatchUpPart());
}
