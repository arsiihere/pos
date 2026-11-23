// 03a v1.2.10 §10.6, test 172 (STAB-7): the simulator's priority option on a small overload day, in the normal gate (the
// full days with the report run in test:perf only, priority.perf.test.ts). Asserted: the far-cap bound for groups a
// waiting line drives, and live = replay. No timing asserts (AD-32).
import { describe, expect, it } from 'vitest';
import { buildEngineState, type EngineState } from '../../src/index';
import { generateDay, runDay } from './index';

const withoutDiag = (s: EngineState): Omit<EngineState, 'diagnostics'> => {
  const { diagnostics: _d, ...rest } = s;
  void _d;
  return rest;
};

describe('[03a v1.2.10 §10.6 #172] the priority option on a small overload day (600 orders, max delay 1 min, Start tapped 2 min late so fired lines slide)', () => {
  it('[03a #172] groups become priority; no driven group waits past T + 30 min + one cook unprioritised; live = replay', () => {
    const run = runDay(generateDay(7, { overload: true, orders: 600 }), { priority: { defaultMs: 60_000, noLimitEvery: 7 }, startLateMs: 120_000 });
    const p = run.priority!;
    expect(p.priority_groups).toBeGreaterThan(0);
    expect(p.bound_violations).toEqual([]);
    expect(withoutDiag(buildEngineState(run.events))).toEqual(withoutDiag(run.liveState));
    expect(run.events.some((e) => e.event_type === 'LinePrioritized')).toBe(true);
  }, 120_000);
});
