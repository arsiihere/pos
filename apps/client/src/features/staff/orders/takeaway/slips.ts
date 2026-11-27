import type { LiveBus } from '../../shell/live';

// ⚠️ 02b-TK L-CLIENT-3 item 2 (03c v1.0.16 §3.11 Result, §8; 02b v1.0.25 §3.2 step 11): the takeaway orders whose token
// slip did not print at Send (`slip.printed: false` with `no_printer`, `failed` or `replay_late`). Their token shows
// "Slip not printed — Print slip" until a Print token (PrintTakeawaySlip reprint) prints it. Kept in memory for the
// page's life (03c §8: after a reload the hint is gone; the token view's Print token stays).

export interface SlipResult {
  printed: boolean;
  job_id: string | null;
  skipped: string | null;
}

/** 03c §8: the skips that leave the customer without a slip ("Slip not printed — Print slip"). */
export const SLIP_MISSES: ReadonlySet<string> = new Set(['no_printer', 'failed', 'replay_late']);

export const slipMissed = (slip: SlipResult | null | undefined): boolean => slip != null && !slip.printed && slip.skipped !== null && SLIP_MISSES.has(slip.skipped);

export interface SlipMisses {
  missed(order_ids: readonly string[]): boolean;
  mark(order_id: string): void;
  clear(order_ids: readonly string[]): void;
  version(): number;
  subscribe(listener: () => void): () => void;
}

function createSlipMisses(): SlipMisses {
  const ids = new Set<string>();
  const listeners = new Set<() => void>();
  let v = 0;
  const changed = () => {
    v += 1;
    for (const l of [...listeners]) l();
  };
  return {
    missed: (order_ids) => order_ids.some((id) => ids.has(id)),
    mark(order_id) {
      ids.add(order_id);
      changed();
    },
    clear(order_ids) {
      if (order_ids.filter((id) => ids.delete(id)).length > 0) changed();
    },
    version: () => v,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const perPage = new WeakMap<object, SlipMisses>();

/** One store per staff page (keyed by its live bus), for the page's life. */
export function slipMissesOf(shell: { live: LiveBus }): SlipMisses {
  let store = perPage.get(shell.live);
  if (store === undefined) perPage.set(shell.live, (store = createSlipMisses()));
  return store;
}
