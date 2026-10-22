import { describe, expect, it } from 'vitest';
import { Semaphore, SemaphoreTimeoutError } from './semaphore';

describe('semaphore', () => {
  it('[00 §7.4] third acquire times out after the deadline', async () => {
    const sem = new Semaphore(2);
    await sem.acquire(1_000);
    await sem.acquire(1_000);
    const started = Date.now();
    await expect(sem.acquire(40)).rejects.toBeInstanceOf(SemaphoreTimeoutError);
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
  });

  it('[00 §7.4] release hands the slot to the oldest waiter', async () => {
    const sem = new Semaphore(1);
    const releaseFirst = await sem.acquire(1_000);
    const order: string[] = [];
    const firstWaiter = sem.acquire(1_000).then((release) => {
      order.push('a');
      return release;
    });
    const secondWaiter = sem.acquire(1_000).then((release) => {
      order.push('b');
      return release;
    });
    await Promise.resolve();
    releaseFirst();
    const releaseA = await firstWaiter;
    expect(order).toEqual(['a']);
    releaseA();
    await secondWaiter;
    expect(order).toEqual(['a', 'b']);
  });
});
