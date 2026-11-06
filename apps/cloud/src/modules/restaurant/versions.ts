import { canonicalJson, sha256hex } from '@pos/domain/hash';
import type { AdminPoint } from '@pos/events';
import type { PointRow } from './repository.js';

// R30 (CL-5, as menu-variants/versions.ts): the point wire's version is a content hash of exactly these keys.
// archived = archived_at IS NOT NULL.
export function toPointWire(row: PointRow): AdminPoint {
  const input = {
    point_id: row.point_id,
    name: row.name,
    sort_order: Number(row.sort_order),
    archived: row.archived_at !== null,
  };
  return {
    point_id: input.point_id,
    name: input.name,
    sort_order: input.sort_order,
    archived_at: row.archived_at,
    version: sha256hex(canonicalJson(input)),
  };
}
