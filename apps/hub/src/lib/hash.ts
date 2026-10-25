import { canonicalJson, sha256hex } from '@pos/domain/hash';

export { canonicalJson, sha256hex } from '@pos/domain/hash';

export function payloadHash(payload: unknown): string {
  return sha256hex(canonicalJson(payload));
}
