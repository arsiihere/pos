import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerPrintProjections } from '../../src/print/index';
import { createProjectionRegistry } from '../../src/projections/registry';
import { createTestHub, type TestHub } from '../helpers/test-hub';

// 03c §3.2, §5 (task c4): projection `print_config` (reset) over the real 0015 tables, fed real `PrinterSaved` /
// `StationOutputSet` events through the hub writer (their commands are c5).
let hub: TestHub;

beforeEach(async () => {
  hub = await createTestHub();
});
afterEach(async () => {
  await hub.close();
});

const branch = (): string => hub.deps.config.provisioned!.branch_id;

/** One writer transaction of hub-stream events, clock +1 s first; returns its recorded time. */
function append(...events: Array<{ event_type: 'PrinterSaved' | 'StationOutputSet'; payload: object }>): number {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) =>
    tx.append(
      events.map((e) => ({
        stream_type: 'hub' as const,
        stream_id: branch(),
        event_type: e.event_type,
        schema_version: 1,
        payload: e.payload as Record<string, unknown>,
        occurred_at: now,
        actor_id: null,
        device_id: 'D_ADMIN',
      })),
    ),
  );
  return now;
}

const printer = (printer_id: string, o: { name?: string; archived?: boolean; connection?: 'lan' | 'usb'; address?: string; paper?: 58 | 80 } = {}) => ({
  event_type: 'PrinterSaved' as const,
  payload: {
    printer_id,
    name: o.name ?? printer_id,
    connection: o.connection ?? 'lan',
    address: o.address ?? '192.168.1.50:9100',
    paper_width_mm: o.paper ?? 80,
    archived: o.archived ?? false,
  },
});
const output = (station_id: string, mode: 'screen' | 'both' | 'printer', printer_id: string | null, o: { taker?: boolean; orderId?: boolean } = {}) => ({
  event_type: 'StationOutputSet' as const,
  payload: { station_id, mode, printer_id, show_taker: o.taker ?? true, show_order_id: o.orderId ?? true },
});

const dump = () => ({
  printers: hub.deps.db.prepare('SELECT * FROM printers ORDER BY printer_id').all(),
  station_outputs: hub.deps.db.prepare('SELECT * FROM station_outputs ORDER BY station_id').all(),
});
const runtime = () => hub.deps.db.prepare('SELECT * FROM printer_runtime ORDER BY printer_id').all();

/** A rebuild of `print_config` alone from seq 0: no checkpoint → `reset` runs first (registry.ts:71). */
function rebuild(): number {
  hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'print_config'`).run();
  const registry = createProjectionRegistry();
  registerPrintProjections(registry);
  return registry.catchUp(hub.deps.db, branch()).replayed.print_config ?? 0;
}

/** A config history: add, edit, archive, rename into a freed name, outputs set and changed. */
function configDay(): { t1: number; t3: number; t5: number } {
  const t1 = append(printer('PR1', { name: 'Kitchen' }), printer('PR2', { name: 'Bar', connection: 'usb', address: '/dev/usb/lp0', paper: 58 }));
  append(output('S1', 'both', 'PR1'), output('S2', 'screen', 'PR2', { taker: false }));
  const t3 = append(printer('PR1', { name: 'Kitchen', address: '192.168.1.60:9100' }));
  append(output('S2', 'printer', 'PR1', { orderId: false }), output('S3', 'screen', null));
  const t5 = append(printer('PR2', { name: 'Bar', connection: 'usb', address: '/dev/usb/lp0', paper: 58, archived: true }));
  append(printer('PR3', { name: 'Bar' }));
  return { t1, t3, t5 };
}

describe('[03c §3.2, §5] projection print_config', () => {
  it('[03c §3.2] live folds: PrinterSaved upserts printers (archived_at, updated_at); StationOutputSet upserts station_outputs', () => {
    const { t1, t3, t5 } = configDay();
    expect(dump()).toEqual({
      printers: [
        { printer_id: 'PR1', name: 'Kitchen', connection: 'lan', address: '192.168.1.60:9100', paper_width_mm: 80, archived_at: null, updated_at: t3 },
        { printer_id: 'PR2', name: 'Bar', connection: 'usb', address: '/dev/usb/lp0', paper_width_mm: 58, archived_at: t5, updated_at: t5 },
        { printer_id: 'PR3', name: 'Bar', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived_at: null, updated_at: t5 + 1_000 },
      ],
      station_outputs: [
        { station_id: 'S1', mode: 'both', printer_id: 'PR1', show_taker: 1, show_order_id: 1 },
        { station_id: 'S2', mode: 'printer', printer_id: 'PR1', show_taker: 1, show_order_id: 0 },
        { station_id: 'S3', mode: 'screen', printer_id: null, show_taker: 1, show_order_id: 1 },
      ],
    });
    expect(t1).toBeLessThan(t3);
  });

  it('[03c §3.2] archive keeps its first time; a later save of the archived printer moves only updated_at; un-archive clears it', () => {
    const t1 = append(printer('PR1', { archived: true }));
    const t2 = append(printer('PR1', { archived: true, name: 'Old' }));
    expect(hub.deps.db.prepare('SELECT name, archived_at, updated_at FROM printers').get()).toEqual({ name: 'Old', archived_at: t1, updated_at: t2 });
    const t3 = append(printer('PR1', { archived: false, name: 'Old' }));
    expect(hub.deps.db.prepare('SELECT archived_at, updated_at FROM printers').get()).toEqual({ archived_at: null, updated_at: t3 });
  });

  it('[03c §3.2, §5] rebuild from seq 0 (no checkpoint → reset) equals the live tables', () => {
    configDay();
    const live = dump();
    expect(live.printers.length).toBe(3);
    // stale rows a reset must clear (a projection rebuilt over a restored db, §5 "print_config projection (reset)")
    hub.deps.db.prepare(`INSERT INTO station_outputs (station_id, mode, printer_id) VALUES ('S_STALE', 'screen', NULL)`).run();
    expect(rebuild()).toBe(9);
    expect(dump()).toEqual(live);
  });

  it('[03c #29 half, §3.2] a print_config rebuild keeps printer_runtime (worker facts outside the projection)', () => {
    configDay();
    hub.deps.db
      .prepare(
        `INSERT INTO printer_runtime (printer_id, supports_status, last_status, last_status_at, last_clean_at, last_ack_at, last_error, problem_alert_id)
         VALUES ('PR1', 1, 'paper_end', 5, 4, 3, 'EPIPE', 'AL1')`,
      )
      .run();
    const before = runtime();
    expect(before.length).toBe(1);
    rebuild();
    expect(runtime()).toEqual(before);
  });
});
