import { describe, expect, it } from 'vitest';
import { NoneAdapterSettings } from './none.js';

// 05 §4.5 row A-2 (H9-4): adapter `none` takes no settings; `.strict()` refuses any key.
describe('none adapter settings schema', () => {
  it('[05 row A-2] accepts {}', () => {
    expect(NoneAdapterSettings.safeParse({}).success).toBe(true);
  });

  it('[05 row A-2] refuses any key', () => {
    expect(NoneAdapterSettings.safeParse({ token: 'x' }).success).toBe(false);
  });

  it('[05 row A-2] refuses a non-object', () => {
    expect(NoneAdapterSettings.safeParse(null).success).toBe(false);
    expect(NoneAdapterSettings.safeParse([]).success).toBe(false);
  });
});
