// owned by lane Q, task 25c (was the W0.6 stub)
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { ShellHooks } from '../../shell/hooks';
import type { Enqueue } from '../../tables/contracts';
import { queueOf } from './enqueue';

// 02b v1.0.11 §8 Queue, §3.12: "The queue is drained before a new login is offered on the device": the sign-in
// screen shows "2 waiting to send" and sends them first (SignIn awaits beforeSignIn before POST /auth/pin). A failed
// drain never blocks the login: what was not sent stays queued, or waits in the queue log for "Send again".
export const createShellHooks: (enqueue: Enqueue) => ShellHooks = (enqueue) => {
  const queue = queueOf(enqueue);
  // the line is cached per count so useSyncExternalStore sees a stable value
  let lastCount = -1;
  let lastLine: string | null = null;
  return {
    async beforeSignIn() {
      // nothing queued in this page's life (after a reload everything is in the log): no wait at all
      if (queue === null || enqueue.pendingCount() === 0) return;
      await queue.drain().catch(() => {});
    },
    queueLine() {
      const n = enqueue.pendingCount();
      if (n !== lastCount) {
        lastCount = n;
        lastLine = n === 0 ? null : fill(t('queue.waiting'), { n: String(n) });
      }
      return lastLine;
    },
    subscribe: (listener) => enqueue.subscribe(listener),
  };
};
