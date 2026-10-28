// S35 j: the only ULID source in the browser. 48-bit time + 80 random bits from crypto.getRandomValues,
// Crockford base32 (method of apps/hub/src/auth/pair-page.ts). Never crypto.randomUUID: the hub is plain
// HTTP on the LAN, so there is no secure context.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newUlid(nowMs: number = Date.now()): string {
  let time = '';
  let t = nowMs;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let random = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      random += CROCKFORD[(value >> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  return time + random;
}
