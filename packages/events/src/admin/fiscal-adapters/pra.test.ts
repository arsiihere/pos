import { describe, expect, it } from 'vitest';
import { PraAdapterSettings } from './pra.js';

// 05 Appendix P.2: "PRA needs no adapter_settings (its settingsSchema accepts {} only)"; row A-1 (3) H10-5:
// never a secret, so a token (or any key) is refused.
describe('PRA adapter settings schema', () => {
  it('[05 P.2] accepts {}', () => {
    expect(PraAdapterSettings.safeParse({}).success).toBe(true);
  });

  it('[05 P.2] refuses any key, a token included', () => {
    expect(PraAdapterSettings.safeParse({ token: 'test-token' }).success).toBe(false);
    expect(PraAdapterSettings.safeParse({ ntn: '1234567' }).success).toBe(false);
  });

  it('[05 P.2] refuses a non-object', () => {
    expect(PraAdapterSettings.safeParse('x').success).toBe(false);
  });
});
