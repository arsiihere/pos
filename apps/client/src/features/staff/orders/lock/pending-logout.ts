import type { Device } from '../../api';
import type { Enqueue } from '../../tables/contracts';

// 02b v1.0.11 §8 Device idle lock, #35 S-4, owner Q-2 (25d): a logout the idle lock could not deliver (offline) is a
// PENDING LOGOUT kept by the app — not a queue entry — and sent before the next login. It lives in this page's memory
// only, with the token (00 §8.1): after a reload or restart it is gone (the hub idles the session out, 4 h cap).
// A 2xx, or a 401 (the hub had already ended the session), settles it; anything else keeps it.

export interface PendingLogout {
  /** a session token whose logout is still owed */
  add(sessionToken: string): void;
  count(): number;
  /** send every owed logout; true when none is left */
  flush(): Promise<boolean>;
}

export interface PendingLogoutOptions {
  device: Device;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  baseUrl?: string;
}

export function createPendingLogout(o: PendingLogoutOptions): PendingLogout {
  const tokens: string[] = [];
  const fetchFn = o.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  let flushing: Promise<boolean> | null = null;
  async function run(): Promise<boolean> {
    for (const token of [...tokens]) {
      let status: number;
      try {
        const response = await fetchFn(`${o.baseUrl ?? ''}/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${o.device.token}`, 'X-Session-Token': token, 'Content-Type': 'application/json' },
          body: '{}',
        });
        status = response.status;
      } catch {
        return false;
      }
      if ((status >= 200 && status < 300) || status === 401) tokens.splice(tokens.indexOf(token), 1);
      else return false;
    }
    return tokens.length === 0;
  }
  return {
    add(token) {
      if (!tokens.includes(token)) tokens.push(token);
    },
    count: () => tokens.length,
    flush() {
      if (flushing !== null) return flushing;
      flushing = run().finally(() => {
        flushing = null;
      });
      return flushing;
    },
  };
}

/** One pending logout per staff page (keyed by its Enqueue): the idle lock adds to it, the sign-in hooks send it. */
const registry = new WeakMap<Enqueue, PendingLogout>();

export function pendingLogoutOf(enqueue: Enqueue, make: () => PendingLogout): PendingLogout {
  let found = registry.get(enqueue);
  if (found === undefined) {
    found = make();
    registry.set(enqueue, found);
  }
  return found;
}

/** The page's pending logout if the idle lock made one, else null (the sign-in hooks only read it). */
export function peekPendingLogout(enqueue: Enqueue): PendingLogout | null {
  return registry.get(enqueue) ?? null;
}
