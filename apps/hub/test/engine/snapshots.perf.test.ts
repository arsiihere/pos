// 03a §7.1 "snapshot write ≤ 50 ms at design size, off the response path" (task 21, §10.6). AD-32 and AD-34: a
// wall-clock bound, so it runs only in the clean measurement (`pnpm test:perf`, project perf-hub), never in the normal
// gate; AD-34 moved it here from snapshots.int.test.ts after it hit 60–91 ms under full-suite load.
//
// Fixture (P-12): the AD-27 normal peak day of seed 7 (@pos/engine/sim), its state with the most lines (task 18's
// snapshot row). States are immutable, so the peak is kept by reference.
//
// One sample = the full write: serialise + insert in its own transaction (writeSnapshotSync) on the peak state, with
// the clock moved 1 ms so no two snapshots share a taken_at. Every sample must pass: the max is asserted.
import { performance } from 'node:perf_hooks';
import type { EngineState } from '@pos/engine';
import { generateDay, runDay } from '@pos/engine/sim';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostFlags } from '../../src/engine-host/host-flags';
import { writeSnapshotSync } from '../../src/engine-host/snapshots';
import { createTestHub, type TestHub } from '../helpers/test-hub';

const SEED = 7;
const SNAPSHOT_MS = 50; // §7.1
const SNAPSHOT_SAMPLES = 15;
const HOOK_MS = 300_000; // a watchdog for the day's simulation, not a bound

const snapshotJsonOf = (db: Database.Database): string[] =>
  db.prepare('SELECT state_json FROM engine_snapshots ORDER BY last_seq, taken_at').pluck().all() as string[];

describe('[03a §7.1 snapshot] the full write on the peak state', () => {
  let hub: TestHub;
  let peak: { state: EngineState; lines: number; seq: number } | null = null;

  beforeAll(async () => {
    let best = -1;
    runDay(generateDay(SEED), {
      watch: (state, seq) => {
        const n = Object.keys(state.lines).length;
        if (n > best) {
          best = n;
          peak = { state, lines: n, seq };
        }
      },
    });
    hub = await createTestHub();
    hostFlags.checkpoint_pending = false;
  }, HOOK_MS);

  afterAll(async () => {
    await hub?.close();
  });

  it('[03a §7.1 snapshot] serialise + insert in its own transaction ≤ 50 ms at design size (every sample)', () => {
    const p = peak!;
    expect(p.lines).toBeGreaterThanOrEqual(1_000);
    hub.deps.state.swap(p.state);
    const ms: number[] = [];
    for (let i = 0; i < SNAPSHOT_SAMPLES; i += 1) {
      hub.clock.advance(1);
      const a = performance.now();
      writeSnapshotSync(hub.deps);
      ms.push(performance.now() - a);
    }
    const rows = snapshotJsonOf(hub.deps.db);
    expect(rows).toHaveLength(2);
    const bytes = rows[1]!.length;
    const sorted = [...ms].sort((x, y) => x - y);
    // For the status board's §7.1 row.
    console.info(`[03a §7.1 snapshot] ${JSON.stringify({ samples: ms.map((x) => Math.round(x * 10) / 10), p50: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1], bytes, lines: p.lines, seq: p.seq })}`);
    expect(Math.max(...ms)).toBeLessThanOrEqual(SNAPSHOT_MS);
  });
});
