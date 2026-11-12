// stub (W0.6); owned by lane D, task 23a
import type { UseTableLock } from '../contracts';

// 02a §8 Order screen (D61): Touch once a minute, Release on unmount, lock frames → banner. Until 23a: no banner,
// Send allowed, nothing sent.
export const useTableLock: UseTableLock = () => ({ banner: null, canSend: true, release: async () => {} });
