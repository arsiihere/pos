import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PosEvent } from '@pos/events';
import { bindTicketsLog, queueKitchenJob, ticketsProjection } from '../../src/print/tickets-projection';
import { createProjectionRegistry } from '../../src/projections/registry';
import { statementCounter } from '../helpers/statement-counter';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { FX, appendOrder, append as kdsAppend, fireLines, openDay, removeLine, serveLines, voidLine } from '../kds/fixtures';

// 03c §3.3, §3.5, P9 (task c8): CANCELLED / FIRST slip jobs, reprint jobs and the kitchen re-create ids, folded by
// `kitchen_tickets` from real events through the hub writer. "Printed" (§3.1) needs a sent kitchen job: the worker
// (c14) sets `sent_at`; here the test sets it on the real row, as the worker would.
let hub: TestHub;

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  openDay(hub);
  printer('PR1');
});
afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

const branch = (): string => hub.deps.config.provisioned!.branch_id;
function hubEvent(event_type: 'PrinterSaved' | 'StationOutputSet', payload: Record<string, unknown>): void {
  kdsAppend(hub, [{ stream_type: 'hub', stream_id: branch(), event_type, payload }], { actor: null });
}
function output(station_id: string, mode: 'screen' | 'both' | 'printer', printer_id: string | null): void {
  hubEvent('StationOutputSet', { station_id, mode, printer_id, show_taker: true, show_order_id: true });
}
function printer(printer_id: string): void {
  hubEvent('PrinterSaved', { printer_id, name: printer_id, connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false });
}
function order(prefix: string, lines: Array<{ n: number; quantity?: number }>): string {
  return appendOrder(hub, {
    order_type: 'takeaway',
    lines: lines.map((l) => ({ order_item_id: `${prefix}${l.n}`, item_id: FX.naan, quantity: l.quantity ?? 1 })),
  }).order_id;
}
const jobs = (kind?: string) =>
  (hub.deps.db
    .prepare(`SELECT job_id, kind, printer_id, station_id, ticket_id, order_id, payload, created_at FROM print_jobs ${kind === undefined ? '' : 'WHERE kind = ?'} ORDER BY created_at, job_id`)
    .all(...(kind === undefined ? [] : [kind])) as Array<{ job_id: string; kind: string; station_id: string | null; ticket_id: string; payload: string; created_at: number }>).map((j) => ({
    ...j,
    payload: JSON.parse(j.payload) as Record<string, unknown>,
  }));
/** The worker's send + ack on the ticket's kitchen jobs (c14), on the real rows. */
function printed(ticket_id: string): void {
  const at = hub.clock.branchNow();
  hub.deps.db.prepare(`UPDATE print_jobs SET sent_at = ?, sent_printer_id = 'PR1', acked_at = ? WHERE ticket_id = ? AND kind = 'kitchen' AND cancelled_at IS NULL`).run(at, at, ticket_id);
}
const ticketOf = (order_item_id: string) =>
  hub.deps.db.prepare('SELECT ticket_id FROM ticket_lines WHERE order_item_id = ?').pluck().get(order_item_id) as string;

