import { describe, expect, it } from 'vitest';
import { createBranchClock } from './clock';

describe('clock', () => {
  it('[F §4.7] branchNow never jumps with the wall clock', () => {
    let wall = 1_000_000;
    let mono = 0;
    const { clock, alarm } = createBranchClock({
      wallNow: () => wall,
      monoNow: () => mono,
      lastRecordedAt: 0,
    });
    expect(alarm).toBeNull();
    expect(clock.branchNow()).toBe(1_000_000);
    wall = 9_000_000;
    expect(clock.branchNow()).toBe(1_000_000);
    mono = 50;
    expect(clock.branchNow()).toBe(1_000_050);
  });

  it('[F §4.7, D48] boot wall ≤ last recorded_at → last+1 with an alarm (delta_ms = wall − last)', () => {
    const behind = createBranchClock({
      wallNow: () => 100,
      monoNow: () => 0,
      lastRecordedAt: 500,
    });
    expect(behind.alarm).toEqual({ wall_ms: 100, last_recorded_at: 500, delta_ms: -400 });
    expect(behind.clock.branchNow()).toBe(501);

    const equal = createBranchClock({
      wallNow: () => 500,
      monoNow: () => 0,
      lastRecordedAt: 500,
    });
    expect(equal.alarm).toEqual({ wall_ms: 500, last_recorded_at: 500, delta_ms: 0 });
    expect(equal.clock.branchNow()).toBe(501);
  });
});
