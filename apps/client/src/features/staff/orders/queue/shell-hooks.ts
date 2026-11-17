// owned by lane Q, task 25c (was the W0.6 stub)
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { ShellHooks } from '../../shell/hooks';
import type { Enqueue } from '../../tables/contracts';
import { peekPendingLogout } from '../lock/pending-logout';
import { queueOf } from './enqueue';

// 02b v1.0.11 §8 Queue, §3.12: "The queue is drained before a new login is offered on the device": the sign-in
// screen shows "2 waiting to send" and sends them first (SignIn awaits beforeSignIn before POST /auth/pin). A failed
// drain never blocks the login: what was not sent stays queued, or waits in the queue log for "Send again". Then
// the idle lock's pending logout, if any (25d).
export const createShellHooks: (enqueue: Enqueue) => ShellHooks = (enqueue) => {
  const queue = queueOf(enqueue);
  // the line is cached per count so useSyncExternalStore sees a stable value
  let lastCount = -1;
  let lastLine: string | null = null;
  return {
    async beforeSignIn() {
      // nothing queued in this page's life (after a reload everything is in the log): no wait at all
      if (queue !== null && enqueue.pendingCount() > 0) await queue.drain().catch(() => {});
      // 25d, #35 S-4: a logout the idle lock owes is sent before the next login (after the drain)
      await peekPendingLogout(enqueue)?.flush().catch(() => false);
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
