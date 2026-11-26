// ⚠️ 02b v1.0.25 §6.19 (run 3 R3-M-8): OpenOrderBillChanged is delivered like OrdersBilled — staff sockets and cashier
// kiosks, never a KDS station (nor any other non-staff, non-kiosk socket, e.g. a later display). The event carries no
// amount or contact. The contract only: nothing appends it yet (L-BILL-2).
import type { PosEvent } from '@pos/events';
import { anOpenOrderBillChanged } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { ORDER_EVENT_TYPES } from '../../src/orders/audiences';
import { audienceAllows } from '../../src/ws/audience';
import type { SocketCtx } from '../../src/ws/catch-up';

const socket = (o: Partial<SocketCtx>): SocketCtx => ({ deviceId: 'D1', deviceType: 'tablet', sessionId: 'X1', kind: 'staff', staffId: 'S_CASH', stationId: null, asOfSeq: 1, ...o });

describe('[02b §6.19, R3-M-8] OpenOrderBillChanged audience', () => {
  it('is in ORDER_EVENT_TYPES beside OrdersBilled / OrdersUnbilled', () => {
    expect(ORDER_EVENT_TYPES).toEqual(expect.arrayContaining(['OrdersBilled', 'OrdersUnbilled', 'OpenOrderBillChanged']));
  });

  it('reaches staff sockets (tablet, phone) and cashier kiosks, never a KDS station — the same as OrdersBilled', () => {
    const changed = anOpenOrderBillChanged() as PosEvent;
    const billed = { ...changed, event_type: 'OrdersBilled', payload: { order_ids: ['O1'], bill_id: 'B1' } } as PosEvent;
    const sockets = {
      tablet: socket({}),
      phone: socket({ deviceType: 'phone' }),
      kiosk: socket({ deviceType: 'cashier_kiosk' }),
      station: socket({ deviceType: 'kds', kind: 'station', staffId: null, stationId: 'S1' }),
    };
    for (const [name, s] of Object.entries(sockets)) {
      expect(audienceAllows(changed, s), name).toBe(audienceAllows(billed, s));
    }
    expect([sockets.tablet, sockets.phone, sockets.kiosk].map((s) => audienceAllows(changed, s))).toEqual([true, true, true]);
    expect(audienceAllows(changed, sockets.station)).toBe(false);
  });
});
