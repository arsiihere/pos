import { newUlid } from '../../../../app/ulid';
import { t } from '../../../../i18n';
import { errorKey } from '../../../../i18n/en';
import type { Shell } from '../../shell/hooks';
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

// ⚠️ 02b-TK L-CLIENT-4 item 2 (03c v1.0.16 §3.11 trigger 2, §6.14, §8; 02b v1.0.25 §3.2 step 10a): a Send & pay panel
// closed with the bill still open → `PrintTakeawaySlip { order_id, reason: 'pay_later' }`, sent once with its own
// command_id (never queued: a print needs the hub) and sent again with the SAME command_id after a lost reply or a 5xx,
// while the page lives, until a 2xx or a 4xx (D32: the hub answers a resend with the stored result, no second job).
// After the last retry (a final failure) the token is marked "Slip not printed — Print slip", as a Send-time miss.

/** The waits before each resend of a pay-later slip that got no answer (a lost reply, a 5xx); then it is a final failure. */
export const PAY_LATER_RETRY_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];

export type PayLaterShell = Pick<Shell, 'live' | 'api' | 'toasts'>;

/** the orders whose pay-later slip this page has sent: "once" per order (a double close sends nothing more) */
const payLaterSent = new WeakMap<object, Set<string>>();

export function printPayLaterSlip(shell: PayLaterShell, order_id: string, commandId: string = newUlid()): void {
  let sent = payLaterSent.get(shell.live);
  if (sent === undefined) payLaterSent.set(shell.live, (sent = new Set()));
  if (sent.has(order_id)) return;
  sent.add(order_id);
  const misses = slipMissesOf(shell);
  const attempt = async (n: number): Promise<void> => {
    const answer = await shell.api.command<SlipResult>('PrintTakeawaySlip', { order_id, reason: 'pay_later' }, { commandId });
    if (answer.ok) {
      const slip = answer.data;
      if (slip.printed) return shell.toasts.show({ text: t('takeaway.slip.printing'), tone: 'ok' });
      // 03c §8: a miss marks the token; setting_off, slip_held (and already_printed: the token has its slip) show nothing
      if (slipMissed(slip)) {
        misses.mark(order_id);
        shell.toasts.show({ text: t(slip.skipped === 'no_printer' ? 'takeaway.slip.no_printer' : 'takeaway.slip.not_printed'), tone: 'warn' });
      }
      return;
    }
    const e = answer.error;
    if (e.kind === 'api' && e.status < 500) {
      // a 4xx is final; billed = the token was paid meanwhile (the customer has the receipt): nothing to say
      if (e.code === 'TAKEAWAY_SLIP_NOT_ALLOWED' && e.details['reason'] === 'billed') return;
      return shell.toasts.show({ text: t(errorKey(e.code)), tone: 'warn' });
    }
    const wait = e.kind === 'signed_out' ? undefined : PAY_LATER_RETRY_MS[n];
    if (wait === undefined) {
      misses.mark(order_id);
      return shell.toasts.show({ text: t('takeaway.slip.not_printed'), tone: 'warn' });
    }
    setTimeout(() => void attempt(n + 1), wait);
  };
  void attempt(0);
}
