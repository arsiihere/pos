// stub (W0.6); owned by lane Q, task 25c
import type { ShellHooks } from '../../shell/hooks';
import type { Enqueue } from '../../tables/contracts';

// 02b §8 Queue: the sign-in screen drains the queue first and shows "n waiting to send". Until 25c: nothing to wait
// for, no line.
export const createShellHooks: (enqueue: Enqueue) => ShellHooks = () => ({ beforeSignIn: async () => {}, queueLine: () => null, subscribe: () => () => {} });
