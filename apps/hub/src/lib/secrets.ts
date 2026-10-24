/// <reference types="node" />
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface SecretGen {
  token256(): string;
  bytes(n: number): Buffer;
  crockford(n: number): string;
}

function crockfordFrom(take: (n: number) => Buffer, n: number): string {
  const raw = take(n);
  let out = '';
  for (const byte of raw) out += ALPHABET[byte % 32];
  return out;
}

export const cryptoSecrets: SecretGen = {
  token256: () => randomBytes(32).toString('hex'),
  bytes: (n) => randomBytes(n),
  crockford: (n) => crockfordFrom(randomBytes, n),
};

export function testSecrets(): SecretGen {
  let i = 0;
  const bytes = (n: number): Buffer => {
    const buf = Buffer.alloc(n);
    for (let j = 0; j < n; j++) buf[j] = (i + j) & 0xff;
    i += n;
    return buf;
  };
  return {
    token256: () => bytes(32).toString('hex'),
    bytes,
    crockford: (n) => crockfordFrom(bytes, n),
  };
}
