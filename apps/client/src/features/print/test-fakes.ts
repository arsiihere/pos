import type { LineDetail } from '@pos/domain';
import type { WsServerMessage } from '@pos/events';
import { vi } from 'vitest';
import type { HubResult } from '../../api/hub-admin';
import type { OrderTicket } from '../pass/contracts';
import type { PrintTransport } from './register';

// Test-only fakes for 03c's slot module (A4).

export function line(order_item_id: string, order_id = 'O1', station_id = 'S-T'): LineDetail {
  return {
    order_item_id,
    order_id,
    station_id,
    point_id: 'P-PASS',
    identifier: { kind: 'table', label: 'T4' },
    order_type: 'dine_in',
    item_name: 'Naan',
    units: 1,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 60_000,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
  };
}

export function ticket(ticket_id: string, station_id: string, has_printer: boolean): OrderTicket {
  return { ticket_id, station_id, station_name: station_id, fired_at: 1, printed: true, has_printer };
}

export const catchUp = (state: Record<string, unknown>): WsServerMessage => ({ type: 'catch_up', as_of_seq: 1, state });

export const event = (event_type: string, payload: Record<string, unknown>, seq = 2): WsServerMessage => ({
  type: 'event',
  seq,
  event: { event_id: `E${seq}`, event_type, schema_version: 1, payload },
});

export const fireDispatched = (order_item_ids: string[], station_id = 'S-T'): WsServerMessage =>
  event('FireDispatched', { station_id, order_item_ids, load_id: null, due_at: 1 });

export interface FakeTransport extends PrintTransport {
  commands: Array<{ type: string; payload: Record<string, unknown>; commandId: string | undefined }>;
  /** command answers wait for releaseCommands() when held */
  holdCommands: boolean;
  releaseCommands(): void;
  reads: string[];
  /** the next answers, in order (default: ticket_ids = every ticket asked for, nothing skipped) */
  reprintAnswers: Array<HubResult<{ ticket_ids: string[]; skipped: Array<{ ticket_id: string; reason: string }> }>>;
  ticketAnswers: Map<string, HubResult<{ tickets: OrderTicket[] }>>;
  /** order-tickets reads wait for release() when held */
  hold: boolean;
  release(): void;
  can: boolean;
}

export function fakeTransport(): FakeTransport {
  let waiting: Array<() => void> = [];
  let commandWaits: Array<() => void> = [];
  const f: FakeTransport = {
    holdCommands: false,
    releaseCommands() {
      const run = commandWaits;
      commandWaits = [];
      for (const r of run) r();
    },
    commands: [],
    reads: [],
    reprintAnswers: [],
    ticketAnswers: new Map(),
    hold: false,
    can: true,
    release() {
      const run = waiting;
      waiting = [];
      for (const r of run) r();
    },
    canReprint: () => f.can,
    command: vi.fn(async (type: string, payload: Record<string, unknown>, commandId?: string) => {
      f.commands.push({ type, payload, commandId });
      if (f.holdCommands) await new Promise<void>((r) => commandWaits.push(r));
      const next = f.reprintAnswers.shift();
      if (next !== undefined) return next;
      const ids = typeof payload['ticket_id'] === 'string' ? [payload['ticket_id']] : ['T-1'];
      return { ok: true as const, data: { ticket_ids: ids, skipped: [] } };
    }) as PrintTransport['command'],
    orderTickets: vi.fn(async (order_id: string) => {
      f.reads.push(order_id);
      if (f.hold) await new Promise<void>((r) => waiting.push(r));
      return f.ticketAnswers.get(order_id) ?? { ok: true as const, data: { tickets: [] } };
    }),
  };
  return f;
}
