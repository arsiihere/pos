import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decryptFile, encryptFile } from './crypto-file';

describe('crypto-file', () => {
  it('[00 §10 #65] round trip; a flipped byte fails the tag and writes no output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-enc-'));
    try {
      const src = join(dir, 'in.bin');
      const enc = join(dir, 'out.enc');
      const plain = join(dir, 'out.bin');
      const body = Buffer.from('plaintext that must round-trip');
      writeFileSync(src, body);
      const key = randomBytes(32);
      await encryptFile(src, enc, key, randomBytes(12));
      expect(existsSync(`${enc}.tmp`)).toBe(false);
      expect(readFileSync(enc).subarray(0, 8).toString()).toBe('POSENC1\n');

      await decryptFile(enc, plain, key);
      expect(readFileSync(plain)).toEqual(body);
      expect(existsSync(`${plain}.tmp`)).toBe(false);

      const flipped = readFileSync(enc);
      flipped[flipped.length - 20] ^= 0xff;
      const bad = join(dir, 'bad.enc');
      const badOut = join(dir, 'bad-out.bin');
      writeFileSync(bad, flipped);
      await expect(decryptFile(bad, badOut, key)).rejects.toThrow();
      expect(existsSync(badOut)).toBe(false);
      expect(existsSync(`${badOut}.tmp`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
