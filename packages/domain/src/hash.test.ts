import { describe, expect, it } from 'vitest';
import * as root from './index';
import { canonicalJson, sha256hex } from './hash';

describe('hash', () => {
  it('[01a S27] canonicalJson sorts keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1},1]},"b":1}');
    expect(canonicalJson([2, 1, 'x'])).toBe('[2,1,"x"]');
    expect(canonicalJson('s')).toBe('"s"');
  });

  it('[01a S27] canonicalJson throws on undefined as a value, in an array and at the top level', () => {
    expect(() => canonicalJson({ a: 1, b: undefined })).toThrow('canonicalJson: undefined');
    expect(() => canonicalJson({ a: { b: [1, undefined] } })).toThrow('canonicalJson: undefined');
    expect(() => canonicalJson([undefined])).toThrow('canonicalJson: undefined');
    expect(() => canonicalJson(undefined)).toThrow('canonicalJson: undefined');
  });

  it("[01a S27] sha256hex('abc')", () => {
    expect(sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('[01a S27] @pos/domain root does not export canonicalJson', () => {
    expect('canonicalJson' in root).toBe(false);
    expect('sha256hex' in root).toBe(false);
  });
});
