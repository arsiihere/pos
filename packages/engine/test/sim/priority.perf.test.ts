// 03a v1.2.10 §10.6, test 172 (STAB-7; review M-10; re-review m-4): the normal peak day and the overload day with the
// branch default max delay 5 min on every item (every 10th line "No limit"). Report only (the numbers file and the status
// board after the owner's run on the real disk); asserted: no group a waiting line drives waits more than
// MAX_DELAY_NO_LIMIT_MS + one cook past T without becoming priority (groups a fired, sliding or COOKING line drives are
// exempt by design, PR-3), and live = replay. Never in the normal gate (AD-32), never on tmpfs.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildEngineState, type EngineState } from '../../src/index';
import { dist, step } from './perf-kit';
import { generateDay, runDay, type SimResult } from './index';

const HOOK_MS = 3_600_000; // a watchdog, not a bound (day.perf.test.ts)
const PRIORITY = { defaultMs: 300_000, noLimitEvery: 10 };

const withoutDiag = (s: EngineState): Omit<EngineState, 'diagnostics'> => {
  const { diagnostics: _d, ...rest } = s;
  void _d;
  return rest;
};

const reportOf = (r: SimResult) => {
  const p = r.priority!;
  return {
    lines: p.lines,
    priority_line_share: p.lines === 0 ? 0 : p.priority_lines / p.lines,
    groups: p.groups,
    priority_group_share: p.groups === 0 ? 0 : p.priority_groups / p.groups,
    delay_ms: p.delays_ms.length === 0 ? null : dist(p.delays_ms),
    no_limit_delay_ms: p.no_limit_delays_ms.length === 0 ? null : dist(p.no_limit_delays_ms),
    overtakes: p.overtakes,
    overtakes_by_earlier_onset: p.overtakes_by_earlier_onset,
    bound_violations: p.bound_violations,
  };
};

describe.each([
  ['normal', false],
  ['overload', true],
] as const)('[03a v1.2.10 §10.6 #172] the %s day with max delay 5 min', (name, overload) => {
  let run: SimResult;
  beforeAll(() => {
    run = step(`priority_${name}_day`, () => runDay(generateDay(7, { overload }), { priority: PRIORITY }), reportOf);
  }, HOOK_MS);

  it('[03a #172] the far-cap bound for groups a waiting line drives', () => {
    expect(run.priority!.bound_violations).toEqual([]);
  });

  it('[03a #172] live = replay', () => {
    expect(withoutDiag(buildEngineState(run.events))).toEqual(withoutDiag(run.liveState));
  });
});
