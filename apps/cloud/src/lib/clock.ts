export interface Clock {
  branchNow(): number;
}

export function systemClock(): Clock {
  return { branchNow: () => Date.now() };
}

export function fixedClock(t: number): Clock & { set(t: number): void } {
  let now = t;
  return {
    branchNow: () => now,
    set(next: number) {
      now = next;
    },
  };
}
