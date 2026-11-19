import { canonicalJson, sha256hex } from '@pos/domain/hash';
import type { BillingSettings } from '@pos/events';

// 05 row A-1 (4) (01b B23 style): the only place that builds a billing settings version — the content hash of the
// branch's document. No column: a branch with no saved document has the default document's version.

/** JSON round trip: drops absent optional keys, so a stored (JSONB) and a parsed document hash alike. */
export function plainDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function billingSettingsVersion(branchId: string, document: BillingSettings): string {
  return sha256hex(canonicalJson({ branch_id: branchId, document: plainDocument(document) }));
}
