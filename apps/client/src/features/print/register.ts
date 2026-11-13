import type { HubResult } from '../../api/hub-admin';
import { t } from '../../i18n';
import { notifySlots, registerLineAction, registerLineTag, registerPassCardAction, subscribeFrames } from '../kds/slots';
import type { OrderTicket } from '../pass/contracts';
import { createPrintedSet, type PrintedSet } from './printed';
import { createReprinter, type PrintTransport, type Reprinter } from './reprint';
import { createTicketsCache, type TicketsCache } from './tickets-cache';

export type { PrintTransport };

/**
 * 03c §3.5, §3.8 (D12, Q-50; task A4): registers 03c's `printed` tag and Reprint actions into `features/kds/slots.ts`
 * (line tag, line action, Pass card action, frame subscription). Called once by each 03b screen's entry (KDS, Pass)
 * at module scope, before it renders — never inside a component or effect.
 *
 * IR-15 (integrator ruling 2026-11-13): `transport` is the screen's session (`ReprintTicket` with an optional
 * command_id, `order-tickets`, the `reprint-ticket` grant). Without it only the `printed` tag is registered. A second
 * call replaces the first registration (StrictMode, or a later call with the transport), never duplicates, and keeps
 * what the screen already learned: the `printed` set, the ticket cache and, for the same transport, the open command
 * ids. The returned function unregisters everything and forgets that state.
 */

interface State {
  printed: PrintedSet;
  cache: TicketsCache;
  transport: PrintTransport | null;
  reprinter: Reprinter | null;
  offs: Array<() => void>;
}

let state: State | null = null;

function fresh(): State {
  const s: State = {
    printed: createPrintedSet(),
    // the cache reads through whichever transport is registered now
    cache: createTicketsCache(
      (order_id): Promise<HubResult<{ tickets: OrderTicket[] }>> =>
        s.transport === null ? Promise.resolve({ ok: false, error: { kind: 'network' } }) : s.transport.orderTickets(order_id),
      notifySlots,
    ),
    transport: null,
    reprinter: null,
    offs: [],
  };
  return s;
}

export function registerPrintSlots(transport?: PrintTransport): () => void {
  const s = state ?? fresh();
  for (const off of s.offs) off();
  s.offs = [];
  state = s;
  if ((transport ?? null) !== s.transport) {
    s.transport = transport ?? null;
    s.reprinter = transport === undefined ? null : createReprinter(transport, notifySlots);
  }

  s.offs.push(registerLineTag((line) => (s.printed.has(line.order_item_id) ? { key: 'printed', label: t('print.tag.printed') } : null)));
  s.offs.push(
    subscribeFrames((frame) => {
      let changed = s.printed.apply(frame);
      // §3.10: the station's has_printer changed; 03b re-renders its rows with the new ctx.has_printer
      if (frame.type === 'station_notice' && frame.kind === 'output') changed = true;
      if (s.transport !== null) s.cache.apply(frame);
      if (changed) notifySlots();
    }),
  );

  const reprinter = s.reprinter;
  if (reprinter !== null) {
    // KDS rows and Pass takeover rows of a station with a printer (Q-50, Q-51)
    s.offs.push(
      registerLineAction((line, ctx) => {
        if (!ctx.has_printer || !reprinter.available()) return null;
        return ctx.surface === 'kds' ? reprinter.kds(line) : reprinter.takeover(line, ctx.station_id);
      }),
    );
    // Pass card: only with reprint-ticket, once a cached ticket of the order has a printer (Q-52)
    s.offs.push(
      registerPassCardAction((order) => {
        if (!reprinter.available()) return null;
        const tickets = s.cache.tickets(order.order_id);
        return tickets?.some((tk) => tk.has_printer) === true ? reprinter.card(order.order_id) : null;
      }),
    );
  }

  const offs = s.offs;
  return () => {
    if (state !== s || s.offs !== offs) return; // replaced since: that registration owns the slots now
    for (const off of offs) off();
    state = null;
  };
}
