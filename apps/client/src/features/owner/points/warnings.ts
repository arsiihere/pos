import type { Point } from '../../../api/cloud-admin';

// ⚠️ 01a v2.12 §8.1 QS-1 (owner 2026-11-28 QA-R2, BUG-8; PT-1, PT-6; 03b §4.4 routePoint): what the Points page warns
// about, from the points it lists (0 reads). Active points only.
// - same_position: two or more points with one `sort_order`;
// - tie: for an order type, two or more points with the same most specific set that accepts it ('all' = every type);
//   not shown when every active point is 'all' (the legacy setup, 03b §6.12);
// - gap: an order type no active point accepts (its lines go to the station's default Pass).
// Pure.

export const WARN_ORDER_TYPES = ['dine_in', 'takeaway', 'parking'] as const;
export type WarnOrderType = (typeof WARN_ORDER_TYPES)[number];

export type PointWarning =
  | { kind: 'same_position'; sort_order: number; names: string[] }
  | { kind: 'tie'; order_type: WarnOrderType; names: string[] }
  | { kind: 'gap'; order_type: WarnOrderType };

type P = Pick<Point, 'point_id' | 'name' | 'sort_order' | 'order_types' | 'archived_at'>;

const ALL_TYPES = 4; // dine_in, takeaway, parking, delivery
const size = (p: P) => (p.order_types === 'all' ? ALL_TYPES : p.order_types.length);
const accepts = (p: P, type: WarnOrderType) => p.order_types === 'all' || (p.order_types as readonly string[]).includes(type);
const byOrder = (a: P, b: P) => a.sort_order - b.sort_order || a.name.localeCompare(b.name) || (a.point_id < b.point_id ? -1 : 1);

export function pointWarnings(points: readonly P[]): PointWarning[] {
  const live = points.filter((p) => p.archived_at === null).sort(byOrder);
  const out: PointWarning[] = [];
  const bySort = new Map<number, P[]>();
  for (const p of live) bySort.set(p.sort_order, [...(bySort.get(p.sort_order) ?? []), p]);
  for (const [sort_order, list] of bySort) if (list.length > 1) out.push({ kind: 'same_position', sort_order, names: list.map((p) => p.name) });
  const legacy = live.every((p) => p.order_types === 'all');
  for (const type of WARN_ORDER_TYPES) {
    const take = live.filter((p) => accepts(p, type));
    if (take.length === 0) {
      if (live.length > 0) out.push({ kind: 'gap', order_type: type });
      continue;
    }
    if (legacy) continue;
    const best = Math.min(...take.map(size));
    const tied = take.filter((p) => size(p) === best);
    if (tied.length > 1) out.push({ kind: 'tie', order_type: type, names: tied.map((p) => p.name) });
  }
  return out;
}
