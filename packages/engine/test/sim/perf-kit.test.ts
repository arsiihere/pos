// 03a task 18: the perf gate's measuring kit on a small saturated slice, so the gate's numbers are not vacuous: the
// peak really has waiting lines, BF-7 really flips 20, replay from a checkpoint really equals live. Times are not asserted here.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyEvent, initialEngineState, toCheckpoint, type EngineState } from '../../src/index';
import { generateDay, runDay, type SimResult } from './index';
import { dist, keepEvery, measureAtPeak, peakPass, pctl, replayFrom, writeSection, type Peak } from './perf-kit';

describe('[03a task 18] perf kit', () => {
  it('[03a task 18] pctl is nearest rank; dist keeps every sample', () => {
    const xs = Array.from({ length: 200 }, (_, i) => 200 - i);
    expect(pctl(xs, 0.5)).toBe(100);
    expect(pctl(xs, 0.99)).toBe(198);
    expect(pctl([7], 0.99)).toBe(7);
    expect(dist(xs)).toEqual({ n: 200, p50: 100, p99: 198, max: 200, mean: 100.5 });
  });

  it('[03a task 18] writeSection merges sections and survives a re-read', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'perf-kit-')), 'deep', 'numbers.json');
    writeSection(file, 'a', { x: 1 });
    writeSection(file, 'b', { y: 2 });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: { x: 1 }, b: { y: 2 } });
  });

  describe('on 150 orders from the 13 h peak', () => {
    const full = generateDay(7);
    const from = full.orders.findIndex((o) => o.at_ms - full.start_ms >= 13 * 3_600_000);
    const day = { ...full, orders: full.orders.slice(from, from + 150) };
    const live = new Map<number, EngineState>();
    let run: SimResult;
    let peak: Peak;

    beforeAll(() => {
      run = runDay(day, { watch: keepEvery(live, 500) });
      peak = peakPass(run.events, live);
    }, 120_000);

    it('[03a task 18] the replay from a checkpoint equals live, and its count is the log after the checkpoint', () => {
      const first = applyEvent(initialEngineState(), run.events[0]!);
      const r = replayFrom(toCheckpoint(first, 1), run.events, 1);
      expect(r.events).toBe(run.events.length - 1);
      expect(r.state).toEqual(run.liveState);
    });

    it('[03a task 18] the replay can hand back the state after a chosen event', () => {
      const first = applyEvent(initialEngineState(), run.events[0]!);
      const seq = [...live.keys()][1]!;
      const r = replayFrom(toCheckpoint(first, 1), run.events, 1, seq - 1);
      expect(r.captured).toEqual(live.get(seq));
    });

    it('[03a task 18] the peak pass compares live states mid-day and finds a real peak', () => {
      expect(live.size).toBeGreaterThan(5);
      expect(peak.live_compared).toBe(live.size);
      expect(peak.live_mismatches).toEqual([]);
      const unfired = Object.values(peak.byUnfired.state.stations).reduce((n, s) => n + s.unfired.length, 0);
      expect(unfired).toBe(peak.byUnfired.unfired);
      expect(unfired).toBeGreaterThan(50);
      expect(Object.keys(peak.byLines.state.lines).length).toBe(peak.byLines.lines);
      expect(peak.fold_by_type.ItemAdded!.n).toBeGreaterThan(0);
    });

    it('[03a task 18] every measurement at the peak runs on what it names', () => {
      const m = measureAtPeak(peak, day, run.events, { samples: 3 });
      expect(m.errors).toEqual({});
      expect(m.bf7!.flipped).toBe(20);
      expect(m.bf7!.reserved).toBe(20);
      expect(m.bf7!.other_lines_moved).toBe(0);
      expect(m.snapshot.bytes).toBeGreaterThan(100_000);
      expect(m.snapshot.ms.n).toBe(3);
      expect(m.capacity_drop!.ms.n).toBe(3);
      expect(m.capacity_drop!.to).toBeLessThan(m.capacity_drop!.from);
      expect(m.capacity_drop!.lines_moved).toBeGreaterThan(0);
      expect(m.return_boost!.mark).toBe('return');
      expect(m.stations_live.ms.n).toBe(3);
      expect(m.stations_live.in_flight).toBeGreaterThan(0);
      expect(m.tick_intents.drafts).toBeGreaterThan(0);
      expect(m.removal_scan.ms.n).toBe(3);
    }, 120_000);
  });
});
