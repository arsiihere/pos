import type { EngineState } from '@pos/engine';
import type { EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerKdsProjections } from '../../src/kds/index';
import { registerOrdersProjection } from '../../src/orders/index';
import { bindTicketsLog, ticketsProjection, type FoldSkippedLine } from '../../src/print/tickets-projection';
import { createProjectionRegistry } from '../../src/projections/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { FX, appendOrder, append as kdsAppend, fireLines, openDay, serveLines } from '../kds/fixtures';

// 03c §3.3, D1 (task c7): projection `kitchen_tickets` over the real 0015 tables, fed real events through the hub
// writer (02b orders via the shared fixtures, FireDispatched on the station stream, PrinterSaved / StationOutputSet on
// the hub stream).
let hub: TestHub;
let skips: FoldSkippedLine[];

beforeEach(async () => {
  hub = await createTestHub({ provisioned: true });
  skips = [];
  bindTicketsLog(hub.deps.projections, (line) => skips.push(line));
  openDay(hub);
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

/** A takeaway order of `n` naan lines `<prefix>1..n` (S1). */
function order(prefix: string, n = 2): string {
  return appendOrder(hub, {
    order_type: 'takeaway',
    lines: Array.from({ length: n }, (_, i) => ({ order_item_id: `${prefix}${i + 1}`, item_id: FX.naan })),
  }).order_id;
}
const rows = (sql: string, ...args: unknown[]) => hub.deps.db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
const tickets = () => rows('SELECT ticket_id, station_id, order_id, fire_event_id, fired_at, reason FROM tickets ORDER BY order_id');
const ticketLines = () => rows('SELECT order_item_id, ticket_id, station_id, done_at FROM ticket_lines ORDER BY order_item_id');
const jobs = () => rows('SELECT job_id, kind, printer_id, station_id, ticket_id, order_id, payload, created_at, sent_at, acked_at, cancelled_at FROM print_jobs ORDER BY job_id');
const fireDraft = (station_id: string, order_item_ids: string[]): Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id' | 'schema_version'> => ({
  stream_type: 'station',
  stream_id: station_id,
  event_type: 'FireDispatched',
  payload: { station_id, order_item_ids, load_id: null, due_at: hub.clock.branchNow(), reason: 'scheduled' },
});

