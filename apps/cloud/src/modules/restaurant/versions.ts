import { canonicalJson, sha256hex } from '@pos/domain/hash';
import type { AdminPoint } from '@pos/events';
import type { PointRow } from './repository.js';

// R30 (CL-5, as menu-variants/versions.ts): the point wire's version is a content hash of exactly these keys.
// archived = archived_at IS NOT NULL. ⚠️ Changed by 01a v2.11 PT-2 (run 3 R3-M-2): an explicit order_types set joins
// the hash, sorted; the member is omitted for SQL NULL ('all'), so a legacy point keeps its version, and an explicit
// four-type set and 'all' have different versions.
export function toPointWire(row: PointRow): AdminPoint {
  const orderTypes = row.order_types === null ? null : [...row.order_types].sort();
  const input = {
    point_id: row.point_id,
    name: row.name,
    sort_order: Number(row.sort_order),
    archived: row.archived_at !== null,
    ...(orderTypes === null ? {} : { order_types: orderTypes }),
  };
  return {
    point_id: input.point_id,
    name: input.name,
    sort_order: input.sort_order,
    archived_at: row.archived_at,
    order_types: orderTypes ?? 'all',
    version: sha256hex(canonicalJson(input)),
  };
}
