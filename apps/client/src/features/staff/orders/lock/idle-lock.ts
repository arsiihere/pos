import type { IdleLock } from '../contracts';

// 02b v1.0.11 §8 Device idle lock (00 H-1, run 4 m-9), owner Q-21 (25d): the device's own idle timer of the
// session's idle TTL, connected or not. It compares the WALL CLOCK since the last tap — on resume
// (`visibilitychange`), before acting on any tap, and from a timer while the page is awake (a sleeping WebView
// suspends timers, so the timer alone is never trusted). `idle_ttl_ms ≤ 0` locks at once (as the hub treats it).
// Once locked it stays locked: the page signs the person out.

export interface IdleTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface IdleLockOptions {
  ttlMs: number;
  /** wall clock (Q-21), ms */
  now: () => number;
  timers?: IdleTimers;
  /** once, at the moment the lock closes */
  onLock: () => void;
  /** the last tap before this lock existed (wall clock); default now — idle time counts from the screen's mount even
   *  when the TTL was only learned later (review #171) */
  lastTapAt?: number;
  /** default true; false = nothing runs (no check, no timer) until `start()` (a React effect starts it, StrictMode) */
  autoStart?: boolean;
}

export interface DeviceIdleLock extends IdleLock {
  /** the resume / visibility check; true when locked */
  check(): boolean;
  /** the first check + the timer (autoStart: false) */
  start(): void;
  /** stops it for good: no timer, no lock, every tap passes */
  dispose(): void;
}

const browserTimers: IdleTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createIdleLock(o: IdleLockOptions): DeviceIdleLock {
  const timers = o.timers ?? browserTimers;
  const listeners = new Set<() => void>();
  let last = o.lastTapAt ?? o.now();
  let isLocked = false;
  let disposed = false;
  let started = false;
  let timer: unknown = null;

  const expired = () => o.ttlMs <= 0 || o.now() - last >= o.ttlMs;
  const clear = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const lock = () => {
    if (isLocked || disposed) return;
    isLocked = true;
    clear();
    for (const l of [...listeners]) l();
    o.onLock();
  };
  const schedule = () => {
    clear();
    if (isLocked || disposed) return;
    timer = timers.setTimeout(() => {
      timer = null;
      if (expired()) lock();
      else schedule();
    }, Math.max(0, last + o.ttlMs - o.now()));
  };
  const check = () => {
    if (!disposed && started && !isLocked && expired()) lock();
    return isLocked;
  };
  const start = () => {
    if (started || disposed) return;
    started = true;
    if (!check()) schedule();
  };

  if (o.autoStart !== false) start();

  return {
    touch() {
      if (disposed || !started) {
        last = o.now();
        return true;
      }
      if (check()) return false;
      last = o.now();
      schedule();
      return true;
    },
    locked: () => isLocked,
    check,
    start,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
