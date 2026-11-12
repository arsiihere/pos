import type { PrinterSavedPayload, StationOutputSetPayload } from '@pos/events';
import type { Projection } from '../projections/registry.js';

// 03c §3.2, §5 (task c4): projection `print_config` (reset) over `printers` and `station_outputs`. Hub-local config:
// events on `hub` / branch_id. `printer_runtime` is worker-owned and outside the projection, so a rebuild keeps it.
export const printConfigProjection: Projection = {
  name: 'print_config',
  eventTypes: ['PrinterSaved', 'StationOutputSet'],
  apply(tx, event) {
    if (event.event_type === 'PrinterSaved') {
      const p = event.payload as PrinterSavedPayload;
      // archived_at keeps the first archive time; an un-archive clears it.
      tx.prepare(
        `INSERT INTO printers (printer_id, name, connection, address, paper_width_mm, archived_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (printer_id) DO UPDATE SET
           name = excluded.name, connection = excluded.connection, address = excluded.address,
           paper_width_mm = excluded.paper_width_mm,
           archived_at = CASE WHEN excluded.archived_at IS NULL THEN NULL ELSE COALESCE(printers.archived_at, excluded.archived_at) END,
           updated_at = excluded.updated_at`,
      ).run(p.printer_id, p.name, p.connection, p.address, p.paper_width_mm, p.archived ? event.recorded_at : null, event.recorded_at);
      return;
    }
    const s = event.payload as StationOutputSetPayload;
    tx.prepare(
      `INSERT INTO station_outputs (station_id, mode, printer_id, show_taker, show_order_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (station_id) DO UPDATE SET
         mode = excluded.mode, printer_id = excluded.printer_id,
         show_taker = excluded.show_taker, show_order_id = excluded.show_order_id`,
    ).run(s.station_id, s.mode, s.printer_id, s.show_taker ? 1 : 0, s.show_order_id ? 1 : 0);
  },
  reset(tx) {
    tx.prepare('DELETE FROM printers').run();
    tx.prepare('DELETE FROM station_outputs').run();
  },
};
