import { canonicalJson, sha256hex } from '@pos/domain/hash';

export { canonicalJson, sha256hex } from '@pos/domain/hash';

/** 00 §3.7 M47; v1.6 H-9: `omit` names the command's `pinCheck` field, removed before hashing (01d §3.3 rule 4). */
export function payloadHash(payload: unknown, omit?: string): string {
  if (omit === undefined || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return sha256hex(canonicalJson(payload));
  }
  const rest: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  delete rest[omit];
  return sha256hex(canonicalJson(rest));
}
