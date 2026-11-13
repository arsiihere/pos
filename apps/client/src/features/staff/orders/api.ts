import type { ErrorCode } from '@pos/domain';
import type { HubResult } from '../../../api/hub-admin';
import type { CommandOptions } from '../api';
import type { EtaDraft, EtaPreviewBody, MarkServedPayload, OrdersApi, OrderViewAnswer, OrderViewBody, SubmitOrderPayload, SubmitResult } from './contracts';

// 02b §6.1–§6.10, §6.14–§6.18a (W0.5): the Ordering commands and queries on the staff api's command() / query().
// Payloads go out as given; results as the hub sends them (docs/plans/02-client-gaps.md §3).

/** What createOrdersApi needs of the staff api (features/staff/api.ts). */
export interface StaffTransport {
  command<T>(commandType: string, payload: unknown, opts?: CommandOptions): Promise<HubResult<T>>;
  query<T>(path: string): Promise<HubResult<T>>;
}

/** 02b §6.14 / hub eta-preview.ts DRAFT_MAX_BYTES: the draft's JSON, UTF-8. */
export const ETA_DRAFT_MAX_BYTES = 8_192;

const q = (v: string) => encodeURIComponent(v);

const VALIDATION_FAILED = 'VALIDATION_FAILED' satisfies ErrorCode;
const ROUTE_NOT_FOUND = 'ROUTE_NOT_FOUND' satisfies ErrorCode;

export function createOrdersApi(staff: StaffTransport): OrdersApi {
  const cmd =
    <P, R>(type: string) =>
    (payload: P): Promise<HubResult<R>> =>
      staff.command<R>(type, payload);
  return {
    submitOrder: (p: SubmitOrderPayload, opts?: CommandOptions) => staff.command<SubmitResult>('SubmitOrder', p, opts),
    removeItems: cmd('RemoveItems'),
    setLineWeight: cmd('SetLineWeight'),
    markServed: (p: MarkServedPayload, opts?: CommandOptions) => staff.command<{ served: number; skipped: string[] }>('MarkServed', p, opts),
    releaseItems: cmd('ReleaseItems'),
    boostOrder: cmd('BoostOrder'),
    returnToKitchen: cmd('ReturnToKitchen'),
    compLine: cmd('CompLine'),
    addZoneStock: cmd('AddZoneStock'),
    setZoneStock: cmd('SetZoneStock'),

    async etaPreview(draft: EtaDraft): Promise<HubResult<EtaPreviewBody>> {
      const json = JSON.stringify(draft);
      // the hub answers 400 over 8 KB; refused here before the call (no request leaves the device)
      if (new TextEncoder().encode(json).length > ETA_DRAFT_MAX_BYTES)
        return {
          ok: false,
          // the hub's VALIDATION_FAILED details shape (`issues: [{ path, message }]`), marked as a local answer
          error: { kind: 'api', status: 400, code: VALIDATION_FAILED, details: { issues: [{ path: 'draft', message: 'draft over 8 KB' }], local: true } },
        };
      return staff.query<EtaPreviewBody>(`/queries/eta-preview?draft=${q(json)}`);
    },
    seatingOrders: (seating_id) => staff.query(`/queries/seating-orders?seating_id=${q(seating_id)}`),
    openOrders(filter = {}) {
      const params = new URLSearchParams();
      if (filter.order_type !== undefined) params.set('order_type', filter.order_type);
      if (filter.abandoned !== undefined) params.set('abandoned', String(filter.abandoned));
      const s = params.toString();
      return staff.query(s === '' ? '/queries/open-orders' : `/queries/open-orders?${s}`);
    },
    zoneStock: (zone_id) => staff.query(zone_id === undefined ? '/queries/zone-stock' : `/queries/zone-stock?zone_id=${q(zone_id)}`),
    orderContact: (order_id) => staff.query(`/queries/order-contact?order_id=${q(order_id)}`),

    async orderView(order_id: string): Promise<HubResult<OrderViewAnswer>> {
      const answer = await staff.query<OrderViewBody>(`/queries/order-view?order_id=${q(order_id)}`);
      if (answer.ok) return { ok: true, data: { kind: 'order', order: answer.data } };
      // H3 fallback switch (Q-8): only the hub without the route (404 ROUTE_NOT_FOUND) is "not there yet"; every other
      // answer (404 ORDER_NOT_FOUND, 403 outside_scope, …) passes through
      const e = answer.error;
      if (e.kind === 'api' && e.status === 404 && e.code === ROUTE_NOT_FOUND) return { ok: true, data: { kind: 'missing' } };
      return answer;
    },
  };
}
