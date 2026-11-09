// 03a v1.2 Q-3 (02p task 15): the zone line, deal header and ready-item shapes of tests 125 and 130, shared by
// zone-filter.int.test.ts (live, replay) and boot-idset.int.test.ts (restart).
import type { PosEvent } from '@pos/events';
import { anItemAdded, anItemDone, anOrderBatch } from '@pos/events/testing';

const NO_STATION = { station_id: null, serve_mode: null, cook_time_ms: null };

// A deal header H and its parts (each part an engine line on S1), in one submit batch with the order.
export function dealOrder(order_id: string, header: string, parts: readonly string[], recorded_at: number): PosEvent[] {
  return anOrderBatch({
    order_id,
    lines: [
      { order_item_id: header, item: { line_kind: 'deal', item_id: null, deal_id: 'DL1', ...NO_STATION } },
      ...parts.map((id) => ({ order_item_id: id, item: { line_kind: 'deal_part', parent_order_item_id: header, deal_id: 'DL1' } })),
    ],
    order: { table_id: `T-${order_id}`, table_key: `dine_in:T-${order_id}` },
    recorded_at,
  });
}

// An ItemAdded served from a zone: never listed in order_item_ids, never an engine line (§3.3 Q-3).
export const zoneAdded = (order_id: string, order_item_id: string): PosEvent =>
  anItemAdded({ stream_id: order_id, payload: { order_id, order_item_id, served_from_zone_id: 'ZN1', ...NO_STATION } });

// An order of ready items only: OrderPlaced with empty order_item_ids (AD-E18).
export const emptyOrder = (order_id: string, recorded_at: number): PosEvent =>
  anOrderBatch({ order_id, lines: [], order: { groups: [], lines: [], table_id: `T-${order_id}`, table_key: `dine_in:T-${order_id}` }, recorded_at })[0]!;

export const readyAdded = (order_id: string, order_item_id: string): PosEvent =>
  anItemAdded({ stream_id: order_id, payload: { order_id, order_item_id, is_ready_item: true, ...NO_STATION } });

export const served = (order_id: string, ids: string[], source: 'tap' | 'zone'): PosEvent =>
  ({ ...anItemDone({ stream_id: order_id }), event_type: 'ItemServed', payload: { order_item_ids: ids, source } }) as PosEvent;

export const removed = (order_id: string, order_item_id: string): PosEvent =>
  ({ ...anItemDone({ stream_id: order_id }), event_type: 'ItemRemoved', payload: { order_item_id } }) as PosEvent;

export const voided = (order_id: string, order_item_id: string): PosEvent =>
  ({ ...anItemDone({ stream_id: order_id }), event_type: 'ItemVoided', payload: { order_item_id, units: 1 } }) as PosEvent;

// Test 125's later events on the zone line Z and the deal header H of order O: the four shapes (ItemServed zone,
// ItemRemoved / ItemVoided on a zone line and on a deal header).
export const zoneAndDealShapes = (o: string, z: string, h: string): PosEvent[] => [served(o, [z], 'zone'), removed(o, z), voided(o, z), removed(o, h), voided(o, h)];

// AD-E18: every event on a ready-items-only order (its ready line R).
export const readyShapes = (o: string, r: string): PosEvent[] => [readyAdded(o, `${r}b`), served(o, [r], 'tap'), removed(o, r), voided(o, r)];

export const ABSENT_ID = 'engine fold: absent id';
