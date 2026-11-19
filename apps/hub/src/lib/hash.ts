import { canonicalJson, sha256hex } from '@pos/domain/hash';

export { canonicalJson, sha256hex } from '@pos/domain/hash';

/**
 * 00 §3.7 M47; v1.6 H-9: the command's `pinCheck` field is removed before hashing (01d §3.3 rule 4).
 * 00 v1.12 §3.7 (⚠️ Changed by 05 (row H-4)): `omit` also takes the command's `hashOmit` list of dotted payload
 * paths (`'buyer.tax_id.value'`); each is removed before `payload_hash` is computed. A path walks plain objects
 * only: a missing, null, array or primitive step leaves the payload unchanged. The caller's payload is not mutated.
 */
export function payloadHash(payload: unknown, omit?: string | readonly string[]): string {
  const paths = omit === undefined ? [] : typeof omit === 'string' ? [omit] : omit;
  let rest = payload;
  for (const path of paths) rest = withoutPath(rest, path.split('.'));
  return sha256hex(canonicalJson(rest));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Copy-on-write along the path; untouched branches are shared, never changed.
function withoutPath(value: unknown, segments: readonly string[]): unknown {
  const [head, ...tail] = segments;
  if (head === undefined || !isPlainObject(value) || !Object.hasOwn(value, head)) return value;
  const copy: Record<string, unknown> = { ...value };
  if (tail.length === 0) delete copy[head];
  else copy[head] = withoutPath(value[head], tail);
  return copy;
}
