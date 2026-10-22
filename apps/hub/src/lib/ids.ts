import { monotonicFactory } from 'ulid';
import type { Clock } from './clock.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface IdGen {
  next(): string;
}

export function ulidGen(clock: Clock): IdGen {
  const next = monotonicFactory();
  return { next: () => next(clock.branchNow()) };
}

export function testIdGen(): IdGen {
  let n = 0;
  return {
    next() {
      n += 1;
      let value = n;
      let encoded = '';
      for (let i = 0; i < 26; i++) {
        encoded = ALPHABET[value % 32]! + encoded;
        value = Math.floor(value / 32);
      }
      return encoded;
    },
  };
}