describe('[03c #2] tickets at fire', () => {
  it('[03c #2, §3.3] one fire, two orders → two tickets; output both → two kitchen jobs (live, station-routed)', () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    const a = order('A');
    const b = order('B');
    const [fire] = fireLines(hub, FX.station, ['A1', 'B1', 'A2'], 'scheduled');
    const t = (o: string) => `${fire!.event_id}:${o}`;
    expect(tickets()).toEqual(
      [a, b]
        .sort()
        .map((o) => ({ ticket_id: t(o), station_id: FX.station, order_id: o, fire_event_id: fire!.event_id, fired_at: fire!.recorded_at, reason: 'scheduled' })),
    );
    expect(ticketLines()).toEqual([
      { order_item_id: 'A1', ticket_id: t(a), station_id: FX.station, done_at: null },
      { order_item_id: 'A2', ticket_id: t(a), station_id: FX.station, done_at: null },
      { order_item_id: 'B1', ticket_id: t(b), station_id: FX.station, done_at: null },
    ]);
    const job = (o: string) => ({
      job_id: `${t(o)}:kitchen`,
      kind: 'kitchen',
      printer_id: null,
      station_id: FX.station,
      ticket_id: t(o),
      order_id: o,
      payload: JSON.stringify({ ticket_id: t(o) }),
      created_at: fire!.recorded_at,
      sent_at: null,
      acked_at: null,
      cancelled_at: null,
    });
    expect(jobs()).toEqual([a, b].map(job).sort((x, y) => x.job_id.localeCompare(y.job_id)));
  });

  it('[03c #2, §3.3] the jobs are written in the fire\'s own transaction: a rolled-back fire leaves no ticket and no job', () => {
    printer('PR1');
    output(FX.station, 'printer', 'PR1');
    order('A');
    expect(() =>
      hub.deps.writer.run((tx) => {
        tx.append([{ ...fireDraft(FX.station, ['A1']), occurred_at: hub.clock.branchNow(), actor_id: null, device_id: 'hub', schema_version: 1 }]);
        expect(rows('SELECT kind FROM print_jobs')).toEqual([{ kind: 'kitchen' }]);
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(tickets()).toEqual([]);
    expect(jobs()).toEqual([]);
  });

  it('[03c #2, §3.2] output printer → a job; screen (with or without a fallback printer) or no row → tickets, no job', () => {
    printer('PR1');
    order('A', 4);
    fireLines(hub, FX.station, ['A1']); // no station_outputs row = screen
    output(FX.station, 'screen', null);
    fireLines(hub, FX.station, ['A2']);
    output(FX.station, 'screen', 'PR1');
    fireLines(hub, FX.station, ['A3']);
    expect(tickets()).toHaveLength(3);
    expect(jobs()).toEqual([]);
    output(FX.station, 'printer', 'PR1');
    const [fire] = fireLines(hub, FX.station, ['A4']);
    expect(jobs().map((j) => j.ticket_id)).toEqual([`${fire!.event_id}:${tickets()[0]!.order_id as string}`]);
    expect(skips).toEqual([]);
  });

  it('[03c §3.3] ItemDone / ItemServed set ticket_lines.done_at; ItemDoneUndone clears it', () => {
    const a = order('A', 3);
    fireLines(hub, FX.station, ['A1', 'A2', 'A3']);
    const at = hub.clock.branchNow();
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'ItemDone', payload: { order_item_id: 'A1', done_at: at + 500, source: 'tap' } }]);
    const done = (id: string) => ticketLines().find((l) => l.order_item_id === id)!.done_at;
    expect(done('A1')).toBe(at + 500);
    kdsAppend(hub, [{ stream_type: 'order', stream_id: a, event_type: 'ItemDoneUndone', payload: { order_item_id: 'A1' } }]);
    expect(done('A1')).toBeNull();
    const [served] = serveLines(hub, a, ['A2']);
    expect(done('A2')).toBe(served!.recorded_at);
    expect(done('A3')).toBeNull();
  });

  it('[03c §3.3] a fire costs ≤ 3 reads + multi-row inserts (2 reads, 3 inserts for two orders)', () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    order('A');
    order('B');
    const registry = createProjectionRegistry();
    const projection = ticketsProjection(registry);
    hub.clock.advance(1_000);
    const at = hub.clock.branchNow();
    const event = {
      event_id: 'E_FIRE',
      tenant_id: 'tenant-a',
      branch_id: branch(),
      stream_type: 'station' as const,
      stream_id: FX.station,
      event_type: 'FireDispatched',
      schema_version: 1,
      payload: { station_id: FX.station, order_item_ids: ['A1', 'B1', 'B2'], load_id: null, due_at: at, reason: 'scheduled' },
      occurred_at: at,
      recorded_at: at,
      actor_id: null,
      device_id: 'hub',
      seq: 999_999,
    };
    const counter = statementCounter(hub.deps.db);
    hub.deps.db.transaction(() => projection.apply(hub.deps.db, event, 'live'))();
    // reads: order_lines, station_outputs; inserts: tickets, ticket_lines, print_jobs
    expect(counter.count).toBe(5);
    expect(jobs()).toHaveLength(2);
  });
});

