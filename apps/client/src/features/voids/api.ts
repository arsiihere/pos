import type { HubResult } from '../../api/hub-admin';
import type { CommandOptions, StaffApi } from '../staff/api';
import type { PendingVoidsBody, VoidItemsPayload, VoidItemsResult, VoidPreviewBody } from './contracts';

// 04 §6.1, §6.3, §6.4: the void reads and the one void write, on the staff api's query() / command(). VoidItems is not
// queueable (V15): it goes straight to the hub, never to the device queue.

const q = (v: string) => encodeURIComponent(v);

export function voidPreview(api: Pick<StaffApi, 'query'>, o: { order_id: string; order_item_ids: readonly string[]; units?: number }): Promise<HubResult<VoidPreviewBody>> {
  const units = o.units === undefined ? '' : `&units=${o.units}`;
  return api.query<VoidPreviewBody>(`/queries/void-preview?order_id=${q(o.order_id)}&order_item_ids=${o.order_item_ids.map(q).join(',')}${units}`);
}

export function pendingVoids(api: Pick<StaffApi, 'query'>, by: { order_ids: readonly string[] } | { seating_id: string }): Promise<HubResult<PendingVoidsBody>> {
  return api.query<PendingVoidsBody>('seating_id' in by ? `/queries/pending-voids?seating_id=${q(by.seating_id)}` : `/queries/pending-voids?order_ids=${by.order_ids.map(q).join(',')}`);
}

export function voidItems(api: Pick<StaffApi, 'command'>, payload: VoidItemsPayload, opts: CommandOptions = {}): Promise<HubResult<VoidItemsResult>> {
  return api.command<VoidItemsResult>('VoidItems', payload, opts);
}
