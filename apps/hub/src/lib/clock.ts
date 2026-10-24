export interface Clock {
  branchNow(): number;
}

export const T = 1_761_000_000_000;

export function createBranchClock(o: {
  wallNow: () => number;
  monoNow: () => number;
  lastRecordedAt: number;
}): { clock: Clock; alarm: null | { wall_ms: number; last_recorded_at: number; delta_ms: number } } {
  const wall = o.wallNow();
  const bootMono = o.monoNow();
  const alarm =
    wall <= o.lastRecordedAt
      ? { wall_ms: wall, last_recorded_at: o.lastRecordedAt, delta_ms: wall - o.lastRecordedAt }
      : null;
  const bootWall = Math.max(wall, o.lastRecordedAt + 1);
  return {
    alarm,
    clock: {
      branchNow: () => Math.floor(bootWall + (o.monoNow() - bootMono)),
    },
  };
}

export function fixedClock(t: number): Clock & { set(t: number): void; advance(ms: number): void } {
  let now = t;
  return {
    branchNow: () => now,
    set(next: number) {
      now = next;
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

export function steppingClock(t: number, stepMs: number): Clock {
  let now = t;
  return {
    branchNow() {
      const current = now;
      now += stepMs;
      return current;
    },
  };
}
