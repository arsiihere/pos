/// <reference types="node" />

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SemaphoreTimeoutError extends Error {
  constructor() {
    super('semaphore acquire timed out');
    this.name = 'SemaphoreTimeoutError';
  }
}

export class Semaphore {
  private inUse = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly size: number) {}

  acquire(timeoutMs: number): Promise<() => void> {
    if (this.inUse < this.size) {
      this.inUse += 1;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new SemaphoreTimeoutError());
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next !== undefined) {
        clearTimeout(next.timer);
        next.resolve(this.releaser());
        return;
      }
      this.inUse -= 1;
    };
  }
}