describe('[03c #7] history never prints', () => {
  it('[03c #7, D1] 500 historical fires, no checkpoint → catch-up folds every ticket and writes 0 jobs; same for a restored tail', { timeout: 120_000 }, () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    // 50 orders × 10 lines, each line its own fire; an order's lines are served after its fires (speed only: the
    // engine's per-fire cost grows with the lines still open at the station)
    for (let o = 0; o < 50; o += 1) {
      const id = order(`O${o}_`, 10);
      const lines = Array.from({ length: 10 }, (_, i) => `O${o}_${i + 1}`);
      for (const line of lines) fireLines(hub, FX.station, [line]);
      serveLines(hub, id, lines);
    }
    const live = { tickets: tickets(), lines: ticketLines() };
    expect(live.tickets).toHaveLength(500);
    expect(jobs()).toHaveLength(500);

    // a hub whose kitchen_tickets has never run (no checkpoint, empty tables): boot catch-up from seq 0
    const wipe = () => {
      hub.deps.db.prepare('DELETE FROM print_jobs').run();
      hub.deps.db.prepare('DELETE FROM ticket_lines').run();
      hub.deps.db.prepare('DELETE FROM tickets').run();
    };
    wipe();
    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'kitchen_tickets'`).run();
    const replay = () => {
      const registry = createProjectionRegistry();
      registry.register(ticketsProjection(registry));
      return registry.catchUp(hub.deps.db, branch()).replayed.kitchen_tickets ?? 0;
    };
    expect(replay()).toBeGreaterThanOrEqual(500);
    expect({ tickets: tickets(), lines: ticketLines() }).toEqual(live);
    expect(jobs()).toEqual([]);
    expect(rows('SELECT * FROM print_fold_skips')).toEqual([]);

    // a restore: the backup copy has the projection up to seq N; the tail after N replays in catch-up
    const mid = (hub.deps.db.prepare(`SELECT seq FROM events WHERE event_type = 'FireDispatched' ORDER BY seq LIMIT 1 OFFSET 250`).pluck().get() as number) - 1;
    hub.deps.db.prepare(`DELETE FROM ticket_lines WHERE ticket_id IN (SELECT ticket_id FROM tickets WHERE fire_event_id IN (SELECT event_id FROM events WHERE seq > ?))`).run(mid);
    hub.deps.db.prepare(`DELETE FROM tickets WHERE fire_event_id IN (SELECT event_id FROM events WHERE seq > ?)`).run(mid);
    hub.deps.db.prepare(`UPDATE projection_checkpoints SET last_seq = ? WHERE projection = 'kitchen_tickets'`).run(mid);
    expect(tickets()).toHaveLength(250);
    replay();
    expect({ tickets: tickets(), lines: ticketLines() }).toEqual(live);
    expect(jobs()).toEqual([]);
  });
});

describe('[03c #8] total fold', () => {
  it('[03c #8, §3.3] a fire id missing from order_lines at a both station → the fire commits, no ticket, a print_fold_skips row, print.fold_skipped logged', () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    const a = order('A');
    hub.deps.db.prepare(`DELETE FROM order_lines WHERE order_item_id = 'A2'`).run();
    const [fire] = fireLines(hub, FX.station, ['A1', 'A2']);
    expect(rows('SELECT event_id FROM events WHERE event_id = ?', fire!.event_id)).toHaveLength(1);
    expect((hub.deps.state.get() as EngineState).lines.A1!.fired_at).toBe(fire!.recorded_at);
    expect(tickets()).toEqual([]);
    expect(ticketLines()).toEqual([]);
    expect(jobs()).toEqual([]);
    expect(rows('SELECT * FROM print_fold_skips')).toEqual([
      { event_id: fire!.event_id, station_id: FX.station, order_ids: JSON.stringify([a]), reason: 'line_missing', at: fire!.recorded_at, alerted_at: null },
    ]);
    expect(skips).toEqual([{ event_id: fire!.event_id, event_type: 'FireDispatched', station_id: FX.station, reason: 'line_missing' }]);
  });

  it('[03c #8, §3.3, D1] a corrupt station_outputs row → the fire commits; its tickets stay (only the jobs are skipped); a print_fold_skips row; rebuild = live', () => {
    printer('PR1');
    const a = order('A');
    hub.deps.db.pragma('ignore_check_constraints = ON');
    hub.deps.db.prepare(`INSERT INTO station_outputs (station_id, mode, printer_id) VALUES (?, 'paper', 'PR1')`).run(FX.station);
    hub.deps.db.pragma('ignore_check_constraints = OFF');
    const [fire] = fireLines(hub, FX.station, ['A1']);
    expect(rows('SELECT event_id FROM events WHERE event_id = ?', fire!.event_id)).toHaveLength(1);
    expect(tickets().map((t) => t.ticket_id)).toEqual([`${fire!.event_id}:${a}`]);
    expect(ticketLines().map((l) => l.order_item_id)).toEqual(['A1']);
    expect(jobs()).toEqual([]);
    expect(rows('SELECT event_id, reason FROM print_fold_skips')).toEqual([{ event_id: fire!.event_id, reason: 'bad_output' }]);
    expect(skips).toEqual([{ event_id: fire!.event_id, event_type: 'FireDispatched', station_id: FX.station, reason: 'bad_output' }]);
    const live = { tickets: tickets(), lines: ticketLines() };
    hub.deps.db.prepare('DELETE FROM ticket_lines').run();
    hub.deps.db.prepare('DELETE FROM tickets').run();
    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'kitchen_tickets'`).run();
    const registry = createProjectionRegistry();
    registry.register(ticketsProjection(registry));
    registry.catchUp(hub.deps.db, branch());
    expect({ tickets: tickets(), lines: ticketLines() }).toEqual(live);
  });

  it('[03c §3.3] a fire re-listing a line already on a ticket makes no empty ticket and no kitchen job; only its new lines are ticketed', () => {
    printer('PR1');
    output(FX.station, 'both', 'PR1');
    const a = order('A', 3);
    const [f1] = fireLines(hub, FX.station, ['A1']);
    kdsAppend(hub, [fireDraft(FX.station, ['A1'])]);
    expect(tickets().map((t) => t.ticket_id)).toEqual([`${f1!.event_id}:${a}`]);
    expect(jobs().map((j) => j.job_id)).toEqual([`${f1!.event_id}:${a}:kitchen`]);
    const [f3] = kdsAppend(hub, [fireDraft(FX.station, ['A1', 'A2'])]);
    expect(ticketLines().map((l) => [l.order_item_id, l.ticket_id])).toEqual([
      ['A1', `${f1!.event_id}:${a}`],
      ['A2', `${f3!.event_id}:${a}`],
    ]);
    expect(jobs().map((j) => j.job_id).sort()).toEqual([`${f1!.event_id}:${a}:kitchen`, `${f3!.event_id}:${a}:kitchen`].sort());
    expect(skips).toEqual([]);
  });

  it('[03c #8, §3.3] a screen station with a fallback printer gets a skip row; a station with no printer only the log line; catch-up never writes skip rows', () => {
    printer('PR1');
    output(FX.station, 'screen', 'PR1');
    output(FX.zoneStation, 'screen', null);
    order('A');
    hub.deps.db.prepare(`DELETE FROM order_lines WHERE order_item_id IN ('A1', 'A2')`).run();
    const [f1] = fireLines(hub, FX.station, ['A1']);
    const [f2] = fireLines(hub, FX.zoneStation, ['A2']);
    expect(rows('SELECT event_id, station_id, order_ids, reason FROM print_fold_skips')).toEqual([
      { event_id: f1!.event_id, station_id: FX.station, order_ids: '[]', reason: 'line_missing' },
    ]);
    expect(skips.map((s) => s.event_id)).toEqual([f1!.event_id, f2!.event_id]);

    hub.deps.db.prepare('DELETE FROM print_fold_skips').run();
    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'kitchen_tickets'`).run();
    const registry = createProjectionRegistry();
    const caught: FoldSkippedLine[] = [];
    registry.register(ticketsProjection(registry));
    registry.catchUp(hub.deps.db, branch());
    bindTicketsLog(registry, (line) => caught.push(line));
    expect(rows('SELECT * FROM print_fold_skips')).toEqual([]);
    expect(caught.map((s) => s.event_id)).toEqual([f1!.event_id, f2!.event_id]);
  });
});

describe('[03c #10] registration order', () => {
  it('[03c #10, §3.3] boot order: 02b orders → 03b kds → 03c print_config, kitchen_tickets (last)', () => {
    const order = Object.keys(hub.deps.projections.catchUp(hub.deps.db, branch()).replayed);
    const kds = createProjectionRegistry();
    registerOrdersProjection(kds);
    registerKdsProjections(kds);
    const kdsNames = Object.keys(kds.catchUp(hub.deps.db, branch()).replayed);
    const from = order.indexOf('orders');
    expect(from).toBeGreaterThanOrEqual(0);
    expect(order.slice(from)).toEqual([...kdsNames, 'print_config', 'kitchen_tickets']);
  });
});
