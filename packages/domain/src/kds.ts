// 03b §4.4: shared KDS / Pass types (browser-safe; no node imports).

export const UNDO_DONE_MS = 30_000; // D16; Undo Done and Undo ready

export type Identifier =
  | { kind: 'table'; label: string } // "T4 + T5", "Family 2"
  | { kind: 'token'; token: number; date: string | null }
  | { kind: 'parking'; car_number: string; car_type: 'sedan' | 'mini' | 'large' };

export interface LineDetail {
  order_item_id: string;
  order_id: string;
  station_id: string;
  point_id: string;
  identifier: Identifier;
  order_type: 'dine_in' | 'takeaway' | 'parking';
  item_name: string;
  units: number; // live units
  line_kind: 'item' | 'option_child' | 'deal_part';
  for_parent: string | null;
  deal_name: string | null;
  options: string[]; // option children with no station
  kitchen_note: string | null;
  order_note: string | null;
  return_of: { order_item_id: string; mode: 'fix' | 'remake'; item_name: string; identifier: Identifier } | null;
  cook_ms: number;
  prep_ms: number;
  from_stock: boolean;
  placed_by_name: string | null; // order taker (03c ticket toggle)
}
