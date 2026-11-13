import type { LineDetail } from '@pos/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHubClock } from '../../../app/hub-clock';
import type { KdsRow } from '../store';
import { clockText, plannedDoneMs, timerOf } from './LineTimer';

// 03b v1.0.8 §3.3, #71 (K2; frame 03b-C03): waiting / cooking / late, on the hub clock only.

const D = { cook_ms: 120_000, prep_ms: 30_000 } as LineDetail;
const row = (o: Partial<KdsRow>): KdsRow => ({
  order_item_id: 'A',
  order_id: 'O',
  stage: 'added',
  fired_at: null,
  started_at: null,
  mark: null,
  done_undone: false,
  done_at: null,
  detail: D,
  ...o,
});

afterEach(() => vi.useRealTimers());

describe('[03b #71] line timer', () => {
  it('[03b #71] late +N min when now > planned_done_ms, with a skewed device clock corrected by hub_time', () => {
    // the device clock is 25 minutes behind the hub; the screen must still count from the hub's time
    const HUB = Date.UTC(2026, 10, 13, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(HUB - 25 * 60_000);
    let perf = 0;
    const clock = createHubClock({ now_ms: HUB, utc_offset_ms: 18_000_000 }, () => perf);
    const cooking = row({ stage: 'cooking', fired_at: HUB - 4 * 60_000, started_at: HUB - 3 * 60_000 }); // planned done HUB − 1 min
    expect(plannedDoneMs(cooking, D)).toBe(HUB - 60_000);
    expect(timerOf(cooking, D, clock.nowMs())).toEqual({ kind: 'late', minutes: 1 });
    perf = 61_000; // 61 s later: 2:01 past planned done → +3 min (rounded up)
    expect(timerOf(cooking, D, clock.nowMs())).toEqual({ kind: 'late', minutes: 3 });
    // not started: planned done = fired_at + prep_ms + cook_ms
    const waiting = row({ fired_at: HUB - 60_000 });
    expect(plannedDoneMs(waiting, D)).toBe(HUB + 90_000);
    perf = 0;
    expect(timerOf(waiting, D, clock.nowMs())).toMatchObject({ kind: 'waiting', elapsed: 60_000 });
    // with the device clock the line would not be late at all — the hub clock decides
    expect(timerOf(cooking, D, Date.now()).kind).toBe('cooking');
  });

  it('[03b §3.3] cooking m:ss since started_at, waiting m:ss since fired_at, h:mm:ss from an hour, done', () => {
    expect(timerOf(row({ stage: 'cooking', started_at: 1_000, fired_at: 0 }), D, 71_000)).toMatchObject({ kind: 'cooking', elapsed: 70_000 });
    expect(timerOf(row({ fired_at: 1_000 }), D, 11_000)).toMatchObject({ kind: 'waiting', elapsed: 10_000 });
    expect(timerOf(row({ stage: 'done', started_at: 0 }), D, 10_000_000)).toEqual({ kind: 'done' });
    expect(clockText(70_000)).toBe('1:10');
    expect(clockText(3_910_000)).toBe('1:05:10');
    expect(clockText(-5)).toBe('0:00');
  });
});