describe('[03c #3, #4] CANCELLED slips', () => {
  it('[03c #3, §3.3] partial removal of a printed line → cancel { units }; whole removal → units null; job station-routed, live', () => {
    output(FX.station, 'both', 'PR1');
    const a = order('A', [{ n: 1, quantity: 4 }, { n: 2 }]);
    fireLines(hub, FX.station, ['A1', 'A2']);
    const ticket = ticketOf('A1');
    printed(ticket);
    const [partial] = removeLine(hub, a, 'A1', 1);
    const [whole] = removeLine(hub, a, 'A2');
    expect(jobs('cancel')).toEqual([
      { job_id: `${partial!.event_id}:cancel:1`, kind: 'cancel', printer_id: null, station_id: FX.station, ticket_id: ticket, order_id: a, payload: { ticket_id: ticket, order_item_id: 'A1', units: 1 }, created_at: partial!.recorded_at },
      { job_id: `${whole!.event_id}:cancel:1`, kind: 'cancel', printer_id: null, station_id: FX.station, ticket_id: ticket, order_id: a, payload: { ticket_id: ticket, order_item_id: 'A2', units: null }, created_at: whole!.recorded_at },
    ]);
    // the fold never reads the units left: they are rendered at send from order_lines (D2), whichever projection folds first
    expect(hub.deps.db.prepare(`SELECT units - removed_units AS left FROM order_lines WHERE order_item_id = 'A1'`).pluck().get()).toBe(3);
  });

  it('[03c #3, §3.3] removal of an unprinted line (job not yet sent, or no printer at all) → no slip', () => {
    output(FX.station, 'both', 'PR1');
    const a = order('A', [{ n: 1, quantity: 4 }]);
    fireLines(hub, FX.station, ['A1']);
    removeLine(hub, a, 'A1', 1);
    const b = order('B', [{ n: 1 }]);
    output(FX.station, 'screen', null);
    fireLines(hub, FX.station, ['B1']);
    removeLine(hub, b, 'B1');
    expect(jobs('cancel')).toEqual([]);
  });

  it('[03c #4, §3.3] void of a printed, not-done line → CANCELLED with its units; a done (or served) line → nothing', () => {
    output(FX.station, 'printer', 'PR1');
    const a = order('A', [{ n: 1, quantity: 3 }, { n: 2, quantity: 2 }, { n: 3 }]);
    fireLines(hub, FX.station, ['A1', 'A2', 'A3']);
    printed(ticketOf('A1'));
    const [v] = voidLine(hub, a, 'A1', 2);
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'ItemDone', payload: { order_item_id: 'A2', done_at: hub.clock.branchNow(), source: 'tap' } }]);
    voidLine(hub, a, 'A2', 1);
    serveLines(hub, a, ['A3']);
    voidLine(hub, a, 'A3', 1);
    expect(jobs('cancel').map((j) => [j.job_id, j.payload])).toEqual([[`${v!.event_id}:cancel:1`, { ticket_id: ticketOf('A1'), order_item_id: 'A1', units: 2 }]]);
  });

  it('[03c §3.1] "printed" counts a sent reprint job too; a cancelled kitchen job does not', () => {
    output(FX.station, 'both', 'PR1');
    const a = order('A', [{ n: 1, quantity: 4 }]);
    fireLines(hub, FX.station, ['A1']);
    const ticket = ticketOf('A1');
    hub.deps.db.prepare(`UPDATE print_jobs SET sent_at = 1, cancelled_at = 2 WHERE ticket_id = ?`).run(ticket);
    removeLine(hub, a, 'A1', 1);
    expect(jobs('cancel')).toEqual([]);
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'TicketReprinted', payload: { order_id: a, station_id: null, ticket_ids: [ticket] } }]);
    hub.deps.db.prepare(`UPDATE print_jobs SET sent_at = 3 WHERE kind = 'reprint'`).run();
    removeLine(hub, a, 'A1', 1);
    expect(jobs('cancel')).toHaveLength(1);
  });
});

describe('[03c #5] FIRST slips', () => {
  it('[03c #5, §3.3, P9] boost on a printed ticket at a printer station → FIRST with its not-done lines; both / screen → none', () => {
    printer('PR2');
    output(FX.station, 'printer', 'PR1');
    output(FX.zoneStation, 'both', 'PR2');
    // FX.naan goes to S1 for takeaway; the second ticket's lines are fired at S2 by the test
    const a = order('A', [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
    fireLines(hub, FX.station, ['A1', 'A2', 'A3']);
    fireLines(hub, FX.zoneStation, ['A4']);
    printed(ticketOf('A1'));
    printed(ticketOf('A4'));
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'ItemDone', payload: { order_item_id: 'A3', done_at: hub.clock.branchNow(), source: 'tap' } }]);
    const [boost] = kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'OrderBoosted', payload: { order_id: a } }], { actor: 'S_MGR' });
    expect(jobs('first')).toEqual([
      {
        job_id: `${boost!.event_id}:first:1`,
        kind: 'first',
        printer_id: null,
        station_id: FX.station,
        ticket_id: ticketOf('A1'),
        order_id: a,
        payload: { ticket_id: ticketOf('A1'), order_item_ids: ['A1', 'A2'], reason: 'boost' },
        created_at: boost!.recorded_at,
      },
    ]);
    output(FX.station, 'screen', 'PR1');
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'OrderBoosted', payload: { order_id: a } }], { actor: 'S_MGR' });
    expect(jobs('first')).toHaveLength(1);
  });

  it('[03c #5, §3.3] ItemsReleased { expedite } → FIRST for the expedited printed lines only; an unprinted ticket → none; a pull never yields FIRST', () => {
    output(FX.station, 'printer', 'PR1');
    const a = order('A', [{ n: 1 }, { n: 2 }]);
    const b = order('B', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1', 'A2']);
    printed(ticketOf('A1'));
    const [released] = kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'ItemsReleased', payload: { order_id: a, alert_id: null, released: [], expedite: ['A2'] } }], { actor: 'S_MGR' });
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'ItemsReleased', payload: { order_id: a, alert_id: null, released: ['A1'], expedite: [] } }], { actor: 'S_MGR' });
    fireLines(hub, FX.station, ['B1'], 'pulled');
    kdsAppend(hub, [{ stream_type: 'order', stream_id: b, event_type: 'ItemsReleased', payload: { order_id: b, alert_id: null, released: [], expedite: ['B1'] } }], { actor: 'S_MGR' });
    expect(jobs('first').map((j) => [j.job_id, j.payload])).toEqual([[`${released!.event_id}:first:1`, { ticket_id: ticketOf('A1'), order_item_ids: ['A2'], reason: 'expedite' }]]);
    expect(jobs().filter((j) => j.ticket_id === ticketOf('B1')).map((j) => j.kind)).toEqual(['kitchen']);
  });
});

