import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock } from './clock';
import { hubTime } from './hub-time';

describe('hubTime (S47)', () => {
  const zone = process.env.TZ;

  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('[01a S47] hubTime gives now_ms and utc_offset_ms 18000000 under TZ=Asia/Karachi', () => {
    process.env.TZ = 'Asia/Karachi';
    const now = Date.UTC(2026, 9, 25, 7, 30);
    expect(hubTime(fixedClock(now))).toEqual({ now_ms: now, utc_offset_ms: 18_000_000 });
    process.env.TZ = 'UTC';
    expect(hubTime(fixedClock(now))).toEqual({ now_ms: now, utc_offset_ms: 0 });
  });
});
