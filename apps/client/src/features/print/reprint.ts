import type { LineDetail } from '@pos/domain';
import type { HubResult } from '../../api/hub-admin';
import { newUlid } from '../../app/ulid';
import { t } from '../../i18n';
import { errorKey, fill } from '../../i18n/en';
import type { SlotAction } from '../kds/slots';
import type { OrderTicket } from '../pass/contracts';

// 03c §3.5, §6.1, §6.8; 03b v1.0.8 §8 (Q-50, Q-51); brief §3.6 03c-C02: the three Reprint actions. Each run() sends
// `ReprintTicket` on the screen's own session (the transport, IR-15) and answers a toast:
// - "Reprinting {n} tickets. It prints when the printer is back." (n = the ticket_ids the hub queued; a reprint is
//   queued even while the printer is down), "Nothing to reprint" when it queued none (`result.skipped`);
// - 404 ORDER_NOT_FOUND "This order has no tickets"; 403 PERMISSION_DENIED hides every Reprint (no toast); any other
//   refusal its catalogue words;
// - a network failure or a signed-out session rejects, so 03b shows its own error (AD-K9).
// 00 M47: a send that ended without an answer (network / signed out) keeps its command_id, and the next tap resends
// it, so the hub replays instead of printing twice; a definitive answer (2xx or a refusal) ends it. A tap while the
// same Reprint runs gets that run's promise (one command).

export interface ReprintResult {
  ticket_ids: string[];
  skipped: Array<{ ticket_id: string; reason: string }>;
}

/** What 03c needs from the screen's session (IR-15): the KDS station session, or the Pass staff session. */
export interface PrintTransport {
  /** `POST /commands/<kebab>` on the screen's session, with this command_id when given (else a new one) */
  command<T>(commandType: string, payload: Record<string, unknown>, commandId?: string): Promise<HubResult<T>>;
  /** `GET /queries/order-tickets?order_id` (03c §6.8; staff session with `reprint-ticket`) */
  orderTickets(order_id: string): Promise<HubResult<{ tickets: OrderTicket[] }>>;
  /** the session's `reprint-ticket` grant (a station session reprints its own station: true) */
  canReprint(): boolean;
  /**
   * IR-19 (optional): who the session is (the Pass: the signed-in staff id). A PERMISSION_DENIED hides Reprint only
   * while `session()` answers the same value; without it (the KDS) a denial lasts as before.
   */
  session?(): string | null;
}

export class ReprintUnanswered extends Error {}

type Refused = Exclude<HubResult<unknown>, { ok: true }>;

function queued(n: number): { toast: string } {
  return { toast: n > 0 ? fill(t('print.reprinting_queued'), { n: String(n) }) : t('print.nothing_to_reprint') };
}

/** One registration's Reprint state: the open command ids, the runs in flight, the takeover runs left half done. */
export function createReprinter(transport: PrintTransport, onDenied: () => void) {
  const ids = new Map<string, string>();
  const running = new Map<string, Promise<{ toast?: string }>>();
  // takeover key → the tickets not answered yet and how many the hub queued so far
  const partial = new Map<string, { left: string[]; n: number }>();
  /** IR-19: denied, and for which session (`transport.session()` at the 403; undefined when it has none) */
  let denied: { session: string | null | undefined } | null = null;
  const sessionNow = (): string | null | undefined => transport.session?.();

  const refusal = (answer: Refused, n = 0): { toast?: string } => {
    if (answer.error.kind !== 'api') throw new ReprintUnanswered(answer.error.kind);
    if (answer.error.code === 'PERMISSION_DENIED') {
      denied = { session: sessionNow() };
      onDenied();
      return n > 0 ? queued(n) : {};
    }
    if (n > 0) return queued(n);
    if (answer.error.code === 'ORDER_NOT_FOUND') return { toast: t('print.no_tickets') };
    return { toast: t(errorKey(answer.error.code)) };
  };

  /** One ReprintTicket for `key`, reusing its command_id after an unanswered send. */
  const send = async (key: string, payload: { order_id: string } | { ticket_id: string }): Promise<HubResult<ReprintResult>> => {
    const id = ids.get(key) ?? newUlid();
    ids.set(key, id);
    const answer = await transport.command<ReprintResult>('ReprintTicket', payload, id);
    if (answer.ok || answer.error.kind === 'api') ids.delete(key);
    return answer;
  };

  const once = (key: string, run: () => Promise<{ toast?: string }>): SlotAction => ({
    key: 'reprint',
    label: t('print.reprint'),
    run() {
      const inFlight = running.get(key);
      if (inFlight !== undefined) return inFlight;
      const started = run().finally(() => running.delete(key));
      running.set(key, started);
      return started;
    },
  });

  const byOrder = (key: string, order_id: string) =>
    once(key, async () => {
      const answer = await send(key, { order_id });
      return answer.ok ? queued(answer.data.ticket_ids.length) : refusal(answer);
    });

  return {
    // the open command ids are kept whatever the session; only the denial is scoped to it (IR-19)
    available: () => (denied === null || (transport.session !== undefined && denied.session !== sessionNow())) && transport.canReprint(),

    /**
     * KDS row (`surface: 'kds'`, a station session): the hub reprints only this station's tickets of the order (§3.5),
     * so one ReprintTicket by order. Shown only when the station has a printer (`ctx.has_printer`, Q-50).
     */
    kds: (line: LineDetail) => byOrder(`kds:order:${line.order_id}`, line.order_id),

    /** Pass card (§3.5): by order — the staff session reprints every station's ticket that has a printer. */
    card: (order_id: string) => byOrder(`card:order:${order_id}`, order_id),

    /**
     * Pass takeover row (`surface: 'takeover'`, the staff session; Q-51): a staff ReprintTicket by order would reprint
     * every station's tickets, so the row reads `order-tickets` and reprints, one ReprintTicket { ticket_id } each,
     * only the tickets of the takeover station that have a printer. The toast sums what the hub queued. After an
     * unanswered send the next tap continues with the tickets not answered yet (each keeps its command_id).
     */
    takeover: (line: LineDetail, station_id: string) => {
      const key = `takeover:${station_id}:${line.order_id}`;
      return once(key, async () => {
        let state = partial.get(key);
        if (state === undefined) {
          const read = await transport.orderTickets(line.order_id);
          if (!read.ok) return refusal(read);
          if (read.data.tickets.length === 0) return { toast: t('print.no_tickets') };
          state = { left: read.data.tickets.filter((tk) => tk.station_id === station_id && tk.has_printer).map((tk) => tk.ticket_id), n: 0 };
          partial.set(key, state);
        }
        while (state.left.length > 0) {
          const ticket_id = state.left[0]!;
          const answer = await send(`ticket:${ticket_id}`, { ticket_id });
          if (!answer.ok) {
            if (answer.error.kind !== 'api') throw new ReprintUnanswered(answer.error.kind); // kept for the next tap
            partial.delete(key);
            return refusal(answer, state.n);
          }
          state.n += answer.data.ticket_ids.length;
          state.left.shift();
        }
        partial.delete(key);
        return queued(state.n);
      });
    },
  };
}

export type Reprinter = ReturnType<typeof createReprinter>;