describe('[03c §3.3, §3.5] reprint jobs and history', () => {
  it('[03c §3.3] TicketReprinted { ticket_ids } → a reprint job per ticket, id event_id:reprint:n; unknown ids passed over', () => {
    const a = order('A', [{ n: 1 }, { n: 2 }]);
    fireLines(hub, FX.station, ['A1']);
    fireLines(hub, FX.zoneStation, ['A2']);
    const t1 = ticketOf('A1');
    const t2 = ticketOf('A2');
    const [e] = kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'TicketReprinted', payload: { order_id: a, station_id: null, ticket_ids: [t2, 'NOPE', t1] } }]);
    expect(jobs('reprint').map((j) => [j.job_id, j.station_id, j.ticket_id, j.payload])).toEqual(
      [
        [`${e!.event_id}:reprint:1`, FX.zoneStation, t2, { ticket_id: t2 }],
        [`${e!.event_id}:reprint:3`, FX.station, t1, { ticket_id: t1 }],
      ].sort((x, y) => (x[0] as string).localeCompare(y[0] as string)),
    );
  });

  it('[03c D1] slip and reprint events in catch-up write no job', () => {
    output(FX.station, 'printer', 'PR1');
    const a = order('A', [{ n: 1, quantity: 2 }]);
    fireLines(hub, FX.station, ['A1']);
    printed(ticketOf('A1'));
    removeLine(hub, a, 'A1', 1);
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'OrderBoosted', payload: { order_id: a } }], { actor: 'S_MGR' });
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'TicketReprinted', payload: { order_id: a, station_id: null, ticket_ids: [ticketOf('A1')] } }]);
    expect(jobs().map((j) => j.kind).sort()).toEqual(['cancel', 'first', 'kitchen', 'reprint']);
    hub.deps.db.prepare('DELETE FROM print_jobs').run();
    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'kitchen_tickets'`).run();
    hub.deps.projections.catchUp(hub.deps.db, branch());
    expect(jobs()).toEqual([]);
  });
});

describe('[03c #6, §3.3] kitchen re-create ids', () => {
  it('[03c #6, §3.3] after a cancelled kitchen job a new one takes ticket_id:kitchen:2, then :3; never two live kitchen jobs', () => {
    const a = order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']); // screen: no job at fire
    const ticket = { ticket_id: ticketOf('A1'), station_id: FX.station, order_id: a };
    const tx = hub.deps.db;
    expect(queueKitchenJob(tx, ticket, 1)).toBe(`${ticket.ticket_id}:kitchen`);
    expect(queueKitchenJob(tx, ticket, 2)).toBeNull();
    // the worker's empty-render cancel (Done before send, §3.6), on the real row
    tx.prepare(`UPDATE print_jobs SET cancelled_at = 3 WHERE job_id = ?`).run(`${ticket.ticket_id}:kitchen`);
    expect(queueKitchenJob(tx, ticket, 4)).toBe(`${ticket.ticket_id}:kitchen:2`);
    expect(queueKitchenJob(tx, ticket, 5)).toBeNull();
    tx.prepare(`UPDATE print_jobs SET cancelled_at = 6 WHERE job_id = ?`).run(`${ticket.ticket_id}:kitchen:2`);
    expect(queueKitchenJob(tx, ticket, 7)).toBe(`${ticket.ticket_id}:kitchen:3`);
    expect(jobs('kitchen').map((j) => [j.job_id, j.payload, j.created_at])).toEqual([
      [`${ticket.ticket_id}:kitchen`, { ticket_id: ticket.ticket_id }, 1],
      [`${ticket.ticket_id}:kitchen:2`, { ticket_id: ticket.ticket_id }, 4],
      [`${ticket.ticket_id}:kitchen:3`, { ticket_id: ticket.ticket_id }, 7],
    ]);
  });

  it('[03c #6] an at-fire kitchen job cancelled by a manager is re-created as :kitchen:2', () => {
    output(FX.station, 'both', 'PR1');
    const a = order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']);
    const ticket_id = ticketOf('A1');
    hub.deps.db.prepare(`UPDATE print_jobs SET cancelled_at = 1 WHERE job_id = ?`).run(`${ticket_id}:kitchen`);
    expect(queueKitchenJob(hub.deps.db, { ticket_id, station_id: FX.station, order_id: a }, 2)).toBe(`${ticket_id}:kitchen:2`);
  });
});

describe('[03c §3.3] slip fold cost', () => {
  it('[03c §3.3] ≤ 3 reads + multi-row inserts: cancel 1 read + 1 insert, first 1 + 1, reprint 1 insert', () => {
    output(FX.station, 'printer', 'PR1');
    const a = order('A', [{ n: 1, quantity: 2 }, { n: 2 }]);
    fireLines(hub, FX.station, ['A1', 'A2']);
    const ticket = ticketOf('A1');
    printed(ticket);
    const projection = ticketsProjection(createProjectionRegistry());
    const at = hub.clock.branchNow();
    const event = (event_id: string, event_type: string, payload: Record<string, unknown>): PosEvent =>
      ({ event_id, tenant_id: 'tenant-a', branch_id: branch(), stream_type: 'order', stream_id: a, event_type, schema_version: 1, payload, occurred_at: at, recorded_at: at, actor_id: null, device_id: 'hub', seq: 999_999 }) as PosEvent;
    const cost = (e: PosEvent): number => {
      const counter = statementCounter(hub.deps.db);
      hub.deps.db.transaction(() => projection.apply(hub.deps.db, e, 'live'))();
      return counter.count;
    };
    expect(cost(event('E1', 'ItemRemoved', { order_item_id: 'A1', units: 1 }))).toBe(2);
    expect(cost(event('E2', 'OrderBoosted', { order_id: a }))).toBe(2);
    expect(cost(event('E3', 'TicketReprinted', { order_id: a, station_id: null, ticket_ids: [ticket] }))).toBe(1);
    expect(jobs().map((j) => j.job_id).filter((id) => id.startsWith('E'))).toEqual(['E1:cancel:1', 'E2:first:1', 'E3:reprint:1']);
  });
});

describe('[03c §3.3] a failed slip / reprint fold is never silent', () => {
  const failInserts = (kind: string) =>
    hub.deps.db.exec(`CREATE TRIGGER fail_${kind} BEFORE INSERT ON print_jobs WHEN NEW.kind = '${kind}' BEGIN SELECT RAISE(ABORT, 'disk says no'); END`);
  const skipRows = () => hub.deps.db.prepare('SELECT event_id, station_id, reason FROM print_fold_skips ORDER BY at, event_id').all();

  it('[03c §3.3] cancel / first / reprint insert failures → the event commits; print_fold_skips row with the ticket\'s station (it has a printer); log line', () => {
    const logged: string[] = [];
    bindTicketsLog(hub.deps.projections, (line) => logged.push(`${line.event_type}:${line.station_id ?? '-'}:${line.reason}`));
    output(FX.station, 'printer', 'PR1');
    const a = order('A', [{ n: 1, quantity: 3 }]);
    fireLines(hub, FX.station, ['A1']);
    printed(ticketOf('A1'));
    for (const kind of ['cancel', 'first', 'reprint']) failInserts(kind);
    const [removed] = removeLine(hub, a, 'A1', 1);
    const [boost] = kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'OrderBoosted', payload: { order_id: a } }], { actor: 'S_MGR' });
    const [reprint] = kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'TicketReprinted', payload: { order_id: a, station_id: null, ticket_ids: [ticketOf('A1')] } }]);
    expect(hub.deps.db.prepare(`SELECT units - removed_units FROM order_lines WHERE order_item_id = 'A1'`).pluck().get()).toBe(2);
    expect(jobs().map((j) => j.kind)).toEqual(['kitchen']);
    expect(skipRows()).toEqual([
      { event_id: removed!.event_id, station_id: FX.station, reason: 'fold_error' },
      { event_id: boost!.event_id, station_id: FX.station, reason: 'fold_error' },
      { event_id: reprint!.event_id, station_id: FX.station, reason: 'fold_error' },
    ]);
    expect(logged).toEqual([`ItemRemoved:${FX.station}:fold_error`, `OrderBoosted:${FX.station}:fold_error`, `TicketReprinted:${FX.station}:fold_error`]);
  });

  it('[03c §3.3] a failed reprint at a station with no printer → log line only, no skip row', () => {
    const logged: string[] = [];
    bindTicketsLog(hub.deps.projections, (line) => logged.push(`${line.event_type}:${line.station_id ?? '-'}`));
    const a = order('A', [{ n: 1 }]);
    fireLines(hub, FX.station, ['A1']); // no station_outputs row: screen, no printer
    failInserts('reprint');
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'TicketReprinted', payload: { order_id: a, station_id: null, ticket_ids: [ticketOf('A1')] } }]);
    expect(skipRows()).toEqual([]);
    expect(logged).toEqual([`TicketReprinted:${FX.station}`]);
  });
});
